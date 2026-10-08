import Link from "next/link";
import type { ReactNode } from "react";
import { CadreApplication } from "../../components/shell/CadreApplication";
import { Alerte } from "../../components/ui/Alerte";
import { CHEMIN_SECURITE_COMPTE, entreesAutorisees } from "../../lib/navigation";
import { obtenirSession } from "../../lib/session";

/** Garde serveur : toute page de ce groupe exige une session valide (sinon /connexion). */
export default async function LayoutApplication({ children }: { children: ReactNode }) {
  const session = await obtenirSession();
  const { utilisateur } = session;
  return (
    <CadreApplication
      nom={utilisateur.nom}
      roles={utilisateur.roles}
      entrees={entreesAutorisees(utilisateur.roles)}
    >
      {session.tfa_a_configurer ? (
        <div className="mp-bandeau-tfa">
          <Alerte
            tonalite="attention"
            annonce="aucune"
            titre="Configurez la double authentification"
          >
            <p>
              Votre cabinet l&apos;exige pour votre rôle : elle protège l&apos;accès aux données
              financières et aux clients.{" "}
              <Link href={CHEMIN_SECURITE_COMPTE}>Activer maintenant</Link>
            </p>
          </Alerte>
        </div>
      ) : null}
      {children}
    </CadreApplication>
  );
}
