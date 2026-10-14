import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BandeauSimule } from "../../../../../components/canaux/BandeauSimule";
import { NouvelleTranscription } from "../../../../../components/transcriptions/NouvelleTranscription";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerToutesPagesCanaux } from "../../../../../lib/canaux-serveur";
import { dateHeureCourte } from "../../../../../lib/canaux";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import {
  AVERTISSEMENT_TRANSCRIPTION,
  cheminApiTranscriptions,
  formaterConfiance,
  formaterDuree,
  hrefTranscription,
  hrefTranscriptions,
  libelleLangue,
  libelleStatutTranscription,
  LIMITE_LISTE_TRANSCRIPTIONS,
  tonaliteStatutTranscription,
  type TranscriptionApi,
} from "../../../../../lib/transcriptions";

export const metadata: Metadata = { title: "Transcriptions de la mission" };

/**
 * Transcriptions des enregistrements de la mission (AGT-11) : brouillons à relire, jamais utilisés
 * ailleurs tant qu'ils ne sont pas validés. Service SIMULÉ : aucun vrai audio décodé.
 */
export default async function PageTranscriptionsMission({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("transcription.lire");
  const m = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!m.ok) return null;
  const mission = m.donnees;
  const peutCreer =
    aPermission(utilisateur.roles, "transcription.gerer") && mission.statut !== "cloturee";
  const r = await chargerToutesPagesCanaux<TranscriptionApi>(
    cheminApiTranscriptions(mission.id),
    LIMITE_LISTE_TRANSCRIPTIONS,
  );

  return (
    <div className="mp-pile">
      <BandeauSimule>
        <p>
          Le service de transcription est simulé : il ne décode que des enregistrements de test.
        </p>
      </BandeauSimule>
      <Alerte tonalite="info" annonce="aucune">
        <p>{AVERTISSEMENT_TRANSCRIPTION}</p>
      </Alerte>
      {peutCreer ? <NouvelleTranscription missionId={mission.id} /> : null}
      {!r.ok ? (
        <EtatErreur
          titre="Les transcriptions n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefTranscriptions(mission.id)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune transcription pour cette mission." icone="bulle">
          <p>
            Envoyez un enregistrement (entretien, réunion) : le texte proposé est à relire avant
            validation.
          </p>
        </EtatVide>
      ) : (
        <Tableau<TranscriptionApi>
          legende="Transcriptions de la mission"
          legendeVisible
          cleLigne={(t) => t.id}
          colonnes={[
            {
              cle: "date",
              entete: "Envoyée le",
              rendu: (t) => (
                <Link href={hrefTranscription(mission.id, t.id)} prefetch={false}>
                  {dateHeureCourte(t.cree_le)}
                </Link>
              ),
            },
            {
              cle: "langue",
              entete: "Langue",
              rendu: (t) => libelleLangue(t.langue_detectee ?? t.langue_demandee),
            },
            { cle: "duree", entete: "Durée", rendu: (t) => formaterDuree(t.duree_audio_ms) },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (t) => (
                <BadgeStatut tonalite={tonaliteStatutTranscription(t.statut)}>
                  {libelleStatutTranscription(t.statut)}
                </BadgeStatut>
              ),
            },
            {
              cle: "confiance",
              entete: "Confiance",
              alignement: "droite",
              rendu: (t) => formaterConfiance(t.confiance_pm),
            },
          ]}
          lignes={r.donnees.elements}
        />
      )}
      {r.ok && r.donnees.tronquee ? (
        <p className="mp-texte-doux mp-texte-petit">
          La liste est partielle : seules les transcriptions les plus récentes sont affichées.
        </p>
      ) : null}
    </div>
  );
}
