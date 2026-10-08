import type { ReactNode } from "react";
import { Onglets } from "../../../../components/ui/Onglets";
import { sousPagesBanques } from "../../../../lib/banque-ao";
import { exigerPermission } from "../../../../lib/session";

/**
 * Banques et offres des appels d'offres (AO-04 à AO-07) : CV, références, offres technique et
 * financière. Lecture avec `ao.lire` ; l'offre financière exige en plus `finance.lire`.
 */
export default async function LayoutBanquesAo({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("ao.lire");
  return (
    <div className="mp-rubrique">
      <Onglets libelle="Banques et offres" pages={sousPagesBanques(utilisateur.roles)} />
      {children}
    </div>
  );
}
