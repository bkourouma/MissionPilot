import type { Metadata } from "next";
import { obtenirT } from "../../../lib/i18n/serveur";
import { VisuelMarque } from "../../../components/shell/VisuelMarque";
import { FormulaireInvitationPortail } from "../../../components/portail/FormulaireInvitationPortail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Activer votre espace client", "Activate your client space") };
}

/**
 * Page publique d'acceptation d'une invitation au portail client. Le jeton est dans le fragment
 * de l'URL (`#jeton=…`) : il n'est jamais reçu par ce serveur, seul le navigateur le lit, puis
 * il est retiré de la barre d'adresse et de l'historique.
 */
export default async function PageInvitationPortail() {
  const t = await obtenirT();
  return (
    <main className="mp-connexion">
      <VisuelMarque
        titre={t("Suivez vos missions en ligne.", "Follow your engagements online.")}
        texte={t(
          "Avancement, documents et factures partagés par votre cabinet de conseil, dans un espace sécurisé.",
          "Progress, documents and invoices shared by your consulting firm, in a secure space.",
        )}
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <h1 className="mp-connexion__titre">
            {t("Activer votre espace client", "Activate your client space")}
          </h1>
          <p className="mp-texte-doux">
            {t(
              "Votre cabinet de conseil vous invite à suivre vos missions en ligne : avancement, documents et factures. Indiquez votre nom et choisissez un mot de passe pour créer votre accès.",
              "Your consulting firm invites you to follow your engagements online: progress, documents and invoices. Enter your name and choose a password to create your access.",
            )}
          </p>
          <FormulaireInvitationPortail />
        </div>
      </div>
    </main>
  );
}
