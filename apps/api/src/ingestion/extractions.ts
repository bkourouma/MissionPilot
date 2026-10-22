import type { ExtractionDecision, NatureExtraction, StatutExtraction } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { lireDocument, type DocumentIngestion } from "./documents.js";
import { natureDe } from "./natures.js";

/*
 * Service GÉNÉRIQUE des brouillons d'extraction (lot 6, ADR-009) : « l'IA propose, l'expert dispose ».
 * Un brouillon naît `brouillon_ia` ; un humain le corrige (`modifie`) puis un valideur le valide ou le
 * rejette. Un brouillon non validé ne nourrit RIEN. Le contenu est relu par la NATURE (`natures.ts`) à
 * chaque écriture humaine ; la validation exécute `appliquer` de la nature (s'il existe) dans la même
 * transaction et enregistre son `resultat`.
 *
 * DROITS : ce service ne vérifie AUCUN droit. Les routes qui l'appellent (DD, standard) contrôlent AVANT :
 * la permission de leur domaine (`dd.ecrire`, `dd.valider`, `standard.gerer`…), la visibilité du dossier DD
 * ou du brouillon de méthode (404 sinon, y compris pour un autre cabinet), et, pour la décision, le droit
 * de valider. Seule la séparation des tâches est aussi imposée ici (valideur différent de l'auteur du
 * téléversement, du demandeur de la lecture et du dernier modificateur, sauf associé) en plus du déclencheur
 * MQG02 de la base, qui double la règle.
 *
 * Aucun journal ne contient le contenu du brouillon.
 */

export interface ExtractionLigne {
  id: string;
  cabinet_id: string;
  document_id: string;
  nature: NatureExtraction;
  statut: StatutExtraction;
  contenu: Record<string, unknown>;
  ia_demande_id: string | null;
  chiffres_non_verifies: boolean;
  cree_par: string;
  /** Demandeur de la lecture (auteur du téléversement ou de la dernière relance). */
  demande_par: string;
  cree_le: Date;
  modifie_par: string | null;
  modifie_par_nom: string | null;
  modifie_le: Date | null;
  valide_par: string | null;
  valide_par_nom: string | null;
  valide_le: Date | null;
  motif_rejet: string | null;
  resultat: Record<string, unknown> | null;
}

export interface VueExtraction {
  id: string;
  document_id: string;
  nature: NatureExtraction;
  statut: StatutExtraction;
  contenu: Record<string, unknown>;
  chiffres_non_verifies: boolean;
  cree_le: string | null;
  modifie_par: { id: string; nom: string } | null;
  modifie_le: string | null;
  valide_par: { id: string; nom: string } | null;
  valide_le: string | null;
  motif_rejet: string | null;
  resultat: Record<string, unknown> | null;
}

const COLONNES = `x.id, x.cabinet_id, x.document_id, x.nature, x.statut, x.contenu, x.ia_demande_id,
  x.chiffres_non_verifies, x.cree_par, x.demande_par, x.cree_le, x.modifie_par, um.nom AS modifie_par_nom, x.modifie_le,
  x.valide_par, uv.nom AS valide_par_nom, x.valide_le, x.motif_rejet, x.resultat`;
const DEPUIS = `ingestion_extractions x
  LEFT JOIN utilisateurs um ON um.id = x.modifie_par
  LEFT JOIN utilisateurs uv ON uv.id = x.valide_par`;

const horodatage = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : ((v as string | null | undefined) ?? null);

export function vueExtraction(x: ExtractionLigne): VueExtraction {
  return {
    id: x.id,
    document_id: x.document_id,
    nature: x.nature,
    statut: x.statut,
    contenu: x.contenu,
    chiffres_non_verifies: x.chiffres_non_verifies,
    cree_le: horodatage(x.cree_le),
    modifie_par: x.modifie_par ? { id: x.modifie_par, nom: x.modifie_par_nom ?? "" } : null,
    modifie_le: horodatage(x.modifie_le),
    valide_par: x.valide_par ? { id: x.valide_par, nom: x.valide_par_nom ?? "" } : null,
    valide_le: horodatage(x.valide_le),
    motif_rejet: x.motif_rejet,
    resultat: x.resultat,
  };
}

/** Extraction par identifiant (404 si inconnue ou d'un autre cabinet, par RLS). */
export async function lireExtraction(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<ExtractionLigne> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE x.id = $1 ${verrouiller ? "FOR UPDATE OF x" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Extraction");
  return r.rows[0] as ExtractionLigne;
}

/** Vues des extractions d'un document, la plus récente d'abord. */
export async function listerExtractions(db: Db, documentId: string): Promise<VueExtraction[]> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE x.document_id = $1 ORDER BY x.cree_le DESC, x.id DESC`,
    [documentId],
  );
  return (r.rows as ExtractionLigne[]).map(vueExtraction);
}

export interface EntreeBrouillon {
  nature: NatureExtraction;
  /** Contenu DÉJÀ relu et borné par la nature. */
  contenu: Record<string, unknown>;
  /** Demande de l'orchestrateur (ia_demandes) dont le brouillon est issu. */
  iaDemandeId: string | null;
  chiffresNonVerifies: boolean;
}

/**
 * Crée le brouillon d'un document (cree_par = auteur du document ; demande_par = dernier demandeur de la
 * lecture, lu dans la table : `derniere_demande_par`, à défaut l'auteur). 409 si un brouillon est déjà ouvert pour
 * ce document (une relance exige de trancher le précédent). Renvoie l'identifiant.
 */
export async function creerBrouillon(
  db: Db,
  document: Pick<DocumentIngestion, "id" | "cabinet_id" | "cree_par" | "usage">,
  entree: EntreeBrouillon,
): Promise<string> {
  const ouvert = await db.query(
    `SELECT 1 FROM ingestion_extractions WHERE document_id = $1 AND statut IN ('brouillon_ia', 'modifie')`,
    [document.id],
  );
  if (ouvert.rows[0]) {
    throw new AppError(
      409,
      "EXTRACTION_OUVERTE",
      "Un brouillon est déjà ouvert pour ce document : validez-le ou rejetez-le d'abord.",
    );
  }
  const r = await db.query(
    `INSERT INTO ingestion_extractions (cabinet_id, document_id, nature, contenu, ia_demande_id,
       chiffres_non_verifies, cree_par, demande_par)
     SELECT $1::uuid, d.id, $3::text, $4::jsonb, $5::uuid, $6::boolean, $7::uuid, coalesce(d.derniere_demande_par, d.cree_par)
     FROM ingestion_documents d WHERE d.id = $2 RETURNING id`,
    [
      document.cabinet_id,
      document.id,
      entree.nature,
      JSON.stringify(entree.contenu),
      entree.iaDemandeId,
      entree.chiffresNonVerifies,
      document.cree_par,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: document.cabinet_id,
    utilisateurId: document.cree_par,
    action: "ingestion.brouillon",
    entite: "ingestion_extraction",
    entiteId: id,
    details: { document_id: document.id, nature: entree.nature },
  });
  return id;
}

const ouverte = (x: ExtractionLigne) => x.statut === "brouillon_ia" || x.statut === "modifie";

/** Correction humaine : le contenu complet remplace le précédent (relu par la nature) ; statut `modifie`. */
export async function modifierExtraction(
  db: Db,
  auth: Auth,
  id: string,
  contenu: unknown,
): Promise<VueExtraction> {
  const x = await lireExtraction(db, id, true);
  if (!ouverte(x)) throw conflit("Seul un brouillon ouvert se corrige.");
  const api = natureDe(x.nature);
  const pages = await db.query(
    "SELECT numero, texte FROM ingestion_pages WHERE document_id = $1 ORDER BY numero",
    [x.document_id],
  );
  const valide = api.validerContenu(contenu, pages.rows as { numero: number; texte: string }[]);
  await db.query(
    `UPDATE ingestion_extractions SET statut = 'modifie', contenu = $2, chiffres_non_verifies = $3,
       modifie_par = $4, modifie_le = now() WHERE id = $1`,
    [id, JSON.stringify(valide), api.contientNonVerifie(valide), auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "ingestion.modifier",
    entite: "ingestion_extraction",
    entiteId: id,
    details: { document_id: x.document_id, nature: x.nature },
  });
  return vueExtraction(await lireExtraction(db, id));
}

const SQLSTATE_EXTRACTION = "MQG02";

const validationRequise = () =>
  new AppError(
    403,
    "VALIDATION_REQUISE",
    "L'auteur du téléversement, le demandeur de la lecture et le dernier modificateur ne valident pas leur propre brouillon : le faire valider par un autre membre.",
  );

/**
 * Décision sur un brouillon ouvert. Valider un brouillon qui contient des éléments non vérifiés exige
 * `acquitte_chiffres` (409 CHIFFRES_A_ACQUITTER) ; l'auteur du téléversement du document, le demandeur de la
 * lecture et le dernier modificateur ne valident pas (sauf associé, 403 VALIDATION_REQUISE), contrôle fait
 * AVANT `appliquer` ; le rejet n'est pas concerné ; après validation, `appliquer` de la nature s'exécute et son résultat est
 * enregistré avec la décision (une extraction tranchée n'est plus modifiable).
 */
export async function deciderExtraction(
  db: Db,
  auth: Auth,
  id: string,
  decision: ExtractionDecision,
): Promise<VueExtraction> {
  const x = await lireExtraction(db, id, true);
  if (!ouverte(x)) {
    throw new AppError(409, "EXTRACTION_TRANCHEE", "Cette extraction est déjà tranchée.");
  }
  let resultat: Record<string, unknown> | null = null;
  if (decision.decision === "validee") {
    if (x.chiffres_non_verifies && decision.acquitte_chiffres !== true) {
      throw new AppError(
        409,
        "CHIFFRES_A_ACQUITTER",
        "Le brouillon cite des éléments non vérifiés dans le document : relisez-les puis acquittez-les pour valider.",
      );
    }
    const doc = await lireDocument(db, x.document_id);
    if (
      [doc?.cree_par, x.cree_par, x.demande_par, x.modifie_par].includes(auth.utilisateurId) &&
      !estAssocie(auth)
    ) {
      throw validationRequise();
    }
    const appliquer = natureDe(x.nature).appliquer;
    if (appliquer && doc) resultat = await appliquer(db, auth, x, doc);
  }
  try {
    await db.query(
      `UPDATE ingestion_extractions SET statut = $2, valide_par = $3, valide_le = now(),
         motif_rejet = $4, resultat = $5 WHERE id = $1`,
      [
        id,
        decision.decision === "validee" ? "valide" : "rejete",
        auth.utilisateurId,
        decision.decision === "rejetee" ? (decision.motif ?? null) : null,
        resultat === null ? null : JSON.stringify(resultat),
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === SQLSTATE_EXTRACTION) throw validationRequise();
    throw error;
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: decision.decision === "validee" ? "ingestion.valider" : "ingestion.rejeter",
    entite: "ingestion_extraction",
    entiteId: id,
    details: {
      document_id: x.document_id,
      nature: x.nature,
      acquitte_chiffres: decision.acquitte_chiffres === true,
    },
  });
  return vueExtraction(await lireExtraction(db, id));
}
