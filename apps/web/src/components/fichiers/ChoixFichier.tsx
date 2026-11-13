"use client";

import { useEffect, useId, useState, type ChangeEvent } from "react";
import { TYPES_FICHIER, type TypeFichier } from "@missionpilot/shared";
import {
  acceptPour,
  controlerFichier,
  extensionsLisibles,
  formaterTaille,
  libelleType,
  TAILLE_MAX_OCTETS,
} from "../../lib/fichiers";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";

export interface ChoixFichierProps {
  libelle: string;
  /** Types admis (sous-ensemble de la liste blanche de l'API). */
  types?: readonly TypeFichier[];
  fichier: File | null;
  /** Fichier choisi et contrôlé localement, ou `null` (retiré). */
  onChoix: (fichier: File | null) => void;
  /** Erreur à afficher (contrôle local ou refus du serveur). */
  erreur?: string;
  /** Propose « Prendre une photo » (appareil photo du téléphone). */
  photo?: boolean;
  /** Progression de l'envoi en cours (0 à 1), sinon `null`. */
  progression?: number | null;
  desactive?: boolean;
  aide?: string;
  requis?: boolean;
}

/**
 * Choix d'un fichier : « Prendre une photo » (téléphone, attribut `capture`) et « Choisir un
 * fichier ». Le fichier est contrôlé localement (extension, taille) avant tout envoi : retour
 * immédiat, connexion épargnée ; le serveur reste seul juge du type réel. Aperçu du nom, du
 * type, de la taille et, pour une image, d'une vignette.
 */
export function ChoixFichier({
  libelle,
  types = TYPES_FICHIER,
  fichier,
  onChoix,
  erreur,
  photo = false,
  progression = null,
  desactive = false,
  aide,
  requis = false,
}: ChoixFichierProps) {
  const id = useId();
  const t = useT();
  const langue = useLangue();
  const [erreurLocale, setErreurLocale] = useState<string | null>(null);
  const [vignette, setVignette] = useState<string | null>(null);

  useEffect(() => {
    if (!fichier || !fichier.type.startsWith("image/") || typeof URL.createObjectURL !== "function")
      return setVignette(null);
    const url = URL.createObjectURL(fichier);
    setVignette(url);
    return () => URL.revokeObjectURL(url);
  }, [fichier]);

  function surChoix(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0] ?? null;
    // Permet de choisir à nouveau le même fichier après un retrait.
    ev.target.value = "";
    if (!f) return;
    const c = controlerFichier(f, types, undefined, langue);
    if (!c.ok) {
      setErreurLocale(c.message);
      onChoix(null);
      return;
    }
    setErreurLocale(null);
    onChoix(f);
  }

  const message = erreurLocale ?? erreur;
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;
  const decrit = [idAide, message ? idErreur : null].filter(Boolean).join(" ");
  const enEnvoi = progression !== null;
  const aideTexte =
    aide ??
    t(
      `${extensionsLisibles(types)}, ${Math.floor(TAILLE_MAX_OCTETS / (1024 * 1024))} Mo au plus.`,
      `${extensionsLisibles(types, langue)}, ${Math.floor(TAILLE_MAX_OCTETS / (1024 * 1024))} MB at most.`,
    );

  return (
    <fieldset
      className={message ? "mp-fichier mp-fichier--erreur" : "mp-fichier"}
      aria-describedby={decrit}
      disabled={desactive || enEnvoi}
    >
      <legend className="mp-champ__libelle">
        {libelle}
        {requis ? (
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">{t("(obligatoire)", "(required)")}</span>
          </span>
        ) : null}
      </legend>
      <p className="mp-champ__aide" id={idAide}>
        {aideTexte}
      </p>
      {fichier ? (
        <div className="mp-fichier__apercu">
          {vignette ? (
            <img
              className="mp-fichier__vignette"
              src={vignette}
              alt={t("Aperçu du fichier choisi", "Preview of the chosen file")}
            />
          ) : (
            <Icone nom="trombone" taille={28} className="mp-fichier__icone" />
          )}
          <span className="mp-fichier__meta">
            <strong className="mp-coupure">{fichier.name}</strong>
            <span className="mp-texte-doux mp-texte-petit">
              {`${libelleType(fichier.type, fichier.name, langue)} · ${formaterTaille(fichier.size, langue)}`}
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
                `Retirer le fichier choisi ${fichier.name}`,
                `Remove the chosen file ${fichier.name}`,
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
            aria-label={t("Envoi du fichier", "Uploading file")}
            aria-valuetext={`${Math.round(progression * 100)} %`}
          />
          <span className="mp-texte-petit" aria-hidden="true">{`${Math.round(
            progression * 100,
          )} %`}</span>
        </div>
      ) : (
        <div className="mp-fichier__declencheurs">
          {photo ? (
            <label className="mp-bouton mp-bouton--secondaire mp-fichier__declencheur mp-fichier__declencheur--photo">
              <input
                className="mp-fichier__entree"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={surChoix}
                aria-describedby={decrit}
              />
              <Icone nom="appareilPhoto" />
              <span>
                {fichier
                  ? t("Reprendre la photo", "Retake photo")
                  : t("Prendre une photo", "Take a photo")}
              </span>
            </label>
          ) : null}
          <label className="mp-bouton mp-bouton--secondaire mp-fichier__declencheur">
            <input
              className="mp-fichier__entree"
              type="file"
              accept={acceptPour(types)}
              onChange={surChoix}
              aria-describedby={decrit}
              aria-invalid={message ? true : undefined}
            />
            <Icone nom="trombone" />
            <span>
              {fichier
                ? t("Choisir un autre fichier", "Choose another file")
                : t("Choisir un fichier", "Choose a file")}
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
