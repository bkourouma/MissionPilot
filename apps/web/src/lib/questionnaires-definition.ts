/**
 * Définitions de questionnaires (SOC-10) côté web : édition immuable (sections, questions,
 * options, conditions d'affichage), contrôle de FORME local par le schéma partagé
 * (`definitionQuestionnaireSchema`), localisation lisible des anomalies et mise en forme des
 * réponses. Logique pure, testée dans `questionnaires-definition.test.ts`.
 *
 * La COHÉRENCE d'une définition (références des conditions, cycles, profondeur, échelles,
 * doublons) est jugée par le moteur `validerDefinition` de `@missionpilot/engines`, que l'API
 * applique à chaque enregistrement et à la validation d'une version : le web n'importe pas les
 * moteurs (CODING_STANDARDS §1), il affiche les anomalies rendues par l'API (code, chemin,
 * message). Les garde-fous locaux (profondeur des conditions, opérateurs selon le type de la
 * question citée) évitent seulement de construire une définition que l'API refuserait.
 */
import {
  definitionQuestionnaireSchema,
  ECHELLE_ACCORD,
  ECHELLE_MATURITE,
  identifiantGrilleSchema,
  type ConditionAffichage,
  type DefinitionQuestionnaireDonnees,
  type QuestionQuestionnaire,
  type SectionQuestionnaire,
  type ValeurConditionAffichage,
} from "@missionpilot/shared";
import { formaterDate, formaterNombre } from "./format";

export type Definition = DefinitionQuestionnaireDonnees;
export type Section = SectionQuestionnaire;
export type Question = QuestionQuestionnaire;
export type Condition = ConditionAffichage;
export type TypeQuestion = Question["type"];
export type OperateurCondition = Condition["op"];
export type OptionChoix = Extract<Question, { type: "choix_unique" }>["options"][number];
/** Condition élémentaire : comparaison de la réponse à une question. */
export type Comparaison = Exclude<Condition, { op: "et" | "ou" | "non" }>;

/** Anomalie localisée : même forme que celles du moteur (`code`, `chemin`, `message`). */
export interface Anomalie {
  code: string;
  chemin: string;
  message: string;
}

/** Bornes du schéma et du moteur (`packages/engines/src/questionnaires/types.ts`). */
export const PROFONDEUR_MAX_CONDITION = 5;
export const POINTS_LIKERT_MIN = 2;
export const POINTS_LIKERT_MAX = 10;
export const LONGUEUR_TEXTE_DEFAUT = 2_000;
export const LONGUEUR_TEXTE_PLAFOND = 20_000;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 50;

/** Espace insécable (U+00A0) entre une valeur et son unité, comme `lib/format.ts`. */
export const ESPACE_INSECABLE = String.fromCharCode(0xa0);

// --- Types de questions -----------------------------------------------------------------------

/** Types définis par le schéma, plus « pourcentage » (nombre de 0 à 100 %, unité « % »). */
export const MODELES_QUESTION = [
  "likert",
  "choix_unique",
  "choix_multiple",
  "oui_non",
  "pourcentage",
  "numerique",
  "texte",
  "date",
] as const;
export type ModeleQuestion = (typeof MODELES_QUESTION)[number];

export const MODELE_QUESTION: Record<ModeleQuestion, { libelle: string; aide: string }> = {
  likert: {
    libelle: "Échelle (Likert)",
    aide: "De 2 à 10 niveaux libellés, ex. de « Pas du tout d'accord » à « Tout à fait d'accord ».",
  },
  choix_unique: { libelle: "Choix unique", aide: "Une seule réponse parmi les options proposées." },
  choix_multiple: {
    libelle: "Choix multiple",
    aide: "Plusieurs réponses possibles, avec un minimum et un maximum.",
  },
  oui_non: { libelle: "Oui / non", aide: "Réponse binaire." },
  pourcentage: { libelle: "Pourcentage", aide: "Nombre de 0 à 100 %." },
  numerique: { libelle: "Nombre", aide: "Valeur numérique, avec bornes et unité facultatives." },
  texte: { libelle: "Texte libre", aide: "Réponse rédigée, longueur maximale réglable." },
  date: { libelle: "Date", aide: "Date, avec bornes facultatives." },
};

export const estModeleQuestion = (v: string): v is ModeleQuestion =>
  (MODELES_QUESTION as readonly string[]).includes(v);

/** « pourcentage » est une question numérique de 0 à 100 d'unité « % ». */
export function modeleDeQuestion(q: Question): ModeleQuestion {
  if (q.type === "numerique" && q.unite === "%" && q.min === 0 && q.max === 100) {
    return "pourcentage";
  }
  return q.type;
}

/** Échelles de départ proposées pour une question de Likert (5 niveaux). */
export const ECHELLES_TYPES = [
  { id: "accord", libelle: "Échelle d'accord", niveaux: ECHELLE_ACCORD },
  { id: "maturite", libelle: "Échelle de maturité", niveaux: ECHELLE_MATURITE },
] as const;

// --- Identifiants -----------------------------------------------------------------------------

export function estIdentifiantValide(v: string): boolean {
  return identifiantGrilleSchema.safeParse(v).success;
}

/** « Plan d'action RH » → « plan_d_action_rh » (vide si rien d'exploitable). */
export function suggererIdentifiant(texte: string, max = 40): string {
  return (
    texte
      .normalize("NFD")
      // Diacritiques séparés par NFD (accents, cédille) : retirés.
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+/, "")
      .slice(0, max)
      .replace(/_+$/, "")
  );
}

/** `base`, sinon `base_2`, `base_3`… : premier identifiant absent de `existants`. */
export function identifiantLibre(base: string, existants: ReadonlySet<string>): string {
  const racine = base === "" ? "element" : base;
  if (!existants.has(racine)) return racine;
  for (let n = 2; ; n++) {
    const candidat = `${racine}_${n}`;
    if (!existants.has(candidat)) return candidat;
  }
}

export function identifiantsQuestions(def: Definition): Set<string> {
  return new Set(def.sections.flatMap((s) => s.questions.map((q) => q.id)));
}

export function identifiantsSections(def: Definition): Set<string> {
  return new Set(def.sections.map((s) => s.id));
}

// --- Création ---------------------------------------------------------------------------------

function deuxOptions(): OptionChoix[] {
  return [
    { code: "option_1", libelle: "Option 1" },
    { code: "option_2", libelle: "Option 2" },
  ];
}

/** Question vierge du modèle donné (libellé à saisir). */
export function nouvelleQuestion(modele: ModeleQuestion, id: string, libelle = ""): Question {
  const base = { id, libelle, obligatoire: true };
  switch (modele) {
    case "likert":
      return { ...base, type: "likert", points: 5, libelles: [...ECHELLE_ACCORD] };
    case "choix_unique":
      return { ...base, type: "choix_unique", options: deuxOptions() };
    case "choix_multiple":
      return { ...base, type: "choix_multiple", options: deuxOptions() };
    case "pourcentage":
      return { ...base, type: "numerique", min: 0, max: 100, unite: "%" };
    case "numerique":
      return { ...base, type: "numerique" };
    case "texte":
      return { ...base, type: "texte" };
    case "date":
      return { ...base, type: "date" };
    case "oui_non":
      return { ...base, type: "oui_non" };
  }
}

/** Définition de départ d'un modèle créé de zéro : une section, une question à rédiger. */
export function definitionVierge(code: string, titre: string): Definition {
  return {
    id: code,
    version: 1,
    titre,
    sections: [
      {
        id: "section_1",
        titre: "Section 1",
        questions: [nouvelleQuestion("oui_non", "q1", "Première question (à reformuler)")],
      },
    ],
  };
}

/**
 * Change le type d'une question en gardant ce qui est commun (identifiant, libellé, aide,
 * caractère obligatoire, condition) ; les options passent d'un choix unique à un choix
 * multiple et inversement.
 */
export function changerModele(q: Question, modele: ModeleQuestion): Question {
  if (modeleDeQuestion(q) === modele) return q;
  const neuve = nouvelleQuestion(modele, q.id, q.libelle);
  const commun = {
    obligatoire: q.obligatoire,
    ...(q.aide === undefined ? {} : { aide: q.aide }),
    ...(q.condition === undefined ? {} : { condition: q.condition }),
  };
  if (
    (neuve.type === "choix_unique" || neuve.type === "choix_multiple") &&
    (q.type === "choix_unique" || q.type === "choix_multiple")
  ) {
    return { ...neuve, ...commun, options: q.options.map((o) => ({ ...o })) };
  }
  return { ...neuve, ...commun };
}

/** Libellés d'une échelle ajustés à `points` niveaux (les libellés saisis sont gardés). */
export function ajusterNiveaux(libelles: readonly string[], points: number): string[] {
  const n = Math.min(Math.max(Math.trunc(points), POINTS_LIKERT_MIN), POINTS_LIKERT_MAX);
  return Array.from({ length: n }, (_, i) => libelles[i] ?? `Niveau ${i + 1}`);
}

/** Nouvelle option au code libre (`option_3`…). */
export function nouvelleOption(options: readonly OptionChoix[]): OptionChoix {
  const codes = new Set(options.map((o) => o.code));
  const n = options.length + 1;
  return { code: identifiantLibre(`option_${n}`, codes), libelle: `Option ${n}` };
}

/** Texte facultatif : vide (ou blanc) → absent. */
export function texteFacultatif(v: string): string | undefined {
  return v.trim() === "" ? undefined : v;
}

/** Copie de `objet` où `cle` vaut `valeur`, ou est retirée si `valeur` est `undefined`. */
export function avecChamp<T extends object, K extends keyof T>(objet: T, cle: K, valeur: T[K]): T {
  const copie = { ...objet };
  if (valeur === undefined) delete copie[cle];
  else copie[cle] = valeur;
  return copie;
}

// --- Listes -----------------------------------------------------------------------------------

/** Déplace l'élément `index` d'un rang (sans effet aux extrémités). */
export function deplacer<T>(liste: readonly T[], index: number, sens: -1 | 1): T[] {
  const cible = index + sens;
  if (index < 0 || index >= liste.length || cible < 0 || cible >= liste.length) return [...liste];
  const copie = [...liste];
  [copie[index], copie[cible]] = [copie[cible] as T, copie[index] as T];
  return copie;
}

export function remplacer<T>(liste: readonly T[], index: number, valeur: T): T[] {
  return liste.map((x, i) => (i === index ? valeur : x));
}

export function retirer<T>(liste: readonly T[], index: number): T[] {
  return liste.filter((_, i) => i !== index);
}

// --- Édition de la définition -------------------------------------------------------------------

export function majSection(def: Definition, si: number, f: (s: Section) => Section): Definition {
  const s = def.sections[si];
  return s ? { ...def, sections: remplacer(def.sections, si, f(s)) } : def;
}

export function majQuestion(
  def: Definition,
  si: number,
  qi: number,
  f: (q: Question) => Question,
): Definition {
  return majSection(def, si, (s) => {
    const q = s.questions[qi];
    return q ? { ...s, questions: remplacer(s.questions, qi, f(q)) } : s;
  });
}

export function ajouterSection(def: Definition): Definition {
  const n = def.sections.length + 1;
  const id = identifiantLibre(`section_${n}`, identifiantsSections(def));
  const q = identifiantLibre(`q${identifiantsQuestions(def).size + 1}`, identifiantsQuestions(def));
  return {
    ...def,
    sections: [
      ...def.sections,
      { id, titre: `Section ${n}`, questions: [nouvelleQuestion("oui_non", q)] },
    ],
  };
}

export function ajouterQuestion(
  def: Definition,
  si: number,
  modele: ModeleQuestion = "oui_non",
): Definition {
  const ids = identifiantsQuestions(def);
  const id = identifiantLibre(`q${ids.size + 1}`, ids);
  return majSection(def, si, (s) => ({
    ...s,
    questions: [...s.questions, nouvelleQuestion(modele, id)],
  }));
}

/** Une définition garde au moins une section (schéma) : la dernière ne se supprime pas. */
export function supprimerSection(def: Definition, si: number): Definition {
  if (def.sections.length <= 1) return def;
  return { ...def, sections: retirer(def.sections, si) };
}

/** Une section garde au moins une question (schéma) : la dernière ne se supprime pas. */
export function supprimerQuestion(def: Definition, si: number, qi: number): Definition {
  return majSection(def, si, (s) =>
    s.questions.length <= 1 ? s : { ...s, questions: retirer(s.questions, qi) },
  );
}

export function deplacerSection(def: Definition, si: number, sens: -1 | 1): Definition {
  return { ...def, sections: deplacer(def.sections, si, sens) };
}

export function deplacerQuestion(
  def: Definition,
  si: number,
  qi: number,
  sens: -1 | 1,
): Definition {
  return majSection(def, si, (s) => ({ ...s, questions: deplacer(s.questions, qi, sens) }));
}

/** Remplace la question citée `ancien` par `nouveau` dans une condition. */
export function renommerReferences(c: Condition, ancien: string, nouveau: string): Condition {
  switch (c.op) {
    case "et":
    case "ou":
      return {
        op: c.op,
        conditions: c.conditions.map((s) => renommerReferences(s, ancien, nouveau)),
      };
    case "non":
      return { op: "non", condition: renommerReferences(c.condition, ancien, nouveau) };
    default:
      return c.question === ancien ? { ...c, question: nouveau } : c;
  }
}

/**
 * Change l'identifiant d'une question et met à jour les conditions qui la citent. Si
 * l'identifiant est déjà pris, seules les références restent inchangées : le doublon sera
 * signalé (IDENTIFIANT_DOUBLON) par le moteur.
 */
export function renommerQuestion(
  def: Definition,
  si: number,
  qi: number,
  nouveau: string,
): Definition {
  const q = def.sections[si]?.questions[qi];
  if (!q || q.id === nouveau) return def;
  const ancien = q.id;
  const dejaPris = identifiantsQuestions(def).has(nouveau);
  const avecId = majQuestion(def, si, qi, (x) => ({ ...x, id: nouveau }));
  if (dejaPris) return avecId;
  const ren = (c: Condition | undefined) =>
    c ? renommerReferences(c, ancien, nouveau) : undefined;
  return {
    ...avecId,
    sections: avecId.sections.map((s) => ({
      ...avecChamp(s, "condition", ren(s.condition)),
      questions: s.questions.map((x) => avecChamp(x, "condition", ren(x.condition))),
    })),
  };
}

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

const tronquer = (t: string, max = 60) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

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

// --- Contrôle de forme local --------------------------------------------------------------------

type Probleme = NonNullable<
  ReturnType<typeof definitionQuestionnaireSchema.safeParse>["error"]
>["issues"][number];

/** ["sections", 0, "questions", 2, "libelle"] → « sections[0].questions[2].libelle ». */
export function cheminDepuisSegments(segments: readonly (string | number)[]): string {
  return segments.reduce<string>(
    (acc, s) => (typeof s === "number" ? `${acc}[${s}]` : acc === "" ? s : `${acc}.${s}`),
    "",
  );
}

const TABLEAUX: Record<string, [code: string, message: string]> = {
  sections: ["SECTIONS_VIDES", "Le questionnaire doit contenir au moins une section."],
  questions: ["QUESTIONS_VIDES", "La section doit contenir au moins une question."],
  options: ["OPTIONS_INSUFFISANTES", "Au moins deux options sont attendues."],
  libelles: ["ECHELLE_INVALIDE", "Chaque niveau de l'échelle doit avoir un libellé."],
  conditions: ["CONDITION_VIDE", "La combinaison doit contenir au moins une condition."],
  valeurs: ["CONDITION_VIDE", "Choisissez au moins une valeur."],
};

function traduire(p: Probleme): [code: string, message: string] {
  const dernier = [...p.path].reverse().find((s) => typeof s === "string") as string | undefined;
  switch (p.code) {
    case "too_small":
      if (p.type === "string") return ["LIBELLE_VIDE", "Ce texte est obligatoire."];
      if (p.type === "array")
        return TABLEAUX[dernier ?? ""] ?? ["TROP_COURT", `Au moins ${String(p.minimum)} éléments.`];
      return ["VALEUR_HORS_BORNES", `La valeur doit être au moins ${String(p.minimum)}.`];
    case "too_big":
      if (p.type === "string")
        return ["TEXTE_TROP_LONG", `${String(p.maximum)} caractères au plus.`];
      if (p.type === "array") return ["TROP_D_ELEMENTS", `${String(p.maximum)} éléments au plus.`];
      return ["VALEUR_HORS_BORNES", `La valeur doit être au plus ${String(p.maximum)}.`];
    case "invalid_string":
      if (dernier === "min" || dernier === "max" || dernier === "valeur") {
        return ["DATE_INVALIDE", "Date au format AAAA-MM-JJ attendue."];
      }
      return [
        "IDENTIFIANT_INVALIDE",
        "Identifiant invalide : minuscules, chiffres, « _ », « . » ou « - », 80 caractères au plus.",
      ];
    case "not_finite":
    case "invalid_type":
      return ["VALEUR_MANQUANTE", "Valeur manquante ou de type inattendu."];
    case "not_multiple_of":
      return ["VALEUR_HORS_BORNES", "Un nombre entier est attendu."];
    case "custom":
      return ["VALEUR_INVALIDE", p.message];
    default:
      return ["FORME_INVALIDE", "Valeur refusée."];
  }
}

/**
 * Contrôle de FORME local (types, longueurs, bornes) par le schéma partagé, avant tout envoi :
 * messages en français, chemins au format du moteur. La cohérence reste jugée par l'API.
 */
export function verifierForme(def: Definition): Anomalie[] {
  const r = definitionQuestionnaireSchema.safeParse(def);
  if (r.success) return [];
  const vues = new Set<string>();
  const anomalies: Anomalie[] = [];
  for (const p of r.error.issues) {
    const [code, message] = traduire(p);
    const chemin = cheminDepuisSegments(p.path);
    const cle = `${chemin}|${code}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    anomalies.push({ code, chemin, message });
  }
  return anomalies;
}

// --- Localisation des anomalies -----------------------------------------------------------------

const CHAMPS: Record<string, string> = {
  id: "identifiant",
  version: "version",
  titre: "titre",
  description: "description",
  libelle: "libellé",
  aide: "aide",
  points: "nombre de niveaux",
  options: "options",
  minSelections: "sélections minimales",
  maxSelections: "sélections maximales",
  longueurMax: "longueur maximale",
  min: "minimum",
  max: "maximum",
  unite: "unité",
  code: "code",
  condition: "condition d'affichage",
  question: "question citée",
  valeur: "valeur",
  valeurs: "valeurs",
};

/**
 * Chemin du moteur (« sections[1].questions[0].condition.conditions[2] ») → emplacement lisible
 * (« Section 2 « Stratégie » › Question 1 « … » › condition d'affichage › élément 3 »).
 */
export function localiserChemin(chemin: string, def: Definition | null): string {
  if (chemin === "") return "Questionnaire";
  const parties: string[] = [];
  let section: Section | undefined;
  let question: Question | undefined;
  for (const segment of chemin.split(".")) {
    const m = /^([A-Za-z]+)((?:\[\d+\])*)$/.exec(segment);
    if (!m) {
      parties.push(segment);
      continue;
    }
    const nom = m[1] as string;
    const indices = [...(m[2] ?? "").matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
    const i = indices[0];
    if (nom === "sections" && i !== undefined) {
      section = def?.sections[i];
      parties.push(
        `Section ${i + 1}${section?.titre.trim() ? ` « ${tronquer(section.titre.trim(), 40)} »` : ""}`,
      );
    } else if (nom === "questions" && i !== undefined) {
      question = section?.questions[i];
      parties.push(
        `Question ${i + 1}${question?.libelle.trim() ? ` « ${tronquer(question.libelle.trim(), 50)} »` : ""}`,
      );
    } else if (nom === "options" && i !== undefined) {
      parties.push(`option ${i + 1}`);
    } else if (nom === "libelles" && i !== undefined) {
      parties.push(`libellé du niveau ${i + 1}`);
    } else if ((nom === "conditions" || nom === "valeurs") && i !== undefined) {
      parties.push(`${nom === "conditions" ? "élément" : "valeur"} ${i + 1}`);
    } else {
      parties.push(CHAMPS[nom] ?? nom);
    }
  }
  return parties.join(" › ");
}

export const idAncreSection = (si: number) => `qe-s${si}`;
export const idAncreQuestion = (si: number, qi: number) => `qe-s${si}-q${qi}`;

/** Élément de l'éditeur à atteindre pour une anomalie (section ou question), s'il existe. */
export function ancreChemin(chemin: string): string | null {
  const s = /^sections\[(\d+)\]/.exec(chemin);
  if (!s) return null;
  const q = /^sections\[\d+\]\.questions\[(\d+)\]/.exec(chemin);
  return q ? idAncreQuestion(Number(s[1]), Number(q[1])) : idAncreSection(Number(s[1]));
}

// --- Réponses ---------------------------------------------------------------------------------

/**
 * Réponse soumise mise en forme selon sa question ; `null` si la question n'a pas de réponse.
 * Une valeur d'un type inattendu est rendue telle quelle (jamais masquée).
 */
export function formaterReponse(q: Question, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (Array.isArray(v) && v.length === 0) return null;
  switch (q.type) {
    case "likert":
      return typeof v === "number" ? decrireValeur(q, v) : String(v);
    case "choix_unique":
      return typeof v === "string" ? decrireValeur(q, v) : String(v);
    case "choix_multiple":
      return Array.isArray(v) ? v.map((x) => decrireValeur(q, String(x))).join(", ") : String(v);
    case "oui_non":
      return typeof v === "boolean" ? (v ? "Oui" : "Non") : String(v);
    case "numerique":
      return typeof v === "number" ? decrireValeur(q, v) : String(v);
    case "date":
      return typeof v === "string" ? formaterDate(v) : String(v);
    case "texte":
      return String(v);
  }
}
