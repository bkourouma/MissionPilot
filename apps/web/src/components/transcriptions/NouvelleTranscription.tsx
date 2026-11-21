"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useRafraichir } from "../formulaires/useRafraichir";
import { api, ErreurApi } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { erreurReprenable, type FichierTeleverse } from "../../lib/fichiers";
import { televerser } from "../../lib/televersement";
import {
  avertissementTranscription,
  cheminApiAudioTranscription,
  cheminApiTranscriptions,
  hrefTranscription,
  messageErreurTranscription,
  optionsLangueTranscription,
  validerTranscription,
  type ChampTranscription,
  type ChargeTranscription,
} from "../../lib/transcriptions";
import { BandeauSimule } from "../canaux/BandeauSimule";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChoixAudio } from "./ChoixAudio";
import "../canaux/canaux.css";

export interface NouvelleTranscriptionProps {
  missionId: string;
}

/** Retire sans attendre un audio téléversé resté sans rattachement (quota d'attente). */
function retirerOrphelin(id: string | null) {
  if (id) void api.supprimer(`/api/fichiers/${encodeURIComponent(id)}`).catch(() => undefined);
}

/**
 * Envoi d'un audio à transcrire (AGT-11) : l'enregistrement est téléversé (POST /api/fichiers),
 * puis la transcription est demandée avec le consentement DÉCLARÉ de la personne enregistrée et sa
 * référence. Le résultat est un brouillon à relire. Fournisseur simulé : aucun vrai audio décodé.
 */
export function NouvelleTranscription({ missionId }: NouvelleTranscriptionProps) {
  const router = useRouter();
  const t = useT();
  const langueUi = useLangue();
  const { rafraichir } = useRafraichir();
  const [ouvert, setOuvert] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [langue, setLangue] = useState("fr");
  const [consenti, setConsenti] = useState(false);
  const [reference, setReference] = useState("");
  const [duree, setDuree] = useState("");
  const [progression, setProgression] = useState<number | null>(null);
  const [erreurFichier, setErreurFichier] = useState<string | null>(null);
  const f = useFormulaire<ChampTranscription>();
  // Audio déjà téléversé mais pas encore rattaché (reprise après coupure).
  const enAttente = useRef<{ fichier: File; id: string } | null>(null);

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="envoyer" onClick={() => setOuvert(true)}>
          {t("Transcrire un enregistrement", "Transcribe a recording")}
        </Bouton>
      </div>
    );
  }

  async function transcrire(charge: ChargeTranscription, audio: File): Promise<{ id?: string }> {
    let fichierId = enAttente.current?.fichier === audio ? enAttente.current.id : null;
    if (!fichierId) {
      retirerOrphelin(enAttente.current?.id ?? null);
      enAttente.current = null;
      setProgression(0);
      try {
        const envoye = await televerser<FichierTeleverse>(
          cheminApiAudioTranscription(missionId),
          audio,
          audio.name,
          {
            onProgression: setProgression,
          },
        );
        fichierId = envoye.id;
        enAttente.current = { fichier: audio, id: envoye.id };
      } finally {
        setProgression(null);
      }
    }
    try {
      const r = await api.post<{ id?: string }>(
        cheminApiTranscriptions(missionId),
        { ...charge, fichier_id: fichierId },
        { redirigerSi401: false },
      );
      enAttente.current = null;
      return r;
    } catch (e) {
      if (!erreurReprenable(e)) {
        retirerOrphelin(fichierId);
        enAttente.current = null;
      }
      throw e;
    }
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurFichier(null);
    const v = validerTranscription({ langue, consenti, reference, dureeMinutes: duree }, langueUi);
    if (!fichier) {
      // Le champ audio n'a pas de clé de validation : message sous le sélecteur.
      setErreurFichier(
        t("Choisissez l'enregistrement à transcrire.", "Choose the recording to transcribe."),
      );
      if (v.ok) return;
    }
    await f.envoyer(v, (c) => transcrire(c, fichier as File), {
      rafraichir: false,
      succes: t(
        "Enregistrement envoyé : la transcription est en cours.",
        "Recording uploaded: the transcription is in progress.",
      ),
      messageSpecifique: (e) => {
        if (e instanceof ErreurApi && e.code === "TYPE_FICHIER_REFUSE") {
          setErreurFichier(
            t(
              "Enregistrement refusé : en mode simulé, seul un audio de test passe.",
              "Recording rejected: in simulated mode, only a test audio is accepted.",
            ),
          );
        }
        return messageErreurTranscription(e, langueUi);
      },
      apres: (r) => {
        if (r && typeof r.id === "string") router.push(hrefTranscription(missionId, r.id));
        else rafraichir();
      },
    });
  }

  const reprise = enAttente.current !== null && enAttente.current.fichier === fichier;
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Transcrire un enregistrement", "Transcribe a recording")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Transcrire un enregistrement", "Transcribe a recording")}
      </p>
      <BandeauSimule>
        <p>
          {t(
            "Le service de transcription est simulé : il ne décode que des enregistrements de test.",
            "The transcription service is simulated: it only decodes test recordings.",
          )}
        </p>
      </BandeauSimule>
      <p className="mp-texte-doux">{avertissementTranscription(langueUi)}</p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Transcription impossible", "Could not transcribe")}
      />
      <ChoixAudio
        fichier={fichier}
        onChoix={(x) => {
          setErreurFichier(null);
          setFichier(x);
        }}
        erreur={erreurFichier ?? undefined}
        progression={progression}
      />
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Select
          libelle={t("Langue de l'enregistrement", "Recording language")}
          required
          value={langue}
          onChange={(e) => setLangue(e.target.value)}
          options={optionsLangueTranscription(langueUi)}
          erreur={f.erreurs.langue}
        />
        <Champ
          libelle={t("Durée annoncée (minutes, facultatif)", "Stated duration (minutes, optional)")}
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          value={duree}
          onChange={(e) => setDuree(e.target.value)}
          erreur={f.erreurs.dureeMinutes}
          aide={t(
            "Sans elle, le plafond mensuel compte 30 minutes.",
            "Without it, the monthly limit counts 30 minutes.",
          )}
        />
      </div>
      <CaseACocher
        libelle={t(
          "La personne enregistrée a consenti à l'enregistrement et à sa transcription",
          "The person recorded consented to the recording and its transcription",
        )}
        checked={consenti}
        onChange={(e) => setConsenti(e.target.checked)}
        aria-invalid={f.erreurs.consenti ? true : undefined}
        aria-describedby={f.erreurs.consenti ? "erreur-consentement" : undefined}
      />
      {f.erreurs.consenti ? (
        <p id="erreur-consentement" className="mp-champ__erreur" role="alert">
          <Icone nom="attention" taille={16} />
          <span>{f.erreurs.consenti}</span>
        </p>
      ) : null}
      <ZoneTexte
        libelle={t("Référence du consentement", "Consent reference")}
        required
        maxLength={500}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        erreur={f.erreurs.reference}
        aide={t(
          "Comment et quand le consentement a été recueilli (10 caractères au moins).",
          "How and when consent was obtained (at least 10 characters).",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={reprise ? "nuage" : "envoyer"}
          chargement={f.enCours}
          texteChargement={
            progression !== null
              ? t("Envoi de l'enregistrement…", "Uploading the recording…")
              : t("Création…", "Creating…")
          }
        >
          {reprise
            ? t("Réessayer", "Try again")
            : t("Envoyer et transcrire", "Upload and transcribe")}
        </Bouton>
        <Bouton variante="discret" onClick={() => setOuvert(false)} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
