import type { Metadata } from "next";
import { PreferenceCanalPortail } from "../../../../components/canaux/PreferenceCanalPortail";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { BANDEAU_SIMULE, BANDEAU_SIMULE_EN } from "../../../../lib/canaux";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { Alerte } from "../../../../components/ui/Alerte";
import { peut } from "../../../../lib/portail";
import {
  API_CANAUX_MOI_PORTAIL,
  canauxMoi,
  CHEMIN_PREFERENCES_PORTAIL,
} from "../../../../lib/portail-canaux";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Messages et consentement", "Messages and consent") };
}

/**
 * Préférences de messagerie (CLI-02) : pour WhatsApp et pour SMS, votre numéro, la mention de
 * consentement, la vérification par code et le retrait immédiat. Tout est simulé.
 */
export default async function PreferencesPortail() {
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.canaux.gerer")) {
    return <NonDisponible titre={t("Messages", "Messages")} />;
  }
  const r = await chargerPortail<unknown>(API_CANAUX_MOI_PORTAIL);
  const canaux = r.ok ? canauxMoi(r.donnees) : [];
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Vos messages", "Your messages")}
        soustitre={t(
          "Choisissez si votre cabinet peut vous écrire par WhatsApp ou par SMS. Vous donnez votre accord vous-même, et vous pouvez le retirer à tout moment.",
          "Choose whether your firm may write to you by WhatsApp or SMS. You give your consent yourself, and you can withdraw it at any time.",
        )}
      />
      <Alerte tonalite="info" annonce="aucune" titre={t(BANDEAU_SIMULE, BANDEAU_SIMULE_EN)}>
        <p>
          {t(
            "Pour l'instant, aucun message réel n'est envoyé : seuls des numéros de test sont acceptés.",
            "For now, no real message is sent: only test numbers are accepted.",
          )}
        </p>
      </Alerte>
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Vos préférences n'ont pas pu être chargées.",
            "Your preferences could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={CHEMIN_PREFERENCES_PORTAIL}
        />
      ) : canaux.length === 0 ? (
        <EtatVide
          titre={t("Aucun canal de messagerie n'est proposé.", "No messaging channel is offered.")}
          icone="bulle"
        >
          <p>
            {t(
              "Votre cabinet n'a pas encore ouvert de canal de messagerie.",
              "Your firm has not opened a messaging channel yet.",
            )}
          </p>
        </EtatVide>
      ) : (
        canaux.map((c) => <PreferenceCanalPortail key={c.canal} moi={c} />)
      )}
    </div>
  );
}
