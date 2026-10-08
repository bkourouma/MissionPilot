/**
 * Application d'un jeu de règles de modulation à un contexte (STD-05).
 *
 * Déterministe : mêmes règles, même contexte et mêmes briques de base ⇒ même
 * résultat, dans le même ordre. Étapes :
 * 1. contrôle de forme (`ErreurModulation` `REGLES_INVALIDES` au premier
 *    écart, avec son chemin) ;
 * 2. ordre d'évaluation des règles actives (dépendances `brique_active`,
 *    puis priorité décroissante, puis code) ; un cycle lève `CYCLE_REGLES` ;
 * 3. évaluation de chaque condition, journalisée feuille par feuille ;
 * 4. résolution des effets par clé (priorité, conflits) et état résultant.
 *
 * Le moteur ne lit ni base ni horloge : les briques actives avant modulation
 * (méthode figée de la mission) sont un paramètre.
 */
import { evaluerCondition, type VerificationCondition } from "./conditions";
import { ordreEvaluation } from "./dependances";
import {
  cleEffet,
  comparerCodes,
  construireEtat,
  resoudreCle,
  valeurEffet,
  type CandidatEffet,
  type ConflitModulation,
  type EffetApplique,
  type EtatModulation,
} from "./effets";
import { ErreurModulation } from "./erreurs";
import { anomaliesStructure, estCodeModulation, estObjet } from "./structure";
import type { ContexteModulation, RegleModulation } from "./types";

export interface OptionsModulation {
  /** Briques actives de la méthode avant modulation (lues par `brique_active`). */
  readonly briquesDeBase?: readonly string[];
}

export interface EntreeJournalModulation {
  readonly regle: string;
  readonly priorite: number;
  /** Règle désactivée : ni évaluée ni appliquée. */
  readonly active: boolean;
  readonly declenchee: boolean;
  /** Feuilles de la condition vérifiées, avec les valeurs lues. */
  readonly verifications: readonly VerificationCondition[];
  /** Effets de la règle retenus après résolution des conflits. */
  readonly effetsRetenus: number;
  /** Effets de la règle écartés (conflit perdu ou non résolu, classe inférieure). */
  readonly effetsEcartes: number;
}

export interface ResultatModulation {
  /** Effets appliqués, triés par clé. */
  readonly effets: readonly EffetApplique[];
  readonly etat: EtatModulation;
  /** Conflits rencontrés (résolus ou non), triés par clé. */
  readonly conflits: readonly ConflitModulation[];
  /** Règles actives dans l'ordre d'évaluation, puis règles inactives par code. */
  readonly journal: readonly EntreeJournalModulation[];
  /** Codes des règles déclenchées, dans l'ordre d'évaluation. */
  readonly reglesDeclenchees: readonly string[];
}

/** Lève `REGLES_INVALIDES` au premier écart de forme. */
export function exigerReglesBienFormees(regles: readonly RegleModulation[]): void {
  const anomalie = anomaliesStructure(regles)[0];
  if (anomalie) throw new ErreurModulation("REGLES_INVALIDES", anomalie.message, anomalie.chemin);
}

export function briquesDeBaseValides(options: OptionsModulation): readonly string[] {
  const base = options.briquesDeBase ?? [];
  if (!Array.isArray(base) || !base.every(estCodeModulation)) {
    throw new ErreurModulation("OPTIONS_INVALIDES", "Briques de base invalides.", "briquesDeBase");
  }
  return base;
}

/** Applique les règles au contexte et renvoie effets, état, conflits et journal. */
export function appliquerModulation(
  regles: readonly RegleModulation[],
  contexte: ContexteModulation,
  options: OptionsModulation = {},
): ResultatModulation {
  exigerReglesBienFormees(regles);
  if (!estObjet(contexte)) {
    throw new ErreurModulation("OPTIONS_INVALIDES", "Contexte attendu (objet).", "contexte");
  }
  const base = new Set(briquesDeBaseValides(options));
  const actives = regles.filter((r) => r.active !== false);
  const { ordre, cycles } = ordreEvaluation(actives);
  if (cycles.length > 0) {
    throw new ErreurModulation(
      "CYCLE_REGLES",
      `Règles en dépendance circulaire : ${cycles.map((c) => c.join(" → ")).join(" ; ")}.`,
    );
  }

  const candidats = new Map<string, CandidatEffet[]>();
  const briqueActive = (brique: string): boolean => {
    const liste = candidats.get(`brique:${brique}`);
    const applique = liste ? resoudreCle(`brique:${brique}`, liste).applique : null;
    return applique ? applique.effet.type === "activer_brique" : base.has(brique);
  };
  const evaluees: {
    regle: RegleModulation;
    declenchee: boolean;
    verifications: VerificationCondition[];
  }[] = [];
  for (const regle of ordre) {
    const verifications: VerificationCondition[] = [];
    const declenchee = evaluerCondition(
      regle.condition,
      contexte,
      briqueActive,
      "condition",
      verifications,
    );
    evaluees.push({ regle, declenchee, verifications });
    if (!declenchee) continue;
    for (const effet of regle.effets) {
      const cle = cleEffet(effet);
      const c: CandidatEffet = { regle: regle.code, priorite: regle.priorite, effet };
      // Ajout en place (une copie par effet serait quadratique).
      const liste = candidats.get(cle);
      if (liste) liste.push(c);
      else candidats.set(cle, [c]);
    }
  }

  const effets: EffetApplique[] = [];
  const conflits: ConflitModulation[] = [];
  for (const cle of [...candidats.keys()].sort(comparerCodes)) {
    const r = resoudreCle(cle, candidats.get(cle)!);
    if (r.applique) effets.push(r.applique);
    if (r.conflit) conflits.push(r.conflit);
  }
  const retenus = new Map(effets.map((e) => [e.cle, e]));
  const estRetenu = (code: string, effet: RegleModulation["effets"][number]): boolean => {
    const e = retenus.get(cleEffet(effet));
    return (
      e !== undefined && e.regles.includes(code) && valeurEffet(e.effet) === valeurEffet(effet)
    );
  };

  const journal: EntreeJournalModulation[] = evaluees.map(
    ({ regle, declenchee, verifications }) => {
      const nbRetenus = declenchee
        ? regle.effets.filter((e) => estRetenu(regle.code, e)).length
        : 0;
      return {
        regle: regle.code,
        priorite: regle.priorite,
        active: true,
        declenchee,
        verifications,
        effetsRetenus: nbRetenus,
        effetsEcartes: declenchee ? regle.effets.length - nbRetenus : 0,
      };
    },
  );
  for (const regle of [...regles]
    .filter((r) => r.active === false)
    .sort((a, b) => comparerCodes(a.code, b.code))) {
    journal.push({
      regle: regle.code,
      priorite: regle.priorite,
      active: false,
      declenchee: false,
      verifications: [],
      effetsRetenus: 0,
      effetsEcartes: 0,
    });
  }
  return {
    effets,
    etat: construireEtat(effets, [...base]),
    conflits,
    journal,
    reglesDeclenchees: evaluees.filter((e) => e.declenchee).map((e) => e.regle.code),
  };
}
