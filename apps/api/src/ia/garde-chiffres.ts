import { jetonsDans, sansJetons, type Masque } from "./masquage.js";

/*
 * GARDE-CHIFFRES (AGENTS.md, PRD : « les chiffres ne viennent jamais du
 * modèle de langage »).
 *
 * Le contexte fourni au modèle contient les nombres CALCULÉS par les moteurs
 * (liste blanche, construite par le code des services : jamais reçue d'une
 * requête HTTP). Après génération, tout nombre de la sortie absent de cette
 * liste marque la génération `chiffres_non_verifies` : la validation exige
 * alors un acquittement explicite d'un humain (`acquitte_chiffres`). Dans le
 * doute, la garde SIGNALE : un faux positif coûte un acquittement, un faux
 * négatif laisserait passer un chiffre inventé.
 *
 * Préparation : forme NFKC (chiffres pleine chasse, espaces insécables…),
 * puis tout chiffre décimal Unicode (\p{Nd} : arabe « ٣ », devanagari…)
 * ramené en ASCII. Lecture des nombres (écriture française et anglaise) :
 * « 1 500 000 », « 1.500.000 », « 1,500,000 », « 12,5 % », « 3 j »,
 * « 1,5 million », « 850. millions », « 2 Md », « USD350000 », signe écrit
 * (« -350 000 », « −42 % », « +5 % »). Un nombre de la sortie correspond à
 * une valeur de la liste blanche :
 * - à la précision affichée près ET à 5 % au plus en relatif (« 1,5 million »
 *   pour 1 523 400 ; « 12,5 % » pour 12,47 ; mais « 2 milliards » ne couvre
 *   pas 1,6 milliard) ;
 * - un pourcentage peut citer une fraction de la liste (12,5 % pour 0,125) ;
 * - signe : écrit, il doit être celui de la valeur (« -5 % » pour −0,05) ;
 *   absent, il est libre (« baisse de 5 % » pour −0,05) ;
 * - fourchette « 10-15 % » : les deux bornes sont lues, avec l'unité de la
 *   seconde.
 *
 * Nombres TRIVIAUX ignorés :
 * - numérotation de liste en début de ligne (« 1. », « 2) ») et numéro après
 *   « étape », « phase », « axe », « partie », « section », « chapitre »,
 *   « annexe », « tableau », « figure », « n° » : seulement une suite
 *   RÉELLEMENT consécutive depuis 1 (« Phase 1 », « Phase 2 » ; « Phase 45 »
 *   seul est lu), 50 au plus ;
 * - années (1900 à 2100) et dates complètes (« 06/10/2026 »,
 *   « 2026-10-06 ») PRÉSENTES DANS LES ENTRÉES ; une date absente des
 *   entrées est signalée telle quelle ;
 * - jetons de masquage CONNUS du masque de la demande ; un jeton inconnu
 *   (« [TERME_99999] » forgé) est signalé ;
 * - identifiants courts collés à des lettres (au plus deux chiffres : « T1 »,
 *   « 1er », « COVID-19 », « 4G ») ; une suite d'au moins trois chiffres
 *   collée à des lettres (« ISO9001 », « x350000 », « env.4500 ») est lue.
 *
 * Limite : la garde repère des nombres écrits en chiffres ; un nombre écrit
 * en lettres (« douze ») ou en chiffres romains n'est pas détecté.
 */

export interface NombreLu {
  brut: string;
  /** Valeur lue, multiplicateur et signe appliqués (« -1,5 million » → −1 500 000). */
  valeur: number;
  /** Demi-unité de la précision affichée, multiplicateur appliqué. */
  tolerance: number;
  pourcentage: boolean;
  /** Signe écrit, sinon null (libre). */
  signe: "-" | "+" | null;
}

/** Écart relatif maximal admis pour un arrondi d'affichage. */
export const ARRONDI_RELATIF_MAX = 0.05;
/** Numéro de section, d'étape… exempté au plus (suite consécutive depuis 1). */
const NUMERO_MAX = 50;

const UNITES =
  "%|pts?|points?|jours?|j|heures?|h|[Mm]illions?|MILLIONS?|[Mm]illiards?|MILLIARDS?|" +
  "[Mm]ds?|MDS?|M|[kK]|F\\s?CFA|CFA|XOF|XAF|EUR|USD|€|\\$";
/** Multiplicateurs admis après un point ou une virgule (« 850. millions »). */
const MULTIPLICATEURS_APRES_POINT =
  "[Mm]illions?|MILLIONS?|[Mm]illiards?|MILLIARDS?|[Mm]ds?|MDS?|[kK]";
const DEVISES_PREFIXE = "USD|EUR|XOF|XAF|F\\s?CFA|CFA|€|\\$";

const NOMBRE = new RegExp(
  "(?<![\\p{L}\\p{N}_])" +
    `(?:(${DEVISES_PREFIXE})\\s?)?` +
    "([-−+])?" +
    "(\\d{1,3}(?: \\d{3})+(?!\\d)|\\d{1,3}(?:\\.\\d{3}){2,}(?!\\d)|\\d{1,3}(?:,\\d{3}){2,}(?!\\d)|\\d+)" +
    "(?:[,.](\\d+))?" +
    `(?:(?:\\s?(${UNITES})|[.,]?\\s?(${MULTIPLICATEURS_APRES_POINT}))(?![\\p{L}\\p{N}]))?`,
  "gu",
);
/** Suite d'au moins trois chiffres collée à des lettres (« ISO9001 », « x350000 »). */
const COLLE_LETTRES = /(?<=[\p{L}_])\d{3,}/gu;

const LISTE_NUMEROTEE = /^([ \t]*)(\d{1,3})[.)](?=\s)/gm;
const NUMERO_CONTEXTE =
  /(?<![\p{L}])(étape|etape|phase|axe|partie|section|chapitre|annexe|tableau|figure|n°|no\.)\s*(\d{1,2})(?![\p{N}])/giu;
const DATES = /(?<![\p{N}])(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})(?![\p{N}])/gu;
const ANNEES = /(?<![\p{N}])(19\d{2}|20\d{2}|2100)(?![\p{N}])/gu;

/* ----- Normalisation ----- */

const cacheChiffres = new Map<string, string>();
const EST_CHIFFRE = /^\p{Nd}$/u;

/**
 * Valeur ASCII d'un chiffre décimal Unicode : ces chiffres sont encodés par
 * suites de dix (0 à 9) ; on compte les chiffres qui le précèdent dans sa suite.
 */
function chiffreAscii(c: string): string {
  if (c >= "0" && c <= "9") return c;
  const connu = cacheChiffres.get(c);
  if (connu) return connu;
  const cp = c.codePointAt(0) as number;
  let k = 0;
  while (cp - k - 1 > 0x39 && EST_CHIFFRE.test(String.fromCodePoint(cp - k - 1))) k++;
  const valeur = String(k % 10);
  cacheChiffres.set(c, valeur);
  return valeur;
}

/** Forme NFKC, chiffres en ASCII. */
export function normaliserChiffres(texte: string): string {
  return texte.normalize("NFKC").replace(/\p{Nd}/gu, chiffreAscii);
}

/* ----- Contexte des entrées ----- */

export interface ContexteGarde {
  /** Années (1900 à 2100) citées dans les entrées. */
  annees: ReadonlySet<number>;
  /** Dates complètes citées dans les entrées (forme canonique, voir `cleDate`). */
  dates: ReadonlySet<string>;
}

/** Forme canonique d'une date (« 06/10/2026 », « 6.10.26 », « 2026-10-06 » → « 2026-10-06 »). */
export function cleDate(date: string): string {
  const p = date.split(/[/.-]/).map((x) => x.trim());
  if (p.length !== 3) return date;
  const [a, b, c] = p as [string, string, string];
  const [annee, mois, jour] = a.length === 4 ? [a, b, c] : [c.length === 2 ? `20${c}` : c, b, a];
  return `${annee}-${mois.padStart(2, "0")}-${jour.padStart(2, "0")}`;
}

/** Années (1900 à 2100) citées dans des textes d'entrée : triviales en sortie. */
export function anneesDe(textes: Iterable<string>): Set<number> {
  const annees = new Set<number>();
  for (const t of textes) {
    for (const m of normaliserChiffres(t).matchAll(ANNEES)) annees.add(Number(m[1]));
  }
  return annees;
}

/** Années et dates des entrées (variables, libellés et valeurs des chiffres fournis). */
export function contexteGarde(textes: Iterable<string>): ContexteGarde {
  const liste = [...textes];
  const dates = new Set<string>();
  for (const t of liste) {
    for (const m of normaliserChiffres(t).matchAll(DATES)) dates.add(cleDate(m[0]));
  }
  return { annees: anneesDe(liste), dates };
}

/* ----- Lecture ----- */

const MULTIPLICATEURS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  million: 1e6,
  millions: 1e6,
  md: 1e9,
  mds: 1e9,
  milliard: 1e9,
  milliards: 1e9,
};

function multiplicateurDe(unite: string): number {
  // « M » seul (majuscule) : million ; « m » minuscule n'est pas une unité lue.
  if (unite === "M") return 1e6;
  return MULTIPLICATEURS[unite.toLowerCase()] ?? 1;
}

interface Lecture extends NombreLu {
  debut: number;
  fin: number;
  /** Unité écrite (ou reprise de la borne suivante d'une fourchette). */
  unite: string;
  multiplicateur: number;
  decimales: string;
  entier: string;
  prefixe: boolean;
}

/** Valeur absolue écrite. « 1.500 » : un point suivi de 3 chiffres sans autre groupe reste une décimale (1,5). */
function valeurAbsolue(entier: string, decimales: string): number {
  const chiffres = entier.replace(/[ .,]/g, "");
  return Number(decimales ? `${chiffres}.${decimales}` : chiffres);
}

function lire(m: RegExpMatchArray): Lecture | null {
  const entier = m[3] ?? "";
  const decimales = m[4] ?? "";
  if (!Number.isFinite(valeurAbsolue(entier, decimales))) return null;
  const lecture: Lecture = {
    brut: m[0],
    valeur: 0,
    tolerance: 0,
    pourcentage: false,
    signe: m[2] === undefined ? null : m[2] === "+" ? "+" : "-",
    debut: m.index as number,
    fin: (m.index as number) + m[0].length,
    unite: "",
    multiplicateur: 1,
    decimales,
    entier,
    prefixe: m[1] !== undefined,
  };
  appliquerUnite(lecture, m[5] ?? m[6] ?? "");
  return lecture;
}

function appliquerUnite(l: Lecture, unite: string): void {
  const multiplicateur = multiplicateurDe(unite);
  const absolue = valeurAbsolue(l.entier, l.decimales);
  l.unite = unite;
  l.multiplicateur = multiplicateur;
  l.valeur = (l.signe === "-" ? -1 : 1) * absolue * multiplicateur;
  l.tolerance = l.decimales
    ? 0.5 * 10 ** -l.decimales.length * multiplicateur
    : 0.5 * (multiplicateur > 1 ? multiplicateur : 0);
  l.pourcentage = unite === "%" || unite.startsWith("pt") || unite.startsWith("point");
}

/** Identifiant court collé à des lettres (« 1er », « COVID-19 ») : au plus deux chiffres, nu. */
function identifiantCourt(texte: string, l: Lecture): boolean {
  if (l.signe || l.prefixe || l.decimales || l.unite || l.entier.length > 2) return false;
  const apres = texte.slice(l.fin, l.fin + 1);
  const avant = texte.slice(Math.max(0, l.debut - 2), l.debut);
  return /^\p{L}$/u.test(apres) || /^\p{L}-$/u.test(avant);
}

/** Lectures d'un texte DÉJÀ normalisé, fourchettes résolues. */
function lectures(texte: string): Lecture[] {
  const lus: Lecture[] = [];
  for (const m of texte.matchAll(NOMBRE)) {
    const l = lire(m);
    if (!l || identifiantCourt(texte, l)) continue;
    lus.push(l);
  }
  // Fourchette « 10-15 % », « 10 à 15 % » : la première borne prend l'unité de la seconde.
  for (let i = 1; i < lus.length; i++) {
    const p = lus[i - 1] as Lecture;
    const s = lus[i] as Lecture;
    if (p.unite || !s.unite || s.signe) continue;
    if (/^\s*(?:[-–]|à|a)\s*$/u.test(texte.slice(p.fin, s.debut))) appliquerUnite(p, s.unite);
  }
  // Suites de chiffres collées à des lettres, hors des nombres déjà lus.
  let reste = texte;
  for (const l of lus)
    reste = reste.slice(0, l.debut) + " ".repeat(l.fin - l.debut) + reste.slice(l.fin);
  for (const m of reste.matchAll(COLLE_LETTRES)) {
    lus.push({
      brut: m[0],
      valeur: Number(m[0]),
      tolerance: 0,
      pourcentage: false,
      signe: null,
      debut: m.index as number,
      fin: (m.index as number) + m[0].length,
      unite: "",
      multiplicateur: 1,
      decimales: "",
      entier: m[0],
      prefixe: false,
    });
  }
  return lus.sort((a, b) => a.debut - b.debut);
}

/** Nombres écrits en chiffres d'un texte. */
export function extraireNombres(texte: string): NombreLu[] {
  return lectures(normaliserChiffres(texte)).map(
    ({ brut, valeur, tolerance, pourcentage, signe }) => ({
      brut,
      valeur,
      tolerance,
      pourcentage,
      signe,
    }),
  );
}

/* ----- Vérification ----- */

function ajouter(liste: string[], valeur: string): void {
  const v = valeur.trim();
  if (v && !liste.includes(v)) liste.push(v);
}

const cleMot = (mot: string) => {
  const m = mot.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return m === "no." ? "n°" : m;
};

/**
 * Texte normalisé sans ses nombres triviaux (remplacés par des espaces) ; les
 * jetons inconnus et les dates absentes des entrées vont dans `suspects`.
 */
function sansTrivialites(
  sortie: string,
  contexte: ContexteGarde,
  masque: Pick<Masque, "connait"> | undefined,
  suspects: string[],
): string {
  let t = sansJetons(normaliserChiffres(sortie), masque);
  for (const jeton of new Set(jetonsDans(t))) {
    ajouter(suspects, jeton);
    t = t.split(jeton).join(" ");
  }
  t = t.replace(DATES, (d) => {
    if (!contexte.dates.has(cleDate(d))) ajouter(suspects, d);
    return " ";
  });
  let maxListe = 0;
  t = t.replace(LISTE_NUMEROTEE, (tout: string, retrait: string, n: string) => {
    const v = Number(n);
    if (v < 1 || v > Math.min(maxListe + 1, NUMERO_MAX)) return tout;
    maxListe = Math.max(maxListe, v);
    return retrait;
  });
  const maxParMot = new Map<string, number>();
  t = t.replace(NUMERO_CONTEXTE, (tout: string, mot: string, n: string) => {
    const cle = cleMot(mot);
    const max = maxParMot.get(cle) ?? 0;
    const v = Number(n);
    if (v < 1 || v > Math.min(max + 1, NUMERO_MAX)) return tout;
    maxParMot.set(cle, Math.max(max, v));
    return `${mot} `;
  });
  return t;
}

function correspond(n: NombreLu, w: number): boolean {
  if (n.signe === "-" && !(w < 0)) return false;
  if (n.signe === "+" && w < 0) return false;
  const v = Math.abs(n.valeur);
  const cibles = [Math.abs(w)];
  if (n.pourcentage) cibles.push(Math.abs(w * 100));
  return cibles.some((c) => {
    const ecart = Math.abs(v - c);
    const epsilon = 1e-9 * Math.max(1, c);
    if (ecart > n.tolerance + epsilon) return false;
    // Arrondi d'affichage : au plus 5 % d'écart relatif (« 2 milliards » ≠ 1,6 milliard).
    return ecart <= epsilon || ecart <= ARRONDI_RELATIF_MAX * c;
  });
}

export interface ResultatGarde {
  chiffresNonVerifies: boolean;
  /** Nombres de la sortie absents de la liste blanche (tels qu'écrits, normalisés, 50 au plus). */
  nombresNonVerifies: string[];
}

/**
 * Vérifie que chaque nombre de `sortie` vient de `listeBlanche` (ou est
 * trivial). `contexte` : années et dates des entrées (`contexteGarde`) ;
 * `masque` : masque de la demande (seuls ses jetons sont ignorés).
 */
export function verifierChiffres(
  sortie: string,
  listeBlanche: readonly number[],
  contexte: Partial<ContexteGarde> = {},
  masque?: Pick<Masque, "connait">,
): ResultatGarde {
  const ctx: ContexteGarde = {
    annees: contexte.annees ?? new Set(),
    dates: contexte.dates ?? new Set(),
  };
  const suspects: string[] = [];
  for (const n of lectures(sansTrivialites(sortie, ctx, masque, suspects))) {
    const annee =
      !n.pourcentage &&
      n.signe === null &&
      n.tolerance === 0 &&
      Number.isInteger(n.valeur) &&
      ctx.annees.has(n.valeur);
    if (annee || listeBlanche.some((w) => correspond(n, w))) continue;
    ajouter(suspects, n.brut);
  }
  return { chiffresNonVerifies: suspects.length > 0, nombresNonVerifies: suspects.slice(0, 50) };
}

const EST_JETON = /^\[[A-Z]+_\d{1,5}\]$/;
const EST_DATE = new RegExp(`^${DATES.source}$`, "u");

/**
 * Après une modification humaine : les nombres signalés dans la version
 * précédente qui figurent ENCORE dans le nouveau texte. Un nombre ajouté par
 * un humain relève de sa responsabilité d'expert (« l'expert dispose ») ;
 * seul un nombre venu du modèle reste à acquitter.
 */
export function suspectsRestants(texte: string, suspects: readonly string[]): string[] {
  if (suspects.length === 0) return [];
  const normalise = normaliserChiffres(texte);
  const presents = lectures(normalise);
  return suspects.filter((s) => {
    if (EST_JETON.test(s) || EST_DATE.test(s)) return normalise.includes(s);
    const lu = lectures(normaliserChiffres(s))[0];
    return presents.some(
      (n) =>
        n.brut.trim() === s ||
        (lu !== undefined && n.signe === lu.signe && Math.abs(n.valeur - lu.valeur) < 1e-9),
    );
  });
}
