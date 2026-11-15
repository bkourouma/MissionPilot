"use client";

import type { Langue, ValeurConditionAffichage } from "@missionpilot/shared";
import {
  changerOperateur,
  changerQuestionCible,
  combinaisonPossible,
  conditionParDefaut,
  decrireCondition,
  estComparaison,
  libelleOperateur,
  operateursPour,
  premiereComparaison,
  PROFONDEUR_MAX_CONDITION,
  remplacer,
  retirer,
  type Comparaison,
  type Condition,
  type Question,
  type QuestionIndexee,
} from "../../lib/questionnaires-definition";
import { useT, useLangue } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Select } from "../ui/Select";
import { ChampNombre } from "./ChampNombre";

/** Nombre maximal d'éléments d'une combinaison (schéma partagé). */
const ELEMENTS_MAX = 20;

type Forme = "comparaison" | "et" | "ou" | "non";

const FORMES: { valeur: Forme; libelle: string; en: string }[] = [
  {
    valeur: "comparaison",
    libelle: "Comparer la réponse à une question",
    en: "Compare the response to a question",
  },
  {
    valeur: "et",
    libelle: "Toutes les conditions suivantes (et)",
    en: "All of the following conditions (and)",
  },
  {
    valeur: "ou",
    libelle: "Au moins une des conditions suivantes (ou)",
    en: "At least one of the following conditions (or)",
  },
  {
    valeur: "non",
    libelle: "La condition suivante est fausse (non)",
    en: "The following condition is false (not)",
  },
];

export interface EditeurConditionProps {
  condition: Condition;
  onChange: (c: Condition) => void;
  /** Questions que la condition peut citer. */
  candidates: readonly QuestionIndexee[];
  /** Toutes les questions par identifiant (pour une question citée hors des candidates). */
  questions: ReadonlyMap<string, Question>;
  /** Niveau d'imbrication, 1 = racine. */
  niveau?: number;
  idBase: string;
  legende: string;
  /** Retirer cet élément de la combinaison parente. */
  onRetirer?: () => void;
}

/**
 * Éditeur d'une condition d'affichage : comparaison (question citée, opérateur admis par le
 * type de la question, valeur compatible) ou combinaison « et », « ou », « non », imbriquée
 * sur 5 niveaux au plus (règle du moteur). Un résumé en clair suit chaque modification.
 */
export function EditeurCondition({
  condition,
  onChange,
  candidates,
  questions,
  niveau = 1,
  idBase,
  legende,
  onRetirer,
}: EditeurConditionProps) {
  const t = useT();
  const langue = useLangue();
  const parDefaut = candidates[0]?.question;
  const forme: Forme = estComparaison(condition) ? "comparaison" : condition.op;
  const combinaisonOk = combinaisonPossible(niveau);

  function changerForme(f: Forme) {
    if (!parDefaut) return;
    if (f === "comparaison") {
      const op = premiereComparaison(condition)?.op ?? "egal";
      onChange(changerOperateur(condition, op, questions, parDefaut));
    } else {
      onChange(changerOperateur(condition, f, questions, parDefaut));
    }
  }

  return (
    <fieldset className="mp-qe-condition">
      <legend>{legende}</legend>
      <div className="mp-grille-champs">
        <Select
          libelle={t("Forme de la condition", "Condition type")}
          name={`${idBase}-forme`}
          value={forme}
          options={FORMES.map((f) => ({
            valeur: f.valeur,
            libelle: langue === "en" ? f.en : f.libelle,
            desactivee: f.valeur !== "comparaison" && f.valeur !== forme && !combinaisonOk,
          }))}
          onChange={(e) => changerForme(e.target.value as Forme)}
          aide={
            combinaisonOk
              ? undefined
              : t(
                  `Profondeur maximale atteinte (${PROFONDEUR_MAX_CONDITION} niveaux) : seules des comparaisons sont possibles ici.`,
                  `Maximum depth reached (${PROFONDEUR_MAX_CONDITION} levels): only comparisons are possible here.`,
                )
          }
        />
      </div>
      {estComparaison(condition) ? (
        <EditeurComparaison
          c={condition}
          onChange={onChange}
          candidates={candidates}
          questions={questions}
          idBase={idBase}
        />
      ) : condition.op === "non" ? (
        <EditeurCondition
          condition={condition.condition}
          onChange={(c) => onChange({ op: "non", condition: c })}
          candidates={candidates}
          questions={questions}
          niveau={niveau + 1}
          idBase={`${idBase}-n`}
          legende={t("Condition inversée", "Inverted condition")}
        />
      ) : (
        <ElementsCombinaison
          c={condition}
          onChange={onChange}
          candidates={candidates}
          questions={questions}
          niveau={niveau}
          idBase={idBase}
        />
      )}
      {niveau === 1 ? (
        <p className="mp-qe-resume">
          <Icone nom="info" taille={16} />
          <span>
            {t(
              `Résumé : affichée si ${decrireCondition(condition, questions)}.`,
              `Summary: displayed if ${decrireCondition(condition, questions, langue)}.`,
            )}
          </span>
        </p>
      ) : null}
      {onRetirer ? (
        <div>
          <Bouton variante="discret" icone="corbeille" onClick={onRetirer}>
            {t(`Retirer : ${legende.toLowerCase()}`, `Remove: ${legende.toLowerCase()}`)}
          </Bouton>
        </div>
      ) : null}
    </fieldset>
  );
}

function ElementsCombinaison({
  c,
  onChange,
  candidates,
  questions,
  niveau,
  idBase,
}: {
  c: Extract<Condition, { op: "et" | "ou" }>;
  onChange: (c: Condition) => void;
  candidates: readonly QuestionIndexee[];
  questions: ReadonlyMap<string, Question>;
  niveau: number;
  idBase: string;
}) {
  const t = useT();
  const parDefaut = candidates[0]?.question;
  return (
    <>
      <ol className="mp-qe-condition__enfants">
        {c.conditions.map((s, i) => (
          <li key={i}>
            <EditeurCondition
              condition={s}
              onChange={(n) => onChange({ op: c.op, conditions: remplacer(c.conditions, i, n) })}
              onRetirer={
                c.conditions.length > 1
                  ? () => onChange({ op: c.op, conditions: retirer(c.conditions, i) })
                  : undefined
              }
              candidates={candidates}
              questions={questions}
              niveau={niveau + 1}
              idBase={`${idBase}-${i}`}
              legende={t(`Condition ${i + 1}`, `Condition ${i + 1}`)}
            />
          </li>
        ))}
      </ol>
      {parDefaut ? (
        <div>
          <Bouton
            variante="secondaire"
            icone="plus"
            disabled={c.conditions.length >= ELEMENTS_MAX}
            onClick={() =>
              onChange({ op: c.op, conditions: [...c.conditions, conditionParDefaut(parDefaut)] })
            }
          >
            {t("Ajouter une condition", "Add a condition")}
          </Bouton>
        </div>
      ) : null}
    </>
  );
}

const tronquer = (t: string, max = 70) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

function EditeurComparaison({
  c,
  onChange,
  candidates,
  questions,
  idBase,
}: {
  c: Comparaison;
  onChange: (c: Condition) => void;
  candidates: readonly QuestionIndexee[];
  questions: ReadonlyMap<string, Question>;
  idBase: string;
}) {
  const t = useT();
  const langue = useLangue();
  const q = questions.get(c.question);
  const connue = candidates.some((x) => x.question.id === c.question);
  const optionsQuestions = [
    ...candidates.map((x) => ({
      valeur: x.question.id,
      libelle: `${x.repere} — ${tronquer(x.question.libelle.trim() || x.question.id)}`,
    })),
    ...(connue
      ? []
      : [
          {
            valeur: c.question,
            libelle: t(
              `Question introuvable : « ${c.question} »`,
              `Question not found: "${c.question}"`,
            ),
            desactivee: true,
          },
        ]),
  ];
  const ops = operateursPour(q);
  return (
    <div className="mp-grille-champs">
      <Select
        libelle={t("Question citée", "Referenced question")}
        name={`${idBase}-question`}
        value={c.question}
        options={optionsQuestions}
        erreur={
          connue
            ? undefined
            : t(
                "Cette question n'existe plus : choisissez-en une autre.",
                "This question no longer exists: choose another one.",
              )
        }
        onChange={(e) => {
          const cible = questions.get(e.target.value);
          if (cible) onChange(changerQuestionCible(c, cible));
        }}
      />
      <Select
        libelle={t("Opérateur", "Operator")}
        name={`${idBase}-operateur`}
        value={c.op}
        options={ops.map((op) => ({ valeur: op, libelle: libelleOperateur(op, q, langue) }))}
        onChange={(e) => {
          if (q) onChange(changerOperateur(c, e.target.value as Comparaison["op"], questions, q));
        }}
      />
      {c.op === "vide" ? null : c.op === "dans" ? (
        <ValeursMultiples c={c} q={q} onChange={onChange} idBase={idBase} />
      ) : (
        <ValeurSimple
          q={q}
          valeur={c.valeur}
          idBase={idBase}
          onChange={(valeur) => onChange({ ...c, valeur } as Comparaison)}
        />
      )}
    </div>
  );
}

/** Valeurs proposées pour une question à choix ou à échelle. */
function valeursProposees(
  q: Question | undefined,
  langue: Langue = "fr",
): { valeur: string; libelle: string }[] {
  if (q?.type === "likert") {
    return q.libelles.map((l, i) => ({
      valeur: String(i + 1),
      libelle: `${i + 1} — ${l || (langue === "en" ? "(no label)" : "(sans libellé)")}`,
    }));
  }
  if (q?.type === "choix_unique" || q?.type === "choix_multiple") {
    return q.options.map((o) => ({ valeur: o.code, libelle: o.libelle || o.code }));
  }
  return [];
}

function ValeursMultiples({
  c,
  q,
  onChange,
  idBase,
}: {
  c: Extract<Condition, { op: "dans" }>;
  q: Question | undefined;
  onChange: (c: Condition) => void;
  idBase: string;
}) {
  const t = useT();
  const langue = useLangue();
  const proposees = valeursProposees(q, langue);
  const choisies = c.valeurs.map(String);
  const versValeur = (v: string): ValeurConditionAffichage =>
    q?.type === "likert" ? Number(v) : v;
  return (
    <fieldset className="mp-groupe" aria-invalid={choisies.length === 0 || undefined}>
      <legend className="mp-champ__libelle">{t("Valeurs acceptées", "Accepted values")}</legend>
      <div className="mp-groupe__options">
        {proposees.map((o) => (
          <CaseACocher
            key={o.valeur}
            name={`${idBase}-valeurs`}
            libelle={o.libelle}
            checked={choisies.includes(o.valeur)}
            onChange={(e) => {
              const suivantes = e.target.checked
                ? [...choisies, o.valeur]
                : choisies.filter((x) => x !== o.valeur);
              // L'ordre de la question est conservé ; au moins une valeur (sinon refus du moteur).
              const ordonnees = proposees.map((p) => p.valeur).filter((v) => suivantes.includes(v));
              onChange({ ...c, valeurs: ordonnees.map(versValeur) });
            }}
          />
        ))}
      </div>
      {choisies.length === 0 ? (
        <p className="mp-champ__erreur">
          <Icone nom="attention" taille={16} />
          <span>{t("Cochez au moins une valeur.", "Select at least one value.")}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

function ValeurSimple({
  q,
  valeur,
  onChange,
  idBase,
}: {
  q: Question | undefined;
  valeur: ValeurConditionAffichage;
  onChange: (v: ValeurConditionAffichage) => void;
  idBase: string;
}) {
  const t = useT();
  const langue = useLangue();
  const nom = `${idBase}-valeur`;
  switch (q?.type) {
    case "likert":
    case "choix_unique":
    case "choix_multiple":
      return (
        <Select
          libelle={t("Valeur", "Value")}
          name={nom}
          value={String(valeur)}
          options={valeursProposees(q, langue)}
          onChange={(e) => onChange(q.type === "likert" ? Number(e.target.value) : e.target.value)}
        />
      );
    case "oui_non":
      return (
        <Select
          libelle={t("Valeur", "Value")}
          name={nom}
          value={valeur === false ? "non" : "oui"}
          options={[
            { valeur: "oui", libelle: t("Oui", "Yes") },
            { valeur: "non", libelle: t("Non", "No") },
          ]}
          onChange={(e) => onChange(e.target.value === "oui")}
        />
      );
    case "numerique":
      return (
        <ChampNombre
          libelle={q.unite ? t(`Valeur (${q.unite})`, `Value (${q.unite})`) : t("Valeur", "Value")}
          name={nom}
          valeur={typeof valeur === "number" ? valeur : undefined}
          entier={q.entier}
          requis
          onChange={(v) => {
            if (v !== undefined) onChange(v);
          }}
        />
      );
    case "date":
      return (
        <Champ
          libelle={t("Date", "Date")}
          name={nom}
          type="date"
          required
          value={typeof valeur === "string" ? valeur : ""}
          erreur={valeur === "" ? t("Choisissez une date.", "Choose a date.") : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Champ
          libelle={t("Valeur (texte exact)", "Value (exact text)")}
          name={nom}
          maxLength={200}
          value={String(valeur)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
