import { ErreurCapitalisation } from "./erreurs";
import { resumeRobuste } from "./statistiques";

/**
 * Base d'estimation (CAP-02) : temps réels par brique, observés à la validation du retour
 * d'expérience de chaque mission, filtrés par contexte (facteurs du référentiel de méthodes).
 *
 * Règle de repli : si le contexte demandé réunit au moins `effectifMinimum` missions, le résumé
 * porte sur elles (niveau « contexte ») ; sinon sur toutes les missions de la brique (niveau
 * « brique ») ; sous l'effectif minimum, AUCUNE statistique n'est rendue (niveau
 * « insuffisant ») : une estimation ne repose jamais sur une ou deux missions identifiables.
 *
 * Non-divulgation : une durée de mission est une donnée du cabinet que tous les lecteurs de la
 * base de connaissances ne doivent pas pouvoir reconstituer. Le plancher de l'effectif minimum
 * est donc 3 (une médiane de trois missions ne désigne pas une mission) ; les quartiles et les
 * extrêmes, qui sur 3 ou 4 valeurs redonnent les durées individuelles (le premier quartile de
 * trois valeurs est la moyenne des deux plus petites), ne sont rendus qu'à partir de
 * `EFFECTIF_STATISTIQUES_DETAILLEES` observations ; les effectifs inférieurs à l'effectif
 * minimum ne sont jamais rendus (`null`) : ils révéleraient qu'une brique n'a été faite qu'une
 * ou deux fois.
 */

export type ValeurContexteObservee = boolean | number | string | readonly string[];

export interface ObservationTemps {
  mission_id: string;
  brique_code: string;
  methode_code: string | null;
  realise_centiemes: number;
  contexte: Readonly<Record<string, ValeurContexteObservee | null>>;
}

export interface DemandeEstimation {
  briques: readonly string[];
  /** Facteurs exigés (valeur nulle ou absente : facteur ignoré). */
  contexte?: Readonly<Record<string, ValeurContexteObservee | null>>;
  /** Restreint aux missions de cette méthode (code), si fourni. */
  methode_code?: string | null;
  effectifMinimum?: number;
}

export type NiveauEstimation = "contexte" | "brique" | "insuffisant";

/** Statistiques rendues : médiane toujours ; quartiles, extrêmes et atypiques selon l'effectif. */
export interface ResumeEstimation {
  effectif: number;
  mediane: number;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
  atypiques: number | null;
}

export interface EstimationBrique {
  brique_code: string;
  niveau: NiveauEstimation;
  /** Missions qui vérifient le contexte demandé ; `null` sous l'effectif minimum (non divulgué). */
  effectif_contexte: number | null;
  /** Missions de la brique, tous contextes confondus ; `null` sous l'effectif minimum. */
  effectif_brique: number | null;
  /** Facteurs effectivement appliqués (vide au niveau « brique »). */
  facteurs_appliques: string[];
  resume: ResumeEstimation | null;
}

export const EFFECTIF_MINIMUM_PAR_DEFAUT = 3;
/** Plancher de l'effectif minimum : une médiane de trois missions ne désigne aucune mission. */
export const EFFECTIF_MINIMUM_PLANCHER = 3;
/** Quartiles, extrêmes et valeurs atypiques : à partir de cinq observations seulement. */
export const EFFECTIF_STATISTIQUES_DETAILLEES = 5;

function resumeEstimation(valeurs: readonly number[]): ResumeEstimation | null {
  const r = resumeRobuste(valeurs);
  if (r === null) return null;
  const detaille = r.effectif >= EFFECTIF_STATISTIQUES_DETAILLEES;
  return {
    effectif: r.effectif,
    mediane: r.mediane,
    q1: detaille ? r.q1 : null,
    q3: detaille ? r.q3 : null,
    min: detaille ? r.min : null,
    max: detaille ? r.max : null,
    atypiques: detaille ? r.atypiques : null,
  };
}

function egal(observee: ValeurContexteObservee, attendue: ValeurContexteObservee): boolean {
  if (Array.isArray(attendue)) {
    // Liste demandée : chaque code demandé figure dans la valeur observée.
    const obs = Array.isArray(observee) ? observee : [observee];
    return attendue.every((v) => obs.includes(v));
  }
  if (Array.isArray(observee)) return observee.includes(attendue as string);
  return observee === attendue;
}

/** L'observation vérifie-t-elle chaque facteur renseigné de la demande ? */
export function verifieContexteEstimation(
  contexte: ObservationTemps["contexte"],
  exige: NonNullable<DemandeEstimation["contexte"]>,
): boolean {
  return Object.entries(exige).every(([cle, attendue]) => {
    if (attendue === null || attendue === undefined) return true;
    const observee = contexte[cle];
    return observee !== null && observee !== undefined && egal(observee, attendue);
  });
}

function facteursRenseignes(contexte: DemandeEstimation["contexte"]): string[] {
  return Object.entries(contexte ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k]) => k)
    .sort();
}

/** Estimation de chaque brique demandée (ordre de la demande, sans doublon). */
export function estimerBriques(
  observations: readonly ObservationTemps[],
  demande: DemandeEstimation,
): EstimationBrique[] {
  const minimum = demande.effectifMinimum ?? EFFECTIF_MINIMUM_PAR_DEFAUT;
  if (!Number.isInteger(minimum) || minimum < EFFECTIF_MINIMUM_PLANCHER || minimum > 100) {
    throw new ErreurCapitalisation(
      "EFFECTIF_MINIMUM_INVALIDE",
      `L'effectif minimum est un entier de ${EFFECTIF_MINIMUM_PLANCHER} à 100.`,
    );
  }
  const facteurs = facteursRenseignes(demande.contexte);
  const exige = demande.contexte ?? {};
  return [...new Set(demande.briques)].map((code) => {
    const base = observations.filter(
      (o) =>
        o.brique_code === code &&
        (demande.methode_code == null || o.methode_code === demande.methode_code),
    );
    const enContexte = base.filter((o) => verifieContexteEstimation(o.contexte, exige));
    // Un effectif sous l'effectif minimum n'est jamais rendu.
    const publiable = (n: number) => (n >= minimum ? n : null);
    const resultat = (niveau: NiveauEstimation, retenues: readonly ObservationTemps[]) => ({
      brique_code: code,
      niveau,
      effectif_contexte: publiable(enContexte.length),
      effectif_brique: publiable(base.length),
      facteurs_appliques: niveau === "contexte" ? facteurs : [],
      resume:
        niveau === "insuffisant"
          ? null
          : resumeEstimation(retenues.map((o) => o.realise_centiemes)),
    });
    if (facteurs.length > 0 && enContexte.length >= minimum) {
      return resultat("contexte", enContexte);
    }
    if (base.length >= minimum) return resultat("brique", base);
    return resultat("insuffisant", []);
  });
}
