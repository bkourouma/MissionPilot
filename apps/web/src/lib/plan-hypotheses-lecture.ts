/** Saisie des hypothèses : lecture et contrôles de forme des champs. */
import type { ParAnnee } from "./plan-modele";
import { aideMontant, lireMontant, lireNombre } from "./saisie";
import type { Devise } from "./format";
import { LIBELLE_LIBRE_MAX, type SaisieParAnnee } from "./plan-hypotheses-saisie";

export type Erreurs = Record<string, string>;

export const MESSAGE_REQUIS = "Champ obligatoire.";
export const MESSAGE_NOMBRE = "Nombre attendu (ex. 12,5).";
export const MESSAGE_ENTIER = "Nombre entier attendu.";

export interface BornesTaux {
  requis?: boolean;
  min?: number;
  max?: number;
  /** La borne basse est exclue (croissance > −100 %). */
  minExclu?: boolean;
}

export function messageBornes(b: BornesTaux): string {
  const n = (v: number) => v.toLocaleString("fr-FR");
  if (b.min !== undefined && b.max !== undefined && !b.minExclu) {
    return `Nombre attendu entre ${n(b.min)} et ${n(b.max)}.`;
  }
  const parties: string[] = [];
  if (b.min !== undefined)
    parties.push(b.minExclu ? `supérieur à ${n(b.min)}` : `d'au moins ${n(b.min)}`);
  if (b.max !== undefined) parties.push(`d'au plus ${n(b.max)}`);
  return `Nombre attendu ${parties.join(" et ")}.`;
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
    if (b.requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  if (Number.isNaN(n)) {
    err[cle] = MESSAGE_NOMBRE;
    return undefined;
  }
  const tropBas = b.min !== undefined && (b.minExclu ? n <= b.min : n < b.min);
  const tropHaut = b.max !== undefined && n > b.max;
  if (tropBas || tropHaut) {
    err[cle] = messageBornes(b);
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
    if (b.requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  if (Number.isNaN(n) || !Number.isInteger(n)) {
    err[cle] = MESSAGE_ENTIER;
    return undefined;
  }
  if (n < b.min || n > b.max) {
    err[cle] = `Nombre entier de ${b.min} à ${b.max} attendu.`;
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
    if (o.requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  if (Number.isNaN(n)) {
    err[cle] = `Montant invalide${o.signe ? "" : " ou négatif"}. ${aideMontant(devise)}`;
    return undefined;
  }
  if (o.strict && n <= 0) {
    err[cle] = "Montant strictement positif attendu.";
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
    if (requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  const valeurs = cases.map((c, i) => {
    if (c.trim() === "") {
      err[`${cle}.${i}`] = "Renseignez chaque année, ou choisissez une valeur unique.";
      return undefined;
    }
    return lire(c, `${cle}.${i}`, true);
  });
  return valeurs.every((v): v is number => v !== undefined) ? valeurs : undefined;
}

export function lireLibelle(v: string, cle: string, err: Erreurs): string {
  const t = v.trim();
  if (t === "") err[cle] = MESSAGE_REQUIS;
  else if (t.length > LIBELLE_LIBRE_MAX) err[cle] = `${LIBELLE_LIBRE_MAX} caractères au plus.`;
  return t;
}
