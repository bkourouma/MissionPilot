import type { PlanRealiseSaisie } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { exigerPlanRedigeable, exigerPlanVisible } from "./acces.js";

/*
 * Réalisés trimestriels du plan vivant (PLA-18, migration 0430).
 *
 * - Ajout seul VERSIONNÉ : corriger un réalisé crée une version plus haute ; la courante est la plus
 *   haute, l'historique reste lisible. Le plan validé et ses versions du modèle ne sont pas touchés.
 * - Trimestres saisis dans l'ordre, sans trou : refusé (400) ici et doublé en base (MQL18).
 * - Écrire : « plan.ecrire », mission visible non clôturée (409) ; lire : « plan.lire ». Ces montants
 *   sont des états financiers du CLIENT : jamais au portail (politique `portail_interdit`).
 * - Le journal d'audit ne contient ni montant ni commentaire (exercice, trimestre, version seuls).
 */

export const VERSIONS_REALISE_MAX = 50;

interface RealiseDb {
  id: string;
  exercice: number;
  trimestre: number;
  version: number;
  chiffre_affaires: number;
  ebe: number;
  resultat_net: number | null;
  tresorerie_fin: number | null;
  commentaire: string | null;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
}

// Les montants sont des entiers sûrs (bornés en base) : float8 les rend sans perte.
const COLONNES = `r.id, r.exercice, r.trimestre, r.version, r.chiffre_affaires::float8 AS chiffre_affaires,
  r.ebe::float8 AS ebe, r.resultat_net::float8 AS resultat_net, r.tresorerie_fin::float8 AS tresorerie_fin,
  r.commentaire, r.cree_par, u.nom AS auteur_nom, r.cree_le`;
const DEPUIS = "plan_realises r JOIN utilisateurs u ON u.id = r.cree_par";

function vueRealise(r: RealiseDb) {
  return {
    id: r.id,
    exercice: r.exercice,
    trimestre: r.trimestre,
    version: r.version,
    chiffre_affaires: r.chiffre_affaires,
    ebe: r.ebe,
    resultat_net: r.resultat_net,
    tresorerie_fin: r.tresorerie_fin,
    commentaire: r.commentaire,
    cree_par: r.cree_par,
    auteur_nom: r.auteur_nom,
    cree_le: r.cree_le,
  };
}

/**
 * Saisit (version 1) ou corrige (version suivante) le réalisé d'un trimestre. 400 si le trimestre
 * précédent de l'exercice n'est pas saisi ; 409 au plafond de versions.
 */
export async function saisirRealise(
  db: Db,
  auth: Auth,
  planId: string,
  exercice: number,
  trimestre: number,
  corps: PlanRealiseSaisie,
) {
  await exigerPlanRedigeable(db, auth, planId);
  const n = await db.query(
    `SELECT coalesce(max(version) FILTER (WHERE trimestre = $3), 0) AS courante,
            count(*) FILTER (WHERE trimestre = $3 - 1) AS precedents
     FROM plan_realises WHERE plan_id = $1 AND exercice = $2`,
    [planId, exercice, trimestre],
  );
  const courante = Number(n.rows[0].courante);
  if (courante === 0 && trimestre > 1 && Number(n.rows[0].precedents) === 0) {
    throw new AppError(
      400,
      "REALISE_TRIMESTRE_NON_CONSECUTIF",
      `Les trimestres se saisissent dans l'ordre, sans trou : saisir d'abord le trimestre ${trimestre - 1}.`,
    );
  }
  if (courante >= VERSIONS_REALISE_MAX) {
    throw new AppError(
      409,
      "REALISES_PLAFOND",
      `Un trimestre compte au plus ${VERSIONS_REALISE_MAX} versions de réalisé.`,
    );
  }
  const version = courante + 1;
  const r = await db.query(
    `INSERT INTO plan_realises (cabinet_id, plan_id, exercice, trimestre, version, chiffre_affaires,
       ebe, resultat_net, tresorerie_fin, commentaire, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      auth.cabinetId,
      planId,
      exercice,
      trimestre,
      version,
      corps.chiffre_affaires,
      corps.ebe,
      corps.resultat_net,
      corps.tresorerie_fin,
      corps.commentaire,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.realise.saisir",
    entite: "plan_strategique",
    entiteId: planId,
    details: { exercice, trimestre, version },
  });
  const lu = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE r.id = $1`, [r.rows[0].id]);
  return vueRealise(lu.rows[0] as RealiseDb);
}

/** Réalisés COURANTS (version la plus haute) d'un exercice, par trimestre croissant. */
export async function realisesCourants(
  db: Db,
  planId: string,
  exercice: number,
): Promise<RealiseDb[]> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS}
     WHERE r.plan_id = $1 AND r.exercice = $2
       AND r.version = (SELECT max(x.version) FROM plan_realises x
                        WHERE x.plan_id = r.plan_id AND x.exercice = r.exercice
                          AND x.trimestre = r.trimestre)
     ORDER BY r.trimestre`,
    [planId, exercice],
  );
  return r.rows as RealiseDb[];
}

/**
 * Réalisés du plan (tous les exercices, ou un seul) : pour chaque (exercice, trimestre), la version
 * courante et l'historique des versions (la plus récente d'abord).
 */
export async function lireRealises(db: Db, auth: Auth, planId: string, exercice?: number) {
  await exigerPlanVisible(db, auth, planId);
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS}
     WHERE r.plan_id = $1 AND ($2::int IS NULL OR r.exercice = $2)
     ORDER BY r.exercice, r.trimestre, r.version DESC`,
    [planId, exercice ?? null],
  );
  const groupes = new Map<string, ReturnType<typeof vueRealise>[]>();
  for (const ligne of r.rows as RealiseDb[]) {
    const cle = `${ligne.exercice}:${ligne.trimestre}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), vueRealise(ligne)]);
  }
  return {
    realises: [...groupes.values()].map((versions) => ({
      exercice: (versions[0] as { exercice: number }).exercice,
      trimestre: (versions[0] as { trimestre: number }).trimestre,
      courant: versions[0],
      versions,
    })),
  };
}
