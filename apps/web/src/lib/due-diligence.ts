/**
 * Service « Due diligence » (SPEC-3b, DD-01 à DD-15) côté cabinet : contrats des réponses de
 * l'API, libellés, chemins, droits d'affichage, messages d'erreur et regroupements d'affichage.
 * Logique pure, testée dans `due-diligence.test.ts`.
 *
 * Les verdicts proposés, les solidités, les fourchettes de marché, les synthèses (chaîne, risques,
 * hypothèses, E&S, plan, note) sont ceux des moteurs de l'API (`packages/engines/src/due-diligence`) :
 * ce module les met en forme et ne les recalcule JAMAIS. Le web n'importe pas
 * `@missionpilot/engines` (CODING_STANDARDS §1) : les types ci-dessous reprennent la forme des
 * réponses (clés en snake_case, SPEC-3b §8).
 *
 * Les droits (`droitsDd`) ne servent qu'au confort d'affichage : l'API reste seule juge.
 */
import {
  aPermission,
  ANALYSE_DD_LIBELLES,
  CATEGORIE_ANALYSE_DD_LIBELLES,
  CODE_AVERTISSEMENT_NOTE_LIBELLES,
  CODE_BLOQUANT_NOTE_LIBELLES,
  DECISION_EXCLUSION_LIBELLES,
  ETAT_CONSTAT_SIGNAL_LIBELLES,
  FAMILLE_RISQUE_DD_LIBELLES,
  METHODE_DIMENSIONNEMENT_LIBELLES,
  NIVEAU_ES_LIBELLES,
  NIVEAU_RISQUE_DD_LIBELLES,
  PARAMETRE_DIMENSIONNEMENT_LIBELLES,
  PARAMETRES_DIMENSIONNEMENT,
  RECOMMANDATION_NOTE_LIBELLES,
  SENS_LIEN_DD_LIBELLES,
  STATUT_ACTION_100J_LIBELLES,
  THEME_ES_LIBELLES,
  TYPE_OPERATION_DD_LIBELLES,
  VARIANTE_NOTE_LIBELLES,
  VERDICT_DD_LIBELLES,
  type AnalyseDd,
  type CategorieAnalyseDd,
  type CodeAvertissementNote,
  type CodeBloquantNote,
  type CodeParametreDimensionnement,
  type DecisionExclusion,
  type EtatConstatSignal,
  type FamilleRisqueDd,
  type MethodeDimensionnement,
  type NiveauEs,
  type NiveauRisqueDd,
  type RecommandationNote,
  type Role,
  type SensLienDd,
  type StatutAction100j,
  type ThemeEs,
  type TypeOperationDd,
  type VarianteNote,
  type VerdictDd,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import { formaterMontantMineur, formaterNombre, VALEUR_ABSENTE, type Devise } from "./format";
import type { SoliditeVue } from "./preuves";
import { cheminPage, chargerToutesLesPages, type ChargementPage } from "./pagination";
import { messageRapport } from "./rapports";

// --- Réponses de l'API ----------------------------------------------------------------------

export interface PageDd<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export type LectureSolidite = "solide" | "etayee" | "fragile";
export type EtatHypothese = VerdictDd | "en_attente" | "ouverte";
export type EtatNote = "brouillon" | "soumise" | "validee" | "rejetee";

/** R01 : un dossier d'opération étudiée. Les libellés de taxonomie sont facultatifs (repli : taxonomie chargée). */
export interface DossierResume {
  id: string;
  numero: number | string;
  titre: string;
  secteur_code: string;
  pays_code: string;
  secteur_libelle?: string | null;
  pays_libelle?: string | null;
  cible_nom: string | null;
  type_operation: TypeOperationDd;
  devise: Devise;
  date_operation: string | null;
  version_cadrage: number;
  cree_par: string;
  cree_le: string;
}

/** R03 : dossier, cadrage courant, libellés de taxonomie et mission. */
export interface DossierDetail extends DossierResume {
  filiere_code: string | null;
  filiere_libelle: string | null;
  secteur_libelle: string | null;
  pays_libelle: string | null;
  question_investissement: string | null;
  perimetre: string | null;
  mission: { id: string; intitule: string; statut: string };
}

/** R06 : une version du cadrage. */
export interface VersionCadrage {
  version: number;
  titre: string;
  secteur_code: string;
  filiere_code: string | null;
  pays_code: string;
  cible_nom: string | null;
  type_operation: TypeOperationDd;
  devise: Devise;
  date_operation: string | null;
  question_investissement: string | null;
  perimetre: string | null;
  motif: string | null;
  cree_le: string;
}

export interface EntreeTaxonomie {
  id?: string;
  code: string;
  libelle: string;
  parent_code: string | null;
}

export type AvisExpertDd = boolean | { motif?: string | null; signe?: boolean } | null;

export interface PointAnalyse {
  id: string;
  assertion_id: string;
  version: number;
  libelle: string | null;
  enonce: string;
  niveau: NiveauRisqueDd | null;
  avis_expert: AvisExpertDd;
  solidite?: SoliditeVue | null;
  nb_pour: number;
  nb_contre: number;
  a_arbitrer: number;
}

export interface CategorieAnalyse {
  categorie: CategorieAnalyseDd;
  points: PointAnalyse[];
}

export interface BlocAnalyse {
  analyse: AnalyseDd;
  categories: CategorieAnalyse[];
}

export interface ReponseAnalyses {
  analyses: BlocAnalyse[];
  couverture: { points: number; solides: number; etayes: number; fragiles: number };
}

export interface RisqueEtape {
  id: string;
  libelle: string;
  famille: FamilleRisqueDd;
  niveau: NiveauRisqueDd;
  lecture: LectureSolidite | null;
}

export interface EtapeChaine {
  id: string;
  version: number;
  libelle: string;
  description: string | null;
  ordre: number;
  part_cout_bp: number | null;
  part_marge_bp: number | null;
  part_cout_affichee: string | null;
  part_marge_affichee: string | null;
  acteurs: string[];
  contraintes: string | null;
  rang_marge: number | null;
  risques: RisqueEtape[];
}

export type CoherenceParts = "vide" | "incomplete" | "coherente" | "incoherente";

export interface SyntheseChaine {
  total_cout_bp: number;
  total_marge_bp: number;
  coherence_cout: CoherenceParts;
  coherence_marge: CoherenceParts;
  etape_marge_max: string | null;
}

export interface ReponseChaine {
  etapes: EtapeChaine[];
  synthese: SyntheseChaine;
}

export interface RisqueDd {
  id: string;
  assertion_id: string;
  version: number;
  libelle: string;
  famille: FamilleRisqueDd;
  niveau: NiveauRisqueDd;
  etape_id: string | null;
  signal_id: string | null;
  enonce: string;
  solidite?: SoliditeVue | null;
  a_arbitrer: number;
}

export interface SyntheseRisques {
  total: number;
  familles: {
    famille: FamilleRisqueDd;
    total: number;
    par_niveau: Record<NiveauRisqueDd, number>;
    niveau_max: NiveauRisqueDd | null;
  }[];
  a_documenter: string[];
  par_etape: { etape_id: string; total: number; niveau_max: NiveauRisqueDd }[];
}

export interface ReponseRisques {
  risques: RisqueDd[];
  synthese: SyntheseRisques;
}

export interface SignalDossier {
  signal_id: string;
  version: number;
  libelle: string;
  famille: FamilleRisqueDd;
  gravite_indicative: NiveauRisqueDd;
  question: string | null;
  reference_publique: string | null;
  specificite: number;
  etat_constat: EtatConstatSignal | null;
  risque_id: string | null;
}

export interface IndicationVerdict {
  indication: VerdictDd;
  raison: string;
  conflit: boolean;
  soutien: Record<LectureSolidite, number>;
  contre: Record<LectureSolidite, number>;
}

export interface LienHypothese {
  assertion_id: string;
  sens: SensLienDd;
  enonce: string;
  solidite?: SoliditeVue | null;
  analyse_point: { analyse: AnalyseDd; categorie: CategorieAnalyseDd } | null;
}

export interface VerdictResume {
  id: string;
  verdict: VerdictDd;
  proposee_par?: string;
  proposee_le?: string;
}

export interface NoeudHypothese {
  id: string;
  parent_id: string | null;
  version: number;
  libelle: string;
  description: string | null;
  critere: string | null;
  liens: LienHypothese[];
  indication: IndicationVerdict;
  verdict_en_vigueur: VerdictResume | null;
  verdict_en_attente: VerdictResume | null;
  etat?: EtatHypothese;
}

export interface ControleArbre {
  total: number;
  racines: number;
  profondeur_max: number;
  par_etat: Record<"confirmee" | "infirmee" | "non_concluante" | "ouverte" | "en_attente", number>;
  incoherences: {
    noeud: string;
    code: "PARENT_CONFIRME_ENFANT_INFIRME" | "PARENT_INFIRME_TOUS_ENFANTS_CONFIRMES";
  }[];
}

export interface ReponseHypotheses {
  noeuds: NoeudHypothese[];
  arbre: ControleArbre;
}

export interface CitationVerdict {
  assertion_id: string;
  version: number;
  sens: SensLienDd;
  indice_num: number;
  indice_den: number;
  lecture: LectureSolidite;
}

export interface VerdictDetail {
  id: string;
  numero: number;
  verdict: VerdictDd;
  indication_moteur: VerdictDd;
  motif: string;
  assertions_citees: CitationVerdict[];
  proposee_par: string;
  proposee_le: string;
  decision: {
    decision: "valide" | "rejete";
    motif: string | null;
    valide_par: string;
    valide_le: string;
  } | null;
}

export interface SourceParametre {
  type: "preuve" | "avis_expert";
  preuve_id?: string;
  motif?: string;
}

export interface ParametreDimensionnement {
  code: CodeParametreDimensionnement;
  unite?: string;
  bas: number;
  base: number;
  haut: number;
  source: SourceParametre | null;
}

export interface Fourchette {
  bas: number;
  base: number;
  haut: number;
}

export interface SensibiliteParametre {
  code: CodeParametreDimensionnement;
  resultat_bas: number;
  resultat_haut: number;
  amplitude: number;
  part_amplitude_bp: number;
}

export interface CouvertureSources {
  total: number;
  preuve: number;
  avis_expert: number;
  absente: string[];
}

export interface AjustementDimensionnement {
  libelle: string;
  facteur_bp: number;
  motif: string;
}

/** Sortie du moteur de dimensionnement (R30, R31, R34). */
export interface ResultatDimensionnement {
  methode?: MethodeDimensionnement;
  etages: { code: string; valeurs: Fourchette }[];
  avant_ajustement: Fourchette;
  resultat: Fourchette;
  ajuste: boolean;
  ajustements_appliques: { libelle: string; facteur_bp: number; base: number }[];
  sensibilite: SensibiliteParametre[];
  couverture: CouvertureSources;
}

export interface Dimensionnement {
  id: string;
  methode: MethodeDimensionnement;
  version: number;
  libelle: string;
  parametres: ParametreDimensionnement[];
  ajustements: AjustementDimensionnement[];
  resultat: ResultatDimensionnement;
  couverture?: CouvertureSources;
}

export interface Recoupement {
  ecart_bp: number;
  plus_eleve: "descendant" | "ascendant" | "egal";
  alerte: boolean;
  chevauchement: boolean;
}

export interface ReponseDimensionnements {
  elements: Dimensionnement[];
  recoupement: Recoupement | null;
}

export interface ExclusionTouchee {
  regle: string;
  libelle: string;
  criteres: ("mot_cle" | "secteur" | "pays")[];
  mots_trouves: string[];
  decision: DecisionExclusion | null;
  decideur: string | null;
  decide_le: string | null;
}

export interface FiltrageDd {
  id: string;
  numero: number;
  liste_version: { liste_id?: string; nom?: string; version?: number } | number | null;
  declarations: { activites: string[]; secteur_codes: string[]; pays_codes: string[] };
  themes: {
    code: ThemeEs;
    niveau: NiveauEs;
    justification: string | null;
    assertion_id: string | null;
  }[];
  touches: ExclusionTouchee[];
  non_touchees: number;
  auteur_id: string;
  cree_le: string;
}

export interface SyntheseEs {
  niveau_global: NiveauEs;
  par_niveau: Record<NiveauEs, number>;
  manquants: string[];
  complet: boolean;
  a_documenter: string[];
  touches_bloquantes: number;
  bloquant: boolean;
}

/** Exclusion confirmée dans un filtrage antérieur et non levée dans le dernier (R39). */
export interface ExclusionAnterieureNonLevee {
  regle: string;
  libelle: string;
}

export interface ReponseFiltrages {
  elements: FiltrageDd[];
  /** Bloquantes comme les règles touchées sans décision ; comptées dans la synthèse. */
  exclusions_anterieures_non_levees: ExclusionAnterieureNonLevee[];
  synthese: SyntheseEs | null;
}

export interface ListeExclusion {
  id: string;
  nom: string;
  version: number;
  nb_regles: number;
  client_id: string | null;
  client_raison_sociale?: string | null;
  reference_cadre?: string | null;
}

export interface RegleExclusion {
  code: string;
  libelle: string;
  mots_cles: string[];
  secteur_codes: string[];
  pays_codes: string[];
}

export interface VersionListeExclusion {
  version: number;
  regles: RegleExclusion[];
  reference_cadre: string | null;
  motif: string | null;
  cree_le: string;
}

export interface SignalBibliotheque {
  id: string;
  code: string;
  version: number;
  libelle: string;
  description: string | null;
  famille: FamilleRisqueDd;
  secteur_code: string | null;
  pays_code: string | null;
  gravite_indicative: NiveauRisqueDd;
  question: string | null;
  reference_publique: string | null;
  actif: boolean;
}

export interface VersionSignal extends Omit<SignalBibliotheque, "id" | "code"> {
  motif: string | null;
  cree_le: string;
}

export interface AjustementDd {
  id: string;
  numero: number;
  cible_type: "verdict" | "risque" | "dimensionnement";
  cible_id: string;
  champ: string;
  valeur_avant: string;
  valeur_apres: string;
  motif: string;
  auteur_id: string;
  cree_le: string;
}

export interface LienPlanKpi {
  id: string | null;
  libelle?: string | null;
  masque?: boolean;
}

export interface ActionPlan100j {
  id: string;
  version: number;
  libelle: string;
  description: string | null;
  jour_debut: number;
  jour_fin: number;
  date_debut: string | null;
  date_fin: string | null;
  phase: PhasePlan;
  statut_action: StatutAction100j;
  en_retard: boolean;
  responsable: { id: string; nom: string | null } | null;
  plan_element: LienPlanKpi | null;
  kpi: LienPlanKpi | null;
}

export type PhasePlan = "jours_0_30" | "jours_31_60" | "jours_61_100";

export interface SynthesePlan {
  par_phase: Record<PhasePlan, { total: number; terminees: number }>;
  total: number;
  terminees: number;
  taux_realisation_bp: number | null;
  en_retard: string[];
  jour_courant: number | null;
  sans_responsable: string[];
  sans_indicateur: string[];
  sans_plan: string[];
}

export interface ReponsePlan100j {
  date_operation: string | null;
  actions: ActionPlan100j[];
  synthese: SynthesePlan;
}

export interface NoteResume {
  id: string;
  titre: string;
  derniere_version: number;
  etat: EtatNote;
  validee_version: number | null;
  cree_le: string;
}

export interface ControleNote {
  bloquants: CodeBloquantNote[];
  avertissements: CodeAvertissementNote[];
  soumissible: boolean;
}

export interface VersionNote {
  version: number;
  etat: "brouillon" | "soumise";
  recommandation: RecommandationNote;
  /** Absents des métadonnées de la liste des versions ; présents dans `contenu`. */
  synthese: string;
  conditions: string[];
  soumise_le: string | null;
  motif: string | null;
  cree_par?: string;
  cree_le: string;
}

/** Métadonnées d'une version dans la liste des versions (sans synthèse ni conditions). */
export type VersionNoteMeta = Omit<VersionNote, "synthese" | "conditions">;

export interface ValidationNote {
  note_version?: number;
  version?: number;
  decision: "valide" | "rejete";
  motif: string | null;
  valide_par: string;
  valide_le: string;
}

export interface NoteDetail {
  id: string;
  titre: string;
  dossier_id: string;
  cree_par: string;
  cree_le: string;
  versions: VersionNoteMeta[];
  contenu: VersionNote;
  validations: ValidationNote[];
  controle: ControleNote;
  etat?: EtatNote;
  validee_version?: number | null;
}

export interface SyntheseDossier {
  compteurs: Partial<
    Record<
      "points" | "etapes" | "risques" | "hypotheses" | "actions" | "dimensionnements" | "filtrages",
      number
    >
  >;
  sources: {
    solides: number;
    etayees: number;
    fragiles: number;
    anomalies_prv03: number;
  };
  arbre: ControleArbre;
  risques: SyntheseRisques;
  marche: {
    dimensionnements: {
      id: string;
      methode: MethodeDimensionnement;
      libelle: string;
      version: number;
      resultat: Fourchette;
      couverture: CouvertureSources;
    }[];
    recoupement: Recoupement | null;
  };
  filtrage_es: SyntheseEs | null;
  plan_100j: SynthesePlan;
  signaux: { applicables: number; constates: number; a_verifier: number; sans_constat?: number };
  note: { id?: string; titre?: string; derniere_version: number | null; etat: EtatNote } | null;
  ajustements: { total: number };
  controle_note: ControleNote;
}

/** Assertion de la mission, telle que listée par le registre des preuves (liens d'hypothèse). */
export interface AssertionChoix {
  id: string;
  enonce: string;
  statut?: string;
}

/** Preuve de la mission proposée comme source d'un paramètre (libellé = source précise). */
export interface PreuveChoix {
  id: string;
  source_precise: string;
  date_preuve?: string;
}

export interface MembreEquipe {
  utilisateur_id: string;
  nom: string;
}

// --- Libellés (jamais un code affiché) -------------------------------------------------------

export {
  ANALYSE_DD_LIBELLES,
  CATEGORIE_ANALYSE_DD_LIBELLES,
  DECISION_EXCLUSION_LIBELLES,
  ETAT_CONSTAT_SIGNAL_LIBELLES,
  FAMILLE_RISQUE_DD_LIBELLES,
  METHODE_DIMENSIONNEMENT_LIBELLES,
  NIVEAU_ES_LIBELLES,
  NIVEAU_RISQUE_DD_LIBELLES,
  PARAMETRE_DIMENSIONNEMENT_LIBELLES,
  RECOMMANDATION_NOTE_LIBELLES,
  SENS_LIEN_DD_LIBELLES,
  STATUT_ACTION_100J_LIBELLES,
  THEME_ES_LIBELLES,
  TYPE_OPERATION_DD_LIBELLES,
  VARIANTE_NOTE_LIBELLES,
  VERDICT_DD_LIBELLES,
};

export const ETAT_HYPOTHESE_LIBELLES: Record<EtatHypothese, string> = {
  ...VERDICT_DD_LIBELLES,
  en_attente: "En attente de validation",
  ouverte: "Ouverte",
};

export const ETAT_NOTE_LIBELLES: Record<EtatNote, string> = {
  brouillon: "Brouillon",
  soumise: "En attente de validation",
  validee: "Validée",
  rejetee: "Rejetée",
};

export const LECTURE_SOLIDITE_DD_LIBELLES: Record<LectureSolidite, string> = {
  solide: "Solide",
  etayee: "Étayée",
  fragile: "Fragile",
};

export const PHASE_PLAN_LIBELLES: Record<PhasePlan, string> = {
  jours_0_30: "Jours 0 à 30",
  jours_31_60: "Jours 31 à 60",
  jours_61_100: "Jours 61 à 100",
};

export const CRITERE_TOUCHE_LIBELLES: Record<"mot_cle" | "secteur" | "pays", string> = {
  mot_cle: "Mot-clé",
  secteur: "Secteur",
  pays: "Pays",
};

export const COHERENCE_LIBELLES: Record<CoherenceParts, string> = {
  vide: "Aucune étape renseignée.",
  incomplete: "incomplètes : au moins une étape n'a pas de part renseignée",
  coherente: "cohérentes : le total est proche de 100 %",
  incoherente: "incohérentes : le total s'écarte de 100 %",
};

export const CIBLE_AJUSTEMENT_LIBELLES: Record<AjustementDd["cible_type"], string> = {
  verdict: "Verdict d'hypothèse",
  risque: "Niveau de risque",
  dimensionnement: "Dimensionnement de marché",
};

export const RAISON_VERDICT_LIBELLES: Record<string, string> = {
  AUCUNE_ASSERTION: "Aucune assertion n'est liée à l'hypothèse.",
  CONTRE_SOLIDE_SANS_SOUTIEN_SOLIDE:
    "Une assertion solide contredit l'hypothèse et aucune assertion solide ne la soutient.",
  CONFLIT_SOLIDE: "Des assertions solides se contredisent : l'arbitrage revient à l'expert.",
  CONTRE_ETAYE_OU_SOLIDE: "Une assertion étayée ou solide contredit l'hypothèse.",
  SOUTIEN_SUFFISANT_SANS_CONTRE: "Le soutien est suffisant et rien de solide ne la contredit.",
  SOUTIEN_INSUFFISANT: "Le soutien est insuffisant : trop peu d'assertions solides ou étayées.",
};

export const libelleRaisonVerdict = (raison: string): string =>
  RAISON_VERDICT_LIBELLES[raison] ?? "Indication du moteur.";

/** Lecture du moteur → tonalité du badge (le texte est toujours affiché). */
export const TONALITE_LECTURE_DD: Record<LectureSolidite, TonaliteStatut> = {
  solide: "succes",
  etayee: "attention",
  fragile: "danger",
};

export const TONALITE_NIVEAU_RISQUE: Record<NiveauRisqueDd, TonaliteStatut> = {
  faible: "succes",
  modere: "neutre",
  eleve: "attention",
  critique: "danger",
};

export const TONALITE_NIVEAU_ES: Record<NiveauEs, TonaliteStatut> = {
  non_concerne: "neutre",
  faible: "succes",
  modere: "neutre",
  eleve: "attention",
  critique: "danger",
};

export const TONALITE_ETAT_HYPOTHESE: Record<EtatHypothese, TonaliteStatut> = {
  confirmee: "succes",
  infirmee: "danger",
  non_concluante: "attention",
  en_attente: "attention",
  ouverte: "neutre",
};

export const TONALITE_ETAT_NOTE: Record<EtatNote, TonaliteStatut> = {
  brouillon: "neutre",
  soumise: "attention",
  validee: "succes",
  rejetee: "danger",
};

export const TONALITE_STATUT_ACTION: Record<StatutAction100j, TonaliteStatut> = {
  a_faire: "neutre",
  en_cours: "attention",
  terminee: "succes",
  bloquee: "danger",
};

/** Options de liste de choix `{ valeur, libelle }` pour un vocabulaire fermé. */
export function optionsDe<T extends string>(
  valeurs: readonly T[],
  libelles: Record<T, string>,
): { valeur: T; libelle: string }[] {
  return valeurs.map((v) => ({ valeur: v, libelle: libelles[v] }));
}

// --- Chemins d'API (toujours `/api/*`, jamais l'origine de l'API) -----------------------------

const seg = (v: string) => encodeURIComponent(v);

export const cheminDossiers = (missionId: string) => `/api/missions/${seg(missionId)}/dd/dossiers`;
export const cheminDossier = (id: string) => `/api/dd/dossiers/${seg(id)}`;
export const cheminSynthese = (id: string) => `${cheminDossier(id)}/synthese`;
export const cheminCadrage = (id: string) => `${cheminDossier(id)}/cadrage`;
export const cheminVersionsCadrage = (id: string) => `${cheminCadrage(id)}/versions`;
export const cheminAnalyses = (id: string, analyse?: AnalyseDd | null) =>
  `${cheminDossier(id)}/analyses${analyse ? `?analyse=${analyse}` : ""}`;
export const cheminPoints = (id: string) => `${cheminDossier(id)}/points`;
export const cheminVersionsPoint = (id: string) => `/api/dd/points/${seg(id)}/versions`;
export const cheminChaine = (id: string) => `${cheminDossier(id)}/chaine`;
export const cheminEtapes = (id: string) => `${cheminChaine(id)}/etapes`;
export const cheminVersionsEtape = (id: string) => `/api/dd/etapes/${seg(id)}/versions`;
export const cheminRisques = (id: string, requete = "") =>
  `${cheminDossier(id)}/risques${requete ? `?${requete}` : ""}`;
export const cheminVersionsRisque = (id: string) => `/api/dd/risques/${seg(id)}/versions`;
export const cheminHypotheses = (id: string) => `${cheminDossier(id)}/hypotheses`;
export const cheminVersionsHypothese = (id: string) => `/api/dd/hypotheses/${seg(id)}/versions`;
export const cheminLiensHypothese = (id: string) => `/api/dd/hypotheses/${seg(id)}/liens`;
export const cheminAssertionsHypothese = (id: string) => `/api/dd/hypotheses/${seg(id)}/assertions`;
export const cheminVerdictsHypothese = (id: string) => `/api/dd/hypotheses/${seg(id)}/verdicts`;
export const cheminValidationVerdict = (id: string) => `/api/dd/verdicts/${seg(id)}/validation`;
export const cheminSignaux = (requete = "") => `/api/dd/signaux${requete ? `?${requete}` : ""}`;
export const cheminVersionsSignal = (id: string) => `/api/dd/signaux/${seg(id)}/versions`;
export const cheminSignauxDossier = (id: string) => `${cheminDossier(id)}/signaux`;
export const cheminConstatSignal = (dossierId: string, signalId: string) =>
  `${cheminSignauxDossier(dossierId)}/${seg(signalId)}/constats`;
export const cheminDimensionnements = (id: string) => `${cheminDossier(id)}/dimensionnements`;
export const cheminVersionsDimensionnement = (id: string) =>
  `/api/dd/dimensionnements/${seg(id)}/versions`;
export const cheminCalculDimensionnement = () => "/api/dd/dimensionnements/calculer";
export const cheminListesExclusion = (requete = "") =>
  `/api/dd/listes-exclusion${requete ? `?${requete}` : ""}`;
export const cheminVersionsListe = (id: string) => `/api/dd/listes-exclusion/${seg(id)}/versions`;
export const cheminFiltrages = (id: string) => `${cheminDossier(id)}/filtrages`;
export const cheminDecisionsFiltrage = (id: string) => `/api/dd/filtrages/${seg(id)}/decisions`;
export const cheminAjustements = (id: string) => `${cheminDossier(id)}/ajustements`;
export const cheminPlan100j = (id: string) => `${cheminDossier(id)}/plan-100j`;
export const cheminActionsPlan = (id: string) => `${cheminPlan100j(id)}/actions`;
export const cheminVersionsAction = (id: string) => `/api/dd/actions/${seg(id)}/versions`;
export const cheminNotes = (id: string) => `${cheminDossier(id)}/notes`;
export const cheminNote = (id: string, version?: number | null) =>
  `/api/dd/notes/${seg(id)}${version ? `?version=${version}` : ""}`;
export const cheminVersionsNote = (id: string) => `/api/dd/notes/${seg(id)}/versions`;
export const cheminSoumissionNote = (id: string) => `/api/dd/notes/${seg(id)}/soumission`;
export const cheminValidationNote = (id: string) => `/api/dd/notes/${seg(id)}/validation`;
export const cheminRapportsNote = (id: string, requete = "") =>
  `/api/dd/notes/${seg(id)}/rapports${requete ? `?${requete}` : ""}`;
export const cheminTaxonomie = (taxonomie: "secteur" | "filiere" | "pays") =>
  `/api/standard/taxonomies?taxonomie=${taxonomie}`;

/** Plafond de `limite` de R38 (versions d'une liste : une version pèse jusqu'à 200 Ko), 10 par défaut. */
export const LIMITE_VERSIONS_LISTE_DD = 20;

/** Lecture d'une page de l'API depuis le navigateur (`api.get`), injectée pour rester testable. */
export type LirePageDd = <T>(chemin: string) => Promise<PageDd<T>>;

/**
 * R38 : toutes les versions d'une liste d'exclusion (plus récente d'abord), page par page
 * (`limiteMax: 20`, sinon l'API répond 400). Une erreur sur une page est rendue avec son message.
 */
export function chargerVersionsListe(
  id: string,
  lire: LirePageDd,
): Promise<ChargementPage<{ elements: VersionListeExclusion[]; tronquee: boolean }>> {
  return chargerToutesLesPages<VersionListeExclusion>(
    async (chemin) => {
      try {
        const page = await lire<VersionListeExclusion>(chemin);
        return { ok: true, donnees: { elements: page.elements, suivant: page.curseur_suivant } };
      } catch (e) {
        return { ok: false, message: messageDd(e), statut: e instanceof ErreurApi ? e.statut : 0 };
      }
    },
    cheminVersionsListe(id),
    { limiteMax: LIMITE_VERSIONS_LISTE_DD },
  );
}

/** R38 : la seule version COURANTE (première page d'un élément) ; `null` si la liste n'a aucune version. */
export async function chargerVersionCouranteListe(
  id: string,
  lire: LirePageDd,
): Promise<VersionListeExclusion | null> {
  const page = await lire<VersionListeExclusion>(cheminPage(cheminVersionsListe(id), 1, null));
  return [...page.elements].sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Phrase de l'écran du filtrage pour les exclusions antérieures non levées (`null` s'il n'y en a pas). */
export function phraseExclusionsAnterieures(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "1 exclusion confirmée lors d'une revue antérieure n'a pas été levée dans la dernière revue : elle reste bloquante."
    : `${n} exclusions confirmées lors d'une revue antérieure n'ont pas été levées dans la dernière revue : elles restent bloquantes.`;
}

/** Plafond de `limite` des routes paginées du module (R24, R35, R53) et de la route des taxonomies. */
export const LIMITE_LISTE_DD = 100;

// --- Chemins de pages -----------------------------------------------------------------------

export const hrefListeDossiers = (missionId: string) => `/missions/${seg(missionId)}/due-diligence`;
export const hrefNouveauDossier = (missionId: string) => `${hrefListeDossiers(missionId)}/nouveau`;
export const hrefDossier = (missionId: string, dossierId: string) =>
  `${hrefListeDossiers(missionId)}/${seg(dossierId)}`;

export const ECRANS_DOSSIER = [
  "cadrage",
  "analyses",
  "chaine",
  "risques",
  "hypotheses",
  "marche",
  "environnement-social",
  "plan-100-jours",
  "note",
  "documents",
  "ajustements",
] as const;
export type EcranDossier = (typeof ECRANS_DOSSIER)[number];

export const hrefEcranDossier = (missionId: string, dossierId: string, ecran: EcranDossier) =>
  `${hrefDossier(missionId, dossierId)}/${ecran}`;
export const hrefHypothese = (missionId: string, dossierId: string, hypotheseId: string) =>
  `${hrefEcranDossier(missionId, dossierId, "hypotheses")}/${seg(hypotheseId)}`;
export const hrefNote = (missionId: string, dossierId: string, noteId: string) =>
  `${hrefEcranDossier(missionId, dossierId, "note")}/${seg(noteId)}`;
/** Fiche d'une assertion du registre des preuves : on y relie les sources (preuves). */
export const hrefAssertionRegistre = (missionId: string, assertionId: string) =>
  `/missions/${seg(missionId)}/preuves/assertions/${seg(assertionId)}`;
export const hrefAnalyses = (missionId: string, dossierId: string, analyse: AnalyseDd) =>
  `${hrefEcranDossier(missionId, dossierId, "analyses")}?analyse=${analyse}`;

export const hrefParametresDd = "/parametres/due-diligence";
export const hrefSignaux = `${hrefParametresDd}/signaux`;
export const hrefListesExclusion = `${hrefParametresDd}/exclusions`;

/** Onglets d'un dossier (l'onglet actif est celui dont le href est le plus long préfixe). */
export function sousPagesDd(
  missionId: string,
  dossierId: string,
  options: { partage?: boolean } = {},
) {
  const h = (e: EcranDossier) => hrefEcranDossier(missionId, dossierId, e);
  const base = [
    { id: "synthese", libelle: "Synthèse", href: hrefDossier(missionId, dossierId) },
    { id: "cadrage", libelle: "Cadrage", href: h("cadrage") },
    { id: "analyses", libelle: "Analyses", href: h("analyses") },
    { id: "chaine", libelle: "Chaîne de valeur", href: h("chaine") },
    { id: "risques", libelle: "Risques", href: h("risques") },
    { id: "hypotheses", libelle: "Hypothèses", href: h("hypotheses") },
    { id: "marche", libelle: "Marché", href: h("marche") },
    {
      id: "environnement-social",
      libelle: "Environnement et social",
      href: h("environnement-social"),
    },
    { id: "plan-100-jours", libelle: "Plan des 100 jours", href: h("plan-100-jours") },
    { id: "note", libelle: "Note au comité", href: h("note") },
    { id: "documents", libelle: "Documents", href: h("documents") },
    { id: "ajustements", libelle: "Ajustements", href: h("ajustements") },
  ] as const;
  // Partage avec l'investisseur (dd.portail.gerer) : onglet ajouté seulement pour qui peut le gérer.
  return options.partage
    ? ([
        ...base,
        {
          id: "portail",
          libelle: "Partage investisseur",
          href: `${hrefDossier(missionId, dossierId)}/portail`,
        },
      ] as const)
    : base;
}

/** Onglets des paramètres de la due diligence. */
export function sousPagesParametresDd(options: { portail?: boolean } = {}) {
  const base = [
    { id: "signaux", libelle: "Signaux d'alerte", href: hrefSignaux },
    { id: "exclusions", libelle: "Listes d'exclusion", href: hrefListesExclusion },
    { id: "modeles", libelle: "Modèles sectoriels", href: `${hrefParametresDd}/modeles` },
  ] as const;
  // Option « portail investisseur » du cabinet (dd.portail.configurer, associé seul).
  return options.portail
    ? ([
        ...base,
        {
          id: "portail",
          libelle: "Portail investisseur",
          href: `${hrefParametresDd}/portail`,
        },
      ] as const)
    : base;
}

/** Écran où corriger un point bloquant ou un avertissement de la note. */
export const ECRAN_BLOQUANT: Record<CodeBloquantNote | CodeAvertissementNote, EcranDossier> = {
  SANS_HYPOTHESE: "hypotheses",
  HYPOTHESE_SANS_VERDICT_VALIDE: "hypotheses",
  SOURCES_MANQUANTES: "analyses",
  EXCLUSION_NON_LEVEE_FAVORABLE: "environnement-social",
  HYPOTHESE_INFIRMEE_FAVORABLE: "hypotheses",
  CONDITIONS_MANQUANTES: "note",
  RISQUES_CRITIQUES_FRAGILES: "risques",
  AUCUN_DIMENSIONNEMENT: "marche",
  RECOUPEMENT_MARCHE_DIVERGENT: "marche",
  ARBRE_INCOHERENT: "hypotheses",
};

export interface PointDeControle {
  code: string;
  gravite: "bloquant" | "avertissement";
  libelle: string;
  ecran: EcranDossier;
}

/** Bloquants puis avertissements du moteur, chacun en une phrase française avec son écran. */
export function pointsDeControle(controle: ControleNote | null | undefined): PointDeControle[] {
  if (!controle) return [];
  return [
    ...controle.bloquants.map((code) => ({
      code,
      gravite: "bloquant" as const,
      libelle: CODE_BLOQUANT_NOTE_LIBELLES[code] ?? "Point bloquant à corriger.",
      ecran: ECRAN_BLOQUANT[code] ?? "note",
    })),
    ...controle.avertissements.map((code) => ({
      code,
      gravite: "avertissement" as const,
      libelle: CODE_AVERTISSEMENT_NOTE_LIBELLES[code] ?? "Point d'attention.",
      ecran: ECRAN_BLOQUANT[code] ?? "note",
    })),
  ];
}

// --- Droits d'affichage ---------------------------------------------------------------------

export interface DroitsDd {
  lire: boolean;
  /** Écrire : permission du rôle et mission ouverte (l'API reste la source de vérité). */
  ecrire: boolean;
  valider: boolean;
  gererReferentiel: boolean;
}

export function droitsDd(roles: readonly Role[], mission?: { statut: string }): DroitsDd {
  return {
    lire: aPermission(roles, "dd.lire"),
    ecrire: aPermission(roles, "dd.ecrire") && mission?.statut !== "cloturee",
    valider: aPermission(roles, "dd.valider") && mission?.statut !== "cloturee",
    gererReferentiel: aPermission(roles, "dd.referentiel.gerer"),
  };
}

/** Signer un avis d'expert : expert métier ou associé, comme le registre des preuves. */
export const peutSignerAvisDd = (roles: readonly Role[]): boolean =>
  roles.includes("expert_metier") || roles.includes("associe");

// --- Erreurs --------------------------------------------------------------------------------

const MESSAGES_DD: Record<string, string> = {
  MISSION_CLOTUREE: "La mission est clôturée : le dossier de due diligence est figé.",
  PLAFOND_ATTEINT: "Ce dossier atteint le plafond d'éléments de ce type.",
  VERSION_PERIMEE:
    "Une autre modification vient d'être enregistrée. Rechargez la page puis recommencez.",
  CONFLIT: "Une autre modification vient d'être enregistrée. Rechargez la page puis recommencez.",
  TAXONOMIE_INCONNUE:
    "Le secteur, la filière ou le pays choisi n'existe pas (ou plus), ou la filière n'appartient pas au secteur.",
  NOTE_BLOQUEE:
    "La note ne peut pas être soumise : des points bloquants restent à corriger (voir le contrôle).",
  NOTE_TROP_VOLUMINEUSE: "La base de la note dépasse la taille autorisée : réduisez le dossier.",
  NOTE_PERIMEE:
    "Cette version n'est plus la dernière soumise. Rechargez la page pour voir la version à valider.",
  NOTE_DEJA_DECIDEE: "Cette version de la note a déjà fait l'objet d'une décision.",
  NOTE_NON_VALIDEE:
    "Aucune version validée de la note : le rapport n'est généré qu'après la validation d'un tiers.",
  SEPARATION_DES_TACHES:
    "La validation revient à une autre personne que l'auteur : vous avez contribué à ce contenu. Demandez à un tiers (un associé peut le faire).",
  VERDICT_EN_ATTENTE:
    "Un verdict attend déjà sa validation pour cette hypothèse : décidez-le avant d'en proposer un autre.",
  VERDICT_SANS_SOURCE:
    "Un verdict confirmé ou infirmé cite des assertions liées à l'hypothèse dans le bon sens (soutient pour confirmée, contredit pour infirmée).",
  VERDICT_PERIME:
    "Ce verdict n'est plus le dernier ou l'hypothèse a changé depuis. Rechargez la page.",
  VERDICT_DEJA_DECIDE: "Ce verdict a déjà fait l'objet d'une décision.",
  MOTIF_ECART_REQUIS:
    "Le niveau choisi diffère de la gravité indicative du signal d'alerte : précisez le motif de l'écart.",
  MOTIF_DETAILLE_REQUIS:
    "Ce verdict s'écarte de l'indication du moteur : un motif détaillé (20 caractères au moins) est exigé.",
  LIEN_INCOHERENT:
    "Un lien choisi n'appartient pas à ce dossier ou à ce client (étape, signal, responsable, initiative, indicateur ou liste).",
  RATTACHEMENT_INCOHERENT:
    "Le rattachement est incohérent : élément d'une autre mission, lien absent ou catégorie inconnue.",
  ARBRE_TROP_PROFOND: "L'arbre d'hypothèses ne dépasse pas quatre niveaux.",
  ASSERTION_ABANDONNEE: "Cette assertion est abandonnée : elle ne peut plus être liée.",
  CLASSE_RISQUE_ABAISSEE:
    "La classe de risque d'une assertion ne s'abaisse pas sans habilitation d'expert.",
  PARAMETRE_SANS_SOURCE:
    "Chaque paramètre cite une preuve de la mission ou un avis d'expert motivé (10 caractères au moins).",
  DIMENSIONNEMENT_INVALIDE:
    "Les paramètres du dimensionnement sont invalides : bornes bas ≤ base ≤ haut, pourcentages entre 0 et 100 %.",
  DEPASSEMENT:
    "Le résultat dépasse les capacités de calcul : vérifiez les ordres de grandeur saisis.",
  SIGNAL_EXISTANT: "Un signal porte déjà ce code dans la bibliothèque du cabinet.",
  LISTE_EXISTANTE: "Une liste d'exclusion porte déjà ce nom.",
  INTERDIT: "Votre rôle ne vous permet pas d'effectuer cette action.",
  ACCES_REFUSE: "Votre rôle ne vous permet pas d'effectuer cette action.",
};

const MESSAGE_INTROUVABLE = "Cet élément n'existe plus ou n'est pas accessible. Rechargez la page.";

/** Codes bloquants reçus dans `details.manquants` d'un refus `NOTE_BLOQUEE`. */
export function codesManquants(e: unknown): CodeBloquantNote[] {
  if (!(e instanceof ErreurApi)) return [];
  const d = e.details as { manquants?: unknown } | undefined;
  if (!d || !Array.isArray(d.manquants)) return [];
  return d.manquants.filter(
    (c): c is CodeBloquantNote => typeof c === "string" && c in CODE_BLOQUANT_NOTE_LIBELLES,
  );
}

/** Message français pour un refus de l'API du module (le code sert au test, le texte à l'écran). */
export function messageDd(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "NOTE_BLOQUEE") {
      const manquants = codesManquants(e);
      if (manquants.length > 0) {
        return `${MESSAGES_DD.NOTE_BLOQUEE} ${manquants
          .map((c) => CODE_BLOQUANT_NOTE_LIBELLES[c])
          .join(" ")}`;
      }
    }
    if (e.code === "TROP_DE_RAPPORTS" || e.code.startsWith("RENDU_")) return messageRapport(e);
    const specifique = MESSAGES_DD[e.code];
    if (specifique) return specifique;
    if (e.statut === 404) return MESSAGE_INTROUVABLE;
    if (e.statut === 409 || (e.statut === 400 && e.message !== "Données invalides.")) {
      return e.message;
    }
  }
  return messageErreur(e);
}

/** Après ce refus, l'écran est probablement périmé : rafraîchir les données. */
export const etatDdChange = (e: unknown): boolean =>
  e instanceof ErreurApi &&
  (e.statut === 404 || (e.statut === 409 && e.code !== "PLAFOND_ATTEINT"));

// --- Mise en forme --------------------------------------------------------------------------

const NBSP = String.fromCharCode(0xa0);

/** Points de base → « 25,5 % » (affichage seulement ; les parts viennent des moteurs). */
export function formaterBp(bp: number | null | undefined): string {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return VALEUR_ABSENTE;
  return `${formaterNombre(bp / 100, 2)}${NBSP}%`;
}

/** Valeur d'un paramètre de dimensionnement selon son unité (nombre, pourcentage, montant). */
export function formaterValeurParametre(
  code: CodeParametreDimensionnement,
  valeur: number,
  devise: Devise,
): string {
  const unite = uniteParametre(code);
  if (unite === "pourcentage_bp") return formaterBp(valeur);
  if (unite === "montant") return formaterMontantMineur(valeur, devise);
  return formaterNombre(valeur, 0);
}

export function uniteParametre(code: string): "nombre" | "pourcentage_bp" | "montant" {
  const tous = [...PARAMETRES_DIMENSIONNEMENT.descendant, ...PARAMETRES_DIMENSIONNEMENT.ascendant];
  return tous.find((p) => p.code === code)?.unite ?? "nombre";
}

export const libelleParametre = (code: string): string =>
  (PARAMETRE_DIMENSIONNEMENT_LIBELLES as Record<string, string>)[code] ?? "Paramètre";

export const libelleCategorie = (categorie: string): string =>
  (CATEGORIE_ANALYSE_DD_LIBELLES as Record<string, string>)[categorie] ?? "Catégorie";

export const libelleTheme = (code: string): string =>
  (THEME_ES_LIBELLES as Record<string, string>)[code] ?? "Thème";

/** Libellé d'une taxonomie par code ; sans correspondance, un texte neutre (jamais un code). */
export function libelleTaxonomie(
  entrees: readonly Pick<EntreeTaxonomie, "code" | "libelle">[],
  code: string | null | undefined,
): string {
  if (!code) return VALEUR_ABSENTE;
  return entrees.find((e) => e.code === code)?.libelle ?? "Libellé indisponible";
}

/** Secteur et pays d'un dossier : libellé reçu de l'API, sinon taxonomie chargée. */
export function libellesDossier(
  d: Pick<DossierResume, "secteur_code" | "pays_code" | "secteur_libelle" | "pays_libelle">,
  secteurs: readonly Pick<EntreeTaxonomie, "code" | "libelle">[],
  pays: readonly Pick<EntreeTaxonomie, "code" | "libelle">[],
): { secteur: string; pays: string } {
  return {
    secteur: d.secteur_libelle ?? libelleTaxonomie(secteurs, d.secteur_code),
    pays: d.pays_libelle ?? libelleTaxonomie(pays, d.pays_code),
  };
}

/** Avis d'expert présent sur un point (booléen ou objet de la réponse). */
export function aAvisExpert(v: AvisExpertDd | undefined): boolean {
  if (v === null || v === undefined) return false;
  return typeof v === "boolean" ? v : true;
}

/** Texte de fragilité d'un point (porté par le texte, pas seulement par la couleur). */
export function messageFragilite(p: Pick<PointAnalyse, "nb_pour" | "avis_expert">): string | null {
  if (p.nb_pour === 0)
    return aAvisExpert(p.avis_expert) ? "Avis d'expert, sans source" : "Aucune source";
  if (p.nb_pour === 1) return "Source unique";
  return null;
}

/** État d'un nœud d'hypothèse : l'état reçu, sinon dérivé du verdict en vigueur ou en attente. */
export function etatVerdict(
  n: Pick<NoeudHypothese, "etat" | "verdict_en_vigueur" | "verdict_en_attente">,
): EtatHypothese {
  if (n.etat && n.etat in ETAT_HYPOTHESE_LIBELLES) return n.etat;
  if (n.verdict_en_vigueur) return n.verdict_en_vigueur.verdict;
  if (n.verdict_en_attente) return "en_attente";
  return "ouverte";
}

export interface NoeudArbre {
  noeud: NoeudHypothese;
  profondeur: number;
  enfants: NoeudArbre[];
}

/** Arbre d'affichage construit depuis la liste plate (ordre de l'API conservé, profondeur ≤ 4). */
export function construireArbre(noeuds: readonly NoeudHypothese[]): NoeudArbre[] {
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const enfantsDe = new Map<string | null, NoeudHypothese[]>();
  for (const n of noeuds) {
    const parent = n.parent_id && parId.has(n.parent_id) ? n.parent_id : null;
    const liste = enfantsDe.get(parent) ?? [];
    liste.push(n);
    enfantsDe.set(parent, liste);
  }
  const construire = (parent: string | null, profondeur: number, vus: Set<string>): NoeudArbre[] =>
    (enfantsDe.get(parent) ?? [])
      .filter((n) => !vus.has(n.id) && profondeur <= 4)
      .map((n) => ({
        noeud: n,
        profondeur,
        enfants: construire(n.id, profondeur + 1, new Set([...vus, n.id])),
      }));
  return construire(null, 1, new Set());
}

/** Profondeur d'un nœud (1 = racine) ; une boucle ou un parent inconnu arrête la remontée. */
export function profondeurNoeud(
  id: string,
  noeuds: readonly Pick<NoeudHypothese, "id" | "parent_id">[],
): number {
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  let profondeur = 1;
  let courant = parId.get(id)?.parent_id ?? null;
  const vus = new Set<string>([id]);
  while (courant && parId.has(courant) && !vus.has(courant)) {
    vus.add(courant);
    profondeur += 1;
    courant = parId.get(courant)?.parent_id ?? null;
  }
  return profondeur;
}

/** Nœuds sous lesquels on peut encore ajouter une sous-hypothèse (profondeur < 4). */
export function parentsPossibles(
  noeuds: readonly NoeudHypothese[],
  profondeurMax = 4,
): NoeudHypothese[] {
  return noeuds.filter((n) => profondeurNoeud(n.id, noeuds) < profondeurMax);
}

/** Étape de la chaîne affichée par la carte : objet simple, sérialisable. */
export interface EtapeCarte {
  id: string;
  libelle: string;
  ordre: number;
  acteurs: string[];
  partCoutAffichee: string;
  partMargeAffichee: string;
  margeMax: boolean;
  risques: RisqueEtape[];
}

/** Étapes triées par ordre pour la carte ; la plus forte marge est celle que le moteur désigne. */
export function etapesPourCarte(chaine: ReponseChaine): EtapeCarte[] {
  return [...chaine.etapes]
    .sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, "fr"))
    .map((e) => ({
      id: e.id,
      libelle: e.libelle,
      ordre: e.ordre,
      acteurs: e.acteurs ?? [],
      partCoutAffichee: e.part_cout_affichee ?? VALEUR_ABSENTE,
      partMargeAffichee: e.part_marge_affichee ?? VALEUR_ABSENTE,
      margeMax: chaine.synthese?.etape_marge_max === e.id,
      risques: e.risques ?? [],
    }));
}

/** Phrase sur les parts de coût (étapes incomplètes ou incohérentes), `null` si tout va bien. */
export function messageCoherenceChaine(s: SyntheseChaine | null | undefined): string | null {
  if (!s) return null;
  const messages: string[] = [];
  if (s.coherence_cout === "incomplete" || s.coherence_cout === "incoherente") {
    messages.push(`Les parts de coût sont ${COHERENCE_LIBELLES[s.coherence_cout]}.`);
  }
  if (s.coherence_marge === "incomplete" || s.coherence_marge === "incoherente") {
    messages.push(`Les parts de marge sont ${COHERENCE_LIBELLES[s.coherence_marge]}.`);
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

/** Risques regroupés par famille, dans l'ordre canonique ; les familles vides sont conservées. */
export function risquesParFamille<T extends { famille: FamilleRisqueDd }>(
  risques: readonly T[],
  familles: readonly FamilleRisqueDd[],
): { famille: FamilleRisqueDd; risques: T[] }[] {
  return familles.map((famille) => ({
    famille,
    risques: risques.filter((r) => r.famille === famille),
  }));
}

/** Plus haut niveau d'un risque pour le tri d'affichage (le plus grave d'abord). */
const RANG_NIVEAU: Record<NiveauRisqueDd, number> = { faible: 1, modere: 2, eleve: 3, critique: 4 };
export function trierParGravite<T extends { niveau: NiveauRisqueDd }>(risques: readonly T[]): T[] {
  return [...risques].sort((a, b) => RANG_NIVEAU[b.niveau] - RANG_NIVEAU[a.niveau]);
}

// --- Paramètres d'URL -----------------------------------------------------------------------

type ParamsUrl = Record<string, string | string[] | undefined>;
const premier = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;
const estDans = <T extends string>(liste: readonly T[], v: string | undefined): v is T =>
  v !== undefined && (liste as readonly string[]).includes(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Analyse choisie dans l'URL (la première par défaut) ; une valeur inconnue est écartée. */
export function lireAnalyse(sp: ParamsUrl, analyses: readonly AnalyseDd[]): AnalyseDd {
  const v = premier(sp.analyse);
  return estDans(analyses, v) ? v : analyses[0]!;
}

export interface FiltresRisques {
  famille?: FamilleRisqueDd;
  niveau?: NiveauRisqueDd;
  etape_id?: string;
}

export function lireFiltresRisques(
  sp: ParamsUrl,
  familles: readonly FamilleRisqueDd[],
  niveaux: readonly NiveauRisqueDd[],
): FiltresRisques {
  const famille = premier(sp.famille);
  const niveau = premier(sp.niveau);
  const etape = premier(sp.etape_id);
  return {
    ...(estDans(familles, famille) ? { famille } : {}),
    ...(estDans(niveaux, niveau) ? { niveau } : {}),
    ...(etape && UUID.test(etape) ? { etape_id: etape } : {}),
  };
}

/** Requête de R13 (`risquesQuerySchema`) : seules les valeurs connues sont transmises. */
export function requeteRisques(f: FiltresRisques): string {
  const u = new URLSearchParams();
  if (f.famille) u.set("famille", f.famille);
  if (f.niveau) u.set("niveau", f.niveau);
  if (f.etape_id) u.set("etape_id", f.etape_id);
  return u.toString();
}

export function lireCibleAjustement(sp: ParamsUrl): AjustementDd["cible_type"] | undefined {
  const v = premier(sp.cible);
  return estDans(["verdict", "risque", "dimensionnement"] as const, v) ? v : undefined;
}

/** Ajustements filtrés par type de cible (liste bornée à 1 000 par l'API : filtre local). */
export function filtrerAjustements(
  liste: readonly AjustementDd[],
  cible: AjustementDd["cible_type"] | undefined,
): AjustementDd[] {
  return cible ? liste.filter((a) => a.cible_type === cible) : [...liste];
}

/** Requête de R24 (`signauxQuerySchema`) construite depuis les paramètres d'URL. */
export interface FiltresSignaux {
  famille?: FamilleRisqueDd;
  secteur_code?: string;
  pays_code?: string;
  actif?: "true" | "false";
  q?: string;
}

const CODE_TAXONOMIE_URL = /^[a-z0-9_.-]{1,120}$/;

export function lireFiltresSignaux(
  sp: ParamsUrl,
  familles: readonly FamilleRisqueDd[],
): FiltresSignaux {
  const famille = premier(sp.famille);
  const secteur = premier(sp.secteur_code);
  const pays = premier(sp.pays_code);
  const actif = premier(sp.actif);
  const q = premier(sp.q)?.trim().slice(0, 100);
  return {
    ...(estDans(familles, famille) ? { famille } : {}),
    ...(secteur && CODE_TAXONOMIE_URL.test(secteur) ? { secteur_code: secteur } : {}),
    ...(pays && CODE_TAXONOMIE_URL.test(pays) ? { pays_code: pays } : {}),
    ...(actif === "true" || actif === "false" ? { actif } : {}),
    ...(q ? { q } : {}),
  };
}

export function requeteSignaux(f: FiltresSignaux, curseur?: string | null): string {
  const u = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(f)) if (valeur) u.set(cle, valeur);
  u.set("limite", String(LIMITE_LISTE_DD));
  if (curseur) u.set("curseur", curseur);
  return u.toString();
}

export function libelleLienPlan(l: LienPlanKpi | null | undefined): string {
  if (!l || l.id === null) return l?.masque ? "Lien non visible" : "Aucun";
  return l.libelle ?? "Élément lié";
}

/** Résumé d'une opération (carte de dossier) : type, cible, devise. */
export function resumeOperation(
  d: Pick<DossierResume, "type_operation" | "cible_nom" | "devise">,
): string {
  const type = TYPE_OPERATION_DD_LIBELLES[d.type_operation];
  return d.cible_nom ? `${type} · ${d.cible_nom}` : type;
}

export const libelleRecommandation = (r: RecommandationNote): string =>
  RECOMMANDATION_NOTE_LIBELLES[r];

export const libelleVariante = (v: VarianteNote): string => VARIANTE_NOTE_LIBELLES[v];

export const METHODE_COURTE_LIBELLES: Record<MethodeDimensionnement, string> = {
  descendant: "Descendante",
  ascendant: "Ascendante",
};

/**
 * Le valideur peut-il décider ? Confort d'affichage de la séparation des tâches : jamais l'auteur
 * (sauf associé). L'API et la base jugent (MPZ25, MPZ26, MPZ28).
 */
export function peutValiderSansConflit(
  roles: readonly Role[],
  utilisateurId: string,
  auteurs: readonly (string | null | undefined)[],
): boolean {
  if (!aPermission(roles, "dd.valider")) return false;
  if (roles.includes("associe")) return true;
  return !auteurs.includes(utilisateurId);
}

/** État d'une note : celui reçu, sinon dérivé de ses versions et de ses validations. */
export function etatNote(n: Pick<NoteDetail, "etat" | "versions" | "validations">): EtatNote {
  if (n.etat && n.etat in ETAT_NOTE_LIBELLES) return n.etat;
  const derniere = [...n.versions].sort((a, b) => b.version - a.version)[0];
  if (!derniere || derniere.etat === "brouillon") return "brouillon";
  const decision = n.validations.find((v) => (v.note_version ?? v.version) === derniere.version);
  if (!decision) return "soumise";
  return decision.decision === "valide" ? "validee" : "rejetee";
}

/** Dernière version validée d'une note (`null` : aucune). */
export function versionValidee(
  n: Pick<NoteDetail, "validee_version" | "validations">,
): number | null {
  if (typeof n.validee_version === "number") return n.validee_version;
  const valides = n.validations
    .filter((v) => v.decision === "valide")
    .map((v) => v.note_version ?? v.version)
    .filter((v): v is number => typeof v === "number");
  return valides.length > 0 ? Math.max(...valides) : null;
}

/** Réponse d'une écriture : `{ id }` à la création, `{ version }` à la correction (et `resultat` du marché). */
export interface ReponseEcriture {
  id?: string;
  version?: number;
}

/** Plus faible lecture parmi les assertions liées (la plus prudente) ; `null` : aucune évaluée. */
export function lectureMinimale(
  liens: readonly { solidite?: { lecture: LectureSolidite } | null }[],
): LectureSolidite | null {
  const lectures = liens.flatMap((l) => (l.solidite ? [l.solidite.lecture] : []));
  if (lectures.length === 0) return null;
  if (lectures.includes("fragile")) return "fragile";
  if (lectures.includes("etayee")) return "etayee";
  return "solide";
}

/** Réponse de R03 : le cadrage courant est imbriqué (`cadrage`) ; les anciennes formes plates restent lues. */
export type DossierBrut = Omit<DossierDetail, keyof CadrageDossier> & {
  cadrage?: CadrageDossier;
} & Partial<CadrageDossier>;
type CadrageDossier = Pick<
  DossierDetail,
  | "titre"
  | "secteur_code"
  | "filiere_code"
  | "pays_code"
  | "cible_nom"
  | "type_operation"
  | "devise"
  | "date_operation"
  | "question_investissement"
  | "perimetre"
>;

/** Remonte le cadrage imbriqué de R03 au niveau du dossier (un seul contrat pour les écrans). */
export function aplatirDossier(brut: DossierBrut): DossierDetail {
  const { cadrage, ...reste } = brut;
  return { ...cadrage, ...reste, ...(cadrage ?? {}) } as DossierDetail;
}

/** Champ d'un ajustement tracé, en français (le code technique n'est jamais affiché). */
export const CHAMP_AJUSTEMENT_LIBELLES: Record<string, string> = {
  verdict: "Verdict",
  niveau: "Niveau de risque",
  facteur: "Facteur d'ajustement",
};

/** Valeur avant ou après d'un ajustement : libellé français pour un verdict ou un niveau, sinon telle quelle. */
export function libelleValeurAjustement(
  a: Pick<AjustementDd, "cible_type" | "champ">,
  valeur: string,
): string {
  if (a.cible_type === "verdict") {
    return (VERDICT_DD_LIBELLES as Record<string, string>)[valeur] ?? valeur;
  }
  if (a.cible_type === "risque" && a.champ === "niveau") {
    return (NIVEAU_RISQUE_DD_LIBELLES as Record<string, string>)[valeur] ?? valeur;
  }
  return valeur;
}

/** Phrase du jour courant d'un plan : avant la date d'opération, le nombre de jours restants. */
export function phraseJourCourant(jour: number | null): string {
  if (jour === null) return "";
  if (jour < 0) {
    const restants = -jour;
    return ` L'opération n'a pas commencé : début dans ${restants} jour${restants > 1 ? "s" : ""}.`;
  }
  return ` Jour courant : ${jour}.`;
}
