import { ajouterJours } from "@missionpilot/engines";
import { cleDeCompte, type Casting } from "./casting.js";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import type { Alea } from "../horloge.js";
import { COMMENTAIRES_CORRECTION } from "./donnees-temps.js";
import type { FeuillePlan } from "./temps-plan.js";
import { heure, type Scenario } from "./temps-scenario.js";

/*
 * Circuit des feuilles de temps du Tenant démo, par les VRAIES routes avec la session de chaque
 * collaborateur : création, saisie, soumission, validation (chef, directeur de mission ou associé,
 * jamais l'auteur), quelques rejets avec motif suivis d'une correction et d'une resoumission.
 *
 * Antédatage (SQL propriétaire littéral, seulement ce que les déclencheurs de 0030 laissent
 * faire) : `lignes_temps.cree_le` (feuille encore en brouillon ou rejetée), `soumise_le` et
 * `premiere_soumission_le` (feuille soumise), `rejetee_le` (feuille rejetée) et
 * `feuille_validations.decide_le` (table en ajout seul pour le rôle applicatif, modifiable par le
 * propriétaire). Ne peuvent PAS être antidatés : `feuilles_temps.cree_le` (identité figée par
 * déclencheur), `validee_le`, `verrouillee_le`, `modifie_le` (posés au moment de la validation).
 */

export interface EtatFeuille {
  id: string;
  statut: string;
  cycle: number;
}

export interface Compteurs {
  creees: number;
  deja: number;
  soumises: number;
  validees: number;
  rejetees: number;
  appels: number;
}

export interface EnvSaisie {
  ctx: ContexteTenantDemo;
  casting: Casting;
  /** Code d'activité interne -> identifiant. */
  activites: ReadonlyMap<string, string>;
  /** Feuilles existantes : `${collaborateurId}|${semaine}`. */
  existantes: Map<string, EtatFeuille>;
  /** Mois (AAAA-MM) dont la période est clôturée : aucune feuille nouvelle n'y est créée (reprise). */
  moisClos: ReadonlySet<string>;
  rng: Alea;
  compteurs: Compteurs;
}

type Vue = { id: string; statut: string; cycle: number };

/** Charge les feuilles déjà présentes (reprise après échec, relance du module). */
export async function chargerExistantes(
  ctx: ContexteTenantDemo,
): Promise<Map<string, EtatFeuille>> {
  const r = await ctx.proprietaire.query(
    `SELECT id, collaborateur_id, semaine::text AS semaine, statut, cycle
       FROM feuilles_temps WHERE cabinet_id = $1`,
    [ctx.cabinetId],
  );
  return new Map(
    r.rows.map((l) => [
      `${l.collaborateur_id as string}|${l.semaine as string}`,
      { id: l.id as string, statut: l.statut as string, cycle: l.cycle as number },
    ]),
  );
}

/** Mois dont la période est clôturée (reprise après une exécution complète). */
export async function chargerMoisClos(ctx: ContexteTenantDemo): Promise<Set<string>> {
  const r = await ctx.proprietaire.query(
    "SELECT mois::text AS mois FROM periodes_temps WHERE cabinet_id = $1 AND statut = 'cloturee'",
    [ctx.cabinetId],
  );
  return new Set(r.rows.map((l) => (l.mois as string).slice(0, 7)));
}

/* ----- Appels de route ----- */

/** Exécute `fn` sur les éléments avec au plus `n` appels simultanés ; la première erreur arrête le lot. */
export async function enParallele<T>(
  elements: readonly T[],
  n: number,
  fn: (element: T) => Promise<void>,
): Promise<void> {
  let suivant = 0;
  let erreur: unknown;
  await Promise.all(
    Array.from({ length: Math.min(n, elements.length) }, async () => {
      while (suivant < elements.length && erreur === undefined) {
        const element = elements[suivant++] as T;
        try {
          await fn(element);
        } catch (e) {
          erreur ??= e;
        }
      }
    }),
  );
  if (erreur !== undefined) throw erreur;
}

/**
 * Requêtes du client propriétaire en file : le client `pg` n'accepte qu'une requête à la fois,
 * et les feuilles d'une semaine se jouent en parallèle.
 */
const files = new WeakMap<object, Promise<unknown>>();
function requeteSerie(ctx: ContexteTenantDemo, sql: string, params: unknown[]) {
  const suite = (files.get(ctx.proprietaire) ?? Promise.resolve()).then(() =>
    ctx.proprietaire.query(sql, params),
  );
  files.set(
    ctx.proprietaire,
    suite.catch(() => undefined),
  );
  return suite;
}

const envoyer = (s: SessionDemo, methode: "get" | "post" | "put", url: string, corps: unknown) =>
  methode === "get"
    ? s.get(url)
    : methode === "post"
      ? s.post(url, corps)
      : s.put(url, corps ?? {});

async function appeler(
  env: EnvSaisie,
  cle: CleCompte,
  methode: "get" | "post" | "put",
  url: string,
  corps?: unknown,
  tolere: readonly number[] = [],
): Promise<{ statut: number; vue: Vue }> {
  const s = env.ctx.session(cle);
  let r = await envoyer(s, methode, url, corps);
  // Interblocage entre saisies simultanées : la route a annulé sa transaction, on la rejoue.
  for (
    let essai = 0;
    essai < 4 && r.statusCode === 500 && /deadlock|serializ/i.test(r.body);
    essai++
  ) {
    r = await envoyer(s, methode, url, corps);
  }
  env.compteurs.appels++;
  if (r.statusCode >= 400 && !tolere.includes(r.statusCode)) {
    throw new Error(`${methode.toUpperCase()} ${url} (${cle}) : HTTP ${r.statusCode} ${r.body}`);
  }
  return {
    statut: r.statusCode,
    vue: r.statusCode < 400 ? (r.json() as Vue) : { id: "", statut: "", cycle: 0 },
  };
}

function lignesCorps(env: EnvSaisie, plan: FeuillePlan, complement: string | null) {
  let complete = false;
  return plan.lignes.flatMap((l) => {
    const activiteId = l.activite ? env.activites.get(l.activite) : undefined;
    if (l.activite && !activiteId) return [];
    const commentaire =
      !complete && complement && l.missionId ? ((complete = true), complement) : l.commentaire;
    return [
      {
        date: l.date,
        jours: l.unites / 2,
        ...(l.tacheId ? { tache_id: l.tacheId } : { activite_id: activiteId }),
        ...(commentaire ? { commentaire } : {}),
      },
    ];
  });
}

async function remplir(
  env: EnvSaisie,
  plan: FeuillePlan,
  id: string,
  quand: string,
  complement: string | null,
): Promise<void> {
  await appeler(env, plan.cle, "put", `/api/feuilles-temps/${id}/lignes`, {
    lignes: lignesCorps(env, plan, complement),
  });
  await requeteSerie(
    env.ctx,
    "UPDATE lignes_temps SET cree_le = $2::timestamptz WHERE feuille_id = $1",
    [id, quand],
  );
}

async function soumettre(
  env: EnvSaisie,
  plan: FeuillePlan,
  id: string,
  quand: string,
): Promise<Vue> {
  const { vue } = await appeler(env, plan.cle, "post", `/api/feuilles-temps/${id}/soumettre`, {});
  await requeteSerie(
    env.ctx,
    `UPDATE feuilles_temps SET soumise_le = $2::timestamptz,
       premiere_soumission_le = LEAST(premiere_soumission_le, $2::timestamptz) WHERE id = $1`,
    [id, quand],
  );
  env.compteurs.soumises++;
  return vue;
}

/** Valideurs possibles d'une feuille, dans l'ordre d'essai (jamais l'auteur). */
function candidatsValideurs(
  env: EnvSaisie,
  plan: FeuillePlan,
  chefEnPremier: boolean,
): CleCompte[] {
  const { ctx, casting } = env;
  const missions = Object.values(casting.missions).filter((m) => plan.missionIds.includes(m.id));
  const cle = (id: string | null) =>
    id ? (cleDeCompte(ctx, id) as CleCompte | undefined) : undefined;
  const chefs = missions.map((m) => cle(m.chefId));
  const dirs = missions.map((m) => cle(m.directeurId));
  const fixes: CleCompte[] = ["directeur.mission", "directeur.mission.2", "associe", "associe.2"];
  const liste = [...(chefEnPremier ? chefs : []), ...dirs, ...chefs, ...fixes];
  return [
    ...new Set(liste.filter((c): c is CleCompte => !!c && c !== plan.cle && !!ctx.sessions[c])),
  ];
}

/** Valide la feuille (ou, en validation partielle, la partie du chef) ; renvoie le statut obtenu. */
async function valider(
  env: EnvSaisie,
  plan: FeuillePlan,
  vue: Vue,
  scen: Scenario,
  rng: Alea,
): Promise<string> {
  const chefEnPremier = plan.missionIds.length > 0 && (rng.proba(0.5) || scen.partielle);
  let derniere = "";
  for (const v of candidatsValideurs(env, plan, chefEnPremier)) {
    const r = await appeler(
      env,
      v,
      "post",
      `/api/feuilles-temps/${vue.id}/valider`,
      {},
      [403, 404, 409],
    );
    if (r.statut >= 400) {
      derniere = `${v} : HTTP ${r.statut}`;
      continue;
    }
    if (r.vue.statut === "validee") {
      await decider(env, vue.id, vue.cycle, scen.tDecision);
      env.compteurs.validees++;
      return "validee";
    }
    if (scen.partielle) {
      await decider(env, vue.id, vue.cycle, scen.tDecision);
      return "soumise";
    }
  }
  throw new Error(
    `Feuille ${plan.cle} ${plan.semaine} non validable (${derniere || "aucun valideur"}).`,
  );
}

async function decider(env: EnvSaisie, id: string, cycle: number, quand: string): Promise<void> {
  await requeteSerie(
    env.ctx,
    "UPDATE feuille_validations SET decide_le = $3::timestamptz WHERE feuille_id = $1 AND cycle = $2",
    [id, cycle, quand],
  );
}

async function rejeter(env: EnvSaisie, plan: FeuillePlan, vue: Vue, scen: Scenario): Promise<void> {
  const motif = scen.rejet ?? "Feuille à revoir.";
  for (const v of candidatsValideurs(env, plan, true)) {
    const r = await appeler(
      env,
      v,
      "post",
      `/api/feuilles-temps/${vue.id}/rejeter`,
      { motif },
      [403, 404, 409],
    );
    if (r.statut >= 400) continue;
    await requeteSerie(
      env.ctx,
      "UPDATE feuilles_temps SET rejetee_le = $2::timestamptz WHERE id = $1",
      [vue.id, scen.tRejet],
    );
    await decider(env, vue.id, vue.cycle, scen.tRejet);
    env.compteurs.rejetees++;
    return;
  }
  throw new Error(`Feuille ${plan.cle} ${plan.semaine} non rejetable.`);
}

/**
 * Mène UNE feuille jusqu'à son état final, en reprenant là où une exécution précédente s'est
 * arrêtée. `seulementRemplir` : crée et remplit, sans soumettre (retardataires d'une semaine de
 * rappel) ; `remplie` : la saisie du brouillon est déjà faite.
 */
export async function jouerFeuille(
  env: EnvSaisie,
  plan: FeuillePlan,
  scen: Scenario,
  options: { seulementRemplir?: boolean; remplie?: boolean } = {},
): Promise<void> {
  const rng = env.rng.deriver(`jouer|${plan.cle}|${plan.semaine}`);
  const cle = `${plan.collaborateurId}|${plan.semaine}`;
  let etat = env.existantes.get(cle);
  if (
    (!etat || etat.statut === "brouillon") &&
    env.moisClos.has(plan.semaine.slice(0, 7)) &&
    env.moisClos.has(ajouterJours(plan.semaine, 4).slice(0, 7))
  ) {
    // Reprise : la période est déjà close, une feuille manquante ou restée brouillon n'y serait plus remplie.
    env.compteurs.deja++;
    return;
  }
  if (!etat) {
    const { vue } = await appeler(env, plan.cle, "post", "/api/feuilles-temps", {
      semaine: plan.semaine,
      pre_remplir: false,
    });
    etat = { id: vue.id, statut: vue.statut, cycle: vue.cycle };
    env.existantes.set(cle, etat);
    env.compteurs.creees++;
  } else if (etat.statut === "validee" || etat.statut === "verrouillee") {
    env.compteurs.deja++;
    return;
  }
  const vue: Vue = { ...etat };
  let soumisIci = false;
  const majEtat = (v: Vue): void => {
    vue.statut = v.statut;
    vue.cycle = v.cycle;
    etat.statut = v.statut;
    etat.cycle = v.cycle;
  };

  if (vue.statut === "brouillon" || vue.statut === "rejetee") {
    if (!options.remplie || vue.statut === "rejetee") {
      await remplir(env, plan, vue.id, heure(scen.t1.slice(0, 10), rng, 8, 13), null);
    }
    if (scen.final === "brouillon" || options.seulementRemplir) return;
    majEtat(
      await soumettre(env, plan, vue.id, vue.statut === "rejetee" ? scen.tResoumission : scen.t1),
    );
    soumisIci = true;
    if (scen.rejet) {
      await rejeter(env, plan, vue, scen);
      majEtat({ ...vue, statut: "rejetee" });
      await remplir(env, plan, vue.id, scen.tRejet, rng.choisir(COMMENTAIRES_CORRECTION));
      majEtat(await soumettre(env, plan, vue.id, scen.tResoumission));
    }
  } else if (vue.statut === "soumise" && scen.rejet && vue.cycle === 1) {
    await rejeter(env, plan, vue, scen);
    majEtat({ ...vue, statut: "rejetee" });
    await remplir(env, plan, vue.id, scen.tRejet, rng.choisir(COMMENTAIRES_CORRECTION));
    majEtat(await soumettre(env, plan, vue.id, scen.tResoumission));
  }
  if (vue.statut === "soumise" && (scen.final === "validee" || (scen.partielle && soumisIci))) {
    majEtat({ ...vue, statut: await valider(env, plan, vue, scen, rng) });
  }
}
