/**
 * Relecture des lectures de document proposées par le modèle (DD-02, DD-10 ; ADR-009 décision 9).
 *
 * Formats (séparateur « | », le dernier champ prend tout le reste de la ligne) :
 * - « RESUME | page | texte » : au plus 10 ;
 * - « page | type | extrait recopié | énoncé » : type parmi fait, risque, chiffre, engagement,
 *   autre ; au plus 60.
 * Une ligne vide est ignorée ; toute autre ligne hors format est rejetée `format`. Au-delà des
 * maxima : `trop_de_lignes`. Textes bornés par troncature à la limite : extrait 400, énoncé 500,
 * résumé 1000 caractères.
 *
 * Vérification de source : un élément est `verifie` si son extrait (8 caractères au moins) se
 * retrouve dans le texte de la page citée (casse, accents, espaces multiples, guillemets et tirets
 * typographiques ignorés) ET si chaque nombre de l'extrait et de l'énoncé s'y retrouve aussi
 * (`nombresNonRetrouves`). Un élément non retrouvé est GARDÉ avec `verifie: false` : le consultant
 * le voit signalé et doit l'acquitter. Une page inconnue fait rejeter la ligne `page_inconnue`.
 *
 * Résumé : une ligne RESUME qui cite un nombre de 3 chiffres ou plus introuvable dans la page citée
 * est REJETÉE `montant_absent_de_la_page` (gardée dans `rejets`) : le résumé n'a pas d'acquittement
 * par élément, un chiffre inventé n'y est donc jamais toléré.
 */
import { REJET_TEXTE_MAX, REJETS_MAX } from "./etat-regles";
import { nombresNonRetrouves } from "./montants";
import { plier } from "./pages";
import { TYPES_ELEMENT_LECTURE } from "./types";
import type {
  ContenuLectureMoteur,
  ElementLectureMoteur,
  LigneRejetee,
  MotifRejetLigne,
  PageTexte,
  TypeElementLecture,
} from "./types";

export const LECTURE_ELEMENTS_MAX = 60;
export const LECTURE_RESUME_MAX = 10;
const EXTRAIT_MAX = 400;
const ENONCE_MAX = 500;
const RESUME_TEXTE_MAX = 1000;
const EXTRAIT_MIN = 8;
const LIGNE_MODELE_MAX = 4000;
const NUMERO_PAGE = /^[0-9]{1,6}$/;

/** Forme comparable : sans accents, minuscules, apostrophes et tirets unifiés, guillemets retirés, espaces réduits. */
export function formeComparable(texte: string): string {
  return plier(texte.normalize("NFKC"))
    .replace(/[‘’‚‛ʼ`´]/g, "'")
    .replace(/["“”„‟«»]/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Découpe en `n` champs au plus : le dernier reçoit tout le reste de la ligne. */
export function decouper(ligne: string, n: number): string[] {
  const champs: string[] = [];
  let debut = 0;
  while (champs.length < n - 1) {
    const i = ligne.indexOf("|", debut);
    if (i === -1) break;
    champs.push(ligne.slice(debut, i).trim());
    debut = i + 1;
  }
  champs.push(ligne.slice(debut).trim());
  return champs;
}

export function tronquerTexte(texte: string, max: number): string {
  return texte.length > max ? texte.slice(0, max).trimEnd() : texte;
}

/** Lit les lignes de lecture du modèle ; les éléments non retrouvés dans la page sont gardés non vérifiés. */
export function lireLecturesIa(
  lignes: readonly string[],
  pages: readonly PageTexte[],
): { contenu: ContenuLectureMoteur; rejets: LigneRejetee[] } {
  const textes = new Map<number, string>();
  for (const p of pages) if (!textes.has(p.numero)) textes.set(p.numero, p.texte);
  const comparables = new Map<number, string>();
  const comparable = (page: number): string => {
    let c = comparables.get(page);
    if (c === undefined) {
      c = formeComparable(textes.get(page) as string);
      comparables.set(page, c);
    }
    return c;
  };
  const rejets: LigneRejetee[] = [];
  const resume: { page: number; texte: string }[] = [];
  const elements: ElementLectureMoteur[] = [];
  const rejeter = (page: number | null, brut: string, motif: MotifRejetLigne) => {
    if (rejets.length < REJETS_MAX) {
      rejets.push({ page, texte: brut.slice(0, REJET_TEXTE_MAX), motif });
    }
  };
  for (const brute of lignes) {
    const t = brute.trim();
    if (t.length === 0) continue;
    if (t.length > LIGNE_MODELE_MAX) {
      rejeter(null, t, "ligne_trop_longue");
      continue;
    }
    const barre = t.indexOf("|");
    const estResume = barre !== -1 && plier(t.slice(0, barre).trim()) === "resume";
    const attendus = estResume ? 3 : 4;
    const champs = decouper(t, attendus);
    const pageTexte = champs[estResume ? 1 : 0] as string;
    if (champs.length !== attendus || !NUMERO_PAGE.test(pageTexte)) {
      rejeter(null, t, "format");
      continue;
    }
    const page = Number(pageTexte);
    if (!textes.has(page)) {
      rejeter(page, t, "page_inconnue");
      continue;
    }
    if (estResume) {
      const texte = tronquerTexte(champs[2] as string, RESUME_TEXTE_MAX);
      if (texte.length === 0) rejeter(page, t, "format");
      else if (resume.length >= LECTURE_RESUME_MAX) rejeter(page, t, "trop_de_lignes");
      else if (nombresNonRetrouves(texte, textes.get(page) as string).length > 0) {
        rejeter(page, t, "montant_absent_de_la_page");
      } else resume.push({ page, texte });
      continue;
    }
    const type = plier(champs[1] as string) as TypeElementLecture;
    const extrait = tronquerTexte(champs[2] as string, EXTRAIT_MAX);
    const enonce = tronquerTexte(champs[3] as string, ENONCE_MAX);
    if (!TYPES_ELEMENT_LECTURE.includes(type) || extrait.length === 0 || enonce.length === 0) {
      rejeter(page, t, "format");
      continue;
    }
    if (elements.length >= LECTURE_ELEMENTS_MAX) {
      rejeter(page, t, "trop_de_lignes");
      continue;
    }
    const forme = formeComparable(extrait);
    const verifie =
      forme.length >= EXTRAIT_MIN &&
      comparable(page).includes(forme) &&
      nombresNonRetrouves(`${extrait} ${enonce}`, textes.get(page) as string).length === 0;
    elements.push({ page, type, extrait, enonce, verifie });
  }
  return { contenu: { resume, elements, tronque: false }, rejets };
}

/** Vrai si un élément n'a pas été retrouvé dans sa page (acquittement exigé avant validation). */
export function contientNonVerifie(contenu: {
  readonly elements: readonly { readonly verifie: boolean }[];
}): boolean {
  return contenu.elements.some((e) => !e.verifie);
}
