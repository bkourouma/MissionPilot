/**
 * Grille de notation (NOT-01) : dimensions (piliers d'excellence
 * opérationnelle, facteurs de compétitivité) pondérées, chacune composée
 * d'indicateurs qui lisent une question de questionnaire et convertissent la
 * réponse en points sur 100.
 *
 * Pondérations : chaque dimension porte un poids par défaut ; une surcharge
 * par secteur remplace tout ou partie de ces poids. Les poids sont ensuite
 * normalisés à 100 (seules les proportions comptent).
 */
import { validerDefinition } from "../questionnaires/definition";
import { FORMAT_IDENTIFIANT, POINTS_LIKERT_MAX, POINTS_LIKERT_MIN } from "../questionnaires/types";
import type {
  DefinitionQuestionnaire,
  Question,
  QuestionChoixUnique,
  QuestionLikert,
} from "../questionnaires/types";
import { ErreurNotation, type AnomalieGrille } from "./erreurs";
import {
  CENT,
  comparer,
  depuisNombre,
  diviser,
  multiplier,
  somme,
  type Fraction,
} from "./fraction";

/** Points (0-100) attribués à un code d'option. */
export interface PointsOption {
  readonly code: string;
  readonly points: number;
}

/**
 * Règle de conversion d'une réponse en points sur 100.
 * - `likert` : niveau v sur 1..n → (v − 1) / (n − 1) × 100 ; `inverse` lit
 *   l'échelle à rebours (n → 0, 1 → 100).
 * - `choix` : points du code choisi (choix unique).
 * - `choix_multiple` : somme des points des codes cochés, plafonnée à 100.
 * - `oui_non` : points de chaque réponse.
 * - `seuils` : points du dernier palier dont le minimum est ≤ valeur ; sous
 *   le premier palier, points du premier palier.
 * - `interpolation` : interpolation linéaire entre points (x, y), bornée aux
 *   extrémités.
 */
export type RegleConversion =
  | { readonly type: "likert"; readonly points: number; readonly inverse?: boolean }
  | { readonly type: "choix"; readonly valeurs: readonly PointsOption[] }
  | { readonly type: "choix_multiple"; readonly valeurs: readonly PointsOption[] }
  | { readonly type: "oui_non"; readonly oui: number; readonly non: number }
  | {
      readonly type: "seuils";
      readonly paliers: readonly { readonly min: number; readonly points: number }[];
    }
  | {
      readonly type: "interpolation";
      readonly points: readonly { readonly x: number; readonly y: number }[];
    };

export interface IndicateurGrille {
  readonly id: string;
  /** Identifiant de la question de questionnaire lue par l'indicateur. */
  readonly question: string;
  readonly poids: number;
  readonly conversion: RegleConversion;
}

export interface DimensionGrille {
  readonly id: string;
  readonly libelle: string;
  /** Famille de la dimension (ex. `excellence`, `competitivite`), pour les barres du rapport. */
  readonly famille: string;
  /** Poids par défaut (proportion : normalisé à 100 avec les autres). */
  readonly poids: number;
  readonly indicateurs: readonly IndicateurGrille[];
}

export interface SurchargeSecteur {
  readonly secteur: string;
  readonly libelle?: string;
  /** Poids remplaçant ceux par défaut ; une dimension absente garde son poids par défaut. */
  readonly poids: readonly { readonly dimension: string; readonly poids: number }[];
}

export interface GrilleNotation {
  readonly id: string;
  readonly version: number;
  readonly titre: string;
  readonly dimensions: readonly DimensionGrille[];
  readonly secteurs?: readonly SurchargeSecteur[];
}

type Collecteur = (code: string, chemin: string, message: string) => void;

const estPoints = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100;
const estPoidsPositifOuNul = (v: number) => Number.isFinite(v) && v >= 0;

function validerValeursChoix(
  valeurs: readonly PointsOption[],
  chemin: string,
  signaler: Collecteur,
) {
  if (valeurs.length === 0) signaler("CONVERSION_INVALIDE", chemin, "Aucune valeur de choix.");
  const vus = new Set<string>();
  valeurs.forEach((v, i) => {
    if (vus.has(v.code))
      signaler("CONVERSION_INVALIDE", `${chemin}.valeurs[${i}]`, `Code en double : « ${v.code} ».`);
    vus.add(v.code);
    if (!estPoints(v.points)) {
      signaler(
        "CONVERSION_INVALIDE",
        `${chemin}.valeurs[${i}]`,
        "Les points doivent être compris entre 0 et 100.",
      );
    }
  });
}

function strictementCroissante(valeurs: readonly number[]): boolean {
  return valeurs.every((v, i) => Number.isFinite(v) && (i === 0 || v > (valeurs[i - 1] as number)));
}

function validerConversion(r: RegleConversion, chemin: string, signaler: Collecteur): void {
  switch (r.type) {
    case "likert":
      if (
        !Number.isInteger(r.points) ||
        r.points < POINTS_LIKERT_MIN ||
        r.points > POINTS_LIKERT_MAX
      ) {
        signaler(
          "CONVERSION_INVALIDE",
          chemin,
          `Échelle de Likert invalide (${r.points} niveaux).`,
        );
      }
      return;
    case "choix":
    case "choix_multiple":
      validerValeursChoix(r.valeurs, chemin, signaler);
      return;
    case "oui_non":
      if (!estPoints(r.oui) || !estPoints(r.non)) {
        signaler("CONVERSION_INVALIDE", chemin, "Les points doivent être compris entre 0 et 100.");
      }
      return;
    case "seuils":
      if (
        r.paliers.length === 0 ||
        !strictementCroissante(r.paliers.map((p) => p.min)) ||
        !r.paliers.every((p) => estPoints(p.points))
      ) {
        signaler(
          "CONVERSION_INVALIDE",
          chemin,
          "Paliers attendus : minimums strictement croissants, points entre 0 et 100.",
        );
      }
      return;
    case "interpolation":
      if (
        r.points.length < 2 ||
        !strictementCroissante(r.points.map((p) => p.x)) ||
        !r.points.every((p) => estPoints(p.y))
      ) {
        signaler(
          "CONVERSION_INVALIDE",
          chemin,
          "Au moins deux points attendus : abscisses strictement croissantes, ordonnées entre 0 et 100.",
        );
      }
      return;
  }
}

/** Valide la structure d'une grille ; rend toutes les anomalies (ne lève jamais). */
export function validerGrille(grille: GrilleNotation): AnomalieGrille[] {
  const erreurs: AnomalieGrille[] = [];
  const signaler: Collecteur = (code, chemin, message) => erreurs.push({ code, chemin, message });

  if (!FORMAT_IDENTIFIANT.test(grille.id))
    signaler("IDENTIFIANT_INVALIDE", "id", `Identifiant de grille invalide : « ${grille.id} ».`);
  if (!Number.isInteger(grille.version) || grille.version < 1)
    signaler("VERSION_INVALIDE", "version", "La version doit être un entier positif.");
  if (grille.titre.trim() === "") signaler("LIBELLE_VIDE", "titre", "La grille n'a pas de titre.");
  if (grille.dimensions.length === 0)
    signaler("DIMENSIONS_VIDES", "dimensions", "La grille ne contient aucune dimension.");

  const dimensions = new Set<string>();
  const indicateurs = new Set<string>();
  const questions = new Set<string>();
  grille.dimensions.forEach((d, i) => {
    const chemin = `dimensions[${i}]`;
    if (!FORMAT_IDENTIFIANT.test(d.id))
      signaler("IDENTIFIANT_INVALIDE", chemin, `Identifiant de dimension invalide : « ${d.id} ».`);
    if (dimensions.has(d.id))
      signaler("IDENTIFIANT_DOUBLON", chemin, `Dimension en double : « ${d.id} ».`);
    dimensions.add(d.id);
    if (d.libelle.trim() === "")
      signaler("LIBELLE_VIDE", chemin, `La dimension « ${d.id} » n'a pas de libellé.`);
    if (!FORMAT_IDENTIFIANT.test(d.famille))
      signaler("IDENTIFIANT_INVALIDE", chemin, `Famille invalide : « ${d.famille} ».`);
    if (!estPoidsPositifOuNul(d.poids))
      signaler("POIDS_INVALIDE", chemin, `Poids invalide pour « ${d.id} ».`);
    if (d.indicateurs.length === 0)
      signaler("INDICATEURS_VIDES", chemin, `La dimension « ${d.id} » n'a aucun indicateur.`);
    d.indicateurs.forEach((ind, j) => {
      const ci = `${chemin}.indicateurs[${j}]`;
      if (!FORMAT_IDENTIFIANT.test(ind.id))
        signaler("IDENTIFIANT_INVALIDE", ci, `Identifiant d'indicateur invalide : « ${ind.id} ».`);
      if (indicateurs.has(ind.id))
        signaler("IDENTIFIANT_DOUBLON", ci, `Indicateur en double : « ${ind.id} ».`);
      indicateurs.add(ind.id);
      if (questions.has(ind.question))
        signaler("QUESTION_DOUBLON", ci, `La question « ${ind.question} » est notée deux fois.`);
      questions.add(ind.question);
      if (!Number.isFinite(ind.poids) || ind.poids <= 0)
        signaler("POIDS_INVALIDE", ci, `Poids invalide pour « ${ind.id} ».`);
      validerConversion(ind.conversion, `${ci}.conversion`, signaler);
    });
  });
  if (grille.dimensions.every((d) => !(d.poids > 0))) {
    signaler("POIDS_INVALIDE", "dimensions", "Au moins une dimension doit avoir un poids positif.");
  }

  const secteurs = new Set<string>();
  (grille.secteurs ?? []).forEach((s, i) => {
    const chemin = `secteurs[${i}]`;
    if (!FORMAT_IDENTIFIANT.test(s.secteur))
      signaler("IDENTIFIANT_INVALIDE", chemin, `Code de secteur invalide : « ${s.secteur} ».`);
    if (secteurs.has(s.secteur))
      signaler("IDENTIFIANT_DOUBLON", chemin, `Secteur en double : « ${s.secteur} ».`);
    secteurs.add(s.secteur);
    const vus = new Set<string>();
    s.poids.forEach((p, j) => {
      const cp = `${chemin}.poids[${j}]`;
      if (!dimensions.has(p.dimension))
        signaler("DIMENSION_INCONNUE", cp, `Dimension inconnue : « ${p.dimension} ».`);
      if (vus.has(p.dimension))
        signaler("IDENTIFIANT_DOUBLON", cp, `Dimension surchargée deux fois : « ${p.dimension} ».`);
      vus.add(p.dimension);
      if (!estPoidsPositifOuNul(p.poids))
        signaler("POIDS_INVALIDE", cp, `Poids invalide pour « ${p.dimension} ».`);
    });
    const total = grille.dimensions.map(
      (d) => s.poids.find((p) => p.dimension === d.id)?.poids ?? d.poids,
    );
    if (total.every((p) => !(p > 0))) {
      signaler(
        "POIDS_INVALIDE",
        chemin,
        `Le secteur « ${s.secteur} » n'a aucune dimension pondérée.`,
      );
    }
  });
  return erreurs;
}

/** Lève `GRILLE_INVALIDE` avec le détail si la grille n'est pas valide. */
export function exigerGrilleValide(grille: GrilleNotation): void {
  const erreurs = validerGrille(grille);
  if (erreurs.length > 0) {
    throw new ErreurNotation(
      "GRILLE_INVALIDE",
      `Grille invalide (${erreurs.length} anomalie(s)).`,
      erreurs,
    );
  }
}

/** Poids bruts (avant normalisation) applicables au secteur, et secteur effectivement appliqué. */
function poidsBruts(grille: GrilleNotation, secteur: string | undefined) {
  const surcharge =
    secteur === undefined ? undefined : grille.secteurs?.find((s) => s.secteur === secteur);
  return {
    secteurApplique: surcharge?.secteur ?? null,
    poids: grille.dimensions.map((d) => {
      const p = surcharge?.poids.find((x) => x.dimension === d.id)?.poids ?? d.poids;
      return { dimension: d.id, poids: depuisNombre(p, `poids de ${d.id}`) };
    }),
  };
}

/**
 * Poids exacts des dimensions, normalisés pour que leur somme vaille 100.
 * Un secteur absent de la grille applique les poids par défaut
 * (`secteurApplique` vaut alors `null`). La grille doit être valide.
 */
export function poidsExacts(
  grille: GrilleNotation,
  secteur?: string,
): { secteurApplique: string | null; poids: { dimension: string; poids: Fraction }[] } {
  const bruts = poidsBruts(grille, secteur);
  const total = somme(bruts.poids.map((p) => p.poids));
  return {
    secteurApplique: bruts.secteurApplique,
    poids: bruts.poids.map((p) => ({
      dimension: p.dimension,
      poids: multiplier(diviser(p.poids, total), CENT),
    })),
  };
}

/**
 * Poids normalisés à 100 pour l'affichage, au centième, par la méthode du
 * plus fort reste : la somme affichée vaut exactement 100 (égalité de reste
 * départagée par l'ordre de la grille).
 */
export function poidsNormalises(
  grille: GrilleNotation,
  secteur?: string,
): { secteurApplique: string | null; poids: { dimension: string; poids: number }[] } {
  exigerGrilleValide(grille);
  const exacts = poidsExacts(grille, secteur);
  const centiemes = exacts.poids.map((p, rang) => {
    const n = p.poids.num * 100n;
    return { rang, entier: n / p.poids.den, reste: { num: n % p.poids.den, den: p.poids.den } };
  });
  let manque = 10_000n - centiemes.reduce((s, c) => s + c.entier, 0n);
  const parReste = [...centiemes].sort((a, b) => comparer(b.reste, a.reste) || a.rang - b.rang);
  for (const c of parReste) {
    if (manque === 0n) break;
    c.entier += 1n;
    manque -= 1n;
  }
  return {
    secteurApplique: exacts.secteurApplique,
    poids: exacts.poids.map((p, i) => ({
      dimension: p.dimension,
      poids: Number((centiemes[i] as { entier: bigint }).entier) / 100,
    })),
  };
}

function typeAttendu(r: RegleConversion): Question["type"] {
  switch (r.type) {
    case "likert":
      return "likert";
    case "choix":
      return "choix_unique";
    case "choix_multiple":
      return "choix_multiple";
    case "oui_non":
      return "oui_non";
    default:
      return "numerique";
  }
}

/**
 * Vérifie qu'une grille et un questionnaire s'accordent : chaque indicateur
 * lit une question existante, de type compatible (même nombre de niveaux de
 * Likert, toutes les options valorisées et aucune option inconnue). Rend
 * toutes les anomalies, y compris celles de la grille et de la définition.
 */
export function verifierCoherence(
  grille: GrilleNotation,
  definition: DefinitionQuestionnaire,
): AnomalieGrille[] {
  const erreurs: AnomalieGrille[] = [...validerGrille(grille)];
  for (const e of validerDefinition(definition).erreurs) {
    erreurs.push({ ...e, chemin: `questionnaire.${e.chemin}` });
  }
  const questions = new Map(
    definition.sections.flatMap((s) => s.questions.map((q) => [q.id, q] as const)),
  );
  grille.dimensions.forEach((d, i) =>
    d.indicateurs.forEach((ind, j) => {
      const chemin = `dimensions[${i}].indicateurs[${j}]`;
      const q = questions.get(ind.question);
      if (q === undefined) {
        erreurs.push({
          code: "QUESTION_INCONNUE",
          chemin,
          message: `Question inconnue : « ${ind.question} ».`,
        });
        return;
      }
      const r = ind.conversion;
      if (q.type !== typeAttendu(r)) {
        erreurs.push({
          code: "TYPE_INCOMPATIBLE",
          chemin,
          message: `La règle « ${r.type} » ne s'applique pas à la question « ${q.id} » (${q.type}).`,
        });
        return;
      }
      if (r.type === "likert" && r.points !== (q as QuestionLikert).points) {
        erreurs.push({
          code: "TYPE_INCOMPATIBLE",
          chemin,
          message: `La question « ${q.id} » a ${(q as QuestionLikert).points} niveaux, la règle en attend ${r.points}.`,
        });
      }
      if (r.type === "choix" || r.type === "choix_multiple") {
        const codesQuestion = (q as QuestionChoixUnique).options.map((o) => o.code);
        const codesRegle = r.valeurs.map((v) => v.code);
        const manquants = codesQuestion.filter((c) => !codesRegle.includes(c));
        const inconnus = codesRegle.filter((c) => !codesQuestion.includes(c));
        if (manquants.length > 0 || inconnus.length > 0) {
          erreurs.push({
            code: "OPTIONS_INCOHERENTES",
            chemin,
            message: `Options de « ${q.id} » : non valorisées [${manquants.join(", ")}], inconnues [${inconnus.join(", ")}].`,
          });
        }
      }
    }),
  );
  return erreurs;
}

/** Lève `GRILLE_INVALIDE` si la grille et le questionnaire ne s'accordent pas. */
export function exigerCoherence(grille: GrilleNotation, definition: DefinitionQuestionnaire): void {
  const erreurs = verifierCoherence(grille, definition);
  if (erreurs.length > 0) {
    throw new ErreurNotation(
      "GRILLE_INVALIDE",
      `Grille et questionnaire incohérents (${erreurs.length} anomalie(s)).`,
      erreurs,
    );
  }
}
