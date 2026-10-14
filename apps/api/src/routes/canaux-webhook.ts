import type { FastifyPluginAsync } from "fastify";
import { PLAFONDS_CANAUX } from "@missionpilot/shared";
import { traduireErreurCanaux } from "../canaux/erreurs.js";
import { traiterWebhook } from "../canaux/webhook.js";

/*
 * Webhook entrant WhatsApp (lot 3c, SPEC-3c §8) : plugin ENCAPSULÉ. Un analyseur de contenu
 * `application/json` en tampon BRUT (la signature HMAC porte sur les octets reçus, jamais sur un JSON
 * ré-sérialisé) ne vaut que pour cette route ; tout autre type de contenu : 415 ; `bodyLimit` de
 * 64 Kio (413 au-delà) ; la méthode GET n'est pas enregistrée (le défi de vérification de Meta est un
 * point OUVERT : O-13). La route n'existe QU'AVEC un fournisseur WhatsApp configuré : sans lui, 404
 * comme une route inconnue. Justification de la route publique : voir `canaux/webhook.ts`.
 */
export const routesCanauxWebhook: FastifyPluginAsync = async (app) => {
  if (app.canaux.whatsapp === null) return;
  // Aucun autre analyseur (text/plain, formulaire…) : tout autre type de contenu donne 415.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: PLAFONDS_CANAUX.webhookCorpsMaxOctets },
    (_request, body, done) => done(null, body),
  );
  app.setErrorHandler(async (error) => {
    throw traduireErreurCanaux(error);
  });
  app.post(
    "/canaux/whatsapp/webhook",
    { bodyLimit: PLAFONDS_CANAUX.webhookCorpsMaxOctets },
    async (request) => traiterWebhook(app, request),
  );
};
