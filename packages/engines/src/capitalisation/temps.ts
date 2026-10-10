import { ErreurCapitalisation } from "./erreurs";

/**
 * Temps de la capitalisation, en CENTIÈMES DE JOUR entiers (unité des lignes de temps,
 * `lignes_temps.centiemes`) : aucune somme ni conversion n'est faite en SQL ni dans l'API.
 */

const JOURS_TEXTE = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** « 1.5 », « 12.25 », « 3 » (numeric PostgreSQL rendu en texte) → centièmes exacts. */
export function centiemesDepuisJours(texte: string): number {
  const m = JOURS_TEXTE.exec(texte.trim());
  if (!m) throw new ErreurCapitalisation("JOURS_INVALIDES", `Nombre de jours illisible : ${texte}`);
  const entier = Number(m[1]);
  const decimales = (m[2] ?? "").padEnd(2, "0");
  return entier * 100 + Number(decimales);
}

function exigerCentiemes(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ErreurCapitalisation("CENTIEMES_INVALIDES", "Temps en centièmes de jour invalide.");
  }
}

/** Somme exacte de centièmes de jour. */
export function sommeCentiemes(valeurs: readonly number[]): number {
  let total = 0;
  for (const v of valeurs) {
    exigerCentiemes(v);
    total += v;
  }
  exigerCentiemes(total);
  return total;
}

export interface LigneTempsTache {
  tache_id: string;
  centiemes: number;
}

export interface LigneBudgetTache {
  tache_id: string;
  /** Jours budgétés (numeric rendu en texte, deux décimales au plus). */
  jours: string;
}

export interface TempsBrique {
  brique_code: string;
  realise_centiemes: number;
  budget_centiemes: number;
  taches: number;
}

/**
 * Temps réel et budget par brique, d'après le rattachement tâche → brique. Les tâches non
 * rattachées ne comptent pas ; une brique sans aucune ligne garde ses zéros. Tri par code.
 */
export function tempsParBrique(
  rattachements: readonly { tache_id: string; brique_code: string }[],
  temps: readonly LigneTempsTache[],
  budget: readonly LigneBudgetTache[],
): TempsBrique[] {
  const briqueDe = new Map(rattachements.map((r) => [r.tache_id, r.brique_code]));
  const parBrique = new Map<string, TempsBrique>();
  for (const r of rattachements) {
    const b = parBrique.get(r.brique_code) ?? {
      brique_code: r.brique_code,
      realise_centiemes: 0,
      budget_centiemes: 0,
      taches: 0,
    };
    b.taches += 1;
    parBrique.set(r.brique_code, b);
  }
  for (const t of temps) {
    const code = briqueDe.get(t.tache_id);
    if (code === undefined) continue;
    const b = parBrique.get(code) as TempsBrique;
    b.realise_centiemes = sommeCentiemes([b.realise_centiemes, t.centiemes]);
  }
  for (const l of budget) {
    const code = briqueDe.get(l.tache_id);
    if (code === undefined) continue;
    const b = parBrique.get(code) as TempsBrique;
    b.budget_centiemes = sommeCentiemes([b.budget_centiemes, centiemesDepuisJours(l.jours)]);
  }
  return [...parBrique.values()].sort((a, b) => a.brique_code.localeCompare(b.brique_code));
}

/** « 12,5 j », « 0 j », « 3,25 j » (virgule décimale, zéros inutiles retirés). */
export function formaterCentiemesJours(centiemes: number): string {
  exigerCentiemes(centiemes);
  const entier = Math.trunc(centiemes / 100);
  const reste = centiemes % 100;
  if (reste === 0) return `${entier} j`;
  const dec = String(reste).padStart(2, "0").replace(/0$/, "");
  return `${entier},${dec} j`;
}

/** Centièmes de jour → jours (nombre décimal exact à deux décimales, pour l'affichage et l'IA). */
export function centiemesEnJours(centiemes: number): number {
  exigerCentiemes(centiemes);
  return Number(`${Math.trunc(centiemes / 100)}.${String(centiemes % 100).padStart(2, "0")}`);
}
