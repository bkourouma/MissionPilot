import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AFFECTATION_MAX_JOURS,
  ecartJours,
  affectationCreationSchema,
  affectationModificationSchema,
  affectationPourvoirSchema,
  affectationsListeQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { choisir, traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { exigerMissionVisible, peutModifierMission } from "../missions/acces.js";
import { chargerDecoupage } from "../missions/decoupage.js";
import { chargerCalendrier } from "../missions/outils.js";
import {
  avertissementsTache,
  exigerDansBudgetFige,
  joursAllouesParGrade,
  joursFigesParGrade,
  lireAffectation,
  listerAffectations,
} from "../planification/affectations.js";
import {
  collaborateurAffectable,
  exigerDansMission,
  exigerMissionAffectable,
  exigerMissionDatee,
  exigerPasDuCabinet,
  exigerPlaceSurTache,
  fenetreTache,
  type CollaborateurAffectable,
  type MissionPlanifiee,
} from "../planification/outils.js";

const paramsAffectation = z.object({ id: z.string().uuid(), affectationId: z.string().uuid() });
const TACHE_INCONNUE = "Tâche inconnue dans cette mission.";
const CHAMPS_AUDIT = [
  "tache_id",
  "collaborateur_id",
  "grade_id",
  "competence",
  "jours_alloues",
  "date_debut",
  "date_fin",
];

/** Un utilisateur ne s'affecte pas lui-même, sauf s'il dirige la mission (directeur, chef, ou modifie toutes). */
function exigerPasAutoAffectation(
  auth: Auth,
  mission: MissionPlanifiee,
  c: CollaborateurAffectable,
): void {
  if (c.utilisateur_id === auth.utilisateurId && !peutModifierMission(auth, mission)) {
    throw new AppError(403, "AUTO_AFFECTATION", "Vous ne pouvez pas vous affecter vous-même.");
  }
}

/**
 * Contrôles de période (PLN-04) : dans la mission, et dans la fenêtre planifiée
 * de la tâche (dates au plus tôt du moteur) quand le planning est ancré.
 */
async function controlerPeriode(
  db: Db,
  auth: Auth,
  mission: MissionPlanifiee,
  tacheId: string,
  periode: { debut: string; fin: string },
): Promise<void> {
  const d = await chargerDecoupage(db, mission.id);
  if (!d.taches.some((t) => t.id === tacheId)) throw requeteInvalide(TACHE_INCONNUE);
  exigerDansMission(mission, periode);
  const fenetre = fenetreTache(mission, d, tacheId, await chargerCalendrier(db, auth.cabinetId));
  if (fenetre && (periode.debut < fenetre.debut || periode.fin > fenetre.fin)) {
    throw requeteInvalide(
      `La période doit rester dans celle de la tâche (du ${fenetre.debut} au ${fenetre.fin}).`,
    );
  }
}

/**
 * L'affectation nominative d'un utilisateur l'ajoute à l'équipe (visibilité
 * de la mission), avec les garanties de POST /missions/:id/equipe (M1) :
 * - seulement si l'auteur peut modifier la mission (directeur, chef, ou
 *   modifie toutes les missions). Sinon (responsable des ressources),
 *   l'affectation est créée sans ajout d'équipe : la personne voit son
 *   planning par « Mon planning », pas toute la mission ;
 * - l'utilisateur rattaché est actif (collaborateurAffectable) ;
 * - l'ajout réel est journalisé (`ajout_equipe`, via « affectation ») et
 *   marqué `source = 'affectation'` : il est retiré avec la dernière
 *   affectation nominative de la personne (déclencheur, migration 0021). Un
 *   membre ajouté à la main n'est jamais retiré automatiquement.
 */
async function ajouterAEquipe(
  db: Db,
  auth: Auth,
  mission: MissionPlanifiee,
  c: CollaborateurAffectable,
  affectationId: string,
): Promise<void> {
  if (!c.utilisateur_id || !peutModifierMission(auth, mission)) return;
  const r = await db.query(
    `INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id, ajoute_par, source)
     VALUES ($1, $2, $3, $4, 'affectation') ON CONFLICT (mission_id, utilisateur_id) DO NOTHING
     RETURNING id`,
    [auth.cabinetId, mission.id, c.utilisateur_id, auth.utilisateurId],
  );
  if (!r.rowCount) return;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "ajout_equipe",
    entite: "mission",
    entiteId: mission.id,
    details: {
      utilisateur_id: c.utilisateur_id,
      via: "affectation",
      affectation_id: affectationId,
    },
  });
}

/** Auteur de la transaction, lu par le déclencheur de retrait d'équipe (journal). */
async function poserAuteur(db: Db, auth: Auth): Promise<void> {
  await db.query("SELECT set_config('app.utilisateur_id', $1, true)", [auth.utilisateurId]);
}

async function journal(
  db: Db,
  auth: Auth,
  action: string,
  id: string,
  details: Record<string, unknown>,
): Promise<void> {
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite: "affectation",
    entiteId: id,
    details,
  });
}

/** Affectations d'une mission (PLN-04, PLN-08). */
export const routesAffectations: FastifyPluginAsync = async (app) => {
  /** Liste paginée par curseur (date de début, id), 200 au plus par page. */
  app.get("/missions/:id/affectations", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const q = affectationsListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return paginer(await listerAffectations(db, id, apres, q.limite + 1), q.limite);
    });
  });

  app.post("/missions/:id/affectations", async (request, reply) => {
    const auth = exiger(request, "affectation.gerer");
    const { id } = paramsId.parse(request.params);
    const a = affectationCreationSchema.parse(request.body);
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionAffectable(db, auth, id);
      exigerMissionDatee(mission);
      await exigerPasDuCabinet(db, auth.cabinetId, a.jours_alloues);
      await controlerPeriode(db, auth, mission, a.tache_id, {
        debut: a.date_debut,
        fin: a.date_fin,
      });
      await exigerPlaceSurTache(db, a.tache_id);
      let collaborateur: CollaborateurAffectable | null = null;
      if (a.collaborateur_id) {
        collaborateur = await collaborateurAffectable(db, a.collaborateur_id);
        exigerPasAutoAffectation(auth, mission, collaborateur);
      } else {
        const grade = await db.query("SELECT 1 FROM grades WHERE id = $1 AND actif", [
          a.profil?.grade_id,
        ]);
        if (!grade.rowCount) throw requeteInvalide("Grade inconnu ou inactif dans ce cabinet.");
      }
      const fige = await joursFigesParGrade(db, id);
      const avant = await joursAllouesParGrade(db, id);
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, grade_id,
             competence, jours_alloues, date_debut, date_fin, cree_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            auth.cabinetId,
            id,
            a.tache_id,
            a.collaborateur_id ?? null,
            a.profil?.grade_id ?? null,
            a.profil?.competence ?? null,
            a.jours_alloues,
            a.date_debut,
            a.date_fin,
            auth.utilisateurId,
          ],
        ),
        {},
        TACHE_INCONNUE,
      );
      const affectationId = r.rows[0].id as string;
      exigerDansBudgetFige(fige, avant, await joursAllouesParGrade(db, id));
      if (collaborateur) await ajouterAEquipe(db, auth, mission, collaborateur, affectationId);
      const creee = await lireAffectation(db, id, affectationId);
      await journal(db, auth, "creation", affectationId, {
        mission_id: id,
        apres: choisir(creee, CHAMPS_AUDIT),
      });
      return {
        affectation: creee,
        avertissements: await avertissementsTache(
          db,
          a.tache_id,
          (creee.grade_id as string | null) ?? null,
        ),
      };
    });
    reply.status(201);
    return resultat;
  });

  app.patch("/missions/:id/affectations/:affectationId", async (request) => {
    const auth = exiger(request, "affectation.gerer");
    const { id, affectationId } = paramsAffectation.parse(request.params);
    const modif = affectationModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionAffectable(db, auth, id);
      exigerMissionDatee(mission);
      const avantLigne = await lireAffectation(db, id, affectationId);
      const cible = {
        tache_id: modif.tache_id ?? (avantLigne.tache_id as string),
        jours_alloues: modif.jours_alloues ?? (avantLigne.jours_alloues as number),
        date_debut: modif.date_debut ?? (avantLigne.date_debut as string),
        date_fin: modif.date_fin ?? (avantLigne.date_fin as string),
      };
      if (cible.date_fin < cible.date_debut) {
        throw requeteInvalide("La date de fin précède la date de début.");
      }
      if (ecartJours(cible.date_debut, cible.date_fin) >= AFFECTATION_MAX_JOURS) {
        throw requeteInvalide(`Une affectation couvre au plus ${AFFECTATION_MAX_JOURS} jours.`);
      }
      if (cible.tache_id !== avantLigne.tache_id) {
        await exigerPlaceSurTache(db, cible.tache_id, affectationId);
      }
      if (modif.jours_alloues !== undefined) {
        await exigerPasDuCabinet(db, auth.cabinetId, modif.jours_alloues);
      }
      await controlerPeriode(db, auth, mission, cible.tache_id, {
        debut: cible.date_debut,
        fin: cible.date_fin,
      });
      if (avantLigne.collaborateur_id) {
        // Le collaborateur doit toujours être actif pour qu'on modifie son affectation.
        const c = await collaborateurAffectable(db, avantLigne.collaborateur_id as string);
        exigerPasAutoAffectation(auth, mission, c);
      }
      const fige = await joursFigesParGrade(db, id);
      const avant = await joursAllouesParGrade(db, id);
      await traduireErreursPg(
        db.query(
          `UPDATE affectations SET tache_id = $3, jours_alloues = $4, date_debut = $5, date_fin = $6,
             modifie_le = now()
           WHERE id = $1 AND mission_id = $2`,
          [
            affectationId,
            id,
            cible.tache_id,
            cible.jours_alloues,
            cible.date_debut,
            cible.date_fin,
          ],
        ),
        {},
        TACHE_INCONNUE,
      );
      exigerDansBudgetFige(fige, avant, await joursAllouesParGrade(db, id));
      const apres = await lireAffectation(db, id, affectationId);
      const champs = Object.keys(modif);
      await journal(db, auth, "modification", affectationId, {
        mission_id: id,
        avant: choisir(avantLigne, champs),
        apres: choisir(apres, champs),
      });
      return {
        affectation: apres,
        avertissements: await avertissementsTache(
          db,
          cible.tache_id,
          (apres.grade_id as string | null) ?? null,
        ),
      };
    });
  });

  /** Profil à pourvoir → affectation nominative (PLN-04). */
  app.post("/missions/:id/affectations/:affectationId/pourvoir", async (request) => {
    const auth = exiger(request, "affectation.gerer");
    const { id, affectationId } = paramsAffectation.parse(request.params);
    const { collaborateur_id } = affectationPourvoirSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionAffectable(db, auth, id);
      const avantLigne = await lireAffectation(db, id, affectationId);
      if (!avantLigne.a_pourvoir) throw conflit("Cette affectation est déjà nominative.");
      const c = await collaborateurAffectable(db, collaborateur_id);
      exigerPasAutoAffectation(auth, mission, c);
      // La période doit toujours tenir dans la tâche et la mission (dates éventuellement recalées).
      await controlerPeriode(db, auth, mission, avantLigne.tache_id as string, {
        debut: avantLigne.date_debut as string,
        fin: avantLigne.date_fin as string,
      });
      const fige = await joursFigesParGrade(db, id);
      const avant = await joursAllouesParGrade(db, id);
      await db.query(
        `UPDATE affectations SET collaborateur_id = $3, grade_id = NULL, competence = NULL,
           modifie_le = now()
         WHERE id = $1 AND mission_id = $2`,
        [affectationId, id, collaborateur_id],
      );
      exigerDansBudgetFige(fige, avant, await joursAllouesParGrade(db, id));
      await ajouterAEquipe(db, auth, mission, c, affectationId);
      const apres = await lireAffectation(db, id, affectationId);
      await journal(db, auth, "pourvoi", affectationId, {
        mission_id: id,
        avant: choisir(avantLigne, ["grade_id", "competence"]),
        apres: { collaborateur_id },
      });
      return {
        affectation: apres,
        avertissements: await avertissementsTache(
          db,
          apres.tache_id as string,
          (apres.grade_id as string | null) ?? null,
        ),
      };
    });
  });

  app.delete("/missions/:id/affectations/:affectationId", async (request, reply) => {
    const auth = exiger(request, "affectation.gerer");
    const { id, affectationId } = paramsAffectation.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionAffectable(db, auth, id);
      const avant = await lireAffectation(db, id, affectationId);
      await poserAuteur(db, auth);
      // Le déclencheur `affectations_retrait_equipe` (0021) retire de l'équipe
      // la personne qui n'y était entrée que par affectation, quand c'était
      // sa dernière affectation nominative sur la mission (journalisé).
      await db.query("DELETE FROM affectations WHERE id = $1 AND mission_id = $2", [
        affectationId,
        id,
      ]);
      await journal(db, auth, "suppression", affectationId, {
        mission_id: id,
        avant: choisir(avant, CHAMPS_AUDIT),
      });
    });
    return reply.status(204).send();
  });
};
