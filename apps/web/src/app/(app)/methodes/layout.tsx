import type { ReactNode } from "react";
import "../../../components/methodes/methodes.css";
import { Onglets } from "../../../components/ui/Onglets";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { ongletsMethodes } from "../../../lib/methodes";
import { exigerPermission } from "../../../lib/session";

/** Rubrique « Méthodes » (référentiel de méthodes, lot STD) : sous-pages selon les droits. */
export default async function LayoutMethodes({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("standard.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle={t("Sections du référentiel de méthodes", "Method framework sections")}
        pages={ongletsMethodes(utilisateur.roles, langue)}
      />
      {children}
    </div>
  );
}
