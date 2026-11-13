import type { Metadata } from "next";
import { CarteCompteCanal } from "../../../../components/canaux/CarteCompteCanal";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { CHEMIN_PARAMETRES_CANAUX, droitsCanaux } from "../../../../lib/canaux";
import { chargerComptesCanaux } from "../../../../lib/canaux-serveur";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Canaux de messagerie", "Messaging channels") };
}

/**
 * Comptes de canal du cabinet (WhatsApp, SMS de repli) : état, mode, interrupteur « Activé »
 * (associé, avec reconfirmation ; tout titulaire de `canaux.gerer` peut désactiver) et options.
 * Tout est simulé : le bandeau de la rubrique le rappelle sur chaque onglet.
 */
export default async function PageComptesCanaux() {
  const { utilisateur } = await exigerPermission("canaux.lire");
  const t = await obtenirT();
  const droits = droitsCanaux(utilisateur.roles);
  const r = await chargerComptesCanaux();
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Canaux de messagerie", "Messaging channels")}
        soustitre={t(
          "WhatsApp et SMS de repli pour les rappels, la synthèse hebdomadaire du dirigeant et la saisie de KPI par message. Aucun contenu confidentiel ne part, et seul un destinataire ayant donné son accord est joint.",
          "WhatsApp and fallback SMS for reminders, the weekly executive summary and KPI entry by message. No confidential content is sent, and only a recipient who has given consent is reached.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les comptes de canal n'ont pas pu être chargés.",
            "The channel accounts could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={CHEMIN_PARAMETRES_CANAUX}
        />
      ) : r.donnees.length === 0 ? (
        <EtatVide
          titre={t("Aucun canal n'est disponible.", "No channel is available.")}
          icone="bulle"
        >
          <p>
            {t(
              "Aucun fournisseur de canal n'est configuré sur ce serveur : rien ne peut être activé.",
              "No channel provider is configured on this server: nothing can be enabled.",
            )}
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
