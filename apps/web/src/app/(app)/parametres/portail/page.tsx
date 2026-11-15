import type { Metadata } from "next";
import Link from "next/link";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { CHEMIN_SECURITE_COMPTE } from "../../../../lib/navigation";
import {
  CHEMIN_PARAMETRES_PORTAIL,
  HREF_POLITIQUE_PORTAIL,
  type ParametresPortail,
} from "../../../../lib/portail-gestion";
import { exigerPermission } from "../../../../lib/session";
import { FormulairePolitiquePortail } from "./FormulairePolitiquePortail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Portail client", "Client portal") };
}

/**
 * Politique de sécurité du portail client (SOC-09) : double authentification exigée ou non
 * des personnes de vos clients. Modification réservée à « cabinet.gerer », avec
 * reconfirmation d'identité (mot de passe et second facteur de l'auteur).
 */
export default async function PageParametresPortail() {
  const session = await exigerPermission("cabinet.gerer");
  const t = await obtenirT();
  const r = await chargerServeur<ParametresPortail>(CHEMIN_PARAMETRES_PORTAIL);
  const tfaActive = session.tfa_active === true;
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Portail client", "Client portal")}
        soustitre={t(
          "Sécurité des accès que vos clients utilisent sur le portail. Ce que voit chaque client se règle depuis sa fiche, onglet « Portail client ».",
          "Security of the access your clients use on the portal. What each client sees is set from their profile, \u201cClient portal\u201d tab.",
        )}
      />
      <Carte
        titre={t(
          "Double authentification des utilisateurs du portail",
          "Two-factor authentication of portal users",
        )}
      >
        {!r.ok ? (
          <EtatErreur
            titre={t(
              "La politique du portail n'a pas pu être chargée.",
              "The portal policy could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={HREF_POLITIQUE_PORTAIL}
          />
        ) : (
          <div className="mp-pile">
            {tfaActive ? null : (
              <Alerte
                tonalite="attention"
                annonce="aucune"
                titre={t(
                  "Votre double authentification n'est pas active",
                  "Your two-factor authentication is not active",
                )}
              >
                <p>
                  {t(
                    "Modifier cette politique exige votre mot de passe et un code de votre application.",
                    "Changing this policy requires your password and a code from your app.",
                  )}{" "}
                  <Link href={CHEMIN_SECURITE_COMPTE}>
                    {t(
                      "Activer ma double authentification",
                      "Turn on my two-factor authentication",
                    )}
                  </Link>
                </p>
              </Alerte>
            )}
            <p className="mp-texte-doux">
              {t(
                "Les comptes du cabinet ne sont pas concernés : leur politique se règle dans « Sécurité ».",
                "Firm accounts are not affected: their policy is set in \u201cSecurity\u201d.",
              )}
            </p>
            <FormulairePolitiquePortail parametres={r.donnees} tfaActive={tfaActive} />
          </div>
        )}
      </Carte>
    </div>
  );
}
