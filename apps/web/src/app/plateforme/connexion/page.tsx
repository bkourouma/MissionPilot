import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VisuelMarque } from "../../../components/shell/VisuelMarque";
import { obtenirT } from "../../../lib/i18n/serveur";
import { CHEMIN_PLATEFORME } from "../../../lib/plateforme-routes";
import { sessionPlateformeFacultative } from "../../../lib/plateforme-serveur";
import { FormulaireConnexionPlateforme } from "./FormulaireConnexionPlateforme";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Connexion", "Sign in") };
}

export default async function PageConnexionPlateforme() {
  const t = await obtenirT();
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
        titre={t("Console de la plateforme.", "Platform console.")}
        texte={t(
          "Les cabinets abonnés et leurs comptes, réservés aux administrateurs de la plateforme CabinetPilot.",
          "Subscribed firms and their accounts, reserved for CabinetPilot platform administrators.",
        )}
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <h1 className="mp-connexion__titre">
            {t("Console de la plateforme", "Platform console")}
          </h1>
          <p className="mp-texte-doux">
            {t(
              "Réservé aux administrateurs de la plateforme CabinetPilot.",
              "Reserved for CabinetPilot platform administrators.",
            )}
          </p>
          <FormulaireConnexionPlateforme />
        </div>
      </div>
    </main>
  );
}
