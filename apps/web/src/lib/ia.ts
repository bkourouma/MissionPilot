/**
 * Paramètres IA du cabinet (ADR-003) : état et mode, clé OpenRouter, modèles par tâche, plafond
 * mensuel, prompts versionnés, coûts et messages d'erreur. Logique pure, testée dans
 * `ia.test.ts` ; l'API reste seule juge des droits et des règles.
 *
 * La clé API n'existe que dans l'état du formulaire qui la saisit : jamais dans le stockage du
 * navigateur, une URL ou un journal, jamais renvoyée par l'API (`cle_configuree` seulement).
 *
 * Sous-modules ré-exportés ici : `ia-parametres`, `ia-plafond` (clé, plafond, reconfirmation),
 * `ia-modeles`, `ia-prompts` et `ia-couts`.
 */
import type { Langue } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";

export * from "./ia-parametres";
export * from "./ia-plafond";
export * from "./ia-modeles";
export * from "./ia-prompts";
export * from "./ia-couts";

// --- Erreurs ---------------------------------------------------------------------------------

/** Codes du fournisseur (502) : leur message, fixe et en français, vient de l'API. */
export const CODES_ERREUR_FOURNISSEUR = [
  "CLE_REFUSEE",
  "CREDIT_FOURNISSEUR_INSUFFISANT",
  "FOURNISSEUR_INDISPONIBLE",
  "DELAI_DEPASSE",
  "REQUETE_REFUSEE",
  "REPONSE_INVALIDE",
  "REPONSE_TROP_GRANDE",
] as const;

export const MESSAGE_CLE_ILLISIBLE =
  "Le serveur ne parvient plus à déchiffrer la clé API du cabinet (clé de chiffrement du serveur changée ?). Par sécurité, la clé de la plateforme ne la remplace pas : les contenus sont produits par les gabarits. Enregistrez de nouveau la clé OpenRouter du cabinet.";

export const MESSAGE_CLE_ILLISIBLE_EN =
  "The server can no longer decrypt the firm's API key (server encryption key changed?). For security, the platform key does not replace it: content is produced by templates. Save the firm's OpenRouter key again.";

export const MESSAGES_ERREURS_IA_EN: Readonly<Record<string, string>> = {
  PLAFOND_IA_ATTEINT:
    "The firm's monthly AI cost ceiling has been reached: AI is refused until next month or until the ceiling is raised. Content can be produced from the template.",
  CHIFFRES_NON_VERIFIES:
    "Some numbers in this content do not come from the calculation engines: check them, tick the attestation box, then approve.",
  CONTENU_VALIDE:
    "This content has already been approved: it is final and can no longer be edited.",
  CLE_IA_ABSENTE:
    "No API key is available: AI runs in template mode. Save an OpenRouter key to use it.",
  IA_DESACTIVEE:
    'AI is disabled for the firm: enable it ("Enable AI" button) before testing the connection.',
  CLE_IA_ILLISIBLE: MESSAGE_CLE_ILLISIBLE_EN,
  GENERATIONS_SIMULTANEES:
    "Too many AI generations are running for the firm: try again in a moment.",
};

export const MESSAGES_ERREURS_IA: Readonly<Record<string, string>> = {
  PLAFOND_IA_ATTEINT:
    "Le plafond mensuel de coût IA du cabinet est atteint : l'IA est refusée jusqu'au mois prochain ou au relèvement du plafond. Les contenus peuvent être produits par le gabarit.",
  CHIFFRES_NON_VERIFIES:
    "Des nombres de ce contenu ne viennent pas des moteurs de calcul : vérifiez-les, cochez la case d'attestation, puis validez.",
  CONTENU_VALIDE: "Ce contenu a déjà été validé : il est définitif et ne se modifie plus.",
  CLE_IA_ABSENTE:
    "Aucune clé API n'est disponible : l'IA fonctionne en mode gabarit. Enregistrez une clé OpenRouter pour l'utiliser.",
  IA_DESACTIVEE:
    "L'IA est désactivée pour le cabinet : activez-la (bouton « Activer l'IA ») avant de tester la connexion.",
  CLE_IA_ILLISIBLE: MESSAGE_CLE_ILLISIBLE,
  GENERATIONS_SIMULTANEES:
    "Trop de générations IA sont en cours pour le cabinet : réessayez dans un instant.",
};

/** Message affichable d'une erreur d'appel IA (toujours en français). */
export function messageErreurIa(e: unknown, langue: Langue = "fr"): string {
  if (!(e instanceof ErreurApi)) return messageErreur(e);
  const fixe = (langue === "en" ? MESSAGES_ERREURS_IA_EN : MESSAGES_ERREURS_IA)[e.code];
  if (fixe) return fixe;
  // Refus explicites de l'API (séparation des tâches, fournisseur, quota journalier
  // QUOTA_IA_UTILISATEUR dont le nombre vient de l'API) : son message précis.
  if (
    e.code === "APPROBATION_REQUISE" ||
    (CODES_ERREUR_FOURNISSEUR as readonly string[]).includes(e.code) ||
    (e.statut === 429 && e.code !== "ERREUR_INATTENDUE")
  ) {
    return e.message;
  }
  return messageErreur(e);
}

export const estPlafondAtteint = (e: unknown) =>
  e instanceof ErreurApi && e.code === "PLAFOND_IA_ATTEINT";

/** Titre et texte de l'échec du test de connexion (clé illisible : alerte dédiée). */
export function erreurTestConnexion(
  e: unknown,
  langue: Langue = "fr",
): { titre: string; message: string } {
  const code = e instanceof ErreurApi ? e.code : null;
  const en = langue === "en";
  const titre =
    code === "CLE_IA_ILLISIBLE"
      ? en
        ? "Firm API key unreadable"
        : "Clé API du cabinet illisible"
      : code === "IA_DESACTIVEE"
        ? en
          ? "AI is not enabled"
          : "L'IA n'est pas activée"
        : en
          ? "The connection failed"
          : "La connexion a échoué";
  return { titre, message: messageErreurIa(e, langue) };
}
