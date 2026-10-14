/**
 * Synthèse de la chaîne de valeur (DD-04, SPEC-3b §5.3) : étapes ordonnées, parts de coût et de
 * marge en points de base, rang de marge, cohérence des sommes. Fonction pure.
 */
import { ErreurDueDiligence } from "./erreurs";

/** Écart admis à 10 000 pour la somme des parts : 1 point, PROVISOIRE. */
export const TOLERANCE_SOMME_PARTS_BP = 100;

const PLEIN_BP = 10_000;

export interface EtapeChaineEntree {
  readonly id: string;
  readonly ordre: number;
  readonly partCoutBp: number | null;
  readonly partMargeBp: number | null;
}
export interface EtapeChaineSynthese {
  readonly id: string;
  readonly ordre: number;
  readonly partCoutBp: number | null;
  readonly partMargeBp: number | null;
  /** 1 = plus forte part de marge ; `null` si non renseignée. */
  readonly rangMarge: number | null;
}
export type CoherenceParts = "vide" | "incomplete" | "coherente" | "incoherente";
export interface SyntheseChaine {
  /** Tri : ordre, puis id. */
  readonly etapes: readonly EtapeChaineSynthese[];
  readonly totalCoutBp: number;
  readonly totalMargeBp: number;
  readonly coherenceCout: CoherenceParts;
  readonly coherenceMarge: CoherenceParts;
  /** Id de l'étape de rang 1. */
  readonly etapeMargeMax: string | null;
}

function entree(message: string): never {
  throw new ErreurDueDiligence("ENTREE_INVALIDE", message);
}

function partValide(part: number | null, nom: string): void {
  if (part === null) return;
  if (!Number.isInteger(part) || part < 0 || part > PLEIN_BP) {
    entree(`${nom} : entier de 0 à 10 000 points de base attendu.`);
  }
}

function comparerTexte(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function coherence(parts: readonly (number | null)[], total: number): CoherenceParts {
  if (parts.length === 0) return "vide";
  if (parts.some((p) => p === null)) return "incomplete";
  return Math.abs(total - PLEIN_BP) <= TOLERANCE_SOMME_PARTS_BP ? "coherente" : "incoherente";
}

export function syntheseChaineDeValeur(etapes: readonly EtapeChaineEntree[]): SyntheseChaine {
  const ids = new Set<string>();
  for (const e of etapes) {
    if (ids.has(e.id)) entree(`Étape « ${e.id} » en double.`);
    ids.add(e.id);
    if (!Number.isInteger(e.ordre) || e.ordre < 1) entree(`Étape « ${e.id} » : ordre ≥ 1 attendu.`);
    partValide(e.partCoutBp, `Étape « ${e.id} », part de coût`);
    partValide(e.partMargeBp, `Étape « ${e.id} », part de marge`);
  }
  const triees = [...etapes].sort((a, b) => a.ordre - b.ordre || comparerTexte(a.id, b.id));

  // Rang de marge : parts décroissantes, égalités par ordre puis id (rangs distincts 1…n).
  const renseignees = triees.filter((e) => e.partMargeBp !== null);
  const classees = [...renseignees].sort(
    (a, b) =>
      (b.partMargeBp as number) - (a.partMargeBp as number) ||
      a.ordre - b.ordre ||
      comparerTexte(a.id, b.id),
  );
  const rangs = new Map(classees.map((e, i) => [e.id, i + 1] as const));

  const somme = (cle: "partCoutBp" | "partMargeBp"): number =>
    triees.reduce((s, e) => s + (e[cle] ?? 0), 0);
  const totalCoutBp = somme("partCoutBp");
  const totalMargeBp = somme("partMargeBp");

  return {
    etapes: triees.map((e) => ({
      id: e.id,
      ordre: e.ordre,
      partCoutBp: e.partCoutBp,
      partMargeBp: e.partMargeBp,
      rangMarge: rangs.get(e.id) ?? null,
    })),
    totalCoutBp,
    totalMargeBp,
    coherenceCout: coherence(
      triees.map((e) => e.partCoutBp),
      totalCoutBp,
    ),
    coherenceMarge: coherence(
      triees.map((e) => e.partMargeBp),
      totalMargeBp,
    ),
    etapeMargeMax: classees[0]?.id ?? null,
  };
}
