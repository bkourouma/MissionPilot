/**
 * Offre financière d'un appel d'offres (AO-07) : jours par expert, taux, per diem, débours,
 * taxes, totaux et conversion, en entiers exacts.
 */
export {
  calculerOffreFinanciere,
  ErreurOffreFinanciere,
  joursDepuisCentiemes,
  LIGNES_MAX as OFFRE_FINANCIERE_LIGNES_MAX,
  QUANTITE_MAX as OFFRE_FINANCIERE_QUANTITE_MAX,
  TAXES_MAX as OFFRE_FINANCIERE_TAXES_MAX,
  type AssietteTaxe,
  type CodeErreurOffreFinanciere,
  type ConversionOffre,
  type EntreeOffreFinanciere,
  type JoursExpert,
  type LigneCalculee,
  type LigneHonoraires,
  type LigneHonorairesCalculee,
  type LigneQuantite,
  type ResultatOffreFinanciere,
  type Taxe,
  type TaxeCalculee,
} from "./offre-financiere";
