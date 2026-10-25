import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VisuelMarque } from "../../../components/shell/VisuelMarque";
import { CHEMIN_PLATEFORME } from "../../../lib/plateforme-routes";
import { sessionPlateformeFacultative } from "../../../lib/plateforme-serveur";
import { FormulaireConnexionPlateforme } from "./FormulaireConnexionPlateforme";

export const metadata: Metadata = { title: "Connexion" };

export default async function PageConnexionPlateforme() {
  let ouverte = false;
  try {
    ouverte = (await sessionPlateformeFacultative()) !== null;
  } catch {
    // API injoignable : la page de connexion reste affichée (la connexion échouera lisiblement).
  }
  // `redirect` lève une exception propre à Next : hors du try.
  if (ouverte) redirect(CHEMIN_PLATEFORME);

  return (
    <main className="mp-connexion">
      <VisuelMarque
        titre="Console de la plateforme."
        texte="Les cabinets abonnés et leurs comptes, réservés aux administrateurs de la plateforme CabinetPilot."
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <h1 className="mp-connexion__titre">Console de la plateforme</h1>
          <p className="mp-texte-doux">
            Réservé aux administrateurs de la plateforme CabinetPilot.
          </p>
          <FormulaireConnexionPlateforme />
        </div>
      </div>
    </main>
  );
}
