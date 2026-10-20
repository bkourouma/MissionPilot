/**
 * AGT-08 : moteur pur du copilote conversationnel. Routage déterministe d'un message en français
 * vers un outil d'un catalogue FERMÉ (mots-clés, normalisation sans accents, extraction de
 * paramètres simples) et gabarits de réponse (pluriels, états vides). Fonctions pures, sans
 * horloge, sans accès à la base, sans modèle de langage : les chiffres des réponses viennent des
 * services de l'API, jamais d'un texte généré.
 */
export * from "./catalogue";
export * from "./normalisation";
export * from "./intentions";
export * from "./gabarits";
export {
  extraireCommentaire,
  extraireEcheance,
  extraireFactureRelance,
  extraireNomMission,
  extraireTache,
  extraireTexteRecherche,
  type CommentaireExtrait,
  type ResultatEcheance,
  type TacheExtraite,
} from "./extraction";
