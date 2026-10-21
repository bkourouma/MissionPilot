import {
  MOTEUR_REPREVISION,
  reprevoirExercice,
  type RealiseTrimestre,
  type RepartitionTrimestres,
  type ResultatReprevision,
  type ResultatScenarios,
} from "@missionpilot/engines";
import type { PlanReprevisionCreation } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerPlanRedigeable, exigerPlanVisible } from "./acces.js";
import { realisesCourants } from "./realises.js";

/*
 * Re-prévision trimestrielle du plan vivant (PLA-18, migration 0431).
 *
 * - Le plan VALIDÉ n'est jamais modifié : la re-prévision lit une version VALIDÉE du modèle financier
 *   (scénario de base) et les réalisés courants, appelle le moteur `reprevoirExercice`
 *   (@missionpilot/engines), puis ENREGISTRE (ajout seul, versions séquentielles par exercice) les entrées
 *   figées et le résultat du moteur. TOUS les chiffres (écarts, décomposition de l'EBE, faits) viennent du
 *   moteur ; l'API ne calcule rien.
 * - Lancer : « plan.ecrire », mission visible non clôturée (409), version du modèle validée (409
 *   MODELE_NON_VALIDE), exercice dans l'horizon de la version (400), réalisés saisis (400, moteur).
 * - Lire : « plan.lire », mission visible. Rien n'est servi au portail.
 */

/** Re-prévisions enregistrées par exercice et par plan (doublé en base, MQL23). */
export const REPREVISIONS_PAR_EXERCICE_MAX = 40;

const COLONNES = `s.id, s.plan_id, s.modele_version_id, v.version AS modele_version, s.exercice,
  s.version, s.dernier_trimestre, s.methode, s.repartition, s.seuil_pour_mille, s.moteur,
  s.cree_par, u.nom AS auteur_nom, s.cree_le`;
const DEPUIS = `plan_reprevisions s
  JOIN plan_modele_versions v ON v.id = s.modele_version_id
  JOIN utilisateurs u ON u.id = s.cree_par`;

interface ReprevisionDb {
  id: string;
  plan_id: string;
  modele_version_id: string;
  modele_version: number;
  exercice: number;
  version: number;
  dernier_trimestre: number;
  methode: string;
  repartition: number[];
  seuil_pour_mille: number;
  moteur: string;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
  entrees: EntreeFigee[];
  resultat: ResultatReprevision;
}

/** Réalisé figé dans la re-prévision (copie des réalisés utilisés). */
export interface EntreeFigee {
  trimestre: number;
  version: number;
  chiffreAffaires: number;
  excedentBrutExploitation: number;
  resultatNet: number | null;
  tresorerieFin: number | null;
}

function vueReprevision(s: ReprevisionDb) {
  return {
    id: s.id,
    plan_id: s.plan_id,
    modele_version_id: s.modele_version_id,
    modele_version: s.modele_version,
    exercice: s.exercice,
    version: s.version,
    dernier_trimestre: s.dernier_trimestre,
    methode: s.methode,
    repartition: s.repartition,
    seuil_pour_mille: s.seuil_pour_mille,
    moteur: s.moteur,
    cree_par: s.cree_par,
    auteur_nom: s.auteur_nom,
    cree_le: s.cree_le,
    entrees: s.entrees,
    resultat: s.resultat,
  };
}

export async function lireReprevision(
  db: Db,
  planId: string,
  revId: string,
): Promise<ReprevisionDb> {
  const r = await db.query(
    `SELECT ${COLONNES}, s.entrees, s.resultat FROM ${DEPUIS} WHERE s.plan_id = $1 AND s.id = $2`,
    [planId, revId],
  );
  if (!r.rows[0]) throw introuvable("Re-prévision");
  return r.rows[0] as ReprevisionDb;
}

/** Lance et enregistre une re-prévision (ErreurPlan REPREVISION_INVALIDE du moteur → 400). */
export async function creerReprevision(
  db: Db,
  auth: Auth,
  planId: string,
  corps: PlanReprevisionCreation,
) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const v = await db.query(
    `SELECT v.id, v.resultat, (x.id IS NOT NULL) AS validee
     FROM plan_modele_versions v
     LEFT JOIN plan_modele_validations x ON x.modele_version_id = v.id
     WHERE v.plan_id = $1 AND v.version = $2`,
    [planId, corps.version],
  );
  const modele = v.rows[0] as
    { id: string; resultat: ResultatScenarios; validee: boolean } | undefined;
  if (!modele) throw introuvable("Version du modèle financier");
  if (!modele.validee) {
    throw new AppError(
      409,
      "MODELE_NON_VALIDE",
      "La re-prévision se calcule sur une version validée du modèle financier.",
    );
  }
  const exercicePrevu = modele.resultat.base.annees.find((a) => a.exercice === corps.exercice);
  if (!exercicePrevu) {
    throw new AppError(
      400,
      "REPREVISION_EXERCICE_HORS_HORIZON",
      "Cet exercice ne fait pas partie de l'horizon de la version du modèle financier.",
    );
  }
  const courants = await realisesCourants(db, planId, corps.exercice);
  const realises: RealiseTrimestre[] = courants.map((r) => ({
    trimestre: r.trimestre,
    chiffreAffaires: r.chiffre_affaires,
    excedentBrutExploitation: r.ebe,
    resultatNet: r.resultat_net,
    tresorerieFin: r.tresorerie_fin,
  }));
  const resultat = reprevoirExercice({
    exercice: exercicePrevu,
    realises,
    methode: corps.methode,
    ...(corps.repartition ? { repartition: corps.repartition as RepartitionTrimestres } : {}),
    ...(corps.seuil !== undefined ? { seuilEcartPourMille: corps.seuil } : {}),
  });
  const n = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS version FROM plan_reprevisions WHERE plan_id = $1 AND exercice = $2",
    [planId, corps.exercice],
  );
  const version = Number(n.rows[0].version);
  if (version > REPREVISIONS_PAR_EXERCICE_MAX) {
    throw new AppError(
      409,
      "REPREVISIONS_PLAFOND",
      `Un exercice compte au plus ${REPREVISIONS_PAR_EXERCICE_MAX} re-prévisions.`,
    );
  }
  const entrees: EntreeFigee[] = courants.map((r) => ({
    trimestre: r.trimestre,
    version: r.version,
    chiffreAffaires: r.chiffre_affaires,
    excedentBrutExploitation: r.ebe,
    resultatNet: r.resultat_net,
    tresorerieFin: r.tresorerie_fin,
  }));
  const ins = await db.query(
    `INSERT INTO plan_reprevisions (cabinet_id, plan_id, modele_version_id, exercice, version,
       dernier_trimestre, methode, repartition, seuil_pour_mille, entrees, resultat, moteur, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      auth.cabinetId,
      plan.id,
      modele.id,
      corps.exercice,
      version,
      resultat.trimestresRealises,
      resultat.methode,
      JSON.stringify(resultat.repartition),
      resultat.seuilEcartPourMille,
      JSON.stringify(entrees),
      JSON.stringify(resultat),
      MOTEUR_REPREVISION,
      auth.utilisateurId,
    ],
  );
  const id = ins.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.reprevision.creer",
    entite: "plan_strategique",
    entiteId: planId,
    details: {
      reprevision_id: id,
      exercice: corps.exercice,
      version,
      modele_version: corps.version,
      methode: resultat.methode,
    },
  });
  return vueReprevision(await lireReprevision(db, planId, id));
}

/** Historique des re-prévisions, de la plus récente à la plus ancienne (résumés). */
export async function listerReprevisions(
  db: Db,
  auth: Auth,
  planId: string,
  q: { limite: number; curseur?: string | undefined; exercice?: number | undefined },
) {
  await exigerPlanVisible(db, auth, planId);
  const apres = decoderCurseur(q.curseur);
  const cle = "lpad(((extract(epoch FROM s.cree_le) * 1000000)::bigint)::text, 17, '0')";
  const r = await db.query(
    `SELECT ${cle} AS cle_tri, ${COLONNES},
       s.resultat -> 'reprevision' AS reprevision,
       s.resultat -> 'ecartsAnnuels' AS ecarts_annuels
     FROM ${DEPUIS}
     WHERE s.plan_id = $1 AND ($2::int IS NULL OR s.exercice = $2)
       AND ($3::text IS NULL OR (${cle}, s.id) < ($3, $4::uuid))
     ORDER BY s.cree_le DESC, s.id DESC LIMIT $5`,
    [planId, q.exercice ?? null, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  type Ligne = Omit<ReprevisionDb, "entrees" | "resultat"> & {
    cle_tri: string;
    reprevision: ResultatReprevision["reprevision"];
    ecarts_annuels: ResultatReprevision["ecartsAnnuels"];
  };
  const page = paginer(r.rows as Ligne[], q.limite);
  return {
    elements: (page.elements as Ligne[]).map((s) => ({
      id: s.id,
      modele_version: s.modele_version,
      exercice: s.exercice,
      version: s.version,
      dernier_trimestre: s.dernier_trimestre,
      methode: s.methode,
      seuil_pour_mille: s.seuil_pour_mille,
      auteur_nom: s.auteur_nom,
      cree_le: s.cree_le,
      reprevision: s.reprevision,
      ecarts_annuels: s.ecarts_annuels,
    })),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function lireReprevisionPlan(db: Db, auth: Auth, planId: string, revId: string) {
  await exigerPlanVisible(db, auth, planId);
  return vueReprevision(await lireReprevision(db, planId, revId));
}
