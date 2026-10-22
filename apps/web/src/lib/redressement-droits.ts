/** Redressement : droits d'affichage (confort : l'API reste seule juge). */
import { aPermission, type RedDossierResume, type Role } from "@missionpilot/shared";
import type { MissionDetaillee } from "./missions";

// --- Droits d'affichage (confort : l'API reste seule juge) ----------------------------------------

export interface DroitsRedressement {
  lire: boolean;
  /** Ouvrir le dossier d'une mission : directeur, chef ou « modifier toutes les missions ». */
  ouvrir: boolean;
  ecrire: boolean;
  valider: boolean;
  parametrer: boolean;
  assignerTache: boolean;
}

type MissionDroits = Pick<MissionDetaillee, "statut" | "directeur_id" | "chef_id" | "equipe">;

/**
 * Miroir de SPEC-3a §9.1 : `ouvrir` = `redressement.ecrire`, mission modifiable (modifier toutes
 * les missions, directeur ou chef) non clôturée ; `ecrire` = `redressement.ecrire`, mission
 * modifiable OU membre de l'équipe, mission non clôturée, dossier non clos ; `valider`,
 * `parametrer` et `assignerTache` = la permission seule (la séparation des tâches est jugée par
 * l'API).
 */
export function droitsRedressement(
  roles: readonly Role[],
  utilisateurId: string,
  mission: MissionDroits,
  dossier?: Pick<RedDossierResume, "statut"> | null,
): DroitsRedressement {
  const a = (p: Parameters<typeof aPermission>[1]) => aPermission(roles, p);
  const ouverte = mission.statut !== "cloturee";
  const responsable =
    a("mission.modifier_toutes") ||
    (mission.directeur_id !== null && mission.directeur_id === utilisateurId) ||
    (mission.chef_id !== null && mission.chef_id === utilisateurId);
  const equipe = mission.equipe.some((e) => e.utilisateur_id === utilisateurId);
  const ecritureOuverte = a("redressement.ecrire") && ouverte;
  return {
    lire: a("redressement.lire"),
    ouvrir: ecritureOuverte && responsable,
    ecrire: ecritureOuverte && (responsable || equipe) && dossier?.statut !== "clos",
    valider: a("redressement.valider"),
    parametrer: a("redressement.parametrer"),
    assignerTache: a("tache.assigner"),
  };
}

/** Raison affichée quand l'écriture n'est pas proposée (jamais de bouton désactivé sans raison). */
export function raisonSansEcriture(
  mission: Pick<MissionDetaillee, "statut">,
  dossier: Pick<RedDossierResume, "statut"> | null,
  roles: readonly Role[],
): string {
  if (mission.statut === "cloturee") {
    return "La mission est clôturée : le dossier de redressement est en lecture seule.";
  }
  if (dossier?.statut === "clos") return "Le dossier est clos : il est en lecture seule.";
  if (!aPermission(roles, "redressement.ecrire")) {
    return "Votre rôle permet de consulter le dossier de redressement, pas de le modifier.";
  }
  return "La saisie est réservée au directeur, au chef de mission et aux membres de l'équipe.";
}
