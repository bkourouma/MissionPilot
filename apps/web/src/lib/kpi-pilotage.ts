/**
 * Pilotage augmenté des KPI côté cabinet (PRD complémentaire §11.4) : arbres d'indicateurs
 * (KPI-13), qualité des données (KPI-15), revues de performance (KPI-17) et actions correctives
 * (KPI-18). Contrats des réponses de l'API, chemins, libellés, contrôles de saisie et mise en
 * forme. Logique pure, testée dans `kpi-pilotage.test.ts`.
 *
 * Tous les chiffres (contributions, scores de qualité, efficacité, ordre du jour) sont ceux des
 * moteurs de l'API (`packages/engines/src/kpi`) : ce module les met en forme et ne les recalcule
 * jamais. Rien n'est conservé dans le navigateur.
 */
import {
  DELAI_DATE_EFFET_SANS_MOTIF_JOURS,
  RELATION_ARBRE_KPI_LIBELLES,
  STATUT_ACTION_KPI_LIBELLES,
  STATUT_DECISION_KPI_LIBELLES,
  STATUT_REVUE_KPI_LIBELLES,
  type StatutActionKpi,
  type StatutDecisionKpi,
  type StatutRevueKpi,
} from "@missionpilot/shared";
import { ErreurApi, erreurDepuisReponse, MESSAGE_RESEAU } from "./api";
import { formaterDate, formaterNombre, formaterPourcentage, VALEUR_ABSENTE } from "./format";
import { ajouterJoursIso, messageKpi } from "./kpi";
import { dateValide } from "./periode";
import { lireNombre } from "./saisie";
import type { Resultat } from "./saisie";

// --- Réponses de l'API ----------------------------------------------------------------------

export type RelationArbre = "somme" | "produit";
export type NiveauQualite = "bon" | "moyen" | "faible";
export type VerdictEfficacite = "efficace" | "inefficace" | "neutre" | "indeterminee";

export interface ArbreResume {
  id: string;
  mission_id: string;
  kpi_racine_id: string;
  libelle: string;
  description: string | null;
  actif: boolean;
  nombre_noeuds?: number;
}

export interface NoeudArbre {
  id: string;
  parent_id: string | null;
  kpi_id: string | null;
  kpi_libelle: string | null;
  kpi_unite: string | null;
  libelle: string;
  relation: RelationArbre;
  coefficient: number;
  rang: number;
  actif: boolean;
}

export interface DetailArbre extends ArbreResume {
  noeuds: NoeudArbre[];
}

export interface NoeudContribution extends NoeudArbre {
  profondeur: number;
  feuille: boolean;
  avant: number | null;
  apres: number | null;
  variation: number | null;
  residu_avant: number | null;
  residu_apres: number | null;
  contribution_parent: number | null;
  part_parent: number | null;
  contribution_racine: number | null;
  contribution_racine_exacte: string | null;
  part_racine: number | null;
  evaluable: boolean;
}

export interface LevierContribution {
  noeud_id: string;
  libelle: string;
  kpi_id: string | null;
  contribution_racine: number;
  part_racine: number | null;
  favorable: boolean | null;
  rang: number;
}

export interface ContributionsArbre {
  arbre_id: string;
  kpi_racine_id: string;
  sens: "plus_haut_mieux" | "plus_bas_mieux";
  unite: string;
  avant: string;
  apres: string;
  evaluable: boolean;
  manquants: { noeud_id: string; libelle: string }[];
  variation_racine: number | null;
  noeuds: NoeudContribution[];
  leviers: LevierContribution[];
}

export interface QualiteKpiVue {
  score: number | null;
  niveau: NiveauQualite | null;
  fraicheur: number | null;
  completude: number | null;
  coherence: number | null;
  motifs: string[];
  details: {
    periodes_exigibles: number;
    periodes_mesurees: number;
    periodes_fenetre: number;
    periodes_mesurees_fenetre: number;
    retard_periodes: number;
    nombre_corrections: number;
    nombre_lignes: number;
    valeurs_aberrantes: { date: string; valeur: number }[];
  };
}

export interface QualiteMission {
  mission_id: string;
  date_reference: string;
  repartition: { bon: number; moyen: number; faible: number; non_evaluable: number };
  kpis: {
    kpi_id: string;
    libelle: string;
    perspective: string | null;
    frequence: string;
    qualite: QualiteKpiVue;
  }[];
}

export interface EfficaciteVue {
  date_effet: string;
  verdict: VerdictEfficacite;
  periode_effet: string | null;
  moyenne_avant: number | null;
  moyenne_apres: number | null;
  variation: number | null;
  variation_relative: number | null;
  variation_orientee: number | null;
  nombre_avant: number;
  nombre_apres: number;
  manquant_avant: number;
  manquant_apres: number;
  periodes_avant: { periode: string; valeur: number | null }[];
  periodes_apres: { periode: string; valeur: number | null }[];
}

export interface EvenementAction {
  id: string;
  type: "creation" | "statut" | "modification" | "commentaire";
  statut_avant: string | null;
  statut_apres: string;
  commentaire: string | null;
  auteur_nom: string | null;
  cree_le: string;
}

export interface ActionKpi {
  id: string;
  mission_id: string;
  kpi_id: string;
  kpi_libelle: string;
  alerte_id: string | null;
  revue_id: string | null;
  decision_id: string | null;
  numero: number;
  titre: string;
  description: string | null;
  responsable_id: string;
  responsable_nom: string | null;
  echeance: string;
  statut: StatutActionKpi;
  date_effet: string | null;
  motif: string | null;
  efficacite: EfficaciteVue | null;
  evenements?: EvenementAction[];
}

export interface PageActions {
  elements: ActionKpi[];
  curseur_suivant: string | null;
}

export interface PointOrdreDuJour {
  rang: number;
  code: string;
  libelle: string;
  kpi_id: string | null;
  action_id: string | null;
  decision_id: string | null;
  priorite: number;
  duree_minutes: number;
  origine: "moteur" | "manuel";
}

export interface RevueKpi {
  id: string;
  mission_id: string;
  numero: number;
  titre: string;
  date_prevue: string;
  date_reference: string;
  statut: StatutRevueKpi;
  animateur_id: string | null;
  animateur_nom: string | null;
  ordre_du_jour: PointOrdreDuJour[];
  compte_rendu: string | null;
  dossier_fige: boolean;
}

export interface DecisionKpi {
  id: string;
  revue_id: string;
  numero: number;
  libelle: string;
  kpi_id: string | null;
  responsable_id: string | null;
  responsable_nom: string | null;
  echeance: string | null;
  statut: StatutDecisionKpi;
  motif: string | null;
}

export interface DetailRevue extends RevueKpi {
  decisions: DecisionKpi[];
  actions: ActionKpi[];
  /** Listes plafonnées à 500 lignes par l'API : vrai si la liste servie est incomplète. */
  decisions_tronque?: boolean;
  actions_tronque?: boolean;
  evenements_decisions_tronque?: boolean;
}

/** Réponse de la liste des arbres d'une mission (`tronque` : plus de 500 arbres). */
export interface ListeArbres {
  elements: ArbreResume[];
  tronque?: boolean;
}

/** Mention d'une liste plafonnée par l'API, ou null si elle est complète. */
export function avertissementTronque(tronque: boolean | undefined, quoi: string): string | null {
  return tronque
    ? `La liste des ${quoi} est limitée aux 500 premières : les suivantes ne sont pas affichées.`
    : null;
}

export interface PageRevues {
  elements: RevueKpi[];
  curseur_suivant: string | null;
}

// --- Chemins --------------------------------------------------------------------------------

const seg = encodeURIComponent;

export const cheminArbres = (m: string) => `/api/missions/${seg(m)}/kpi/arbres`;
export const cheminArbre = (id: string) => `/api/kpi/arbres/${seg(id)}`;
export const cheminNoeuds = (arbre: string) => `/api/kpi/arbres/${seg(arbre)}/noeuds`;
export const cheminNoeud = (id: string) => `/api/kpi/arbres/noeuds/${seg(id)}`;
export const cheminContributions = (arbre: string, avant: string, apres: string) =>
  `/api/kpi/arbres/${seg(arbre)}/contributions?avant=${seg(avant)}&apres=${seg(apres)}`;
export const cheminQualite = (m: string, date: string) =>
  `/api/missions/${seg(m)}/kpi/qualite-donnees?date=${seg(date)}`;
export const cheminActionsMission = (m: string, requete = "") =>
  `/api/missions/${seg(m)}/kpi/actions${requete ? `?${requete}` : ""}`;
export const cheminAction = (id: string) => `/api/kpi/actions/${seg(id)}`;
export const cheminStatutAction = (id: string) => `/api/kpi/actions/${seg(id)}/statut`;
export const cheminCommentairesAction = (id: string) => `/api/kpi/actions/${seg(id)}/commentaires`;
export const cheminRevues = (m: string, requete = "") =>
  `/api/missions/${seg(m)}/kpi/revues${requete ? `?${requete}` : ""}`;
export const cheminRevue = (id: string) => `/api/kpi/revues/${seg(id)}`;
export const cheminOrdreDuJour = (id: string) => `/api/kpi/revues/${seg(id)}/ordre-du-jour`;
export const cheminGenererOrdreDuJour = (id: string) => `${cheminOrdreDuJour(id)}/generer`;
export const cheminActionRevue = (id: string, action: "tenir" | "cloturer" | "annuler") =>
  `/api/kpi/revues/${seg(id)}/${action}`;
export const cheminDecisionsRevue = (id: string) => `/api/kpi/revues/${seg(id)}/decisions`;
export const cheminStatutDecision = (id: string) => `/api/kpi/revues/decisions/${seg(id)}/statut`;
export const cheminDossierRevue = (id: string, format: "pdf" | "docx" | "pptx") =>
  `/api/kpi/revues/${seg(id)}/dossier?format=${format}`;

export const EXTENSIONS_DOSSIER_REVUE = { pdf: "pdf", docx: "docx", pptx: "pptx" } as const;
export type FormatDossierRevue = keyof typeof EXTENSIONS_DOSSIER_REVUE;

/** Nom du fichier téléchargé : « revue-kpi-3.docx » (ASCII, sans donnée du client). */
export const nomFichierDossierRevue = (numero: number, format: FormatDossierRevue) =>
  `revue-kpi-${numero}.${EXTENSIONS_DOSSIER_REVUE[format]}`;

/**
 * Télécharge le dossier de la revue par un appel authentifié (cookie httpOnly), jamais par un
 * lien : une erreur de l'API (429 trop de dossiers, rendu PDF indisponible…) devient une
 * `ErreurApi` affichée en français, au lieu d'un JSON brut dans l'onglet.
 */
export async function telechargerDossierRevue(
  revueId: string,
  format: FormatDossierRevue,
): Promise<Blob> {
  let reponse: Response;
  try {
    reponse = await fetch(cheminDossierRevue(revueId, format), {
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ErreurApi("RESEAU_INDISPONIBLE", MESSAGE_RESEAU, 0);
  }
  if (!reponse.ok) {
    let corps: unknown;
    try {
      corps = await reponse.json();
    } catch {
      corps = undefined;
    }
    throw erreurDepuisReponse(reponse.status, corps);
  }
  return reponse.blob();
}

export const hrefArbres = (m: string) => `/missions/${seg(m)}/kpi/arbres`;
export const hrefArbre = (m: string, id: string, params = "") =>
  `/missions/${seg(m)}/kpi/arbres/${seg(id)}${params ? `?${params}` : ""}`;
export const hrefActions = (m: string) => `/missions/${seg(m)}/kpi/actions`;
export const hrefAction = (m: string, id: string) => `/missions/${seg(m)}/kpi/actions/${seg(id)}`;
export const hrefRevues = (m: string) => `/missions/${seg(m)}/kpi/revues`;
export const hrefRevue = (m: string, id: string) => `/missions/${seg(m)}/kpi/revues/${seg(id)}`;

// --- Libellés -------------------------------------------------------------------------------

export const LIBELLES_RELATION = RELATION_ARBRE_KPI_LIBELLES;
export const LIBELLES_STATUT_ACTION = STATUT_ACTION_KPI_LIBELLES;
export const LIBELLES_STATUT_DECISION = STATUT_DECISION_KPI_LIBELLES;
export const LIBELLES_STATUT_REVUE = STATUT_REVUE_KPI_LIBELLES;

export const LIBELLES_NIVEAU_QUALITE: Record<NiveauQualite, string> = {
  bon: "Bonne",
  moyen: "Moyenne",
  faible: "Faible",
};

export const LIBELLES_MOTIF_QUALITE: Record<string, string> = {
  AUCUNE_MESURE: "Aucune mesure alors que des périodes sont échues",
  MESURE_EN_RETARD: "Mesure en retard",
  PERIODES_MANQUANTES: "Périodes échues sans mesure",
  VALEURS_ABERRANTES: "Valeurs à vérifier (écart inhabituel)",
  CORRECTIONS_FREQUENTES: "Corrections fréquentes",
};

export const LIBELLES_VERDICT: Record<VerdictEfficacite, string> = {
  efficace: "Efficace : amélioration mesurée",
  inefficace: "Sans effet favorable : dégradation mesurée",
  neutre: "Neutre : variation dans la tolérance",
  indeterminee: "Indéterminée : périodes insuffisantes",
};

export const LIBELLES_POINT_REVUE: Record<string, string> = {
  OUVERTURE: "Ouverture",
  DECISION_OUVERTE: "Décision à suivre",
  ACTION_EN_RETARD: "Action en retard",
  ACTION_INEFFICACE: "Action sans effet mesuré",
  KPI_ROUGE: "KPI en rouge",
  KPI_DEGRADATION: "KPI en dégradation",
  KPI_ORANGE: "KPI en orange",
  QUALITE_DONNEES: "Qualité des données",
  KPI_NON_MESURE: "KPI non mesuré",
  DECISIONS_A_PRENDRE: "Décisions à prendre",
  MANUEL: "Point ajouté",
};

export const AVERTISSEMENT_EFFICACITE =
  "Variation avant/après : une corrélation dans le temps, pas une preuve que l'action en est la cause.";

// --- Mise en forme --------------------------------------------------------------------------

export function libelleNiveauQualite(n: NiveauQualite | null): string {
  return n ? LIBELLES_NIVEAU_QUALITE[n] : "Non évaluable";
}

/** « 79 / 100 », ou « — » sans score. */
export function texteScoreQualite(score: number | null): string {
  return score === null ? VALEUR_ABSENTE : `${formaterNombre(score, 0)} / 100`;
}

export const texteComposante = (v: number | null) => formaterPourcentage(v, 1);

export function libelleMotifQualite(code: string): string {
  return LIBELLES_MOTIF_QUALITE[code] ?? code;
}

/** Contribution signée : « +400 », « −200 » ; la couleur ne porte jamais seule le sens. */
export function texteContribution(v: number | null | undefined, unite = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const n = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 4,
    signDisplay: "exceptZero",
  }).format(v);
  return unite ? `${n}\u00a0${unite}` : n;
}

export function texteFavorable(f: boolean | null): string {
  if (f === null) return "Sans effet";
  return f ? "Favorable" : "Défavorable";
}

export function texteVerdict(e: Pick<EfficaciteVue, "verdict"> | null | undefined): string {
  return e ? LIBELLES_VERDICT[e.verdict] : "Pas encore mesurable (action non terminée)";
}

/** Détail chiffré de l'efficacité : moyennes avant et après, variation orientée. */
export function texteEfficaciteDetail(e: EfficaciteVue, unite: string): string {
  if (e.verdict === "indeterminee") {
    const manque = [
      e.manquant_avant > 0 ? `${e.manquant_avant} période(s) avant` : null,
      e.manquant_apres > 0 ? `${e.manquant_apres} période(s) après` : null,
    ].filter(Boolean);
    return `Il manque ${manque.join(" et ")} mesurée(s) et close(s) pour conclure.`;
  }
  const u = unite ? `\u00a0${unite}` : "";
  const rel =
    e.variation_relative === null ? "" : ` (${formaterPourcentage(e.variation_relative, 1)})`;
  return `Moyenne avant ${formaterNombre(e.moyenne_avant, 4)}${u}, après ${formaterNombre(e.moyenne_apres, 4)}${u} : variation ${texteContribution(e.variation, unite)}${rel}.`;
}

export function enRetard(echeance: string, statut: StatutActionKpi, jour: string): boolean {
  return (statut === "a_faire" || statut === "en_cours") && echeance < jour;
}

export function libelleEcheance(echeance: string | null): string {
  return echeance ? formaterDate(echeance) : "Sans échéance";
}

// --- Saisies --------------------------------------------------------------------------------

const unNonVide = (v: string) => v.trim() !== "";

export interface SaisieArbre {
  kpi_racine_id: string;
  libelle: string;
}
export type ChampArbre = keyof SaisieArbre;

export function validerArbre(s: SaisieArbre): Resultat<SaisieArbre, ChampArbre> {
  const erreurs: Partial<Record<ChampArbre, string>> = {};
  if (!unNonVide(s.kpi_racine_id)) erreurs.kpi_racine_id = "Choisissez le KPI à décomposer.";
  if (!unNonVide(s.libelle)) erreurs.libelle = "Le libellé de l'arbre est obligatoire.";
  else if (s.libelle.trim().length > 200) erreurs.libelle = "200 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { kpi_racine_id: s.kpi_racine_id, libelle: s.libelle.trim() } };
}

export interface SaisieNoeud {
  parent_id: string;
  kpi_id: string;
  libelle: string;
  relation: RelationArbre;
  coefficient: string;
  rang: string;
}
export type ChampNoeud = keyof SaisieNoeud;
export interface ChargeNoeud {
  parent_id: string;
  kpi_id: string | null;
  libelle: string;
  relation: RelationArbre;
  coefficient: number;
  rang: number;
}

export function validerNoeud(s: SaisieNoeud): Resultat<ChargeNoeud, ChampNoeud> {
  const erreurs: Partial<Record<ChampNoeud, string>> = {};
  if (!unNonVide(s.parent_id)) erreurs.parent_id = "Choisissez le nœud parent.";
  if (!unNonVide(s.libelle)) erreurs.libelle = "Le libellé du levier est obligatoire.";
  else if (s.libelle.trim().length > 200) erreurs.libelle = "200 caractères au plus.";
  const coefficient = s.coefficient.trim() === "" ? 1 : lireNombre(s.coefficient);
  if (coefficient === null || Number.isNaN(coefficient)) {
    erreurs.coefficient = "Nombre attendu (ex. 1 ou -1).";
  } else if (Math.abs(coefficient) > 1000 || !/^-?\d{1,4}(\.\d{1,4})?$/.test(String(coefficient))) {
    erreurs.coefficient = "Entre -1000 et 1000, 4 décimales au plus.";
  }
  const rang = s.rang.trim() === "" ? 0 : Number(s.rang);
  if (!Number.isInteger(rang) || rang < 0 || rang > 999) erreurs.rang = "Entier de 0 à 999.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      parent_id: s.parent_id,
      kpi_id: unNonVide(s.kpi_id) ? s.kpi_id : null,
      libelle: s.libelle.trim(),
      relation: s.relation,
      coefficient: coefficient as number,
      rang,
    },
  };
}

export interface SaisieAction {
  kpi_id: string;
  alerte_id: string;
  titre: string;
  description: string;
  responsable_id: string;
  echeance: string;
}
export type ChampAction = keyof SaisieAction;
export interface ChargeAction {
  kpi_id: string;
  alerte_id?: string;
  titre: string;
  description?: string;
  responsable_id: string;
  echeance: string;
}

export function validerAction(s: SaisieAction): Resultat<ChargeAction, ChampAction> {
  const erreurs: Partial<Record<ChampAction, string>> = {};
  if (!unNonVide(s.kpi_id)) erreurs.kpi_id = "Choisissez le KPI concerné.";
  if (!unNonVide(s.titre)) erreurs.titre = "Le titre de l'action est obligatoire.";
  else if (s.titre.trim().length > 200) erreurs.titre = "200 caractères au plus.";
  if (s.description.trim().length > 2000) erreurs.description = "2 000 caractères au plus.";
  if (!unNonVide(s.responsable_id)) erreurs.responsable_id = "Choisissez le responsable.";
  if (!unNonVide(s.echeance)) erreurs.echeance = "L'échéance est obligatoire.";
  else if (!dateValide(s.echeance)) erreurs.echeance = "Date invalide.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      kpi_id: s.kpi_id,
      ...(unNonVide(s.alerte_id) ? { alerte_id: s.alerte_id } : {}),
      titre: s.titre.trim(),
      ...(unNonVide(s.description) ? { description: s.description.trim() } : {}),
      responsable_id: s.responsable_id,
      echeance: s.echeance,
    },
  };
}

export interface SaisieStatutAction {
  statut: "en_cours" | "terminee" | "abandonnee";
  date_effet: string;
  motif: string;
  /** Justification d'une date d'effet très antérieure (obligatoire au-delà de 31 jours). */
  commentaire: string;
}
export type ChampStatutAction = keyof SaisieStatutAction;
export interface ChargeStatutAction {
  statut: "en_cours" | "terminee" | "abandonnee";
  date_effet?: string;
  motif?: string;
  commentaire?: string;
}

export { DELAI_DATE_EFFET_SANS_MOTIF_JOURS };

/** Vrai si la date d'effet recule de plus de 31 jours : un commentaire doit la justifier. */
export function dateEffetExigeCommentaire(dateEffet: string, jour: string): boolean {
  return (
    dateValide(dateEffet) !== null &&
    dateEffet < ajouterJoursIso(jour, -DELAI_DATE_EFFET_SANS_MOTIF_JOURS)
  );
}

export function validerStatutAction(
  s: SaisieStatutAction,
  jour: string,
): Resultat<ChargeStatutAction, ChampStatutAction> {
  const erreurs: Partial<Record<ChampStatutAction, string>> = {};
  if (s.statut === "abandonnee") {
    if (!unNonVide(s.motif)) erreurs.motif = "Un motif est obligatoire pour abandonner une action.";
    else if (s.motif.trim().length > 500) erreurs.motif = "500 caractères au plus.";
  }
  if (s.statut === "terminee" && unNonVide(s.date_effet)) {
    if (!dateValide(s.date_effet)) erreurs.date_effet = "Date invalide.";
    else if (s.date_effet > jour) erreurs.date_effet = "La date d'effet ne peut pas être future.";
    else if (dateEffetExigeCommentaire(s.date_effet, jour) && !unNonVide(s.commentaire)) {
      erreurs.commentaire = `Une date d'effet antérieure de plus de ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} jours exige une justification.`;
    }
  }
  if (s.commentaire.trim().length > 1000) erreurs.commentaire = "1 000 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      statut: s.statut,
      ...(s.statut === "terminee" && unNonVide(s.date_effet) ? { date_effet: s.date_effet } : {}),
      ...(s.statut === "terminee" && unNonVide(s.commentaire)
        ? { commentaire: s.commentaire.trim() }
        : {}),
      ...(s.statut === "abandonnee" ? { motif: s.motif.trim() } : {}),
    },
  };
}

export interface SaisieRevue {
  titre: string;
  date_prevue: string;
  date_reference: string;
  animateur_id: string;
}
export type ChampRevue = keyof SaisieRevue;
export interface ChargeRevue {
  titre: string;
  date_prevue: string;
  date_reference?: string;
  animateur_id?: string;
}

export function validerRevue(s: SaisieRevue): Resultat<ChargeRevue, ChampRevue> {
  const erreurs: Partial<Record<ChampRevue, string>> = {};
  if (!unNonVide(s.titre)) erreurs.titre = "Le titre de la revue est obligatoire.";
  else if (s.titre.trim().length > 200) erreurs.titre = "200 caractères au plus.";
  if (!unNonVide(s.date_prevue)) erreurs.date_prevue = "La date de la revue est obligatoire.";
  else if (!dateValide(s.date_prevue)) erreurs.date_prevue = "Date invalide.";
  if (unNonVide(s.date_reference) && !dateValide(s.date_reference)) {
    erreurs.date_reference = "Date invalide.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre: s.titre.trim(),
      date_prevue: s.date_prevue,
      ...(unNonVide(s.date_reference) ? { date_reference: s.date_reference } : {}),
      ...(unNonVide(s.animateur_id) ? { animateur_id: s.animateur_id } : {}),
    },
  };
}

export interface SaisieDecision {
  libelle: string;
  kpi_id: string;
  responsable_id: string;
  echeance: string;
}
export type ChampDecision = keyof SaisieDecision;
export interface ChargeDecision {
  libelle: string;
  kpi_id?: string;
  responsable_id?: string;
  echeance?: string;
}

export function validerDecision(s: SaisieDecision): Resultat<ChargeDecision, ChampDecision> {
  const erreurs: Partial<Record<ChampDecision, string>> = {};
  if (!unNonVide(s.libelle)) erreurs.libelle = "Le libellé de la décision est obligatoire.";
  else if (s.libelle.trim().length > 500) erreurs.libelle = "500 caractères au plus.";
  if (unNonVide(s.echeance) && !dateValide(s.echeance)) erreurs.echeance = "Date invalide.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle: s.libelle.trim(),
      ...(unNonVide(s.kpi_id) ? { kpi_id: s.kpi_id } : {}),
      ...(unNonVide(s.responsable_id) ? { responsable_id: s.responsable_id } : {}),
      ...(unNonVide(s.echeance) ? { echeance: s.echeance } : {}),
    },
  };
}

/**
 * Motif obligatoire pour abandonner une décision, commentaire (ce qui a été fait) obligatoire pour
 * la déclarer exécutée : un état terminal se justifie. `texte` est le motif ou le commentaire.
 */
export function validerStatutDecision(
  statut: "en_cours" | "executee" | "abandonnee",
  texte: string,
): Resultat<{ statut: typeof statut; motif?: string; commentaire?: string }, "motif"> {
  if (statut === "abandonnee") {
    if (!unNonVide(texte)) return { ok: false, erreurs: { motif: "Un motif est obligatoire." } };
    if (texte.trim().length > 500)
      return { ok: false, erreurs: { motif: "500 caractères au plus." } };
    return { ok: true, charge: { statut, motif: texte.trim() } };
  }
  if (statut === "executee") {
    if (!unNonVide(texte)) {
      return {
        ok: false,
        erreurs: { motif: "Dites ce qui a été fait pour exécuter la décision." },
      };
    }
    if (texte.trim().length > 1000)
      return { ok: false, erreurs: { motif: "1 000 caractères au plus." } };
    return { ok: true, charge: { statut, commentaire: texte.trim() } };
  }
  return { ok: true, charge: { statut } };
}

/** Compte rendu d'une revue : 8 000 caractères au plus ; saisi avant ou à la tenue, puis figé. */
export const COMPTE_RENDU_MAX = 8000;
export function validerCompteRendu(
  texte: string,
): Resultat<{ compte_rendu?: string }, "compte_rendu"> {
  if (texte.trim().length > COMPTE_RENDU_MAX) {
    return { ok: false, erreurs: { compte_rendu: "8 000 caractères au plus." } };
  }
  return { ok: true, charge: unNonVide(texte) ? { compte_rendu: texte.trim() } : {} };
}

export interface PointSaisi {
  libelle: string;
  duree_minutes: number;
}

/** Points d'un ordre du jour saisi à la main (l'API en admet 40 au plus, 1 à 240 minutes chacun). */
export const POINTS_ORDRE_DU_JOUR_MAX = 40;
export const DUREE_POINT_DEFAUT_MINUTES = 10;

/**
 * Ordre du jour saisi : une ligne par point, « Libellé » ou « Libellé | durée en minutes »
 * (10 minutes par défaut). Les lignes vides sont ignorées. Remplace l'ordre du jour actuel.
 */
export function validerOrdreDuJour(texte: string): Resultat<{ points: PointSaisi[] }, "points"> {
  const lignes = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lignes.length === 0) {
    return { ok: false, erreurs: { points: "Saisissez au moins un point, un par ligne." } };
  }
  if (lignes.length > POINTS_ORDRE_DU_JOUR_MAX) {
    return { ok: false, erreurs: { points: `${POINTS_ORDRE_DU_JOUR_MAX} points au plus.` } };
  }
  const points: PointSaisi[] = [];
  for (const [i, ligne] of lignes.entries()) {
    const coupe = ligne.lastIndexOf("|");
    const libelle = (coupe === -1 ? ligne : ligne.slice(0, coupe)).trim();
    const brut = coupe === -1 ? "" : ligne.slice(coupe + 1).trim();
    const duree = brut === "" ? DUREE_POINT_DEFAUT_MINUTES : Number(brut);
    if (libelle === "" || libelle.length > 300) {
      return {
        ok: false,
        erreurs: { points: `Ligne ${i + 1} : un libellé de 1 à 300 caractères est attendu.` },
      };
    }
    if (!Number.isInteger(duree) || duree < 1 || duree > 240) {
      return {
        ok: false,
        erreurs: { points: `Ligne ${i + 1} : une durée entière de 1 à 240 minutes est attendue.` },
      };
    }
    points.push({ libelle, duree_minutes: duree });
  }
  return { ok: true, charge: { points } };
}

/** Messages propres aux refus du pilotage augmenté (les autres passent par `messageKpi`). */
export const MESSAGES_PILOTAGE: Record<string, string> = {
  KPI_REVUE_OUVERTE:
    "Des décisions ou des actions de la revue sont encore ouvertes : terminez-les, ou abandonnez-les avec un motif, avant de clôturer.",
  KPI_ARBRE_TROP_GRAND:
    "Un arbre compte au plus 50 nœuds actifs, 200 nœuds au total (désactivés compris) et 6 niveaux sous la racine.",
  KPI_NOEUD_PARENT_INVALIDE:
    "Le parent du nœud est désactivé ou d'un autre arbre : réactivez d'abord le parent.",
  KPI_REVUE_FIGEE:
    "Le contenu d'une revue tenue (ordre du jour, dossier, compte rendu) est figé : il ne change plus.",
  KPI_ACTION_REVUE: "Une action se rattache à une décision d'une revue tenue et non clôturée.",
  KPI_COEFFICIENT_PRODUIT: "Sous un produit, le coefficient d'un levier est 1.",
  KPI_NOEUD_NON_DESACTIVABLE:
    "Désactivez d'abord les enfants de ce nœud ; la racine ne se désactive pas.",
  TROP_DE_DOSSIERS_REVUE:
    "Trop de dossiers de revue téléchargés en peu de temps : réessayez dans quelques minutes.",
  RENDU_PDF_INDISPONIBLE:
    "Le rendu PDF est indisponible sur ce serveur : choisissez le format Word ou PowerPoint.",
};

/** Message affiché pour une erreur du pilotage augmenté (message propre, sinon celui des KPI). */
export function messagePilotage(e: unknown): string {
  if (e instanceof ErreurApi) {
    const propre = MESSAGES_PILOTAGE[e.code];
    if (propre) return propre;
  }
  return messageKpi(e);
}
