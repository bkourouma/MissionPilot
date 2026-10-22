/**
 * Lecture de montants dans un TEXTE LIBRE (page de PDF, cellule de tableur) et vérification de
 * source des nombres (ADR-009, décisions 7 à 9) : un montant ou un nombre cité par l'IA n'est
 * retenu que s'il se retrouve, lu exactement, dans le texte de la page citée.
 *
 * Lecture d'un jeton numérique (balayage linéaire, aucune expression régulière sur le texte) :
 * - séparateur de milliers : UN espace (insécable, fine, apostrophe) ou un point/une virgule suivi
 *   d'EXACTEMENT trois chiffres ; deux espaces ou plus séparent deux montants (colonnes) ;
 * - séparateur décimal : « , » ou « . » suivi d'un autre nombre de chiffres, ou de trois chiffres
 *   quand `decimales` vaut 3 ou plus. « 1.500 » vaut donc 1500 en FCFA ou en EUR ;
 * - négatif : « -300 » (signe collé au nombre, précédé d'un blanc, du début ou d'une parenthèse)
 *   ou « (12 000) » (présentation comptable) ; un tiret collé à un mot (« N-1 ») n'est pas un signe ;
 * - des colonnes collées par des espaces simples (« 1 050 000 800 000 ») sont lues comme plusieurs
 *   montants quand le découpage est sans équivoque (voir `bornesColonnes`) ; les autres cas ambigus
 *   (« 1 200 300 400 ») restent un seul nombre marqué `ambigu` ;
 * - un jeton collé à une lettre à gauche (« TA1 », « L2_5 ») fait partie d'un identifiant : ignoré ;
 * - un jeton illisible (trop précis, hors limites, mélange de séparateurs) est ignoré : jamais
 *   d'exception pour un contenu non fiable. Hypothèses : un nombre de 11 chiffres ou plus qui ressemble à des
 *   colonnes collées est lu comme plusieurs montants ; deux montants de trois chiffres ou moins
 *   séparés par un seul espace (« 800 700 ») sont lus comme UN nombre (le contrôle d'équilibre en
 *   signalera l'écart).
 *
 * Fonctions pures et déterministes ; temps linéaire dans la taille du texte.
 */
import { ErreurDossier } from "../dossier/erreurs";
import { lireMontantTexte } from "../dossier/montants";

/** Nombre maximal de groupes de chiffres d'un jeton (borne les boucles et la taille des jetons). */
const GROUPES_MAX = 12;
/** Longueur maximale d'un nombre comparé (au-delà, ce n'est plus un nombre d'un document). */
const CHIFFRES_MAX = 64;

const BLANCS_MILLIERS = new Set([" ", " ", " ", " ", "'", "’"]);
const SUFFIXES_MONNAIE = new Set([
  "",
  "€",
  "$",
  "f",
  "cfa",
  "fcfa",
  "f cfa",
  "eur",
  "euro",
  "euros",
  "usd",
  "xof",
  "xaf",
]);

/** Un nombre repéré dans un texte (positions en unités UTF-16, `fin` exclue). */
export interface JetonMontant {
  /** Début, signe ou parenthèse ouvrante inclus. */
  readonly debut: number;
  /** Fin, parenthèse fermante incluse. */
  readonly fin: number;
  /** Valeur en unités mineures, `null` si le jeton est illisible. */
  readonly valeur: number | null;
  /** Groupes de chiffres successifs (séparateurs retirés). */
  readonly groupes: readonly string[];
  /** Vrai si le jeton est une suite de chiffres sans séparateur. */
  readonly simple: boolean;
  /**
   * Vrai si le jeton a pu être plusieurs colonnes collées (« 1 200 300 400 ») : quatre groupes
   * ou plus, dont un groupe intérieur ne commence pas par zéro.
   */
  readonly ambigu: boolean;
}

function chiffreEn(texte: string, i: number): boolean {
  const c = texte.charCodeAt(i);
  return c >= 48 && c <= 57;
}

function estBlanc(c: string | undefined): boolean {
  return c !== undefined && /\s/u.test(c);
}

function estLettre(c: string | undefined): boolean {
  return c !== undefined && (c === "_" || /\p{L}/u.test(c));
}

/** Point de coupe possible entre deux colonnes : un groupe intérieur qui ne commence pas par 0. */
function coupesPossibles(groupes: readonly string[]): number[] {
  const coupes: number[] = [];
  for (let i = 2; i <= groupes.length - 2; i++) {
    if (!(groupes[i] as string).startsWith("0")) coupes.push(i);
  }
  return coupes;
}

/** Valeurs absolues qu'un jeton ambigu pourrait désigner si ses colonnes étaient collées. */
function valeursAlternatives(j: JetonMontant, decimales: number): number[] {
  const g = j.groupes;
  const debuts = [0, ...coupesPossibles(g)];
  const fins = [...coupesPossibles(g), g.length];
  const valeurs: number[] = [];
  for (const a of debuts) {
    for (const b of fins) {
      if (b - a < 2 || (a === 0 && b === g.length)) continue;
      try {
        valeurs.push(lireMontantTexte(g.slice(a, b).join(""), decimales));
      } catch {
        // hors limites : pas une valeur possible
      }
    }
  }
  return valeurs;
}

/**
 * Bornes des colonnes collées par des espaces simples (« 1 050 000 800 000 » → 0, 3, 5), ou null :
 * au moins 4 groupes, 11 chiffres ou plus (un seul nombre aussi grand est improbable), des coupes
 * non adjacentes qui laissent au moins deux groupes à chaque part, et des parts dont le nombre de
 * chiffres diffère d'au plus un. Sinon le jeton reste un seul nombre, marqué `ambigu` s'il aurait
 * pu être découpé.
 */
function bornesColonnes(groupes: readonly string[]): number[] | null {
  const coupes = coupesPossibles(groupes);
  if (groupes.length < 4 || coupes.length === 0) return null;
  for (let j = 1; j < coupes.length; j++) {
    if ((coupes[j] as number) - (coupes[j - 1] as number) < 2) return null;
  }
  const bornes = [0, ...coupes, groupes.length];
  const longueurs = bornes
    .slice(1)
    .map((fin, i) => groupes.slice(bornes[i], fin).reduce((t, g) => t + g.length, 0));
  const total = longueurs.reduce((t, l) => t + l, 0);
  if (total < 11 || Math.max(...longueurs) - Math.min(...longueurs) > 1) return null;
  return bornes;
}

function groupesCorrects(groupes: readonly string[]): boolean {
  return (groupes[0] ?? "").length <= 3 && groupes.slice(1).every((g) => g.length === 3);
}

/** Forme canonique « 1234 » ou « 1234.56 » d'un jeton, ou null s'il est ambigu. */
function canonique(
  groupes: readonly string[],
  seps: readonly string[],
  decimales: number,
): string | null {
  const points: number[] = [];
  seps.forEach((s, i) => {
    if (s === "." || s === ",") points.push(i);
  });
  if (points.length === 0) return groupes.join("");
  const dernier = points[points.length - 1] as number;
  const apres = groupes[dernier + 1] as string;
  if (points.length === 1) {
    const avant = groupes.slice(0, dernier + 1);
    const milliers =
      apres.length === 3 && groupesCorrects(avant) && decimales < 3 && !avant[0]?.startsWith("0");
    return milliers ? groupes.join("") : `${avant.join("")}.${apres}`;
  }
  const car = seps[dernier];
  const autres = points.slice(0, -1).map((i) => seps[i]);
  if (autres.some((c) => c !== autres[0])) return null;
  if (autres[0] === car) return apres.length === 3 ? groupes.join("") : null;
  return `${groupes.slice(0, dernier + 1).join("")}.${apres}`;
}

function verifierDecimales(decimales: number): void {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 4) {
    throw new ErreurDossier("OPTIONS_INVALIDES", "Nombre de décimales entre 0 et 4 attendu.");
  }
}

/**
 * Tous les nombres d'un texte, avec leur position. `lettres` autorise un nombre collé à une lettre
 * à gauche (vérification de source : « ISO9001 »).
 */
export function reperer(
  texte: string,
  decimales: number,
  options: { readonly lettres?: boolean } = {},
): JetonMontant[] {
  verifierDecimales(decimales);
  const jetons: JetonMontant[] = [];
  const n = texte.length;
  let i = 0;
  while (i < n) {
    if (!chiffreEn(texte, i)) {
      i++;
      continue;
    }
    const debutChiffres = i;
    let j = i;
    while (j < n && chiffreEn(texte, j)) j++;
    const groupes = [texte.slice(i, j)];
    const debuts = [i];
    const fins = [j];
    const seps: string[] = [];
    let k = j;
    let point = false;
    let decimal = false;
    while (groupes.length < GROUPES_MAX) {
      const c = texte[k];
      if (c === undefined) break;
      const blanc = BLANCS_MILLIERS.has(c);
      const ponct = c === "." || c === ",";
      if (!blanc && !ponct) break;
      let m = k + 1;
      while (m < n && chiffreEn(texte, m)) m++;
      const longueur = m - (k + 1);
      if (longueur === 0 || decimal) break;
      const ok = groupesCorrects(groupes);
      if (blanc) {
        if (longueur !== 3 || !ok || point) break;
      } else if (longueur === 3 && ok) {
        point = true;
      } else {
        decimal = true;
      }
      groupes.push(texte.slice(k + 1, m));
      debuts.push(k + 1);
      fins.push(m);
      seps.push(c);
      k = m;
    }
    const avant = debutChiffres > 0 ? texte[debutChiffres - 1] : undefined;
    const avantAvant = debutChiffres > 1 ? texte[debutChiffres - 2] : undefined;
    let debut = debutChiffres;
    let fin = k;
    let negatif = false;
    if (avant === "(" && texte[k] === ")") {
      negatif = true;
      debut--;
      fin++;
    } else if (
      (avant === "-" || avant === "−") &&
      (avantAvant === undefined || estBlanc(avantAvant) || avantAvant === "(")
    ) {
      negatif = true;
      debut--;
    }
    i = k;
    if (!options.lettres && estLettre(avant)) continue;
    const bornes =
      !negatif && seps.every((c) => c !== "." && c !== "," && estBlanc(c))
        ? bornesColonnes(groupes)
        : null;
    if (bornes !== null) {
      for (let p = 0; p + 1 < bornes.length; p++) {
        const de = bornes[p] as number;
        const a = bornes[p + 1] as number;
        const part = groupes.slice(de, a);
        let v: number | null = null;
        try {
          v = lireMontantTexte(part.join(""), decimales);
        } catch {
          v = null;
        }
        jetons.push({
          debut: debuts[de] as number,
          fin: fins[a - 1] as number,
          valeur: v,
          groupes: part,
          simple: false,
          ambigu: false,
        });
      }
      continue;
    }
    const forme = canonique(groupes, seps, decimales);
    let valeur: number | null = null;
    if (forme !== null) {
      try {
        valeur = lireMontantTexte(negatif ? `-${forme}` : forme, decimales);
      } catch {
        valeur = null;
      }
    }
    const ambigu =
      !seps.includes(".") && !seps.includes(",") && coupesPossibles(groupes).length > 0;
    jetons.push({ debut, fin, valeur, groupes, simple: seps.length === 0, ambigu });
  }
  return jetons;
}

/** Vrai si `reste` ne contient qu'une monnaie, un appel de note (« (a) », « * ») ou rien. */
export function resteAcceptable(reste: string): boolean {
  const t = reste.trim();
  if (t.length > 12) return false;
  if (SUFFIXES_MONNAIE.has(t.toLowerCase())) return true;
  if (t.length > 0 && [...t].every((c) => c === "*")) return true;
  return t.length >= 3 && t.length <= 4 && t.startsWith("(") && t.endsWith(")");
}

/** Tous les montants lisibles d'un texte (unités mineures, signés), dans l'ordre du texte. */
export function lireMontantsDansTexte(texte: string, decimales: number): number[] {
  const montants: number[] = [];
  for (const j of reperer(texte, decimales)) if (j.valeur !== null) montants.push(j.valeur);
  return montants;
}

/**
 * Montant d'un texte qui ne contient QUE ce montant (cellule, champ d'une ligne du modèle),
 * éventuellement suivi d'une monnaie ; null sinon.
 */
export function lireMontantIsole(texte: string, decimales: number): number | null {
  const t = texte.trim();
  if (t.length === 0 || t.length > 60) return null;
  const jetons = reperer(t, decimales);
  const j = jetons[0];
  if (jetons.length !== 1 || !j || j.debut !== 0 || !resteAcceptable(t.slice(j.fin))) return null;
  return j.valeur;
}

/**
 * Vrai si un montant du texte a la même valeur ABSOLUE que `montant` : une présentation comptable
 * met un montant négatif entre parenthèses ou le donne sans signe. Des colonnes collées par des
 * espaces simples (« 350 000 300 000 ») comptent pour chacune de leurs valeurs possibles.
 */
export function montantPresentDansTexte(
  montant: number,
  texte: string,
  decimales: number,
): boolean {
  return valeursAbsoluesDuTexte(texte, decimales).has(Math.abs(montant));
}

/**
 * Valeurs absolues de tous les montants d'un texte (colonnes ambiguës comprises) : à calculer une
 * fois par page quand plusieurs montants doivent y être vérifiés.
 */
export function valeursAbsoluesDuTexte(texte: string, decimales: number): Set<number> {
  const valeurs = new Set<number>();
  for (const j of reperer(texte, decimales)) {
    if (j.valeur !== null) valeurs.add(Math.abs(j.valeur));
    if (j.ambigu) for (const v of valeursAlternatives(j, decimales)) valeurs.add(v);
  }
  return valeurs;
}

/**
 * Nombres de `texteAVerifier` absents de `texteSource`, en chiffres seuls (séparateurs retirés),
 * sans doublon, dans l'ordre d'apparition. Les nombres de moins de 3 chiffres (numérotations) sont
 * ignorés. Une année (1900-2100) n'a pas de traitement à part : elle est ignorée parce qu'elle
 * figure dans la source, et signalée sinon. Les colonnes collées de la source (« 500 000 120 000 »)
 * comptent aussi pour chacun de leurs sous-nombres.
 */
export function nombresNonRetrouves(texteAVerifier: string, texteSource: string): string[] {
  const source = new Set<string>();
  for (const j of reperer(texteSource, 0, { lettres: true })) {
    const g = j.groupes;
    for (let a = 0; a < g.length; a++) {
      let acc = "";
      for (let b = a; b < g.length; b++) {
        acc += g[b];
        if (acc.length > CHIFFRES_MAX) break;
        source.add(acc);
      }
    }
  }
  const manquants: string[] = [];
  const vus = new Set<string>();
  for (const j of reperer(texteAVerifier, 0, { lettres: true })) {
    const chiffres = j.groupes.join("");
    if (chiffres.length < 3 || vus.has(chiffres)) continue;
    vus.add(chiffres);
    if (!source.has(chiffres)) manquants.push(chiffres);
  }
  return manquants;
}
