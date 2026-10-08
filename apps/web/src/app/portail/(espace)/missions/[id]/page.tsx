import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LigneJalon } from "../../../../../components/portail/LigneJalon";
import { ListeLivrables } from "../../../../../components/portail/ListeLivrables";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import {
  estIdentifiant,
  peut,
  peutValiderJalon,
  periodeMission,
  statutMission,
  type JalonPortail,
  type LivrablePortail,
  type MissionPortail,
} from "../../../../../lib/portail";
import { CHEMIN_PORTAIL } from "../../../../../lib/portail-routes";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Mission" };

const CHEMIN_MISSIONS = `${CHEMIN_PORTAIL}/missions`;

/** Détail d'une mission partagée : jalons (si partagés), documents, accès aux factures. */
export default async function MissionPortailPage({ params }: { params: Promise<{ id: string }> }) {
  const { utilisateur } = await obtenirSessionPortail();
  const roles = utilisateur.roles;
  if (!peut(roles, "portail.missions.lire")) return <NonDisponible titre="Mission" />;
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();

  const base = `/api/portail/missions/${encodeURIComponent(id)}`;
  const r = await chargerPortail<MissionPortail>(base);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Mission" retour={{ href: CHEMIN_MISSIONS, libelle: "Vos missions" }} />
        <EtatErreur
          titre="Cette mission n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`${CHEMIN_MISSIONS}/${id}`}
        />
      </div>
    );
  }

  const mission = r.donnees;
  const [jalons, livrables] = await Promise.all([
    mission.partage.jalons ? chargerPortail<{ elements: JalonPortail[] }>(`${base}/jalons`) : null,
    chargerPortail<{ elements: LivrablePortail[] }>(`${base}/livrables`),
  ]);
  const statut = statutMission(mission.statut);
  const dirigeant = peut(roles, "portail.jalons.valider");
  const facturesVisibles = mission.partage.factures && peut(roles, "portail.factures.lire");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={mission.intitule}
        retour={{ href: CHEMIN_MISSIONS, libelle: "Vos missions" }}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
        soustitre={periodeMission(mission.date_debut, mission.date_fin)}
      />

      {jalons ? (
        <section className="mp-portail-section" aria-labelledby="titre-jalons">
          <h2 id="titre-jalons" className="mp-section__titre">
            Jalons
          </h2>
          <p className="mp-texte-doux">
            {dirigeant
              ? "Les étapes clés de la mission. Quand le cabinet marque un jalon comme atteint, vous pouvez le valider pour confirmer qu'il vous convient."
              : "Les étapes clés de la mission et leur avancement."}
          </p>
          {!jalons.ok ? (
            <Alerte tonalite="danger" titre="Les jalons n'ont pas pu être chargés.">
              <p>{jalons.message}</p>
            </Alerte>
          ) : jalons.donnees.elements.length === 0 ? (
            <EtatVide titre="Aucun jalon n'est encore défini pour cette mission." icone="drapeau" />
          ) : (
            <ul className="mp-liste-lignes" aria-labelledby="titre-jalons">
              {jalons.donnees.elements.map((j) => (
                <LigneJalon
                  key={j.id}
                  missionId={mission.id}
                  jalon={j}
                  peutValider={peutValiderJalon(j, roles)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="mp-portail-section" aria-labelledby="titre-documents">
        <h2 id="titre-documents" className="mp-section__titre">
          Documents
        </h2>
        {!livrables.ok ? (
          <Alerte tonalite="danger" titre="Les documents n'ont pas pu être chargés.">
            <p>{livrables.message}</p>
          </Alerte>
        ) : livrables.donnees.elements.length === 0 ? (
          <EtatVide
            titre="Aucun document n'a encore été partagé pour cette mission."
            icone="trombone"
          >
            <p>Les livrables apparaîtront ici dès que le cabinet les mettra à votre disposition.</p>
          </EtatVide>
        ) : (
          <ListeLivrables livrables={livrables.donnees.elements} idTitre="titre-documents" />
        )}
      </section>

      {facturesVisibles ? (
        <section className="mp-portail-section" aria-labelledby="titre-factures">
          <h2 id="titre-factures" className="mp-section__titre">
            Factures
          </h2>
          <p>
            Les factures émises pour cette mission sont consultables dans la rubrique{" "}
            <Link href={`${CHEMIN_PORTAIL}/factures`}>Factures</Link>.
          </p>
        </section>
      ) : null}
    </div>
  );
}
