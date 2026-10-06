import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutParametres({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("cabinet.gerer");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle="Sections des paramètres"
        pages={sousPagesAutorisees("parametres", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
