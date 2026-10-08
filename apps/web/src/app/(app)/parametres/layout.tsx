import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Onglets } from "../../../components/ui/Onglets";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirSession } from "../../../lib/session";

/**
 * Paramètres : chaque sous-page exige sa permission (cabinet, clôture des temps, import…) ;
 * la rubrique est ouverte dès qu'une sous-page l'est.
 */
export default async function LayoutParametres({ children }: { children: ReactNode }) {
  const { utilisateur } = await obtenirSession();
  if (sousPagesAutorisees("parametres", utilisateur.roles).length === 0) redirect("/acces-refuse");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle="Sections des paramètres"
        pages={sousPagesAutorisees("parametres", utilisateur.roles)}
      />
      {children}
    </div>
  );
}
