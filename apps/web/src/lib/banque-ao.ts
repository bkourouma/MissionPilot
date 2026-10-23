/*
 * Banques et offres des appels d'offres (lot AO-B : AO-04 à AO-07), côté web : types des
 * réponses, sous-pages, droits d'affichage (l'API reste la source de vérité), libellés et
 * lecture des saisies. Aucun calcul : années d'expérience, contrôles et montants viennent de
 * l'API (moteurs `banque-cv` et `offre-financiere`).
 *
 * Sous-modules : `banque-ao-types` (types et racine), `banque-ao-libelles` (navigation, droits,
 * libellés), `banque-ao-saisie-cv`, `banque-ao-saisie-offres` (lecture des saisies),
 * `banque-ao-messages` (erreurs, chemins, choix).
 */

export * from "./banque-ao-types";
export * from "./banque-ao-libelles";
export * from "./banque-ao-saisie-cv";
export * from "./banque-ao-saisie-offres";
export * from "./banque-ao-messages";
