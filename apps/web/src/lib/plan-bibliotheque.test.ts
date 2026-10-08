import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminBibliothequePlan,
  cheminDepuisBibliotheque,
  cheminInitiativeType,
  cheminObservations,
  cheminPageBibliotheque,
  cheminVersionsInitiativeType,
  hrefBibliothequePlan,
  libelleDuree,
  libelleEfficacite,
  libelleOrigine,
  libelleRisque,
  messageBibliotheque,
  SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE,
  SAISIE_INITIATIVE_TYPE_VIDE,
  SAISIE_OBSERVATION_VIDE,
  saisieDepuisInitiative,
  validerDepuisBibliotheque,
  validerInitiativeType,
  validerObservation,
  type InitiativeType,
} from "./plan-bibliotheque";

const type: InitiativeType = {
  id: "t1",
  code: "formation",
  origine: "standard",
  standard_id: null,
  version: 1,
  titre: "Formation",
  description: null,
  perspective: null,
  prerequis: ["A", "B"],
  risques: [{ libelle: "Absences", niveau: "moyen" }],
  cout_min: 100,
  cout_type: 200,
  cout_max: 300,
  devise: "EUR",
  duree_type_jours: 90,
  charge_type_jours: null,
  retire: false,
  efficacite: { niveaux: [], retenue: null, seuil: 3 },
};

describe("libellés", () => {
  it("origine, efficacité, risque, durée", () => {
    expect(libelleOrigine("variante")).toBe("Variante du cabinet");
    expect(libelleOrigine("x")).toBe("Origine inconnue");
    expect(
      libelleEfficacite({
        niveaux: [
          { niveau: "global", observations: 2, moyenne: 50, mediane: 50, minimum: 40, maximum: 60 },
        ],
        retenue: null,
        seuil: 3,
      }),
    ).toBe("Échantillon insuffisant (2 observations, 3 requises)");
    expect(libelleEfficacite({ niveaux: [], retenue: null, seuil: 3 })).toBe(
      "Échantillon insuffisant (0 observation, 3 requises)",
    );
    const r = {
      niveau: "secteur" as const,
      observations: 4,
      moyenne: 63,
      mediane: 66,
      minimum: 40,
      maximum: 80,
    };
    expect(libelleEfficacite({ niveaux: [r], retenue: r, seuil: 3 })).toBe(
      "63/100 en moyenne (4 observations, même secteur)",
    );
    expect(libelleRisque({ libelle: "Retard", niveau: "eleve" })).toBe("Retard (Élevé)");
    expect(libelleDuree(1)).toBe("1 jour");
    expect(libelleDuree(90)).toBe("90 jours");
  });
});

describe("création depuis la bibliothèque", () => {
  it("corps minimal : l'API reprend coût type et échéance du moteur", () => {
    const r = validerDepuisBibliotheque(
      { id: "t1", devise: "XOF" },
      { ...SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE, parent_id: "axe", debut: "2027-01-01" },
      "XOF",
    );
    expect(r.corps).toEqual({ initiative_type_id: "t1", parent_id: "axe", debut: "2027-01-01" });
  });

  it("surcharges et refus (devise différente sans budget, dates)", () => {
    const ok = validerDepuisBibliotheque(
      type,
      {
        parent_id: "axe",
        debut: "2027-01-01",
        echeance: "2027-06-30",
        budget: "1 500,50",
        titre: " Formation ",
        responsable_id: "u1",
      },
      "EUR",
    );
    expect(ok.corps).toMatchObject({ budget: 150_050, titre: "Formation", responsable_id: "u1" });
    const refus = validerDepuisBibliotheque(
      type,
      { ...SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE, echeance: "x" },
      "XOF",
    );
    expect(Object.keys(refus.erreurs).sort()).toEqual(["budget", "debut", "echeance", "parent_id"]);
    const ordre = validerDepuisBibliotheque(
      { id: "t", devise: "XOF" },
      {
        ...SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE,
        parent_id: "a",
        debut: "2027-02-01",
        echeance: "2027-01-01",
        budget: "abc",
      },
      "XOF",
    );
    expect(ordre.erreurs).toMatchObject({
      echeance: "L'échéance doit suivre le début.",
      budget: "Montant invalide.",
    });
    expect(
      validerDepuisBibliotheque(
        { id: "t", devise: "XOF" },
        {
          ...SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE,
          parent_id: "a",
          debut: "2027-02-01",
          titre: "x".repeat(201),
        },
        "XOF",
      ).erreurs.titre,
    ).toBeDefined();
  });
});

describe("initiative type du cabinet", () => {
  it("construit le contenu (prérequis, risques, coûts en unités mineures)", () => {
    const r = validerInitiativeType(
      {
        ...SAISIE_INITIATIVE_TYPE_VIDE,
        code: "comite",
        titre: "Comité",
        prerequis: "Cartographie ; Charte\nBudget",
        risques: "Façade ; élevé\nRetard",
        cout_min: "1 000",
        cout_type: "2 000",
        cout_max: "3 000",
        duree_type_jours: "60",
        charge_type_jours: "12",
      },
      true,
    );
    expect(r.donnees).toEqual({
      titre: "Comité",
      description: null,
      prerequis: ["Cartographie", "Charte", "Budget"],
      risques: [
        { libelle: "Façade", niveau: "eleve" },
        { libelle: "Retard", niveau: "moyen" },
      ],
      cout_min: 1000,
      cout_type: 2000,
      cout_max: 3000,
      devise: "XOF",
      duree_type_jours: 60,
      charge_type_jours: 12,
    });
  });

  it("refuse code, coûts désordonnés, durée, charge et risques invalides", () => {
    const r = validerInitiativeType(
      {
        ...SAISIE_INITIATIVE_TYPE_VIDE,
        code: "Pas Valide",
        cout_min: "3",
        cout_type: "2",
        cout_max: "1",
        duree_type_jours: "0",
        charge_type_jours: "1,5",
        risques: "Sans niveau connu ; critique",
      },
      true,
    );
    expect(Object.keys(r.erreurs).sort()).toEqual([
      "charge_type_jours",
      "code",
      "cout_type",
      "duree_type_jours",
      "risques",
      "titre",
    ]);
    const sansCout = validerInitiativeType(
      { ...SAISIE_INITIATIVE_TYPE_VIDE, titre: "T", duree_type_jours: "5" },
      false,
    );
    expect(Object.keys(sansCout.erreurs).sort()).toEqual(["cout_max", "cout_min", "cout_type"]);
    const trop = validerInitiativeType(
      {
        ...SAISIE_INITIATIVE_TYPE_VIDE,
        titre: "T",
        cout_min: "1",
        cout_type: "1",
        cout_max: "1",
        duree_type_jours: "5",
        prerequis: Array.from({ length: 21 }, (_, i) => `P${i}`).join("\n"),
      },
      false,
    );
    expect(trop.erreurs.prerequis).toBeDefined();
  });

  it("préremplit depuis une initiative existante", () => {
    expect(saisieDepuisInitiative(type)).toMatchObject({
      code: "formation",
      prerequis: "A\nB",
      risques: "Absences ; moyen",
      cout_min: "1",
      cout_type: "2",
      cout_max: "3",
      duree_type_jours: "90",
      charge_type_jours: "",
    });
  });
});

describe("observation et messages", () => {
  it("valide une observation d'efficacité", () => {
    expect(
      validerObservation({
        ...SAISIE_OBSERVATION_VIDE,
        efficacite: "70",
        pays: "ci",
        taille: "pme",
      }).corps,
    ).toEqual({
      efficacite: 70,
      secteur: null,
      taille: "pme",
      pays: "CI",
      commentaire: null,
    });
    expect(
      Object.keys(
        validerObservation({
          ...SAISIE_OBSERVATION_VIDE,
          efficacite: "101",
          pays: "CIV",
          secteur: "x".repeat(81),
        }).erreurs,
      ).sort(),
    ).toEqual(["efficacite", "pays", "secteur"]);
  });

  it("traduit les refus et construit les chemins", () => {
    expect(messageBibliotheque(new ErreurApi("INTERDIT", "x", 403))).toContain("experts métier");
    expect(messageBibliotheque(new ErreurApi("INTROUVABLE", "x", 404))).toContain("introuvable");
    expect(messageBibliotheque(new ErreurApi("STANDARD_IMMUABLE", "Standard.", 409))).toBe(
      "Standard.",
    );
    expect(messageBibliotheque(new ErreurApi("DEVISE_DIFFERENTE", "Devise.", 400))).toBe("Devise.");
    expect(hrefBibliothequePlan("m", "p")).toBe("/missions/m/plan/p/bibliotheque");
    expect(cheminPageBibliotheque()).toBe("/api/bibliotheque-initiatives?limite=30");
    expect(cheminPageBibliotheque("abc", 10)).toBe(
      "/api/bibliotheque-initiatives?limite=10&curseur=abc",
    );
    expect(cheminInitiativeType("t")).toBe("/api/bibliotheque-initiatives/t");
    expect(cheminVersionsInitiativeType("t")).toBe("/api/bibliotheque-initiatives/t/versions");
    expect(cheminObservations("t")).toBe("/api/bibliotheque-initiatives/t/observations");
    expect(cheminBibliothequePlan("p")).toBe("/api/plans/p/bibliotheque?limite=100");
    expect(cheminBibliothequePlan("p", "c")).toBe("/api/plans/p/bibliotheque?limite=100&curseur=c");
    expect(cheminDepuisBibliotheque("p")).toBe("/api/plans/p/initiatives/depuis-bibliotheque");
  });
});
