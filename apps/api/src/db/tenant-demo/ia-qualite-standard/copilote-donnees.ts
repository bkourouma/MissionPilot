import type { CleCompte } from "../cles.js";
import type { CleMission } from "./commun.js";

/*
 * Scénarios du module « copilote » du seed Tenant démo : propositions d'actions faites par le
 * copilote (routage déterministe, sans IA) puis confirmées, annulées, expirées ou refusées par
 * l'utilisateur. Les dates sont des écarts en jours avant « aujourd'hui » (horloge fictive).
 */

export type StatutScenario = "confirmee" | "annulee" | "expiree" | "refusee";

interface Commun {
  /** Utilisateur qui dialogue avec le copilote (et qui confirme). */
  qui: CleCompte;
  mission: CleMission;
  /** Jours avant aujourd'hui et minute de la journée (UTC) de la proposition. */
  avant: number;
  minute: number;
  statut: StatutScenario;
  /** Délai de la décision après la proposition, en minutes (confirmation à 5 minutes au plus). */
  decisionMin: number;
}

export interface ScenarioTache extends Commun {
  outil: "creer_tache";
  titre: string;
  /** Collaborateur à qui la tâche est confiée (`qui` si absent). */
  pour?: CleCompte;
  /** Échéance en jours par rapport à aujourd'hui (négatif : passée). */
  echeance: number | null;
  /** État de la tâche créée quand l'action est confirmée. */
  etatTache?: "a_faire" | "en_cours" | "fait";
}

export interface ScenarioCommentaire extends Commun {
  outil: "ajouter_commentaire";
  texte: string;
}

export type ScenarioCopilote = ScenarioTache | ScenarioCommentaire;

export const SCENARIOS: ScenarioCopilote[] = [
  {
    outil: "creer_tache",
    qui: "chef.mission",
    mission: "plan-baobab",
    titre: "Préparer le comité de pilotage de mi-parcours",
    pour: "consultant",
    echeance: -30,
    etatTache: "fait",
    avant: 40,
    minute: 8 * 60 + 12,
    statut: "confirmee",
    decisionMin: 1,
  },
  {
    outil: "creer_tache",
    qui: "directeur.mission",
    mission: "redressement-gabon",
    titre: "Relancer Gabon Offshore pour les relevés bancaires manquants",
    pour: "chef.mission",
    echeance: -15,
    etatTache: "fait",
    avant: 25,
    minute: 9 * 60 + 40,
    statut: "confirmee",
    decisionMin: 2,
  },
  {
    outil: "creer_tache",
    qui: "associe",
    mission: "plan-sicafe-export",
    titre: "Revoir la lettre de mission de Sicafe Export avant signature",
    pour: "directeur.mission",
    echeance: 5,
    etatTache: "en_cours",
    avant: 22,
    minute: 10 * 60 + 5,
    statut: "confirmee",
    decisionMin: 1,
  },
  {
    outil: "creer_tache",
    qui: "chef.mission",
    mission: "plan-baobab",
    titre: "Envoyer le compte rendu des ateliers au client",
    pour: "consultant.2",
    echeance: -10,
    avant: 18,
    minute: 14 * 60 + 20,
    statut: "expiree",
    decisionMin: 47,
  },
  {
    outil: "creer_tache",
    qui: "gestionnaire",
    mission: "flash-teranga",
    titre: "Mettre à jour le tableau des honoraires de Teranga Logistique",
    echeance: 3,
    avant: 12,
    minute: 11 * 60 + 30,
    statut: "annulee",
    decisionMin: 1,
  },
  {
    outil: "creer_tache",
    qui: "ressources",
    mission: "notation-banque-sahel",
    titre: "Planifier les ateliers de notation avec la Banque du Sahel",
    pour: "consultant.junior",
    echeance: 8,
    avant: 15,
    minute: 9 * 60 + 15,
    statut: "refusee",
    decisionMin: 2,
  },
  {
    outil: "ajouter_commentaire",
    qui: "directeur.mission",
    mission: "plan-baobab",
    texte: "Le client a validé le calendrier des ateliers lors du dernier comité.",
    avant: 9,
    minute: 16 * 60 + 2,
    statut: "confirmee",
    decisionMin: 1,
  },
  {
    outil: "ajouter_commentaire",
    qui: "chef.mission",
    mission: "notation-banque-sahel",
    texte: "Échantillon de PME transmis par la banque : l'analyse est en cours.",
    avant: 5,
    minute: 8 * 60 + 50,
    statut: "confirmee",
    decisionMin: 3,
  },
  {
    outil: "ajouter_commentaire",
    qui: "associe",
    mission: "redressement-gabon",
    texte: "Point d'étape avec la direction financière à programmer cette semaine.",
    avant: 3,
    minute: 17 * 60 + 10,
    statut: "annulee",
    decisionMin: 2,
  },
  {
    outil: "creer_tache",
    qui: "directeur.mission",
    mission: "flash-teranga",
    titre: "Préparer la restitution du diagnostic flash",
    echeance: 12,
    avant: 2,
    minute: 15 * 60 + 45,
    statut: "expiree",
    decisionMin: 95,
  },
];

/** Échanges réels passés par la route `POST /api/copilote/messages` (date : jour de l'exécution). */
export const ECHANGES_REELS = [
  {
    qui: "chef.mission" as const,
    message: "Crée une tâche « Relire le rapport d'avancement de la semaine » pour demain",
    titre: "Relire le rapport d'avancement de la semaine",
    issue: "confirmer" as const,
  },
  {
    qui: "directeur.mission" as const,
    message:
      "Ajoute un commentaire sur la mission Plan stratégique 2026-2030 : revoir le périmètre des ateliers avec le client",
    texte: "revoir le périmètre des ateliers avec le client",
    issue: "annuler" as const,
  },
];
