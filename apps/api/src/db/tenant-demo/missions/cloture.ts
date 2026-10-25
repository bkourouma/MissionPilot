import { ajouterJours } from "@missionpilot/engines";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { etalerJournal, maintenantBase } from "./antidatage.js";
import { transactionAntidatage } from "./declencheurs.js";
import { CASTING } from "./donnees-casting.js";

/*
 * Clôture réelle des missions TERMINÉES du casting, par les routes de clôture (check-list
 * évaluée, passage « clôturée », bilan de rentabilité archivé, retour d'expérience ouvert).
 *
 * À appeler EN DERNIER (phase « gestion », après le temps, la facturation et les encaissements) :
 * une mission clôturée refuse toute écriture. Idempotent : une mission déjà clôturée ET datée est
 * sautée ; une mission clôturée mais dont l'antidatage a échoué (date de clôture différente de la
 * date attendue) est réparée (dates et journal) sans nouvelle clôture ;
 * les missions sont retrouvées par leur intitulé EXACT (`missions.intitule`). Sans cette étape,
 * les missions terminées restent « à clôturer » (leur préparation est faite par la phase
 * « missions »). Une clôture refusée (item bloquant de la check-list) lève une erreur claire.
 */

/** Jours après la fin de la mission où l'on date la clôture (facturation et solde réglés). */
const DELAI_CLOTURE_JOURS = 6;

export async function cloturerMissionsTerminees(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  for (const def of CASTING.filter((d) => d.etat === "terminee")) {
    const lue = await ctx.database.withTenant(ctx.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT id, statut, cloturee_le AS reel, (cloturee_le AT TIME ZONE 'UTC')::date::text AS jour
           FROM missions WHERE intitule = $1`,
        [def.nom],
      );
      return r.rows[0] as
        { id: string; statut: string; reel: Date | null; jour: string | null } | undefined;
    });
    if (!lue)
      throw new Error(
        `Mission « ${def.nom} » introuvable : exécuter d'abord la phase « missions ».`,
      );
    const jourCloture = ajouterJours(def.fin, DELAI_CLOTURE_JOURS);
    if (lue.statut === "cloturee") {
      if (lue.jour === jourCloture) continue;
      // Clôture réelle faite, antidatage interrompu : on répare les dates sans rouvrir ni reclore.
      const t = lue.reel as Date;
      await antidaterCloture(ctx, lue.id, jourCloture);
      await etalerJournal(
        ctx,
        { debut: new Date(t.getTime() - 20_000), fin: new Date(t.getTime() + 20_000) },
        ajouterJours(def.fin, 1),
        jourCloture,
      );
      ctx.journal(`  mission « ${def.nom} » : dates de clôture réparées.`);
      continue;
    }
    const debutReel = await maintenantBase(ctx);
    const directeur = ctx.session(def.directeur);
    if (lue.statut === "en_cours") {
      attendre(
        200,
        await directeur.post(`/api/missions/${lue.id}/statut`, { statut: "a_cloturer" }),
        "à clôturer",
      );
    }
    const evaluation = await ctx
      .session(def.chef)
      .post(`/api/missions/${lue.id}/cloture/evaluer`, {});
    attendre(200, evaluation, `évaluation de clôture de ${def.nom}`);
    const cloture = await associe.post(`/api/missions/${lue.id}/cloturer`);
    attendre(200, cloture, `clôture de ${def.nom}`);
    await antidaterCloture(ctx, lue.id, jourCloture);
    await etalerJournal(
      ctx,
      { debut: debutReel, fin: await maintenantBase(ctx) },
      ajouterJours(def.fin, 1),
      jourCloture,
    );
    ctx.journal(`  mission « ${def.nom} » clôturée.`);
  }
}

/** Remonte les horodatages de la clôture à sa date fictive (SQL propriétaire, requêtes littérales). */
async function antidaterCloture(
  ctx: ContexteTenantDemo,
  missionId: string,
  jour: string,
): Promise<void> {
  const t = `${jour}T16:00:00Z`;
  await transactionAntidatage(ctx.proprietaire, {
    tables: ["bilans_mission", "cloture_verifications", "retours_experience"],
    avant: async (c) => {
      await c.query("UPDATE missions SET cloturee_le = $2, modifie_le = $2 WHERE id = $1", [
        missionId,
        t,
      ]);
    },
    pendant: async (c) => {
      await c.query(
        "UPDATE bilans_mission SET cloture_le = $2, date_cloture = $3::date, cree_le = $2 WHERE mission_id = $1",
        [missionId, t, jour],
      );
      await c.query("UPDATE retours_experience SET ouvert_le = $2 WHERE mission_id = $1", [
        missionId,
        t,
      ]);
      await c.query(
        "UPDATE cloture_verifications SET verifie_le = $2 WHERE mission_id = $1 AND declencheur = 'cloture'",
        [missionId, t],
      );
    },
  });
}
