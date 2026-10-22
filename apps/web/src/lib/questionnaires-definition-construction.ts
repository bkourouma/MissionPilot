/** Sous-module de `questionnaires-definition.ts` : identifiants, création et listes. */
import { ECHELLE_ACCORD, identifiantGrilleSchema } from "@missionpilot/shared";
import {
  type Definition,
  type Question,
  type OptionChoix,
  POINTS_LIKERT_MIN,
  POINTS_LIKERT_MAX,
  type ModeleQuestion,
  modeleDeQuestion,
} from "./questionnaires-definition-socle";

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
