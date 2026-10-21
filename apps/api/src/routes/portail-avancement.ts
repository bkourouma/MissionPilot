import type { FastifyPluginAsync } from "fastify";
import { portailAvancementListeQuerySchema } from "@missionpilot/shared";
import { paramsId } from "../http/outils.js";
import { avecPortail, exigerPortail, journaliserPortail } from "../portail/acces.js";
import { listerRapportsPortail, lireRapportPortail } from "../portail/avancement.js";

/*
 * Rapports d'avancement hebdomadaires VALIDÉS, sous /api/portail/avancement (AUT-10). Lecture seule.
 * Un brouillon, un rapport d'une autre mission, d'un autre client ou d'un autre cabinet répondent le
 * même 404 du portail. Permission `portail.avancement.lire` ; chaque accès est journalisé.
 */
export const routesPortailAvancement: FastifyPluginAsync = async (app) => {
  app.get("/portail/avancement", async (request) => {
    const acces = exigerPortail(request, "portail.avancement.lire");
    const q = portailAvancementListeQuerySchema.parse(request.query);
    return avecPortail(app, acces, async (db) => {
      const page = await listerRapportsPortail(db, acces, q);
      await journaliserPortail(db, acces, "portail.avancement.lister", "avancement_rapport", null, {
        nombre: page.elements.length,
      });
      return page;
    });
  });

  app.get("/portail/avancement/:id", async (request) => {
    const acces = exigerPortail(request, "portail.avancement.lire");
    const { id } = paramsId.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const vue = await lireRapportPortail(db, acces, id);
      await journaliserPortail(db, acces, "portail.avancement.lire", "avancement_rapport", id);
      return vue;
    });
  });
};
