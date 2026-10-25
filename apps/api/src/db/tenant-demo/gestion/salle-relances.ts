import { planifierRelancesSalle, relanceSalleMission } from "../../../salle-mission/relances.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { ecartJours } from "../horloge.js";
import { ok } from "./outils.js";

/*
 * Échéances et relances d'une demande de la salle de mission.
 *
 * ÉCHÉANCE : la route d'envoi exige une échéance >= aujourd'hui (horloge RÉELLE du serveur) ; la
 * demande est donc envoyée avec le jour courant, puis l'échéance fictive (souvent passée) est posée
 * par SQL littéral (seule colonne modifiable d'une demande envoyée avec les relances). Les jobs de
 * relance mis en file pour le jour courant sont supprimés et remplacés par ceux de la vraie échéance
 * (la file ne garde que les paliers encore à venir).
 *
 * RELANCES : la relance MANUELLE passe par la route (équipe) ; les paliers AUTOMATIQUES (rappel J-3,
 * relance J+1, relance ferme J+7 avec alerte au chef et au directeur) rejouent le handler du job
 * réel, qui écrit les notifications et `salle_relances` ; aucun e-mail n'est jamais émis.
 * `salle_relances` est en ajout seul (déclencheur MPL01) : les relances gardent la date réelle de
 * l'exécution (limite assumée, comme les dépôts, accusés et décisions de la salle).
 */

/** Jour courant du serveur (UTC), exigé par la route d'envoi. */
export async function jourReel(ctx: ContexteTenantDemo): Promise<string> {
  const r = await ctx.proprietaire.query("SELECT (now() AT TIME ZONE 'UTC')::date::text AS jour");
  return r.rows[0].jour as string;
}

/** Pose l'échéance fictive d'une demande envoyée et remet les jobs de relance en cohérence. */
export async function poserEcheance(
  ctx: ContexteTenantDemo,
  demandeId: string,
  echeance: string,
): Promise<void> {
  await ctx.proprietaire.query("UPDATE salle_demandes SET echeance = $2::date WHERE id = $1", [
    demandeId,
    echeance,
  ]);
  await ctx.proprietaire.query(
    `DELETE FROM jobs WHERE cabinet_id = $1 AND type = 'relance_salle_mission'
        AND statut = 'en_attente' AND charge->>'demande_id' = $2`,
    [ctx.cabinetId, demandeId],
  );
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    planifierRelancesSalle(db, ctx.cabinetId, demandeId, echeance),
  );
}

type Palier = "rappel_j_moins_3" | "relance_j_plus_1" | "relance_j_plus_7";

async function rejouerPalier(
  ctx: ContexteTenantDemo,
  demandeId: string,
  palier: Palier,
  echeance: string,
): Promise<void> {
  await ctx.database.withTenant(ctx.cabinetId, async (db) => {
    await relanceSalleMission({
      db,
      cabinetId: ctx.cabinetId,
      jobId: demandeId,
      charge: { demande_id: demandeId, palier, echeance },
      maintenant: new Date(),
      database: ctx.database,
    });
  });
}

/**
 * Relances d'une demande dont des pièces manquent : en retard, une relance manuelle de l'équipe puis
 * les paliers J+1 (et J+7 au-delà de sept jours) ; échéance dans moins de trois jours : rappel J-3.
 * Reprise : un palier déjà inscrit pour la demande n'est pas rejoué.
 */
export async function relancerSiBesoin(
  ctx: ContexteTenantDemo,
  missionId: string,
  demandeId: string,
  echeance: string,
  equipe: SessionDemo,
): Promise<number> {
  const faits = new Set(
    (
      await ctx.proprietaire.query(
        "SELECT DISTINCT palier FROM salle_relances WHERE demande_id = $1",
        [demandeId],
      )
    ).rows.map((l) => l.palier as string),
  );
  const retard = ecartJours(echeance, ctx.aujourdhui);
  const rejouer = async (palier: Palier) => {
    if (!faits.has(palier)) await rejouerPalier(ctx, demandeId, palier, echeance);
  };
  if (retard >= 1) {
    if (!faits.has("manuelle")) {
      ok(
        200,
        await equipe.post(`/api/missions/${missionId}/salle/demandes/${demandeId}/relancer`, {}),
        "relance manuelle",
      );
    }
    await rejouer("relance_j_plus_1");
    if (retard >= 7) await rejouer("relance_j_plus_7");
  } else if (retard >= -3) {
    await rejouer("rappel_j_moins_3");
  }
  const n = await ctx.proprietaire.query(
    "SELECT count(*)::int AS n FROM salle_relances WHERE demande_id = $1",
    [demandeId],
  );
  return n.rows[0].n as number;
}
