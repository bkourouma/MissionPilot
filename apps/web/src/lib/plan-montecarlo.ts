/**
 * Simulation de Monte-Carlo du plan financier (PLA-16) : types des réponses de l'API, saisie et
 * contrôle des lois, chemins, géométrie de l'histogramme de la VAN et messages. Logique pure,
 * testée dans `plan-montecarlo.test.ts`.
 *
 * RÈGLE : aucun chiffre n'est calculé ici. VAN, percentiles, probabilités, histogramme et
 * empreinte viennent TELS QUELS de l'API (moteur `simulerMonteCarlo`) ; ce module choisit des
 * champs, les met en forme et trace des rectangles à l'échelle. La simulation est indicative :
 * elle ne modifie ni le plan ni la version du modèle financier.
 */
import {
  AMPLEUR_MAX_LOI_MONTE_CARLO,
  CIBLES_MONTE_CARLO,
  CIBLE_MONTE_CARLO_LIBELLES,
  CIBLE_MONTE_CARLO_UNITES,
  GRAINE_MONTE_CARLO_MAX,
  TIRAGES_MONTE_CARLO_DEFAUT,
  TIRAGES_MONTE_CARLO_MAX,
  TIRAGES_MONTE_CARLO_MIN,
  TYPES_LOI_MONTE_CARLO,
  type CibleMonteCarlo,
  type LoiMonteCarlo,
  type TypeLoiMonteCarlo,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { formaterMontantMineur, formaterNombre, formaterPourcentage, type Devise } from "./format";
import { cheminPlan, hrefPlan } from "./plan-strategique";
import { lireNombre } from "./saisie";

export {
  CIBLES_MONTE_CARLO,
  CIBLE_MONTE_CARLO_LIBELLES,
  CIBLE_MONTE_CARLO_UNITES,
  TYPES_LOI_MONTE_CARLO,
  type CibleMonteCarlo,
  type LoiMonteCarlo,
  type TypeLoiMonteCarlo,
};

// --- Réponses de l'API -------------------------------------------------------------------------

export interface HypotheseIncertaine {
  cible: CibleMonteCarlo;
  loi: LoiMonteCarlo;
}

export interface HistogrammeVan {
  /** 21 bornes : la classe i contient bornes[i] ≤ VAN < bornes[i+1] (dernière classe incluse). */
  bornes: number[];
  effectifs: number[];
}

export interface ResultatMonteCarlo {
  moteur: string;
  graine: number;
  tirages: number;
  tiragesValides: number;
  tiragesRejetes: number;
  base: { van: number; tresorerieMinimale: number };
  van: {
    moyenne: number;
    ecartType: number;
    minimum: number;
    maximum: number;
    percentiles: Record<CleCentile, number>;
    histogramme: HistogrammeVan;
  };
  probabiliteVanNegative: number;
  probabiliteTension: number;
  probabiliteTensionParAnnee: number[];
  tresorerieMinimale: { p5: number; p50: number; p95: number };
  empreinte: string;
}

export interface SimulationMonteCarlo {
  id: string;
  plan_id: string;
  modele_version_id: string;
  version: number;
  graine: number;
  tirages: number;
  hypotheses: HypotheseIncertaine[];
  empreinte: string;
  moteur: string;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
  resultat: ResultatMonteCarlo;
}

export interface ResumeSimulation {
  id: string;
  version: number;
  graine: number;
  tirages: number;
  cibles: CibleMonteCarlo[];
  empreinte: string;
  auteur_nom: string;
  cree_le: string;
  probabilite_van_negative: number;
  probabilite_tension: number;
  van_moyenne: number;
}

export interface PageSimulations {
  elements: ResumeSimulation[];
  curseur_suivant: string | null;
}

export interface DefautsMonteCarlo {
  version: number | null;
  validee: boolean;
  /** Toujours vrai : lois de départ à ajuster, jamais un résultat. */
  valeurs_provisoires: boolean;
  hypotheses: HypotheseIncertaine[];
}

export interface ReponseRejeu {
  simulation_id: string;
  identique: boolean;
  empreinte_enregistree: string;
  empreinte_rejouee: string;
}

/** Version du modèle proposée au choix (résumé de GET /plans/:id/modeles). */
export interface VersionProposee {
  version: number;
  validee: boolean;
}

// --- Libellés ---------------------------------------------------------------------------------

export const MENTION_INDICATIVE =
  "Simulation indicative : elle explore l'incertitude de quelques hypothèses autour d'une version " +
  "du modèle financier, avec des lois que vous choisissez. Elle ne modifie ni le plan ni la " +
  "version du modèle, et ne remplace pas le jugement du consultant.";

export const LIBELLE_TYPE_LOI: Record<TypeLoiMonteCarlo, string> = {
  uniforme: "Uniforme",
  triangulaire: "Triangulaire",
  normale: "Normale tronquée",
};

export const CENTILES = [
  ["p5", "5 %"],
  ["p10", "10 %"],
  ["p25", "25 %"],
  ["p50", "50 % (médiane)"],
  ["p75", "75 %"],
  ["p90", "90 %"],
  ["p95", "95 %"],
] as const;
export type CleCentile = (typeof CENTILES)[number][0];

/** Unité d'un paramètre de loi, pour l'aide à la saisie. */
export const uniteCible = (cible: CibleMonteCarlo) => CIBLE_MONTE_CARLO_UNITES[cible];

export function libelleVersionProposee(v: VersionProposee): string {
  return `Version ${v.version}${v.validee ? " (validée)" : " (non validée)"}`;
}

/** Version de départ : la dernière validée, sinon la dernière (liste de la plus récente à la plus ancienne). */
export function versionParDefaut(versions: readonly VersionProposee[]): number | null {
  return (versions.find((v) => v.validee) ?? versions[0])?.version ?? null;
}

export function libelleLoi(loi: LoiMonteCarlo, cible: CibleMonteCarlo): string {
  const u = uniteCible(cible);
  const n = (x: number) => formaterNombre(x, 2);
  switch (loi.type) {
    case "uniforme":
      return `Uniforme de ${n(loi.min)} à ${n(loi.max)} ${u}`;
    case "triangulaire":
      return `Triangulaire de ${n(loi.min)} à ${n(loi.max)} ${u}, le plus probable à ${n(loi.mode)}`;
    case "normale":
      return `Normale de moyenne ${n(loi.moyenne)} et d'écart-type ${n(loi.ecartType)}, bornée de ${n(loi.min)} à ${n(loi.max)} ${u}`;
  }
}

// --- Saisie des lois --------------------------------------------------------------------------

export interface SaisieLoi {
  actif: boolean;
  type: TypeLoiMonteCarlo;
  min: string;
  mode: string;
  max: string;
  moyenne: string;
  ecartType: string;
}

export interface SaisieSimulation {
  version: string;
  graine: string;
  tirages: string;
  lois: Record<CibleMonteCarlo, SaisieLoi>;
}

const texte = (x: number) => String(x).replace(".", ",");

function loiVide(): SaisieLoi {
  return {
    actif: false,
    type: "triangulaire",
    min: "",
    mode: "",
    max: "",
    moyenne: "",
    ecartType: "",
  };
}

function saisieDepuisLoi(loi: LoiMonteCarlo): SaisieLoi {
  const base = {
    ...loiVide(),
    actif: true,
    type: loi.type,
    min: texte(loi.min),
    max: texte(loi.max),
  };
  if (loi.type === "triangulaire") return { ...base, mode: texte(loi.mode) };
  if (loi.type === "normale") {
    return { ...base, moyenne: texte(loi.moyenne), ecartType: texte(loi.ecartType) };
  }
  return base;
}

/** Saisie initiale : les lois de départ de l'API (valeurs provisoires) sont activées, les autres vides. */
export function saisieInitiale(
  version: number | null,
  defauts: readonly HypotheseIncertaine[],
): SaisieSimulation {
  const lois = Object.fromEntries(CIBLES_MONTE_CARLO.map((c) => [c, loiVide()])) as Record<
    CibleMonteCarlo,
    SaisieLoi
  >;
  for (const h of defauts) lois[h.cible] = saisieDepuisLoi(h.loi);
  return {
    version: version === null ? "" : String(version),
    graine: "",
    tirages: String(TIRAGES_MONTE_CARLO_DEFAUT),
    lois,
  };
}

/** Clé d'erreur d'un champ de loi, ex. « tauxMargeBrute.min ». */
export const cleErreurLoi = (cible: CibleMonteCarlo, champ: keyof SaisieLoi) => `${cible}.${champ}`;

function entier(v: string, min: number, max: number): number | null {
  const n = lireNombre(v);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function nombreLoi(v: string): number | null {
  const n = lireNombre(v);
  return n !== null && Number.isFinite(n) && Math.abs(n) <= AMPLEUR_MAX_LOI_MONTE_CARLO ? n : null;
}

const MESSAGE_NOMBRE = `Nombre entre -${AMPLEUR_MAX_LOI_MONTE_CARLO} et ${AMPLEUR_MAX_LOI_MONTE_CARLO}.`;

function validerLoi(
  cible: CibleMonteCarlo,
  s: SaisieLoi,
  erreurs: Record<string, string>,
): LoiMonteCarlo | null {
  const lire = (champ: "min" | "mode" | "max" | "moyenne" | "ecartType") => {
    const n = nombreLoi(s[champ]);
    if (n === null) erreurs[cleErreurLoi(cible, champ)] = MESSAGE_NOMBRE;
    return n;
  };
  const min = lire("min");
  const max = lire("max");
  const mode = s.type === "triangulaire" ? lire("mode") : 0;
  const moyenne = s.type === "normale" ? lire("moyenne") : 0;
  const ecartType = s.type === "normale" ? lire("ecartType") : 1;
  if (min === null || max === null || mode === null || moyenne === null || ecartType === null) {
    return null;
  }
  let ok = true;
  const refuser = (champ: keyof SaisieLoi, message: string) => {
    erreurs[cleErreurLoi(cible, champ)] = message;
    ok = false;
  };
  if (!(min < max)) refuser("max", "Le maximum doit être strictement supérieur au minimum.");
  if (s.type === "triangulaire" && (mode < min || mode > max)) {
    refuser(
      "mode",
      "La valeur la plus probable doit être comprise entre le minimum et le maximum.",
    );
  }
  if (s.type === "normale") {
    if (!(ecartType > 0)) refuser("ecartType", "L'écart-type doit être strictement positif.");
    if (moyenne < min || moyenne > max) {
      refuser("moyenne", "La moyenne doit être comprise entre le minimum et le maximum.");
    }
  }
  if (!ok) return null;
  if (s.type === "uniforme") return { type: "uniforme", min, max };
  if (s.type === "triangulaire") return { type: "triangulaire", min, mode, max };
  return { type: "normale", moyenne, ecartType, min, max };
}

export interface CorpsSimulation {
  version: number;
  graine?: number;
  tirages: number;
  hypotheses: HypotheseIncertaine[];
}

/** Contrôle de la saisie (mêmes bornes que l'API) ; `corps` est nul s'il reste une erreur. */
export function validerSimulation(s: SaisieSimulation): {
  erreurs: Record<string, string>;
  corps: CorpsSimulation | null;
} {
  const erreurs: Record<string, string> = {};
  const version = entier(s.version, 1, 100_000);
  if (version === null) erreurs.version = "Choisissez une version du modèle financier.";
  const graineTexte = s.graine.trim();
  const graine = graineTexte === "" ? null : entier(graineTexte, 0, GRAINE_MONTE_CARLO_MAX);
  if (graineTexte !== "" && graine === null) {
    erreurs.graine = `Entier de 0 à ${formaterNombre(GRAINE_MONTE_CARLO_MAX, 0)}, ou laisser vide.`;
  }
  const tirages = entier(s.tirages, TIRAGES_MONTE_CARLO_MIN, TIRAGES_MONTE_CARLO_MAX);
  if (tirages === null) {
    erreurs.tirages = `Entier de ${TIRAGES_MONTE_CARLO_MIN} à ${formaterNombre(TIRAGES_MONTE_CARLO_MAX, 0)}.`;
  }
  const hypotheses: HypotheseIncertaine[] = [];
  for (const cible of CIBLES_MONTE_CARLO) {
    const l = s.lois[cible];
    if (!l.actif) continue;
    const loi = validerLoi(cible, l, erreurs);
    if (loi) hypotheses.push({ cible, loi });
  }
  const actives = CIBLES_MONTE_CARLO.filter((c) => s.lois[c].actif).length;
  if (actives === 0) erreurs.hypotheses = "Choisissez au moins une hypothèse incertaine.";
  if (Object.keys(erreurs).length || version === null || tirages === null) {
    return { erreurs, corps: null };
  }
  return {
    erreurs,
    corps: { version, ...(graine !== null ? { graine } : {}), tirages, hypotheses },
  };
}

// --- Histogramme de la VAN --------------------------------------------------------------------

export interface BarreHistogramme {
  index: number;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  effectif: number;
  borneMin: number;
  borneMax: number;
  /** Signe des VAN de la classe : toutes négatives, toutes positives ou mêlées. */
  signe: "negative" | "positive" | "mixte";
}

export interface GeometrieHistogramme {
  largeur: number;
  hauteur: number;
  gauche: number;
  droite: number;
  haut: number;
  bas: number;
  barres: BarreHistogramme[];
  /** Abscisse du zéro, `null` s'il est hors de l'intervalle des classes. */
  xZero: number | null;
  /** Abscisse d'une valeur quelconque (médiane, base), bornée à l'intervalle. */
  abscisse: (valeur: number) => number;
  effectifMax: number;
}

const L = 640;
const H = 300;
const MARGE = { gauche: 16, droite: 16, haut: 16, bas: 56 };

/** Rectangles de l'histogramme, à l'échelle de la largeur et de l'effectif maximal. */
export function geometrieHistogramme(h: HistogrammeVan): GeometrieHistogramme | null {
  const { bornes, effectifs } = h;
  if (effectifs.length === 0 || bornes.length !== effectifs.length + 1) return null;
  const gauche = MARGE.gauche;
  const droite = L - MARGE.droite;
  const haut = MARGE.haut;
  const bas = H - MARGE.bas;
  const min = bornes[0] as number;
  const max = bornes[bornes.length - 1] as number;
  const etendue = max - min;
  const effectifMax = Math.max(1, ...effectifs);
  const largeurUtile = droite - gauche;
  const abscisse = (v: number) =>
    etendue === 0
      ? gauche + largeurUtile / 2
      : gauche + ((Math.min(max, Math.max(min, v)) - min) / etendue) * largeurUtile;
  const barres = effectifs.map((effectif, i): BarreHistogramme => {
    const borneMin = bornes[i] as number;
    const borneMax = bornes[i + 1] as number;
    // Étendue nulle (toutes les VAN égales) : une seule barre pleine largeur.
    const x = etendue === 0 ? gauche + (largeurUtile * i) / effectifs.length : abscisse(borneMin);
    const fin =
      etendue === 0 ? gauche + (largeurUtile * (i + 1)) / effectifs.length : abscisse(borneMax);
    const hauteur = (effectif / effectifMax) * (bas - haut);
    return {
      index: i,
      x,
      y: bas - hauteur,
      largeur: Math.max(0, fin - x),
      hauteur,
      effectif,
      borneMin,
      borneMax,
      signe: borneMax <= 0 ? "negative" : borneMin >= 0 ? "positive" : "mixte",
    };
  });
  return {
    largeur: L,
    hauteur: H,
    gauche,
    droite,
    haut,
    bas,
    barres,
    xZero: min <= 0 && max >= 0 && etendue !== 0 ? abscisse(0) : null,
    abscisse,
    effectifMax,
  };
}

export const LIBELLE_SIGNE: Record<BarreHistogramme["signe"], string> = {
  negative: "VAN négative",
  positive: "VAN positive",
  mixte: "classe à cheval sur zéro",
};

/** Lignes du tableau équivalent à l'histogramme (une par classe). */
export function lignesHistogramme(h: HistogrammeVan, devise: Devise) {
  return h.effectifs.map((effectif, i) => ({
    cle: String(i),
    classe: `De ${formaterMontantMineur(h.bornes[i], devise)} à ${formaterMontantMineur(h.bornes[i + 1], devise)}`,
    effectif,
  }));
}

/** Alternative textuelle du graphique (résumé des valeurs du moteur). */
export function descriptionHistogramme(r: ResultatMonteCarlo, devise: Devise): string {
  return (
    `Répartition de la valeur actuelle nette sur ${formaterNombre(r.tiragesValides, 0)} tirages valides, ` +
    `de ${formaterMontantMineur(r.van.minimum, devise)} à ${formaterMontantMineur(r.van.maximum, devise)}, ` +
    `médiane ${formaterMontantMineur(r.van.percentiles.p50, devise)}. ` +
    `Probabilité d'une VAN négative : ${formaterProbabilite(r.probabiliteVanNegative)}.`
  );
}

/** Probabilité du moteur (fraction à 4 décimales) → « 12,3 % ». */
export const formaterProbabilite = (p: number) => formaterPourcentage(p, 2);

// --- Tension de trésorerie par année ----------------------------------------------------------

export function lignesTensionParAnnee(r: ResultatMonteCarlo) {
  return r.probabiliteTensionParAnnee.map((p, i) => ({
    cle: String(i + 1),
    annee: `Année ${i + 1}`,
    probabilite: p,
  }));
}

// --- Chemins ----------------------------------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);

export const cheminMonteCarlo = (planId: string) => `${cheminPlan(planId)}/montecarlo`;
export const cheminSimulations = (planId: string) => `${cheminMonteCarlo(planId)}/simulations`;
export const cheminListeSimulations = (planId: string, limite: number, curseur: string | null) => {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${cheminSimulations(planId)}?${q.toString()}`;
};
export const cheminSimulation = (planId: string, simId: string) =>
  `${cheminSimulations(planId)}/${seg(simId)}`;
export const cheminRejeu = (planId: string, simId: string) =>
  `${cheminSimulation(planId, simId)}/rejeu`;
export const cheminDefauts = (planId: string, version?: number | null) =>
  `${cheminMonteCarlo(planId)}/defauts${version ? `?version=${version}` : ""}`;

export function hrefSimulation(
  missionId: string,
  planId: string,
  q: { simulation?: string | null; curseur?: string | null } = {},
): string {
  const p = new URLSearchParams();
  if (q.simulation) p.set("simulation", q.simulation);
  if (q.curseur) p.set("curseur", q.curseur);
  const s = p.toString();
  return `${hrefPlan(missionId, planId)}/simulation${s ? `?${s}` : ""}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant de simulation lu dans l'URL, ou `null` s'il est absent ou mal formé. */
export function lireIdSimulation(v: string | string[] | undefined): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && UUID.test(x) ? x : null;
}

// --- Messages ---------------------------------------------------------------------------------

/** Message français d'un refus de l'API. */
export function messageMonteCarlo(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "TROP_DE_SIMULATIONS") {
      return "Trop de simulations lancées en peu de temps : patientez quelques minutes avant de recommencer.";
    }
    if (e.code === "SIMULATIONS_PLAFOND") {
      return "Ce plan a atteint le nombre maximal de simulations enregistrées.";
    }
    if (e.code === "MONTE_CARLO_INVALIDE") return e.message;
    if (e.statut === 403) return "Lancer une simulation est réservé aux rédacteurs du plan.";
    if (e.statut === 404) {
      return "Ce plan, cette version du modèle ou cette simulation est introuvable ou ne vous est plus accessible.";
    }
    if (e.statut === 409) return e.message;
    if (e.statut === 400 && e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.") {
      return e.message;
    }
  }
  return messageErreur(e);
}

/** Phrase du résultat d'un rejeu : « identique » ou l'écart constaté. */
export function messageRejeu(r: ReponseRejeu): string {
  if (r.identique) {
    return `Rejeu identique : avec la même graine, les mêmes lois et la même version du modèle, le moteur redonne exactement le résultat enregistré (empreinte ${r.empreinte_rejouee}).`;
  }
  if (r.empreinte_enregistree === r.empreinte_rejouee) {
    return `Écart constaté : les empreintes concordent (${r.empreinte_rejouee}) mais le résultat détaillé rejoué diffère de celui enregistré.`;
  }
  return `Écart constaté : empreinte enregistrée ${r.empreinte_enregistree}, empreinte rejouée ${r.empreinte_rejouee}.`;
}
