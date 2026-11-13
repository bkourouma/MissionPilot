import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirT } from "../../../lib/i18n/serveur";
import { obtenirSession } from "../../../lib/session";

/**
 * Finance : encours de production, rentabilité (finance.lire) et export comptable
 * (export.comptable). Chaque page vérifie sa permission avant tout appel à l'API.
 */
export default async function LayoutFinance({ children }: { children: ReactNode }) {
  const { utilisateur } = await obtenirSession();
  const t = await obtenirT();
  const pages = sousPagesAutorisees("finance", utilisateur.roles);
  if (pages.length === 0) redirect("/acces-refuse");
  return (
    <div className="mp-rubrique">
      <Onglets libelle={t("Sections de la finance", "Finance sections")} pages={pages} />
      {children}
    </div>
  );
}
