import type { CvDemo } from "./donnees-banque-cv-types.js";
import { CABINET, exp, FR_EN } from "./donnees-banque-cv-types.js";

/* CV de l'équipe de consultants (dont un ancien collaborateur, anonymisé ensuite). */
export const CV_EQUIPE: readonly CvDemo[] = [
  {
    cle: "chef.mission.2",
    contenu: {
      titre: "Chef de mission — notation financière et analyse de risque",
      nationalite: "Camerounaise",
      resume:
        "Chef de mission, neuf ans d'expérience en analyse financière, notation de PME et gestion des risques.",
      secteurs: ["Banque et microfinance", "Énergie"],
      competences: [
        "Notation financière",
        "Analyse de risque",
        "Modélisation financière",
        "Gestion de projet",
      ],
      experiences: [
        exp(
          "Chef de mission",
          CABINET,
          "CM",
          "2025-03",
          null,
          ["Banque et microfinance", "Énergie"],
          "Missions de notation et de due diligence.",
        ),
        exp(
          "Analyste risques senior",
          "Banque Atlantique Centrale (fictive)",
          "CM",
          "2018-06",
          "2025-02",
          ["Banque et microfinance"],
          "Notation interne des PME et comités de crédit.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en banque et finance",
          niveau: "bac_5",
          domaine: "Finance",
          etablissement: "Institut des finances de Douala (fictif)",
          annee: 2017,
        },
      ],
      langues: FR_EN,
    },
    majs: [
      {
        motif: "Ajout de la mission de notation Sahel Coton",
        experience: exp(
          "Chef de la mission de notation financière",
          CABINET,
          "ML",
          "2025-02",
          "2025-06",
          ["Agro-industrie"],
          "Notation d'un groupe cotonnier.",
        ),
      },
    ],
  },
  {
    cle: "consultant",
    contenu: {
      titre: "Consultant senior — diagnostic stratégique et business plan",
      nationalite: "Ivoirienne",
      resume:
        "Consultant senior, sept ans d'expérience en diagnostic stratégique, analyse de marché et modélisation financière.",
      secteurs: ["Agro-industrie", "Énergie", "Distribution"],
      competences: [
        "Diagnostic stratégique",
        "Business plan",
        "Modélisation financière",
        "Analyse de marché",
      ],
      experiences: [
        exp(
          "Consultant senior",
          CABINET,
          "CI",
          "2024-10",
          null,
          ["Agro-industrie", "Énergie"],
          "Diagnostics, business plans bancables et modèles financiers.",
        ),
        exp(
          "Consultant",
          "Delta Conseil Afrique",
          "CI",
          "2019-09",
          "2024-09",
          ["Distribution", "Énergie"],
          "Études de marché et plans d'affaires de PME.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en économie appliquée",
          niveau: "bac_5",
          domaine: "Économie",
          etablissement: "Université Félix Houphouët (fictive)",
          annee: 2019,
        },
      ],
      langues: [...FR_EN, { langue: "baoulé", niveau: "maternelle" }],
    },
    majs: [
      {
        motif: "Ajout de la certification en modélisation financière",
        competences: ["Modélisation financière certifiée"],
      },
    ],
  },
  {
    cle: "consultant.2",
    contenu: {
      titre: "Consultante senior — audit, contrôle interne et formation",
      nationalite: "Sénégalaise",
      resume:
        "Consultante senior, huit ans d'expérience en audit organisationnel, contrôle interne et ingénierie de formation.",
      secteurs: ["Banque et microfinance", "Assurance"],
      competences: [
        "Audit organisationnel",
        "Contrôle interne",
        "Gestion des risques",
        "Formation",
      ],
      experiences: [
        exp(
          "Consultante senior",
          CABINET,
          "SN",
          "2025-01",
          null,
          ["Banque et microfinance", "Assurance"],
          "Audits de dispositifs de contrôle interne et formations.",
        ),
        exp(
          "Auditrice interne",
          "Mutuelle d'assurance du Sahel",
          "SN",
          "2018-03",
          "2024-12",
          ["Assurance"],
          "Plans d'audit annuels, cartographie des risques.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en audit et contrôle",
          niveau: "bac_5",
          domaine: "Audit",
          etablissement: "Institut supérieur de gestion de Dakar (fictif)",
          annee: 2017,
        },
      ],
      langues: [...FR_EN, { langue: "wolof", niveau: "maternelle" }],
    },
    majs: [
      {
        motif: "Ajout de la formation de formateur certifié",
        competences: ["Formateur certifié"],
        langues: [
          { langue: "français", niveau: "maternelle" },
          { langue: "anglais", niveau: "bilingue" },
          { langue: "wolof", niveau: "maternelle" },
        ],
      },
    ],
  },
  {
    cle: "ex.consultant",
    nom: "Kévin Dago",
    contenu: {
      titre: "Consultant junior — études de marché et business plan",
      nationalite: "Ivoirienne",
      resume:
        "Consultant junior, études de marché et business plan (ancien collaborateur, parti en septembre 2025).",
      secteurs: ["Distribution", "Agro-industrie"],
      competences: ["Études de marché", "Business plan", "Animation d'ateliers"],
      experiences: [
        exp(
          "Consultant junior",
          CABINET,
          "CI",
          "2024-10",
          "2025-09",
          ["Distribution", "Agro-industrie"],
          "Études de marché et appui aux business plans.",
        ),
      ],
      diplomes: [
        {
          intitule: "Master en marketing",
          niveau: "bac_5",
          domaine: "Marketing",
          etablissement: "École supérieure de commerce d'Abidjan (fictive)",
          annee: 2024,
        },
      ],
      langues: FR_EN,
    },
    majs: [],
  },
];
