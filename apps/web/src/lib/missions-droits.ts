/** Missions : droits de l'utilisateur sur une mission (miroir des règles de l'API). */
import {
  aPermission,
  TYPES_DOCUMENT,
  type Role,
  type StatutMission,
  type TypeDocument,
} from "@missionpilot/shared";
import type { Mission } from "./missions-types";

// --- Droits sur une mission -------------------------------------------------------------

export interface DroitsMission {
  /** Voit toutes les missions ou en est directeur ou chef, et la mission n'est pas clôturée. */
  responsable: boolean;
  /** Modifier la fiche (mission.creer et responsabilité). */
  modifier: boolean;
  /** Réaffecter le chef (« mission.modifier_toutes »). */
  reaffecter: boolean;
  /** Changer le directeur de mission (associé seulement). */
  designerDirecteur: boolean;
  /** Découpage, équipe, statut simple (mission.planifier et responsabilité). */
  planifier: boolean;
  /** Budget en jours des tâches (budget.ecrire et responsabilité). */
  budgeterJours: boolean;
  /** Lire le budget en jours (synthèse, versions). */
  lireBudget: boolean;
  signer: boolean;
  cloturer: boolean;
  dupliquer: boolean;
  enregistrerModele: boolean;
  deposerDocument: boolean;
  /** Types de document que l'utilisateur peut déposer (proposition et lettre : responsables). */
  typesDocument: TypeDocument[];
  /** Transitions simples proposées (hors signature et clôture). */
  transitions: { cible: StatutMission; libelle: string }[];
}

const TRANSITIONS_SIMPLES: Partial<
  Record<StatutMission, { cible: StatutMission; libelle: string }[]>
> = {
  opportunite: [{ cible: "proposition", libelle: "Passer au stade de la proposition" }],
  signee: [{ cible: "en_cours", libelle: "Démarrer la mission" }],
  en_cours: [{ cible: "a_cloturer", libelle: "Passer « à clôturer »" }],
  a_cloturer: [{ cible: "en_cours", libelle: "Rouvrir (retour en cours)" }],
};

/**
 * Droits de l'utilisateur sur une mission (miroir de `missions/acces.ts` et `routes/missions.ts`
 * de l'API) : il faut la permission ET « mission.modifier_toutes » ou être directeur ou chef
 * de la mission. Lire toutes les missions ne donne pas le droit de les modifier. Une mission
 * clôturée ne se modifie plus. La lettre de mission est signée par le directeur désigné de la
 * mission ou un associé ; seul un associé change le directeur.
 */
export function droitsMission(
  m: Pick<Mission, "statut" | "directeur_id" | "chef_id">,
  roles: readonly Role[],
  utilisateurId: string,
): DroitsMission {
  const a = (p: Parameters<typeof aPermission>[1]) => aPermission(roles, p);
  const associe = roles.includes("associe");
  const directeur = m.directeur_id !== null && m.directeur_id === utilisateurId;
  const responsable = a("mission.modifier_toutes") || directeur || m.chef_id === utilisateurId;
  const ouverte = m.statut !== "cloturee";
  const ecrire = responsable && ouverte;
  const planifier = ecrire && a("mission.planifier");
  return {
    responsable: ecrire,
    modifier: ecrire && a("mission.creer"),
    reaffecter: ecrire && a("mission.creer") && a("mission.modifier_toutes"),
    designerDirecteur: ecrire && a("mission.creer") && associe,
    planifier,
    budgeterJours: ecrire && a("budget.ecrire"),
    lireBudget: a("budget.lire_jours"),
    signer: ecrire && a("mission.signer") && m.statut === "proposition" && (associe || directeur),
    cloturer: ecrire && a("mission.cloturer") && m.statut === "a_cloturer",
    dupliquer: a("mission.creer"),
    enregistrerModele: a("catalogue.ecrire"),
    deposerDocument: a("document.ecrire") && ouverte,
    typesDocument:
      a("document.ecrire") && ouverte
        ? TYPES_DOCUMENT.filter(
            (t) =>
              (t !== "proposition" && t !== "lettre_de_mission") ||
              (responsable && (t !== "lettre_de_mission" || a("mission.signer"))),
          )
        : [],
    transitions: planifier ? (TRANSITIONS_SIMPLES[m.statut] ?? []) : [],
  };
}
