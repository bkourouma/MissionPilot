import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  hrefPage,
  lireCurseur,
  peut,
  periodeMission,
  requetePage,
  rubriquesMission,
  statutMission,
  type MissionPortail,
  type PagePortail,
} from "../../../../lib/portail";
import { CHEMIN_PORTAIL } from "../../../../lib/portail-routes";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";
import { NonDisponible } from "../../../../components/portail/NonDisponible";

export const metadata: Metadata = { title: "Missions" };

const CHEMIN = `${CHEMIN_PORTAIL}/missions`;

/** Missions partagées avec l'entreprise du client. */
export default async function MissionsPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.missions.lire")) {
    return <NonDisponible titre="Missions" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<MissionPortail>>(
    requetePage("/api/portail/missions", curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Vos missions"
        soustitre="Les missions que votre cabinet a choisi de partager avec vous. Ouvrez-en une pour suivre ses étapes et retrouver ses documents."
      />
      {!r.ok ? (
        <EtatErreur
          titre="La liste des missions n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune mission n'a encore été partagée avec vous." icone="dossier">
          <p>Dès que votre cabinet partagera une mission, elle apparaîtra ici.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((m) => {
            const statut = statutMission(m.statut);
            return (
              <li key={m.id}>
                <Carte
                  className="mp-module"
                  niveauTitre={2}
                  titre={
                    <Link href={`${CHEMIN}/${encodeURIComponent(m.id)}`} className="mp-lien-etendu">
                      {m.intitule}
                    </Link>
                  }
                  actions={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
                >
                  <div className="mp-pile">
                    <p className="mp-portail-mission__meta">
                      {periodeMission(m.date_debut, m.date_fin)}
                    </p>
                    <p className="mp-texte-doux mp-texte-petit">{rubriquesMission(m.partage)}</p>
                  </div>
                </Carte>
              </li>
            );
          })}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant ? hrefPage(CHEMIN, r.donnees.curseur_suivant) : null
          }
          hrefDebut={curseur ? CHEMIN : null}
          libelle="Pages des missions"
        />
      ) : null}
    </div>
  );
}
