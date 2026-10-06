"use client";

import { useState } from "react";
import {
  avecChamp,
  conditionParDefaut,
  idAncreSection,
  MODELE_QUESTION,
  MODELES_QUESTION,
  estModeleQuestion,
  texteFacultatif,
  type Anomalie,
  type ModeleQuestion,
  type Question,
  type QuestionIndexee,
  type Section,
} from "../../lib/questionnaires-definition";
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
  const [modele, setModele] = useState<ModeleQuestion>("likert");
  const base = `sections[${si}]`;
  const idBase = idAncreSection(si);
  const nom = s.titre.trim() || `section ${si + 1}`;
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
            aria-label={`Monter la section ${si + 1}`}
          >
            Monter
          </Bouton>
          <Bouton
            variante="discret"
            icone="flecheBas"
            disabled={si === total - 1}
            onClick={() => onDeplacer(1)}
            aria-label={`Descendre la section ${si + 1}`}
          >
            Descendre
          </Bouton>
          {total > 1 ? (
            <BoutonConfirmation
              libelle="Supprimer"
              icone="corbeille"
              variante="discret"
              ariaLabel={`Supprimer la section ${si + 1}`}
              question={`Supprimer la section ${si + 1} « ${nom} » et ses ${s.questions.length} question(s) ?`}
              libelleConfirmation="Oui, supprimer"
              action={async () => onSupprimer()}
            />
          ) : null}
        </div>
      </div>

      {autres.length > 0 ? (
        <ul className="mp-qe-anomalies" aria-label={`Anomalies de la section ${si + 1}`}>
          {autres.map((a, i) => (
            <li key={`${a.chemin}-${i}`} className="mp-champ__erreur">
              <Icone nom="attention" taille={16} />
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Champ
        libelle="Titre de la section"
        name={`${idBase}-titre-champ`}
        required
        maxLength={200}
        value={s.titre}
        erreur={erreurA(propres, `${base}.titre`)}
        onChange={(e) => onChange({ ...s, titre: e.target.value })}
      />
      <ZoneTexte
        libelle="Description"
        name={`${idBase}-description`}
        rows={2}
        maxLength={2_000}
        value={s.description ?? ""}
        aide="Facultative : texte d'introduction affiché aux répondants."
        erreur={erreurA(propres, `${base}.description`)}
        onChange={(e) => onChange(avecChamp(s, "description", texteFacultatif(e.target.value)))}
      />
      <CaseACocher
        libelle="Afficher cette section seulement sous condition"
        aide={
          candidatesSection.length === 0
            ? "Une condition de section cite une question d'une autre section : ajoutez-en une d'abord."
            : "Toutes les questions de la section sont masquées si la condition est fausse."
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
          legende="Condition d'affichage de la section"
        />
      ) : null}
      <ChampIdentifiant
        id={s.id}
        idBase={idBase}
        objet="section"
        erreur={erreurA(propres, `${base}.id`)}
        onRenommer={(id) => onChange({ ...s, id })}
      />

      <ol className="mp-qe-liste" aria-label={`Questions de la section ${si + 1}`}>
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
          libelle="Type de la nouvelle question"
          name={`${idBase}-nouvelle`}
          value={modele}
          options={MODELES_QUESTION.map((m) => ({
            valeur: m,
            libelle: MODELE_QUESTION[m].libelle,
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
          aria-label={`Ajouter une question à la section ${si + 1}`}
        >
          Ajouter la question
        </Bouton>
      </div>
    </section>
  );
}
