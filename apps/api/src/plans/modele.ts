import {
  calculerScenariosPlan,
  comparerResultatsPlan,
  ECARTS_SCENARIOS_DEFAUT,
  SERIES_CLES_PLAN,
  type Devise,
  type EcartsScenarios,
  type ExercicePrevisionnel,
  type HypothesesPlan,
  type ResultatScenarios,
} from "@missionpilot/engines";
import type { HypothesesPlanSaisies } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  exigerPlanPilotable,
  exigerPlanRedigeable,
  exigerPlanVisible,
  valideurDispense,
  type PlanAcces,
} from "./acces.js";
import { retirerPartageApresEcriture } from "./partage.js";

/*
 * Modèle financier du plan (PLA-06, PLA-07, PLA-09). TOUS les chiffres
 * viennent du moteur `calculerScenariosPlan` (@missionpilot/engines) : l'API
 * ajoute aux hypothèses saisies l'horizon et la devise du plan, appelle le
 * moteur, et fige son résultat tel quel dans une version horodatée (ajout
 * seul). Aucun état financier n'est recalculé ni retouché ici ; la
 * comparaison de deux versions présente leurs valeurs côte à côte et les
 * écarts calculés par le moteur (`comparerResultatsPlan`) sur les résultats
 * figés.
 */

/** Identifiant du moteur qui a produit un résultat figé. */
export const MOTEUR_PLAN = "engines/plan-strategique@1";

/** Versions du modèle financier par plan (doublé en base, 0181, MPS05). */
export const VERSIONS_MODELE_PAR_PLAN_MAX = 200;

export interface ModeleCalcule {
  hypotheses: HypothesesPlan;
  ecarts: EcartsScenarios;
  resultat: ResultatScenarios;
}

/** Appelle le moteur avec l'horizon et la devise du plan (ErreurPlan si une hypothèse est refusée). */
export function calculerModele(
  plan: Pick<PlanAcces, "horizon" | "devise">,
  saisies: HypothesesPlanSaisies,
  ecarts: EcartsScenarios | undefined,
): ModeleCalcule {
  const hypotheses: HypothesesPlan = {
    ...saisies,
    horizon: plan.horizon,
    devise: plan.devise as Devise,
  };
  const ecartsEffectifs = ecarts ?? ECARTS_SCENARIOS_DEFAUT;
  return {
    hypotheses,
    ecarts: ecartsEffectifs,
    resultat: calculerScenariosPlan(hypotheses, ecartsEffectifs),
  };
}

interface ResumeDb {
  id: string;
  version: number;
  moteur: string;
  commentaire: string | null;
  cree_par: string;
  auteur_nom: string;
  calcule_le: string;
  valide_par: string | null;
  valideur_nom: string | null;
  valide_le: string | null;
  synthese: ResultatScenarios["synthese"];
  equilibre: boolean;
  alertes: ResultatScenarios["base"]["alertes"];
}

interface VersionDb extends ResumeDb {
  hypotheses: HypothesesPlan;
  ecarts: EcartsScenarios;
  resultat: ResultatScenarios;
}

const COLONNES_RESUME = `v.id, v.version, v.moteur, v.commentaire, v.cree_par, u.nom AS auteur_nom,
  v.calcule_le, x.valide_par, w.nom AS valideur_nom, x.valide_le,
  v.resultat -> 'synthese' AS synthese, (v.resultat -> 'base' ->> 'equilibre')::boolean AS equilibre,
  v.resultat -> 'base' -> 'alertes' AS alertes`;

const DEPUIS = `plan_modele_versions v
  JOIN utilisateurs u ON u.id = v.cree_par
  LEFT JOIN plan_modele_validations x ON x.modele_version_id = v.id
  LEFT JOIN utilisateurs w ON w.id = x.valide_par`;

export function vueResume(v: ResumeDb) {
  return {
    id: v.id,
    version: v.version,
    moteur: v.moteur,
    commentaire: v.commentaire,
    cree_par: v.cree_par,
    auteur_nom: v.auteur_nom,
    calcule_le: v.calcule_le,
    validation: v.valide_par
      ? { valide_par: v.valide_par, valideur_nom: v.valideur_nom, valide_le: v.valide_le }
      : null,
    equilibre: v.equilibre,
    synthese: v.synthese,
    alertes: v.alertes,
  };
}

export type ResumeModele = ReturnType<typeof vueResume>;

function vueVersion(v: VersionDb) {
  return { ...vueResume(v), hypotheses: v.hypotheses, ecarts: v.ecarts, resultat: v.resultat };
}

/** Dernière version du modèle (résumé), ou null. */
export async function derniereVersionModele(db: Db, planId: string): Promise<ResumeModele | null> {
  const r = await db.query(
    `SELECT ${COLONNES_RESUME} FROM ${DEPUIS} WHERE v.plan_id = $1 ORDER BY v.version DESC LIMIT 1`,
    [planId],
  );
  return r.rows[0] ? vueResume(r.rows[0] as ResumeDb) : null;
}

async function lireVersion(db: Db, planId: string, version: number): Promise<VersionDb> {
  const r = await db.query(
    `SELECT ${COLONNES_RESUME}, v.hypotheses, v.ecarts, v.resultat FROM ${DEPUIS}
     WHERE v.plan_id = $1 AND v.version = $2`,
    [planId, version],
  );
  if (!r.rows[0]) throw introuvable("Version du modèle financier");
  return r.rows[0] as VersionDb;
}

/**
 * Version de référence (ROI, données de rapport) : celle demandée (404 si
 * absente), sinon la dernière validée, sinon la dernière ; null sans modèle.
 */
export async function versionReference(
  db: Db,
  planId: string,
  version: number | undefined,
): Promise<{ resume: ResumeModele; resultat: ResultatScenarios } | null> {
  let choisie = version;
  if (choisie === undefined) {
    const r = await db.query(
      `SELECT v.version FROM plan_modele_versions v
       LEFT JOIN plan_modele_validations x ON x.modele_version_id = v.id
       WHERE v.plan_id = $1 ORDER BY (x.id IS NOT NULL) DESC, v.version DESC LIMIT 1`,
      [planId],
    );
    choisie = r.rows[0]?.version as number | undefined;
    if (choisie === undefined) return null;
  }
  const v = await lireVersion(db, planId, choisie);
  return { resume: vueResume(v), resultat: v.resultat };
}

/** Recalcul instantané sans enregistrement (PLA-09). */
export async function simulerModele(
  db: Db,
  auth: Auth,
  planId: string,
  corps: { hypotheses: HypothesesPlanSaisies; ecarts?: EcartsScenarios | undefined },
): Promise<ModeleCalcule> {
  const plan = await exigerPlanVisible(db, auth, planId);
  return calculerModele(plan, corps.hypotheses, corps.ecarts);
}

/**
 * Nouvelle version : calcul par le moteur, résultat figé et horodaté. Une
 * version neuve n'est pas validée : elle retire le partage d'un plan partagé.
 */
export async function creerVersionModele(
  db: Db,
  auth: Auth,
  planId: string,
  corps: {
    hypotheses: HypothesesPlanSaisies;
    ecarts?: EcartsScenarios | undefined;
    commentaire?: string | null | undefined;
  },
) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const n = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS version FROM plan_modele_versions WHERE plan_id = $1",
    [planId],
  );
  const version = n.rows[0].version as number;
  if (version > VERSIONS_MODELE_PAR_PLAN_MAX) {
    throw new AppError(
      409,
      "PLAN_PLAFOND_VERSIONS",
      `Un plan compte au plus ${VERSIONS_MODELE_PAR_PLAN_MAX} versions du modèle financier.`,
    );
  }
  const calcul = calculerModele(plan, corps.hypotheses, corps.ecarts);
  await db.query(
    `INSERT INTO plan_modele_versions (cabinet_id, plan_id, version, hypotheses, ecarts, resultat,
       moteur, commentaire, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      auth.cabinetId,
      planId,
      version,
      JSON.stringify(calcul.hypotheses),
      JSON.stringify(calcul.ecarts),
      JSON.stringify(calcul.resultat),
      MOTEUR_PLAN,
      corps.commentaire ?? null,
      auth.utilisateurId,
    ],
  );
  await retirerPartageApresEcriture(db, auth, plan, "modele.calculer");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.modele.calculer",
    entite: "plan_strategique",
    entiteId: planId,
    details: { version, moteur: MOTEUR_PLAN },
  });
  return vueVersion(await lireVersion(db, planId, version));
}

export async function listerVersionsModele(
  db: Db,
  auth: Auth,
  planId: string,
  q: { limite: number; curseur?: string | undefined },
) {
  await exigerPlanVisible(db, auth, planId);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT lpad(v.version::text, 10, '0') AS cle_tri, ${COLONNES_RESUME} FROM ${DEPUIS}
     WHERE v.plan_id = $1
       AND ($2::text IS NULL OR (lpad(v.version::text, 10, '0'), v.id) < ($2, $3::uuid))
     ORDER BY v.version DESC LIMIT $4`,
    [planId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as (ResumeDb & { cle_tri: string })[], q.limite);
  return {
    elements: page.elements.map((v) => vueResume(v as ResumeDb)),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function lireVersionModele(db: Db, auth: Auth, planId: string, version: number) {
  await exigerPlanVisible(db, auth, planId);
  return vueVersion(await lireVersion(db, planId, version));
}

/** Valide une version du modèle : responsable de la mission, autre que l'auteur sauf dispense. */
export async function validerVersionModele(db: Db, auth: Auth, planId: string, version: number) {
  const plan = await exigerPlanPilotable(db, auth, planId);
  const v = await lireVersion(db, planId, version);
  if (v.valide_par) {
    throw new AppError(409, "CONTENU_VALIDE", "Cette version du modèle est déjà validée.");
  }
  if (v.cree_par === auth.utilisateurId && !valideurDispense(auth, plan)) {
    throw new AppError(
      403,
      "VALIDATION_REQUISE",
      "L'auteur d'une version du modèle ne la valide pas lui-même : la faire valider par un autre responsable.",
    );
  }
  await db.query(
    `INSERT INTO plan_modele_validations (cabinet_id, modele_version_id, valide_par)
     VALUES ($1, $2, $3)`,
    [auth.cabinetId, v.id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.modele.valider",
    entite: "plan_strategique",
    entiteId: planId,
    details: { version },
  });
  return vueResume(await lireVersion(db, planId, version));
}

/* ----- Comparaison de deux versions (valeurs côte à côte, sans recalcul) ----- */

function canonique(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonique).join(",")}]`;
  if (x !== null && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

const estObjet = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/** Chemins des hypothèses qui diffèrent (les listes se comparent en bloc). */
export function cheminsModifies(a: unknown, b: unknown, prefixe = ""): string[] {
  if (estObjet(a) && estObjet(b)) {
    const cles = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return cles.flatMap((k) => cheminsModifies(a[k], b[k], prefixe ? `${prefixe}.${k}` : k));
  }
  return canonique(a) === canonique(b) ? [] : [prefixe];
}

/** Séries clés du scénario de base, par exercice (définies par le moteur). */
export const SERIES_CLES: readonly (readonly [
  string,
  string,
  (a: ExercicePrevisionnel) => number,
])[] = SERIES_CLES_PLAN.map((s) => [s.cle, s.libelle, s.extraire] as const);

function serie(r: ResultatScenarios, extraire: (a: ExercicePrevisionnel) => number) {
  return r.base.annees.map((a) => ({ exercice: a.exercice, valeur: extraire(a) }));
}

/** Valeur d'un chemin pointé des hypothèses (`bilanOuverture.capital`), ou null. */
export function valeurChemin(racine: unknown, chemin: string): unknown {
  let courant: unknown = racine;
  for (const cle of chemin.split(".")) {
    if (!estObjet(courant) || !(cle in courant)) return null;
    courant = courant[cle];
  }
  return courant ?? null;
}

/**
 * Comparaison de deux versions : hypothèses et écarts de scénario modifiés (avec leurs valeurs),
 * séries clés côte à côte et écarts exacts calculés par le moteur, synthèse des scénarios.
 */
export async function comparerVersions(db: Db, auth: Auth, planId: string, de: number, a: number) {
  await exigerPlanVisible(db, auth, planId);
  const v1 = await lireVersion(db, planId, de);
  const v2 = await lireVersion(db, planId, a);
  const hypotheses = cheminsModifies(v1.hypotheses, v2.hypotheses);
  const ecarts = comparerResultatsPlan(v1.resultat, v2.resultat);
  const pointsParCle = new Map(ecarts.series.map((s) => [s.cle, s.points]));
  const versApi = (e: {
    de: number | null;
    a: number | null;
    ecart: number | null;
    ecartRelatif: number | null;
  }) => ({
    de: e.de,
    a: e.a,
    ecart: e.ecart,
    ecart_relatif: e.ecartRelatif,
  });
  return {
    de: vueResume(v1),
    a: vueResume(v2),
    hypotheses_modifiees: hypotheses,
    hypotheses_detail: hypotheses.map((chemin) => ({
      chemin,
      de: valeurChemin(v1.hypotheses, chemin),
      a: valeurChemin(v2.hypotheses, chemin),
    })),
    ecarts_modifies: cheminsModifies(v1.ecarts, v2.ecarts),
    series: SERIES_CLES.map(([cle, libelle, extraire]) => ({
      cle,
      libelle,
      de: serie(v1.resultat, extraire),
      a: serie(v2.resultat, extraire),
      points: (pointsParCle.get(cle) ?? []).map((p) => ({ exercice: p.exercice, ...versApi(p) })),
    })),
    synthese: ecarts.synthese.map((s) => ({
      scenario: s.scenario,
      indicateurs: s.indicateurs.map((i) => ({
        cle: i.cle,
        libelle: i.libelle,
        nature: i.nature,
        ...versApi(i),
      })),
    })),
  };
}
