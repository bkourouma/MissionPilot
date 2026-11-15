import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChiffresRapport } from "../../../../../components/avancement/ChiffresRapport";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import {
  cheminApiPortailRapport,
  CHEMIN_AVANCEMENT_PORTAIL,
  hrefRapportPortail,
  libelleSemaineRapport,
  type RapportPortailAvancement,
} from "../../../../../lib/avancement";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Rapport d'avancement", "Progress report") };
}

/**
 * Un rapport d'avancement hebdomadaire validé : introduction et commentaire du chef de mission, puis
 * les chiffres de la semaine. Copie figée, en lecture seule ; 404 uniforme de l'API : « introuvable ».
 */
export default async function DetailAvancementPortail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.avancement.lire")) {
    return <NonDisponible titre={t("Avancement", "Progress")} />;
  }
  const r = await chargerPortail<RapportPortailAvancement>(cheminApiPortailRapport(id));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_AVANCEMENT_PORTAIL, libelle: t("Avancement", "Progress") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Rapport d'avancement", "Progress report")} retour={retour} />
        <EtatErreur
          titre={t("Le rapport n'a pas pu être chargé.", "The report could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefRapportPortail(id)}
        />
      </div>
    );
  }
  const d = r.donnees;
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={libelleSemaineRapport(d, langue)}
        retour={retour}
        soustitre={t(
          `${d.mission_intitule} · publié le ${formaterDate(d.valide_le, "Africa/Abidjan")}`,
          `${d.mission_intitule} · published on ${formaterDate(d.valide_le, "Africa/Abidjan", langue)}`,
        )}
        badges={
          <BadgeStatut tonalite="neutre" sansIcone>
            {t("Lecture seule", "Read-only")}
          </BadgeStatut>
        }
      />
      {d.introduction ? (
        <Carte titre={t("Introduction", "Introduction")} niveauTitre={2}>
          <p style={{ whiteSpace: "pre-line" }}>{d.introduction}</p>
        </Carte>
      ) : null}
      <ChiffresRapport contenu={d.contenu} pourClient />
      {d.commentaire ? (
        <Carte
          titre={t("Commentaire du chef de mission", "Engagement manager's comment")}
          niveauTitre={2}
        >
          <p style={{ whiteSpace: "pre-line" }}>{d.commentaire}</p>
        </Carte>
      ) : null}
    </div>
  );
}
