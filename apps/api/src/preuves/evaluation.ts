import {
  contradictionsAArbitrer,
  indiceSolidite,
  PLAFOND_SOLIDITE_CENTIEMES,
  regrouperPreuvesAssertion,
  regrouperPreuvesParAssertion,
  SEUILS_SOLIDITE_DEFAUT,
  type FiabilitePreuve,
  type GroupePreuvesAssertion,
  type LienPreuveAssertion,
  type PreuveAssertion,
  type SoliditeAssertion,
  type TypeSourcePreuve,
} from "@missionpilot/engines";
import type { ArbitrageLigne, LienCourant, PreuveCourante } from "./donnees.js";

/*
 * Passerelle vers le moteur du registre des preuves (packages/engines/src/preuves). L'indice de
 * solidité, sa lecture, les contradictions à arbitrer et le regroupement pour / contre ne se
 * calculent JAMAIS ici ni en SQL : cette couche ne fait que traduire les lignes de la base en
 * entrées du moteur et la sortie du moteur en JSON snake_case.
 *
 * Une contradiction (preuve « contre » liée) est RÉSOLUE si le dernier arbitrage du couple vise la
 * version courante de la preuve et date d'après le dernier événement de lien : corriger la preuve
 * ou la lier à nouveau rouvre la contradiction.
 */

export interface SoliditeVue {
  indice: number;
  numerateur: number;
  denominateur: number;
  lecture: "solide" | "etayee" | "fragile";
  fiabilites_retenues: { type_source: string; fiabilite: string; poids_centiemes: number }[];
  somme_centiemes: number;
  plafonnee: boolean;
  contradiction_non_resolue: boolean;
  preuves_pour: number;
  preuves_contre: number;
  /** Paramètres de la formule (valeurs à calibrer au pilote), pour l'explication affichée. */
  plafond_centiemes: number;
  seuil_solide: number;
  seuil_etayee: number;
}

export function vueSolidite(s: SoliditeAssertion): SoliditeVue {
  return {
    indice: s.indice,
    numerateur: s.numerateur,
    denominateur: s.denominateur,
    lecture: s.lecture,
    fiabilites_retenues: s.fiabilitesRetenues.map((f) => ({
      type_source: f.typeSource,
      fiabilite: f.fiabilite,
      poids_centiemes: f.poidsCentiemes,
    })),
    somme_centiemes: s.sommeCentiemes,
    plafonnee: s.plafonnee,
    contradiction_non_resolue: s.contradictionNonResolue,
    preuves_pour: s.preuvesPour,
    preuves_contre: s.preuvesContre,
    plafond_centiemes: PLAFOND_SOLIDITE_CENTIEMES,
    seuil_solide: SEUILS_SOLIDITE_DEFAUT.solide,
    seuil_etayee: SEUILS_SOLIDITE_DEFAUT.etayee,
  };
}

/** Contradiction arbitrée : décision sur la version courante, postérieure (à la microseconde) au lien courant. */
export function estArbitree(
  lien: LienCourant,
  preuve: Pick<PreuveCourante, "version">,
  arbitrage: ArbitrageLigne | undefined,
): boolean {
  return (
    arbitrage !== undefined &&
    arbitrage.preuve_version === preuve.version &&
    arbitrage.horodatage > lien.horodatage
  );
}

export function cleCouple(assertionId: string, preuveId: string): string {
  return `${assertionId}/${preuveId}`;
}

/** Liens courants → entrées du moteur (preuves inconnues ignorées : elles n'ont pas de version). */
export function liensPourMoteur(
  liens: readonly LienCourant[],
  preuves: ReadonlyMap<string, PreuveCourante>,
  arbitrages: ReadonlyMap<string, ArbitrageLigne>,
): LienPreuveAssertion[] {
  const sortie: LienPreuveAssertion[] = [];
  for (const lien of liens) {
    const preuve = preuves.get(lien.preuve_id);
    if (!preuve) continue;
    const base = {
      assertion: lien.assertion_id,
      id: preuve.id,
      typeSource: preuve.type_source as TypeSourcePreuve,
      fiabilite: preuve.fiabilite as FiabilitePreuve,
      sens: lien.sens,
    };
    sortie.push(
      lien.sens === "contre"
        ? {
            ...base,
            resolue: estArbitree(
              lien,
              preuve,
              arbitrages.get(cleCouple(lien.assertion_id, lien.preuve_id)),
            ),
          }
        : base,
    );
  }
  return sortie;
}

export interface EvaluationAssertion {
  solidite: SoliditeVue;
  /** Preuves « contre » à arbitrer, dans l'ordre de revue du moteur. */
  a_arbitrer: string[];
}

/** Évalue chaque assertion donnée (même sans preuve : indice 0, fragile) par le moteur. */
export function evaluerAssertions(
  assertionIds: readonly string[],
  liens: readonly LienPreuveAssertion[],
): Map<string, EvaluationAssertion> {
  const parAssertion = new Map<string, PreuveAssertion[]>();
  for (const { assertion, ...preuve } of liens) {
    const liste = parAssertion.get(assertion);
    if (liste) liste.push(preuve);
    else parAssertion.set(assertion, [preuve]);
  }
  const sortie = new Map<string, EvaluationAssertion>();
  for (const id of assertionIds) {
    const preuves = parAssertion.get(id) ?? [];
    sortie.set(id, {
      solidite: vueSolidite(indiceSolidite({ preuves })),
      a_arbitrer: [...regrouperPreuvesAssertion(preuves).aArbitrer],
    });
  }
  return sortie;
}

/** Assertions dont une contradiction reste à arbitrer (PRV-04), selon le moteur. */
export function contradictionsOuvertes(liens: readonly LienPreuveAssertion[]) {
  return contradictionsAArbitrer(liens);
}

/** Assertions dont toutes les contradictions sont arbitrées. */
export function contradictionsArbitrees(
  liens: readonly LienPreuveAssertion[],
): GroupePreuvesAssertion[] {
  return regrouperPreuvesParAssertion(liens).filter(
    (g) => g.contradiction && !g.contradictionNonResolue,
  );
}
