import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutServicesCandidats({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("services_candidats.lire");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle="Sections des services candidats"
        pages={sousPagesAutorisees("services-candidats", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
