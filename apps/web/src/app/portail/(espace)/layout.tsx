import type { ReactNode } from "react";
import { CadrePortail } from "../../../components/portail/CadrePortail";
import { entreesPortail } from "../../../lib/portail";
import { chargerProfilPortail, obtenirSessionPortail } from "../../../lib/portail-serveur";

/**
 * Garde serveur de l'espace client : session d'un utilisateur du portail (sinon /connexion,
 * ou le tableau de bord pour un utilisateur du cabinet). La source de vérité des droits reste
 * l'API (liste blanche du portail).
 */
export default async function LayoutEspaceClient({ children }: { children: ReactNode }) {
  const session = await obtenirSessionPortail();
  const { utilisateur } = session;
  // Tant que la double authentification exigée n'est pas activée, l'API refuse le profil :
  // inutile de le demander (le cadre reste affiché pour la page « Sécurité »).
  const profil = session.tfa_a_configurer ? null : await chargerProfilPortail();
  return (
    <CadrePortail
      nom={utilisateur.nom}
      entreprise={profil?.ok ? profil.donnees.entreprise.raison_sociale : null}
      entrees={entreesPortail(utilisateur.roles)}
      tfaAConfigurer={session.tfa_a_configurer === true}
    >
      {children}
    </CadrePortail>
  );
}
