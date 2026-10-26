import type { CleClient } from "../cles.js";
import type { CleMission } from "./casting.js";

/*
 * Données (libellés seulement) du module SALLE DE MISSION de la phase `gestion` : modèles de
 * demandes du cabinet, scénario de demandes documentaires par mission, déposants du portail
 * supplémentaires. Aucun chiffre métier. Les pièces déposées sont de minuscules PDF fictifs.
 */

export interface PieceSalleDef {
  libelle: string;
  description?: string;
  obligatoire?: boolean;
}

export interface ModeleSalleDef {
  nom: string;
  description: string;
  pieces: PieceSalleDef[];
}

export const MODELES_SALLE: readonly ModeleSalleDef[] = [
  {
    nom: "Ouverture de mission : documents juridiques",
    description: "Pièces corporate demandées à l'ouverture d'une mission.",
    pieces: [
      {
        libelle: "Statuts à jour de la société",
        description: "Version signée, avec les derniers avenants.",
      },
      { libelle: "Extrait RCCM de moins de trois mois" },
      { libelle: "Organigramme général et par direction" },
      { libelle: "Liste des administrateurs et des dirigeants", obligatoire: false },
    ],
  },
  {
    nom: "États financiers des trois derniers exercices",
    description: "Liasse comptable nécessaire au diagnostic financier.",
    pieces: [
      { libelle: "Bilans et comptes de résultat des trois derniers exercices" },
      { libelle: "Balance générale détaillée du dernier exercice" },
      { libelle: "Liasse fiscale ou DSF du dernier exercice" },
      { libelle: "Rapport du commissaire aux comptes", obligatoire: false },
    ],
  },
  {
    nom: "Situation bancaire et endettement",
    description: "Éléments pour analyser la structure d'endettement et les garanties.",
    pieces: [
      { libelle: "Relevés bancaires des douze derniers mois" },
      { libelle: "Tableau d'endettement à date" },
      { libelle: "Contrats de prêt et échéanciers" },
      { libelle: "Attestations de garanties données", obligatoire: false },
    ],
  },
  {
    nom: "Pilotage et stratégie existante",
    description: "Documents de pilotage du client pour cadrer la démarche stratégique.",
    pieces: [
      { libelle: "Plan à moyen terme ou budget pluriannuel" },
      { libelle: "Budget de l'exercice en cours et suivi budgétaire" },
      { libelle: "Comptes rendus des deux derniers conseils d'administration" },
      { libelle: "Études de marché disponibles", obligatoire: false },
    ],
  },
  {
    nom: "Portefeuille de PME à noter",
    description: "Informations de base d'une mission de notation d'un portefeuille.",
    pieces: [
      { libelle: "Liste du portefeuille avec encours par entreprise" },
      { libelle: "Dossiers de crédit des entreprises sélectionnées" },
      { libelle: "États financiers des entreprises sélectionnées" },
      { libelle: "Coordonnées des dirigeants à interroger", obligatoire: false },
    ],
  },
];

/** Évolution visée d'une demande documentaire. */
export type ProfilDemande =
  | "complete" //  tout reçu, accepté, demande close
  | "rejet" //     une pièce rejetée puis redéposée, tout accepté, demande close
  | "partielle" // pièces acceptées, une reçue à examiner, une rejetée, le reste attendu
  | "retard" //    échéance passée, pièces manquantes, relances
  | "attente" //   envoyée, rien reçu (échéance proche : rappel)
  | "brouillon"; // préparée, pas encore envoyée

export interface DemandeSalleDef {
  titre: string;
  message: string;
  /** Nom d'un modèle de MODELES_SALLE (ses pièces ouvrent la demande). */
  modele: string | null;
  /** Pièces propres à la demande, après celles du modèle. */
  extras: PieceSalleDef[];
  /** Échéance : décalage en jours depuis le début de la mission ou depuis aujourd'hui. */
  echeance: { depuis: "debut" | "aujourdhui"; jours: number };
  profil: ProfilDemande;
}

const M = (nom: string) => MODELES_SALLE.find((x) => x.nom.startsWith(nom))?.nom ?? nom;
const juridique = M("Ouverture");
const financier = M("États");
const bancaire = M("Situation");
const pilotage = M("Pilotage");
const portefeuille = M("Portefeuille");

const D = (
  titre: string,
  modele: string | null,
  profil: ProfilDemande,
  depuis: "debut" | "aujourdhui",
  jours: number,
  extras: PieceSalleDef[] = [],
  message = "Merci de déposer les pièces ci-dessous depuis votre portail client avant la date indiquée. Notre équipe vous accusera réception de chaque dépôt.",
): DemandeSalleDef => ({
  titre,
  message,
  modele,
  extras,
  echeance: { depuis, jours },
  profil,
});

const P = (libelle: string, obligatoire = true): PieceSalleDef => ({ libelle, obligatoire });

export const SCENARIOS_SALLE: Partial<Record<CleMission, DemandeSalleDef[]>> = {
  "sicafe-plan": [
    D("Documents juridiques et organisation", juridique, "complete", "debut", 10),
    D("États financiers pour le diagnostic stratégique", financier, "rejet", "debut", 25),
    D("Documents de pilotage existants", pilotage, "complete", "debut", 45, [
      P("Cartographie des plantations et des capacités de transformation"),
    ]),
  ],
  "sahel-coton-notation": [
    D("Documents juridiques", juridique, "complete", "debut", 7),
    D("États financiers des trois derniers exercices", financier, "rejet", "debut", 14),
    D("Situation bancaire", bancaire, "complete", "debut", 21),
  ],
  "wouri-redressement": [
    D("Situation bancaire et endettement", bancaire, "complete", "debut", 7),
    D("États financiers du groupe", financier, "complete", "debut", 14),
    D("Données de trésorerie et litiges", null, "rejet", "debut", 21, [
      P("Balance âgée des clients et des fournisseurs"),
      P("Plan de trésorerie à treize semaines"),
      P("Liste des litiges en cours"),
    ]),
    D("Contrats avec les distributeurs", null, "complete", "debut", 60, [
      P("Contrats cadres avec les distributeurs principaux"),
      P("Conditions de remise et de ristourne en vigueur"),
    ]),
  ],
  "mboa-dd": [
    D("Salle de données : documents corporate", juridique, "complete", "debut", 5, [
      P("Pacte d'actionnaires et avenants"),
    ]),
    D("Contrats clés et engagements", null, "complete", "debut", 14, [
      P("Contrats d'achat d'énergie des centrales"),
      P("Contrats de construction et de maintenance"),
      P("Polices d'assurance en vigueur"),
    ]),
    D("États financiers historiques", financier, "rejet", "debut", 10),
  ],
  "atlantique-bp": [
    D("États financiers du groupe", financier, "complete", "debut", 10),
    D("Hypothèses du business plan", null, "rejet", "debut", 20, [
      P("Tableau du parc de magasins et des surfaces"),
      P("Chiffre d'affaires par magasin sur vingt-quatre mois"),
      P("Programme d'investissements envisagé"),
    ]),
    D("Situation bancaire", bancaire, "complete", "debut", 30),
  ],
  "baobab-plan": [
    D("Documents juridiques et organisation", juridique, "complete", "debut", 10),
    D("Documents de pilotage existants", pilotage, "partielle", "aujourdhui", 6, [
      P("Rapports annuels de la direction technique"),
    ]),
    D("Données de portefeuille et de sinistralité", null, "retard", "aujourdhui", -8, [
      P("Statistiques de sinistralité sur cinq ans"),
      P("Primes émises par branche"),
      P("Programme de réassurance en vigueur"),
    ]),
  ],
  "gabon-redressement": [
    D("Situation bancaire et endettement", bancaire, "complete", "debut", 7),
    D("Trésorerie et créanciers", null, "retard", "aujourdhui", -12, [
      P("Plan de trésorerie à treize semaines"),
      P("Liste des créanciers et des échéances"),
      P("Contrats avec les compagnies pétrolières"),
    ]),
    D("États financiers des trois derniers exercices", financier, "partielle", "aujourdhui", 9),
  ],
  "teranga-flash": [
    D("Documents d'ouverture", juridique, "complete", "debut", 4),
    D("Données logistiques", null, "attente", "aujourdhui", 2, [
      P("Tableau de bord des livraisons des six derniers mois"),
      P("Liste du parc de véhicules"),
      P("Contrats avec les transporteurs sous-traitants"),
    ]),
  ],
  "banque-sahel-notation": [
    D("Portefeuille de PME à noter", portefeuille, "complete", "debut", 10),
    D("Dossiers de crédit prioritaires", null, "retard", "aujourdhui", -4, [
      P("Dossiers de crédit des dix entreprises prioritaires"),
      P("Dernières revues annuelles de risque"),
    ]),
    D("Cartographie des risques sectoriels", null, "attente", "aujourdhui", 14, [
      P("Politique de risque sectorielle de la banque"),
      P("Limites d'exposition par secteur"),
    ]),
    D("Compléments pour le comité de crédit", null, "brouillon", "aujourdhui", 30, [
      P("Procès-verbal du dernier comité de crédit"),
    ]),
  ],
};

/* ----- Déposants du portail ----- */

export interface DeposantDef {
  client: CleClient;
  /** Partie locale de l'adresse `@tenant-demo.test`. */
  cle: string;
  nom: string;
  role: "client_dirigeant" | "client_contributeur";
}

/**
 * Comptes du portail ajoutés (au plus 2 : plafond de comptes actifs du Tenant démo) pour les clients
 * qu'aucun lot n'a dotés d'un dirigeant ou d'un contributeur : sans eux, une demande ne s'envoie pas (aucun destinataire sur le portail).
 */
export const DEPOSANTS_SUPPLEMENTAIRES: readonly DeposantDef[] = [
  {
    client: "mboa-solaire",
    cle: "dirigeant.mboa",
    nom: "Jean-Pierre Ewané",
    role: "client_dirigeant",
  },
  {
    client: "gabon-offshore",
    cle: "dirigeant.gabon",
    nom: "Brice Ondo",
    role: "client_dirigeant",
  },
];

/** Motifs de rejet d'une pièce par le cabinet (le client en dépose une version corrigée). */
export const MOTIFS_REJET: readonly string[] = [
  "Le document transmis est illisible à partir de la deuxième page : merci de le scanner de nouveau.",
  "Le document n'est pas signé et ne porte pas le cachet de la société : merci de transmettre la version signée.",
  "La période couverte est incomplète : merci de fournir la version couvrant tous les exercices demandés.",
];
