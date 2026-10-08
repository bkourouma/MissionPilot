import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminControle,
  cheminContradictions,
  droitsPreuves,
  etatDimension,
  etatPreuvesChange,
  expliquerSolidite,
  formaterCentiemes,
  formaterIndice,
  formaterSeuil,
  hrefAssertion,
  hrefAssertionsFiltre,
  hrefPreuve,
  hrefRegistreFiltre,
  libelleAuteur,
  libelleDimension,
  lireParametresAssertions,
  lireParametresRegistre,
  matriceTriangulation,
  messagePreuves,
  requeteAssertions,
  requeteRegistre,
  sousPagesPreuves,
  TONALITE_LECTURE,
  type CarteTriangulationVue,
  type SoliditeVue,
} from "./preuves";

const SOLIDITE: SoliditeVue = {
  indice: 0.875,
  numerateur: 175,
  denominateur: 200,
  lecture: "solide",
  fiabilites_retenues: [
    { type_source: "entretien", fiabilite: "B", poids_centiemes: 75 },
    { type_source: "document", fiabilite: "A", poids_centiemes: 100 },
  ],
  somme_centiemes: 175,
  plafonnee: false,
  contradiction_non_resolue: false,
  preuves_pour: 2,
  preuves_contre: 0,
  plafond_centiemes: 200,
  seuil_solide: 7500,
  seuil_etayee: 5000,
};

describe("mise en forme des valeurs du moteur", () => {
  it("affiche l'indice, les centièmes et les seuils sans les recalculer", () => {
    expect(formaterIndice(0.875)).toBe("0,875");
    expect(formaterIndice(1)).toBe("1");
    expect(formaterIndice(0.4375)).toBe("0,4375");
    expect(formaterIndice(null)).toBe("—");
    expect(formaterCentiemes(75)).toBe("0,75");
    expect(formaterCentiemes(200)).toBe("2");
    expect(formaterCentiemes(undefined)).toBe("—");
    expect(formaterSeuil(7500)).toBe("0,75");
    expect(formaterSeuil(5000)).toBe("0,5");
  });

  it("la tonalité suit la lecture du moteur", () => {
    expect(TONALITE_LECTURE).toEqual({ solide: "succes", etayee: "attention", fragile: "danger" });
  });
});

describe("explication de la solidité", () => {
  it("cite les sources retenues, la somme, l'indice et les seuils", () => {
    const t = expliquerSolidite(SOLIDITE).join("\n");
    expect(t).toContain("entretien (B, 0,75)");
    expect(t).toContain("document (A, 1)");
    expect(t).toContain("Somme 1,75 (plafond 2)");
    expect(t).toContain("Indice : 1,75 sur 2, soit 0,875");
    expect(t).toContain("solide à partir de 0,75");
  });

  it("signale le plafond, la contradiction non arbitrée et les preuves contraires arbitrées", () => {
    const plafonnee = expliquerSolidite({ ...SOLIDITE, somme_centiemes: 300, plafonnee: true });
    expect(plafonnee.join(" ")).toContain("plafonnée à 2");
    const ouverte = expliquerSolidite({
      ...SOLIDITE,
      contradiction_non_resolue: true,
      preuves_contre: 1,
      denominateur: 400,
    });
    expect(ouverte.join(" ")).toContain("divisé par deux");
    const arbitree = expliquerSolidite({ ...SOLIDITE, preuves_contre: 1 });
    expect(arbitree.join(" ")).toContain("arbitrées par le consultant");
  });

  it("sans preuve : indice nul expliqué", () => {
    const t = expliquerSolidite({
      ...SOLIDITE,
      indice: 0,
      numerateur: 0,
      fiabilites_retenues: [],
      somme_centiemes: 0,
      preuves_pour: 0,
      lecture: "fragile",
    });
    expect(t[0]).toContain("Aucune preuve");
    expect(t.join(" ")).toContain("Indice : 0 sur 2, soit 0");
  });
});

describe("carte de triangulation", () => {
  const carte: CarteTriangulationVue = {
    dimensions: [
      {
        code: "finance",
        libelle: "Finance",
        types_couverts: ["entretien", "document"],
        types_manquants: ["questionnaire"],
        preuves: 2,
        couverte: true,
        triangulee: true,
      },
      {
        code: "rh",
        libelle: "RH",
        types_couverts: [],
        types_manquants: ["questionnaire", "entretien"],
        preuves: 0,
        couverte: false,
        triangulee: false,
      },
    ],
    cellules: [
      { dimension: "finance", type_source: "questionnaire", preuves: 0, meilleure_fiabilite: null },
      { dimension: "finance", type_source: "entretien", preuves: 1, meilleure_fiabilite: "B" },
      { dimension: "rh", type_source: "questionnaire", preuves: 0, meilleure_fiabilite: null },
      { dimension: "rh", type_source: "entretien", preuves: 0, meilleure_fiabilite: null },
    ],
    zones_non_couvertes: [
      { dimension: "finance", type_source: "questionnaire" },
      { dimension: "rh", type_source: "questionnaire" },
      { dimension: "rh", type_source: "entretien" },
    ],
    dimensions_non_couvertes: ["rh"],
    dimensions_sous_triangulees: [],
    rattachements_inconnus: [],
    preuves_ecartees: [],
  };

  it("range les cellules par dimension et par type de source", () => {
    const m = matriceTriangulation(carte);
    expect(m.types).toEqual(["questionnaire", "entretien"]);
    expect(m.lignes[0]?.cellules).toEqual([
      { type_source: "questionnaire", preuves: 0, meilleure_fiabilite: null, non_couverte: true },
      { type_source: "entretien", preuves: 1, meilleure_fiabilite: "B", non_couverte: false },
    ]);
    expect(m.lignes[1]?.cellules.every((c) => c.non_couverte)).toBe(true);
  });

  it("l'état d'une dimension est toujours écrit", () => {
    expect(etatDimension({ couverte: false, triangulee: false })).toEqual({
      libelle: "Non couverte",
      tonalite: "danger",
    });
    expect(etatDimension({ couverte: true, triangulee: false }).libelle).toBe("Une seule source");
    expect(etatDimension({ couverte: true, triangulee: true }).tonalite).toBe("succes");
  });
});

describe("chemins, droits et libellés", () => {
  it("construit les chemins et les liens", () => {
    expect(cheminContradictions("m1")).toBe("/api/missions/m1/preuves/contradictions");
    expect(cheminContradictions("m1", true)).toBe(
      "/api/missions/m1/preuves/contradictions?resolues=oui",
    );
    expect(cheminControle("m1")).toBe("/api/missions/m1/preuves/controle");
    expect(cheminControle("m1", "Rapport final")).toBe(
      "/api/missions/m1/preuves/controle?livrable=Rapport%20final",
    );
    expect(hrefPreuve("m1", "p1")).toBe("/missions/m1/preuves/p1");
    expect(hrefAssertion("m1", "a1")).toBe("/missions/m1/preuves/assertions/a1");
    expect(sousPagesPreuves("m1").map((p) => p.id)).toEqual([
      "registre",
      "assertions",
      "triangulation",
      "contradictions",
    ]);
  });

  it("écrire exige la permission et une mission ouverte", () => {
    expect(droitsPreuves(["consultant"], { statut: "en_cours" })).toEqual({
      lire: true,
      ecrire: true,
    });
    expect(droitsPreuves(["consultant"], { statut: "cloturee" })).toEqual({
      lire: true,
      ecrire: false,
    });
    expect(droitsPreuves(["expert_metier"], { statut: "en_cours" })).toEqual({
      lire: true,
      ecrire: false,
    });
    expect(droitsPreuves(["gestionnaire"], { statut: "en_cours" })).toEqual({
      lire: false,
      ecrire: false,
    });
  });

  it("libellés de repli", () => {
    expect(libelleDimension("finance", [{ code: "finance", libelle: "Finance" }])).toBe("Finance");
    expect(libelleDimension("ancienne", [])).toBe("ancienne");
    expect(libelleAuteur({ nom: "Awa" })).toBe("Awa");
    expect(libelleAuteur(null)).toBe("Utilisateur supprimé");
  });
});

describe("messages d'erreur", () => {
  it("traduit les codes du registre, garde les conflits explicites", () => {
    expect(messagePreuves(new ErreurApi("MISSION_CLOTUREE", "x", 409))).toContain("clôturée");
    expect(messagePreuves(new ErreurApi("ARBITRAGE_INVALIDE", "x", 409))).toContain("Rechargez");
    expect(messagePreuves(new ErreurApi("INTROUVABLE", "x", 404))).toContain("n'existe plus");
    expect(messagePreuves(new ErreurApi("CONFLIT", "Cette preuve est déjà liée.", 409))).toBe(
      "Cette preuve est déjà liée.",
    );
    expect(messagePreuves(new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400))).not.toBe(
      "Données invalides.",
    );
  });

  it("un écran périmé (404, 409) se rafraîchit", () => {
    expect(etatPreuvesChange(new ErreurApi("CONFLIT", "x", 409))).toBe(true);
    expect(etatPreuvesChange(new ErreurApi("INTROUVABLE", "x", 404))).toBe(true);
    expect(etatPreuvesChange(new ErreurApi("ERREUR", "x", 500))).toBe(false);
    expect(etatPreuvesChange(new Error("x"))).toBe(false);
  });
});

describe("paramètres d'URL des listes", () => {
  it("écarte les valeurs inconnues et borne les textes", () => {
    expect(
      lireParametresRegistre({
        q: "  trésorerie  ",
        type_source: "rumeur",
        fiabilite: "B",
        dimension: "Finance Haute",
        curseur: "abc",
      }),
    ).toEqual({ q: "trésorerie", fiabilite: "B", curseur: "abc" });
    expect(
      lireParametresRegistre({ type_source: ["entretien", "document"], dimension: "finance" }),
    ).toEqual({
      type_source: "entretien",
      dimension: "finance",
    });
    expect(lireParametresRegistre({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(lireParametresRegistre({})).toEqual({});
  });

  it("sérialise la requête de l'API et les liens de pagination", () => {
    expect(requeteRegistre({ q: "a b", fiabilite: "A" })).toBe("q=a+b&fiabilite=A&limite=30");
    expect(hrefRegistreFiltre("m1", { fiabilite: "A", curseur: "ancien" }, "suite")).toBe(
      "/missions/m1/preuves?fiabilite=A&curseur=suite",
    );
    expect(hrefRegistreFiltre("m1", { fiabilite: "A", curseur: "ancien" }, null)).toBe(
      "/missions/m1/preuves?fiabilite=A",
    );
    expect(hrefRegistreFiltre("m1", {}, null)).toBe("/missions/m1/preuves");
  });

  it("assertions : statut et classe de risque validés", () => {
    expect(lireParametresAssertions({ statut: "retenue", classe_risque: "R9", q: "x" })).toEqual({
      statut: "retenue",
      q: "x",
    });
    expect(requeteAssertions({ classe_risque: "R3" })).toBe("classe_risque=R3&limite=30");
    expect(hrefAssertionsFiltre("m1", { statut: "retenue" }, "c2")).toBe(
      "/missions/m1/preuves/assertions?statut=retenue&curseur=c2",
    );
  });
});
