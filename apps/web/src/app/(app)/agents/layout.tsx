import type { ReactNode } from "react";
import "../../../components/agents/agents.css";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAgents } from "../../../lib/agents";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

/** Rubrique « Agents IA » (AGT, PRD complémentaire §7) : lecture avec `agent.lire`. */
export default async function LayoutAgents({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("agent.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle={t("Sections des agents IA", "AI agent sections")}
        pages={sousPagesAgents(utilisateur.roles, langue)}
      />
      {children}
    </div>
  );
}
