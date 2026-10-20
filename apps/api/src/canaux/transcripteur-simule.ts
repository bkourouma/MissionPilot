import { z } from "zod";
import {
  ErreurTranscription,
  type CodeLangue,
  type DemandeTranscription,
  type ResultatTranscription,
  type SegmentTranscrit,
  type Transcripteur,
} from "./ports.js";

/*
 * TranscripteurSimule (SPEC-3c §4.2) : ne décode AUCUN vrai audio. Il n'accepte qu'un CONTENEUR DE
 * TEST : en-tête de page OGG de 27 octets (« OggS », version 0, 0 segment), puis la ligne ASCII
 * « MPSIM1 » et un saut de ligne, puis un JSON UTF-8 de 64 Kio au plus :
 * { "texte", "langue", "duree_ms", "confiance" 0..1000, "segments"?, "panne"?: "indisponible"|"delai" }.
 * Tout autre audio (y compris un vrai OGG) : `AUDIO_NON_SIMULE`, définitif : aucune donnée réelle
 * de personne n'entre. Le test fabrique un conteneur par `apps/api/test/audio-test.ts`.
 */

export const LANGUES_SIMULEES: readonly CodeLangue[] = ["fr", "dyu", "wol", "bam", "lin"];
export const MODELE_SIMULE = "simule-v1";
export const TAILLE_JSON_CONTENEUR_MAX = 64 * 1024;
const TAILLE_ENTETE_OGG = 27;
const MARQUE = Buffer.from("MPSIM1\n", "ascii");

const langueSchema = z.enum(["fr", "dyu", "wol", "bam", "lin"]);
const conteneurSchema = z
  .object({
    texte: z.string().max(200_000),
    langue: langueSchema.default("fr"),
    duree_ms: z.number().int().min(0).max(1_800_000),
    confiance: z.number().int().min(0).max(1000),
    segments: z
      .array(
        z
          .object({
            debut_ms: z.number().int().min(0),
            fin_ms: z.number().int().min(0),
            texte: z.string().max(200_000),
            confiance: z.number().int().min(0).max(1000),
          })
          .strict(),
      )
      .max(5000)
      .optional(),
    panne: z.enum(["indisponible", "delai"]).optional(),
  })
  .strict();

/** Vrai si l'audio commence comme un conteneur de test (en-tête OGG de 27 octets puis marque). */
function estConteneurDeTest(audio: Buffer): boolean {
  return (
    audio.length > TAILLE_ENTETE_OGG + MARQUE.length &&
    audio.subarray(0, 4).toString("ascii") === "OggS" &&
    audio[4] === 0 &&
    audio[TAILLE_ENTETE_OGG - 1] === 0 &&
    audio.subarray(TAILLE_ENTETE_OGG, TAILLE_ENTETE_OGG + MARQUE.length).equals(MARQUE)
  );
}

export class TranscripteurSimule implements Transcripteur {
  readonly fournisseur = "simule";
  readonly mode = "simule" as const;

  langues(): readonly CodeLangue[] {
    return LANGUES_SIMULEES;
  }

  async transcrire(demande: DemandeTranscription): Promise<ResultatTranscription> {
    if (demande.langue !== "auto" && !LANGUES_SIMULEES.includes(demande.langue)) {
      throw new ErreurTranscription("LANGUE_NON_PRISE_EN_CHARGE", false);
    }
    if (demande.typeMime !== "audio/ogg" || !estConteneurDeTest(demande.audio)) {
      throw new ErreurTranscription("AUDIO_NON_SIMULE", false);
    }
    const json = demande.audio.subarray(TAILLE_ENTETE_OGG + MARQUE.length);
    if (json.length > TAILLE_JSON_CONTENEUR_MAX)
      throw new ErreurTranscription("AUDIO_ILLISIBLE", false);
    let brut: unknown;
    try {
      brut = JSON.parse(json.toString("utf8"));
    } catch {
      throw new ErreurTranscription("AUDIO_ILLISIBLE", false);
    }
    const lu = conteneurSchema.safeParse(brut);
    if (!lu.success) throw new ErreurTranscription("AUDIO_ILLISIBLE", false);
    const c = lu.data;
    if (c.panne === "indisponible") throw new ErreurTranscription("INDISPONIBLE", true);
    // Issue INCONNUE (délai) : non réessayable.
    if (c.panne === "delai") throw new ErreurTranscription("INDISPONIBLE", false);
    const segments: readonly SegmentTranscrit[] = c.segments
      ? c.segments.map((s) => ({
          debutMs: s.debut_ms,
          finMs: s.fin_ms,
          texte: s.texte,
          confiance: s.confiance,
        }))
      : [{ debutMs: 0, finMs: c.duree_ms, texte: c.texte, confiance: c.confiance }];
    return {
      texte: c.texte,
      segments,
      langueDetectee: c.langue,
      dureeAudioMs: c.duree_ms,
      modele: MODELE_SIMULE,
    };
  }
}

/** Contenu du conteneur de test (champs du JSON, voir l'en-tête du fichier). */
export interface ContenuConteneurTest {
  texte: string;
  langue?: CodeLangue;
  dureeMs: number;
  confiance: number;
  segments?: readonly { debutMs: number; finMs: number; texte: string; confiance: number }[];
  panne?: "indisponible" | "delai";
}

/**
 * Fabrique un conteneur de test : en-tête de page OGG de 27 octets (« OggS », version 0, 0 segment),
 * ligne « MPSIM1 », puis le JSON. Ce n'est PAS de l'audio : le simulateur de développement et les
 * tests s'en servent pour « parler », sans aucune donnée réelle de personne.
 */
export function fabriquerConteneurAudioSimule(c: ContenuConteneurTest): Buffer {
  const entete = Buffer.alloc(TAILLE_ENTETE_OGG);
  entete.write("OggS", 0, "ascii");
  const json = JSON.stringify({
    texte: c.texte,
    langue: c.langue ?? "fr",
    duree_ms: c.dureeMs,
    confiance: c.confiance,
    ...(c.segments
      ? {
          segments: c.segments.map((s) => ({
            debut_ms: s.debutMs,
            fin_ms: s.finMs,
            texte: s.texte,
            confiance: s.confiance,
          })),
        }
      : {}),
    ...(c.panne ? { panne: c.panne } : {}),
  });
  return Buffer.concat([entete, MARQUE, Buffer.from(json, "utf8")]);
}
