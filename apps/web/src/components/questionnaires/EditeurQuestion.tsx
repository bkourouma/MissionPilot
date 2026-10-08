"use client";

import { useEffect, useState } from "react";
import {
  ajusterNiveaux,
  avecChamp,
  changerModele,
  conditionParDefaut,
  deplacer,
  ECHELLES_TYPES,
  estIdentifiantValide,
  estModeleQuestion,
  idAncreQuestion,
  LONGUEUR_TEXTE_PLAFOND,
  MODELE_QUESTION,
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
  const base = `sections[${si}].questions[${qi}]`;
  const idBase = idAncreQuestion(si, qi);
  const nom = q.libelle.trim() || `question ${qi + 1}`;
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
          <span aria-hidden="true">{` · ${MODELE_QUESTION[modele].libelle}`}</span>
        </h3>
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="discret"
            icone="flecheHaut"
            disabled={qi === 0}
            onClick={() => onDeplacer(-1)}
            aria-label={`Monter la question ${qi + 1}`}
          >
            Monter
          </Bouton>
          <Bouton
            variante="discret"
            icone="flecheBas"
            disabled={qi === total - 1}
            onClick={() => onDeplacer(1)}
            aria-label={`Descendre la question ${qi + 1}`}
          >
            Descendre
          </Bouton>
          {total > 1 ? (
            <BoutonConfirmation
              libelle="Supprimer"
              icone="corbeille"
              variante="discret"
              ariaLabel={`Supprimer la question ${qi + 1}`}
              question={`Supprimer la question ${qi + 1} « ${nom} » ?`}
              libelleConfirmation="Oui, supprimer"
              action={async () => onSupprimer()}
            />
          ) : null}
        </div>
      </div>

      {autres.length > 0 ? (
        <ul className="mp-qe-anomalies" aria-label={`Anomalies de la question ${qi + 1}`}>
          {autres.map((a, i) => (
            <li key={`${a.chemin}-${i}`} className="mp-champ__erreur">
              <Icone nom="attention" taille={16} />
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ZoneTexte
        libelle="Libellé de la question"
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
          libelle="Type de réponse"
          name={`${idBase}-type`}
          value={modele}
          options={MODELES_QUESTION.map((m) => ({
            valeur: m,
            libelle: MODELE_QUESTION[m].libelle,
          }))}
          aide={MODELE_QUESTION[modele].aide}
          onChange={(e) => {
            if (estModeleQuestion(e.target.value)) onChange(changerModele(q, e.target.value));
          }}
        />
        <CaseACocher
          libelle="Réponse obligatoire"
          aide="Une question obligatoire masquée par sa condition n'est pas exigée."
          checked={q.obligatoire}
          onChange={(e) => onChange({ ...q, obligatoire: e.target.checked })}
        />
      </div>
      <ZoneTexte
        libelle="Aide pour le répondant"
        name={`${idBase}-aide`}
        rows={2}
        maxLength={1_000}
        value={q.aide ?? ""}
        aide="Facultative : précision affichée sous le libellé."
        erreur={erreurA(anomalies, `${base}.aide`)}
        onChange={(e) => onChange(avecChamp(q, "aide", texteFacultatif(e.target.value)))}
      />

      <ReglagesType q={q} idBase={idBase} onChange={onChange} />

      <CaseACocher
        libelle="Afficher cette question seulement sous condition"
        aide={
          candidates.length === 0
            ? "Ajoutez d'abord une autre question à laquelle rattacher la condition."
            : "La question n'apparaît au répondant que si la condition est vraie."
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
          legende="Condition d'affichage"
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
  const [texte, setTexte] = useState(id);
  useEffect(() => setTexte(id), [id]);
  const invalide = texte.trim() !== "" && !estIdentifiantValide(texte.trim());
  return (
    <details className="mp-details">
      <summary>
        {`Identifiant de la ${objet}`}
        <span className="mp-visuellement-cache">{` (${id})`}</span>
      </summary>
      <Champ
        libelle={`Identifiant de la ${objet}`}
        name={`${idBase}-id`}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        value={texte}
        aide={
          objet === "question"
            ? "Clé stable des réponses et des grilles de notation : minuscules, chiffres, « _ », « . » ou « - ». Les conditions qui citent la question sont mises à jour ; une grille de notation, elle, ne l'est pas."
            : "Clé stable de la section : minuscules, chiffres, « _ », « . » ou « - »."
        }
        erreur={
          texte.trim() === ""
            ? "L'identifiant est obligatoire."
            : invalide
              ? "Identifiant invalide : minuscules sans accent, chiffres, « _ », « . » ou « - »."
              : erreur
        }
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => {
          const t = texte.trim();
          if (t !== "" && t !== id && estIdentifiantValide(t)) onRenommer(t);
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
            libelle="Longueur maximale (caractères)"
            name={`${idBase}-longueur`}
            entier
            valeur={q.longueurMax}
            aide={`Facultative : 2 000 par défaut, ${LONGUEUR_TEXTE_PLAFOND.toLocaleString("fr-FR")} au plus.`}
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
                Réponse de 0 à 100 %. Pour d'autres bornes, choisissez le type « Nombre ».
              </span>
            </p>
            <CaseACocher
              libelle="Nombre entier exigé"
              checked={q.entier === true}
              onChange={(e) => onChange(avecChamp(q, "entier", e.target.checked || undefined))}
            />
          </div>
        );
      }
      return (
        <div className="mp-grille-champs">
          <ChampNombre
            libelle="Minimum"
            name={`${idBase}-min`}
            valeur={q.min}
            aide="Facultatif."
            onChange={(v) => onChange(avecChamp(q, "min", v))}
          />
          <ChampNombre
            libelle="Maximum"
            name={`${idBase}-max`}
            valeur={q.max}
            aide="Facultatif."
            onChange={(v) => onChange(avecChamp(q, "max", v))}
          />
          <Champ
            libelle="Unité"
            name={`${idBase}-unite`}
            maxLength={30}
            value={q.unite ?? ""}
            aide="Facultative, ex. personnes, FCFA, %."
            onChange={(e) => onChange(avecChamp(q, "unite", texteFacultatif(e.target.value)))}
          />
          <CaseACocher
            libelle="Nombre entier exigé"
            checked={q.entier === true}
            onChange={(e) => onChange(avecChamp(q, "entier", e.target.checked || undefined))}
          />
        </div>
      );
    case "date":
      return (
        <div className="mp-grille-champs">
          <Champ
            libelle="Date au plus tôt"
            name={`${idBase}-min`}
            type="date"
            value={q.min ?? ""}
            aide="Facultative."
            onChange={(e) => onChange(avecChamp(q, "min", texteFacultatif(e.target.value)))}
          />
          <Champ
            libelle="Date au plus tard"
            name={`${idBase}-max`}
            type="date"
            value={q.max ?? ""}
            aide="Facultative."
            onChange={(e) => onChange(avecChamp(q, "max", texteFacultatif(e.target.value)))}
          />
        </div>
      );
    case "oui_non":
      return (
        <p className="mp-qe-resume">
          <Icone nom="info" taille={16} />
          <span>Réponses proposées : Oui, Non.</span>
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
  const points = Array.from(
    { length: POINTS_LIKERT_MAX - POINTS_LIKERT_MIN + 1 },
    (_, i) => POINTS_LIKERT_MIN + i,
  );
  return (
    <fieldset className="mp-groupe">
      <legend className="mp-champ__libelle">Échelle de réponse</legend>
      <div className="mp-ligne-action">
        <Select
          libelle="Nombre de niveaux"
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
            {`${e.libelle} (${e.niveaux.length} niveaux)`}
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
              libelle={`Libellé du niveau ${i + 1}`}
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
  const options = (o: OptionChoix[]) => onChange({ ...q, options: o });
  return (
    <fieldset className="mp-groupe">
      <legend className="mp-champ__libelle">{`Options (${q.options.length})`}</legend>
      <p className="mp-champ__aide">
        {`De ${OPTIONS_MIN} à ${OPTIONS_MAX} options. Le code est la valeur enregistrée : gardez-le stable après un envoi.`}
      </p>
      <ol className="mp-qe-elements">
        {q.options.map((o, i) => (
          <li key={i} className="mp-qe-element">
            <Champ
              libelle={`Code de l'option ${i + 1}`}
              name={`${idBase}-option-${i}-code`}
              required
              autoCapitalize="none"
              spellCheck={false}
              maxLength={80}
              value={o.code}
              erreur={
                o.code !== "" && !estIdentifiantValide(o.code)
                  ? "Minuscules sans accent, chiffres, « _ », « . » ou « - »."
                  : undefined
              }
              onChange={(e) => options(remplacer(q.options, i, { ...o, code: e.target.value }))}
            />
            <Champ
              libelle={`Libellé de l'option ${i + 1}`}
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
                aria-label={`Monter l'option ${i + 1}`}
                onClick={() => options(deplacer(q.options, i, -1))}
              >
                <span className="mp-visuellement-cache">Monter</span>
              </Bouton>
              <Bouton
                variante="discret"
                icone="flecheBas"
                disabled={i === q.options.length - 1}
                aria-label={`Descendre l'option ${i + 1}`}
                onClick={() => options(deplacer(q.options, i, 1))}
              >
                <span className="mp-visuellement-cache">Descendre</span>
              </Bouton>
              <Bouton
                variante="discret"
                icone="corbeille"
                disabled={q.options.length <= OPTIONS_MIN}
                aria-label={`Retirer l'option ${i + 1}`}
                onClick={() => options(retirer(q.options, i))}
              >
                <span className="mp-visuellement-cache">Retirer</span>
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
          Ajouter une option
        </Bouton>
      </div>
      {q.type === "choix_multiple" ? (
        <div className="mp-grille-champs">
          <ChampNombre
            libelle="Nombre minimal de réponses"
            name={`${idBase}-min-selections`}
            entier
            valeur={q.minSelections}
            aide="Facultatif : 1 par défaut."
            onChange={(v) => onChange(avecChamp(q, "minSelections", v))}
          />
          <ChampNombre
            libelle="Nombre maximal de réponses"
            name={`${idBase}-max-selections`}
            entier
            valeur={q.maxSelections}
            aide="Facultatif : toutes les options par défaut."
            onChange={(v) => onChange(avecChamp(q, "maxSelections", v))}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
