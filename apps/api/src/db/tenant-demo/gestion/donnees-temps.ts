/*
 * Libellés et pondérations du module TEMPS du seed « Tenant démo » (phase `gestion`). Données
 * seulement : la logique est dans temps-plan.ts, temps-saisie.ts, temps-cloture.ts et
 * temps-suivi.ts. Aucune valeur chiffrée métier ici (jours, montants) : seulement des textes et
 * des poids de tirage.
 */

/** Genre de profil, déduit de la clé de compte : il oriente le temps interne. */
export type GenreProfil = "associe" | "direction" | "chef" | "consultant" | "stagiaire" | "externe";

/** Commentaires de lignes de mission (une ligne sur trois environ en porte un). */
export const COMMENTAIRES_MISSION: readonly string[] = [
  "Analyse des documents transmis par le client",
  "Atelier de travail avec la direction",
  "Entretiens avec les responsables de département",
  "Rédaction du livrable en cours",
  "Préparation du comité de pilotage",
  "Revue des états financiers et retraitements",
  "Consolidation des données collectées",
  "Réunion de cadrage avec l'équipe projet",
  "Mise en forme de la présentation",
  "Relecture croisée et contrôle qualité",
  "Visite de site et échanges avec les équipes terrain",
  "Mise à jour du modèle et des hypothèses",
  "Restitution intermédiaire au client",
  "Traitement des remarques du client",
];

/** Commentaires du temps interne, par code d'activité. */
export const COMMENTAIRES_INTERNES: Record<string, readonly string[]> = {
  formation_interne: ["Session de partage de pratiques", "Atelier méthodes du cabinet"],
  formation: ["Formation en ligne (analyse financière)", "Séminaire professionnel"],
  avant_vente: ["Réponse à un appel d'offres", "Préparation d'une proposition commerciale"],
  gestion_cabinet: ["Point de pilotage du cabinet", "Revue de portefeuille des missions"],
  developpement_methodes: [
    "Mise à jour des modèles de livrables",
    "Capitalisation sur les missions passées",
  ],
  administration: ["Classement et suivi administratif", "Notes de frais et justificatifs"],
  prospection: ["Prise de contact avec de nouveaux clients"],
  conges: ["Congé"],
};

/** Poids de tirage des activités internes, par genre de profil (codes absents du cabinet ignorés). */
export const POIDS_ACTIVITES: Record<GenreProfil, Record<string, number>> = {
  associe: {
    avant_vente: 40,
    gestion_cabinet: 30,
    developpement_methodes: 15,
    prospection: 10,
    administration: 5,
  },
  direction: {
    avant_vente: 30,
    gestion_cabinet: 20,
    developpement_methodes: 20,
    formation_interne: 15,
    administration: 10,
    prospection: 5,
  },
  chef: {
    avant_vente: 20,
    developpement_methodes: 25,
    formation_interne: 20,
    gestion_cabinet: 15,
    administration: 15,
    prospection: 5,
  },
  consultant: {
    formation_interne: 30,
    formation: 20,
    developpement_methodes: 25,
    administration: 15,
    avant_vente: 10,
  },
  stagiaire: { formation: 40, formation_interne: 40, administration: 20 },
  externe: { administration: 60, formation: 40 },
};

/** Motifs de rejet d'une feuille par son valideur (le consultant corrige puis resoumet). */
export const MOTIFS_REJET: readonly string[] = [
  "Les jours saisis sur la tâche ne correspondent pas au planning de l'équipe : merci de vérifier.",
  "Précisez le contenu des journées passées sur la mission (commentaires manquants).",
  "Une journée semble imputée sur la mauvaise phase de la mission, à revoir avec le chef de mission.",
  "Merci de détailler les jours d'atelier chez le client avant validation.",
  "Feuille incomplète : la répartition entre les missions doit être confirmée.",
  "Vérifiez la ventilation entre le diagnostic et le plan d'action.",
  "Les temps de déplacement ne sont pas à imputer sur cette tâche, merci de corriger.",
  "Écart avec le compte rendu de réunion du comité de pilotage : à rectifier.",
  "Ajoutez les commentaires de saisie demandés par la direction de mission.",
  "Le détail des journées de rédaction est à reprendre.",
  "Merci de confirmer les jours passés sur site avec le client.",
];

/** Complément de commentaire ajouté lors de la correction après rejet. */
export const COMMENTAIRES_CORRECTION: readonly string[] = [
  "Précisé suite à la remarque du valideur",
  "Ventilation revue avec le chef de mission",
  "Détail des journées complété",
];

/** Motifs de correction à la hausse (temps oublié). */
export const MOTIFS_CORRECTION_AJOUT: readonly string[] = [
  "Oubli de la demi-journée de restitution, constaté lors du rapprochement avec la facturation.",
  "Temps de préparation du comité non saisi, régularisé à la demande du directeur de mission.",
  "Demi-journée de travail effectif omise lors de la saisie hebdomadaire.",
];

/** Motifs de correction à la baisse (temps saisi en trop ou mal imputé). */
export const MOTIFS_CORRECTION_RETRAIT: readonly string[] = [
  "Journée imputée à tort sur cette tâche, déplacée après vérification avec le chef de mission.",
  "Erreur de saisie corrigée après relecture du carnet de bord de l'équipe.",
  "Demi-journée comptée deux fois lors de la saisie hebdomadaire.",
  "Rectification suite au rapprochement avec le planning réalisé de la mission.",
];

/** Motif de rejet d'une demande de correction. */
export const MOTIF_REJET_CORRECTION =
  "Justificatif insuffisant : la demande doit s'appuyer sur le compte rendu de la réunion concernée.";

/** Poids de tirage du retard de soumission (jours après la fin de la semaine) : 0 = à l'heure. */
export const PROBA_SOUMISSION_TARDIVE = 0.12;
