import { z } from "zod";
import { texte } from "./commun";
import type { ModeFournisseurCanal } from "./canaux";

/*
 * AGT-11, lot 3c (ADR-013) : transcription d'un audio téléversé. Fournisseur SIMULÉ : il n'accepte
 * qu'un conteneur de test, jamais un vrai audio. La transcription est un BROUILLON à relire :
 * texte automatique (version 1), versions humaines, validation par un autre que le dernier
 * modificateur (sauf associé). Une transcription non validée ne nourrit ni le dossier client, ni
 * le registre des preuves, ni un rapport. Le consentement à l'enregistrement est déclaré et
 * référencé (O-09).
 *
 * Les types audio sont déclarés ICI : l'extension de la liste blanche générale des fichiers
 * (`TYPES_FICHIER` et `EXTENSIONS_FICHIER` de `documents.ts`, SPEC §4.4) relève de l'intégration du
 * lot, car elle impose un libellé de plus aux écrans de fichiers.
 */

export const LANGUES_TRANSCRIPTION = ["fr", "dyu", "wol", "bam", "lin"] as const;
export type LangueTranscription = (typeof LANGUES_TRANSCRIPTION)[number];
export const LANGUES_DEMANDEES_TRANSCRIPTION = [...LANGUES_TRANSCRIPTION, "auto"] as const;
export type LangueDemandeeTranscription = (typeof LANGUES_DEMANDEES_TRANSCRIPTION)[number];

export const STATUTS_TRANSCRIPTION = [
  "en_file",
  "en_cours",
  "a_relire",
  "validee",
  "rejetee",
  "echec",
] as const;
export type StatutTranscription = (typeof STATUTS_TRANSCRIPTION)[number];

export const ORIGINES_VERSION_TRANSCRIPTION = ["automatique", "humaine"] as const;
export type OrigineVersionTranscription = (typeof ORIGINES_VERSION_TRANSCRIPTION)[number];

export const CODES_ERREUR_TRANSCRIPTION = [
  "AUDIO_NON_SIMULE",
  "LANGUE_NON_PRISE_EN_CHARGE",
  "AUDIO_ILLISIBLE",
  "INDISPONIBLE",
] as const;
export type CodeErreurTranscription = (typeof CODES_ERREUR_TRANSCRIPTION)[number];

/** Types audio de la liste blanche, détectés par le contenu (SPEC §4.4). */
export const TYPES_AUDIO = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"] as const;
export type TypeAudio = (typeof TYPES_AUDIO)[number];

/** Extensions admises par type audio : l'extension du nom doit correspondre au contenu. */
export const EXTENSIONS_AUDIO: Record<TypeAudio, readonly string[]> = {
  "audio/ogg": ["ogg", "oga", "opus"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a"],
  "audio/wav": ["wav"],
};

export const NIVEAUX_CONFIANCE_TRANSCRIPTION = ["bon", "moyen", "faible"] as const;

/** Limites (valeurs PROVISOIRES : SPEC §13, O-08). */
export const PLAFONDS_TRANSCRIPTION = {
  dureeMaxMinutes: 30,
  minutesParMoisEtCabinet: 600,
  enFileMax: 10,
  creationsPar10Min: 20,
  tailleAudioMaxOctets: 15 * 1024 * 1024,
  texteMaxCaracteres: 200_000,
  segmentsMax: 5000,
  listeLimiteMax: 100,
  listeLimiteDefaut: 30,
} as const;

/* ----- Libellés français ----- */

export const LIBELLES_LANGUE_TRANSCRIPTION: Record<LangueDemandeeTranscription, string> = {
  fr: "Français",
  dyu: "Dioula",
  wol: "Wolof",
  bam: "Bambara",
  lin: "Lingala",
  auto: "Détection automatique",
};

export const LIBELLES_STATUT_TRANSCRIPTION: Record<StatutTranscription, string> = {
  en_file: "En file d'attente",
  en_cours: "En cours",
  a_relire: "À relire",
  validee: "Validée",
  rejetee: "Rejetée",
  echec: "Échec",
};

export const LIBELLES_ORIGINE_VERSION_TRANSCRIPTION: Record<OrigineVersionTranscription, string> = {
  automatique: "Transcription automatique",
  humaine: "Correction humaine",
};

export const LIBELLES_ERREUR_TRANSCRIPTION: Record<CodeErreurTranscription, string> = {
  AUDIO_NON_SIMULE: "Cet audio n'est pas un enregistrement de test accepté par le simulateur.",
  LANGUE_NON_PRISE_EN_CHARGE: "Cette langue n'est pas prise en charge.",
  AUDIO_ILLISIBLE: "L'audio est illisible.",
  INDISPONIBLE: "Le service de transcription est indisponible.",
};

export const LIBELLES_NIVEAU_CONFIANCE: Record<
  (typeof NIVEAUX_CONFIANCE_TRANSCRIPTION)[number],
  string
> = {
  bon: "Confiance bonne",
  moyen: "Confiance moyenne",
  faible: "Confiance faible",
};

export const AVERTISSEMENT_TRANSCRIPTION =
  "Brouillon à relire : une transcription non validée n'est utilisée nulle part ailleurs.";

/* ----- Schémas d'entrée ----- */

const uuid = z.string().uuid();
const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PLAFONDS_TRANSCRIPTION.listeLimiteMax)
  .default(PLAFONDS_TRANSCRIPTION.listeLimiteDefaut);

export const transcriptionParamSchema = z.object({ id: uuid }).strict();

/**
 * `POST /missions/:id/transcriptions` : un audio déjà téléversé par `POST /api/fichiers`, la
 * langue, le consentement à l'enregistrement DÉCLARÉ (obligatoire) avec sa référence (10 à 500
 * caractères) et, facultativement, la durée annoncée en secondes (sans elle, le plafond mensuel
 * suppose 30 minutes).
 */
export const transcriptionCreationSchema = z
  .object({
    fichier_id: uuid,
    langue: z.enum(LANGUES_DEMANDEES_TRANSCRIPTION),
    enregistrement_consenti: z.literal(true),
    reference_consentement: z.string().trim().min(10).max(500),
    duree_secondes: z
      .number()
      .int()
      .min(1)
      .max(PLAFONDS_TRANSCRIPTION.dureeMaxMinutes * 60)
      .optional(),
  })
  .strict();
export type TranscriptionCreation = z.infer<typeof transcriptionCreationSchema>;

/** `PUT /transcriptions/:id/texte` : nouvelle version humaine (en-tête `If-Match` : numéro de version). */
export const transcriptionTexteSchema = z
  .object({
    texte: z
      .string()
      .max(PLAFONDS_TRANSCRIPTION.texteMaxCaracteres)
      .refine((t) => t.trim() !== "", "Le texte ne peut pas être vide."),
  })
  .strict();

/** Valeur de l'en-tête `If-Match` : le numéro de version lu (entre guillemets ou non). */
export const transcriptionIfMatchSchema = z
  .string()
  .regex(/^"?\d{1,9}"?$/)
  .transform((v) => Number(v.replace(/"/g, "")))
  .pipe(z.number().int().min(1));

/** Corps vide : validation. */
export const transcriptionValidationSchema = z.object({}).strict();
/** Rejet : motif obligatoire. */
export const transcriptionRejetSchema = z.object({ motif: texte(500) }).strict();

export const transcriptionsQuerySchema = z
  .object({
    statut: z.enum(STATUTS_TRANSCRIPTION).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/* ----- Réponses proposées ----- */

export interface SegmentTranscriptionApi {
  readonly debut_ms: number;
  readonly fin_ms: number;
  readonly texte: string;
  /** Entier de 0 à 1000 (pour mille). */
  readonly confiance: number;
}

export interface TranscriptionApi {
  readonly id: string;
  readonly mission_id: string;
  readonly fichier_id: string;
  readonly langue_demandee: LangueDemandeeTranscription;
  readonly langue_detectee: LangueTranscription | null;
  readonly statut: StatutTranscription;
  readonly confiance_pm: number | null;
  readonly niveau_confiance: (typeof NIVEAUX_CONFIANCE_TRANSCRIPTION)[number] | null;
  readonly duree_audio_ms: number | null;
  readonly erreur_code: CodeErreurTranscription | null;
  readonly mode_fournisseur: ModeFournisseurCanal;
  readonly cree_par: string;
  readonly cree_le: string;
  readonly valide_par: string | null;
  readonly valide_le: string | null;
  readonly motif_rejet: string | null;
  /** L'audio est effacé 30 jours après la décision (90 sans décision). */
  readonly audio_disponible: boolean;
  /** FIN-02 : ABSENT sans `finance.lire`, jamais masqué par un zéro. */
  readonly cout_estime_micro_usd?: number | null;
}

export interface VersionTranscriptionApi {
  readonly numero: number;
  readonly origine: OrigineVersionTranscription;
  readonly texte: string;
  readonly auteur_id: string | null;
  readonly cree_le: string;
  /** Segments de la version 1 (automatique) seulement. */
  readonly segments?: readonly SegmentTranscriptionApi[];
}

export interface TranscriptionDetailApi extends TranscriptionApi {
  readonly versions: readonly VersionTranscriptionApi[];
}
