/*
 * GRILLE GÉNÉRIQUE DE DÉPART, À VALIDER ET AFFINER PAR LES EXPERTS DU CABINET.
 *
 * Grille « propre générique » de notation de la compétitivité et de
 * l'excellence opérationnelle (service 1, NOT-01 ; DECISIONS.md, décisions V2).
 * Les formulations sont originales et s'appuient sur des principes publics de
 * gestion (planification et déclinaison d'objectifs, gestion par processus,
 * pilotage par indicateurs, cycle « planifier, faire, vérifier, agir »,
 * résolution de problèmes par les causes, gestion des compétences, écoute
 * client). Aucun texte n'est repris d'un référentiel sous licence (EFQM,
 * Shingo…) ni du cahier SANKORIA.
 *
 * Structure : 6 piliers d'excellence opérationnelle et 4 facteurs de
 * compétitivité, 6 ou 7 questions de notation chacun ; pondérations par
 * défaut (somme 100) et surcharges complètes par secteur (somme 100).
 *
 * Les identifiants (questionnaires, sections, questions, options, dimensions,
 * secteurs) sont STABLES : une question retirée n'est jamais recyclée, une
 * formulation modifiée en profondeur reçoit un nouvel identifiant et la
 * version de la grille augmente.
 */
import type {
  ConditionAffichage,
  DefinitionQuestionnaireDonnees,
  GrilleNotationDonnees,
  QuestionQuestionnaire,
  RegleConversionDonnees,
} from "./schemas";

/* ----- Échelles de réponse (Likert 1-5 libellées) ----- */

/** Échelle de maturité d'une pratique. */
export const ECHELLE_MATURITE = [
  "Inexistant",
  "Ponctuel, informel",
  "En place, appliqué en partie",
  "Systématique et suivi",
  "Systématique, mesuré et amélioré",
] as const;

/** Échelle d'accord avec une affirmation. */
export const ECHELLE_ACCORD = [
  "Pas du tout d'accord",
  "Plutôt pas d'accord",
  "Ni d'accord ni en désaccord",
  "Plutôt d'accord",
  "Tout à fait d'accord",
] as const;

/* ----- Construction : chaque question notée porte sa règle de conversion ----- */

interface QuestionNotee {
  readonly question: QuestionQuestionnaire;
  readonly conversion: RegleConversionDonnees;
  readonly poids: number;
}

interface Pilier {
  readonly id: string;
  readonly libelle: string;
  readonly famille: "excellence" | "competitivite";
  readonly description: string;
  readonly poids: number;
  readonly questions: readonly QuestionNotee[];
}

interface OptionsQuestion {
  readonly poids?: number;
  readonly aide?: string;
  readonly condition?: ConditionAffichage;
  readonly obligatoire?: boolean;
}

function base(id: string, libelle: string, o: OptionsQuestion) {
  return {
    id,
    libelle,
    obligatoire: o.obligatoire ?? true,
    ...(o.aide === undefined ? {} : { aide: o.aide }),
    ...(o.condition === undefined ? {} : { condition: o.condition }),
  };
}

/** Pratique notée sur l'échelle de maturité (1 → 0 point, 5 → 100 points). */
function maturite(id: string, libelle: string, o: OptionsQuestion = {}): QuestionNotee {
  return {
    question: {
      ...base(id, libelle, o),
      type: "likert",
      points: 5,
      libelles: [...ECHELLE_MATURITE],
    },
    conversion: { type: "likert", points: 5 },
    poids: o.poids ?? 1,
  };
}

/** Choix unique : chaque option porte ses points. */
function choix(
  id: string,
  libelle: string,
  options: readonly (readonly [code: string, libelle: string, points: number])[],
  o: OptionsQuestion = {},
): QuestionNotee {
  return {
    question: {
      ...base(id, libelle, o),
      type: "choix_unique",
      options: options.map(([code, l]) => ({ code, libelle: l })),
    },
    conversion: { type: "choix", valeurs: options.map(([code, , points]) => ({ code, points })) },
    poids: o.poids ?? 1,
  };
}

function ouiNon(id: string, libelle: string, o: OptionsQuestion = {}): QuestionNotee {
  return {
    question: { ...base(id, libelle, o), type: "oui_non" },
    conversion: { type: "oui_non", oui: 100, non: 0 },
    poids: o.poids ?? 1,
  };
}

/** Pourcentage saisi (0-100), facultatif : la donnée n'est pas toujours connue. */
function pourcentage(
  id: string,
  libelle: string,
  conversion: RegleConversionDonnees,
  o: OptionsQuestion = {},
): QuestionNotee {
  return {
    question: {
      ...base(id, libelle, { obligatoire: false, ...o }),
      type: "numerique",
      min: 0,
      max: 100,
      unite: "%",
    },
    conversion,
    poids: o.poids ?? 1,
  };
}

/* ----- Les dix dimensions ----- */

const PILIERS: readonly Pilier[] = [
  {
    id: "strategie",
    libelle: "Stratégie déployée",
    famille: "excellence",
    description:
      "Existence d'une stratégie écrite et sa traduction en objectifs, moyens et revues.",
    poids: 12,
    questions: [
      ouiNon("strat.plan_formalise", "L'entreprise dispose-t-elle d'un plan stratégique écrit ?", {
        poids: 2,
      }),
      choix(
        "strat.horizon_plan",
        "Quel horizon couvre le plan stratégique en vigueur ?",
        [
          ["moins_un_an", "Moins d'un an", 25],
          ["un_a_deux_ans", "Un à deux ans", 50],
          ["trois_a_cinq_ans", "Trois à cinq ans", 100],
          ["plus_de_cinq_ans", "Plus de cinq ans", 80],
        ],
        { condition: { op: "egal", question: "strat.plan_formalise", valeur: true } },
      ),
      maturite(
        "strat.communication",
        "Les orientations stratégiques sont expliquées à l'ensemble du personnel, pas seulement à l'équipe de direction.",
      ),
      maturite(
        "strat.declinaison",
        "Les objectifs stratégiques sont traduits en objectifs annuels chiffrés pour chaque service.",
        { poids: 2 },
      ),
      maturite(
        "strat.ressources",
        "Les budgets, investissements et recrutements sont arbitrés en fonction des priorités stratégiques.",
      ),
      maturite(
        "strat.revue",
        "La direction revoit l'avancement du plan à intervalles fixes et ajuste les actions en conséquence.",
      ),
      maturite(
        "strat.veille",
        "La direction analyse régulièrement l'évolution du marché, de la concurrence et de la réglementation.",
      ),
    ],
  },
  {
    id: "processus",
    libelle: "Processus",
    famille: "excellence",
    description:
      "Description, maîtrise et mesure des processus qui produisent la valeur pour le client.",
    poids: 10,
    questions: [
      maturite(
        "proc.cartographie",
        "Les principaux processus (de la commande à la livraison, achats, recrutement…) sont décrits et ont chacun un responsable.",
        { poids: 2 },
      ),
      maturite(
        "proc.modes_operatoires",
        "Les tâches répétitives suivent des modes opératoires écrits, connus et appliqués par les équipes.",
      ),
      maturite(
        "proc.interfaces",
        "Les transmissions entre services (informations, produits, dossiers) se font sans pertes ni retards fréquents.",
      ),
      maturite(
        "proc.indicateurs",
        "Chaque processus clé a au moins un indicateur de performance (délai, qualité ou coût).",
      ),
      choix(
        "proc.outils",
        "Comment les informations des processus clés sont-elles principalement gérées ?",
        [
          ["papier", "Sur papier ou de façon orale", 0],
          ["tableur", "Dans des tableurs dispersés", 35],
          ["logiciel_metier", "Dans un ou plusieurs logiciels métier", 70],
          ["systeme_integre", "Dans un système intégré partagé par les services", 100],
        ],
      ),
      maturite(
        "proc.risques",
        "Les risques opérationnels majeurs (rupture d'approvisionnement, panne, fraude, sécurité) sont identifiés et ont un plan de prévention.",
      ),
    ],
  },
  {
    id: "pilotage",
    libelle: "Pilotage de la performance",
    famille: "excellence",
    description:
      "Indicateurs, cibles, fréquence de revue et qualité des décisions qui en découlent.",
    poids: 10,
    questions: [
      maturite(
        "pil.tableau_bord",
        "La direction dispose d'un tableau de bord qui regroupe les indicateurs clés, mis à jour à fréquence fixe.",
        { poids: 2 },
      ),
      choix(
        "pil.frequence",
        "À quelle fréquence la direction examine-t-elle les indicateurs de performance ?",
        [
          ["jamais", "Jamais ou presque", 0],
          ["annuelle", "Une fois par an", 25],
          ["trimestrielle", "Chaque trimestre", 60],
          ["mensuelle", "Chaque mois", 90],
          ["hebdomadaire", "Chaque semaine", 100],
        ],
      ),
      maturite("pil.cibles", "Chaque indicateur suivi a une cible chiffrée et un responsable."),
      maturite(
        "pil.fiabilite",
        "Les chiffres utilisés pour décider sont fiables et disponibles à temps.",
      ),
      maturite(
        "pil.decisions",
        "Les réunions de suivi aboutissent à des actions datées et attribuées, dont l'exécution est vérifiée.",
      ),
      maturite(
        "pil.budget",
        "Un budget annuel est établi et l'écart entre le réalisé et le budget est analysé au moins chaque trimestre.",
      ),
    ],
  },
  {
    id: "amelioration",
    libelle: "Amélioration continue",
    famille: "excellence",
    description:
      "Capacité à résoudre durablement les problèmes et à faire progresser les pratiques.",
    poids: 10,
    questions: [
      maturite(
        "amel.causes",
        "Les problèmes récurrents sont traités par une analyse de leurs causes profondes plutôt que par des corrections ponctuelles.",
        { poids: 2 },
      ),
      maturite(
        "amel.suggestions",
        "Le personnel peut proposer des améliorations, et chaque proposition reçoit une réponse.",
      ),
      maturite(
        "amel.methode",
        "Les projets d'amélioration suivent une démarche structurée : constat, analyse, action, vérification du résultat.",
      ),
      maturite(
        "amel.reclamations",
        "Les réclamations et retours des clients sont enregistrés, analysés et donnent lieu à des actions.",
      ),
      maturite(
        "amel.generalisation",
        "Les solutions qui ont fait leurs preuves sont étendues aux autres équipes ou sites.",
      ),
      maturite(
        "amel.comparaison",
        "L'entreprise compare ses pratiques et ses résultats à ceux d'autres entreprises (concurrents, partenaires, références du secteur).",
      ),
    ],
  },
  {
    id: "organisation",
    libelle: "Organisation",
    famille: "excellence",
    description: "Clarté des rôles, délégation, compétences et gouvernance.",
    poids: 8,
    questions: [
      ouiNon(
        "org.organigramme",
        "Existe-t-il un organigramme à jour précisant les rôles et responsabilités de chaque poste ?",
      ),
      maturite(
        "org.delegation",
        "Les décisions courantes sont prises au bon niveau, sans remonter systématiquement à la direction générale.",
        { poids: 2 },
      ),
      maturite(
        "org.attendus",
        "Chaque collaborateur sait précisément ce que l'on attend de lui et sur quels critères il est évalué.",
      ),
      maturite(
        "org.competences",
        "Les compétences nécessaires sont identifiées et un plan de formation annuel est mis en œuvre.",
      ),
      maturite("org.releve", "Les postes clés ont un remplaçant identifié et préparé."),
      choix("org.gouvernance", "Comment les décisions stratégiques sont-elles prises ?", [
        ["dirigeant_seul", "Par le dirigeant seul", 0],
        ["direction_informelle", "Par la direction, de façon informelle", 40],
        ["comite_direction", "En comité de direction, avec compte rendu", 80],
        [
          "comite_et_conseil",
          "En comité de direction, avec un organe de gouvernance (conseil d'administration ou comité consultatif)",
          100,
        ],
      ]),
    ],
  },
  {
    id: "engagement",
    libelle: "Engagement des équipes",
    famille: "excellence",
    description: "Reconnaissance, communication interne, climat social, santé et sécurité.",
    poids: 10,
    questions: [
      maturite(
        "eng.reconnaissance",
        "Les contributions individuelles et collectives sont reconnues (remerciements, primes, promotions).",
      ),
      maturite(
        "eng.communication",
        "L'information circule régulièrement entre la direction et le personnel, dans les deux sens.",
        { poids: 2 },
      ),
      maturite(
        "eng.climat",
        "Le climat social est mesuré (enquête, entretiens) et les résultats donnent lieu à des actions.",
      ),
      maturite(
        "eng.sante_securite",
        "La santé et la sécurité au travail font l'objet de règles connues, appliquées et vérifiées.",
      ),
      maturite(
        "eng.entretiens",
        "Chaque collaborateur a un entretien individuel au moins une fois par an.",
      ),
      pourcentage(
        "eng.departs",
        "Taux de départs volontaires du personnel sur les douze derniers mois (%)",
        {
          type: "interpolation",
          points: [
            { x: 0, y: 100 },
            { x: 5, y: 100 },
            { x: 15, y: 50 },
            { x: 30, y: 0 },
          ],
        },
        {
          aide: "Démissions et départs volontaires rapportés à l'effectif moyen. Laisser vide si inconnu.",
        },
      ),
    ],
  },
  {
    id: "qualite",
    libelle: "Qualité",
    famille: "competitivite",
    description: "Maîtrise de la qualité livrée au client, de la spécification au contrôle.",
    poids: 12,
    questions: [
      maturite(
        "qual.exigences",
        "Les exigences des clients (spécifications, délais, normes) sont écrites et connues des équipes qui produisent.",
        { poids: 2 },
      ),
      maturite(
        "qual.controles",
        "Des contrôles sont réalisés aux étapes clés et les non-conformités sont enregistrées.",
      ),
      choix(
        "qual.certification",
        "Où en est l'entreprise en matière de certification ou de référentiel qualité (ISO 9001, normes sanitaires, etc.) ?",
        [
          ["aucune", "Aucune démarche", 0],
          ["en_projet", "Démarche en cours de préparation", 40],
          ["partielle", "Certifiée sur une partie des activités", 70],
          ["complete", "Certifiée sur l'ensemble des activités", 100],
        ],
      ),
      pourcentage(
        "qual.service_client",
        "Part des commandes livrées complètes et dans les délais sur les douze derniers mois (%)",
        {
          type: "seuils",
          paliers: [
            { min: 0, points: 0 },
            { min: 70, points: 25 },
            { min: 80, points: 50 },
            { min: 90, points: 75 },
            { min: 97, points: 100 },
          ],
        },
        { aide: "Laisser vide si l'information n'est pas suivie." },
      ),
      maturite(
        "qual.satisfaction",
        "La satisfaction des clients est mesurée régulièrement (enquête, indicateur, entretien).",
      ),
      maturite(
        "qual.fournisseurs",
        "Les fournisseurs sont sélectionnés et évalués sur la qualité de ce qu'ils livrent.",
      ),
    ],
  },
  {
    id: "couts",
    libelle: "Maîtrise des coûts",
    famille: "competitivite",
    description: "Connaissance des coûts et des marges, chasse aux pertes, achats et trésorerie.",
    poids: 10,
    questions: [
      maturite(
        "cout.revient",
        "Le coût de revient de chaque produit ou service est calculé et tenu à jour.",
        { poids: 2 },
      ),
      maturite(
        "cout.marges",
        "Les marges sont suivies par produit, client ou activité, et les activités non rentables sont identifiées.",
      ),
      maturite(
        "cout.pertes",
        "Les pertes (rebuts, stocks dormants, temps d'attente, retouches) sont mesurées et réduites.",
      ),
      maturite(
        "cout.achats",
        "Les achats importants sont mis en concurrence et négociés selon une procédure connue.",
      ),
      maturite(
        "cout.tresorerie",
        "La trésorerie est prévue sur plusieurs mois et les délais de paiement des clients et des fournisseurs sont pilotés.",
      ),
      maturite(
        "cout.productivite",
        "La productivité (production ou chiffre d'affaires par personne, par machine…) est mesurée et suivie dans le temps.",
      ),
    ],
  },
  {
    id: "innovation",
    libelle: "Innovation",
    famille: "competitivite",
    description: "Renouvellement de l'offre, des procédés et des usages numériques.",
    poids: 8,
    questions: [
      maturite(
        "innov.veille",
        "L'entreprise suit les évolutions techniques et les nouveaux usages de ses clients.",
      ),
      pourcentage(
        "innov.part_nouveautes",
        "Part du chiffre d'affaires réalisée avec des produits ou services lancés depuis moins de trois ans (%)",
        {
          type: "interpolation",
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 80 },
            { x: 40, y: 100 },
          ],
        },
        { aide: "Laisser vide si l'information n'est pas suivie." },
      ),
      maturite(
        "innov.idees",
        "Les idées nouvelles sont recueillies, évaluées et testées selon un processus défini.",
        { poids: 2 },
      ),
      choix(
        "innov.moyens",
        "Quels moyens l'entreprise consacre-t-elle à l'innovation (temps, budget, personnes) ?",
        [
          ["aucun", "Aucun moyen identifié", 0],
          ["ponctuels", "Des moyens ponctuels, sans budget dédié", 35],
          ["dedies", "Un budget ou une équipe dédiés", 75],
          ["planifies", "Des moyens fixés dans le plan stratégique et suivis", 100],
        ],
      ),
      maturite(
        "innov.numerique",
        "Les outils numériques servent à améliorer l'offre ou la relation client (vente en ligne, paiement mobile, données clients…).",
      ),
      maturite(
        "innov.partenariats",
        "L'entreprise coopère avec des partenaires extérieurs pour innover (clients, fournisseurs, universités, incubateurs).",
      ),
    ],
  },
  {
    id: "positionnement",
    libelle: "Positionnement concurrentiel",
    famille: "competitivite",
    description: "Clarté de la cible et de l'offre, différenciation, dépendance commerciale.",
    poids: 10,
    questions: [
      maturite(
        "posi.cible",
        "Les segments de clientèle visés et la proposition de valeur pour chacun sont clairement définis.",
        { poids: 2 },
      ),
      maturite(
        "posi.differenciation",
        "Les clients reconnaissent ce qui distingue l'offre de l'entreprise de celle des concurrents.",
      ),
      maturite(
        "posi.concurrents",
        "Les forces, les faiblesses et les prix des principaux concurrents sont connus et mis à jour.",
      ),
      choix(
        "posi.part_marche",
        "Comment la part de marché de l'entreprise a-t-elle évolué sur les trois dernières années ?",
        [
          ["forte_baisse", "Forte baisse", 0],
          ["baisse", "Baisse", 25],
          ["stable", "Stable", 50],
          ["hausse", "Hausse", 80],
          ["forte_hausse", "Forte hausse", 100],
          ["inconnue", "Nous ne savons pas", 20],
        ],
      ),
      choix(
        "posi.dependance",
        "Quelle part du chiffre d'affaires le premier client représente-t-il ?",
        [
          ["moins_de_10", "Moins de 10 %", 100],
          ["de_10_a_25", "De 10 à 25 %", 70],
          ["de_25_a_50", "De 25 à 50 %", 35],
          ["plus_de_50", "Plus de 50 %", 0],
        ],
      ),
      maturite(
        "posi.prix",
        "Les prix sont fixés en tenant compte de la valeur perçue par les clients et des prix du marché, pas seulement des coûts.",
      ),
      maturite(
        "posi.reputation",
        "La marque et la réputation de l'entreprise sont entretenues (présence en ligne, références, recommandations).",
      ),
    ],
  },
];

/* ----- Secteurs ----- */

export const SECTEURS_GRILLE_GENERIQUE = [
  { code: "agro_industrie", libelle: "Agro-industrie" },
  { code: "numerique", libelle: "Numérique" },
  { code: "industrie", libelle: "Industrie" },
  { code: "services", libelle: "Services" },
  { code: "commerce", libelle: "Commerce et distribution" },
] as const;
export type SecteurGrilleGenerique = (typeof SECTEURS_GRILLE_GENERIQUE)[number]["code"];

/**
 * Poids par secteur (somme 100 dans chaque colonne). Ordre des dimensions :
 * stratégie, processus, pilotage, amélioration, organisation, engagement,
 * qualité, coûts, innovation, positionnement.
 */
const POIDS_SECTEURS: Record<SecteurGrilleGenerique, readonly number[]> = {
  // Sécurité sanitaire et maîtrise des pertes : qualité, processus et coûts renforcés.
  agro_industrie: [10, 12, 10, 10, 8, 8, 15, 12, 5, 10],
  // Renouvellement rapide de l'offre et dépendance aux talents : innovation et engagement.
  numerique: [12, 8, 10, 10, 8, 12, 10, 6, 14, 10],
  // Production : processus, amélioration continue, qualité et coûts.
  industrie: [10, 13, 10, 12, 7, 8, 13, 12, 7, 8],
  // Prestation humaine : engagement, qualité de service et positionnement.
  services: [12, 9, 10, 9, 8, 12, 14, 8, 7, 11],
  // Marges serrées et concurrence frontale : coûts et positionnement.
  commerce: [11, 9, 10, 8, 8, 10, 11, 13, 6, 14],
};

/* ----- Exports : questionnaire de notation et grille ----- */

export const QUESTIONNAIRE_NOTATION_GENERIQUE: DefinitionQuestionnaireDonnees = {
  id: "notation_generique",
  version: 1,
  titre: "Notation de la compétitivité et de l'excellence opérationnelle",
  sections: PILIERS.map((p) => ({
    id: p.id,
    titre: p.libelle,
    description: p.description,
    questions: p.questions.map((q) => q.question),
  })),
};

export const GRILLE_GENERIQUE: GrilleNotationDonnees = {
  id: "notation_generique",
  version: 1,
  titre: "Grille générique de notation (à valider et affiner par les experts du cabinet)",
  dimensions: PILIERS.map((p) => ({
    id: p.id,
    libelle: p.libelle,
    famille: p.famille,
    poids: p.poids,
    indicateurs: p.questions.map((q) => ({
      id: q.question.id,
      question: q.question.id,
      poids: q.poids,
      conversion: q.conversion,
    })),
  })),
  secteurs: SECTEURS_GRILLE_GENERIQUE.map((s) => ({
    secteur: s.code,
    libelle: s.libelle,
    poids: PILIERS.map((p, i) => ({ dimension: p.id, poids: POIDS_SECTEURS[s.code][i] as number })),
  })),
};

/* ----- Questionnaire préliminaire des dirigeants (NOT-02) ----- */

function accord(id: string, libelle: string, o: OptionsQuestion = {}): QuestionQuestionnaire {
  return { ...base(id, libelle, o), type: "likert", points: 5, libelles: [...ECHELLE_ACCORD] };
}

/**
 * Questionnaire préliminaire des dirigeants : style de management, culture,
 * appétence au changement. Il n'est pas noté par la grille : il éclaire
 * l'interprétation des scores et la conduite de la mission.
 */
export const QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS: DefinitionQuestionnaireDonnees = {
  id: "preliminaire_dirigeants",
  version: 1,
  titre: "Questionnaire préliminaire des dirigeants",
  sections: [
    {
      id: "profil",
      titre: "Votre profil",
      questions: [
        {
          id: "prof.fonction",
          type: "texte",
          libelle: "Votre fonction",
          obligatoire: true,
          longueurMax: 120,
        },
        {
          id: "prof.anciennete",
          type: "choix_unique",
          libelle: "Depuis combien de temps dirigez-vous l'entreprise ?",
          obligatoire: true,
          options: [
            { code: "moins_de_2_ans", libelle: "Moins de 2 ans" },
            { code: "de_2_a_5_ans", libelle: "De 2 à 5 ans" },
            { code: "de_5_a_10_ans", libelle: "De 5 à 10 ans" },
            { code: "plus_de_10_ans", libelle: "Plus de 10 ans" },
          ],
        },
      ],
    },
    {
      id: "management",
      titre: "Style de management",
      questions: [
        {
          id: "mgt.decision",
          type: "choix_unique",
          libelle: "Comment prenez-vous le plus souvent les décisions importantes ?",
          obligatoire: true,
          options: [
            { code: "seul", libelle: "Seul" },
            {
              code: "apres_consultation",
              libelle: "Seul, après avoir consulté quelques proches collaborateurs",
            },
            { code: "collegiale", libelle: "Collégialement, en équipe de direction" },
            { code: "deleguee", libelle: "Je délègue la décision au responsable concerné" },
          ],
        },
        accord(
          "mgt.delegation",
          "Je délègue volontiers des décisions à mes collaborateurs directs.",
        ),
        {
          id: "mgt.temps_strategique",
          type: "choix_unique",
          libelle:
            "Quelle part de votre temps consacrez-vous aux questions de long terme (stratégie, développement), plutôt qu'aux opérations courantes ?",
          obligatoire: true,
          options: [
            { code: "moins_de_10", libelle: "Moins de 10 %" },
            { code: "de_10_a_25", libelle: "De 10 à 25 %" },
            { code: "de_25_a_50", libelle: "De 25 à 50 %" },
            { code: "plus_de_50", libelle: "Plus de 50 %" },
          ],
        },
        accord(
          "mgt.controle",
          "Je préfère vérifier moi-même les travaux importants plutôt que de m'appuyer sur des indicateurs.",
        ),
        accord(
          "mgt.avis_equipes",
          "Je demande régulièrement à mes équipes leur avis sur ma façon de diriger.",
        ),
      ],
    },
    {
      id: "culture",
      titre: "Culture de l'entreprise",
      questions: [
        {
          id: "cult.valeurs",
          type: "oui_non",
          libelle: "L'entreprise a-t-elle des valeurs écrites, partagées avec le personnel ?",
          obligatoire: true,
        },
        {
          id: "cult.valeurs_detail",
          type: "texte",
          libelle: "Quelles sont ces valeurs ?",
          obligatoire: false,
          longueurMax: 500,
          condition: { op: "egal", question: "cult.valeurs", valeur: true },
        },
        accord(
          "cult.erreur",
          "Chez nous, une erreur signalée est d'abord vue comme une occasion d'apprendre.",
        ),
        accord("cult.client", "La satisfaction du client guide les décisions du quotidien."),
        accord(
          "cult.resultats",
          "Les résultats de l'entreprise sont partagés avec l'ensemble du personnel.",
        ),
        {
          id: "cult.traits",
          type: "choix_multiple",
          libelle: "Quels traits décrivent le mieux la culture de l'entreprise ? (trois au plus)",
          obligatoire: true,
          maxSelections: 3,
          options: [
            { code: "familiale", libelle: "Familiale" },
            { code: "hierarchique", libelle: "Hiérarchique" },
            { code: "entrepreneuriale", libelle: "Entrepreneuriale" },
            { code: "resultats", libelle: "Tournée vers les résultats" },
            { code: "client", libelle: "Tournée vers le client" },
            { code: "prudente", libelle: "Prudente" },
            { code: "innovante", libelle: "Innovante" },
            { code: "solidaire", libelle: "Solidaire" },
          ],
        },
      ],
    },
    {
      id: "changement",
      titre: "Appétence au changement",
      questions: [
        accord(
          "chg.besoin",
          "L'entreprise devra changer en profondeur certaines de ses façons de faire dans les deux prochaines années.",
        ),
        {
          id: "chg.experience",
          type: "choix_unique",
          libelle:
            "Comment se sont déroulés les derniers changements importants (nouvel outil, réorganisation, nouveau marché) ?",
          obligatoire: true,
          options: [
            { code: "aucun", libelle: "Aucun changement important récent" },
            { code: "echec", libelle: "Plutôt mal : abandonné ou sans résultat" },
            { code: "mitige", libelle: "Avec des difficultés, résultat partiel" },
            { code: "reussi", libelle: "Bien : objectifs atteints" },
          ],
        },
        {
          id: "chg.freins",
          type: "texte",
          libelle: "Qu'est-ce qui a freiné ce changement ?",
          obligatoire: false,
          longueurMax: 1_000,
          condition: { op: "dans", question: "chg.experience", valeurs: ["echec", "mitige"] },
        },
        accord(
          "chg.disponibilite",
          "Je suis prêt à consacrer chaque semaine du temps au pilotage d'un projet de transformation.",
        ),
        {
          id: "chg.priorites",
          type: "choix_multiple",
          libelle: "Quels sujets souhaitez-vous traiter en priorité ? (trois au plus)",
          obligatoire: true,
          maxSelections: 3,
          options: [
            { code: "strategie", libelle: "Stratégie et développement" },
            { code: "organisation", libelle: "Organisation et gouvernance" },
            { code: "finances", libelle: "Finances et rentabilité" },
            { code: "commercial", libelle: "Commercial et marketing" },
            { code: "production", libelle: "Production et qualité" },
            { code: "ressources_humaines", libelle: "Ressources humaines" },
            { code: "numerique", libelle: "Numérique et systèmes d'information" },
          ],
        },
        {
          id: "chg.attentes",
          type: "texte",
          libelle: "Qu'attendez-vous de cette notation ?",
          obligatoire: false,
          longueurMax: 1_000,
        },
      ],
    },
  ],
};
