import type { ReactNode } from "react";
import "../../../../components/due-diligence/due-diligence.css";
import { Onglets } from "../../../../components/ui/Onglets";
import { sousPagesParametresDd } from "../../../../lib/due-diligence";
import { exigerPermission } from "../../../../lib/session";

/**
 * Paramètres de la due diligence (DD-11, DD-14) : bibliothèque de signaux d'alerte et listes
 * d'exclusion du cabinet. Lecture avec `dd.lire`, modification avec `dd.referentiel.gerer` (l'API juge) ; les lecteurs atteignent
 * la bibliothèque depuis l'onglet « Risques » d'un dossier.
 */
export default async function LayoutParametresDd({ children }: { children: ReactNode }) {
  await exigerPermission("dd.lire");
  return (
    <div className="mp-dd">
      <Onglets
        libelle="Sections des paramètres de la due diligence"
        pages={sousPagesParametresDd()}
      />
      {children}
    </div>
  );
}
