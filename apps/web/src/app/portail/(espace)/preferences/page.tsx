import type { Metadata } from "next";
import { PreferenceCanalPortail } from "../../../../components/canaux/PreferenceCanalPortail";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { BANDEAU_SIMULE } from "../../../../lib/canaux";
import { Alerte } from "../../../../components/ui/Alerte";
import { peut } from "../../../../lib/portail";
import {
  API_CANAUX_MOI_PORTAIL,
  canauxMoi,
  CHEMIN_PREFERENCES_PORTAIL,
} from "../../../../lib/portail-canaux";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Messages et consentement" };

/**
 * Préférences de messagerie (CLI-02) : pour WhatsApp et pour SMS, votre numéro, la mention de
 * consentement, la vérification par code et le retrait immédiat. Tout est simulé.
 */
export default async function PreferencesPortail() {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.canaux.gerer")) {
    return <NonDisponible titre="Messages" />;
  }
  const r = await chargerPortail<unknown>(API_CANAUX_MOI_PORTAIL);
  const canaux = r.ok ? canauxMoi(r.donnees) : [];
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Vos messages"
        soustitre="Choisissez si votre cabinet peut vous écrire par WhatsApp ou par SMS. Vous donnez votre accord vous-même, et vous pouvez le retirer à tout moment."
      />
      <Alerte tonalite="info" annonce="aucune" titre={BANDEAU_SIMULE}>
        <p>
          Pour l&apos;instant, aucun message réel n&apos;est envoyé : seuls des numéros de test sont
          acceptés.
        </p>
      </Alerte>
      {!r.ok ? (
        <EtatErreur
          titre="Vos préférences n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={CHEMIN_PREFERENCES_PORTAIL}
        />
      ) : canaux.length === 0 ? (
        <EtatVide titre="Aucun canal de messagerie n'est proposé." icone="bulle">
          <p>Votre cabinet n&apos;a pas encore ouvert de canal de messagerie.</p>
        </EtatVide>
      ) : (
        canaux.map((c) => <PreferenceCanalPortail key={c.canal} moi={c} />)
      )}
    </div>
  );
}
