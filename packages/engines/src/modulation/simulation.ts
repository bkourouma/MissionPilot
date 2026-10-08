/**
 * Simulation et cas types (STD-05) : « simulable avant activation, testée sur
 * des cas types ».
 *
 * - `comparerModulations` : différentiel entre deux résultats (effets ajoutés,
 *   retirés, modifiés ; règles qui se déclenchent ou s'éteignent) ; sert aussi
 *   à comparer deux JEUX de règles sur un même contexte ;
 * - `simulerModulation` : même jeu de règles, contexte avant et après ;
 * - `executerCasTypes` : rejoue des cas types et compare aux attendus
 *   (effets présents, effets absents, règles déclenchées, conflits non
 *   résolus). Un cas type ne lève pas : ses écarts sont listés.
 */
import {
  appliquerModulation,
  type OptionsModulation,
  type ResultatModulation,
} from "./application";
import { comparerCodes, signatureEffet, valeurEffet, type EffetApplique } from "./effets";
import { ErreurModulation } from "./erreurs";
import { anomaliesStructure, estCodeModulation } from "./structure";
import type { ContexteModulation, EffetModulation, RegleModulation } from "./types";

export interface EffetModifie {
  readonly cle: string;
  readonly avant: EffetApplique;
  readonly apres: EffetApplique;
}

export interface DifferentielModulation {
  readonly identique: boolean;
  /** Effets présents seulement après, triés par clé. */
  readonly ajoutes: readonly EffetApplique[];
  /** Effets présents seulement avant, triés par clé. */
  readonly retires: readonly EffetApplique[];
  /** Même clé, autre valeur, triés par clé. */
  readonly modifies: readonly EffetModifie[];
  /** Règles déclenchées après mais pas avant, triées. */
  readonly reglesDeclenchees: readonly string[];
  /** Règles déclenchées avant mais plus après, triées. */
  readonly reglesEteintes: readonly string[];
  /** Variation du nombre de conflits non résolus (après − avant). */
  readonly variationConflitsNonResolus: number;
}

function nonResolus(r: ResultatModulation): number {
  return r.conflits.filter((c) => !c.resolu).length;
}

export function comparerModulations(
  avant: ResultatModulation,
  apres: ResultatModulation,
): DifferentielModulation {
  const parCleAvant = new Map(avant.effets.map((e) => [e.cle, e]));
  const parCleApres = new Map(apres.effets.map((e) => [e.cle, e]));
  const cles = [...new Set([...parCleAvant.keys(), ...parCleApres.keys()])].sort(comparerCodes);
  const ajoutes: EffetApplique[] = [];
  const retires: EffetApplique[] = [];
  const modifies: EffetModifie[] = [];
  for (const cle of cles) {
    const a = parCleAvant.get(cle);
    const b = parCleApres.get(cle);
    if (!a) ajoutes.push(b!);
    else if (!b) retires.push(a);
    else if (valeurEffet(a.effet) !== valeurEffet(b.effet))
      modifies.push({ cle, avant: a, apres: b });
  }
  const avantR = new Set(avant.reglesDeclenchees);
  const apresR = new Set(apres.reglesDeclenchees);
  const reglesDeclenchees = [...apresR].filter((r) => !avantR.has(r)).sort(comparerCodes);
  const reglesEteintes = [...avantR].filter((r) => !apresR.has(r)).sort(comparerCodes);
  const variation = nonResolus(apres) - nonResolus(avant);
  return {
    identique:
      ajoutes.length +
        retires.length +
        modifies.length +
        reglesDeclenchees.length +
        reglesEteintes.length ===
        0 && variation === 0,
    ajoutes,
    retires,
    modifies,
    reglesDeclenchees,
    reglesEteintes,
    variationConflitsNonResolus: variation,
  };
}

export interface SimulationModulation {
  readonly avant: ResultatModulation;
  readonly apres: ResultatModulation;
  readonly differentiel: DifferentielModulation;
}

/** Applique le même jeu de règles à deux contextes et renvoie le différentiel. */
export function simulerModulation(
  regles: readonly RegleModulation[],
  contexteAvant: ContexteModulation,
  contexteApres: ContexteModulation,
  options: OptionsModulation = {},
): SimulationModulation {
  const avant = appliquerModulation(regles, contexteAvant, options);
  const apres = appliquerModulation(regles, contexteApres, options);
  return { avant, apres, differentiel: comparerModulations(avant, apres) };
}

export interface AttenduCasType {
  /** Effets qui doivent être appliqués. */
  readonly presents?: readonly EffetModulation[];
  /** Effets qui ne doivent pas être appliqués. */
  readonly absents?: readonly EffetModulation[];
  /** Ensemble exact des règles déclenchées (ordre indifférent). */
  readonly reglesDeclenchees?: readonly string[];
  /** Nombre exact de conflits non résolus. */
  readonly conflitsNonResolus?: number;
}

export interface CasTypeModulation {
  readonly code: string;
  readonly contexte: ContexteModulation;
  readonly briquesDeBase?: readonly string[];
  readonly attendu: AttenduCasType;
}

export type EcartCasType =
  | { readonly type: "EFFET_MANQUANT"; readonly effet: EffetModulation }
  | { readonly type: "EFFET_INATTENDU"; readonly effet: EffetModulation }
  | {
      readonly type: "REGLES_DECLENCHEES";
      readonly attendues: readonly string[];
      readonly obtenues: readonly string[];
    }
  | { readonly type: "CONFLITS"; readonly attendus: number; readonly obtenus: number };

export interface ResultatCasType {
  readonly code: string;
  readonly reussi: boolean;
  readonly ecarts: readonly EcartCasType[];
  readonly resultat: ResultatModulation;
}

export interface ExecutionCasTypes {
  readonly reussi: boolean;
  readonly reussis: number;
  readonly echoues: number;
  /** Cas dans l'ordre reçu. */
  readonly cas: readonly ResultatCasType[];
}

function verifierCas(casTypes: readonly CasTypeModulation[]): void {
  if (!Array.isArray(casTypes)) {
    throw new ErreurModulation("CAS_TYPE_INVALIDE", "Liste de cas types attendue.", "casTypes");
  }
  const codes = new Set<string>();
  casTypes.forEach((cas, i) => {
    const chemin = `casTypes[${i}]`;
    if (!estCodeModulation(cas?.code) || codes.has(cas.code)) {
      throw new ErreurModulation(
        "CAS_TYPE_INVALIDE",
        "Code de cas type absent ou en double.",
        `${chemin}.code`,
      );
    }
    codes.add(cas.code);
    const a = cas.attendu;
    const effets = [...(a?.presents ?? []), ...(a?.absents ?? [])];
    const factice: RegleModulation = {
      code: "attendu",
      priorite: 0,
      condition: { type: "brique_active", brique: "attendu" },
      effets,
    };
    const forme = anomaliesStructure([factice])[0];
    const conflits = a?.conflitsNonResolus;
    if (
      typeof a !== "object" ||
      a === null ||
      forme !== undefined ||
      (conflits !== undefined && (!Number.isInteger(conflits) || conflits < 0)) ||
      (a.reglesDeclenchees !== undefined && !Array.isArray(a.reglesDeclenchees))
    ) {
      throw new ErreurModulation(
        "CAS_TYPE_INVALIDE",
        "Attendus du cas type invalides.",
        `${chemin}.attendu`,
      );
    }
  });
}

function ecartsCas(cas: CasTypeModulation, resultat: ResultatModulation): EcartCasType[] {
  const appliques = new Set(resultat.effets.map((e) => signatureEffet(e.effet)));
  const ecarts: EcartCasType[] = [];
  for (const effet of cas.attendu.presents ?? []) {
    if (!appliques.has(signatureEffet(effet))) ecarts.push({ type: "EFFET_MANQUANT", effet });
  }
  for (const effet of cas.attendu.absents ?? []) {
    if (appliques.has(signatureEffet(effet))) ecarts.push({ type: "EFFET_INATTENDU", effet });
  }
  const attendues = cas.attendu.reglesDeclenchees;
  if (attendues !== undefined) {
    const a = [...new Set(attendues)].sort(comparerCodes);
    const o = [...resultat.reglesDeclenchees].sort(comparerCodes);
    if (a.join("\u0000") !== o.join("\u0000")) {
      ecarts.push({ type: "REGLES_DECLENCHEES", attendues: a, obtenues: o });
    }
  }
  const conflits = cas.attendu.conflitsNonResolus;
  if (conflits !== undefined && conflits !== nonResolus(resultat)) {
    ecarts.push({ type: "CONFLITS", attendus: conflits, obtenus: nonResolus(resultat) });
  }
  return ecarts;
}

/** Rejoue chaque cas type et liste ses écarts aux attendus. */
export function executerCasTypes(
  regles: readonly RegleModulation[],
  casTypes: readonly CasTypeModulation[],
): ExecutionCasTypes {
  verifierCas(casTypes);
  const cas = casTypes.map((c): ResultatCasType => {
    const resultat = appliquerModulation(regles, c.contexte, {
      briquesDeBase: c.briquesDeBase ?? [],
    });
    const ecarts = ecartsCas(c, resultat);
    return { code: c.code, reussi: ecarts.length === 0, ecarts, resultat };
  });
  const reussis = cas.filter((c) => c.reussi).length;
  return { reussi: reussis === cas.length, reussis, echoues: cas.length - reussis, cas };
}
