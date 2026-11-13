import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { ItemModeleCloture } from "../../../../lib/cloture";
import { exigerPermission } from "../../../../lib/session";
import { ModeleCloture } from "./ModeleCloture";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Check-list de clôture", "Close-out checklist") };
}

/**
 * Modèle de check-list de clôture des missions du cabinet (AUT-08) : items activables, bloquants
 * ou non. Réservé au droit de paramétrer le cabinet ; une dérogation à un item bloquant reste
 * décidée mission par mission, avec un motif.
 */
export default async function PageModeleCloture() {
  await exigerPermission("cabinet.gerer");
  const t = await obtenirT();
  const r = await chargerServeur<{ items: ItemModeleCloture[] }>("/api/cloture/modele");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Check-list de clôture des missions", "Engagement close-out checklist")}
        soustitre={t(
          "Choisissez les vérifications exigées avant de clôturer une mission et celles qui bloquent. Un item bloquant non conforme interdit la clôture, sauf dérogation motivée d'un directeur de mission ou d'un associé.",
          "Choose the checks required before closing an engagement and which ones block. A non-compliant blocking item prevents close-out, unless an engagement director or partner grants a reasoned waiver.",
        )}
      />
      <Carte titre={t("Items du modèle", "Template items")}>
        {!r.ok ? (
          <EtatErreur
            titre={t("Le modèle n'a pas pu être chargé.", "The template could not be loaded.")}
            message={r.message}
            hrefReessayer="/parametres/cloture-mission"
          />
        ) : (
          <ModeleCloture items={r.donnees.items} />
        )}
      </Carte>
    </div>
  );
}
