/**
 * Appels d'offres, lot AO-A (AO-01 à AO-03, AO-08) : types des réponses de l'API, libellés,
 * chemins, droits d'affichage, lecture des saisies et de l'import CSV. Logique pure, testée dans
 * `appels-offres.test.ts`.
 *
 * RÈGLE : rapprochement, score go/no-go, synthèse de conformité, rétro-planning et alertes sont
 * CALCULÉS par l'API (moteur packages/engines/src/appels-offres). Ce module n'en recalcule rien :
 * il met en forme ce que l'API renvoie et lit les saisies (conversion de texte en valeur). Les
 * droits ci-dessous sont un confort d'affichage ; l'API reste seule juge.
 */
import {
  aPermission,
  appelOffresCreationSchema,
  CATEGORIE_EXIGENCE_AO_LIBELLES,
  CATEGORIES_EXIGENCE_AO,
  RECOMMANDATION_GO_NO_GO_LIBELLES,
  STATUT_APPEL_OFFRES_LIBELLES,
  STATUT_CONFORMITE_AO_LIBELLES,
  STATUTS_APPEL_OFFRES,
  type AppelOffresCreation,
  type CategorieExigenceAo,
  type Role,
  type StatutAppelOffres,
  type StatutConformiteAo,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import type { Devise } from "./format";
import { decouperListe, lireMontant, lireNombre, type Resultat } from "./saisie";

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

// --- Droits d'affichage ----------------------------------------------------------------------

export interface DroitsAo {
  lire: boolean;
  gerer: boolean;
  decider: boolean;
  /** Marge estimée (FIN-02). */
  finance: boolean;
  /** Confier une étape par une tâche assignée. */
  assigner: boolean;
  ia: boolean;
}

export function droitsAppelsOffres(roles: readonly Role[]): DroitsAo {
  return {
    lire: aPermission(roles, "ao.lire"),
    gerer: aPermission(roles, "ao.gerer"),
    decider: aPermission(roles, "ao.decider"),
    finance: aPermission(roles, "finance.lire"),
    assigner: aPermission(roles, "tache.assigner"),
    ia: aPermission(roles, "ia.utiliser"),
  };
}

// --- Libellés et tonalités -------------------------------------------------------------------

export const libelleStatutAo = (s: StatutAppelOffres) => STATUT_APPEL_OFFRES_LIBELLES[s] ?? s;

export function tonaliteStatutAo(s: StatutAppelOffres): TonaliteStatut {
  if (s === "gagne") return "succes";
  if (s === "perdu" || s === "no_go") return "danger";
  if (s === "go_no_go" || s === "depose") return "attention";
  return "neutre";
}

export const libelleRecommandation = (r: Recommandation) => RECOMMANDATION_GO_NO_GO_LIBELLES[r];

export function tonaliteRecommandation(r: Recommandation): TonaliteStatut {
  return r === "go" ? "succes" : r === "no_go" ? "danger" : "attention";
}

export const libelleConformite = (s: StatutConformiteAo) => STATUT_CONFORMITE_AO_LIBELLES[s];

export function tonaliteConformite(s: StatutConformiteAo): TonaliteStatut {
  if (s === "conforme") return "succes";
  if (s === "non_conforme") return "danger";
  if (s === "partiel" || s === "en_cours") return "attention";
  return "neutre";
}

export const libelleCategorie = (c: CategorieExigenceAo) => CATEGORIE_EXIGENCE_AO_LIBELLES[c];

export const LIBELLES_CRITERES: Record<string, string> = {
  adequation: "Adéquation",
  references: "Références",
  charge: "Charge",
  marge: "Marge estimée",
  concurrence: "Concurrence connue",
};

export const LIBELLES_ELIMINATOIRES: Record<string, string> = {
  marge_non_positive: "Marge nulle ou négative",
  references_insuffisantes: "Références exigées non atteintes",
};

export const LIBELLES_SIGNAUX: Record<string, string> = {
  ignorer_consignes: "consigne d'ignorer les instructions",
  changement_role: "changement de rôle demandé",
  invite_systeme: "prétendu message système",
  demande_action: "demande d'action",
  autorite_pretendue: "autorité prétendue",
  sortie_imposee: "format de réponse imposé",
  caracteres_invisibles: "caractères invisibles",
};

/** « dans 3 jours », « demain », « aujourd'hui », « dépassée de 2 jours ». */
export function texteJoursRestants(n: number): string {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n > 1) return `dans ${n} jours`;
  if (n === -1) return "dépassée d'un jour";
  return `dépassée de ${-n} jours`;
}

/** Texte d'une alerte (fiche ou cabinet). */
export function texteAlerte(a: {
  type: AlerteFiche["type"];
  joursRestants: number;
  etapeLibelle?: string | null;
}): string {
  if (a.type === "date_limite") return `Date limite ${texteJoursRestants(a.joursRestants)}`;
  const etape = a.etapeLibelle ?? "Étape";
  if (a.type === "etape_du_jour") return `${etape} : prévue aujourd'hui`;
  return `${etape} : en retard (${texteJoursRestants(a.joursRestants)})`;
}

export function tonaliteAlerte(joursRestants: number): TonaliteStatut {
  if (joursRestants <= 1) return "danger";
  return "attention";
}

// --- Chemins ---------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface FiltresAo {
  statut: StatutAppelOffres | "";
  q: string;
  curseur: string;
}

export function lireFiltresAo(p: Record<string, string | string[] | undefined>): FiltresAo {
  const s = un(p.statut) ?? "";
  const c = un(p.curseur) ?? "";
  return {
    statut: (STATUTS_APPEL_OFFRES as readonly string[]).includes(s) ? (s as StatutAppelOffres) : "",
    q: (un(p.q) ?? "").trim().slice(0, 100),
    curseur: /^[A-Za-z0-9_-]{1,500}$/.test(c) ? c : "",
  };
}

export function cheminFiches(f: FiltresAo): string {
  const r = new URLSearchParams({ limite: "50" });
  if (f.statut) r.set("statut", f.statut);
  if (f.q) r.set("q", f.q);
  if (f.curseur) r.set("curseur", f.curseur);
  return `/api/appels-offres?${r.toString()}`;
}

export function hrefAppelsOffres(f: Partial<FiltresAo> = {}): string {
  const r = new URLSearchParams();
  if (f.statut) r.set("statut", f.statut);
  if (f.q) r.set("q", f.q);
  if (f.curseur) r.set("curseur", f.curseur);
  const s = r.toString();
  return s ? `/appels-offres?${s}` : "/appels-offres";
}

export const hrefFiche = (id: string) => `/appels-offres/${segment(id)}`;
export const hrefGoNoGo = (id: string) => `/appels-offres/${segment(id)}/go-no-go`;
export const hrefMatrice = (id: string) => `/appels-offres/${segment(id)}/matrice`;
/** Personnes à qui confier une étape (utilisateurs actifs avec `ao.lire`, droit `tache.assigner`). */
export const CHEMIN_PERSONNES_ASSIGNABLES = "/api/appels-offres/assignables";
export const hrefRetroplanning = (id: string) => `/appels-offres/${segment(id)}/retroplanning`;

/** Fiches regroupées par statut, dans l'ordre du cycle de vie (colonnes du pipeline). */
export function regrouperParStatut(
  fiches: readonly FicheAo[],
): { statut: StatutAppelOffres; fiches: FicheAo[] }[] {
  return STATUTS_APPEL_OFFRES.map((statut) => ({
    statut,
    fiches: fiches.filter((f) => f.statut === statut),
  }));
}

/** Statuts que l'utilisateur pose à la main depuis un statut (les autres : décision). */
export function statutsManuels(s: StatutAppelOffres): ("depose" | "gagne" | "perdu")[] {
  if (s === "en_reponse") return ["depose"];
  if (s === "depose") return ["gagne", "perdu"];
  return [];
}

export const estOuverte = (s: StatutAppelOffres) =>
  s === "detecte" || s === "go_no_go" || s === "en_reponse";

// --- Erreurs ---------------------------------------------------------------------------------

const CODES_MESSAGE_API = new Set([
  "AO_REFERENCE_EXISTANTE",
  "AO_TRANSITION_REFUSEE",
  "AO_DECISION_REQUISE",
  "AO_MATRICE_NON_CONFORME",
  "AO_EXTRACTION_TRANCHEE",
  "AO_REPONSE_FIGEE",
  "AO_EVALUATION_PERIMEE",
  "AO_DATE_LIMITE_REQUISE",
  "AO_RETROPLANNING_EXISTANT",
  "MARGE_RESERVEE",
  "DATE_LIMITE_PASSEE",
  "GENERATION_IA_ECHEC",
  "TYPE_FICHIER_REFUSE",
  "FICHIER_TROP_VOLUMINEUX",
]);

export function messageAo(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return "Cet appel d'offres n'existe pas ou plus.";
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

// --- Saisies ---------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYS = /^[A-Za-z]{2}$/;

export interface SaisieFiche {
  reference: string;
  titre: string;
  objet: string;
  bailleur: string;
  pays: string;
  secteur: string;
  montant: string;
  devise: Devise;
  date_limite: string;
  url: string;
  mots_cles: string;
}

export const SAISIE_FICHE_VIDE: SaisieFiche = {
  reference: "",
  titre: "",
  objet: "",
  bailleur: "",
  pays: "",
  secteur: "",
  montant: "",
  devise: "XOF",
  date_limite: "",
  url: "",
  mots_cles: "",
};

const ou = (v: string) => (v.trim() === "" ? null : v.trim());

/** Saisie du formulaire → corps de création, ou erreurs par champ. */
export function validerFiche(s: SaisieFiche): Resultat<AppelOffresCreation, keyof SaisieFiche> {
  const erreurs: Partial<Record<keyof SaisieFiche, string>> = {};
  const titre = s.titre.trim();
  if (titre === "") erreurs.titre = "Donnez l'intitulé de l'appel d'offres.";
  else if (titre.length > 300) erreurs.titre = "300 caractères au plus.";
  if (s.pays.trim() !== "" && !PAYS.test(s.pays.trim())) {
    erreurs.pays = "Code pays à deux lettres (ex. CI, SN).";
  }
  const montant = lireMontant(s.montant, s.devise);
  if (montant !== null && Number.isNaN(montant)) erreurs.montant = "Montant illisible.";
  if (s.date_limite.trim() !== "" && !DATE.test(s.date_limite.trim())) {
    erreurs.date_limite = "Date au format AAAA-MM-JJ.";
  }
  if (s.url.trim() !== "" && !/^https?:\/\/[^\s<>"]+$/i.test(s.url.trim())) {
    erreurs.url = "Adresse http ou https.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      reference: ou(s.reference),
      titre,
      objet: ou(s.objet),
      bailleur: ou(s.bailleur),
      pays: ou(s.pays)?.toUpperCase() ?? null,
      secteur: ou(s.secteur),
      montant_estime: montant,
      devise: s.devise,
      date_limite: ou(s.date_limite),
      url: ou(s.url),
      mots_cles: decouperListe(s.mots_cles.replace(/\|/g, ",")),
    },
  };
}

/** Colonnes attendues de l'import CSV (en-tête obligatoire, ordre libre). */
export const COLONNES_IMPORT = [
  "reference",
  "titre",
  "bailleur",
  "pays",
  "secteur",
  "montant",
  "devise",
  "date_limite",
  "url",
  "mots_cles",
] as const;

/** Une ligne CSV (guillemets doubles, séparateur `;` ou `,`) → cellules. */
export function cellulesCsv(ligne: string, separateur: string): string[] {
  const cellules: string[] = [];
  let courante = "";
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i] as string;
    if (entreGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') {
        courante += '"';
        i += 1;
      } else if (c === '"') entreGuillemets = false;
      else courante += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === separateur) {
      cellules.push(courante.trim());
      courante = "";
    } else courante += c;
  }
  cellules.push(courante.trim());
  return cellules;
}

const sansAccents = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z_]/g, "_");

/**
 * Import manuel (AO-01) : texte CSV collé ou lu d'un fichier → fiches validées par le schéma
 * partagé, et erreurs par ligne (numéro de ligne du fichier, en-tête = 1). 200 fiches au plus.
 */
export function analyserImportCsv(texte: string): {
  fiches: AppelOffresCreation[];
  erreurs: { ligne: number; message: string }[];
} {
  const lignes = texte
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const entete = lignes[0] ?? "";
  const separateur =
    (entete.match(/;/g) ?? []).length >= (entete.match(/,/g) ?? []).length ? ";" : ",";
  const colonnes = cellulesCsv(entete, separateur).map(sansAccents);
  if (!colonnes.includes("titre")) {
    return { fiches: [], erreurs: [{ ligne: 1, message: "En-tête sans colonne « titre »." }] };
  }
  const fiches: AppelOffresCreation[] = [];
  const erreurs: { ligne: number; message: string }[] = [];
  for (const [i, brute] of lignes.slice(1).entries()) {
    if (brute.trim() === "") continue;
    const numero = i + 2;
    if (fiches.length >= 200) {
      erreurs.push({ ligne: numero, message: "200 fiches au plus par import." });
      break;
    }
    const valeurs = cellulesCsv(brute, separateur);
    const v = (nom: string) => valeurs[colonnes.indexOf(nom)] ?? "";
    const devise = (v("devise").toUpperCase() || "XOF") as Devise;
    const r = validerFiche({
      ...SAISIE_FICHE_VIDE,
      reference: v("reference"),
      titre: v("titre"),
      bailleur: v("bailleur"),
      pays: v("pays"),
      secteur: v("secteur"),
      montant: v("montant"),
      devise,
      date_limite: v("date_limite"),
      url: v("url"),
      mots_cles: v("mots_cles"),
    });
    if (!r.ok) {
      erreurs.push({ ligne: numero, message: Object.values(r.erreurs).join(" ") });
      continue;
    }
    const controle = appelOffresCreationSchema.safeParse(r.charge);
    if (!controle.success) {
      erreurs.push({ ligne: numero, message: "Valeurs refusées (devise, date ou longueur)." });
      continue;
    }
    fiches.push(controle.data);
  }
  return { fiches, erreurs };
}

/**
 * Pourcentage saisi (« 15 », « 15,5 », « -2,25 ») → points de base entiers (1 % = 100), par
 * lecture du texte (aucun calcul flottant). `null` si vide, `NaN` si illisible ou plus de deux
 * décimales.
 */
export function pourCentVersPointsDeBase(v: string): number | null {
  const t = v.replace(/\s/g, "").replace(",", ".").replace("%", "");
  if (t === "") return null;
  const m = /^(-?)(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return Number.NaN;
  const entier = Number(m[2]);
  const decimales = Number((m[3] ?? "").padEnd(2, "0"));
  const bp = entier * 100 + decimales;
  return m[1] === "-" ? -bp : bp;
}

export interface SaisieEvaluation {
  adequation: string;
  references_pertinentes: string;
  references_exigees: string;
  jours_disponibles: string;
  jours_requis: string;
  marge: string;
  marge_cible: string;
  concurrents_connus: string;
  concurrents_forts: string;
}

export const SAISIE_EVALUATION_VIDE: SaisieEvaluation = {
  adequation: "",
  references_pertinentes: "",
  references_exigees: "0",
  jours_disponibles: "",
  jours_requis: "",
  marge: "",
  marge_cible: "20",
  concurrents_connus: "0",
  concurrents_forts: "0",
};

export interface ChargeEvaluation {
  adequation?: number;
  references_pertinentes?: number;
  references_exigees: number;
  jours_disponibles: number;
  jours_requis: number;
  marge_estimee_bp?: number;
  marge_cible_bp?: number;
  concurrents_connus: number;
  concurrents_forts: number;
}

function entier(v: string, max: number, obligatoire: boolean): number | null | "erreur" {
  const n = lireNombre(v);
  if (n === null) return obligatoire ? "erreur" : null;
  if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > max) return "erreur";
  return n;
}

/** Saisie de l'évaluation go/no-go → corps ; la marge n'est envoyée qu'avec `finance.lire`. */
export function validerEvaluation(
  s: SaisieEvaluation,
  voitFinance: boolean,
): Resultat<ChargeEvaluation, keyof SaisieEvaluation> {
  const erreurs: Partial<Record<keyof SaisieEvaluation, string>> = {};
  const lus: Partial<Record<keyof SaisieEvaluation, number | null>> = {};
  const regles: [keyof SaisieEvaluation, number, boolean, string][] = [
    ["adequation", 100, false, "Note entière de 0 à 100."],
    ["references_pertinentes", 1000, false, "Nombre entier."],
    ["references_exigees", 100, true, "Nombre entier de 0 à 100."],
    ["jours_disponibles", 100000, true, "Jours disponibles : nombre entier."],
    ["jours_requis", 100000, true, "Jours requis : nombre entier."],
    ["concurrents_connus", 100, true, "Nombre entier de 0 à 100."],
    ["concurrents_forts", 100, true, "Nombre entier de 0 à 100."],
  ];
  for (const [champ, max, obligatoire, message] of regles) {
    const n = entier(s[champ], max, obligatoire);
    if (n === "erreur") erreurs[champ] = message;
    else lus[champ] = n;
  }
  if ((lus.concurrents_forts ?? 0) > (lus.concurrents_connus ?? 0)) {
    erreurs.concurrents_forts = "Les concurrents forts font partie des concurrents connus.";
  }
  let marge: number | null = null;
  let cible: number | null = null;
  if (voitFinance) {
    marge = pourCentVersPointsDeBase(s.marge);
    if (marge !== null && (Number.isNaN(marge) || marge < -10000 || marge > 10000)) {
      erreurs.marge = "Pourcentage de −100 à 100, deux décimales au plus.";
    }
    cible = pourCentVersPointsDeBase(s.marge_cible);
    if (cible !== null && (Number.isNaN(cible) || cible < 1 || cible > 10000)) {
      erreurs.marge_cible = "Pourcentage de 0,01 à 100.";
    }
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const facultatif = (k: keyof SaisieEvaluation) =>
    lus[k] === null || lus[k] === undefined ? {} : { [k]: lus[k] as number };
  return {
    ok: true,
    charge: {
      ...facultatif("adequation"),
      ...facultatif("references_pertinentes"),
      references_exigees: lus.references_exigees as number,
      jours_disponibles: lus.jours_disponibles as number,
      jours_requis: lus.jours_requis as number,
      concurrents_connus: lus.concurrents_connus as number,
      concurrents_forts: lus.concurrents_forts as number,
      ...(marge !== null ? { marge_estimee_bp: marge } : {}),
      ...(marge !== null && cible !== null ? { marge_cible_bp: cible } : {}),
    },
  };
}

/** Points de base → « 15,5 % » (affichage d'une valeur reçue de l'API). */
export function formaterPointsDeBase(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "—";
  const signe = bp < 0 ? "−" : "";
  const a = Math.abs(bp);
  const dec = String(a % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${signe}${Math.trunc(a / 100)}${dec ? `,${dec}` : ""} %`;
}

export function validerMotif(motif: string): Resultat<string, "motif"> {
  const m = motif.trim();
  if (m.length < 10) return { ok: false, erreurs: { motif: "Motivez en 10 caractères au moins." } };
  if (m.length > 2000) return { ok: false, erreurs: { motif: "2 000 caractères au plus." } };
  return { ok: true, charge: m };
}

export function validerTexteDossier(texte: string): Resultat<string, "texte"> {
  const t = texte.trim();
  if (t.length < 50) {
    return {
      ok: false,
      erreurs: { texte: "Collez le texte du dossier (50 caractères au moins)." },
    };
  }
  if (t.length > 200_000) return { ok: false, erreurs: { texte: "200 000 caractères au plus." } };
  return { ok: true, charge: t };
}

export interface SaisieExigence {
  libelle: string;
  categorie: string;
  obligatoire: boolean;
  reference: string;
}

export function validerExigence(s: SaisieExigence): Resultat<
  {
    libelle: string;
    categorie: CategorieExigenceAo;
    obligatoire: boolean;
    reference: string | null;
  },
  keyof SaisieExigence
> {
  const erreurs: Partial<Record<keyof SaisieExigence, string>> = {};
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = "Décrivez l'exigence.";
  else if (libelle.length > 1000) erreurs.libelle = "1 000 caractères au plus.";
  if (!(CATEGORIES_EXIGENCE_AO as readonly string[]).includes(s.categorie)) {
    erreurs.categorie = "Choisissez une catégorie.";
  }
  if (s.reference.trim().length > 60) erreurs.reference = "60 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle,
      categorie: s.categorie as CategorieExigenceAo,
      obligatoire: s.obligatoire,
      reference: ou(s.reference),
    },
  };
}
