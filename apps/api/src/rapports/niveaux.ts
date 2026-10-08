import { aPermission, type Permission, type Role } from "@missionpilot/shared";

/*
 * Niveau de confidentialité d'un rapport enregistré (rapports_mission.niveau),
 * CALCULÉ par le code d'après les sections réellement incluses ou le modèle.
 *
 * Niveaux CUMULATIFS de l'état d'avancement :
 * - « base » : ni jours ni données financières (identité, avancement physique,
 *   jalons) ;
 * - « jours » : contient des sections en jours (budget, réalisé, temps
 *   consommé) — générées avec « budget.lire_jours » ;
 * - « finance » : contient coûts, taux ou marges (FIN-02) — générées avec
 *   « finance.lire ».
 * Un rapport « finance » peut aussi contenir des sections en jours, sa
 * lecture exige donc les deux permissions (tout détenteur actuel de
 * « finance.lire » a aussi « budget.lire_jours », packages/shared/src/roles.ts).
 *
 * Niveaux des SERVICES (migration 0131), propres à un modèle :
 * - « notation » : rapport de notation publiée (NOT-07) — « notation.lire » ;
 * - « plan » : rapport de plan stratégique (PLA-11), modèle financier du
 *   client compris — « plan.lire » (ni ressources ni gestionnaire).
 *
 * Ces permissions sont revérifiées à CHAQUE lecture (stockage/fichiers.ts
 * `exigerFichierLisible`, listes des rapports), en plus de « mission.lire » et
 * de la visibilité de la mission, sans condition d'auteur : un rôle retiré
 * perd l'accès immédiatement. Un niveau inconnu est refusé.
 */

export const NIVEAUX_RAPPORT = ["base", "jours", "finance"] as const;
export type NiveauCumulatif = (typeof NIVEAUX_RAPPORT)[number];

export const NIVEAUX_SERVICE = ["notation", "plan"] as const;
export type NiveauService = (typeof NIVEAUX_SERVICE)[number];

export type NiveauRapport = NiveauCumulatif | NiveauService;

export const TOUS_LES_NIVEAUX: readonly NiveauRapport[] = [...NIVEAUX_RAPPORT, ...NIVEAUX_SERVICE];

export const PERMISSIONS_NIVEAU: Record<NiveauRapport, readonly Permission[]> = {
  base: [],
  jours: ["budget.lire_jours"],
  finance: ["budget.lire_jours", "finance.lire"],
  notation: ["notation.lire"],
  plan: ["plan.lire"],
};

/** Vrai si ces rôles détiennent toutes les permissions du niveau (hors « mission.lire »). */
export function peutLireNiveau(roles: readonly Role[], niveau: NiveauRapport): boolean {
  const exigees = Object.prototype.hasOwnProperty.call(PERMISSIONS_NIVEAU, niveau)
    ? PERMISSIONS_NIVEAU[niveau]
    : undefined;
  // Niveau inconnu (ligne corrompue) : refus.
  if (!exigees) return false;
  return exigees.every((p) => aPermission(roles, p));
}

/** Niveaux cumulatifs (état d'avancement) lisibles par ces rôles. */
export function niveauxLisibles(roles: readonly Role[]): NiveauCumulatif[] {
  return NIVEAUX_RAPPORT.filter((n) => peutLireNiveau(roles, n));
}

/** Tous les niveaux lisibles par ces rôles (filtre des listes de rapports). */
export function tousNiveauxLisibles(roles: readonly Role[]): NiveauRapport[] {
  return TOUS_LES_NIVEAUX.filter((n) => peutLireNiveau(roles, n));
}

/** Niveau d'un état d'avancement d'après ses sections : le plus élevé des niveaux inclus. */
export function niveauDesSections(niveaux: readonly NiveauCumulatif[]): NiveauCumulatif {
  if (niveaux.includes("finance")) return "finance";
  if (niveaux.includes("jours")) return "jours";
  return "base";
}
