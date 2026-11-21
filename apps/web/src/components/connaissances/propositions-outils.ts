import type { Langue } from "@missionpilot/shared";

/** Statut d'une proposition d'évolution du standard (valeurs de `propositions_standard.statut`). */
const STATUTS_PROPOSITION: Record<string, readonly [string, string]> = {
  proposee: ["proposée", "proposed"],
  en_revue: ["en revue", "under review"],
  acceptee: ["acceptée", "accepted"],
  refusee: ["refusée", "refused"],
  publiee: ["publiée", "published"],
};

/** Libellé lisible d'un statut de proposition ; une valeur inconnue est rendue telle quelle. */
export function libelleStatutProposition(statut: string, langue: Langue): string {
  const l = STATUTS_PROPOSITION[statut];
  return l ? l[langue === "en" ? 1 : 0] : statut;
}
