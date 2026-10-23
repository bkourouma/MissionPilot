/**
 * Ancrage d'un montant proposé par le modèle sur une LIGNE de la page citée (DOS-03, ADR-009).
 *
 * Un montant n'est retenu que s'il est le PREMIER montant (colonne de l'exercice N, comme
 * `extraireEtatParRegles`) d'une ligne de la page dont le LIBELLÉ COMPLET est celui de la ligne
 * proposée. Le libellé d'une ligne source est le texte qui précède son premier montant, hors code
 * éventuel en tête et hors colonne « note » ; la comparaison est insensible à la casse, aux accents,
 * aux espaces et à la ponctuation de bord. Règles :
 * - la ligne source doit COMMENCER par le libellé du modèle (après le code éventuel) ;
 * - libellé du modèle égal au libellé de la ligne : ancrage possible ;
 * - libellé du modèle plus court (simple préfixe, « Dettes fiscales » pour « Dettes fiscales et
 *   sociales ») : admis seulement si UNE SEULE ligne de la page commence par ce préfixe, que le
 *   libellé du modèle fait au moins 12 caractères et couvre au moins 80 % du libellé de la ligne
 *   (tolérance de troncature) ; sinon la ligne n'ancre pas (`absent`) ;
 * - plusieurs lignes candidates (libellés identiques, ou préfixe commun à plusieurs lignes sans
 *   qu'une seule porte exactement le libellé) : `libelle_ambigu`, jamais de choix au hasard ; si une
 *   seule ligne porte exactement le libellé, c'est elle qui est examinée ;
 * - quand aucune ligne ne porte le libellé, repli sur le code en jeton isolé, seulement si UNE
 *   SEULE ligne de la page porte ce code (sinon `libelle_ambigu`).
 * Une ligne source à trois montants ou plus (ou à colonnes collées ambiguës) ne permet pas de savoir
 * quelle colonne est l'exercice N : `montants_ambigus`.
 *
 * Aucune expression régulière sur le texte de la page : balayages linéaires bornés.
 */
import { reperer } from "./montants";
import { plier } from "./pages";

/** Longueur minimale d'un libellé du modèle tronqué (simple préfixe du libellé de la ligne). */
export const LIBELLE_PREFIXE_MIN = 12;
/** Part minimale du libellé de la ligne source que doit couvrir un libellé tronqué. */
export const COUVERTURE_PREFIXE_MIN = 0.8;
/** Nombre de montants à partir duquel les colonnes sont jugées ambiguës. */
export const MONTANTS_AMBIGUS = 3;

export type ResultatAncrage = "ancre" | "montants_ambigus" | "libelle_ambigu" | "absent";

interface Normalise {
  readonly norm: string;
  /** Pour chaque caractère de `norm`, position du caractère d'origine. */
  readonly index: number[];
}

function remplacerTypo(c: string): string {
  if ("‘’‚‛ʼ`´".includes(c)) return "'";
  if ("‐‑‒–—―−".includes(c)) return "-";
  return c;
}

function estBlanc(c: string): boolean {
  return c.trim().length === 0;
}

/** Forme comparable d'un texte (sans accents, minuscules, espaces réduits) avec les positions d'origine. */
function normaliser(texte: string): Normalise {
  let norm = "";
  const index: number[] = [];
  let blancEnCours = true;
  for (let i = 0; i < texte.length;) {
    const c = String.fromCodePoint(texte.codePointAt(i) as number);
    const debut = i;
    i += c.length;
    for (const d of c.normalize("NFKC")) {
      if (estBlanc(d)) {
        if (!blancEnCours) {
          norm += " ";
          index.push(debut);
          blancEnCours = true;
        }
        continue;
      }
      for (const e of plier(remplacerTypo(d))) {
        norm += e;
        index.push(debut);
        blancEnCours = false;
      }
    }
  }
  while (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    index.pop();
  }
  return { norm, index };
}

function estAlnum(c: string | undefined): boolean {
  if (c === undefined) return false;
  const k = c.charCodeAt(0);
  if (k < 128) return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122);
  return /^[\p{L}\p{N}]$/u.test(c);
}

/** Position du premier caractère alphanumérique à partir de `depuis` (longueur si aucun). */
function premierAlnum(norm: string, depuis: number): number {
  let i = depuis;
  while (i < norm.length && !estAlnum(norm[i])) i++;
  return i;
}

/** Retire la ponctuation et les espaces de bord d'une forme normalisée. */
function sansBords(norm: string): string {
  let d = 0;
  let f = norm.length;
  while (d < f && !estAlnum(norm[d])) d++;
  while (f > d && !estAlnum(norm[f - 1])) f--;
  return norm.slice(d, f);
}

/** Code de ligne d'allure usuelle : 1 à 6 caractères (majuscules, chiffres, puis « _ », « . », « - »). */
function ressembleACode(jeton: string): boolean {
  if (jeton.length === 0 || jeton.length > 6) return false;
  for (let i = 0; i < jeton.length; i++) {
    const c = jeton[i] as string;
    const majuscule = c >= "A" && c <= "Z";
    const chiffre = c >= "0" && c <= "9";
    if (!majuscule && !chiffre && !(i > 0 && (c === "_" || c === "." || c === "-"))) return false;
  }
  return true;
}

interface MontantsLigne {
  readonly premier: number | null;
  readonly ambigu: boolean;
  /** Texte normalisé entre la fin du libellé comparé et le premier montant ; vide = libellé complet. */
  readonly queue: string;
}

interface LignePage {
  readonly texte: string;
  readonly forme: Normalise;
  /** Position du premier caractère alphanumérique de `forme.norm`. */
  readonly debut: number;
  /** Position (dans `forme.norm`) du libellé après un code en tête d'allure usuelle, ou -1. */
  readonly apresCode: number;
  /** Montants lus après une position donnée (même position, même résultat). */
  readonly montants: Map<number, MontantsLigne>;
}

/** Nombre maximal de lignes sources examinées pour une même ligne du modèle (coût borné). */
const SOURCES_MAX = 200;

/** Page préparée pour l'ancrage (calcul unique par page). */
export interface PageAncrable {
  readonly lignes: readonly LignePage[];
}

function positionApresCode(texte: string, forme: Normalise): number {
  const t = texte.trim();
  let e = 0;
  while (e < t.length && !estBlanc(t[e] as string)) e++;
  const jeton = t.slice(0, e);
  if (e >= t.length || !ressembleACode(jeton)) return -1;
  const norm = normaliser(jeton).norm;
  if (!forme.norm.startsWith(norm) || forme.norm[norm.length] !== " ") return -1;
  return premierAlnum(forme.norm, norm.length);
}

export function preparerPageAncrable(texte: string): PageAncrable {
  return {
    lignes: texte
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        const forme = normaliser(l);
        return {
          texte: l,
          forme,
          debut: premierAlnum(forme.norm, 0),
          apresCode: positionApresCode(l, forme),
          montants: new Map(),
        };
      }),
  };
}

function estCaractereCode(c: string | undefined): boolean {
  return c !== undefined && /^[A-Za-z0-9_.-]$/.test(c);
}

/** Position de fin (dans la ligne d'origine) du code en jeton isolé, ou -1. */
function finDuCode(ligne: string, code: string): number {
  let depuis = 0;
  for (;;) {
    const i = ligne.indexOf(code, depuis);
    if (i === -1) return -1;
    const fin = i + code.length;
    if (!estCaractereCode(ligne[i - 1]) && !estCaractereCode(ligne[fin])) return fin;
    depuis = i + 1;
  }
}

function montantsApres(l: LignePage, fin: number, decimales: number): MontantsLigne {
  let m = l.montants.get(fin);
  if (m === undefined) {
    // Libellé du modèle coupé au milieu d'un mot (« Poste 1 » pour « Poste 12 ») : la suite du mot
    // fait partie du libellé de la ligne source, pas des montants.
    let saut = 0;
    if (estAlnum(l.texte[fin - 1])) while (estAlnum(l.texte[fin + saut])) saut++;
    const reste = l.texte.slice(fin + saut);
    const tous = reperer(reste, decimales).filter((j) => j.valeur !== null);
    let jetons = tous;
    // Colonne « note » (comme `extraireEtatParRegles`) : entier de 1 ou 2 chiffres sans séparateur
    // juste avant un autre montant.
    const premier = jetons[0];
    if (
      premier !== undefined &&
      jetons.length >= 2 &&
      premier.simple &&
      premier.groupes[0] !== undefined &&
      premier.groupes[0].length <= 2 &&
      reste[premier.debut] === premier.groupes[0][0]
    ) {
      jetons = jetons.slice(1);
    }
    m = {
      premier: jetons[0] === undefined ? null : Math.abs(jetons[0].valeur as number),
      ambigu: jetons.length >= MONTANTS_AMBIGUS || jetons.some((j) => j.ambigu),
      queue: sansBords(
        normaliser(l.texte.slice(fin, fin + saut + (tous[0]?.debut ?? reste.length))).norm,
      ),
    };
    l.montants.set(fin, m);
  }
  return m;
}

/** Fin (dans la ligne d'origine) du libellé du modèle en tête de la ligne source, ou -1. */
function finDuLibelle(l: LignePage, lib: string, codeNorm: string): number {
  const norm = l.forme.norm;
  let d = l.debut;
  if (!norm.startsWith(lib, d)) {
    const codeEnTete =
      codeNorm.length > 0 && norm.startsWith(codeNorm, d) && norm[d + codeNorm.length] === " ";
    d = codeEnTete ? premierAlnum(norm, d + codeNorm.length) : -1;
    if (d === -1 || !norm.startsWith(lib, d)) {
      d = l.apresCode;
      if (d === -1 || !norm.startsWith(lib, d)) return -1;
    }
  }
  return (l.forme.index[d + lib.length - 1] as number) + 1;
}

function comparer(m: MontantsLigne, cible: number): ResultatAncrage {
  if (m.ambigu) return "montants_ambigus";
  return m.premier === cible ? "ancre" : "absent";
}

/**
 * Vérifie que `montant` (valeur absolue) est le premier montant de la ligne de la page qui porte le
 * libellé complet (ou, à défaut de libellé retrouvé, le code) de la ligne proposée.
 */
export function ancrerMontant(
  page: PageAncrable,
  libelle: string,
  code: string,
  montant: number,
  decimales: number,
): ResultatAncrage {
  const cible = Math.abs(montant);
  const lib = sansBords(normaliser(libelle).norm);
  if (lib.length > 0) {
    const codeNorm = normaliser(code).norm;
    const trouvees: MontantsLigne[] = [];
    for (const l of page.lignes) {
      const fin = finDuLibelle(l, lib, codeNorm);
      if (fin === -1) continue;
      trouvees.push(montantsApres(l, fin, decimales));
      if (trouvees.length >= SOURCES_MAX) break;
    }
    if (trouvees.length > 0) {
      const exactes = trouvees.filter((m) => m.queue === "");
      if (exactes.length === 1) return comparer(exactes[0] as MontantsLigne, cible);
      if (trouvees.length > 1) return "libelle_ambigu";
      // Une seule ligne commence par ce préfixe : troncature admise sous conditions.
      const unique = trouvees[0] as MontantsLigne;
      const complet = lib.length + 1 + unique.queue.length;
      if (lib.length < LIBELLE_PREFIXE_MIN || lib.length < COUVERTURE_PREFIXE_MIN * complet) {
        return "absent";
      }
      return comparer(unique, cible);
    }
  }
  const portant: MontantsLigne[] = [];
  for (const l of page.lignes) {
    const fin = finDuCode(l.texte, code);
    if (fin === -1) continue;
    portant.push(montantsApres(l, fin, decimales));
    if (portant.length > 1) return "libelle_ambigu";
  }
  return portant.length === 1 ? comparer(portant[0] as MontantsLigne, cible) : "absent";
}
