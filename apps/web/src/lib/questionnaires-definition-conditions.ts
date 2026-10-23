/** Sous-module de `questionnaires-definition.ts` : conditions d'affichage. */
import { type ValeurConditionAffichage } from "@missionpilot/shared";
import { formaterDate, formaterNombre } from "./format";
import { tronquer } from "./questionnaires-definition-utilitaires";
import {
  type Definition,
  type Question,
  type Condition,
  type OperateurCondition,
  type Comparaison,
  PROFONDEUR_MAX_CONDITION,
  ESPACE_INSECABLE,
} from "./questionnaires-definition-socle";

// --- Conditions d'affichage ---------------------------------------------------------------------

export interface QuestionIndexee {
  question: Question;
  section: number;
  rang: number;
  /** Repère court : « S1 · Q2 ». */
  repere: string;
}

export function indexQuestions(def: Definition): Map<string, QuestionIndexee> {
  const index = new Map<string, QuestionIndexee>();
  def.sections.forEach((s, si) =>
    s.questions.forEach((q, qi) => {
      if (!index.has(q.id)) {
        index.set(q.id, { question: q, section: si, rang: qi, repere: `S${si + 1} · Q${qi + 1}` });
      }
    }),
  );
  return index;
}

/**
 * Questions qu'une condition peut citer : toutes sauf la question elle-même (condition de
 * question) ou sauf celles de la section (condition de section, qui sinon dépendrait
 * d'elle-même).
 */
export function questionsReferencables(
  def: Definition,
  cible: { section: number; question?: number },
): QuestionIndexee[] {
  return [...indexQuestions(def).values()].filter((x) =>
    cible.question === undefined
      ? x.section !== cible.section
      : !(x.section === cible.section && x.rang === cible.question),
  );
}

export const OPERATEURS_COMPARAISON = [
  "egal",
  "different",
  "dans",
  "superieur",
  "inferieur",
  "vide",
] as const;
export const OPERATEURS_COMBINAISON = ["et", "ou", "non"] as const;

export const estComparaison = (c: Condition): c is Comparaison =>
  c.op !== "et" && c.op !== "ou" && c.op !== "non";

/** Opérateurs de comparaison admis par le moteur selon le type de la question citée. */
export function operateursPour(q: Question | undefined): OperateurCondition[] {
  if (!q) return ["egal", "different", "vide"];
  const ops: OperateurCondition[] = ["egal", "different"];
  if (q.type === "likert" || q.type === "choix_unique" || q.type === "choix_multiple")
    ops.push("dans");
  if (q.type === "likert" || q.type === "numerique" || q.type === "date")
    ops.push("superieur", "inferieur");
  ops.push("vide");
  return ops;
}

const LIBELLES_OPERATEUR: Record<OperateurCondition, string> = {
  egal: "est égale à",
  different: "est différente de",
  dans: "est l'une des valeurs",
  superieur: "est supérieure à",
  inferieur: "est inférieure à",
  vide: "est sans réponse",
  et: "Toutes les conditions suivantes (et)",
  ou: "Au moins une des conditions suivantes (ou)",
  non: "La condition suivante est fausse (non)",
};

/** Libellé d'un opérateur ; sur un choix multiple, « égal » signifie « contient » (moteur). */
export function libelleOperateur(op: OperateurCondition, q?: Question): string {
  if (q?.type === "choix_multiple") {
    if (op === "egal") return "contient";
    if (op === "different") return "ne contient pas";
    if (op === "dans") return "contient l'une des valeurs";
  }
  if (q?.type === "date") {
    if (op === "superieur") return "est postérieure au";
    if (op === "inferieur") return "est antérieure au";
  }
  return LIBELLES_OPERATEUR[op];
}

/** Valeur de départ d'une comparaison sur `q` (à ajuster par l'utilisateur). */
export function valeurParDefaut(q: Question | undefined): ValeurConditionAffichage {
  switch (q?.type) {
    case "likert":
      return 1;
    case "choix_unique":
    case "choix_multiple":
      return q.options[0]?.code ?? "";
    case "oui_non":
      return true;
    case "numerique":
      return q.min ?? 0;
    case "date":
      return q.min ?? q.max ?? "";
    default:
      return "";
  }
}

/** Comparaison de départ : « la réponse à `q` est égale à … ». */
export function conditionParDefaut(q: Question): Comparaison {
  return { op: "egal", question: q.id, valeur: valeurParDefaut(q) };
}

/** Première comparaison d'une condition (parcours en profondeur), s'il y en a une. */
export function premiereComparaison(c: Condition): Comparaison | null {
  if (estComparaison(c)) return c;
  if (c.op === "non") return premiereComparaison(c.condition);
  for (const s of c.conditions) {
    const p = premiereComparaison(s);
    if (p) return p;
  }
  return null;
}

/** Valeur ordonnable (nombre ou date) pour `superieur` / `inferieur`. */
function valeurOrdonnee(q: Question | undefined, v: ValeurConditionAffichage): number | string {
  if (typeof v === "number") return v;
  if (typeof v === "string" && q?.type === "date") return v;
  const d = valeurParDefaut(q);
  return typeof d === "boolean" ? 0 : d;
}

/**
 * Change l'opérateur d'une condition en gardant ce qui peut l'être : une combinaison (et, ou)
 * reprend la condition courante comme premier élément, « non » l'enveloppe, une comparaison
 * reprend la question et la valeur de la première comparaison trouvée.
 */
export function changerOperateur(
  c: Condition,
  op: OperateurCondition,
  questions: ReadonlyMap<string, Question>,
  parDefaut: Question,
): Condition {
  if (op === c.op) return c;
  if (op === "et" || op === "ou") {
    if (c.op === "et" || c.op === "ou") return { op, conditions: c.conditions };
    if (c.op === "non") return { op, conditions: [c.condition] };
    return { op, conditions: [c] };
  }
  if (op === "non") return { op, condition: c };
  const base = premiereComparaison(c) ?? conditionParDefaut(parDefaut);
  const q = questions.get(base.question);
  const valeur =
    "valeur" in base
      ? base.valeur
      : "valeurs" in base
        ? (base.valeurs[0] ?? valeurParDefaut(q))
        : valeurParDefaut(q);
  switch (op) {
    case "vide":
      return { op, question: base.question };
    case "dans":
      return { op, question: base.question, valeurs: [valeur] };
    case "superieur":
    case "inferieur":
      return { op, question: base.question, valeur: valeurOrdonnee(q, valeur) };
    default:
      return { op, question: base.question, valeur };
  }
}

/** Change la question citée par une comparaison : valeur remise à une valeur compatible. */
export function changerQuestionCible(c: Comparaison, q: Question): Comparaison {
  const op = operateursPour(q).includes(c.op) ? c.op : "egal";
  const valeur = valeurParDefaut(q);
  switch (op) {
    case "vide":
      return { op, question: q.id };
    case "dans":
      return { op, question: q.id, valeurs: [valeur] };
    case "superieur":
    case "inferieur":
      return { op, question: q.id, valeur: valeurOrdonnee(q, valeur) };
    default:
      return { op: op as "egal" | "different", question: q.id, valeur };
  }
}

/** Profondeur : une comparaison vaut 1, chaque combinaison ajoute 1 (règle du moteur). */
export function profondeurCondition(c: Condition, plafond = PROFONDEUR_MAX_CONDITION + 1): number {
  const enfants =
    c.op === "et" || c.op === "ou" ? c.conditions : c.op === "non" ? [c.condition] : [];
  if (enfants.length === 0 || plafond <= 1) return 1;
  return 1 + Math.max(...enfants.map((e) => profondeurCondition(e, plafond - 1)));
}

/**
 * Une combinaison peut-elle être posée au niveau `niveau` (1 = racine) ? Ses éléments seront
 * au niveau suivant, qui ne doit pas dépasser la profondeur maximale.
 */
export const combinaisonPossible = (niveau: number) => niveau < PROFONDEUR_MAX_CONDITION;

/** Valeur citée dans une condition, en clair (« Plutôt d'accord (4) », « Oui »…). */
export function decrireValeur(q: Question | undefined, v: ValeurConditionAffichage): string {
  if (q?.type === "likert" && typeof v === "number") {
    const l = q.libelles[v - 1];
    return l ? `${l} (${v})` : String(v);
  }
  if ((q?.type === "choix_unique" || q?.type === "choix_multiple") && typeof v === "string") {
    return q.options.find((o) => o.code === v)?.libelle ?? v;
  }
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (q?.type === "date" && typeof v === "string")
    return v === "" ? "(date à choisir)" : formaterDate(v);
  if (typeof v === "number")
    return `${formaterNombre(v, 4)}${q?.type === "numerique" && q.unite ? `${ESPACE_INSECABLE}${q.unite}` : ""}`;
  return v === "" ? "(valeur à saisir)" : v;
}

/** Condition en clair : « « Effectif » est supérieure à 50 et « Secteur » est l'une des… ». */
export function decrireCondition(c: Condition, questions: ReadonlyMap<string, Question>): string {
  switch (c.op) {
    case "et":
    case "ou": {
      const parties = c.conditions.map((s) => {
        const t = decrireCondition(s, questions);
        return estComparaison(s) ? t : `(${t})`;
      });
      return parties.join(c.op === "et" ? " et " : " ou ");
    }
    case "non":
      return `non (${decrireCondition(c.condition, questions)})`;
    default: {
      const q = questions.get(c.question);
      const nom = q
        ? `« ${tronquer(q.libelle.trim() || q.id)} »`
        : `« ${c.question} » (question inconnue)`;
      const op = libelleOperateur(c.op, q);
      if (c.op === "vide") return `${nom} ${op}`;
      if (c.op === "dans")
        return `${nom} ${op} : ${c.valeurs.map((v) => decrireValeur(q, v)).join(", ")}`;
      return `${nom} ${op} ${decrireValeur(q, c.valeur)}`;
    }
  }
}

/** Questions de la définition par identifiant (pour décrire les conditions). */
export function questionsParId(def: Definition): Map<string, Question> {
  return new Map([...indexQuestions(def)].map(([id, x]) => [id, x.question]));
}
