import { resumerAjouterCommentaire, resumerCreerTache } from "@missionpilot/engines";
import { empreinteParametres } from "../../../copilote/actions.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { chargerMissions, type MissionLot, type ModuleLot } from "./commun.js";
import {
  ECHANGES_REELS,
  SCENARIOS,
  type ScenarioCommentaire,
  type ScenarioCopilote,
  type ScenarioTache,
} from "./copilote-donnees.js";

/*
 * Module « copilote » (AGT-08) : actions PROPOSÉES par le copilote puis décidées par l'utilisateur.
 *
 * - historique : propositions anciennes insérées avec leur date (la route date tout en « maintenant »
 *   et l'identité d'une proposition, dates comprises, ne se modifie plus : MPG11). Chaque ligne naît
 *   « proposee » (MPG10) puis reçoit sa décision une fois : confirmée (avec l'objet créé : tâche ou
 *   commentaire, jamais d'exécution sans confirmation), annulée, expirée (5 minutes dépassées) ou
 *   refusée (droit retiré entre la proposition et la confirmation). Résumés et empreintes viennent
 *   des mêmes fonctions que le code de production ;
 * - échanges réels : deux messages passent par `POST /api/copilote/messages` (routage déterministe
 *   du moteur : aucune clé, aucun réseau), puis la confirmation ou l'annulation par leurs routes.
 * Idempotent : une proposition est retrouvée par utilisateur, outil et résumé.
 */

const minute = (jourISO: string, min: number): string =>
  new Date(Date.parse(`${jourISO}T00:00:00Z`) + min * 60_000).toISOString();

async function inserer(
  ctx: ContexteTenantDemo,
  s: ScenarioCopilote,
  mission: MissionLot,
): Promise<boolean> {
  const c = ctx.proprietaire;
  const utilisateurId = ctx.utilisateurs[s.qui];
  if (!utilisateurId) throw new Error(`Utilisateur « ${s.qui} » introuvable.`);
  const cree = minute(ctx.dateAvant(s.avant), s.minute);
  const decide = new Date(Date.parse(cree) + s.decisionMin * 60_000).toISOString();
  const expire = new Date(Date.parse(cree) + 5 * 60_000).toISOString();

  let parametres: Record<string, unknown>;
  let resume: string;
  let pourId = utilisateurId;
  if (s.outil === "creer_tache") {
    const t: ScenarioTache = s;
    const cible = t.pour ? ctx.utilisateurs[t.pour] : utilisateurId;
    if (!cible) throw new Error(`Utilisateur « ${t.pour} » introuvable.`);
    pourId = cible;
    const echeance = t.echeance === null ? null : ctx.jour(t.echeance);
    parametres = { titre: t.titre, echeance, assignee_id: cible, mission_id: mission.id };
    resume = resumerCreerTache({
      titre: t.titre,
      echeance,
      pour_nom: t.pour ? (ctx.comptes[t.pour]?.nom ?? null) : null,
      mission_intitule: mission.intitule,
    });
  } else {
    const k: ScenarioCommentaire = s;
    parametres = { texte: k.texte, mission_id: mission.id };
    resume = resumerAjouterCommentaire({ texte: k.texte, mission_intitule: mission.intitule });
  }

  const deja = await c.query(
    "SELECT 1 FROM copilote_actions WHERE cabinet_id = $1 AND utilisateur_id = $2 AND outil = $3 AND resume = $4",
    [ctx.cabinetId, utilisateurId, s.outil, resume],
  );
  if ((deja.rowCount ?? 0) > 0) return false;

  await c.query("BEGIN");
  try {
    const ins = await c.query<{ id: string }>(
      `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
         cree_le, expire_le) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
      [
        ctx.cabinetId,
        utilisateurId,
        s.outil,
        JSON.stringify(parametres),
        empreinteParametres(parametres),
        resume,
        cree,
        expire,
      ],
    );
    const id = ins.rows[0]!.id;
    let resultatId: string | null = null;
    if (s.statut === "confirmee" && s.outil === "creer_tache") {
      const etat = s.etatTache ?? "a_faire";
      const r = await c.query<{ id: string }>(
        `INSERT INTO taches_collaboration (cabinet_id, titre, description, assignee_id, cree_par,
           echeance, statut, fait_le, entite_type, entite_id, mission_id, cree_le, modifie_le)
         VALUES ($1, $2, '', $3, $4, $5, $6, $7, 'mission', $8, $8, $9, $9) RETURNING id`,
        [
          ctx.cabinetId,
          s.titre,
          pourId,
          utilisateurId,
          s.echeance === null ? null : ctx.jour(s.echeance),
          etat,
          etat === "fait" ? new Date(Date.parse(decide) + 2 * 86_400_000).toISOString() : null,
          mission.id,
          decide,
        ],
      );
      resultatId = r.rows[0]!.id;
    } else if (s.statut === "confirmee" && s.outil === "ajouter_commentaire") {
      const r = await c.query<{ id: string }>(
        `INSERT INTO commentaires (cabinet_id, entite_type, entite_id, mission_id, auteur_id, texte,
           cree_le) VALUES ($1, 'mission', $2, $2, $3, $4, $5) RETURNING id`,
        [ctx.cabinetId, mission.id, utilisateurId, s.texte, decide],
      );
      resultatId = r.rows[0]!.id;
    }
    await c.query(
      "UPDATE copilote_actions SET statut = $2, decide_le = $3, resultat_id = $4 WHERE id = $1",
      [id, s.statut, decide, resultatId],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  return true;
}

/** Un échange réel avec le copilote : message, proposition, puis confirmation ou annulation. */
async function echangeReel(
  ctx: ContexteTenantDemo,
  e: (typeof ECHANGES_REELS)[number],
): Promise<boolean> {
  const utilisateurId = ctx.utilisateurs[e.qui];
  const fragment = "titre" in e ? e.titre : e.texte;
  const deja = await ctx.proprietaire.query(
    "SELECT 1 FROM copilote_actions WHERE cabinet_id = $1 AND utilisateur_id = $2 AND parametres::text ILIKE $3",
    [ctx.cabinetId, utilisateurId, `%${fragment}%`],
  );
  if ((deja.rowCount ?? 0) > 0) return false;
  const session = ctx.session(e.qui);
  const r = await session.post("/api/copilote/messages", { message: e.message });
  attendre(200, r, "message au copilote");
  const reponse = r.json() as { statut: string; texte: string; action?: { action_id: string } };
  if (reponse.statut !== "action_proposee" || !reponse.action) {
    throw new Error(
      `Copilote : proposition attendue, reçu « ${reponse.statut} » (${reponse.texte}).`,
    );
  }
  const suite = e.issue === "confirmer" ? "confirmer" : "annuler";
  attendre(
    200,
    await session.post(`/api/copilote/actions/${reponse.action.action_id}/${suite}`),
    `copilote : ${suite}`,
  );
  return true;
}

export const semerCopilote: ModuleLot = async (ctx) => {
  const missions = await chargerMissions(ctx);
  let crees = 0;
  for (const s of SCENARIOS) {
    const mission = missions[s.mission];
    if (!mission) continue;
    if (await inserer(ctx, s, mission)) crees += 1;
  }
  let reels = 0;
  if (Object.keys(missions).length > 0) {
    for (const e of ECHANGES_REELS) if (await echangeReel(ctx, e)) reels += 1;
  }
  ctx.journal(`copilote : ${crees} proposition(s) historique(s), ${reels} échange(s) réel(s).`);
};
