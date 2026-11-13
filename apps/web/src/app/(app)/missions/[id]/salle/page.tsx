import Link from "next/link";
import type { Metadata } from "next";
import { NouvelleDemande } from "../../../../../components/salle-mission/NouvelleDemande";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
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
  statutDemande,
  type SalleMission,
} from "../../../../../lib/salle-mission";
import { exigerPermission } from "../../../../../lib/session";
import "../../../../../components/salle-mission/salle.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Salle de mission", "Engagement room") };
}

/**
 * Onglet « Salle de mission » (CLI-01) : demandes documentaires envoyées au client, suivi des
 * pièces, préparation d'une nouvelle demande. Mission clôturée : lecture seule.
 */
export default async function PageSalleMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("salle.lire");
  const m = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!m.ok) return null;
  const r = await chargerServeur<SalleMission>(cheminSalle(id));
  const dateDuJour = aujourdhui();
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "La salle de mission n'a pas pu être chargée.",
          "The engagement room could not be loaded.",
        )}
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
          {t(
            "Demandez au client les documents de la mission. Il les dépose depuis son portail, même depuis un téléphone ; il reçoit un accusé de réception, puis des relances avant et après l'échéance. Vous acceptez ou rejetez chaque pièce, et versez les pièces acceptées au dossier de la mission.",
            "Ask the client for the engagement documents. They upload them from their portal, even from a phone; they receive an acknowledgment of receipt, then reminders before and after the due date. You accept or reject each document, and add accepted documents to the engagement file.",
          )}
        </p>
        {salle.mission_cloturee ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {t(
                "Mission clôturée : la salle reste consultable, plus aucune demande n'est possible.",
                "Engagement closed: the room can still be viewed, but no further requests are possible.",
              )}
            </p>
          </Alerte>
        ) : salle.destinataires.length === 0 ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>
              {t(
                `Aucun dirigeant ni contributeur de ${m.donnees.client_raison_sociale} n'est actif sur le portail : une demande ne peut pas encore être envoyée.`,
                `No executive or contributor of ${m.donnees.client_raison_sociale} is active on the portal: a request cannot be sent yet.`,
              )}{" "}
              {gerePortail(utilisateur.roles) ? (
                <Link href={hrefPortailClient(m.donnees.client_id)}>
                  {t("Inviter sur le portail", "Invite to the portal")}
                </Link>
              ) : null}
            </p>
          </Alerte>
        ) : null}
        {gerer ? (
          <NouvelleDemande missionId={id} methodes={salle.methodes} aujourdhui={dateDuJour} />
        ) : null}
      </div>
      {salle.demandes.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune demande de documents pour cette mission.",
            "No document request for this engagement.",
          )}
          icone="trombone"
        >
          <p>
            {t(
              "Préparez une demande depuis un modèle du cabinet ou pièce par pièce, puis envoyez-la au client.",
              "Prepare a request from a firm template or document by document, then send it to the client.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {salle.demandes.map((d) => {
            const statut = statutDemande(d.statut, langue);
            const detail = detailAvancement(d.synthese, langue);
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
                    {d.echeance
                      ? `${t("Échéance", "Due date")} : ${formaterDate(d.echeance, "UTC", langue)}`
                      : t("Pas d'échéance", "No due date")}
                    {echeanceDepassee(d, dateDuJour) ? t(" (dépassée)", " (overdue)") : ""}
                  </li>
                  <li>{avancement(d.synthese, langue)}</li>
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
