import { aPermission, type Role } from "@missionpilot/shared";

// --- Droits d'affichage ---------------------------------------------------------------------

export interface DroitsPreuves {
  lire: boolean;
  /** Écrire : permission du rôle et mission ouverte (l'API reste la source de vérité). */
  ecrire: boolean;
}

/**
 * Signer un avis d'expert (et abaisser la classe de risque d'une assertion) : expert métier ou
 * associé, comme l'API (MPV04, MPV06). Confort d'affichage seulement.
 */
export function peutSignerAvisExpert(roles: readonly Role[]): boolean {
  return roles.includes("expert_metier") || roles.includes("associe");
}

export function droitsPreuves(roles: readonly Role[], mission: { statut: string }): DroitsPreuves {
  return {
    lire: aPermission(roles, "preuve.lire"),
    ecrire: aPermission(roles, "preuve.ecrire") && mission.statut !== "cloturee",
  };
}
