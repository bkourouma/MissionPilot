/**
 * Lecture des nombres et des textes saisis dans les écrans KPI. Voir `kpi-saisie.ts`, point
 * d'entrée du module.
 */
import {
  CHIFFRES_SIGNIFICATIFS_KPI,
  creerTraduire,
  LOCALES_INTL,
  valeurKpiSchema,
  type Langue,
} from "@missionpilot/shared";
import { normaliserNombreSaisi } from "./saisie";

// --- Lecture des nombres --------------------------------------------------------------------

export interface Lecture<T> {
  valeur: T | null;
  erreur: string | null;
}

/**
 * Nombre saisi sans espaces, point décimal : « -1 250,50 » → « -1250.50 » en français,
 * « -1,250.50 » → « -1250.50 » en anglais (voir `normaliserNombreSaisi`).
 */
function normaliser(v: string): string {
  return normaliserNombreSaisi(v);
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Parties d'un décimal normalisé, sans zéros de tête ni zéros décimaux de queue. */
function parties(brut: string) {
  const negatif = brut.startsWith("-");
  const [ent = "0", dec = ""] = brut.replace(/^-/, "").split(".");
  return { negatif, entier: ent.replace(/^0+(?=\d)/, ""), decimales: dec.replace(/0+$/, "") };
}

/**
 * Valeur d'un KPI (mesure, cible, seuil d'alerte) : au plus 15 chiffres entiers, 6 décimales
 * et 15 chiffres significatifs (exactitude d'un nombre JSON). Vide : `valeur` null.
 */
export function lireValeurKpi(v: string, langue: Langue = "fr"): Lecture<number> {
  const t = creerTraduire(langue);
  const brut = normaliser(v);
  if (brut === "") return { valeur: null, erreur: null };
  if (!DECIMAL.test(brut)) {
    return {
      valeur: null,
      erreur: t("Nombre attendu (ex. 1 250,5).", "Number expected (e.g. 1250.5)."),
    };
  }
  const { negatif, entier, decimales } = parties(brut);
  if (entier.length > 15) {
    return {
      valeur: null,
      erreur: t(
        "15 chiffres avant la virgule au plus.",
        "15 digits before the decimal point at most.",
      ),
    };
  }
  if (decimales.length > 6) {
    return { valeur: null, erreur: t("6 décimales au plus.", "6 decimals at most.") };
  }
  if ((entier + decimales).replace(/^0+/, "").length > CHIFFRES_SIGNIFICATIFS_KPI) {
    return {
      valeur: null,
      erreur: t(
        `${CHIFFRES_SIGNIFICATIFS_KPI} chiffres significatifs au plus : au-delà, la valeur ne serait pas enregistrée exactement.`,
        `${CHIFFRES_SIGNIFICATIFS_KPI} significant digits at most: beyond that, the value would not be stored exactly.`,
      ),
    };
  }
  const n = Number(`${negatif ? "-" : ""}${entier}${decimales ? `.${decimales}` : ""}`);
  const valeur = n === 0 ? 0 : n;
  if (!valeurKpiSchema.safeParse(valeur).success) {
    return {
      valeur: null,
      erreur: t(
        "Valeur refusée : trop de chiffres pour être exacte.",
        "Value refused: too many digits to be exact.",
      ),
    };
  }
  return { valeur, erreur: null };
}

/**
 * Pourcentage saisi (« 95 », « 87,5 ») → fraction exacte (0,95 ; 0,875) par décalage de la
 * virgule dans l'écriture décimale (aucune division flottante). Deux décimales au plus.
 */
export function lirePourcentage(v: string, max: number, langue: Langue = "fr"): Lecture<number> {
  const t = creerTraduire(langue);
  const brut = normaliser(v).replace(/%$/, "");
  if (brut === "") return { valeur: null, erreur: null };
  if (!/^\d+(\.\d+)?$/.test(brut)) {
    return {
      valeur: null,
      erreur: t(
        "Pourcentage positif attendu (ex. 95 ou 87,5).",
        "Positive percentage expected (e.g. 95 or 87.5).",
      ),
    };
  }
  const { entier, decimales } = parties(brut);
  if (decimales.length > 2) {
    return { valeur: null, erreur: t("2 décimales au plus.", "2 decimals at most.") };
  }
  if (Number(brut) > max) {
    const m = max.toLocaleString(LOCALES_INTL[langue]);
    return { valeur: null, erreur: t(`${m} % au plus.`, `${m}% at most.`) };
  }
  const chiffres = `${entier}${decimales}`;
  const position = entier.length - 2;
  const texte =
    position > 0
      ? `${chiffres.slice(0, position)}.${chiffres.slice(position)}`
      : `0.${"0".repeat(-position)}${chiffres}`;
  return { valeur: Number(texte), erreur: null };
}

/** Fraction de l'API (0,955) → pourcentage modifiable (« 95,5 »), par décalage de la virgule. */
export function fractionVersPourcentage(f: number | null | undefined): string {
  if (f === null || f === undefined || !Number.isFinite(f) || f < 0) return "";
  const s = String(f);
  if (!/^\d+(\.\d+)?$/.test(s)) return "";
  const [ent = "0", dec = ""] = s.split(".");
  const entier = `${ent}${dec.slice(0, 2).padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  const reste = dec.slice(2);
  return reste ? `${entier},${reste}` : entier;
}

/** Valeur de l'API → texte modifiable (« 1250,5 »). */
export function valeurVersSaisie(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(v).replace(".", ",");
}

/** Entier borné (délais, nombres de périodes). */
export function lireEntier(
  v: string,
  min: number,
  max: number,
  langue: Langue = "fr",
): Lecture<number> {
  const brut = v.trim();
  if (brut === "") return { valeur: null, erreur: null };
  if (!/^\d{1,4}$/.test(brut) || Number(brut) < min || Number(brut) > max) {
    return {
      valeur: null,
      erreur: creerTraduire(langue)(
        `Nombre entier de ${min} à ${max} attendu.`,
        `Whole number from ${min} to ${max} expected.`,
      ),
    };
  }
  return { valeur: Number(brut), erreur: null };
}

/** Pondération d'un KPI dans le score composite : 0 à 1000, quatre décimales au plus. */
export function lirePonderation(v: string, langue: Langue = "fr"): Lecture<number> {
  const t = creerTraduire(langue);
  const brut = normaliser(v);
  if (brut === "") {
    return {
      valeur: null,
      erreur: t(
        "La pondération est obligatoire (1 par défaut).",
        "The weighting is required (1 by default).",
      ),
    };
  }
  if (!/^\d+(\.\d+)?$/.test(brut)) {
    return {
      valeur: null,
      erreur: t(
        "Nombre positif attendu (ex. 1 ou 2,5).",
        "Positive number expected (e.g. 1 or 2.5).",
      ),
    };
  }
  const { entier, decimales } = parties(brut);
  if (decimales.length > 4) {
    return { valeur: null, erreur: t("4 décimales au plus.", "4 decimals at most.") };
  }
  const n = Number(`${entier}${decimales ? `.${decimales}` : ""}`);
  if (n > 1000) return { valeur: null, erreur: t("1 000 au plus.", "1,000 at most.") };
  return { valeur: n, erreur: null };
}

// --- Textes ---------------------------------------------------------------------------------

export const LIBELLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const UNITE_MAX = 40;
export const MOTIF_MAX = 500;
export const COMMENTAIRE_MAX = 1000;
export const JUSTIFICATIF_MAX = 500;

export function texteFacultatif(
  v: string,
  max: number,
  erreurs: Record<string, string>,
  champ: string,
  langue: Langue = "fr",
): string | null {
  const t = v.trim();
  if (t.length > max) erreurs[champ] = messageMaxCaracteres(max, langue);
  return t === "" ? null : t;
}

export function texteObligatoire(
  v: string,
  max: number,
  erreurs: Record<string, string>,
  champ: string,
  messageVide: string,
  langue: Langue = "fr",
): string {
  const t = v.trim();
  if (t === "") erreurs[champ] = messageVide;
  else if (t.length > max) erreurs[champ] = messageMaxCaracteres(max, langue);
  return t;
}

/** « 1 000 caractères au plus. » / « 1,000 characters at most. » */
export function messageMaxCaracteres(max: number, langue: Langue = "fr"): string {
  const n = max.toLocaleString(LOCALES_INTL[langue]);
  return creerTraduire(langue)(`${n} caractères au plus.`, `${n} characters at most.`);
}
