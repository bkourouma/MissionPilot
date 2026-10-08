import { formaterDate, formaterNombre } from "../../lib/format";
import {
  decrireCondition,
  ESPACE_INSECABLE,
  LONGUEUR_TEXTE_DEFAUT,
  questionsParId,
  type Definition,
  type Question,
} from "../../lib/questionnaires-definition";
import { Icone } from "../ui/Icone";
import "./questionnaires.css";

export interface ApercuQuestionnaireProps {
  definition: Definition;
  /** Préfixe des identifiants du DOM (plusieurs aperçus dans une même page). */
  prefixe?: string;
  /** Niveau des titres de section (2 par défaut). */
  niveauTitre?: 2 | 3;
}

/** Note décrivant une condition d'affichage (texte + icône, jamais la couleur seule). */
function NoteCondition({ id, texte }: { id?: string; texte: string }) {
  return (
    <p className="mp-qe-resume" id={id}>
      <Icone nom="info" taille={16} />
      <span>{texte}</span>
    </p>
  );
}

function bornes(min: string | undefined, max: string | undefined, unite = ""): string | null {
  if (min !== undefined && max !== undefined) return `Entre ${min}${unite} et ${max}${unite}.`;
  if (min !== undefined) return `Au moins ${min}${unite}.`;
  if (max !== undefined) return `Au plus ${max}${unite}.`;
  return null;
}

function aideQuestion(q: Question): string | null {
  switch (q.type) {
    case "choix_multiple": {
      const { minSelections: min, maxSelections: max } = q;
      const s = (n: number) => (n > 1 ? "s" : "");
      const plage =
        min !== undefined && max !== undefined
          ? ` De ${min} à ${max} réponses.`
          : min !== undefined
            ? ` Au moins ${min} réponse${s(min)}.`
            : max !== undefined
              ? ` Au plus ${max} réponse${s(max)}.`
              : "";
      return `Plusieurs réponses possibles.${plage}`;
    }
    case "numerique": {
      const u = q.unite ? `${ESPACE_INSECABLE}${q.unite}` : "";
      const b = bornes(
        q.min === undefined ? undefined : formaterNombre(q.min, 4),
        q.max === undefined ? undefined : formaterNombre(q.max, 4),
        u,
      );
      return [q.entier ? "Nombre entier." : null, b].filter(Boolean).join(" ") || null;
    }
    case "date":
      return bornes(
        q.min === undefined ? undefined : formaterDate(q.min),
        q.max === undefined ? undefined : formaterDate(q.max),
      );
    case "texte":
      return `${formaterNombre(q.longueurMax ?? LONGUEUR_TEXTE_DEFAUT)} caractères au plus.`;
    default:
      return null;
  }
}

function TitreQuestion({ q, numero }: { q: Question; numero: number }) {
  return (
    <>
      {`${numero}. ${q.libelle.trim() || "(question sans libellé)"}`}
      {q.obligatoire ? (
        <span className="mp-champ__requis">
          {" "}
          <span aria-hidden="true">*</span>
          <span className="mp-visuellement-cache">(obligatoire)</span>
        </span>
      ) : (
        <span className="mp-texte-doux mp-texte-petit"> (facultative)</span>
      )}
    </>
  );
}

const CHOIX = new Set<Question["type"]>(["likert", "choix_unique", "choix_multiple", "oui_non"]);

function ChoixQuestion({ q, nom }: { q: Question; nom: string }) {
  const options =
    q.type === "likert"
      ? q.libelles.map((l, i) => ({ v: String(i + 1), l: `${i + 1} — ${l}` }))
      : q.type === "choix_unique" || q.type === "choix_multiple"
        ? q.options.map((o) => ({ v: o.code, l: o.libelle }))
        : [
            { v: "oui", l: "Oui" },
            { v: "non", l: "Non" },
          ];
  const type = q.type === "choix_multiple" ? "checkbox" : "radio";
  return (
    <div className={`mp-apercu__choix${q.type === "likert" ? " mp-apercu__choix--echelle" : ""}`}>
      {options.map((o) => (
        <label key={o.v} className="mp-apercu__option">
          <input type={type} name={nom} value={o.v} disabled />
          <span>{o.l}</span>
        </label>
      ))}
    </div>
  );
}

function ChampQuestion({ q, id, decrit }: { q: Question; id: string; decrit?: string }) {
  if (q.type === "texte") {
    return (
      <textarea
        id={id}
        className="mp-champ__controle mp-zone-texte"
        rows={3}
        disabled
        aria-describedby={decrit}
      />
    );
  }
  const champ = (
    <input
      id={id}
      className="mp-champ__controle"
      type={q.type === "date" ? "date" : "text"}
      inputMode={q.type === "numerique" ? "decimal" : undefined}
      disabled
      aria-describedby={decrit}
    />
  );
  if (q.type === "numerique" && q.unite) {
    return (
      <span className="mp-apercu__unite">
        {champ}
        <span>{q.unite}</span>
      </span>
    );
  }
  return champ;
}

function ApercuQuestion({
  q,
  numero,
  id,
  questions,
}: {
  q: Question;
  numero: number;
  id: string;
  questions: ReadonlyMap<string, Question>;
}) {
  const aide = [q.aide?.trim(), aideQuestion(q)].filter(Boolean).join(" ");
  const idAide = aide ? `${id}-aide` : undefined;
  const idCondition = q.condition ? `${id}-condition` : undefined;
  const decrit = [idAide, idCondition].filter(Boolean).join(" ") || undefined;
  const notes = (
    <>
      {aide ? (
        <p className="mp-champ__aide" id={idAide}>
          {aide}
        </p>
      ) : null}
      {q.condition ? (
        <NoteCondition
          id={idCondition}
          texte={`Affichée seulement si ${decrireCondition(q.condition, questions)}.`}
        />
      ) : null}
    </>
  );
  if (CHOIX.has(q.type)) {
    return (
      <fieldset className="mp-apercu__question" disabled aria-describedby={decrit}>
        <legend className="mp-apercu__libelle">
          <TitreQuestion q={q} numero={numero} />
        </legend>
        {notes}
        <ChoixQuestion q={q} nom={`${id}-reponse`} />
      </fieldset>
    );
  }
  return (
    <div className="mp-apercu__question">
      <label className="mp-apercu__libelle" htmlFor={`${id}-champ`}>
        <TitreQuestion q={q} numero={numero} />
      </label>
      {notes}
      <ChampQuestion q={q} id={`${id}-champ`} decrit={decrit} />
    </div>
  );
}

/**
 * Aperçu d'un questionnaire tel que le verront les répondants : champs inactifs, conditions
 * d'affichage décrites en clair (elles ne sont pas évaluées ici : c'est le rôle du moteur).
 */
export function ApercuQuestionnaire({
  definition,
  prefixe = "apercu",
  niveauTitre = 2,
}: ApercuQuestionnaireProps) {
  const questions = questionsParId(definition);
  const Titre = `h${niveauTitre}` as const;
  // Numérotation continue des questions d'une section à l'autre.
  const debuts: number[] = [];
  let suivant = 1;
  for (const s of definition.sections) {
    debuts.push(suivant);
    suivant += s.questions.length;
  }
  return (
    <div className="mp-apercu">
      <p className="mp-texte-doux mp-texte-petit">
        {`Aperçu de « ${definition.titre.trim() || "questionnaire sans titre"} » : les champs sont inactifs, les conditions d'affichage sont décrites sous chaque élément concerné.`}
      </p>
      {definition.sections.map((s, si) => (
        <section
          key={`${s.id}-${si}`}
          className="mp-apercu__section"
          aria-labelledby={`${prefixe}-s${si}`}
        >
          <Titre id={`${prefixe}-s${si}`} className="mp-qe-entete__titre">
            {`${si + 1}. ${s.titre.trim() || "(section sans titre)"}`}
          </Titre>
          {s.description ? <p className="mp-texte-preserve">{s.description}</p> : null}
          {s.condition ? (
            <NoteCondition
              texte={`Section affichée seulement si ${decrireCondition(s.condition, questions)}.`}
            />
          ) : null}
          <ol className="mp-apercu__questions">
            {s.questions.map((q, qi) => (
              <li key={`${q.id}-${qi}`}>
                <ApercuQuestion
                  q={q}
                  numero={(debuts[si] ?? 1) + qi}
                  id={`${prefixe}-s${si}-q${qi}`}
                  questions={questions}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
