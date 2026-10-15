import { cache } from "react";
import type { RedDossierVue, RedReferentielVue } from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import type { MissionDetaillee } from "./missions";
import { chargerMission } from "./missions-serveur";
import { chargerPersonnes } from "./referentiels-serveur";
import { candidatsProprietaire, type OptionPersonne } from "./kpi";
import {
  CHEMIN_REFERENTIEL_RED,
  cheminDossierMission,
  droitsRedressement,
  type DroitsRedressement,
} from "./redressement";
import { exigerPermission, type Session } from "./session";

/**
 * Chargements serveur communs aux écrans du redressement (dépend de `next/headers` : à ne pas
 * importer dans un composant client). Non testé directement ; la logique pure est dans
 * `redressement.ts`.
 */

/** Dossier de redressement d'une mission, chargé une fois par requête (layout et page). */
export const chargerDossierMission = cache((missionId: string) =>
  chargerServeur<RedDossierVue>(cheminDossierMission(missionId)),
);

/** Référentiel du moteur (grille d'urgence, catalogue de leviers…) : aucune lecture en base. */
export const chargerReferentielRed = cache(() =>
  chargerServeur<RedReferentielVue>(CHEMIN_REFERENTIEL_RED),
);

export type ContexteRed =
  /** Mission illisible : l'en-tête de la mission affiche déjà l'erreur. */
  | { etat: "mission_indisponible" }
  | { etat: "erreur"; message: string; session: Session }
  | { etat: "absent"; mission: MissionDetaillee; droits: DroitsRedressement; session: Session }
  | {
      etat: "ok";
      mission: MissionDetaillee;
      dossier: RedDossierVue;
      droits: DroitsRedressement;
      session: Session;
    };

/**
 * Contexte d'une page du dossier : session (permission `redressement.lire`), mission, dossier et
 * droits d'affichage. `absent` : la mission n'a pas encore de dossier (404 `RED_ABSENT`, la
 * mission, elle, a déjà été chargée par l'en-tête).
 */
export async function chargerContexteRed(missionId: string): Promise<ContexteRed> {
  const session = await exigerPermission("redressement.lire");
  const m = await chargerMission(missionId);
  if (!m.ok) return { etat: "mission_indisponible" };
  const d = await chargerDossierMission(missionId);
  const roles = session.utilisateur.roles;
  const id = session.utilisateur.id;
  if (!d.ok) {
    if (d.statut === 404) {
      return {
        etat: "absent",
        mission: m.donnees,
        droits: droitsRedressement(roles, id, m.donnees),
        session,
      };
    }
    return { etat: "erreur", message: d.message, session };
  }
  return {
    etat: "ok",
    mission: m.donnees,
    dossier: d.donnees,
    droits: droitsRedressement(roles, id, m.donnees, d.donnees),
    session,
  };
}

/**
 * Personnes proposées comme responsable d'une action : directeur, chef et équipe de la mission
 * (l'API vérifie qu'elles sont actives, voient la mission et lisent le redressement).
 */
export async function chargerResponsablesPossibles(
  session: Session,
  mission: MissionDetaillee,
): Promise<OptionPersonne[]> {
  const personnes = await chargerPersonnes(session.utilisateur.roles);
  const noms = new Map(personnes.map((p) => [p.utilisateur_id, p.nom]));
  return candidatsProprietaire(mission, noms);
}
