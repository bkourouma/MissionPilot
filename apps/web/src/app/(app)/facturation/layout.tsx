import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirT } from "../../../lib/i18n/serveur";
import { obtenirSession } from "../../../lib/session";

/**
 * Facturation : factures (facture.lire), encaissements (encaissement.gerer) et créances.
 * Chaque page vérifie sa propre permission ; la rubrique est ouverte dès qu'une sous-page l'est.
 */
export default async function LayoutFacturation({ children }: { children: ReactNode }) {
  const { utilisateur } = await obtenirSession();
  const t = await obtenirT();
  const pages = sousPagesAutorisees("facturation", utilisateur.roles);
  if (pages.length === 0) redirect("/acces-refuse");
  return (
    <div className="mp-rubrique">
      <Onglets libelle={t("Sections de la facturation", "Billing sections")} pages={pages} />
      {children}
    </div>
  );
}
