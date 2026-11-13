import type { Metadata } from "next";
import { SelecteurLangue } from "../../components/i18n/SelecteurLangue";
import { obtenirT } from "../../lib/i18n/serveur";
import { redirect } from "next/navigation";
import { cheminDeRetour } from "../../lib/connexion";
import { destinationApresConnexion, estCheminPortail } from "../../lib/portail-routes";
import { sessionFacultative } from "../../lib/session";
import { VisuelMarque } from "../../components/shell/VisuelMarque";
import { chargerDemo } from "./comptes-demo-serveur";
import { FormulaireConnexion } from "./FormulaireConnexion";
import { LienAdministrateur } from "./LienAdministrateur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Connexion", "Sign in") };
}

export default async function PageConnexion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const suite = cheminDeRetour((await searchParams).suite);
  // Déjà connecté (session valide) : pas besoin de se reconnecter ; l'espace dépend du compte
  // (portail client ou cabinet).
  const session = await sessionFacultative();
  if (session) redirect(destinationApresConnexion(suite, session.portail === true));
  const espaceClient = estCheminPortail(suite);
  // Démonstration multi-cabinets : servie par l'API seulement si elle est active ; sinon rien.
  const demo = await chargerDemo();
  const t = await obtenirT();

  return (
    <main className="mp-connexion">
      <VisuelMarque
        titre={
          espaceClient
            ? t(
                "Suivez vos missions, vos documents et vos factures.",
                "Follow your engagements, documents and invoices.",
              )
            : t(
                "Pilotez chaque mission, de la proposition à la clôture.",
                "Steer every engagement, from proposal to close.",
              )
        }
        texte={
          espaceClient
            ? t(
                "L'espace que votre cabinet partage avec vous, au même endroit.",
                "The space your firm shares with you, all in one place.",
              )
            : t(
                "Temps, budget, facturation et conseil augmenté par l'IA, dans un seul outil pour votre cabinet.",
                "Time, budget, billing and AI-augmented consulting, in a single tool for your firm.",
              )
        }
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <div className="mp-connexion__langue">
            <SelecteurLangue />
          </div>
          <h1 className="mp-connexion__titre">{t("Connexion", "Sign in")}</h1>
          <p className="mp-texte-doux">
            {espaceClient
              ? t(
                  "Accédez à votre espace client : missions, documents et factures partagés par votre cabinet.",
                  "Access your client space: engagements, documents and invoices shared by your firm.",
                )
              : t("Accédez à l'espace de votre cabinet.", "Access your firm's workspace.")}
          </p>
          <FormulaireConnexion suite={suite} demo={demo} />
          <LienAdministrateur />
        </div>
      </div>
    </main>
  );
}
