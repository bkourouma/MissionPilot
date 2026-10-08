import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutPlanning({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("temps.saisir");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle="Sections de mon planning"
        pages={sousPagesAutorisees("mon-planning", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
