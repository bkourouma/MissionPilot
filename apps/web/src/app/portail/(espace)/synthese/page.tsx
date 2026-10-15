import type { Metadata } from "next";
import type { SyntheseDirigeantApi } from "@missionpilot/shared";
import { VueSynthese } from "../../../../components/canaux/VueSynthese";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { peut } from "../../../../lib/portail";
import { API_SYNTHESE_PORTAIL, CHEMIN_SYNTHESE_PORTAIL } from "../../../../lib/portail-canaux";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Synthèse de la semaine" };

/**
 * Synthèse hebdomadaire du dirigeant (CLI-07), mobile d'abord : deux nombres, puis le détail et des
 * liens vers les pages concernées. Jamais un montant.
 */
export default async function SynthesePortail() {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.synthese.lire")) {
    return <NonDisponible titre="Synthèse" />;
  }
  const r = await chargerPortail<SyntheseDirigeantApi>(API_SYNTHESE_PORTAIL);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Votre semaine"
        soustitre="Ce qui demande votre attention aujourd'hui, avec un lien vers chaque sujet."
      />
      {!r.ok ? (
        <EtatErreur
          titre="La synthèse n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={CHEMIN_SYNTHESE_PORTAIL}
        />
      ) : r.donnees.vide ? (
        <EtatVide titre="Rien à signaler cette semaine." icone="succes">
          <p>Aucun point d&apos;attention ni décision attendue.</p>
        </EtatVide>
      ) : (
        <VueSynthese synthese={r.donnees} avecLiens />
      )}
    </div>
  );
}
