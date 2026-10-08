import { valeursCourantesDatees } from "@missionpilot/engines";
import {
  FAITS_PAR_CLIENT_MAX,
  type CategorieFaitDossier,
  type FaitCreation,
  type FaitDecision,
  type SourceDossier,
  type StatutFaitDossier,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { exigerFichierLisible } from "../stockage/fichiers.js";
import { verrouillerDossier } from "./acces.js";
import { inscrireFiabilite } from "./fiabilite.js";

/*
 * Faits datés et sourcés du dossier (DOS-01, DOS-02). Ajout seul (0220) : une
 * correction est un nouveau fait qui remplace l'ancien ; le statut se dérive
 * (proposé, confirmé, rejeté, remplacé). Séparation des tâches : une proposition
 * n'est pas confirmée par son auteur (sauf associé) ; l'auteur peut la rejeter
 * (retrait). Un fait d'origine IA est toujours proposé et confirmé par un humain
 * dans une autre transaction (MPO03).
 */

export const COLONNES_FAIT = `f.id, f.client_id, f.categorie, f.cle, f.type_valeur, f.valeur,
  f.date_effet::text AS date_effet, f.source_type, f.source_libelle, f.source_document_id,
  f.source_page, f.source_reference, f.fiabilite, f.origine, f.commentaire, f.remplace_id,
  f.auteur_id, ua.nom AS auteur_nom, f.cree_le, d.decision, d.motif AS decision_motif,
  d.decideur_id, ud.nom AS decideur_nom, d.cree_le AS decide_le, r.id AS remplace_par_id`;

export const JOINTURES_FAIT = `FROM dossier_faits f
  JOIN utilisateurs ua ON ua.id = f.auteur_id
  LEFT JOIN dossier_faits_decisions d ON d.fait_id = f.id
  LEFT JOIN utilisateurs ud ON ud.id = d.decideur_id
  LEFT JOIN dossier_faits r ON r.remplace_id = f.id`;

/** Statut dérivé : remplacé l'emporte, puis la décision, sinon proposé. */
export function statutFait(ligne: Record<string, unknown>): StatutFaitDossier {
  if (ligne.remplace_par_id) return "remplace";
  if (ligne.decision === "rejete") return "rejete";
  return ligne.decision === "confirme" ? "confirme" : "propose";
}

const horodatage = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));

/** Projection d'un fait pour l'API (aucun champ interne au cabinet). */
export function vueFait(f: Record<string, unknown>) {
  return {
    id: f.id as string,
    client_id: f.client_id as string,
    categorie: f.categorie as CategorieFaitDossier,
    cle: f.cle as string,
    valeur: f.valeur,
    date_effet: f.date_effet as string,
    source: {
      type: f.source_type,
      libelle: f.source_libelle,
      document_id: f.source_document_id ?? null,
      page: f.source_page ?? null,
      reference: f.source_reference ?? null,
    },
    fiabilite: f.fiabilite as "A" | "B" | "C" | "D",
    origine: f.origine as "saisie" | "ia",
    commentaire: f.commentaire ?? null,
    statut: statutFait(f),
    remplace_id: f.remplace_id ?? null,
    remplace_par_id: f.remplace_par_id ?? null,
    auteur: { id: f.auteur_id, nom: f.auteur_nom },
    cree_le: horodatage(f.cree_le),
    decision: f.decision
      ? {
          decision: f.decision,
          motif: f.decision_motif ?? null,
          par: { id: f.decideur_id, nom: f.decideur_nom },
          le: horodatage(f.decide_le),
        }
      : null,
  };
}
export type VueFait = ReturnType<typeof vueFait>;

export type VueFaits = "courants" | "propositions" | "tous";

const FILTRES_VUE: Record<VueFaits, string> = {
  courants: "AND r.id IS NULL AND d.decision IS DISTINCT FROM 'rejete'",
  propositions: "AND r.id IS NULL AND d.decision IS NULL",
  tous: "",
};

/** Faits d'un client (plafonnés à FAITS_PAR_CLIENT_MAX : aucune troncature possible). */
export async function listerFaits(
  db: Db,
  clientId: string,
  vue: VueFaits,
  categorie?: CategorieFaitDossier,
): Promise<VueFait[]> {
  const r = await db.query(
    `SELECT ${COLONNES_FAIT} ${JOINTURES_FAIT}
     WHERE f.client_id = $1 AND ($2::text IS NULL OR f.categorie = $2) ${FILTRES_VUE[vue]}
     ORDER BY f.categorie, f.cle, f.date_effet DESC, f.cree_le DESC, f.id
     LIMIT $3`,
    [clientId, categorie ?? null, FAITS_PAR_CLIENT_MAX],
  );
  return r.rows.map(vueFait);
}

/**
 * Valeur courante de chaque clé (moteur `valeursCourantesDatees`) parmi les faits CONFIRMÉS
 * courants, à la date donnée : la vue « profil » du dossier.
 */
export function faitsCourantsParCle(faits: readonly VueFait[], aLaDate: string): VueFait[] {
  const confirmes = faits
    .filter((f) => f.statut === "confirme")
    .map((f) => ({
      fait: f,
      cle: `${f.categorie}/${f.cle}`,
      dateEffet: f.date_effet,
      rang: Date.parse(f.cree_le ?? "") || 0,
    }));
  return valeursCourantesDatees(confirmes, aLaDate).map((v) => v.fait);
}

async function lireFait(
  db: Db,
  clientId: string,
  faitId: string,
): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES_FAIT} ${JOINTURES_FAIT} WHERE f.id = $1 AND f.client_id = $2`,
    [faitId, clientId],
  );
  if (!r.rows[0]) throw introuvable("Fait");
  return r.rows[0];
}

/** Un document cité en source doit être lisible par l'auteur (404 sinon, même règle que /fichiers). */
async function controlerSource(db: Db, auth: Auth, source: SourceDossier): Promise<void> {
  if (source.document_id) await exigerFichierLisible(db, auth, source.document_id);
}

async function exigerPlace(db: Db, clientId: string): Promise<void> {
  const r = await db.query("SELECT count(*)::int AS n FROM dossier_faits WHERE client_id = $1", [
    clientId,
  ]);
  if ((r.rows[0].n as number) >= FAITS_PAR_CLIENT_MAX) {
    throw new AppError(409, "DOSSIER_PLEIN", `Au plus ${FAITS_PAR_CLIENT_MAX} faits par dossier.`);
  }
}

/**
 * Enregistre un fait saisi par un membre du cabinet ; « confirme » : l'auteur l'atteste
 * (décision inscrite dans la même transaction). Le dossier doit être visible (appelant).
 */
export async function creerFait(
  db: Db,
  auth: Auth,
  clientId: string,
  fait: FaitCreation,
): Promise<VueFait> {
  await verrouillerDossier(db, clientId);
  await exigerPlace(db, clientId);
  await controlerSource(db, auth, fait.source);
  if (fait.remplace_id) await lireFait(db, clientId, fait.remplace_id);
  const r = await db.query(
    `INSERT INTO dossier_faits (cabinet_id, client_id, categorie, cle, type_valeur, valeur, date_effet,
       source_type, source_libelle, source_document_id, source_page, source_reference, fiabilite,
       origine, commentaire, remplace_id, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'saisie', $14, $15, $16)
     RETURNING id`,
    [
      auth.cabinetId,
      clientId,
      fait.categorie,
      fait.cle,
      fait.valeur.type,
      JSON.stringify(fait.valeur),
      fait.date_effet,
      fait.source.type,
      fait.source.libelle,
      fait.source.document_id ?? null,
      fait.source.page ?? null,
      fait.source.reference ?? null,
      fait.fiabilite,
      fait.commentaire ?? null,
      fait.remplace_id ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  if (fait.statut === "confirme") {
    await db.query(
      `INSERT INTO dossier_faits_decisions (cabinet_id, fait_id, decision, decideur_id)
       VALUES ($1, $2, 'confirme', $3)`,
      [auth.cabinetId, id, auth.utilisateurId],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "dossier_fait",
    entiteId: id,
    details: {
      client_id: clientId,
      categorie: fait.categorie,
      cle: fait.cle,
      statut: fait.statut,
      remplace_id: fait.remplace_id ?? null,
    },
  });
  await inscrireFiabilite(db, auth, clientId);
  return vueFait(await lireFait(db, clientId, id));
}

/**
 * Confirme ou rejette un fait proposé. L'auteur d'une proposition humaine ne la confirme pas
 * lui-même (sauf associé) ; il peut la retirer (rejet motivé).
 */
export async function deciderFait(
  db: Db,
  auth: Auth,
  clientId: string,
  faitId: string,
  decision: FaitDecision,
): Promise<VueFait> {
  await verrouillerDossier(db, clientId);
  const fait = await lireFait(db, clientId, faitId);
  const statut = statutFait(fait);
  if (statut !== "propose") throw conflit("Seul un fait proposé reçoit une décision.");
  if (
    decision.decision === "confirme" &&
    fait.origine === "saisie" &&
    fait.auteur_id === auth.utilisateurId &&
    !estAssocie(auth)
  ) {
    throw new AppError(
      403,
      "VALIDATION_REQUISE",
      "L'auteur d'une proposition ne la confirme pas lui-même : la faire confirmer par un autre membre.",
    );
  }
  await db.query(
    `INSERT INTO dossier_faits_decisions (cabinet_id, fait_id, decision, motif, decideur_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, faitId, decision.decision, decision.motif ?? null, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: decision.decision === "confirme" ? "confirmation" : "rejet",
    entite: "dossier_fait",
    entiteId: faitId,
    details: { client_id: clientId, cle: fait.cle },
  });
  await inscrireFiabilite(db, auth, clientId);
  return vueFait(await lireFait(db, clientId, faitId));
}

/** Historique d'un fait : la chaîne de ses remplacements, du plus ancien au plus récent. */
export async function historiqueFait(db: Db, clientId: string, faitId: string): Promise<VueFait[]> {
  await lireFait(db, clientId, faitId);
  const r = await db.query(
    `WITH RECURSIVE avant(id, profondeur) AS (
       SELECT id, 0 FROM dossier_faits WHERE id = $1
       UNION ALL
       SELECT f.remplace_id, a.profondeur + 1 FROM dossier_faits f JOIN avant a ON f.id = a.id
       WHERE f.remplace_id IS NOT NULL AND a.profondeur < $3
     ), apres(id, profondeur) AS (
       SELECT id, 0 FROM dossier_faits WHERE id = $1
       UNION ALL
       SELECT f.id, a.profondeur + 1 FROM dossier_faits f JOIN apres a ON f.remplace_id = a.id
       WHERE a.profondeur < $3
     )
     SELECT ${COLONNES_FAIT} ${JOINTURES_FAIT}
     WHERE f.client_id = $2 AND f.id IN (SELECT id FROM avant UNION SELECT id FROM apres)
     ORDER BY f.cree_le, f.id`,
    [faitId, clientId, FAITS_PAR_CLIENT_MAX],
  );
  return r.rows.map(vueFait);
}
