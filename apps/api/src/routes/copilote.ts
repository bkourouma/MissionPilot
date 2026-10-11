import type { FastifyPluginAsync } from "fastify";
import { messageCopiloteSchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { annulerAction, confirmerAction } from "../copilote/actions.js";
import { traiterMessage } from "../copilote/service.js";
import { paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";

/**
 * AGT-08 : copilote conversationnel unique, dans les droits de l'utilisateur.
 *
 * - `POST /copilote/messages` : un message (1 000 caractères au plus), une réponse construite par
 *   le code ; l'IA, si le cabinet l'a activée, ne fait que ROUTER vers un outil d'un catalogue
 *   fermé (copilote/service.ts). Plafond de débit : 30 messages par 10 minutes et par utilisateur
 *   (429).
 * - `POST /copilote/actions/:id/confirmer` et `…/annuler` : une action modifiante n'est jamais
 *   exécutée par le copilote ; l'utilisateur confirme la PROPOSITION (même utilisateur, une seule
 *   fois, avant expiration, droits revérifiés) ou l'annule (copilote/actions.ts).
 *
 * Chaque route exige `copilote.utiliser`. Aucune n'est dans `LISTE_BLANCHE_PORTAIL` : fermées au
 * portail client (403 `PORTAIL_ROUTE_INTERDITE`). Aucune conversation n'est conservée ; les
 * réponses ne sont jamais mises en cache.
 */
export const routesCopilote: FastifyPluginAsync = async (app) => {
  app.post("/copilote/messages", async (request, reply) => {
    const auth = exiger(request, "copilote.utiliser");
    const corps = messageCopiloteSchema.parse(request.body);
    const { reponse, notifications } = await traiterMessage(
      {
        database: app.db,
        config: app.config,
        journalIa: (entree) => app.log.info({ ia: entree }),
      },
      auth,
      corps,
    );
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return reply.header("cache-control", "private, no-store").send(reponse);
  });

  app.post("/copilote/actions/:id/confirmer", async (request, reply) => {
    const auth = exiger(request, "copilote.utiliser");
    const { id } = paramsId.parse(request.params);
    const { resultat, notifications } = await confirmerAction(app.db, auth, id, new Date());
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return reply.header("cache-control", "private, no-store").send(resultat);
  });

  app.post("/copilote/actions/:id/annuler", async (request, reply) => {
    const auth = exiger(request, "copilote.utiliser");
    const { id } = paramsId.parse(request.params);
    const resultat = await annulerAction(app.db, auth, id, new Date());
    return reply.header("cache-control", "private, no-store").send(resultat);
  });
};
