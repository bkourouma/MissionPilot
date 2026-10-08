import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutCatalogue({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("catalogue.lire");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle="Sections du catalogue"
        pages={sousPagesAutorisees("catalogue", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
