import type { Auth } from "../../../auth/contexte.js";
import { authDe } from "../../../collaboration/entites.js";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import type { DecisionAvis } from "./donnees-ao-veille.js";
import { existe } from "./outils.js";

/* Outils communs de la veille simulée du Tenant démo (dates fictives, décisions en ajout seul). */

export const heure = (jour: string, hhmm: string) => `${jour}T${hhmm}:00Z`;
const STATUT_APRES = { retenir: "retenu", ecarter: "ecarte", reexaminer: "nouveau" } as const;

export const uid = (ctx: ContexteTenantDemo, cle: CleCompte): string => {
  const id = ctx.utilisateurs[cle];
  if (!id) throw new Error(`Utilisateur « ${cle} » introuvable dans le contexte.`);
  return id;
};

export async function auteurDe(ctx: ContexteTenantDemo, cle: CleCompte): Promise<Auth> {
  const auth = await ctx.database.withTenant(ctx.cabinetId, (db) =>
    authDe(db, ctx.cabinetId, uid(ctx, cle)),
  );
  if (!auth) throw new Error(`Compte « ${cle} » inactif ou introuvable.`);
  return auth;
}

/** Décision en ajout seul à sa date, puis statut du résultat (copie de `decider`, veille.ts). */
export async function decisions(
  ctx: ContexteTenantDemo,
  resultatId: string,
  liste: readonly DecisionAvis[],
): Promise<void> {
  for (const d of liste) {
    const quand = heure(d.jour, "10:00");
    await ctx.proprietaire.query(
      `INSERT INTO ao_veille_decisions (cabinet_id, resultat_id, decision, motif, auteur_id, cree_le)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [ctx.cabinetId, resultatId, d.decision, d.motif, uid(ctx, d.auteur), quand],
    );
    await ctx.proprietaire.query(
      "UPDATE ao_veille_resultats SET statut = $2, modifie_le = $3::timestamptz WHERE id = $1",
      [resultatId, STATUT_APRES[d.decision], quand],
    );
  }
}

export async function sansDecision(ctx: ContexteTenantDemo, resultatId: string): Promise<boolean> {
  return !(await existe(ctx, "SELECT 1 FROM ao_veille_decisions WHERE resultat_id = $1", [
    resultatId,
  ]));
}

export async function transaction(
  ctx: ContexteTenantDemo,
  travail: () => Promise<void>,
): Promise<void> {
  await ctx.proprietaire.query("BEGIN");
  try {
    await travail();
    await ctx.proprietaire.query("COMMIT");
  } catch (erreur) {
    await ctx.proprietaire.query("ROLLBACK");
    throw erreur;
  }
}
