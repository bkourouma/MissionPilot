/**
 * Logique pure du rail de navigation : mémoire des groupes ouverts (stockage navigateur, jamais
 * bloquant) et navigation au clavier entre les entrées. Aucune dépendance au DOM : testée à part.
 */

/** Clé de stockage de la liste des groupes que la personne a laissés ouverts. */
export const CLE_GROUPES_RAIL = "mp:rail:groupes-ouverts";

/** Sous-ensemble de `Storage` dont le rail a besoin (permet d'injecter un faux en test). */
export interface StockageLecture {
  getItem(cle: string): string | null;
}
export interface StockageEcriture {
  setItem(cle: string, valeur: string): void;
}

/** Sérialise l'ensemble des groupes ouverts (ordre stable, sans doublon). */
export function serialiserGroupes(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)].sort());
}

/**
 * Relit la valeur stockée. `null` : rien d'exploitable (absente, JSON invalide, mauvais type).
 * Les identifiants inconnus (groupe retiré, droits changés) sont ignorés.
 */
export function lireGroupes(
  brut: string | null | undefined,
  connus: readonly string[],
): string[] | null {
  if (!brut) return null;
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!Array.isArray(valeur)) return null;
  const ok = new Set(connus);
  return [...new Set(valeur.filter((v): v is string => typeof v === "string" && ok.has(v)))];
}

/** Lit la mémoire du rail ; un stockage bloqué ou absent donne `null`, jamais une erreur. */
export function lireMemoireRail(
  stockage: StockageLecture | null | undefined,
  connus: readonly string[],
): string[] | null {
  try {
    return lireGroupes(stockage?.getItem(CLE_GROUPES_RAIL), connus);
  } catch {
    return null;
  }
}

/** Écrit la mémoire du rail ; renvoie `false` (sans lever) si le stockage est bloqué ou plein. */
export function ecrireMemoireRail(
  stockage: StockageEcriture | null | undefined,
  ids: Iterable<string>,
): boolean {
  try {
    if (!stockage) return false;
    stockage.setItem(CLE_GROUPES_RAIL, serialiserGroupes(ids));
    return true;
  } catch {
    return false;
  }
}

/** Stockage local du navigateur, ou `null` s'il est inaccessible (l'accès seul peut lever). */
export function stockageLocalSur(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Groupes à ouvrir après lecture de la mémoire : ceux que la personne avait laissés ouverts, plus
 * toujours celui de la page courante (on ne cache jamais l'endroit où l'on se trouve).
 */
export function groupesAOuvrir(
  memorises: readonly string[] | null,
  actifs: readonly string[],
): string[] {
  return [...new Set([...(memorises ?? []), ...actifs])];
}

/** « Tout replier » si tout est ouvert, « Tout déplier » sinon. */
export function toutEstOuvert(ouverts: ReadonlySet<string>, tous: readonly string[]): boolean {
  return tous.length > 0 && tous.every((id) => ouverts.has(id));
}

/** Bascule globale : tout replier si tout est ouvert, tout déplier sinon. */
export function basculerTous(ouverts: ReadonlySet<string>, tous: readonly string[]): Set<string> {
  return toutEstOuvert(ouverts, tous) ? new Set() : new Set(tous);
}

/**
 * Index à focaliser après une touche de direction dans le rail (flèches haut/bas, début, fin).
 * `null` : touche non gérée (le navigateur garde son comportement) ou liste vide. Pas de bouclage :
 * aux extrémités on reste sur place, comme dans une liste de menu.
 */
export function indexClavier(touche: string, courant: number, total: number): number | null {
  if (total <= 0) return null;
  switch (touche) {
    case "ArrowDown":
      return courant < 0 ? 0 : Math.min(courant + 1, total - 1);
    case "ArrowUp":
      return courant < 0 ? total - 1 : Math.max(courant - 1, 0);
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}
