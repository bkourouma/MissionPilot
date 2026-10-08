/**
 * Écarts de perception signalés comme CONSTATS (NOT-10, PRD complémentaire §11.1).
 *
 * Les écarts sont détectés par le moteur existant (`detecterEcarts`, brique
 * `notation.ecarts_perception` du référentiel) ; ce moteur les rattache aux POPULATIONS de
 * répondants (dirigeants, managers, équipes, parties externes : fonction déclarée à l'envoi, à
 * défaut rôle du portail) et les rédige en constats déterministes :
 * - `entre_populations` si les niveaux extrêmes viennent de populations différentes ;
 *   `interne` si une même population est divisée ;
 * - gravité `majeur` à partir de `seuilMajeur` niveaux d'écart (3 par défaut, à calibrer),
 *   `notable` en dessous ;
 * - ordre : écart décroissant, puis ordre des questions reçu (stable).
 * Aucun chiffre n'est produit ici : niveaux et écarts sont ceux de `detecterEcarts`.
 */
import type { EcartRepondants } from "../questionnaires/incoherences";
import { ErreurNotationAugmentee } from "./augmentee-erreurs";

export const SEUIL_CONSTAT_MAJEUR_DEFAUT = 3;
export const POPULATION_NON_PRECISEE = "non précisée";

export interface PopulationRepondant {
  readonly repondant: string;
  readonly population: string;
}

export type TypeConstat = "entre_populations" | "interne";
export type GraviteConstat = "majeur" | "notable";

export interface ConstatPerception {
  readonly question: string;
  readonly libelle: string;
  readonly type: TypeConstat;
  readonly gravite: GraviteConstat;
  readonly ecart: number;
  readonly niveauBas: number;
  readonly niveauHaut: number;
  readonly populationsBasses: readonly string[];
  readonly populationsHautes: readonly string[];
  readonly nombreRepondants: number;
  readonly enonce: string;
}

function populationsDe(ids: readonly string[], parId: ReadonlyMap<string, string>): string[] {
  return [...new Set(ids.map((id) => parId.get(id) ?? POPULATION_NON_PRECISEE))].sort();
}

const liste = (p: readonly string[]) => p.map((x) => `« ${x} »`).join(", ");

function enonce(c: Omit<ConstatPerception, "enonce">): string {
  const sujet = `Sur « ${c.libelle} »`;
  if (c.type === "interne") {
    return `${sujet}, la population ${liste(c.populationsHautes)} est divisée : de ${c.niveauBas} à ${c.niveauHaut} (écart de ${c.ecart} niveaux).`;
  }
  return `${sujet}, ${liste(c.populationsHautes)} répond au niveau ${c.niveauHaut} et ${liste(c.populationsBasses)} au niveau ${c.niveauBas} (écart de ${c.ecart} niveaux).`;
}

/** Constats de perception depuis les écarts du moteur et les populations des répondants. */
export function constatsPerception(
  ecarts: readonly EcartRepondants[],
  populations: readonly PopulationRepondant[],
  options: { readonly seuilMajeur?: number } = {},
): ConstatPerception[] {
  const seuil = options.seuilMajeur ?? SEUIL_CONSTAT_MAJEUR_DEFAUT;
  if (!Number.isInteger(seuil) || seuil < 1) {
    throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", "Seuil de constat majeur : entier ≥ 1.");
  }
  const parId = new Map(
    populations.map((p) => [p.repondant, p.population.trim() || POPULATION_NON_PRECISEE]),
  );
  return ecarts
    .map((e, rang) => {
      const basses = populationsDe(e.repondantsMin, parId);
      const hautes = populationsDe(e.repondantsMax, parId);
      const memes = basses.length === 1 && hautes.length === 1 && basses[0] === hautes[0];
      const base = {
        question: e.question,
        libelle: e.libelle,
        type: (memes ? "interne" : "entre_populations") as TypeConstat,
        gravite: (e.ecart >= seuil ? "majeur" : "notable") as GraviteConstat,
        ecart: e.ecart,
        niveauBas: e.min,
        niveauHaut: e.max,
        populationsBasses: basses,
        populationsHautes: hautes,
        nombreRepondants: e.nombreRepondants,
      };
      return { rang, constat: { ...base, enonce: enonce(base) } };
    })
    .sort((a, b) => b.constat.ecart - a.constat.ecart || a.rang - b.rang)
    .map((x) => x.constat);
}
