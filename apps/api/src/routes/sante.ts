import type { FastifyPluginAsync } from "fastify";

export const routesSante: FastifyPluginAsync = async (app) => {
  app.get("/sante", async () => ({ statut: "ok" }));
};
