import type { Metadata } from "next";
import { CarteCompteCanal } from "../../../../components/canaux/CarteCompteCanal";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { CHEMIN_PARAMETRES_CANAUX, droitsCanaux } from "../../../../lib/canaux";
import { chargerComptesCanaux } from "../../../../lib/canaux-serveur";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Canaux de messagerie" };

/**
 * Comptes de canal du cabinet (WhatsApp, SMS de repli) : état, mode, interrupteur « Activé »
 * (associé, avec reconfirmation ; tout titulaire de `canaux.gerer` peut désactiver) et options.
 * Tout est simulé : le bandeau de la rubrique le rappelle sur chaque onglet.
 */
export default async function PageComptesCanaux() {
  const { utilisateur } = await exigerPermission("canaux.lire");
  const droits = droitsCanaux(utilisateur.roles);
  const r = await chargerComptesCanaux();
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Canaux de messagerie"
        soustitre="WhatsApp et SMS de repli pour les rappels, la synthèse hebdomadaire du dirigeant et la saisie de KPI par message. Aucun contenu confidentiel ne part, et seul un destinataire ayant donné son accord est joint."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les comptes de canal n'ont pas pu être chargés."
          message={r.message}
          hrefReessayer={CHEMIN_PARAMETRES_CANAUX}
        />
      ) : r.donnees.length === 0 ? (
        <EtatVide titre="Aucun canal n'est disponible." icone="bulle">
          <p>
            Aucun fournisseur de canal n&apos;est configuré sur ce serveur : rien ne peut être
            activé.
          </p>
        </EtatVide>
      ) : (
        <div className="mp-canaux__cartes">
          {r.donnees.map((c) => (
            <CarteCompteCanal
              key={c.canal}
              compte={c}
              peutConfigurer={droits.configurer}
              peutGerer={droits.gerer}
            />
          ))}
        </div>
      )}
    </div>
  );
}
