/*
 * Composants du cycle « brouillon IA → modifié → validé » (SOC-06), réutilisables par les écrans
 * des services de conseil. Logique et libellés : `lib/ia-contenu.ts`, `lib/ia-diff.ts`.
 */
export {
  BadgeContenuIa,
  BadgeEssaiIa,
  BadgeGabaritIa,
  BadgeStatutGenerationIa,
} from "./BadgeContenuIa";
export {
  BandeauChiffresNonVerifies,
  type BandeauChiffresNonVerifiesProps,
} from "./BandeauChiffresNonVerifies";
export { BoutonGenerationIa, type BoutonGenerationIaProps } from "./BoutonGenerationIa";
export { DiffTexteIa } from "./DiffTexteIa";
export { HistoriqueVersionsIa } from "./HistoriqueVersionsIa";
export { PanneauContenuIa, type PanneauContenuIaProps } from "./PanneauContenuIa";
export { useSuiviGeneration, type SuiviGeneration } from "./useSuiviGeneration";
