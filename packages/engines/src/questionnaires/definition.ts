/**
 * Validation d'une définition de questionnaire (SOC-10).
 *
 * `validerDefinition` ne lève jamais : elle rend la liste complète des
 * anomalies, chacune avec un code stable, un chemin (`sections[0].questions[2]`)
 * et un message lisible en français. Les fonctions qui exploitent une
 * définition (`questionsVisibles`, `validerReponses`…) la valident d'abord et
 * lèvent `DEFINITION_INVALIDE` si elle ne l'est pas : une définition fautive
 * (cycle de conditions, référence inconnue) ne peut donc jamais être évaluée.
 */
import { analyserDateISO } from "../commun/dates";
import { ErreurQuestionnaire, type Anomalie } from "./erreurs";
import {
  FORMAT_IDENTIFIANT,
  LONGUEUR_TEXTE_PLAFOND,
  POINTS_LIKERT_MAX,
  POINTS_LIKERT_MIN,
  PROFONDEUR_MAX_CONDITION,
  type Condition,
  type DefinitionQuestionnaire,
  type OptionChoix,
  type Question,
  type ValeurCondition,
} from "./types";

export interface ResultatValidationDefinition {
  readonly valide: boolean;
  readonly erreurs: readonly Anomalie[];
}

type Collecteur = (code: string, chemin: string, message: string) => void;

function texteRenseigne(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "";
}

function estDateISO(v: unknown): v is string {
  return typeof v === "string" && analyserDateISO(v).valide;
}

function estEntier(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/**
 * Profondeur d'une condition : une comparaison vaut 1, chaque combinaison
 * ajoute 1. Le parcours s'arrête à `plafond` (résultat = min(profondeur,
 * plafond)), ce qui borne la récursion sur une condition malveillante.
 */
export function profondeurCondition(c: Condition, plafond = PROFONDEUR_MAX_CONDITION + 1): number {
  const enfants =
    c.op === "et" || c.op === "ou" ? c.conditions : c.op === "non" ? [c.condition] : [];
  if (enfants.length === 0 || plafond <= 1) return 1;
  return 1 + Math.max(...enfants.map((e) => profondeurCondition(e, plafond - 1)));
}

/** Identifiants des questions lues par une condition, dans l'ordre d'apparition. */
export function referencesCondition(c: Condition): string[] {
  switch (c.op) {
    case "et":
    case "ou":
      return c.conditions.flatMap(referencesCondition);
    case "non":
      return referencesCondition(c.condition);
    default:
      return [c.question];
  }
}

/** Vrai si `valeur` peut être comparée par égalité à une réponse de `q`. */
function valeurCompatible(q: Question, valeur: ValeurCondition): boolean {
  switch (q.type) {
    case "likert":
      return estEntier(valeur) && valeur >= 1 && valeur <= q.points;
    case "choix_unique":
    case "choix_multiple":
      return typeof valeur === "string" && q.options.some((o) => o.code === valeur);
    case "oui_non":
      return typeof valeur === "boolean";
    case "numerique":
      return typeof valeur === "number" && Number.isFinite(valeur);
    case "texte":
      return typeof valeur === "string";
    case "date":
      return estDateISO(valeur);
  }
}

function validerComparaisonOrdonnee(q: Question, valeur: unknown): boolean {
  if (q.type === "likert" || q.type === "numerique") {
    return typeof valeur === "number" && Number.isFinite(valeur);
  }
  return q.type === "date" && estDateISO(valeur);
}

function validerCondition(
  c: Condition,
  chemin: string,
  questions: ReadonlyMap<string, Question>,
  signaler: Collecteur,
): void {
  if (c.op === "et" || c.op === "ou") {
    if (c.conditions.length === 0) {
      signaler(
        "CONDITION_VIDE",
        chemin,
        `La combinaison « ${c.op} » ne contient aucune condition.`,
      );
    }
    c.conditions.forEach((s, i) =>
      validerCondition(s, `${chemin}.conditions[${i}]`, questions, signaler),
    );
    return;
  }
  if (c.op === "non") {
    validerCondition(c.condition, `${chemin}.condition`, questions, signaler);
    return;
  }
  const cible = questions.get(c.question);
  if (cible === undefined) {
    signaler(
      "REFERENCE_INCONNUE",
      chemin,
      `La condition cite une question inconnue : « ${c.question} ».`,
    );
    return;
  }
  const incompatible = (detail: string) =>
    signaler(
      "VALEUR_INCOMPATIBLE",
      chemin,
      `La condition sur « ${c.question} » (${cible.type}) est incompatible : ${detail}.`,
    );
  switch (c.op) {
    case "egal":
    case "different":
      if (!valeurCompatible(cible, c.valeur)) incompatible(`valeur ${JSON.stringify(c.valeur)}`);
      return;
    case "dans":
      if (c.valeurs.length === 0) incompatible("liste de valeurs vide");
      c.valeurs
        .filter((v) => !valeurCompatible(cible, v))
        .forEach((v) => incompatible(`valeur ${JSON.stringify(v)}`));
      return;
    case "superieur":
    case "inferieur":
      if (!validerComparaisonOrdonnee(cible, c.valeur)) {
        incompatible(`comparaison « ${c.op} » à ${JSON.stringify(c.valeur)}`);
      }
      return;
    case "vide":
      return;
  }
}

function validerOptions(options: readonly OptionChoix[], chemin: string, signaler: Collecteur) {
  if (options.length < 2)
    signaler("OPTIONS_INSUFFISANTES", chemin, "Au moins deux options sont attendues.");
  const vus = new Set<string>();
  options.forEach((o, i) => {
    const c = `${chemin}.options[${i}]`;
    if (!FORMAT_IDENTIFIANT.test(o.code)) {
      signaler("IDENTIFIANT_INVALIDE", c, `Code d'option invalide : « ${o.code} ».`);
    }
    if (vus.has(o.code))
      signaler("IDENTIFIANT_DOUBLON", c, `Code d'option en double : « ${o.code} ».`);
    vus.add(o.code);
    if (!texteRenseigne(o.libelle)) signaler("LIBELLE_VIDE", c, "Le libellé de l'option est vide.");
  });
}

function validerQuestion(q: Question, chemin: string, signaler: Collecteur): void {
  if (!texteRenseigne(q.libelle))
    signaler("LIBELLE_VIDE", chemin, `La question « ${q.id} » n'a pas de libellé.`);
  switch (q.type) {
    case "likert":
      if (!estEntier(q.points) || q.points < POINTS_LIKERT_MIN || q.points > POINTS_LIKERT_MAX) {
        signaler(
          "ECHELLE_INVALIDE",
          chemin,
          `L'échelle doit compter de ${POINTS_LIKERT_MIN} à ${POINTS_LIKERT_MAX} niveaux (reçu ${q.points}).`,
        );
      } else if (q.libelles.length !== q.points || !q.libelles.every(texteRenseigne)) {
        signaler(
          "ECHELLE_INVALIDE",
          chemin,
          `Chacun des ${q.points} niveaux doit avoir un libellé.`,
        );
      }
      return;
    case "choix_unique":
      validerOptions(q.options, chemin, signaler);
      return;
    case "choix_multiple": {
      validerOptions(q.options, chemin, signaler);
      const min = q.minSelections ?? 1;
      const max = q.maxSelections ?? q.options.length;
      if (!estEntier(min) || !estEntier(max) || min < 1 || min > max || max > q.options.length) {
        signaler(
          "SELECTION_INVALIDE",
          chemin,
          `Bornes de sélection incohérentes (min ${min}, max ${max}, ${q.options.length} options).`,
        );
      }
      return;
    }
    case "texte":
      if (
        q.longueurMax !== undefined &&
        (!estEntier(q.longueurMax) || q.longueurMax < 1 || q.longueurMax > LONGUEUR_TEXTE_PLAFOND)
      ) {
        signaler(
          "LONGUEUR_INVALIDE",
          chemin,
          `La longueur maximale doit être un entier de 1 à ${LONGUEUR_TEXTE_PLAFOND}.`,
        );
      }
      return;
    case "numerique": {
      const bornesFinies = [q.min, q.max].every((b) => b === undefined || Number.isFinite(b));
      if (!bornesFinies || (q.min !== undefined && q.max !== undefined && q.min > q.max)) {
        signaler("BORNES_INVALIDES", chemin, "Les bornes numériques sont incohérentes.");
      }
      return;
    }
    case "date": {
      const bornesValides = [q.min, q.max].every((b) => b === undefined || estDateISO(b));
      if (!bornesValides || (q.min !== undefined && q.max !== undefined && q.min > q.max)) {
        signaler("BORNES_INVALIDES", chemin, "Les bornes de date sont incohérentes.");
      }
      return;
    }
    case "oui_non":
      return;
  }
}

/**
 * Détecte les cycles du graphe « la visibilité de Q dépend de la réponse à R »
 * (condition de la question et condition de sa section). Parcours en
 * profondeur dans l'ordre de la définition : résultat déterministe.
 */
function detecterCycles(
  dependances: ReadonlyMap<string, readonly string[]>,
  chemins: ReadonlyMap<string, string>,
  signaler: Collecteur,
): void {
  const etat = new Map<string, "en_cours" | "fini">();
  const pile: string[] = [];
  const visiter = (id: string): void => {
    etat.set(id, "en_cours");
    pile.push(id);
    for (const suivant of dependances.get(id) as readonly string[]) {
      const e = etat.get(suivant);
      if (e === "en_cours") {
        const boucle = [...pile.slice(pile.indexOf(suivant)), suivant];
        signaler(
          "CYCLE",
          chemins.get(id) as string,
          `Cycle de conditions : ${boucle.join(" → ")}.`,
        );
      } else if (e === undefined && dependances.has(suivant)) {
        visiter(suivant);
      }
    }
    pile.pop();
    etat.set(id, "fini");
  };
  for (const id of dependances.keys()) if (!etat.has(id)) visiter(id);
}

/** Valide une définition de questionnaire et rend toutes ses anomalies. */
export function validerDefinition(def: DefinitionQuestionnaire): ResultatValidationDefinition {
  const erreurs: Anomalie[] = [];
  const signaler: Collecteur = (code, chemin, message) => erreurs.push({ code, chemin, message });

  if (!FORMAT_IDENTIFIANT.test(def.id)) {
    signaler(
      "IDENTIFIANT_INVALIDE",
      "id",
      `Identifiant de questionnaire invalide : « ${def.id} ».`,
    );
  }
  if (!estEntier(def.version) || def.version < 1) {
    signaler("VERSION_INVALIDE", "version", "La version doit être un entier positif.");
  }
  if (!texteRenseigne(def.titre))
    signaler("LIBELLE_VIDE", "titre", "Le questionnaire n'a pas de titre.");
  if (def.sections.length === 0) {
    signaler("SECTIONS_VIDES", "sections", "Le questionnaire ne contient aucune section.");
  }

  const questions = new Map<string, Question>();
  const chemins = new Map<string, string>();
  const sectionsVues = new Set<string>();
  def.sections.forEach((s, i) => {
    const chemin = `sections[${i}]`;
    if (!FORMAT_IDENTIFIANT.test(s.id)) {
      signaler("IDENTIFIANT_INVALIDE", chemin, `Identifiant de section invalide : « ${s.id} ».`);
    }
    if (sectionsVues.has(s.id))
      signaler("IDENTIFIANT_DOUBLON", chemin, `Section en double : « ${s.id} ».`);
    sectionsVues.add(s.id);
    if (!texteRenseigne(s.titre))
      signaler("LIBELLE_VIDE", chemin, `La section « ${s.id} » n'a pas de titre.`);
    if (s.questions.length === 0) {
      signaler("QUESTIONS_VIDES", chemin, `La section « ${s.id} » ne contient aucune question.`);
    }
    s.questions.forEach((q, j) => {
      const cq = `${chemin}.questions[${j}]`;
      if (!FORMAT_IDENTIFIANT.test(q.id)) {
        signaler("IDENTIFIANT_INVALIDE", cq, `Identifiant de question invalide : « ${q.id} ».`);
      }
      if (questions.has(q.id)) {
        signaler("IDENTIFIANT_DOUBLON", cq, `Question en double : « ${q.id} ».`);
      } else {
        questions.set(q.id, q);
        chemins.set(q.id, cq);
      }
      validerQuestion(q, cq, signaler);
    });
  });

  const dependances = new Map<string, string[]>();
  const refsRacine = (c: Condition | undefined, chemin: string): string[] =>
    c !== undefined && verifierRacine(c, chemin, questions, signaler) ? referencesCondition(c) : [];
  def.sections.forEach((s, i) => {
    const refsSection = refsRacine(s.condition, `sections[${i}].condition`);
    s.questions.forEach((q, j) => {
      const chemin = `sections[${i}].questions[${j}]`;
      const refs = [...refsSection, ...refsRacine(q.condition, `${chemin}.condition`)];
      if (chemins.get(q.id) === chemin) dependances.set(q.id, [...new Set(refs)]);
    });
  });
  detecterCycles(dependances, chemins, signaler);

  return { valide: erreurs.length === 0, erreurs };
}

function verifierRacine(
  c: Condition,
  chemin: string,
  questions: ReadonlyMap<string, Question>,
  signaler: Collecteur,
): boolean {
  if (profondeurCondition(c) > PROFONDEUR_MAX_CONDITION) {
    signaler(
      "PROFONDEUR_DEPASSEE",
      chemin,
      `Condition trop imbriquée : ${PROFONDEUR_MAX_CONDITION} niveaux au plus.`,
    );
    return false;
  }
  validerCondition(c, chemin, questions, signaler);
  return true;
}

/** Lève `DEFINITION_INVALIDE` (avec le détail) si la définition n'est pas valide. */
export function exigerDefinitionValide(def: DefinitionQuestionnaire): void {
  const { valide, erreurs } = validerDefinition(def);
  if (!valide) {
    throw new ErreurQuestionnaire(
      "DEFINITION_INVALIDE",
      `Définition de questionnaire invalide (${erreurs.length} anomalie(s)).`,
      erreurs,
    );
  }
}
