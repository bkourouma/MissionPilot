import type { Metadata } from "next";
import { FormulaireInvitation } from "./FormulaireInvitation";

export const metadata: Metadata = { title: "Rejoindre votre cabinet" };

/**
 * Page publique d'acceptation d'invitation. Le jeton est dans le fragment de l'URL
 * (`#jeton=…`) : il n'est jamais reçu par ce serveur, seul le navigateur le lit.
 */
export default function PageInvitation() {
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
        <h1 className="mp-connexion__titre">Rejoindre votre cabinet</h1>
        <p className="mp-texte-doux">
          Vous avez été invité à utiliser MissionPilot. Indiquez votre nom et choisissez un mot de
          passe pour créer votre compte.
        </p>
        <FormulaireInvitation />
      </div>
    </main>
  );
}
