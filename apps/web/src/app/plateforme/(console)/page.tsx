import type { Metadata } from "next";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { obtenirT } from "../../../lib/i18n/serveur";
import { CHEMIN_PLATEFORME } from "../../../lib/plateforme-routes";
import { chargerCabinets } from "../../../lib/plateforme-serveur";
import { ConsoleCabinets } from "./ConsoleCabinets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Cabinets", "Firms") };
}

/** Accueil de la console : liste des cabinets (jamais de donnée de mission ou de facturation). */
export default async function PageCabinets() {
  const t = await obtenirT();
  const resultat = await chargerCabinets();
  if (!resultat.ok) {
    return (
      <div className="mp-page">
        <EtatErreur
          titre={t(
            "La liste des cabinets n'a pas pu être chargée.",
            "The list of firms could not be loaded.",
          )}
          message={resultat.message}
          hrefReessayer={CHEMIN_PLATEFORME}
        />
      </div>
    );
  }
  return <ConsoleCabinets cabinets={resultat.donnees} />;
}
