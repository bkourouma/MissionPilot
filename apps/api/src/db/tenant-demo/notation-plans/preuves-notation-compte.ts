import type { ContexteTenantDemo } from "../contexte.js";

/*
 * Comptage des lignes du registre des preuves créées par l'étape « preuves-notation » (lot 3)
 * pour une mission : affirmations du livrable « Notation de l'entreprise » (version 1) et preuves
 * qu'elles citent. Sert à un autre lot qui sème SON registre dans la même mission et qui doit
 * ignorer ces lignes dans ses gardes de reprise (redressement-dd/preuves-ecriture.ts).
 */

/** Livrable des affirmations rattachées aux dimensions de la grille de notation. */
export const LIVRABLE_NOTATION = "Notation de l'entreprise";

export interface CompteRegistreNotation {
  preuves: number;
  assertions: number;
}

export async function compterRegistreNotation(
  ctx: ContexteTenantDemo,
  missionId: string,
): Promise<CompteRegistreNotation> {
  const a = await ctx.proprietaire.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM assertions a
       JOIN assertion_versions v ON v.assertion_id = a.id AND v.version = 1
      WHERE a.cabinet_id = $1 AND a.mission_id = $2 AND v.livrable = $3`,
    [ctx.cabinetId, missionId, LIVRABLE_NOTATION],
  );
  const p = await ctx.proprietaire.query<{ n: number }>(
    `SELECT count(DISTINCT l.preuve_id)::int AS n FROM assertion_preuve_liens l
       JOIN assertion_versions v ON v.assertion_id = l.assertion_id AND v.version = 1
      WHERE l.cabinet_id = $1 AND l.mission_id = $2 AND l.action = 'lier' AND v.livrable = $3`,
    [ctx.cabinetId, missionId, LIVRABLE_NOTATION],
  );
  return { preuves: p.rows[0]?.n ?? 0, assertions: a.rows[0]?.n ?? 0 };
}
