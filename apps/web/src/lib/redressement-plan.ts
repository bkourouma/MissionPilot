/** Redressement : plan, kanban, créanciers et liste tronquée (suggestions d'affichage, l'API juge). */
import {
  RED_STATUT_ACTION_LIBELLES,
  RED_STATUTS_ACTION,
  type RedStatutAction,
} from "@missionpilot/shared";
import { formaterPointsDeBase } from "./redressement-formes";

// --- Plan et kanban -------------------------------------------------------------------------------

/**
 * Miroir d'AFFICHAGE de la matrice d'actions du moteur (`transitionActionAdmise`) : propose les
 * statuts de la liste « Déplacer vers… ». L'API refuse toute transition non admise.
 */
export const TRANSITIONS_SUGGEREES: Readonly<Record<RedStatutAction, readonly RedStatutAction[]>> =
  {
    a_faire: ["en_cours", "bloquee", "terminee", "abandonnee"],
    en_cours: ["bloquee", "terminee", "abandonnee"],
    bloquee: ["en_cours", "abandonnee"],
    terminee: [],
    abandonnee: [],
  };

export function statutsSuggeres(statut: RedStatutAction): { valeur: string; libelle: string }[] {
  return (TRANSITIONS_SUGGEREES[statut] ?? []).map((s) => ({
    valeur: s,
    libelle: RED_STATUT_ACTION_LIBELLES[s],
  }));
}

/** Un motif est demandé pour « Bloquée » et « Abandonnée ». */
export const exigeMotifAction = (vers: RedStatutAction) =>
  vers === "bloquee" || vers === "abandonnee";
/** Une date de fin est demandée pour « Terminée ». */
export const exigeDateFinAction = (vers: RedStatutAction) => vers === "terminee";

export interface CarteRang {
  id: string;
  rang: number;
}

/** Plafond du rang accepté par l'API (schéma partagé : 0 à 100 000). */
const RANG_MAX = 100_000;

/**
 * Mises à jour de rang à envoyer pour déplacer une action d'un cran dans sa colonne, ou `null`
 * au bord de la colonne. Le rang est une CLÉ DE TRI (l'API ordonne par rang, puis échéance, puis
 * numéro), pas une position : après l'échange, les rangs sont rendus strictement croissants en
 * conservant ceux qui le sont déjà, ce qui lève aussi les égalités (rang 0 par défaut). Seules
 * les cartes dont le rang change sont renvoyées.
 */
export function majsRangApresDeplacement(
  colonne: readonly CarteRang[],
  id: string,
  sens: "monter" | "descendre",
): CarteRang[] | null {
  const i = colonne.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const j = sens === "monter" ? i - 1 : i + 1;
  if (j < 0 || j >= colonne.length) return null;
  const ordre = [...colonne];
  const [a, b] = [ordre[i], ordre[j]];
  if (!a || !b) return null;
  ordre[i] = b;
  ordre[j] = a;
  const majs: CarteRang[] = [];
  let dernier = -1;
  for (const carte of ordre) {
    const rang = carte.rang > dernier ? carte.rang : dernier + 1;
    if (rang > RANG_MAX) return null;
    if (rang !== carte.rang) majs.push({ id: carte.id, rang });
    dernier = rang;
  }
  return majs;
}

export const STATUTS_ACTION_OPTIONS = RED_STATUTS_ACTION.map((s) => ({
  valeur: s,
  libelle: RED_STATUT_ACTION_LIBELLES[s],
}));

// --- Créanciers ----------------------------------------------------------------------------------

/** Part garantie ou concentration (points de base de l'API) : « 12,50 % » ; `null` → « — ». */
export function formaterPart(pb: number | null | undefined): string {
  return formaterPointsDeBase(pb, "pourcentage");
}

// --- Liste tronquée ---------------------------------------------------------------------------------

/** Avertissement quand une liste chargée page par page a été coupée par le garde-fou. */
export function avertissementTronque(tronquee: boolean): string | null {
  return tronquee
    ? "La liste est trop longue pour être affichée en entier : affinez les filtres ou ouvrez un élément précis."
    : null;
}
