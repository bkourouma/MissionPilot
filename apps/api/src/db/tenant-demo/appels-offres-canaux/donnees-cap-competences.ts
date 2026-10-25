import type { CleCollaborateur, CleCompte } from "../cles.js";
import type { CleMissionCasting } from "./outils.js";

/* Référentiel de compétences, déclarations, décisions et preuves de repli du Tenant démo (CAP-06). */

export interface CompetenceDemo {
  code: string;
  libelle: string;
  description: string;
  briques: string[];
  types_livrable: string[];
}

export const COMPETENCES: CompetenceDemo[] = [
  {
    code: "diagnostic_strategique",
    libelle: "Diagnostic et plan stratégique",
    description: "Diagnostic externe et interne, SWOT, axes, objectifs et feuille de route.",
    briques: ["diagnostic_strategique", "swot", "vision_mission", "axes_objectifs"],
    types_livrable: ["plan"],
  },
  {
    code: "modelisation_financiere",
    libelle: "Modélisation financière",
    description: "Hypothèses, modèle de projection, scénarios et plan de financement.",
    briques: ["calcul_modele", "hypotheses", "plan_financement", "scenarios"],
    types_livrable: ["plan"],
  },
  {
    code: "analyse_financiere",
    libelle: "Analyse financière et notation",
    description: "Analyse des comptes historiques, calcul et justification d'une note.",
    briques: ["analyse_financiere", "analyse_historique", "calcul_note"],
    types_livrable: ["notation", "etat"],
  },
  {
    code: "entretiens_restitution",
    libelle: "Entretiens et restitution aux dirigeants",
    description: "Conduite d'entretiens, questionnaires préliminaires et restitution orale.",
    briques: [
      "entretiens_individuels",
      "questionnaire_preliminaire",
      "restitution_dirigeants",
      "restitution_plan",
      "restitution_dirigeant",
    ],
    types_livrable: [],
  },
  {
    code: "redaction_rapports",
    libelle: "Rédaction de rapports de mission",
    description: "Rapports de notation, dossiers bancaires et feuilles de route rédigés.",
    briques: ["rapport_notation", "dossier_bancaire", "feuille_de_route"],
    types_livrable: ["rapport", "notation"],
  },
  {
    code: "conduite_business_plan",
    libelle: "Conduite d'un business plan bancable",
    description: "Cadrage, plan de financement, dossier bancaire et suivi des demandes.",
    briques: ["cadrage_projet", "dossier_bancaire", "plan_financement", "suivi_demandes"],
    types_livrable: ["plan"],
  },
];

export interface DeclarationDemo {
  /** Collaborateur évalué ; déclare lui-même sauf si `declarant` est précisé. */
  collaborateur: CleCollaborateur;
  declarant?: CleCompte;
  competence: string;
  niveau: 1 | 2 | 3 | 4;
  commentaire: string;
  decision?: { par: CleCompte; decision: "validee" | "refusee"; commentaire: string };
}

export const DECLARATIONS: DeclarationDemo[] = [
  {
    collaborateur: "consultant",
    competence: "modelisation_financiere",
    niveau: 3,
    commentaire: "Modèle du business plan d'Atlantique Retail conduit de bout en bout.",
    decision: {
      par: "directeur.mission",
      decision: "validee",
      commentaire: "Modèle relu et conforme.",
    },
  },
  {
    collaborateur: "consultant",
    competence: "analyse_financiere",
    niveau: 2,
    commentaire: "Analyse financière de la notation de Sahel Coton.",
    decision: {
      par: "associe",
      decision: "validee",
      commentaire: "Niveau confirmé sur la mission.",
    },
  },
  {
    collaborateur: "consultant.2",
    competence: "diagnostic_strategique",
    niveau: 3,
    commentaire: "Diagnostic et SWOT du plan stratégique de la SICAFÉ.",
    decision: {
      par: "associe.2",
      decision: "validee",
      commentaire: "Diagnostic solide, bien animé.",
    },
  },
  {
    collaborateur: "consultant.2",
    competence: "entretiens_restitution",
    niveau: 2,
    commentaire: "Entretiens individuels de la notation de Sahel Coton.",
    decision: {
      par: "ressources",
      decision: "validee",
      commentaire: "Validé avec le directeur de mission.",
    },
  },
  {
    collaborateur: "consultant.junior",
    competence: "redaction_rapports",
    niveau: 2,
    commentaire: "Rédaction du rapport de notation sous la relecture du chef de mission.",
    decision: { par: "directeur.mission", decision: "validee", commentaire: "Rapports clairs." },
  },
  {
    collaborateur: "consultant.junior",
    competence: "modelisation_financiere",
    niveau: 3,
    commentaire: "Participation au modèle du business plan.",
    decision: {
      par: "directeur.mission",
      decision: "refusee",
      commentaire:
        "Niveau trop élevé au regard du rôle tenu (saisie et contrôles) : redéclarer au niveau 2.",
    },
  },
  {
    collaborateur: "consultant.junior",
    competence: "modelisation_financiere",
    niveau: 2,
    commentaire: "Redéclaration après la décision : saisie des hypothèses et contrôles du modèle.",
    decision: {
      par: "directeur.mission",
      decision: "validee",
      commentaire: "Niveau cohérent avec la pratique.",
    },
  },
  {
    collaborateur: "chef.mission",
    competence: "diagnostic_strategique",
    niveau: 4,
    commentaire: "Pilotage de plusieurs plans stratégiques de grands groupes.",
    decision: {
      par: "associe",
      decision: "validee",
      commentaire: "Référente du cabinet sur le sujet.",
    },
  },
  {
    collaborateur: "chef.mission",
    competence: "conduite_business_plan",
    niveau: 3,
    commentaire: "Conduite du business plan bancable d'Atlantique Retail.",
    decision: {
      par: "directeur.mission",
      decision: "validee",
      commentaire: "Confirmé par les banques consultées.",
    },
  },
  {
    collaborateur: "consultant.junior.2",
    competence: "entretiens_restitution",
    niveau: 1,
    commentaire: "Première participation à des entretiens, en observateur.",
  },
  {
    collaborateur: "consultant.stagiaire",
    declarant: "directeur.mission",
    competence: "redaction_rapports",
    niveau: 1,
    commentaire: "Déclaré par le directeur de mission après deux mois de stage.",
    decision: { par: "associe", decision: "validee", commentaire: "Niveau notions confirmé." },
  },
];

export interface PreuveDemo {
  mission: CleMissionCasting;
  collaborateur: CleCollaborateur;
  competence: string;
}

/** Preuves de repli (temps planifié des tâches rattachées) si aucun temps validé ne les produit. */
export const PREUVES_REPLI: PreuveDemo[] = [
  { mission: "planSicafe", collaborateur: "consultant.2", competence: "diagnostic_strategique" },
  { mission: "planSicafe", collaborateur: "chef.mission", competence: "diagnostic_strategique" },
  { mission: "planSicafe", collaborateur: "consultant.junior", competence: "redaction_rapports" },
  { mission: "notationSahel", collaborateur: "consultant", competence: "analyse_financiere" },
  { mission: "notationSahel", collaborateur: "consultant.2", competence: "entretiens_restitution" },
  {
    mission: "notationSahel",
    collaborateur: "consultant.junior",
    competence: "redaction_rapports",
  },
  {
    mission: "businessPlanAtlantique",
    collaborateur: "consultant",
    competence: "modelisation_financiere",
  },
  {
    mission: "businessPlanAtlantique",
    collaborateur: "chef.mission",
    competence: "conduite_business_plan",
  },
  {
    mission: "businessPlanAtlantique",
    collaborateur: "consultant.junior",
    competence: "modelisation_financiere",
  },
];
