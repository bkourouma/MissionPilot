/**
 * Simulation de Monte-Carlo du plan financier (PLA-16) : distribution de la
 * VAN et probabilité de tension de trésorerie, reproductibles (graine fixée).
 *
 * Moteur pur : ni base, ni horloge, ni IA, ni `Math.random`. Mêmes hypothèses
 * + mêmes paramètres + même graine = résultat identique (voir `prng.ts`).
 *
 * Principe : jusqu'à cinq hypothèses « incertaines » (les cinq écarts de
 * `EcartsScenario`) reçoivent chacune une loi (uniforme, triangulaire ou
 * normale tronquée). À chaque tirage :
 * 1. une valeur par hypothèse incertaine est tirée, dans l'ordre FIXE de
 *    `CIBLES_INCERTAINES` (et non dans l'ordre de saisie, pour que la saisie
 *    n'influe pas le flux) ;
 * 2. elle est arrondie au centième (points, ou % relatif pour les charges
 *    fixes) ;
 * 3. les écarts sont appliqués aux hypothèses normalisées par `appliquerEcarts`
 *    (mêmes sémantique et mêmes bornes que les scénarios), puis le modèle est
 *    recalculé par `calculerDepuisNormalisees`.
 *
 * Un tirage dont les hypothèses sortent de leurs bornes (`HYPOTHESE_INVALIDE`
 * ou `MONTANT_INVALIDE`) est rejeté : compté dans `tiragesRejetes`, exclu des
 * statistiques, sans tirage supplémentaire (le flux reste le même). Plus de
 * 20 % de rejets, ou aucun tirage valide : `MONTE_CARLO_INVALIDE`.
 *
 * Tension de trésorerie : trésorerie nette de clôture < 0 au moins une fois
 * sur l'horizon, ce qui correspond à l'alerte `TRESORERIE_NEGATIVE`.
 *
 * Statistiques : moyenne et variance (de population) par somme `bigint`
 * exacte, arrondies à l'unité mineure (écart-type = racine entière arrondie) ;
 * percentiles au rang le plus proche (rang = ⌈p × n / 100⌉ sur la suite triée
 * par ordre croissant) ; probabilités arrondies à 4 décimales (demi vers le
 * haut) par un calcul entier ; empreinte FNV-1a 32 bits de la suite des VAN et
 * des trésoreries minimales (entiers signés sur 64 bits, petit-boutiste), dans
 * l'ordre des tirages valides.
 */
import { ErreurPlan } from "./erreurs";
import { diviserArrondi } from "../finance/calcul-exact";
import { versEntier } from "./exact";
import { appliquerEcarts, type EcartsScenario } from "./scenarios";
import {
  normaliserHypotheses,
  type HypothesesNormalisees,
  type HypothesesPlan,
} from "./hypotheses";
import { calculerDepuisNormalisees } from "./modele";
import {
  creerGenerateur,
  tirerNormale,
  tirerTriangulaire,
  tirerUniforme,
  validerGraine,
  type GenerateurAlea,
} from "./prng";

export const MOTEUR_MONTE_CARLO = "engines/plan-strategique/monte-carlo@1";

/** Nombre maximal de tirages (plafond dur, pour borner le temps de calcul). */
export const TIRAGES_MAX = 2000;
export const TIRAGES_MIN = 100;
export const TIRAGES_DEFAUT = 1000;
/** Part maximale de tirages rejetés : au-delà, la simulation est refusée (20 %). */
export const REJETS_MAX_POURCENT = 20;
/** Nombre de classes de l'histogramme de la VAN. */
export const CLASSES_HISTOGRAMME = 20;
/** Valeur absolue maximale d'un paramètre de loi (points, % ou jours). */
export const AMPLEUR_MAX_LOI = 1000;

/** Les cinq hypothèses pouvant être rendues incertaines, dans l'ordre de tirage. */
export const CIBLES_INCERTAINES = [
  "croissanceChiffreAffaires",
  "tauxMargeBrute",
  "tauxChargesVariables",
  "chargesFixes",
  "delaiClientsJours",
] as const;

export type CibleIncertaine = (typeof CIBLES_INCERTAINES)[number];

export type LoiIncertaine =
  | { readonly type: "uniforme"; readonly min: number; readonly max: number }
  | {
      readonly type: "triangulaire";
      readonly min: number;
      readonly mode: number;
      readonly max: number;
    }
  | {
      readonly type: "normale";
      readonly moyenne: number;
      readonly ecartType: number;
      readonly min: number;
      readonly max: number;
    };

export interface HypotheseIncertaine {
  readonly cible: CibleIncertaine;
  /** Loi de l'écart appliqué à la cible (mêmes unités que `EcartsScenario`). */
  readonly loi: LoiIncertaine;
}

export interface ParametresMonteCarlo {
  /** Entier de 0 à 4 294 967 295. */
  readonly graine: number;
  /** Entier de `TIRAGES_MIN` à `TIRAGES_MAX`. */
  readonly tirages: number;
  /** De 1 à 5 hypothèses, une loi au plus par cible. */
  readonly hypotheses: readonly HypotheseIncertaine[];
}

export interface HistogrammeVan {
  /** 21 bornes entières : la classe i contient bornes[i] ≤ VAN < bornes[i+1] (dernière classe : ≤ maximum). */
  readonly bornes: readonly number[];
  /** 20 effectifs. */
  readonly effectifs: readonly number[];
}

export interface PercentilesVan {
  readonly p5: number;
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
}

export interface DistributionVan {
  readonly moyenne: number;
  readonly ecartType: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly percentiles: PercentilesVan;
  readonly histogramme: HistogrammeVan;
}

export interface ResultatMonteCarlo {
  readonly moteur: typeof MOTEUR_MONTE_CARLO;
  readonly graine: number;
  readonly tirages: number;
  readonly tiragesValides: number;
  readonly tiragesRejetes: number;
  /** Scénario de base (aucun écart). */
  readonly base: { readonly van: number; readonly tresorerieMinimale: number };
  readonly van: DistributionVan;
  /** Part des tirages valides où la VAN est < 0 (fraction à 4 décimales). */
  readonly probabiliteVanNegative: number;
  /** Part des tirages valides où la trésorerie de clôture est < 0 au moins une fois. */
  readonly probabiliteTension: number;
  /** Part des tirages valides où la trésorerie de clôture de l'année est < 0 (index 0 = année 1). */
  readonly probabiliteTensionParAnnee: readonly number[];
  /** Trésorerie nette de clôture minimale sur l'horizon, par tirage. */
  readonly tresorerieMinimale: { readonly p5: number; readonly p50: number; readonly p95: number };
  /** Somme de contrôle FNV-1a 32 bits, 8 caractères hexadécimaux. */
  readonly empreinte: string;
}

// --- Validation -------------------------------------------------------------

function invalide(chemin: string, message: string): never {
  throw new ErreurPlan("MONTE_CARLO_INVALIDE", `${chemin} : ${message}`, chemin);
}

function nombre(chemin: string, x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > AMPLEUR_MAX_LOI) {
    invalide(
      chemin,
      `un nombre fini de valeur absolue ≤ ${AMPLEUR_MAX_LOI} attendu (reçu ${String(x)}).`,
    );
  }
  return x;
}

function validerLoi(chemin: string, loi: unknown): void {
  if (typeof loi !== "object" || loi === null) invalide(chemin, "une loi est attendue.");
  const l = loi as Record<string, unknown>;
  switch (l.type) {
    case "uniforme": {
      const min = nombre(`${chemin}.min`, l.min);
      const max = nombre(`${chemin}.max`, l.max);
      if (!(min < max))
        invalide(`${chemin}.max`, `doit être strictement supérieur à min (${min}).`);
      return;
    }
    case "triangulaire": {
      const min = nombre(`${chemin}.min`, l.min);
      const mode = nombre(`${chemin}.mode`, l.mode);
      const max = nombre(`${chemin}.max`, l.max);
      if (!(min < max))
        invalide(`${chemin}.max`, `doit être strictement supérieur à min (${min}).`);
      if (mode < min || mode > max) {
        invalide(`${chemin}.mode`, `doit être compris entre min (${min}) et max (${max}).`);
      }
      return;
    }
    case "normale": {
      const moyenne = nombre(`${chemin}.moyenne`, l.moyenne);
      const ecartType = nombre(`${chemin}.ecartType`, l.ecartType);
      const min = nombre(`${chemin}.min`, l.min);
      const max = nombre(`${chemin}.max`, l.max);
      if (!(ecartType > 0)) invalide(`${chemin}.ecartType`, "doit être strictement positif.");
      if (!(min < max))
        invalide(`${chemin}.max`, `doit être strictement supérieur à min (${min}).`);
      if (moyenne < min || moyenne > max) {
        invalide(`${chemin}.moyenne`, `doit être comprise entre min (${min}) et max (${max}).`);
      }
      return;
    }
    default:
      invalide(`${chemin}.type`, "uniforme, triangulaire ou normale attendu.");
  }
}

/** Valide les paramètres de simulation (`MONTE_CARLO_INVALIDE`, avec le chemin fautif). */
export function validerParametresMonteCarlo(p: ParametresMonteCarlo): void {
  validerGraine(p.graine);
  if (!Number.isInteger(p.tirages) || p.tirages < TIRAGES_MIN || p.tirages > TIRAGES_MAX) {
    invalide(
      "tirages",
      `un entier de ${TIRAGES_MIN} à ${TIRAGES_MAX} est attendu (reçu ${String(p.tirages)}).`,
    );
  }
  if (!Array.isArray(p.hypotheses) || p.hypotheses.length < 1 || p.hypotheses.length > 5) {
    invalide("hypotheses", "de 1 à 5 hypothèses incertaines sont attendues.");
  }
  const vues = new Set<string>();
  p.hypotheses.forEach((h, i) => {
    const chemin = `hypotheses[${i}]`;
    if (typeof h !== "object" || h === null)
      invalide(chemin, "une hypothèse incertaine est attendue.");
    if (!(CIBLES_INCERTAINES as readonly unknown[]).includes(h.cible)) {
      invalide(`${chemin}.cible`, `une cible parmi ${CIBLES_INCERTAINES.join(", ")} est attendue.`);
    }
    if (vues.has(h.cible)) invalide(`${chemin}.cible`, `la cible ${h.cible} est en double.`);
    vues.add(h.cible);
    validerLoi(`${chemin}.loi`, h.loi);
  });
}

// --- Statistiques exactes ---------------------------------------------------

/** Racine carrée entière (par défaut) d'un `bigint` positif ou nul. */
function racineEntiere(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

function moyenneEtEcartType(valeurs: readonly number[]): { moyenne: number; ecartType: number } {
  const n = BigInt(valeurs.length);
  let somme = 0n;
  let sommeCarres = 0n;
  for (const v of valeurs) {
    const b = BigInt(v);
    somme += b;
    sommeCarres += b * b;
  }
  const moyenne = versEntier(diviserArrondi(somme, n));
  // Variance de population = N / n² avec N = n × Σx² − (Σx)² (≥ 0).
  const numerateur = n * sommeCarres - somme * somme;
  const n2 = n * n;
  const k0 = racineEntiere(numerateur / n2);
  // Arrondi au plus proche de √(N / n²) : k0 + 1 si 4N ≥ n² (2 k0 + 1)².
  const k = 4n * numerateur >= n2 * (2n * k0 + 1n) ** 2n ? k0 + 1n : k0;
  return { moyenne, ecartType: versEntier(k) };
}

/** Percentile au rang le plus proche sur une suite triée croissante. */
function percentile(triees: readonly number[], p: number): number {
  const rang = Math.max(1, Math.floor((p * triees.length + 99) / 100));
  return triees[rang - 1]!;
}

function histogramme(triees: readonly number[]): HistogrammeVan {
  const minimum = BigInt(triees[0]!);
  const etendue = BigInt(triees[triees.length - 1]!) - minimum;
  const classes = BigInt(CLASSES_HISTOGRAMME);
  const bornes: number[] = [];
  for (let i = 0n; i < classes; i++) {
    const decalage = (i * etendue + classes - 1n) / classes;
    bornes.push(versEntier(minimum + decalage));
  }
  bornes.push(triees[triees.length - 1]!);
  const effectifs = Array.from({ length: CLASSES_HISTOGRAMME }, () => 0);
  for (const v of triees) {
    const classe = etendue === 0n ? 0n : ((BigInt(v) - minimum) * classes) / etendue;
    const index = Number(classe >= classes ? classes - 1n : classe);
    effectifs[index] = effectifs[index]! + 1;
  }
  return { bornes, effectifs };
}

/** Probabilité arrondie à 4 décimales (demi vers le haut), calcul entier. */
function probabilite(compte: number, total: number): number {
  return Math.floor((2 * compte * 10_000 + total) / (2 * total)) / 10_000;
}

function comparer(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** FNV-1a 32 bits sur des entiers signés 64 bits, petit-boutiste. */
function empreinteFnv(suite: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const v of suite) {
    let m = BigInt.asUintN(64, BigInt(v));
    for (let i = 0; i < 8; i++) {
      h = Math.imul(h ^ Number(m & 0xffn), 0x01000193) >>> 0;
      m >>= 8n;
    }
  }
  return h.toString(16).padStart(8, "0");
}

// --- Simulation -------------------------------------------------------------

function tirer(g: GenerateurAlea, loi: LoiIncertaine): number {
  switch (loi.type) {
    case "uniforme":
      return tirerUniforme(g, loi.min, loi.max);
    case "triangulaire":
      return tirerTriangulaire(g, loi.min, loi.mode, loi.max);
    case "normale":
      return tirerNormale(g, loi.moyenne, loi.ecartType, loi.min, loi.max);
  }
}

/** Arrondi au centième, sans zéro négatif. */
function auCentieme(x: number): number {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
}

function tresorerieMinimale(annees: readonly { bilan: { tresorerieNette: number } }[]): number {
  return Math.min(...annees.map((a) => a.bilan.tresorerieNette));
}

/**
 * Simule `tirages` plans financiers aux hypothèses incertaines tirées selon
 * leurs lois, et résume la distribution de la VAN et le risque de tension.
 */
export function simulerMonteCarlo(
  hypotheses: HypothesesPlan,
  parametres: ParametresMonteCarlo,
): ResultatMonteCarlo {
  validerParametresMonteCarlo(parametres);
  const normalisees: HypothesesNormalisees = normaliserHypotheses(hypotheses);
  const referencee = calculerDepuisNormalisees(normalisees);
  const lois = CIBLES_INCERTAINES.flatMap((cible) => {
    const h = parametres.hypotheses.find((x) => x.cible === cible);
    return h ? [{ cible, loi: h.loi }] : [];
  });
  const g = creerGenerateur(parametres.graine);
  const horizon = normalisees.horizon;

  const vans: number[] = [];
  const minimales: number[] = [];
  const tensionsParAnnee = Array.from({ length: horizon }, () => 0);
  let tensions = 0;
  let vanNegatives = 0;
  let rejetes = 0;

  for (let t = 0; t < parametres.tirages; t++) {
    const ecarts: { -readonly [K in keyof EcartsScenario]: number } = {};
    for (const { cible, loi } of lois) ecarts[cible] = auCentieme(tirer(g, loi));
    let resultat;
    try {
      resultat = calculerDepuisNormalisees(appliquerEcarts(normalisees, ecarts, "monte-carlo"));
    } catch (e) {
      if (
        e instanceof ErreurPlan &&
        (e.code === "HYPOTHESE_INVALIDE" || e.code === "MONTANT_INVALIDE")
      ) {
        rejetes++;
        continue;
      }
      throw e;
    }
    const van = resultat.synthese.valeurActuelleNette;
    const minimale = tresorerieMinimale(resultat.annees);
    vans.push(van);
    minimales.push(minimale);
    if (van < 0) vanNegatives++;
    if (minimale < 0) tensions++;
    resultat.annees.forEach((a, i) => {
      if (a.bilan.tresorerieNette < 0) tensionsParAnnee[i] = tensionsParAnnee[i]! + 1;
    });
  }

  const valides = vans.length;
  if (valides === 0 || rejetes * 100 > REJETS_MAX_POURCENT * parametres.tirages) {
    throw new ErreurPlan(
      "MONTE_CARLO_INVALIDE",
      `${rejetes} tirage(s) sur ${parametres.tirages} rejeté(s) car hors des bornes des hypothèses ` +
        `(maximum ${REJETS_MAX_POURCENT} %) : réduire l'amplitude des lois.`,
      "hypotheses",
    );
  }

  const empreinte = empreinteFnv(vans.flatMap((v, i) => [v, minimales[i]!]));
  const vansTriees = [...vans].sort(comparer);
  const minimalesTriees = [...minimales].sort(comparer);
  const { moyenne, ecartType } = moyenneEtEcartType(vans);

  return {
    moteur: MOTEUR_MONTE_CARLO,
    graine: parametres.graine,
    tirages: parametres.tirages,
    tiragesValides: valides,
    tiragesRejetes: rejetes,
    base: {
      van: referencee.synthese.valeurActuelleNette,
      tresorerieMinimale: tresorerieMinimale(referencee.annees),
    },
    van: {
      moyenne,
      ecartType,
      minimum: vansTriees[0]!,
      maximum: vansTriees[valides - 1]!,
      percentiles: {
        p5: percentile(vansTriees, 5),
        p10: percentile(vansTriees, 10),
        p25: percentile(vansTriees, 25),
        p50: percentile(vansTriees, 50),
        p75: percentile(vansTriees, 75),
        p90: percentile(vansTriees, 90),
        p95: percentile(vansTriees, 95),
      },
      histogramme: histogramme(vansTriees),
    },
    probabiliteVanNegative: probabilite(vanNegatives, valides),
    probabiliteTension: probabilite(tensions, valides),
    probabiliteTensionParAnnee: tensionsParAnnee.map((c) => probabilite(c, valides)),
    tresorerieMinimale: {
      p5: percentile(minimalesTriees, 5),
      p50: percentile(minimalesTriees, 50),
      p95: percentile(minimalesTriees, 95),
    },
    empreinte,
  };
}
