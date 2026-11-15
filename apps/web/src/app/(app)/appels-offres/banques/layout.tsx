import type { ReactNode } from "react";
import "../../../../components/appels-offres/appels-offres.css";
import { Onglets } from "../../../../components/ui/Onglets";
import { libelleSousPageBanques, sousPagesBanques } from "../../../../lib/banque-ao";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

/**
 * Banques et offres des appels d'offres (AO-04 à AO-07) : CV, références, offres technique et
 * financière. Lecture avec `ao.lire` ; l'offre financière exige en plus `finance.lire`.
 */
export default async function LayoutBanquesAo({ children }: { children: ReactNode }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("ao.lire");
  const pages = sousPagesBanques(utilisateur.roles).map((p) => ({
    id: p.id,
    href: p.href,
    libelle: libelleSousPageBanques(p, langue),
  }));
  return (
    <div className="mp-rubrique">
      <Onglets libelle={t("Banques et offres", "Banks and bids")} pages={pages} />
      {children}
    </div>
  );
}
