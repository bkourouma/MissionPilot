import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
      <div className="mp-connexion__panneau">
        <div className="mp-connexion__marque">
          <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true" focusable="false">
            <rect width="32" height="32" rx="7" fill="currentColor" />
            <path
              d="M8 23V10l8 8 8-8v13"
              fill="none"
              stroke="var(--mp-sur-primaire)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>MissionPilot</span>
        </div>
        <h1 className="mp-connexion__titre">Console de la plateforme</h1>
        <p className="mp-texte-doux">Réservé aux administrateurs de la plateforme MissionPilot.</p>
        <FormulaireConnexionPlateforme />
      </div>
    </main>
  );
}
