import { aPermission, type Permission, type Role } from "@missionpilot/shared";

/** Navigation de la rubrique « Agents IA » et droits d'affichage. */

/* ----- Navigation de la rubrique ----- */

export interface SousPageAgents {
  id: string;
  libelle: string;
  href: string;
  permission: Permission;
}

export const SOUS_PAGES_AGENTS: readonly SousPageAgents[] = [
  { id: "equipe", libelle: "Équipe d'agents", href: "/agents", permission: "agent.lire" },
  { id: "autonomie", libelle: "Autonomie", href: "/agents/autonomie", permission: "agent.lire" },
  { id: "executions", libelle: "Exécutions", href: "/agents/executions", permission: "agent.lire" },
  {
    id: "evaluations",
    libelle: "Évaluations",
    href: "/agents/evaluations",
    permission: "agent.lire",
  },
  {
    id: "contribution",
    libelle: "Contribution de l'IA",
    href: "/agents/contribution",
    permission: "agent.lire",
  },
];

export function sousPagesAgents(roles: readonly Role[]): SousPageAgents[] {
  return SOUS_PAGES_AGENTS.filter((p) => aPermission(roles, p.permission));
}

/** Droits d'affichage (l'API reste la source de vérité). */
export function droitsAgents(roles: readonly Role[]) {
  return {
    gerer: aPermission(roles, "agent.gerer"),
    decider: aPermission(roles, "autonomie.decider"),
    couper: aPermission(roles, "agent.gerer") || aPermission(roles, "autonomie.decider"),
    lever: aPermission(roles, "autonomie.decider"),
    /** Incident MAJEUR (rétrogradation automatique) : agent.gerer ou autonomie.decider. */
    incidentMajeur: aPermission(roles, "agent.gerer") || aPermission(roles, "autonomie.decider"),
    /** Brique R0 (seule à pouvoir aller jusqu'à N4) : associé. */
    declarerR0: aPermission(roles, "autonomie.decider"),
  };
}
