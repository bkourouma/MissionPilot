/**
 * Validation d'une réponse isolée contre sa question (SOC-10).
 *
 * La validation normalise la valeur : texte débarrassé de ses espaces de bord,
 * choix multiple dédoublonné et rangé dans l'ordre des options. Une valeur
 * vide (`null`, texte blanc, liste vide) est valide et rendue `null` : le
 * caractère obligatoire se juge au niveau du questionnaire, selon la
 * visibilité (voir `validerReponses`).
 */
import { analyserDateISO } from "../commun/dates";
import {
  LONGUEUR_TEXTE_DEFAUT,
  estVide,
  type Question,
  type QuestionChoixMultiple,
  type QuestionDate,
  type QuestionNumerique,
  type ValeurReponse,
} from "./types";

export type CodeReponseInvalide =
  | "TYPE_INVALIDE"
  | "HORS_ECHELLE"
  | "OPTION_INCONNUE"
  | "SELECTION_INSUFFISANTE"
  | "SELECTION_EXCESSIVE"
  | "HORS_BORNES"
  | "NON_ENTIER"
  | "TROP_LONG"
  | "DATE_INVALIDE";

export type ResultatValidationReponse =
  | { readonly valide: true; readonly valeur: ValeurReponse | null }
  | { readonly valide: false; readonly code: CodeReponseInvalide; readonly message: string };

function refus(code: CodeReponseInvalide, message: string): ResultatValidationReponse {
  return { valide: false, code, message };
}

function accepte(valeur: ValeurReponse): ResultatValidationReponse {
  return { valide: true, valeur };
}

function validerChoixMultiple(
  q: QuestionChoixMultiple,
  valeur: unknown,
): ResultatValidationReponse {
  if (!Array.isArray(valeur) || !valeur.every((v) => typeof v === "string")) {
    return refus("TYPE_INVALIDE", "Une liste de choix est attendue.");
  }
  const codes = new Set<string>(valeur);
  const inconnu = [...codes].find((c) => !q.options.some((o) => o.code === c));
  if (inconnu !== undefined) return refus("OPTION_INCONNUE", `Choix inconnu : « ${inconnu} ».`);
  const min = q.minSelections ?? 1;
  const max = q.maxSelections ?? q.options.length;
  if (codes.size < min) {
    return refus("SELECTION_INSUFFISANTE", `Cochez au moins ${min} choix.`);
  }
  if (codes.size > max) return refus("SELECTION_EXCESSIVE", `Cochez au plus ${max} choix.`);
  return accepte(q.options.filter((o) => codes.has(o.code)).map((o) => o.code));
}

function validerNumerique(q: QuestionNumerique, valeur: unknown): ResultatValidationReponse {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) {
    return refus("TYPE_INVALIDE", "Un nombre est attendu.");
  }
  if (q.entier === true && !Number.isInteger(valeur)) {
    return refus("NON_ENTIER", "Un nombre entier est attendu.");
  }
  if ((q.min !== undefined && valeur < q.min) || (q.max !== undefined && valeur > q.max)) {
    const bornes = `${q.min ?? "−∞"} et ${q.max ?? "+∞"}`;
    return refus("HORS_BORNES", `La valeur doit être comprise entre ${bornes}.`);
  }
  return accepte(valeur);
}

function validerDate(q: QuestionDate, valeur: unknown): ResultatValidationReponse {
  if (typeof valeur !== "string" || !analyserDateISO(valeur).valide) {
    return refus("DATE_INVALIDE", "Une date au format AAAA-MM-JJ est attendue.");
  }
  if ((q.min !== undefined && valeur < q.min) || (q.max !== undefined && valeur > q.max)) {
    const bornes = `${q.min ?? "…"} et ${q.max ?? "…"}`;
    return refus("HORS_BORNES", `La date doit être comprise entre ${bornes}.`);
  }
  return accepte(valeur);
}

/** Valide et normalise la réponse `valeur` à la question `question`. */
export function validerReponse(question: Question, valeur: unknown): ResultatValidationReponse {
  if (estVide(valeur as ValeurReponse | null | undefined)) return { valide: true, valeur: null };
  switch (question.type) {
    case "likert":
      if (typeof valeur !== "number" || !Number.isInteger(valeur)) {
        return refus("TYPE_INVALIDE", "Un niveau entier de l'échelle est attendu.");
      }
      if (valeur < 1 || valeur > question.points) {
        return refus("HORS_ECHELLE", `Le niveau doit être compris entre 1 et ${question.points}.`);
      }
      return accepte(valeur);
    case "choix_unique":
      if (typeof valeur !== "string") return refus("TYPE_INVALIDE", "Un choix est attendu.");
      if (!question.options.some((o) => o.code === valeur)) {
        return refus("OPTION_INCONNUE", `Choix inconnu : « ${valeur} ».`);
      }
      return accepte(valeur);
    case "choix_multiple":
      return validerChoixMultiple(question, valeur);
    case "texte": {
      if (typeof valeur !== "string") return refus("TYPE_INVALIDE", "Un texte est attendu.");
      const texte = valeur.trim();
      const max = question.longueurMax ?? LONGUEUR_TEXTE_DEFAUT;
      if (texte.length > max) return refus("TROP_LONG", `${max} caractères au plus.`);
      return accepte(texte);
    }
    case "numerique":
      return validerNumerique(question, valeur);
    case "oui_non":
      if (typeof valeur !== "boolean") return refus("TYPE_INVALIDE", "Oui ou non est attendu.");
      return accepte(valeur);
    case "date":
      return validerDate(question, valeur);
  }
}
