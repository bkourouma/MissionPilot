/** Navigation clavier d'une grille de saisie (lignes x colonnes) : logique pure, testée. */

export interface PositionGrille {
  ligne: number;
  colonne: number;
}

export interface ContexteTouche {
  key: string;
  shiftKey?: boolean;
  /** Position du curseur dans le champ (début, fin) et longueur du texte. */
  debutSelection: number;
  finSelection: number;
  longueur: number;
}

/**
 * Curseur au bord demandé : curseur simple à ce bord, ou sélection couvrant tout le texte
 * (case focalisée, contenu sélectionné : la première flèche doit déjà changer de case).
 */
function auBord(c: ContexteTouche, bord: "debut" | "fin"): boolean {
  if (c.debutSelection === 0 && c.finSelection === c.longueur) return true;
  if (c.debutSelection !== c.finSelection) return false;
  return bord === "debut" ? c.debutSelection === 0 : c.finSelection >= c.longueur;
}

/**
 * Pas de déplacement demandé par une touche, ou `null` si la touche garde son rôle normal.
 * Haut/bas et Entrée (Maj+Entrée remonte) changent de ligne ; gauche/droite changent de
 * colonne seulement quand le curseur est au bord du texte (sinon le champ garde la main).
 */
export function pasDeTouche(c: ContexteTouche): { dl: number; dc: number } | null {
  switch (c.key) {
    case "ArrowDown":
      return { dl: 1, dc: 0 };
    case "ArrowUp":
      return { dl: -1, dc: 0 };
    case "Enter":
      return { dl: c.shiftKey ? -1 : 1, dc: 0 };
    case "ArrowRight":
      return auBord(c, "fin") ? { dl: 0, dc: 1 } : null;
    case "ArrowLeft":
      return auBord(c, "debut") ? { dl: 0, dc: -1 } : null;
    default:
      return null;
  }
}

/**
 * Prochaine case à focaliser dans la direction du pas, en sautant les cases absentes
 * (jour clôturé, colonne repliée). `null` au bord de la grille : le focus ne bouge pas.
 */
export function cibleGrille(
  depart: PositionGrille,
  pas: { dl: number; dc: number },
  taille: { lignes: number; colonnes: number },
  existe: (p: PositionGrille) => boolean,
): PositionGrille | null {
  let ligne = depart.ligne + pas.dl;
  let colonne = depart.colonne + pas.dc;
  while (ligne >= 0 && ligne < taille.lignes && colonne >= 0 && colonne < taille.colonnes) {
    if (existe({ ligne, colonne })) return { ligne, colonne };
    ligne += pas.dl;
    colonne += pas.dc;
  }
  return null;
}
