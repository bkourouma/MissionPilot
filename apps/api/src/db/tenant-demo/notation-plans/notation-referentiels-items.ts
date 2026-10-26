import type { CleCompteCabinet } from "../cles.js";

/*
 * Banque d'items de notation du cabinet « Tenant démo » (données de l'étape « notation-referentiels »).
 * Aucun chiffre calculé ici : poids, priorités et durées sont des paramètres d'items rédigés par
 * des consultants ; la sélection adaptative est faite par le moteur.
 */

/** Libellés de l'échelle de maturité (identiques à ceux de la grille générique). */
export const ECHELLE_ITEM = [
  "Inexistant",
  "Ponctuel, informel",
  "En place, appliqué en partie",
  "Systématique et suivi",
  "Systématique, mesuré et amélioré",
] as const;

export type Redacteur = Extract<
  CleCompteCabinet,
  "chef.mission" | "chef.mission.2" | "consultant" | "consultant.2" | "associe.2"
>;
type Valideur = Extract<CleCompteCabinet, "expert.metier" | "expert.metier.2">;

export interface DefItem {
  dimension: string;
  /** Identifiant de la pratique : celui de la question correspondante de la grille générique. */
  pratique: string;
  /** Groupe nominal de la pratique, repris dans les ancrages de chaque niveau. */
  nom: string;
  intitule: string;
  /** Formulation « tous publics » de la question. */
  question: string;
  /** Formulation propre à un public (dirigeants ou équipes). */
  public: "dirigeant" | "equipe";
  questionPublic: string;
  poids: number;
  priorite: number;
  dureeSecondes: number;
  auteur: Redacteur;
  /** Absent : l'item reste en brouillon (relecture en attente). */
  valideur?: Valideur;
  /** Une version 2 en brouillon est ouverte après la validation de la version 1. */
  versionSuivante?: { auteur: Redacteur; intitule: string };
}

export const ITEMS: readonly DefItem[] = [
  {
    dimension: "strategie",
    pratique: "strat.declinaison",
    nom: "la déclinaison de la stratégie en objectifs par service",
    intitule: "Déclinaison de la stratégie en objectifs opérationnels",
    question: "Dans quelle mesure chaque service connaît-il les objectifs qui découlent du plan ?",
    public: "dirigeant",
    questionPublic:
      "Votre stratégie est-elle traduite en objectifs chiffrés pour chaque direction ?",
    poids: 3,
    priorite: 1,
    dureeSecondes: 30,
    auteur: "chef.mission",
    valideur: "expert.metier",
  },
  {
    dimension: "strategie",
    pratique: "strat.revue",
    nom: "la revue périodique de la stratégie",
    intitule: "Revue périodique de la stratégie",
    question: "À quelle fréquence la direction confronte-t-elle le plan aux résultats réels ?",
    public: "dirigeant",
    questionPublic:
      "Revoyez-vous votre stratégie à intervalles réguliers avec votre équipe de direction ?",
    poids: 2,
    priorite: 2,
    dureeSecondes: 25,
    auteur: "consultant",
    valideur: "expert.metier.2",
    versionSuivante: {
      auteur: "chef.mission.2",
      intitule: "Revue périodique de la stratégie et arbitrages tracés",
    },
  },
  {
    dimension: "processus",
    pratique: "proc.cartographie",
    nom: "la cartographie des processus clés",
    intitule: "Cartographie des processus clés",
    question:
      "Les processus clés de l'entreprise sont-ils décrits et connus de ceux qui les exécutent ?",
    public: "equipe",
    questionPublic: "Savez-vous comment votre activité s'enchaîne avec celle des autres services ?",
    poids: 3,
    priorite: 1,
    dureeSecondes: 30,
    auteur: "consultant.2",
    valideur: "expert.metier",
  },
  {
    dimension: "processus",
    pratique: "proc.risques",
    nom: "la maîtrise des risques opérationnels",
    intitule: "Maîtrise des risques opérationnels",
    question:
      "Les risques majeurs des processus sont-ils identifiés avec des mesures de prévention ?",
    public: "dirigeant",
    questionPublic:
      "Disposez-vous d'un registre des risques opérationnels revu au moins chaque année ?",
    poids: 2,
    priorite: 3,
    dureeSecondes: 35,
    auteur: "chef.mission",
    valideur: "expert.metier.2",
  },
  {
    dimension: "pilotage",
    pratique: "pil.tableau_bord",
    nom: "le tableau de bord de direction",
    intitule: "Tableau de bord de direction",
    question:
      "La direction dispose-t-elle d'un tableau de bord à jour des indicateurs essentiels ?",
    public: "dirigeant",
    questionPublic: "Recevez-vous chaque mois un tableau de bord fiable de vos indicateurs clés ?",
    poids: 4,
    priorite: 1,
    dureeSecondes: 25,
    auteur: "consultant",
    valideur: "expert.metier",
    versionSuivante: {
      auteur: "consultant.2",
      intitule: "Tableau de bord de direction, cibles et responsables nommés",
    },
  },
  {
    dimension: "pilotage",
    pratique: "pil.fiabilite",
    nom: "la fiabilité des données de pilotage",
    intitule: "Fiabilité des données de pilotage",
    question: "Les chiffres présentés en comité de direction sont-ils vérifiés avant diffusion ?",
    public: "equipe",
    questionPublic:
      "Les chiffres que vous remontez à la direction sont-ils contrôlés par un tiers ?",
    poids: 3,
    priorite: 2,
    dureeSecondes: 30,
    auteur: "chef.mission.2",
    valideur: "expert.metier",
  },
  {
    dimension: "amelioration",
    pratique: "amel.causes",
    nom: "l'analyse des causes des écarts",
    intitule: "Analyse des causes des écarts constatés",
    question: "Quand un écart apparaît, cherche-t-on sa cause racine avant d'agir ?",
    public: "equipe",
    questionPublic:
      "Après un incident, votre équipe remonte-t-elle jusqu'à la cause plutôt qu'au symptôme ?",
    poids: 3,
    priorite: 1,
    dureeSecondes: 35,
    auteur: "consultant.2",
    valideur: "expert.metier.2",
  },
  {
    dimension: "amelioration",
    pratique: "amel.reclamations",
    nom: "le traitement des réclamations clients",
    intitule: "Traitement des réclamations clients",
    question: "Les réclamations sont-elles enregistrées, traitées et analysées pour s'améliorer ?",
    public: "dirigeant",
    questionPublic:
      "Suivez-vous le délai de traitement et les causes des réclamations de vos clients ?",
    poids: 2,
    priorite: 2,
    dureeSecondes: 30,
    auteur: "consultant",
  },
  {
    dimension: "organisation",
    pratique: "org.delegation",
    nom: "les délégations de pouvoir",
    intitule: "Délégations de pouvoir et de signature",
    question: "Les niveaux de décision et de signature sont-ils écrits et respectés ?",
    public: "dirigeant",
    questionPublic: "Avez-vous formalisé ce que chaque responsable peut décider sans vous ?",
    poids: 3,
    priorite: 1,
    dureeSecondes: 30,
    auteur: "chef.mission",
    valideur: "expert.metier",
  },
  {
    dimension: "organisation",
    pratique: "org.competences",
    nom: "la gestion des compétences",
    intitule: "Gestion prévisionnelle des compétences",
    question: "Les compétences nécessaires à moyen terme sont-elles identifiées et développées ?",
    public: "dirigeant",
    questionPublic: "Disposez-vous d'un plan de formation relié aux besoins de votre stratégie ?",
    poids: 2,
    priorite: 2,
    dureeSecondes: 30,
    auteur: "consultant.2",
    valideur: "expert.metier.2",
  },
  {
    dimension: "engagement",
    pratique: "eng.climat",
    nom: "l'écoute du climat social",
    intitule: "Écoute du climat social",
    question: "La direction mesure-t-elle régulièrement l'état d'esprit des équipes ?",
    public: "equipe",
    questionPublic: "Avez-vous l'occasion de dire ce qui ne va pas sans craindre de conséquences ?",
    poids: 3,
    priorite: 1,
    dureeSecondes: 25,
    auteur: "associe.2",
    valideur: "expert.metier",
  },
  {
    dimension: "engagement",
    pratique: "eng.reconnaissance",
    nom: "la reconnaissance des contributions",
    intitule: "Reconnaissance des contributions individuelles",
    question: "Les contributions remarquables des collaborateurs sont-elles reconnues ?",
    public: "equipe",
    questionPublic: "Votre travail est-il reconnu à sa juste valeur par votre hiérarchie ?",
    poids: 2,
    priorite: 3,
    dureeSecondes: 25,
    auteur: "consultant",
  },
  {
    dimension: "qualite",
    pratique: "qual.controles",
    nom: "les contrôles qualité",
    intitule: "Contrôles qualité sur les produits et services",
    question: "Des contrôles qualité sont-ils réalisés avant la livraison au client ?",
    public: "equipe",
    questionPublic:
      "Vérifiez-vous votre travail selon une procédure écrite avant de le transmettre ?",
    poids: 3,
    priorite: 1,
    dureeSecondes: 30,
    auteur: "chef.mission.2",
    valideur: "expert.metier.2",
  },
  {
    dimension: "qualite",
    pratique: "qual.satisfaction",
    nom: "la mesure de la satisfaction client",
    intitule: "Mesure de la satisfaction des clients",
    question: "La satisfaction des clients est-elle mesurée et suivie dans le temps ?",
    public: "dirigeant",
    questionPublic:
      "Mesurez-vous au moins une fois par an la satisfaction de vos principaux clients ?",
    poids: 3,
    priorite: 2,
    dureeSecondes: 25,
    auteur: "consultant",
    valideur: "expert.metier",
  },
  {
    dimension: "couts",
    pratique: "cout.revient",
    nom: "le calcul des coûts de revient",
    intitule: "Calcul des coûts de revient",
    question: "Le coût de revient de chaque produit ou service est-il connu ?",
    public: "dirigeant",
    questionPublic: "Connaissez-vous la marge réelle de vos principaux produits ou services ?",
    poids: 4,
    priorite: 1,
    dureeSecondes: 35,
    auteur: "chef.mission",
    valideur: "expert.metier.2",
  },
  {
    dimension: "couts",
    pratique: "cout.tresorerie",
    nom: "le suivi de la trésorerie",
    intitule: "Suivi et prévision de la trésorerie",
    question: "La trésorerie est-elle prévue à trois mois et suivie chaque semaine ?",
    public: "dirigeant",
    questionPublic: "Disposez-vous d'un plan de trésorerie glissant à treize semaines ?",
    poids: 3,
    priorite: 2,
    dureeSecondes: 30,
    auteur: "consultant.2",
  },
  {
    dimension: "innovation",
    pratique: "innov.veille",
    nom: "la veille sur le marché et les technologies",
    intitule: "Veille sur le marché et les technologies",
    question: "Une veille organisée alimente-t-elle les décisions de la direction ?",
    public: "dirigeant",
    questionPublic:
      "Quelqu'un est-il chargé de suivre l'évolution de votre secteur et de vous la restituer ?",
    poids: 2,
    priorite: 2,
    dureeSecondes: 25,
    auteur: "consultant",
    valideur: "expert.metier",
  },
  {
    dimension: "innovation",
    pratique: "innov.idees",
    nom: "la collecte et l'étude des idées d'amélioration",
    intitule: "Collecte et suite donnée aux idées des équipes",
    question: "Les idées d'amélioration des équipes sont-elles collectées et étudiées ?",
    public: "equipe",
    questionPublic: "Vos suggestions reçoivent-elles une réponse de votre hiérarchie ?",
    poids: 2,
    priorite: 3,
    dureeSecondes: 25,
    auteur: "chef.mission.2",
  },
  {
    dimension: "positionnement",
    pratique: "posi.concurrents",
    nom: "la connaissance des concurrents",
    intitule: "Connaissance des concurrents",
    question: "Les concurrents principaux et leurs offres sont-ils analysés régulièrement ?",
    public: "dirigeant",
    questionPublic:
      "Savez-vous comment vos trois principaux concurrents se positionnent sur le prix et le service ?",
    poids: 2,
    priorite: 2,
    dureeSecondes: 30,
    auteur: "chef.mission",
    valideur: "expert.metier.2",
  },
  {
    dimension: "positionnement",
    pratique: "posi.differenciation",
    nom: "la différenciation de l'offre",
    intitule: "Différenciation de l'offre",
    question: "Les clients perçoivent-ils ce qui distingue l'entreprise de ses concurrents ?",
    public: "dirigeant",
    questionPublic:
      "Pouvez-vous citer ce qui pousse vos clients à vous choisir plutôt qu'un concurrent ?",
    poids: 3,
    priorite: 1,
    dureeSecondes: 30,
    auteur: "consultant.2",
  },
];
