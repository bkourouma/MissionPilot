import "../../../../../components/dossier/dossier.css";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnteteDossier } from "../../../../../components/dossier/EnteteDossier";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  grouperFriseParAnnee,
  libelleTypeEvenement,
  type EvenementFrise,
  type VueDossier,
} from "../../../../../lib/dossier";
import { formaterDate } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Frise du client", "Client timeline") };
}

/** Frise chronologique (DOS-06) : notations, missions, décisions, alertes, selon vos droits. */
export default async function PageFrise({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("dossier.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const [dossier, frise] = await Promise.all([
    chargerServeur<VueDossier>(`/api/dossiers/${id}`),
    chargerServeur<{ evenements: EvenementFrise[]; tronquee: boolean }>(
      `/api/dossiers/${id}/frise?limite=200`,
    ),
  ]);
  if (!dossier.ok && dossier.statut === 404) notFound();
  if (!dossier.ok || !frise.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Frise du client", "Client timeline")}
          retour={{ href: `/dossiers/${id}`, libelle: t("Dossier", "File") }}
        />
        <EtatErreur
          titre={t("La frise n'a pas pu être chargée.", "The timeline could not be loaded.")}
          message={!dossier.ok ? dossier.message : !frise.ok ? frise.message : ""}
          hrefReessayer={`/dossiers/${id}/frise`}
        />
      </div>
    );
  }

  return (
    <div className="mp-page">
      <EnteteDossier client={dossier.donnees.client} fiabilite={dossier.donnees.fiabilite} />
      {frise.donnees.evenements.length === 0 ? (
        <EtatVide
          titre={t("Aucun événement à afficher.", "No events to display.")}
          icone="historique"
        >
          <p>
            {t(
              "Missions, notations publiées, décisions et alertes du client apparaîtront ici.",
              "The client's engagements, published ratings, decisions and alerts will appear here.",
            )}
          </p>
        </EtatVide>
      ) : (
        grouperFriseParAnnee(frise.donnees.evenements).map((g) => (
          <Carte key={g.annee} titre={g.annee}>
            <ol className="mp-frise">
              {g.evenements.map((e) => (
                <li key={`${e.type}-${e.id}`}>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleTypeEvenement(e.type, langue)}
                  </BadgeStatut>{" "}
                  <time dateTime={e.date}>{formaterDate(e.date, "UTC", langue)}</time> —{" "}
                  {e.mission_id ? (
                    <Link href={`/missions/${e.mission_id}`}>{e.libelle}</Link>
                  ) : (
                    e.libelle
                  )}
                </li>
              ))}
            </ol>
          </Carte>
        ))
      )}
      {frise.donnees.tronquee ? (
        <p>
          {t(
            "Seuls les 200 événements les plus récents sont affichés ; l'export du dossier les reprend.",
            "Only the 200 most recent events are shown; the file export includes them.",
          )}
        </p>
      ) : null}
    </div>
  );
}
