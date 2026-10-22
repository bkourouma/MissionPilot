/**
 * Contenus du plan stratégique (diagnostic, SWOT, vision et mission, axes, objectifs,
 * initiatives) : état des formulaires, contrôles en français (mêmes bornes que les schémas de
 * `@missionpilot/shared`, l'API reste juge), construction des `donnees` envoyées à l'API et
 * texte comparable d'une version (historique, différences). Logique pure, testée dans
 * `plan-elements.test.ts`.
 *
 * Une version reprend TOUJOURS l'ensemble du contenu (API) : le formulaire de modification
 * est prérempli avec la version courante. Les gains annuels d'une initiative (base du ROI)
 * sont saisis par le consultant, une valeur par année d'horizon ; la VAN et le TRI sont
 * calculés par le moteur de l'API, jamais ici.
 *
 * Sous-modules : `plan-elements-saisie`, `plan-elements-controles`, `plan-elements-liens`,
 * `plan-elements-texte`.
 */
export * from "./plan-elements-saisie";
export * from "./plan-elements-controles";
export * from "./plan-elements-liens";
export * from "./plan-elements-texte";
