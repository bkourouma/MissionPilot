import { STATUTS_APPEL_OFFRES, type StatutAppelOffres } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { FicheAo } from "./appels-offres-types";

// --- Chemins ---------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface FiltresAo {
  statut: StatutAppelOffres | "";
  q: string;
  curseur: string;
}

export function lireFiltresAo(p: Record<string, string | string[] | undefined>): FiltresAo {
  const s = un(p.statut) ?? "";
  const c = un(p.curseur) ?? "";
  return {
    statut: (STATUTS_APPEL_OFFRES as readonly string[]).includes(s) ? (s as StatutAppelOffres) : "",
    q: (un(p.q) ?? "").trim().slice(0, 100),
    curseur: /^[A-Za-z0-9_-]{1,500}$/.test(c) ? c : "",
  };
}

export function cheminFiches(f: FiltresAo): string {
  const r = new URLSearchParams({ limite: "50" });
  if (f.statut) r.set("statut", f.statut);
  if (f.q) r.set("q", f.q);
  if (f.curseur) r.set("curseur", f.curseur);
  return `/api/appels-offres?${r.toString()}`;
}

export function hrefAppelsOffres(f: Partial<FiltresAo> = {}): string {
  const r = new URLSearchParams();
  if (f.statut) r.set("statut", f.statut);
  if (f.q) r.set("q", f.q);
  if (f.curseur) r.set("curseur", f.curseur);
  const s = r.toString();
  return s ? `/appels-offres?${s}` : "/appels-offres";
}

export const hrefFiche = (id: string) => `/appels-offres/${segment(id)}`;
export const hrefGoNoGo = (id: string) => `/appels-offres/${segment(id)}/go-no-go`;
export const hrefMatrice = (id: string) => `/appels-offres/${segment(id)}/matrice`;
/** Personnes à qui confier une étape (utilisateurs actifs avec `ao.lire`, droit `tache.assigner`). */
export const CHEMIN_PERSONNES_ASSIGNABLES = "/api/appels-offres/assignables";
export const hrefRetroplanning = (id: string) => `/appels-offres/${segment(id)}/retroplanning`;

/** Fiches regroupées par statut, dans l'ordre du cycle de vie (colonnes du pipeline). */
export function regrouperParStatut(
  fiches: readonly FicheAo[],
): { statut: StatutAppelOffres; fiches: FicheAo[] }[] {
  return STATUTS_APPEL_OFFRES.map((statut) => ({
    statut,
    fiches: fiches.filter((f) => f.statut === statut),
  }));
}

/** Statuts que l'utilisateur pose à la main depuis un statut (les autres : décision). */
export function statutsManuels(s: StatutAppelOffres): ("depose" | "gagne" | "perdu")[] {
  if (s === "en_reponse") return ["depose"];
  if (s === "depose") return ["gagne", "perdu"];
  return [];
}

export const estOuverte = (s: StatutAppelOffres) =>
  s === "detecte" || s === "go_no_go" || s === "en_reponse";

// --- Erreurs ---------------------------------------------------------------------------------

const CODES_MESSAGE_API = new Set([
  "AO_REFERENCE_EXISTANTE",
  "AO_TRANSITION_REFUSEE",
  "AO_DECISION_REQUISE",
  "AO_MATRICE_NON_CONFORME",
  "AO_EXTRACTION_TRANCHEE",
  "AO_REPONSE_FIGEE",
  "AO_EVALUATION_PERIMEE",
  "AO_DATE_LIMITE_REQUISE",
  "AO_RETROPLANNING_EXISTANT",
  "MARGE_RESERVEE",
  "DATE_LIMITE_PASSEE",
  "GENERATION_IA_ECHEC",
  "TYPE_FICHIER_REFUSE",
  "FICHIER_TROP_VOLUMINEUX",
]);

export function messageAo(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return "Cet appel d'offres n'existe pas ou plus.";
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}
