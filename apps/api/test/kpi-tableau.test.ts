import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agregerKpiParPeriode,
  ajouterJours,
  alerteDegradationKpi,
  alerteRetardKpi,
  alertesSeuilsKpi,
  evaluerKpi,
  periodeKpiDe,
  periodesKpiEntre,
  projeterKpiFinPeriode,
  scoreCompositeKpi,
  tendanceKpi,
} from "@missionpilot/engines";
import { MAX_KPI_PAR_MISSION } from "../src/kpi/donnees.js";
import {
  MAX_PERIODES_EVALUEES_PAR_REQUETE,
  MESURES_EXPORTEES_MAX,
  PERIODES_EXPORTEES_MAX,
} from "../src/kpi/tableau.js";
import { aujourdhui } from "../src/missions/outils.js";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerKpi,
  mesurer,
  preparerJeuTableau,
  preparerKpi,
  type JeuTableau,
  type ScenarioKpi,
} from "./kpi-outils.js";
import { creerMission } from "./missions-outils.js";

/*
 * Tableau de bord (KPI-03) et export : chaque chiffre servi est IDENTIQUE à
 * celui que rend le moteur (packages/engines/src/kpi) sur les mêmes entrées,
 * et respecte la règle validée (vert ≥ 95 %, orange 80–95 %, rouge < 80 %).
 */

let ctx: Contexte;
let s: ScenarioKpi;
let jeu: JeuTableau;
const DATE = "2026-05-15";

type Kpi = Record<string, unknown> & {
  id: string;
  statut: string;
  derniere_periode: Record<string, unknown> & { atteinte: Record<string, unknown> };
  periode_en_cours: Record<string, unknown> & { projection: Record<string, unknown> };
  tendance: Record<string, unknown>;
  alertes: Record<string, unknown>[];
};
let tableau: { kpis: Kpi[]; score_global: Record<string, unknown>; alertes: unknown[] } & Record<
  string,
  unknown
>;
const kpi = (id: string) => tableau.kpis.find((k) => k.id === id) as Kpi;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerKpi(ctx, "KPI tableau");
  jeu = await preparerJeuTableau(s);
  const r = await s.consultantEquipe.get(
    `/api/missions/${s.missionId}/kpi/tableau-de-bord?date=${DATE}`,
  );
  if (r.statusCode !== 200) throw new Error(r.body);
  tableau = r.json();
}, 180_000);
afterAll(() => ctx.fermer());

const MESURES_CA = [
  { date: "2026-01-10", valeur: 400 },
  { date: "2026-01-25", valeur: 600 },
  { date: "2026-02-28", valeur: 900 },
  { date: "2026-03-31", valeur: 800 },
  { date: "2026-04-30", valeur: 700 },
  { date: "2026-05-10", valeur: 300 },
];
const MESURES_DELAI = [
  { date: "2026-01-31", valeur: 50 },
  { date: "2026-02-28", valeur: 55 },
  { date: "2026-03-31", valeur: 62 },
];

describe("droits du tableau de bord et de l'export", () => {
  it("401, 403, autre cabinet 404, consultant hors équipe 404", async () => {
    const url = `/api/missions/${s.missionId}/kpi/tableau-de-bord`;
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect((await s.expertExterne.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.consultantHors.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/missions/${s.missionId}/kpi/export`)).statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/kpi/${jeu.ca}/alertes`)).statusCode).toBe(404);
    expect((await s.a.chef.get(`${url}?date=2026-13-01`)).statusCode).toBe(400);
  });
});

describe("résultats identiques au moteur", () => {
  it("série par période : agrégation (flux = somme), cible versionnée, statut", async () => {
    const serie = agregerKpiParPeriode(MESURES_CA, {
      frequence: "mensuelle",
      nature: "flux",
      du: "2026-01-01",
      au: DATE,
    });
    const cibles = [1000, 1000, 1000, 1200, 1200];
    const exporte = (
      await s.a.chef.get(`/api/missions/${s.missionId}/kpi/export?date=${DATE}`)
    ).json();
    const periodes = exporte.kpis.find(
      (k: { definition: { id: string } }) => k.definition.id === jeu.ca,
    ).periodes as Record<string, unknown>[];
    expect(periodes.map((p) => p.periode)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    serie.forEach((p, i) => {
      const attendu = evaluerKpi({ valeur: p.valeur, cible: cibles[i], sens: "plus_haut_mieux" });
      expect(periodes[i]).toMatchObject({
        valeur: p.valeur,
        nombre_mesures: p.nombreMesures,
        cible: cibles[i],
        statut: attendu.statut,
        atteinte: { taux: attendu.atteinte?.taux, taux_exact: attendu.atteinte?.tauxExact },
        ecart: { ecart: attendu.ecart?.ecart, ecart_relatif: attendu.ecart?.ecartRelatif },
      });
    });
    // Règle KPI-03 : 100 % vert, 90 % orange, 80 % orange (borne incluse), 58 % rouge.
    expect(periodes.map((p) => p.statut)).toEqual(["vert", "orange", "orange", "rouge", "rouge"]);
    expect(periodes.map((p) => p.close)).toEqual([true, true, true, true, false]);
    expect(periodes[0]?.valeur).toBe(1000);
  });

  it("statut, atteinte, tendance et projection du KPI de flux", () => {
    const ca = kpi(jeu.ca);
    const attendu = evaluerKpi({ valeur: 700, cible: 1200, sens: "plus_haut_mieux" });
    expect(ca.statut).toBe(attendu.statut);
    expect(ca.derniere_periode).toMatchObject({ periode: "2026-04", valeur: 700, cible: 1200 });
    expect(ca.derniere_periode.atteinte).toMatchObject({
      taux: attendu.atteinte?.taux,
      taux_exact: attendu.atteinte?.tauxExact,
    });
    const tendance = tendanceKpi([1000, 900, 800, 700], "plus_haut_mieux");
    expect(ca.tendance).toEqual({
      direction: tendance.direction,
      evolution: tendance.evolution,
      pente: tendance.pente,
      variation: tendance.variation,
      variation_relative: tendance.variationRelative,
      points: tendance.points,
    });
    expect(ca.tendance.evolution).toBe("degradation");
    const projection = projeterKpiFinPeriode(MESURES_CA, {
      nature: "flux",
      debut: "2026-05-01",
      fin: "2026-05-31",
      dateReference: DATE,
    });
    expect(ca.periode_en_cours.projection).toMatchObject({
      valeur_projetee: projection.valeurProjetee,
      methode: "prorata",
      jours_ecoules: projection.joursEcoules,
      jours_total: projection.joursTotal,
    });
    expect(ca.periode_en_cours.statut_projete).toBe(
      evaluerKpi({ valeur: projection.valeurProjetee, cible: 1200, sens: "plus_haut_mieux" })
        .statut,
    );
  });

  it("KPI de stock « plus bas = mieux » : dernière valeur, seuil haut, retard de mesure", () => {
    const delai = kpi(jeu.delai);
    const attendu = evaluerKpi({ valeur: 62, cible: 45, sens: "plus_bas_mieux" });
    expect(delai.derniere_periode).toMatchObject({ periode: "2026-03", valeur: 62 });
    expect(delai.statut).toBe(attendu.statut);
    expect(delai.derniere_periode.atteinte.taux).toBe(attendu.atteinte?.taux);
    const seuils = alertesSeuilsKpi(62, 55, { haut: 60 });
    const retard = alerteRetardKpi({
      frequence: "mensuelle",
      datesMesures: MESURES_DELAI.map((m) => m.date),
      dateReference: DATE,
      suiviDepuis: "2026-01-01",
      delaiGraceJours: 5,
    });
    expect(retard).not.toBeNull();
    expect(delai.alertes).toEqual(
      expect.arrayContaining([
        { code: "SEUIL_HAUT", periode: "2026-03", valeur: 62, seuil: 60 },
        expect.objectContaining({
          code: "MESURE_EN_RETARD",
          periode: "2026-04",
          periode_attendue: "2026-04",
          jours_de_retard: retard?.code === "MESURE_EN_RETARD" ? retard.joursDeRetard : -1,
        }),
      ]),
    );
    expect(delai.alertes).toHaveLength(seuils.length + 1);
    const projection = projeterKpiFinPeriode(MESURES_DELAI, {
      nature: "stock",
      debut: "2026-05-01",
      fin: "2026-05-31",
      dateReference: DATE,
    });
    expect(delai.periode_en_cours.projection.valeur_projetee).toBe(projection.valeurProjetee);
  });

  it("alerte de dégradation après 3 variations défavorables (moteur)", () => {
    const attendu = alerteDegradationKpi([1000, 900, 800, 700], "plus_haut_mieux", { periodes: 3 });
    expect(attendu).toEqual({ code: "DEGRADATION_CONSECUTIVE", periodes: 3, seuil: 3 });
    expect(kpi(jeu.ca).alertes).toContainEqual({
      code: "DEGRADATION_CONSECUTIVE",
      periode: "2026-04",
      periodes: 3,
      seuil: 3,
    });
  });

  it("score composite pondéré : KPI sans cible exclu, couverture", () => {
    const attendu = scoreCompositeKpi([
      { code: jeu.ca, poids: 1, valeur: 700, cible: 1200, sens: "plus_haut_mieux" },
      { code: jeu.delai, poids: 2, valeur: 62, cible: 45, sens: "plus_bas_mieux" },
      { code: jeu.sansCible, poids: 1, valeur: 5, cible: null, sens: "plus_haut_mieux" },
    ]);
    expect(tableau.score_global).toMatchObject({
      score: attendu.score,
      score_exact: attendu.scoreExact,
      statut: attendu.statut,
      couverture: attendu.couverture,
      exclus: [{ kpi_id: jeu.sansCible, raison: "sans_cible" }],
    });
    expect(kpi(jeu.sansCible).statut).toBe("sans_cible");
    const perspectives = (
      tableau.perspectives as { perspective: string; nombre_kpi: number }[]
    ).map((p) => [p.perspective, p.nombre_kpi]);
    expect(perspectives).toEqual([
      ["finances", 1],
      ["clients", 1],
      ["processus", 1],
    ]);
  });

  it("date d'arrêté antérieure : les mesures postérieures sont ignorées", async () => {
    const r = await s.a.chef.get(
      `/api/missions/${s.missionId}/kpi/tableau-de-bord?date=2026-02-15`,
    );
    const ca = (r.json().kpis as Kpi[]).find((k) => k.id === jeu.ca) as Kpi;
    expect(ca.derniere_periode).toMatchObject({ periode: "2026-01", valeur: 1000 });
    expect(ca.statut).toBe("vert");
  });
});

describe("export des données", () => {
  it("format versionné : définitions, cibles, historique complet des mesures, journal", async () => {
    const m = (await s.a.chef.get(`/api/kpi/${jeu.delai}/mesures`)).json().elements[0];
    await s.a.chef.post(`/api/kpi/mesures/${m.id}/corrections`, {
      date_mesure: "2026-03-31",
      valeur: 61,
      motif: "Recalcul",
    });
    const r = await s.a.directeur.get(`/api/missions/${s.missionId}/kpi/export?date=${DATE}`);
    expect(r.statusCode).toBe(200);
    const e = r.json();
    expect(e).toMatchObject({ format: "missionpilot.kpi.v1", date_reference: DATE });
    expect(e.mission).toEqual({ id: s.missionId, intitule: "Pilotage de la performance" });
    const delai = e.kpis.find((k: { definition: { id: string } }) => k.definition.id === jeu.delai);
    expect(delai.mesures).toHaveLength(4);
    expect(delai.mesures.filter((x: { active: boolean }) => x.active)).toHaveLength(3);
    expect(delai.cibles).toEqual([expect.objectContaining({ version: 1, valeur: 45 })]);
    expect(delai.periodes[2]).toMatchObject({ periode: "2026-03", valeur: 61 });
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT utilisateur_id FROM journal_audit WHERE action = 'kpi.exporter' AND entite_id = $1",
            [s.missionId],
          )
        ).rows,
    );
    expect(journal).toContainEqual({ utilisateur_id: s.a.directeur.utilisateurId });
  });
});

describe("série par période (graphique d'évolution)", () => {
  const url = () => `/api/missions/${s.missionId}/kpi/series?date=${DATE}`;

  it("mêmes périodes que l'export, sans entrée d'audit kpi.exporter", async () => {
    const compter = () =>
      proprietaire(
        async (c) =>
          (
            await c.query(
              "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'kpi.exporter' AND entite_id = $1",
              [s.missionId],
            )
          ).rows[0].n as number,
      );
    const avant = await compter();
    const r = await s.consultantEquipe.get(url());
    expect(r.statusCode).toBe(200);
    expect(await compter()).toBe(avant);
    const serie = r.json();
    expect(serie).toMatchObject({ mission_id: s.missionId, date_reference: DATE });
    const exporte = (
      await s.a.chef.get(`/api/missions/${s.missionId}/kpi/export?date=${DATE}`)
    ).json();
    expect(serie.kpis).toHaveLength(exporte.kpis.length);
    for (const k of serie.kpis as { definition: { id: string }; periodes: unknown[] }[]) {
      const e = exporte.kpis.find(
        (x: { definition: { id: string } }) => x.definition.id === k.definition.id,
      );
      expect(k.periodes).toEqual(e.periodes);
    }
    expect(serie.kpis[0]).not.toHaveProperty("mesures");
  });

  it("401, 403, autre cabinet 404, consultant hors équipe 404, date invalide 400", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect((await s.expertExterne.get(url())).statusCode).toBe(403);
    expect((await s.b.associe.get(url())).statusCode).toBe(404);
    expect((await s.consultantHors.get(url())).statusCode).toBe(404);
    expect(
      (await s.a.chef.get(`/api/missions/${s.missionId}/kpi/series?date=2190-01-01`)).statusCode,
    ).toBe(400);
  });
});

describe("non-régression : volume évalué et exporté borné (déni de service)", () => {
  it("date d'arrêté hors bornes : 400 avant tout calcul", async () => {
    for (const date of ["2190-01-01", "9999-12-31", "0001-01-01", "1999-12-31"]) {
      for (const route of ["tableau-de-bord", "export"]) {
        const r = await s.a.chef.get(`/api/missions/${s.missionId}/kpi/${route}?date=${date}`);
        expect(r.statusCode, `${route} ${date}`).toBe(400);
        expect(r.json().erreur.code).toBe("REQUETE_INVALIDE");
      }
    }
  });

  it("200 KPI hebdomadaires suivis depuis 2000 : 400 explicite, réponse bornée en temps", async () => {
    const m = await creerMission(s.a, { intitule: "Volume extrême" });
    // Hors API (le suivi est borné à 10 ans avant la création) : KPI « créés » en 2009.
    await proprietaire((c) =>
      c.query(
        `INSERT INTO kpi_definitions (cabinet_id, mission_id, client_id, libelle, unite, sens,
           nature, frequence, debut_suivi, cree_par, cree_le)
         SELECT $1, $2, $3, 'KPI ' || g, 'u', 'plus_haut_mieux', 'flux', 'hebdomadaire',
           '2000-01-03', $4, '2009-06-01'
         FROM generate_series(1, $5::int) g`,
        [s.a.cabinetId, m.id, s.a.clientId, s.a.associeId, MAX_KPI_PAR_MISSION],
      ),
    );
    try {
      for (const route of ["tableau-de-bord", "export"]) {
        const debut = performance.now();
        const r = await s.a.chef.get(`/api/missions/${m.id}/kpi/${route}`);
        const duree = performance.now() - debut;
        expect(r.statusCode, r.body).toBe(400);
        expect(r.json().erreur.code).toBe("KPI_TROP_DE_PERIODES");
        expect(duree, `${route} : ${Math.round(duree)} ms`).toBeLessThan(2_000);
      }
      expect(MAX_PERIODES_EVALUEES_PAR_REQUETE).toBe(20_000);
    } finally {
      // Base de test partagée : ces KPI hors normes ne doivent pas peser sur la tâche
      // quotidienne exécutée par les fichiers suivants.
      await proprietaire((c) =>
        c.query("UPDATE kpi_definitions SET actif = false WHERE mission_id = $1", [m.id]),
      );
    }
  });

  it("juste sous le plafond (200 KPI × 99 semaines) : servi en temps borné", async () => {
    const jour = aujourdhui();
    const debut = periodeKpiDe(ajouterJours(jour, -98 * 7), "hebdomadaire").debut;
    const m = await creerMission(s.a, { intitule: "Volume au plafond" });
    await proprietaire((c) =>
      c.query(
        `INSERT INTO kpi_definitions (cabinet_id, mission_id, client_id, libelle, unite, sens,
           nature, frequence, debut_suivi, cree_par)
         SELECT $1, $2, $3, 'KPI ' || g, 'u', 'plus_haut_mieux', 'flux', 'hebdomadaire', $4, $5
         FROM generate_series(1, $6::int) g`,
        [s.a.cabinetId, m.id, s.a.clientId, debut, s.a.associeId, MAX_KPI_PAR_MISSION],
      ),
    );
    try {
      expect(MAX_KPI_PAR_MISSION * periodesKpiEntre(debut, jour, "hebdomadaire").length).toBe(
        19_800,
      );
      for (const route of ["tableau-de-bord", "export"]) {
        const chrono = performance.now();
        const r = await s.a.chef.get(`/api/missions/${m.id}/kpi/${route}?date=${jour}`);
        const duree = performance.now() - chrono;
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json().kpis).toHaveLength(MAX_KPI_PAR_MISSION);
        // Seuil large : la machine de test peut être chargée (CODING_STANDARDS §10).
        expect(duree, `${route} : ${Math.round(duree)} ms`).toBeLessThan(3_000);
      }
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE kpi_definitions SET actif = false WHERE mission_id = $1", [m.id]),
      );
    }
  });

  it("export : seules les dernières périodes et leurs mesures ; sous le plafond, servi", async () => {
    const jour = aujourdhui();
    // Il y a 8 ans et demi à 9 ans : plus de 400 semaines, moins de 10 ans.
    const debut = periodeKpiDe(`${Number(jour.slice(0, 4)) - 9}-06-15`, "hebdomadaire").debut;
    const m = await creerMission(s.a, { intitule: "Historique long" });
    const k = await creerKpi(s.a.chef, m.id, {
      libelle: "Hebdomadaire sur 9 ans",
      frequence: "hebdomadaire",
      debut_suivi: debut,
      cible: 10,
    });
    expect(k.debut_suivi).toBe(debut);
    const ancienne = periodeKpiDe(debut, "hebdomadaire").fin;
    const recente = periodeKpiDe(jour, "hebdomadaire").debut;
    await mesurer(s.a.chef, k.id, ancienne, 4);
    await mesurer(s.a.chef, k.id, recente, 9);
    const debutChrono = performance.now();
    const r = await s.a.chef.get(`/api/missions/${m.id}/kpi/export?date=${jour}`);
    expect(performance.now() - debutChrono).toBeLessThan(2_000);
    expect(r.statusCode, r.body).toBe(200);
    const e = r.json();
    expect(e).toMatchObject({
      periodes_exportees_max: PERIODES_EXPORTEES_MAX,
      mesures_exportees_max: MESURES_EXPORTEES_MAX,
    });
    const x = e.kpis[0];
    expect(x.periodes).toHaveLength(PERIODES_EXPORTEES_MAX);
    expect(x.periodes_total).toBe(periodesKpiEntre(debut, jour, "hebdomadaire").length);
    expect(x.periodes_total).toBeGreaterThan(400);
    expect(x.periodes.at(-1).periode).toBe(periodeKpiDe(jour, "hebdomadaire").cle);
    // La mesure d'il y a 9 ans est hors des périodes exportées.
    expect(x.mesures.map((l: { date_mesure: string }) => l.date_mesure)).toEqual([recente]);
    expect(x.mesures_tronquees).toBe(false);
    expect(
      (await s.a.chef.get(`/api/missions/${m.id}/kpi/tableau-de-bord?date=${jour}`)).statusCode,
    ).toBe(200);
  });
});
