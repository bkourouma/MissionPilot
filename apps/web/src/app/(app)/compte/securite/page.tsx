import type { Metadata } from "next";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirT } from "../../../../lib/i18n/serveur";
import type { EtatTfa } from "../../../../lib/double-authentification";
import { obtenirSession } from "../../../../lib/session";
import { CarteDoubleAuthentification } from "./SecuriteCompte";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Sécurité du compte", "Account security") };
}

/** Sécurité de son propre compte (SOC-02) : tout utilisateur connecté. */
export default async function PageSecuriteCompte() {
  const t = await obtenirT();
  const { utilisateur } = await obtenirSession();
  const r = await chargerServeur<EtatTfa>("/api/auth/2fa");

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Sécurité du compte", "Account security")}
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
          hrefReessayer="/compte/securite"
        />
      ) : (
        <CarteDoubleAuthentification etat={r.donnees} email={utilisateur.email} />
      )}
    </div>
  );
}
