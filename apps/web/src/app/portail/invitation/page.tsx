import type { Metadata } from "next";
import { VisuelMarque } from "../../../components/shell/VisuelMarque";
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
      <VisuelMarque
        titre="Suivez vos missions en ligne."
        texte="Avancement, documents et factures partagés par votre cabinet de conseil, dans un espace sécurisé."
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <h1 className="mp-connexion__titre">Activer votre espace client</h1>
          <p className="mp-texte-doux">
            Votre cabinet de conseil vous invite à suivre vos missions en ligne : avancement,
            documents et factures. Indiquez votre nom et choisissez un mot de passe pour créer votre
            accès.
          </p>
          <FormulaireInvitationPortail />
        </div>
      </div>
    </main>
  );
}
