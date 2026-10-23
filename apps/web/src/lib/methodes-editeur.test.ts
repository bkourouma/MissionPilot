import { describe, expect, it } from "vitest";
import { construireRegle } from "./methodes";
import type { BriqueVersion, ElementVersion, EtapeVersion, Facteur } from "./methodes";
import {
  saisieDepuisBrique,
  saisieDepuisElement,
  saisieDepuisEtape,
  saisieDepuisRegle,
  saisieElementVide,
  saisieEtapeVide,
  validerBriqueModification,
  validerElementCreation,
  validerElementModification,
  validerEtapeCreation,
  validerEtapeModification,
} from "./methodes-editeur";

const UUID_E = "0e1c2d3e-0000-4000-8000-000000000001";
const UUID_B = "0b1c2d3e-0000-4000-8000-000000000001";

const ETAPE: EtapeVersion = {
  id: UUID_E,
  code: "cadrage",
  libelle: "Cadrage",
  description: null,
  ordre: 1,
};

const BRIQUE: BriqueVersion = {
  id: UUID_B,
  etape_id: UUID_E,
  etape_code: "cadrage",
  code: "atelier",
  libelle: "Atelier",
  objet: "Réunir les parties prenantes",
  entrees: null,
  moteur: null,
  agent: "redacteur",
  classe_risque: "R1",
  garde: null,
  sortie: "Compte rendu",
  definition_termine: null,
  temps_type_jours: 1.5,
  profil_temps: "consultant senior",
  niveau_autonomie_max: "N2",
  active_par_defaut: true,
  ordre: 1,
};

describe("étape", () => {
  it("valide une création et rend une description nulle si elle est vide", () => {
    const r = validerEtapeCreation({ code: "cadrage", libelle: " Cadrage ", description: "" });
    expect(r).toEqual({
      ok: true,
      charge: { code: "cadrage", libelle: "Cadrage", description: null },
    });
  });

  it("refuse un libellé vide et un code invalide", () => {
    const r = validerEtapeCreation(saisieEtapeVide());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.libelle).toBe("Libellé obligatoire.");
      expect(r.erreurs.code).toContain("Code");
    }
  });

  it("modifie en place sans envoyer le code", () => {
    const s = { ...saisieDepuisEtape(ETAPE), libelle: "Cadrage initial", description: "Début" };
    expect(validerEtapeModification(s)).toEqual({
      ok: true,
      charge: { libelle: "Cadrage initial", description: "Début" },
    });
    expect(validerEtapeModification({ ...s, libelle: " " }).ok).toBe(false);
  });
});

describe("brique en modification", () => {
  it("préremplit la saisie (temps à la française) et n'envoie pas le code", () => {
    const s = saisieDepuisBrique(BRIQUE);
    expect(s.temps_type_jours).toBe("1,5");
    const r = validerBriqueModification({ ...s, objet: "Nouvel objet" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).not.toHaveProperty("code");
      expect(r.charge.objet).toBe("Nouvel objet");
      expect(r.charge.temps_type_jours).toBe(1.5);
      expect(r.charge.agent).toBe("redacteur");
    }
  });

  it("garde les contrôles de la création (autonomie, temps par quart de jour)", () => {
    const s = saisieDepuisBrique(BRIQUE);
    const r = validerBriqueModification({
      ...s,
      classe_risque: "R3",
      niveau_autonomie_max: "N3",
      temps_type_jours: "1,3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.niveau_autonomie_max).toContain("N2");
      expect(r.erreurs.temps_type_jours).toContain("quart de jour");
    }
  });
});

describe("élément", () => {
  const element: ElementVersion = {
    id: "el1",
    brique_id: UUID_B,
    brique_code: "atelier",
    type: "item",
    code: "gouvernance_1",
    libelle: "Le conseil se réunit",
    description: null,
    essentiel: true,
    actif_par_defaut: true,
  };

  it("crée un élément avec une brique facultative", () => {
    const r = validerElementCreation({
      ...saisieElementVide(),
      code: "rapport",
      libelle: "Rapport final",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge.brique_id).toBeNull();
      expect(r.charge.essentiel).toBe(false);
    }
  });

  it("n'accepte « essentiel » que pour un item", () => {
    const s = { ...saisieElementVide(), code: "rapport", libelle: "Rapport", essentiel: true };
    const livrable = validerElementCreation(s);
    expect(livrable.ok && livrable.charge.essentiel).toBe(false);
    const item = validerElementCreation({ ...s, type: "item" });
    expect(item.ok && item.charge.essentiel).toBe(true);
  });

  it("modifie en place sans code ni type", () => {
    const s = saisieDepuisElement(element);
    expect(s.brique_id).toBe(UUID_B);
    const r = validerElementModification({
      ...s,
      libelle: "Le conseil se réunit chaque trimestre",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).not.toHaveProperty("code");
      expect(r.charge).not.toHaveProperty("type");
      expect(r.charge).toMatchObject({ brique_id: UUID_B, essentiel: true });
    }
    expect(validerElementModification({ ...s, libelle: "" }).ok).toBe(false);
  });

  it("refuse un code invalide à la création", () => {
    const r = validerElementCreation({
      ...saisieElementVide(),
      code: "Rapport Final",
      libelle: "x",
    });
    expect(r.ok).toBe(false);
  });
});

describe("règle rouverte dans l'éditeur", () => {
  const facteur = (f: Pick<Facteur, "code" | "libelle" | "type">): Facteur => ({
    id: f.code,
    description: null,
    valeurs: null,
    min: null,
    max: null,
    porte_par: "mission",
    origine: "cabinet",
    ...f,
  });
  const facteurs = [
    facteur({ code: "effectif", libelle: "Effectif", type: "nombre" }),
    facteur({ code: "agricole", libelle: "Agricole", type: "booleen" }),
  ];

  it("fait l'aller-retour construireRegle, saisieDepuisRegle, construireRegle", () => {
    const regle = construireRegle(
      {
        code: "petite_structure",
        libelle: "Petite structure",
        priorite: "20",
        combinaison: "au_moins_un",
        comparaisons: [
          { facteur: "effectif", comparateur: "inferieur", valeur: "20,5" },
          { facteur: "agricole", comparateur: "egal", valeur: "oui" },
        ],
        effets: [
          { type: "retirer_brique", code: "atelier", valeur: "" },
          { type: "relever_classe_risque", code: "atelier", valeur: "R2" },
          { type: "seuil", code: "k", valeur: "0,5" },
          { type: "gabarit", code: "rapport", valeur: "court" },
        ],
      },
      facteurs,
    );
    expect(regle.ok).toBe(true);
    if (!regle.ok) return;
    const saisie = saisieDepuisRegle(regle.charge);
    expect(saisie).not.toBeNull();
    expect(saisie?.combinaison).toBe("au_moins_un");
    expect(saisie?.comparaisons[0]?.valeur).toBe("20,5");
    expect(saisie?.comparaisons[1]?.valeur).toBe("oui");
    expect(construireRegle(saisie!, facteurs)).toEqual(regle);
  });

  it("renvoie null pour une condition que l'éditeur ne sait pas rouvrir", () => {
    const base = { code: "r", priorite: 1, effets: [] };
    expect(
      saisieDepuisRegle({
        ...base,
        condition: {
          type: "non",
          condition: {
            type: "comparaison",
            facteur: "agricole",
            comparateur: "egal",
            valeur: true,
          },
        },
      }),
    ).toBeNull();
    expect(
      saisieDepuisRegle({ ...base, condition: { type: "brique_active", brique: "b" } }),
    ).toBeNull();
  });
});
