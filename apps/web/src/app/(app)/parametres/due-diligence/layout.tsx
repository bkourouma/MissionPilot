import type { ReactNode } from "react";
import "../../../../components/due-diligence/due-diligence.css";
import { Onglets } from "../../../../components/ui/Onglets";
import { sousPagesParametresDd } from "../../../../lib/due-diligence";
import { droitsPortailDd } from "../../../../lib/due-diligence-portail";
import { obtenirT, obtenirLangue } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

/**
 * Paramètres de la due diligence (DD-11, DD-14) : bibliothèque de signaux d'alerte et listes
 * d'exclusion du cabinet. Lecture avec `dd.lire`, modification avec `dd.referentiel.gerer` (l'API juge) ; les lecteurs atteignent
 * la bibliothèque depuis l'onglet « Risques » d'un dossier.
 */
export default async function LayoutParametresDd({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("dd.lire");
  const portail = droitsPortailDd(utilisateur.roles).gerer;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-dd">
      <Onglets
        libelle={t(
          "Sections des paramètres de la due diligence",
          "Due diligence settings sections",
        )}
        pages={sousPagesParametresDd({ portail }, langue)}
      />
      {children}
    </div>
  );
}
