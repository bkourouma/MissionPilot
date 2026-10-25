/*
 * Données du dossier de due diligence de la mission 4 « Due diligence — Mboa Solaire »
 * (1er septembre au 19 décembre 2025) : cadrage, analyses, chaîne de valeur, risques, constats de
 * signaux. Contenus FICTIFS, cohérents avec le registre des preuves de la mission
 * (preuves-donnees-3.ts) : les clés `p1` à `p8` désignent ces preuves. Jours `j` = décalages depuis
 * le début de la mission. Aucune qualification juridique dans les libellés.
 */

export type Auteur = "consultant" | "consultant2";
export type ClePreuve = "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7" | "p8";

/** Fragment (unique) de la source de chaque preuve du registre, pour les retrouver en base. */
export const SOURCES_PREUVES: Record<ClePreuve, string> = {
  p1: "Carnet de commandes de Mboa",
  p2: "Plan d'affaires 2026-2030",
  p3: "Entretien avec le directeur technique",
  p4: "Étude de la Banque africaine",
  p5: "Visite de trois installations",
  p6: "Arrêté tarifaire 2025",
  p7: "Échantillon de dix contrats",
  p8: "Enquête auprès de douze clients",
};

export const CADRAGE_V1 = {
  titre: "Acquisition d'une participation majoritaire dans Mboa Énergie Solaire",
  secteur_code: "citi_d",
  filiere_code: null,
  pays_code: "cm",
  cible_nom: "Mboa Énergie Solaire",
  type_operation: "acquisition",
  devise: "XOF",
  date_operation: "2025-09-15",
  question_investissement:
    "Faut-il acquérir une participation majoritaire dans Mboa Énergie Solaire au prix proposé par le vendeur ?",
  perimetre:
    "Activités d'installation et de maintenance de centrales solaires commerciales au Cameroun.",
};

export const CADRAGE_VERSIONS = [
  {
    j: 10,
    par: "consultant" as Auteur,
    motif: "Précision du périmètre après la réunion de lancement avec le vendeur.",
    corps: {
      titre: "Acquisition d'une participation majoritaire dans Mboa Énergie Solaire (Cameroun)",
      perimetre:
        "Activités d'installation, de maintenance et de vente d'électricité solaire aux clients commerciaux et industriels du Cameroun ; filiales exclues.",
    },
  },
  {
    j: 45,
    par: "consultant2" as Auteur,
    motif:
      "Question d'investissement affinée après les visites de sites et l'analyse du carnet de commandes.",
    corps: {
      question_investissement:
        "L'hypothèse de croissance de 18 % par an du plan d'affaires est-elle atteignable, et à quel prix l'opération reste-t-elle créatrice de valeur ?",
    },
  },
];

export interface DefPoint {
  analyse: "pestel" | "cinq_forces" | "swot" | "operationnelle";
  categorie: string;
  libelle: string;
  enonce: string;
  classe: "R2" | "R3";
  niveau?: "faible" | "modere" | "eleve" | "critique";
  preuves: ClePreuve[];
  /** Avis d'expert (sans preuve propre) : motif de l'avis. */
  avis?: string;
  par: Auteur;
  j: number;
}

export const POINTS: DefPoint[] = [
  {
    analyse: "pestel",
    categorie: "politique",
    libelle: "Tarif réglementé en hausse",
    enonce:
      "Le tarif moyen réglementé en basse tension de 98 XOF/kWh doit augmenter de 4 % au 1er janvier 2026, ce qui soutient le marché de l'électricité solaire commerciale.",
    classe: "R2",
    niveau: "faible",
    preuves: ["p6"],
    par: "consultant",
    j: 27,
  },
  {
    analyse: "pestel",
    categorie: "economique",
    libelle: "Compétitivité face au réseau",
    enonce:
      "Le tarif de vente de 112 XOF/kWh retenu au plan d'affaires dépasse le tarif réglementé de 98 XOF/kWh : la compétitivité de Mboa face au réseau repose sur des contrats négociés.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p6", "p2"],
    par: "consultant",
    j: 28,
  },
  {
    analyse: "pestel",
    categorie: "social",
    libelle: "Satisfaction des clients",
    enonce:
      "Sept clients sur neuf interrogés renouvelleraient leur contrat de maintenance, mais trois signalent des retards d'intervention supérieurs à cinq jours.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p8"],
    par: "consultant2",
    j: 36,
  },
  {
    analyse: "pestel",
    categorie: "technologique",
    libelle: "Performance des installations",
    enonce:
      "La production mesurée atteint 87 % du productible théorique sur les trois sites visités, en deçà de la garantie de 92 % accordée aux clients.",
    classe: "R2",
    niveau: "eleve",
    preuves: ["p5", "p7"],
    par: "consultant2",
    j: 31,
  },
  {
    analyse: "pestel",
    categorie: "environnemental",
    libelle: "Entretien des panneaux",
    enonce:
      "L'encrassement des panneaux n'est pas traité depuis plus de deux mois sur deux des trois sites visités.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p5"],
    par: "consultant2",
    j: 32,
  },
  {
    analyse: "cinq_forces",
    categorie: "pouvoir_clients",
    libelle: "Poids des plus gros clients",
    enonce:
      "Les trois plus importants contrats représentent 52 % du montant des contrats signés, ce qui renforce le pouvoir de négociation de ces clients.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p1"],
    par: "consultant",
    j: 15,
  },
  {
    analyse: "cinq_forces",
    categorie: "pouvoir_fournisseurs",
    libelle: "Dépendance aux onduleurs",
    enonce:
      "Les onduleurs sont remplacés à dix ans et leur approvisionnement repose sur un petit nombre de fournisseurs, selon le directeur technique.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p3"],
    par: "consultant",
    j: 10,
  },
  {
    analyse: "cinq_forces",
    categorie: "nouveaux_entrants",
    libelle: "Arrivée de concurrents",
    enonce:
      "Peu de concurrents disposent aujourd'hui d'un carnet de commandes signé comparable sur le segment des clients commerciaux au Cameroun.",
    classe: "R2",
    niveau: "modere",
    preuves: [],
    avis: "Lecture de l'équipe à partir des entretiens de marché ; à confirmer par une cartographie des concurrents.",
    par: "consultant2",
    j: 34,
  },
  {
    analyse: "cinq_forces",
    categorie: "substituts",
    libelle: "Électricité du réseau",
    enonce:
      "L'électricité du réseau reste le substitut principal : son tarif réglementé de 98 XOF/kWh plafonne le prix de vente que Mboa peut généraliser.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p6"],
    par: "consultant",
    j: 29,
  },
  {
    analyse: "swot",
    categorie: "forces",
    libelle: "Carnet de commandes signé",
    enonce:
      "Quatorze contrats signés représentent 14,6 milliards XOF de livraisons 2026, soit 60 % du chiffre d'affaires prévu.",
    classe: "R2",
    niveau: "faible",
    preuves: ["p1"],
    par: "consultant",
    j: 16,
  },
  {
    analyse: "swot",
    categorie: "faiblesses",
    libelle: "Coût de maintenance sous-évalué",
    enonce:
      "Le coût de maintenance de 7 500 XOF par kWc et par an retenu au plan est inférieur aux références régionales, dont la médiane est de 9 800 XOF.",
    classe: "R2",
    niveau: "eleve",
    preuves: ["p4", "p7"],
    par: "consultant",
    j: 31,
  },
  {
    analyse: "swot",
    categorie: "opportunites",
    libelle: "Contrats de maintenance",
    enonce:
      "La hausse du tarif réglementé et la demande des clients existants ouvrent la voie à de nouveaux contrats de maintenance facturés 8 200 XOF par kWc et par an en moyenne.",
    classe: "R2",
    niveau: "faible",
    preuves: ["p6", "p7"],
    par: "consultant2",
    j: 37,
  },
  {
    analyse: "swot",
    categorie: "menaces",
    libelle: "Pénalités de garantie",
    enonce:
      "Les retards d'intervention signalés par trois clients et une production inférieure à la garantie de 92 % exposent Mboa à des pénalités contractuelles.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p8", "p7"],
    par: "consultant2",
    j: 38,
  },
  {
    analyse: "operationnelle",
    categorie: "processus",
    libelle: "Maintenance préventive",
    enonce:
      "Le suivi de la maintenance préventive est irrégulier : deux sites sur trois visités n'ont pas été nettoyés depuis plus de deux mois.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p5"],
    par: "consultant2",
    j: 24,
  },
  {
    analyse: "operationnelle",
    categorie: "approvisionnement",
    libelle: "Remplacement des onduleurs",
    enonce:
      "Selon le directeur technique, les onduleurs sont remplacés à dix ans, pièces comprises dans le coût de maintenance annoncé.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p3"],
    par: "consultant",
    j: 9,
  },
  {
    analyse: "operationnelle",
    categorie: "goulots",
    libelle: "Capacité d'intervention",
    enonce:
      "Les équipes d'intervention ne tiennent pas les délais de cinq jours chez tous les clients : trois clients sur neuf signalent des retards.",
    classe: "R2",
    niveau: "modere",
    preuves: ["p8"],
    par: "consultant",
    j: 39,
  },
];

export interface DefEtape {
  cle: string;
  libelle: string;
  description: string;
  ordre: number;
  part_cout_bp: number;
  part_marge_bp: number;
  acteurs: string[];
  contraintes: string;
  j: number;
}

/** Les parts de coût et de marge de chaque colonne totalisent 10 000 points de base. */
export const ETAPES: DefEtape[] = [
  {
    cle: "approvisionnement",
    libelle: "Approvisionnement en équipements",
    description:
      "Achat de panneaux, d'onduleurs et de structures auprès de fournisseurs internationaux.",
    ordre: 1,
    part_cout_bp: 5500,
    part_marge_bp: 1500,
    acteurs: ["Fournisseurs de panneaux", "Fournisseurs d'onduleurs"],
    contraintes: "Délais de livraison de plusieurs semaines et paiements en devises.",
    j: 5,
  },
  {
    cle: "installation",
    libelle: "Ingénierie et installation",
    description: "Étude du site, pose en toiture et mise en service chez le client.",
    ordre: 2,
    part_cout_bp: 2000,
    part_marge_bp: 2500,
    acteurs: ["Équipes d'installation", "Bureaux d'études"],
    contraintes: "Disponibilité des équipes qualifiées.",
    j: 6,
  },
  {
    cle: "exploitation",
    libelle: "Exploitation et maintenance",
    description:
      "Suivi de production, nettoyage, interventions correctives et remplacement des onduleurs.",
    ordre: 3,
    part_cout_bp: 1500,
    part_marge_bp: 3500,
    acteurs: ["Équipes de maintenance"],
    contraintes: "Garantie de performance de 92 % du productible théorique.",
    j: 7,
  },
  {
    cle: "vente",
    libelle: "Vente d'énergie et services",
    description: "Facturation de l'électricité produite et des contrats de maintenance.",
    ordre: 4,
    part_cout_bp: 1000,
    part_marge_bp: 2500,
    acteurs: ["Clients commerciaux", "Service commercial"],
    contraintes: "Contrats négociés à 112 XOF/kWh pour une partie des clients seulement.",
    j: 8,
  },
];
