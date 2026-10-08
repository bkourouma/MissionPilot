import type { ReactNode } from "react";
import "../../../components/agents/agents.css";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAgents } from "../../../lib/agents";
import { exigerPermission } from "../../../lib/session";

/** Rubrique « Agents IA » (AGT, PRD complémentaire §7) : lecture avec `agent.lire`. */
export default async function LayoutAgents({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("agent.lire");
  return (
    <div className="mp-rubrique">
      <Onglets libelle="Sections des agents IA" pages={sousPagesAgents(utilisateur.roles)} />
      {children}
    </div>
  );
}
