"use client";

import { useId, useState, type ChangeEvent } from "react";
import { formaterTaille } from "../../lib/fichiers";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  acceptAudio,
  controlerAudio,
  extensionsAudioLisibles,
  PLAFONDS_TRANSCRIPTION,
} from "../../lib/transcriptions";
import { Bouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";

export interface ChoixAudioProps {
  fichier: File | null;
  /** Audio choisi et contrôlé localement, ou `null` (retiré). */
  onChoix: (fichier: File | null) => void;
  erreur?: string;
  /** Progression de l'envoi en cours (0 à 1), sinon `null`. */
  progression?: number | null;
  desactive?: boolean;
}

const MO_MAX = Math.floor(PLAFONDS_TRANSCRIPTION.tailleAudioMaxOctets / (1024 * 1024));

/**
 * Sélecteur d'enregistrement audio, dédié : la liste blanche générale des fichiers n'est pas
 * étendue à l'audio. Contrôle local (extension, taille) avant tout envoi ; le serveur reste seul
 * juge, et en mode simulé il n'accepte qu'un enregistrement de test.
 */
export function ChoixAudio({
  fichier,
  onChoix,
  erreur,
  progression = null,
  desactive = false,
}: ChoixAudioProps) {
  const t = useT();
  const langue = useLangue();
  const id = useId();
  const [erreurLocale, setErreurLocale] = useState<string | null>(null);
  const message = erreurLocale ?? erreur;
  const enEnvoi = progression !== null;
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;

  function surChoix(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0] ?? null;
    ev.target.value = "";
    if (!f) return;
    const c = controlerAudio(f, langue);
    if (!c.ok) {
      setErreurLocale(c.message);
      onChoix(null);
      return;
    }
    setErreurLocale(null);
    onChoix(f);
  }

  return (
    <fieldset
      className={message ? "mp-fichier mp-fichier--erreur" : "mp-fichier"}
      aria-describedby={[idAide, message ? idErreur : null].filter(Boolean).join(" ")}
      disabled={desactive || enEnvoi}
    >
      <legend className="mp-champ__libelle">
        {t("Enregistrement audio", "Audio recording")}
        <span className="mp-champ__requis">
          {" "}
          <span aria-hidden="true">*</span>
          <span className="mp-visuellement-cache">{t("(obligatoire)", "(required)")}</span>
        </span>
      </legend>
      <p className="mp-champ__aide" id={idAide}>
        {t(
          `${extensionsAudioLisibles()}, ${MO_MAX} Mo au plus. En mode simulé, seul un enregistrement de test est accepté.`,
          `${extensionsAudioLisibles("en")}, ${MO_MAX} MB at most. In simulated mode, only a test recording is accepted.`,
        )}
      </p>
      {fichier ? (
        <div className="mp-fichier__apercu">
          <Icone nom="trombone" taille={28} className="mp-fichier__icone" />
          <span className="mp-fichier__meta">
            <strong className="mp-coupure">{fichier.name}</strong>
            <span className="mp-texte-doux mp-texte-petit">
              {formaterTaille(fichier.size, langue)}
            </span>
          </span>
          {enEnvoi ? null : (
            <Bouton
              variante="discret"
              icone="fermer"
              onClick={() => {
                setErreurLocale(null);
                onChoix(null);
              }}
              aria-label={t(
                `Retirer l'enregistrement choisi ${fichier.name}`,
                `Remove the chosen recording ${fichier.name}`,
              )}
            >
              {t("Retirer", "Remove")}
            </Bouton>
          )}
        </div>
      ) : null}
      {enEnvoi ? (
        <div className="mp-fichier__progression">
          <progress
            max={1}
            value={progression}
            aria-label={t("Envoi de l'enregistrement", "Uploading the recording")}
            aria-valuetext={`${Math.round(progression * 100)} %`}
          />
          <span
            className="mp-texte-petit"
            aria-hidden="true"
          >{`${Math.round(progression * 100)} %`}</span>
        </div>
      ) : (
        <div className="mp-fichier__declencheurs">
          <label className="mp-bouton mp-bouton--secondaire mp-fichier__declencheur">
            <input
              className="mp-fichier__entree"
              type="file"
              accept={acceptAudio()}
              onChange={surChoix}
              aria-describedby={idAide}
              aria-invalid={message ? true : undefined}
            />
            <Icone nom="trombone" />
            <span>
              {fichier
                ? t("Choisir un autre enregistrement", "Choose another recording")
                : t("Choisir un enregistrement", "Choose a recording")}
            </span>
          </label>
        </div>
      )}
      {message ? (
        <p className="mp-champ__erreur" id={idErreur} role="alert">
          <Icone nom="attention" taille={16} />
          <span>{message}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
