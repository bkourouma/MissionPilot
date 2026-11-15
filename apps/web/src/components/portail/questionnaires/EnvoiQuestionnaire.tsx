"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import { useT } from "../../i18n/FournisseurLangue";
import { Alerte } from "../../ui/Alerte";
import { Bouton } from "../../ui/Bouton";
import { Icone } from "../../ui/Icone";
import { idBlocQuestion } from "../../../lib/portail-questionnaires-saisie";
import "./questionnaires.css";

export interface ErreurAffichee {
  id: string;
  libelle: string;
  message: string;
}

export interface EnvoiQuestionnaireProps {
  collectif: boolean;
  /** État de la sauvegarde du brouillon, en clair. */
  texteEtat: string;
  etatAlerte: boolean;
  enregistrement: boolean;
  /** Lien de reconnexion (session expirée), sinon null. */
  hrefReconnexion: string | null;
  /** Questions à compléter ou corriger (après une tentative d'envoi). */
  erreurs: readonly ErreurAffichee[];
  erreurEnvoi: string | null;
  refErreurEnvoi: Ref<HTMLDivElement>;
  confirmation: boolean;
  envoi: boolean;
  onEnregistrer: () => void;
  onDemander: () => void;
  onConfirmer: () => void;
  onAnnuler: () => void;
  onAllerA: (id: string) => void;
}

/**
 * Bas du questionnaire : état du brouillon, enregistrement manuel, questions à reprendre et
 * envoi en deux temps (confirmation explicite : après envoi, plus de modification possible).
 */
export function EnvoiQuestionnaire(p: EnvoiQuestionnaireProps) {
  const t = useT();
  const idTitre = useId();
  const idConfirmation = useId();
  const refConfirmation = useRef<HTMLParagraphElement>(null);
  const refDemander = useRef<HTMLButtonElement>(null);
  const [rendreFocus, setRendreFocus] = useState(false);

  useEffect(() => {
    if (p.confirmation) refConfirmation.current?.focus();
    else if (rendreFocus) refDemander.current?.focus();
  }, [p.confirmation, rendreFocus]);

  const n = p.erreurs.length;
  return (
    <section className="mp-pq-envoi" aria-labelledby={idTitre}>
      <h2 id={idTitre} className="mp-section__titre">
        {p.collectif
          ? t("Envoyer la réponse de l'entreprise", "Send the company's response")
          : t("Envoyer vos réponses", "Send your responses")}
      </h2>
      <p className={p.etatAlerte ? "mp-pq-etat mp-pq-etat--alerte" : "mp-pq-etat"}>
        <Icone nom={p.etatAlerte ? "attention" : "nuage"} taille={16} />
        <span>{p.texteEtat}</span>
      </p>
      {p.hrefReconnexion ? (
        <p>
          <a href={p.hrefReconnexion} target="_blank" rel="noopener">
            {t("Se reconnecter dans un nouvel onglet", "Sign in again in a new tab")}
          </a>
        </p>
      ) : null}
      {n > 0 ? (
        <Alerte
          tonalite="danger"
          annonce="aucune"
          titre={
            n === 1
              ? t("Une question demande votre attention", "One question needs your attention")
              : t(`${n} questions demandent votre attention`, `${n} questions need your attention`)
          }
        >
          <ol className="mp-pq-erreurs">
            {p.erreurs.map((e) => (
              <li key={e.id}>
                <a
                  href={`#${idBlocQuestion(e.id)}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    p.onAllerA(e.id);
                  }}
                >
                  {e.libelle}
                </a>{" "}
                : {e.message}
              </li>
            ))}
          </ol>
        </Alerte>
      ) : null}
      {p.erreurEnvoi ? (
        <Alerte
          ref={p.refErreurEnvoi}
          tonalite="danger"
          titre={t("Envoi impossible", "Sending impossible")}
        >
          <p>{p.erreurEnvoi}</p>
        </Alerte>
      ) : null}
      {p.confirmation ? (
        <div className="mp-pq-confirmation" role="group" aria-labelledby={idConfirmation}>
          <p
            id={idConfirmation}
            ref={refConfirmation}
            tabIndex={-1}
            className="mp-pq-confirmation__titre"
          >
            {p.collectif
              ? t("Envoyer la réponse de votre entreprise ?", "Send your company's response?")
              : t("Envoyer vos réponses ?", "Send your responses?")}
          </p>
          <p>
            <strong>
              {p.collectif
                ? t(
                    "Après envoi, vous ne pourrez plus modifier la réponse de votre entreprise, vos collègues non plus.",
                    "After sending, you will no longer be able to edit your company's response, and neither will your colleagues.",
                  )
                : t(
                    "Après envoi, vous ne pourrez plus modifier vos réponses.",
                    "After sending, you will no longer be able to edit your responses.",
                  )}
            </strong>{" "}
            {p.collectif
              ? t(
                  "Elle sera transmise au cabinet, datée et enregistrée à votre nom.",
                  "It will be sent to the firm, dated and recorded in your name.",
                )
              : t(
                  "Elles seront transmises au cabinet, datées et enregistrées à votre nom.",
                  "They will be sent to the firm, dated and recorded in your name.",
                )}
          </p>
          <div className="mp-barre-actions">
            <Bouton
              icone="envoyer"
              onClick={p.onConfirmer}
              chargement={p.envoi}
              texteChargement={t("Envoi en cours…", "Sending…")}
            >
              {t("Oui, envoyer", "Yes, send")}
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={p.envoi}
              onClick={() => {
                setRendreFocus(true);
                p.onAnnuler();
              }}
            >
              {t("Revenir au questionnaire", "Back to the questionnaire")}
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="mp-barre-actions">
          <Bouton
            ref={refDemander}
            icone="envoyer"
            onClick={() => {
              setRendreFocus(false);
              p.onDemander();
            }}
          >
            {p.collectif
              ? t("Envoyer la réponse…", "Send the response…")
              : t("Envoyer mes réponses…", "Send my responses…")}
          </Bouton>
          <Bouton
            variante="secondaire"
            onClick={p.onEnregistrer}
            chargement={p.enregistrement}
            texteChargement={t("Enregistrement…", "Saving…")}
          >
            {t("Enregistrer le brouillon", "Save draft")}
          </Bouton>
        </div>
      )}
    </section>
  );
}
