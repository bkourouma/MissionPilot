import type { Metadata } from "next";
import { VisuelMarque } from "../../components/shell/VisuelMarque";
import { FormulaireInvitation } from "./FormulaireInvitation";

export const metadata: Metadata = { title: "Rejoindre votre cabinet" };

/**
 * Page publique d'acceptation d'invitation. Le jeton est dans le fragment de l'URL
 * (`#jeton=…`) : il n'est jamais reçu par ce serveur, seul le navigateur le lit.
 */
export default function PageInvitation() {
  return (
    <main className="mp-connexion">
      <VisuelMarque
        titre="Rejoignez votre cabinet sur CabinetPilot."
        texte="Temps, budget, facturation et conseil augmenté par l'IA, dans un seul outil pour votre cabinet."
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <h1 className="mp-connexion__titre">Rejoindre votre cabinet</h1>
          <p className="mp-texte-doux">
            Vous avez été invité à utiliser CabinetPilot. Indiquez votre nom et choisissez un mot de
            passe pour créer votre compte.
          </p>
          <FormulaireInvitation />
        </div>
      </div>
    </main>
  );
}
