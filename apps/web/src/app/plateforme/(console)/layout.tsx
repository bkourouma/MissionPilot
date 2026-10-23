import type { ReactNode } from "react";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { exigerSessionPlateforme } from "../../../lib/plateforme-serveur";
import { BoutonDeconnexionPlateforme } from "./BoutonDeconnexionPlateforme";

/** Logo MissionPilot (décoratif : le texte voisin porte le nom). */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
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
  );
}

/**
 * Garde serveur de la console : toute page de ce groupe exige une session plateforme valide
 * (sinon /plateforme/connexion). Coque sans menu métier : le super administrateur ne voit que
 * les cabinets et leurs comptes.
 */
export default async function LayoutConsole({ children }: { children: ReactNode }) {
  const session = await exigerSessionPlateforme();
  return (
    <div className="mp-plateforme">
      <a className="mp-lien-evitement" href="#contenu">
        Aller au contenu
      </a>
      <header className="mp-plateforme__entete">
        <div className="mp-plateforme__marque">
          <Logo />
          <span className="mp-plateforme__marque-textes">
            <span className="mp-plateforme__produit">MissionPilot</span>
            <span className="mp-plateforme__espace">Console plateforme</span>
          </span>
        </div>
        <div className="mp-plateforme__compte">
          <p className="mp-plateforme__identite">
            <span className="mp-plateforme__nom">{session.nom}</span>
            <span className="mp-plateforme__email">{session.email}</span>
            {session.estDemo ? (
              <BadgeStatut tonalite="attention" sansIcone>
                Démo
              </BadgeStatut>
            ) : null}
          </p>
          <BoutonDeconnexionPlateforme estDemo={session.estDemo} />
        </div>
      </header>
      <main id="contenu" className="mp-plateforme__contenu" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
