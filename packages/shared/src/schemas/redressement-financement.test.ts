import { describe, expect, it } from "vitest";
import {
  RED_COVENANT_FREQUENCE_LIBELLES,
  RED_COVENANT_FREQUENCES,
  RED_COVENANT_OPERATEUR_LIBELLES,
  RED_COVENANT_OPERATEURS,
  RED_COVENANT_RAISON_LIBELLES,
  RED_COVENANT_RAISONS,
  RED_COVENANT_RATIO_LIBELLES,
  RED_COVENANT_RATIOS,
  RED_COVENANT_STATUT_LIBELLES,
  RED_COVENANT_STATUTS,
  RED_COVENANTS_PAR_VERSION_MAX,
  RED_FINANCEMENT_EMPLOIS,
  RED_FINANCEMENT_LIGNES_MAX,
  RED_FINANCEMENT_NATURE_LIBELLES,
  RED_FINANCEMENT_ORIGINE_LIBELLES,
  RED_FINANCEMENT_ORIGINES,
  RED_FINANCEMENT_RESSOURCES,
  RED_FINANCEMENT_SENS_LIBELLES,
  RED_FINANCEMENT_SENS,
  RED_FINANCEMENT_STATUT_LIBELLES,
  RED_FINANCEMENT_STATUTS,
  RED_FINANCEMENT_TYPE_PERIODE_LIBELLES,
  RED_FINANCEMENT_TYPES_PERIODE,
  RED_COVENANT_MENTION,
  redCovenantsVersionCreationSchema,
  redFinancementPropositionQuerySchema,
  redFinancementVersionCreationSchema,
} from "./redressement-financement";

const MOTS_INTERDITS = [
  "cessation des paiements",
  "faillite",
  "défaillance",
  "état de crise",
  "en difficulté",
];

describe("libellés", () => {
  it("couvrent chaque valeur de liste fermée, en français, sans qualification juridique", () => {
    const cartes: [readonly string[], Record<string, string>][] = [
      [RED_COVENANT_RATIOS, RED_COVENANT_RATIO_LIBELLES],
      [RED_COVENANT_OPERATEURS, RED_COVENANT_OPERATEUR_LIBELLES],
      [RED_COVENANT_FREQUENCES, RED_COVENANT_FREQUENCE_LIBELLES],
      [RED_COVENANT_STATUTS, RED_COVENANT_STATUT_LIBELLES],
      [RED_COVENANT_RAISONS, RED_COVENANT_RAISON_LIBELLES],
      [RED_FINANCEMENT_TYPES_PERIODE, RED_FINANCEMENT_TYPE_PERIODE_LIBELLES],
      [RED_FINANCEMENT_SENS, RED_FINANCEMENT_SENS_LIBELLES],
      [
        [...RED_FINANCEMENT_EMPLOIS, ...RED_FINANCEMENT_RESSOURCES],
        RED_FINANCEMENT_NATURE_LIBELLES,
      ],
      [RED_FINANCEMENT_STATUTS, RED_FINANCEMENT_STATUT_LIBELLES],
      [RED_FINANCEMENT_ORIGINES, RED_FINANCEMENT_ORIGINE_LIBELLES],
    ];
    for (const [valeurs, libelles] of cartes) {
      expect(Object.keys(libelles).sort()).toEqual([...valeurs].sort());
      for (const v of valeurs) {
        const t = libelles[v] ?? "";
        expect(t.length).toBeGreaterThan(0);
        for (const mot of MOTS_INTERDITS) expect(t.toLowerCase()).not.toContain(mot);
      }
    }
    for (const mot of MOTS_INTERDITS) expect(RED_COVENANT_MENTION.toLowerCase()).not.toContain(mot);
  });
});

const covenant = (extra: Record<string, unknown> = {}) => ({
  ratio: "liquidite_generale",
  operateur: "min",
  seuil_pb: 12_000,
  frequence: "annuelle",
  ...extra,
});

describe("redCovenantsVersionCreationSchema", () => {
  it("accepte une liste vide, un covenant complet, un plancher et un plafond cohérents", () => {
    expect(redCovenantsVersionCreationSchema.safeParse({ covenants: [] }).success).toBe(true);
    const r = redCovenantsVersionCreationSchema.parse({
      covenants: [
        covenant({ preteur: "  Banque X ", seuil_pb: -5_000 }),
        covenant({ operateur: "max", seuil_pb: 20_000 }),
      ],
      motif: "Avenant",
    });
    expect(r.covenants[0]?.preteur).toBe("Banque X");
  });

  it("chaîne vide pour le prêteur ou le motif : traitée comme absente", () => {
    const r = redCovenantsVersionCreationSchema.parse({
      covenants: [covenant({ preteur: "  " })],
      motif: "",
    });
    expect(r.covenants[0]?.preteur).toBeNull();
    expect(r.motif).toBeNull();
  });

  it("refuse : champ inconnu, ratio hors liste, opérateur, fréquence, seuil décimal ou hors bornes", () => {
    for (const mauvais of [
      covenant({ exces: 1 }),
      covenant({ ratio: "marge_brute" }),
      covenant({ ratio: "bfr_jours" }),
      covenant({ operateur: "egal" }),
      covenant({ frequence: "mensuelle" }),
      covenant({ seuil_pb: 1.5 }),
      covenant({ seuil_pb: 100_000_001 }),
      covenant({ seuil_pb: "12000" }),
      covenant({ preteur: "x".repeat(121) }),
    ]) {
      expect(redCovenantsVersionCreationSchema.safeParse({ covenants: [mauvais] }).success).toBe(
        false,
      );
    }
    expect(redCovenantsVersionCreationSchema.safeParse({ covenants: [], exces: 1 }).success).toBe(
      false,
    );
    expect(redCovenantsVersionCreationSchema.safeParse({}).success).toBe(false);
  });

  it("refuse : doublon de (ratio, opérateur), plancher au-dessus du plafond, plus de 12", () => {
    const doublon = redCovenantsVersionCreationSchema.safeParse({
      covenants: [covenant(), covenant({ seuil_pb: 1 })],
    });
    expect(doublon.success).toBe(false);
    const bande = redCovenantsVersionCreationSchema.safeParse({
      covenants: [covenant({ seuil_pb: 20_000 }), covenant({ operateur: "max", seuil_pb: 10_000 })],
    });
    expect(bande.success).toBe(false);
    const trop = redCovenantsVersionCreationSchema.safeParse({
      covenants: Array.from({ length: RED_COVENANTS_PAR_VERSION_MAX + 1 }, (_, i) =>
        covenant({ ratio: RED_COVENANT_RATIOS[i % RED_COVENANT_RATIOS.length], seuil_pb: i }),
      ),
    });
    expect(trop.success).toBe(false);
  });
});

const ligne = (extra: Record<string, unknown> = {}) => ({
  periode: 1,
  sens: "emploi",
  nature: "investissements",
  montant: 1_000_000,
  ...extra,
});
const plan = (extra: Record<string, unknown> = {}) => ({
  date_debut: "2026-07-01",
  type_periode: "annee",
  nombre_periodes: 3,
  lignes: [ligne(), ligne({ sens: "ressource", nature: "apport_associes", periode: 3 })],
  ...extra,
});

describe("redFinancementVersionCreationSchema", () => {
  it("accepte un plan valide, sans ligne, avec libellé et motif facultatifs", () => {
    expect(redFinancementVersionCreationSchema.safeParse(plan()).success).toBe(true);
    expect(redFinancementVersionCreationSchema.safeParse(plan({ lignes: [] })).success).toBe(true);
    const r = redFinancementVersionCreationSchema.parse(
      plan({ lignes: [ligne({ libelle: "Machine" })], motif: "Version initiale" }),
    );
    expect(r.lignes[0]?.libelle).toBe("Machine");
  });

  it("refuse : date hors 1er du mois ou hors bornes, type, nombre de périodes, champ inconnu", () => {
    for (const mauvais of [
      plan({ date_debut: "2026-07-02" }),
      plan({ date_debut: "1999-01-01" }),
      plan({ date_debut: "2026-02-30" }),
      plan({ type_periode: "trimestre" }),
      plan({ nombre_periodes: 0 }),
      plan({ nombre_periodes: 9 }),
      plan({ nombre_periodes: 1.5 }),
      plan({ exces: 1 }),
    ]) {
      expect(redFinancementVersionCreationSchema.safeParse(mauvais).success).toBe(false);
    }
  });

  it("refuse : nature hors de la liste du sens, période au-delà du plan, montant nul, décimal ou trop grand", () => {
    for (const mauvaise of [
      ligne({ nature: "apport_associes" }),
      ligne({ sens: "ressource", nature: "investissements" }),
      ligne({ periode: 4 }),
      ligne({ periode: 0 }),
      ligne({ montant: 0 }),
      ligne({ montant: 1.5 }),
      ligne({ montant: 10_000_000_000_001 }),
      ligne({ sens: "autre" }),
      ligne({ libelle: "x".repeat(201) }),
      ligne({ exces: 1 }),
    ]) {
      expect(
        redFinancementVersionCreationSchema.safeParse(plan({ lignes: [mauvaise] })).success,
      ).toBe(false);
    }
  });

  it("refuse plus de 200 lignes", () => {
    const lignes = Array.from({ length: RED_FINANCEMENT_LIGNES_MAX + 1 }, () => ligne());
    expect(redFinancementVersionCreationSchema.safeParse(plan({ lignes })).success).toBe(false);
    expect(
      redFinancementVersionCreationSchema.safeParse(plan({ lignes: lignes.slice(1) })).success,
    ).toBe(true);
  });
});

describe("redFinancementPropositionQuerySchema", () => {
  it("tout est facultatif ; le nombre de périodes est converti depuis le texte", () => {
    expect(redFinancementPropositionQuerySchema.parse({})).toEqual({});
    expect(
      redFinancementPropositionQuerySchema.parse({
        date_debut: "2026-10-01",
        type_periode: "semestre",
        nombre_periodes: "4",
      }),
    ).toEqual({ date_debut: "2026-10-01", type_periode: "semestre", nombre_periodes: 4 });
  });

  it("refuse : valeurs hors bornes ou paramètres inconnus", () => {
    for (const mauvais of [
      { nombre_periodes: "0" },
      { nombre_periodes: "9" },
      { nombre_periodes: "1.5" },
      { type_periode: "mois" },
      { date_debut: "2026-10-15" },
      { exces: "1" },
    ]) {
      expect(redFinancementPropositionQuerySchema.safeParse(mauvais).success).toBe(false);
    }
  });
});
