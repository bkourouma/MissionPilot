import { ajouterJours } from "@missionpilot/engines";
import { journaliser } from "../../../audit.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { etalerJournal, maintenantBase } from "./antidatage.js";
import { OPPORTUNITES_COMPLEMENTAIRES, type DefOpportunite } from "./donnees-pipeline.js";

/*
 * Pipeline commercial complémentaire (opportunités perdues ou ouvertes), par les vraies routes :
 * création par le chef de mission, proposition générée depuis le catalogue (taux du barème et
 * taux négociés du client), validée par un associé, envoyée, refusée par le client ou restée sans
 * réponse, puis issue « perdue » motivée. Dates remontées en SQL propriétaire (littéral).
 */

const ACTION_PIPELINE_FAIT = "semis_tenant_demo_pipeline";

const midi = (date: string): string => `${date}T12:00:00Z`;

async function creer(ctx: ContexteTenantDemo, def: DefOpportunite) {
  const chef = ctx.session(def.chef);
  const associe = ctx.session(def.associe);
  const typeId = ctx.typesMission[def.type];
  if (!typeId) throw new Error(`Type de mission « ${def.type} » absent du catalogue.`);
  const opp = await chef.post("/api/opportunites", {
    client_id: ctx.client(def.client),
    intitule: def.intitule,
    type_mission_id: typeId,
    montant_estime: def.montant,
    probabilite: def.probabilite,
    etape: def.etape === "prospection" ? "prospection" : "qualification",
    responsable_id: chef.utilisateurId,
    date_cloture_prevue: ajouterJours(def.date, 75),
  });
  attendre(201, opp, `opportunité ${def.intitule}`);
  const id = opp.json().id as string;
  let propositionId: string | null = null;
  if (def.proposition) {
    const prop = await chef.post(`/api/opportunites/${id}/propositions`, {
      date_reference: ajouterJours(def.date, 10),
    });
    attendre(201, prop, `proposition ${def.intitule}`);
    propositionId = prop.json().id as string;
    const url = `/api/propositions/${propositionId}`;
    attendre(200, await chef.post(`${url}/statut`, { statut: "a_valider" }), "à valider");
    attendre(200, await associe.post(`${url}/statut`, { statut: "validee" }), "validée");
    if (def.proposition !== "validee") {
      attendre(200, await chef.post(`${url}/statut`, { statut: "envoyee" }), "envoyée");
    }
    if (def.proposition === "refusee") {
      attendre(200, await chef.post(`${url}/statut`, { statut: "refusee" }), "refusée");
    }
  }
  if (def.etape !== "prospection" && def.etape !== "qualification") {
    attendre(200, await chef.post(`/api/opportunites/${id}/etape`, { etape: def.etape }), "étape");
  }
  if (def.perdue) {
    attendre(
      200,
      await chef.post(`/api/opportunites/${id}/issue`, {
        statut: "perdue",
        motif_perte: def.perdue.motif,
      }),
      "opportunité perdue",
    );
  }
  return { id, propositionId };
}

async function antidater(
  ctx: ContexteTenantDemo,
  def: DefOpportunite,
  ids: { id: string; propositionId: string | null },
): Promise<void> {
  const c = ctx.proprietaire;
  const cloture = def.perdue ? midi(def.perdue.date) : null;
  const dernier = def.perdue?.date ?? ajouterJours(def.date, def.proposition ? 20 : 0);
  const repondue = def.perdue ? midi(ajouterJours(def.perdue.date, -3)) : null;
  await c.query("BEGIN");
  try {
    await c.query("ALTER TABLE propositions DISABLE TRIGGER propositions_figee");
    await c.query(
      "UPDATE opportunites SET cree_le = $2, modifie_le = $3, cloturee_le = $4 WHERE id = $1",
      [ids.id, midi(def.date), midi(dernier), cloture],
    );
    if (ids.propositionId) {
      await c.query(
        `UPDATE propositions SET cree_le = $2, validee_le = $3,
           envoyee_le = CASE WHEN envoyee_le IS NULL THEN NULL ELSE $4::timestamptz END,
           repondue_le = CASE WHEN repondue_le IS NULL THEN NULL ELSE $5::timestamptz END,
           modifie_le = $6 WHERE id = $1`,
        [
          ids.propositionId,
          midi(ajouterJours(def.date, 10)),
          midi(ajouterJours(def.date, 17)),
          midi(ajouterJours(def.date, 20)),
          repondue,
          midi(dernier),
        ],
      );
    }
    await c.query("ALTER TABLE propositions ENABLE TRIGGER propositions_figee");
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}

/** Opportunités complémentaires du pipeline. Reprise : tout ou rien (marqueur au journal d'audit). */
export async function semerPipelineComplementaire(ctx: ContexteTenantDemo): Promise<void> {
  const deja = await ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const marque = await db.query("SELECT 1 FROM journal_audit WHERE action = $1 LIMIT 1", [
      ACTION_PIPELINE_FAIT,
    ]);
    if (marque.rowCount) return true;
    const presentes = await db.query(
      "SELECT 1 FROM opportunites WHERE intitule = ANY($1) LIMIT 1",
      [OPPORTUNITES_COMPLEMENTAIRES.map((o) => o.intitule)],
    );
    if (presentes.rowCount) {
      throw new Error(
        "Le pipeline complémentaire existe mais n'a pas été terminé par une exécution précédente : " +
          "repartir d'une base neuve.",
      );
    }
    return false;
  });
  if (deja) return;
  for (const def of OPPORTUNITES_COMPLEMENTAIRES) {
    const debut = await maintenantBase(ctx);
    const ids = await creer(ctx, def);
    await antidater(ctx, def, ids);
    await etalerJournal(
      ctx,
      { debut, fin: await maintenantBase(ctx) },
      def.date,
      def.perdue?.date ?? ajouterJours(def.date, def.proposition ? 20 : 0),
    );
  }
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    journaliser(db, {
      cabinetId: ctx.cabinetId,
      utilisateurId: null,
      action: ACTION_PIPELINE_FAIT,
      entite: "cabinet",
      entiteId: ctx.cabinetId,
      details: { opportunites: OPPORTUNITES_COMPLEMENTAIRES.length },
    }),
  );
}
