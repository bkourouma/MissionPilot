import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  ecartsQuestionnaireQuerySchema,
  envoiQuestionnaireCreationSchema,
  envoiQuestionnaireModificationSchema,
  modeleQuestionnaireCreationSchema,
  questionnaireListeQuerySchema,
  relanceQuestionnaireSchema,
  versionQuestionnaireCreationSchema,
  versionQuestionnaireModificationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { envoyerEmails, type NotificationCreee } from "../notifications/notifier.js";
import { exigerEnvoiVisible, exigerMissionOuverte } from "../questionnaires/acces.js";
import {
  cloreEnvoi,
  creerEnvoi,
  detailEnvoi,
  ecartsEnvoi,
  envoyerEnvoi,
  listerEnvoisMission,
  modifierEnvoi,
  repondantsEligibles,
  reponsesSoumises,
} from "../questionnaires/envois.js";
import { traduireErreurQuestionnaires } from "../questionnaires/erreurs.js";
import {
  creerModele,
  creerVersion,
  GABARITS,
  lireModele,
  lireVersion,
  listerModeles,
  modifierVersion,
  validerVersion,
} from "../questionnaires/modeles.js";
import { relancerManuellement } from "../questionnaires/relances.js";
import { routesNotation } from "./notation.js";
import { routesPortailQuestionnaires } from "./portail-questionnaires.js";

/*
 * Questionnaires (SOC-10) côté cabinet, montés sous /api, avec la notation
 * (routes/notation.ts) et les réponses du portail client
 * (routes/portail-questionnaires.ts, /api/portail/questionnaires/**).
 *
 * Lecture : questionnaire.lire ; rédaction, validation, envoi (dont la liste
 * des répondants désignables), relance, clôture : questionnaire.gerer.
 * Envois et réponses : mission visible
 * (404 sinon), mission non clôturée pour écrire (questionnaires/acces.ts).
 */

const paramsEnvoi = z.object({ id: z.string().uuid() }).strict();

export const routesQuestionnaires: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurQuestionnaires(error);
  });

  /** Envoie les e-mails des notifications après validation de la transaction. */
  const apresValidation = (notifications: readonly (NotificationCreee | null)[]) =>
    envoyerEmails(app.mailer, notifications, (m) => app.log.warn(m));

  app.get("/questionnaires/gabarits", async (request) => {
    exiger(request, "questionnaire.lire");
    return {
      elements: Object.entries(GABARITS).map(([code, d]) => ({
        code,
        titre: d.titre,
        sections: d.sections.length,
        questions: d.sections.reduce((n, s) => n + s.questions.length, 0),
      })),
    };
  });

  app.get("/questionnaires/modeles", async (request) => {
    const auth = exiger(request, "questionnaire.lire");
    const q = questionnaireListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, (db) => listerModeles(db, apres, q.limite));
  });

  app.post("/questionnaires/modeles", async (request, reply) => {
    const auth = exiger(request, "questionnaire.gerer");
    const corps = modeleQuestionnaireCreationSchema.parse(request.body);
    const modele = await app.db.withTenant(auth.cabinetId, (db) => creerModele(db, auth, corps));
    reply.status(201);
    return modele;
  });

  app.get("/questionnaires/modeles/:id", async (request) => {
    const auth = exiger(request, "questionnaire.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireModele(db, id));
  });

  app.post("/questionnaires/modeles/:id/versions", async (request, reply) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsId.parse(request.params);
    const { definition } = versionQuestionnaireCreationSchema.parse(request.body ?? {});
    const version = await app.db.withTenant(auth.cabinetId, (db) =>
      creerVersion(db, auth, id, definition),
    );
    reply.status(201);
    return version;
  });

  app.get("/questionnaires/versions/:id", async (request) => {
    const auth = exiger(request, "questionnaire.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireVersion(db, id));
  });

  app.put("/questionnaires/versions/:id", async (request) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsId.parse(request.params);
    const { definition } = versionQuestionnaireModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierVersion(db, auth, id, definition));
  });

  app.post("/questionnaires/versions/:id/valider", async (request) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => validerVersion(db, auth, id));
  });

  app.get("/missions/:id/questionnaires", async (request) => {
    const auth = exiger(request, "questionnaire.lire");
    const { id } = paramsId.parse(request.params);
    const q = questionnaireListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    const lignes = await app.db.withTenant(auth.cabinetId, (db) =>
      listerEnvoisMission(db, auth, id, apres, q.limite),
    );
    return paginer(lignes, q.limite);
  });

  /**
   * Répondants désignables pour un envoi de la mission (écran d'envoi) :
   * questionnaire.gerer, mission visible et ouverte ; utilisateurs du portail
   * actifs du client (actif), dirigeants et contributeurs seulement.
   */
  app.get("/missions/:id/questionnaires/repondants-eligibles", async (request) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsId.parse(request.params);
    const q = questionnaireListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, (db) =>
      repondantsEligibles(db, auth, id, apres, q.limite),
    );
  });

  app.post("/missions/:id/questionnaires", async (request, reply) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = envoiQuestionnaireCreationSchema.parse(request.body);
    const envoi = await app.db.withTenant(auth.cabinetId, (db) => creerEnvoi(db, auth, id, corps));
    reply.status(201);
    return envoi;
  });

  app.get("/questionnaires/envois/:id", async (request) => {
    const auth = exiger(request, "questionnaire.lire");
    const { id } = paramsEnvoi.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailEnvoi(db, await exigerEnvoiVisible(db, auth, id)),
    );
  });

  app.patch("/questionnaires/envois/:id", async (request) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsEnvoi.parse(request.params);
    const modif = envoiQuestionnaireModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await modifierEnvoi(db, auth, id, modif);
      return detailEnvoi(db, await exigerEnvoiVisible(db, auth, id));
    });
  });

  app.post("/questionnaires/envois/:id/envoyer", async (request) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsEnvoi.parse(request.params);
    const { detail, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { notifications } = await envoyerEnvoi(db, auth, id);
      return {
        notifications,
        detail: await detailEnvoi(db, await exigerEnvoiVisible(db, auth, id)),
      };
    });
    await apresValidation(notifications);
    return detail;
  });

  app.post("/questionnaires/envois/:id/clore", async (request) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsEnvoi.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await cloreEnvoi(db, auth, id);
      return detailEnvoi(db, await exigerEnvoiVisible(db, auth, id));
    });
  });

  app.post("/questionnaires/envois/:id/relancer", async (request) => {
    const auth = exiger(request, "questionnaire.gerer");
    const { id } = paramsEnvoi.parse(request.params);
    const { repondant_ids } = relanceQuestionnaireSchema.parse(request.body ?? {});
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const envoi = await exigerEnvoiVisible(db, auth, id, true);
      await exigerMissionOuverte(db, auth, envoi.mission_id);
      return relancerManuellement(db, auth, envoi, repondant_ids);
    });
    await apresValidation(resultat.notifications);
    return { relances: resultat.relances };
  });

  /** Réponses SOUMISES (contenu) ; les brouillons du client ne sont pas servis. */
  app.get("/questionnaires/envois/:id/reponses", async (request) => {
    const auth = exiger(request, "questionnaire.lire");
    const { id } = paramsEnvoi.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const envoi = await exigerEnvoiVisible(db, auth, id);
      const elements = await reponsesSoumises(db, envoi.id);
      return {
        mode: envoi.mode,
        elements: elements.map((r) => ({
          id: r.id,
          repondant: r.repondant_id
            ? { id: r.repondant_id, nom: r.nom, fonction: r.fonction }
            : null,
          soumise_le: r.soumise_le,
          soumise_par_nom: r.soumise_par_nom,
          reponses: r.reponses,
        })),
      };
    });
  });

  app.get("/questionnaires/envois/:id/ecarts", async (request) => {
    const auth = exiger(request, "questionnaire.lire");
    const { id } = paramsEnvoi.parse(request.params);
    const { seuil } = ecartsQuestionnaireQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      ecartsEnvoi(db, await exigerEnvoiVisible(db, auth, id), seuil),
    );
  });

  await app.register(routesNotation);
  await app.register(routesPortailQuestionnaires);
};
