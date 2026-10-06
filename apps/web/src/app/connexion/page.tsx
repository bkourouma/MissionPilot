import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cheminDeRetour } from "../../lib/connexion";
import { sessionFacultative } from "../../lib/session";
import { FormulaireConnexion } from "./FormulaireConnexion";

export const metadata: Metadata = { title: "Connexion" };

export default async function PageConnexion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const suite = cheminDeRetour((await searchParams).suite);
  // Déjà connecté (session valide) : pas besoin de se reconnecter.
  if (await sessionFacultative()) redirect(suite);

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
        <h1 className="mp-connexion__titre">Connexion</h1>
        <p className="mp-texte-doux">Accédez à l&apos;espace de votre cabinet.</p>
        <FormulaireConnexion suite={suite} />
      </div>
    </main>
  );
}
