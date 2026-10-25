import type { CleMission } from "./casting.js";

/*
 * Données (textes seulement) du module RAPPORTS de la phase `gestion` : paramètres de rapport du
 * cabinet, mots d'introduction et commentaires du chef de mission pour les rapports
 * d'avancement hebdomadaires. AUCUN chiffre dans ces textes : jours, avancement et KPI viennent du
 * moteur (le chef ne rédige jamais les chiffres, règle du circuit de validation).
 */

export const PARAMETRES_RAPPORTS = {
  conservation_jours: 1825,
  mention_ia_active: true,
  mention_ia:
    "Document établi par le cabinet avec MissionPilot : les chiffres sont calculés par des moteurs vérifiables et tout contenu préparé avec l'aide de l'IA a été relu et validé par un consultant.",
} as const;

/** Rapports d'avancement (état d'avancement) : fractions de la période écoulée où ils sont émis. */
export const FRACTIONS_EN_COURS: readonly number[] = [0.35, 0.7, 1];
/** Missions terminées : à mi-parcours (chef de mission) puis rapport final de synthèse (associé). */
export const FRACTION_MI_PARCOURS = 0.5;

/** Nombre de semaines de rapports hebdomadaires générées par mission en cours (les plus récentes). */
export const SEMAINES_HEBDO = 8;

const INTRODUCTIONS: readonly string[] = [
  "Point hebdomadaire de la mission à l'attention de la direction du client.",
  "Synthèse de la semaine : l'équipe poursuit les travaux conformément au calendrier convenu.",
  "Rapport d'avancement de la semaine, établi à partir du suivi de la mission.",
  "Faits marquants de la semaine et prochaines échéances de la mission.",
];

const COMMENTAIRES: Partial<Record<CleMission, readonly string[]>> = {
  "baobab-plan": [
    "Les ateliers avec les directions métiers se déroulent bien ; les porteurs d'objectifs sont désignés et les premiers indicateurs sont à l'étude.",
    "Le diagnostic stratégique est partagé avec le comité de pilotage. Nous attendons les retours de la direction technique sur les hypothèses de sinistralité.",
    "La cascade des objectifs avance : les axes prioritaires sont validés, le détail des initiatives sera présenté la semaine prochaine.",
    "Le modèle financier est en cours de consolidation avec la direction financière ; les hypothèses de souscription restent à confirmer.",
  ],
  "gabon-redressement": [
    "Le suivi de trésorerie hebdomadaire est en place ; les points de vigilance sont partagés avec la direction financière.",
    "Les échanges avec les principaux créanciers se poursuivent ; une réunion de synthèse est prévue avec la direction générale.",
    "Le plan de redressement est en cours de chiffrage ; les mesures de réduction des coûts sont documentées par entité.",
    "La charge de travail dépasse légèrement le prévisionnel en raison de demandes complémentaires du client sur les contrats offshore.",
  ],
  "teranga-flash": [
    "Les entretiens avec les responsables d'exploitation sont terminés ; l'analyse des flux logistiques est en cours.",
    "Le diagnostic flash progresse conformément au calendrier court de la mission ; la restitution est préparée.",
    "Les premiers constats sur les délais de livraison sont partagés avec la direction ; les pistes d'amélioration sont hiérarchisées.",
  ],
  "banque-sahel-notation": [
    "Le questionnaire de notation a été transmis aux premières PME du portefeuille ; les retours arrivent progressivement.",
    "Les réponses reçues sont examinées ; plusieurs dossiers nécessitent des compléments de la part des entreprises.",
    "La revue des notations provisoires est en cours avec l'expert métier avant publication au comité de crédit.",
    "L'harmonisation des grilles sectorielles avance ; les ajustements justifiés sont consignés au dossier.",
  ],
};

const COMMENTAIRE_GENERIQUE: readonly string[] = [
  "Les travaux avancent conformément au calendrier convenu avec le client.",
  "L'équipe a poursuivi les entretiens et l'analyse documentaire ; aucun point bloquant à signaler.",
];

/** Introduction (une des phrases types), choisie de façon déterministe par l'appelant. */
export function introduction(rang: number): string {
  return INTRODUCTIONS[rang % INTRODUCTIONS.length] as string;
}

/** Commentaire du chef de mission pour la mission et le rang de la semaine. */
export function commentaire(cle: CleMission, rang: number): string {
  const liste = COMMENTAIRES[cle] ?? COMMENTAIRE_GENERIQUE;
  return liste[rang % liste.length] as string;
}

/** Commentaire libre ajouté au rapport d'état financier (section « Commentaire du consultant »). */
export const COMMENTAIRE_ETAT_FINANCIER =
  "Les états retenus sont ceux acceptés au dossier du client ; les écarts de contrôle éventuels sont rappelés dans la section dédiée.";
