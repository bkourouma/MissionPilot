/**
 * Relecture des lignes d'état financier proposées par le modèle (DOS-03, ADR-009 décisions 7 et 8).
 *
 * Le modèle ne fait que PROPOSER des lignes de texte « page | section | code | parent | role |
 * libellé | montant » ; ce moteur les relit, les borne et les rattache. Un chiffre n'est jamais
 * retenu sur la foi du modèle : le montant doit être ANCRÉ sur une ligne de la page citée qui porte
 * aussi le libellé COMPLET de la ligne (ou, à défaut, son code en jeton isolé porté par une seule
 * ligne) et y être le PREMIER montant (colonne de l'exercice N), voir `ancrage.ts`. Sinon la ligne
 * est rejetée `montant_absent_de_la_page` (montant sur une autre ligne ou dans une autre colonne,
 * comme la colonne N-1), `montants_ambigus` (ligne source à trois montants ou plus) ou
 * `libelle_ambigu` (plusieurs lignes de la page se disputent le libellé ou le code : un poste ne
 * peut pas recevoir le montant d'un voisin au préfixe commun). Tout rejet impose la revue humaine
 * (`forcerRevueEtat`).
 *
 * Règles :
 * - exactement 7 champs séparés par « | » (parent et role peuvent être vides) ; une ligne vide est
 *   ignorée, toute autre ligne qui ne respecte pas le format est rejetée `format` ;
 * - section parmi actif, passif, charges, produits, resultat ; code `^[A-Za-z0-9_.-]{1,40}$`, unique ;
 * - role vide ou total / resultat_exercice / resultat_net ; resultat_exercice exige la section
 *   passif, resultat_net la section resultat, et la section resultat ne porte que resultat_net ;
 *   un total n'a pas de parent ; un rôle n'est retenu qu'une fois (total : une fois par section),
 *   comme l'exige `validerLignesEtat` ;
 * - les parents sont résolus APRÈS lecture de toutes les lignes (un parent déclaré après son enfant
 *   est admis) : un parent absent des lignes retenues, de section différente, qui est un total,
 *   la ligne elle-même ou qui forme un cycle, fait rejeter l'enfant `parent_inconnu` ; le rejet
 *   se propage aux descendants jusqu'à stabilité ;
 * - au plus `LIGNES_ETAT_MAX` lignes retenues (`trop_de_lignes` ensuite), au plus 2000 caractères
 *   par ligne du modèle (`ligne_trop_longue`).
 *
 * Mêmes entrées, même sortie ; aucune expression régulière sur un texte non borné.
 */
import {
  LIGNES_ETAT_MAX,
  ROLES_LIGNE_ETAT,
  SECTIONS_ETAT_FINANCIER,
} from "../dossier/etat-financier";
import type { RoleLigneEtat, SectionEtatFinancier } from "../dossier/etat-financier";
import { ErreurDossier } from "../dossier/erreurs";
import { REJET_TEXTE_MAX, REJETS_MAX } from "./etat-regles";
import { ancrerMontant, preparerPageAncrable } from "./ancrage";
import type { PageAncrable } from "./ancrage";
import { lireMontantIsole } from "./montants";
import type {
  ExtractionEtat,
  LigneEtatExtraite,
  LigneRejetee,
  MotifRejetLigne,
  PageTexte,
} from "./types";

const LIGNE_MODELE_MAX = 2000;
const LIBELLE_MAX = 200;
const CODE = /^[A-Za-z0-9_.-]{1,40}$/;
const NUMERO_PAGE = /^[0-9]{1,6}$/;

interface Candidate {
  readonly ligne: LigneEtatExtraite;
  readonly brut: string;
}

/** Retire les lignes dont le parent est invalide ou en cycle, jusqu'à stabilité. */
function resoudreParents(candidates: Candidate[], rejeter: (c: Candidate) => void): Candidate[] {
  let courant = candidates;
  for (;;) {
    const parCode = new Map(courant.map((c) => [c.ligne.code, c]));
    const invalides = new Set<Candidate>();
    for (const c of courant) {
      const p = c.ligne.parent;
      if (p === null) continue;
      const parent = parCode.get(p);
      if (
        !parent ||
        parent === c ||
        parent.ligne.section !== c.ligne.section ||
        parent.ligne.role === "total"
      ) {
        invalides.add(c);
      }
    }
    const etat = new Map<Candidate, 1 | 2>();
    for (const c of courant) {
      const chemin: Candidate[] = [];
      let n: Candidate | undefined = c;
      while (n !== undefined && !etat.has(n)) {
        etat.set(n, 1);
        chemin.push(n);
        const p: string | null = n.ligne.parent;
        n = p === null ? undefined : parCode.get(p);
      }
      if (n !== undefined && etat.get(n) === 1) {
        for (const m of chemin.slice(chemin.indexOf(n))) invalides.add(m);
      }
      for (const m of chemin) etat.set(m, 2);
    }
    if (invalides.size === 0) return courant;
    for (const c of courant) if (invalides.has(c)) rejeter(c);
    courant = courant.filter((c) => !invalides.has(c));
  }
}

/**
 * Relit les lignes du modèle ; seules les lignes dont le montant est ancré sur une ligne de la page
 * citée sont retenues.
 */
export function lireLignesEtatIa(
  lignes: readonly string[],
  pages: readonly PageTexte[],
  decimales: number,
): ExtractionEtat {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 4) {
    throw new ErreurDossier("OPTIONS_INVALIDES", "Nombre de décimales entre 0 et 4 attendu.");
  }
  const textes = new Map<number, string>();
  for (const p of pages) if (!textes.has(p.numero)) textes.set(p.numero, p.texte);
  const pagesAncrables = new Map<number, PageAncrable>();
  const rejets: LigneRejetee[] = [];
  const rejeter = (page: number | null, brut: string, motif: MotifRejetLigne) => {
    if (rejets.length < REJETS_MAX)
      rejets.push({ page, texte: brut.slice(0, REJET_TEXTE_MAX), motif });
  };
  const retenues: Candidate[] = [];
  const codes = new Set<string>();
  const roles = new Set<string>();
  for (const brute of lignes) {
    const t = brute.trim();
    if (t.length === 0) continue;
    if (t.length > LIGNE_MODELE_MAX) {
      rejeter(null, t, "ligne_trop_longue");
      continue;
    }
    const champs = t.split("|").map((c) => c.trim());
    const [pageTexte, sectionTexte, code, parent, roleTexte, libelle, montantTexte] = champs;
    if (champs.length !== 7 || !NUMERO_PAGE.test(pageTexte as string)) {
      rejeter(null, t, "format");
      continue;
    }
    const page = Number(pageTexte);
    const rej = (motif: MotifRejetLigne) => rejeter(page, t, motif);
    const source = textes.get(page);
    if (source === undefined) {
      rej("page_inconnue");
      continue;
    }
    if (!(SECTIONS_ETAT_FINANCIER as readonly string[]).includes(sectionTexte as string)) {
      rej("section_inconnue");
      continue;
    }
    const section = sectionTexte as SectionEtatFinancier;
    if (!CODE.test(code as string)) {
      rej("code_invalide");
      continue;
    }
    if (codes.has(code as string)) {
      rej("code_en_double");
      continue;
    }
    const role = (roleTexte as string) === "" ? null : (roleTexte as string);
    const roleValide = role === null || (ROLES_LIGNE_ETAT as readonly string[]).includes(role);
    const cleRole = role === "total" ? `total:${section}` : role;
    const coherent =
      roleValide &&
      (role === "resultat_exercice" ? section === "passif" : true) &&
      (role === "resultat_net" ? section === "resultat" : true) &&
      (section === "resultat" ? role === "resultat_net" : true) &&
      (role === "total" ? (parent as string) === "" : true) &&
      (cleRole === null || !roles.has(cleRole));
    if (!coherent) {
      rej("role_invalide");
      continue;
    }
    const montant = lireMontantIsole(montantTexte as string, decimales);
    if (montant === null) {
      rej("montant_illisible");
      continue;
    }
    if ((libelle as string).length === 0) {
      rej("format");
      continue;
    }
    let pageAncrable = pagesAncrables.get(page);
    if (pageAncrable === undefined) {
      pageAncrable = preparerPageAncrable(source);
      pagesAncrables.set(page, pageAncrable);
    }
    const ancrage = ancrerMontant(
      pageAncrable,
      libelle as string,
      code as string,
      montant,
      decimales,
    );
    if (ancrage !== "ancre") {
      rej(
        ancrage === "montants_ambigus"
          ? "montants_ambigus"
          : ancrage === "libelle_ambigu"
            ? "libelle_ambigu"
            : "montant_absent_de_la_page",
      );
      continue;
    }
    if (retenues.length >= LIGNES_ETAT_MAX) {
      rej("trop_de_lignes");
      continue;
    }
    codes.add(code as string);
    if (cleRole !== null) roles.add(cleRole);
    retenues.push({
      brut: t,
      ligne: {
        code: code as string,
        libelle: (libelle as string).slice(0, LIBELLE_MAX),
        section,
        montant,
        parent: (parent as string) === "" ? null : (parent as string),
        role: role as RoleLigneEtat | null,
        page,
      },
    });
  }
  const finales = resoudreParents(retenues, (c) => rejeter(c.ligne.page, c.brut, "parent_inconnu"));
  return { lignes: finales.map((c) => c.ligne), rejets };
}

/**
 * Vrai si l'état doit passer en revue humaine : des lignes ont été rejetées, le texte vient d'un
 * OCR, ou aucune ligne n'est retenue. Le contrôle d'équilibre (`controlerEtatFinancier`) reste seul
 * juge des totaux ; ce critère s'y ajoute et ne le remplace pas.
 */
export function forcerRevueEtat(
  extraction: ExtractionEtat,
  options: { readonly ocr: boolean },
): boolean {
  return extraction.rejets.length > 0 || options.ocr || extraction.lignes.length === 0;
}
