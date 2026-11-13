import type { Metadata } from "next";
import { VisuelMarque } from "../../components/shell/VisuelMarque";
import { obtenirT } from "../../lib/i18n/serveur";
import { FormulaireInvitation } from "./FormulaireInvitation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Rejoindre votre cabinet", "Join your firm") };
}

/**
 * Page publique d'acceptation d'invitation. Le jeton est dans le fragment de l'URL
 * (`#jeton=…`) : il n'est jamais reçu par ce serveur, seul le navigateur le lit.
 */
export default async function PageInvitation() {
  const t = await obtenirT();
  return (
    <main className="mp-connexion">
      <VisuelMarque
        titre={t("Rejoignez votre cabinet sur CabinetPilot.", "Join your firm on CabinetPilot.")}
        texte={t(
          "Temps, budget, facturation et conseil augmenté par l'IA, dans un seul outil pour votre cabinet.",
          "Time, budget, billing and AI-augmented consulting, in a single tool for your firm.",
        )}
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <h1 className="mp-connexion__titre">{t("Rejoindre votre cabinet", "Join your firm")}</h1>
          <p className="mp-texte-doux">
            {t(
              "Vous avez été invité à utiliser CabinetPilot. Indiquez votre nom et choisissez un mot de passe pour créer votre compte.",
              "You have been invited to use CabinetPilot. Enter your name and choose a password to create your account.",
            )}
          </p>
          <FormulaireInvitation />
        </div>
      </div>
    </main>
  );
}
