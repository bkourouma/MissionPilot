import { describe, expect, it } from "vitest";
import {
  briefQuerySchema,
  briefSchema,
  chargeBriefQuotidienSchema,
  elementBriefSchema,
  FAMILLES_BRIEF_API,
  GRAVITES_BRIEF_API,
  LIBELLES_FAMILLE_BRIEF,
  LIBELLES_GRAVITE_BRIEF,
  TYPES_ELEMENT_BRIEF_API,
} from "./brief";

const element = {
  type: "facture_echue",
  famille: "deriver",
  libelle: "Facture échue : FAC-2026-0001 (20 jours de retard)",
  entite_id: "5c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a11",
  mission_id: "6c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a12",
  mission_libelle: "Plan stratégique",
  lien: "/facturation/5c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a11",
  gravite: "moyenne",
  anciennete_jours: 20,
};

const vide = { total: 0, tronque: false, elements: [] };

describe("requête du brief", () => {
  it("accepte l'absence de date ou une date bornée, refuse le reste", () => {
    expect(briefQuerySchema.safeParse({}).success).toBe(true);
    expect(briefQuerySchema.safeParse({ date: "2026-10-12" }).success).toBe(true);
    for (const mauvaise of [
      { date: "1999-12-31" },
      { date: "2101-01-01" },
      { date: "2026-02-30" },
      { date: "demain" },
      { date: "2026-10-12", autre: 1 },
      { utilisateur_id: "x" },
    ]) {
      expect(briefQuerySchema.safeParse(mauvaise).success, JSON.stringify(mauvaise)).toBe(false);
    }
  });
});

describe("réponse du brief", () => {
  it("accepte un élément complet et un élément sans donnée financière", () => {
    expect(elementBriefSchema.safeParse(element).success).toBe(true);
    expect(
      elementBriefSchema.safeParse({ ...element, montant: 150000, devise: "XOF" }).success,
    ).toBe(true);
  });

  it("refuse un champ inconnu (schéma strict), un type ou une gravité inconnus", () => {
    expect(elementBriefSchema.safeParse({ ...element, contenu: "verbatim client" }).success).toBe(
      false,
    );
    expect(elementBriefSchema.safeParse({ ...element, type: "inconnu" }).success).toBe(false);
    expect(elementBriefSchema.safeParse({ ...element, gravite: "critique" }).success).toBe(false);
    expect(elementBriefSchema.safeParse({ ...element, anciennete_jours: -1 }).success).toBe(false);
  });

  it("refuse un lien externe ou protocole-relatif", () => {
    for (const lien of ["https://exemple.test/x", "//exemple.test/x", "javascript:alert(1)", ""]) {
      expect(elementBriefSchema.safeParse({ ...element, lien }).success, lien).toBe(false);
    }
  });

  it("valide le brief entier, vide ou non", () => {
    const brief = {
      date_reference: "2026-10-12",
      familles: {
        decider: vide,
        deriver: { total: 1, tronque: false, elements: [element] },
        envoyer: vide,
      },
      total: 1,
      vide: false,
    };
    expect(briefSchema.safeParse(brief).success).toBe(true);
    expect(
      briefSchema.safeParse({
        date_reference: "2026-10-12",
        familles: { decider: vide, deriver: vide, envoyer: vide },
        total: 0,
        vide: true,
      }).success,
    ).toBe(true);
    expect(briefSchema.safeParse({ ...brief, extra: 1 }).success).toBe(false);
    expect(briefSchema.safeParse({ ...brief, familles: { decider: vide } }).success).toBe(false);
  });

  it("tous les identifiants ont un libellé français", () => {
    for (const f of FAMILLES_BRIEF_API) expect(LIBELLES_FAMILLE_BRIEF[f].length).toBeGreaterThan(3);
    for (const g of GRAVITES_BRIEF_API) expect(LIBELLES_GRAVITE_BRIEF[g].length).toBeGreaterThan(3);
    expect(new Set(TYPES_ELEMENT_BRIEF_API).size).toBe(TYPES_ELEMENT_BRIEF_API.length);
  });
});

describe("charge de la tâche quotidienne", () => {
  it("accepte une charge vide, une date, une date et un curseur", () => {
    const id = "5c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a11";
    expect(chargeBriefQuotidienSchema.safeParse({}).success).toBe(true);
    expect(chargeBriefQuotidienSchema.safeParse({ date: "2026-10-12" }).success).toBe(true);
    expect(chargeBriefQuotidienSchema.safeParse({ date: "2026-10-12", apres_id: id }).success).toBe(
      true,
    );
  });

  it("refuse une date invalide ou hors bornes, un curseur non UUID et toute autre clé", () => {
    for (const mauvaise of [
      { date: "pas-une-date" },
      { date: "2026-02-30" },
      { date: "1999-12-31" },
      { date: 20261012 },
      { date: "2026-10-12", apres_id: "abc" },
      { date: "2026-10-12", apres_id: 12 },
      { date: "2026-10-12", autre: 1 },
    ]) {
      expect(chargeBriefQuotidienSchema.safeParse(mauvaise).success, JSON.stringify(mauvaise)).toBe(
        false,
      );
    }
  });
});

describe("types d'éléments : validations d'offre, de plan et de révision de budget", () => {
  it("31 types, dont les trois nouveaux acceptés par l'élément strict", () => {
    expect(TYPES_ELEMENT_BRIEF_API).toHaveLength(31);
    for (const type of [
      "offre_technique_a_valider",
      "plan_a_valider",
      "revision_budget_a_valider",
    ]) {
      const lien = "/missions/6c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a12/budget";
      expect(
        elementBriefSchema.safeParse({ ...element, type, famille: "decider", lien }).success,
        type,
      ).toBe(true);
    }
    expect(elementBriefSchema.safeParse({ ...element, type: "rapport_non_diffuse" }).success).toBe(
      false,
    );
  });
});

describe("type « voyant_rouge » : motifs en texte", () => {
  it("accepte des motifs textuels (5 au plus, non vides) et refuse le reste", () => {
    const base = {
      ...element,
      type: "voyant_rouge",
      famille: "deriver",
      lien: "/missions/6c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a12/redressement",
    };
    expect(elementBriefSchema.safeParse({ ...base, motifs: ["Urgence au rouge."] }).success).toBe(
      true,
    );
    expect(
      elementBriefSchema.safeParse({ ...base, motifs: ["1", "2", "3", "4", "5", "6"] }).success,
    ).toBe(false);
    expect(elementBriefSchema.safeParse({ ...base, motifs: [""] }).success).toBe(false);
    expect(elementBriefSchema.safeParse({ ...base, motifs: [12] }).success).toBe(false);
  });
});
