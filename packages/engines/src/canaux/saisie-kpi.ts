/**
 * Saisie de KPI par message (KPI-14, lot 3c, SPEC §9.6). Du code déterministe : le texte reçu est
 * une donnée non fiable (AGT-07), jamais interprété par un modèle. Le résultat n'est qu'une
 * PROPOSITION (confirmée par OUI, puis reprise par un utilisateur du cabinet) : la valeur est une
 * chaîne décimale exacte, aucun `Number` n'intervient dans la valeur.
 */
import { ErreurCanaux } from "./erreurs";
import { normaliserTexteCanal } from "./reponse";

export const SEUIL_ORDRE_GRANDEUR = 10;
export const HISTORIQUE_MIN = 3;
export const K_MAD = 5;
export const POINTS_MIN_MAD = 6;

/** Longueur maximale d'un texte analysé ; au-delà : `KPI_INCONNU` (pas une commande de saisie). */
export const SAISIE_TEXTE_LONGUEUR_MAX = 1000;
/** Nombre maximal de propositions rendues pour un KPI ambigu. */
export const SAISIE_PROPOSITIONS_MAX = 5;

export interface KpiRecherche {
  readonly id: string;
  readonly libelle: string;
}

export type CodeErreurSaisieKpi =
  "VALEUR_ABSENTE" | "VALEUR_AMBIGUE" | "VALEUR_HORS_BORNES" | "KPI_INCONNU" | "KPI_AMBIGU";

export type ResultatSaisieKpi =
  | {
      readonly statut: "ok";
      readonly kpiId: string;
      /** Chaîne décimale exacte (`125000000`, `8.5`, `-5`). */
      readonly valeur: string;
      readonly suffixe?: "%";
    }
  | {
      readonly statut: "erreur";
      readonly code: CodeErreurSaisieKpi;
      /** `KPI_AMBIGU` : au plus 5 identifiants, triés par libellé. */
      readonly propositions?: readonly string[];
    };

/* ----- Lecture d'un nombre ----- */

type Nombre =
  | { genre: "ok"; valeur: string; pourcentage: boolean }
  | { genre: "ambigu" }
  | { genre: "hors_bornes" }
  | { genre: "non" };

const NON: Nombre = { genre: "non" };

function finaliser(signe: string, entier: string, fraction: string, pourcentage: boolean): Nombre {
  const ent = entier.replace(/^0+(?=\d)/, "");
  const frac = fraction.replace(/0+$/, "");
  // |valeur| < 10^15 : au plus 15 chiffres entiers ; six décimales au plus.
  if (ent.length > 15 || frac.length > 6) return { genre: "hors_bornes" };
  const corps = frac === "" ? ent : `${ent}.${frac}`;
  const valeur = signe === "-" && corps !== "0" ? `-${corps}` : corps;
  return { genre: "ok", valeur, pourcentage };
}

/**
 * Lit un nombre : milliers par espace, `.` ou `,` décimal ; si les deux apparaissent, le dernier
 * est décimal ; un séparateur unique suivi de exactement trois chiffres est ambigu sauf si la
 * partie entière est `0` ; un `%` final est noté ; signe admis.
 */
function lireNombre(brut: string): Nombre {
  let s = brut;
  let pourcentage = false;
  if (s.endsWith("%")) {
    pourcentage = true;
    s = s.slice(0, -1);
  }
  let signe = "";
  if (s.startsWith("+") || s.startsWith("-")) {
    signe = s[0] as string;
    s = s.slice(1);
  }
  if (!/^\d/.test(s)) return NON;

  if (s.includes(" ")) {
    const m = /^(\d{1,3}(?: \d{3})+)(?:[.,](\d+))?$/.exec(s);
    if (!m) return NON;
    return finaliser(signe, (m[1] as string).replace(/ /g, ""), m[2] ?? "", pourcentage);
  }
  if (/^\d+$/.test(s)) return finaliser(signe, s, "", pourcentage);

  const virgules = s.split(",").length - 1;
  const points = s.split(".").length - 1;
  if (virgules > 0 && points > 0) {
    const i = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    const milliers = s[i] === "," ? "." : ",";
    const ent = s.slice(0, i);
    const frac = s.slice(i + 1);
    if (!/^\d+$/.test(frac)) return NON;
    const groupes = milliers === "." ? /^\d{1,3}(\.\d{3})+$/ : /^\d{1,3}(,\d{3})+$/;
    if (!groupes.test(ent)) return NON;
    return finaliser(signe, ent.split(milliers).join(""), frac, pourcentage);
  }
  const sep = virgules > 0 ? "," : ".";
  const parties = s.split(sep);
  if (parties.length === 2) {
    const [ent, frac] = parties as [string, string];
    if (!/^\d+$/.test(ent) || !/^\d+$/.test(frac)) return NON;
    if (frac.length === 3 && ent !== "0") return { genre: "ambigu" };
    return finaliser(signe, ent, frac, pourcentage);
  }
  // Même séparateur répété : regroupement par milliers obligatoire.
  const groupes = sep === "," ? /^\d{1,3}(,\d{3})+$/ : /^\d{1,3}(\.\d{3})+$/;
  if (!groupes.test(s)) return NON;
  return finaliser(signe, parties.join(""), "", pourcentage);
}

/* ----- Analyse d'un texte ----- */

function motCourant(brut: string): string {
  return brut.replace(/^[^\p{L}\p{N}+-]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");
}

const mots = (texte: string): string[] => texte.split(/[^a-z0-9]+/).filter((m) => m !== "");

/**
 * Cherche l'indicateur parmi les KPI FOURNIS (jamais d'autres) et extrait la valeur : la valeur
 * est le plus long suffixe de mots qui est un nombre, le reste est la recherche ; chaque mot de
 * la recherche (2 caractères au moins) doit être le début d'un mot du libellé, et un seul KPI doit
 * les satisfaire tous. Ordre des erreurs : valeur (absente, ambiguë, hors bornes), puis KPI.
 */
export function analyserSaisieKpi(texte: string, kpis: readonly KpiRecherche[]): ResultatSaisieKpi {
  if (typeof texte !== "string" || texte.length > SAISIE_TEXTE_LONGUEUR_MAX) {
    return { statut: "erreur", code: "KPI_INCONNU" };
  }
  const tokens = normaliserTexteCanal(texte)
    .replace(/(\d)\s+%/g, "$1%")
    .split(/\s+/)
    .map(motCourant)
    .filter((t) => t !== "" && t !== "kpi");

  let nombre: Nombre = NON;
  let debutValeur = tokens.length;
  for (let k = tokens.length; k >= 1; k--) {
    const candidat = lireNombre(tokens.slice(tokens.length - k).join(" "));
    if (candidat.genre !== "non") {
      nombre = candidat;
      debutValeur = tokens.length - k;
      break;
    }
  }
  if (nombre.genre === "non") return { statut: "erreur", code: "VALEUR_ABSENTE" };
  if (nombre.genre === "ambigu") return { statut: "erreur", code: "VALEUR_AMBIGUE" };
  if (nombre.genre === "hors_bornes") return { statut: "erreur", code: "VALEUR_HORS_BORNES" };

  const recherche = mots(tokens.slice(0, debutValeur).join(" ")).filter((m) => m.length >= 2);
  if (recherche.length === 0) return { statut: "erreur", code: "KPI_INCONNU" };

  const correspondants = kpis
    .map((kpi) => ({ kpi, libelle: normaliserTexteCanal(kpi.libelle) }))
    .filter(({ libelle }) => {
      const motsLibelle = mots(libelle);
      return recherche.every((r) => motsLibelle.some((m) => m.startsWith(r)));
    });
  if (correspondants.length === 0) return { statut: "erreur", code: "KPI_INCONNU" };
  if (correspondants.length > 1) {
    const propositions = [...correspondants]
      .sort((a, b) =>
        a.libelle < b.libelle
          ? -1
          : a.libelle > b.libelle
            ? 1
            : a.kpi.id < b.kpi.id
              ? -1
              : a.kpi.id > b.kpi.id
                ? 1
                : 0,
      )
      .slice(0, SAISIE_PROPOSITIONS_MAX)
      .map(({ kpi }) => kpi.id);
    return { statut: "erreur", code: "KPI_AMBIGU", propositions };
  }
  const [unique] = correspondants as [(typeof correspondants)[number]];
  return nombre.pourcentage
    ? { statut: "ok", kpiId: unique.kpi.id, valeur: nombre.valeur, suffixe: "%" }
    : { statut: "ok", kpiId: unique.kpi.id, valeur: nombre.valeur };
}

/* ----- Vraisemblance ----- */

export type NiveauVraisemblance = "ok" | "a_verifier" | "invraisemblable";
export type MotifVraisemblance =
  | "dans_la_norme"
  | "negatif_inhabituel"
  | "historique_insuffisant"
  | "zero"
  | "ordre_de_grandeur"
  | "ecart_median"
  | "origine_vocale";

export interface ResultatVraisemblance {
  readonly niveau: NiveauVraisemblance;
  readonly motif: MotifVraisemblance;
}

const ECHELLE = 6;
const DECIMAL = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/;

function versEchelle(valeur: string, erreur: "VALEUR_INVALIDE" | "HISTORIQUE_INVALIDE"): bigint {
  const m = typeof valeur === "string" ? DECIMAL.exec(valeur) : null;
  if (!m) throw new ErreurCanaux(erreur);
  const absolu = BigInt((m[2] as string) + (m[3] ?? "").padEnd(ECHELLE, "0"));
  return m[1] === "-" ? -absolu : absolu;
}

const comparer = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** Double de la médiane (exact : la moyenne de deux valeurs centrales peut avoir un demi-pas). */
function medianeDoublee(valeurs: readonly bigint[]): bigint {
  const tri = [...valeurs].sort(comparer);
  const n = tri.length;
  const milieu = Math.floor(n / 2);
  return n % 2 === 1
    ? 2n * (tri[milieu] as bigint)
    : (tri[milieu - 1] as bigint) + (tri[milieu] as bigint);
}

/**
 * Vraisemblance d'une valeur au regard de l'historique (décimaux exacts, mise à l'échelle 10^6
 * en `BigInt`). Règles dans l'ordre : négatif inhabituel, historique insuffisant (< 3), zéro,
 * ordre de grandeur (×10 de la médiane), écart médian (> 5 MAD, à partir de 6 valeurs).
 */
export function evaluerVraisemblance(
  valeur: string,
  historique: readonly string[],
): ResultatVraisemblance {
  const v = versEchelle(valeur, "VALEUR_INVALIDE");
  const h = historique.map((x) => versEchelle(x, "HISTORIQUE_INVALIDE"));

  if (v < 0n && h.every((x) => x >= 0n))
    return { niveau: "a_verifier", motif: "negatif_inhabituel" };
  if (h.length < HISTORIQUE_MIN) return { niveau: "a_verifier", motif: "historique_insuffisant" };
  if (v === 0n) return { niveau: "a_verifier", motif: "zero" };

  const seuil = BigInt(SEUIL_ORDRE_GRANDEUR);
  const mediane2 = medianeDoublee(h); // 2 × médiane
  if (mediane2 > 0n && (2n * v >= seuil * mediane2 || 2n * seuil * v <= mediane2)) {
    return { niveau: "invraisemblable", motif: "ordre_de_grandeur" };
  }
  if (h.length >= POINTS_MIN_MAD) {
    const mad4 = medianeDoublee(h.map((x) => abs(2n * x - mediane2))); // 4 × MAD
    const ecart2 = abs(2n * v - mediane2); // 2 × |valeur − médiane|
    if (mad4 > 0n && 2n * ecart2 > BigInt(K_MAD) * mad4) {
      return { niveau: "a_verifier", motif: "ecart_median" };
    }
  }
  return { niveau: "ok", motif: "dans_la_norme" };
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/**
 * Origine vocale : une reconnaissance vocale se trompe sur les chiffres, donc « à vérifier » au
 * minimum (la confirmation `OUI <valeur>` est alors exigée). Un `invraisemblable` reste tel quel.
 */
export function renforcerPourVocal(resultat: ResultatVraisemblance): ResultatVraisemblance {
  return resultat.niveau === "ok" ? { niveau: "a_verifier", motif: "origine_vocale" } : resultat;
}
