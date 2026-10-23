/** Redressement : droits d'affichage (confort : l'API reste seule juge). */
import {
  aPermission,
  type RedCausesVersionVue,
  type RedDossierResume,
  type Role,
} from "@missionpilot/shared";
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

/** Raison affichée à l'auteur d'une cartographie qui ne peut pas la valider lui-même (RED-04). */
export const TEXTE_CAUSES_AUTEUR_NE_VALIDE_PAS =
  "Vous avez participé à cette cartographie (demande ou modification) : elle doit être validée par un autre consultant. Un associé peut la valider lui-même.";

export interface ValidationCauses {
  /** Le bouton « Valider » est affiché (brouillon, écriture permise). */
  proposee: boolean;
  /** Valider est possible pour cet utilisateur. */
  autorisee: boolean;
  /** Explication visible quand le bouton est affiché mais désactivé. */
  raison: string | null;
}

/**
 * Miroir de `validerCauses` (API) : la validation exige `redressement.ecrire` (droit d'écriture
 * du dossier, `peutEcrire`) et refuse quiconque a signé un rang de la version, sauf un associé
 * (RED-04 : « un consultant autre que l'auteur »). Confort d'affichage : l'API reste juge.
 */
export function validationCauses(
  version: Pick<RedCausesVersionVue, "statut" | "historique" | "cree_par">,
  peutEcrire: boolean,
  roles: readonly Role[],
  utilisateurId: string,
): ValidationCauses {
  if (!peutEcrire || version.statut !== "brouillon") {
    return { proposee: false, autorisee: false, raison: null };
  }
  const auteur = version.historique.some((r) => r.auteur.id === utilisateurId);
  if (auteur && !roles.includes("associe")) {
    return { proposee: true, autorisee: false, raison: TEXTE_CAUSES_AUTEUR_NE_VALIDE_PAS };
  }
  return { proposee: true, autorisee: true, raison: null };
}
