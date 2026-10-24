import { journaliser } from "../../../audit.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { batirMission, type MissionBatie } from "./construction.js";
import { CASTING, type DefMission } from "./donnees-casting.js";
import { constituerEquipe, pressentirEquipe } from "./equipe.js";
import { antidaterMission, maintenantBase } from "./antidatage.js";
import { reviserBudget } from "./budget-revision.js";
import { assurerReferentiels } from "./referentiels.js";
import { deposerDocuments, franchirJalons, preparerCloture } from "./suivi.js";

/*
 * Orchestration de la phase « missions » : référentiels, puis chaque mission du casting dans
 * l'ordre. Reprise : une mission terminée est consignée au journal d'audit (action
 * `semis_tenant_demo_mission`) ; une relance saute les missions consignées et REFUSE (message
 * clair) une mission présente mais non consignée, c'est-à-dire construite à moitié.
 */

const ACTION_MISSION_FAITE = "semis_tenant_demo_mission";

async function missionExistante(ctx: ContexteTenantDemo, nom: string): Promise<string | null> {
  return ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const r = await db.query("SELECT id FROM missions WHERE intitule = $1", [nom]);
    return (r.rows[0]?.id as string | undefined) ?? null;
  });
}

async function missionConsignee(ctx: ContexteTenantDemo, cle: string): Promise<boolean> {
  return ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const r = await db.query(
      "SELECT 1 FROM journal_audit WHERE action = $1 AND details->>'cle' = $2 LIMIT 1",
      [ACTION_MISSION_FAITE, cle],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

async function consigner(ctx: ContexteTenantDemo, m: MissionBatie): Promise<void> {
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    journaliser(db, {
      cabinetId: ctx.cabinetId,
      utilisateurId: null,
      action: ACTION_MISSION_FAITE,
      entite: "mission",
      entiteId: m.id,
      details: { cle: m.def.cle },
    }),
  );
}

/** Mission du casting par `cle`, pour les étapes qui suivent (relue si elle a été consignée). */
export function parCle(cle: string): DefMission {
  const def = CASTING.find((d) => d.cle === cle);
  if (!def) throw new Error(`Mission « ${cle} » absente du casting.`);
  return def;
}

export async function semerCasting(
  ctx: ContexteTenantDemo,
  suite?: (ctx: ContexteTenantDemo, m: MissionBatie) => Promise<void>,
): Promise<MissionBatie[]> {
  await assurerReferentiels(ctx);
  const batis: MissionBatie[] = [];
  for (const def of CASTING) {
    if (await missionConsignee(ctx, def.cle)) {
      ctx.journal(`  mission « ${def.nom} » déjà faite.`);
      continue;
    }
    if (await missionExistante(ctx, def.nom)) {
      throw new Error(
        `La mission « ${def.nom} » existe mais n'a pas été terminée par une exécution précédente : ` +
          "repartir d'une base neuve.",
      );
    }
    ctx.journal(`  mission « ${def.nom} »…`);
    const debutReel = await maintenantBase(ctx);
    const m = await batirMission(ctx, def);
    const chef = ctx.session(def.chef);
    if (def.signature) await constituerEquipe(ctx, chef, m);
    else await pressentirEquipe(ctx, chef, m);
    const versionRevisee = await reviserBudget(ctx, m);
    const documents = await deposerDocuments(ctx, m);
    await franchirJalons(ctx, m);
    await preparerCloture(ctx, m);
    await antidaterMission(ctx, m, documents, versionRevisee, {
      debut: debutReel,
      fin: await maintenantBase(ctx),
    });
    if (suite) await suite(ctx, m);
    await consigner(ctx, m);
    batis.push(m);
  }
  return batis;
}
