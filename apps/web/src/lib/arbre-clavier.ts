/*
 * Navigation clavier d'un arbre ARIA (role="tree"), en logique pure : le composant ne fait que
 * traduire le résultat en focus et en état replié. Modèle de référence : l'arbre de navigation des
 * pratiques de création ARIA (flèches haut/bas, droite/gauche, Début, Fin).
 */

export interface NoeudNavigable {
  id: string;
  enfants: readonly NoeudNavigable[];
}

export interface ElementVisible {
  id: string;
  parentId: string | null;
  /** Niveau ARIA, à partir de 1. */
  niveau: number;
  aEnfants: boolean;
  deplie: boolean;
}

/** Éléments visibles dans l'ordre d'affichage : les enfants d'un nœud replié sont omis. */
export function aplatirArbre(
  arbre: readonly NoeudNavigable[],
  replies: ReadonlySet<string>,
): ElementVisible[] {
  const sortie: ElementVisible[] = [];
  const parcourir = (
    noeuds: readonly NoeudNavigable[],
    parentId: string | null,
    niveau: number,
  ) => {
    for (const n of noeuds) {
      const aEnfants = n.enfants.length > 0;
      const deplie = aEnfants && !replies.has(n.id);
      sortie.push({ id: n.id, parentId, niveau, aEnfants, deplie });
      if (deplie) parcourir(n.enfants, n.id, niveau + 1);
    }
  };
  parcourir(arbre, null, 1);
  return sortie;
}

export type ActionArbre =
  | { type: "focus"; id: string }
  | { type: "deplier"; id: string }
  | { type: "replier"; id: string }
  | null;

/** Action déclenchée par une touche sur l'élément `courantId` (null : touche non gérée). */
export function actionClavierArbre(
  visibles: readonly ElementVisible[],
  courantId: string,
  touche: string,
): ActionArbre {
  const i = visibles.findIndex((v) => v.id === courantId);
  const courant = visibles[i];
  if (!courant) return null;
  switch (touche) {
    case "ArrowDown":
      return i < visibles.length - 1 ? { type: "focus", id: visibles[i + 1]!.id } : null;
    case "ArrowUp":
      return i > 0 ? { type: "focus", id: visibles[i - 1]!.id } : null;
    case "Home":
      return i > 0 ? { type: "focus", id: visibles[0]!.id } : null;
    case "End":
      return i < visibles.length - 1
        ? { type: "focus", id: visibles[visibles.length - 1]!.id }
        : null;
    case "ArrowRight":
      if (!courant.aEnfants) return null;
      if (!courant.deplie) return { type: "deplier", id: courant.id };
      // Le premier enfant suit immédiatement son parent dans la liste des éléments visibles.
      return { type: "focus", id: visibles[i + 1]!.id };
    case "ArrowLeft":
      if (courant.deplie) return { type: "replier", id: courant.id };
      return courant.parentId ? { type: "focus", id: courant.parentId } : null;
    default:
      return null;
  }
}

/** Nouvel ensemble de nœuds repliés après une action de repli ou de dépli. */
export function appliquerRepli(replies: ReadonlySet<string>, action: ActionArbre): Set<string> {
  const suivant = new Set(replies);
  if (action?.type === "replier") suivant.add(action.id);
  if (action?.type === "deplier") suivant.delete(action.id);
  return suivant;
}

/**
 * Élément qui porte le focus par défaut (tabindex 0, les autres -1) : l'élément courant s'il est
 * encore visible, sinon le premier.
 */
export function elementFocalisable(
  visibles: readonly ElementVisible[],
  courantId: string | null,
): string | null {
  if (courantId && visibles.some((v) => v.id === courantId)) return courantId;
  return visibles[0]?.id ?? null;
}
