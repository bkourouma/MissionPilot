"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
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
        {p.collectif ? "Envoyer la réponse de l'entreprise" : "Envoyer vos réponses"}
      </h2>
      <p className={p.etatAlerte ? "mp-pq-etat mp-pq-etat--alerte" : "mp-pq-etat"}>
        <Icone nom={p.etatAlerte ? "attention" : "nuage"} taille={16} />
        <span>{p.texteEtat}</span>
      </p>
      {p.hrefReconnexion ? (
        <p>
          <a href={p.hrefReconnexion} target="_blank" rel="noopener">
            Se reconnecter dans un nouvel onglet
          </a>
        </p>
      ) : null}
      {n > 0 ? (
        <Alerte
          tonalite="danger"
          annonce="aucune"
          titre={
            n === 1
              ? "Une question demande votre attention"
              : `${n} questions demandent votre attention`
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
        <Alerte ref={p.refErreurEnvoi} tonalite="danger" titre="Envoi impossible">
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
            {p.collectif ? "Envoyer la réponse de votre entreprise ?" : "Envoyer vos réponses ?"}
          </p>
          <p>
            <strong>
              {p.collectif
                ? "Après envoi, vous ne pourrez plus modifier la réponse de votre entreprise, vos collègues non plus."
                : "Après envoi, vous ne pourrez plus modifier vos réponses."}
            </strong>{" "}
            {p.collectif
              ? "Elle sera transmise au cabinet, datée et enregistrée à votre nom."
              : "Elles seront transmises au cabinet, datées et enregistrées à votre nom."}
          </p>
          <div className="mp-barre-actions">
            <Bouton
              icone="envoyer"
              onClick={p.onConfirmer}
              chargement={p.envoi}
              texteChargement="Envoi en cours…"
            >
              Oui, envoyer
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={p.envoi}
              onClick={() => {
                setRendreFocus(true);
                p.onAnnuler();
              }}
            >
              Revenir au questionnaire
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
            {p.collectif ? "Envoyer la réponse…" : "Envoyer mes réponses…"}
          </Bouton>
          <Bouton
            variante="secondaire"
            onClick={p.onEnregistrer}
            chargement={p.enregistrement}
            texteChargement="Enregistrement…"
          >
            Enregistrer le brouillon
          </Bouton>
        </div>
      )}
    </section>
  );
}
