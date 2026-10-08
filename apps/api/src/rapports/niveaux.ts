import { aPermission, type Permission, type Role } from "@missionpilot/shared";

/*
 * Niveau de confidentialité d'un rapport enregistré (rapports_mission.niveau),
 * CALCULÉ par le code d'après les sections réellement incluses :
 * - « base » : ni jours ni données financières (identité, avancement physique,
 *   jalons) ;
 * - « jours » : contient des sections en jours (budget, réalisé, temps
 *   consommé) — générées avec « budget.lire_jours » ;
 * - « finance » : contient coûts, taux ou marges (FIN-02) — générées avec
 *   « finance.lire ».
 *
 * Les niveaux sont CUMULATIFS : un rapport « finance » peut aussi contenir
 * des sections en jours, sa lecture exige donc les deux permissions (tout
 * détenteur actuel de « finance.lire » a aussi « budget.lire_jours »,
 * packages/shared/src/roles.ts). Ces permissions sont revérifiées à CHAQUE
 * lecture (stockage/fichiers.ts `exigerFichierLisible`, liste des rapports),
 * en plus de « mission.lire » et de la visibilité de la mission, sans
 * condition d'auteur : un rôle retiré perd l'accès immédiatement.
 */

export const NIVEAUX_RAPPORT = ["base", "jours", "finance"] as const;
export type NiveauRapport = (typeof NIVEAUX_RAPPORT)[number];

export const PERMISSIONS_NIVEAU: Record<NiveauRapport, readonly Permission[]> = {
  base: [],
  jours: ["budget.lire_jours"],
  finance: ["budget.lire_jours", "finance.lire"],
};

/** Vrai si ces rôles détiennent toutes les permissions du niveau (hors « mission.lire »). */
export function peutLireNiveau(roles: readonly Role[], niveau: NiveauRapport): boolean {
  const exigees = PERMISSIONS_NIVEAU[niveau] as readonly Permission[] | undefined;
  // Niveau inconnu (ligne corrompue) : refus.
  if (!exigees) return false;
  return exigees.every((p) => aPermission(roles, p));
}

/** Niveaux lisibles par ces rôles (filtre de la liste des rapports). */
export function niveauxLisibles(roles: readonly Role[]): NiveauRapport[] {
  return NIVEAUX_RAPPORT.filter((n) => peutLireNiveau(roles, n));
}

/** Niveau d'un rapport d'après ses sections : le plus élevé des niveaux inclus. */
export function niveauDesSections(niveaux: readonly NiveauRapport[]): NiveauRapport {
  if (niveaux.includes("finance")) return "finance";
  if (niveaux.includes("jours")) return "jours";
  return "base";
}
