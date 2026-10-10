import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { ItemModeleCloture } from "../../../../lib/cloture";
import { exigerPermission } from "../../../../lib/session";
import { ModeleCloture } from "./ModeleCloture";

export const metadata: Metadata = { title: "Check-list de clôture" };

/**
 * Modèle de check-list de clôture des missions du cabinet (AUT-08) : items activables, bloquants
 * ou non. Réservé au droit de paramétrer le cabinet ; une dérogation à un item bloquant reste
 * décidée mission par mission, avec un motif.
 */
export default async function PageModeleCloture() {
  await exigerPermission("cabinet.gerer");
  const r = await chargerServeur<{ items: ItemModeleCloture[] }>("/api/cloture/modele");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Check-list de clôture des missions"
        soustitre="Choisissez les vérifications exigées avant de clôturer une mission et celles qui bloquent. Un item bloquant non conforme interdit la clôture, sauf dérogation motivée d'un directeur de mission ou d'un associé."
      />
      <Carte titre="Items du modèle">
        {!r.ok ? (
          <EtatErreur
            titre="Le modèle n'a pas pu être chargé."
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
