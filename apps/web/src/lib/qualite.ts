/**
 * Qualité et responsabilité professionnelle (QUA-01 à QUA-04, QUA-06 à QUA-08) : types des
 * réponses de l'API, libellés, chemins, validations de saisie et droits d'affichage. Logique
 * pure, testée dans `qualite.test.ts`.
 *
 * RÈGLE : la garde de chaque classe, la séparation des tâches, la définition de terminé et le
 * NPS sont jugés ou calculés par l'API (moteur `evaluerGarde`, contrôles déterministes,
 * `syntheseNps`). Ce module n'en recalcule rien : il met en forme ce que l'API renvoie. Les
 * droits ci-dessous sont un confort d'affichage ; l'API reste seule juge.
 *
 * Sous-modules : `qualite-types`, `qualite-libelles`, `qualite-chemins`, `qualite-validation`.
 */
export * from "./qualite-types";
export * from "./qualite-libelles";
export * from "./qualite-chemins";
export * from "./qualite-validation";
