import { describe, expect, it } from "vitest";
import {
  CODES_SERVICES_CANDIDATS,
  guichetCreationSchema,
  guichetModificationSchema,
  guichetsQuerySchema,
  guichetsRapprochementSchema,
  activationServiceSchema,
  SERVICES_PRIX_REQUIS,
  prixFixeSchema,
  serviceCandidatCodeSchema,
  SERVICES_CANDIDATS_LIBELLES,
} from "./services-candidats";

const base = { nom: "Banque Exemple", type: "banque" } as const;

describe("services candidats : codes, libellés, prix à fixer par le cabinet", () => {
  it("deux codes, libellés français, aucun prix par défaut", () => {
    expect(CODES_SERVICES_CANDIDATS).toEqual(["diagnostic_flash", "business_plan_bancable"]);
    expect(SERVICES_CANDIDATS_LIBELLES.diagnostic_flash).toBe("Diagnostic flash");
    expect(SERVICES_CANDIDATS_LIBELLES.business_plan_bancable).toBe(
      "Business plan bancable et recherche de financement",
    );
    expect(SERVICES_PRIX_REQUIS).toEqual({ diagnostic_flash: true, business_plan_bancable: false });
    expect(activationServiceSchema.safeParse({ service: "diagnostic_flash" }).success).toBe(true);
    expect(activationServiceSchema.safeParse({}).success).toBe(false);
    expect(activationServiceSchema.safeParse({ service: "autre" }).success).toBe(false);
    expect(activationServiceSchema.safeParse({ service: "diagnostic_flash", x: 1 }).success).toBe(
      false,
    );
    expect(serviceCandidatCodeSchema.safeParse("autre").success).toBe(false);
    expect(serviceCandidatCodeSchema.safeParse("diagnostic_flash").success).toBe(true);
  });

  it("prixFixeSchema : bornes, devise, strict", () => {
    expect(prixFixeSchema.safeParse({ montant: 0, devise: "EUR" }).success).toBe(true);
    expect(prixFixeSchema.safeParse({ montant: null, devise: "XAF" }).success).toBe(true);
    expect(prixFixeSchema.safeParse({ montant: 1_000_000_000_000, devise: "USD" }).success).toBe(
      true,
    );
    expect(prixFixeSchema.safeParse({ montant: 1_000_000_000_001, devise: "XOF" }).success).toBe(
      false,
    );
    expect(prixFixeSchema.safeParse({ montant: -1, devise: "XOF" }).success).toBe(false);
    expect(prixFixeSchema.safeParse({ montant: 1.5, devise: "XOF" }).success).toBe(false);
    expect(prixFixeSchema.safeParse({ montant: 1, devise: "GBP" }).success).toBe(false);
    expect(prixFixeSchema.safeParse({ montant: 1, devise: "XOF", x: 1 }).success).toBe(false);
  });
});

describe("guichetCreationSchema", () => {
  it("accepte le minimum et applique les valeurs par défaut", () => {
    const r = guichetCreationSchema.parse(base);
    expect(r).toMatchObject({
      pays: [],
      objets: [],
      devises: [],
      montant_min: null,
      montant_max: null,
      devise_montant: null,
      date_limite: null,
      actif: true,
    });
  });

  it("accepte un guichet complet", () => {
    const r = guichetCreationSchema.safeParse({
      ...base,
      pays: ["CI", "SN"],
      secteurs: ["agro"],
      filieres: ["cacao"],
      tailles: ["PME"],
      objets: ["bfr", "export"],
      devises: ["XOF"],
      montant_min: 1000,
      montant_max: 5000,
      devise_montant: "XOF",
      date_limite: "2027-03-31",
      description: "Ligne de crédit.",
      url: "https://exemple.org/guichet",
      actif: false,
    });
    expect(r.success).toBe(true);
  });

  it("refuse un champ inconnu, un nom vide ou trop long, un type inconnu", () => {
    expect(guichetCreationSchema.safeParse({ ...base, x: 1 }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...base, nom: "  " }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...base, nom: "a".repeat(201) }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...base, type: "mecene" }).success).toBe(false);
  });

  it("refuse un tableau trop long ou une entrée trop longue", () => {
    const trop = Array.from({ length: 61 }, (_, i) => `p${i}`);
    expect(guichetCreationSchema.safeParse({ ...base, pays: trop }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...base, secteurs: ["a".repeat(81)] }).success).toBe(
      false,
    );
    expect(guichetCreationSchema.safeParse({ ...base, secteurs: [""] }).success).toBe(false);
    const cinquante = Array.from({ length: 50 }, (_, i) => `p${i}`);
    expect(guichetCreationSchema.safeParse({ ...base, pays: cinquante }).success).toBe(true);
  });

  it("refuse des objets ou devises hors vocabulaire", () => {
    expect(guichetCreationSchema.safeParse({ ...base, objets: ["don"] }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...base, devises: ["GBP"] }).success).toBe(false);
  });

  it("montants : entiers positifs, min <= max, devise obligatoire avec une borne", () => {
    const ok = { ...base, devise_montant: "XOF" } as const;
    expect(guichetCreationSchema.safeParse({ ...ok, montant_min: 5, montant_max: 5 }).success).toBe(
      true,
    );
    expect(
      guichetCreationSchema.safeParse({ ...ok, montant_min: 10, montant_max: 5 }).success,
    ).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...ok, montant_min: -1 }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...ok, montant_max: 1.5 }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...base, montant_min: 10 }).success).toBe(false);
    expect(guichetCreationSchema.safeParse({ ...base, montant_max: 10 }).success).toBe(false);
    // Une devise sans borne reste acceptée.
    expect(guichetCreationSchema.safeParse(ok).success).toBe(true);
  });

  it("date limite : date ISO valide ou null", () => {
    expect(guichetCreationSchema.safeParse({ ...base, date_limite: "2027-02-30" }).success).toBe(
      false,
    );
    expect(guichetCreationSchema.safeParse({ ...base, date_limite: "31/03/2027" }).success).toBe(
      false,
    );
    expect(guichetCreationSchema.safeParse({ ...base, date_limite: null }).success).toBe(true);
  });

  it("url : http et https seulement, 500 caractères au plus", () => {
    const essai = (url: unknown) => guichetCreationSchema.safeParse({ ...base, url }).success;
    expect(essai("http://exemple.org")).toBe(true);
    expect(essai("https://exemple.org/a?b=1")).toBe(true);
    expect(essai("javascript:alert(1)")).toBe(false);
    expect(essai("JavaScript:alert(1)")).toBe(false);
    expect(essai("data:text/html,x")).toBe(false);
    expect(essai("ftp://exemple.org")).toBe(false);
    expect(essai("pas une adresse")).toBe(false);
    expect(essai("https://exemple.org/" + "a".repeat(500))).toBe(false);
    expect(essai("")).toBe(true);
    expect(essai(null)).toBe(true);
  });

  it("description : 2000 caractères au plus", () => {
    expect(
      guichetCreationSchema.safeParse({ ...base, description: "a".repeat(2000) }).success,
    ).toBe(true);
    expect(
      guichetCreationSchema.safeParse({ ...base, description: "a".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("guichetModificationSchema", () => {
  it("refuse un corps vide", () => {
    const r = guichetModificationSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepte un champ seul, sans appliquer de valeur par défaut", () => {
    const r = guichetModificationSchema.parse({ actif: false });
    expect(r).toEqual({ actif: false });
    expect(guichetModificationSchema.parse({ nom: "Autre" })).toEqual({ nom: "Autre" });
  });

  it("refuse un champ inconnu", () => {
    expect(guichetModificationSchema.safeParse({ nom: "A", x: 1 }).success).toBe(false);
  });

  it("min > max refusé ; devise nulle avec une borne refusée ; borne seule acceptée", () => {
    expect(guichetModificationSchema.safeParse({ montant_min: 10, montant_max: 5 }).success).toBe(
      false,
    );
    expect(
      guichetModificationSchema.safeParse({ montant_min: 10, devise_montant: null }).success,
    ).toBe(false);
    expect(guichetModificationSchema.safeParse({ montant_min: 10 }).success).toBe(true);
    expect(
      guichetModificationSchema.safeParse({ montant_min: 10, devise_montant: "EUR" }).success,
    ).toBe(true);
  });

  it("url javascript: refusée", () => {
    expect(guichetModificationSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("guichetsQuerySchema", () => {
  it("défauts, actif en chaîne, limite bornée", () => {
    expect(guichetsQuerySchema.parse({})).toEqual({ limite: 100 });
    expect(guichetsQuerySchema.parse({ actif: "true", limite: "20" })).toEqual({
      actif: true,
      limite: 20,
    });
    expect(guichetsQuerySchema.parse({ actif: "false" }).actif).toBe(false);
    expect(guichetsQuerySchema.safeParse({ actif: "oui" }).success).toBe(false);
    expect(guichetsQuerySchema.safeParse({ limite: "0" }).success).toBe(false);
    expect(guichetsQuerySchema.safeParse({ limite: "201" }).success).toBe(false);
    expect(guichetsQuerySchema.safeParse({ autre: "1" }).success).toBe(false);
  });
});

describe("guichetsRapprochementSchema", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";

  it("exige un client ou un profil", () => {
    expect(guichetsRapprochementSchema.safeParse({}).success).toBe(false);
    expect(guichetsRapprochementSchema.safeParse({ client_id: uuid }).success).toBe(true);
    expect(guichetsRapprochementSchema.safeParse({ profil: {} }).success).toBe(true);
  });

  it("refuse un client_id non uuid, un champ inconnu, un profil mal formé", () => {
    expect(guichetsRapprochementSchema.safeParse({ client_id: "abc" }).success).toBe(false);
    expect(guichetsRapprochementSchema.safeParse({ client_id: uuid, x: 1 }).success).toBe(false);
    expect(guichetsRapprochementSchema.safeParse({ profil: { montant: -1 } }).success).toBe(false);
    expect(guichetsRapprochementSchema.safeParse({ profil: { objet: "don" } }).success).toBe(false);
    expect(guichetsRapprochementSchema.safeParse({ profil: { inconnu: 1 } }).success).toBe(false);
  });

  it("accepte un profil de surcharges complet", () => {
    const r = guichetsRapprochementSchema.safeParse({
      client_id: uuid,
      profil: {
        pays: "CI",
        secteur: "agro",
        filieres: ["cacao"],
        taille: "PME",
        objet: "bfr",
        montant: 1000,
        devise: "XOF",
      },
    });
    expect(r.success).toBe(true);
    expect(
      guichetsRapprochementSchema.safeParse({ profil: { pays: null, montant: null } }).success,
    ).toBe(true);
  });
});

describe("guichets : bornes alignées sur les CHECK de la migration 0563", () => {
  const essai = (corps: Record<string, unknown>) =>
    guichetCreationSchema.safeParse({ ...base, ...corps }).success;
  const liste = (n: number, longueur = 5) =>
    Array.from({ length: n }, (_, i) => String(i).padStart(longueur, "x"));

  it("nombre d'entrées maximal par champ", () => {
    expect(essai({ pays: liste(60, 2) })).toBe(true); // 60 entrées : le maximum, total 179 caractères
    expect(essai({ pays: liste(61, 1) })).toBe(false);
    expect(essai({ secteurs: liste(51) })).toBe(false);
    expect(essai({ filieres: liste(51) })).toBe(false);
    expect(essai({ tailles: liste(11, 3) })).toBe(false);
    expect(essai({ tailles: liste(10, 3) })).toBe(true);
    expect(essai({ objets: ["creation", "bfr"] })).toBe(true);
    expect(essai({ devises: ["XOF", "XAF", "EUR", "USD", "XOF"] })).toBe(false);
    expect(essai({ devises: ["XOF", "XOF", "EUR"] })).toBe(true); // dédoublonné
  });

  it("longueur totale maximale (valeurs jointes par une virgule)", () => {
    // 600 caractères pour les pays : 60 x 9 + 59 = 599 accepté, 60 x 10 + 59 = 659 refusé.
    expect(essai({ pays: liste(60, 9) })).toBe(true);
    expect(essai({ pays: liste(60, 10) })).toBe(false);
    // 200 pour les tailles : 10 x 19 + 9 = 199 accepté, 10 x 20 + 9 = 209 refusé.
    expect(essai({ tailles: liste(10, 19) })).toBe(true);
    expect(essai({ tailles: liste(10, 20) })).toBe(false);
    // 2000 pour secteurs et filières : 50 x 39 + 49 = 1999 accepté, 50 x 40 + 49 = 2049 refusé.
    expect(essai({ secteurs: liste(50, 39) })).toBe(true);
    expect(essai({ secteurs: liste(50, 40) })).toBe(false);
    expect(essai({ filieres: liste(50, 40) })).toBe(false);
  });

  it("dédoublonne les listes", () => {
    const r = guichetCreationSchema.parse({
      ...base,
      pays: ["CI", "CI", "SN"],
      objets: ["bfr", "bfr"],
    });
    expect(r.pays).toEqual(["CI", "SN"]);
    expect(r.objets).toEqual(["bfr"]);
  });

  it("nom sans caractère de contrôle", () => {
    expect(essai({ nom: "Banque" + String.fromCharCode(7) + "Exemple" })).toBe(false);
    expect(essai({ nom: "Banque" + String.fromCharCode(10) + "Exemple" })).toBe(false);
    expect(essai({ nom: "Banque Exemple" })).toBe(true);
  });

  it("url : « :// » et aucun espace exigés", () => {
    expect(essai({ url: "http:exemple.org" })).toBe(false);
    expect(essai({ url: "https:/exemple.org" })).toBe(false);
    expect(essai({ url: "https://exemple .org" })).toBe(false);
    expect(essai({ url: "https://exemple.org/a b" })).toBe(false);
    expect(essai({ url: "https://exemple.org/a" })).toBe(true);
  });

  it("prix : mention de 200 caractères au plus", () => {
    expect(
      prixFixeSchema.safeParse({ montant: 1, devise: "XOF", commentaire: "x".repeat(200) }).success,
    ).toBe(true);
    expect(
      prixFixeSchema.safeParse({ montant: 1, devise: "XOF", commentaire: "x".repeat(201) }).success,
    ).toBe(false);
    expect(prixFixeSchema.safeParse({ montant: 1, devise: "XOF", commentaire: null }).success).toBe(
      true,
    );
  });
});
