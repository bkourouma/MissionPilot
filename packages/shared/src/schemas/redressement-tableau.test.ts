import { describe, expect, it } from "vitest";
import {
  RED_CODES_MOTIF_VOYANT,
  RED_GRAVITE_MOTIF_LIBELLES,
  RED_GRAVITES_MOTIF,
  RED_MOTIF_VOYANT_LIBELLES,
  RED_TABLEAU_LIMITE_DEFAUT,
  RED_TABLEAU_LIMITE_MAX,
  RED_TABLEAU_MENTION,
  RED_VOYANT_PILOTAGE_LIBELLES,
  RED_VOYANTS_PILOTAGE,
  redTableauPortefeuilleQuerySchema,
} from "./redressement-tableau";

const INTERDITS = [
  "cessation des paiements",
  "faillite",
  "défaillance",
  "état de crise",
  "en difficulté",
];

describe("libellés du tableau de bord", () => {
  it("chaque voyant, gravité et motif a un libellé français non vide", () => {
    for (const v of RED_VOYANTS_PILOTAGE)
      expect(RED_VOYANT_PILOTAGE_LIBELLES[v].length).toBeGreaterThan(2);
    for (const g of RED_GRAVITES_MOTIF)
      expect(RED_GRAVITE_MOTIF_LIBELLES[g].length).toBeGreaterThan(2);
    for (const c of RED_CODES_MOTIF_VOYANT)
      expect(RED_MOTIF_VOYANT_LIBELLES[c].length).toBeGreaterThan(5);
    expect(Object.keys(RED_MOTIF_VOYANT_LIBELLES).sort()).toEqual(
      [...RED_CODES_MOTIF_VOYANT].sort(),
    );
  });

  it("aucun libellé ne qualifie juridiquement la situation du client", () => {
    const textes = [
      ...Object.values(RED_VOYANT_PILOTAGE_LIBELLES),
      ...Object.values(RED_GRAVITE_MOTIF_LIBELLES),
      ...Object.values(RED_MOTIF_VOYANT_LIBELLES),
      RED_TABLEAU_MENTION,
    ];
    for (const t of textes) {
      for (const mot of INTERDITS) {
        // La mention rappelle justement qu'il n'y a pas de qualification juridique.
        expect(t.toLowerCase()).not.toContain(mot);
      }
    }
    expect(RED_TABLEAU_MENTION).toContain("ne qualifie pas la situation juridique");
  });
});

describe("requête du portefeuille", () => {
  it("valeurs par défaut", () => {
    expect(redTableauPortefeuilleQuerySchema.parse({})).toEqual({
      limite: RED_TABLEAU_LIMITE_DEFAUT,
    });
  });

  it("filtres, curseur et limite acceptés (texte converti)", () => {
    expect(
      redTableauPortefeuilleQuerySchema.parse({
        limite: "5",
        statut: "diagnostic",
        secteur: "general",
        curseur: "abc",
      }),
    ).toEqual({ limite: 5, statut: "diagnostic", secteur: "general", curseur: "abc" });
  });

  it("refuse une limite hors bornes, un statut inconnu, un champ inconnu", () => {
    for (const q of [
      { limite: 0 },
      { limite: RED_TABLEAU_LIMITE_MAX + 1 },
      { limite: 1.5 },
      { statut: "ferme" },
      { secteur: "inconnu" },
      { curseur: "x".repeat(501) },
      { client_id: "00000000-0000-4000-8000-000000000000" },
    ]) {
      expect(redTableauPortefeuilleQuerySchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
  });
});
