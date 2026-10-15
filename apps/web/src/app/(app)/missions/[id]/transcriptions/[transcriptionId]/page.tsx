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
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../../lib/session";
import {
  actionsTranscription,
  AVERTISSEMENT_TRANSCRIPTION,
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

export const metadata: Metadata = { title: "Transcription" };

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
  if (!estIdentifiant(id) || !estIdentifiant(transcriptionId)) notFound();
  const session = await exigerPermission("transcription.lire");
  const r = await chargerServeur<TranscriptionDetailApi>(cheminApiTranscription(transcriptionId));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La transcription n'a pas pu être chargée."
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
  });
  const courante = versionCourante(t.versions);
  const segments = segmentsDe(t.versions);
  const niveau = niveauConfiancePm(t.confiance_pm);

  return (
    <div className="mp-pile">
      <Link href={hrefTranscriptions(id)} className="mp-lien-retour">
        <Icone nom="chevronGauche" taille={18} />
        <span>Transcriptions de la mission</span>
      </Link>
      <h2 className="mp-section__titre">
        {`Transcription du ${dateHeureCourte(t.cree_le)} `}
        <BadgeStatut tonalite={tonaliteStatutTranscription(t.statut)}>
          {libelleStatutTranscription(t.statut)}
        </BadgeStatut>
      </h2>
      <BandeauSimule>
        <p>
          Le service de transcription est simulé : il ne décode que des enregistrements de test.
        </p>
      </BandeauSimule>
      {t.statut === "validee" ? null : (
        <Alerte tonalite="attention" annonce="aucune" titre="Brouillon">
          <p>{AVERTISSEMENT_TRANSCRIPTION}</p>
        </Alerte>
      )}
      <Carte titre="Enregistrement" niveauTitre={3}>
        <dl className="mp-liste-def">
          <div>
            <dt>Langue</dt>
            <dd>{libelleLangue(t.langue_detectee ?? t.langue_demandee)}</dd>
          </div>
          <div>
            <dt>Durée</dt>
            <dd>{formaterDuree(t.duree_audio_ms)}</dd>
          </div>
          <div>
            <dt>Confiance globale</dt>
            <dd>
              <BadgeStatut tonalite={tonaliteConfiance(niveau)}>
                {`${libelleNiveauConfiance(niveau)} (${formaterConfiance(t.confiance_pm)})`}
              </BadgeStatut>
            </dd>
          </div>
          {t.valide_le ? (
            <div>
              <dt>Validée le</dt>
              <dd>{dateHeureCourte(t.valide_le)}</dd>
            </div>
          ) : null}
          {t.motif_rejet ? (
            <div>
              <dt>Motif du rejet</dt>
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
            aria-label="Écouter l'enregistrement"
          />
        ) : (
          <p className="mp-texte-doux">
            {t.audio_disponible
              ? "Vous ne pouvez pas écouter cet enregistrement."
              : "L'enregistrement a été effacé (conservation limitée) : seul le texte reste."}
          </p>
        )}
      </Carte>

      {transcriptionEnAttente(t.statut) ? (
        <Alerte tonalite="info" annonce="status" titre="Transcription en cours">
          <p>Le texte n&apos;est pas encore prêt. Actualisez la page dans quelques instants.</p>
          <ActualiserPage />
        </Alerte>
      ) : t.statut === "echec" ? (
        <Alerte tonalite="danger" titre="La transcription a échoué">
          <p>{libelleErreurTranscription(t.erreur_code)}</p>
        </Alerte>
      ) : courante ? (
        <>
          <Carte
            titre={`Texte (version ${courante.numero}, ${libelleOrigineVersion(courante.origine).toLowerCase()})`}
            niveauTitre={3}
          >
            <p className="mp-texte-preserve">{courante.texte}</p>
          </Carte>
          {segments.length > 0 ? (
            <Carte titre="Confiance par passage" niveauTitre={3}>
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
                        {`${libelleNiveauConfiance(n)} (${formaterConfiance(s.confiance)})`}
                      </BadgeStatut>
                    </li>
                  );
                })}
              </ul>
            </Carte>
          ) : null}
          <Carte titre="Relecture" niveauTitre={3}>
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
                  ? "Vous n'avez pas le droit de corriger ni de valider cette transcription."
                  : "Cette transcription est terminée : elle ne se modifie plus."}
              </p>
            ) : null}
          </Carte>
          {t.versions.length > 1 ? (
            <Carte titre="Versions" niveauTitre={3}>
              <ul className="mp-canaux__historique">
                {versionsRecentesDabord(t.versions).map((v) => (
                  <li key={v.numero}>
                    <strong>{`Version ${v.numero}`}</strong>
                    <span>{libelleOrigineVersion(v.origine)}</span>
                    <span className="mp-texte-doux">{dateHeureCourte(v.cree_le)}</span>
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
