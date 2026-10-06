import type { ReactNode } from "react";
import { CadreApplication } from "../../components/shell/CadreApplication";
import { entreesAutorisees } from "../../lib/navigation";
import { obtenirSession } from "../../lib/session";

/** Garde serveur : toute page de ce groupe exige une session valide (sinon /connexion). */
export default async function LayoutApplication({ children }: { children: ReactNode }) {
  const { utilisateur } = await obtenirSession();
  return (
    <CadreApplication
      nom={utilisateur.nom}
      roles={utilisateur.roles}
      entrees={entreesAutorisees(utilisateur.roles)}
    >
      {children}
    </CadreApplication>
  );
}
