import type {
  CategorieExigenceAo,
  StatutAppelOffres,
  StatutConformiteAo,
} from "@missionpilot/shared";
import type { Devise } from "./format";

// --- Types des réponses de l'API -------------------------------------------------------------

export interface Rapprochement {
  score: number;
  composantes: Record<"secteur" | "competences" | "references" | "pays" | "bailleur", number>;
  competencesTrouvees: string[];
  referencesSecteur: number;
  referencesPays: number;
  referencesBailleur: number;
}

export interface FicheAo {
  id: string;
  reference: string | null;
  titre: string;
  objet: string | null;
  bailleur: string | null;
  pays: string | null;
  secteur: string | null;
  montant_estime: number | null;
  devise: Devise;
  date_publication: string | null;
  date_limite: string | null;
  source: "saisie" | "import";
  source_libelle: string | null;
  url: string | null;
  mots_cles: string[];
  statut: StatutAppelOffres;
  score_rapprochement: number;
  rapprochement: Rapprochement;
  responsable_id: string | null;
  responsable_nom: string | null;
  cree_le: string;
}

export interface EvenementAo {
  id: string;
  de_statut: StatutAppelOffres | null;
  vers_statut: StatutAppelOffres;
  motif: string | null;
  auteur_nom: string;
  cree_le: string;
}

export type FicheDetail = FicheAo & { evenements: EvenementAo[] };

export interface PageFiches {
  elements: FicheAo[];
  suivant: string | null;
}

export type Recommandation = "go" | "a_examiner" | "no_go";

export interface EvaluationAo {
  id: string;
  numero: number;
  entrees: Record<string, number>;
  score: number;
  recommandation: Recommandation;
  resultat: {
    criteres: { critere: string; poids: number; note: number | null }[];
    eliminatoires: string[];
  };
  marge_renseignee?: boolean;
  auteur_nom: string;
  cree_le: string;
}

export interface DecisionAo {
  id: string;
  evaluation_id: string;
  decision: "go" | "no_go";
  motif: string;
  decideur_nom: string;
  cree_le: string;
}

export interface GoNoGoAo {
  evaluations: EvaluationAo[];
  decisions: DecisionAo[];
}

export interface DossierAo {
  id: string;
  numero: number;
  source: "texte" | "fichier";
  nom_fichier: string | null;
  longueur: number;
  apercu: string;
  signaux_injection: string[];
  cree_par_nom: string;
  cree_le: string;
}

export interface PropositionExigence {
  libelle: string;
  categorie: CategorieExigenceAo;
  obligatoire: boolean;
  reference: string | null;
}

export interface ExtractionAo {
  id: string;
  dossier_id: string;
  methode: "ia" | "deterministe";
  gabarit: boolean;
  chiffres_non_verifies: boolean;
  tronque: boolean;
  propositions: PropositionExigence[];
  nombre: number;
  statut: "brouillon" | "validee" | "rejetee";
  retenues: number[] | null;
  cree_par_nom: string;
  cree_le: string;
}

export interface ExigenceAo {
  id: string;
  numero: number;
  libelle: string;
  categorie: CategorieExigenceAo;
  obligatoire: boolean;
  reference: string | null;
  origine: "manuelle" | "extraction";
  statut: StatutConformiteAo;
  commentaire: string | null;
  piece: string | null;
  responsable_id: string | null;
  responsable_nom: string | null;
}

export interface SyntheseConformiteAo {
  total: number;
  parStatut: Record<StatutConformiteAo, number>;
  obligatoires: number;
  obligatoiresSatisfaites: number;
  bloquantes: number;
  tauxConformite: number | null;
  pretAuDepot: boolean;
}

export interface MatriceAo {
  exigences: ExigenceAo[];
  synthese: SyntheseConformiteAo;
}

export interface AlerteFiche {
  aoId: string;
  type: "date_limite" | "etape_en_retard" | "etape_du_jour";
  niveau?: "depassee" | "j1" | "j3" | "j7";
  joursRestants: number;
  etapeCode?: string;
  etapeLibelle?: string;
}

export interface EtapeAo {
  id: string;
  ordre: number;
  code: string;
  libelle: string;
  date_prevue: string;
  responsable_id: string | null;
  responsable_nom: string | null;
  faite: boolean;
  tache_id: string | null;
  tache_statut: "a_faire" | "en_cours" | "fait" | null;
  tache_assignee_nom: string | null;
}

export interface RetroplanningAo {
  date_limite: string | null;
  statut: StatutAppelOffres;
  etapes: EtapeAo[];
  alertes: AlerteFiche[];
}

export interface AlerteCabinet {
  ao_id: string;
  titre: string;
  type: AlerteFiche["type"];
  niveau: AlerteFiche["niveau"] | null;
  jours_restants: number;
  etape_libelle: string | null;
}
