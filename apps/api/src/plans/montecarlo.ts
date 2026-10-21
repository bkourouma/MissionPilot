import { randomInt } from "node:crypto";
import {
  MOTEUR_MONTE_CARLO,
  simulerMonteCarlo,
  type HypothesesPlan,
  type ParametresMonteCarlo,
  type ResultatMonteCarlo,
} from "@missionpilot/engines";
import {
  GRAINE_MONTE_CARLO_MAX,
  type HypotheseIncertaineSaisie,
  type PlanMonteCarloSimulation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerPlanRedigeable, exigerPlanVisible } from "./acces.js";

/*
 * Simulation de Monte-Carlo du plan financier (PLA-16).
 *
 * - Une simulation porte sur une VERSION du modèle financier (hypothèses
 *   figées, 0181) : elle ne modifie ni le plan ni la version (qui reste
 *   immuable, validée ou non) et s'enregistre dans sa propre table, en
 *   ajout seul (0429).
 * - TOUS les chiffres viennent du moteur `simulerMonteCarlo`
 *   (@missionpilot/engines) ; l'API n'ajoute que la graine quand elle est
 *   absente (`crypto.randomInt`, jamais dans le moteur), puis enregistre
 *   graine, lois, résultat et empreinte.
 * - Lancer : « plan.ecrire », plan rédigeable (mission visible, non clôturée) ;
 *   au plus SIMULATIONS_PAR_FENETRE par utilisateur sur la fenêtre (429
 *   TROP_DE_SIMULATIONS), comptées sur la table elle-même (doublé en base,
 *   MQL14). Calcul synchrone, borné par TIRAGES_MAX (2000) tirages.
 * - Lire, rejouer : « plan.lire », mission visible. Le rejeu relance le moteur
 *   avec la graine, les lois et les hypothèses ENREGISTRÉES et compare au
 *   résultat figé ; il n'écrit que sa trace de débit (REJEUX_PAR_PLAN_PAR_FENETRE).
 * - Défauts : lois de départ autour des hypothèses de base, VALEURS
 *   PROVISOIRES modifiables (aide de saisie, jamais un résultat).
 */

/** Simulations admises par utilisateur sur la fenêtre glissante (à calibrer au pilote). */
export const SIMULATIONS_PAR_FENETRE = 30;
export const FENETRE_SIMULATIONS_MINUTES = 10;
/**
 * Plafond de débit du rejeu : REJEUX_PAR_PLAN_PAR_FENETRE rejeux par plan (tous utilisateurs) sur
 * FENETRE_REJEUX_MINUTES minutes, comptés en base (`plan_rejeux_montecarlo`, 0432) ; 429
 * TROP_DE_REJEUX au-delà. Valeur provisoire, à valider.
 */
export const REJEUX_PAR_PLAN_PAR_FENETRE = 5;
export const FENETRE_REJEUX_MINUTES = 10;
/** Simulations enregistrées par plan (doublé en base, MQL12). */
export const SIMULATIONS_PAR_PLAN_MAX = 100;

const COLONNES = `s.id, s.plan_id, s.modele_version_id, v.version, s.graine::float8 AS graine,
  s.tirages, s.parametres, s.empreinte, s.moteur, s.cree_par, u.nom AS auteur_nom, s.cree_le`;
const DEPUIS = `plan_simulations_montecarlo s
  JOIN plan_modele_versions v ON v.id = s.modele_version_id
  JOIN utilisateurs u ON u.id = s.cree_par`;

interface SimulationDb {
  id: string;
  plan_id: string;
  modele_version_id: string;
  version: number;
  graine: number;
  tirages: number;
  parametres: { hypotheses: HypotheseIncertaineSaisie[] };
  empreinte: string;
  moteur: string;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
  resultat: ResultatMonteCarlo;
}

function vueSimulation(s: SimulationDb) {
  return {
    id: s.id,
    plan_id: s.plan_id,
    modele_version_id: s.modele_version_id,
    version: s.version,
    graine: s.graine,
    tirages: s.tirages,
    hypotheses: s.parametres.hypotheses,
    empreinte: s.empreinte,
    moteur: s.moteur,
    cree_par: s.cree_par,
    auteur_nom: s.auteur_nom,
    cree_le: s.cree_le,
    resultat: s.resultat,
  };
}

/** Graine tirée par le serveur (jamais par le moteur) : entier de 0 à 4 294 967 295. */
export function tirerGraine(): number {
  return randomInt(0, GRAINE_MONTE_CARLO_MAX + 1);
}

/** Paramètres du moteur à partir de la ligne enregistrée. */
function parametresDe(
  s: Pick<SimulationDb, "graine" | "tirages" | "parametres">,
): ParametresMonteCarlo {
  return {
    graine: s.graine,
    tirages: s.tirages,
    hypotheses: s.parametres.hypotheses as ParametresMonteCarlo["hypotheses"],
  };
}

/** 429 si l'utilisateur a déjà lancé SIMULATIONS_PAR_FENETRE simulations sur la fenêtre. */
async function verifierDebit(db: Db, auth: Auth): Promise<void> {
  // Sérialise les lancements d'un même utilisateur (le décompte et l'insertion ne se croisent pas).
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `montecarlo:${auth.utilisateurId}`,
  ]);
  const r = await db.query(
    `SELECT count(*)::int AS n FROM plan_simulations_montecarlo
     WHERE cree_par = $1 AND cree_le > now() - make_interval(mins => $2)`,
    [auth.utilisateurId, FENETRE_SIMULATIONS_MINUTES],
  );
  if ((r.rows[0].n as number) >= SIMULATIONS_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_DE_SIMULATIONS",
      `Au plus ${SIMULATIONS_PAR_FENETRE} simulations par ${FENETRE_SIMULATIONS_MINUTES} minutes : réessayez plus tard.`,
    );
  }
}

interface VersionModele {
  id: string;
  version: number;
  hypotheses: HypothesesPlan;
}

async function versionModele(db: Db, planId: string, version: number): Promise<VersionModele> {
  const r = await db.query(
    "SELECT id, version, hypotheses FROM plan_modele_versions WHERE plan_id = $1 AND version = $2",
    [planId, version],
  );
  if (!r.rows[0]) throw introuvable("Version du modèle financier");
  return r.rows[0] as VersionModele;
}

async function lireSimulation(db: Db, planId: string, simId: string): Promise<SimulationDb> {
  const r = await db.query(
    `SELECT ${COLONNES}, s.resultat FROM ${DEPUIS} WHERE s.plan_id = $1 AND s.id = $2`,
    [planId, simId],
  );
  if (!r.rows[0]) throw introuvable("Simulation de Monte-Carlo");
  return r.rows[0] as SimulationDb;
}

/** Lance et enregistre une simulation (ErreurPlan MONTE_CARLO_INVALIDE si les lois sont refusées). */
export async function lancerSimulation(
  db: Db,
  auth: Auth,
  planId: string,
  corps: PlanMonteCarloSimulation,
) {
  await exigerPlanRedigeable(db, auth, planId);
  await verifierDebit(db, auth);
  const version = await versionModele(db, planId, corps.version);
  const graine = corps.graine ?? tirerGraine();
  const resultat = simulerMonteCarlo(version.hypotheses, {
    graine,
    tirages: corps.tirages,
    hypotheses: corps.hypotheses,
  });
  const r = await db.query(
    `INSERT INTO plan_simulations_montecarlo (cabinet_id, plan_id, modele_version_id, graine,
       tirages, parametres, resultat, empreinte, moteur, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      auth.cabinetId,
      planId,
      version.id,
      graine,
      corps.tirages,
      JSON.stringify({ hypotheses: corps.hypotheses }),
      JSON.stringify(resultat),
      resultat.empreinte,
      MOTEUR_MONTE_CARLO,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.montecarlo.simuler",
    entite: "plan_strategique",
    entiteId: planId,
    details: { simulation_id: id, version: version.version, tirages: corps.tirages },
  });
  return vueSimulation(await lireSimulation(db, planId, id));
}

/** Historique des simulations, de la plus récente à la plus ancienne (résumés). */
export async function listerSimulations(
  db: Db,
  auth: Auth,
  planId: string,
  q: { limite: number; curseur?: string | undefined },
) {
  await exigerPlanVisible(db, auth, planId);
  const apres = decoderCurseur(q.curseur);
  const cle = "lpad(((extract(epoch FROM s.cree_le) * 1000000)::bigint)::text, 17, '0')";
  const r = await db.query(
    `SELECT ${cle} AS cle_tri, ${COLONNES},
       (s.resultat -> 'probabiliteVanNegative')::float8 AS probabilite_van_negative,
       (s.resultat -> 'probabiliteTension')::float8 AS probabilite_tension,
       (s.resultat -> 'van' ->> 'moyenne')::float8 AS van_moyenne
     FROM ${DEPUIS}
     WHERE s.plan_id = $1 AND ($2::text IS NULL OR (${cle}, s.id) < ($2, $3::uuid))
     ORDER BY s.cree_le DESC, s.id DESC LIMIT $4`,
    [planId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  type Ligne = Omit<SimulationDb, "resultat" | "parametres"> & {
    cle_tri: string;
    parametres: SimulationDb["parametres"];
    probabilite_van_negative: number;
    probabilite_tension: number;
    van_moyenne: number;
  };
  const page = paginer(r.rows as Ligne[], q.limite);
  return {
    elements: (page.elements as Omit<Ligne, "cle_tri">[]).map((s) => ({
      id: s.id,
      version: s.version,
      graine: s.graine,
      tirages: s.tirages,
      cibles: s.parametres.hypotheses.map((h) => h.cible),
      empreinte: s.empreinte,
      auteur_nom: s.auteur_nom,
      cree_le: s.cree_le,
      probabilite_van_negative: s.probabilite_van_negative,
      probabilite_tension: s.probabilite_tension,
      van_moyenne: s.van_moyenne,
    })),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function lireSimulationPlan(db: Db, auth: Auth, planId: string, simId: string) {
  await exigerPlanVisible(db, auth, planId);
  return vueSimulation(await lireSimulation(db, planId, simId));
}

const estObjet = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/** Égalité profonde exacte de deux valeurs JSON (l'ordre des clés est sans effet). */
function egalJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => egalJson(x, b[i]));
  }
  if (estObjet(a) && estObjet(b)) {
    const ca = Object.keys(a);
    return ca.length === Object.keys(b).length && ca.every((k) => k in b && egalJson(a[k], b[k]));
  }
  return a === b;
}

/**
 * Rejeu à l'identique : relance le moteur avec la graine, les lois et les
 * hypothèses de la version ENREGISTRÉES ; n'écrit rien. `identique` exige
 * l'égalité exacte du résultat (et pas seulement de l'empreinte).
 */
/** Compte un rejeu et lève 429 si le plan en a déjà subi REJEUX_PAR_PLAN_PAR_FENETRE sur la fenêtre. */
async function verifierDebitRejeu(db: Db, auth: Auth, planId: string): Promise<void> {
  // Sérialise les rejeux d'un même plan (le décompte et l'insertion ne se croisent pas).
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`rejeu:${planId}`]);
  await db.query(
    "DELETE FROM plan_rejeux_montecarlo WHERE plan_id = $1 AND cree_le < now() - interval '1 hour'",
    [planId],
  );
  const r = await db.query(
    `SELECT count(*)::int AS n FROM plan_rejeux_montecarlo
     WHERE plan_id = $1 AND cree_le > now() - make_interval(mins => $2)`,
    [planId, FENETRE_REJEUX_MINUTES],
  );
  if ((r.rows[0].n as number) >= REJEUX_PAR_PLAN_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_DE_REJEUX",
      `Au plus ${REJEUX_PAR_PLAN_PAR_FENETRE} rejeux par plan et par ${FENETRE_REJEUX_MINUTES} minutes : réessayez plus tard.`,
    );
  }
  await db.query(
    "INSERT INTO plan_rejeux_montecarlo (cabinet_id, plan_id, cree_par) VALUES ($1, $2, $3)",
    [auth.cabinetId, planId, auth.utilisateurId],
  );
}

export async function rejouerSimulation(db: Db, auth: Auth, planId: string, simId: string) {
  await exigerPlanVisible(db, auth, planId);
  const s = await lireSimulation(db, planId, simId);
  await verifierDebitRejeu(db, auth, planId);
  const v = await db.query("SELECT hypotheses FROM plan_modele_versions WHERE id = $1", [
    s.modele_version_id,
  ]);
  const rejoue = simulerMonteCarlo(v.rows[0].hypotheses as HypothesesPlan, parametresDe(s));
  // Même passage par JSON que l'enregistrement (zéro négatif, undefined).
  const rejoueJson = JSON.parse(JSON.stringify(rejoue)) as unknown;
  return {
    simulation_id: s.id,
    identique: rejoue.empreinte === s.empreinte && egalJson(rejoueJson, s.resultat),
    empreinte_enregistree: s.empreinte,
    empreinte_rejouee: rejoue.empreinte,
  };
}

/* ----- Lois de départ (valeurs provisoires, modifiables) ----- */

/** Lois proposées : triangulaires autour de la base (écarts en points, %, ou jours). */
export const LOIS_PAR_DEFAUT: readonly HypotheseIncertaineSaisie[] = [
  { cible: "croissanceChiffreAffaires", loi: { type: "triangulaire", min: -5, mode: 0, max: 5 } },
  { cible: "tauxMargeBrute", loi: { type: "triangulaire", min: -2, mode: 0, max: 2 } },
  { cible: "chargesFixes", loi: { type: "triangulaire", min: -5, mode: 0, max: 10 } },
  { cible: "delaiClientsJours", loi: { type: "triangulaire", min: 0, mode: 0, max: 30 } },
];

/** Version de départ : celle demandée (404 si absente), sinon la dernière validée, sinon la dernière. */
export async function defautsMonteCarlo(
  db: Db,
  auth: Auth,
  planId: string,
  version: number | undefined,
) {
  await exigerPlanVisible(db, auth, planId);
  const r = await db.query(
    `SELECT v.version, (x.id IS NOT NULL) AS validee FROM plan_modele_versions v
     LEFT JOIN plan_modele_validations x ON x.modele_version_id = v.id
     WHERE v.plan_id = $1 AND ($2::int IS NULL OR v.version = $2)
     ORDER BY (x.id IS NOT NULL) DESC, v.version DESC LIMIT 1`,
    [planId, version ?? null],
  );
  if (!r.rows[0]) {
    if (version !== undefined) throw introuvable("Version du modèle financier");
    return { version: null, validee: false, valeurs_provisoires: true, hypotheses: [] };
  }
  return {
    version: r.rows[0].version as number,
    validee: r.rows[0].validee as boolean,
    valeurs_provisoires: true,
    hypotheses: LOIS_PAR_DEFAUT,
  };
}
