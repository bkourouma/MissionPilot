/**
 * Moteurs du dossier client vivant (DOS-02 à DOS-06, PRD complémentaire §5) :
 * contrôles d'équilibre d'un état financier ingéré, lecture exacte d'un
 * montant saisi en texte, indice de fiabilité des données du client, frise
 * chronologique, valeur courante des faits et facteurs datés. Fonctions pures
 * et déterministes ; montants en entiers d'unités mineures.
 */
export { ErreurDossier, type CodeErreurDossier } from "./erreurs";
export { MONTANT_TEXTE_MAX, lireMontantTexte } from "./montants";
export {
  SECTIONS_ETAT_FINANCIER,
  ROLES_LIGNE_ETAT,
  LIGNES_ETAT_MAX,
  MONTANT_LIGNE_ETAT_MAX,
  TOLERANCE_ETAT_MAX,
  CODES_CONTROLE_ETAT,
  validerLignesEtat,
  controlerEtatFinancier,
  type SectionEtatFinancier,
  type RoleLigneEtat,
  type LigneEtatFinancier,
  type OptionsControleEtat,
  type CodeControleEtat,
  type StatutConstatEtat,
  type ConstatControleEtat,
  type TotauxEtatFinancier,
  type ControleEtatFinancier,
} from "./etat-financier";
export {
  CERTIFICATIONS_COMPTES,
  NIVEAUX_INFORMEL,
  CLASSES_FIABILITE_DOSSIER,
  BAREME_FIABILITE_DOSSIER_DEFAUT,
  CODES_RECOMMANDATION_FIABILITE,
  moisRevolus,
  indiceFiabiliteDossier,
  type CertificationComptes,
  type NiveauInformel,
  type ClasseFiabiliteDossier,
  type BaremeFiabiliteDossier,
  type EtatPourFiabilite,
  type EntreeFiabiliteDossier,
  type CodeRecommandationFiabilite,
  type RecommandationFiabilite,
  type DetailFiabiliteDossier,
  type IndiceFiabiliteDossier,
} from "./fiabilite";
export {
  TYPES_EVENEMENT_FRISE,
  FRISE_LIMITE_MAX,
  FRISE_EVENEMENTS_MAX,
  cleDateFrise,
  construireFrise,
  type TypeEvenementFrise,
  type EvenementFrise,
  type OptionsFrise,
  type Frise,
} from "./frise";
export {
  valeursCourantesDatees,
  contexteDepuisFacteurs,
  type ValeurDatee,
} from "./valeurs-courantes";
