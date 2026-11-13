import type { ReactNode } from "react";
import { Marque } from "../../../components/shell/Marque";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { exigerSessionPlateforme } from "../../../lib/plateforme-serveur";
import { BoutonDeconnexionPlateforme } from "./BoutonDeconnexionPlateforme";
import { obtenirT } from "../../../lib/i18n/serveur";
import { SelecteurLangue } from "../../../components/i18n/SelecteurLangue";

/**
 * Garde serveur de la console : toute page de ce groupe exige une session plateforme valide
 * (sinon /plateforme/connexion). Coque sans menu métier : le super administrateur ne voit que
 * les cabinets et leurs comptes.
 */
export default async function LayoutConsole({ children }: { children: ReactNode }) {
  const session = await exigerSessionPlateforme();
  const t = await obtenirT();
  return (
    <div className="mp-plateforme">
      <a className="mp-lien-evitement" href="#contenu">
        {t("Aller au contenu", "Skip to content")}
      </a>
      <header className="mp-plateforme__entete">
        <div className="mp-plateforme__marque">
          <Marque tailleSymbole={30} />
          <span className="mp-plateforme__espace">
            {t("Console plateforme", "Platform console")}
          </span>
        </div>
        <div className="mp-plateforme__compte">
          <p className="mp-plateforme__identite">
            <span className="mp-plateforme__nom">{session.nom}</span>
            <span className="mp-plateforme__email">{session.email}</span>
            {session.estDemo ? (
              <BadgeStatut tonalite="attention" sansIcone>
                {t("Démo", "Demo")}
              </BadgeStatut>
            ) : null}
          </p>
          <SelecteurLangue />
          <BoutonDeconnexionPlateforme estDemo={session.estDemo} />
        </div>
      </header>
      <main id="contenu" className="mp-plateforme__contenu" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
