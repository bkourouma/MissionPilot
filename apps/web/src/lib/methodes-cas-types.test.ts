import { describe, expect, it } from "vitest";
import type { CasTypeVersion, Facteur } from "./methodes";
import { construireCasType, saisieCasTypeVide, saisieDepuisCasType } from "./methodes-cas-types";

const FACTEURS: Facteur[] = [
  {
    id: "f1",
    code: "effectif",
    libelle: "Effectif",
    description: null,
    type: "nombre",
    valeurs: null,
    min: 0,
    max: null,
    porte_par: "mission",
    origine: "standard",
  },
  {
    id: "f2",
    code: "agricole",
    libelle: "Agricole",
    description: null,
    type: "booleen",
    valeurs: null,
    min: null,
    max: null,
    porte_par: "mission",
    origine: "standard",
  },
];
const REGLES = ["petite_structure", "filiere_agricole"];

describe("cas type", () => {
  it("construit le corps de création : contexte typé, règles et conflits attendus", () => {
    const r = construireCasType(
      {
        code: "pme_agricole",
        libelle: " PME agricole ",
        contexte: { effectif: "12", agricole: "oui" },
        regles: ["petite_structure"],
        conflits: "0",
      },
      FACTEURS,
      REGLES,
    );
    expect(r).toEqual({
      ok: true,
      charge: {
        code: "pme_agricole",
        libelle: "PME agricole",
        contexte: { effectif: 12, agricole: true },
        attendu: { regles_declenchees: ["petite_structure"], conflits_non_resolus: 0 },
      },
    });
  });

  it("exige un libellé, un code et au moins une attente", () => {
    const r = construireCasType(saisieCasTypeVide(), FACTEURS, REGLES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.libelle).toBe("Libellé obligatoire.");
      expect(r.erreurs.code).toContain("Code");
      expect(r.erreurs.regles).toContain("au moins une règle");
    }
  });

  it("remonte les erreurs de contexte par facteur", () => {
    const r = construireCasType(
      {
        ...saisieCasTypeVide(),
        code: "c",
        libelle: "C",
        contexte: { effectif: "beaucoup", agricole: "peut-être" },
        regles: ["petite_structure"],
      },
      FACTEURS,
      REGLES,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.effectif).toBe("Nombre attendu.");
      expect(r.erreurs.agricole).toBe("Choisir oui ou non.");
    }
  });

  it("refuse un nombre de conflits négatif ou décimal", () => {
    for (const conflits of ["-1", "1,5", "abc"]) {
      const r = construireCasType(
        { ...saisieCasTypeVide(), code: "c", libelle: "C", regles: ["petite_structure"], conflits },
        FACTEURS,
        REGLES,
      );
      expect(r.ok, conflits).toBe(false);
    }
  });

  it("ignore une règle cochée qui n'existe plus dans la version", () => {
    const r = construireCasType(
      {
        ...saisieCasTypeVide(),
        code: "c",
        libelle: "C",
        regles: ["supprimee", "petite_structure"],
      },
      FACTEURS,
      REGLES,
    );
    expect(r.ok && r.charge.attendu.regles_declenchees).toEqual(["petite_structure"]);
  });
});

describe("cas type en modification", () => {
  const existant: CasTypeVersion = {
    id: "c1",
    code: "pme_agricole",
    libelle: "PME agricole",
    cas: {
      contexte: { effectif: 12, agricole: true },
      briques_de_base: ["atelier"],
      attendu: {
        presents: [{ type: "activer_brique", brique: "atelier" }],
        regles_declenchees: ["petite_structure"],
        conflits_non_resolus: 1,
      },
    },
  };

  it("préremplit la saisie depuis le cas type enregistré", () => {
    expect(saisieDepuisCasType(existant)).toEqual({
      code: "pme_agricole",
      libelle: "PME agricole",
      contexte: { effectif: "12", agricole: "oui" },
      regles: ["petite_structure"],
      conflits: "1",
    });
  });

  it("conserve les effets attendus et les briques de base que le formulaire ne montre pas", () => {
    const s = { ...saisieDepuisCasType(existant), regles: [], conflits: "" };
    const r = construireCasType(s, FACTEURS, REGLES, existant.cas);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge.briques_de_base).toEqual(["atelier"]);
      expect(r.charge.attendu).toEqual({
        presents: [{ type: "activer_brique", brique: "atelier" }],
      });
    }
  });

  it("retire une attente décochée sans toucher aux autres", () => {
    const s = { ...saisieDepuisCasType(existant), conflits: "" };
    const r = construireCasType(s, FACTEURS, REGLES, existant.cas);
    expect(r.ok && r.charge.attendu.conflits_non_resolus).toBeUndefined();
    expect(r.ok && r.charge.attendu.regles_declenchees).toEqual(["petite_structure"]);
  });

  it("garde le code du cas type (PUT du même code)", () => {
    const r = construireCasType(saisieDepuisCasType(existant), FACTEURS, REGLES, existant.cas);
    expect(r.ok && r.charge.code).toBe("pme_agricole");
  });
});
