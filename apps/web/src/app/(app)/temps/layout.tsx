import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { libelleSousPage, sousPagesAutorisees } from "../../../lib/navigation";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutTemps({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("temps.saisir");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle={t("Sections des temps", "Time sections")}
        pages={sousPagesAutorisees("feuille-de-temps", utilisateur.roles).map((p) => ({
          ...p,
          libelle: libelleSousPage(p, langue),
        }))}
      />
      {children}
    </div>
  );
}
