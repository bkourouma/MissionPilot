import type { ReactNode } from "react";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export default async function LayoutServicesCandidats({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("services_candidats.lire");
  const t = await obtenirT();
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle={t("Sections des services candidats", "Candidate services sections")}
        pages={sousPagesAutorisees("services-candidats", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
