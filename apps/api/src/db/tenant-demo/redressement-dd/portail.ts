import type { ContexteTenantDemo } from "../contexte.js";

/**
 * Paramètres du portail client du cabinet (`portail_parametres`). La route (PUT
 * /api/portail/parametres) exige une confirmation d'identité à deux facteurs, que les comptes de
 * démonstration n'ont pas : insertion par SQL propriétaire, valeur prudente et réversible
 * (double authentification du portail NON obligatoire, comme les comptes du socle).
 */
export async function semerParametresPortail(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.utilisateurs["associe"];
  if (!associe) throw new Error("Compte « associe » introuvable dans le contexte.");
  await ctx.proprietaire.query(
    `INSERT INTO portail_parametres (cabinet_id, tfa_obligatoire, modifie_par)
     VALUES ($1, false, $2) ON CONFLICT (cabinet_id) DO NOTHING`,
    [ctx.cabinetId, associe],
  );
}
