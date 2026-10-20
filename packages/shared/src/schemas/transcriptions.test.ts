import { describe, expect, it } from "vitest";
import {
  AVERTISSEMENT_TRANSCRIPTION,
  CODES_ERREUR_TRANSCRIPTION,
  EXTENSIONS_AUDIO,
  LANGUES_DEMANDEES_TRANSCRIPTION,
  LANGUES_TRANSCRIPTION,
  LIBELLES_ERREUR_TRANSCRIPTION,
  LIBELLES_LANGUE_TRANSCRIPTION,
  LIBELLES_ORIGINE_VERSION_TRANSCRIPTION,
  LIBELLES_STATUT_TRANSCRIPTION,
  PLAFONDS_TRANSCRIPTION,
  STATUTS_TRANSCRIPTION,
  transcriptionCreationSchema,
  transcriptionIfMatchSchema,
  transcriptionParamSchema,
  transcriptionRejetSchema,
  transcriptionsQuerySchema,
  transcriptionTexteSchema,
  transcriptionValidationSchema,
  TYPES_AUDIO,
} from "./transcriptions";

const UUID = "3f2c9b1e-0000-4000-8000-000000000001";
const creation = {
  fichier_id: UUID,
  langue: "fr",
  enregistrement_consenti: true,
  reference_consentement: "Consentement écrit du 2026-10-12",
};

describe("listes et libellés", () => {
  it("langues, statuts, erreurs : un libellé français par valeur", () => {
    expect(LANGUES_TRANSCRIPTION).toEqual(["fr", "dyu", "wol", "bam", "lin"]);
    expect(Object.keys(LIBELLES_LANGUE_TRANSCRIPTION).sort()).toEqual(
      [...LANGUES_DEMANDEES_TRANSCRIPTION].sort(),
    );
    expect(Object.keys(LIBELLES_STATUT_TRANSCRIPTION).sort()).toEqual(
      [...STATUTS_TRANSCRIPTION].sort(),
    );
    expect(Object.keys(LIBELLES_ERREUR_TRANSCRIPTION).sort()).toEqual(
      [...CODES_ERREUR_TRANSCRIPTION].sort(),
    );
    expect(Object.keys(LIBELLES_ORIGINE_VERSION_TRANSCRIPTION).sort()).toEqual([
      "automatique",
      "humaine",
    ]);
    expect(AVERTISSEMENT_TRANSCRIPTION).toContain("Brouillon");
  });

  it("types audio et extensions : l'extension doit correspondre au contenu", () => {
    expect(TYPES_AUDIO).toEqual(["audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"]);
    for (const t of TYPES_AUDIO) expect(EXTENSIONS_AUDIO[t].length).toBeGreaterThan(0);
    expect(EXTENSIONS_AUDIO["audio/wav"]).toEqual(["wav"]);
    // Jamais l'extension d'un format non audio.
    for (const extensions of Object.values(EXTENSIONS_AUDIO)) {
      expect(extensions).not.toContain("pdf");
      expect(extensions).not.toContain("exe");
    }
  });

  it("plafonds de la SPEC §13", () => {
    expect(PLAFONDS_TRANSCRIPTION).toMatchObject({
      dureeMaxMinutes: 30,
      minutesParMoisEtCabinet: 600,
      enFileMax: 10,
      creationsPar10Min: 20,
      tailleAudioMaxOctets: 15 * 1024 * 1024,
      texteMaxCaracteres: 200_000,
      segmentsMax: 5000,
    });
  });
});

describe("transcriptionCreationSchema", () => {
  it("cas nominal", () => {
    expect(transcriptionCreationSchema.safeParse(creation).success).toBe(true);
    expect(
      transcriptionCreationSchema.safeParse({ ...creation, langue: "auto", duree_secondes: 660 })
        .success,
    ).toBe(true);
  });

  it("le consentement à l'enregistrement est obligatoire et vrai", () => {
    expect(
      transcriptionCreationSchema.safeParse({ ...creation, enregistrement_consenti: false })
        .success,
    ).toBe(false);
    expect(
      transcriptionCreationSchema.safeParse({ ...creation, enregistrement_consenti: undefined })
        .success,
    ).toBe(false);
  });

  it("référence du consentement : 10 à 500 caractères", () => {
    expect(
      transcriptionCreationSchema.safeParse({ ...creation, reference_consentement: "123456789" })
        .success,
    ).toBe(false);
    expect(
      transcriptionCreationSchema.safeParse({
        ...creation,
        reference_consentement: "x".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("langue connue ; durée de 1 s à 30 min ; aucun champ inconnu", () => {
    expect(transcriptionCreationSchema.safeParse({ ...creation, langue: "en" }).success).toBe(
      false,
    );
    expect(transcriptionCreationSchema.safeParse({ ...creation, langue: "dyu" }).success).toBe(
      true,
    );
    expect(transcriptionCreationSchema.safeParse({ ...creation, duree_secondes: 0 }).success).toBe(
      false,
    );
    expect(
      transcriptionCreationSchema.safeParse({ ...creation, duree_secondes: 1800 }).success,
    ).toBe(true);
    expect(
      transcriptionCreationSchema.safeParse({ ...creation, duree_secondes: 1801 }).success,
    ).toBe(false);
    expect(transcriptionCreationSchema.safeParse({ ...creation, fichier_id: "x" }).success).toBe(
      false,
    );
    expect(transcriptionCreationSchema.safeParse({ ...creation, texte: "x" }).success).toBe(false);
  });
});

describe("autres corps", () => {
  it("texte corrigé : non vide, 200 000 caractères au plus", () => {
    expect(transcriptionTexteSchema.safeParse({ texte: "Bonjour" }).success).toBe(true);
    expect(transcriptionTexteSchema.safeParse({ texte: "   " }).success).toBe(false);
    expect(transcriptionTexteSchema.safeParse({ texte: "a".repeat(200_001) }).success).toBe(false);
    expect(transcriptionTexteSchema.safeParse({ texte: "a".repeat(200_000) }).success).toBe(true);
  });

  it("If-Match : numéro de version, guillemets tolérés", () => {
    expect(transcriptionIfMatchSchema.parse("3")).toBe(3);
    expect(transcriptionIfMatchSchema.parse('"12"')).toBe(12);
    expect(transcriptionIfMatchSchema.safeParse("0").success).toBe(false);
    expect(transcriptionIfMatchSchema.safeParse("abc").success).toBe(false);
    expect(transcriptionIfMatchSchema.safeParse("1234567890").success).toBe(false);
  });

  it("validation : corps vide ; rejet : motif obligatoire", () => {
    expect(transcriptionValidationSchema.safeParse({}).success).toBe(true);
    expect(transcriptionValidationSchema.safeParse({ x: 1 }).success).toBe(false);
    expect(transcriptionRejetSchema.safeParse({ motif: "Audio inaudible" }).success).toBe(true);
    expect(transcriptionRejetSchema.safeParse({ motif: " " }).success).toBe(false);
    expect(transcriptionRejetSchema.safeParse({}).success).toBe(false);
  });

  it("paramètre et liste", () => {
    expect(transcriptionParamSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(transcriptionParamSchema.safeParse({ id: "1" }).success).toBe(false);
    expect(transcriptionsQuerySchema.parse({}).limite).toBe(30);
    expect(transcriptionsQuerySchema.safeParse({ statut: "a_relire", limite: "100" }).success).toBe(
      true,
    );
    expect(transcriptionsQuerySchema.safeParse({ limite: "101" }).success).toBe(false);
    expect(transcriptionsQuerySchema.safeParse({ statut: "x" }).success).toBe(false);
  });
});
