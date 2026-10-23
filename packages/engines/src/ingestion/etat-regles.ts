/**
 * Lecture DÉTERMINISTE (sans IA) d'un état financier dans le texte de pages de PDF ou dans les
 * lignes d'une feuille de tableur (DOS-03, ADR-009 décisions 7 et 8). Utilisée quand l'IA est
 * indisponible : le résultat est un brouillon que le moteur de contrôle (`controlerEtatFinancier`)
 * juge ensuite et qu'une revue humaine valide (voir `forcerRevueEtat`).
 *
 * Règles (insensibles à la casse et aux accents) :
 * 1. SECTION. Une ligne SANS montant qui, une fois retirés « (suite) », « exercice », « année », les
 *    années 19xx/20xx et un préfixe « BILAN » ou « COMPTE DE RÉSULTAT », se réduit à ACTIF, PASSIF,
 *    CHARGES, PRODUITS ou RÉSULTAT ouvre cette section jusqu'au titre suivant (elle traverse les
 *    pages). « BILAN » ou « COMPTE DE RÉSULTAT » seuls sont des titres sans effet.
 * 2. LIGNE DE DONNÉES = [code facultatif] libellé montant(s), les montants étant en fin de ligne,
 *    séparés par des blancs (voir `montants.ts` pour la lecture d'un nombre ; la fin de ligne peut
 *    porter une monnaie ou un appel de note « (a) », « * »). Les nombres collés à « / » (dates,
 *    « page 3/12 ») ne sont pas des montants. Un libellé sans lettre est rejeté `format`.
 * 3. CODE. 1 à 3 lettres majuscules suivies de 0 à 2 chiffres (référence SYSCOHADA : AD, BK, DA,
 *    TA…) ou 2 à 8 chiffres (compte), séparé du libellé par un espace et suivi d'un libellé.
 *    Hypothèse : un libellé qui commence par un mot de ce genre (« TVA due ») le perd en code.
 *    Sans code, le code est généré, stable et unique : « L<page>_<rang> » (rang = numéro de la
 *    ligne dans la page, 1 = première ligne ; en tableur, numéro de la ligne de la feuille).
 *    Un code déjà retenu est rejeté `code_en_double`.
 * 4. MONTANTS. Un nombre de 1 ou 2 chiffres sans séparateur placé juste avant un autre montant est
 *    une colonne « note » ignorée. Ensuite : un montant → retenu ; deux → le PREMIER (exercice N) ;
 *    trois ou plus (brut, amortissements, net…) → `montants_ambigus`. Dans un texte de page, des
 *    colonnes écrites avec des espaces simples sont découpées quand c'est sans équivoque (voir
 *    `montants.ts`) ; sinon (« 1 200 300 400 ») la ligne est rejetée `montants_ambigus` (revue)
 *    plutôt que lue de travers ; en tableur, chaque cellule est exacte.
 *    Un jeton illisible →
 *    `montant_illisible`. Une ligne dont les seuls montants sont des années et dont le libellé est
 *    un en-tête de colonnes (ref, note, libellé, exercice, brut, net…) est un en-tête : ignorée.
 * 5. TOTAUX. « TOTAL ACTIF / PASSIF / CHARGES / PRODUITS » (et « Total du bilan actif », « Total des
 *    charges »…) → `role: "total"` de la section nommée. Toute autre ligne dont le libellé commence
 *    par « total » ou « sous-total » → `sous_total_non_rattache`. Un second total de la même section
 *    → `role_invalide` (le moteur de contrôle n'en admet qu'un).
 * 6. RÉSULTAT. « RÉSULTAT NET » (ou « RÉSULTAT DE L'EXERCICE ») dans une section charges, produits ou
 *    résultat → section `resultat`, role `resultat_net` ; dans la section passif → role
 *    `resultat_exercice` (un seul de chaque, sinon `role_invalide`). Toute autre ligne de la section
 *    `resultat` → `role_invalide`. Les autres soldes (« Résultat d'exploitation »…) sont des lignes
 *    ordinaires de leur section : le contrôle des totaux en signale l'écart.
 * 7. Lignes sans parent (PDF « à plat »). Avant toute section : `section_inconnue`. Plus de 500
 *    caractères : `ligne_trop_longue`. Au plus `LIGNES_ETAT_MAX` lignes retenues, puis
 *    `trop_de_lignes`. Au plus 1000 rejets conservés, chacun avec la page et les 200 premiers
 *    caractères de la ligne.
 * 8. Le montant retenu est lu DANS la ligne source : il s'y trouve toujours, par construction.
 *    Chaque ligne est traitée en temps linéaire (aucune expression régulière sur plus de 500
 *    caractères) ; jamais d'exception pour un contenu non fiable.
 */
import { LIGNES_ETAT_MAX } from "../dossier/etat-financier";
import type { RoleLigneEtat, SectionEtatFinancier } from "../dossier/etat-financier";
import { ErreurDossier } from "../dossier/erreurs";
import { plier } from "./pages";
import { reperer, resteAcceptable } from "./montants";
import type { JetonMontant } from "./montants";
import type {
  ExtractionEtat,
  LigneEtatExtraite,
  LigneRejetee,
  MotifRejetLigne,
  PageTexte,
} from "./types";

export const LIGNE_SOURCE_MAX = 500;
export const REJET_TEXTE_MAX = 200;
export const REJETS_MAX = 1000;
const LIBELLE_MAX = 200;

const CODE_LETTRES = /^[A-Z]{1,3}[0-9]{0,2}$/;
const CODE_COMPTE = /^[0-9]{2,8}$/;
const SECTIONS_TITRE: readonly string[] = ["actif", "passif", "charges", "produits"];
const MOTS_ENTETE = new Set([
  "ref",
  "note",
  "notes",
  "libelle",
  "libelles",
  "exercice",
  "annee",
  "clos",
  "brut",
  "net",
  "amort",
  "amortissements",
  "periode",
]);
const MOTS_ANNEXES_TOTAL = new Set(["du", "de", "des", "bilan", "general", "generale", "l", "la"]);

/** Mots d'un texte : minuscules, sans accents, découpés sur tout ce qui n'est pas lettre ou chiffre. */
export function motsDe(texte: string): string[] {
  return plier(texte)
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 0);
}

const ESTANNEE = /^(19|20)[0-9]{2}$/;

/** Titre de section : une section, `null` pour un titre sans effet (« BILAN »), ou rien. */
type Titre = { readonly section: SectionEtatFinancier | null };

function detecterTitre(ligne: string): Titre | undefined {
  if (ligne.length > 120) return undefined;
  let mots = motsDe(ligne).filter(
    (m) => m !== "suite" && m !== "exercice" && m !== "annee" && m !== "n" && !ESTANNEE.test(m),
  );
  if (mots[0] === "bilan") mots = mots.slice(1);
  let compte = false;
  if (mots[0] === "compte" && mots[1] === "de") {
    mots = mots.slice(2);
    compte = true;
    if (mots[0] === "resultat" && mots.length > 1) mots = mots.slice(1);
  }
  if (mots.length === 0) return { section: null };
  if (mots.length !== 1) return undefined;
  const m = mots[0] as string;
  if (SECTIONS_TITRE.includes(m)) return { section: m as SectionEtatFinancier };
  if (m === "resultat") return compte ? { section: null } : { section: "resultat" };
  return undefined;
}

type Classe =
  | { readonly genre: "ordinaire" }
  | { readonly genre: "total"; readonly section: SectionEtatFinancier }
  | { readonly genre: "sous_total" }
  | { readonly genre: "resultat" };

function classer(mots: readonly string[]): Classe {
  if (mots[0] === "total" || (mots[0] === "sous" && mots[1] === "total")) {
    if (mots[0] === "total") {
      const reste = mots.slice(1).filter((m) => !MOTS_ANNEXES_TOTAL.has(m));
      const seul = reste[0];
      if (reste.length === 1 && seul !== undefined && SECTIONS_TITRE.includes(seul)) {
        return { genre: "total", section: seul as SectionEtatFinancier };
      }
    }
    return { genre: "sous_total" };
  }
  if (
    mots[0] === "resultat" &&
    (mots[1] === "net" || mots[1] === "exercice" || (mots[1] === "de" && mots[3] === "exercice"))
  ) {
    return { genre: "resultat" };
  }
  return { genre: "ordinaire" };
}

interface MontantLu {
  readonly valeur: number | null;
  /** Rang 1-based de la cellule (tableur) ; absent pour un texte. */
  readonly colonne?: number;
  /** Colonne « note » : nombre de 1 ou 2 chiffres, sans séparateur ni signe. */
  readonly note: boolean;
  /** Colonnes peut-être collées (« 350 000 300 000 ») : lecture trop incertaine pour être retenue. */
  readonly ambigu: boolean;
  /** Année écrite en 4 chiffres sans séparateur. */
  readonly annee: boolean;
}

interface DonneeLue {
  readonly page: number;
  readonly code: string | null;
  readonly codeGenere: string;
  readonly libelle: string;
  readonly montants: readonly MontantLu[];
  readonly brut: string;
  readonly ligne?: number;
  /** Rang (1 = première ligne de la page) d'une ligne de texte libre, pour `extraireEtatParReglesAvecRangs`. */
  readonly rang?: number;
  /** Texte libre d'une page (et non cellules d'un tableur) : les colonnes peuvent être collées. */
  readonly texteLibre?: boolean;
}

interface Contexte {
  readonly decimales: number;
  section: SectionEtatFinancier | null;
  readonly lignes: LigneEtatExtraite[];
  readonly rejets: LigneRejetee[];
  readonly codes: Set<string>;
  readonly roles: Set<string>;
  /** Lignes retenues d'un texte de page, par « page:rang » (lot 11, corrections OCR). */
  readonly positions: Map<string, LigneEtatExtraite>;
}

function nouveauContexte(decimales: number): Contexte {
  return {
    decimales,
    section: null,
    lignes: [],
    rejets: [],
    codes: new Set(),
    roles: new Set(),
    positions: new Map(),
  };
}

function rejeter(ctx: Contexte, page: number, brut: string, motif: MotifRejetLigne): void {
  if (ctx.rejets.length >= REJETS_MAX) return;
  ctx.rejets.push({ page, texte: brut.slice(0, REJET_TEXTE_MAX), motif });
}

function nettoyerLibelle(brut: string): string {
  let l = brut.replace(/\s+/g, " ").trim();
  while (l.length > 0 && ".·…_-:;".includes(l[l.length - 1] as string))
    l = l.slice(0, -1).trimEnd();
  return l.slice(0, LIBELLE_MAX);
}

function contientLettre(texte: string): boolean {
  return /\p{L}/u.test(texte);
}

/** Retire la colonne « note » : un petit entier juste avant un autre montant. */
function sansNote(montants: readonly MontantLu[]): MontantLu[] {
  const premier = montants[0];
  return premier?.note === true && montants.length >= 2 ? montants.slice(1) : [...montants];
}

function traiterDonnee(ctx: Contexte, d: DonneeLue): void {
  const mots = motsDe(d.libelle);
  const montants = sansNote(d.montants);
  if (
    montants.length > 0 &&
    montants.every((m) => m.annee) &&
    (mots.length === 0 || mots.some((m) => MOTS_ENTETE.has(m)))
  ) {
    return;
  }
  const rej = (motif: MotifRejetLigne) => rejeter(ctx, d.page, d.brut, motif);
  if (d.libelle.length === 0 || !contientLettre(d.libelle) || montants.length === 0) {
    return rej("format");
  }
  if (ctx.section === null) return rej("section_inconnue");
  const classe = classer(mots);
  if (classe.genre === "sous_total") return rej("sous_total_non_rattache");
  if (montants.some((m) => m.valeur === null)) return rej("montant_illisible");
  if (montants.length >= 3 || (d.texteLibre === true && montants.some((m) => m.ambigu))) {
    return rej("montants_ambigus");
  }
  let section: SectionEtatFinancier = ctx.section;
  let role: RoleLigneEtat | null = null;
  if (classe.genre === "total") {
    section = classe.section;
    role = "total";
  } else if (classe.genre === "resultat" && ctx.section === "passif") {
    role = "resultat_exercice";
  } else if (classe.genre === "resultat" && ctx.section !== "actif") {
    section = "resultat";
    role = "resultat_net";
  } else if (ctx.section === "resultat") {
    return rej("role_invalide");
  }
  const cleRole = role === "total" ? `total:${section}` : role;
  if (cleRole !== null && ctx.roles.has(cleRole)) return rej("role_invalide");
  const code = d.code ?? d.codeGenere;
  if (ctx.codes.has(code)) return rej("code_en_double");
  if (ctx.lignes.length >= LIGNES_ETAT_MAX) return rej("trop_de_lignes");
  const retenu = montants[0] as MontantLu;
  if (cleRole !== null) ctx.roles.add(cleRole);
  ctx.codes.add(code);
  const ligne: LigneEtatExtraite = {
    code,
    libelle: d.libelle,
    section,
    montant: retenu.valeur as number,
    parent: null,
    role,
    page: d.page,
    ...(d.ligne !== undefined && retenu.colonne !== undefined
      ? { ligne: d.ligne, colonne: retenu.colonne }
      : {}),
  };
  ctx.lignes.push(ligne);
  if (d.rang !== undefined) ctx.positions.set(`${d.page}:${d.rang}`, ligne);
}

function verifierDecimalesEtat(decimales: number): void {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 4) {
    throw new ErreurDossier("OPTIONS_INVALIDES", "Nombre de décimales entre 0 et 4 attendu.");
  }
}

function estAnnee(j: JetonMontant): boolean {
  const premier = j.groupes[0] ?? "";
  const nombre = Number(premier);
  return j.simple && premier.length === 4 && nombre >= 1900 && nombre <= 2100;
}

function enMontant(texte: string, j: JetonMontant, colonne?: number): MontantLu {
  const premier = j.groupes[0] ?? "";
  return {
    valeur: j.valeur,
    ambigu: j.ambigu,
    ...(colonne !== undefined ? { colonne } : {}),
    note: j.simple && premier.length <= 2 && texte[j.debut] === premier[0],
    annee: estAnnee(j),
  };
}

function entiereBlanche(texte: string, de: number, a: number): boolean {
  for (let i = de; i < a; i++) if (!/\s/u.test(texte[i] as string)) return false;
  return true;
}

/** Sépare un code éventuel du libellé : « AD Frais de recherche » → [« AD », « Frais de recherche »]. */
function separerCode(libelle: string): { code: string | null; libelle: string } {
  const espace = libelle.indexOf(" ");
  if (espace > 0) {
    const mot = libelle.slice(0, espace);
    const reste = libelle.slice(espace + 1).trim();
    if (reste.length > 0 && (CODE_LETTRES.test(mot) || CODE_COMPTE.test(mot))) {
      return { code: mot, libelle: reste };
    }
  }
  return { code: null, libelle };
}

function traiterLigneTexte(ctx: Contexte, page: number, rang: number, ligne: string): void {
  if (ligne.length > LIGNE_SOURCE_MAX) return rejeter(ctx, page, ligne, "ligne_trop_longue");
  const jetons = reperer(ligne, ctx.decimales).filter(
    (j) => ligne[j.debut - 1] !== "/" && ligne[j.fin] !== "/",
  );
  if (jetons.every(estAnnee)) {
    const titre = detecterTitre(ligne);
    if (titre !== undefined) {
      if (titre.section !== null) ctx.section = titre.section;
      return;
    }
  }
  const dernier = jetons[jetons.length - 1];
  if (!dernier || !resteAcceptable(ligne.slice(dernier.fin))) return;
  let debut = jetons.length - 1;
  while (debut > 0) {
    const precedent = jetons[debut - 1] as JetonMontant;
    const courant = jetons[debut] as JetonMontant;
    if (!entiereBlanche(ligne, precedent.fin, courant.debut)) break;
    debut--;
  }
  const region = jetons.slice(debut);
  const { code, libelle } = separerCode(
    nettoyerLibelle(ligne.slice(0, (region[0] as JetonMontant).debut)),
  );
  traiterDonnee(ctx, {
    page,
    code,
    codeGenere: `L${page}_${rang}`,
    libelle,
    montants: region.map((j) => enMontant(ligne, j)),
    brut: ligne,
    rang,
    texteLibre: true,
  });
}

/**
 * Lit un état financier dans le texte de pages (règles en tête de fichier). Les lignes retenues
 * n'ont jamais de parent ; les lignes non lues sont rejetées avec leur motif.
 */
export function extraireEtatParRegles(
  pages: readonly PageTexte[],
  decimales: number,
): ExtractionEtat {
  return extraireEtatParReglesAvecRangs(pages, decimales).extraction;
}

/**
 * Comme `extraireEtatParRegles`, et indique pour chaque ligne retenue sa position « page:rang »
 * (rang 1-based dans la page, lignes vides comprises). Sert à comparer deux lectures d'un même texte
 * ligne à ligne (corrections OCR) ; l'extraction renvoyée est strictement la même.
 */
export function extraireEtatParReglesAvecRangs(
  pages: readonly PageTexte[],
  decimales: number,
): {
  readonly extraction: ExtractionEtat;
  readonly positions: ReadonlyMap<string, LigneEtatExtraite>;
} {
  verifierDecimalesEtat(decimales);
  const ctx = nouveauContexte(decimales);
  for (const p of pages) {
    const lignes = p.texte.split("\n");
    for (let i = 0; i < lignes.length; i++) {
      const ligne = (lignes[i] as string).replace(/\t/g, " ").trim();
      if (ligne.length > 0) traiterLigneTexte(ctx, p.numero, i + 1, ligne);
    }
  }
  return { extraction: { lignes: ctx.lignes, rejets: ctx.rejets }, positions: ctx.positions };
}

interface Cellule {
  readonly texte: string;
  readonly jeton: JetonMontant | null;
}

function lireCellule(texte: string, decimales: number): Cellule {
  const jetons = reperer(texte, decimales);
  const j = jetons[0];
  if (jetons.length === 1 && j && j.debut === 0 && resteAcceptable(texte.slice(j.fin))) {
    return { texte, jeton: j };
  }
  return { texte, jeton: null };
}

/**
 * Lit un état financier dans une feuille de tableur : chaque ligne est [code] libellé montant(s)
 * réparti en cellules. Mêmes règles que `extraireEtatParRegles` ; la page vaut 1, `ligne` est le
 * numéro de ligne de la feuille et `colonne` le rang (1 = A) de la cellule du montant.
 */
export function extraireEtatDepuisTableau(
  lignes: readonly { readonly numero: number; readonly valeurs: readonly string[] }[],
  decimales: number,
): ExtractionEtat {
  verifierDecimalesEtat(decimales);
  const ctx = nouveauContexte(decimales);
  for (const l of lignes) {
    const cellules = l.valeurs.map((v) => lireCellule(String(v).trim(), decimales));
    const brut = cellules
      .map((c) => c.texte)
      .filter((t) => t.length > 0)
      .join(" | ");
    if (brut.length === 0) continue;
    if (brut.length > LIGNE_SOURCE_MAX) {
      rejeter(ctx, 1, brut, "ligne_trop_longue");
      continue;
    }
    const premierTexte = cellules.findIndex((c) => c.texte.length > 0 && c.jeton === null);
    const montantsIdx: number[] = [];
    cellules.forEach((c, i) => {
      if (c.jeton !== null && i > premierTexte) montantsIdx.push(i);
    });
    const premierMontant = montantsIdx[0] ?? cellules.length;
    const textes = cellules
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.jeton === null && c.texte.length > 0 && i < premierMontant)
      .map(({ c }) => c.texte);
    if (montantsIdx.length === 0) {
      const titre = detecterTitre(textes.join(" "));
      if (titre?.section) ctx.section = titre.section;
      continue;
    }
    let code: string | null = null;
    let libelle = nettoyerLibelle(textes.join(" "));
    const cellule0 = cellules[0];
    if (premierTexte > 0 && cellule0?.jeton?.simple && CODE_COMPTE.test(cellule0.texte)) {
      code = cellule0.texte;
    } else if (textes.length >= 2 && CODE_LETTRES.test(textes[0] as string)) {
      code = textes[0] as string;
      libelle = nettoyerLibelle(textes.slice(1).join(" "));
    }
    traiterDonnee(ctx, {
      page: 1,
      code,
      codeGenere: `L1_${l.numero}`,
      libelle,
      montants: montantsIdx.map((i) =>
        enMontant(
          (cellules[i] as Cellule).texte,
          (cellules[i] as Cellule).jeton as JetonMontant,
          i + 1,
        ),
      ),
      brut,
      ligne: l.numero,
    });
  }
  return { lignes: ctx.lignes, rejets: ctx.rejets };
}
