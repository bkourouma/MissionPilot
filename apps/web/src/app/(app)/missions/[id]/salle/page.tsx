import Link from "next/link";
import type { Metadata } from "next";
import { NouvelleDemande } from "../../../../../components/salle-mission/NouvelleDemande";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
import { aujourdhui } from "../../../../../lib/periode";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { gerePortail, hrefPortailClient } from "../../../../../lib/portail-gestion";
import {
  avancement,
  cheminSalle,
  detailAvancement,
  echeanceDepassee,
  hrefDemande,
  hrefSalle,
  peutGererSalle,
  STATUT_DEMANDE,
  type SalleMission,
} from "../../../../../lib/salle-mission";
import { exigerPermission } from "../../../../../lib/session";
import "../../../../../components/salle-mission/salle.css";

export const metadata: Metadata = { title: "Salle de mission" };

/**
 * Onglet « Salle de mission » (CLI-01) : demandes documentaires envoyées au client, suivi des
 * pièces, préparation d'une nouvelle demande. Mission clôturée : lecture seule.
 */
export default async function PageSalleMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("salle.lire");
  const m = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!m.ok) return null;
  const r = await chargerServeur<SalleMission>(cheminSalle(id));
  const dateDuJour = aujourdhui();
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La salle de mission n'a pas pu être chargée."
        message={r.message}
        hrefReessayer={hrefSalle(id)}
      />
    );
  }
  const salle = r.donnees;
  const gerer = peutGererSalle(utilisateur.roles) && !salle.mission_cloturee;

  return (
    <div className="mp-pile mp-pile--large">
      <div className="mp-entete-section mp-pile">
        <p className="mp-texte-doux">
          Demandez au client les documents de la mission. Il les dépose depuis son portail, même
          depuis un téléphone ; il reçoit un accusé de réception, puis des relances avant et après
          l&apos;échéance. Vous acceptez ou rejetez chaque pièce, et versez les pièces acceptées au
          dossier de la mission.
        </p>
        {salle.mission_cloturee ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              Mission clôturée : la salle reste consultable, plus aucune demande n&apos;est
              possible.
            </p>
          </Alerte>
        ) : salle.destinataires.length === 0 ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>
              Aucun dirigeant ni contributeur de {m.donnees.client_raison_sociale} n&apos;est actif
              sur le portail : une demande ne peut pas encore être envoyée.{" "}
              {gerePortail(utilisateur.roles) ? (
                <Link href={hrefPortailClient(m.donnees.client_id)}>Inviter sur le portail</Link>
              ) : null}
            </p>
          </Alerte>
        ) : null}
        {gerer ? (
          <NouvelleDemande missionId={id} methodes={salle.methodes} aujourdhui={dateDuJour} />
        ) : null}
      </div>
      {salle.demandes.length === 0 ? (
        <EtatVide titre="Aucune demande de documents pour cette mission." icone="trombone">
          <p>
            Préparez une demande depuis un modèle du cabinet ou pièce par pièce, puis envoyez-la au
            client.
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {salle.demandes.map((d) => {
            const statut = STATUT_DEMANDE[d.statut];
            const detail = detailAvancement(d.synthese);
            return (
              <li key={d.id} className="mp-carte mp-salle__piece">
                <div className="mp-salle__entete-carte">
                  <h2 className="mp-salle__piece-titre">
                    <Link href={hrefDemande(id, d.id)} className="mp-lien-etendu">
                      {d.titre}
                    </Link>
                  </h2>
                  <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
                </div>
                <ul className="mp-salle__meta">
                  <li>
                    {d.echeance ? `Échéance : ${formaterDate(d.echeance)}` : "Pas d'échéance"}
                    {echeanceDepassee(d, dateDuJour) ? " (dépassée)" : ""}
                  </li>
                  <li>{avancement(d.synthese)}</li>
                  {detail ? <li>{detail}</li> : null}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
