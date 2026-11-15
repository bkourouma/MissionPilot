import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { obtenirT } from "../../../lib/i18n/serveur";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutPlanning({ children }: { children: ReactNode }) {
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("temps.saisir");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle={t("Sections de mon planning", "My schedule sections")}
        pages={sousPagesAutorisees("mon-planning", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
