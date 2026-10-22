/*
 * Notation augmentée (PRD complémentaire §11.1) côté interface : types des réponses de l'API,
 * chemins, libellés et lecture des paramètres d'URL. Aucun chiffre n'est calculé ici : indice
 * de confiance, contributions, simulation, mesures de calibration et priorités viennent de
 * l'API (moteurs). Les fonctions ne font que présenter.
 *
 * Sous-modules : `notation-augmentee-types`, `-analyse`, `-banque`, `-erreurs`, `-calibration`,
 * `-parametres`.
 */
export * from "./notation-augmentee-types";
export * from "./notation-augmentee-analyse";
export * from "./notation-augmentee-banque";
export * from "./notation-augmentee-erreurs";
export * from "./notation-augmentee-calibration";
export * from "./notation-augmentee-parametres";
