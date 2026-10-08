import { describe, expect, it } from "vitest";
import {
  alertesDerive,
  DEFINITIONS,
  formaterEcartJours,
  indicateursAffiches,
  LIBELLE_CARNET_FACTURE,
  lireCarnet,
  lireFiltresIndicateurs,
  MESSAGE_RESERVE,
  requeteIndicateurs,
  statutConsommation,
  statutDelai,
  statutEcart,
  statutMarge,
  statutOccupation,
  type ElementMission,
  type IndicateursCabinet,
  type ReponseIndicateurs,
} from "./indicateurs";

const ratio = (reussis: number, attendus: number) => ({
  reussis,
  attendus,
  taux: attendus === 0 ? null : reussis / attendus,
});

/** Réponse sans aucun droit financier : les champs monétaires sont ABSENTS. */
const cabinetSansFinance: IndicateursCabinet = {
  jours_disponibles: 200,
  jours_affectes: 150,
  taux_occupation: 0.75,
  jours_facturables: 120,
  taux_facturabilite: 0.6,
  discipline_saisie: ratio(9, 10),
  nombre_missions: 3,
  jours_budget: 100,
  jours_realises: 80,
  jours_atterrissage: 110,
  consommation_budgetaire: 0.8,
  ecart_terminaison: { jours: 10, relatif_jours: 0.1 },
  respect_jalons: ratio(3, 4),
  delai_moyen_encaissement: 38.5,
  factures_soldees: 2,
};

const reponse = (cabinet: IndicateursCabinet, finance = false): ReponseIndicateurs => ({
  du: "2027-03-01",
  au: "2027-03-31",
  date_reference: "2027-03-31",
  niveau: "cabinet",
  devise: "XOF",
  droits: { finance, montants: finance },
  cabinet,
  elements: [],
});

describe("définitions du PRD", () => {
  it("couvre les onze indicateurs, dans l'ordre de la table", () => {
    expect(DEFINITIONS.map((d) => d.libelle)).toEqual([
      "Taux d'occupation",
      "Taux de facturabilité",
      "Consommation budgétaire",
      "Écart à terminaison",
      "Marge de mission",
      "Taux de réalisation",
      "Encours de production",
      "Délai moyen d'encaissement",
      "Carnet de commandes",
      "Respect des jalons",
      "Discipline de saisie",
    ]);
  });
});

describe("masquage financier par champ absent", () => {
  it("n'affiche aucune valeur pour marge, réalisation, encours et carnet sans droit", () => {
    const liste = indicateursAffiches(reponse(cabinetSansFinance));
    const absents = liste.filter((i) => !i.present).map((i) => i.definition.id);
    expect(absents).toEqual(["marge", "realisation", "encours", "carnet"]);
    for (const i of liste.filter((x) => !x.present)) {
      expect(i.valeur).toBe("");
      expect(i.detail).toBeNull();
    }
    // L'écart à terminaison reste en jours, sans montant.
    const ecart = liste.find((i) => i.definition.id === "ecart");
    expect(ecart?.detail).not.toMatch(/FCFA/);
    expect(MESSAGE_RESERVE).toBe("Réservé aux associés et gestionnaires.");
  });

  it("affiche les valeurs servies avec finance.lire, sans les recalculer", () => {
    const liste = indicateursAffiches(
      reponse(
        {
          ...cabinetSansFinance,
          ecart_terminaison: { jours: 10, relatif_jours: 0.1, couts_production: 2_500_000 },
          marge: {
            honoraires: 10_000_000,
            couts_internes: 6_000_000,
            debours_non_refactures: 0,
            sous_traitance: 0,
            marge: 4_000_000,
            taux_marge: 0.4,
          },
          taux_realisation: 0.92,
          encours: { encours_production: 1_200_000, facture_d_avance: 0 },
          carnet_commandes: 30_000_000,
        },
        true,
      ),
    );
    expect(liste.every((i) => i.present)).toBe(true);
    const parId = Object.fromEntries(liste.map((i) => [i.definition.id, i]));
    expect(parId.marge?.valeur).toBe("40 %");
    expect(parId.encours?.valeur).toBe("1 200 000 FCFA");
    expect(parId.carnet?.valeur).toBe("30 000 000 FCFA");
    expect(parId.ecart?.detail).toContain("2 500 000");
    expect(parId.delai?.valeur).toBe("38,5 j");
    expect(parId.jalons?.detail).toBe("3 sur 4");
  });

  it("affiche le carnet fondé sur le facturé, avec son libellé, sans finance.lire", () => {
    const liste = indicateursAffiches({
      ...reponse({ ...cabinetSansFinance, carnet_commandes_facture: 12_000_000 }),
      droits: { finance: false, montants: true },
    });
    const carnet = liste.find((i) => i.definition.id === "carnet");
    expect(carnet?.present).toBe(true);
    expect(carnet?.valeur).toBe("12 000 000 FCFA");
    expect(carnet?.detail).toBe(LIBELLE_CARNET_FACTURE);
    expect(lireCarnet({ carnet_commandes: 5, carnet_commandes_facture: 9 })?.base).toBe("produit");
    expect(lireCarnet({})).toBeNull();
  });

  it("donne un statut avec texte à chaque indicateur présent", () => {
    for (const i of indicateursAffiches(reponse(cabinetSansFinance)).filter((x) => x.present)) {
      expect(i.statut?.libelle).toBeTruthy();
    }
  });
});

describe("statuts de lecture", () => {
  it("classe l'occupation selon les seuils du plan de charge", () => {
    expect(statutOccupation(1.05).libelle).toBe("Surcharge");
    expect(statutOccupation(0.4).tonalite).toBe("attention");
    expect(statutOccupation(0.8).tonalite).toBe("succes");
    expect(statutOccupation(null).tonalite).toBe("neutre");
  });

  it("signale une dérive de plus de 5 % (parcours C)", () => {
    expect(statutEcart(0.06).tonalite).toBe("danger");
    expect(statutEcart(0.03).tonalite).toBe("attention");
    expect(statutEcart(0).tonalite).toBe("succes");
    expect(statutEcart(null, 2).tonalite).toBe("danger");
    expect(statutEcart(null, 0).tonalite).toBe("neutre");
  });

  it("classe consommation, marge et délai", () => {
    expect(statutConsommation(1.1).libelle).toBe("Budget dépassé");
    expect(statutConsommation(0.95).tonalite).toBe("attention");
    expect(statutMarge(-0.1).libelle).toBe("Marge négative");
    expect(statutMarge(0.1).tonalite).toBe("attention");
    expect(statutMarge(null, -5).tonalite).toBe("danger");
    expect(statutMarge(null, 0).tonalite).toBe("neutre");
    expect(statutDelai(30).tonalite).toBe("succes");
    expect(statutDelai(120).tonalite).toBe("danger");
  });
});

describe("alertes de dérive", () => {
  const mission = (id: string, jours: number, relatif: number | null): ElementMission => ({
    mission_id: id,
    intitule: `Mission ${id}`,
    client_id: "c",
    directeur_id: null,
    devise_mission: "XOF",
    nombre_missions: 1,
    jours_budget: 100,
    jours_realises: 50,
    jours_atterrissage: 100 + jours,
    consommation_budgetaire: 0.5,
    ecart_terminaison: { jours, relatif_jours: relatif },
    respect_jalons: ratio(0, 0),
  });

  it("ne garde que les missions dont l'atterrissage dépasse le budget, pires d'abord", () => {
    const a = alertesDerive([
      mission("a", 3, 0.03),
      mission("b", -5, -0.05),
      mission("c", 12, 0.12),
      mission("d", 0, 0),
    ]);
    expect(a.map((x) => x.mission_id)).toEqual(["c", "a"]);
    expect(a[0]?.statut.tonalite).toBe("danger");
    expect(a[1]?.statut.tonalite).toBe("attention");
  });
});

describe("format et filtres", () => {
  it("met en forme un écart signé", () => {
    expect(formaterEcartJours(3, 0.1)).toBe("+3 j (+10 %)");
    expect(formaterEcartJours(-2.5, null)).toBe("−2,5 j");
  });

  it("lit la période et le niveau, mois en cours par défaut", () => {
    expect(lireFiltresIndicateurs({}, "2027-03-15")).toEqual({
      du: "2027-03-01",
      au: "2027-03-15",
      niveau: "cabinet",
      corrigee: false,
    });
    const f = lireFiltresIndicateurs(
      { du: "2027-01-01", au: "2027-03-31", niveau: "grade" },
      "2027-03-15",
    );
    expect(requeteIndicateurs(f)).toBe("du=2027-01-01&au=2027-03-31&niveau=grade");
    expect(lireFiltresIndicateurs({ niveau: "pirate" }, "2027-03-15").niveau).toBe("cabinet");
    // 366 jours au plus (règle de l'API) : au-delà, période par défaut signalée.
    expect(
      lireFiltresIndicateurs({ du: "2026-01-01", au: "2027-01-02" }, "2027-03-15"),
    ).toMatchObject({ du: "2027-03-01", corrigee: true });
    expect(
      lireFiltresIndicateurs({ du: "2026-01-01", au: "2027-01-01" }, "2027-03-15").corrigee,
    ).toBe(false);
  });
});
