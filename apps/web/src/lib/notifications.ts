/**
 * Notifications in-app (SOC-08) : types, libellés et sécurité des liens. Logique pure, testée
 * dans `notifications.test.ts`. Titre et corps sont du texte brut : ils sont rendus comme du
 * texte par React (jamais interprétés comme du HTML).
 */
import { lienInterneSur } from "@missionpilot/shared";

export interface Notification {
  id: string;
  type: string;
  titre: string;
  corps: string | null;
  lien: string | null;
  lue_le: string | null;
  cree_le: string;
}

export interface PageNotifications {
  elements: Notification[];
  curseur_suivant: string | null;
  non_lues: number;
}

/**
 * Liens plus anciens que les écrans : l'API envoie encore `/mon-planning`, servi par
 * « Mon planning » (`/planning`).
 */
const ALIAS: readonly [string, string][] = [["/mon-planning", "/planning"]];

/**
 * Lien d'une notification utilisable dans l'application, ou `null` : uniquement un chemin
 * interne (une seule « / » initiale, sans schéma ni barre oblique inverse), jamais une adresse
 * externe, même si la base contenait une valeur inattendue.
 */
export function lienNotification(lien: string | null | undefined): string | null {
  if (!lien || !lienInterneSur(lien)) return null;
  for (const [ancien, nouveau] of ALIAS) {
    if (lien === ancien || lien.startsWith(`${ancien}?`) || lien.startsWith(`${ancien}/`)) {
      return nouveau + lien.slice(ancien.length);
    }
  }
  return lien;
}

/** Nom accessible de la cloche : « Notifications, 3 non lues ». */
export function libelleCloche(nonLues: number | null): string {
  if (nonLues === null || nonLues <= 0) return "Notifications, aucune non lue";
  return nonLues === 1 ? "Notifications, 1 non lue" : `Notifications, ${nonLues} non lues`;
}

/** Pastille affichée : « 9+ » au-delà de 9, rien sans notification non lue. */
export function pastilleCloche(nonLues: number | null): string | null {
  if (nonLues === null || nonLues <= 0) return null;
  return nonLues > 9 ? "9+" : String(nonLues);
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export function lireParametresNotifications(p: Record<string, string | string[] | undefined>): {
  nonLues: boolean;
  curseur: string;
} {
  const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const curseur = un(p.curseur) ?? "";
  return { nonLues: un(p.filtre) === "non_lues", curseur: CURSEUR.test(curseur) ? curseur : "" };
}

export function hrefNotifications(nonLues: boolean, curseur = ""): string {
  const r = new URLSearchParams();
  if (nonLues) r.set("filtre", "non_lues");
  if (curseur) r.set("curseur", curseur);
  const s = r.toString();
  return s ? `/notifications?${s}` : "/notifications";
}

/** Corps découpé en paragraphes (les retours à la ligne de l'API restent du texte). */
export const paragraphes = (corps: string | null): string[] =>
  (corps ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
