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
  TYPE_EVENEMENT_LIBELLES,
  type EvenementFrise,
  type VueDossier,
} from "../../../../../lib/dossier";
import { formaterDate } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Frise du client" };

/** Frise chronologique (DOS-06) : notations, missions, décisions, alertes, selon vos droits. */
export default async function PageFrise({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("dossier.lire");
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
          titre="Frise du client"
          retour={{ href: `/dossiers/${id}`, libelle: "Dossier" }}
        />
        <EtatErreur
          titre="La frise n'a pas pu être chargée."
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
        <EtatVide titre="Aucun événement à afficher." icone="historique">
          <p>Missions, notations publiées, décisions et alertes du client apparaîtront ici.</p>
        </EtatVide>
      ) : (
        grouperFriseParAnnee(frise.donnees.evenements).map((g) => (
          <Carte key={g.annee} titre={g.annee}>
            <ol className="mp-pile">
              {g.evenements.map((e) => (
                <li key={`${e.type}-${e.id}`}>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {TYPE_EVENEMENT_LIBELLES[e.type]}
                  </BadgeStatut>{" "}
                  <time dateTime={e.date}>{formaterDate(e.date)}</time> —{" "}
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
          Seuls les 200 événements les plus récents sont affichés ; l&apos;export du dossier les
          reprend.
        </p>
      ) : null}
    </div>
  );
}
