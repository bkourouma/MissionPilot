"use client";

import { useId, type ReactNode } from "react";
import type { QuestionQuestionnaire } from "@missionpilot/shared";
import { Bouton } from "../../ui/Bouton";
import { CadreChamp, Champ, idsDescription } from "../../ui/Champ";
import { Icone } from "../../ui/Icone";
import { ZoneTexte } from "../../ui/ZoneTexte";
import {
  aideChamp,
  compteurCaracteres,
  idBlocQuestion,
  LONGUEUR_LIGNE_MAX,
  longueurMax,
  type ValeurSaisie,
} from "../../../lib/portail-questionnaires-saisie";
import "./questionnaires.css";

type Question<T extends QuestionQuestionnaire["type"]> = Extract<
  QuestionQuestionnaire,
  { type: T }
>;

interface ProprietesChamp<Q extends QuestionQuestionnaire = QuestionQuestionnaire> {
  question: Q;
  valeur: ValeurSaisie | undefined;
  erreur?: string;
  onChange: (valeur: ValeurSaisie) => void;
  onBlur?: () => void;
}

export interface ChampQuestionProps extends ProprietesChamp {
  /** Réponse reprise de la saisie d'un collègue (mode collectif). */
  miseAJour?: boolean;
  /** Saisie d'un collègue en concurrence avec la vôtre (mode collectif). */
  conflit?: { leur: string; onGarder: () => void; onReprendre: () => void } | null;
}

/** Aide de la question (définition) et contraintes de saisie (bornes, nombre de choix). */
function aideDe(q: QuestionQuestionnaire, complement?: string): ReactNode {
  const aide = q.aide?.trim();
  // L'aide saisie par le cabinet devient une phrase, suivie des contraintes de saisie.
  const phrase = aide && !/[.!?…:]$/.test(aide) ? `${aide}.` : aide;
  const parties = [phrase, aideChamp(q), complement].filter(Boolean);
  return parties.length > 0 ? parties.join(" ") : undefined;
}

function MarqueObligatoire({ obligatoire }: { obligatoire: boolean }) {
  if (!obligatoire) return null;
  return (
    <span className="mp-champ__requis">
      {" "}
      <span aria-hidden="true">*</span>
      <span className="mp-visuellement-cache">(obligatoire)</span>
    </span>
  );
}

interface OptionRadio {
  cle: string;
  valeur: string | number | boolean;
  libelle: ReactNode;
}

/**
 * Groupe de boutons radio dans un fieldset : la légende porte la question, l'aide et l'erreur
 * sont liées au groupe (aria-describedby), placées avant les options.
 */
function GroupeRadio({
  question: q,
  valeur,
  erreur,
  onChange,
  options,
  disposition,
}: ProprietesChamp & { options: OptionRadio[]; disposition: "colonne" | "ligne" | "echelle" }) {
  const id = useId();
  const aide = aideDe(q);
  const { idAide, idErreur, describedBy } = idsDescription(id, Boolean(aide), Boolean(erreur));
  return (
    <fieldset className="mp-pq-groupe" aria-describedby={describedBy}>
      <legend className="mp-pq-question__libelle">
        {q.libelle}
        <MarqueObligatoire obligatoire={q.obligatoire} />
      </legend>
      {aide ? (
        <p className="mp-champ__aide" id={idAide}>
          {aide}
        </p>
      ) : null}
      {erreur ? (
        <p className="mp-champ__erreur" id={idErreur}>
          <Icone nom="attention" taille={16} />
          <span>{erreur}</span>
        </p>
      ) : null}
      <div className={`mp-pq-options mp-pq-options--${disposition}`}>
        {options.map((o) => {
          const idOption = `${id}-${o.cle}`;
          return (
            <div key={o.cle} className="mp-pq-option">
              <input
                type="radio"
                id={idOption}
                name={id}
                className="mp-pq-option__controle"
                checked={valeur === o.valeur}
                onChange={() => onChange(o.valeur)}
              />
              <label htmlFor={idOption} className="mp-pq-option__libelle">
                {o.libelle}
              </label>
            </div>
          );
        })}
      </div>
      {!q.obligatoire && valeur !== null && valeur !== undefined ? (
        <Bouton variante="discret" className="mp-pq-effacer" onClick={() => onChange(null)}>
          Effacer la réponse
          <span className="mp-visuellement-cache"> : {q.libelle}</span>
        </Bouton>
      ) : null}
    </fieldset>
  );
}

function ChampLikert(p: ProprietesChamp<Question<"likert">>) {
  const options = Array.from({ length: p.question.points }, (_, i) => ({
    cle: String(i + 1),
    valeur: i + 1,
    libelle: (
      <>
        <span className="mp-pq-niveau">{i + 1}</span>
        <span>{p.question.libelles[i] ?? `Niveau ${i + 1}`}</span>
      </>
    ),
  }));
  return <GroupeRadio {...p} options={options} disposition="echelle" />;
}

function ChampChoixUnique(p: ProprietesChamp<Question<"choix_unique">>) {
  const options = p.question.options.map((o) => ({
    cle: o.code,
    valeur: o.code,
    libelle: o.libelle,
  }));
  return <GroupeRadio {...p} options={options} disposition="colonne" />;
}

function ChampOuiNon(p: ProprietesChamp<Question<"oui_non">>) {
  const options = [
    { cle: "oui", valeur: true, libelle: "Oui" },
    { cle: "non", valeur: false, libelle: "Non" },
  ];
  return <GroupeRadio {...p} options={options} disposition="ligne" />;
}

/** Cases à cocher : la sélection garde l'ordre des options. */
function ChampChoixMultiple({
  question: q,
  valeur,
  erreur,
  onChange,
}: ProprietesChamp<Question<"choix_multiple">>) {
  const id = useId();
  const aide = aideDe(q);
  const { idAide, idErreur, describedBy } = idsDescription(id, Boolean(aide), Boolean(erreur));
  const selection = Array.isArray(valeur) ? valeur : [];
  const basculer = (code: string, coche: boolean) =>
    onChange(
      coche
        ? q.options.map((o) => o.code).filter((c) => c === code || selection.includes(c))
        : selection.filter((c) => c !== code),
    );
  return (
    <fieldset className="mp-pq-groupe" aria-describedby={describedBy}>
      <legend className="mp-pq-question__libelle">
        {q.libelle}
        <MarqueObligatoire obligatoire={q.obligatoire} />
      </legend>
      {aide ? (
        <p className="mp-champ__aide" id={idAide}>
          {aide}
        </p>
      ) : null}
      {erreur ? (
        <p className="mp-champ__erreur" id={idErreur}>
          <Icone nom="attention" taille={16} />
          <span>{erreur}</span>
        </p>
      ) : null}
      <div className="mp-pq-options mp-pq-options--colonne">
        {q.options.map((o) => {
          const idOption = `${id}-${o.code}`;
          return (
            <div key={o.code} className="mp-pq-option">
              <input
                type="checkbox"
                id={idOption}
                className="mp-pq-option__controle"
                checked={selection.includes(o.code)}
                onChange={(e) => basculer(o.code, e.target.checked)}
              />
              <label htmlFor={idOption} className="mp-pq-option__libelle">
                {o.libelle}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Nombre saisi à la française (virgule décimale), unité affichée à droite. */
function ChampNombre({
  question: q,
  valeur,
  erreur,
  onChange,
  onBlur,
}: ProprietesChamp<Question<"numerique">>) {
  const id = useId();
  const aide = aideDe(q);
  const { describedBy } = idsDescription(id, Boolean(aide), Boolean(erreur));
  return (
    <CadreChamp id={id} libelle={q.libelle} aide={aide} erreur={erreur} requis={q.obligatoire}>
      <div className="mp-pq-nombre">
        <input
          id={id}
          type="text"
          inputMode={q.entier ? "numeric" : "decimal"}
          autoComplete="off"
          className="mp-champ__controle"
          value={typeof valeur === "string" ? valeur : ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          required={q.obligatoire}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={describedBy}
        />
        {q.unite ? (
          <span className="mp-pq-nombre__unite" aria-hidden="true">
            {q.unite}
          </span>
        ) : null}
      </div>
    </CadreChamp>
  );
}

/** Texte : une ligne jusqu'à 200 caractères, zone multiligne au-delà ; compteur dans l'aide. */
function ChampTexte({
  question: q,
  valeur,
  erreur,
  onChange,
  onBlur,
}: ProprietesChamp<Question<"texte">>) {
  const max = longueurMax(q);
  const texte = typeof valeur === "string" ? valeur : "";
  const aide = aideDe(q, `${compteurCaracteres(texte, max)}.`);
  const communs = {
    libelle: q.libelle,
    aide,
    erreur,
    required: q.obligatoire,
    maxLength: max,
    value: texte,
    onBlur,
  };
  if (max <= LONGUEUR_LIGNE_MAX) {
    return (
      <Champ
        {...communs}
        type="text"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <ZoneTexte {...communs} rows={max > 1_000 ? 6 : 4} onChange={(e) => onChange(e.target.value)} />
  );
}

function ChampDate({
  question: q,
  valeur,
  erreur,
  onChange,
  onBlur,
}: ProprietesChamp<Question<"date">>) {
  return (
    <Champ
      type="date"
      libelle={q.libelle}
      aide={aideDe(q)}
      erreur={erreur}
      required={q.obligatoire}
      min={q.min}
      max={q.max}
      value={typeof valeur === "string" ? valeur : ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

function Controle(p: ProprietesChamp) {
  const q = p.question;
  switch (q.type) {
    case "likert":
      return <ChampLikert {...p} question={q} />;
    case "choix_unique":
      return <ChampChoixUnique {...p} question={q} />;
    case "choix_multiple":
      return <ChampChoixMultiple {...p} question={q} />;
    case "oui_non":
      return <ChampOuiNon {...p} question={q} />;
    case "numerique":
      return <ChampNombre {...p} question={q} />;
    case "texte":
      return <ChampTexte {...p} question={q} />;
    case "date":
      return <ChampDate {...p} question={q} />;
  }
}

/** Saisie d'un collègue en concurrence avec la vôtre : décision explicite. */
function Conflit({
  libelle,
  leur,
  onGarder,
  onReprendre,
}: {
  libelle: string;
  leur: string;
  onGarder: () => void;
  onReprendre: () => void;
}) {
  return (
    <div className="mp-pq-conflit" role="group" aria-label={`Réponse à choisir : ${libelle}`}>
      <p className="mp-pq-conflit__titre">
        <Icone nom="attention" taille={18} />
        <span>Un collègue a aussi modifié cette réponse</span>
      </p>
      <p>
        Sa réponse : <strong className="mp-pq-conflit__valeur">{leur}</strong>. La vôtre, affichée
        ci-dessus, n&apos;est pas encore enregistrée.
      </p>
      <div className="mp-barre-actions">
        <Bouton variante="secondaire" onClick={onGarder}>
          Garder ma réponse
        </Bouton>
        <Bouton variante="secondaire" onClick={onReprendre}>
          Reprendre sa réponse
        </Bouton>
      </div>
    </div>
  );
}

/** Une question du questionnaire : contrôle selon son type, mise à jour ou conflit éventuels. */
export function ChampQuestion({ miseAJour, conflit, ...p }: ChampQuestionProps) {
  return (
    <div
      id={idBlocQuestion(p.question.id)}
      className={p.erreur ? "mp-pq-question mp-pq-question--erreur" : "mp-pq-question"}
    >
      <Controle {...p} />
      {miseAJour ? (
        <p className="mp-pq-question__maj">
          <Icone nom="personnes" taille={16} />
          <span>Réponse mise à jour par un collègue</span>
        </p>
      ) : null}
      {conflit ? (
        <Conflit
          libelle={p.question.libelle}
          leur={conflit.leur}
          onGarder={conflit.onGarder}
          onReprendre={conflit.onReprendre}
        />
      ) : null}
    </div>
  );
}
