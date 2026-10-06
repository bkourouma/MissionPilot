/**
 * Moteurs de calcul du domaine finance : fonctions pures, déterministes,
 * sans base, sans réseau ni horloge (la date est toujours un paramètre).
 * Montants en entiers d'unités mineures ; voir `calcul-exact.ts` pour la
 * règle d'arrondi unique.
 */
export { ErreurFinance, type CodeErreurFinance } from "./erreurs";
export * from "./monnaie";
export * from "./grille-taux";
export * from "./budget";
export {
  calculerMarge,
  valeurTemps,
  tauxRealisation,
  encoursMission,
  encoursPortefeuille,
  tauxFacturabilite,
  delaiMoyenEncaissement,
  carnetCommandes,
  ecartTerminaison,
  consommationBudgetaire,
  agregerRentabilite,
  type ComposantesMarge,
  type Marge,
  type TempsValorisable,
  type Encours,
  type FactureEncaissee,
  type CommandeMission,
  type EcartTerminaison,
  type AxeRentabilite,
  type RentabiliteMission,
  type RentabiliteAgregee,
} from "./rentabilite";
export * from "./balance-agee";
export * from "./facture";
export * from "./echeancier";
export * from "./approbation";
