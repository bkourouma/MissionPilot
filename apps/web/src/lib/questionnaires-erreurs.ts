/** Sous-module de `questionnaires.ts` : messages d'erreur et anomalies. */
import { ErreurApi } from "./api";
import { type Anomalie } from "./questionnaires-definition";
import { DELAI_RELANCE_HEURES } from "./questionnaires-types";

// --- Erreurs ----------------------------------------------------------------------------------

const ANOMALIE = /^([A-Z][A-Z0-9_]*) : ([\s\S]+)$/;

/**
 * Anomalies du moteur rendues par l'API (400 REQUETE_INVALIDE, `details.fieldErrors` indexés
 * par chemin, messages « CODE : message »). `null` si l'erreur n'en porte pas. Une erreur de
 * forme du schéma (clé `definition` ou `source`, message brut parfois en anglais) devient une
 * anomalie générique en français.
 */
export function anomaliesDepuisErreur(e: unknown): Anomalie[] | null {
  if (!(e instanceof ErreurApi) || e.code !== "REQUETE_INVALIDE") return null;
  const d = e.details as { fieldErrors?: Record<string, unknown> } | undefined;
  if (!d || typeof d !== "object" || !d.fieldErrors || typeof d.fieldErrors !== "object")
    return null;
  const anomalies: Anomalie[] = [];
  let forme = false;
  for (const [chemin, messages] of Object.entries(d.fieldErrors)) {
    const definition = chemin === "definition" || chemin === "source";
    for (const m of Array.isArray(messages) ? messages : []) {
      const r = typeof m === "string" ? ANOMALIE.exec(m) : null;
      if (r && !definition) {
        anomalies.push({ code: r[1] as string, chemin, message: (r[2] as string).trim() });
      } else if (definition) {
        forme = true;
      }
      // Autre champ refusé (répondants, mode…) : ce n'est pas une anomalie de définition,
      // il est signalé sur son champ par le formulaire (`champsRefuses`).
    }
  }
  if (forme) {
    anomalies.push({
      code: "FORME_INVALIDE",
      chemin: "",
      message:
        "Une partie de la définition a été refusée par le serveur : vérifiez les champs obligatoires et les longueurs.",
    });
  }
  return anomalies.length > 0 ? anomalies : null;
}

/** Message propre aux questionnaires (sinon `null` : message générique de `messageErreur`). */
export function messageQuestionnaire(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  const anomalies = anomaliesDepuisErreur(e);
  if (anomalies) {
    return anomalies.length === 1
      ? "La définition comporte une anomalie : corrigez-la puis enregistrez de nouveau."
      : `La définition comporte ${anomalies.length} anomalies : corrigez-les puis enregistrez de nouveau.`;
  }
  if (e.statut === 404) {
    return "Questionnaire introuvable : il a été retiré, ou vous n'y avez plus accès.";
  }
  // 409 (version figée, envoi clos, mission clôturée, brouillon existant, code déjà pris) et
  // 400 métier (répondant invalide) : le message de l'API est en français et précis.
  if (e.statut === 409 || (e.statut === 400 && e.code !== "REQUETE_INVALIDE")) return e.message;
  return null;
}

/** Message d'une relance refusée : 409 = déjà relancé il y a moins de 24 h, ou plus en attente. */
export function messageRelance(e: unknown): string | null {
  if (e instanceof ErreurApi && e.statut === 409) {
    const regle = /24\s*h/.test(e.message)
      ? ""
      : ` Un répondant ne se relance qu'une fois par période de ${DELAI_RELANCE_HEURES} heures, et seulement tant qu'il n'a pas soumis.`;
    return `Relance refusée : ${e.message}${regle}`;
  }
  return messageQuestionnaire(e);
}
