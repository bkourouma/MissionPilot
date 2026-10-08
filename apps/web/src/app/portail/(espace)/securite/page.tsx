import type { Metadata } from "next";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import type { EtatTfa } from "../../../../lib/double-authentification";
import { CHEMIN_SECURITE_PORTAIL } from "../../../../lib/portail-routes";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";
// Même carte que la sécurité du compte côté cabinet : les routes /api/auth/2fa/* sont ouvertes
// aux utilisateurs du portail (liste blanche de l'API), sauf la politique du cabinet.
import { CarteDoubleAuthentification } from "../../../(app)/compte/securite/SecuriteCompte";

export const metadata: Metadata = { title: "Sécurité" };

/** Sécurité de son propre compte du portail : double authentification. */
export default async function SecuritePortail() {
  const { utilisateur } = await obtenirSessionPortail();
  // /api/auth/2fa n'est pas soumise à la politique 2FA : pas de redirection en boucle.
  const r = await chargerPortail<EtatTfa>("/api/auth/2fa");

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Sécurité de votre accès"
        soustitre={`Compte ${utilisateur.email}. La double authentification demande, après le mot de passe, un code à 6 chiffres affiché par une application de votre téléphone.`}
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'état de la double authentification n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={CHEMIN_SECURITE_PORTAIL}
        />
      ) : (
        <CarteDoubleAuthentification etat={r.donnees} email={utilisateur.email} />
      )}
    </div>
  );
}
