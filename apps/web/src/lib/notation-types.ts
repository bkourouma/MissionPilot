/** Notation : types des réponses de l'API (voir `notation.ts`). */
import type { StatutVersionNotation, StrategieNotation } from "@missionpilot/shared";

// --- Types des réponses de l'API ------------------------------------------------------------

export type Classe = "A" | "B" | "C" | "D" | "E";
export type Evolution = "hausse" | "baisse" | "stable" | "non_comparable";

export interface IndicateurResultat {
  indicateur: string;
  question: string;
  statut: "repondu" | "manquant" | "sans_objet";
  points: number | null;
}

/** Dimension du calcul figé (moteur `noterQuestionnaire` / `noterRepondants`). */
export interface DimensionResultat {
  dimension: string;
  libelle: string;
  famille: string;
  notable: boolean;
  score: number | null;
  scoreExact: string | null;
  classe: Classe | null;
  /** Couverture (0-1) du poids des indicateurs applicables. */
  couverture: number;
  indicateurs: IndicateurResultat[];
  /** Poids normalisé (somme 100). */
  poids: number;
  poidsExact: string;
}

export interface ResultatNotation {
  grille: string;
  version: number;
  secteur: string | null;
  strategie: StrategieNotation;
  notable: boolean;
  score: number | null;
  scoreExact: string | null;
  classe: Classe | null;
  /** Part (0-1) du poids des dimensions qui est notable. */
  couverture: number;
  dimensions: DimensionResultat[];
}

/** Dimension après ajustements motivés (moteur `appliquerAjustement`). */
export interface DimensionAjustee {
  dimension: string;
  libelle: string;
  famille: string;
  scoreCalcule: number | null;
  score: number | null;
  classe: Classe | null;
  deltaCumule: number;
}

export interface AjustementNotation {
  rang: number;
  dimension: string;
  delta: number;
  motif: string;
  date: string;
  score_avant: number;
  score_apres: number;
  plafonne: boolean;
  auteur: { id: string; nom: string };
  cree_le: string;
}

export type ActionRevue = "soumission" | "renvoi" | "publication";

export interface EvenementRevue {
  rang: number;
  action: ActionRevue;
  motif: string | null;
  par: { id: string; nom: string };
  le: string;
}

export interface RepondantEcart {
  id: string;
  nom?: string;
  fonction?: string | null;
}

/** Écart entre répondants (NOT-05), détecté par le moteur. */
export interface EcartRepondants {
  question: string;
  libelle: string;
  min: number;
  max: number;
  ecart: number;
  nombre_repondants: number;
  repondants_min: RepondantEcart[];
  repondants_max: RepondantEcart[];
}

/** Réponse de GET /api/notations/:id/version (et des actions qui rendent une version). */
export interface VueVersionNotation {
  id: string;
  notation_id: string;
  numero: number;
  statut: StatutVersionNotation;
  envoi_id: string;
  grille: {
    version_id: string | null;
    generique: boolean;
    code: string;
    version: number;
    titre: string;
  };
  secteur: string | null;
  strategie: StrategieNotation;
  reponses_utilisees: number;
  calcule_par: { id: string; nom: string | null };
  calcule_le: string;
  resultat: ResultatNotation;
  score: {
    notable: boolean;
    score_calcule: number | null;
    score: number | null;
    classe: Classe | null;
    dimensions: DimensionAjustee[];
  };
  ajustements: AjustementNotation[];
  revue: EvenementRevue[];
  ecarts: EcartRepondants[];
}

export interface VersionResume {
  numero: number;
  statut: StatutVersionNotation;
  score: number | null;
  classe: Classe | null;
  calcule_le: string;
  publiee_le: string | null;
}

/** Réponse de GET /api/missions/:id/notation. */
export interface ResumeNotation {
  id: string;
  mission_id: string;
  client_id: string;
  cree_par: string;
  cree_le: string;
  /** Du plus récent au plus ancien. */
  versions: VersionResume[];
}

export interface BarreDimension {
  dimension: string;
  libelle: string;
  score: number | null;
  classe: Classe | null;
}

export interface DimensionClassee {
  dimension: string;
  libelle: string;
  score: number;
}

/** Données du rapport (moteur `donneesRapport`). */
export interface DonneesRapport {
  global: { score: number | null; classe: Classe | null };
  radar: { dimension: string; axe: string; score: number | null }[];
  barres: { famille: string; dimensions: BarreDimension[] }[];
  forces: DimensionClassee[];
  faiblesses: DimensionClassee[];
}

export interface EcartScore {
  avant: number | null;
  apres: number | null;
  ecart: number | null;
  evolution: Evolution;
}

/** Comparaison avec la notation publiée précédente du client (moteur `comparerNotations`). */
export interface ComparaisonNotation {
  precedente: {
    notation_id: string;
    numero: number;
    mission_intitule: string;
    publiee_le: string;
    score: number | null;
    classe: Classe | null;
  };
  global: EcartScore;
  classeAvant: Classe | null;
  classeApres: Classe | null;
  ecartClasses: number | null;
  dimensions: (EcartScore & { dimension: string; libelle: string })[];
}

/** Réponse de GET /api/notations/:id/rapport. */
export interface RapportNotation {
  notation_id: string;
  mission_id: string;
  version: {
    numero: number;
    statut: StatutVersionNotation;
    calcule_le: string;
    publiee_le: string | null;
  };
  donnees: DonneesRapport;
  comparaison: ComparaisonNotation | null;
}

/** Envoi de questionnaire de la mission (GET /api/missions/:id/questionnaires), sans réponse. */
export interface EnvoiQuestionnaire {
  id: string;
  titre: string;
  mode: "individuel" | "collectif" | "par_fonction";
  statut: "brouillon" | "envoye" | "clos";
  repondants: number;
  reponses_soumises: number;
  envoye_le: string | null;
  clos_le: string | null;
}
