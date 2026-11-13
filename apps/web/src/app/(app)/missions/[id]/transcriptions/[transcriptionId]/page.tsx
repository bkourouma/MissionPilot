import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BandeauSimule } from "../../../../../../components/canaux/BandeauSimule";
import { ActionsTranscription } from "../../../../../../components/transcriptions/ActionsTranscription";
import { ActualiserPage } from "../../../../../../components/transcriptions/ActualiserPage";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../components/ui/Icone";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { dateHeureCourte } from "../../../../../../lib/canaux";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../../lib/session";
import {
  actionsTranscription,
  avertissementTranscription,
  cheminApiTranscription,
  formaterConfiance,
  formaterDuree,
  formaterPosition,
  hrefAudioTranscription,
  hrefTranscription,
  hrefTranscriptions,
  libelleErreurTranscription,
  libelleLangue,
  libelleNiveauConfiance,
  libelleOrigineVersion,
  libelleStatutTranscription,
  niveauConfiancePm,
  segmentsDe,
  tonaliteConfiance,
  tonaliteStatutTranscription,
  transcriptionEnAttente,
  versionCourante,
  versionsRecentesDabord,
  type TranscriptionDetailApi,
} from "../../../../../../lib/transcriptions";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await obtenirT();
  return { title: tr("Transcription", "Transcription") };
}

/**
 * Détail d'une transcription : lecteur audio, texte avec indicateur de confiance par segment,
 * zone de correction, validation et rejet. Un brouillon n'est utilisé nulle part tant qu'il n'est
 * pas validé.
 */
export default async function PageDetailTranscription({
  params,
}: {
  params: Promise<{ id: string; transcriptionId: string }>;
}) {
  const { id, transcriptionId } = await params;
  // `t` désigne la transcription dans cette page : le traducteur s'appelle `tr`.
  const tr = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(id) || !estIdentifiant(transcriptionId)) notFound();
  const session = await exigerPermission("transcription.lire");
  const r = await chargerServeur<TranscriptionDetailApi>(cheminApiTranscription(transcriptionId));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre={tr(
          "La transcription n'a pas pu être chargée.",
          "The transcription could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefTranscription(id, transcriptionId)}
      />
    );
  }
  const t = r.donnees;
  const droits = actionsTranscription({
    transcription: t,
    versions: t.versions,
    roles: session.utilisateur.roles,
    utilisateurId: session.utilisateur.id,
    langue,
  });
  const courante = versionCourante(t.versions);
  const segments = segmentsDe(t.versions);
  const niveau = niveauConfiancePm(t.confiance_pm);

  return (
    <div className="mp-pile">
      <Link href={hrefTranscriptions(id)} className="mp-lien-retour">
        <Icone nom="chevronGauche" taille={18} />
        <span>{tr("Transcriptions de la mission", "Engagement transcriptions")}</span>
      </Link>
      <h2 className="mp-section__titre">
        {tr(
          `Transcription du ${dateHeureCourte(t.cree_le)} `,
          `Transcription of ${dateHeureCourte(t.cree_le, "en")} `,
        )}
        <BadgeStatut tonalite={tonaliteStatutTranscription(t.statut)}>
          {libelleStatutTranscription(t.statut, langue)}
        </BadgeStatut>
      </h2>
      <BandeauSimule>
        <p>
          {tr(
            "Le service de transcription est simulé : il ne décode que des enregistrements de test.",
            "The transcription service is simulated: it only decodes test recordings.",
          )}
        </p>
      </BandeauSimule>
      {t.statut === "validee" ? null : (
        <Alerte tonalite="attention" annonce="aucune" titre={tr("Brouillon", "Draft")}>
          <p>{avertissementTranscription(langue)}</p>
        </Alerte>
      )}
      <Carte titre={tr("Enregistrement", "Recording")} niveauTitre={3}>
        <dl className="mp-liste-def">
          <div>
            <dt>{tr("Langue", "Language")}</dt>
            <dd>{libelleLangue(t.langue_detectee ?? t.langue_demandee, langue)}</dd>
          </div>
          <div>
            <dt>{tr("Durée", "Duration")}</dt>
            <dd>{formaterDuree(t.duree_audio_ms)}</dd>
          </div>
          <div>
            <dt>{tr("Confiance globale", "Overall confidence")}</dt>
            <dd>
              <BadgeStatut tonalite={tonaliteConfiance(niveau)}>
                {`${libelleNiveauConfiance(niveau, langue)} (${formaterConfiance(t.confiance_pm, langue)})`}
              </BadgeStatut>
            </dd>
          </div>
          {t.valide_le ? (
            <div>
              <dt>{tr("Validée le", "Approved on")}</dt>
              <dd>{dateHeureCourte(t.valide_le, langue)}</dd>
            </div>
          ) : null}
          {t.motif_rejet ? (
            <div>
              <dt>{tr("Motif du rejet", "Reason for the rejection")}</dt>
              <dd>{t.motif_rejet}</dd>
            </div>
          ) : null}
        </dl>
        {droits.ecouter ? (
          <audio
            className="mp-canaux__lecteur"
            controls
            preload="none"
            src={hrefAudioTranscription(t.id)}
            aria-label={tr("Écouter l'enregistrement", "Listen to the recording")}
          />
        ) : (
          <p className="mp-texte-doux">
            {t.audio_disponible
              ? tr(
                  "Vous ne pouvez pas écouter cet enregistrement.",
                  "You cannot listen to this recording.",
                )
              : tr(
                  "L'enregistrement a été effacé (conservation limitée) : seul le texte reste.",
                  "The recording has been deleted (limited retention): only the text remains.",
                )}
          </p>
        )}
      </Carte>

      {transcriptionEnAttente(t.statut) ? (
        <Alerte
          tonalite="info"
          annonce="status"
          titre={tr("Transcription en cours", "Transcription in progress")}
        >
          <p>
            {tr(
              "Le texte n'est pas encore prêt. Actualisez la page dans quelques instants.",
              "The text is not ready yet. Refresh the page in a few moments.",
            )}
          </p>
          <ActualiserPage />
        </Alerte>
      ) : t.statut === "echec" ? (
        <Alerte
          tonalite="danger"
          titre={tr("La transcription a échoué", "The transcription failed")}
        >
          <p>{libelleErreurTranscription(t.erreur_code, langue)}</p>
        </Alerte>
      ) : courante ? (
        <>
          <Carte
            titre={tr(
              `Texte (version ${courante.numero}, ${libelleOrigineVersion(courante.origine).toLowerCase()})`,
              `Text (version ${courante.numero}, ${libelleOrigineVersion(courante.origine, "en").toLowerCase()})`,
            )}
            niveauTitre={3}
          >
            <p className="mp-texte-preserve">{courante.texte}</p>
          </Carte>
          {segments.length > 0 ? (
            <Carte titre={tr("Confiance par passage", "Confidence by passage")} niveauTitre={3}>
              <ul className="mp-canaux__segments">
                {segments.map((s) => {
                  const n = niveauConfiancePm(s.confiance);
                  return (
                    <li
                      key={`${s.debut_ms}-${s.fin_ms}`}
                      className={`mp-canaux__segment mp-canaux__segment--${n ?? "faible"}`}
                    >
                      <span className="mp-canaux__segment-position">
                        {`${formaterPosition(s.debut_ms)} - ${formaterPosition(s.fin_ms)}`}
                      </span>
                      <p className="mp-canaux__segment-texte">{s.texte}</p>
                      <BadgeStatut tonalite={tonaliteConfiance(n)}>
                        {`${libelleNiveauConfiance(n, langue)} (${formaterConfiance(s.confiance, langue)})`}
                      </BadgeStatut>
                    </li>
                  );
                })}
              </ul>
            </Carte>
          ) : null}
          <Carte titre={tr("Relecture", "Review")} niveauTitre={3}>
            <ActionsTranscription
              transcriptionId={t.id}
              texte={courante.texte}
              versionNumero={courante.numero}
              droits={droits}
            />
            {!droits.corriger &&
            !droits.valider &&
            !droits.rejeter &&
            !droits.motifValidationImpossible ? (
              <p className="mp-texte-doux">
                {t.statut === "a_relire"
                  ? tr(
                      "Vous n'avez pas le droit de corriger ni de valider cette transcription.",
                      "You are not allowed to correct or approve this transcription.",
                    )
                  : tr(
                      "Cette transcription est terminée : elle ne se modifie plus.",
                      "This transcription is finished: it can no longer be modified.",
                    )}
              </p>
            ) : null}
          </Carte>
          {t.versions.length > 1 ? (
            <Carte titre={tr("Versions", "Versions")} niveauTitre={3}>
              <ul className="mp-canaux__historique">
                {versionsRecentesDabord(t.versions).map((v) => (
                  <li key={v.numero}>
                    <strong>{`Version ${v.numero}`}</strong>
                    <span>{libelleOrigineVersion(v.origine, langue)}</span>
                    <span className="mp-texte-doux">{dateHeureCourte(v.cree_le, langue)}</span>
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
