/**
 * Dépendances entre règles de modulation : une règle qui LIT l'état d'une
 * brique (condition `brique_active`) dépend de toutes les règles qui
 * ÉCRIVENT cette brique (effet `activer_brique` ou `retirer_brique`).
 *
 * L'ordre d'évaluation est un tri topologique (Kahn) qui, à égalité, prend la
 * priorité la plus haute puis le code le plus petit : sans dépendance, c'est
 * l'ordre des priorités. Un cycle (une règle qui lit la brique qu'elle écrit,
 * ou une boucle entre règles) rend le jeu inévaluable : les composantes
 * fortement connexes en cause sont renvoyées (Tarjan), triées.
 */
import { comparerCodes } from "./effets";
import { feuillesCondition } from "./structure";
import type { RegleModulation } from "./types";

function briquesLues(regle: RegleModulation): Set<string> {
  const lues = new Set<string>();
  feuillesCondition(regle.condition, "condition", (f) => {
    if (f.type === "brique_active") lues.add(f.brique);
  });
  return lues;
}

function briquesEcrites(regle: RegleModulation): Set<string> {
  const ecrites = new Set<string>();
  for (const e of regle.effets) {
    if (e.type === "activer_brique" || e.type === "retirer_brique") ecrites.add(e.brique);
  }
  return ecrites;
}

/** Ajoute en place à la liste d'une clé (une copie à chaque ajout serait quadratique). */
function ajouter(m: Map<string, string[]>, cle: string, valeur: string): void {
  const liste = m.get(cle);
  if (liste) liste.push(valeur);
  else m.set(cle, [valeur]);
}

/** Pour chaque règle (par code), les codes des règles dont elle dépend. */
export function dependancesRegles(regles: readonly RegleModulation[]): Map<string, Set<string>> {
  const ecrivains = new Map<string, string[]>();
  for (const r of regles) {
    for (const b of briquesEcrites(r)) ajouter(ecrivains, b, r.code);
  }
  return new Map(
    regles.map((r) => {
      const deps = new Set<string>();
      for (const b of briquesLues(r)) for (const w of ecrivains.get(b) ?? []) deps.add(w);
      return [r.code, deps];
    }),
  );
}

function avant(a: RegleModulation, b: RegleModulation): number {
  return b.priorite - a.priorite || comparerCodes(a.code, b.code);
}

/** Composantes fortement connexes cycliques (taille > 1, ou boucle sur soi), triées. */
function cycles(
  codes: readonly string[],
  deps: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const bas = new Map<string, number>();
  const pile: string[] = [];
  const surPile = new Set<string>();
  const resultat: string[][] = [];
  const visiter = (v: string): void => {
    indices.set(v, index);
    bas.set(v, index);
    index += 1;
    pile.push(v);
    surPile.add(v);
    for (const w of [...deps.get(v)!].sort(comparerCodes)) {
      if (!indices.has(w)) {
        visiter(w);
        bas.set(v, Math.min(bas.get(v)!, bas.get(w)!));
      } else if (surPile.has(w)) bas.set(v, Math.min(bas.get(v)!, indices.get(w)!));
    }
    if (bas.get(v) !== indices.get(v)) return;
    const composante: string[] = [];
    let w: string;
    do {
      w = pile.pop()!;
      surPile.delete(w);
      composante.push(w);
    } while (w !== v);
    if (composante.length > 1 || deps.get(v)?.has(v)) resultat.push(composante.sort(comparerCodes));
  };
  for (const c of [...codes].sort(comparerCodes)) if (!indices.has(c)) visiter(c);
  return resultat.sort((a, b) => comparerCodes(a[0]!, b[0]!));
}

/** Ordre d'évaluation des règles ; `cycles` non vide si le jeu est inévaluable. */
export function ordreEvaluation(regles: readonly RegleModulation[]): {
  ordre: RegleModulation[];
  cycles: string[][];
} {
  const deps = dependancesRegles(regles);
  const restantes = new Map<string, number>(regles.map((r) => [r.code, deps.get(r.code)!.size]));
  const suivants = new Map<string, string[]>();
  for (const [lecteur, ecrivains] of deps) {
    for (const e of ecrivains) ajouter(suivants, e, lecteur);
  }
  const parCode = new Map(regles.map((r) => [r.code, r]));
  const pretes = regles.filter((r) => restantes.get(r.code) === 0);
  const ordre: RegleModulation[] = [];
  while (pretes.length > 0) {
    pretes.sort(avant);
    const r = pretes.shift()!;
    ordre.push(r);
    for (const s of suivants.get(r.code) ?? []) {
      const reste = restantes.get(s)! - 1;
      restantes.set(s, reste);
      if (reste === 0) pretes.push(parCode.get(s)!);
    }
  }
  if (ordre.length === regles.length) return { ordre, cycles: [] };
  return { ordre, cycles: cycles([...deps.keys()], deps) };
}
