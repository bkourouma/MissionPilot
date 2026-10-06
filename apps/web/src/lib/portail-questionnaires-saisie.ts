/**
 * Saisie d'un questionnaire du portail client (SOC-10) : affichage conditionnel en direct,
 * lecture et contrôle des champs, brouillon à envoyer et réconciliation avec la réponse du
 * serveur. Logique pure, testée dans `portail-questionnaires-saisie.test.ts`.
 *
 * Le web n'importe pas `@missionpilot/engines` (CODING_STANDARDS §1) : l'évaluation des
 * conditions reproduit, à l'identique, `visibilite.ts` du moteur (une condition ne lit que des
 * réponses valides à des questions visibles ; une comparaison sur une réponse vide est fausse,
 * sauf `vide`). Les contrôles de champ évitent d'envoyer une valeur que l'API refuserait (elle
 * refuse alors toute la sauvegarde) et donnent un message en français ; ils ne calculent rien :
 * la progression et la validation qui font foi sont celles de l'API.
 *
 * Rien n'est gardé dans le navigateur : l'état de saisie vit en mémoire, le brouillon sur le
 * serveur.
 */
import type {
  ConditionAffichage,
  DefinitionQuestionnaireDonnees,
  QuestionQuestionnaire,
} from "@missionpilot/shared";
import { formaterDate, formaterNombre } from "./format";
import type { Reponses, ValeurReponse } from "./portail-questionnaires";
import { lireNombre } from "./saisie";

/**
 * Valeur d'un champ tel qu'il est saisi : niveau ou code choisi (ou `null`), cases cochées,
 * oui/non (ou `null`), texte brut (nombre « 12,5 », date « AAAA-MM-JJ », texte libre).
 */
export type ValeurSaisie = string | number | boolean | string[] | null;

export type Saisies = Record<string, ValeurSaisie>;

/** Longueur maximale par défaut d'une réponse texte (contrat du moteur). */
export const LONGUEUR_TEXTE_DEFAUT = 2_000;

/** Au-delà, une réponse texte se saisit dans une zone multiligne. */
export const LONGUEUR_LIGNE_MAX = 200;

const NBSP = "\u00a0";

/**
 * Valeur propre d'un objet indexé par identifiant de question, jamais une propriété héritée du
 * prototype (« constructor » est un identifiant de question valide).
 */
export function propre<T>(objet: Readonly<Record<string, T>>, cle: string): T | undefined {
  return possede(objet, cle) ? objet[cle] : undefined;
}

/** `Object.hasOwn`, absent des navigateurs anciens encore fréquents sur téléphone. */
export function possede(objet: object, cle: string): boolean {
  return Object.prototype.hasOwnProperty.call(objet, cle);
}

/** Toutes les questions, dans l'ordre de la définition. */
export function questionsDe(def: DefinitionQuestionnaireDonnees): QuestionQuestionnaire[] {
  return def.sections.flatMap((s) => s.questions);
}

/** Identifiants de toutes les questions de la définition. */
export const idsQuestions = (def: DefinitionQuestionnaireDonnees) =>
  new Set(questionsDe(def).map((q) => q.id));

// --- Conversion entre réponses du serveur et champs ----------------------------------------

/** Nombre affiché dans un champ, à la française (« 12,5 »), sans séparateur de milliers. */
function nombreVersTexte(v: number): string {
  return String(v).replace(".", ",");
}

/** Valeur du serveur → valeur du champ (une valeur d'un type inattendu donne un champ vide). */
export function versSaisie(
  q: QuestionQuestionnaire,
  v: ValeurReponse | null | undefined,
): ValeurSaisie {
  switch (q.type) {
    case "likert":
      return typeof v === "number" ? v : null;
    case "choix_unique":
      return typeof v === "string" ? v : null;
    case "choix_multiple":
      return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
    case "oui_non":
      return typeof v === "boolean" ? v : null;
    case "numerique":
      return typeof v === "number" && Number.isFinite(v) ? nombreVersTexte(v) : "";
    case "texte":
    case "date":
      return typeof v === "string" ? v : "";
  }
}

/** Champs initiaux à partir des réponses enregistrées. */
export function saisiesInitiales(def: DefinitionQuestionnaireDonnees, reponses: Reponses): Saisies {
  const s: Saisies = {};
  for (const q of questionsDe(def)) {
    if (possede(reponses, q.id)) s[q.id] = versSaisie(q, propre(reponses, q.id));
  }
  return s;
}

export type LectureSaisie =
  { ok: true; valeur: ValeurReponse | null } | { ok: false; message: string };

const vide = { ok: true, valeur: null } as const;
const refus = (message: string): LectureSaisie => ({ ok: false, message });

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateValide(v: string): boolean {
  const m = DATE_ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

function bornesNombre(min: number | undefined, max: number | undefined, unite?: string): string {
  const u = unite ? `${NBSP}${unite}` : "";
  if (min !== undefined && max !== undefined) {
    return `La valeur doit être comprise entre ${formaterNombre(min, 4)} et ${formaterNombre(max, 4)}${u}.`;
  }
  if (min !== undefined) return `La valeur doit être d'au moins ${formaterNombre(min, 4)}${u}.`;
  return `La valeur doit être d'au plus ${formaterNombre(max, 4)}${u}.`;
}

function bornesDate(min: string | undefined, max: string | undefined): string {
  if (min && max) {
    return `La date doit être comprise entre le ${formaterDate(min)} et le ${formaterDate(max)}.`;
  }
  if (min) return `La date doit être le ${formaterDate(min)} ou après.`;
  return `La date doit être le ${formaterDate(max)} ou avant.`;
}

function lireChoixMultiple(
  q: Extract<QuestionQuestionnaire, { type: "choix_multiple" }>,
  s: ValeurSaisie,
): LectureSaisie {
  if (!Array.isArray(s)) return s === null || s === undefined ? vide : refus("Cochez vos choix.");
  const codes = new Set(s);
  if (codes.size === 0) return vide;
  if ([...codes].some((c) => !q.options.some((o) => o.code === c))) {
    return refus("Un choix n'est plus proposé : décochez-le.");
  }
  const min = q.minSelections ?? 1;
  const max = q.maxSelections ?? q.options.length;
  if (codes.size < min) return refus(`Cochez au moins ${min} choix.`);
  if (codes.size > max) return refus(`Cochez au plus ${max} choix.`);
  return { ok: true, valeur: q.options.filter((o) => codes.has(o.code)).map((o) => o.code) };
}

function lireNumerique(
  q: Extract<QuestionQuestionnaire, { type: "numerique" }>,
  s: ValeurSaisie,
): LectureSaisie {
  const n = typeof s === "number" ? s : typeof s === "string" ? lireNombre(s) : null;
  if (n === null) return vide;
  if (!Number.isFinite(n)) {
    return refus(
      q.entier
        ? "Saisissez un nombre entier, par exemple 12."
        : "Saisissez un nombre, par exemple 12 ou 12,5.",
    );
  }
  if (q.entier && !Number.isInteger(n)) return refus("Saisissez un nombre entier, sans décimale.");
  if ((q.min !== undefined && n < q.min) || (q.max !== undefined && n > q.max)) {
    return refus(bornesNombre(q.min, q.max, q.unite));
  }
  return { ok: true, valeur: n };
}

/**
 * Lit un champ : valeur prête pour l'API (`null` = pas de réponse), ou message d'erreur.
 * Mêmes contrôles que `validerReponse` du moteur (type, échelle, options, bornes, longueur).
 */
export function lireSaisie(q: QuestionQuestionnaire, s: ValeurSaisie | undefined): LectureSaisie {
  if (s === undefined || s === null) return vide;
  switch (q.type) {
    case "likert":
      if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > q.points) {
        return refus("Choisissez un niveau de l'échelle proposée.");
      }
      return { ok: true, valeur: s };
    case "choix_unique":
      if (s === "") return vide;
      if (typeof s !== "string" || !q.options.some((o) => o.code === s)) {
        return refus("Ce choix n'est plus proposé : choisissez parmi les options affichées.");
      }
      return { ok: true, valeur: s };
    case "choix_multiple":
      return lireChoixMultiple(q, s);
    case "oui_non":
      return typeof s === "boolean" ? { ok: true, valeur: s } : vide;
    case "numerique":
      return lireNumerique(q, s);
    case "texte": {
      if (typeof s !== "string") return vide;
      const t = s.trim();
      if (t === "") return vide;
      const max = q.longueurMax ?? LONGUEUR_TEXTE_DEFAUT;
      if (t.length > max) return refus(`${max} caractères au plus (actuellement ${t.length}).`);
      return { ok: true, valeur: t };
    }
    case "date": {
      if (typeof s !== "string" || s.trim() === "") return vide;
      if (!dateValide(s)) return refus("Saisissez une date valide, par exemple 15/03/2027.");
      if ((q.min && s < q.min) || (q.max && s > q.max)) return refus(bornesDate(q.min, q.max));
      return { ok: true, valeur: s };
    }
  }
}

/** Égalité de deux réponses (listes comparées dans leur ordre normalisé). */
export function egales(a: ValeurReponse | null | undefined, b: ValeurReponse | null | undefined) {
  const x = a ?? null;
  const y = b ?? null;
  if (Array.isArray(x) || Array.isArray(y)) {
    return (
      Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i])
    );
  }
  return x === y;
}

// --- Affichage conditionnel (même règle que le moteur) -------------------------------------

type Lire = (question: string) => ValeurReponse | null;

function egale(reponse: ValeurReponse, valeur: string | number | boolean): boolean {
  return Array.isArray(reponse) ? reponse.includes(valeur as string) : reponse === valeur;
}

function compare(reponse: ValeurReponse, valeur: number | string, sens: 1 | -1): boolean {
  if (typeof reponse !== typeof valeur) return false;
  return sens === 1 ? reponse > valeur : reponse < valeur;
}

/** Évalue une condition d'affichage ; `lire` rend la réponse effective (null si vide ou masquée). */
export function evaluerCondition(c: ConditionAffichage, lire: Lire): boolean {
  switch (c.op) {
    case "et":
      return c.conditions.every((s) => evaluerCondition(s, lire));
    case "ou":
      return c.conditions.some((s) => evaluerCondition(s, lire));
    case "non":
      return !evaluerCondition(c.condition, lire);
    case "vide":
      return lire(c.question) === null;
  }
  const reponse = lire(c.question);
  if (reponse === null) return false;
  switch (c.op) {
    case "egal":
      return egale(reponse, c.valeur);
    case "different":
      return !egale(reponse, c.valeur);
    case "dans":
      return c.valeurs.some((v) => egale(reponse, v));
    case "superieur":
      return compare(reponse, c.valeur, 1);
    case "inferieur":
      return compare(reponse, c.valeur, -1);
  }
}

/** Réponses effectives des champs : valeur valide et non vide, sinon `null`. */
export function valeursEffectives(
  def: DefinitionQuestionnaireDonnees,
  saisies: Readonly<Saisies>,
): Map<string, ValeurReponse> {
  const valeurs = new Map<string, ValeurReponse>();
  for (const q of questionsDe(def)) {
    const r = lireSaisie(q, propre(saisies, q.id));
    if (r.ok && r.valeur !== null) valeurs.set(q.id, r.valeur);
  }
  return valeurs;
}

/**
 * Questions visibles pour ces réponses : section ET question dont la condition est vraie. Une
 * réponse à une question masquée compte comme vide (masquage en cascade). Une définition
 * cyclique (refusée par l'API à la validation de la version) ne fait pas boucler l'évaluation.
 */
export function questionsVisibles(
  def: DefinitionQuestionnaireDonnees,
  valeurs: ReadonlyMap<string, ValeurReponse>,
): Set<string> {
  const questions = new Map<string, QuestionQuestionnaire>();
  const conditionsSection = new Map<string, ConditionAffichage | undefined>();
  for (const s of def.sections) {
    for (const q of s.questions) {
      questions.set(q.id, q);
      conditionsSection.set(q.id, s.condition);
    }
  }
  const connues = new Map<string, boolean>();
  const enCours = new Set<string>();
  const lire: Lire = (id) => (estVisible(id) ? (valeurs.get(id) ?? null) : null);
  const estVisible = (id: string): boolean => {
    const connue = connues.get(id);
    if (connue !== undefined) return connue;
    const q = questions.get(id);
    if (!q || enCours.has(id)) return false;
    enCours.add(id);
    const cs = conditionsSection.get(id);
    const visible =
      (cs === undefined || evaluerCondition(cs, lire)) &&
      (q.condition === undefined || evaluerCondition(q.condition, lire));
    enCours.delete(id);
    connues.set(id, visible);
    return visible;
  };
  return new Set(
    questionsDe(def)
      .filter((q) => estVisible(q.id))
      .map((q) => q.id),
  );
}

/** Visibilité des questions d'après les champs saisis. */
export const visiblesDepuisSaisies = (
  def: DefinitionQuestionnaireDonnees,
  saisies: Readonly<Saisies>,
) => questionsVisibles(def, valeursEffectives(def, saisies));

/** Questions apparues et masquées entre deux états (annonce aux lecteurs d'écran). */
export function ecartVisibilite(avant: ReadonlySet<string>, apres: ReadonlySet<string>) {
  let apparues = 0;
  let masquees = 0;
  for (const id of apres) if (!avant.has(id)) apparues++;
  for (const id of avant) if (!apres.has(id)) masquees++;
  return { apparues, masquees };
}

// --- Brouillon à envoyer -------------------------------------------------------------------

export interface ChargeBrouillon {
  /** Réponses modifiées depuis la dernière version connue du serveur (`null` efface). */
  reponses: Record<string, ValeurReponse | null>;
  /** Champs visibles invalides : non envoyés, signalés à l'utilisateur. */
  invalides: string[];
}

/**
 * Réponses à envoyer : questions VISIBLES dont la valeur valide diffère de la version connue du
 * serveur, hors questions `exclues` (refusées par le serveur, conflit en attente de décision).
 * Une question masquée n'est jamais envoyée (le serveur l'écarte de toute façon).
 */
export function chargeBrouillon(
  def: DefinitionQuestionnaireDonnees,
  saisies: Readonly<Saisies>,
  base: Readonly<Reponses>,
  exclues: ReadonlySet<string> = new Set(),
): ChargeBrouillon {
  const visibles = visiblesDepuisSaisies(def, saisies);
  const reponses: Record<string, ValeurReponse | null> = {};
  const invalides: string[] = [];
  for (const q of questionsDe(def)) {
    if (!visibles.has(q.id) || exclues.has(q.id)) continue;
    const r = lireSaisie(q, propre(saisies, q.id));
    if (!r.ok) {
      invalides.push(q.id);
      continue;
    }
    if (!egales(r.valeur, propre(base, q.id))) reponses[q.id] = r.valeur;
  }
  return { reponses, invalides };
}

export const estVideCharge = (c: Pick<ChargeBrouillon, "reponses">) =>
  Object.keys(c.reponses).length === 0;

export interface Reconciliation {
  saisies: Saisies;
  /** Nouvelle version connue du serveur. */
  base: Reponses;
  /** Questions mises à jour depuis le serveur par un collègue (mode collectif). */
  misesAJour: string[];
  /**
   * Questions modifiées ici ET par un collègue (mode collectif) : la réponse du collègue,
   * en attente d'une décision (garder la sienne ou reprendre celle du collègue).
   */
  conflits: Record<string, ValeurReponse | null>;
}

/**
 * Intègre la réponse du serveur (après une sauvegarde ou une actualisation) sans perdre la
 * saisie faite pendant l'échange :
 * - question envoyée et inchangée depuis : la valeur normalisée du serveur est reprise ;
 * - question non envoyée que le serveur a changée : reprise si elle n'a pas été touchée ici
 *   (saisie d'un collègue en mode collectif, réponse masquée écartée en mode individuel),
 *   sinon conflit en mode collectif ;
 * - question modifiée ici pendant l'échange : la saisie locale est gardée (envoyée ensuite).
 */
export function reconcilier(
  def: DefinitionQuestionnaireDonnees,
  etat: { saisies: Readonly<Saisies>; base: Readonly<Reponses> },
  envoye: Readonly<Record<string, ValeurReponse | null>>,
  serveur: Readonly<Reponses>,
  collectif: boolean,
): Reconciliation {
  const saisies: Saisies = { ...etat.saisies };
  const misesAJour: string[] = [];
  const conflits: Record<string, ValeurReponse | null> = {};
  for (const q of questionsDe(def)) {
    const s = propre(serveur, q.id) ?? null;
    const local = lireSaisie(q, propre(etat.saisies, q.id));
    if (possede(envoye, q.id)) {
      if (local.ok && egales(local.valeur, propre(envoye, q.id)) && !egales(s, local.valeur)) {
        saisies[q.id] = versSaisie(q, s);
      }
      continue;
    }
    if (egales(s, propre(etat.base, q.id))) continue;
    if (local.ok && egales(local.valeur, propre(etat.base, q.id))) {
      saisies[q.id] = versSaisie(q, s);
      if (collectif) misesAJour.push(q.id);
    } else if (collectif) {
      conflits[q.id] = s;
    }
  }
  return { saisies, base: { ...serveur }, misesAJour, conflits };
}

// --- Contrôle avant l'envoi ----------------------------------------------------------------

function messageObligatoire(q: QuestionQuestionnaire): string {
  switch (q.type) {
    case "likert":
    case "choix_unique":
    case "oui_non":
      return "Cette question est obligatoire : choisissez une réponse.";
    case "choix_multiple":
      return "Cette question est obligatoire : cochez au moins un choix.";
    case "date":
      return "Cette question est obligatoire : indiquez une date.";
    default:
      return "Cette question est obligatoire : renseignez une réponse.";
  }
}

export interface ErreurQuestion {
  id: string;
  message: string;
}

export const MESSAGE_CONFLIT = "Choisissez la réponse à garder avant d'envoyer.";

/**
 * Erreurs bloquant l'envoi, dans l'ordre du questionnaire : questions visibles obligatoires sans
 * réponse, valeurs invalides, conflits non tranchés. Les questions masquées ne sont pas exigées.
 */
export function erreursAvantEnvoi(
  def: DefinitionQuestionnaireDonnees,
  saisies: Readonly<Saisies>,
  conflits: Readonly<Record<string, unknown>> = {},
): ErreurQuestion[] {
  const visibles = visiblesDepuisSaisies(def, saisies);
  const erreurs: ErreurQuestion[] = [];
  for (const q of questionsDe(def)) {
    if (!visibles.has(q.id)) continue;
    if (possede(conflits, q.id)) {
      erreurs.push({ id: q.id, message: MESSAGE_CONFLIT });
      continue;
    }
    const r = lireSaisie(q, propre(saisies, q.id));
    if (!r.ok) erreurs.push({ id: q.id, message: r.message });
    else if (r.valeur === null && q.obligatoire)
      erreurs.push({ id: q.id, message: messageObligatoire(q) });
  }
  return erreurs;
}

// --- Aides d'affichage des champs ----------------------------------------------------------

/** Aide sous un champ, construite d'après la question (bornes, nombre de choix, longueur). */
export function aideChamp(q: QuestionQuestionnaire): string | null {
  switch (q.type) {
    case "choix_multiple": {
      const min = q.minSelections ?? 1;
      const max = q.maxSelections ?? q.options.length;
      if (min === max) return `Cochez ${min} choix.`;
      if (min > 1) return `Cochez entre ${min} et ${max} choix.`;
      return max < q.options.length ? `Cochez ${max} choix au plus.` : "Plusieurs choix possibles.";
    }
    case "numerique": {
      if (q.min === undefined && q.max === undefined) {
        const nature = q.entier ? "Nombre entier" : "Nombre, décimales séparées par une virgule";
        return q.unite ? `${nature} ; unité : ${q.unite}.` : `${nature}.`;
      }
      const u = q.unite ? `${NBSP}${q.unite}` : "";
      if (q.min !== undefined && q.max !== undefined) {
        return `Entre ${formaterNombre(q.min, 4)} et ${formaterNombre(q.max, 4)}${u}${q.entier ? ", nombre entier" : ""}.`;
      }
      return q.min !== undefined
        ? `Au moins ${formaterNombre(q.min, 4)}${u}.`
        : `Au plus ${formaterNombre(q.max, 4)}${u}.`;
    }
    case "date":
      if (q.min && q.max) return `Entre le ${formaterDate(q.min)} et le ${formaterDate(q.max)}.`;
      if (q.min) return `À partir du ${formaterDate(q.min)}.`;
      if (q.max) return `Jusqu'au ${formaterDate(q.max)}.`;
      return null;
    default:
      return null;
  }
}

/** Longueur maximale d'une réponse texte. */
export const longueurMax = (q: Extract<QuestionQuestionnaire, { type: "texte" }>) =>
  q.longueurMax ?? LONGUEUR_TEXTE_DEFAUT;

/** Compteur de caractères : « 120 caractères sur 2 000 ». */
export function compteurCaracteres(texte: string, max: number): string {
  const n = texte.trim().length;
  return `${formaterNombre(n, 0)} caractère${n > 1 ? "s" : ""} sur ${formaterNombre(max, 0)}`;
}

/** Identifiant HTML du bloc d'une question (identifiants de question : `[a-z0-9_.-]`). */
export const idBlocQuestion = (id: string) => `mp-pq-${id}`;
