import type { Metadata } from "next";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { CHEMIN_PLATEFORME } from "../../../lib/plateforme-routes";
import { chargerCabinets } from "../../../lib/plateforme-serveur";
import { ConsoleCabinets } from "./ConsoleCabinets";

export const metadata: Metadata = { title: "Cabinets" };

/** Accueil de la console : liste des cabinets (jamais de donnée de mission ou de facturation). */
export default async function PageCabinets() {
  const resultat = await chargerCabinets();
  if (!resultat.ok) {
    return (
      <div className="mp-page">
        <EtatErreur
          titre="La liste des cabinets n'a pas pu être chargée."
          message={resultat.message}
          hrefReessayer={CHEMIN_PLATEFORME}
        />
      </div>
    );
  }
  return <ConsoleCabinets cabinets={resultat.donnees} />;
}
