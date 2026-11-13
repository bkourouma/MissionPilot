import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutCatalogue({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("catalogue.lire");
  const t = await obtenirT();
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle={t("Sections du catalogue", "Catalog sections")}
        pages={sousPagesAutorisees("catalogue", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
