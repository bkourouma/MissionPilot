/**
 * Géométrie du graphique de trésorerie du modèle financier (SVG). Logique pure, testée dans
 * `plan-graphique.test.ts`.
 *
 * Ce module ne fait que PLACER des points : il convertit les valeurs du moteur (trésorerie
 * nette de clôture, inchangée) en coordonnées d'écran. Aucun repère chiffré n'est inventé :
 * l'axe ne porte que le zéro, les valeurs exactes sont dans le tableau qui accompagne le
 * graphique (alternative accessible) et dans l'infobulle de chaque point.
 */
import type { NomScenario, ResultatScenarios } from "./plan-modele";
import { exercicesTresorerieNegative, SCENARIOS, SCENARIO_LIBELLES } from "./plan-modele";

export interface PointTresorerie {
  exercice: number;
  valeur: number;
}

export interface SerieTresorerie {
  scenario: NomScenario;
  libelle: string;
  points: PointTresorerie[];
}

export interface MarqueurGraphique extends PointTresorerie {
  x: number;
  y: number;
}

export interface GeometrieTresorerie {
  largeur: number;
  hauteur: number;
  /** Zone de tracé. */
  gauche: number;
  droite: number;
  haut: number;
  bas: number;
  /** Ordonnée de la ligne du zéro. */
  yZero: number;
  abscisses: { exercice: number; x: number }[];
  series: {
    scenario: NomScenario;
    libelle: string;
    points: string;
    marqueurs: MarqueurGraphique[];
  }[];
}

/** Trésorerie nette de clôture de chaque scénario, telle que rendue par le moteur. */
export function seriesTresorerie(r: Pick<ResultatScenarios, NomScenario>): SerieTresorerie[] {
  return SCENARIOS.map((s) => ({
    scenario: s,
    libelle: SCENARIO_LIBELLES[s],
    points: (r[s]?.annees ?? []).map((a) => ({
      exercice: a.exercice,
      valeur: a.bilan.tresorerieNette,
    })),
  }));
}

const arrondi = (v: number) => Math.round(v * 10) / 10;

/**
 * Place les séries dans un repère `largeur × hauteur` (unités du viewBox) ; le zéro est
 * toujours visible. `null` sans aucun point à tracer.
 */
export function geometrieTresorerie(
  series: readonly SerieTresorerie[],
  dimensions: { largeur?: number; hauteur?: number } = {},
): GeometrieTresorerie | null {
  const largeur = dimensions.largeur ?? 400;
  const hauteur = dimensions.hauteur ?? 220;
  const valeurs = series.flatMap((s) => s.points.map((p) => p.valeur));
  const reference = series.find((s) => s.points.length > 0);
  if (!reference || valeurs.length === 0) return null;
  const gauche = 24;
  const droite = largeur - 16;
  const haut = 12;
  const bas = hauteur - 28;
  const min = Math.min(0, ...valeurs);
  const max = Math.max(0, ...valeurs);
  const etendue = max - min || 1;
  const y = (v: number) => arrondi(haut + ((max - v) / etendue) * (bas - haut));
  const n = reference.points.length;
  const pas = n > 1 ? (droite - gauche) / (n - 1) : 0;
  const x = (i: number) => arrondi(n > 1 ? gauche + i * pas : (gauche + droite) / 2);
  return {
    largeur,
    hauteur,
    gauche,
    droite,
    haut,
    bas,
    yZero: y(0),
    abscisses: reference.points.map((p, i) => ({ exercice: p.exercice, x: x(i) })),
    series: series.map((s) => {
      const marqueurs = s.points.map((p, i) => ({ ...p, x: x(i), y: y(p.valeur) }));
      return {
        scenario: s.scenario,
        libelle: s.libelle,
        points: marqueurs.map((m) => `${m.x},${m.y}`).join(" "),
        marqueurs,
      };
    }),
  };
}

/** Forme d'un marqueur par scénario (la couleur ne porte pas seule la distinction). */
export const MARQUEURS: Record<NomScenario, "cercle" | "carre" | "triangle"> = {
  base: "cercle",
  optimiste: "carre",
  pessimiste: "triangle",
};

/** Points d'un triangle centré en (x, y). */
export function pointsTriangle(x: number, y: number, r = 5): string {
  return `${arrondi(x)},${arrondi(y - r)} ${arrondi(x + r)},${arrondi(y + r)} ${arrondi(x - r)},${arrondi(y + r)}`;
}

/** Motif de chaque série, écrit dans la légende et la description. */
export const TRAITS: Record<NomScenario, string> = {
  base: "trait plein et points ronds",
  optimiste: "tirets et points carrés",
  pessimiste: "pointillés et points triangulaires",
};

/**
 * Description du graphique pour les lecteurs d'écran : motif de chaque scénario et années de
 * trésorerie négative (d'après les alertes du moteur, sans calcul).
 */
export function descriptionGraphique(r: Pick<ResultatScenarios, NomScenario>): string {
  const negatifs = SCENARIOS.map((s) => ({ s, annees: exercicesTresorerieNegative(r[s]) }))
    .filter((x) => x.annees.length > 0)
    .map((x) => `${SCENARIO_LIBELLES[x.s].toLowerCase()} en ${x.annees.join(", ")}`);
  const traits = SCENARIOS.map((s) => `${SCENARIO_LIBELLES[s].toLowerCase()} en ${TRAITS[s]}`);
  const tresorerie = negatifs.length
    ? `Trésorerie négative : ${negatifs.join(" ; ")}.`
    : "La trésorerie reste positive ou nulle dans les trois scénarios.";
  return `Scénarios : ${traits.join(" ; ")}. ${tresorerie} Les valeurs exactes figurent dans le tableau qui suit.`;
}
