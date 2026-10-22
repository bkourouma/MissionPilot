/** Indicateurs : définitions du PRD (libellé, définition, niveaux, fréquence, droit requis). */

// --- Définitions (PRD) ---------------------------------------------------------------------

export type IdIndicateur =
  | "occupation"
  | "facturabilite"
  | "consommation"
  | "ecart"
  | "marge"
  | "realisation"
  | "encours"
  | "delai"
  | "carnet"
  | "jalons"
  | "discipline";

/** Droit qui conditionne la présence de l'indicateur dans la réponse. */
export type DroitIndicateur = "finance" | "montants" | null;

export interface DefinitionIndicateur {
  id: IdIndicateur;
  libelle: string;
  definition: string;
  niveaux: string;
  frequence: string;
  droit: DroitIndicateur;
}

export const DEFINITIONS: readonly DefinitionIndicateur[] = [
  {
    id: "occupation",
    libelle: "Taux d'occupation",
    definition: "Jours affectés / jours disponibles",
    niveaux: "Collaborateur, grade, cabinet",
    frequence: "Hebdomadaire",
    droit: null,
  },
  {
    id: "facturabilite",
    libelle: "Taux de facturabilité",
    definition: "Jours facturables réalisés / jours disponibles",
    niveaux: "Collaborateur, grade, cabinet",
    frequence: "Mensuelle",
    droit: null,
  },
  {
    id: "consommation",
    libelle: "Consommation budgétaire",
    definition: "Jours réalisés / jours budgétés",
    niveaux: "Tâche, phase, mission",
    frequence: "Hebdomadaire",
    droit: null,
  },
  {
    id: "ecart",
    libelle: "Écart à terminaison",
    definition: "Atterrissage − budget, en jours et en FCFA",
    niveaux: "Mission, portefeuille d'un directeur",
    frequence: "Hebdomadaire",
    droit: null,
  },
  {
    id: "marge",
    libelle: "Marge de mission",
    definition:
      "(Honoraires − coûts internes − débours non refacturés − sous-traitance) / honoraires",
    niveaux: "Mission, client, type, associé",
    frequence: "Mensuelle",
    droit: "finance",
  },
  {
    id: "realisation",
    libelle: "Taux de réalisation",
    definition: "Honoraires facturés / valeur des temps au taux standard",
    niveaux: "Mission, associé",
    frequence: "À la clôture",
    droit: "finance",
  },
  {
    id: "encours",
    libelle: "Encours de production",
    definition: "Valeur des temps réalisés non encore facturés",
    niveaux: "Mission, cabinet",
    frequence: "Mensuelle",
    droit: "finance",
  },
  {
    id: "delai",
    libelle: "Délai moyen d'encaissement",
    definition: "Jours entre émission et encaissement des factures",
    niveaux: "Client, cabinet",
    frequence: "Mensuelle",
    droit: null,
  },
  {
    id: "carnet",
    libelle: "Carnet de commandes",
    definition: "Honoraires signés restant à produire",
    niveaux: "Cabinet, associé",
    frequence: "Mensuelle",
    droit: "montants",
  },
  {
    id: "jalons",
    libelle: "Respect des jalons",
    definition: "Jalons tenus / jalons prévus",
    niveaux: "Mission",
    frequence: "Mensuelle",
    droit: null,
  },
  {
    id: "discipline",
    libelle: "Discipline de saisie",
    definition: "Feuilles de temps soumises dans les délais / feuilles attendues",
    niveaux: "Collaborateur, équipe",
    frequence: "Hebdomadaire",
    droit: null,
  },
];

export const MESSAGE_RESERVE = "Réservé aux associés et gestionnaires.";
