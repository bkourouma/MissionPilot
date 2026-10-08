"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alerte } from "../../ui/Alerte";
import { BadgeStatut } from "../../ui/BadgeStatut";
import { EnteteDePage } from "../../ui/EnteteDePage";
import {
  aDefinition,
  CHEMIN_QUESTIONNAIRES_PORTAIL,
  echeance,
  estModifiable,
  etatQuestionnaire,
  finLectureSeule,
  libelleMode,
  type FinSaisie,
  type QuestionnaireComplet,
  type QuestionnairePortail,
} from "../../../lib/portail-questionnaires";
import { LectureQuestionnaire } from "./LectureQuestionnaire";
import { SaisieQuestionnaire } from "./SaisieQuestionnaire";
import "./questionnaires.css";

export interface ReponseQuestionnaireProps {
  questionnaire: QuestionnaireComplet;
  /** Date du jour « AAAA-MM-JJ », calculée côté serveur (même valeur au rendu et à l'hydratation). */
  aujourdhui: string;
}

/**
 * Page de réponse : en-tête (statut, mode, date limite) suivi du formulaire tant que le
 * questionnaire accepte une saisie, puis des réponses en lecture seule une fois envoyé,
 * verrouillé ou clos. La vue du serveur la plus récente alimente l'en-tête et la progression.
 */
export function ReponseQuestionnaire({ questionnaire, aujourdhui }: ReponseQuestionnaireProps) {
  const [vue, setVue] = useState<QuestionnairePortail>(questionnaire);
  const [fin, setFin] = useState<FinSaisie | null>(() =>
    estModifiable(questionnaire, aujourdhui) ? null : finLectureSeule(questionnaire, 0, aujourdhui),
  );
  const [focaliserFin, setFocaliserFin] = useState(false);
  const refFin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focaliserFin) refFin.current?.focus();
  }, [focaliserFin, fin]);

  function terminer(f: FinSaisie, nouvelle?: QuestionnairePortail) {
    if (nouvelle) setVue(nouvelle);
    setFin(f);
    setFocaliserFin(true);
  }

  const etat = etatQuestionnaire(vue, aujourdhui);
  const ech = echeance(vue.date_limite, aujourdhui);
  const definition = aDefinition(vue) ? vue.definition : questionnaire.definition;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={vue.titre}
        retour={{ href: CHEMIN_QUESTIONNAIRES_PORTAIL, libelle: "Vos questionnaires" }}
        badges={
          <>
            <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
            <BadgeStatut tonalite="neutre" sansIcone>
              {libelleMode(vue.mode, vue.fonction)}
            </BadgeStatut>
          </>
        }
        soustitre={ech ? ech.texte : "Sans date limite"}
      />
      {fin ? (
        <>
          <Alerte
            ref={refFin}
            tonalite={fin.tonalite}
            titre={fin.titre}
            annonce={focaliserFin ? undefined : "aucune"}
          >
            <p>{fin.message}</p>
            {fin.lien ? (
              <p>
                <Link href={fin.lien.href}>{fin.lien.libelle}</Link>
              </p>
            ) : null}
          </Alerte>
          {fin.type === "lecture" ? (
            <>
              <LectureQuestionnaire definition={definition} reponses={vue.reponse.reponses ?? {}} />
              <p>
                <Link href={CHEMIN_QUESTIONNAIRES_PORTAIL}>Retour à vos questionnaires</Link>
              </p>
            </>
          ) : null}
        </>
      ) : (
        <SaisieQuestionnaire
          questionnaire={questionnaire}
          progression={vue.reponse.progression}
          aujourdhui={aujourdhui}
          onVue={setVue}
          onFin={terminer}
        />
      )}
    </div>
  );
}
