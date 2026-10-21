import type {
  CartographieCauses,
  CritereAlerte,
  EntreeCauses,
  NiveauAlerte,
  StatutCritereAlerte,
} from "@missionpilot/engines";
import type {
  RedCausesListeVue,
  RedCausesRangVue,
  RedCausesVersionVue,
  RedCauseVue,
  StatutContenu,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { exigerDossierRedEcriture, type AccesDossierRed, type DossierRed } from "./acces.js";
import { derniereUrgence } from "./urgence.js";
import { calculerRatiosDossier } from "./ratios.js";
import { journalRed } from "./journal.js";
import type { PlafondDebit } from "./limites.js";
import { projectionCourante } from "./tresorerie.js";
import { iso, isoOuVide, personne } from "./vues.js";

/*
 * Cartographie des causes racines (RED-04) : stockage, historique, modification et validation.
 * L'IA PROPOSE (la génération vit dans causes-ia.ts, seul fichier du module qui parle à l'IA) ;
 * le consultant modifie puis valide. Règles du circuit humain, doublées par la base (0488) :
 * - historique en ajout seul : « brouillon_ia » (rang 1), « modifie », « valide » (MPZ13) ;
 * - une cartographie ne passe à « valide » que par un rang « valide » du dernier historique
 *   (MPZ14) ; seule une cartographie validée est exploitable dans un livrable (`causesValidees`) ;
 * - séparation des tâches : le valideur n'est ni le demandeur ni l'auteur d'un rang, sauf associé
 *   (403 APPROBATION_REQUISE, doublé par MPZ07) ;
 * - des nombres que les moteurs n'ont pas produits exigent un acquittement explicite
 *   (409 CHIFFRES_NON_VERIFIES) ;
 * - journal d'audit : identifiants, comptes et indicateurs seulement, jamais un texte de cause.
 */

/** Débits PROVISOIRES (DECISIONS.md), à calibrer : comptés sur `journal_audit` (limites.ts). */
export const DEBIT_CAUSES_GENERATION: PlafondDebit = {
  entite: "red_causes",
  action: "generation",
  maximum: 10,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_PROPOSITIONS_CAUSES",
  message: "Au plus 10 propositions de causes racines par 10 minutes : réessayez plus tard.",
};
export const DEBIT_CAUSES_MODIFICATION: PlafondDebit = {
  entite: "red_causes",
  action: "modification",
  maximum: 60,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_MODIFICATIONS_CAUSES",
  message: "Au plus 60 modifications de causes racines par 10 minutes : réessayez plus tard.",
};

/* ----- Lecture ----- */

interface LigneVersion {
  id: string;
  dossier_id: string;
  version: number;
  contenu: { causes?: Record<string, unknown>[] };
  statut: "brouillon" | "valide";
  gabarit: boolean;
  demande_id: string;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  modifie_le: Date;
  valide_par: string | null;
  valide_par_nom: string | null;
  valide_le: Date | null;
}
interface LigneRang {
  version_id: string;
  rang: number;
  statut_contenu: StatutContenu;
  auteur_id: string;
  auteur_nom: string;
  demande_id: string | null;
  brief: Record<string, unknown> | null;
  gabarit: boolean;
  chiffres_non_verifies: boolean;
  nombres_non_verifies: string[];
  chiffres_acquittes: boolean;
  cree_le: Date;
}

const COLONNES_VERSION = `v.id, v.dossier_id, v.version, v.contenu, v.statut, v.gabarit, v.demande_id,
  v.cree_par, cu.nom AS cree_par_nom, v.cree_le, v.modifie_le, v.valide_par, vu.nom AS valide_par_nom,
  v.valide_le`;
const DEPUIS_VERSION = `red_causes_versions v JOIN utilisateurs cu ON cu.id = v.cree_par
  LEFT JOIN utilisateurs vu ON vu.id = v.valide_par`;

async function rangsDe(db: Db, dossierId: string, versionId?: string): Promise<LigneRang[]> {
  const r = await db.query(
    `SELECT h.version_id, h.rang, h.statut_contenu, h.auteur_id, u.nom AS auteur_nom, h.demande_id,
       h.brief, h.gabarit, h.chiffres_non_verifies, h.nombres_non_verifies, h.chiffres_acquittes,
       h.cree_le
     FROM red_causes_historique h JOIN utilisateurs u ON u.id = h.auteur_id
     WHERE h.dossier_id = $1 AND ($2::uuid IS NULL OR h.version_id = $2)
     ORDER BY h.version_id, h.rang`,
    [dossierId, versionId ?? null],
  );
  return r.rows as LigneRang[];
}

function causesDe(contenu: LigneVersion["contenu"]): RedCauseVue[] {
  return (contenu.causes ?? []).map((c) => ({
    id: c.id as string,
    domaine: c.domaine as RedCauseVue["domaine"],
    libelle: c.libelle as string,
    description: c.description as string,
    confiance: (c.confiance as RedCauseVue["confiance"] | undefined) ?? null,
  }));
}

function vueVersion(v: LigneVersion, rangs: LigneRang[]): RedCausesVersionVue {
  const dernier = rangs[rangs.length - 1];
  return {
    id: v.id,
    dossier_id: v.dossier_id,
    version: v.version,
    statut: v.statut,
    statut_contenu: dernier?.statut_contenu ?? "brouillon_ia",
    exploitable_livrable: v.statut === "valide",
    gabarit: v.gabarit,
    chiffres_non_verifies: dernier?.chiffres_non_verifies ?? false,
    nombres_non_verifies: dernier?.nombres_non_verifies ?? [],
    chiffres_acquittes: dernier?.chiffres_acquittes ?? false,
    causes: causesDe(v.contenu),
    demande_id: v.demande_id,
    cree_par: personne(v.cree_par, v.cree_par_nom),
    cree_le: isoOuVide(v.cree_le),
    modifie_le: isoOuVide(v.modifie_le),
    valide_par: v.valide_par ? personne(v.valide_par, v.valide_par_nom) : null,
    valide_le: iso(v.valide_le),
    historique: rangs.map((x): RedCausesRangVue => ({
      rang: x.rang,
      statut_contenu: x.statut_contenu,
      auteur: personne(x.auteur_id, x.auteur_nom),
      chiffres_non_verifies: x.chiffres_non_verifies,
      chiffres_acquittes: x.chiffres_acquittes,
      cree_le: isoOuVide(x.cree_le),
    })),
  };
}

/** Cartographies d'un dossier, la plus récente d'abord, avec leur historique (30 au plus). */
export async function listerCauses(db: Db, dossier: DossierRed): Promise<RedCausesListeVue> {
  const versions = await db.query(
    `SELECT ${COLONNES_VERSION} FROM ${DEPUIS_VERSION} WHERE v.dossier_id = $1 ORDER BY v.version DESC`,
    [dossier.id],
  );
  const rangs = await rangsDe(db, dossier.id);
  return {
    elements: (versions.rows as LigneVersion[]).map((v) =>
      vueVersion(
        v,
        rangs.filter((x) => x.version_id === v.id),
      ),
    ),
  };
}

async function lireVue(db: Db, dossierId: string, versionId: string): Promise<RedCausesVersionVue> {
  const r = await db.query(
    `SELECT ${COLONNES_VERSION} FROM ${DEPUIS_VERSION} WHERE v.id = $1 AND v.dossier_id = $2`,
    [versionId, dossierId],
  );
  const v = r.rows[0] as LigneVersion | undefined;
  if (!v) throw introuvable("Cartographie des causes");
  return vueVersion(v, await rangsDe(db, dossierId, versionId));
}

/**
 * Dernière cartographie VALIDÉE d'un dossier, ou null : la seule exploitable dans un livrable
 * (rapport de clôture). Une proposition de l'IA non validée n'est jamais retournée.
 */
export async function causesValidees(
  db: Db,
  dossierId: string,
): Promise<RedCausesVersionVue | null> {
  const r = await db.query(
    `SELECT v.id FROM red_causes_versions v
     WHERE v.dossier_id = $1 AND v.statut = 'valide' ORDER BY v.version DESC LIMIT 1`,
    [dossierId],
  );
  const id = (r.rows[0] as { id: string } | undefined)?.id;
  return id ? lireVue(db, dossierId, id) : null;
}

/* ----- Données de diagnostic transmises au moteur ----- */

/**
 * Entrée des fonctions du moteur de causes : dernières sorties des moteurs du dossier (urgence,
 * score d'alerte, ratios du dernier exercice accepté, trésorerie courante). Rien n'est calculé ici.
 */
export async function lireEntreeCauses(db: Db, dossier: DossierRed): Promise<EntreeCauses> {
  const u = await derniereUrgence(db, dossier.id);
  const s = await db.query(
    `SELECT s.resultat FROM red_scores s WHERE s.dossier_id = $1
     ORDER BY s.cree_le DESC, s.id DESC LIMIT 1`,
    [dossier.id],
  );
  const score = (
    s.rows[0] as
      | {
          resultat: {
            score: number | null;
            niveau: NiveauAlerte;
            criteres: { critere: CritereAlerte; statut: StatutCritereAlerte }[];
          };
        }
      | undefined
  )?.resultat;
  const calcul = await calculerRatiosDossier(db, dossier);
  const tresorerie = await projectionCourante(db, dossier.id);
  return {
    urgence: u
      ? {
          domaines: u.resultat.domaines.map((d) => ({
            domaine: d.domaine,
            voyant: d.voyant,
            pourcentage: d.pourcentage,
          })),
        }
      : null,
    alerte: score
      ? {
          score: score.score,
          niveau: score.niveau,
          criteres: score.criteres.map((c) => ({ critere: c.critere, statut: c.statut })),
        }
      : null,
    ratios: calcul.exercices[0]?.ratios ?? null,
    tresorerie: tresorerie
      ? {
          semainesTension: [...tresorerie.projection.semainesTension],
          premiereSemaineTension: tresorerie.projection.premiereSemaineTension,
          besoinFinancement: tresorerie.projection.besoinFinancement,
          devise: dossier.devise,
        }
      : null,
  };
}

/* ----- Écriture ----- */

const contenuDe = (c: CartographieCauses) =>
  JSON.stringify({ version: c.version, causes: c.causes });

export interface NouvelleCartographie {
  cartographie: CartographieCauses;
  demandeId: string;
  gabarit: boolean;
  /** Résumé du besoin (indicateurs et comptes seulement, jamais un texte libre). */
  brief: Record<string, unknown>;
  nombresNonVerifies: readonly string[];
}

/** Enregistre une proposition : cartographie N du dossier (brouillon) et rang 1 « brouillon_ia ». */
export async function creerCartographie(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  p: NouvelleCartographie,
): Promise<RedCausesVersionVue> {
  const numero = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS n FROM red_causes_versions WHERE dossier_id = $1",
    [dossier.id],
  );
  const r = await db.query(
    `INSERT INTO red_causes_versions (cabinet_id, dossier_id, version, contenu, gabarit, demande_id,
       cree_par, modifie_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      numero.rows[0].n,
      contenuDe(p.cartographie),
      p.gabarit,
      p.demandeId,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO red_causes_historique (cabinet_id, dossier_id, version_id, rang, statut_contenu,
       auteur_id, demande_id, brief, gabarit, chiffres_non_verifies, nombres_non_verifies)
     VALUES ($1, $2, $3, 1, 'brouillon_ia', $4, $5, $6, $7, $8, $9)`,
    [
      auth.cabinetId,
      dossier.id,
      id,
      auth.utilisateurId,
      p.demandeId,
      JSON.stringify(p.brief),
      p.gabarit,
      p.nombresNonVerifies.length > 0,
      JSON.stringify(p.nombresNonVerifies),
    ],
  );
  await journalRed(db, auth, "red_causes", "generation", id, {
    dossier_id: dossier.id,
    demande_id: p.demandeId,
    version: numero.rows[0].n,
    gabarit: p.gabarit,
    causes: p.cartographie.causes.length,
    chiffres_non_verifies: p.nombresNonVerifies.length > 0,
  });
  return lireVue(db, dossier.id, id);
}

/** Cartographie en brouillon du dossier (verrouillée), ou 404 / 409 si elle est validée. */
export async function brouillonVerrouille(
  db: Db,
  dossierId: string,
  versionId: string,
): Promise<{ id: string; gabarit: boolean; rangs: LigneRang[] }> {
  const r = await db.query(
    `SELECT id, statut, gabarit FROM red_causes_versions WHERE id = $1 AND dossier_id = $2 FOR UPDATE`,
    [versionId, dossierId],
  );
  const v = r.rows[0] as { id: string; statut: string; gabarit: boolean } | undefined;
  if (!v) throw introuvable("Cartographie des causes");
  if (v.statut === "valide") {
    throw new AppError(
      409,
      "RED_CAUSES_VALIDEES",
      "Cartographie validée : définitive. Demandez une nouvelle proposition pour la faire évoluer.",
    );
  }
  return { id: v.id, gabarit: v.gabarit, rangs: await rangsDe(db, dossierId, versionId) };
}

/**
 * Retouche d'un consultant : nouveau rang « modifie » AVANT l'écriture du contenu (la base l'exige
 * dans la même transaction). `restants` : nombres venus du modèle qui figurent encore dans le
 * nouveau contenu (seuls ceux-là restent à acquitter ; un nombre ajouté par un consultant relève
 * de sa responsabilité d'expert).
 */
export async function inscrireModification(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  brouillon: { id: string; gabarit: boolean; rangs: LigneRang[] },
  cartographie: CartographieCauses,
  restants: readonly string[],
): Promise<RedCausesVersionVue> {
  const dernier = brouillon.rangs[brouillon.rangs.length - 1] as LigneRang;
  await db.query(
    `INSERT INTO red_causes_historique (cabinet_id, dossier_id, version_id, rang, statut_contenu,
       auteur_id, gabarit, chiffres_non_verifies, nombres_non_verifies)
     VALUES ($1, $2, $3, $4, 'modifie', $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      dossier.id,
      brouillon.id,
      dernier.rang + 1,
      auth.utilisateurId,
      brouillon.gabarit,
      restants.length > 0,
      JSON.stringify(restants),
    ],
  );
  await db.query("UPDATE red_causes_versions SET contenu = $2, modifie_par = $3 WHERE id = $1", [
    brouillon.id,
    contenuDe(cartographie),
    auth.utilisateurId,
  ]);
  await journalRed(db, auth, "red_causes", "modification", brouillon.id, {
    dossier_id: dossier.id,
    rang: dernier.rang + 1,
    causes: cartographie.causes.length,
    chiffres_non_verifies: restants.length > 0,
  });
  return lireVue(db, dossier.id, brouillon.id);
}

/**
 * Validation par un consultant : séparation des tâches, acquittement des nombres non vérifiés,
 * puis rang « valide » et passage de la cartographie à « valide » (la base exige les deux).
 */
export async function validerCauses(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  versionId: string,
  acquitteChiffres: boolean,
): Promise<RedCausesVersionVue> {
  const brouillon = await brouillonVerrouille(db, acces.dossier.id, versionId);
  const rangs = brouillon.rangs;
  const dernier = rangs[rangs.length - 1] as LigneRang;
  if (!estAssocie(auth) && rangs.some((x) => x.auteur_id === auth.utilisateurId)) {
    throw new AppError(
      403,
      "APPROBATION_REQUISE",
      "Le demandeur ou l'auteur d'une version d'une cartographie proposée par l'IA ne la valide pas lui-même.",
    );
  }
  if (dernier.chiffres_non_verifies && !acquitteChiffres) {
    throw new AppError(
      409,
      "CHIFFRES_NON_VERIFIES",
      "Des nombres de la cartographie ne viennent pas des moteurs de calcul : vérifiez-les puis acquittez-les explicitement.",
    );
  }
  const acquittes = dernier.chiffres_non_verifies && acquitteChiffres;
  await db.query(
    `INSERT INTO red_causes_historique (cabinet_id, dossier_id, version_id, rang, statut_contenu,
       auteur_id, gabarit, chiffres_non_verifies, nombres_non_verifies, chiffres_acquittes)
     VALUES ($1, $2, $3, $4, 'valide', $5, $6, $7, $8, $9)`,
    [
      auth.cabinetId,
      acces.dossier.id,
      brouillon.id,
      dernier.rang + 1,
      auth.utilisateurId,
      brouillon.gabarit,
      dernier.chiffres_non_verifies,
      JSON.stringify(dernier.nombres_non_verifies),
      acquittes,
    ],
  );
  await db.query(
    "UPDATE red_causes_versions SET statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1",
    [brouillon.id, auth.utilisateurId],
  );
  await journalRed(db, auth, "red_causes", "validation", brouillon.id, {
    dossier_id: acces.dossier.id,
    rang: dernier.rang + 1,
    acquitte_chiffres: acquittes,
  });
  return lireVue(db, acces.dossier.id, brouillon.id);
}

/** Accès en écriture au dossier d'une cartographie (404 si inconnue ou invisible), verrou pris. */
export async function accesCartographie(
  db: Db,
  auth: Auth,
  versionId: string,
): Promise<AccesDossierRed> {
  const r = await db.query("SELECT dossier_id FROM red_causes_versions WHERE id = $1", [versionId]);
  const ligne = r.rows[0] as { dossier_id: string } | undefined;
  if (!ligne) throw introuvable("Cartographie des causes");
  return exigerDossierRedEcriture(db, auth, ligne.dossier_id);
}
