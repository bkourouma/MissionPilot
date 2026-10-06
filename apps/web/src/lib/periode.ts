/**
 * Périodes saisies dans l'URL des écrans de finance (indicateurs, rentabilité, export) :
 * lecture et contrôle de dates « AAAA-MM-JJ », sans aucun calcul de chiffre métier.
 * Testé dans `periode.test.ts`.
 */

import { ecartJours } from "@missionpilot/shared";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Periode {
  du: string;
  au: string;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Date calendaire valide (2000-2100, plage acceptée par l'API), sinon `null`. */
export function dateValide(v: string): string | null {
  const m = DATE.exec(v);
  if (!m) return null;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100) return null;
  const d = new Date(Date.UTC(a, mo - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;
  return v;
}

/** Aujourd'hui en date calendaire UTC (fuseau d'Abidjan, sans heure d'été). */
export function aujourdhui(maintenant: Date = new Date()): string {
  return maintenant.toISOString().slice(0, 10);
}

/** Premier jour du mois d'une date « AAAA-MM-JJ ». */
export function debutDuMois(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Premier jour de l'année d'une date « AAAA-MM-JJ ». */
export function debutDAnnee(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

/**
 * Période lue dans les paramètres d'URL ; une date absente ou invalide reprend la valeur par
 * défaut, une période inversée est remplacée par la période par défaut (l'API la refuserait).
 */
export function lirePeriode(
  p: Record<string, string | string[] | undefined>,
  defaut: Periode,
  /** Durée maximale acceptée par l'API (règle des schémas partagés : écart < maxJours). */
  maxJours?: number,
): Periode & { corrigee: boolean } {
  const brutDu = un(p.du);
  const brutAu = un(p.au);
  const du = dateValide(brutDu) ?? defaut.du;
  const au = dateValide(brutAu) ?? defaut.au;
  if (au < du) return { ...defaut, corrigee: true };
  if (maxJours !== undefined && ecartJours(du, au) >= maxJours)
    return { ...defaut, corrigee: true };
  const invalide =
    (brutDu !== "" && dateValide(brutDu) === null) ||
    (brutAu !== "" && dateValide(brutAu) === null);
  return { du, au, corrigee: invalide };
}

/** Contrôle d'une période saisie dans un formulaire : message français, ou `null` si correcte. */
export function erreurPeriode(du: string, au: string): string | null {
  if (!dateValide(du) || !dateValide(au)) return "Saisissez deux dates valides (jj/mm/aaaa).";
  if (au < du) return "La fin de la période précède son début.";
  return null;
}
