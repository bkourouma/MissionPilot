/** IA : coûts (ia.configurer ET finance.lire), mois affichés et état du plafond. */
import { aPermission, SEUILS_ALERTE_PLAFOND_IA, type Role } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { Devise } from "./format";

const NBSP = " ";

// --- Coûts (ia.configurer ET finance.lire) ---------------------------------------------------

export interface CoutsMoisIa {
  mois: string;
  cout_micro_usd: number;
  appels: number;
  appels_cache: number;
}

/** GET /api/ia/couts?mois=AAAA-MM. */
export interface CoutsIa {
  unite: string;
  seuil_ratio_mission: number;
  taux_conversion: { usd_vers: Partial<Record<Devise, number>>; date: string; a_valider: boolean };
  mois: string;
  cout_micro_usd: number;
  /** Appels au fournisseur (hors générations servies par le cache). */
  appels: number;
  /** Générations servies par le cache des réponses (coût nul). */
  appels_cache: number;
  plafond_mensuel_micro_usd: number;
  /** Plafond appliqué (borné par l'opérateur avec la clé de plateforme) ; base de `part_plafond`. */
  plafond_effectif_micro_usd: number;
  /** Part consommée du plafond EFFECTIF (calculée par l'API) ; null pour un plafond nul. */
  part_plafond: number | null;
  historique: CoutsMoisIa[];
}

/** GET /api/ia/couts/missions. */
export interface CoutMissionIa {
  mission_id: string;
  intitule: string | null;
  cout_micro_usd: number;
  appels: number;
  devise: Devise;
  cout_devise: number;
  prix_mission: number | null;
  ratio_cout_prix: number | null;
  depasse_seuil: boolean | null;
}

/** Droits de lecture des coûts (confort d'affichage : l'API répond 403 sinon). */
export const voitCoutsIa = (roles: readonly Role[]) =>
  aPermission(roles, "ia.configurer") && aPermission(roles, "finance.lire");

export const FORMAT_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

export const moisDe = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Générations servies par le cache des réponses (AGT-06) : sans appel au fournisseur, à coût nul.
 * Une réponse plus ancienne de l'API (sans le compteur) est lue comme zéro.
 */
export function libelleServiesCache(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
  const nombre = new Intl.NumberFormat("fr-FR").format(v).replace(/\p{Zs}/gu, NBSP);
  return `${nombre}${NBSP}${v > 1 ? "générations reprises" : "génération reprise"} du cache, sans coût`;
}

/** Mois lu dans l'URL, sinon le mois en cours (UTC, comme l'API). */
export function lireMois(v: unknown, maintenant: Date): string {
  return typeof v === "string" && FORMAT_MOIS.test(v) ? v : moisDe(maintenant);
}

/** « 2026-10 » décalé de `delta` mois. */
export function decalerMois(mois: string, delta: number): string {
  const [a, m] = mois.split("-").map(Number);
  return moisDe(new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1 + delta, 1)));
}

/** « 2026-10 » → « octobre 2026 ». */
export function libelleMois(mois: string): string {
  if (!FORMAT_MOIS.test(mois)) return mois;
  const [a, m] = mois.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, 1)));
}

/** État du plafond d'après la part consommée calculée par l'API (seuils d'alerte 80 et 100 %). */
export function etatPlafond(part: number | null | undefined): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  if (typeof part !== "number" || !Number.isFinite(part)) {
    return { libelle: "Plafond nul : aucun appel facturé", tonalite: "neutre" };
  }
  const [alerte = 80, atteint = 100] = SEUILS_ALERTE_PLAFOND_IA;
  if (part * 100 >= atteint) return { libelle: "Plafond atteint", tonalite: "danger" };
  if (part * 100 >= alerte)
    return { libelle: `Plus de ${alerte} % consommés`, tonalite: "attention" };
  return { libelle: "Sous le plafond", tonalite: "succes" };
}

export function hrefCoutsIa(mois: string, curseurMissions?: string | null): string {
  const p = new URLSearchParams({ mois });
  if (curseurMissions) p.set("missions", curseurMissions);
  return `/parametres/ia?${p.toString()}#couts`;
}
