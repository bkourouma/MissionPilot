import type { Acteurs } from "./commun.js";

/*
 * Données du référentiel de due diligence du cabinet (hors mission) : signaux d'alerte, listes
 * d'exclusion, modèles d'analyse par secteur. Contenus FICTIFS, rédigés comme des rappels pour
 * l'expert (jamais une affirmation chiffrée ni une qualification juridique). Jours = décalages
 * depuis le début de l'activité du cabinet (2024-10-01) : bibliothèque constituée au premier
 * semestre 2025, avant la mission « Mboa Solaire » (1er septembre 2025).
 */

export type CleActeurDd = keyof Pick<Acteurs, "associe" | "directeur" | "expert" | "expert2">;

export interface DefRegle {
  code: string;
  libelle: string;
  mots_cles: string[];
  secteur_codes?: string[];
  pays_codes?: string[];
}

export interface DefListe {
  nom: string;
  /** `mboa` : liste propre au client de la mission 4 ; sinon liste du cabinet. */
  client: "mboa" | null;
  reference_cadre: string | null;
  regles: DefRegle[];
  par: CleActeurDd;
  j: number;
  revision?: { j: number; par: CleActeurDd; motif: string; regles: DefRegle[] };
}

const REGLES_STANDARD: DefRegle[] = [
  { code: "armement", libelle: "Armement et munitions", mots_cles: ["armement", "munitions"] },
  { code: "jeux-argent", libelle: "Jeux d'argent", mots_cles: ["casino", "paris sportifs"] },
  { code: "tabac", libelle: "Production de tabac", mots_cles: ["tabac", "cigarettes"] },
  {
    code: "diesel-production",
    libelle: "Production d'électricité à partir de groupes diesel",
    mots_cles: ["groupes electrogenes diesel", "centrale diesel"],
  },
];

export const LISTES: DefListe[] = [
  {
    nom: "Liste d'exclusion standard du cabinet",
    client: null,
    reference_cadre:
      "Pratiques usuelles des investisseurs d'impact (cadre public, sans reprise de texte)",
    regles: REGLES_STANDARD,
    par: "associe",
    j: 128,
    revision: {
      j: 210,
      par: "directeur",
      motif: "Ajout d'une règle sur le défrichement après la revue du comité des risques.",
      regles: [
        ...REGLES_STANDARD,
        {
          code: "defrichement",
          libelle: "Défrichement de forêts primaires",
          mots_cles: ["deforestation", "defrichement"],
        },
      ],
    },
  },
  {
    nom: "Liste d'exclusion — Mboa Énergie Solaire (cadre de l'investisseur)",
    client: "mboa",
    reference_cadre: null,
    regles: [
      {
        code: "diesel-production",
        libelle: "Production d'électricité à partir de groupes diesel",
        mots_cles: ["groupes electrogenes diesel", "centrale diesel"],
      },
      { code: "charbon", libelle: "Activités liées au charbon", mots_cles: ["charbon"] },
      {
        code: "pays-hors-perimetre",
        libelle: "Activités hors du périmètre géographique de l'investisseur",
        mots_cles: [],
        pays_codes: ["gq"],
      },
    ],
    par: "expert",
    j: 205,
  },
  {
    nom: "Liste d'exclusion — agro-industrie",
    client: null,
    reference_cadre: null,
    regles: [
      {
        code: "defrichement",
        libelle: "Défrichement de forêts primaires",
        mots_cles: ["deforestation", "defrichement"],
      },
      {
        code: "travail-enfants",
        libelle: "Recours au travail des enfants",
        mots_cles: ["travail des enfants"],
      },
      {
        code: "pesticides-interdits",
        libelle: "Produits phytosanitaires interdits",
        mots_cles: ["pesticides interdits"],
      },
    ],
    par: "expert2",
    j: 230,
  },
];

export interface DefModele {
  secteur_code: string;
  analyse: "pestel" | "cinq_forces" | "swot" | "operationnelle";
  points: { categorie: string; libelle: string }[];
  par: CleActeurDd;
  j: number;
  revision?: {
    j: number;
    par: CleActeurDd;
    motif: string;
    actif?: boolean;
    points?: { categorie: string; libelle: string }[];
  };
}

export const MODELES: DefModele[] = [
  {
    secteur_code: "citi_d",
    analyse: "pestel",
    points: [
      {
        categorie: "politique",
        libelle: "Stabilité du cadre de soutien aux énergies renouvelables",
      },
      { categorie: "economique", libelle: "Évolution des tarifs de l'électricité du réseau" },
      {
        categorie: "technologique",
        libelle: "Durée de vie et performance des équipements installés",
      },
      {
        categorie: "environnemental",
        libelle: "Gestion de fin de vie des panneaux et des batteries",
      },
    ],
    par: "expert",
    j: 170,
    revision: {
      j: 215,
      par: "associe",
      motif: "Relecture et validation par un associé : ajout du point sur les riverains.",
      points: [
        {
          categorie: "politique",
          libelle: "Stabilité du cadre de soutien aux énergies renouvelables",
        },
        { categorie: "economique", libelle: "Évolution des tarifs de l'électricité du réseau" },
        {
          categorie: "technologique",
          libelle: "Durée de vie et performance des équipements installés",
        },
        {
          categorie: "environnemental",
          libelle: "Gestion de fin de vie des panneaux et des batteries",
        },
        { categorie: "social", libelle: "Acceptabilité des projets par les riverains" },
      ],
    },
  },
  {
    secteur_code: "citi_d",
    analyse: "operationnelle",
    points: [
      { categorie: "processus", libelle: "Qualité du suivi de production et alertes de panne" },
      { categorie: "approvisionnement", libelle: "Délais de livraison des onduleurs et panneaux" },
      { categorie: "goulots", libelle: "Capacité des équipes d'installation et de maintenance" },
    ],
    par: "expert",
    j: 172,
  },
  {
    secteur_code: "citi_g",
    analyse: "cinq_forces",
    points: [
      { categorie: "rivalite", libelle: "Intensité de la concurrence sur les prix de gros" },
      { categorie: "pouvoir_clients", libelle: "Poids des plus gros revendeurs dans les ventes" },
      {
        categorie: "pouvoir_fournisseurs",
        libelle: "Exclusivités de distribution accordées par les marques",
      },
      { categorie: "nouveaux_entrants", libelle: "Arrivée de plateformes de vente en ligne" },
    ],
    par: "expert2",
    j: 178,
    revision: {
      j: 240,
      par: "directeur",
      motif: "Validation par le directeur de mission : ajout du point sur les substituts.",
      points: [
        { categorie: "rivalite", libelle: "Intensité de la concurrence sur les prix de gros" },
        { categorie: "pouvoir_clients", libelle: "Poids des plus gros revendeurs dans les ventes" },
        {
          categorie: "pouvoir_fournisseurs",
          libelle: "Exclusivités de distribution accordées par les marques",
        },
        { categorie: "nouveaux_entrants", libelle: "Arrivée de plateformes de vente en ligne" },
        {
          categorie: "substituts",
          libelle: "Achats directs auprès des fabricants par les grands comptes",
        },
      ],
    },
  },
  {
    secteur_code: "citi_g",
    analyse: "operationnelle",
    points: [
      { categorie: "processus", libelle: "Gestion des stocks et inventaires tournants" },
      { categorie: "approvisionnement", libelle: "Délais d'importation et de dédouanement" },
      { categorie: "goulots", libelle: "Capacité des entrepôts et de la flotte de livraison" },
    ],
    par: "expert2",
    j: 180,
  },
  {
    secteur_code: "citi_c",
    analyse: "swot",
    points: [
      {
        categorie: "forces",
        libelle: "Maîtrise de l'approvisionnement en matières premières locales",
      },
      { categorie: "faiblesses", libelle: "Dépendance à quelques acheteurs à l'export" },
      {
        categorie: "opportunites",
        libelle: "Demande régionale pour les produits transformés localement",
      },
      { categorie: "menaces", libelle: "Volatilité des cours des matières premières" },
    ],
    par: "expert",
    j: 186,
  },
  {
    secteur_code: "citi_a",
    analyse: "pestel",
    points: [
      { categorie: "politique", libelle: "Politique de prix d'achat aux producteurs" },
      { categorie: "environnemental", libelle: "Exposition aux aléas climatiques" },
      { categorie: "social", libelle: "Conditions de travail dans les exploitations partenaires" },
    ],
    par: "expert",
    j: 188,
    revision: {
      j: 245,
      par: "associe",
      motif: "Modèle retiré : remplacé par le modèle agro-industrie, plus complet.",
      actif: false,
    },
  },
];
