import { describe, expect, it } from "vitest";
import { historiqueClotureQuerySchema, modeleClotureSchema } from "./cloture";
import {
  salleDemandeCreationSchema,
  salleDemandeModificationSchema,
  salleModeleCreationSchema,
} from "./salle-mission";

describe("salle de mission : dates et pièces bornées", () => {
  it("l'échéance reste dans la plage du CHECK SQL (2000-2100)", () => {
    expect(
      salleDemandeCreationSchema.safeParse({ titre: "x", echeance: "2027-03-10" }).success,
    ).toBe(true);
    for (const echeance of ["1999-12-31", "2101-01-01"]) {
      expect(salleDemandeCreationSchema.safeParse({ titre: "x", echeance }).success, echeance).toBe(
        false,
      );
      expect(salleDemandeModificationSchema.safeParse({ echeance }).success, echeance).toBe(false);
    }
  });

  it("les pièces d'un modèle sont plafonnées en octets (CHECK de 0330)", () => {
    const pieces = Array.from({ length: 100 }, (_, i) => ({
      libelle: `Pièce ${i}`,
      description: "é".repeat(2000),
    }));
    expect(salleModeleCreationSchema.safeParse({ nom: "Gros", pieces }).success).toBe(false);
    expect(
      salleModeleCreationSchema.safeParse({ nom: "Petit", pieces: pieces.slice(0, 10) }).success,
    ).toBe(true);
  });
});

describe("clôture : modèle et historique", () => {
  it("un item inactif ne peut pas être bloquant", () => {
    const item = (actif: boolean, bloquant: boolean) =>
      modeleClotureSchema.safeParse({ items: [{ controle: "debours_traites", actif, bloquant }] });
    expect(item(true, true).success).toBe(true);
    expect(item(false, false).success).toBe(true);
    expect(item(false, true).success).toBe(false);
  });

  it("l'historique accepte un curseur par liste et refuse tout autre champ", () => {
    expect(
      historiqueClotureQuerySchema.parse({ limite: "10", curseur_verifications: "abc" }),
    ).toMatchObject({ limite: 10, curseur_verifications: "abc" });
    expect(historiqueClotureQuerySchema.safeParse({ curseur: "abc" }).success).toBe(false);
  });
});
