import type { CleMission } from "./commun.js";

/*
 * Scénarios d'exécution du module « agents » (textes d'entrée, issue humaine attendue, textes de
 * relecture). Fictifs, en français, sans chiffre : voir agents-donnees.ts.
 */

export type IssueExecution = "telle_quelle" | "complete" | "legere" | "rejetee" | "attente";

export interface ScenarioExecution {
  id: string;
  prompt: string;
  mission: CleMission;
  declencheur: "chef" | "directeur";
  issue: IssueExecution;
  entree: number;
  motif?: string;
}

/** Textes d'entrée des exécutions (fictifs, sans chiffre) ; `{client}` = raison sociale. */
export const TEXTES_AGENT: Record<string, readonly string[]> = {
  redacteur_section_rapport: [
    "Constat établi lors des entretiens chez {client} : les décisions d'investissement dépendent de deux personnes et les critères ne sont pas formalisés. Recommandation : instaurer un comité d'investissement avec des critères écrits.",
    "Chez {client}, les équipes décrivent des circuits de validation qui varient selon les sites. Les délais de réponse aux clients en pâtissent. Piste : harmoniser les étapes de validation.",
    "Analyse de la chaîne d'approvisionnement de {client} : dépendance à un fournisseur principal et stocks de sécurité faibles. Mesure proposée : qualifier un second fournisseur.",
    "Les indicateurs de suivi de {client} sont produits à la main chaque mois et diffusés avec retard. Proposition : automatiser une extraction commune et fixer un jour de publication.",
    "Synthèse de la dimension gouvernance chez {client} : le conseil se réunit régulièrement mais les comptes rendus ne suivent pas les actions décidées.",
  ],
  pmo_note_comite: [
    "Mission {client} : entretiens terminés, analyse documentaire en cours. Point à décider : date de l'atelier de restitution. Risque : disponibilité des directeurs de filiale.",
    "Mission {client} : le diagnostic a été présenté aux équipes. Décision attendue : périmètre de la phase suivante. Risque : retard de transmission des états financiers.",
    "Mission {client} : atelier de priorisation animé, trois initiatives retenues. Décision attendue : responsable de chaque initiative.",
    "Mission {client} : revue des hypothèses du modèle avec la direction financière. Décision attendue : validation du scénario central.",
  ],
  pmo_rapport_avancement: [
    "Semaine sur la mission {client} : poursuite des entretiens et réception de plusieurs pièces. Un point d'attention sur la disponibilité du comité.",
    "Semaine sur la mission {client} : préparation de la restitution intermédiaire, relecture interne du livrable.",
    "Semaine sur la mission {client} : atelier reporté à la demande du client, replanifié la semaine suivante.",
  ],
  cadrage_lettre_mission: [
    "Objet : diagnostic flash de l'organisation logistique de {client}. Livrables : rapport court et séance de restitution. Hypothèse : accès aux données d'exploitation des sites.",
    "Objet : notation financière d'un portefeuille de petites entreprises clientes de {client}. Livrables : notes, rapport de synthèse. Hypothèse : accès au portefeuille à une date d'arrêté.",
  ],
  capitalisation_rex: [
    "Mission pour {client} : plan stratégique sur plusieurs mois. Points forts : implication du comité de direction, ateliers productifs. Difficultés : collecte documentaire lente. Enseignement : cadrer les pièces attendues dès le lancement.",
    "Mission pour {client} : notation financière d'un portefeuille. Points forts : méthode claire, échanges réguliers. Difficultés : qualité inégale des données comptables. Enseignement : prévoir une phase de fiabilisation.",
    "Mission pour {client} : diagnostic flash. Points forts : calendrier tenu. Difficultés : accès tardif aux données d'exploitation. Enseignement : demander une extraction unique avant le démarrage.",
  ],
  qualite_controle_livrable: [
    "Rapport de diagnostic de {client} avec résumé, constats, recommandations et annexes sourcées.",
    "Projet de plan d'action de {client} : recommandations sans responsables ni échéances.",
    "Rapport intermédiaire de {client} : constats rédigés, synthèse manquante.",
  ],
};

export const SCENARIOS_EXECUTION: readonly ScenarioExecution[] = [
  {
    id: "red-teranga",
    prompt: "redacteur_section_rapport",
    mission: "flash-teranga",
    declencheur: "chef",
    issue: "complete",
    entree: 0,
  },
  {
    id: "red-sahel",
    prompt: "redacteur_section_rapport",
    mission: "notation-banque-sahel",
    declencheur: "chef",
    issue: "legere",
    entree: 1,
  },
  {
    id: "red-baobab",
    prompt: "redacteur_section_rapport",
    mission: "plan-baobab",
    declencheur: "chef",
    issue: "complete",
    entree: 4,
  },
  {
    id: "red-gabon",
    prompt: "redacteur_section_rapport",
    mission: "redressement-gabon",
    declencheur: "chef",
    issue: "rejetee",
    entree: 3,
    motif:
      "Ton trop promotionnel et recommandations sans lien avec les constats : à reprendre avec le plan de trésorerie.",
  },
  {
    id: "red-export",
    prompt: "redacteur_section_rapport",
    mission: "plan-sicafe-export",
    declencheur: "directeur",
    issue: "telle_quelle",
    entree: 2,
  },
  {
    id: "comite-baobab",
    prompt: "pmo_note_comite",
    mission: "plan-baobab",
    declencheur: "chef",
    issue: "complete",
    entree: 0,
  },
  {
    id: "comite-gabon",
    prompt: "pmo_note_comite",
    mission: "redressement-gabon",
    declencheur: "chef",
    issue: "legere",
    entree: 1,
  },
  {
    id: "comite-teranga",
    prompt: "pmo_note_comite",
    mission: "flash-teranga",
    declencheur: "chef",
    issue: "attente",
    entree: 2,
  },
  {
    id: "comite-sahel",
    prompt: "pmo_note_comite",
    mission: "notation-banque-sahel",
    declencheur: "chef",
    issue: "legere",
    entree: 3,
  },
  {
    id: "avanc-baobab",
    prompt: "pmo_rapport_avancement",
    mission: "plan-baobab",
    declencheur: "chef",
    issue: "telle_quelle",
    entree: 0,
  },
  {
    id: "avanc-teranga",
    prompt: "pmo_rapport_avancement",
    mission: "flash-teranga",
    declencheur: "chef",
    issue: "rejetee",
    entree: 2,
    motif: "Le commentaire reprend l'avancement de la semaine précédente : à reformuler.",
  },
  {
    id: "avanc-gabon",
    prompt: "pmo_rapport_avancement",
    mission: "redressement-gabon",
    declencheur: "chef",
    issue: "attente",
    entree: 1,
  },
  {
    id: "lettre-teranga",
    prompt: "cadrage_lettre_mission",
    mission: "flash-teranga",
    declencheur: "chef",
    issue: "complete",
    entree: 0,
  },
  {
    id: "lettre-sahel",
    prompt: "cadrage_lettre_mission",
    mission: "notation-banque-sahel",
    declencheur: "chef",
    issue: "rejetee",
    entree: 1,
    motif:
      "Une clause de limitation de responsabilité ne correspond pas au mandat : projet écarté.",
  },
  {
    id: "rex-baobab",
    prompt: "capitalisation_rex",
    mission: "plan-baobab",
    declencheur: "directeur",
    issue: "complete",
    entree: 0,
  },
  {
    id: "rex-sahel",
    prompt: "capitalisation_rex",
    mission: "notation-banque-sahel",
    declencheur: "chef",
    issue: "legere",
    entree: 1,
  },
  {
    id: "rex-teranga",
    prompt: "capitalisation_rex",
    mission: "flash-teranga",
    declencheur: "chef",
    issue: "attente",
    entree: 2,
  },
  {
    id: "qual-gabon",
    prompt: "qualite_controle_livrable",
    mission: "redressement-gabon",
    declencheur: "chef",
    issue: "telle_quelle",
    entree: 0,
  },
  {
    id: "qual-teranga",
    prompt: "qualite_controle_livrable",
    mission: "flash-teranga",
    declencheur: "directeur",
    issue: "telle_quelle",
    entree: 1,
  },
  {
    id: "qual-baobab",
    prompt: "qualite_controle_livrable",
    mission: "plan-baobab",
    declencheur: "chef",
    issue: "rejetee",
    entree: 2,
    motif: "Contrôle sans objet : le livrable n'est pas encore rédigé.",
  },
];

/** Texte de relecture complet par scénario « complete » (le consultant réécrit le brouillon). */
export const TEXTES_FINAUX: Record<string, string> = {
  "red-teranga":
    "L'information d'exploitation de Teranga Logistique circule aujourd'hui de façon inégale entre les sites : chaque entrepôt tient ses propres tableaux et les arbitrages de transport se prennent à l'oral. Cette situation ralentit la réponse aux clients et rend les écarts difficiles à expliquer à la direction. Nous recommandons un tableau de suivi commun, alimenté chaque semaine, et un point d'exploitation hebdomadaire entre les responsables de site. Cette organisation fait l'objet de la section suivante.",
  "red-baobab":
    "La gouvernance de Baobab Assurances repose sur un conseil qui se réunit régulièrement, mais dont les décisions ne sont pas suivies de façon uniforme. Les comptes rendus n'identifient pas toujours un responsable ni une échéance. Nous proposons un tableau de suivi des décisions, présenté à chaque séance, afin de relier chaque orientation stratégique à une action et à une personne.",
  "comite-baobab":
    "Note du comité de pilotage — Baobab Assurances.\n\nAvancement : les entretiens avec la direction générale et les responsables de branche sont terminés ; l'analyse documentaire se poursuit.\nPoints à décider : date de l'atelier de restitution ; périmètre de la phase suivante.\nRisques : disponibilité des directeurs de branche en fin de mois ; transmission tardive des états de la branche vie.\nProchaines étapes : confirmer l'atelier et finaliser le diagnostic partagé.",
  "lettre-teranga":
    "Projet de lettre de mission — Diagnostic flash de Teranga Logistique.\n\nObjet : analyser l'organisation logistique de l'entreprise et formuler des recommandations à court terme.\nLivrables : un rapport court et une séance de restitution à la direction.\nHypothèses : accès aux données d'exploitation des sites et disponibilité de la direction d'exploitation pour deux entretiens.\nLe présent projet reste soumis à la validation du directeur de mission avant tout envoi.",
  "rex-baobab":
    "Retour d'expérience intermédiaire — mission de plan stratégique (client anonymisé).\n\nCe qui a bien fonctionné : l'implication du comité de direction et la qualité des ateliers de cadrage.\nDifficultés : la collecte documentaire est plus lente que prévu, faute de liste des pièces attendues dès le lancement.\nEnseignements : cadrer les pièces à fournir lors de la réunion de lancement et désigner un point focal côté client.",
};

/** Paragraphe ajouté par le consultant pour une retouche légère du brouillon. */
export const AJOUTS_LEGERS: readonly string[] = [
  "Point à confirmer avec le client avant diffusion.",
  "Les sources de cette section seront citées dans les annexes.",
  "Cette section sera relue par le directeur de mission avant remise.",
];
