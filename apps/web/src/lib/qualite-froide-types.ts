/**
 * Types des réponses de l'API de la revue à froid (QUA-05) ; voir `qualite-froide.ts`.
 */
import type {
  ConclusionRevueFroide,
  GraviteConstatFroid,
  StatutActionFroide,
  StatutCampagneFroide,
  StatutEchantillonFroid,
  StrateEchantillon,
} from "@missionpilot/shared";

export interface CampagneResume {
  id: string;
  intitule: string;
  statut: StatutCampagneFroide;
  graine: string;
  taille_demandee: number;
  taille_obtenue: number;
  terminees: number;
  cree_le: string;
  cloturee_le: string | null;
}

export interface PageCampagnes {
  elements: CampagneResume[];
  curseur_suivant: string | null;
}

export interface LigneEchantillon {
  id: string;
  rang: number;
  cle: string;
  statut: StatutEchantillonFroid;
  mission_id: string;
  mission_intitule: string;
  client_nom: string;
  type_mission_libelle: string | null;
  directeur_nom: string | null;
  mission_cloturee_le: string | null;
  relecteur_id: string | null;
  relecteur_nom: string | null;
  affecte_le: string | null;
  score: number | null;
  conclusion: ConclusionRevueFroide | null;
  terminee_le: string | null;
}

export interface CriteresTirage {
  periode_debut: string;
  periode_fin: string;
  types_mission_ids: string[];
  directeur_ids: string[];
  stratifier_par: StrateEchantillon | null;
  exclure_deja_revues: boolean;
}

export interface CampagneDetail {
  id: string;
  intitule: string;
  criteres: CriteresTirage;
  taille_demandee: number;
  taille_obtenue: number;
  graine: string;
  empreinte_population: string;
  population_taille: number;
  statut: StatutCampagneFroide;
  cree_par_nom: string | null;
  cree_le: string;
  cloturee_le: string | null;
  progression: { total: number; terminees: number };
  echantillon: LigneEchantillon[];
}

export interface EcartVerification {
  type: string;
  message: string;
  attendu: unknown;
  obtenu: unknown;
}

export interface VerificationTirage {
  reproductible: boolean;
  graine: string;
  empreinte_population: string;
  population_taille: number;
  taille_echantillon: number;
  ecarts: EcartVerification[];
}

export interface ViolationIndependance {
  code: string;
  message: string;
}

export interface RelecteurEligible {
  id: string;
  nom: string;
  eligible: boolean;
  violations: ViolationIndependance[];
}

export interface EligibiliteRelecteurs {
  echantillon_id: string;
  relecteurs: RelecteurEligible[];
}

export interface MaRevue {
  id: string;
  campagne_id: string;
  campagne_intitule: string;
  rang: number;
  statut: StatutEchantillonFroid;
  affecte_le: string | null;
  score: number | null;
  conclusion: ConclusionRevueFroide | null;
  terminee_le: string | null;
  criteres_evalues: number;
  criteres_total: number;
  mission_intitule: string;
  client_nom: string;
}

export interface ConstatLie {
  id: string;
  critere: string | null;
  gravite: GraviteConstatFroid;
  description: string;
}

export interface HistoriqueAction {
  rang: number;
  de_statut: StatutActionFroide | null;
  vers_statut: StatutActionFroide;
  responsable_id: string | null;
  responsable_nom: string | null;
  echeance: string | null;
  commentaire: string | null;
  auteur_nom: string | null;
  le: string;
}

export interface ActionFroide {
  id: string;
  campagne_id: string;
  constat_id: string | null;
  titre: string;
  description: string | null;
  responsable_id: string;
  responsable_nom: string | null;
  echeance: string;
  statut: StatutActionFroide;
  cree_le: string;
  cloturee_le: string | null;
  en_retard: boolean;
  campagne_intitule?: string;
  constat?: ConstatLie | null;
  historique?: HistoriqueAction[];
}

export interface PageActions {
  elements: ActionFroide[];
  curseur_suivant: string | null;
}

/** Indicateurs du plan : tous calculés par le moteur (`taux_realisation` va de 0 à 100). */
export interface EtatPlan {
  total: number;
  a_faire: number;
  en_cours: number;
  faites: number;
  abandonnees: number;
  en_retard: number;
  taux_realisation: number;
  prochaine_echeance: string | null;
}

export interface PlanAmelioration {
  campagne_id: string;
  date_reference: string;
  etat: EtatPlan;
  actions: ActionFroide[];
}

export interface EvaluationCritere {
  critere: string;
  note: number | null;
  commentaire: string | null;
  evalue_le: string;
}

export interface ConstatFroid {
  id: string;
  critere: string | null;
  gravite: GraviteConstatFroid;
  description: string;
  recommandation: string | null;
  cree_le: string;
}

export interface ResultatMoteur {
  complete: boolean;
  manquants: string[];
  score: number | null;
  couverture: number;
  conclusion: ConclusionRevueFroide | null;
  motifs: string[];
}

export interface VueEchantillon {
  echantillon: {
    id: string;
    rang: number;
    statut: StatutEchantillonFroid;
    campagne: { id: string; intitule: string; statut: StatutCampagneFroide };
    mission: {
      mission_id: string;
      mission_intitule: string;
      client_nom: string;
      type_mission_libelle: string | null;
      directeur_nom: string | null;
      mission_cloturee_le: string | null;
    };
    relecteur: { id: string; nom: string } | null;
    affecte_le: string | null;
    score: number | null;
    conclusion: ConclusionRevueFroide | null;
    synthese: string | null;
    terminee_le: string | null;
  };
  evaluations: EvaluationCritere[];
  constats: ConstatFroid[];
  resultat: ResultatMoteur;
  grille: { version: number; criteres: { code: string; libelle: string; poids: number }[] };
  peut_ecrire: boolean;
}

export interface BudgetDossier {
  version_reference?: number;
  budget_jours?: number | null;
  devise?: "XOF" | "XAF" | "EUR" | "USD";
  honoraires?: number | null;
  debours_refacturables?: number | null;
  debours_non_refacturables?: number | null;
  couts_internes?: number | null;
  sous_traitance?: number | null;
  marge?: number | null;
  taux_marge?: number | null;
}

export interface DossierRevue {
  echantillon_id: string;
  mission: {
    intitule: string;
    statut: string;
    date_debut: string | null;
    date_fin: string | null;
    date_signature: string | null;
    cloturee_le: string | null;
    client_nom: string;
    type_mission_libelle: string | null;
    directeur_nom: string | null;
    chef_nom: string | null;
  };
  suivis_qualite: {
    id: string;
    type_livrable: string;
    libelle: string;
    version: number;
    classe: string;
    statut: string;
    signature: { signataire_nom: string | null; qualite: string | null; signe_le: string } | null;
  }[];
  acceptation: {
    niveau_risque: string;
    decision: string;
    evalue_le: string;
    conflits_detectes: number;
  } | null;
  satisfaction: {
    notes: { moment: string; jalon_libelle: string | null; note: number; saisi_le: string }[];
    synthese: {
      total: number;
      promoteurs: number;
      passifs: number;
      detracteurs: number;
      nps: string | null;
    };
  };
  derogations: { total: number; approuvees: number; refusees: number; demandees: number };
  methode?: { code: string; libelle: string; version: number } | null;
  budget?: BudgetDossier;
}
