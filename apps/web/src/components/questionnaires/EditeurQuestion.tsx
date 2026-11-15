"use client";

import { useEffect, useState } from "react";
import {
  ajusterNiveaux,
  avecChamp,
  changerModele,
  conditionParDefaut,
  deplacer,
  ECHELLES_TYPES,
  libelleEchelleType,
  estIdentifiantValide,
  estModeleQuestion,
  idAncreQuestion,
  LONGUEUR_TEXTE_PLAFOND,
  modeleQuestionTexte,
  MODELES_QUESTION,
  modeleDeQuestion,
  nouvelleOption,
  OPTIONS_MAX,
  OPTIONS_MIN,
  POINTS_LIKERT_MAX,
  POINTS_LIKERT_MIN,
  remplacer,
  retirer,
  texteFacultatif,
  type Anomalie,
  type OptionChoix,
  type Question,
  type QuestionIndexee,
} from "../../lib/questionnaires-definition";
import { useT, useLangue } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChampNombre } from "./ChampNombre";
import { EditeurCondition } from "./EditeurCondition";

export interface EditeurQuestionProps {
  q: Question;
  si: number;
  qi: number;
  /** Nombre de questions de la section (déplacement, suppression). */
  total: number;
  candidates: readonly QuestionIndexee[];
  questions: ReadonlyMap<string, Question>;
  /** Anomalies dont le chemin désigne cette question ou l'un de ses éléments. */
  anomalies: readonly Anomalie[];
  onChange: (q: Question) => void;
  onRenommer: (id: string) => void;
  onDeplacer: (sens: -1 | 1) => void;
  onSupprimer: () => void;
}

/** Message de l'anomalie portant exactement sur `chemin`, s'il y en a une. */
export function erreurA(anomalies: readonly Anomalie[], chemin: string): string | undefined {
  return anomalies.find((a) => a.chemin === chemin)?.message;
}

/** Éditeur d'une question : libellé, type, aide, caractère obligatoire, réglages, condition. */
export function EditeurQuestion({
  q,
  si,
  qi,
  total,
  candidates,
  questions,
  anomalies,
  onChange,
  onRenommer,
  onDeplacer,
  onSupprimer,
}: EditeurQuestionProps) {
  const t = useT();
  const langue = useLangue();
  const base = `sections[${si}].questions[${qi}]`;
  const idBase = idAncreQuestion(si, qi);
  const nom = q.libelle.trim() || t(`question ${qi + 1}`, `question ${qi + 1}`);
  const modele = modeleDeQuestion(q);
  const champs = new Set([`${base}.libelle`, `${base}.aide`, `${base}.id`]);
  const autres = anomalies.filter((a) => !champs.has(a.chemin));

  return (
    <article
      id={idBase}
      tabIndex={-1}
      className={anomalies.length > 0 ? "mp-qe-question mp-qe-question--erreur" : "mp-qe-question"}
      aria-labelledby={`${idBase}-titre`}
    >
      <div className="mp-qe-entete">
        <h3 id={`${idBase}-titre`} className="mp-qe-repere">
          {`Question ${qi + 1}`}
          <span className="mp-visuellement-cache">{` : ${nom}`}</span>
          <span aria-hidden="true">{` · ${modeleQuestionTexte(modele, langue).libelle}`}</span>
        </h3>
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="discret"
            icone="flecheHaut"
            disabled={qi === 0}
            onClick={() => onDeplacer(-1)}
            aria-label={t(`Monter la question ${qi + 1}`, `Move up question ${qi + 1}`)}
          >
            {t("Monter", "Move up")}
          </Bouton>
          <Bouton
            variante="discret"
            icone="flecheBas"
            disabled={qi === total - 1}
            onClick={() => onDeplacer(1)}
            aria-label={t(`Descendre la question ${qi + 1}`, `Move down question ${qi + 1}`)}
          >
            {t("Descendre", "Move down")}
          </Bouton>
          {total > 1 ? (
            <BoutonConfirmation
              libelle={t("Supprimer", "Delete")}
              icone="corbeille"
              variante="discret"
              ariaLabel={t(`Supprimer la question ${qi + 1}`, `Delete question ${qi + 1}`)}
              question={t(
                `Supprimer la question ${qi + 1} « ${nom} » ?`,
                `Delete question ${qi + 1} "${nom}"?`,
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
          aria-label={t(`Anomalies de la question ${qi + 1}`, `Issues in question ${qi + 1}`)}
        >
          {autres.map((a, i) => (
            <li key={`${a.chemin}-${i}`} className="mp-champ__erreur">
              <Icone nom="attention" taille={16} />
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ZoneTexte
        libelle={t("Libellé de la question", "Question label")}
        name={`${idBase}-libelle`}
        required
        rows={2}
        maxLength={500}
        value={q.libelle}
        erreur={erreurA(anomalies, `${base}.libelle`)}
        onChange={(e) => onChange({ ...q, libelle: e.target.value })}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Type de réponse", "Response type")}
          name={`${idBase}-type`}
          value={modele}
          options={MODELES_QUESTION.map((m) => ({
            valeur: m,
            libelle: modeleQuestionTexte(m, langue).libelle,
          }))}
          aide={modeleQuestionTexte(modele, langue).aide}
          onChange={(e) => {
            if (estModeleQuestion(e.target.value)) onChange(changerModele(q, e.target.value));
          }}
        />
        <CaseACocher
          libelle={t("Réponse obligatoire", "Required response")}
          aide={t(
            "Une question obligatoire masquée par sa condition n'est pas exigée.",
            "A required question hidden by its condition is not required.",
          )}
          checked={q.obligatoire}
          onChange={(e) => onChange({ ...q, obligatoire: e.target.checked })}
        />
      </div>
      <ZoneTexte
        libelle={t("Aide pour le répondant", "Help for the respondent")}
        name={`${idBase}-aide`}
        rows={2}
        maxLength={1_000}
        value={q.aide ?? ""}
        aide={t(
          "Facultative : précision affichée sous le libellé.",
          "Optional: clarification displayed under the label.",
        )}
        erreur={erreurA(anomalies, `${base}.aide`)}
        onChange={(e) => onChange(avecChamp(q, "aide", texteFacultatif(e.target.value)))}
      />

      <ReglagesType q={q} idBase={idBase} onChange={onChange} />

      <CaseACocher
        libelle={t(
          "Afficher cette question seulement sous condition",
          "Display this question only under a condition",
        )}
        aide={
          candidates.length === 0
            ? t(
                "Ajoutez d'abord une autre question à laquelle rattacher la condition.",
                "First add another question to attach the condition to.",
              )
            : t(
                "La question n'apparaît au répondant que si la condition est vraie.",
                "The question only appears to the respondent if the condition is true.",
              )
        }
        disabled={candidates.length === 0 && q.condition === undefined}
        checked={q.condition !== undefined}
        onChange={(e) => {
          const premiere = candidates[0]?.question;
          if (!e.target.checked) onChange(avecChamp(q, "condition", undefined));
          else if (premiere) onChange({ ...q, condition: conditionParDefaut(premiere) });
        }}
      />
      {q.condition ? (
        <EditeurCondition
          condition={q.condition}
          onChange={(c) => onChange({ ...q, condition: c })}
          candidates={candidates}
          questions={questions}
          idBase={`${idBase}-c`}
          legende={t("Condition d'affichage", "Display condition")}
        />
      ) : null}

      <ChampIdentifiant
        id={q.id}
        idBase={idBase}
        erreur={erreurA(anomalies, `${base}.id`)}
        onRenommer={onRenommer}
      />
    </article>
  );
}

/** Identifiant stable, modifié à la sortie du champ (les conditions qui le citent suivent). */
export function ChampIdentifiant({
  id,
  idBase,
  erreur,
  onRenommer,
  objet = "question",
}: {
  id: string;
  idBase: string;
  erreur?: string;
  onRenommer: (id: string) => void;
  objet?: "question" | "section";
}) {
  const t = useT();
  const [texte, setTexte] = useState(id);
  useEffect(() => setTexte(id), [id]);
  const invalide = texte.trim() !== "" && !estIdentifiantValide(texte.trim());
  return (
    <details className="mp-details">
      <summary>
        {t(
          `Identifiant de la ${objet}`,
          `${objet === "question" ? "Question" : "Section"} identifier`,
        )}
        <span className="mp-visuellement-cache">{` (${id})`}</span>
      </summary>
      <Champ
        libelle={t(
          `Identifiant de la ${objet}`,
          `${objet === "question" ? "Question" : "Section"} identifier`,
        )}
        name={`${idBase}-id`}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        value={texte}
        aide={
          objet === "question"
            ? t(
                "Clé stable des réponses et des grilles de notation : minuscules, chiffres, « _ », « . » ou « - ». Les conditions qui citent la question sont mises à jour ; une grille de notation, elle, ne l'est pas.",
                'Stable key of responses and rating grids: lowercase letters, digits, "_", "." or "-". Conditions that cite the question are updated; a rating grid is not.',
              )
            : t(
                "Clé stable de la section : minuscules, chiffres, « _ », « . » ou « - ».",
                'Stable key of the section: lowercase letters, digits, "_", "." or "-".',
              )
        }
        erreur={
          texte.trim() === ""
            ? t("L'identifiant est obligatoire.", "The identifier is required.")
            : invalide
              ? t(
                  "Identifiant invalide : minuscules sans accent, chiffres, « _ », « . » ou « - ».",
                  'Invalid identifier: lowercase letters without accents, digits, "_", "." or "-".',
                )
              : erreur
        }
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => {
          const saisi = texte.trim();
          if (saisi !== "" && saisi !== id && estIdentifiantValide(saisi)) onRenommer(saisi);
          else setTexte(id);
        }}
      />
    </details>
  );
}

function ReglagesType({
  q,
  idBase,
  onChange,
}: {
  q: Question;
  idBase: string;
  onChange: (q: Question) => void;
}) {
  const t = useT();
  switch (q.type) {
    case "likert":
      return <ReglagesLikert q={q} idBase={idBase} onChange={onChange} />;
    case "choix_unique":
    case "choix_multiple":
      return <ReglagesChoix q={q} idBase={idBase} onChange={onChange} />;
    case "texte":
      return (
        <div className="mp-grille-champs">
          <ChampNombre
            libelle={t("Longueur maximale (caractères)", "Maximum length (characters)")}
            name={`${idBase}-longueur`}
            entier
            valeur={q.longueurMax}
            aide={t(
              `Facultative : 2 000 par défaut, ${LONGUEUR_TEXTE_PLAFOND.toLocaleString("fr-FR")} au plus.`,
              `Optional: 2,000 by default, ${LONGUEUR_TEXTE_PLAFOND.toLocaleString("en-GB")} at most.`,
            )}
            onChange={(v) => onChange(avecChamp(q, "longueurMax", v))}
          />
        </div>
      );
    case "numerique":
      if (modeleDeQuestion(q) === "pourcentage") {
        return (
          <div className="mp-pile">
            <p className="mp-qe-resume">
              <Icone nom="info" taille={16} />
              <span>
                {t(
                  "Réponse de 0 à 100 %. Pour d'autres bornes, choisissez le type « Nombre ».",
                  'Response from 0 to 100%. For other bounds, choose the "Number" type.',
                )}
              </span>
            </p>
            <CaseACocher
              libelle={t("Nombre entier exigé", "Whole number required")}
              checked={q.entier === true}
              onChange={(e) => onChange(avecChamp(q, "entier", e.target.checked || undefined))}
            />
          </div>
        );
      }
      return (
        <div className="mp-grille-champs">
          <ChampNombre
            libelle={t("Minimum", "Minimum")}
            name={`${idBase}-min`}
            valeur={q.min}
            aide={t("Facultatif.", "Optional.")}
            onChange={(v) => onChange(avecChamp(q, "min", v))}
          />
          <ChampNombre
            libelle={t("Maximum", "Maximum")}
            name={`${idBase}-max`}
            valeur={q.max}
            aide={t("Facultatif.", "Optional.")}
            onChange={(v) => onChange(avecChamp(q, "max", v))}
          />
          <Champ
            libelle={t("Unité", "Unit")}
            name={`${idBase}-unite`}
            maxLength={30}
            value={q.unite ?? ""}
            aide={t("Facultative, ex. personnes, FCFA, %.", "Optional, e.g. people, FCFA, %.")}
            onChange={(e) => onChange(avecChamp(q, "unite", texteFacultatif(e.target.value)))}
          />
          <CaseACocher
            libelle={t("Nombre entier exigé", "Whole number required")}
            checked={q.entier === true}
            onChange={(e) => onChange(avecChamp(q, "entier", e.target.checked || undefined))}
          />
        </div>
      );
    case "date":
      return (
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Date au plus tôt", "Earliest date")}
            name={`${idBase}-min`}
            type="date"
            value={q.min ?? ""}
            aide={t("Facultative.", "Optional.")}
            onChange={(e) => onChange(avecChamp(q, "min", texteFacultatif(e.target.value)))}
          />
          <Champ
            libelle={t("Date au plus tard", "Latest date")}
            name={`${idBase}-max`}
            type="date"
            value={q.max ?? ""}
            aide={t("Facultative.", "Optional.")}
            onChange={(e) => onChange(avecChamp(q, "max", texteFacultatif(e.target.value)))}
          />
        </div>
      );
    case "oui_non":
      return (
        <p className="mp-qe-resume">
          <Icone nom="info" taille={16} />
          <span>{t("Réponses proposées : Oui, Non.", "Proposed responses: Yes, No.")}</span>
        </p>
      );
  }
}

function ReglagesLikert({
  q,
  idBase,
  onChange,
}: {
  q: Extract<Question, { type: "likert" }>;
  idBase: string;
  onChange: (q: Question) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const points = Array.from(
    { length: POINTS_LIKERT_MAX - POINTS_LIKERT_MIN + 1 },
    (_, i) => POINTS_LIKERT_MIN + i,
  );
  return (
    <fieldset className="mp-groupe">
      <legend className="mp-champ__libelle">{t("Échelle de réponse", "Response scale")}</legend>
      <div className="mp-ligne-action">
        <Select
          libelle={t("Nombre de niveaux", "Number of levels")}
          name={`${idBase}-points`}
          value={String(q.points)}
          options={points.map((p) => ({ valeur: String(p), libelle: String(p) }))}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ ...q, points: n, libelles: ajusterNiveaux(q.libelles, n) });
          }}
        />
        {ECHELLES_TYPES.map((e) => (
          <Bouton
            key={e.id}
            variante="secondaire"
            onClick={() => onChange({ ...q, points: e.niveaux.length, libelles: [...e.niveaux] })}
          >
            {`${libelleEchelleType(e.id, langue)} (${e.niveaux.length} ${t("niveaux", "levels")})`}
          </Bouton>
        ))}
      </div>
      <ol className="mp-qe-elements">
        {q.libelles.map((l, i) => (
          <li key={i} className="mp-qe-element mp-qe-element--niveau">
            <span className="mp-qe-element__rang" aria-hidden="true">
              {i + 1}
            </span>
            <Champ
              libelle={t(`Libellé du niveau ${i + 1}`, `Label of level ${i + 1}`)}
              name={`${idBase}-niveau-${i}`}
              required
              maxLength={120}
              value={l}
              onChange={(e) =>
                onChange({ ...q, libelles: remplacer(q.libelles, i, e.target.value) })
              }
            />
          </li>
        ))}
      </ol>
    </fieldset>
  );
}

function ReglagesChoix({
  q,
  idBase,
  onChange,
}: {
  q: Extract<Question, { type: "choix_unique" | "choix_multiple" }>;
  idBase: string;
  onChange: (q: Question) => void;
}) {
  const t = useT();
  const options = (o: OptionChoix[]) => onChange({ ...q, options: o });
  return (
    <fieldset className="mp-groupe">
      <legend className="mp-champ__libelle">
        {t(`Options (${q.options.length})`, `Options (${q.options.length})`)}
      </legend>
      <p className="mp-champ__aide">
        {t(
          `De ${OPTIONS_MIN} à ${OPTIONS_MAX} options. Le code est la valeur enregistrée : gardez-le stable après un envoi.`,
          `From ${OPTIONS_MIN} to ${OPTIONS_MAX} options. The code is the stored value: keep it stable after sending.`,
        )}
      </p>
      <ol className="mp-qe-elements">
        {q.options.map((o, i) => (
          <li key={i} className="mp-qe-element">
            <Champ
              libelle={t(`Code de l'option ${i + 1}`, `Code of option ${i + 1}`)}
              name={`${idBase}-option-${i}-code`}
              required
              autoCapitalize="none"
              spellCheck={false}
              maxLength={80}
              value={o.code}
              erreur={
                o.code !== "" && !estIdentifiantValide(o.code)
                  ? t(
                      "Minuscules sans accent, chiffres, « _ », « . » ou « - ».",
                      'Lowercase letters without accents, digits, "_", "." or "-".',
                    )
                  : undefined
              }
              onChange={(e) => options(remplacer(q.options, i, { ...o, code: e.target.value }))}
            />
            <Champ
              libelle={t(`Libellé de l'option ${i + 1}`, `Label of option ${i + 1}`)}
              name={`${idBase}-option-${i}-libelle`}
              required
              maxLength={200}
              value={o.libelle}
              onChange={(e) => options(remplacer(q.options, i, { ...o, libelle: e.target.value }))}
            />
            <div className="mp-barre-actions mp-barre-actions--compacte">
              <Bouton
                variante="discret"
                icone="flecheHaut"
                disabled={i === 0}
                aria-label={t(`Monter l'option ${i + 1}`, `Move up option ${i + 1}`)}
                onClick={() => options(deplacer(q.options, i, -1))}
              >
                <span className="mp-visuellement-cache">{t("Monter", "Move up")}</span>
              </Bouton>
              <Bouton
                variante="discret"
                icone="flecheBas"
                disabled={i === q.options.length - 1}
                aria-label={t(`Descendre l'option ${i + 1}`, `Move down option ${i + 1}`)}
                onClick={() => options(deplacer(q.options, i, 1))}
              >
                <span className="mp-visuellement-cache">{t("Descendre", "Move down")}</span>
              </Bouton>
              <Bouton
                variante="discret"
                icone="corbeille"
                disabled={q.options.length <= OPTIONS_MIN}
                aria-label={t(`Retirer l'option ${i + 1}`, `Remove option ${i + 1}`)}
                onClick={() => options(retirer(q.options, i))}
              >
                <span className="mp-visuellement-cache">{t("Retirer", "Remove")}</span>
              </Bouton>
            </div>
          </li>
        ))}
      </ol>
      <div>
        <Bouton
          variante="secondaire"
          icone="plus"
          disabled={q.options.length >= OPTIONS_MAX}
          onClick={() => options([...q.options, nouvelleOption(q.options)])}
        >
          {t("Ajouter une option", "Add an option")}
        </Bouton>
      </div>
      {q.type === "choix_multiple" ? (
        <div className="mp-grille-champs">
          <ChampNombre
            libelle={t("Nombre minimal de réponses", "Minimum number of responses")}
            name={`${idBase}-min-selections`}
            entier
            valeur={q.minSelections}
            aide={t("Facultatif : 1 par défaut.", "Optional: 1 by default.")}
            onChange={(v) => onChange(avecChamp(q, "minSelections", v))}
          />
          <ChampNombre
            libelle={t("Nombre maximal de réponses", "Maximum number of responses")}
            name={`${idBase}-max-selections`}
            entier
            valeur={q.maxSelections}
            aide={t(
              "Facultatif : toutes les options par défaut.",
              "Optional: all options by default.",
            )}
            onChange={(v) => onChange(avecChamp(q, "maxSelections", v))}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
