/**
 * Notation d'une mission (service 1, NOT-01 à NOT-07) : types des réponses de l'API, libellés,
 * mise en forme et droits d'affichage. Logique pure, testée dans `notation.test.ts`.
 *
 * RÈGLE : aucun chiffre de notation n'est calculé ici. Scores, classes, couvertures, écarts,
 * ajustements cumulés, forces, faiblesses et comparaisons viennent TELS QUELS de l'API (et de
 * ses moteurs) ; ce module ne fait que les joindre par identifiant et les mettre en forme.
 *
 * Les droits ci-dessous sont un confort d'affichage (bouton visible ou explication) : l'API
 * reste seule juge (permissions, rôle `expert_metier`, séparation des tâches).
 *
 * Aucune réponse de questionnaire n'est conservée dans le navigateur : la page est rendue par
 * le serveur à chaque affichage, sans stockage local ni cache.
 *
 * Sous-modules : `notation-types` (réponses de l'API), `notation-libelles`, `notation-droits`,
 * `notation-saisies` (validation et erreurs), `notation-chemins`, `notation-choix`.
 */
export * from "./notation-types";
export * from "./notation-libelles";
export * from "./notation-droits";
export * from "./notation-saisies";
export * from "./notation-chemins";
export * from "./notation-choix";
