import type { CleCompte, CleCompteCabinet } from "../cles.js";
import { CASTING, type MissionCasting } from "./casting.js";

/*
 * Données de l'étape « notations-complement » : quatre notations PUBLIÉES supplémentaires, de
 * classes A, B, E et D, pour que le cabinet « Tenant démo » ne se limite pas aux classes B, C, D
 * des missions 2 et 9. Les notes sortent des moteurs : seules sont décrites ici la maturité visée
 * des réponses du questionnaire (qui fixe l'ordre de grandeur du score), les ajustements motivés
 * (modérés) et les acteurs. Les chefs et directeurs de mission NE sont PAS décrits ici : ils sont
 * retrouvés par SQL (missions.chef_id / directeur_id), car ils diffèrent d'une mission à l'autre.
 */

/** Mission 3 : absente du CASTING partagé (pas de notation, de plan ni d'envoi avant cette étape). */
export const MISSION_BRASSERIES: MissionCasting = {
  numero: 3,
  intitule: "Redressement — Brasseries du Wouri",
  client: "brasseries-wouri",
};

export interface DefRepondantComplement {
  /** Compte du socle réutilisé tel quel (SICAFÉ), sinon compte de portail retrouvé/créé par e-mail. */
  existant?: CleCompte;
  email?: string;
  nom?: string;
  fonction?: string;
  role?: "client_dirigeant" | "client_contributeur";
  /** Date d'ouverture du compte (avant le début de la mission du client). */
  depuis?: string;
  /** Écart de ce répondant par rapport à la maturité moyenne (un dirigeant se juge mieux placé). */
  biais: number;
}

export interface AjustementComplement {
  dimension: string;
  delta: number;
  motif: string;
}

export interface DefComplement {
  /** Clé stable (dérive le hasard à graine des réponses). */
  cle: string;
  mission: MissionCasting;
  /** Code de la grille de notation validée (étape « notation-referentiels »). */
  grille: string;
  /** Version du modèle « notation_generique » de l'envoi de notation. */
  versionModele: 1 | 2;
  /** Maturité moyenne visée des réponses (0 à 1) : fixe la classe obtenue, calculée par le moteur. */
  maturite: number;
  /** Date limite de l'envoi (passée), posée après les réponses comme le fait l'étape « questionnaires ». */
  limitePassee: string;
  repondants: readonly [DefRepondantComplement, DefRepondantComplement, DefRepondantComplement];
  /** Consultant qui crée la notation, la calcule et la soumet. */
  calculateur: CleCompteCabinet;
  /** Expert métier qui publie (ni calcul, ni ajustement, ni soumission) ; l'autre est second expert. */
  publieur: CleCompteCabinet;
  secondExpert: CleCompteCabinet;
  methode: { contexte: Record<string, unknown>; motif: string };
  ajustements: readonly AjustementComplement[];
  /** Capacité du plan d'action enregistré pour la version (NOT-17). */
  capacitePlan: number;
  /** Classe attendue après calcul et ajustements (contrôle de cohérence, journalisé si autre). */
  classeVisee: "A" | "B" | "C" | "D" | "E";
}

const EQUIPE: readonly CleCompteCabinet[] = [
  "consultant",
  "consultant.2",
  "expert.metier",
  "expert.metier.2",
];
export const EQUIPE_NOTATION = EQUIPE;

export const COMPLEMENTS: readonly DefComplement[] = [
  {
    // SICAFE : groupe bien structuré, notation de départ du diagnostic stratégique (classe A).
    cle: "complement-sicafe",
    mission: CASTING.sicafe,
    grille: "competitivite-excellence",
    versionModele: 2,
    maturite: 0.9,
    limitePassee: "2025-02-21",
    repondants: [
      { existant: "dirigeant.client", biais: 0.05 },
      { existant: "contributeur.client", biais: -0.02 },
      {
        email: "s.yao@sicafe.tenant-demo.test",
        nom: "Serge Yao",
        fonction: "Directeur des ressources humaines",
        role: "client_contributeur",
        depuis: "2025-01-22",
        biais: -0.03,
      },
    ],
    calculateur: "consultant",
    publieur: "expert.metier",
    secondExpert: "expert.metier.2",
    methode: {
      contexte: {
        effectif: 640,
        filieres: ["agroalimentaire"],
        agricole: false,
        pays: "ci",
        situation: "croissance",
        zone: "uemoa",
        taille: "grande",
      },
      motif: "Notation de départ du diagnostic stratégique du groupe : contexte du dossier repris.",
    },
    ajustements: [
      {
        dimension: "processus",
        delta: -3,
        motif:
          "Procédures des deux filiales à jour, mais audit interne des processus non présenté.",
      },
      {
        dimension: "couts",
        delta: 2,
        motif: "Comptabilité analytique par filiale vérifiée sur pièces (clôture annuelle).",
      },
    ],
    capacitePlan: 6,
    classeVisee: "A",
  },
  {
    // Atlantique Retail : distributeur correctement piloté mais aux marges sous tension (classe B).
    cle: "complement-atlantique",
    mission: CASTING.atlantique,
    grille: "competitivite-excellence",
    versionModele: 1,
    maturite: 0.7,
    limitePassee: "2026-03-13",
    repondants: [
      {
        email: "c.fontaine@atlantique-retail.tenant-demo.test",
        nom: "Camille Fontaine",
        fonction: "Directrice générale",
        role: "client_dirigeant",
        depuis: "2026-01-05",
        biais: 0.06,
      },
      {
        email: "j.marchetti@atlantique-retail.tenant-demo.test",
        nom: "Julien Marchetti",
        fonction: "Directeur administratif et financier",
        role: "client_contributeur",
        depuis: "2026-01-05",
        biais: -0.03,
      },
      {
        email: "s.lemaire@atlantique-retail.tenant-demo.test",
        nom: "Sophie Lemaire",
        fonction: "Directrice des ressources humaines",
        role: "client_contributeur",
        depuis: "2026-01-07",
        biais: -0.04,
      },
    ],
    calculateur: "consultant.2",
    publieur: "expert.metier.2",
    secondExpert: "expert.metier",
    methode: {
      contexte: {
        effectif: 210,
        filieres: ["commerce"],
        agricole: false,
        pays: "fr",
        zone: "hors_zone_franc",
        situation: "tension",
        taille: "moyenne",
      },
      motif: "Notation préalable au business plan bancable : contexte du dossier client repris.",
    },
    ajustements: [
      {
        dimension: "couts",
        delta: -4,
        motif: "Marge par rayon non rapprochée de la comptabilité sur deux magasins.",
      },
      {
        dimension: "qualite",
        delta: 3,
        motif: "Enquête de satisfaction client trimestrielle documentée et suivie.",
      },
    ],
    capacitePlan: 8,
    classeVisee: "B",
  },
  {
    // Brasseries du Wouri : entreprise en difficulté, mission de redressement (classe E).
    cle: "complement-brasseries",
    mission: MISSION_BRASSERIES,
    grille: "competitivite-excellence",
    versionModele: 2,
    maturite: 0.18,
    limitePassee: "2025-04-11",
    repondants: [
      {
        email: "e.nkoulou@brasseries-wouri.tenant-demo.test",
        nom: "Emmanuel Nkoulou",
        fonction: "Directeur général",
        role: "client_dirigeant",
        depuis: "2025-03-03",
        biais: 0.05,
      },
      {
        email: "h.fotso@brasseries-wouri.tenant-demo.test",
        nom: "Hortense Fotso",
        fonction: "Directrice financière",
        role: "client_contributeur",
        depuis: "2025-03-03",
        biais: -0.02,
      },
      {
        email: "p.essomba@brasseries-wouri.tenant-demo.test",
        nom: "Patrice Essomba",
        fonction: "Directeur des opérations",
        role: "client_contributeur",
        depuis: "2025-03-05",
        biais: -0.03,
      },
    ],
    calculateur: "consultant",
    publieur: "expert.metier.2",
    secondExpert: "expert.metier",
    methode: {
      contexte: {
        effectif: 480,
        filieres: ["agroalimentaire"],
        agricole: false,
        pays: "cm",
        zone: "cemac",
        situation: "difficulte",
        fiabilite_comptes: "reconstitues",
        taille: "moyenne",
      },
      motif: "Notation de l'état de l'entreprise en redressement : contexte du dossier repris.",
    },
    ajustements: [
      {
        dimension: "couts",
        delta: -3,
        motif: "Coût de revient par hectolitre non suivi depuis la panne de la ligne de soutirage.",
      },
      {
        dimension: "pilotage",
        delta: -2,
        motif: "Tableau de bord de trésorerie hebdomadaire interrompu depuis le dernier trimestre.",
      },
    ],
    capacitePlan: 10,
    classeVisee: "E",
  },
  {
    // Baobab Assurances : assureur en transformation, maturité encore faible (classe D).
    cle: "complement-baobab",
    mission: CASTING.baobab,
    grille: "competitivite-excellence",
    versionModele: 1,
    maturite: 0.4,
    limitePassee: "2026-09-18",
    repondants: [
      {
        email: "a.sarr@baobab-assurances.tenant-demo.test",
        nom: "Aminata Sarr",
        fonction: "Directrice générale",
        role: "client_dirigeant",
        depuis: "2026-06-01",
        biais: 0.07,
      },
      {
        email: "m.gueye@baobab-assurances.tenant-demo.test",
        nom: "Mor Gueye",
        fonction: "Directeur technique",
        role: "client_contributeur",
        depuis: "2026-06-01",
        biais: -0.03,
      },
      {
        email: "n.ba@baobab-assurances.tenant-demo.test",
        nom: "Nogaye Ba",
        fonction: "Directrice des ressources humaines",
        role: "client_contributeur",
        depuis: "2026-06-03",
        biais: -0.04,
      },
    ],
    calculateur: "consultant.2",
    publieur: "expert.metier",
    secondExpert: "expert.metier.2",
    methode: {
      contexte: {
        effectif: 160,
        filieres: ["assurance"],
        agricole: false,
        pays: "sn",
        zone: "uemoa",
        situation: "stabilite",
        taille: "moyenne",
      },
      motif:
        "Notation préalable au plan stratégique 2026-2030 : contexte du dossier client repris.",
    },
    ajustements: [
      {
        dimension: "strategie",
        delta: -3,
        motif:
          "Orientations stratégiques non déclinées par direction : aucune feuille de route vue.",
      },
      {
        dimension: "organisation",
        delta: 2,
        motif: "Organigramme et délégations de pouvoir à jour (note de service du trimestre).",
      },
    ],
    capacitePlan: 8,
    classeVisee: "D",
  },
];
