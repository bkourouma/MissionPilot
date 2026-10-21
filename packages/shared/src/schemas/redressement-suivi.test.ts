import { describe, expect, it } from "vitest";
import {
  RED_SUIVI_GRAVITE_LIBELLES,
  RED_SUIVI_GRAVITES,
  RED_SUIVI_MENTION,
  RED_SUIVI_RATIO_LIBELLES,
  RED_SUIVI_RATIOS,
  RED_SUIVI_SENS,
  RED_SUIVI_SENS_LIBELLES,
  RED_SUIVI_SOURCE_RELEVE_LIBELLES,
  RED_SUIVI_SOURCES_RELEVE,
  RED_SUIVI_STATUT_JALON_LIBELLES,
  RED_SUIVI_STATUTS_JALON,
  RED_SUIVI_TYPE_ALERTE_LIBELLES,
  RED_SUIVI_TYPE_EVENEMENT_LIBELLES,
  RED_SUIVI_TYPES_ALERTE,
  RED_SUIVI_TYPES_EVENEMENT,
  redSuiviEvenementCreationSchema,
  redSuiviJalonParamsSchema,
  redSuiviPlanCreationSchema,
  redSuiviReleveCreationSchema,
} from "./redressement-suivi";

const MOTS_INTERDITS = [
  "cessation des paiements",
  "faillite",
  "défaillance",
  "état de crise",
  "en difficulté",
];

const ID = "11111111-1111-4111-8111-111111111111";

describe("libellés", () => {
  it("couvrent chaque valeur de liste fermée, en français, sans qualification juridique", () => {
    const cartes: [readonly string[], Record<string, string>][] = [
      [RED_SUIVI_RATIOS, RED_SUIVI_RATIO_LIBELLES],
      [RED_SUIVI_STATUTS_JALON, RED_SUIVI_STATUT_JALON_LIBELLES],
      [RED_SUIVI_TYPES_EVENEMENT, RED_SUIVI_TYPE_EVENEMENT_LIBELLES],
      [RED_SUIVI_SOURCES_RELEVE, RED_SUIVI_SOURCE_RELEVE_LIBELLES],
      [RED_SUIVI_TYPES_ALERTE, RED_SUIVI_TYPE_ALERTE_LIBELLES],
      [RED_SUIVI_GRAVITES, RED_SUIVI_GRAVITE_LIBELLES],
      [RED_SUIVI_SENS, RED_SUIVI_SENS_LIBELLES],
    ];
    for (const [valeurs, libelles] of cartes) {
      expect(Object.keys(libelles).sort()).toEqual([...valeurs].sort());
      for (const v of valeurs) {
        const t = libelles[v] ?? "";
        expect(t.length).toBeGreaterThan(0);
        for (const mot of MOTS_INTERDITS) expect(t.toLowerCase()).not.toContain(mot);
      }
    }
    for (const mot of MOTS_INTERDITS) expect(RED_SUIVI_MENTION.toLowerCase()).not.toContain(mot);
  });
});

describe("redSuiviPlanCreationSchema", () => {
  it("accepte un corps vide (jalons par défaut) et des jalons croissants", () => {
    expect(redSuiviPlanCreationSchema.safeParse({}).success).toBe(true);
    const r = redSuiviPlanCreationSchema.parse({
      jalons: [{ mois: 3, libelle: "  Point initial " }, { mois: 24 }],
    });
    expect(r.jalons?.[0]?.libelle).toBe("Point initial");
  });

  it("refuse des échéances non croissantes, hors bornes, inconnues ou trop nombreuses", () => {
    for (const corps of [
      { jalons: [] },
      { jalons: [{ mois: 6 }, { mois: 6 }] },
      { jalons: [{ mois: 12 }, { mois: 6 }] },
      { jalons: [{ mois: 0 }] },
      { jalons: [{ mois: 61 }] },
      { jalons: [{ mois: 1.5 }] },
      { jalons: [{ mois: 6, extra: 1 }] },
      { jalons: Array.from({ length: 13 }, (_, i) => ({ mois: i + 1 })) },
      { jalons: [{ mois: 6, libelle: "x".repeat(121) }] },
      { autre: 1 },
    ]) {
      expect(redSuiviPlanCreationSchema.safeParse(corps).success, JSON.stringify(corps)).toBe(
        false,
      );
    }
  });
});

describe("redSuiviReleveCreationSchema", () => {
  const base = { jalon_id: ID, date_releve: "2027-05-01" };

  it("accepte des indicateurs saisis et un instantané", () => {
    expect(
      redSuiviReleveCreationSchema.safeParse({
        ...base,
        source: "saisie",
        ratios: { liquidite_generale: 12_000, endettement: -5 },
        commentaire: "Relevé de mai",
      }).success,
    ).toBe(true);
    expect(redSuiviReleveCreationSchema.safeParse({ ...base, source: "instantane" }).success).toBe(
      true,
    );
  });

  it("refuse une saisie sans ratio, un instantané avec ratios, un ratio inconnu ou hors bornes", () => {
    for (const corps of [
      { ...base, source: "saisie" },
      { ...base, source: "saisie", ratios: {} },
      { ...base, source: "instantane", ratios: { endettement: 1 } },
      { ...base, source: "saisie", ratios: { bfr_jours: 5 } },
      { ...base, source: "saisie", ratios: { endettement: 100_000_001 } },
      { ...base, source: "saisie", ratios: { endettement: 1.5 } },
      { ...base, source: "autre", ratios: { endettement: 1 } },
      { ...base, source: "saisie", ratios: { endettement: 1 }, commentaire: "x".repeat(1001) },
      { ...base, date_releve: "2101-01-01", source: "saisie", ratios: { endettement: 1 } },
      { ...base, jalon_id: "x", source: "saisie", ratios: { endettement: 1 } },
      { ...base, source: "saisie", ratios: { endettement: 1 }, id: ID },
    ]) {
      expect(redSuiviReleveCreationSchema.safeParse(corps).success, JSON.stringify(corps)).toBe(
        false,
      );
    }
  });
});

describe("redSuiviEvenementCreationSchema", () => {
  it("un jalon réalisé n'exige pas de motif, un report oui", () => {
    expect(
      redSuiviEvenementCreationSchema.safeParse({ type: "realise", date_effet: "2027-05-01" })
        .success,
    ).toBe(true);
    expect(
      redSuiviEvenementCreationSchema.safeParse({
        type: "reporte",
        date_effet: "2027-06-01",
        motif: "Client indisponible",
      }).success,
    ).toBe(true);
    for (const corps of [
      { type: "reporte", date_effet: "2027-06-01" },
      { type: "reporte", date_effet: "2027-06-01", motif: "   " },
      { type: "annule", date_effet: "2027-06-01" },
      { type: "realise", date_effet: "2027-06-31" },
      { type: "realise", date_effet: "2027-06-01", motif: "x".repeat(501) },
    ]) {
      expect(redSuiviEvenementCreationSchema.safeParse(corps).success, JSON.stringify(corps)).toBe(
        false,
      );
    }
  });
});

describe("redSuiviJalonParamsSchema", () => {
  it("exige deux identifiants", () => {
    expect(redSuiviJalonParamsSchema.safeParse({ id: ID, jalonId: ID }).success).toBe(true);
    expect(redSuiviJalonParamsSchema.safeParse({ id: ID, jalonId: "x" }).success).toBe(false);
  });
});
