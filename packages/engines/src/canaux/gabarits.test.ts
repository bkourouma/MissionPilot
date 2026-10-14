import { describe, expect, it } from "vitest";
import {
  CODES_GABARIT,
  ErreurCanaux,
  estGsm7,
  GABARITS_CANAL,
  rendreGabaritCanal,
  rendreVarianteSms,
  TYPES_VARIABLE_CANAL,
} from "./index";

const ORIGINE = "http://localhost:3100";
const CHEMIN = "/portail/questionnaires/3f2c9b1e-0000-4000-8000-000000000001";

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ErreurCanaux ? e.code : "AUTRE";
  }
}

describe("rendreGabaritCanal (SPEC §18.2)", () => {
  it("relance J+10 : texte de 225 caractères et lien absolu de 81 caractères", () => {
    const rendu = rendreGabaritCanal(
      "relance_questionnaire_j10",
      { 1: "Lagune Conseil", 2: CHEMIN },
      ORIGINE,
    );
    expect(rendu.texte.startsWith("Lagune Conseil vous rappelle")).toBe(true);
    expect(rendu.longueur).toBe(rendu.texte.length);
    expect(rendu.longueur).toBe(225);
    const lien = `${ORIGINE}${CHEMIN}`;
    expect(lien).toHaveLength(81);
    expect(rendu.texte).toContain(lien);
    // Ni titre de questionnaire, ni nom de personne : seulement le cabinet et le lien.
    expect(rendu.variables).toEqual(["Lagune Conseil", CHEMIN]);
  });

  it("accepte un tableau positionnel et une origine terminée par une barre oblique", () => {
    const a = rendreGabaritCanal("relance_questionnaire_j10", ["Cab", CHEMIN], `${ORIGINE}/`);
    const b = rendreGabaritCanal("relance_questionnaire_j10", { 1: "Cab", 2: CHEMIN }, ORIGINE);
    expect(a.texte).toBe(b.texte);
  });

  it("refuse un texte libre ou un lien absolu en variable de lien", () => {
    for (const lien of [
      "https://exemple.test/x",
      "//exemple.test/portail/x",
      "/autre/chemin",
      "/portail/../admin",
      "/portail//x",
      `/portail/${"a".repeat(300)}`,
      "Bonjour tout le monde",
    ]) {
      expect(
        code(() => rendreGabaritCanal("relance_questionnaire_j10", { 1: "Cab", 2: lien }, ORIGINE)),
        lien,
      ).toBe("VARIABLE_INVALIDE");
    }
  });

  it("nom du cabinet : 1 à 60 caractères, sans saut de ligne", () => {
    const rendre = (nom: string) =>
      code(() => rendreGabaritCanal("reponse_stop", { 1: nom }, ORIGINE));
    expect(rendre("A")).toBeNull();
    expect(rendre("A".repeat(60))).toBeNull();
    expect(rendre("A".repeat(61))).toBe("VARIABLE_INVALIDE");
    expect(rendre("   ")).toBe("VARIABLE_INVALIDE");
    expect(rendre("Ligne 1\nLigne 2")).toBe("VARIABLE_INVALIDE");
  });

  it("compteur : plafonné à 999 dans le message", () => {
    const rendu = rendreGabaritCanal(
      "synthese_hebdo",
      { 1: "Cab", 2: 1200, 3: "4", 4: "/portail/synthese" },
      ORIGINE,
    );
    expect(rendu.texte).toContain("(999 point(s) d'attention, 4 décision(s) attendue(s))");
    expect(rendu.texte).toContain(`${ORIGINE}/portail/synthese`);
    expect(rendu.variables).toEqual(["Cab", "999", "4", "/portail/synthese"]);
    for (const mauvais of [-1, 3.5, "abc", ""]) {
      expect(
        code(() =>
          rendreGabaritCanal(
            "synthese_hebdo",
            { 1: "Cab", 2: mauvais, 3: 1, 4: "/portail/synthese" },
            ORIGINE,
          ),
        ),
      ).toBe("VARIABLE_INVALIDE");
    }
  });

  it("code de vérification : exactement six chiffres", () => {
    expect(rendreGabaritCanal("verification_numero", { 1: "123456" }, ORIGINE).texte).toContain(
      "123456",
    );
    expect(code(() => rendreGabaritCanal("verification_numero", { 1: "12345" }, ORIGINE))).toBe(
      "VARIABLE_INVALIDE",
    );
    expect(code(() => rendreGabaritCanal("verification_numero", { 1: "1234567" }, ORIGINE))).toBe(
      "VARIABLE_INVALIDE",
    );
  });

  it("saisie de KPI : libellé court et valeur décimale, valeur répétée dans la confirmation", () => {
    const a = rendreGabaritCanal(
      "reponse_saisie_a_confirmer",
      { 1: "Chiffre d'affaires", 2: "125000000" },
      ORIGINE,
    );
    expect(a.texte).toBe(
      "Saisie reçue : « Chiffre d'affaires » = 125000000. Répondez OUI pour confirmer ou NON pour annuler.",
    );
    const b = rendreGabaritCanal("reponse_saisie_a_verifier", { 1: "Taux", 2: "-8.5" }, ORIGINE);
    expect(b.texte).toContain("OUI -8.5. Sinon répondez NON.");
    for (const valeur of ["8,5", "abc", "1e5", "-0", "0.1234567", "1234567890123456"]) {
      expect(
        code(() =>
          rendreGabaritCanal("reponse_saisie_a_confirmer", { 1: "x", 2: valeur }, ORIGINE),
        ),
        valeur,
      ).toBe("VARIABLE_INVALIDE");
    }
    expect(
      code(() =>
        rendreGabaritCanal("reponse_saisie_a_confirmer", { 1: "x".repeat(41), 2: "1" }, ORIGINE),
      ),
    ).toBe("VARIABLE_INVALIDE");
  });

  it("une valeur qui ressemble à une variable n'est jamais re-substituée", () => {
    const rendu = rendreGabaritCanal("reponse_stop", { 1: "{1} et {2}" }, ORIGINE);
    expect(rendu.texte).toContain("de {1} et {2}.");
  });

  it("nombre de variables exact, gabarit et origine connus", () => {
    expect(code(() => rendreGabaritCanal("reponse_stop", {}, ORIGINE))).toBe("VARIABLE_INVALIDE");
    expect(code(() => rendreGabaritCanal("reponse_stop", { 1: "A", 2: "B" }, ORIGINE))).toBe(
      "VARIABLE_INVALIDE",
    );
    expect(code(() => rendreGabaritCanal("reponse_stop", ["A", "B"], ORIGINE))).toBe(
      "VARIABLE_INVALIDE",
    );
    expect(code(() => rendreGabaritCanal("reponse_saisie_enregistree", {}, ORIGINE))).toBeNull();
    expect(code(() => rendreGabaritCanal("inconnu" as never, {}, ORIGINE))).toBe("GABARIT_INCONNU");
    expect(code(() => rendreGabaritCanal("toString" as never, {}, ORIGINE))).toBe(
      "GABARIT_INCONNU",
    );
    for (const mauvaise of [
      "ftp://x",
      "localhost:3100",
      "http://x/chemin",
      "javascript:alert(1)",
    ]) {
      expect(code(() => rendreGabaritCanal("reponse_stop", { 1: "A" }, mauvaise))).toBe(
        "ORIGINE_INVALIDE",
      );
    }
  });

  it("le libellé court est réservé aux réponses de service", () => {
    // Un gabarit hors service avec un libellé court est refusé même s'il était déclaré.
    const original = GABARITS_CANAL.alerte_kpi;
    const detourne = { ...original, variables: ["libelle_court", "lien_portail"] as const };
    (GABARITS_CANAL as unknown as Record<string, unknown>).alerte_kpi = detourne;
    try {
      expect(
        code(() => rendreGabaritCanal("alerte_kpi", { 1: "Libellé", 2: "/portail/kpi" }, ORIGINE)),
      ).toBe("VARIABLE_INVALIDE");
    } finally {
      (GABARITS_CANAL as unknown as Record<string, unknown>).alerte_kpi = original;
    }
  });

  it("refuse un texte rendu qui dépasse la limite d'un gabarit", () => {
    const original = GABARITS_CANAL.reponse_saisie_enregistree;
    (GABARITS_CANAL as unknown as Record<string, unknown>).reponse_saisie_enregistree = {
      ...original,
      texte: "x".repeat(1025),
    };
    try {
      expect(code(() => rendreGabaritCanal("reponse_saisie_enregistree", {}, ORIGINE))).toBe(
        "TEXTE_TROP_LONG",
      );
    } finally {
      (GABARITS_CANAL as unknown as Record<string, unknown>).reponse_saisie_enregistree = original;
    }
  });

  it("variable absente d'un gabarit mal déclaré : refus", () => {
    const original = GABARITS_CANAL.reponse_saisie_enregistree;
    (GABARITS_CANAL as unknown as Record<string, unknown>).reponse_saisie_enregistree = {
      ...original,
      texte: "Merci {1}",
    };
    try {
      expect(code(() => rendreGabaritCanal("reponse_saisie_enregistree", {}, ORIGINE))).toBe(
        "VARIABLE_INVALIDE",
      );
    } finally {
      (GABARITS_CANAL as unknown as Record<string, unknown>).reponse_saisie_enregistree = original;
    }
  });
});

describe("catalogue fermé (inventaire)", () => {
  it("chaque code a son entrée, sa catégorie et des types de variable du catalogue fermé", () => {
    expect(Object.keys(GABARITS_CANAL).sort()).toEqual([...CODES_GABARIT].sort());
    for (const g of Object.values(GABARITS_CANAL)) {
      expect(GABARITS_CANAL[g.code]).toBe(g);
      for (const type of g.variables) expect(TYPES_VARIABLE_CANAL).toContain(type);
      // Chaque {n} du texte désigne une variable déclarée.
      const positions = [...g.texte.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      for (const p of positions) expect(p).toBeLessThanOrEqual(g.variables.length);
      // Chaque variable déclarée figure dans le texte.
      for (let i = 1; i <= g.variables.length; i++) expect(positions).toContain(i);
    }
  });

  it("aucun type de texte libre ; le libellé court est réservé aux réponses de service", () => {
    expect([...TYPES_VARIABLE_CANAL].sort()).toEqual(
      [
        "code_otp",
        "compte",
        "libelle_court",
        "lien_portail",
        "nom_cabinet",
        "nombre_decimal",
        "valeur_kpi",
      ].sort(),
    );
    for (const g of Object.values(GABARITS_CANAL)) {
      if (g.variables.includes("libelle_court")) expect(g.categorie).toBe("reponse_service");
    }
  });

  it("variantes SMS : seulement relance, synthèse, signature, alerte", () => {
    for (const g of Object.values(GABARITS_CANAL)) {
      const attendu = ["relance", "synthese", "signature", "alerte"].includes(g.categorie);
      expect(g.varianteSms !== undefined, g.code).toBe(attendu);
    }
  });

  it("aucun texte du catalogue ne cite un titre, un montant ou un score", () => {
    for (const g of Object.values(GABARITS_CANAL)) {
      expect(g.texte).not.toMatch(/\b(FCFA|EUR|USD|score|titre)\b|€/i);
    }
  });
});

describe("variantes SMS et GSM-7", () => {
  it("relance J+10 : 154 caractères, GSM-7", () => {
    const rendu = rendreVarianteSms(
      "relance_questionnaire_j10",
      { 1: "Lagune Conseil", 2: CHEMIN },
      ORIGINE,
    );
    expect(rendu.texte).toBe(
      `MissionPilot : un questionnaire attend votre reponse : ${ORIGINE}${CHEMIN} STOP pour arreter`,
    );
    expect(rendu.longueur).toBe(154);
    expect(estGsm7(rendu.texte)).toBe(true);
  });

  it("les quatre variantes tiennent dans un SMS avec un lien de synthèse", () => {
    for (const c of ["synthese_hebdo", "signature_a_effectuer", "alerte_kpi"] as const) {
      const variables =
        c === "synthese_hebdo"
          ? { 1: "Cabinet", 2: 3, 3: 4, 4: "/portail/synthese" }
          : { 1: "Cabinet", 2: "/portail/signatures" };
      const rendu = rendreVarianteSms(c, variables, ORIGINE);
      expect(rendu.longueur).toBeLessThanOrEqual(160);
      expect(estGsm7(rendu.texte)).toBe(true);
    }
  });

  it("refuse une variante absente, un lien trop long, un gabarit inconnu", () => {
    expect(code(() => rendreVarianteSms("verification_numero", { 1: "123456" }, ORIGINE))).toBe(
      "VARIANTE_SMS_ABSENTE",
    );
    expect(code(() => rendreVarianteSms("zzz" as never, {}, ORIGINE))).toBe("GABARIT_INCONNU");
    const lien = `/portail/${"a".repeat(150)}`;
    expect(
      code(() => rendreVarianteSms("signature_a_effectuer", { 1: "Cab", 2: lien }, ORIGINE)),
    ).toBe("SMS_TROP_LONG");
  });

  it("estGsm7 : sans accent ni caractère étendu", () => {
    expect(estGsm7("MissionPilot : un questionnaire attend votre reponse")).toBe(true);
    expect(estGsm7("un questionnaire attend votre réponse")).toBe(false); // « é »
    expect(estGsm7("prix 5 €")).toBe(false);
    expect(estGsm7("tableau [1]")).toBe(false);
    expect(estGsm7("a\nb")).toBe(true);
    expect(estGsm7("")).toBe(true);
  });
});
