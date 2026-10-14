/**
 * Erreurs typées du moteur de redressement (SPEC-3a, §6.2).
 *
 * Un écart de données (ratio non calculable, score insuffisant, semaine de tension) n'est
 * JAMAIS une erreur : c'est un constat rendu par le moteur. Seule une entrée mal formée en
 * lève une. L'API traduit le code (jamais le message) ; les messages ne recopient aucune
 * valeur saisie (ni montant ni nom).
 */
export type CodeErreurRedressement =
  | "MONTANT_INVALIDE"
  | "SOMME_HORS_LIMITES"
  | "ENTREE_INVALIDE"
  | "DATE_INVALIDE"
  | "POSTE_INCONNU"
  | "CORRESPONDANCE_INVALIDE"
  | "ETAT_INVALIDE"
  | "QUESTION_INCONNUE"
  | "REPONSE_INVALIDE"
  | "SEUILS_INVALIDES"
  | "SEMAINE_INVALIDE"
  | "TRESORERIE_INVALIDE"
  | "REALISE_NON_CONTIGU"
  | "ECHEANCIER_INVALIDE"
  | "ACCORD_SUPERIEUR_CREANCE"
  | "PAIEMENT_EXCESSIF"
  | "ACCORD_ROMPU"
  | "PLAN_INVALIDE"
  | "LEVIER_INCONNU"
  | "PARAMETRES_LEVIER_INVALIDES"
  | "BASE_INCOMPLETE";

export class ErreurRedressement extends Error {
  readonly code: CodeErreurRedressement;
  /** Postes ou champs absents (BASE_INCOMPLETE, CORRESPONDANCE_INVALIDE) : rendus en `details.manquants`. */
  readonly manquants: readonly string[];

  constructor(code: CodeErreurRedressement, message: string, manquants: readonly string[] = []) {
    super(message);
    this.name = "ErreurRedressement";
    this.code = code;
    this.manquants = manquants;
  }
}
