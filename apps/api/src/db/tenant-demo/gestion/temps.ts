import { ajouterJours } from "@missionpilot/engines";
import { cleDeCompte, type Casting } from "./casting.js";
import type { CleCompte } from "../cles.js";
import { ok } from "./outils.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { DEBUT_ACTIVITE } from "../constantes.js";
import { lundiDe, type Alea } from "../horloge.js";
import type { GenreProfil } from "./donnees-temps.js";
import { antedaterFeuilles, cloturerPeriodes, semerCorrections } from "./temps-cloture.js";
import { choisirImport, importerSemaine } from "./temps-import.js";
import { construirePaquets } from "./temps-paquets.js";
import { motifRejet, scenarioFeuille } from "./temps-scenario.js";
import { planifierPersonne, type FeuillePlan, type PersonneTemps } from "./temps-plan.js";
import {
  chargerExistantes,
  chargerMoisClos,
  enParallele,
  jouerFeuille,
  type Compteurs,
  type EnvSaisie,
} from "./temps-saisie.js";
import {
  antedaterAlertes,
  declarerRestes,
  declarerRestesFinaux,
  envoyerRappel,
  envoyerRelance,
  remettreNotificationsALHeure,
} from "./temps-suivi.js";

/*
 * MODULE TEMPS de la phase `gestion` du Tenant démo : deux ans de feuilles de temps cohérentes
 * avec les missions, les affectations et le budget (voir temps-plan.ts pour les règles de
 * volume), le circuit complet (saisie, soumission, validation, rejets, semaines récentes en
 * cours), la clôture mensuelle jusqu'en août 2026, des corrections tracées, les rappels de
 * saisie, le reste à faire et les alertes de suivi, un petit import CSV.
 *
 * Tout passe par les vraies routes avec la session de chaque collaborateur. IDEMPOTENT : les
 * feuilles existantes sont reprises là où elles s'étaient arrêtées (état lu en base), les
 * périodes déjà clôturées et les relevés déjà posés sont sautés.
 */

/** Appels simultanés au plus lors de la saisie d'une semaine (personnes différentes). */
const CONCURRENCE = 4;

const genreDe = (cle: string): GenreProfil => {
  if (cle.startsWith("associe")) return "associe";
  if (cle.startsWith("directeur")) return "direction";
  if (cle.startsWith("chef")) return "chef";
  if (cle.includes("stagiaire")) return "stagiaire";
  if (cle.startsWith("expert.externe")) return "externe";
  return "consultant";
};

const isoJour = (date: string): number => {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay();
  return j === 0 ? 7 : j;
};

interface Donnees {
  personnes: PersonneTemps[];
  ouvre: (date: string) => boolean;
  activites: Map<string, string>;
}

/** Collaborateurs avec compte, absences validées, calendrier du cabinet et activités internes. */
async function chargerDonnees(ctx: ContexteTenantDemo): Promise<Donnees> {
  const q = (sql: string, p: unknown[] = [ctx.cabinetId]) => ctx.proprietaire.query(sql, p);
  const absences = (
    await q(
      `SELECT collaborateur_id, date_debut::text AS debut, date_fin::text AS fin, type
         FROM absences WHERE cabinet_id = $1 AND statut = 'validee' ORDER BY date_debut`,
    )
  ).rows;
  const collaborateurs = (
    await q(
      `SELECT c.id, c.nom, c.utilisateur_id, c.cree_le::date::text AS depuis
         FROM collaborateurs c JOIN utilisateurs u ON u.id = c.utilisateur_id
        WHERE c.cabinet_id = $1 AND c.actif AND u.actif ORDER BY c.nom`,
    )
  ).rows;
  const personnes: PersonneTemps[] = [];
  for (const c of collaborateurs) {
    const cle = cleDeCompte(ctx, c.utilisateur_id as string) as CleCompte | undefined;
    if (!cle || !ctx.sessions[cle]) continue;
    personnes.push({
      cle,
      collaborateurId: c.id as string,
      utilisateurId: c.utilisateur_id as string,
      nom: c.nom as string,
      depuis: c.depuis as string,
      genre: genreDe(cle),
      rythme: ctx.alea.deriver(`gestion-temps|rythme|${cle}`).choisir([3, 3.5, 4, 4.5]),
      absences: absences
        .filter((a) => a.collaborateur_id === c.id)
        .map((a) => ({ debut: a.debut as string, fin: a.fin as string, type: a.type as string })),
    });
  }
  const travailles = ((await q("SELECT jours_travailles FROM cabinets WHERE id = $1")).rows[0]
    ?.jours_travailles as number[] | undefined) ?? [1, 2, 3, 4, 5];
  const feries = new Set(
    (await q("SELECT date::text AS date FROM cabinet_feries WHERE cabinet_id = $1")).rows.map(
      (r) => r.date as string,
    ),
  );
  const activites = new Map(
    (await q("SELECT id, code FROM activites_internes WHERE cabinet_id = $1 AND actif")).rows.map(
      (r) => [r.code as string, r.id as string],
    ),
  );
  return {
    personnes,
    ouvre: (d) => travailles.includes(isoJour(d)) && !feries.has(d),
    activites,
  };
}

/** Rang des tâches dans leur mission : phase, tâche, puis ordre de création (les `ordre` peuvent être égaux). */
async function rangTaches(ctx: ContexteTenantDemo): Promise<Map<string, number>> {
  const r = await ctx.proprietaire.query(
    `SELECT t.id FROM mission_taches t JOIN mission_phases p ON p.id = t.phase_id
      WHERE t.cabinet_id = $1 ORDER BY p.ordre, t.ordre, p.cree_le, t.cree_le, t.id`,
    [ctx.cabinetId],
  );
  return new Map(r.rows.map((l, i) => [l.id as string, i]));
}

/** Onze feuilles à rejeter, une par tranche de la période (hors semaines récentes). */
function choisirRejets(plans: readonly FeuillePlan[], rng: Alea): Map<string, string> {
  const candidats = plans
    .filter(
      (p) => p.missionIds.length > 0 && p.semaine >= "2024-12-02" && p.semaine <= "2026-07-27",
    )
    .sort((a, b) => a.semaine.localeCompare(b.semaine) || a.cle.localeCompare(b.cle));
  const rejets = new Map<string, string>();
  const n = 11;
  for (let k = 0; k < n; k++) {
    const tranche = candidats.slice(
      Math.floor((k * candidats.length) / n),
      Math.floor(((k + 1) * candidats.length) / n),
    );
    if (tranche.length === 0) continue;
    const p = rng.choisir(tranche);
    rejets.set(`${p.cle}|${p.semaine}`, motifRejet(rng));
  }
  return rejets;
}

export async function semerTemps(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  const debutExecution = performance.now();
  const rng = ctx.alea.deriver("gestion-temps");
  const journal = ctx.journal;
  for (const cle of casting.absentes) {
    journal(`temps : mission « ${cle} » absente du casting, ignorée (aucun temps).`);
  }

  // 0. Paramètres de saisie : posés par le socle ; sinon on les pose par la route.
  const parametres = await ctx.proprietaire.query(
    "SELECT seuil_consommation_pct FROM parametres_temps WHERE cabinet_id = $1",
    [ctx.cabinetId],
  );
  if ((parametres.rowCount ?? 0) === 0) {
    ok(
      200,
      await ctx.session("associe").patch("/api/temps/parametres", {
        controle_capacite: "signaler",
        seuil_consommation_pct: 85,
      }),
      "paramètres de temps",
    );
  }
  // Borne basse des notifications et alertes produites par ce module (reprise après échec comprise).
  const borne = (
    await ctx.proprietaire.query(
      `SELECT (least(coalesce(min(cree_le), clock_timestamp()), clock_timestamp())
                - interval '1 hour')::text AS t FROM feuilles_temps WHERE cabinet_id = $1`,
      [ctx.cabinetId],
    )
  ).rows[0]?.t as string;

  // 1. Données et planification (pure).
  const donnees = await chargerDonnees(ctx);
  const parUtilisateur = new Map(donnees.personnes.map((p) => [p.utilisateurId, p]));
  const paquets = construirePaquets(
    casting,
    parUtilisateur,
    ctx.aujourdhui,
    rng.deriver("paquets"),
    journal,
    await rangTaches(ctx),
  );
  const activites = new Set(donnees.activites.keys());
  const tous: FeuillePlan[] = donnees.personnes.flatMap((p) =>
    planifierPersonne({
      personne: p,
      paquets: paquets.filter((q) => q.cle === p.cle),
      debutActivite: DEBUT_ACTIVITE,
      aujourdhui: ctx.aujourdhui,
      ouvre: donnees.ouvre,
      activites,
      rng: rng.deriver(`plan|${p.cle}`),
    }),
  );
  const importee = choisirImport(tous, rng.deriver("import"));
  const plans = tous.filter((p) => p !== importee);
  const rejets = choisirRejets(plans, rng.deriver("rejets"));
  const manque = paquets.reduce((s, q) => s + q.manque, 0);
  journal(
    `temps : ${plans.length} feuilles planifiées pour ${donnees.personnes.length} collaborateurs, ` +
      `${paquets.length} paquets de mission` +
      (manque > 0 ? ` (${manque / 2} j non placés faute de capacité)` : "") +
      `.`,
  );

  // 2. Import CSV d'une semaine (avant le circuit : la semaine est retirée du circuit normal).
  if (importee) journal(`temps : ${await importerSemaine(ctx, casting, importee)}.`);
  else journal("temps : aucune semaine candidate à l'import CSV.");

  // 3. Circuit semaine par semaine, dans l'ordre chronologique.
  const compteurs: Compteurs = {
    creees: 0,
    deja: 0,
    soumises: 0,
    validees: 0,
    rejetees: 0,
    appels: 0,
  };
  const env: EnvSaisie = {
    ctx,
    casting,
    activites: donnees.activites,
    existantes: await chargerExistantes(ctx),
    moisClos: await chargerMoisClos(ctx),
    rng: rng.deriver("saisie"),
    compteurs,
  };
  const parSemaine = new Map<string, FeuillePlan[]>();
  for (const p of plans) parSemaine.set(p.semaine, [...(parSemaine.get(p.semaine) ?? []), p]);
  const semaines = [...parSemaine.keys()].sort();
  const courant = lundiDe(ctx.aujourdhui);
  const precedent = ajouterJours(courant, -7);
  // Semaines de rappel (mars à début octobre 2026, une sur trois) : deux retardataires chacune.
  const eligibles = semaines.filter((s) => s >= "2026-03-09" && s <= ajouterJours(precedent, -7));
  const decalage = rng.entier(0, 2);
  const semainesRappel = new Set(eligibles.filter((_, i) => i % 3 === decalage));
  let rappels = 0;
  for (const [i, semaine] of semaines.entries()) {
    const feuilles = parSemaine.get(semaine) ?? [];
    const retardataires = new Set<FeuillePlan>();
    if (semainesRappel.has(semaine)) {
      const eligiblesRetard = rng
        .deriver(`retard|${semaine}`)
        .melanger(
          feuilles.filter(
            (p) => !p.cle.startsWith("associe") && !rejets.has(`${p.cle}|${p.semaine}`),
          ),
        );
      eligiblesRetard.slice(0, 2).forEach((p) => retardataires.add(p));
    }
    const scenario = (p: FeuillePlan) =>
      scenarioFeuille(env, p, {
        rejet: rejets.get(`${p.cle}|${p.semaine}`) ?? null,
        tard: retardataires.has(p),
      });
    await enParallele(feuilles, CONCURRENCE, (p) =>
      jouerFeuille(env, p, scenario(p), { seulementRemplir: retardataires.has(p) }),
    );
    if (semainesRappel.has(semaine)) {
      rappels += await envoyerRappel(ctx, semaine);
      rappels += await envoyerRelance(ctx, semaine);
      await enParallele([...retardataires], CONCURRENCE, (p) =>
        jouerFeuille(env, p, scenario(p), { remplie: true }),
      );
    }
    if ((i + 1) % 13 === 0 || i === semaines.length - 1) {
      journal(
        `temps : semaine ${semaine} (${i + 1}/${semaines.length}), ${compteurs.creees} feuilles créées.`,
      );
    }
  }
  rappels += await envoyerRappel(ctx, courant);
  rappels += await envoyerRelance(ctx, precedent);

  // 4. Clôture mensuelle jusqu'en août 2026, puis corrections tracées.
  const premierJour = plans.reduce(
    (m, p) => p.lignes.reduce((x, l) => (l.date < x ? l.date : x), m),
    ctx.aujourdhui,
  );
  const premierMois = premierJour.slice(0, 7);
  const cloturees = await cloturerPeriodes(ctx, premierMois, rng.deriver("cloture"));
  const corrections = await semerCorrections(
    ctx,
    casting,
    plans,
    paquets,
    rng.deriver("corrections"),
  );

  // 5. Reste à faire (alertes de suivi évaluées par les routes), puis remise à la date.
  const restes =
    (await declarerRestes(ctx, casting, paquets, rng.deriver("restes"))) +
    (await declarerRestesFinaux(ctx, casting, paquets, rng.deriver("restes-finaux")));
  await antedaterFeuilles(ctx);
  const alertes = await antedaterAlertes(ctx, casting, borne, rng.deriver("alertes"));
  await remettreNotificationsALHeure(ctx, casting, borne);

  const duree = Math.round((performance.now() - debutExecution) / 1000);
  journal(
    `temps : ${compteurs.creees} feuilles créées (${compteurs.deja} déjà validées), ` +
      `${compteurs.soumises} soumissions, ${compteurs.validees} validations, ${compteurs.rejetees} rejets, ` +
      `${rappels} rappels, ${cloturees} périodes clôturées, ${corrections} corrections, ` +
      `${restes} relevés de reste à faire, ${alertes} alertes datées, ${compteurs.appels} appels, ${duree} s.`,
  );
}
