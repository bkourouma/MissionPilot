/**
 * File d'attente locale de la feuille de temps (faible connectivité) : logique pure, testée
 * dans `file-sauvegarde.test.ts`.
 *
 * Chaque modification remplace l'instantané en attente de la feuille (une seule entrée par
 * feuille : l'API remplace toutes les lignes d'un coup, seul le dernier état compte). Il est
 * retiré quand l'API a confirmé l'enregistrement de CET instantané ; après une coupure ou un
 * rechargement, il est repris tant que la feuille reste modifiable. Rien d'autre que la saisie
 * (identifiants de tâches et valeurs) n'est conservé dans le navigateur.
 */
import { ErreurApi } from "./api";

/** Sous-ensemble de `localStorage`, injectable pour les tests. */
export interface Stockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

export interface Instantane {
  feuilleId: string;
  /** Clés des rangées affichées (tâches et activités ajoutées comprises). */
  rangees: string[];
  /** Texte saisi par case (`rangée|date`). */
  valeurs: Record<string, string>;
  /** Horodatage local de la modification (ms). */
  modifieLe: number;
}

const PREFIXE = "mp-temps-attente:";
export const cleFile = (feuilleId: string) => `${PREFIXE}${feuilleId}`;

function estInstantane(v: unknown, feuilleId: string): v is Instantane {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.feuilleId === feuilleId &&
    Array.isArray(o.rangees) &&
    o.rangees.every((r) => typeof r === "string") &&
    typeof o.valeurs === "object" &&
    o.valeurs !== null &&
    Object.values(o.valeurs as object).every((x) => typeof x === "string") &&
    typeof o.modifieLe === "number"
  );
}

/** Enregistre l'instantané ; `false` si le stockage est indisponible ou plein. */
export function mettreEnFile(stockage: Stockage | null, i: Instantane): boolean {
  if (!stockage) return false;
  try {
    stockage.setItem(cleFile(i.feuilleId), JSON.stringify(i));
    return true;
  } catch {
    return false;
  }
}

export function lireFile(stockage: Stockage | null, feuilleId: string): Instantane | null {
  if (!stockage) return null;
  try {
    const brut = stockage.getItem(cleFile(feuilleId));
    if (!brut) return null;
    const v = JSON.parse(brut) as unknown;
    return estInstantane(v, feuilleId) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Retire l'instantané confirmé par l'API. Un instantané plus récent (modification faite pendant
 * l'envoi) est conservé : il partira au prochain envoi.
 */
export function confirmerEnvoi(stockage: Stockage | null, feuilleId: string, modifieLe: number) {
  if (!stockage) return;
  const enAttente = lireFile(stockage, feuilleId);
  if (enAttente && enAttente.modifieLe > modifieLe) return;
  try {
    stockage.removeItem(cleFile(feuilleId));
  } catch {
    // Stockage indisponible : rien à retirer.
  }
}

export function abandonner(stockage: Stockage | null, feuilleId: string) {
  try {
    stockage?.removeItem(cleFile(feuilleId));
  } catch {
    // Stockage indisponible.
  }
}

/**
 * Instantané à reprendre au chargement : seulement si la feuille est encore modifiable et que
 * la saisie locale est postérieure à la dernière modification connue du serveur (sinon la
 * feuille a été modifiée ailleurs : la version du serveur fait foi).
 */
export function aReprendre(
  i: Instantane | null,
  feuille: { modifiable: boolean; modifieLe: string },
): Instantane | null {
  if (!i || !feuille.modifiable) return null;
  const serveur = Date.parse(feuille.modifieLe);
  if (Number.isFinite(serveur) && i.modifieLe <= serveur) return null;
  return i;
}

/** Une erreur réseau, un délai ou une indisponibilité se retente ; un refus de l'API, non. */
export function estReessayable(e: unknown): boolean {
  if (!(e instanceof ErreurApi)) return false;
  return e.statut === 0 || e.statut >= 500 || e.statut === 429;
}

/** Délai avant la nouvelle tentative : 2 s, 4 s, 8 s… plafonné à 30 s. */
export function delaiReprise(tentatives: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, Math.min(tentatives, 10)));
}

export type EtatSynchro = "a_jour" | "modifie" | "enregistrement" | "hors_ligne" | "refuse";

/** Message annoncé (role="status") pour chaque état de synchronisation. */
export const MESSAGE_SYNCHRO: Record<EtatSynchro, string> = {
  a_jour: "Brouillon enregistré.",
  modifie: "Modifications en cours…",
  enregistrement: "Enregistrement du brouillon…",
  hors_ligne:
    "Hors connexion : votre saisie est gardée sur cet appareil et sera envoyée dès le retour du réseau.",
  refuse: "Enregistrement refusé : corrigez la saisie signalée.",
};
