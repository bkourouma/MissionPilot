import type { Metadata } from "next";
import type { SyntheseDirigeantApi } from "@missionpilot/shared";
import { VueSynthese } from "../../../../components/canaux/VueSynthese";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { peut } from "../../../../lib/portail";
import { API_SYNTHESE_PORTAIL, CHEMIN_SYNTHESE_PORTAIL } from "../../../../lib/portail-canaux";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Synthèse de la semaine", "Weekly summary") };
}

/**
 * Synthèse hebdomadaire du dirigeant (CLI-07), mobile d'abord : deux nombres, puis le détail et des
 * liens vers les pages concernées. Jamais un montant.
 */
export default async function SynthesePortail() {
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.synthese.lire")) {
    return <NonDisponible titre={t("Synthèse", "Summary")} />;
  }
  const r = await chargerPortail<SyntheseDirigeantApi>(API_SYNTHESE_PORTAIL);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Votre semaine", "Your week")}
        soustitre={t(
          "Ce qui demande votre attention aujourd'hui, avec un lien vers chaque sujet.",
          "What needs your attention today, with a link to each topic.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("La synthèse n'a pas pu être chargée.", "The summary could not be loaded.")}
          message={r.message}
          hrefReessayer={CHEMIN_SYNTHESE_PORTAIL}
        />
      ) : r.donnees.vide ? (
        <EtatVide
          titre={t("Rien à signaler cette semaine.", "Nothing to report this week.")}
          icone="succes"
        >
          <p>
            {t(
              "Aucun point d'attention ni décision attendue.",
              "No points of attention or decisions needed.",
            )}
          </p>
        </EtatVide>
      ) : (
        <VueSynthese synthese={r.donnees} avecLiens />
      )}
    </div>
  );
}
