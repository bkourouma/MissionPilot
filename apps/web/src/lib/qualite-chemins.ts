/** Qualité : droits d'affichage et chemins (module extrait de `qualite.ts`). */
import { UUID } from "./qualite-uuid";
import { aPermission, STATUTS_SUIVI, type Role, type StatutSuivi } from "@missionpilot/shared";

export interface DroitsQualite {
  consulter: boolean;
  relire: boolean;
  signer: boolean;
  associe: boolean;
}

export function droitsQualite(roles: readonly Role[]): DroitsQualite {
  return {
    consulter: aPermission(roles, "mission.lire"),
    relire: aPermission(roles, "qualite.relire"),
    signer: aPermission(roles, "qualite.signer"),
    associe: roles.includes("associe"),
  };
}

// --- Chemins ---------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface FiltresQualite {
  statut: StatutSuivi | "";
  curseur: string;
  /** Mission dont on suit les livrables (UUID) ; vide : toutes les missions visibles. */
  mission: string;
}

export function lireFiltresQualite(
  p: Record<string, string | string[] | undefined>,
): FiltresQualite {
  const s = un(p.statut) ?? "";
  const c = un(p.curseur) ?? "";
  const m = un(p.mission) ?? "";
  return {
    statut: (STATUTS_SUIVI as readonly string[]).includes(s) ? (s as StatutSuivi) : "",
    curseur: /^[A-Za-z0-9_-]{1,500}$/.test(c) ? c : "",
    mission: UUID.test(m) ? m : "",
  };
}

export function cheminSuivis(f: Omit<FiltresQualite, "mission"> & { mission?: string }): string {
  const r = new URLSearchParams({ limite: "30" });
  if (f.mission) r.set("mission_id", f.mission);
  if (f.statut) r.set("statut", f.statut);
  if (f.curseur) r.set("curseur", f.curseur);
  return `/api/qualite/suivis?${r.toString()}`;
}

export function hrefQualite(f: Partial<FiltresQualite> = {}): string {
  const r = new URLSearchParams();
  if (f.mission) r.set("mission", f.mission);
  if (f.statut) r.set("statut", f.statut);
  if (f.curseur) r.set("curseur", f.curseur);
  const s = r.toString();
  return s ? `/qualite?${s}` : "/qualite";
}

/** Suivi qualité des livrables d'une mission (onglet « Qualité » de la mission). */
export const hrefQualiteMission = (missionId: string) => hrefQualite({ mission: missionId });

export const hrefSuivi = (id: string) => `/qualite/${segment(id)}`;
export const hrefAcceptation = (missionId: string) => `/qualite/acceptation/${segment(missionId)}`;
export const hrefSatisfaction = (missionId: string) =>
  `/qualite/satisfaction/${segment(missionId)}`;
export const cheminSuivi = (id: string) => `/api/qualite/suivis/${segment(id)}`;
export const cheminActionSuivi = (id: string, action: string) => `${cheminSuivi(id)}/${action}`;
export const cheminVu = (suiviId: string, elementId: string) =>
  `${cheminSuivi(suiviId)}/elements/${segment(elementId)}/vu`;
export const cheminAttestation = (suiviId: string, itemId: string) =>
  `${cheminSuivi(suiviId)}/verification/${segment(itemId)}/attestation`;
export const cheminTerminerSession = (id: string) =>
  `/api/qualite/sessions/${segment(id)}/terminer`;
export const cheminAcceptation = (missionId: string) =>
  `/api/qualite/missions/${segment(missionId)}/acceptation`;
export const cheminSatisfactions = (missionId: string) =>
  `/api/qualite/missions/${segment(missionId)}/satisfactions`;
