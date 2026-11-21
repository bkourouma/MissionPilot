import type { Langue } from "@missionpilot/shared";
import { grouperEntrees, type EntreeNavigation, type GroupeNavigation } from "../../lib/navigation";

/**
 * Modules « du quotidien » mis en tête de l'accueil, dans cet ordre. Ce sont des identifiants de
 * la table de navigation : aucune route ni permission n'est inventée ici, une entrée absente
 * (droit manquant) ou pas encore disponible est simplement ignorée.
 */
export const MODULES_QUOTIDIEN: readonly string[] = [
  "mon-brief",
  "mon-planning",
  "feuille-de-temps",
  "mes-taches",
  "missions",
  "copilote",
];

export interface RepartitionModules {
  /** Modules du quotidien utilisables, dans l'ordre de `MODULES_QUOTIDIEN`. */
  quotidien: EntreeNavigation[];
  /** Les autres modules utilisables, regroupés par métier. */
  groupes: GroupeNavigation[];
  /** Modules « Pas encore disponible », mis à part pour ne pas se mélanger aux autres. */
  indisponibles: EntreeNavigation[];
  /** Nombre de modules utilisables (quotidien compris). */
  nbDisponibles: number;
}

/**
 * Répartit les entrées visibles (déjà filtrées par rôle) entre quotidien, groupes de modules
 * utilisables et modules indisponibles. L'entrée « Tableau de bord » (la page elle-même) est exclue.
 */
export function repartirModules(
  entrees: readonly EntreeNavigation[],
  langue: Langue = "fr",
  quotidien: readonly string[] = MODULES_QUOTIDIEN,
): RepartitionModules {
  const autres = entrees.filter((e) => e.id !== "tableau-de-bord");
  const disponibles = autres.filter((e) => e.disponible);
  const parId = new Map(disponibles.map((e) => [e.id, e]));
  const entreesQuotidien = [...new Set(quotidien)].flatMap((id) => parId.get(id) ?? []);
  const idsQuotidien = new Set(entreesQuotidien.map((e) => e.id));
  const reste = disponibles.filter((e) => !idsQuotidien.has(e.id));
  return {
    quotidien: entreesQuotidien,
    groupes: grouperEntrees(reste, langue),
    indisponibles: autres.filter((e) => !e.disponible),
    nbDisponibles: disponibles.length,
  };
}

/** « 1 module », « 12 modules » : accord seul, le mot est traduit par l'appelant. */
export const pluriel = (n: number): boolean => n > 1;
