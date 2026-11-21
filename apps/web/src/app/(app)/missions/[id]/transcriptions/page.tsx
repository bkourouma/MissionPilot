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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import {
  avertissementTranscription,
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Transcriptions de la mission", "Engagement transcriptions") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          {t(
            "Le service de transcription est simulé : il ne décode que des enregistrements de test.",
            "The transcription service is simulated: it only decodes test recordings.",
          )}
        </p>
      </BandeauSimule>
      <Alerte tonalite="info" annonce="aucune">
        <p>{avertissementTranscription(langue)}</p>
      </Alerte>
      {peutCreer ? <NouvelleTranscription missionId={mission.id} /> : null}
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les transcriptions n'ont pas pu être chargées.",
            "The transcriptions could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefTranscriptions(mission.id)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune transcription pour cette mission.",
            "No transcription for this engagement.",
          )}
          icone="bulle"
        >
          <p>
            {t(
              "Envoyez un enregistrement (entretien, réunion) : le texte proposé est à relire avant validation.",
              "Upload a recording (interview, meeting): the proposed text must be reviewed before approval.",
            )}
          </p>
        </EtatVide>
      ) : (
        <Tableau<TranscriptionApi>
          legende={t("Transcriptions de la mission", "Engagement transcriptions")}
          legendeVisible
          cleLigne={(tr) => tr.id}
          colonnes={[
            {
              cle: "date",
              entete: t("Envoyée le", "Uploaded on"),
              rendu: (tr) => (
                <Link href={hrefTranscription(mission.id, tr.id)} prefetch={false}>
                  {dateHeureCourte(tr.cree_le, langue)}
                </Link>
              ),
            },
            {
              cle: "langue",
              entete: t("Langue", "Language"),
              rendu: (tr) => libelleLangue(tr.langue_detectee ?? tr.langue_demandee, langue),
            },
            {
              cle: "duree",
              entete: t("Durée", "Duration"),
              alignement: "droite",
              rendu: (tr) => formaterDuree(tr.duree_audio_ms),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (tr) => (
                <BadgeStatut tonalite={tonaliteStatutTranscription(tr.statut)}>
                  {libelleStatutTranscription(tr.statut, langue)}
                </BadgeStatut>
              ),
            },
            {
              cle: "confiance",
              entete: t("Confiance", "Confidence"),
              alignement: "droite",
              rendu: (tr) => formaterConfiance(tr.confiance_pm, langue),
            },
          ]}
          lignes={r.donnees.elements}
        />
      )}
      {r.ok && r.donnees.tronquee ? (
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "La liste est partielle : seules les transcriptions les plus récentes sont affichées.",
            "The list is partial: only the most recent transcriptions are shown.",
          )}
        </p>
      ) : null}
    </div>
  );
}
