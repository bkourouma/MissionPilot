import type { FastifyPluginAsync } from "fastify";
import { estPasValide, lundiDeLaSemaine, versCentiemes } from "@missionpilot/engines";
import { resteAFaireDeclarationSchema, resteAFaireQuerySchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { AppError, conflit, interdit, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { exigerMissionVisible, peutModifierMission } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { envoyerEmails, type NotificationCreee } from "../notifications/notifier.js";
import { collaborateurAffectable, collaborateurDe } from "../planification/outils.js";
import { jours, lireParametresTemps } from "../temps/outils.js";
import { calculerSuiviMission, evaluerAlertes, vueNoeud } from "../temps/suivi.js";

const CLE_ORDRE = "lpad((9223372036854775807 - r.ordre)::text, 19, '0')";

/** Reste à faire (TPS-05), suivi budgété / réalisé / atterrissage (TPS-06 à TPS-08). */
export const routesSuiviTemps: FastifyPluginAsync = async (app) => {
  /**
   * Déclaration du reste à faire, par tâche et collaborateur, pour une
   * semaine. Pour soi (tâche affectée), ou pour un collaborateur affecté si
   * l'on peut modifier la mission (chef, directeur, associé). Ajout seul :
   * la déclaration la plus récente fait foi.
   */
  app.post("/missions/:id/reste-a-faire", async (request, reply) => {
    const auth = exiger(request, "temps.saisir");
    const { id } = paramsId.parse(request.params);
    const d = resteAFaireDeclarationSchema.parse(request.body);
    const semaine = lundiDeLaSemaine(d.semaine ?? aujourdhui());
    const { declarations, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id, true);
      if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
      const p = await lireParametresTemps(db, auth.cabinetId);
      const moi = await collaborateurDe(db, auth.utilisateurId);
      const creees: Record<string, unknown>[] = [];
      for (const [i, l] of d.lignes.entries()) {
        const tache = await db.query(
          "SELECT id, libelle FROM mission_taches WHERE id = $1 AND mission_id = $2",
          [l.tache_id, id],
        );
        if (!tache.rows[0])
          throw requeteInvalide(`Ligne ${i + 1} : tâche inconnue dans cette mission.`);
        const collaborateurId = l.collaborateur_id ?? moi?.id;
        if (!collaborateurId)
          throw conflit("Aucun collaborateur actif n'est rattaché à votre compte.");
        if (collaborateurId !== moi?.id && !peutModifierMission(auth, mission)) throw interdit();
        await collaborateurAffectable(db, collaborateurId);
        const affectee = await db.query(
          "SELECT 1 FROM affectations WHERE tache_id = $1 AND collaborateur_id = $2 LIMIT 1",
          [l.tache_id, collaborateurId],
        );
        if (!affectee.rowCount) {
          throw new AppError(
            400,
            "TACHE_NON_AFFECTEE",
            `Ligne ${i + 1} : la tâche « ${tache.rows[0].libelle as string} » n'est pas affectée à ce collaborateur.`,
          );
        }
        if (!estPasValide(l.jours, p.granularite, p.heuresParJour)) {
          throw requeteInvalide(`Ligne ${i + 1} : reste à faire hors du pas de saisie du cabinet.`);
        }
        const r = await db.query(
          `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine,
             centiemes, declare_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, tache_id, collaborateur_id, semaine::text AS semaine, centiemes, declare_par,
             declare_le`,
          [
            auth.cabinetId,
            id,
            l.tache_id,
            collaborateurId,
            semaine,
            versCentiemes(l.jours),
            auth.utilisateurId,
          ],
        );
        const { centiemes, ...reste } = r.rows[0];
        creees.push({ ...reste, jours: jours(centiemes) });
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "declaration_reste_a_faire",
        entite: "mission",
        entiteId: id,
        details: { semaine, lignes: creees.length },
      });
      const n: NotificationCreee[] = await evaluerAlertes(db, auth.cabinetId, id);
      return { declarations: creees, notifications: n };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    reply.status(201);
    return { elements: declarations };
  });

  /** Historique des déclarations (les plus récentes d'abord), par curseur. */
  app.get("/missions/:id/reste-a-faire", async (request) => {
    const auth = exiger(request, "budget.lire_jours");
    const { id } = paramsId.parse(request.params);
    const q = resteAFaireQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const r = await db.query(
        `SELECT r.id, r.tache_id, t.libelle AS tache_libelle, r.collaborateur_id,
           c.nom AS collaborateur_nom, r.semaine::text AS semaine, r.centiemes, r.declare_par,
           r.declare_le, ${CLE_ORDRE} AS cle_tri
         FROM reste_a_faire r JOIN mission_taches t ON t.id = r.tache_id
         JOIN collaborateurs c ON c.id = r.collaborateur_id
         WHERE r.mission_id = $1 AND ($2::uuid IS NULL OR r.tache_id = $2)
           AND ($3::text IS NULL OR (${CLE_ORDRE}, r.id) > ($3, $4::uuid))
         ORDER BY cle_tri, r.id
         LIMIT $5`,
        [id, q.tache_id ?? null, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
      );
      const page = paginer(r.rows, q.limite);
      return {
        ...page,
        elements: page.elements.map(({ centiemes, ...reste }) => ({
          ...reste,
          jours: jours(centiemes),
        })),
      };
    });
  });

  /**
   * Tableau budgété / réalisé / reste à faire / atterrissage / écart par
   * tâche, lot, phase et mission, par personne et par grade, avec couleurs,
   * temps en attente de validation, avancement physique et alertes actives.
   */
  app.get("/missions/:id/suivi", async (request) => {
    const auth = exiger(request, "budget.lire_jours");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      const s = await calculerSuiviMission(db, auth.cabinetId, id);
      const intitule = await db.query("SELECT intitule FROM missions WHERE id = $1", [id]);
      const alertes = await db.query(
        `SELECT niveau, noeud_id, type, message, declenchee_le FROM alertes_suivi
         WHERE mission_id = $1 AND active ORDER BY niveau, declenchee_le, id`,
        [id],
      );
      const arbre = vueNoeud(s.arbre, s);
      return {
        mission: { id, intitule: intitule.rows[0]?.intitule ?? null, statut: mission.statut },
        seuils: {
          consommation_orange_pct: s.seuils.consommationOrangePct,
          atterrissage_orange_pct: s.seuils.atterrissageOrangePct,
          atterrissage_rouge_pct: s.seuils.atterrissageRougePct,
        },
        arbre,
        par_personne: s.parPersonne,
        par_grade: s.parGrade,
        en_attente: arbre.en_attente,
        performance: s.performance,
        alertes: alertes.rows,
      };
    });
  });
};
