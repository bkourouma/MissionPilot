/**
 * Confusions classiques d'OCR dans les montants d'une page lue par reconnaissance de caractères
 * (lot 11, ADR-009 décisions 4 et 8) : lettre O/o lue pour 0, l/I/| lue pour 1, virgule et point
 * confondus comme séparateurs. La tolérance ne sert QU'À PROPOSER une correction à un relecteur :
 * elle n'entre jamais dans l'extraction retenue, ne change aucun rejet et n'affaiblit pas
 * l'ancrage strict (libellé complet + montant sur la ligne, voir `ancrage.ts`).
 *
 * NORMALISATION (`normaliserConfusionsOcr`), pure, de même longueur que le texte d'origine (chaque
 * caractère remplacé l'est par UN caractère : les positions d'origine restent valables) :
 * - seule la ZONE DES MONTANTS de chaque ligne est examinée : les mots numériques à la fin de la
 *   ligne (hors monnaie ou appel de note final). Un libellé, un code, un mot ordinaire ne sont donc
 *   jamais réécrits (« Olivier SARL », « Illimité », « Total l'actif ») : un mot n'est un candidat
 *   que s'il ne contient que des chiffres, « . », « , » et des lettres confondables (O o l I, et
 *   « | » à l'intérieur seulement), avec au moins un chiffre ;
 * - un mot qui porte deux lettres confondables ou plus (« 12O4O ») est AMBIGU : laissé tel quel, et
 *   la zone s'arrête à lui ;
 * - un mot de moins de quatre caractères qui porte une lettre n'est admis que comme groupe de trois
 *   caractères d'un nombre déjà commencé par un groupe voisin (« 56O » dans « 1 234 56O ») : « l2 »,
 *   « 5O » ou « 5OO » isolés (appels de note, numéros) ne sont pas touchés ;
 * - un « l » ou « I » isolé, séparé par UN seul blanc d'un groupe de trois chiffres, est lu 1
 *   (« l 234 567 ») ; une année (19xx ou 20xx) n'est jamais réécrite ;
 * - séparateurs mêlés (« 1,234.567 » avec 0 à 2 décimales) ou point décimal répété (« 1.234.56 ») :
 *   les séparateurs de milliers sont remplacés par un blanc, le séparateur décimal est conservé ;
 * - les lignes de plus de 500 caractères (rejetées par les règles) ne sont pas examinées.
 *
 * PROPOSITIONS (`proposerCorrectionsOcr`) : pour chaque ligne modifiée par la normalisation, l'état
 * lu par les règles sur le texte normalisé est comparé à celui du texte brut ; une correction est
 * proposée si la ligne n'est lue qu'après correction ou si son montant diffère, sauf si l'extraction
 * retenue contient déjà ce montant pour ce libellé. Les lignes proposées par le modèle et rejetées
 * `montant_absent_de_la_page` ont un second essai d'ancrage sur la ligne normalisée. Limites connues
 * (faux positifs possibles, revus par un humain) : un libellé terminé par un mot numérique
 * (« Réf O1234 ») est lu comme zone de montants ; un montant à trois chiffres ou moins qui porte
 * une lettre (« 5OO ») n'est jamais proposé.
 *
 * Fonctions pures et déterministes ; boucles bornées par la taille des lignes (500 caractères) ;
 * aucune expression régulière sur un texte non borné.
 */
import { ErreurDossier } from "../dossier/erreurs";
import { ancrerMontant, preparerPageAncrable } from "./ancrage";
import type { PageAncrable } from "./ancrage";
import { LIGNE_SOURCE_MAX, extraireEtatParReglesAvecRangs } from "./etat-regles";
import { lireMontantIsole, reperer, resteAcceptable } from "./montants";
import { plier } from "./pages";
import type { ExtractionEtat, LigneEtatExtraite, PageTexte } from "./types";

/** Confusions reconnues (mêmes valeurs que `CONFUSIONS_OCR` de `packages/shared`). */
export const CONFUSIONS_OCR_MOTEUR = ["o_zero", "l_un", "separateur"] as const;
export type ConfusionOcrMoteur = (typeof CONFUSIONS_OCR_MOTEUR)[number];

/** Nombre maximal de corrections proposées (même valeur que `CORRECTIONS_OCR_MAX` de `packages/shared`). */
export const CORRECTIONS_OCR_PROPOSEES_MAX = 100;
/** Longueur maximale du jeton lu conservé dans une correction. */
export const TEXTE_LU_MAX = 60;
const LIBELLE_MAX = 200;
/** Lignes du modèle rejetées examinées par page (coût borné). */
const REJETS_IA_EXAMINES_MAX = 200;
/** Lignes modifiées examinées par page pour une ligne du modèle (coût borné). */
const LIGNES_MODIFIEES_IA_MAX = 200;

/** Une réécriture d'un mot, positions dans la ligne d'origine (`fin` exclue). */
export interface ChangementOcr {
  /** Index (0-based) de la ligne dans la page. */
  readonly ligne: number;
  readonly debut: number;
  readonly fin: number;
  readonly lu: string;
  readonly corrige: string;
  readonly confusions: readonly ConfusionOcrMoteur[];
}

export interface TexteNormaliseOcr {
  /** Même nombre de caractères et de lignes que le texte d'origine. */
  readonly texte: string;
  readonly changements: readonly ChangementOcr[];
}

/** Correction proposée (même forme que `correctionOcrSchema` de `packages/shared`). */
export interface CorrectionOcrProposee {
  readonly page: number;
  readonly code: string;
  readonly libelle: string;
  readonly texte_lu: string;
  readonly montant_propose: number;
  readonly confusions: readonly ConfusionOcrMoteur[];
}

const CONFUSABLES = "OolI|";
const ALPHABET = "0123456789OolI|.,";

function estBlanc(c: string): boolean {
  return /\s/u.test(c);
}

function estChiffre(c: string): boolean {
  return c >= "0" && c <= "9";
}

function confusionDe(c: string): ConfusionOcrMoteur {
  return c === "O" || c === "o" ? "o_zero" : "l_un";
}

function verifierDecimales(decimales: number): void {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 4) {
    throw new ErreurDossier("OPTIONS_INVALIDES", "Nombre de décimales entre 0 et 4 attendu.");
  }
}

interface Mot {
  readonly debut: number;
  readonly fin: number;
  /** Cœur du mot : sans parenthèse ou signe en tête, sans parenthèse fermante en queue. */
  readonly c0: number;
  readonly c1: number;
}

function motsDe(ligne: string): Mot[] {
  const mots: Mot[] = [];
  let i = 0;
  while (i < ligne.length) {
    if (estBlanc(ligne[i] as string)) {
      i++;
      continue;
    }
    const debut = i;
    while (i < ligne.length && !estBlanc(ligne[i] as string)) i++;
    let c0 = debut;
    let c1 = i;
    for (let k = 0; k < 2 && c0 < c1 && "(-−+".includes(ligne[c0] as string); k++) c0++;
    if (c1 > c0 && ligne[c1 - 1] === ")") c1--;
    mots.push({ debut, fin: i, c0, c1 });
  }
  return mots;
}

interface Analyse {
  /** Que des chiffres, « . », « , » et des lettres confondables (« | » à l'intérieur seulement). */
  readonly valide: boolean;
  readonly lettres: number;
  readonly chiffres: number;
}

function analyserCoeur(ligne: string, m: Mot): Analyse {
  let lettres = 0;
  let chiffres = 0;
  for (let i = m.c0; i < m.c1; i++) {
    const c = ligne[i] as string;
    if (!ALPHABET.includes(c)) return { valide: false, lettres, chiffres };
    if (estChiffre(c)) chiffres++;
    else if (CONFUSABLES.includes(c)) {
      if (c === "|" && (i === m.c0 || i === m.c1 - 1)) return { valide: false, lettres, chiffres };
      lettres++;
    }
  }
  return { valide: true, lettres, chiffres };
}

function convertir(coeur: string): string {
  let sortie = "";
  for (const c of coeur)
    sortie += CONFUSABLES.includes(c) ? (confusionDe(c) === "o_zero" ? "0" : "1") : c;
  return sortie;
}

function ressembleAUneAnnee(chiffres: string): boolean {
  return (
    chiffres.length === 4 &&
    (chiffres.startsWith("19") || chiffres.startsWith("20")) &&
    [...chiffres].every(estChiffre)
  );
}

/** Vrai si un « l » ou « I » isolé précède, à un blanc, le mot `de` qui compte trois caractères. */
function lIsoleAvant(ligne: string, mots: readonly Mot[], de: number): boolean {
  if (de === 0) return false;
  const avant = mots[de - 1] as Mot;
  const suivant = mots[de] as Mot;
  const c = ligne.slice(avant.debut, avant.fin);
  return (
    (c === "l" || c === "I") && suivant.debut - avant.fin === 1 && suivant.c1 - suivant.c0 === 3
  );
}

/** Zone de montants : indices [de, a] (inclus) des mots numériques de fin de ligne, ou null. */
function zoneDesMontants(ligne: string, mots: readonly Mot[]): { de: number; a: number } | null {
  const n = mots.length;
  for (let k = 0; k <= 2 && n - k > 0; k++) {
    if (k > 0 && !resteAcceptable(ligne.slice((mots[n - k] as Mot).debut))) continue;
    const fin = n - k - 1;
    let de = fin + 1;
    while (de > 0) {
      const a = analyserCoeur(ligne, mots[de - 1] as Mot);
      if (!a.valide || a.chiffres === 0 || a.lettres >= 2) break;
      de--;
    }
    if (de > fin) continue;
    const debutInitial = de;
    const prefixe = lIsoleAvant(ligne, mots, de);
    // Un mot à lettre trop court pour être sûr n'est admis que comme groupe d'un nombre commencé.
    for (let j = de; j <= fin; j++) {
      const m = mots[j] as Mot;
      const longueur = m.c1 - m.c0;
      const a = analyserCoeur(ligne, m);
      const groupe = j > de ? m.debut - (mots[j - 1] as Mot).fin === 1 : prefixe;
      const converti = convertir(ligne.slice(m.c0, m.c1));
      if (
        a.lettres === 1 &&
        (ressembleAUneAnnee(converti) || (longueur < 4 && !(longueur === 3 && groupe)))
      ) {
        de = j + 1;
      }
    }
    if (de > fin) continue;
    if (de === debutInitial && prefixe) de--;
    return { de, a: fin };
  }
  return null;
}

function separateursDe(coeur: string): { pieces: string[]; seps: string[] } {
  const pieces: string[] = [""];
  const seps: string[] = [];
  for (const c of coeur) {
    if (c === "." || c === ",") {
      seps.push(c);
      pieces.push("");
    } else {
      pieces[pieces.length - 1] += c;
    }
  }
  return { pieces, seps };
}

/** Séparateurs mêlés ou point décimal répété : le cœur réécrit (même longueur), ou null. */
function corrigerSeparateurs(coeur: string, decimales: number): string | null {
  if (![...coeur].every((c) => estChiffre(c) || c === "." || c === ",")) return null;
  const { pieces, seps } = separateursDe(coeur);
  if (seps.length < 2) return null;
  const premier = pieces[0] as string;
  const suite = pieces.slice(1, -1);
  const dernier = pieces[pieces.length - 1] as string;
  if (premier.length < 1 || premier.length > 3 || suite.some((p) => p.length !== 3)) return null;
  const entier = (sep: string) => (sep === "." || sep === "," ? " " : sep);
  if (dernier.length === 3 && decimales <= 2 && seps.includes(".") && seps.includes(",")) {
    return [...coeur].map(entier).join("");
  }
  const dernierSep = seps[seps.length - 1] as string;
  const memeSeparateur = seps.every((s) => s === dernierSep);
  if (
    decimales >= 1 &&
    memeSeparateur &&
    dernier.length >= 1 &&
    dernier.length <= decimales &&
    dernier.length !== 3
  ) {
    let sortie = "";
    let vus = 0;
    for (const c of coeur) {
      if (c === "." || c === ",") {
        vus++;
        sortie += vus < seps.length ? " " : c;
      } else {
        sortie += c;
      }
    }
    return sortie;
  }
  return null;
}

/** Réécrit les mots de la zone des montants d'une ligne ; la ligne est inchangée sans confusion. */
function normaliserLigne(
  ligne: string,
  index: number,
  decimales: number,
  changements: ChangementOcr[],
): string {
  if (ligne.length === 0 || ligne.length > LIGNE_SOURCE_MAX) return ligne;
  ligne = ligne.split("\t").join(" ");
  const mots = motsDe(ligne);
  const zone = zoneDesMontants(ligne, mots);
  if (zone === null) return ligne;
  let sortie = ligne;
  for (let j = zone.de; j <= zone.a; j++) {
    const m = mots[j] as Mot;
    const lu = ligne.slice(m.c0, m.c1);
    const confusions = new Set<ConfusionOcrMoteur>();
    let corrige = lu;
    if ([...lu].some((c) => CONFUSABLES.includes(c))) {
      for (const c of lu) if (CONFUSABLES.includes(c)) confusions.add(confusionDe(c));
      corrige = convertir(lu);
    }
    const sep = corrigerSeparateurs(corrige, decimales);
    if (sep !== null) {
      corrige = sep;
      confusions.add("separateur");
    }
    if (corrige === lu) continue;
    sortie = sortie.slice(0, m.c0) + corrige + sortie.slice(m.c1);
    changements.push({
      ligne: index,
      debut: m.c0,
      fin: m.c1,
      lu,
      corrige,
      confusions: CONFUSIONS_OCR_MOTEUR.filter((c) => confusions.has(c)),
    });
  }
  return sortie;
}

/**
 * Texte de page normalisé des confusions classiques d'OCR (voir l'en-tête du fichier). Même longueur,
 * mêmes lignes ; `changements` liste chaque mot réécrit, dans l'ordre du texte.
 */
export function normaliserConfusionsOcr(texte: string, decimales: number): TexteNormaliseOcr {
  verifierDecimales(decimales);
  const changements: ChangementOcr[] = [];
  const lignes = texte.split("\n");
  const sorties = lignes.map((l, i) => normaliserLigne(l, i, decimales, changements));
  return changements.length === 0
    ? { texte, changements }
    : { texte: sorties.join("\n"), changements };
}

function libellesCompatibles(a: string, b: string): boolean {
  const x = plier(a).trim();
  const y = plier(b).trim();
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

/** Jeton du montant retenu (premier jeton de la ligne dont la valeur est `montant`), ou null. */
function jetonDuMontant(ligne: string, montant: number, decimales: number) {
  for (const j of reperer(ligne, decimales)) {
    if (
      j.valeur !== null &&
      Math.abs(j.valeur) === Math.abs(montant) &&
      ligne[j.debut - 1] !== "/" &&
      ligne[j.fin] !== "/"
    )
      return j;
  }
  return null;
}

function construireCorrection(
  page: number,
  code: string,
  libelle: string,
  montant: number,
  brute: string,
  normalisee: string,
  changements: readonly ChangementOcr[],
  decimales: number,
): CorrectionOcrProposee | null {
  const jeton = jetonDuMontant(normalisee, montant, decimales);
  const recouvrants = jeton
    ? changements.filter((c) => c.debut < jeton.fin && c.fin > jeton.debut)
    : [];
  const utiles = recouvrants.length > 0 ? recouvrants : changements;
  if (utiles.length === 0) return null;
  let debut = Math.min(...utiles.map((c) => c.debut));
  let fin = Math.max(...utiles.map((c) => c.fin));
  if (jeton) {
    debut = Math.min(debut, jeton.debut);
    fin = Math.max(fin, jeton.fin);
    if (fin - debut > TEXTE_LU_MAX) {
      debut = jeton.debut;
      fin = jeton.fin;
    }
  }
  let texteLu = brute.slice(debut, fin).trim();
  if (texteLu.length === 0) texteLu = (utiles[0] as ChangementOcr).lu;
  const confusions = CONFUSIONS_OCR_MOTEUR.filter((c) =>
    utiles.some((u) => u.confusions.includes(c)),
  );
  if (confusions.length === 0) return null;
  return {
    page,
    code: code.slice(0, 40),
    libelle: libelle.slice(0, LIBELLE_MAX),
    texte_lu: texteLu.slice(0, TEXTE_LU_MAX),
    montant_propose: montant,
    confusions,
  };
}

interface Candidate {
  readonly page: number;
  readonly ligne: number;
  readonly correction: CorrectionOcrProposee;
}

/** Champs d'une ligne du modèle « page | section | code | parent | role | libellé | montant ». */
function lireLigneModele(texte: string) {
  const champs = texte.split("|").map((c) => c.trim());
  if (champs.length !== 7) return null;
  return {
    code: champs[2] as string,
    libelle: champs[5] as string,
    montantTexte: champs[6] as string,
  };
}

/**
 * Corrections PROPOSÉES pour un texte de pages lu par OCR (voir l'en-tête du fichier). `extraction`
 * est celle faite sur le texte BRUT : elle n'est jamais modifiée et les propositions ne la complètent
 * pas. Sans confusion dans le texte, la liste est vide. Au plus `CORRECTIONS_OCR_PROPOSEES_MAX`
 * propositions, par page puis par ligne ; mêmes entrées, même sortie.
 */
export function proposerCorrectionsOcr(
  pages: readonly PageTexte[],
  extraction: ExtractionEtat,
  decimales: number,
): CorrectionOcrProposee[] {
  verifierDecimales(decimales);
  const normalisees: PageTexte[] = [];
  const changementsParPage = new Map<number, ChangementOcr[]>();
  let nombre = 0;
  for (const p of pages) {
    const n = normaliserConfusionsOcr(p.texte, decimales);
    normalisees.push({ numero: p.numero, texte: n.texte });
    if (n.changements.length > 0 && !changementsParPage.has(p.numero)) {
      changementsParPage.set(p.numero, [...n.changements]);
      nombre += n.changements.length;
    }
  }
  if (nombre === 0) return [];
  const brut = extraireEtatParReglesAvecRangs(pages, decimales).positions;
  const corrige = extraireEtatParReglesAvecRangs(normalisees, decimales).positions;
  const candidates: Candidate[] = [];
  const dejaVu = new Set<string>();
  const dejaRetenu = (l: LigneEtatExtraite) =>
    extraction.lignes.some(
      (r) =>
        r.page === l.page && r.montant === l.montant && libellesCompatibles(r.libelle, l.libelle),
    );

  const lignesBrutes = new Map<number, string[]>();
  const lignesNormalisees = new Map<number, string[]>();
  pages.forEach((p, i) => {
    if (!changementsParPage.has(p.numero) || lignesBrutes.has(p.numero)) return;
    lignesBrutes.set(
      p.numero,
      p.texte.split("\n").map((l) => (l.length > LIGNE_SOURCE_MAX ? l : l.split("\t").join(" "))),
    );
    lignesNormalisees.set(p.numero, (normalisees[i] as PageTexte).texte.split("\n"));
  });

  for (const [numero, changements] of changementsParPage) {
    const indexes = [...new Set(changements.map((c) => c.ligne))].sort((a, b) => a - b);
    for (const idx of indexes) {
      const cle = `${numero}:${idx + 1}`;
      const apres = corrige.get(cle);
      if (apres === undefined || dejaRetenu(apres)) continue;
      const avant = brut.get(cle);
      if (avant !== undefined && avant.montant === apres.montant) continue;
      const doLigne = changements.filter((c) => c.ligne === idx);
      const correction = construireCorrection(
        numero,
        apres.code,
        apres.libelle,
        apres.montant,
        (lignesBrutes.get(numero) as string[])[idx] as string,
        (lignesNormalisees.get(numero) as string[])[idx] as string,
        doLigne,
        decimales,
      );
      if (correction === null) continue;
      dejaVu.add(cle);
      candidates.push({ page: numero, ligne: idx, correction });
    }
  }

  // Lignes du modèle rejetées faute de montant sur la page : second essai sur la ligne normalisée.
  const examines = new Map<number, number>();
  const ancrables = new Map<string, PageAncrable>();
  for (const rejet of extraction.rejets) {
    if (rejet.motif !== "montant_absent_de_la_page" || rejet.page === null) continue;
    const changements = changementsParPage.get(rejet.page);
    if (changements === undefined) continue;
    const vus = examines.get(rejet.page) ?? 0;
    if (vus >= REJETS_IA_EXAMINES_MAX) continue;
    examines.set(rejet.page, vus + 1);
    const modele = lireLigneModele(rejet.texte);
    if (modele === null) continue;
    const montant = lireMontantIsole(modele.montantTexte, decimales);
    if (montant === null || modele.libelle.length === 0) continue;
    const indexes = [...new Set(changements.map((c) => c.ligne))]
      .sort((a, b) => a - b)
      .slice(0, LIGNES_MODIFIEES_IA_MAX);
    for (const idx of indexes) {
      const cle = `${rejet.page}:${idx + 1}`;
      if (dejaVu.has(cle)) continue;
      const normalisee = (lignesNormalisees.get(rejet.page) as string[])[idx] as string;
      let ancrable = ancrables.get(cle);
      if (ancrable === undefined) {
        ancrable = preparerPageAncrable(normalisee);
        ancrables.set(cle, ancrable);
      }
      if (ancrerMontant(ancrable, modele.libelle, modele.code, montant, decimales) !== "ancre")
        continue;
      const correction = construireCorrection(
        rejet.page,
        modele.code,
        modele.libelle,
        montant,
        (lignesBrutes.get(rejet.page) as string[])[idx] as string,
        normalisee,
        changements.filter((c) => c.ligne === idx),
        decimales,
      );
      if (correction === null) continue;
      dejaVu.add(cle);
      candidates.push({ page: rejet.page, ligne: idx, correction });
      break;
    }
  }

  candidates.sort((a, b) => a.page - b.page || a.ligne - b.ligne);
  return candidates.slice(0, CORRECTIONS_OCR_PROPOSEES_MAX).map((c) => c.correction);
}
