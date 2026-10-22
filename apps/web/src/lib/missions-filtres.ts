/** Missions : filtres de la liste (lecture de l'URL, requête API, lien). */
import { STATUTS_MISSION, type StatutMission } from "@missionpilot/shared";
import type { PageCurseur } from "./pagination";
import { UUID } from "./missions-motifs";
import type { Mission } from "./missions-types";

// --- Filtres de la liste --------------------------------------------------------------

/** Réponse de `GET /api/missions` : page et curseur de la suivante (null à la fin). */
export type PageMissions = PageCurseur<Mission>;

export interface FiltresMissions {
  statut: StatutMission | "";
  client_id: string;
  directeur_id: string;
  q: string;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uuidOuVide = (v: string | undefined) => (v && UUID.test(v) ? v : "");

export function lireFiltresMissions(
  p: Record<string, string | string[] | undefined>,
): FiltresMissions {
  const s = un(p.statut) ?? "";
  return {
    statut: (STATUTS_MISSION as readonly string[]).includes(s) ? (s as StatutMission) : "",
    client_id: uuidOuVide(un(p.client_id)),
    directeur_id: uuidOuVide(un(p.directeur_id)),
    q: (un(p.q) ?? "").trim().slice(0, 100),
  };
}

/**
 * Requête `GET /api/missions?…` (le directeur est filtré dans la page : l'API ne le propose pas).
 * La réponse est paginée par curseur (`PageMissions`, 100 par défaut, 500 au plus) : les
 * pages chargent toute la liste par `chargerToutesLesPages` (`lib/pagination.ts`).
 */
export function requeteMissions(f: FiltresMissions): string {
  const r = new URLSearchParams();
  if (f.statut) r.set("statut", f.statut);
  if (f.client_id) r.set("client_id", f.client_id);
  if (f.q) r.set("q", f.q);
  return r.toString();
}

export function hrefMissions(f: FiltresMissions): string {
  const r = new URLSearchParams();
  if (f.q) r.set("q", f.q);
  if (f.statut) r.set("statut", f.statut);
  if (f.client_id) r.set("client_id", f.client_id);
  if (f.directeur_id) r.set("directeur_id", f.directeur_id);
  const s = r.toString();
  return s ? `/missions?${s}` : "/missions";
}

export function filtrerParDirecteur<T extends Pick<Mission, "directeur_id">>(
  missions: readonly T[],
  directeurId: string,
): T[] {
  return directeurId ? missions.filter((m) => m.directeur_id === directeurId) : [...missions];
}
