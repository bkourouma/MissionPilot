/** Modèle financier du plan : mise en forme des valeurs des états. */
import type { Langue } from "@missionpilot/shared";
import {
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";
import { JOURS_EXERCICE } from "./plan-modele-types";

const NBSP = " ";

export type FormatValeur = "montant" | "pourcentage" | "multiple" | "annees" | "jours";

/** Valeur d'une ligne, mise en forme sans calcul (« — » si absente ou non définie). */
export function formaterValeur(
  format: FormatValeur,
  valeur: number | null | undefined,
  devise: Devise,
  langue: Langue = "fr",
): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  const en = langue === "en";
  switch (format) {
    case "montant":
      return formaterMontantMineur(valeur, devise, langue);
    case "pourcentage":
      return formaterPourcentage(valeur, 1, langue);
    case "multiple":
      return formaterNombre(valeur, 2, langue);
    case "annees":
      return en
        ? `${formaterNombre(valeur, 2, langue)}${NBSP}year${Math.abs(valeur) >= 2 ? "s" : ""}`
        : `${formaterNombre(valeur, 2)}${NBSP}an${Math.abs(valeur) >= 2 ? "s" : ""}`;
    case "jours":
      if (en) {
        return valeur > JOURS_EXERCICE
          ? `${formaterNombre(valeur, 0, langue)}${NBSP}days (not reached within the year)`
          : `${formaterNombre(valeur, 0, langue)}${NBSP}days`;
      }
      return valeur > JOURS_EXERCICE
        ? `${formaterNombre(valeur, 0)}${NBSP}jours (non atteint dans l'exercice)`
        : `${formaterNombre(valeur, 0)}${NBSP}jours`;
  }
}

/** Taux exprimé en points par le moteur (12 → « 12 % »). */
export function formaterPoints(points: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof points !== "number" || !Number.isFinite(points)) return VALEUR_ABSENTE;
  return `${formaterNombre(points, 2, langue)}${NBSP}%`;
}

/** Nombre signé pour un écart (+5, −2, 0). */
export function formaterSigne(v: number, langue: Langue = "fr"): string {
  return v > 0 ? `+${formaterNombre(v, 2, langue)}` : formaterNombre(v, 2, langue);
}
