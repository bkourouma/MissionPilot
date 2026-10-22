/** Sous-module de `questionnaires-definition.ts` : contrôle de forme local et localisation des anomalies. */
import { definitionQuestionnaireSchema } from "@missionpilot/shared";
import { tronquer } from "./questionnaires-definition-utilitaires";
import {
  type Definition,
  type Section,
  type Question,
  type Anomalie,
} from "./questionnaires-definition-socle";

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
