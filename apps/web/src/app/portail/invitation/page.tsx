import type { Metadata } from "next";
import { FormulaireInvitationPortail } from "../../../components/portail/FormulaireInvitationPortail";

export const metadata: Metadata = { title: "Activer votre espace client" };

/**
 * Page publique d'acceptation d'une invitation au portail client. Le jeton est dans le fragment
 * de l'URL (`#jeton=…`) : il n'est jamais reçu par ce serveur, seul le navigateur le lit, puis
 * il est retiré de la barre d'adresse et de l'historique.
 */
export default function PageInvitationPortail() {
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
        <h1 className="mp-connexion__titre">Activer votre espace client</h1>
        <p className="mp-texte-doux">
          Votre cabinet de conseil vous invite à suivre vos missions en ligne : avancement,
          documents et factures. Indiquez votre nom et choisissez un mot de passe pour créer votre
          accès.
        </p>
        <FormulaireInvitationPortail />
      </div>
    </main>
  );
}
