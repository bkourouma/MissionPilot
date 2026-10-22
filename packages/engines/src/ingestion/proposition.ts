/**
 * Relecture des propositions de standard faites par le modèle (STD-13 ; ADR-009 décision 10).
 *
 * Formats (séparateur « | », champs rognés, nombre de champs exact, chacun terminé par la page) :
 * - « etape | code | libellé | page » (au plus 20) ;
 * - « brique | étape_code | code | libellé | objet | page » (au plus 60) ;
 * - « element | type | code | libellé | description | page » (au plus 100) ; type parmi livrable,
 *   item, kpi_type, initiative_type, risque_type, gabarit, automatisation ; description facultative ;
 * - « rubrique | code | libellé | niveau1 | niveau2 | niveau3 | niveau4 | niveau5 | page » (au plus
 *   30) ; exactement 5 niveaux non vides, sinon `format`.
 * Une ligne vide est ignorée ; une ligne hors format est rejetée `format` ; au-delà des maxima :
 * `trop_de_lignes`.
 *
 * Les codes sont ramenés à `^[a-z0-9_.-]{1,120}$` : accents retirés, minuscules, espaces et autres
 * caractères → « _ » (répétitions réduites, bords retirés) ; un code vide ensuite est `code_invalide`.
 * Un code en double dans une même famille (étapes, briques, éléments, rubriques ; les éléments
 * sont uniques tous types confondus, par prudence) est rejeté `code_en_double`. Une brique dont
 * l'étape n'est pas proposée est GARDÉE : l'étape existe peut-être déjà dans la méthode cible,
 * l'API tranche. Une page inconnue est rejetée `page_inconnue`. Textes bornés par troncature :
 * libellé 200, objet et description 2000, niveau 1000 caractères.
 *
 * Aucune donnée financière (FIN-02) : une proposition d'amorçage ne porte ni taux ni honoraires.
 * Toute ligne dont un texte (libellé, objet, description, niveau) contient un nombre de trois
 * chiffres ou plus ou une mention de monnaie est rejetée `donnee_financiere`
 * (`contientDonneeFinanciere`, aussi utilisée par l'API pour la correction humaine). Les CODES
 * (code, étape_code), lus avant normalisation, sont contrôlés de même. Le texte est
 * non fiable : balayages linéaires, aucune expression régulière à retour arrière.
 */
import { REJET_TEXTE_MAX, REJETS_MAX } from "./etat-regles";
import { tronquerTexte } from "./lecture";
import { plier } from "./pages";
import { TYPES_ELEMENT_PROPOSITION } from "./types";
import type {
  BriqueProposee,
  ContenuPropositionMoteur,
  ElementPropose,
  EtapeProposee,
  LigneRejetee,
  MotifRejetLigne,
  PageTexte,
  RubriqueProposee,
  TypeElementProposition,
} from "./types";

export const PROPOSITION_MAXIMA_MOTEUR = {
  etapes: 20,
  briques: 60,
  elements: 100,
  rubriques: 30,
} as const;
const LIBELLE_MAX = 200;
const LONG_TEXTE_MAX = 2000;
const NIVEAU_MAX = 1000;
const CODE_MAX = 120;
const LIGNE_MODELE_MAX = 8000;
const NUMERO_PAGE = /^[0-9]{1,6}$/;
const NB_NIVEAUX = 5;

/** Ramène un code à la forme du référentiel ; chaîne vide si rien d'exploitable ne reste. */
export function normaliserCodeProposition(brut: string): string {
  let code = "";
  let souligne = false;
  for (const c of plier(brut)) {
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "." || c === "-") {
      code += c;
      souligne = false;
    } else if (!souligne && code.length > 0) {
      code += "_";
      souligne = true;
    }
    if (code.length > CODE_MAX) break;
  }
  if (code.endsWith("_")) code = code.slice(0, -1);
  return code.slice(0, CODE_MAX);
}

const SEPARATEURS_MILLIERS = new Set([" ", " ", " ", " ", ".", ",", "'", "’"]);
const MONNAIES = new Set([
  "fcfa",
  "cfa",
  "xof",
  "xaf",
  "eur",
  "euro",
  "euros",
  "usd",
  "dollar",
  "dollars",
  "chf",
  "franc",
  "francs",
]);
/** Mots de nombre (écrits en lettres) : « cent mille francs » ne passe pas par les chiffres. */
const MOTS_NOMBRE = new Set([
  "cent",
  "cents",
  "mille",
  "milles",
  "million",
  "millions",
  "milliard",
  "milliards",
]);

function estChiffre(c: string | undefined): boolean {
  if (c === undefined) return false;
  const k = c.charCodeAt(0);
  if (k < 128) return k >= 48 && k <= 57;
  return /^\p{Nd}$/u.test(c);
}

function estLettre(c: string | undefined): boolean {
  if (c === undefined) return false;
  const k = c.charCodeAt(0);
  if (k < 128) return (k >= 65 && k <= 90) || (k >= 97 && k <= 122);
  return /^\p{L}$/u.test(c);
}

/** Longueur de la suite de chiffres qui commence en `i` (0 si `i` n'est pas un chiffre). */
function longueurChiffres(t: string, i: number): number {
  let j = i;
  while (estChiffre(t[j])) j++;
  return j - i;
}

/**
 * Vrai si le texte contient un nombre de trois chiffres ou plus (séparateurs de milliers compris :
 * « 1 500 », « 2.000 », « 450 »), une mention de monnaie (FCFA, F CFA, CFA, XOF, XAF, EUR, euro(s),
 * USD, dollar(s), CHF, franc(s), €, $ ou £) ou un mot de nombre (cent(s), mille(s), million(s),
 * milliard(s)), en mots ENTIERS, sans égard à la casse ni aux accents : « centre », « centralisé »,
 * « milieu » ou « millésime » ne sont pas détectés. Les nombres d'un ou deux chiffres (« 5 jours »,
 * « niveau 3 », « 10 % ») sont admis ; une année (« 2025 ») ou une norme (« ISO 9001 ») est refusée par
 * prudence, de même que « cent pour cent » (faux positif assumé).
 *
 * LIMITE : c'est une HEURISTIQUE de prudence, pas une garantie. Un montant épelé autrement (« deux
 * mille » est repéré par « mille », mais « 3k », une abréviation ou une autre langue ne le sont pas),
 * un nombre à un ou deux chiffres suivi d'un multiplicateur inconnu ou une devise rare passent. La
 * barrière réelle reste la validation humaine du brouillon (FIN-02, l'IA propose, l'expert dispose).
 * Fonction pure, balayage linéaire, aucun retour arrière.
 */
export function contientDonneeFinanciere(texte: string): boolean {
  const t = plier(texte.normalize("NFKC"));
  if (t.includes("€") || t.includes("$") || t.includes("£")) return true;
  let i = 0;
  while (i < t.length) {
    if (estChiffre(t[i])) {
      // Suite de groupes de chiffres reliés par un séparateur de milliers (suivi de 3 chiffres).
      let total = longueurChiffres(t, i);
      i += total;
      while (i + 3 < t.length && SEPARATEURS_MILLIERS.has(t[i] as string)) {
        const g = longueurChiffres(t, i + 1);
        if (g !== 3) break;
        total += g;
        i += 1 + g;
      }
      if (total >= 3) return true;
    } else if (estLettre(t[i])) {
      let j = i;
      while (estLettre(t[j])) j++;
      const mot = t.slice(i, j);
      if (MONNAIES.has(mot) || MOTS_NOMBRE.has(mot)) return true;
      i = j;
    } else {
      i++;
    }
  }
  return false;
}

/** Lit les lignes de proposition du modèle (étapes, briques, éléments, rubriques). */
export function lirePropositionIa(
  lignes: readonly string[],
  pages: readonly PageTexte[],
): { contenu: ContenuPropositionMoteur; rejets: LigneRejetee[] } {
  const numeros = new Set(pages.map((p) => p.numero));
  const rejets: LigneRejetee[] = [];
  const etapes: EtapeProposee[] = [];
  const briques: BriqueProposee[] = [];
  const elements: ElementPropose[] = [];
  const rubriques: RubriqueProposee[] = [];
  const codes = {
    etape: new Set<string>(),
    brique: new Set<string>(),
    element: new Set<string>(),
    rubrique: new Set<string>(),
  };
  for (const brute of lignes) {
    const t = brute.trim();
    if (t.length === 0) continue;
    let page: number | null = null;
    const rej = (motif: MotifRejetLigne) => {
      if (rejets.length < REJETS_MAX) {
        rejets.push({ page, texte: t.slice(0, REJET_TEXTE_MAX), motif });
      }
    };
    if (t.length > LIGNE_MODELE_MAX) {
      rej("ligne_trop_longue");
      continue;
    }
    const champs = t.split("|").map((c) => c.trim());
    const genre = plier(champs[0] as string);
    const attendus =
      genre === "etape"
        ? 4
        : genre === "brique" || genre === "element"
          ? 6
          : genre === "rubrique"
            ? 9
            : 0;
    const pageTexte = champs[champs.length - 1] as string;
    if (attendus === 0 || champs.length !== attendus || !NUMERO_PAGE.test(pageTexte)) {
      rej("format");
      continue;
    }
    page = Number(pageTexte);
    if (!numeros.has(page)) {
      rej("page_inconnue");
      continue;
    }
    const numeroPage = page;
    const f = (i: number): string => champs[i] as string;
    // Textes libres de la famille (hors genre, codes et page) : jamais de chiffres ni de monnaie.
    const textes =
      genre === "etape"
        ? [f(2)]
        : genre === "brique"
          ? [f(3), f(4)]
          : genre === "element"
            ? [f(3), f(4)]
            : champs.slice(2, 3 + NB_NIVEAUX);
    // Codes BRUTS (avant normalisation) : « Taux journalier 500 » devient « taux_journalier_500 », donnée
    // financière déguisée en identifiant ; les codes sont donc contrôlés comme les textes libres.
    const codesBruts =
      genre === "etape"
        ? [f(1)]
        : genre === "brique"
          ? [f(1), f(2)]
          : genre === "element"
            ? [f(2)]
            : [f(1)];
    if ([...textes, ...codesBruts].some(contientDonneeFinanciere)) {
      rej("donnee_financiere");
      continue;
    }
    if (genre === "etape") {
      const code = normaliserCodeProposition(f(1));
      const libelle = tronquerTexte(f(2), LIBELLE_MAX);
      if (code === "") rej("code_invalide");
      else if (libelle === "") rej("format");
      else if (codes.etape.has(code)) rej("code_en_double");
      else if (etapes.length >= PROPOSITION_MAXIMA_MOTEUR.etapes) rej("trop_de_lignes");
      else {
        codes.etape.add(code);
        etapes.push({ code, libelle, page: numeroPage });
      }
    } else if (genre === "brique") {
      const etapeCode = normaliserCodeProposition(f(1));
      const code = normaliserCodeProposition(f(2));
      const libelle = tronquerTexte(f(3), LIBELLE_MAX);
      const objet = tronquerTexte(f(4), LONG_TEXTE_MAX);
      if (code === "" || etapeCode === "") rej("code_invalide");
      else if (libelle === "" || objet === "") rej("format");
      else if (codes.brique.has(code)) rej("code_en_double");
      else if (briques.length >= PROPOSITION_MAXIMA_MOTEUR.briques) rej("trop_de_lignes");
      else {
        codes.brique.add(code);
        briques.push({ etape_code: etapeCode, code, libelle, objet, page: numeroPage });
      }
    } else if (genre === "element") {
      const type = plier(f(1)).replace(/[\s-]+/g, "_") as TypeElementProposition;
      const code = normaliserCodeProposition(f(2));
      const libelle = tronquerTexte(f(3), LIBELLE_MAX);
      const description = tronquerTexte(f(4), LONG_TEXTE_MAX);
      if (!TYPES_ELEMENT_PROPOSITION.includes(type) || libelle === "") rej("format");
      else if (code === "") rej("code_invalide");
      else if (codes.element.has(code)) rej("code_en_double");
      else if (elements.length >= PROPOSITION_MAXIMA_MOTEUR.elements) rej("trop_de_lignes");
      else {
        codes.element.add(code);
        elements.push({
          type,
          code,
          libelle,
          description: description === "" ? null : description,
          page: numeroPage,
        });
      }
    } else {
      const code = normaliserCodeProposition(f(1));
      const libelle = tronquerTexte(f(2), LIBELLE_MAX);
      const niveaux = champs.slice(3, 3 + NB_NIVEAUX).map((n) => tronquerTexte(n, NIVEAU_MAX));
      if (niveaux.some((n) => n === "") || libelle === "") rej("format");
      else if (code === "") rej("code_invalide");
      else if (codes.rubrique.has(code)) rej("code_en_double");
      else if (rubriques.length >= PROPOSITION_MAXIMA_MOTEUR.rubriques) rej("trop_de_lignes");
      else {
        codes.rubrique.add(code);
        rubriques.push({ code, libelle, niveaux, page: numeroPage });
      }
    }
  }
  return { contenu: { etapes, briques, elements, rubriques, tronque: false }, rejets };
}
