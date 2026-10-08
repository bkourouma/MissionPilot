import { describe, expect, it } from "vitest";
import {
  deboursCreationSchema,
  echeanceCreationSchema,
  factureCreationSchema,
  factureLigneModificationSchema,
  parametresFacturationSchema,
  tauxClientCreationSchema,
} from "./facturation";

const DEBOURS = {
  date: "2026-10-05",
  categorie: "transport",
  libelle: "Taxi",
  montant: 5000,
};

describe("schémas de facturation", () => {
  it("débours : justificatif par chemin relatif sûr, montant entier positif, dates bornées", () => {
    expect(
      deboursCreationSchema.parse({ ...DEBOURS, justificatif: "debours/taxi.jpg" }),
    ).toMatchObject({ refacturable: true, justificatif: "debours/taxi.jpg" });
    for (const justificatif of [
      "../x.jpg",
      "/x.jpg",
      "https://x.test/a.jpg",
      "a\\b.jpg",
      "a\u0000.jpg",
    ]) {
      expect(
        deboursCreationSchema.safeParse({ ...DEBOURS, justificatif }).success,
        justificatif,
      ).toBe(false);
    }
    expect(deboursCreationSchema.safeParse({ ...DEBOURS, montant: 0 }).success).toBe(false);
    expect(deboursCreationSchema.safeParse({ ...DEBOURS, montant: 1.5 }).success).toBe(false);
    expect(deboursCreationSchema.safeParse({ ...DEBOURS, date: "2101-01-01" }).success).toBe(false);
    expect(deboursCreationSchema.safeParse({ ...DEBOURS, statut: "valide" }).success).toBe(false);
  });

  it("échéance : montant OU pourcentage, jamais de régie saisie", () => {
    const base = { type: "jalon", libelle: "Rapport", date_prevue: "2026-12-01" };
    expect(echeanceCreationSchema.safeParse({ ...base, montant: 10 }).success).toBe(true);
    expect(echeanceCreationSchema.safeParse({ ...base, pourcentage: 33.3333 }).success).toBe(true);
    expect(echeanceCreationSchema.safeParse({ ...base, pourcentage: 33.33333 }).success).toBe(
      false,
    );
    expect(echeanceCreationSchema.safeParse({ ...base }).success).toBe(false);
    expect(echeanceCreationSchema.safeParse({ ...base, montant: 1, pourcentage: 1 }).success).toBe(
      false,
    );
    expect(echeanceCreationSchema.safeParse({ ...base, type: "regie", montant: 1 }).success).toBe(
      false,
    );
  });

  it("facture : au moins un élément, sans doublon ; TVA au centième", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(factureCreationSchema.safeParse({}).success).toBe(false);
    expect(factureCreationSchema.safeParse({ echeance_ids: [id, id] }).success).toBe(false);
    expect(factureCreationSchema.parse({ debours_ids: [id] }).echeance_ids).toEqual([]);
    expect(factureLigneModificationSchema.safeParse({ taux_tva: 18.123 }).success).toBe(false);
    expect(
      factureLigneModificationSchema.safeParse({ remise: { type: "montant", valeur: 1.5 } })
        .success,
    ).toBe(false);
  });

  it("paramètres : IBAN normalisé, préfixes distincts, taux autorisés dédoublonnés et triés", () => {
    const p = parametresFacturationSchema.parse({
      iban: "ci93 ci00 0000 0000",
      taux_tva_autorises: [18, 0, 18],
    });
    expect(p.iban).toBe("CI93CI0000000000");
    expect(p.taux_tva_autorises).toEqual([0, 18]);
    expect(
      parametresFacturationSchema.safeParse({ prefixe_facture: "FA", prefixe_avoir: "FA" }).success,
    ).toBe(false);
    expect(parametresFacturationSchema.safeParse({}).success).toBe(false);
  });

  it("taux négocié : validité cohérente et bornée", () => {
    const g = "00000000-0000-4000-8000-000000000001";
    expect(tauxClientCreationSchema.parse({ grade_id: g, taux: 1 }).devise).toBe("XOF");
    expect(
      tauxClientCreationSchema.safeParse({
        grade_id: g,
        taux: 1,
        valide_du: "2027-01-01",
        valide_au: "2026-01-01",
      }).success,
    ).toBe(false);
  });
});
