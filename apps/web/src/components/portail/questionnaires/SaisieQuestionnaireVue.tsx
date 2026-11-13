"use client";

import type { ComponentProps, Ref } from "react";
import type { QuestionQuestionnaire } from "@missionpilot/shared";
import { formaterDate } from "../../../lib/format";
import { useT, useLangue } from "../../i18n/FournisseurLangue";
import {
  echeance,
  hrefReconnexion,
  texteSauvegarde,
  type EtatSauvegarde,
  type ProgressionPortail,
  type QuestionnaireComplet,
} from "../../../lib/portail-questionnaires";
import {
  propre,
  type Saisies,
  type ValeurSaisie,
} from "../../../lib/portail-questionnaires-saisie";
import { Alerte } from "../../ui/Alerte";
import { Icone } from "../../ui/Icone";
import { BandeauMode } from "./BandeauMode";
import { ChampQuestion } from "./ChampQuestion";
import { EnvoiQuestionnaire } from "./EnvoiQuestionnaire";
import { ProgressionQuestionnaire } from "./ProgressionQuestionnaire";
import { ETATS_ALERTE } from "./saisie-questionnaire-outils";
import "./questionnaires.css";

export interface SaisieQuestionnaireVueProps {
  questionnaire: QuestionnaireComplet;
  progression: ProgressionPortail;
  aujourdhui: string;
  actualisation: boolean;
  onActualiser: () => void;
  erreurGlobale: string | null;
  etatSauvegarde: EtatSauvegarde;
  derniereSauvegarde: string | null;
  visibles: ReadonlySet<string>;
  saisies: Saisies;
  majCollegues: ReadonlySet<string>;
  erreurDe: (q: QuestionQuestionnaire) => string | undefined;
  conflitDe: (q: QuestionQuestionnaire) => ComponentProps<typeof ChampQuestion>["conflit"];
  onModifier: (qid: string, v: ValeurSaisie) => void;
  onToucher: (qid: string) => void;
  sessionEnvoi: boolean;
  erreurs: ComponentProps<typeof EnvoiQuestionnaire>["erreurs"];
  erreurEnvoi: string | null;
  refErreurEnvoi: Ref<HTMLDivElement>;
  confirmation: boolean;
  envoi: boolean;
  onEnregistrer: () => void;
  onDemander: () => void;
  onConfirmer: () => void;
  onAnnuler: () => void;
  onAllerA: (qid: string) => void;
  annonce: string;
}

/** Rendu du formulaire de réponse : bandeaux, suivi, sections visibles et zone d'envoi. */
export function SaisieQuestionnaireVue({
  questionnaire,
  progression,
  aujourdhui,
  actualisation,
  onActualiser,
  erreurGlobale,
  etatSauvegarde,
  derniereSauvegarde,
  visibles,
  saisies,
  majCollegues,
  erreurDe,
  conflitDe,
  onModifier,
  onToucher,
  sessionEnvoi,
  erreurs,
  erreurEnvoi,
  refErreurEnvoi,
  confirmation,
  envoi,
  onEnregistrer,
  onDemander,
  onConfirmer,
  onAnnuler,
  onAllerA,
  annonce,
}: SaisieQuestionnaireVueProps) {
  const t = useT();
  const langue = useLangue();
  const { id, mode } = questionnaire;
  const collectif = mode === "collectif";
  const sections = questionnaire.definition.sections
    .map((s) => ({ section: s, questions: s.questions.filter((q) => visibles.has(q.id)) }))
    .filter((x) => x.questions.length > 0);
  const ech = echeance(questionnaire.date_limite, aujourdhui, langue);
  const etatAlerte = ETATS_ALERTE.has(etatSauvegarde);
  const texteEtat = texteSauvegarde(etatSauvegarde, derniereSauvegarde, undefined, langue);

  return (
    <>
      <BandeauMode
        mode={mode}
        fonction={questionnaire.fonction}
        onActualiser={collectif ? onActualiser : undefined}
        actualisation={actualisation}
      />
      {ech?.depassee ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("Date limite dépassée", "Due date passed")}
        >
          <p>
            {t("La date limite était le ", "The due date was ")}
            {formaterDate(questionnaire.date_limite, undefined, langue)}
            {t(
              " : le cabinet doit la prolonger pour que vos réponses soient de nouveau acceptées.",
              ": the firm must extend it for your responses to be accepted again.",
            )}
          </p>
        </Alerte>
      ) : null}

      <div className="mp-pq-suivi">
        <ProgressionQuestionnaire progression={progression} id="mp-pq-progression" />
        <p className={etatAlerte ? "mp-pq-etat mp-pq-etat--alerte" : "mp-pq-etat"}>
          <Icone nom={etatAlerte ? "attention" : "nuage"} taille={16} />
          <span>{texteEtat}</span>
        </p>
        {erreurGlobale ? (
          <Alerte tonalite="danger" titre={t("Attention", "Warning")}>
            <p>{erreurGlobale}</p>
          </Alerte>
        ) : null}
        <p className="mp-pq-note">
          {t(
            "Les questions marquées d'un astérisque (*) sont obligatoires. Vos réponses sont enregistrées automatiquement au fil de la saisie : vous pouvez vous interrompre et reprendre plus tard.",
            "Questions marked with an asterisk (*) are required. Your responses are saved automatically as you type: you can stop and resume later.",
          )}
        </p>
      </div>

      {sections.length >= 3 ? (
        <details className="mp-details mp-pq-sommaire">
          <summary>
            {t("Sommaire", "Contents")} ({sections.length} {t("sections", "sections")})
          </summary>
          <ol>
            {sections.map(({ section }) => (
              <li key={section.id}>
                <a href={`#mp-pq-section-${section.id}`}>{section.titre}</a>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <form
        className="mp-pq-formulaire"
        noValidate
        aria-label={t(
          `Réponses au questionnaire « ${questionnaire.titre} »`,
          `Responses to the questionnaire "${questionnaire.titre}"`,
        )}
        onSubmit={(e) => e.preventDefault()}
      >
        {sections.map(({ section, questions: qs }) => {
          const idTitre = `mp-pq-titre-${section.id}`;
          return (
            <section
              key={section.id}
              id={`mp-pq-section-${section.id}`}
              className="mp-pq-section"
              aria-labelledby={idTitre}
            >
              <h2 id={idTitre} className="mp-section__titre mp-pq-section__titre">
                {section.titre}
              </h2>
              {section.description ? (
                <p className="mp-pq-section__description">{section.description}</p>
              ) : null}
              {qs.map((q) => (
                <ChampQuestion
                  key={q.id}
                  question={q}
                  valeur={propre(saisies, q.id)}
                  erreur={erreurDe(q)}
                  onChange={(v) => onModifier(q.id, v)}
                  onBlur={() => onToucher(q.id)}
                  miseAJour={majCollegues.has(q.id)}
                  conflit={conflitDe(q)}
                />
              ))}
            </section>
          );
        })}

        <EnvoiQuestionnaire
          collectif={collectif}
          texteEtat={texteEtat}
          etatAlerte={etatAlerte}
          enregistrement={etatSauvegarde === "enregistrement"}
          hrefReconnexion={
            etatSauvegarde === "session" || sessionEnvoi ? hrefReconnexion(id) : null
          }
          erreurs={erreurs}
          erreurEnvoi={erreurEnvoi}
          refErreurEnvoi={refErreurEnvoi}
          confirmation={confirmation}
          envoi={envoi}
          onEnregistrer={onEnregistrer}
          onDemander={onDemander}
          onConfirmer={onConfirmer}
          onAnnuler={onAnnuler}
          onAllerA={onAllerA}
        />
      </form>

      <div className="mp-visuellement-cache" role="status" aria-atomic="true">
        {annonce}
      </div>
    </>
  );
}
