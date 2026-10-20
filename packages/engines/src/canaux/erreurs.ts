/**
 * Erreurs des moteurs des canaux externes simulés (lot 3c : WhatsApp, SMS, transcription,
 * signature électronique).
 *
 * Une entrée mal formée lève une `ErreurCanaux` portant un code STABLE : l'appelant traduit le
 * code, jamais le message. Les messages sont fixes et ne citent jamais une valeur reçue (numéro,
 * texte d'un message, secret).
 */
export const MESSAGES_ERREUR_CANAUX = {
  NUMERO_INVALIDE: "Numéro de téléphone invalide (format international attendu).",
  VARIABLE_INVALIDE: "Variable de gabarit invalide.",
  GABARIT_INCONNU: "Gabarit inconnu.",
  ORIGINE_INVALIDE: "Origine web invalide.",
  TEXTE_TROP_LONG: "Texte trop long.",
  VARIANTE_SMS_ABSENTE: "Ce gabarit n'a pas de variante SMS.",
  SMS_TROP_LONG: "Texte SMS trop long ou hors alphabet GSM-7.",
  ENTREE_INVALIDE: "Entrée invalide.",
  VALEUR_INVALIDE: "Valeur décimale invalide.",
  HISTORIQUE_INVALIDE: "Historique de mesures invalide.",
  TEXTE_VIDE: "Transcription vide.",
  DUREE_INVALIDE: "Durée invalide.",
  DUREE_MAX: "Durée de l'audio supérieure au plafond.",
  SEGMENTS_TROP_NOMBREUX: "Trop de segments.",
  SEGMENTS_CHEVAUCHANT: "Segments non triés ou qui se chevauchent.",
  SEGMENT_HORS_DUREE: "Segment hors de la durée de l'audio.",
  CONFIANCE_INVALIDE: "Confiance hors de l'intervalle 0 à 1000.",
  EVENEMENT_INVALIDE: "Événement de preuve invalide.",
  EMPREINTE_INVALIDE: "Empreinte invalide.",
} as const;

export type CodeErreurCanaux = keyof typeof MESSAGES_ERREUR_CANAUX;

export class ErreurCanaux extends Error {
  readonly code: CodeErreurCanaux;

  constructor(code: CodeErreurCanaux) {
    super(MESSAGES_ERREUR_CANAUX[code]);
    this.name = "ErreurCanaux";
    this.code = code;
  }
}
