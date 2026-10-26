import type { ContexteTenantDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";
import { cleResponsable, type ActeursMission } from "./kpi-acteurs.js";
import type { SpecAction } from "./kpi-types.js";
import { exiger, lire } from "./outils.js";

/*
 * Actions correctives (KPI-18) par POST /api/missions/:id/kpi/actions puis POST /api/kpi/actions/:id/statut
 * et /commentaires. Clé naturelle : le titre dans la mission. Une action rejouée reprend là où elle
 * s'était arrêtée (statut courant relu) ; ses commentaires ne sont jamais ajoutés deux fois.
 */

type LigneAction = {
  id: string;
  statut: string;
};

/** Id de l'alerte la plus récente du KPI pour ce code, ou null si le suivi n'en a pas détecté. */
async function alerteDe(
  ctx: ContexteTenantDemo,
  kpiId: string,
  code: SpecAction["alerte"],
): Promise<string | null> {
  if (!code) return null;
  const [a] = await lire<{ id: string }>(
    ctx,
    `SELECT id FROM kpi_alertes WHERE kpi_id = $1 AND code = $2
      ORDER BY periode_cle DESC, id DESC LIMIT 1`,
    [kpiId, code],
  );
  return a?.id ?? null;
}

/** Crée l'action si absente (par titre) et la mène à son statut final ; renvoie son identifiant. */
export async function semerAction(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  acteurs: ActeursMission,
  spec: SpecAction,
  rang: number,
  kpiIds: ReadonlyMap<string, string>,
  decisionId: string | null,
): Promise<string> {
  const kpiId = kpiIds.get(spec.kpi);
  if (!kpiId) throw new Error(`KPI « ${spec.kpi} » inconnu pour l'action « ${spec.titre} ».`);
  const session = ctx.session(acteurs.chef);
  const [deja] = await lire<LigneAction>(
    ctx,
    "SELECT id, statut FROM kpi_actions WHERE mission_id = $1 AND titre = $2",
    [mission.id, spec.titre],
  );
  let id = deja?.id;
  let statut = deja?.statut ?? "a_faire";
  if (!id) {
    const responsable = ctx.utilisateurs[cleResponsable(acteurs, spec.responsable, rang)];
    const r = await session.post(`/api/missions/${mission.id}/kpi/actions`, {
      kpi_id: kpiId,
      alerte_id: await alerteDe(ctx, kpiId, spec.alerte),
      decision_id: decisionId,
      titre: spec.titre,
      description: spec.description,
      responsable_id: responsable,
      echeance: spec.echeance,
    });
    exiger(r, 201, `Création de l'action « ${spec.titre} »`);
    id = r.json().id as string;
  }
  const changer = async (corps: Record<string, string>, quoi: string) => {
    const r = await session.post(`/api/kpi/actions/${id}/statut`, corps);
    exiger(r, 200, `${quoi} de l'action « ${spec.titre} »`);
  };
  if (statut === "a_faire" && spec.fin !== "a_faire") {
    if (spec.fin !== "abandonnee") {
      await changer({ statut: "en_cours" }, "Démarrage");
      statut = "en_cours";
    }
  }
  if (statut !== "terminee" && statut !== "abandonnee") {
    if (spec.fin === "terminee") {
      await changer(
        {
          statut: "terminee",
          date_effet: spec.dateEffet ?? spec.echeance,
          commentaire: spec.commentaire ?? "Mesure corrective mise en service à cette date.",
        },
        "Clôture",
      );
    } else if (spec.fin === "abandonnee") {
      await changer(
        { statut: "abandonnee", motif: spec.motif ?? "Action abandonnée par décision du comité." },
        "Abandon",
      );
    }
  }
  await commenter(ctx, id, spec, acteurs);
  return id;
}

async function commenter(
  ctx: ContexteTenantDemo,
  id: string,
  spec: SpecAction,
  acteurs: ActeursMission,
): Promise<void> {
  const faits = await lire<{ commentaire: string }>(
    ctx,
    "SELECT commentaire FROM kpi_action_evenements WHERE action_id = $1 AND type = 'commentaire'",
    [id],
  );
  for (const texte of spec.commentaires ?? []) {
    if (faits.some((f) => f.commentaire === texte)) continue;
    const r = await ctx.session(acteurs.chef).post(`/api/kpi/actions/${id}/commentaires`, {
      commentaire: texte,
    });
    exiger(r, 201, `Commentaire de l'action « ${spec.titre} »`);
  }
}
