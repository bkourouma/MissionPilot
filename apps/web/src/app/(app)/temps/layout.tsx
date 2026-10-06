import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutTemps({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("temps.saisir");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle="Sections des temps"
        pages={sousPagesAutorisees("feuille-de-temps", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
