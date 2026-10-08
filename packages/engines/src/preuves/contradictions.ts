/**
 * Regroupement des preuves « pour » et « contre » d'une assertion (PRV-02,
 * PRV-04). Une assertion qui a au moins une preuve contre porte une
 * contradiction ; elle est NON RÉSOLUE tant qu'une preuve contre n'a pas été
 * arbitrée par le consultant (`resolue`). La détection elle-même (agent
 * contradicteur) relève de l'IA ; le moteur ne fait que ranger et compter.
 *
 * Ordre stable : les groupes par identifiant d'assertion, les preuves de
 * chaque côté par fiabilité (A d'abord) puis identifiant.
 */
import { ErreurPreuves } from "./erreurs";
import {
  comparerIdentifiants,
  comparerPreuves,
  verifierIdentifiant,
  verifierPreuve,
  type PreuveAssertion,
} from "./preuve";

export interface PreuvesRegroupees {
  readonly pour: readonly PreuveAssertion[];
  readonly contre: readonly PreuveAssertion[];
  /** Au moins une preuve contre. */
  readonly contradiction: boolean;
  /** Au moins une preuve contre non arbitrée. */
  readonly contradictionNonResolue: boolean;
  /** Identifiants des preuves contre à arbitrer, dans l'ordre de revue. */
  readonly aArbitrer: readonly string[];
}

/** Lien d'une preuve à une assertion (une même preuve peut servir plusieurs assertions). */
export interface LienPreuveAssertion extends PreuveAssertion {
  readonly assertion: string;
}

export interface GroupePreuvesAssertion extends PreuvesRegroupees {
  readonly assertion: string;
}

/**
 * Sépare les preuves d'UNE assertion en « pour » et « contre ». Une même
 * preuve ne peut figurer deux fois (ni des deux côtés) : `PREUVE_INVALIDE`.
 */
export function regrouperPreuvesAssertion(preuves: readonly PreuveAssertion[]): PreuvesRegroupees {
  const vues = new Set<string>();
  const pour: PreuveAssertion[] = [];
  const contre: PreuveAssertion[] = [];
  for (const preuve of preuves) {
    verifierPreuve(preuve, true);
    if (vues.has(preuve.id)) {
      throw new ErreurPreuves("PREUVE_INVALIDE", "Preuve rattachée deux fois à la même assertion.");
    }
    vues.add(preuve.id);
    (preuve.sens === "pour" ? pour : contre).push(preuve);
  }
  pour.sort(comparerPreuves);
  contre.sort(comparerPreuves);
  const aArbitrer = contre.filter((p) => p.resolue !== true).map((p) => p.id);
  return {
    pour,
    contre,
    contradiction: contre.length > 0,
    contradictionNonResolue: aArbitrer.length > 0,
    aArbitrer,
  };
}

/** Regroupe des liens preuve → assertion par assertion, groupes triés par identifiant. */
export function regrouperPreuvesParAssertion(
  liens: readonly LienPreuveAssertion[],
): GroupePreuvesAssertion[] {
  const parAssertion = new Map<string, PreuveAssertion[]>();
  for (const lien of liens) {
    if (typeof lien.assertion !== "string" || lien.assertion === "") {
      throw new ErreurPreuves("ASSERTION_INVALIDE", "Identifiant d'assertion absent.");
    }
    verifierIdentifiant(lien.id, "de preuve");
    const { assertion, ...preuve } = lien;
    const groupe = parAssertion.get(assertion);
    if (groupe) groupe.push(preuve);
    else parAssertion.set(assertion, [preuve]);
  }
  return [...parAssertion.keys()].sort(comparerIdentifiants).map((assertion) => ({
    assertion,
    ...regrouperPreuvesAssertion(parAssertion.get(assertion)!),
  }));
}

/** Assertions dont une contradiction reste à arbitrer (PRV-04), dans l'ordre des identifiants. */
export function contradictionsAArbitrer(
  liens: readonly LienPreuveAssertion[],
): GroupePreuvesAssertion[] {
  return regrouperPreuvesParAssertion(liens).filter((g) => g.contradictionNonResolue);
}
