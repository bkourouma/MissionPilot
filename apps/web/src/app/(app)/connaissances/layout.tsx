import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { aPermission } from "@missionpilot/shared";
import "../../../components/connaissances/connaissances.css";
import { Onglets } from "../../../components/ui/Onglets";
import { PERMISSIONS_RUBRIQUE, sousPagesConnaissances } from "../../../lib/capitalisation";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { obtenirSession } from "../../../lib/session";

/** Rubrique « Connaissances » (CAP, PRD complémentaire §12) : chaque sous-page a sa permission. */
export default async function LayoutConnaissances({ children }: { children: ReactNode }) {
  const { utilisateur } = await obtenirSession();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!PERMISSIONS_RUBRIQUE.some((p) => aPermission(utilisateur.roles, p)))
    redirect("/acces-refuse");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle={t("Sections des connaissances", "Knowledge sections")}
        pages={sousPagesConnaissances(utilisateur.roles, langue)}
      />
      {children}
    </div>
  );
}
