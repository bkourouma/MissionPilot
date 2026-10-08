/**
 * Bibliothèque d'initiatives types (PLA-13) : calculs purs.
 *
 * - `echeanceDepuisDuree` : échéance d'une initiative créée depuis la
 *   bibliothèque, à partir de son début et de la durée type (jours
 *   calendaires, début compris : 1 jour → échéance = début).
 * - `syntheseEfficacite` : efficacité observée (0 à 100) d'une initiative
 *   type, par contexte (secteur, taille, pays). Les observations sont
 *   regroupées du contexte le plus précis au plus large ; la synthèse RETENUE
 *   est la plus précise qui compte au moins `seuil` observations (aucune
 *   sinon : l'échantillon est insuffisant, jamais extrapolé). Moyenne et
 *   médiane entières, demi vers le haut.
 */
import { analyserDateISO, dateISODepuisJourUTC, type DateISO } from "../commun/dates";
import { ErreurPlan } from "./erreurs";

/** Durée type maximale d'une initiative (10 ans). */
export const DUREE_INITIATIVE_MAX_JOURS = 3650;

/** Observations minimales pour qu'une efficacité soit retenue (à calibrer au pilote). */
export const SEUIL_OBSERVATIONS_EFFICACITE = 3;

/** Échéance = début + durée − 1 jour (durée en jours calendaires, de 1 à 3 650). */
export function echeanceDepuisDuree(debut: DateISO, dureeJours: number): DateISO {
  const d = analyserDateISO(debut);
  if (!d.valide) throw new ErreurPlan("DATE_INVALIDE", "Date de début invalide.", "debut");
  if (!Number.isInteger(dureeJours) || dureeJours < 1 || dureeJours > DUREE_INITIATIVE_MAX_JOURS) {
    throw new ErreurPlan(
      "BIBLIOTHEQUE_INVALIDE",
      `Durée type entre 1 et ${DUREE_INITIATIVE_MAX_JOURS} jours.`,
      "duree",
    );
  }
  return dateISODepuisJourUTC(d.jourUTC + dureeJours - 1);
}

export interface ContexteEfficacite {
  readonly secteur: string | null;
  readonly taille: string | null;
  readonly pays: string | null;
}

export interface ObservationEfficacite extends ContexteEfficacite {
  /** Efficacité observée, entier de 0 à 100. */
  readonly efficacite: number;
}

export type NiveauContexte = "secteur_taille_pays" | "secteur_taille" | "secteur" | "global";

export interface SyntheseContexte {
  readonly niveau: NiveauContexte;
  readonly observations: number;
  /** null sans observation. */
  readonly moyenne: number | null;
  readonly mediane: number | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
}

export interface SyntheseEfficacite {
  /** Du plus précis au plus large ; un niveau sans critère renseigné dans le contexte est omis. */
  readonly niveaux: readonly SyntheseContexte[];
  /** Plus précis atteignant le seuil, sinon null (échantillon insuffisant). */
  readonly retenue: SyntheseContexte | null;
  readonly seuil: number;
}

const normaliser = (v: string | null) => (v === null ? null : v.trim().toLowerCase() || null);

/** Moyenne entière demi vers le haut d'entiers positifs. */
function moyenne(valeurs: readonly number[]): number {
  const somme = valeurs.reduce((s, v) => s + v, 0);
  return Math.floor((2 * somme + valeurs.length) / (2 * valeurs.length));
}

function mediane(tries: readonly number[]): number {
  const m = tries.length >> 1;
  if (tries.length % 2 === 1) return tries[m] as number;
  return moyenne([tries[m - 1] as number, tries[m] as number]);
}

function synthese(niveau: NiveauContexte, valeurs: readonly number[]): SyntheseContexte {
  if (valeurs.length === 0) {
    return { niveau, observations: 0, moyenne: null, mediane: null, minimum: null, maximum: null };
  }
  const tries = [...valeurs].sort((a, b) => a - b);
  return {
    niveau,
    observations: valeurs.length,
    moyenne: moyenne(valeurs),
    mediane: mediane(tries),
    minimum: tries[0] as number,
    maximum: tries[tries.length - 1] as number,
  };
}

/** Efficacité observée d'une initiative type, du contexte le plus précis au plus large. */
export function syntheseEfficacite(
  observations: readonly ObservationEfficacite[],
  contexte: ContexteEfficacite,
  seuil: number = SEUIL_OBSERVATIONS_EFFICACITE,
): SyntheseEfficacite {
  if (!Number.isInteger(seuil) || seuil < 1 || seuil > 1000) {
    throw new ErreurPlan("BIBLIOTHEQUE_INVALIDE", "Seuil d'observations invalide.", "seuil");
  }
  observations.forEach((o, i) => {
    if (!Number.isInteger(o.efficacite) || o.efficacite < 0 || o.efficacite > 100) {
      throw new ErreurPlan(
        "BIBLIOTHEQUE_INVALIDE",
        "Efficacité entre 0 et 100.",
        `observations[${i}].efficacite`,
      );
    }
  });
  const c = {
    secteur: normaliser(contexte.secteur),
    taille: normaliser(contexte.taille),
    pays: normaliser(contexte.pays),
  };
  const obs = observations.map((o) => ({
    secteur: normaliser(o.secteur),
    taille: normaliser(o.taille),
    pays: normaliser(o.pays),
    efficacite: o.efficacite,
  }));
  const filtres: [NiveauContexte, boolean, (o: (typeof obs)[number]) => boolean][] = [
    [
      "secteur_taille_pays",
      c.secteur !== null && c.taille !== null && c.pays !== null,
      (o) => o.secteur === c.secteur && o.taille === c.taille && o.pays === c.pays,
    ],
    [
      "secteur_taille",
      c.secteur !== null && c.taille !== null,
      (o) => o.secteur === c.secteur && o.taille === c.taille,
    ],
    ["secteur", c.secteur !== null, (o) => o.secteur === c.secteur],
    ["global", true, () => true],
  ];
  const niveaux = filtres
    .filter(([, applicable]) => applicable)
    .map(([niveau, , garde]) =>
      synthese(
        niveau,
        obs.filter(garde).map((o) => o.efficacite),
      ),
    );
  return { niveaux, retenue: niveaux.find((n) => n.observations >= seuil) ?? null, seuil };
}
