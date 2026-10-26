import type { CvDemo } from "./donnees-banque-cv-types.js";
import { CABINET, exp, FR_EN } from "./donnees-banque-cv-types.js";

/* CV de la direction du cabinet (associés, directeur et cheffes de mission). */
export const CV_DIRECTION: readonly CvDemo[] = [
  {
    cle: "associe",
    contenu: {
      titre: "Associée — stratégie, gouvernance et restructuration",
      nationalite: "Ivoirienne",
      resume:
        "Associée fondatrice, plus de vingt ans d'expérience du conseil en stratégie et en restructuration auprès de groupes ivoiriens et ouest-africains.",
      secteurs: ["Agro-industrie", "Banque et microfinance", "Énergie"],
      competences: ["Stratégie d'entreprise", "Restructuration", "Gouvernance", "Négociation"],
      experiences: [
        exp(
          "Associée fondatrice",
          CABINET,
          "CI",
          "2024-10",
          null,
          ["Agro-industrie", "Énergie"],
          "Direction du cabinet, pilotage des missions de stratégie et de redressement.",
        ),
        exp(
          "Directrice du conseil",
          "Delta Conseil Afrique",
          "CI",
          "2014-03",
          "2024-09",
          ["Agro-industrie", "Banque et microfinance"],
          "Direction d'une équipe de quinze consultants ; plans stratégiques de groupes agro-industriels.",
          "Banque de développement régionale (fictive)",
        ),
        exp(
          "Manager senior",
          "Cabinet Horizon Ouest-Africain",
          "SN",
          "2008-09",
          "2014-02",
          ["Banque et microfinance"],
          "Missions de restructuration et de gouvernance d'établissements financiers.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en finance d'entreprise",
          niveau: "bac_5",
          domaine: "Finance",
          etablissement: "École supérieure de gestion d'Abidjan (fictive)",
          annee: 2006,
        },
        {
          intitule: "Licence en économie",
          niveau: "bac_3",
          domaine: "Économie",
          etablissement: "Université d'Abidjan (fictive)",
          annee: 2004,
        },
      ],
      langues: [...FR_EN, { langue: "dioula", niveau: "bilingue" }],
    },
    majs: [
      {
        motif: "Ajout de la certification en gouvernance des entreprises",
        competences: ["Administrateur certifié (gouvernance)"],
      },
    ],
  },
  {
    cle: "associe.2",
    contenu: {
      titre: "Associé — finance d'entreprise et due diligence",
      nationalite: "Sénégalaise",
      resume:
        "Associé spécialisé en évaluation d'entreprise, due diligence et levée de fonds, dix-huit ans d'expérience en banque d'affaires et en conseil.",
      secteurs: ["Assurance", "Banque et microfinance", "Distribution"],
      competences: [
        "Due diligence",
        "Évaluation d'entreprise",
        "Levée de fonds",
        "Modélisation financière",
      ],
      experiences: [
        exp(
          "Associé",
          CABINET,
          "SN",
          "2024-10",
          null,
          ["Assurance", "Distribution"],
          "Missions de due diligence et d'accompagnement de levées de fonds.",
        ),
        exp(
          "Directeur des fusions-acquisitions",
          "Banque d'affaires Teranga Capital",
          "SN",
          "2012-01",
          "2024-09",
          ["Banque et microfinance", "Assurance"],
          "Une quarantaine d'opérations de fusion-acquisition en zone UEMOA.",
          "Fonds d'investissement régional (fictif)",
        ),
        exp(
          "Analyste financier senior",
          "Groupe Financier Sahel",
          "ML",
          "2007-06",
          "2011-12",
          ["Banque et microfinance"],
          "Analyse de crédit et notation interne de portefeuilles de PME.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en ingénierie financière",
          niveau: "bac_5",
          domaine: "Finance",
          etablissement: "Institut supérieur de gestion de Dakar (fictif)",
          annee: 2007,
        },
      ],
      langues: [...FR_EN, { langue: "wolof", niveau: "maternelle" }],
    },
    majs: [
      {
        motif: "Ajout de la mission de due diligence menée en 2025",
        competences: ["Valorisation par les flux de trésorerie"],
        experience: exp(
          "Responsable de la due diligence d'un opérateur solaire",
          CABINET,
          "CM",
          "2025-09",
          "2025-12",
          ["Énergie"],
          "Revue financière et opérationnelle pour un fonds d'investissement.",
          "Fonds d'investissement régional (fictif)",
        ),
      },
    ],
  },
  {
    cle: "directeur.mission",
    contenu: {
      titre: "Directeur de mission — plans stratégiques et conduite du changement",
      nationalite: "Malienne",
      resume:
        "Directeur de mission, quatorze ans de pilotage de plans stratégiques et de programmes de conduite du changement.",
      secteurs: ["Agro-industrie", "Transport et logistique", "Distribution"],
      competences: [
        "Plan stratégique",
        "Pilotage de mission",
        "Conduite du changement",
        "Gestion de projet",
      ],
      experiences: [
        exp(
          "Directeur de mission",
          CABINET,
          "CI",
          "2024-10",
          null,
          ["Agro-industrie", "Transport et logistique"],
          "Direction des missions de plan stratégique et de diagnostic.",
        ),
        exp(
          "Chef de projet senior",
          "Cabinet Baobab Stratégie",
          "ML",
          "2016-02",
          "2024-09",
          ["Agro-industrie", "Distribution"],
          "Pilotage de neuf plans stratégiques de PME et de groupes familiaux.",
        ),
        exp(
          "Consultant",
          "Cabinet Horizon Ouest-Africain",
          "SN",
          "2012-09",
          "2016-01",
          ["Transport et logistique"],
          "Diagnostics organisationnels et cartographie de processus.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en management stratégique",
          niveau: "bac_5",
          domaine: "Gestion",
          etablissement: "École supérieure de commerce de Bamako (fictive)",
          annee: 2012,
        },
      ],
      langues: [...FR_EN, { langue: "bambara", niveau: "maternelle" }],
    },
    majs: [
      {
        motif: "Ajout de la certification de gestion de projet",
        competences: ["Gestion de projet certifiée"],
      },
      {
        motif: "Ajout de la mission SICAFE",
        experience: exp(
          "Directeur de la mission de plan stratégique 2025-2028",
          CABINET,
          "CI",
          "2024-11",
          "2025-04",
          ["Agro-industrie"],
          "Cascade d'objectifs d'un groupe agro-industriel (holding et deux filiales).",
        ),
        competences: ["Cascade d'objectifs"],
      },
    ],
  },
  {
    cle: "chef.mission",
    contenu: {
      titre: "Cheffe de mission — audit organisationnel et contrôle de gestion",
      nationalite: "Burkinabè",
      resume:
        "Cheffe de mission, onze ans d'expérience en audit organisationnel, contrôle de gestion et animation d'ateliers.",
      secteurs: ["Agro-industrie", "Distribution"],
      competences: [
        "Audit organisationnel",
        "Contrôle de gestion",
        "Animation d'ateliers",
        "Gestion de projet",
      ],
      experiences: [
        exp(
          "Cheffe de mission",
          CABINET,
          "CI",
          "2024-10",
          null,
          ["Agro-industrie", "Distribution"],
          "Coordination d'équipes de trois à six consultants sur des missions de diagnostic et de redressement.",
        ),
        exp(
          "Consultante senior",
          "Cabinet Sahel Performance",
          "BF",
          "2017-04",
          "2024-09",
          ["Distribution"],
          "Audits organisationnels et mise en place de tableaux de bord.",
        ),
        exp(
          "Contrôleuse de gestion",
          "Société de distribution du Faso",
          "BF",
          "2014-01",
          "2017-03",
          ["Distribution"],
          "Budgets, reporting mensuel et analyse des écarts.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en contrôle de gestion",
          niveau: "bac_5",
          domaine: "Gestion",
          etablissement: "Université de Ouagadougou (fictive)",
          annee: 2013,
        },
      ],
      langues: [...FR_EN, { langue: "dioula", niveau: "bilingue" }],
    },
    majs: [
      {
        motif: "Ajout de l'expérience de redressement",
        experience: exp(
          "Cheffe de la mission de redressement",
          CABINET,
          "CM",
          "2025-03",
          "2025-11",
          ["Distribution"],
          "Plan de redressement d'un groupe brassicole.",
        ),
        competences: ["Redressement d'entreprise"],
      },
    ],
  },
];
