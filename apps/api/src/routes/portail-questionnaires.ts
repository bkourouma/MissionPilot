import type { FastifyPluginAsync } from "fastify";
import { portailListeQuerySchema, saisieReponsesSchema } from "@missionpilot/shared";
import { decoderCurseur, paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { exigerPortail, journaliserPortail } from "../portail/acces.js";
import {
  avecPortailQuestionnaires,
  enregistrerBrouillon,
  mesQuestionnaires,
  monQuestionnaire,
  soumettre,
  vueQuestionnaire,
} from "../questionnaires/portail.js";

/*
 * Réponses aux questionnaires depuis le portail client (SOC-09, SOC-10),
 * montées sous /api/portail/questionnaires (liste blanche du portail :
 * portail/garde.ts). Seuls les dirigeants et contributeurs client répondent
 * (DECISIONS.md, V2) : permission dédiée « portail.questionnaires.repondre »,
 * que l'investisseur ne détient pas, pour lire SES questionnaires et y
 * répondre. Chaque accès est journalisé ; règles d'accès :
 * questionnaires/portail.ts.
 */

const PERMISSION = "portail.questionnaires.repondre" as const;

export const routesPortailQuestionnaires: FastifyPluginAsync = async (app) => {
  app.get("/portail/questionnaires", async (request) => {
    const acces = exigerPortail(request, PERMISSION);
    const q = portailListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortailQuestionnaires(app, acces, async (db) => {
      const page = await mesQuestionnaires(db, acces, apres, q.limite);
      await journaliserPortail(db, acces, "portail_lecture", "questionnaires", null, {
        nombre: page.elements.length,
      });
      return page;
    });
  });

  app.get("/portail/questionnaires/:id", async (request) => {
    const acces = exigerPortail(request, PERMISSION);
    const { id } = paramsId.parse(request.params);
    return avecPortailQuestionnaires(app, acces, async (db) => {
      const vue = await monQuestionnaire(db, acces, id);
      await journaliserPortail(db, acces, "portail_lecture", "questionnaire_envoi", id);
      return vue;
    });
  });

  /** Sauvegarde automatique d'un brouillon (fusion des réponses citées). */
  app.patch("/portail/questionnaires/:id/reponses", async (request) => {
    const acces = exigerPortail(request, PERMISSION);
    const { id } = paramsId.parse(request.params);
    const { reponses } = saisieReponsesSchema.parse(request.body);
    return avecPortailQuestionnaires(app, acces, async (db) => {
      const { envoi, reponse } = await enregistrerBrouillon(db, acces, id, reponses);
      await journaliserPortail(db, acces, "portail_saisie", "questionnaire_envoi", id, {
        questions: Object.keys(reponses).length,
      });
      return vueQuestionnaire(acces, envoi, reponse, true);
    });
  });

  app.post("/portail/questionnaires/:id/soumettre", async (request) => {
    const acces = exigerPortail(request, PERMISSION);
    const { id } = paramsId.parse(request.params);
    const { vue, notification } = await avecPortailQuestionnaires(app, acces, async (db) => {
      const resultat = await soumettre(db, acces, id);
      await journaliserPortail(db, acces, "portail_soumission", "questionnaire_envoi", id);
      return resultat;
    });
    await envoyerEmails(app.mailer, [notification], (m) => app.log.warn(m));
    return vue;
  });
};
