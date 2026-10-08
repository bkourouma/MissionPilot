/**
 * Vocabulaire du registre des preuves (PRD complémentaire §6) : types de
 * source indépendants, fiabilité A à D et son poids, sens d'une preuve par
 * rapport à une assertion.
 *
 * Les poids sont des CENTIÈMES entiers (A = 100, B = 75, C = 50, D = 25) :
 * aucune somme de flottants, aucun bruit d'arrondi dans les seuils.
 */
import { ErreurPreuves } from "./erreurs";

export const TYPES_SOURCE_PREUVE = [
  "questionnaire",
  "entretien",
  "observation",
  "document",
  "donnee_externe",
] as const;
export type TypeSourcePreuve = (typeof TYPES_SOURCE_PREUVE)[number];

export const FIABILITES_PREUVE = ["A", "B", "C", "D"] as const;
export type FiabilitePreuve = (typeof FIABILITES_PREUVE)[number];

/** Poids d'une fiabilité, en centièmes (valeurs du PRD, à calibrer au pilote). */
export const POIDS_FIABILITE_CENTIEMES: Readonly<Record<FiabilitePreuve, number>> = {
  A: 100,
  B: 75,
  C: 50,
  D: 25,
};

export const SENS_PREUVE = ["pour", "contre"] as const;
export type SensPreuve = (typeof SENS_PREUVE)[number];

/** Preuve rattachée à une assertion. */
export interface PreuveAssertion {
  readonly id: string;
  readonly typeSource: TypeSourcePreuve;
  readonly fiabilite: FiabilitePreuve;
  readonly sens: SensPreuve;
  /**
   * Preuve « contre » arbitrée par le consultant (PRV-04) : elle reste au
   * dossier mais ne divise plus l'indice. Sans effet sur une preuve « pour ».
   */
  readonly resolue?: boolean;
}

export function estTypeSourcePreuve(valeur: unknown): valeur is TypeSourcePreuve {
  return typeof valeur === "string" && (TYPES_SOURCE_PREUVE as readonly string[]).includes(valeur);
}

export function estFiabilitePreuve(valeur: unknown): valeur is FiabilitePreuve {
  return typeof valeur === "string" && (FIABILITES_PREUVE as readonly string[]).includes(valeur);
}

/** Rang d'une fiabilité : A → 0 (la meilleure), D → 3. */
export function rangFiabilite(fiabilite: FiabilitePreuve): number {
  return FIABILITES_PREUVE.indexOf(fiabilite);
}

/** Comparaison d'identifiants indépendante de la locale (ordre des unités UTF-16). */
export function comparerIdentifiants(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ordre de revue : meilleure fiabilité d'abord, puis identifiant. */
export function comparerPreuves(
  a: Pick<PreuveAssertion, "id" | "fiabilite">,
  b: Pick<PreuveAssertion, "id" | "fiabilite">,
): number {
  return (
    rangFiabilite(a.fiabilite) - rangFiabilite(b.fiabilite) || comparerIdentifiants(a.id, b.id)
  );
}

export function verifierIdentifiant(id: unknown, quoi: string): asserts id is string {
  if (typeof id !== "string" || id === "") {
    throw new ErreurPreuves("PREUVE_INVALIDE", `Identifiant ${quoi} absent.`);
  }
}

/** Contrôle la forme d'une preuve (type, fiabilité, sens) ; lève `PREUVE_INVALIDE`. */
export function verifierPreuve(preuve: Partial<PreuveAssertion>, avecSens: boolean): void {
  verifierIdentifiant(preuve.id, "de preuve");
  if (!estTypeSourcePreuve(preuve.typeSource)) {
    throw new ErreurPreuves("PREUVE_INVALIDE", "Type de source de preuve inconnu.");
  }
  if (!estFiabilitePreuve(preuve.fiabilite)) {
    throw new ErreurPreuves("PREUVE_INVALIDE", "Fiabilité de preuve inconnue (A à D).");
  }
  if (avecSens && preuve.sens !== "pour" && preuve.sens !== "contre") {
    throw new ErreurPreuves("PREUVE_INVALIDE", "Sens de preuve inconnu (pour ou contre).");
  }
}
