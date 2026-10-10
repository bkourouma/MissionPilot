import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  decouperExigences,
  EXIGENCES_EXTRACTION_MAX,
  syntheseConformite,
  type ExigenceProposee,
  type StatutConformite,
} from "@missionpilot/engines";
import {
  AO_DOSSIER_TEXTE_MAX,
  AO_DOSSIER_TEXTE_MIN,
  AO_EXIGENCES_MAX,
  type DecisionExtraction,
  type ExigenceCreation,
  type ExigenceModification,
  type ExtractionExigences,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { authDe } from "../collaboration/entites.js";
import type { Database, Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { signauxInjection } from "../ia/donnees-non-fiables.js";
import { lireDemandeVisible } from "../ia/generations.js";
import { genererContenu, type DependancesIa, type ResultatExecution } from "../ia/orchestrateur.js";
import {
  assurerPromptAoExigences,
  DOSSIER_PROMPT_MAX,
  exigencesDepuisSortie,
  NOM_PROMPT_AO_EXIGENCES,
} from "../ia/prompts/gabarits/appels-offres.js";
import { refusType } from "../stockage/detection.js";
import type { FichierDb } from "../stockage/fichiers.js";
import { lireFiche, type FicheAo } from "./fiches.js";

/*
 * Exigences d'un dossier d'appel d'offres et matrice de conformité (AO-03).
 *
 * 1. Dossier : texte collé, ou fichier TEXTE (.txt, .csv) téléversé par POST /api/fichiers et
 *    lisible par l'utilisateur, lu borné (1 Mo, 200 000 caractères) ; un PDF ou un document
 *    bureautique n'est pas lu ici (chaîne d'ingestion et OCR à venir, ADR-009). Le texte est un
 *    contenu NON FIABLE (AGT-07) : signaux d'injection relevés et conservés, jamais suivis.
 * 2. Extraction : par l'ORCHESTRATEUR IA (prompt `ao_exigences_extraction`, dossier en variable
 *    non fiable, masquage, plafond, garde-chiffres, trace), ou par le découpage DÉTERMINISTE du
 *    moteur (repli : IA désactivée, sans clé, plafond atteint, sortie inexploitable, ou mode
 *    demandé). Toujours un BROUILLON : rien n'entre dans la matrice sans validation humaine.
 * 3. Matrice : lignes au libellé, à la catégorie et au caractère obligatoire figés ; statut,
 *    commentaire, pièce et responsable suivis (historique écrit par déclencheur) jusqu'au dépôt.
 *    La synthèse et la condition de dépôt sortent du moteur (`syntheseConformite`).
 */

/** Plafonds de volume par fiche (tables en ajout seul : 409 au-delà). */
export const AO_DOSSIERS_PAR_FICHE_MAX = 20;
export const AO_EXTRACTIONS_PAR_FICHE_MAX = 50;

/** Taille maximale d'un fichier texte de dossier lu par cette route. */
export const AO_DOSSIER_FICHIER_MAX = 1024 * 1024;
const TYPES_TEXTE = ["text/plain", "text/csv"];

const MESSAGES_ECHEC: Record<string, string> = {
  PLAFOND_IA_ATTEINT: "Plafond mensuel de coût IA atteint.",
  GENERATIONS_SIMULTANEES: "Trop de générations IA en cours pour le cabinet.",
};

/** Fiche encore en préparation de réponse (verrouillée), sinon 409. */
export async function exigerFicheOuverte(db: Db, aoId: string): Promise<FicheAo> {
  const fiche = await lireFiche(db, aoId, true);
  if (!["detecte", "go_no_go", "en_reponse"].includes(fiche.statut)) {
    throw new AppError(
      409,
      "AO_REPONSE_FIGEE",
      "La réponse n'est plus en préparation : matrice et rétro-planning sont figés.",
    );
  }
  return fiche;
}

/** Contrôle d'un fichier de dossier avant lecture : texte seulement, taille bornée. */
export function exigerFichierTexte(f: FichierDb): void {
  if (!TYPES_TEXTE.includes(f.type_mime)) {
    throw refusType(
      "Seul un fichier texte (.txt, .csv) se lit ici : collez le texte d'un PDF ou d'un document.",
    );
  }
  if (Number(f.taille) > AO_DOSSIER_FICHIER_MAX) {
    throw new AppError(413, "FICHIER_TROP_VOLUMINEUX", "Dossier texte limité à 1 Mo.");
  }
}

/** Lecture bornée d'un flux de stockage, décodée en UTF-8 (BOM retiré). */
export async function lireTexteBorne(
  flux: Readable,
  max = AO_DOSSIER_FICHIER_MAX,
): Promise<string> {
  const morceaux: Buffer[] = [];
  let total = 0;
  for await (const m of flux) {
    const b = Buffer.isBuffer(m) ? m : Buffer.from(m as Uint8Array);
    total += b.length;
    if (total > max) {
      flux.destroy();
      throw new AppError(413, "FICHIER_TROP_VOLUMINEUX", "Dossier texte limité à 1 Mo.");
    }
    morceaux.push(b);
  }
  // Le décodeur UTF-8 retire déjà l'éventuel BOM (ignoreBOM faux par défaut).
  return new TextDecoder("utf-8").decode(Buffer.concat(morceaux));
}

const COLONNES_DOSSIER = `d.id, d.ao_id, d.numero, d.source, d.nom_fichier, d.sha256,
  length(d.texte) AS longueur, left(d.texte, 300) AS apercu, d.signaux_injection, d.cree_par,
  u.nom AS cree_par_nom, d.cree_le`;

/** Enregistre un dossier (ajout seul) sur une fiche ouverte. */
export async function ajouterDossier(
  db: Db,
  auth: Auth,
  aoId: string,
  texteBrut: string,
  fichier: { nom: string } | null,
) {
  await exigerFicheOuverte(db, aoId);
  const nb = await db.query("SELECT count(*)::int AS n FROM ao_dossiers WHERE ao_id = $1", [aoId]);
  if ((nb.rows[0].n as number) >= AO_DOSSIERS_PAR_FICHE_MAX) {
    throw conflit(`Une fiche compte ${AO_DOSSIERS_PAR_FICHE_MAX} dossiers au plus.`);
  }
  const texte = texteBrut.replace(/\r\n?/g, "\n");
  if (texte.trim().length < AO_DOSSIER_TEXTE_MIN) {
    throw requeteInvalide("Le dossier est vide ou trop court pour en extraire des exigences.");
  }
  if (texte.length > AO_DOSSIER_TEXTE_MAX) {
    throw requeteInvalide("Dossier trop long : 200 000 caractères au plus.");
  }
  const signaux = signauxInjection(texte).slice(0, 20);
  const r = await db.query(
    `INSERT INTO ao_dossiers (cabinet_id, ao_id, numero, source, nom_fichier, sha256, texte,
       signaux_injection, cree_par)
     SELECT $1, $2, coalesce(max(numero), 0) + 1, $3, $4, $5, $6, $7, $8
     FROM ao_dossiers WHERE ao_id = $2
     RETURNING id`,
    [
      auth.cabinetId,
      aoId,
      fichier ? "fichier" : "texte",
      fichier?.nom.slice(0, 255) ?? null,
      createHash("sha256").update(texte, "utf8").digest("hex"),
      texte,
      signaux,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "ajout_dossier",
    entite: "appel_offres",
    entiteId: aoId,
    // Jamais le contenu : source, longueur et signaux d'injection.
    details: { dossier_id: id, source: fichier ? "fichier" : "texte", signaux },
  });
  const lu = await db.query(
    `SELECT ${COLONNES_DOSSIER} FROM ao_dossiers d JOIN utilisateurs u ON u.id = d.cree_par
     WHERE d.id = $1`,
    [id],
  );
  return lu.rows[0];
}

export async function dossiersDeFiche(db: Db, aoId: string) {
  const r = await db.query(
    `SELECT ${COLONNES_DOSSIER} FROM ao_dossiers d JOIN utilisateurs u ON u.id = d.cree_par
     WHERE d.ao_id = $1 ORDER BY d.numero DESC`,
    [aoId],
  );
  return r.rows;
}

const COLONNES_EXTRACTION = `x.id, x.ao_id, x.dossier_id, x.methode, x.ia_demande_id, x.gabarit,
  x.chiffres_non_verifies, x.tronque, x.propositions, x.nombre, x.statut, x.retenues, x.motif,
  x.acquitte_chiffres, x.tranche_par, x.tranche_le, x.cree_par, u.nom AS cree_par_nom, x.cree_le`;

export async function extractionsDeFiche(db: Db, aoId: string) {
  const r = await db.query(
    `SELECT ${COLONNES_EXTRACTION} FROM ao_extractions x JOIN utilisateurs u ON u.id = x.cree_par
     WHERE x.ao_id = $1 ORDER BY x.cree_le DESC, x.id DESC`,
    [aoId],
  );
  return r.rows;
}

async function lireExtraction(db: Db, id: string, verrouiller = false) {
  const r = await db.query(
    `SELECT ${COLONNES_EXTRACTION} FROM ao_extractions x JOIN utilisateurs u ON u.id = x.cree_par
     WHERE x.id = $1 ${verrouiller ? "FOR UPDATE OF x" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Extraction");
  return r.rows[0] as Record<string, unknown> & {
    id: string;
    ao_id: string;
    statut: string;
    propositions: ExigenceProposee[];
  };
}

/** Place restante pour une extraction sur la fiche (sous le verrou de la fiche), sinon 409. */
async function exigerPlaceExtraction(db: Db, aoId: string): Promise<void> {
  const r = await db.query("SELECT count(*)::int AS n FROM ao_extractions WHERE ao_id = $1", [
    aoId,
  ]);
  if ((r.rows[0].n as number) >= AO_EXTRACTIONS_PAR_FICHE_MAX) {
    throw conflit(`Une fiche compte ${AO_EXTRACTIONS_PAR_FICHE_MAX} extractions au plus.`);
  }
}

async function enregistrerExtraction(
  db: Db,
  auth: Auth,
  e: {
    aoId: string;
    dossierId: string;
    methode: "ia" | "deterministe";
    demandeId: string | null;
    gabarit: boolean;
    chiffresNonVerifies: boolean;
    tronque: boolean;
    propositions: ExigenceProposee[];
  },
) {
  await exigerPlaceExtraction(db, e.aoId);
  const r = await db.query(
    `INSERT INTO ao_extractions (cabinet_id, ao_id, dossier_id, methode, ia_demande_id, gabarit,
       chiffres_non_verifies, tronque, propositions, nombre, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      auth.cabinetId,
      e.aoId,
      e.dossierId,
      e.methode,
      e.demandeId,
      e.gabarit,
      e.chiffresNonVerifies,
      e.tronque,
      JSON.stringify(e.propositions),
      e.propositions.length,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "extraction_exigences",
    entite: "appel_offres",
    entiteId: e.aoId,
    details: {
      extraction_id: id,
      methode: e.methode,
      gabarit: e.gabarit,
      nombre: e.propositions.length,
      ia_demande_id: e.demandeId,
    },
  });
  return lireExtraction(db, id);
}

/**
 * Extraction des exigences d'un dossier (brouillon à valider). Mode « ia » : orchestrateur, avec
 * repli déterministe si la génération est un gabarit ou si sa sortie est inexploitable.
 */
export async function extraireExigences(
  database: Database,
  deps: DependancesIa,
  auth: Auth,
  aoId: string,
  corps: ExtractionExigences,
): Promise<{ extraction: Record<string, unknown>; resultat: ResultatExecution | null }> {
  const prep = await database.withTenant(auth.cabinetId, async (db) => {
    const fiche = await exigerFicheOuverte(db, aoId);
    // Avant tout appel IA payant : une fiche pleine refuse l'extraction.
    await exigerPlaceExtraction(db, aoId);
    const d = await db.query("SELECT id, texte FROM ao_dossiers WHERE id = $1 AND ao_id = $2", [
      corps.dossier_id,
      aoId,
    ]);
    if (!d.rows[0]) throw introuvable("Dossier");
    if (corps.mode === "ia") await assurerPromptAoExigences(db, auth.cabinetId);
    return { titre: fiche.titre, texte: d.rows[0].texte as string };
  });
  const repli = decouperExigences(prep.texte, EXIGENCES_EXTRACTION_MAX);

  if (corps.mode === "deterministe") {
    const extraction = await database.withTenant(auth.cabinetId, async (db) => {
      await exigerFicheOuverte(db, aoId);
      return enregistrerExtraction(db, auth, {
        aoId,
        dossierId: corps.dossier_id,
        methode: "deterministe",
        demandeId: null,
        gabarit: true,
        chiffresNonVerifies: false,
        tronque: repli.tronque,
        propositions: repli.exigences,
      });
    });
    return { extraction, resultat: null };
  }

  const { demandeId, resultat } = await genererContenu(database, deps, {
    tache: "extraction",
    promptNom: NOM_PROMPT_AO_EXIGENCES,
    variables: { titre: prep.titre, dossier: prep.texte.slice(0, DOSSIER_PROMPT_MAX) },
    // AGT-07 : le dossier (et le titre recopié d'un avis public) sont des données non fiables.
    variablesNonFiables: ["dossier", "titre"],
    termesSensibles: corps.termes_sensibles,
    entite: { type: "appel_offres", id: aoId },
    utilisateur: auth,
    repliSiPlafond: true,
  });

  const extraction = await database.withTenant(auth.cabinetId, async (db) => {
    await exigerFicheOuverte(db, aoId);
    const demande = await lireDemandeVisible(db, auth, demandeId);
    if (demande.statut !== "terminee" || demande.g_version === null) {
      const code = String(demande.erreur_code ?? "");
      throw new AppError(
        502,
        "GENERATION_IA_ECHEC",
        MESSAGES_ECHEC[code] ?? "L'extraction par l'IA a échoué : réessayez plus tard.",
      );
    }
    const proposees = demande.p_gabarit === true ? null : exigencesDepuisSortie(demande.g_donnees);
    const gabarit = proposees === null;
    return enregistrerExtraction(db, auth, {
      aoId,
      dossierId: corps.dossier_id,
      methode: "ia",
      demandeId,
      gabarit,
      chiffresNonVerifies: !gabarit && demande.g_chiffres_non_verifies === true,
      tronque: gabarit ? repli.tronque : prep.texte.length > DOSSIER_PROMPT_MAX,
      propositions: proposees ?? repli.exigences,
    });
  });
  return { extraction, resultat };
}

async function prochainNumero(db: Db, aoId: string, ajout: number): Promise<number> {
  const r = await db.query(
    "SELECT coalesce(max(numero), 0) AS n, count(*)::int AS total FROM ao_exigences WHERE ao_id = $1",
    [aoId],
  );
  if ((r.rows[0].total as number) + ajout > AO_EXIGENCES_MAX) {
    throw conflit(`La matrice compte ${AO_EXIGENCES_MAX} exigences au plus.`);
  }
  return (r.rows[0].n as number) + 1;
}

async function insererExigence(
  db: Db,
  auth: Auth,
  aoId: string,
  numero: number,
  e: ExigenceProposee & { responsable_id?: string | null },
  extractionId: string | null,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO ao_exigences (cabinet_id, ao_id, numero, libelle, categorie, obligatoire,
       reference, origine, extraction_id, responsable_id, cree_par, modifie_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [
      auth.cabinetId,
      aoId,
      numero,
      e.libelle,
      e.categorie,
      e.obligatoire,
      e.reference,
      extractionId ? "extraction" : "manuelle",
      extractionId,
      e.responsable_id ?? null,
      auth.utilisateurId,
    ],
  );
  return r.rows[0].id as string;
}

/** Validation humaine d'une extraction : les propositions retenues entrent dans la matrice. */
export async function trancherExtraction(
  db: Db,
  auth: Auth,
  extractionId: string,
  corps: DecisionExtraction,
) {
  const x = await lireExtraction(db, extractionId);
  await exigerFicheOuverte(db, x.ao_id);
  const verrou = await lireExtraction(db, extractionId, true);
  if (verrou.statut !== "brouillon") {
    throw new AppError(409, "AO_EXTRACTION_TRANCHEE", "Cette extraction est déjà tranchée.");
  }
  const propositions = verrou.propositions;
  let retenues: number[] = [];
  if (corps.decision === "validee") {
    retenues = [...new Set(corps.retenues ?? propositions.map((_, i) => i))].sort((a, b) => a - b);
    if (retenues.some((i) => i >= propositions.length)) {
      throw requeteInvalide("Rang de proposition inconnu.");
    }
    if (retenues.length === 0) throw requeteInvalide("Retenez au moins une exigence, ou rejetez.");
    if (verrou.chiffres_non_verifies === true && corps.acquitte_chiffres !== true) {
      throw new AppError(
        409,
        "CHIFFRES_A_ACQUITTER",
        "L'extraction cite des nombres non vérifiés : relisez-les puis acquittez-les pour valider.",
      );
    }
    let numero = await prochainNumero(db, x.ao_id, retenues.length);
    for (const i of retenues) {
      await insererExigence(db, auth, x.ao_id, numero, propositions[i] as ExigenceProposee, x.id);
      numero += 1;
    }
  }
  await db.query(
    `UPDATE ao_extractions SET statut = $2, retenues = $3, motif = $4, tranche_par = $5,
       acquitte_chiffres = $6, tranche_le = now() WHERE id = $1`,
    [
      extractionId,
      corps.decision,
      corps.decision === "validee" ? retenues : null,
      corps.motif ?? null,
      auth.utilisateurId,
      corps.decision === "validee" && corps.acquitte_chiffres === true,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "validation_extraction",
    entite: "appel_offres",
    entiteId: x.ao_id,
    details: {
      extraction_id: extractionId,
      decision: corps.decision,
      retenues: retenues.length,
      acquitte_chiffres: corps.acquitte_chiffres === true,
    },
  });
  return lireExtraction(db, extractionId);
}

async function exigerResponsable(db: Db, auth: Auth, id: string | null | undefined) {
  if (id && !(await authDe(db, auth.cabinetId, id))) {
    throw requeteInvalide("Responsable inconnu ou inactif.");
  }
}

export async function ajouterExigence(db: Db, auth: Auth, aoId: string, e: ExigenceCreation) {
  await exigerFicheOuverte(db, aoId);
  await exigerResponsable(db, auth, e.responsable_id);
  const numero = await prochainNumero(db, aoId, 1);
  const id = await insererExigence(
    db,
    auth,
    aoId,
    numero,
    {
      libelle: e.libelle,
      categorie: e.categorie,
      obligatoire: e.obligatoire,
      reference: e.reference ?? null,
      responsable_id: e.responsable_id ?? null,
    },
    null,
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "ajout_exigence",
    entite: "appel_offres",
    entiteId: aoId,
    details: { exigence_id: id },
  });
  return lireExigence(db, id);
}

const COLONNES_EXIGENCE = `x.id, x.ao_id, x.numero, x.libelle, x.categorie, x.obligatoire,
  x.reference, x.origine, x.extraction_id, x.statut, x.commentaire, x.piece, x.responsable_id,
  r.nom AS responsable_nom, x.modifie_par, x.modifie_le, x.cree_le`;
const DEPUIS_EXIGENCE = "ao_exigences x LEFT JOIN utilisateurs r ON r.id = x.responsable_id";

async function lireExigence(db: Db, id: string, verrouiller = false) {
  const r = await db.query(
    `SELECT ${COLONNES_EXIGENCE} FROM ${DEPUIS_EXIGENCE} WHERE x.id = $1
     ${verrouiller ? "FOR UPDATE OF x" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Exigence");
  return r.rows[0] as Record<string, unknown> & {
    id: string;
    ao_id: string;
    obligatoire: boolean;
    statut: StatutConformite;
    commentaire: string | null;
  };
}

/** Suivi d'une ligne de la matrice (statut, commentaire, pièce, responsable). */
export async function modifierExigence(db: Db, auth: Auth, id: string, m: ExigenceModification) {
  const avant = await lireExigence(db, id);
  await exigerFicheOuverte(db, avant.ao_id);
  const x = await lireExigence(db, id, true);
  if (m.responsable_id !== undefined) await exigerResponsable(db, auth, m.responsable_id);
  const statut = m.statut ?? x.statut;
  const commentaire = m.commentaire !== undefined ? m.commentaire : x.commentaire;
  if (statut === "sans_objet" && x.obligatoire && !commentaire) {
    throw requeteInvalide("Motivez en commentaire l'écart d'une exigence obligatoire.");
  }
  await db.query(
    `UPDATE ao_exigences SET statut = $2, commentaire = $3,
       piece = CASE WHEN $4::boolean THEN $5 ELSE piece END,
       responsable_id = CASE WHEN $6::boolean THEN $7::uuid ELSE responsable_id END,
       modifie_par = $8, modifie_le = now()
     WHERE id = $1`,
    [
      id,
      statut,
      commentaire ?? null,
      m.piece !== undefined,
      m.piece ?? null,
      m.responsable_id !== undefined,
      m.responsable_id ?? null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "suivi_exigence",
    entite: "appel_offres",
    entiteId: x.ao_id,
    details: { exigence_id: id, statut },
  });
  return lireExigence(db, id);
}

/** Matrice de conformité et sa synthèse (moteur). */
export async function matriceDeFiche(db: Db, aoId: string) {
  const r = await db.query(
    `SELECT ${COLONNES_EXIGENCE} FROM ${DEPUIS_EXIGENCE} WHERE x.ao_id = $1 ORDER BY x.numero`,
    [aoId],
  );
  const lignes = r.rows as { statut: StatutConformite; obligatoire: boolean }[];
  return { exigences: r.rows, synthese: syntheseConformite(lignes) };
}

export async function historiqueExigence(db: Db, id: string) {
  const x = await lireExigence(db, id);
  const r = await db.query(
    `SELECT s.id, s.statut, s.commentaire, s.piece, s.responsable_id, s.auteur_id,
       u.nom AS auteur_nom, s.cree_le
     FROM ao_exigences_suivi s JOIN utilisateurs u ON u.id = s.auteur_id
     WHERE s.exigence_id = $1 ORDER BY s.cree_le, s.id`,
    [id],
  );
  return { exigence: x, suivi: r.rows };
}
