import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cheminDeRetour } from "../../lib/connexion";
import { destinationApresConnexion, estCheminPortail } from "../../lib/portail-routes";
import { sessionFacultative } from "../../lib/session";
import { chargerComptesDemo } from "./comptes-demo-serveur";
import { VisuelMarque } from "../../components/shell/VisuelMarque";
import { FormulaireConnexion } from "./FormulaireConnexion";

export const metadata: Metadata = { title: "Connexion" };

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
  // Recette locale : liste servie par l'API seulement avec CONNEXION_RAPIDE_DEMO=oui ; sinon rien.
  const comptesDemo = await chargerComptesDemo();

  return (
    <main className="mp-connexion">
      <VisuelMarque
        titre={
          espaceClient
            ? "Suivez vos missions, vos documents et vos factures."
            : "Pilotez chaque mission, de la proposition à la clôture."
        }
        texte={
          espaceClient
            ? "L'espace que votre cabinet partage avec vous, au même endroit."
            : "Temps, budget, facturation et conseil augmenté par l'IA, dans un seul outil pour votre cabinet."
        }
      />
      <div className="mp-connexion__zone">
        <div className="mp-connexion__panneau">
          <h1 className="mp-connexion__titre">Connexion</h1>
          <p className="mp-texte-doux">
            {espaceClient
              ? "Accédez à votre espace client : missions, documents et factures partagés par votre cabinet."
              : "Accédez à l'espace de votre cabinet."}
          </p>
          <FormulaireConnexion suite={suite} comptesDemo={comptesDemo} />
        </div>
      </div>
    </main>
  );
}
