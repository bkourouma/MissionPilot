/**
 * Transcription d'un audio téléversé (AGT-11, lot 3c, ADR-013) : brouillon à relire, versions
 * humaines, validation. Logique pure, testée dans `transcriptions.test.ts`.
 *
 * Fournisseur SIMULÉ : il n'accepte qu'un conteneur de test, jamais un vrai audio (« Simulé :
 * aucun envoi réel »). Une transcription non validée n'est utilisée nulle part ailleurs. L'audio
 * a son propre sélecteur : la liste blanche générale des fichiers (`TYPES_FICHIER`) n'est pas
 * étendue, les types audio viennent de `TYPES_AUDIO` / `EXTENSIONS_AUDIO`.
 */
import {
  aPermission,
  EXTENSIONS_AUDIO,
  LANGUES_DEMANDEES_TRANSCRIPTION,
  LIBELLES_ERREUR_TRANSCRIPTION,
  LIBELLES_LANGUE_TRANSCRIPTION,
  LIBELLES_NIVEAU_CONFIANCE,
  LIBELLES_ORIGINE_VERSION_TRANSCRIPTION,
  LIBELLES_STATUT_TRANSCRIPTION,
  PLAFONDS_TRANSCRIPTION,
  TYPES_AUDIO,
  type LangueDemandeeTranscription,
  type Role,
  type SegmentTranscriptionApi,
  type StatutTranscription,
  type TranscriptionApi,
  type TranscriptionDetailApi,
  type VersionTranscriptionApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import { extensionDe, formaterTaille } from "./fichiers";
import type { Resultat } from "./saisie";

export { PLAFONDS_TRANSCRIPTION };
export type {
  SegmentTranscriptionApi,
  TranscriptionApi,
  TranscriptionDetailApi,
  VersionTranscriptionApi,
};

export { AVERTISSEMENT_TRANSCRIPTION } from "@missionpilot/shared";

// --- Chemins ---------------------------------------------------------------------------------

const enc = encodeURIComponent;

export const cheminApiTranscriptions = (missionId: string) =>
  `/api/missions/${enc(missionId)}/transcriptions`;
/** Téléversement de l'audio : route dédiée (la liste blanche générale des fichiers n'est pas étendue à l'audio). */
export const cheminApiAudioTranscription = (missionId: string) =>
  `/api/missions/${enc(missionId)}/transcriptions/audio`;
export const cheminApiTranscription = (id: string) => `/api/transcriptions/${enc(id)}`;
export const cheminApiTexteTranscription = (id: string) => `/api/transcriptions/${enc(id)}/texte`;
export const cheminApiActionTranscription = (id: string, action: "valider" | "rejeter") =>
  `/api/transcriptions/${enc(id)}/${action}`;
/** Écoute : route dédiée (`GET /api/fichiers/:id` ne sert pas un fichier cité par une transcription). */
export const hrefAudioTranscription = (id: string) => `/api/transcriptions/${enc(id)}/audio`;

export const hrefTranscriptions = (missionId: string) =>
  `/missions/${enc(missionId)}/transcriptions`;
export const hrefTranscription = (missionId: string, id: string) =>
  `${hrefTranscriptions(missionId)}/${enc(id)}`;

/** Plafond de `limite` des routes de transcription. */
export const LIMITE_LISTE_TRANSCRIPTIONS = PLAFONDS_TRANSCRIPTION.listeLimiteMax;

// --- Libellés --------------------------------------------------------------------------------

export const libelleStatutTranscription = (s: string | null | undefined) =>
  (s ? (LIBELLES_STATUT_TRANSCRIPTION as Record<string, string>)[s] : undefined) ?? "—";

export const libelleLangue = (l: string | null | undefined) =>
  (l ? (LIBELLES_LANGUE_TRANSCRIPTION as Record<string, string>)[l] : undefined) ?? "—";

export const libelleOrigineVersion = (o: string | null | undefined) =>
  (o ? (LIBELLES_ORIGINE_VERSION_TRANSCRIPTION as Record<string, string>)[o] : undefined) ?? "—";

export const libelleErreurTranscription = (c: string | null | undefined) =>
  (c ? (LIBELLES_ERREUR_TRANSCRIPTION as Record<string, string>)[c] : undefined) ??
  "La transcription a échoué.";

export const OPTIONS_LANGUE_TRANSCRIPTION = LANGUES_DEMANDEES_TRANSCRIPTION.map((l) => ({
  valeur: l,
  libelle: LIBELLES_LANGUE_TRANSCRIPTION[l],
}));

export function tonaliteStatutTranscription(s: StatutTranscription | string): TonaliteStatut {
  switch (s) {
    case "validee":
      return "succes";
    case "a_relire":
    case "en_file":
    case "en_cours":
      return "attention";
    case "echec":
    case "rejetee":
      return "danger";
    default:
      return "neutre";
  }
}

/** Le résultat n'est pas encore là : la page propose d'actualiser. */
export const transcriptionEnAttente = (statut: StatutTranscription | string) =>
  statut === "en_file" || statut === "en_cours";

// --- Durée, confiance ------------------------------------------------------------------------

/** « 3 min 05 s », « 42 s » ; « — » si inconnue. */
export function formaterDuree(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const secondes = total % 60;
  if (minutes === 0) return `${secondes} s`;
  return `${minutes} min ${String(secondes).padStart(2, "0")} s`;
}

/** Position dans l'audio : « 0:12 », « 12:05 ». */
export function formaterPosition(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type NiveauConfiance = "bon" | "moyen" | "faible";

/** Mêmes seuils que le moteur (`niveauConfiance`) : « bon » dès 800, « moyen » dès 600 (pour mille). */
export function niveauConfiancePm(pm: number | null | undefined): NiveauConfiance | null {
  if (pm === null || pm === undefined || !Number.isFinite(pm)) return null;
  return pm >= 800 ? "bon" : pm >= 600 ? "moyen" : "faible";
}

export function libelleNiveauConfiance(n: NiveauConfiance | null): string {
  return n ? LIBELLES_NIVEAU_CONFIANCE[n] : "Confiance inconnue";
}

export function tonaliteConfiance(n: NiveauConfiance | null): TonaliteStatut {
  if (n === "bon") return "succes";
  if (n === "moyen") return "attention";
  if (n === "faible") return "danger";
  return "neutre";
}

/** Confiance en pourcentage lisible : 850 (pour mille) → « 85 % ». */
export function formaterConfiance(pm: number | null | undefined): string {
  if (pm === null || pm === undefined || !Number.isFinite(pm)) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(pm / 10)} %`;
}

// --- Versions --------------------------------------------------------------------------------

/** Versions de la plus récente à la plus ancienne. */
export function versionsRecentesDabord(
  versions: readonly VersionTranscriptionApi[],
): VersionTranscriptionApi[] {
  return [...versions].sort((a, b) => b.numero - a.numero);
}

/** Version courante : le numéro le plus élevé (celle qu'on corrige et qu'on valide). */
export function versionCourante(
  versions: readonly VersionTranscriptionApi[],
): VersionTranscriptionApi | null {
  return versionsRecentesDabord(versions)[0] ?? null;
}

/** Segments de la version automatique (seule à en porter), triés par début. */
export function segmentsDe(
  versions: readonly VersionTranscriptionApi[],
): SegmentTranscriptionApi[] {
  const v1 = versions.find((v) => v.numero === 1 && v.segments !== undefined);
  return [...(v1?.segments ?? [])].sort((a, b) => a.debut_ms - b.debut_ms);
}

/** Valeur de l'en-tête `If-Match` : le numéro de version lu, entre guillemets. */
export const enteteIfMatch = (numero: number) => `"${numero}"`;

// --- Droits et séparation des tâches ---------------------------------------------------------

export interface ActionsTranscription {
  corriger: boolean;
  valider: boolean;
  rejeter: boolean;
  ecouter: boolean;
  /** Pourquoi on ne peut pas valider alors que le droit existe, sinon `null`. */
  motifValidationImpossible: string | null;
}

/** Dernier auteur HUMAIN : une validation ne revient pas à lui, sauf associé (`MPH07`). */
export function dernierAuteurHumain(versions: readonly VersionTranscriptionApi[]): string | null {
  const humaines = versionsRecentesDabord(versions).filter(
    (v) => v.origine === "humaine" && v.auteur_id,
  );
  return humaines[0]?.auteur_id ?? null;
}

export function actionsTranscription(entree: {
  transcription: Pick<TranscriptionApi, "statut" | "audio_disponible">;
  versions: readonly VersionTranscriptionApi[];
  roles: readonly Role[];
  utilisateurId: string;
}): ActionsTranscription {
  const { transcription, versions, roles, utilisateurId } = entree;
  const aRelire = transcription.statut === "a_relire";
  const peutValider = aPermission(roles, "transcription.valider") && aRelire;
  const dernier = dernierAuteurHumain(versions);
  const memePersonne = dernier !== null && dernier === utilisateurId && !roles.includes("associe");
  return {
    corriger: aPermission(roles, "transcription.gerer") && aRelire,
    valider: peutValider && !memePersonne,
    rejeter: peutValider,
    ecouter: aPermission(roles, "transcription.lire") && transcription.audio_disponible,
    motifValidationImpossible:
      peutValider && memePersonne
        ? "Vous avez corrigé ce texte : une autre personne doit le valider (séparation des tâches)."
        : null,
  };
}

// --- Audio : sélecteur dédié -----------------------------------------------------------------

/** Valeur de l'attribut `accept` du champ audio. */
export function acceptAudio(): string {
  return TYPES_AUDIO.flatMap((t) => [t, ...EXTENSIONS_AUDIO[t].map((e) => `.${e}`)]).join(",");
}

/** « OGG, OGA, OPUS, MP3, M4A ou WAV ». */
export function extensionsAudioLisibles(): string {
  const ext = TYPES_AUDIO.flatMap((t) => EXTENSIONS_AUDIO[t]).map((e) => e.toUpperCase());
  return `${ext.slice(0, -1).join(", ")} ou ${ext[ext.length - 1]}`;
}

const MO_MAX = Math.floor(PLAFONDS_TRANSCRIPTION.tailleAudioMaxOctets / (1024 * 1024));

export type ControleAudio = { ok: true } | { ok: false; message: string };

/**
 * Contrôle local d'un audio choisi : non vide, 15 Mo au plus, extension audio admise. Le serveur
 * reste seul juge (type par le contenu) ; en mode simulé il n'accepte qu'un enregistrement de test.
 */
export function controlerAudio(f: { name: string; size: number }): ControleAudio {
  if (f.size <= 0) return { ok: false, message: "Ce fichier est vide : choisissez-en un autre." };
  if (f.size > PLAFONDS_TRANSCRIPTION.tailleAudioMaxOctets) {
    return {
      ok: false,
      message: `Fichier trop volumineux (${formaterTaille(f.size)}) : ${MO_MAX} Mo au plus.`,
    };
  }
  const ext = extensionDe(f.name);
  const admises = TYPES_AUDIO.flatMap((t) => EXTENSIONS_AUDIO[t]) as readonly string[];
  if (!ext || !admises.includes(ext)) {
    return {
      ok: false,
      message: `Type de fichier non accepté : choisissez un enregistrement ${extensionsAudioLisibles()}.`,
    };
  }
  return { ok: true };
}

// --- Création --------------------------------------------------------------------------------

export interface SaisieTranscription {
  langue: string;
  consenti: boolean;
  reference: string;
  /** Durée annoncée en minutes (facultative), nombre entier. */
  dureeMinutes: string;
}

export type ChampTranscription = "langue" | "consenti" | "reference" | "dureeMinutes";

export interface ChargeTranscription {
  langue: LangueDemandeeTranscription;
  enregistrement_consenti: true;
  reference_consentement: string;
  duree_secondes?: number;
}

/**
 * Corps de `POST /api/missions/:id/transcriptions` (sans `fichier_id`, ajouté après le
 * téléversement). Le consentement à l'enregistrement est DÉCLARÉ (case) et référencé (10 à 500
 * caractères) : sans les deux, rien n'est envoyé.
 */
export function validerTranscription(
  s: SaisieTranscription,
): Resultat<ChargeTranscription, ChampTranscription> {
  const erreurs: Partial<Record<ChampTranscription, string>> = {};
  const langue = (LANGUES_DEMANDEES_TRANSCRIPTION as readonly string[]).includes(s.langue)
    ? (s.langue as LangueDemandeeTranscription)
    : null;
  if (!langue) erreurs.langue = "Choisissez la langue de l'enregistrement.";
  if (!s.consenti) {
    erreurs.consenti =
      "Cochez la case : la transcription exige le consentement de la personne enregistrée.";
  }
  const reference = s.reference.trim();
  if (reference.length < 10) {
    erreurs.reference =
      "Indiquez comment le consentement a été recueilli, en 10 caractères au moins (ex. accord oral enregistré le 12/03/2027).";
  } else if (reference.length > 500) {
    erreurs.reference = "La référence ne doit pas dépasser 500 caractères.";
  }
  let duree: number | undefined;
  const brut = s.dureeMinutes.trim();
  if (brut !== "") {
    const minutes = /^\d{1,3}$/.test(brut) ? Number(brut) : Number.NaN;
    if (Number.isNaN(minutes) || minutes < 1 || minutes > PLAFONDS_TRANSCRIPTION.dureeMaxMinutes) {
      erreurs.dureeMinutes = `La durée annoncée est de 1 à ${PLAFONDS_TRANSCRIPTION.dureeMaxMinutes} minutes.`;
    } else {
      duree = minutes * 60;
    }
  }
  if (Object.keys(erreurs).length > 0 || !langue) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      langue,
      enregistrement_consenti: true,
      reference_consentement: reference,
      ...(duree !== undefined ? { duree_secondes: duree } : {}),
    },
  };
}

/** Texte corrigé : non vide, 200 000 caractères au plus. */
export function validerCorrectionTexte(texte: string): Resultat<{ texte: string }, "texte"> {
  if (texte.trim() === "") {
    return { ok: false, erreurs: { texte: "Le texte ne peut pas être vide." } };
  }
  if (texte.length > PLAFONDS_TRANSCRIPTION.texteMaxCaracteres) {
    return {
      ok: false,
      erreurs: {
        texte: `Le texte ne doit pas dépasser ${PLAFONDS_TRANSCRIPTION.texteMaxCaracteres.toLocaleString("fr-FR")} caractères.`,
      },
    };
  }
  return { ok: true, charge: { texte } };
}

export function validerRejetTranscription(motif: string): Resultat<{ motif: string }, "motif"> {
  const t = motif.trim();
  if (t === "") return { ok: false, erreurs: { motif: "Indiquez le motif du rejet." } };
  if (t.length > 500) {
    return { ok: false, erreurs: { motif: "Le motif ne doit pas dépasser 500 caractères." } };
  }
  return { ok: true, charge: { motif: t } };
}

// --- Erreurs ---------------------------------------------------------------------------------

export function messageErreurTranscription(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "PLAFOND_TRANSCRIPTION") {
      return "Le plafond de transcription est atteint (durée, minutes du mois ou transcriptions en attente). Réessayez plus tard.";
    }
    if (e.code === "TYPE_FICHIER_REFUSE") {
      return "Fichier audio refusé par le serveur : en mode simulé, seul un enregistrement de test est accepté.";
    }
    if (e.code === "FICHIER_TROP_VOLUMINEUX")
      return `Fichier trop volumineux : ${MO_MAX} Mo au plus.`;
    if (e.statut === 412 || e.code === "VERSION_PERIMEE") {
      return "Le texte a été modifié depuis votre lecture. Rechargez la page pour repartir de la dernière version.";
    }
    if (e.code === "TROP_DE_REQUETES") {
      return "Trop de demandes en peu de temps. Patientez quelques instants avant de réessayer.";
    }
  }
  return messageErreur(e);
}
