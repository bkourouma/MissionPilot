import type { ContexteTenantDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";
import { cleResponsable, type ActeursMission } from "./kpi-acteurs.js";
import { semerAction } from "./kpi-actions.js";
import type { SpecArbre, SpecDecision, SpecRevue } from "./kpi-types.js";
import { exiger, lire } from "./outils.js";

/*
 * Arbres d'indicateurs (KPI-13) et revues de performance (KPI-17) par les routes de
 * routes/kpi-pilotage.ts. Cycle d'une revue : créée → ordre du jour généré par le moteur → tenue
 * (dossier figé) → décisions et actions → clôturée (ou annulée tant qu'elle est planifiée).
 * Clés naturelles : KPI racine d'un arbre ; titre d'une revue dans la mission ; libellé d'une
 * décision dans sa revue. Rejouable : l'état courant est relu avant chaque geste.
 */

export type IdsKpi = ReadonlyMap<string, string>;

export async function semerArbre(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  acteurs: ActeursMission,
  spec: SpecArbre,
  ids: IdsKpi,
): Promise<void> {
  const session = ctx.session(acteurs.chef);
  const racineId = ids.get(spec.racine);
  if (!racineId) throw new Error(`KPI racine « ${spec.racine} » inconnu.`);
  let [arbre] = await lire<{ id: string }>(
    ctx,
    "SELECT id FROM kpi_arbres WHERE mission_id = $1 AND kpi_racine_id = $2",
    [mission.id, racineId],
  );
  if (!arbre) {
    const r = await session.post(`/api/missions/${mission.id}/kpi/arbres`, {
      kpi_racine_id: racineId,
      libelle: spec.libelle,
      description: spec.description,
    });
    exiger(r, 201, `Création de l'arbre « ${spec.libelle} »`);
    arbre = { id: r.json().id as string };
  }
  const noeuds = await lire<{ id: string; kpi_id: string | null; parent_id: string | null }>(
    ctx,
    "SELECT id, kpi_id, parent_id FROM kpi_arbre_noeuds WHERE arbre_id = $1",
    [arbre.id],
  );
  const racine = noeuds.find((n) => n.parent_id === null);
  if (!racine) throw new Error(`Arbre « ${spec.libelle} » sans nœud racine.`);
  const relation = await lire<{ relation: string }>(
    ctx,
    "SELECT relation FROM kpi_arbre_noeuds WHERE id = $1",
    [racine.id],
  );
  if (relation[0]?.relation !== spec.relation) {
    const r = await session.patch(`/api/kpi/arbres/noeuds/${racine.id}`, {
      relation: spec.relation,
    });
    exiger(r, 200, `Relation de l'arbre « ${spec.libelle} »`);
  }
  for (const [rang, levier] of spec.leviers.entries()) {
    const kpiId = ids.get(levier.cle);
    if (!kpiId) throw new Error(`Levier « ${levier.cle} » inconnu.`);
    if (noeuds.some((n) => n.kpi_id === kpiId)) continue;
    const libelle = (
      await lire<{ libelle: string }>(ctx, "SELECT libelle FROM kpi_definitions WHERE id = $1", [
        kpiId,
      ])
    )[0]?.libelle;
    const r = await session.post(`/api/kpi/arbres/${arbre.id}/noeuds`, {
      parent_id: racine.id,
      kpi_id: kpiId,
      libelle,
      coefficient: levier.coefficient,
      rang,
    });
    exiger(r, 201, `Levier « ${levier.cle} » de l'arbre « ${spec.libelle} »`);
  }
}

type LigneRevue = {
  id: string;
  statut: string;
  ordre: number;
  compte_rendu: string | null;
};

async function lireRevue(
  ctx: ContexteTenantDemo,
  missionId: string,
  titre: string,
): Promise<LigneRevue | undefined> {
  return (
    await lire<LigneRevue>(
      ctx,
      `SELECT id, statut, jsonb_array_length(ordre_du_jour)::int AS ordre, compte_rendu
         FROM kpi_revues WHERE mission_id = $1 AND titre = $2`,
      [missionId, titre],
    )
  )[0];
}

export async function semerRevue(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  acteurs: ActeursMission,
  spec: SpecRevue,
  ids: IdsKpi,
): Promise<void> {
  const session = ctx.session(acteurs.chef);
  let revue = await lireRevue(ctx, mission.id, spec.titre);
  if (!revue) {
    const r = await session.post(`/api/missions/${mission.id}/kpi/revues`, {
      titre: spec.titre,
      date_prevue: spec.date,
      animateur_id: ctx.utilisateurs[acteurs.directeur],
    });
    exiger(r, 201, `Création de la revue « ${spec.titre} »`);
    revue = await lireRevue(ctx, mission.id, spec.titre);
  }
  if (!revue) throw new Error(`Revue « ${spec.titre} » introuvable après création.`);
  const url = `/api/kpi/revues/${revue.id}`;
  if (spec.etat === "annulee") {
    if (revue.statut === "planifiee")
      exiger(await session.post(`${url}/annuler`), 200, "Annulation");
    return;
  }
  if (revue.statut === "planifiee") {
    if (revue.ordre === 0) {
      exiger(await session.post(`${url}/ordre-du-jour/generer`), 200, "Ordre du jour de la revue");
    }
    if (spec.etat === "planifiee") {
      if (spec.compteRendu && !revue.compte_rendu) {
        exiger(
          await session.patch(url, { compte_rendu: spec.compteRendu }),
          200,
          "Compte rendu préparatoire",
        );
      }
      return;
    }
    exiger(await session.post(`${url}/tenir`, { compte_rendu: spec.compteRendu }), 200, "Tenue");
    revue.statut = "tenue";
  }
  if (revue.statut !== "tenue") return; // déjà clôturée (ou annulée) : rien à reprendre
  for (const [rang, d] of spec.decisions.entries()) {
    await semerDecision(ctx, mission, acteurs, revue.id, d, rang, ids);
  }
  if (spec.etat === "cloturee") {
    exiger(await session.post(`${url}/cloturer`), 200, `Clôture de la revue « ${spec.titre} »`);
  }
}

async function semerDecision(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  acteurs: ActeursMission,
  revueId: string,
  d: SpecDecision,
  rang: number,
  ids: IdsKpi,
): Promise<void> {
  const session = ctx.session(acteurs.chef);
  const kpiId = ids.get(d.kpi);
  if (!kpiId) throw new Error(`KPI « ${d.kpi} » inconnu pour la décision « ${d.libelle} ».`);
  const [deja] = await lire<{ id: string; statut: string }>(
    ctx,
    "SELECT id, statut FROM kpi_revue_decisions WHERE revue_id = $1 AND libelle = $2",
    [revueId, d.libelle],
  );
  let id = deja?.id;
  let statut = deja?.statut ?? "ouverte";
  if (!id) {
    const r = await session.post(`/api/kpi/revues/${revueId}/decisions`, {
      libelle: d.libelle,
      kpi_id: kpiId,
      responsable_id: ctx.utilisateurs[cleResponsable(acteurs, d.responsable, rang)],
      echeance: d.echeance,
    });
    exiger(r, 201, `Décision « ${d.libelle} »`);
    id = r.json().id as string;
  }
  for (const [i, a] of d.actions.entries()) {
    await semerAction(ctx, mission, acteurs, a, rang + i, ids, id);
  }
  const changer = async (corps: Record<string, string>) => {
    exiger(
      await session.post(`/api/kpi/revues/decisions/${id}/statut`, corps),
      200,
      `Statut de la décision « ${d.libelle} »`,
    );
  };
  if (statut === "ouverte" && d.fin !== "ouverte" && d.fin !== "abandonnee") {
    await changer({ statut: "en_cours" });
    statut = "en_cours";
  }
  if (statut === "ouverte" || statut === "en_cours") {
    if (d.fin === "executee") {
      await changer({
        statut: "executee",
        commentaire: d.commentaire ?? "Décision mise en oeuvre.",
      });
    } else if (d.fin === "abandonnee") {
      await changer({
        statut: "abandonnee",
        motif: d.motif ?? "Décision abandonnée par le comité.",
      });
    }
  }
}
