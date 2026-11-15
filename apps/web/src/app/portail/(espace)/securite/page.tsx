import type { Metadata } from "next";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import type { EtatTfa } from "../../../../lib/double-authentification";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { CHEMIN_SECURITE_PORTAIL } from "../../../../lib/portail-routes";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";
// Même carte que la sécurité du compte côté cabinet : les routes /api/auth/2fa/* sont ouvertes
// aux utilisateurs du portail (liste blanche de l'API), sauf la politique du cabinet.
import { CarteDoubleAuthentification } from "../../../(app)/compte/securite/SecuriteCompte";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Sécurité", "Security") };
}

/** Sécurité de son propre compte du portail : double authentification. */
export default async function SecuritePortail() {
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  // /api/auth/2fa n'est pas soumise à la politique 2FA : pas de redirection en boucle.
  const r = await chargerPortail<EtatTfa>("/api/auth/2fa");

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Sécurité de votre accès", "Security of your access")}
        soustitre={t(
          `Compte ${utilisateur.email}. La double authentification demande, après le mot de passe, un code à 6 chiffres affiché par une application de votre téléphone.`,
          `Account ${utilisateur.email}. Two-factor authentication asks, after the password, for a 6-digit code shown by an app on your phone.`,
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "L'état de la double authentification n'a pas pu être chargé.",
            "The two-factor authentication status could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={CHEMIN_SECURITE_PORTAIL}
        />
      ) : (
        <CarteDoubleAuthentification etat={r.donnees} email={utilisateur.email} />
      )}
    </div>
  );
}
