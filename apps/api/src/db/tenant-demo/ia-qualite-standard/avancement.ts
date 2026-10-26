import { lundiDeLaSemaine } from "@missionpilot/engines";
import { acteursMission } from "./ia-aide.js";
import { composerPourMission } from "../../../automatisation/avancement-lecture.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { lundisEntre } from "../horloge.js";
import { CASTING, CLES_MISSIONS, midi, type ModuleLot } from "./commun.js";
import { COMMENTAIRE_IA_GABARIT, COMMENTAIRES, INTRODUCTIONS } from "./avancement-donnees.js";

/*
 * Module « avancement » (AUT-10) : paramètre du cabinet et rapports d'avancement HEBDOMADAIRES des
 * missions signées ou en cours, un par semaine depuis le démarrage.
 *
 * - paramètre : `PUT /api/avancement/parametres` par l'associé (fonction activée ; l'envoi par
 *   e-mail reste désactivé et non branché : aucun envoi n'existe) ;
 * - rapports : le contenu chiffré vient TOUJOURS du moteur (`composerPourMission` = ce que la tâche
 *   hebdomadaire appelle), inscrit avec la date du lundi de génération (INSERT daté : la table est
 *   créée « maintenant » par la route). Les semaines passées sont validées par le chef de mission
 *   (validation datée par SQL : le rapport validé est figé et la route date en « maintenant ») ; les
 *   deux dernières semaines restent en brouillon pour certaines missions, avec un brouillon de
 *   commentaire « IA » issu d'un gabarit déterministe. La note d'introduction de la semaine en
 *   cours de la mission Baobab passe par la VRAIE route de modification.
 * - jobs : une ligne `avancement_hebdo` par semaine, déjà TERMINÉE (rien n'est exécutable ni envoyé).
 * Idempotent : un rapport est identifié par (mission, semaine), une tâche par sa clé hebdomadaire.
 * Les chiffres ne sont jamais écrits ici.
 */

interface MissionActive {
  id: string;
  client_id: string;
  statut: string;
  intitule: string;
  chef_id: string | null;
  directeur_id: string | null;
  date_debut: string | null;
  date_signature: string | null;
}

/** Missions de la semaine à rapporter : signées, ou en cours (démarrage = début ; signée = signature). */
async function missionsActives(ctx: ContexteTenantDemo): Promise<MissionActive[]> {
  const r = await ctx.proprietaire.query<MissionActive>(
    `SELECT id, client_id, statut, intitule, chef_id, directeur_id,
            date_debut::text, date_signature::text
       FROM missions
      WHERE cabinet_id = $1 AND statut IN ('signee', 'en_cours') AND intitule = ANY($2::text[])
      ORDER BY date_debut, id`,
    [ctx.cabinetId, CLES_MISSIONS.map((c) => CASTING[c].intitule)],
  );
  return r.rows;
}

async function assurerJob(ctx: ContexteTenantDemo, lundi: string): Promise<string> {
  const c = ctx.proprietaire;
  const cle = `avancement_hebdo:${lundi}`;
  const execute = midi(lundi, -330); // 06 h 30 UTC
  await c.query(
    `INSERT INTO jobs (cabinet_id, type, charge, statut, tentatives, tentatives_max, execute_a,
       verrouille_le, progression, cree_le, cle)
     VALUES ($1, 'avancement_hebdo', $2, 'termine', 1, 3, $3, $3, 100, $4, $5)
     ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
    [ctx.cabinetId, JSON.stringify({ semaine: lundi }), execute, midi(lundi, -700), cle],
  );
  const r = await c.query<{ id: string }>(
    "SELECT id FROM jobs WHERE cabinet_id = $1 AND cle = $2",
    [ctx.cabinetId, cle],
  );
  return r.rows[0]!.id;
}

export const semerAvancement: ModuleLot = async (ctx) => {
  const c = ctx.proprietaire;
  const alea = ctx.alea.deriver("avancement");
  const associe = ctx.session("associe");

  const parametres = await c.query("SELECT 1 FROM avancement_parametres WHERE cabinet_id = $1", [
    ctx.cabinetId,
  ]);
  if (parametres.rowCount === 0) {
    attendre(
      200,
      await associe.put("/api/avancement/parametres", { actif: true }),
      "paramètre d'avancement",
    );
  }

  const missions = await missionsActives(ctx);
  const lundiCourant = lundiDeLaSemaine(ctx.aujourdhui);
  let crees = 0;
  for (const m of missions) {
    const depart = m.statut === "signee" ? m.date_signature : m.date_debut;
    if (!depart || !m.chef_id) continue;
    for (const lundi of lundisEntre(depart, lundiCourant)) {
      // Tirages consommés à chaque tour, qu'on écrive ou non : la suite reste reproductible.
      const tirageIntro = alea.entier(0, INTRODUCTIONS.length - 1);
      const tirageCommentaire = alea.entier(0, COMMENTAIRES.length - 1);
      const avecTexte = alea.proba(0.7);
      const existe = await c.query(
        "SELECT 1 FROM avancement_rapports WHERE mission_id = $1 AND semaine = $2",
        [m.id, lundi],
      );
      if ((existe.rowCount ?? 0) > 0) continue;

      const semainesDepuis = Math.round(
        (Date.parse(lundiCourant) - Date.parse(lundi)) / (7 * 86_400_000),
      );
      const jobId = await assurerJob(ctx, lundi);
      const contenu = await ctx.database.withTenant(ctx.cabinetId, (db) =>
        composerPourMission(
          db,
          ctx.cabinetId,
          {
            id: m.id,
            intitule: m.intitule,
            statut: m.statut,
            client_id: m.client_id,
            chef_id: m.chef_id,
            directeur_id: m.directeur_id,
          },
          lundi,
          lundi,
        ),
      );
      const genere = midi(lundi, -330);
      const ins = await c.query<{ id: string }>(
        `INSERT INTO avancement_rapports (cabinet_id, mission_id, client_id, semaine, contenu, job_id,
           genere_le, cree_le, modifie_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7) RETURNING id`,
        [ctx.cabinetId, m.id, m.client_id, lundi, JSON.stringify(contenu), jobId, genere],
      );
      const id = ins.rows[0]!.id;
      crees += 1;

      const enRetard =
        m.intitule === CASTING["redressement-gabon"].intitule ||
        m.intitule === CASTING["flash-teranga"].intitule;
      const validee = semainesDepuis >= 2 || (semainesDepuis === 1 && !enRetard);
      const introduction = avecTexte || validee ? INTRODUCTIONS[tirageIntro]! : null;
      const commentaire = avecTexte ? COMMENTAIRES[tirageCommentaire]! : null;
      if (validee) {
        await c.query(
          `UPDATE avancement_rapports
              SET introduction = $2, commentaire = $3, statut_commentaire = $4, statut = 'valide',
                  valide_par = $5, valide_le = $6, modifie_par = $5
            WHERE id = $1`,
          [
            id,
            introduction,
            commentaire,
            commentaire ? "redige" : "vide",
            m.chef_id,
            midi(lundi, 1440 - 120),
          ],
        );
      } else if (semainesDepuis === 1 && introduction) {
        await c.query(
          "UPDATE avancement_rapports SET introduction = $2, modifie_par = $3 WHERE id = $1",
          [id, introduction, m.chef_id],
        );
      } else if (semainesDepuis === 0 && m.intitule === CASTING["redressement-gabon"].intitule) {
        // Suggestion « IA » (gabarit déterministe) en attente de relecture par le chef de mission.
        await c.query(
          `UPDATE avancement_rapports SET commentaire_ia = $2, statut_commentaire = 'brouillon_ia',
                  modifie_par = $3 WHERE id = $1`,
          [id, COMMENTAIRE_IA_GABARIT, m.chef_id],
        );
      }
    }
  }

  // Note d'introduction de la semaine en cours, par la VRAIE route (chef de la mission Baobab).
  const baobab = await c.query<{ id: string; mission_id: string }>(
    `SELECT r.id, r.mission_id FROM avancement_rapports r JOIN missions m ON m.id = r.mission_id
      WHERE r.cabinet_id = $1 AND m.intitule = $2 AND r.semaine = $3 AND r.statut = 'brouillon'`,
    [ctx.cabinetId, CASTING["plan-baobab"].intitule, lundiCourant],
  );
  for (const { id, mission_id } of baobab.rows) {
    // Chef RÉEL de la mission (visible de son équipe seulement).
    const acteurs = await acteursMission(ctx, { id: mission_id });
    const chef = ctx.session(acteurs?.chef ?? "chef.mission");
    const lu = await chef.get(`/api/avancement/${id}`);
    attendre(200, lu, "lecture d'un rapport d'avancement");
    const rapport = lu.json() as { introduction: string | null; version: number };
    if (rapport.introduction === null) {
      attendre(
        200,
        await chef.patch(`/api/avancement/${id}`, {
          version: rapport.version,
          introduction: INTRODUCTIONS[0]!,
        }),
        "introduction d'un rapport d'avancement",
      );
    }
  }
  for (const m of missions) {
    const acteurs = await acteursMission(ctx, m);
    attendre(
      200,
      await ctx
        .session(acteurs?.directeur ?? "directeur.mission")
        .get(`/api/missions/${m.id}/avancement`),
      "liste des rapports",
    );
  }
  ctx.journal(
    `avancement : ${crees} rapport(s) créé(s) pour ${missions.length} mission(s) active(s).`,
  );
};
