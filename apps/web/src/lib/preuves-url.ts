import { ErreurApi, messageErreur } from "./api";
import { hrefAssertions, hrefRegistre } from "./preuves-chemins";
import { FIABILITES, STATUTS_ASSERTION, TYPE_SOURCE_LIBELLES } from "./preuves-libelles";

// --- Erreurs --------------------------------------------------------------------------------

const MESSAGES_PREUVES: Record<string, string> = {
  MISSION_CLOTUREE: "La mission est clôturée : le registre des preuves est figé.",
  DIMENSION_INCONNUE: "Une dimension choisie n'existe pas (ou plus) pour cette mission.",
  DIMENSION_EXISTANTE: "Cette dimension existe déjà pour la mission.",
  PLAFOND_ATTEINT: "Cette mission atteint le plafond d'éléments de ce registre.",
  ARBITRAGE_INVALIDE:
    "Cette contradiction n'est plus à arbitrer : la preuve a changé ou n'est plus liée « contre ». Rechargez la page.",
  PREUVE_VERSION_CONCURRENTE:
    "Une autre correction vient d'être enregistrée. Rechargez la page puis recommencez.",
  PREUVE_INCOHERENTE:
    "Le document ou la réponse liés n'appartiennent pas à cette mission, ou l'auteur choisi n'est pas valide.",
  AVIS_EXPERT_INVALIDE: "Un avis d'expert est signé par l'auteur de la version.",
};

const MESSAGE_INTROUVABLE = "Cet élément n'existe plus ou n'est pas accessible. Rechargez la page.";

export function messagePreuves(e: unknown): string {
  if (e instanceof ErreurApi) {
    const specifique = MESSAGES_PREUVES[e.code];
    if (specifique) return specifique;
    if (e.statut === 404) return MESSAGE_INTROUVABLE;
    if (e.statut === 409 || (e.statut === 400 && e.message !== "Données invalides.")) {
      return e.message;
    }
  }
  return messageErreur(e);
}

/** Après ce refus, l'écran est probablement périmé : rafraîchir les données. */
export const etatPreuvesChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Paramètres d'URL des listes -------------------------------------------------------------

type ParamsUrl = Record<string, string | string[] | undefined>;

const premier = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

export interface ParametresRegistre {
  q?: string;
  type_source?: string;
  fiabilite?: string;
  dimension?: string;
  curseur?: string;
}

const TYPES_VALIDES = Object.keys(TYPE_SOURCE_LIBELLES);
const FIABILITES_VALIDES = Object.keys(FIABILITES);
const CODE_DIMENSION_URL = /^[a-z0-9_.-]{1,120}$/;

/** Paramètres du registre lus dans l'URL ; une valeur inconnue est écartée, jamais transmise. */
export function lireParametresRegistre(sp: ParamsUrl): ParametresRegistre {
  const q = premier(sp.q)?.trim().slice(0, 100);
  const type = premier(sp.type_source);
  const fiabilite = premier(sp.fiabilite);
  const dimension = premier(sp.dimension);
  const curseur = premier(sp.curseur);
  return {
    ...(q ? { q } : {}),
    ...(type && TYPES_VALIDES.includes(type) ? { type_source: type } : {}),
    ...(fiabilite && FIABILITES_VALIDES.includes(fiabilite) ? { fiabilite } : {}),
    ...(dimension && CODE_DIMENSION_URL.test(dimension) ? { dimension } : {}),
    ...(curseur && curseur.length <= 500 ? { curseur } : {}),
  };
}

function serialiser(p: Record<string, string | undefined>, extra: Record<string, string> = {}) {
  const u = new URLSearchParams();
  for (const [cle, valeur] of Object.entries({ ...p, ...extra })) {
    if (valeur) u.set(cle, valeur);
  }
  return u.toString();
}

export function requeteRegistre(p: ParametresRegistre): string {
  return serialiser({ ...p }, { limite: "30" });
}

/** Lien du registre avec les mêmes filtres et le curseur donné (`null` : début de la liste). */
export function hrefRegistreFiltre(
  missionId: string,
  p: ParametresRegistre,
  curseur: string | null,
): string {
  const filtres: Record<string, string | undefined> = { ...p, curseur: undefined };
  return hrefRegistre(missionId, serialiser(filtres, curseur ? { curseur } : {}));
}

export interface ParametresAssertions {
  q?: string;
  statut?: string;
  classe_risque?: string;
  curseur?: string;
}

const STATUTS_VALIDES = Object.keys(STATUTS_ASSERTION);
const CLASSES_VALIDES = ["R0", "R1", "R2", "R3"];

export function lireParametresAssertions(sp: ParamsUrl): ParametresAssertions {
  const q = premier(sp.q)?.trim().slice(0, 100);
  const statut = premier(sp.statut);
  const classe = premier(sp.classe_risque);
  const curseur = premier(sp.curseur);
  return {
    ...(q ? { q } : {}),
    ...(statut && STATUTS_VALIDES.includes(statut) ? { statut } : {}),
    ...(classe && CLASSES_VALIDES.includes(classe) ? { classe_risque: classe } : {}),
    ...(curseur && curseur.length <= 500 ? { curseur } : {}),
  };
}

export function requeteAssertions(p: ParametresAssertions): string {
  return serialiser({ ...p }, { limite: "30" });
}

export function hrefAssertionsFiltre(
  missionId: string,
  p: ParametresAssertions,
  curseur: string | null,
): string {
  const filtres: Record<string, string | undefined> = { ...p, curseur: undefined };
  return hrefAssertions(missionId, serialiser(filtres, curseur ? { curseur } : {}));
}
