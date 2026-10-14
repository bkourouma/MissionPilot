import { calculerScoreAlerte, SEUILS_ALERTE_DEFAUT } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  entreesAlerteDepuisVue,
  seuilsDepuisJson,
  seuilsVersJson,
  vueScoreAlerte,
} from "../src/redressement/vues.js";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  erreur,
  INCONNU,
  ouvrirDossierRed,
  preparerCasA,
  preparerRed,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Urgence, seuils d'alerte et scores (routes 11 à 17). Urgence : cas U2 et U3 de SPEC-3a §6.4 par
 * l'API, débit 429. Seuils : brouillon, publication (auteur 403, consultant 403, autre expert 200,
 * associé auteur 200, version obsolète 409). Score : cas S1, S2 et S5 de §6.5 par l'API avec les
 * seuils par défaut, puis avec des seuils publiés ; l'instantané des seuils égale la version, le
 * score se rejoue à l'identique ; `insuffisant` conservé ; un secteur changé ne touche pas l'ancien
 * score.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dossierId: string;

const urlD = (suffixe: string) => `/api/redressement/dossiers/${dossierId}${suffixe}`;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED urgence alerte");
  dossierId = (await preparerCasA(s)).dossierId;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("urgence (routes 11 et 12)", () => {
  it("401, 403, 404, autre cabinet", async () => {
    expect((await api(ctx).get(urlD("/urgences"))).statusCode).toBe(401);
    expect((await api(ctx).post(urlD("/urgences"), { reponses: { T1: "oui" } })).statusCode).toBe(
      401,
    );
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect((await u.get(urlD("/urgences"))).statusCode).toBe(403);
      expect((await u.post(urlD("/urgences"), { reponses: { T1: "oui" } })).statusCode).toBe(403);
    }
    expect((await s.expert.post(urlD("/urgences"), { reponses: { T1: "oui" } })).statusCode).toBe(
      403,
    );
    expect((await s.consultantHors.get(urlD("/urgences"))).statusCode).toBe(404);
    expect(
      (await s.consultantHors.post(urlD("/urgences"), { reponses: { T1: "oui" } })).statusCode,
    ).toBe(404);
    expect((await s.b.associe.get(urlD("/urgences"))).statusCode).toBe(404);
    expect(
      (await s.b.associe.post(urlD("/urgences"), { reponses: { T1: "oui" } })).statusCode,
    ).toBe(404);
  });

  it("corps invalide : code inconnu, réponse hors liste, aucune réponse, champ inconnu (400)", async () => {
    for (const corps of [
      { reponses: { Z9: "oui" } },
      { reponses: { T1: "peut-être" } },
      { reponses: {} },
      { reponses: { T1: "oui" }, exces: 1 },
      { reponses: { T1: "oui" }, duree_secondes: 90_000 },
    ]) {
      expect(
        (await s.a.chef.post(urlD("/urgences"), corps)).statusCode,
        JSON.stringify(corps),
      ).toBe(400);
    }
  });

  it("U2 : T1 oui, T2 partiellement, T3 non : trésorerie 63 %, rouge ; le dossier passe en diagnostic", async () => {
    expect((await s.a.chef.get(`/api/redressement/dossiers/${dossierId}`)).json().statut).toBe(
      "ouvert",
    );
    const r = await s.consultantEquipe.post(urlD("/urgences"), {
      reponses: { T1: "oui", T2: "partiellement", T3: "non" },
      duree_secondes: 600,
      commentaire: "Entretien du lundi",
    });
    attendre(201, r, "urgence");
    const u = r.json();
    expect(u).toMatchObject({ grille_version: 1, voyant: "rouge", duree_secondes: 600 });
    expect(u.saisi_par.id).toBe(s.consultantEquipe.utilisateurId);
    const tresorerie = u.resultat.domaines.find(
      (d: { domaine: string }) => d.domaine === "tresorerie",
    );
    expect(tresorerie).toMatchObject({
      voyant: "rouge",
      pourcentage: 63,
      points_ponderes: 5,
      points_maximum: 8,
      poids_repondu: 4,
      poids_total: 4,
    });
    expect(u.resultat.domaines_rouges).toEqual(["tresorerie"]);
    expect(u.resultat.complet).toBe(false);
    expect(u.resultat.questions_repondues).toBe(3);
    const d = (await s.a.chef.get(`/api/redressement/dossiers/${dossierId}`)).json();
    expect(d.statut).toBe("diagnostic");
    expect(d.dernier_voyant_urgence).toBe("rouge");
    expect(d.urgence).toMatchObject({ id: u.id, voyant: "rouge" });
    expect(d.urgence.voyants_par_domaine.tresorerie).toBe("rouge");
    expect(d.urgence.voyants_par_domaine.activite).toBe("non_evalue");
  });

  it("U3 : T2 oui seulement : 25 %, orange (borne atteinte) ; historique paginé, plus récent d'abord", async () => {
    const r = await s.a.chef.post(urlD("/urgences"), {
      reponses: { T1: "non", T2: "oui", T3: "non" },
    });
    attendre(201, r, "urgence U3");
    expect(r.json().voyant).toBe("orange");
    const t = r
      .json()
      .resultat.domaines.find((d: { domaine: string }) => d.domaine === "tresorerie");
    expect(t).toMatchObject({ pourcentage: 25, voyant: "orange" });
    const liste = (await s.a.chef.get(urlD("/urgences?limite=1"))).json();
    expect(liste.elements).toHaveLength(1);
    expect(liste.elements[0].id).toBe(r.json().id);
    expect(liste.suivant).toBeTruthy();
    const page2 = (await s.a.chef.get(urlD(`/urgences?limite=1&curseur=${liste.suivant}`))).json();
    expect(page2.elements[0].voyant).toBe("rouge");
    expect(page2.suivant).toBeNull();
    expect((await s.a.chef.get(urlD("/urgences?limite=51"))).statusCode).toBe(400);
  });

  it("le journal ne contient ni réponse, ni commentaire", async () => {
    const j = await proprietaire((c) =>
      c.query("SELECT details::text AS d FROM journal_audit WHERE entite = 'red_urgence'"),
    );
    expect(j.rows.length).toBeGreaterThanOrEqual(2);
    for (const l of j.rows) {
      expect(l.d).not.toContain("Entretien");
      expect(l.d).not.toContain("oui");
    }
  });
});

describe("seuils d'alerte (routes 13 à 15)", () => {
  const defaut = seuilsVersJson(SEUILS_ALERTE_DEFAUT);
  const avecEndettement = (orange: number, rouge: number) => ({
    ...defaut,
    criteres: { ...defaut.criteres, endettement: { orange, rouge, poids: 10 } },
  });
  let v1: string;

  it("401, 403 : seuls les experts métier et associés rédigent ; lecture ouverte à redressement.lire", async () => {
    expect((await api(ctx).get("/api/redressement/seuils")).statusCode).toBe(401);
    expect(
      (await api(ctx).post("/api/redressement/seuils", { secteur: "industrie", seuils: defaut }))
        .statusCode,
    ).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect((await u.get("/api/redressement/seuils")).statusCode).toBe(403);
    }
    for (const u of [s.a.chef, s.a.directeur, s.consultantEquipe, s.gestionnaire]) {
      expect(
        (await u.post("/api/redressement/seuils", { secteur: "industrie", seuils: defaut }))
          .statusCode,
      ).toBe(403);
    }
    const lu = (await s.consultantHors.get("/api/redressement/seuils")).json();
    expect(lu.secteurs).toHaveLength(6);
    expect(
      lu.secteurs.every(
        (x: { en_vigueur: unknown; peut_publier: boolean }) =>
          x.en_vigueur === null && !x.peut_publier,
      ),
    ).toBe(true);
    expect(lu.defaut_moteur).toEqual(defaut);
    expect(
      (await s.a.chef.get("/api/redressement/seuils?secteur=btp")).json().secteurs,
    ).toHaveLength(1);
    expect((await s.a.chef.get("/api/redressement/seuils?secteur=mines")).statusCode).toBe(400);
  });

  it("rédaction : brouillon numéroté ; règles du moteur (somme des poids, sens) ; corps strict", async () => {
    const r = await s.expert.post("/api/redressement/seuils", {
      secteur: "industrie",
      seuils: avecEndettement(12_000, 25_000),
      motif: "Industrie lourde : endettement toléré plus haut",
    });
    attendre(201, r, "seuils");
    v1 = r.json().id;
    expect(r.json()).toMatchObject({
      secteur: "industrie",
      version: 1,
      statut: "brouillon",
      publiee_par: null,
    });
    // Somme des poids = 99 : refusée par `validerSeuilsAlerte`.
    const somme99 = {
      ...defaut,
      criteres: { ...defaut.criteres, endettement: { orange: 10_000, rouge: 20_000, poids: 9 } },
    };
    const invalide = await s.expert.post("/api/redressement/seuils", {
      secteur: "industrie",
      seuils: somme99,
    });
    expect(invalide.statusCode).toBe(400);
    expect(erreur(invalide)).toBe("RED_SEUILS_INVALIDES");
    // Sens : « haut pire » avec rouge < orange.
    const sens = await s.expert.post("/api/redressement/seuils", {
      secteur: "industrie",
      seuils: avecEndettement(20_000, 10_000),
    });
    expect(erreur(sens)).toBe("RED_SEUILS_INVALIDES");
    // Critère en trop, champ inconnu : 400 du schéma.
    expect(
      (
        await s.expert.post("/api/redressement/seuils", {
          secteur: "industrie",
          seuils: { ...defaut, exces: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.expert.post("/api/redressement/seuils", {
          secteur: "industrie",
          seuils: defaut,
          exces: 1,
        })
      ).statusCode,
    ).toBe(400);
    // Un brouillon n'est pas « en vigueur » ; il se voit comme brouillon.
    const lu = (await s.expert.get("/api/redressement/seuils?secteur=industrie")).json()
      .secteurs[0];
    expect(lu.en_vigueur).toBeNull();
    expect(lu.brouillon.id).toBe(v1);
    expect(lu.peut_publier).toBe(false);
    expect(
      (await s.expert2.get("/api/redressement/seuils?secteur=industrie")).json().secteurs[0]
        .peut_publier,
    ).toBe(true);
  });

  it("publication : l'auteur 403, un consultant 403, un autre expert 200 ; republier 409 ; autre cabinet 404", async () => {
    const url = (id: string) => `/api/redressement/seuils/${id}/publication`;
    expect((await api(ctx).post(url(v1), {})).statusCode).toBe(401);
    const auteur = await s.expert.post(url(v1), {});
    expect(auteur.statusCode).toBe(403);
    expect(erreur(auteur)).toBe("SEPARATION_DES_TACHES");
    expect((await s.consultantEquipe.post(url(v1), {})).statusCode).toBe(403);
    expect((await s.a.chef.post(url(v1), {})).statusCode).toBe(403);
    expect((await s.b.associe.post(url(v1), {})).statusCode).toBe(404);
    expect((await s.expert2.post(url(INCONNU), {})).statusCode).toBe(404);
    expect((await s.expert2.post(url(v1), { exces: 1 })).statusCode).toBe(400);
    const ok = await s.expert2.post(url(v1), {});
    attendre(200, ok, "publication");
    expect(ok.json()).toMatchObject({ statut: "publiee", version: 1 });
    expect(ok.json().publiee_par.id).toBe(s.expert2.utilisateurId);
    const bis = await s.expert2.post(url(v1), {});
    expect(bis.statusCode).toBe(409);
    expect(erreur(bis)).toBe("RED_SEUILS_NON_BROUILLON");
    const lu = (await s.consultantEquipe.get("/api/redressement/seuils?secteur=industrie")).json()
      .secteurs[0];
    expect(lu.en_vigueur.id).toBe(v1);
    expect(lu.en_vigueur.seuils).toEqual(avecEndettement(12_000, 25_000));
  });

  it("un seul brouillon par secteur (409) ; un associé auteur publie ; l'associé publie la version d'un expert", async () => {
    const url = (id: string) => `/api/redressement/seuils/${id}/publication`;
    const v2 = (
      await s.expert.post("/api/redressement/seuils", {
        secteur: "industrie",
        seuils: avecEndettement(11_000, 22_000),
      })
    ).json();
    expect(v2.version).toBe(2);
    // Tant que la dernière version est un brouillon, aucun autre brouillon du secteur (même par un autre expert).
    for (const par of [s.expert, s.expert2, s.associe2]) {
      const refus = await par.post("/api/redressement/seuils", {
        secteur: "industrie",
        seuils: avecEndettement(13_000, 23_000),
      });
      expect(refus.statusCode).toBe(409);
      expect(erreur(refus)).toBe("RED_SEUILS_BROUILLON_EN_COURS");
    }
    // Un autre secteur n'est pas touché.
    attendre(
      201,
      await s.expert.post("/api/redressement/seuils", { secteur: "agriculture", seuils: defaut }),
      "autre secteur",
    );
    attendre(200, await s.expert2.post(url(v2.id), {}), "publication v2");
    const v3 = (
      await s.expert.post("/api/redressement/seuils", {
        secteur: "industrie",
        seuils: avecEndettement(13_000, 23_000),
      })
    ).json();
    expect(v3.version).toBe(3);
    // Un associé publie les seuils qu'il a lui-même rédigés (dispense de l'associé).
    const propre = (
      await s.associe2.post("/api/redressement/seuils", { secteur: "services", seuils: defaut })
    ).json();
    const publie = await s.associe2.post(url(propre.id), {});
    attendre(200, publie, "associé auteur");
    expect(publie.json().statut).toBe("publiee");
    // L'associé publie aussi la v3 de l'expert.
    expect((await s.a.associe.post(url(v3.id), {})).statusCode).toBe(200);
    // Autre cabinet : aucun secteur publié.
    const b = (await s.b.associe.get("/api/redressement/seuils?secteur=industrie")).json()
      .secteurs[0];
    expect(b.en_vigueur).toBeNull();
    expect(b.historique).toHaveLength(0);
  });
});

describe("scores d'alerte (routes 16 et 17)", () => {
  const incidentsNuls = {
    incidents: {
      rejets_bancaires_12m: 0,
      retards_fournisseurs_90j: 0,
      arrieres_fiscaux_sociaux: false,
    },
  };
  let premier: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("401, 403, 404, autre cabinet", async () => {
    expect((await api(ctx).get(urlD("/scores"))).statusCode).toBe(401);
    expect((await api(ctx).post(urlD("/scores"), {})).statusCode).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne, s.expert]) {
      expect((await u.post(urlD("/scores"), {})).statusCode).toBe(403);
    }
    expect((await s.consultantHors.get(urlD("/scores"))).statusCode).toBe(404);
    expect((await s.consultantHors.post(urlD("/scores"), {})).statusCode).toBe(404);
    expect((await s.b.associe.post(urlD("/scores"), {})).statusCode).toBe(404);
    expect(
      (await s.a.chef.post(urlD("/scores"), { incidents: { rejets_bancaires_12m: 1000 } }))
        .statusCode,
    ).toBe(400);
    expect((await s.a.chef.post(urlD("/scores"), { exces: 1 })).statusCode).toBe(400);
  });

  it("S1 : seuils par défaut du moteur : 55 points sur 100 de poids, score 28, niveau modéré, indicatif", async () => {
    const r = await s.a.chef.post(urlD("/scores"), incidentsNuls);
    attendre(201, r, "score S1");
    premier = r.json();
    expect(premier).toMatchObject({
      secteur: "general",
      seuils_source: "defaut_moteur",
      seuils_version_id: null,
      seuils_version: null,
      version_moteur: 1,
      score: 28,
      niveau: "modere",
    });
    expect(premier.seuils).toEqual(seuilsVersJson(SEUILS_ALERTE_DEFAUT));
    const statuts = Object.fromEntries(
      premier.resultat.criteres.map((c: { critere: string; statut: string }) => [
        c.critere,
        c.statut,
      ]),
    );
    expect(statuts).toEqual({
      liquidite_generale: "vert",
      liquidite_immediate: "orange",
      autonomie_financiere: "orange",
      endettement: "orange",
      couverture_charges_financieres: "orange",
      marge_nette: "orange",
      bfr_jours: "vert",
      croissance_ca: "vert",
      variation_marge_brute: "orange",
      rejets_bancaires_12m: "vert",
      retards_fournisseurs_90j: "vert",
      arrieres_fiscaux_sociaux: "vert",
    });
    expect(premier.resultat).toMatchObject({
      points_ponderes: 55,
      poids_evalue: 100,
      poids_total: 100,
    });
    // Entrées conservées : ratios du dernier exercice accepté, tendances, incidents.
    expect(premier.entrees).toMatchObject({
      exercice_reference: 2025,
      correspondance_version: 1,
      devise: "XOF",
      tendances: { croissance_ca_pb: 2000, variation_marge_brute_pb: -300, raison: null },
      incidents: {
        rejets_bancaires_12m: 0,
        retards_fournisseurs_90j: 0,
        arrieres_fiscaux_sociaux: false,
      },
    });
    expect(premier.entrees.ratios.ratios.liquidite_generale.valeur).toBe(13636);
    expect(typeof premier.entrees.analyses_indicatives).toBe("boolean");
    // Rejeu à l'identique par le moteur.
    const rejoue = vueScoreAlerte(
      calculerScoreAlerte(
        entreesAlerteDepuisVue(premier.entrees),
        seuilsDepuisJson(premier.seuils),
      ),
    );
    expect(rejoue).toEqual(premier.resultat);
  });

  it("incidents non renseignés : critères « non évalués », score sur le poids évalué ; S5 : incidents graves 40", async () => {
    const sans = (await s.a.chef.post(urlD("/scores"), {})).json();
    expect(sans.resultat.poids_evalue).toBe(85);
    expect(sans.score).toBe(32);
    const incidents = sans.resultat.criteres.filter(
      (c: { motif: string | null }) => c.motif === "non_renseigne",
    );
    expect(incidents).toHaveLength(3);
    const s5 = (
      await s.a.chef.post(urlD("/scores"), {
        incidents: {
          rejets_bancaires_12m: 3,
          retards_fournisseurs_90j: 1,
          arrieres_fiscaux_sociaux: true,
        },
      })
    ).json();
    expect(s5).toMatchObject({ score: 40, niveau: "modere" });
    expect(s5.resultat.points_ponderes).toBe(80);
  });

  it("seuils publiés du secteur : score avec les seuils du cabinet ; l'instantané égale la version ; l'ancien score ne change pas", async () => {
    const seuils = (await s.expert.get("/api/redressement/seuils?secteur=general")).json()
      .secteurs[0];
    expect(seuils.en_vigueur).toBeNull();
    const nouveaux = {
      ...seuilsVersJson(SEUILS_ALERTE_DEFAUT),
      criteres: {
        ...seuilsVersJson(SEUILS_ALERTE_DEFAUT).criteres,
        endettement: { orange: 14_000, rouge: 20_000, poids: 10 },
      },
    };
    const brouillon = (
      await s.expert.post("/api/redressement/seuils", { secteur: "general", seuils: nouveaux })
    ).json();
    // Brouillon : les scores utilisent encore les seuils du moteur.
    const avant = (await s.a.chef.post(urlD("/scores"), incidentsNuls)).json();
    expect(avant.seuils_source).toBe("defaut_moteur");
    attendre(
      200,
      await s.expert2.post(`/api/redressement/seuils/${brouillon.id}/publication`, {}),
      "publication",
    );
    const apres = (await s.a.chef.post(urlD("/scores"), incidentsNuls)).json();
    expect(apres).toMatchObject({
      seuils_source: "cabinet",
      seuils_version_id: brouillon.id,
      seuils_version: 1,
    });
    // Endettement 13 333 ≤ 14 000 : vert (il était orange) → 45 points → 22,5 → 23, niveau faible.
    expect(
      apres.resultat.criteres.find((c: { critere: string }) => c.critere === "endettement").statut,
    ).toBe("vert");
    expect(apres).toMatchObject({ score: 23, niveau: "faible" });
    // Instantané des seuils == version publiée.
    const publie = (await s.a.chef.get("/api/redressement/seuils?secteur=general")).json()
      .secteurs[0].en_vigueur;
    expect(apres.seuils).toEqual(publie.seuils);
    // L'ancien score est inchangé (il garde son instantané).
    const liste = (await s.a.chef.get(urlD("/scores?limite=50"))).json().elements;
    const ancien = liste.find((x: { id: string }) => x.id === premier.id);
    expect(ancien).toMatchObject({ score: 28, seuils_source: "defaut_moteur" });
    expect(ancien.seuils).toEqual(premier.seuils);
    // Rejeu à l'identique avec les seuils du cabinet.
    const rejoue = vueScoreAlerte(
      calculerScoreAlerte(entreesAlerteDepuisVue(apres.entrees), seuilsDepuisJson(apres.seuils)),
    );
    expect(rejoue).toEqual(apres.resultat);
  });

  it("secteur modifié : le nouveau score suit le nouveau secteur, l'ancien score n'est pas touché", async () => {
    attendre(
      200,
      await s.a.chef.patch(`/api/redressement/dossiers/${dossierId}`, { secteur: "btp" }),
      "secteur",
    );
    const r = (await s.a.chef.post(urlD("/scores"), incidentsNuls)).json();
    // Aucun seuil publié pour le BTP : valeurs par défaut du moteur.
    expect(r).toMatchObject({ secteur: "btp", seuils_source: "defaut_moteur", score: 28 });
    const tous = (await s.a.chef.get(urlD("/scores?limite=50"))).json().elements;
    expect(
      tous.filter((x: { secteur: string }) => x.secteur === "general").length,
    ).toBeGreaterThanOrEqual(4);
    const d = (await s.a.chef.get(`/api/redressement/dossiers/${dossierId}`)).json();
    expect(d).toMatchObject({ dernier_niveau_alerte: "modere", dernier_score: 28 });
    expect(d.alerte).toMatchObject({
      id: r.id,
      seuils_source: "defaut_moteur",
      seuils_version: null,
    });
  });

  it("données insuffisantes : score nul, niveau « insuffisant », conservé", async () => {
    const c = await s.a.associe.post("/api/clients", {
      raison_sociale: "Client sans états (fictif)",
    });
    attendre(201, c, "client");
    const m = await creerMission(s.a, { intitule: "Client sans états", client_id: c.json().id });
    const d = await ouvrirDossierRed(s, m.id);
    const r = await s.a.chef.post(`/api/redressement/dossiers/${d.id}/scores`, incidentsNuls);
    attendre(201, r, "score insuffisant");
    expect(r.json()).toMatchObject({ score: null, niveau: "insuffisant" });
    expect(r.json().entrees.ratios).toBeNull();
    const liste = (await s.a.chef.get(`/api/redressement/dossiers/${d.id}/scores`)).json();
    expect(liste.elements).toHaveLength(1);
    expect(liste.elements[0].niveau).toBe("insuffisant");
    // Le premier score ou la première urgence fait passer le dossier en « diagnostic ».
    expect((await s.a.chef.get(`/api/redressement/dossiers/${d.id}`)).json().statut).toBe(
      "diagnostic",
    );
  });

  it("le journal d'un score ne porte ni ratio ni montant", async () => {
    const j = await proprietaire((c) =>
      c.query(
        "SELECT details FROM journal_audit WHERE entite = 'red_score' AND action = 'score' LIMIT 1",
      ),
    );
    expect(Object.keys(j.rows[0].details).sort()).toEqual(
      ["dossier_id", "niveau", "score", "seuils_source", "seuils_version"].sort(),
    );
  });
});

describe("plafonds de débit (429)", () => {
  it("30 évaluations d'urgence et 30 scores par utilisateur et par 10 minutes", async () => {
    const d = await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Débit" })).id);
    const u = s.associe2;
    for (let i = 0; i < 30; i += 1) {
      attendre(
        201,
        await u.post(`/api/redressement/dossiers/${d.id}/urgences`, { reponses: { T1: "non" } }),
        `urgence ${i}`,
      );
    }
    const trop = await u.post(`/api/redressement/dossiers/${d.id}/urgences`, {
      reponses: { T1: "non" },
    });
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_D_EVALUATIONS");
    // Un autre utilisateur n'est pas touché ; la limite des scores est distincte.
    attendre(
      201,
      await s.a.chef.post(`/api/redressement/dossiers/${d.id}/urgences`, {
        reponses: { T1: "non" },
      }),
      "chef",
    );
    for (let i = 0; i < 30; i += 1) {
      attendre(201, await u.post(`/api/redressement/dossiers/${d.id}/scores`, {}), `score ${i}`);
    }
    const tropScores = await u.post(`/api/redressement/dossiers/${d.id}/scores`, {});
    expect(tropScores.statusCode).toBe(429);
    expect(erreur(tropScores)).toBe("RED_TROP_DE_SCORES");
  });
});
