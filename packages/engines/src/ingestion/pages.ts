/**
 * Préparation du texte des pages : normalisation, plafonds, assemblage borné pour le modèle
 * (ADR-009, décisions 5 et 6).
 *
 * Le texte d'un document est NON FIABLE : `preparerTexteModele` neutralise toute séquence « [[ »
 * (donc « [[PAGE ») du texte source pour qu'une page ne puisse pas imiter le marqueur « [[PAGE n]] »
 * posé par le moteur. Aucune expression régulière sur le texte complet (boucles bornées).
 */
import type { PageTexte } from "./types";

function estControle(code: number): boolean {
  return (code >= 0 && code <= 31) || (code >= 127 && code <= 159);
}

/**
 * Caractère de format Unicode (`\p{Cf}` : espace de largeur nulle, trait d'union conditionnel,
 * BOM…), retiré AVANT la neutralisation de « [[ » : « [\u200b[PAGE 9]] » ne doit pas redevenir un
 * marqueur de page une fois le caractère invisible retiré en aval.
 */
function estFormat(c: string): boolean {
  return /^\p{Cf}$/u.test(c);
}

/**
 * Texte de page normalisé : NFKC, NUL, caractères de contrôle et de format (`\p{Cf}`) retirés (sauf
 * le saut de ligne ; « \r » est retiré, « \t » devient une espace), espaces de fin de ligne retirées, plusieurs lignes
 * vides remplacées par une seule. Idempotent.
 */
export function normaliserTextePage(texte: string): string {
  let propre = "";
  for (const c of texte.normalize("NFKC")) {
    const code = c.codePointAt(0) as number;
    if (c === "\n") propre += c;
    else if (c === "\t") propre += " ";
    else if (!estControle(code) && !estFormat(c)) propre += c;
  }
  const lignes: string[] = [];
  let videPrecedente = false;
  for (const brute of propre.split("\n")) {
    const ligne = brute.trimEnd();
    const vide = ligne.length === 0;
    if (vide && videPrecedente) continue;
    lignes.push(ligne);
    videPrecedente = vide;
  }
  return lignes.join("\n");
}

/** Minuscules sans accents, pour comparer des mots-clés. */
export function plier(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Remplace chaque « [ » suivi d'un « [ » par « [ » + espace : plus aucun « [[ » ne subsiste. */
function neutraliserMarqueurs(texte: string): string {
  let sortie = "";
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i] as string;
    sortie += c === "[" && texte[i + 1] === "[" ? "[ " : c;
  }
  return sortie;
}

export interface OptionsTexteModele {
  /** Nombre maximal de caractères du texte assemblé. */
  readonly max: number;
  /** Pages qui contiennent un de ces mots (casse et accents ignorés) : transmises d'abord. */
  readonly motsCles?: readonly string[];
}

export interface TexteModele {
  readonly texte: string;
  /** Vrai si du texte a été laissé de côté (page coupée ou pages omises). */
  readonly tronque: boolean;
  /** Numéros des pages présentes dans `texte`, dans l'ordre d'assemblage. */
  readonly pages: number[];
}

/**
 * Assemble « [[PAGE n]]\n<texte>\n » pour chaque page non vide : les pages contenant un mot-clé
 * d'abord, puis l'ordre des pages. Une page qui dépasse la limite est coupée à la limite
 * (`tronque` vrai) et l'assemblage s'arrête. Une page vide est omise sans être signalée.
 */
export function preparerTexteModele(
  pages: readonly PageTexte[],
  options: OptionsTexteModele,
): TexteModele {
  const mots = (options.motsCles ?? []).map(plier).filter((m) => m.length > 0);
  const utiles = pages
    .map((p) => ({ numero: p.numero, texte: neutraliserMarqueurs(normaliserTextePage(p.texte)) }))
    .filter((p) => p.texte.trim().length > 0);
  const prioritaires: typeof utiles = [];
  const autres: typeof utiles = [];
  for (const p of utiles) {
    const pliee = mots.length > 0 ? plier(p.texte) : "";
    (mots.some((m) => pliee.includes(m)) ? prioritaires : autres).push(p);
  }
  let texte = "";
  let tronque = false;
  const incluses: number[] = [];
  const ordre = [...prioritaires, ...autres];
  for (let i = 0; i < ordre.length; i++) {
    const p = ordre[i] as (typeof ordre)[number];
    const bloc = `[[PAGE ${p.numero}]]\n${p.texte}\n`;
    const place = options.max - texte.length;
    if (bloc.length <= place) {
      texte += bloc;
      incluses.push(p.numero);
      continue;
    }
    const entete = `[[PAGE ${p.numero}]]\n`.length;
    if (place > entete) {
      texte += bloc.slice(0, place);
      incluses.push(p.numero);
    }
    tronque = true;
    break;
  }
  return { texte, tronque, pages: incluses };
}

export interface PlafondsDocument {
  readonly pagesMax: number;
  readonly caracteresParPage: number;
  readonly caracteresParDocument: number;
}

/** Plafond dépassé (le texte excédentaire est refusé, jamais tronqué en silence), sinon null. */
export function verifierPlafondsDocument(
  pages: readonly PageTexte[],
  plafonds: PlafondsDocument,
): "PLAFOND_PAGES" | "PLAFOND_TEXTE" | null {
  if (pages.length > plafonds.pagesMax) return "PLAFOND_PAGES";
  let total = 0;
  for (const p of pages) {
    if (p.texte.length > plafonds.caracteresParPage) return "PLAFOND_TEXTE";
    total += p.texte.length;
  }
  return total > plafonds.caracteresParDocument ? "PLAFOND_TEXTE" : null;
}
