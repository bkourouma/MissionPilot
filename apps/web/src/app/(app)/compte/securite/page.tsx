import type { Metadata } from "next";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { EtatTfa } from "../../../../lib/double-authentification";
import { obtenirSession } from "../../../../lib/session";
import { CarteDoubleAuthentification } from "./SecuriteCompte";

export const metadata: Metadata = { title: "Sécurité du compte" };

/** Sécurité de son propre compte (SOC-02) : tout utilisateur connecté. */
export default async function PageSecuriteCompte() {
  const { utilisateur } = await obtenirSession();
  const r = await chargerServeur<EtatTfa>("/api/auth/2fa");

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Sécurité du compte"
        soustitre={`Compte ${utilisateur.email}. La double authentification demande, après le mot de passe, un code à 6 chiffres affiché par une application de votre téléphone.`}
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'état de la double authentification n'a pas pu être chargé."
          message={r.message}
          hrefReessayer="/compte/securite"
        />
      ) : (
        <CarteDoubleAuthentification etat={r.donnees} email={utilisateur.email} />
      )}
    </div>
  );
}
