import { aPermission } from "@missionpilot/shared";
import type { ParametresCalendrier } from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { requeteInvalide } from "../errors.js";

/** Droits de lecture du budget : montants (honoraires, débours) et finance (coûts, marges). */
export interface DroitsBudget {
  montants: boolean;
  finance: boolean;
}

export function droitsBudget(auth: Auth): DroitsBudget {
  return {
    montants: aPermission(auth.roles, "budget.lire_montants"),
    finance: aPermission(auth.roles, "finance.lire"),
  };
}

/** Nombre de jours lu en base (numeric → chaîne). */
export const nombre = (v: unknown): number => Number(v);

/** Identifiant lisible et stable dérivé d'un libellé : « Frais de mission » → « frais_de_mission ». */
export function slug(texte: string): string {
  return (
    texte
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "ligne"
  );
}

/** Calendrier ouvré du cabinet (SOC-04) : jours travaillés et jours fériés. */
export async function chargerCalendrier(db: Db, cabinetId: string): Promise<ParametresCalendrier> {
  const cabinet = await db.query("SELECT jours_travailles FROM cabinets WHERE id = $1", [
    cabinetId,
  ]);
  const feries = await db.query("SELECT date::text AS date FROM cabinet_feries ORDER BY date");
  return {
    joursTravailles: (cabinet.rows[0]?.jours_travailles as number[] | undefined) ?? undefined,
    feries: feries.rows.map((r) => r.date as string),
  };
}

/** Correspondance code de grade → identifiant ; refuse les codes inconnus du cabinet. */
export async function gradesParCode(db: Db, codes: Iterable<string>): Promise<Map<string, string>> {
  const r = await db.query("SELECT id, code FROM grades");
  const index = new Map<string, string>(r.rows.map((g) => [g.code as string, g.id as string]));
  const inconnus = [...new Set(codes)].filter((c) => !index.has(c));
  if (inconnus.length > 0) {
    throw requeteInvalide(`Grade(s) inconnu(s) dans ce cabinet : ${inconnus.sort().join(", ")}.`);
  }
  return index;
}

/** Date du jour (UTC) au format AAAA-MM-JJ. */
export const aujourdhui = (): string => new Date().toISOString().slice(0, 10);
