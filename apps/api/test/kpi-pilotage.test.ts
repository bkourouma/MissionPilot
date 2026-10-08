import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composerOrdreDuJourKpi,
  decomposerArbreKpi,
  evaluerQualiteDonneesKpi,
} from "@missionpilot/engines";
import { rapportRevueARendre } from "../src/kpi/dossier-revue.js";
import { traduireErreurKpi } from "../src/kpi/erreurs.js";
import { lireRevue } from "../src/kpi/revues-donnees.js";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerKpi,
  INCONNU,
  mesurer,
  preparerJeuTableau,
  preparerKpi,
  preparerPortailKpi,
  type JeuTableau,
  type ScenarioKpi,
} from "./kpi-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Pilotage augmenté des KPI (PRD complémentaire §11.4) : arbres d'indicateurs (KPI-13), qualité
 * des données (KPI-15), revues de performance (KPI-17), actions correctives (KPI-18). Pour
 * chaque famille de routes : 401, 403, cas nominal, autre cabinet (404) ; chiffres IDENTIQUES à
 * ceux du moteur ; historiques en ajout seul et états terminaux défendus en base.
 */

let ctx: Contexte;
let s: ScenarioKpi;
let jeu: JeuTableau;
let p: Awaited<ReturnType<typeof preparerPortailKpi>>;
const DATE = "2026-05-15";

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerKpi(ctx, "KPI pilotage");
  jeu = await preparerJeuTableau(s);
  p = await preparerPortailKpi(ctx, s);
}, 240_000);
afterAll(() => ctx.fermer());

/** Code SQLSTATE d'un refus de la base (connexion propriétaire, hors API). */
async function refusSql(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await proprietaire((c) => c.query(sql, params));
  } catch (e) {
    return (e as { code?: string }).code ?? "inconnu";
  }
  return "aucun";
}

const erreur = (r: { json: () => { erreur?: { code?: string } } }) => r.json().erreur?.code;

/* ------------------------------------------------------------------------------------------ */
/* KPI-13 : arbres d'indicateurs                                                              */
/* ------------------------------------------------------------------------------------------ */

describe("KPI-13 arbres d'indicateurs", () => {
  let racineKpi: string;
  let volume: string;
  let panier: string;
  let arbreId: string;
  let noeudRacine: string;
  let noeudVolume: string;
  let noeudPanier: string;

  beforeAll(async () => {
    // CA = volume × panier moyen, chaque mois ; mission du second client (les KPI de la mission
    // principale servent aux autres blocs). Le consultant de l'équipe y lit les arbres.
    const m = s.missionA2;
    attendre(
      201,
      await s.a.chef.post(`/api/missions/${m}/equipe`, {
        utilisateur_id: s.consultantEquipe.utilisateurId,
      }),
      "équipe A2",
    );
    racineKpi = (
      await creerKpi(s.a.chef, m, { libelle: "CA par produit", nature: "flux", cible: null })
    ).id;
    volume = (
      await creerKpi(s.a.chef, m, { libelle: "Volume vendu", nature: "stock", cible: null })
    ).id;
    panier = (
      await creerKpi(s.a.chef, m, { libelle: "Panier moyen", nature: "stock", cible: null })
    ).id;
    for (const [d, v] of [
      ["2026-01-31", 500],
      ["2026-02-28", 600],
      ["2026-03-31", 825],
      ["2026-04-30", 1200],
    ] as const) {
      await mesurer(s.a.chef, racineKpi, d, v);
    }
    for (const [d, v] of [
      ["2026-01-31", 10],
      ["2026-02-28", 12],
      ["2026-03-31", 15],
      ["2026-04-30", 20],
    ] as const) {
      await mesurer(s.a.chef, volume, d, v);
    }
    for (const [d, v] of [
      ["2026-01-31", 50],
      ["2026-02-28", 50],
      ["2026-03-31", 55],
      ["2026-04-30", 60],
    ] as const) {
      await mesurer(s.a.chef, panier, d, v);
    }
  }, 120_000);

  it("401, 403 et autre cabinet : aucune lecture ni écriture", async () => {
    const url = `/api/missions/${s.missionA2}/kpi/arbres`;
    const corps = { kpi_racine_id: racineKpi, libelle: "CA = volume × panier" };
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect((await api(ctx).post(url, corps)).statusCode).toBe(401);
    // Le consultant de l'équipe lit les KPI mais ne les gère pas ; le gestionnaire ne les lit pas.
    expect((await s.consultantEquipe.post(url, corps)).statusCode).toBe(403);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.expertExterne.get(url)).statusCode).toBe(403);
    // Autre cabinet : la mission n'existe pas pour lui.
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.post(url, corps)).statusCode).toBe(404);
    expect((await s.a.chef.get(`/api/kpi/arbres/${INCONNU}`)).statusCode).toBe(404);
  });

  it("création : racine liée au KPI racine ; un seul arbre par KPI ; KPI d'une autre mission refusé", async () => {
    const url = `/api/missions/${s.missionA2}/kpi/arbres`;
    const r = await s.a.chef.post(url, {
      kpi_racine_id: racineKpi,
      libelle: "CA = volume × panier",
    });
    expect(r.statusCode).toBe(201);
    const arbre = r.json();
    arbreId = arbre.id;
    expect(arbre.noeuds).toHaveLength(1);
    expect(arbre.noeuds[0]).toMatchObject({
      parent_id: null,
      kpi_id: racineKpi,
      relation: "somme",
    });
    noeudRacine = arbre.noeuds[0].id;
    expect(
      (await s.a.chef.post(url, { kpi_racine_id: racineKpi, libelle: "Doublon" })).statusCode,
    ).toBe(409);
    // KPI de la mission principale : inconnu pour la mission A2.
    expect(
      (await s.a.chef.post(url, { kpi_racine_id: jeu.ca, libelle: "Hors mission" })).statusCode,
    ).toBe(400);
    expect((await s.a.chef.post(url, { libelle: "Sans racine" })).statusCode).toBe(400);
    const liste = await s.a.chef.get(url);
    expect(liste.json().elements).toMatchObject([{ id: arbreId, nombre_noeuds: 1 }]);
    expect(liste.json().tronque).toBe(false);
  });

  it("nœuds : produit, coefficient 1 sous un produit, doublon de KPI, parent invalide", async () => {
    const racine = await s.a.chef.patch(`/api/kpi/arbres/noeuds/${noeudRacine}`, {
      relation: "produit",
    });
    expect(racine.statusCode).toBe(200);
    const v = await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
      parent_id: noeudRacine,
      kpi_id: volume,
      libelle: "Volume vendu",
      rang: 1,
    });
    expect(v.statusCode).toBe(201);
    noeudVolume = v.json().id;
    const pa = await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
      parent_id: noeudRacine,
      kpi_id: panier,
      libelle: "Panier moyen",
      rang: 2,
    });
    expect(pa.statusCode).toBe(201);
    noeudPanier = pa.json().id;
    // Sous un produit le coefficient est 1 (défendu aussi par la base).
    const coef = await s.a.chef.patch(`/api/kpi/arbres/noeuds/${noeudPanier}`, { coefficient: 2 });
    expect(coef.statusCode).toBe(400);
    expect(erreur(coef)).toBe("KPI_COEFFICIENT_PRODUIT");
    expect(
      await refusSql("UPDATE kpi_arbre_noeuds SET coefficient = 3 WHERE id = $1", [noeudPanier]),
    ).toBe("MPK14");
    // Le même KPI deux fois dans l'arbre.
    const doublon = await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
      parent_id: noeudVolume,
      kpi_id: volume,
      libelle: "Encore le volume",
    });
    expect(doublon.statusCode).toBe(409);
    // Parent inconnu.
    expect(
      (
        await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
          parent_id: INCONNU,
          libelle: "Orphelin",
        })
      ).statusCode,
    ).toBe(400);
    // KPI d'une autre mission.
    expect(
      (
        await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
          parent_id: noeudVolume,
          kpi_id: jeu.ca,
          libelle: "Hors mission",
        })
      ).statusCode,
    ).toBe(400);
    // Le parent d'un nœud est figé (aucun cycle possible) ; la racine ne se désactive pas.
    expect(
      await refusSql("UPDATE kpi_arbre_noeuds SET parent_id = $2 WHERE id = $1", [
        noeudVolume,
        noeudPanier,
      ]),
    ).toBe("MPK11");
    const desactive = await s.a.chef.patch(`/api/kpi/arbres/noeuds/${noeudRacine}`, {
      actif: false,
    });
    expect(desactive.statusCode).toBe(409);
    expect(erreur(desactive)).toBe("KPI_NOEUD_NON_DESACTIVABLE");
    const detail = await s.consultantEquipe.get(`/api/kpi/arbres/${arbreId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().noeuds).toHaveLength(3);
  });

  it("contributions : identiques au moteur, somme exacte égale à la variation de la racine", async () => {
    const r = await s.consultantEquipe.get(
      `/api/kpi/arbres/${arbreId}/contributions?avant=2026-03-15&apres=${DATE}`,
    );
    expect(r.statusCode).toBe(200);
    const c = r.json();
    // Moteur sur les mêmes entrées : février (volume 12, panier 50) puis avril (20, 60).
    const attendu = decomposerArbreKpi(
      [
        {
          id: noeudRacine,
          parentId: null,
          relation: "produit",
          coefficient: 1,
          rang: 0,
          avant: 600,
          apres: 1200,
        },
        {
          id: noeudVolume,
          parentId: noeudRacine,
          relation: "somme",
          coefficient: 1,
          rang: 1,
          avant: 12,
          apres: 20,
        },
        {
          id: noeudPanier,
          parentId: noeudRacine,
          relation: "somme",
          coefficient: 1,
          rang: 2,
          avant: 50,
          apres: 60,
        },
      ],
      { sens: "plus_haut_mieux" },
    );
    expect(c.evaluable).toBe(true);
    expect(c.variation_racine).toBe(attendu.variationRacine);
    expect(c.variation_racine).toBe(600);
    expect(
      c.leviers.map((l: { noeud_id: string; contribution_racine: number }) => [
        l.noeud_id,
        l.contribution_racine,
      ]),
    ).toEqual(attendu.leviers.map((l) => [l.id, l.contributionRacine]));
    const parId = new Map(c.noeuds.map((n: { id: string }) => [n.id, n]));
    expect(parId.get(noeudVolume)).toMatchObject({
      contribution_racine: 400,
      contribution_racine_exacte: "400",
    });
    expect(parId.get(noeudPanier)).toMatchObject({ contribution_racine: 200, part_racine: 0.3333 });
    expect(parId.get(noeudRacine)).toMatchObject({
      avant: 600,
      apres: 1200,
      residu_avant: 0,
      residu_apres: 0,
    });
    expect(c.leviers.map((l: { favorable: boolean }) => l.favorable)).toEqual([true, true]);
  });

  it("dates incohérentes, levier non mesuré, autre cabinet", async () => {
    const url = `/api/kpi/arbres/${arbreId}/contributions`;
    expect((await s.a.chef.get(`${url}?avant=2026-05-15&apres=2026-03-15`)).statusCode).toBe(400);
    expect((await s.a.chef.get(url)).statusCode).toBe(400);
    expect((await s.b.associe.get(`${url}?avant=2026-03-15&apres=${DATE}`)).statusCode).toBe(404);
    // Un levier libre (sans KPI) rend l'arbre non évaluable et le signale.
    const libre = await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
      parent_id: noeudRacine,
      libelle: "Levier libre",
      rang: 3,
    });
    expect(libre.statusCode).toBe(201);
    const r = await s.a.chef.get(`${url}?avant=2026-03-15&apres=${DATE}`);
    expect(r.json()).toMatchObject({
      evaluable: false,
      manquants: [{ noeud_id: libre.json().id, libelle: "Levier libre" }],
      leviers: [],
    });
    // Désactivé, il sort du calcul.
    expect(
      (await s.a.chef.patch(`/api/kpi/arbres/noeuds/${libre.json().id}`, { actif: false }))
        .statusCode,
    ).toBe(200);
    expect((await s.a.chef.get(`${url}?avant=2026-03-15&apres=${DATE}`)).json().evaluable).toBe(
      true,
    );
    // Une modification d'arbre est journalisée.
    expect(
      (
        await s.a.chef.patch(`/api/kpi/arbres/${arbreId}`, { description: "Décomposition du CA" })
      ).json().description,
    ).toBe("Décomposition du CA");
    expect((await s.a.chef.patch(`/api/kpi/arbres/${arbreId}`, {})).statusCode).toBe(400);
  });

  it("bornes défendues en base : taille et profondeur de l'arbre", async () => {
    // Profondeur : 6 niveaux sous la racine au plus (la racine est au niveau 0).
    let parent = noeudVolume;
    for (let i = 2; i <= 6; i++) {
      const r = await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
        parent_id: parent,
        libelle: `Niveau ${i}`,
      });
      expect(r.statusCode).toBe(201);
      parent = r.json().id;
    }
    const trop = await s.a.chef.post(`/api/kpi/arbres/${arbreId}/noeuds`, {
      parent_id: parent,
      libelle: "Niveau 7",
    });
    expect(trop.statusCode).toBe(409);
    expect(erreur(trop)).toBe("KPI_ARBRE_TROP_GRAND");
  });

  it("plafonds de l'arbre : réactivation sous un parent actif, 50 nœuds actifs, 200 nœuds au total", async () => {
    const m = s.missionA2;
    const racine = (await creerKpi(s.a.chef, m, { libelle: "Racine des plafonds", cible: null }))
      .id;
    const cree = await s.a.chef.post(`/api/missions/${m}/kpi/arbres`, {
      kpi_racine_id: racine,
      libelle: "Arbre des plafonds",
    });
    expect(cree.statusCode).toBe(201);
    const id = cree.json().id as string;
    const racineNoeud = cree.json().noeuds[0].id as string;
    const noeud = (corps: Record<string, unknown>) =>
      s.a.chef.post(`/api/kpi/arbres/${id}/noeuds`, { libelle: "Levier", ...corps });
    const bascule = (noeudId: string, actif: boolean) =>
      s.a.chef.patch(`/api/kpi/arbres/noeuds/${noeudId}`, { actif });
    const lignes = (sql: string, params: unknown[]) =>
      proprietaire(async (c) => (await c.query(sql, params)).rows);

    // Un enfant ne se réactive pas sous un parent désactivé.
    const parent = (await noeud({ parent_id: racineNoeud, libelle: "Parent" })).json().id as string;
    const enfant = (await noeud({ parent_id: parent, libelle: "Enfant" })).json().id as string;
    expect((await bascule(enfant, false)).statusCode).toBe(200);
    expect((await bascule(parent, false)).statusCode).toBe(200);
    const sousParentInactif = await bascule(enfant, true);
    expect(sousParentInactif.statusCode).toBe(400);
    expect(erreur(sousParentInactif)).toBe("KPI_NOEUD_PARENT_INVALIDE");
    expect(await refusSql("UPDATE kpi_arbre_noeuds SET actif = true WHERE id = $1", [enfant])).toBe(
      "MPK12",
    );
    expect((await bascule(parent, true)).statusCode).toBe(200);
    expect((await bascule(enfant, true)).statusCode).toBe(200);

    // Jusqu'à 50 nœuds actifs (racine, parent et enfant compris).
    const [{ n }] = await lignes(
      "SELECT count(*)::int AS n FROM kpi_arbre_noeuds WHERE arbre_id = $1 AND actif",
      [id],
    );
    await lignes(
      `INSERT INTO kpi_arbre_noeuds (cabinet_id, arbre_id, parent_id, libelle, cree_par)
       SELECT cabinet_id, arbre_id, id, 'Levier ' || g, cree_par
       FROM kpi_arbre_noeuds, generate_series(1, 50 - $2::int) AS g WHERE id = $1`,
      [racineNoeud, n],
    );
    // Un nœud actif de plus est refusé ; un nœud inséré désactivé est admis.
    const trop = await noeud({ parent_id: racineNoeud });
    expect(trop.statusCode).toBe(409);
    expect(erreur(trop)).toBe("KPI_ARBRE_TROP_GRAND");
    await lignes(
      `INSERT INTO kpi_arbre_noeuds (cabinet_id, arbre_id, parent_id, libelle, cree_par, actif)
       SELECT cabinet_id, arbre_id, id, 'Désactivé', cree_par, false FROM kpi_arbre_noeuds WHERE id = $1`,
      [racineNoeud],
    );
    const inactif = (
      await lignes("SELECT id FROM kpi_arbre_noeuds WHERE arbre_id = $1 AND NOT actif", [id])
    )[0].id as string;
    // La RÉACTIVATION est soumise au même plafond (API 409, base MPK13).
    const reactive = await bascule(inactif, true);
    expect(reactive.statusCode).toBe(409);
    expect(erreur(reactive)).toBe("KPI_ARBRE_TROP_GRAND");
    expect(
      await refusSql("UPDATE kpi_arbre_noeuds SET actif = true WHERE id = $1", [inactif]),
    ).toBe("MPK13");
    // Libérer une place permet de réactiver.
    const feuille = (
      await lignes(
        "SELECT id FROM kpi_arbre_noeuds WHERE arbre_id = $1 AND actif AND libelle LIKE 'Levier %' LIMIT 1",
        [id],
      )
    )[0].id as string;
    expect((await bascule(feuille, false)).statusCode).toBe(200);
    expect((await bascule(inactif, true)).statusCode).toBe(200);

    // Total : 200 nœuds au plus, désactivés compris ; la lecture n'a donc aucune troncature.
    await lignes(
      `INSERT INTO kpi_arbre_noeuds (cabinet_id, arbre_id, parent_id, libelle, cree_par, actif)
       SELECT cabinet_id, arbre_id, id, 'Archive ' || g, cree_par, false
       FROM kpi_arbre_noeuds,
         generate_series(1, 200 - (SELECT count(*)::int FROM kpi_arbre_noeuds WHERE arbre_id = $2)) AS g
       WHERE id = $1`,
      [racineNoeud, id],
    );
    expect(
      await refusSql(
        `INSERT INTO kpi_arbre_noeuds (cabinet_id, arbre_id, parent_id, libelle, cree_par, actif)
         SELECT cabinet_id, arbre_id, id, 'Une de trop', cree_par, false FROM kpi_arbre_noeuds WHERE id = $1`,
        [racineNoeud],
      ),
    ).toBe("MPK13");
    expect((await s.a.chef.get(`/api/kpi/arbres/${id}`)).json().noeuds).toHaveLength(200);
  });

  it("l'arbre est fermé au portail", async () => {
    for (const url of [
      `/api/kpi/arbres/${arbreId}`,
      `/api/missions/${s.missionId}/kpi/arbres`,
      `/api/missions/${s.missionId}/kpi/qualite-donnees`,
      `/api/missions/${s.missionId}/kpi/actions`,
      `/api/missions/${s.missionId}/kpi/revues`,
    ]) {
      const r = await p.dirigeant.get(url);
      expect(r.statusCode).toBe(403);
      expect(erreur(r)).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });
});

/* ------------------------------------------------------------------------------------------ */
/* KPI-15 : qualité des données                                                               */
/* ------------------------------------------------------------------------------------------ */

describe("KPI-15 qualité des données", () => {
  const url = () => `/api/missions/${s.missionId}/kpi/qualite-donnees?date=${DATE}`;

  it("401, 403, autre cabinet et mission invisible", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect((await s.gestionnaire.get(url())).statusCode).toBe(403);
    expect((await s.b.associe.get(url())).statusCode).toBe(404);
    expect((await s.consultantHors.get(url())).statusCode).toBe(404);
    expect(
      (await s.a.chef.get(`/api/missions/${s.missionId}/kpi/qualite-donnees?date=hier`)).statusCode,
    ).toBe(400);
  });

  it("scores identiques au moteur : fraîcheur, complétude, cohérence, motifs", async () => {
    const r = await s.consultantEquipe.get(url());
    expect(r.statusCode).toBe(200);
    const q = r.json();
    expect(q.date_reference).toBe(DATE);
    const parId = new Map(q.kpis.map((k: { kpi_id: string }) => [k.kpi_id, k]));
    const ca = parId.get(jeu.ca) as { qualite: Record<string, unknown> };
    const delai = parId.get(jeu.delai) as { qualite: Record<string, unknown> };
    const sansCible = parId.get(jeu.sansCible) as { qualite: Record<string, unknown> };
    // CA : toutes les périodes exigibles mesurées, aucune correction.
    expect(ca.qualite).toMatchObject({
      score: 100,
      niveau: "bon",
      fraicheur: 1,
      completude: 1,
      coherence: 1,
      motifs: [],
    });
    // Délai : avril exigible et non mesuré (un retard) : (4 × 2/3 + 3 × 3/4 + 3) / 10.
    expect(delai.qualite).toMatchObject({
      score: 79,
      niveau: "moyen",
      fraicheur: 0.6667,
      completude: 0.75,
      coherence: 1,
      motifs: ["MESURE_EN_RETARD", "PERIODES_MANQUANTES"],
    });
    expect(sansCible.qualite).toMatchObject({
      score: 38,
      niveau: "faible",
      fraicheur: 0,
      completude: 0.25,
    });
    // Même résultat que le moteur appelé directement sur les mêmes entrées.
    const moteur = evaluerQualiteDonneesKpi({
      frequence: "mensuelle",
      debutSuivi: "2026-01-01",
      dateReference: DATE,
      delaiGraceJours: 5,
      mesures: [
        { date: "2026-01-31", valeur: 50 },
        { date: "2026-02-28", valeur: 55 },
        { date: "2026-03-31", valeur: 62 },
      ],
      nombreCorrections: 0,
      nombreLignes: 3,
    });
    expect(moteur.score).toBe(delai.qualite.score);
    expect(q.repartition).toEqual({ bon: 1, moyen: 1, faible: 1, non_evaluable: 0 });
  });

  it("une correction et une valeur aberrante dégradent la cohérence", async () => {
    const k = (
      await creerKpi(s.a.chef, s.missionA2, {
        libelle: "Encaissements",
        nature: "stock",
        cible: null,
      })
    ).id;
    const mesures: [string, number][] = [
      ["2026-01-31", 100],
      ["2026-02-28", 102],
      ["2026-03-31", 98],
      ["2026-04-30", 101],
    ];
    const lignes = [];
    for (const [d, v] of mesures) lignes.push(await mesurer(s.a.chef, k, d, v));
    attendre(
      201,
      await s.a.chef.post(`/api/kpi/mesures/${lignes[0]?.id}/corrections`, {
        date_mesure: "2026-01-31",
        valeur: 99,
        motif: "Erreur de saisie",
      }),
      "correction",
    );
    const r = await s.a.chef.get(`/api/missions/${s.missionA2}/kpi/qualite-donnees?date=${DATE}`);
    const qualite = r.json().kpis.find((x: { kpi_id: string }) => x.kpi_id === k).qualite;
    // 5 lignes saisies dont 1 correction : cohérence 0,8 ; toutes les périodes sont mesurées.
    expect(qualite).toMatchObject({ coherence: 0.8, completude: 1 });
    expect(qualite.details).toMatchObject({ nombre_corrections: 1, nombre_lignes: 5 });
    expect(qualite.motifs).toContain("CORRECTIONS_FREQUENTES");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* KPI-18 : actions correctives                                                               */
/* ------------------------------------------------------------------------------------------ */

describe("KPI-18 actions correctives", () => {
  let alerteId: string;
  let action1: string;
  let action2: string;
  const url = () => `/api/missions/${s.missionId}/kpi/actions`;

  beforeAll(async () => {
    const a = await s.a.chef.get(`/api/kpi/${jeu.delai}/alertes`);
    alerteId = a.json().elements[0].id;
  });

  it("401, 403, mission invisible, autre cabinet", async () => {
    const corps = {
      kpi_id: jeu.delai,
      titre: "Relancer les clients en retard",
      responsable_id: s.consultantEquipe.utilisateurId,
      echeance: "2026-04-30",
    };
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect((await api(ctx).post(url(), corps)).statusCode).toBe(401);
    expect((await s.gestionnaire.get(url())).statusCode).toBe(403);
    expect((await s.expertExterne.post(url(), corps)).statusCode).toBe(403);
    expect((await s.consultantHors.get(url())).statusCode).toBe(404);
    expect((await s.consultantHors.post(url(), corps)).statusCode).toBe(404);
    expect((await s.b.associe.get(url())).statusCode).toBe(404);
    expect((await s.b.associe.post(url(), corps)).statusCode).toBe(404);
    expect((await s.a.chef.get(`/api/kpi/actions/${INCONNU}`)).statusCode).toBe(404);
  });

  it("création reliée à une alerte ; contrôles du responsable, de l'alerte et du KPI", async () => {
    const corps = {
      kpi_id: jeu.delai,
      alerte_id: alerteId,
      titre: "Relancer les clients en retard",
      description: "Appel des 10 premiers débiteurs",
      responsable_id: s.consultantEquipe.utilisateurId,
      echeance: "2026-04-30",
    };
    const r = await s.a.chef.post(url(), corps);
    expect(r.statusCode).toBe(201);
    const a = r.json();
    action1 = a.id;
    expect(a).toMatchObject({
      numero: 1,
      statut: "a_faire",
      alerte_id: alerteId,
      kpi_id: jeu.delai,
      efficacite: null,
    });
    expect(a.evenements).toMatchObject([{ type: "creation", statut_apres: "a_faire" }]);
    // Responsable hors de l'équipe ; alerte d'un autre KPI ou inconnue : la même réponse 404 (aucune
    // confirmation d'existence d'un identifiant) ; KPI d'une autre mission.
    expect(
      (await s.a.chef.post(url(), { ...corps, responsable_id: s.consultantHors.utilisateurId }))
        .statusCode,
    ).toBe(400);
    const autreKpi = await s.a.chef.post(url(), { ...corps, kpi_id: jeu.ca });
    expect(autreKpi.statusCode).toBe(404);
    const inconnue = await s.a.chef.post(url(), { ...corps, alerte_id: INCONNU });
    expect(inconnue.statusCode).toBe(404);
    expect(autreKpi.json().erreur).toEqual(inconnue.json().erreur);
    expect((await s.a.chef.post(url(), { ...corps, kpi_id: INCONNU })).statusCode).toBe(404);
    expect((await s.a.chef.post(url(), { ...corps, alerte_id: INCONNU })).statusCode).toBe(404);
    expect((await s.a.chef.post(url(), { ...corps, titre: "" })).statusCode).toBe(400);
    // Le consultant de l'équipe peut créer (kpi.saisir + équipe) sur un KPI de la mission.
    const c2 = await s.consultantEquipe.post(url(), {
      kpi_id: jeu.ca,
      titre: "Relancer le portefeuille",
      responsable_id: s.consultantEquipe.utilisateurId,
      echeance: "2026-05-31",
    });
    expect(c2.statusCode).toBe(201);
    action2 = c2.json().id;
    expect(c2.json().numero).toBe(2);
  });

  it("liste filtrée et paginée par curseur", async () => {
    const tout = await s.a.chef.get(url());
    expect(tout.json().elements.map((a: { numero: number }) => a.numero)).toEqual([2, 1]);
    const liee = await s.a.chef.get(`${url()}?alerte_id=${alerteId}`);
    expect(liee.json().elements.map((a: { id: string }) => a.id)).toEqual([action1]);
    const page1 = await s.a.chef.get(`${url()}?limite=1`);
    expect(page1.json().elements).toHaveLength(1);
    const page2 = await s.a.chef.get(`${url()}?limite=1&curseur=${page1.json().curseur_suivant}`);
    expect(page2.json().elements.map((a: { id: string }) => a.id)).toEqual([action1]);
    expect(page2.json().curseur_suivant).toBeNull();
    expect((await s.a.chef.get(`${url()}?statut=terminee`)).json().elements).toEqual([]);
    expect((await s.a.chef.get(`${url()}?curseur=abc`)).statusCode).toBe(400);
  });

  it("statuts : le responsable avance, la clôture porte la date d'effet, un état terminal ne se rouvre pas", async () => {
    const statut = (id: string, corps: Record<string, unknown>, par = s.consultantEquipe) =>
      par.post(`/api/kpi/actions/${id}/statut`, corps);
    expect((await statut(action1, { statut: "en_cours" })).json()).toMatchObject({
      statut: "en_cours",
    });
    // Un consultant hors de l'équipe ne voit pas l'action.
    expect((await statut(action1, { statut: "terminee" }, s.consultantHors)).statusCode).toBe(404);
    expect(
      (await api(ctx).post(`/api/kpi/actions/${action1}/statut`, { statut: "en_cours" }))
        .statusCode,
    ).toBe(401);
    // Corps incohérents.
    expect((await statut(action2, { statut: "abandonnee" })).statusCode).toBe(400);
    expect(
      (await statut(action2, { statut: "en_cours", date_effet: "2026-03-01" })).statusCode,
    ).toBe(400);
    expect(
      (await statut(action2, { statut: "terminee", date_effet: "2999-01-01" })).statusCode,
    ).toBe(400);
    const finie = await statut(action2, {
      statut: "terminee",
      date_effet: "2026-03-01",
      commentaire: "Fait",
    });
    expect(finie.statusCode).toBe(200);
    expect(finie.json()).toMatchObject({ statut: "terminee", date_effet: "2026-03-01" });
    expect(finie.json().evenements.map((e: { type: string }) => e.type)).toEqual([
      "creation",
      "statut",
    ]);
    // Terminale : plus aucune modification.
    expect((await statut(action2, { statut: "en_cours" })).statusCode).toBe(409);
    expect(
      (await s.consultantEquipe.patch(`/api/kpi/actions/${action2}`, { titre: "Autre" }))
        .statusCode,
    ).toBe(409);
    expect(
      await refusSql("UPDATE kpi_actions SET statut = 'a_faire', date_effet = NULL WHERE id = $1", [
        action2,
      ]),
    ).toBe("MPK26");
    expect(await refusSql("UPDATE kpi_actions SET titre = 'Autre' WHERE id = $1", [action2])).toBe(
      "MPK26",
    );
    // Commentaire possible après coup ; l'historique est en ajout seul.
    const com = await s.consultantEquipe.post(`/api/kpi/actions/${action2}/commentaires`, {
      commentaire: "Effet à surveiller",
    });
    expect(com.statusCode).toBe(201);
    expect(com.json().evenements.at(-1)).toMatchObject({ type: "commentaire" });
    expect(
      await refusSql("UPDATE kpi_action_evenements SET commentaire = 'x' WHERE action_id = $1", [
        action2,
      ]),
    ).toBe("MPK05");
    expect(
      await refusSql("DELETE FROM kpi_action_evenements WHERE action_id = $1", [action2]),
    ).toBe("MPK05");
  });

  it("modification : responsable valide, champs figés défendus en base", async () => {
    const ok = await s.a.chef.patch(`/api/kpi/actions/${action1}`, { echeance: "2026-05-05" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().echeance).toBe("2026-05-05");
    expect(
      (
        await s.a.chef.patch(`/api/kpi/actions/${action1}`, {
          responsable_id: s.consultantHors.utilisateurId,
        })
      ).statusCode,
    ).toBe(400);
    expect((await s.a.chef.patch(`/api/kpi/actions/${action1}`, {})).statusCode).toBe(400);
    expect(
      await refusSql("UPDATE kpi_actions SET kpi_id = $2 WHERE id = $1", [action1, jeu.ca]),
    ).toBe("MPK11");
    expect(
      await refusSql(
        "INSERT INTO kpi_actions (cabinet_id, mission_id, kpi_id, numero, titre, responsable_id, echeance, cree_par) SELECT cabinet_id, $2, kpi_id, 0, 't', responsable_id, echeance, cree_par FROM kpi_actions WHERE id = $1",
        [action1, s.missionB],
      ),
    ).not.toBe("aucun");
  });

  it("efficacité recalculée par le moteur : variation avant/après sur les périodes closes", async () => {
    const r = await s.a.chef.get(`/api/kpi/actions/${action2}/efficacite?date=${DATE}&fenetre=2`);
    expect(r.statusCode).toBe(200);
    const e = r.json().efficacite;
    // CA mensuel (plus haut = mieux) : janvier-février 1000 et 900, mars-avril 800 et 700.
    expect(e).toMatchObject({
      verdict: "inefficace",
      moyenne_avant: 950,
      moyenne_apres: 750,
      variation: -200,
      variation_orientee: -200,
      variation_relative: -0.2105,
      nombre_avant: 2,
      nombre_apres: 2,
      periode_effet: null,
    });
    expect(e.periodes_avant.map((x: { periode: string }) => x.periode)).toEqual([
      "2026-01",
      "2026-02",
    ]);
    expect(e.periodes_apres.map((x: { periode: string }) => x.periode)).toEqual([
      "2026-03",
      "2026-04",
    ]);
    expect(r.json().avertissement).toMatch(/corrélation/);
    // Une action non terminée n'a pas d'efficacité ; une fenêtre invalide est refusée.
    expect((await s.a.chef.get(`/api/kpi/actions/${action1}/efficacite`)).statusCode).toBe(409);
    expect(
      (await s.a.chef.get(`/api/kpi/actions/${action2}/efficacite?fenetre=0`)).statusCode,
    ).toBe(400);
    expect((await s.b.associe.get(`/api/kpi/actions/${action2}/efficacite`)).statusCode).toBe(404);
    // La fiche et la liste portent l'efficacité (à la date du jour) pour les actions terminées.
    const detail = await s.a.chef.get(`/api/kpi/actions/${action2}`);
    expect(detail.json().efficacite).toMatchObject({ date_effet: "2026-03-01" });
    const liste = await s.a.chef.get(`${url()}?statut=terminee`);
    expect(liste.json().elements[0].efficacite.verdict).toBeTypeOf("string");
    // Indéterminée tant que les périodes manquent : action terminée tôt sur le délai de paiement.
    const tot = await s.a.chef.post(url(), {
      kpi_id: jeu.delai,
      titre: "Action trop récente",
      responsable_id: s.a.chef.utilisateurId,
      echeance: "2026-02-20",
    });
    // Une date d'effet très antérieure (elle fixe les fenêtres avant/après) exige un commentaire.
    const sansMotif = await s.a.chef.post(`/api/kpi/actions/${tot.json().id}/statut`, {
      statut: "terminee",
      date_effet: "2026-02-15",
    });
    expect(sansMotif.statusCode).toBe(400);
    expect(sansMotif.json().erreur.message).toMatch(/31 jours.*commentaire/);
    const finie = await s.a.chef.post(`/api/kpi/actions/${tot.json().id}/statut`, {
      statut: "terminee",
      date_effet: "2026-02-15",
      commentaire: "Mise en œuvre constatée dès la mi-février",
    });
    expect(finie.statusCode).toBe(200);
    expect(finie.json().evenements.at(-1)).toMatchObject({
      type: "statut",
      commentaire: "Mise en œuvre constatée dès la mi-février",
    });
    const indet = await s.a.chef.get(`/api/kpi/actions/${tot.json().id}/efficacite?date=${DATE}`);
    expect(indet.json().efficacite).toMatchObject({ verdict: "indeterminee", manquant_avant: 1 });
  });

  it("la date d'effet par défaut (aujourd'hui) n'exige aucun commentaire ; le recul se borne à 31 jours", async () => {
    const m = s.missionA2;
    const kpi = (await creerKpi(s.a.chef, m, { libelle: "KPI de la date d'effet" })).id;
    const creer = async () =>
      (
        await s.a.chef.post(`/api/missions/${m}/kpi/actions`, {
          kpi_id: kpi,
          titre: "Action à dater",
          responsable_id: s.a.chef.utilisateurId,
          echeance: "2026-12-31",
        })
      ).json().id as string;
    const statut = (id: string, corps: Record<string, unknown>) =>
      s.a.chef.post(`/api/kpi/actions/${id}/statut`, { statut: "terminee", ...corps });
    const jour = (decalage: number) =>
      new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);
    // Par défaut : aujourd'hui.
    expect((await statut(await creer(), {})).statusCode).toBe(200);
    // Dans la limite des 31 jours : sans commentaire.
    expect((await statut(await creer(), { date_effet: jour(-30) })).statusCode).toBe(200);
    // Au-delà : un commentaire (obligatoire), dans l'historique de l'action.
    const id = await creer();
    expect((await statut(id, { date_effet: jour(-40) })).statusCode).toBe(400);
    expect((await statut(id, { date_effet: jour(-40), commentaire: "  " })).statusCode).toBe(400);
    const ok = await statut(id, {
      date_effet: jour(-40),
      commentaire: "Déployée il y a six semaines",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().evenements.at(-1).commentaire).toBe("Déployée il y a six semaines");
    // Dans le futur : refusé.
    expect((await statut(await creer(), { date_effet: jour(2) })).statusCode).toBe(400);
  });

  it("création simultanée sur deux KPI d'une même mission : numéros distincts, aucun 500", async () => {
    const m = s.missionA2;
    const kpis = [
      (await creerKpi(s.a.chef, m, { libelle: "KPI concurrent 1" })).id,
      (await creerKpi(s.a.chef, m, { libelle: "KPI concurrent 2" })).id,
    ];
    const reponses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        s.a.chef.post(`/api/missions/${m}/kpi/actions`, {
          kpi_id: kpis[i % 2],
          titre: `Action concurrente ${i}`,
          responsable_id: s.a.chef.utilisateurId,
          echeance: "2026-12-31",
        }),
      ),
    );
    expect(reponses.map((r) => r.statusCode)).toEqual(Array(8).fill(201));
    const numeros = reponses.map((r) => r.json().numero as number);
    expect(new Set(numeros).size).toBe(8);
    // La contrainte de numérotation existe en base sous le nom que l'API traduit en 409 réessayable.
    const uniques = await proprietaire(async (c) =>
      (
        await c.query(
          "SELECT conname FROM pg_constraint WHERE conrelid = 'kpi_actions'::regclass AND contype = 'u'",
        )
      ).rows.map((l) => l.conname as string),
    );
    expect(uniques).toContain("kpi_actions_cabinet_id_mission_id_numero_key");
    expect(
      traduireErreurKpi({
        code: "23505",
        constraint: "kpi_actions_cabinet_id_mission_id_numero_key",
      }),
    ).toMatchObject({ statut: 409, code: "CONFLIT" });
  });
});

/* ------------------------------------------------------------------------------------------ */
/* KPI-17 : revues de performance                                                             */
/* ------------------------------------------------------------------------------------------ */

describe("KPI-17 revue de performance", () => {
  let revueId: string;
  let decisionId: string;
  let actionRevue: string;
  const url = () => `/api/missions/${s.missionId}/kpi/revues`;
  const corps = {
    titre: "Revue mensuelle de mai",
    date_prevue: "2026-05-20",
    date_reference: DATE,
  };

  it("401, 403, autre cabinet, mission invisible", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect((await api(ctx).post(url(), corps)).statusCode).toBe(401);
    expect((await s.consultantEquipe.post(url(), corps)).statusCode).toBe(403);
    expect((await s.gestionnaire.get(url())).statusCode).toBe(403);
    expect((await s.consultantHors.get(url())).statusCode).toBe(404);
    expect((await s.b.associe.get(url())).statusCode).toBe(404);
    expect((await s.b.associe.post(url(), corps)).statusCode).toBe(404);
    expect((await s.a.chef.get(`/api/kpi/revues/${INCONNU}`)).statusCode).toBe(404);
  });

  it("planification : numérotée par mission, animateur de l'équipe, dates bornées", async () => {
    const r = await s.a.chef.post(url(), {
      ...corps,
      animateur_id: s.consultantEquipe.utilisateurId,
    });
    expect(r.statusCode).toBe(201);
    revueId = r.json().id;
    expect(r.json()).toMatchObject({
      numero: 1,
      statut: "planifiee",
      ordre_du_jour: [],
      dossier_fige: false,
    });
    expect(
      (await s.a.chef.post(url(), { ...corps, animateur_id: s.consultantHors.utilisateurId }))
        .statusCode,
    ).toBe(400);
    expect(
      (await s.a.chef.post(url(), { ...corps, date_reference: "2999-01-01" })).statusCode,
    ).toBe(400);
    expect((await s.a.chef.post(url(), { titre: "", date_prevue: "2026-05-20" })).statusCode).toBe(
      400,
    );
    const deux = await s.a.chef.post(url(), { titre: "Revue annulée", date_prevue: "2026-06-20" });
    expect(deux.json().numero).toBe(2);
    expect(deux.json().date_reference).toBe("2026-06-20");
    const annulee = await s.a.chef.post(`/api/kpi/revues/${deux.json().id}/annuler`, {});
    expect(annulee.json().statut).toBe("annulee");
    expect((await s.a.chef.post(`/api/kpi/revues/${deux.json().id}/annuler`, {})).statusCode).toBe(
      409,
    );
    expect(
      (await s.a.chef.patch(`/api/kpi/revues/${deux.json().id}`, { titre: "x" })).statusCode,
    ).toBe(409);
    const liste = await s.consultantEquipe.get(url());
    expect(liste.json().elements.map((x: { numero: number }) => x.numero)).toEqual([2, 1]);
    expect(
      (await s.consultantEquipe.get(`${url()}?statut=planifiee`)).json().elements,
    ).toHaveLength(1);
  });

  it("ordre du jour généré par le moteur : mêmes points que l'appel direct", async () => {
    expect(
      (await s.consultantEquipe.post(`/api/kpi/revues/${revueId}/ordre-du-jour/generer`, {}))
        .statusCode,
    ).toBe(403);
    expect((await s.a.chef.post(`/api/kpi/revues/${revueId}/tenir`, {})).statusCode).toBe(409);
    const r = await s.a.chef.post(`/api/kpi/revues/${revueId}/ordre-du-jour/generer`, {});
    expect(r.statusCode).toBe(200);
    const points = r.json().points as {
      code: string;
      priorite: number;
      kpi_id: string | null;
      origine: string;
    }[];
    // Délai de paiement : rouge, 2 alertes (seuil, retard) ; CA : rouge, 1 alerte (dégradation) ;
    // action de relance en retard de 10 jours, action de la CA jugée sans effet ; indicateur sans cible à la qualité des données faible.
    expect(points.map((x) => [x.code, x.priorite])).toEqual([
      ["OUVERTURE", 0],
      ["KPI_ROUGE", 120],
      ["KPI_ROUGE", 110],
      ["ACTION_EN_RETARD", 100],
      ["ACTION_INEFFICACE", 80],
      ["QUALITE_DONNEES", 50],
      ["DECISIONS_A_PRENDRE", 0],
    ]);
    expect(points[1]?.kpi_id).toBe(jeu.delai);
    expect(points.every((x) => x.origine === "moteur")).toBe(true);
    const direct = composerOrdreDuJourKpi({
      dateReference: DATE,
      kpis: [
        {
          id: "a",
          libelle: "x",
          statut: "rouge",
          evolution: "stable",
          nombreAlertes: 2,
          qualite: "bon",
        },
      ],
      actions: [],
      decisionsOuvertes: [],
    });
    expect(direct.points[1]?.priorite).toBe(120);
    expect(r.json().duree_totale_minutes).toBe(5 + 10 + 10 + 5 + 5 + 5 + 10);
    // La fiche porte l'ordre du jour enregistré.
    const fiche = (await s.a.chef.get(`/api/kpi/revues/${revueId}`)).json();
    expect(fiche.ordre_du_jour).toHaveLength(7);
    // Listes lues en entier : le dire explicitement (jamais de troncature silencieuse).
    expect(fiche).toMatchObject({
      decisions_tronque: false,
      actions_tronque: false,
      evenements_decisions_tronque: false,
    });
    expect(r.json().sources_tronquees).toBe(false);
  });

  it("ordre du jour saisi : KPI de la mission seulement ; compte rendu éditable", async () => {
    const mauvais = await s.a.chef.put(`/api/kpi/revues/${revueId}/ordre-du-jour`, {
      points: [{ libelle: "Point", kpi_id: INCONNU, duree_minutes: 5 }],
    });
    expect(mauvais.statusCode).toBe(400);
    expect(
      (
        await s.a.chef.put(`/api/kpi/revues/${revueId}/ordre-du-jour`, {
          points: [{ libelle: "x", duree_minutes: 0 }],
        })
      ).statusCode,
    ).toBe(400);
    const ok = await s.a.chef.put(`/api/kpi/revues/${revueId}/ordre-du-jour`, {
      points: [
        { libelle: "Tour de table", duree_minutes: 10 },
        { libelle: "Délai de paiement", kpi_id: jeu.delai, duree_minutes: 20 },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().points.map((x: { rang: number; code: string }) => [x.rang, x.code])).toEqual([
      [1, "MANUEL"],
      [2, "MANUEL"],
    ]);
    const cr = await s.a.chef.patch(`/api/kpi/revues/${revueId}`, {
      compte_rendu: "Brouillon de notes",
    });
    expect(cr.json().compte_rendu).toBe("Brouillon de notes");
    expect(
      (
        await s.a.chef.patch(`/api/kpi/revues/${revueId}`, { titre: "Revue de mai (version 2)" })
      ).json().titre,
    ).toBe("Revue de mai (version 2)");
    // Régénérer remplace la liste précédente.
    await s.a.chef.post(`/api/kpi/revues/${revueId}/ordre-du-jour/generer`, {});
  });

  it("dossier : document et présentation générés par le moteur de rapports", async () => {
    const dossier = (par: Api, format: string) =>
      par.get(`/api/kpi/revues/${revueId}/dossier?format=${format}`);
    expect((await api(ctx).get(`/api/kpi/revues/${revueId}/dossier?format=docx`)).statusCode).toBe(
      401,
    );
    expect(
      (await s.gestionnaire.get(`/api/kpi/revues/${revueId}/dossier?format=docx`)).statusCode,
    ).toBe(403);
    expect(
      (await s.b.associe.get(`/api/kpi/revues/${revueId}/dossier?format=docx`)).statusCode,
    ).toBe(404);
    expect((await dossier(s.a.chef, "xlsx")).statusCode).toBe(400);
    const pptx = await dossier(s.consultantEquipe, "pptx");
    expect(pptx.statusCode).toBe(200);
    expect(pptx.headers["content-type"]).toContain("presentationml.presentation");
    expect(pptx.headers["content-disposition"]).toContain("Revue KPI 1");
    expect(pptx.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const docx = await dossier(s.a.chef, "docx");
    expect(docx.statusCode).toBe(200);
    expect(docx.headers["content-type"]).toContain("wordprocessingml.document");
    const contenu = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      const revue = await lireRevue(db, revueId);
      return rapportRevueARendre(db, revue!);
    });
    expect(contenu.statut).toBe("brouillon");
    expect(contenu.sections.map((x) => x.titre)).toEqual([
      "Objet de la revue",
      "Ordre du jour",
      "Situation des KPI",
      "Alertes",
    ]);
    // Au plus 10 dossiers par utilisateur sur 10 minutes (429), journalisés sans contenu.
    let dernier = 200;
    for (let i = 0; i < 12 && dernier === 200; i++)
      dernier = (await dossier(s.a.associe, "docx")).statusCode;
    expect(dernier).toBe(429);
    const refus = await dossier(s.a.associe, "pptx");
    expect(refus.statusCode).toBe(429);
    expect(erreur(refus)).toBe("TROP_DE_DOSSIERS_REVUE");
    // Chaque téléchargement est réservé et journalisé AVANT le rendu (sans contenu ni taille).
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE cabinet_id = $1 AND action = 'telechargement_dossier_revue_kpi' ORDER BY cree_le DESC LIMIT 1",
            [s.a.cabinetId],
          )
        ).rows[0],
    );
    expect(journal.details).toEqual({ format: "docx", statut: "planifiee" });
  });

  it("dossier : des demandes simultanées ne dépassent pas le plafond (429 avant le rendu)", async () => {
    const utilisateur = s.consultantEquipe.utilisateurId;
    // Le consultant en a déjà demandé un ; on porte son compteur à 9 sur la fenêtre.
    await proprietaire(async (c) => {
      const { rows } = await c.query(
        "SELECT count(*)::int AS n FROM journal_audit WHERE utilisateur_id = $1 AND action = 'telechargement_dossier_revue_kpi' AND cree_le > now() - interval '10 minutes'",
        [utilisateur],
      );
      for (let i = rows[0].n; i < 9; i++) {
        await c.query(
          "INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite, entite_id, details) VALUES ($1, $2, 'telechargement_dossier_revue_kpi', 'kpi_revue', $3, '{}')",
          [s.a.cabinetId, utilisateur, revueId],
        );
      }
    });
    const reponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        s.consultantEquipe.get(`/api/kpi/revues/${revueId}/dossier?format=docx`),
      ),
    );
    const codes = reponses.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 429, 429, 429, 429]);
  });

  it("tenue : le dossier est figé, l'ordre du jour et la date ne changent plus", async () => {
    expect((await s.consultantEquipe.post(`/api/kpi/revues/${revueId}/tenir`, {})).statusCode).toBe(
      403,
    );
    const tenue = await s.a.chef.post(`/api/kpi/revues/${revueId}/tenir`, {
      compte_rendu: "Compte rendu acté en séance",
    });
    expect(tenue.statusCode).toBe(200);
    expect(tenue.json()).toMatchObject({
      statut: "tenue",
      dossier_fige: true,
      compte_rendu: "Compte rendu acté en séance",
    });
    // Le compte rendu est figé à la tenue : ni par l'API (409), ni directement en base (MPK22).
    const reecriture = await s.a.chef.patch(`/api/kpi/revues/${revueId}`, {
      compte_rendu: "Réécrit après coup",
    });
    expect(reecriture.statusCode).toBe(409);
    expect(
      await refusSql("UPDATE kpi_revues SET compte_rendu = 'Réécrit' WHERE id = $1", [revueId]),
    ).toBe("MPK22");
    expect((await s.a.chef.get(`/api/kpi/revues/${revueId}`)).json().compte_rendu).toBe(
      "Compte rendu acté en séance",
    );
    expect((await s.a.chef.post(`/api/kpi/revues/${revueId}/tenir`, {})).statusCode).toBe(409);
    expect(
      (await s.a.chef.post(`/api/kpi/revues/${revueId}/ordre-du-jour/generer`, {})).statusCode,
    ).toBe(409);
    expect(
      (await s.a.chef.put(`/api/kpi/revues/${revueId}/ordre-du-jour`, { points: [] })).statusCode,
    ).toBe(409);
    expect(
      (await s.a.chef.patch(`/api/kpi/revues/${revueId}`, { titre: "Autre" })).statusCode,
    ).toBe(409);
    expect((await s.a.chef.post(`/api/kpi/revues/${revueId}/annuler`, {})).statusCode).toBe(409);
    expect(
      await refusSql("UPDATE kpi_revues SET date_reference = '2026-01-31' WHERE id = $1", [
        revueId,
      ]),
    ).toBe("MPK22");
    expect(
      await refusSql("UPDATE kpi_revues SET dossier = '{}'::jsonb WHERE id = $1", [revueId]),
    ).toBe("MPK22");
    expect(
      await refusSql(
        "UPDATE kpi_revues SET statut = 'planifiee', dossier = NULL, tenue_le = NULL WHERE id = $1",
        [revueId],
      ),
    ).toBe("MPK21");
    // Une mesure ajoutée APRÈS la tenue ne change pas ce qui a été examiné.
    const avant = await ctx.db.withTenant(s.a.cabinetId, async (db) =>
      rapportRevueARendre(db, (await lireRevue(db, revueId))!),
    );
    await mesurer(s.a.chef, jeu.sansCible, "2026-04-30", 7);
    const apres = await ctx.db.withTenant(s.a.cabinetId, async (db) =>
      rapportRevueARendre(db, (await lireRevue(db, revueId))!),
    );
    expect(apres.sections.find((x) => x.titre === "Situation des KPI")).toEqual(
      avant.sections.find((x) => x.titre === "Situation des KPI"),
    );
    // Aucun circuit de validation : le dossier figé reste un brouillon confidentiel, jamais « Validé ».
    expect(apres.statut).toBe("brouillon");
    expect(apres.confidentiel).toBe(true);
    expect(avant.statut).toBe("brouillon");
    expect(apres.sections.map((x) => x.titre)).toEqual(
      expect.arrayContaining(["Décisions de la revue", "Actions correctives issues de la revue"]),
    );
  });

  it("décisions suivies jusqu'à clôture : actions liées, historique, clôture refusée tant que tout n'est pas terminé", async () => {
    const dec = (corps: Record<string, unknown>, par = s.a.chef) =>
      par.post(`/api/kpi/revues/${revueId}/decisions`, corps);
    expect(
      (await dec({ libelle: "Réviser les conditions de paiement" }, s.consultantEquipe)).statusCode,
    ).toBe(403);
    expect((await dec({ libelle: "x", kpi_id: INCONNU })).statusCode).toBe(400);
    expect(
      (await dec({ libelle: "x", responsable_id: s.consultantHors.utilisateurId })).statusCode,
    ).toBe(400);
    const r = await dec({
      libelle: "Réviser les conditions de paiement",
      kpi_id: jeu.delai,
      responsable_id: s.consultantEquipe.utilisateurId,
      echeance: "2026-06-30",
    });
    expect(r.statusCode).toBe(201);
    decisionId = r.json().id;
    expect(r.json()).toMatchObject({ numero: 1, statut: "ouverte" });
    // Action rattachée à la décision : la revue est celle de la décision.
    const a = await s.a.chef.post(`/api/missions/${s.missionId}/kpi/actions`, {
      kpi_id: jeu.delai,
      decision_id: decisionId,
      titre: "Envoyer les nouvelles conditions",
      responsable_id: s.consultantEquipe.utilisateurId,
      echeance: "2026-06-15",
    });
    expect(a.statusCode).toBe(201);
    actionRevue = a.json().id;
    expect(a.json().revue_id).toBe(revueId);
    // Décision d'une autre mission : 404.
    const ailleurs = await s.a.chef.post(`/api/missions/${s.missionA2}/kpi/actions`, {
      kpi_id: jeu.delai,
      decision_id: decisionId,
      titre: "x",
      responsable_id: s.a.chef.utilisateurId,
      echeance: "2026-06-15",
    });
    expect(ailleurs.statusCode).toBe(404);
    // Clôture refusée : une décision et une action sont ouvertes.
    const refus = await s.a.chef.post(`/api/kpi/revues/${revueId}/cloturer`, {});
    expect(refus.statusCode).toBe(409);
    expect(erreur(refus)).toBe("KPI_REVUE_OUVERTE");
    expect(refus.json().erreur.details.manquants).toEqual([
      `decision:${decisionId}`,
      `action:${actionRevue}`,
    ]);
    expect(
      await refusSql(
        "UPDATE kpi_revues SET statut = 'cloturee', cloturee_le = now() WHERE id = $1",
        [revueId],
      ),
    ).toBe("MPK23");
    // Le responsable change l'état de sa décision ; un étranger à l'équipe ne la voit pas.
    const statut = (corps: Record<string, unknown>, par: Api = s.consultantEquipe) =>
      par.post(`/api/kpi/revues/decisions/${decisionId}/statut`, corps);
    expect((await statut({ statut: "en_cours" }, s.consultantHors)).statusCode).toBe(404);
    expect((await statut({ statut: "en_cours" }, s.b.associe)).statusCode).toBe(404);
    expect((await statut({ statut: "abandonnee" })).statusCode).toBe(400);
    // « Exécutée » se déclare avec un commentaire (ce qui a été fait) : la clôture se justifie.
    expect((await statut({ statut: "executee" })).statusCode).toBe(400);
    expect((await statut({ statut: "executee", commentaire: "  " })).statusCode).toBe(400);
    expect((await statut({ statut: "en_cours" })).json()).toMatchObject({ statut: "en_cours" });
    // L'historique de la décision est en ajout seul.
    const fiche = await s.a.chef.get(`/api/kpi/revues/${revueId}`);
    expect(
      fiche
        .json()
        .evenements_decisions.map((e: { type: string; statut_apres: string }) => [
          e.type,
          e.statut_apres,
        ]),
    ).toEqual([
      ["creation", "ouverte"],
      ["statut", "en_cours"],
    ]);
    expect(await refusSql("UPDATE kpi_revue_decision_evenements SET commentaire = 'x'")).toBe(
      "MPK05",
    );
    // Terminer : décision exécutée, action abandonnée avec motif.
    expect(
      (await statut({ statut: "executee", commentaire: "Courrier envoyé" })).json().statut,
    ).toBe("executee");
    expect((await statut({ statut: "en_cours" })).statusCode).toBe(409);
    expect(
      await refusSql("UPDATE kpi_revue_decisions SET libelle = 'x' WHERE id = $1", [decisionId]),
    ).toBe("MPK25");
    const abandon = await s.consultantEquipe.post(`/api/kpi/actions/${actionRevue}/statut`, {
      statut: "abandonnee",
      motif: "Remplacée par un appel direct",
    });
    expect(abandon.statusCode).toBe(200);
    expect(abandon.json()).toMatchObject({
      statut: "abandonnee",
      motif: "Remplacée par un appel direct",
    });
    const cloture = await s.a.chef.post(`/api/kpi/revues/${revueId}/cloturer`, {});
    expect(cloture.statusCode).toBe(200);
    expect(cloture.json().statut).toBe("cloturee");
    expect((await s.a.chef.post(`/api/kpi/revues/${revueId}/cloturer`, {})).statusCode).toBe(409);
    expect((await dec({ libelle: "Trop tard" })).statusCode).toBe(409);
    expect(
      await refusSql("UPDATE kpi_revues SET compte_rendu = 'tardif' WHERE id = $1", [revueId]),
    ).toBe("MPK22");
    // Revue clôturée : plus d'action rattachée (API 409, base MPK27).
    const tardive = await s.a.chef.post(`/api/missions/${s.missionId}/kpi/actions`, {
      kpi_id: jeu.delai,
      decision_id: decisionId,
      titre: "Trop tard",
      responsable_id: s.consultantEquipe.utilisateurId,
      echeance: "2026-12-31",
    });
    expect(tardive.statusCode).toBe(409);
    expect(
      await refusSql(
        `INSERT INTO kpi_actions (cabinet_id, mission_id, kpi_id, revue_id, numero, titre, responsable_id, echeance, cree_par)
         SELECT cabinet_id, mission_id, kpi_id, $2, 0, 'x', responsable_id, echeance, cree_par
         FROM kpi_actions WHERE id = $1`,
        [actionRevue, revueId],
      ),
    ).toBe("MPK27");
    expect(
      (await s.a.chef.patch(`/api/kpi/revues/${revueId}`, { compte_rendu: "tardif" })).statusCode,
    ).toBe(409);
  });

  it("la revue suivante reprend les décisions encore ouvertes dans son ordre du jour", async () => {
    // Revue 3 tenue avec une décision laissée ouverte, dont l'échéance est passée.
    const r3 = await s.a.chef.post(url(), {
      titre: "Revue de juin",
      date_prevue: "2026-06-20",
      date_reference: DATE,
    });
    expect(r3.json().numero).toBe(3);
    const id3 = r3.json().id as string;
    attendre(
      200,
      await s.a.chef.post(`/api/kpi/revues/${id3}/ordre-du-jour/generer`, {}),
      "ordre du jour",
    );
    attendre(200, await s.a.chef.post(`/api/kpi/revues/${id3}/tenir`, {}), "tenue");
    attendre(
      201,
      await s.a.chef.post(`/api/kpi/revues/${id3}/decisions`, {
        libelle: "Négocier un escompte",
        echeance: "2026-05-01",
      }),
      "décision",
    );
    const r4 = await s.a.chef.post(url(), {
      titre: "Revue de juillet",
      date_prevue: "2026-07-20",
      date_reference: DATE,
    });
    const ordre = await s.a.chef.post(`/api/kpi/revues/${r4.json().id}/ordre-du-jour/generer`, {});
    expect(ordre.statusCode).toBe(200);
    const point = ordre.json().points.find((x: { code: string }) => x.code === "DECISION_OUVERTE");
    expect(point).toMatchObject({ priorite: 95, origine: "moteur" });
    expect(point.libelle).toContain("Négocier un escompte");
    // Une revue tenue ne se clôture pas avec une décision ouverte.
    expect((await s.a.chef.post(`/api/kpi/revues/${id3}/cloturer`, {})).statusCode).toBe(409);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Isolation et défense en base                                                               */
/* ------------------------------------------------------------------------------------------ */

describe("isolation entre cabinets et défenses en base", () => {
  it("un autre cabinet ne voit ni n'écrit rien (404 uniforme)", async () => {
    const revues = await s.a.chef.get(`/api/missions/${s.missionId}/kpi/revues`);
    const revue = revues.json().elements[0].id as string;
    const actions = await s.a.chef.get(`/api/missions/${s.missionId}/kpi/actions`);
    const action = actions.json().elements[0].id as string;
    const appels: [string, string, Record<string, unknown>][] = [
      ["get", `/api/kpi/revues/${revue}`, {}],
      ["get", `/api/kpi/revues/${revue}/dossier?format=docx`, {}],
      ["post", `/api/kpi/revues/${revue}/tenir`, {}],
      ["post", `/api/kpi/revues/${revue}/decisions`, { libelle: "x" }],
      ["get", `/api/kpi/actions/${action}`, {}],
      ["post", `/api/kpi/actions/${action}/statut`, { statut: "en_cours" }],
      ["post", `/api/kpi/actions/${action}/commentaires`, { commentaire: "x" }],
      ["patch", `/api/kpi/actions/${action}`, { titre: "x" }],
    ];
    for (const [methode, chemin, corps] of appels) {
      const r =
        methode === "get"
          ? await s.b.associe.get(chemin)
          : methode === "post"
            ? await s.b.associe.post(chemin, corps)
            : await s.b.associe.patch(chemin, corps);
      expect(r.statusCode, `${methode} ${chemin}`).toBe(404);
    }
  });

  it("références composites : une action ne se rattache pas à la revue ou à l'alerte d'un autre KPI", async () => {
    const r = await proprietaire(
      async (c) =>
        (await c.query("SELECT id, kpi_id FROM kpi_alertes WHERE kpi_id = $1 LIMIT 1", [jeu.delai]))
          .rows[0],
    );
    expect(
      await refusSql(
        `INSERT INTO kpi_actions (cabinet_id, mission_id, kpi_id, alerte_id, numero, titre, responsable_id, echeance, cree_par)
         SELECT cabinet_id, mission_id, $2, $1, 0, 'x', responsable_id, echeance, cree_par FROM kpi_actions LIMIT 1`,
        [r.id, jeu.ca],
      ),
    ).toBe("MPK10");
  });
});
