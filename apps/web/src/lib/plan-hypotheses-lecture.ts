/** Saisie des hypothèses : lecture et contrôles de forme des champs. */
import { LOCALES_INTL, creerTraduire, type Langue, type Traduire } from "@missionpilot/shared";
import type { ParAnnee } from "./plan-modele";
import { aideMontant, lireMontant, lireNombre } from "./saisie";
import type { Devise } from "./format";
import { LIBELLE_LIBRE_MAX, type SaisieParAnnee } from "./plan-hypotheses-saisie";

export type Erreurs = Record<string, string>;

/** Langue des messages écrits dans un objet d'erreurs (le français par défaut). */
const LANGUES_ERREURS = new WeakMap<object, Langue>();

/** Objet d'erreurs vide dont les messages seront écrits dans la langue demandée. */
export function creerErreurs(langue: Langue = "fr"): Erreurs {
  const erreurs: Erreurs = {};
  LANGUES_ERREURS.set(erreurs, langue);
  return erreurs;
}

const langueDe = (err: Erreurs): Langue => LANGUES_ERREURS.get(err) ?? "fr";
const traducteur = (err: Erreurs): Traduire => creerTraduire(langueDe(err));

/** Aide sur la précision d'un montant, dans la langue demandée. */
function aideMontantLangue(devise: Devise, langue: Langue): string {
  if (langue === "fr") return aideMontant(devise);
  const entier = devise === "XOF" || devise === "XAF";
  return entier
    ? "Whole amount, no decimals (e.g. 150,000)."
    : "Two decimals at most (e.g. 1,500.50).";
}

export const MESSAGE_REQUIS = "Champ obligatoire.";
export const MESSAGE_NOMBRE = "Nombre attendu (ex. 12,5).";
export const MESSAGE_ENTIER = "Nombre entier attendu.";
export const MESSAGE_REQUIS_EN = "Required field.";
export const MESSAGE_NOMBRE_EN = "Number expected (e.g. 12.5).";
export const MESSAGE_ENTIER_EN = "Whole number expected.";
const msgRequis = (err: Erreurs) => traducteur(err)(MESSAGE_REQUIS, MESSAGE_REQUIS_EN);

export interface BornesTaux {
  requis?: boolean;
  min?: number;
  max?: number;
  /** La borne basse est exclue (croissance > −100 %). */
  minExclu?: boolean;
}

export function messageBornes(b: BornesTaux, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  const n = (v: number) => v.toLocaleString(LOCALES_INTL[langue]);
  if (b.min !== undefined && b.max !== undefined && !b.minExclu) {
    return t(
      `Nombre attendu entre ${n(b.min)} et ${n(b.max)}.`,
      `Number expected between ${n(b.min)} and ${n(b.max)}.`,
    );
  }
  const parties: string[] = [];
  if (b.min !== undefined)
    parties.push(
      b.minExclu
        ? t(`supérieur à ${n(b.min)}`, `greater than ${n(b.min)}`)
        : t(`d'au moins ${n(b.min)}`, `at least ${n(b.min)}`),
    );
  if (b.max !== undefined) parties.push(t(`d'au plus ${n(b.max)}`, `at most ${n(b.max)}`));
  return t(`Nombre attendu ${parties.join(" et ")}.`, `Number expected ${parties.join(" and ")}.`);
}

/** Nombre décimal (taux en points, ETP, jours) ; `undefined` si vide et facultatif. */
export function lireTaux(
  v: string,
  cle: string,
  err: Erreurs,
  b: BornesTaux = {},
): number | undefined {
  const n = lireNombre(v);
  if (n === null) {
    if (b.requis) err[cle] = msgRequis(err);
    return undefined;
  }
  if (Number.isNaN(n)) {
    err[cle] = traducteur(err)(MESSAGE_NOMBRE, MESSAGE_NOMBRE_EN);
    return undefined;
  }
  const tropBas = b.min !== undefined && (b.minExclu ? n <= b.min : n < b.min);
  const tropHaut = b.max !== undefined && n > b.max;
  if (tropBas || tropHaut) {
    err[cle] = messageBornes(b, langueDe(err));
    return undefined;
  }
  return n;
}

export function lireEntier(
  v: string,
  cle: string,
  err: Erreurs,
  b: { requis?: boolean; min: number; max: number },
): number | undefined {
  const n = lireNombre(v);
  if (n === null) {
    if (b.requis) err[cle] = msgRequis(err);
    return undefined;
  }
  if (Number.isNaN(n) || !Number.isInteger(n)) {
    err[cle] = traducteur(err)(MESSAGE_ENTIER, MESSAGE_ENTIER_EN);
    return undefined;
  }
  if (n < b.min || n > b.max) {
    err[cle] = traducteur(err)(
      `Nombre entier de ${b.min} à ${b.max} attendu.`,
      `Whole number from ${b.min} to ${b.max} expected.`,
    );
    return undefined;
  }
  return n;
}

/** Montant saisi, signé si besoin (« -1 500 ») → unités mineures ; NaN si illisible. */
export function lireMontantSigne(v: string, devise: Devise): number | null {
  const t = v.trim();
  const negatif = /^[-−]/.test(t);
  const n = lireMontant(negatif ? t.slice(1) : t, devise);
  if (n === null) return negatif ? Number.NaN : null;
  if (Number.isNaN(n)) return n;
  return negatif && n !== 0 ? -n : n;
}

export function lireMontantChamp(
  v: string,
  cle: string,
  err: Erreurs,
  devise: Devise,
  o: { requis?: boolean; signe?: boolean; strict?: boolean } = {},
): number | undefined {
  const n = o.signe ? lireMontantSigne(v, devise) : lireMontant(v, devise);
  if (n === null) {
    if (o.requis) err[cle] = msgRequis(err);
    return undefined;
  }
  if (Number.isNaN(n)) {
    const t = traducteur(err);
    err[cle] = `${t(
      `Montant invalide${o.signe ? "" : " ou négatif"}.`,
      `Invalid amount${o.signe ? "" : " or negative"}.`,
    )} ${aideMontantLangue(devise, langueDe(err))}`;
    return undefined;
  }
  if (o.strict && n <= 0) {
    err[cle] = traducteur(err)(
      "Montant strictement positif attendu.",
      "Strictly positive amount expected.",
    );
    return undefined;
  }
  return n;
}

/** Hypothèse annuelle : une valeur, ou une valeur par année (toutes renseignées). */
export function lireParAnnee(
  p: SaisieParAnnee,
  cle: string,
  err: Erreurs,
  horizon: number,
  lire: (v: string, cle: string, requis: boolean) => number | undefined,
  requis: boolean,
): ParAnnee | undefined {
  if (p.mode === "unique") return lire(p.unique, cle, requis);
  const cases = Array.from({ length: horizon }, (_, i) => p.annees[i] ?? "");
  if (cases.every((c) => c.trim() === "")) {
    if (requis) err[cle] = msgRequis(err);
    return undefined;
  }
  const valeurs = cases.map((c, i) => {
    if (c.trim() === "") {
      err[`${cle}.${i}`] = traducteur(err)(
        "Renseignez chaque année, ou choisissez une valeur unique.",
        "Fill in every year, or choose a single value.",
      );
      return undefined;
    }
    return lire(c, `${cle}.${i}`, true);
  });
  return valeurs.every((v): v is number => v !== undefined) ? valeurs : undefined;
}

export function lireLibelle(v: string, cle: string, err: Erreurs): string {
  const t = v.trim();
  if (t === "") err[cle] = msgRequis(err);
  else if (t.length > LIBELLE_LIBRE_MAX)
    err[cle] = traducteur(err)(
      `${LIBELLE_LIBRE_MAX} caractères au plus.`,
      `${LIBELLE_LIBRE_MAX} characters at most.`,
    );
  return t;
}
