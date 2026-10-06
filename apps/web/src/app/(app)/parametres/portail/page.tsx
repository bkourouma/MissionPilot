import type { Metadata } from "next";
import Link from "next/link";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { CHEMIN_SECURITE_COMPTE } from "../../../../lib/navigation";
import {
  CHEMIN_PARAMETRES_PORTAIL,
  HREF_POLITIQUE_PORTAIL,
  type ParametresPortail,
} from "../../../../lib/portail-gestion";
import { exigerPermission } from "../../../../lib/session";
import { FormulairePolitiquePortail } from "./FormulairePolitiquePortail";

export const metadata: Metadata = { title: "Portail client" };

/**
 * Politique de sécurité du portail client (SOC-09) : double authentification exigée ou non
 * des personnes de vos clients. Modification réservée à « cabinet.gerer », avec
 * reconfirmation d'identité (mot de passe et second facteur de l'auteur).
 */
export default async function PageParametresPortail() {
  const session = await exigerPermission("cabinet.gerer");
  const r = await chargerServeur<ParametresPortail>(CHEMIN_PARAMETRES_PORTAIL);
  const tfaActive = session.tfa_active === true;
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Portail client"
        soustitre="Sécurité des accès que vos clients utilisent sur le portail. Ce que voit chaque client se règle depuis sa fiche, onglet « Portail client »."
      />
      <Carte titre="Double authentification des utilisateurs du portail">
        {!r.ok ? (
          <EtatErreur
            titre="La politique du portail n'a pas pu être chargée."
            message={r.message}
            hrefReessayer={HREF_POLITIQUE_PORTAIL}
          />
        ) : (
          <div className="mp-pile">
            {tfaActive ? null : (
              <Alerte
                tonalite="attention"
                annonce="aucune"
                titre="Votre double authentification n'est pas active"
              >
                <p>
                  Modifier cette politique exige votre mot de passe et un code de votre application.{" "}
                  <Link href={CHEMIN_SECURITE_COMPTE}>Activer ma double authentification</Link>
                </p>
              </Alerte>
            )}
            <p className="mp-texte-doux">
              {
                "Les comptes du cabinet ne sont pas concernés : leur politique se règle dans « Sécurité »."
              }
            </p>
            <FormulairePolitiquePortail parametres={r.donnees} tfaActive={tfaActive} />
          </div>
        )}
      </Carte>
    </div>
  );
}
