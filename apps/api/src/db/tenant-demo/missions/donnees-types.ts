/*
 * Types de mission que le catalogue du socle (`/api/catalogue/semer-conseil`) ne fournit pas :
 * notation financière, redressement et due diligence. Le diagnostic flash et le business plan
 * bancable viennent des services candidats (`/api/services-candidats/activer`).
 *
 * Valeurs de départ plausibles (jours par grade, livrables, jalons) : le cabinet les a validées
 * (`a_valider` levé) par la route du catalogue. Données pures, sans appel réseau ni base.
 */

type Jours = Record<string, number>;

interface TacheModele {
  libelle: string;
  jours: Jours;
  livrable?: boolean;
  jalon?: boolean;
}

interface PhaseModele {
  libelle: string;
  taches: TacheModele[];
}

export interface TypeSupplementaire {
  code: string;
  libelle: string;
  domaine: string;
  mode_facturation: "forfait" | "regie" | "abonnement";
  duree_type_jours: number;
  equipe_type: { grade_code: string; nombre: number }[];
  phases: PhaseModele[];
}

export const TYPES_SUPPLEMENTAIRES: readonly TypeSupplementaire[] = [
  {
    code: "notation_financiere",
    libelle: "Notation financière",
    domaine: "Finance",
    mode_facturation: "forfait",
    duree_type_jours: 120,
    equipe_type: [
      { grade_code: "associe", nombre: 1 },
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 2 },
      { grade_code: "junior", nombre: 1 },
    ],
    phases: [
      {
        libelle: "Cadrage et collecte",
        taches: [
          {
            libelle: "Réunion de lancement et cahier des charges",
            jours: { senior: 1, manager: 1, associe: 0.5 },
            jalon: true,
          },
          {
            libelle: "Collecte des états financiers (3 à 5 exercices)",
            jours: { junior: 3, senior: 2 },
          },
          {
            libelle: "Envoi et suivi du questionnaire de notation",
            jours: { junior: 2, senior: 1.5, manager: 0.5 },
          },
        ],
      },
      {
        libelle: "Analyse et scoring",
        taches: [
          {
            libelle: "Retraitement et analyse des états financiers",
            jours: { junior: 5, senior: 4, manager: 1.5 },
          },
          {
            libelle: "Calcul des ratios et scoring quantitatif",
            jours: { senior: 3, manager: 1.5 },
          },
          {
            libelle: "Analyse qualitative (gouvernance, marché, management)",
            jours: { senior: 3, manager: 2, associe: 1 },
          },
        ],
      },
      {
        libelle: "Notation et restitution",
        taches: [
          {
            libelle: "Comité de notation",
            jours: { senior: 1, manager: 1.5, associe: 1.5 },
            jalon: true,
          },
          {
            libelle: "Rapport de notation et plan d'amélioration",
            jours: { senior: 3, manager: 2, associe: 1 },
            livrable: true,
          },
          {
            libelle: "Restitution au client",
            jours: { manager: 1, associe: 1 },
            jalon: true,
          },
        ],
      },
    ],
  },
  {
    code: "redressement",
    libelle: "Redressement d'entreprise en difficulté",
    domaine: "Restructuration",
    mode_facturation: "regie",
    duree_type_jours: 240,
    equipe_type: [
      { grade_code: "associe", nombre: 1 },
      { grade_code: "directeur", nombre: 1 },
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 2 },
    ],
    phases: [
      {
        libelle: "Diagnostic d'urgence",
        taches: [
          {
            libelle: "Revue de la trésorerie et prévision à 13 semaines",
            jours: { senior: 5, manager: 2, directeur: 1 },
          },
          {
            libelle: "Cartographie des créanciers et des échéances",
            jours: { junior: 3, senior: 3, manager: 1 },
          },
          {
            libelle: "Analyse des causes de la dégradation",
            jours: { senior: 4, manager: 2, directeur: 1.5, associe: 1 },
          },
          {
            libelle: "Restitution du diagnostic d'urgence",
            jours: { manager: 1, directeur: 1, associe: 1 },
            jalon: true,
          },
        ],
      },
      {
        libelle: "Plan de redressement",
        taches: [
          {
            libelle: "Négociation avec les créanciers et les banques",
            jours: { senior: 5, manager: 4, directeur: 3, associe: 2 },
          },
          {
            libelle: "Plan d'actions de redressement et plan de financement",
            jours: { senior: 6, manager: 3, directeur: 2 },
            livrable: true,
          },
          {
            libelle: "Validation du plan par le comité de pilotage",
            jours: { manager: 1, directeur: 1.5, associe: 1.5 },
            jalon: true,
          },
        ],
      },
      {
        libelle: "Suivi et clôture",
        taches: [
          {
            libelle: "Mise en œuvre et suivi hebdomadaire des actions",
            jours: { senior: 12, manager: 6, directeur: 2 },
          },
          {
            libelle: "Bilan de clôture du redressement",
            jours: { senior: 2, manager: 2, directeur: 1, associe: 1 },
            livrable: true,
            jalon: true,
          },
        ],
      },
    ],
  },
  {
    code: "due_diligence",
    libelle: "Due diligence",
    domaine: "Transactions",
    mode_facturation: "forfait",
    duree_type_jours: 100,
    equipe_type: [
      { grade_code: "associe", nombre: 1 },
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 2 },
      { grade_code: "junior", nombre: 1 },
    ],
    phases: [
      {
        libelle: "Cadrage",
        taches: [
          {
            libelle: "Lettre d'engagement et périmètre de la revue",
            jours: { manager: 1, associe: 1 },
            jalon: true,
          },
          {
            libelle: "Constitution de la liste des documents demandés",
            jours: { junior: 2, senior: 1 },
          },
        ],
      },
      {
        libelle: "Revue approfondie",
        taches: [
          {
            libelle: "Revue financière (qualité des résultats, dette nette, BFR)",
            jours: { junior: 5, senior: 5, manager: 2, associe: 1 },
          },
          {
            libelle: "Revue juridique, fiscale et sociale",
            jours: { senior: 4, manager: 3 },
          },
          {
            libelle: "Revue commerciale et de marché",
            jours: { junior: 4, senior: 4, manager: 1.5 },
          },
          {
            libelle: "Revue opérationnelle et des risques",
            jours: { junior: 3, senior: 3, manager: 1.5 },
          },
        ],
      },
      {
        libelle: "Synthèse et restitution",
        taches: [
          {
            libelle: "Rapport de due diligence",
            jours: { senior: 4, manager: 3, associe: 2 },
            livrable: true,
            jalon: true,
          },
          {
            libelle: "Présentation au comité d'investissement",
            jours: { manager: 1, associe: 1.5 },
            jalon: true,
          },
        ],
      },
    ],
  },
];

/** Prix fixe de démonstration du diagnostic flash (le produit n'en fournit aucun par défaut). */
export const PRIX_DIAGNOSTIC_FLASH = {
  montant: 1_800_000,
  devise: "XOF",
  commentaire: "Prix fixe du catalogue du cabinet (démonstration)",
};
