import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChiffresRapport } from "../../../../../../components/avancement/ChiffresRapport";
import { EditeurRapport } from "../../../../../../components/avancement/EditeurRapport";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import {
  cheminApiRapportAvancement,
  etatRapport,
  hrefAvancementMission,
  hrefRapportAvancement,
  libelleSemaineRapport,
  MENTION_CHIFFRES_MOTEUR,
  MENTION_VISIBILITE_CLIENT,
  type RapportAvancement,
} from "../../../../../../lib/avancement";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Rapport d'avancement" };

/**
 * Relecture d'un rapport d'avancement : chiffres du moteur en lecture seule, puis introduction et
 * commentaire modifiables tant que le rapport n'est pas validé. Un rapport validé est figé.
 */
export default async function PageRapportAvancement({
  params,
}: {
  params: Promise<{ id: string; rapportId: string }>;
}) {
  const { id, rapportId } = await params;
  if (!estIdentifiant(rapportId)) notFound();
  await exigerPermission("avancement.lire");
  const r = await chargerServeur<RapportAvancement>(cheminApiRapportAvancement(rapportId));
  if (!r.ok && r.statut === 404) notFound();
  const retour = (
    <Link href={hrefAvancementMission(id)} className="mp-lien-retour">
      Revenir aux rapports d&apos;avancement
    </Link>
  );
  if (!r.ok) {
    return (
      <div className="mp-pile mp-pile--large">
        {retour}
        <EtatErreur
          titre="Le rapport n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={hrefRapportAvancement(id, rapportId)}
        />
      </div>
    );
  }
  const rapport = r.donnees;
  // Le rapport doit appartenir à la mission de l'URL.
  if (rapport.mission_id !== id) notFound();
  const etat = etatRapport(rapport.statut);
  return (
    <div className="mp-pile mp-pile--large">
      {retour}
      <section aria-labelledby="titre-rapport" className="mp-pile">
        <h2 id="titre-rapport" className="mp-section__titre">
          {libelleSemaineRapport(rapport)}{" "}
          <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
        </h2>
        <Alerte tonalite="info" annonce="aucune">
          <p>{MENTION_VISIBILITE_CLIENT}</p>
        </Alerte>
      </section>
      <section aria-labelledby="avc-chiffres" className="mp-pile">
        <h3 id="avc-chiffres" className="mp-section__titre">
          Chiffres de la semaine (lecture seule)
        </h3>
        <p className="mp-texte-doux mp-texte-petit">{MENTION_CHIFFRES_MOTEUR}</p>
        <ChiffresRapport contenu={rapport.contenu} />
      </section>
      <section aria-labelledby="avc-textes" className="mp-pile">
        <h3 id="avc-textes" className="mp-section__titre">
          {rapport.statut === "valide" ? "Textes du rapport" : "À relire et compléter"}
        </h3>
        <EditeurRapport rapport={rapport} />
      </section>
    </div>
  );
}
