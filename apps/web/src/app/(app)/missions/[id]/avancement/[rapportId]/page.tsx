import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChiffresRapport } from "../../../../../../components/avancement/ChiffresRapport";
import { EditeurRapport } from "../../../../../../components/avancement/EditeurRapport";
import { Icone } from "../../../../../../components/ui/Icone";
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
  libellesAvancement,
  type RapportAvancement,
} from "../../../../../../lib/avancement";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Rapport d'avancement", "Progress report") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const libelles = libellesAvancement(langue);
  if (!estIdentifiant(rapportId)) notFound();
  await exigerPermission("avancement.lire");
  const r = await chargerServeur<RapportAvancement>(cheminApiRapportAvancement(rapportId));
  if (!r.ok && r.statut === 404) notFound();
  const retour = (
    <Link href={hrefAvancementMission(id)} className="mp-lien-retour">
      <Icone nom="chevronGauche" taille={18} />
      <span>{t("Revenir aux rapports d'avancement", "Back to progress reports")}</span>
    </Link>
  );
  if (!r.ok) {
    return (
      <div className="mp-pile mp-pile--large">
        {retour}
        <EtatErreur
          titre={t("Le rapport n'a pas pu être chargé.", "The report could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefRapportAvancement(id, rapportId)}
        />
      </div>
    );
  }
  const rapport = r.donnees;
  // Le rapport doit appartenir à la mission de l'URL.
  if (rapport.mission_id !== id) notFound();
  const etat = etatRapport(rapport.statut, langue);
  return (
    <div className="mp-pile mp-pile--large">
      {retour}
      <section aria-labelledby="titre-rapport" className="mp-pile">
        <h2 id="titre-rapport" className="mp-section__titre">
          {libelleSemaineRapport(rapport, langue)}{" "}
          <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
        </h2>
        <Alerte tonalite="info" annonce="aucune">
          <p>{libelles.mentionVisibiliteClient}</p>
        </Alerte>
      </section>
      <section aria-labelledby="avc-chiffres" className="mp-pile">
        <h3 id="avc-chiffres" className="mp-section__titre">
          {t("Chiffres de la semaine (lecture seule)", "This week's figures (read-only)")}
        </h3>
        <p className="mp-texte-doux mp-texte-petit">{libelles.mentionChiffresMoteur}</p>
        <ChiffresRapport contenu={rapport.contenu} />
      </section>
      <section aria-labelledby="avc-textes" className="mp-pile">
        <h3 id="avc-textes" className="mp-section__titre">
          {rapport.statut === "valide"
            ? t("Textes du rapport", "Report texts")
            : t("À relire et compléter", "To review and complete")}
        </h3>
        <EditeurRapport rapport={rapport} />
      </section>
    </div>
  );
}
