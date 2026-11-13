/** Sous-module de `questionnaires-definition.ts` : mise en forme des réponses. */
import { type Langue } from "@missionpilot/shared";
import { formaterDate } from "./format";
import { type Question } from "./questionnaires-definition-socle";
import { decrireValeur } from "./questionnaires-definition-conditions";

// --- Réponses ---------------------------------------------------------------------------------

/**
 * Réponse soumise mise en forme selon sa question ; `null` si la question n'a pas de réponse.
 * Une valeur d'un type inattendu est rendue telle quelle (jamais masquée).
 */
export function formaterReponse(q: Question, v: unknown, langue: Langue = "fr"): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (Array.isArray(v) && v.length === 0) return null;
  switch (q.type) {
    case "likert":
      return typeof v === "number" ? decrireValeur(q, v, langue) : String(v);
    case "choix_unique":
      return typeof v === "string" ? decrireValeur(q, v, langue) : String(v);
    case "choix_multiple":
      return Array.isArray(v)
        ? v.map((x) => decrireValeur(q, String(x), langue)).join(", ")
        : String(v);
    case "oui_non":
      return typeof v === "boolean"
        ? v
          ? langue === "en"
            ? "Yes"
            : "Oui"
          : langue === "en"
            ? "No"
            : "Non"
        : String(v);
    case "numerique":
      return typeof v === "number" ? decrireValeur(q, v, langue) : String(v);
    case "date":
      return typeof v === "string" ? formaterDate(v, undefined, langue) : String(v);
    case "texte":
      return String(v);
  }
}
