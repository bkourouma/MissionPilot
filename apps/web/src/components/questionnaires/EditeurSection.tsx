"use client";

import { useState } from "react";
import {
  avecChamp,
  conditionParDefaut,
  idAncreSection,
  modeleQuestionTexte,
  MODELES_QUESTION,
  estModeleQuestion,
  texteFacultatif,
  type Anomalie,
  type ModeleQuestion,
  type Question,
  type QuestionIndexee,
  type Section,
} from "../../lib/questionnaires-definition";
import { useT, useLangue } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { EditeurCondition } from "./EditeurCondition";
import { ChampIdentifiant, EditeurQuestion, erreurA } from "./EditeurQuestion";

/** Nombre maximal de questions par section (schéma partagé). */
const QUESTIONS_MAX = 200;

export interface EditeurSectionProps {
  s: Section;
  si: number;
  total: number;
  /** Questions que la condition de la section peut citer (hors de la section). */
  candidatesSection: readonly QuestionIndexee[];
  /** Questions qu'une question de la section peut citer, par rang de question. */
  candidatesQuestion: (qi: number) => readonly QuestionIndexee[];
  questions: ReadonlyMap<string, Question>;
  anomalies: readonly Anomalie[];
  onChange: (s: Section) => void;
  onQuestion: (qi: number, q: Question) => void;
  onRenommerQuestion: (qi: number, id: string) => void;
  onAjouterQuestion: (modele: ModeleQuestion) => void;
  onDeplacerQuestion: (qi: number, sens: -1 | 1) => void;
  onSupprimerQuestion: (qi: number) => void;
  onDeplacer: (sens: -1 | 1) => void;
  onSupprimer: () => void;
}

/** Éditeur d'une section : titre, description, condition, questions et ajout d'une question. */
export function EditeurSection({
  s,
  si,
  total,
  candidatesSection,
  candidatesQuestion,
  questions,
  anomalies,
  onChange,
  onQuestion,
  onRenommerQuestion,
  onAjouterQuestion,
  onDeplacerQuestion,
  onSupprimerQuestion,
  onDeplacer,
  onSupprimer,
}: EditeurSectionProps) {
  const t = useT();
  const langue = useLangue();
  const [modele, setModele] = useState<ModeleQuestion>("likert");
  const base = `sections[${si}]`;
  const idBase = idAncreSection(si);
  const nom = s.titre.trim() || t(`section ${si + 1}`, `section ${si + 1}`);
  const propres = anomalies.filter(
    (a) =>
      a.chemin === base ||
      (a.chemin.startsWith(`${base}.`) && !a.chemin.startsWith(`${base}.questions[`)),
  );
  const champs = new Set([`${base}.titre`, `${base}.description`, `${base}.id`]);
  const autres = propres.filter((a) => !champs.has(a.chemin));

  return (
    <section
      id={idBase}
      tabIndex={-1}
      className="mp-qe-section"
      aria-labelledby={`${idBase}-titre`}
    >
      <div className="mp-qe-entete">
        <h2 id={`${idBase}-titre`} className="mp-qe-entete__titre">
          {`Section ${si + 1}`}
          <span className="mp-visuellement-cache">{` : ${nom}`}</span>
        </h2>
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="discret"
            icone="flecheHaut"
            disabled={si === 0}
            onClick={() => onDeplacer(-1)}
            aria-label={t(`Monter la section ${si + 1}`, `Move up section ${si + 1}`)}
          >
            {t("Monter", "Move up")}
          </Bouton>
          <Bouton
            variante="discret"
            icone="flecheBas"
            disabled={si === total - 1}
            onClick={() => onDeplacer(1)}
            aria-label={t(`Descendre la section ${si + 1}`, `Move down section ${si + 1}`)}
          >
            {t("Descendre", "Move down")}
          </Bouton>
          {total > 1 ? (
            <BoutonConfirmation
              libelle={t("Supprimer", "Delete")}
              icone="corbeille"
              variante="discret"
              ariaLabel={t(`Supprimer la section ${si + 1}`, `Delete section ${si + 1}`)}
              question={t(
                `Supprimer la section ${si + 1} « ${nom} » et ses ${s.questions.length} question(s) ?`,
                `Delete section ${si + 1} "${nom}" and its ${s.questions.length} question(s)?`,
              )}
              libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
              action={async () => onSupprimer()}
            />
          ) : null}
        </div>
      </div>

      {autres.length > 0 ? (
        <ul
          className="mp-qe-anomalies"
          aria-label={t(`Anomalies de la section ${si + 1}`, `Issues in section ${si + 1}`)}
        >
          {autres.map((a, i) => (
            <li key={`${a.chemin}-${i}`} className="mp-champ__erreur">
              <Icone nom="attention" taille={16} />
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Champ
        libelle={t("Titre de la section", "Section title")}
        name={`${idBase}-titre-champ`}
        required
        maxLength={200}
        value={s.titre}
        erreur={erreurA(propres, `${base}.titre`)}
        onChange={(e) => onChange({ ...s, titre: e.target.value })}
      />
      <ZoneTexte
        libelle={t("Description", "Description")}
        name={`${idBase}-description`}
        rows={2}
        maxLength={2_000}
        value={s.description ?? ""}
        aide={t(
          "Facultative : texte d'introduction affiché aux répondants.",
          "Optional: introduction text displayed to respondents.",
        )}
        erreur={erreurA(propres, `${base}.description`)}
        onChange={(e) => onChange(avecChamp(s, "description", texteFacultatif(e.target.value)))}
      />
      <CaseACocher
        libelle={t(
          "Afficher cette section seulement sous condition",
          "Display this section only under a condition",
        )}
        aide={
          candidatesSection.length === 0
            ? t(
                "Une condition de section cite une question d'une autre section : ajoutez-en une d'abord.",
                "A section condition refers to a question from another section: add one first.",
              )
            : t(
                "Toutes les questions de la section sont masquées si la condition est fausse.",
                "All questions in the section are hidden if the condition is false.",
              )
        }
        disabled={candidatesSection.length === 0 && s.condition === undefined}
        checked={s.condition !== undefined}
        onChange={(e) => {
          const premiere = candidatesSection[0]?.question;
          if (!e.target.checked) onChange(avecChamp(s, "condition", undefined));
          else if (premiere) onChange({ ...s, condition: conditionParDefaut(premiere) });
        }}
      />
      {s.condition ? (
        <EditeurCondition
          condition={s.condition}
          onChange={(c) => onChange({ ...s, condition: c })}
          candidates={candidatesSection}
          questions={questions}
          idBase={`${idBase}-c`}
          legende={t("Condition d'affichage de la section", "Section display condition")}
        />
      ) : null}
      <ChampIdentifiant
        id={s.id}
        idBase={idBase}
        objet="section"
        erreur={erreurA(propres, `${base}.id`)}
        onRenommer={(id) => onChange({ ...s, id })}
      />

      <ol
        className="mp-qe-liste"
        aria-label={t(`Questions de la section ${si + 1}`, `Questions of section ${si + 1}`)}
      >
        {s.questions.map((q, qi) => (
          <li key={qi}>
            <EditeurQuestion
              q={q}
              si={si}
              qi={qi}
              total={s.questions.length}
              candidates={candidatesQuestion(qi)}
              questions={questions}
              anomalies={anomalies.filter(
                (a) =>
                  a.chemin === `${base}.questions[${qi}]` ||
                  a.chemin.startsWith(`${base}.questions[${qi}].`),
              )}
              onChange={(n) => onQuestion(qi, n)}
              onRenommer={(id) => onRenommerQuestion(qi, id)}
              onDeplacer={(sens) => onDeplacerQuestion(qi, sens)}
              onSupprimer={() => onSupprimerQuestion(qi)}
            />
          </li>
        ))}
      </ol>

      <div className="mp-qe-ajout">
        <Select
          libelle={t("Type de la nouvelle question", "Type of the new question")}
          name={`${idBase}-nouvelle`}
          value={modele}
          options={MODELES_QUESTION.map((m) => ({
            valeur: m,
            libelle: modeleQuestionTexte(m, langue).libelle,
          }))}
          onChange={(e) => {
            if (estModeleQuestion(e.target.value)) setModele(e.target.value);
          }}
        />
        <Bouton
          variante="secondaire"
          icone="plus"
          disabled={s.questions.length >= QUESTIONS_MAX}
          onClick={() => onAjouterQuestion(modele)}
          aria-label={t(
            `Ajouter une question à la section ${si + 1}`,
            `Add a question to section ${si + 1}`,
          )}
        >
          {t("Ajouter la question", "Add the question")}
        </Bouton>
      </div>
    </section>
  );
}
