import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirSession } from "../../../lib/session";

/**
 * Facturation : factures (facture.lire), encaissements (encaissement.gerer) et créances.
 * Chaque page vérifie sa propre permission ; la rubrique est ouverte dès qu'une sous-page l'est.
 */
export default async function LayoutFacturation({ children }: { children: ReactNode }) {
  const { utilisateur } = await obtenirSession();
  const pages = sousPagesAutorisees("facturation", utilisateur.roles);
  if (pages.length === 0) redirect("/acces-refuse");
  return (
    <div className="mp-rubrique">
      <Onglets libelle="Sections de la facturation" pages={pages} />
      {children}
    </div>
  );
}
