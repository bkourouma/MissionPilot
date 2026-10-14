import type { CodeGabarit, CodeRefusEnvoi } from "@missionpilot/engines";

/*
 * Ports des canaux externes SIMULÉS (lot 3c, SPEC-3c §3). Types et erreurs seulement : aucune E/S,
 * aucune importation de la base, du trousseau ni de `config`. Les implémentations (fournisseurs
 * simulés ou locaux) sont des fichiers distincts. RÈGLE FERME : aucun adaptateur réel n'existe ;
 * `ModeFournisseur` vaut « reel » pour qu'un futur adaptateur ne soit jamais pris pour un simulé.
 *
 * Règles des ports : aucune erreur ne cite un numéro, un corps, un secret ni un texte ; un résultat
 * `refuse` avec `reessayable: true` est une GARANTIE du fournisseur que rien n'a été accepté ; toute
 * autre panne (délai, coupure, exception) lève `ErreurCanal` et rend l'issue INCONNUE (« au plus
 * une fois », SPEC-3c §7.1).
 */

export type { CodeGabarit, CodeRefusEnvoi };

export type ModeFournisseur = "simule" | "reel"; // « reel » réservé : aucun adaptateur n'existe
export type Canal = "whatsapp" | "sms";

/** Résultat d'un appel qui a abouti : le fournisseur a répondu, accepté ou refusé. */
export interface ResultatEnvoi {
  statut: "accepte" | "refuse";
  idExterne: string | null; // non nul si accepté
  codeRefus: CodeRefusEnvoi | null; // non nul si refusé
  reessayable: boolean; // refus seulement : le fournisseur certifie que rien n'a été accepté
}

export interface EnvoiGabarit {
  idempotence: string; // UUID de la ligne canaux_envois : le fournisseur simulé le respecte
  compte: string; // identifiant public du compte (canaux_comptes.identifiant_compte)
  numero: string; // E.164 en clair, en mémoire seulement, jamais journalisé
  gabarit: CodeGabarit; // catalogue fermé du moteur
  langue: "fr";
  variables: readonly string[]; // positionnelles, déjà validées par le moteur
  texte: string; // texte rendu (le simulé l'affiche ; un réel enverrait gabarit + variables)
}

export interface EnvoiSession {
  idempotence: string;
  compte: string;
  numero: string;
  texte: string; // réponse libre dans la fenêtre de service de 24 h, rendue par un gabarit « reponse_… »
}

export interface MediaRecu {
  contenu: Buffer;
  typeMime: string;
}

export type EvenementCanal =
  | {
      type: "message";
      idEvenement: string; // identifiant du fournisseur, clé d'anti-rejeu
      compte: string;
      numero: string; // E.164
      recuLe: Date;
      contenu:
        | { genre: "texte"; texte: string } // 4096 caractères au plus
        | { genre: "audio"; refMedia: string; typeMime: string; dureeMs: number | null }
        | { genre: "autre" };
    }
  | {
      type: "statut";
      idEvenement: string;
      compte: string;
      idExterneMessage: string;
      statut: "envoye" | "livre" | "lu" | "echec";
      recuLe: Date;
      codeRefus: CodeRefusEnvoi | null;
    };

export interface EntreeWebhook {
  entetes: Readonly<Record<string, string | undefined>>; // clés en minuscules
  corps: Buffer; // corps BRUT, tel que reçu
  maintenant: Date; // horloge injectable
  secrets: readonly string[]; // courant puis précédent (rotation)
}

export const MESSAGES_ERREUR_CANAL = {
  SIGNATURE_INVALIDE: "Signature du webhook invalide.",
  HORODATAGE_HORS_FENETRE: "Horodatage du webhook hors de la fenêtre admise.",
  CORPS_INVALIDE: "Corps du webhook invalide.",
  DELAI_DEPASSE: "Délai dépassé : l'issue de l'envoi est inconnue.",
  INDISPONIBLE_INCONNU: "Fournisseur indisponible : l'issue de l'envoi est inconnue.",
  NUMERO_REEL_REFUSE_EN_SIMULE:
    "Numéro refusé : un fournisseur simulé n'accepte que les numéros de test.",
  MEDIA_INTROUVABLE: "Média introuvable.",
} as const;
export type CodeErreurCanal = keyof typeof MESSAGES_ERREUR_CANAL;

/** Panne de transport : l'issue est INCONNUE (délai, coupure) ; ne pas réessayer sans preuve. */
export class ErreurCanal extends Error {
  constructor(readonly code: CodeErreurCanal) {
    super(MESSAGES_ERREUR_CANAL[code]); // messages fixes, sans numéro, sans corps, sans secret
    this.name = "ErreurCanal";
  }
}

export interface CanalWhatsApp {
  readonly fournisseur: string; // « simule »
  readonly mode: ModeFournisseur;
  envoyerGabarit(envoi: EnvoiGabarit): Promise<ResultatEnvoi>;
  envoyerSession(envoi: EnvoiSession): Promise<ResultatEnvoi>;
  /** Vérifie signature, horodatage et forme ; lève ErreurCanal sinon. Ne touche ni base ni réseau. */
  verifierWebhook(entree: EntreeWebhook): readonly EvenementCanal[]; // 50 événements au plus
  telechargerMedia(compte: string, refMedia: string): Promise<MediaRecu>;
}

export interface EnvoiSms {
  idempotence: string;
  compte: string; // expéditeur
  numero: string;
  gabarit: CodeGabarit;
  texte: string; // GSM-7, 160 caractères au plus
}
export interface PasserelleSms {
  readonly fournisseur: string;
  readonly mode: ModeFournisseur;
  envoyer(envoi: EnvoiSms): Promise<ResultatEnvoi>;
}

export type CodeLangue = "fr" | "dyu" | "wol" | "bam" | "lin"; // valeurs PROVISOIRES (O-08)

export interface DemandeTranscription {
  idempotence: string; // UUID de la transcription
  audio: Buffer; // 15 Mo au plus (FICHIER_TAILLE_MAX_OCTETS), en mémoire seulement
  typeMime: "audio/ogg" | "audio/mpeg" | "audio/mp4" | "audio/wav";
  langue: CodeLangue | "auto";
}
export interface SegmentTranscrit {
  debutMs: number;
  finMs: number;
  texte: string;
  confiance: number; // entier de 0 à 1000 (pour mille)
}
export interface ResultatTranscription {
  texte: string; // 200 000 caractères au plus
  segments: readonly SegmentTranscrit[]; // 5 000 au plus, triés, sans chevauchement
  langueDetectee: CodeLangue;
  dureeAudioMs: number;
  modele: string; // « simule-v1 »
}

export const MESSAGES_ERREUR_TRANSCRIPTION = {
  AUDIO_NON_SIMULE: "Audio refusé : un transcripteur simulé n'accepte que les conteneurs de test.",
  LANGUE_NON_PRISE_EN_CHARGE: "Langue non prise en charge par ce transcripteur.",
  AUDIO_ILLISIBLE: "Audio illisible.",
  INDISPONIBLE: "Transcripteur indisponible.",
} as const;
export type CodeErreurTranscription = keyof typeof MESSAGES_ERREUR_TRANSCRIPTION;

export class ErreurTranscription extends Error {
  constructor(
    readonly code: CodeErreurTranscription, // AUDIO_NON_SIMULE, LANGUE_NON_PRISE_EN_CHARGE, AUDIO_ILLISIBLE : définitifs
    readonly reessayable: boolean,
  ) {
    super(MESSAGES_ERREUR_TRANSCRIPTION[code]);
    this.name = "ErreurTranscription";
  }
}
export interface Transcripteur {
  readonly fournisseur: string;
  readonly mode: ModeFournisseur;
  langues(): readonly CodeLangue[];
  transcrire(demande: DemandeTranscription): Promise<ResultatTranscription>;
}

export interface DemandeSignatureExterne {
  idempotence: string; // UUID de signatures_demandes
  empreintesDocument: string; // SHA-256 hex (fichiers.sha256)
  nomDocument: string;
  signataires: readonly { id: string; rang: number; partie: "cabinet" | "client" }[];
  expireLe: Date;
}
export interface RefDemandeSignature {
  referenceExterne: string; // « loc-… » pour le fournisseur local
  parcours: "interne" | "externe"; // « externe » : le signataire est renvoyé à url (non livré)
  signataires: readonly { id: string; url: string | null }[];
}
export type EvenementSignature = {
  idEvenement: string;
  referenceExterne: string;
  signataireId: string | null;
  type: "invite" | "consulte" | "signe" | "refuse" | "expire";
  recuLe: Date;
};

export const MESSAGES_ERREUR_SIGNATURE = {
  EMPREINTE_INVALIDE: "Empreinte du document invalide (SHA-256 hexadécimal attendu).",
  ECHEANCE_INVALIDE: "Échéance de la demande de signature invalide.",
} as const;
export class ErreurSignature extends Error {
  constructor(readonly code: keyof typeof MESSAGES_ERREUR_SIGNATURE) {
    super(MESSAGES_ERREUR_SIGNATURE[code]);
    this.name = "ErreurSignature";
  }
}

export interface FournisseurSignature {
  readonly fournisseur: string; // « local »
  readonly mode: ModeFournisseur;
  /** Niveau REVENDIQUÉ : « simple_simulee » pour le fournisseur local, sans valeur juridique. */
  readonly niveau: "simple_simulee";
  creerDemande(demande: DemandeSignatureExterne): Promise<RefDemandeSignature>;
  annuler(referenceExterne: string, motif: string): Promise<void>;
  /** Dossier de preuve du fournisseur ; null pour le local (la preuve est notre journal). */
  recupererPreuves(referenceExterne: string): Promise<Buffer | null>;
  /** Fournisseur externe seulement ; absent du local. */
  verifierEvenement?(entree: EntreeWebhook): readonly EvenementSignature[];
}

export interface Canaux {
  whatsapp: CanalWhatsApp | null; // null : WHATSAPP_FOURNISSEUR=aucun
  sms: PasserelleSms | null;
  transcripteur: Transcripteur | null;
  signature: FournisseurSignature | null;
}
