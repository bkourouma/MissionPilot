import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../errors.js";
import { ErreurLlm } from "../ia/fournisseur.js";
import { routesIaCouts } from "./ia-couts.js";
import { routesIaGenerations } from "./ia-generations.js";
import { routesIaParametres } from "./ia-parametres.js";
import { routesIaPrompts } from "./ia-prompts.js";

/** SQLSTATE des déclencheurs du socle IA (migrations 0101, 0102) → 409. */
const ERREURS_SQL: Record<string, [string, string]> = {
  MPI01: ["HISTORIQUE_IA_IMMUABLE", "Historique IA en ajout seul : créer une nouvelle version."],
  MPI02: ["VERSION_PROMPT", "Version de prompt refusée (créée entre-temps ou tâche différente)."],
  MPI03: ["GENERATION_TERMINEE", "Cette génération est terminée : plus aucun changement."],
  MPI04: ["VERSION_CONTENU", "Contenu modifié entre-temps ou déjà validé : rechargez-le."],
};

/**
 * Socle IA de la V2 (ADR-003), monté sous /api/ia : paramètres du cabinet,
 * prompts versionnés, générations tracées et circuit de validation humaine,
 * coûts. Les erreurs du fournisseur (ErreurLlm, messages fixes sans clé ni
 * contenu) deviennent 502 ; les refus des déclencheurs, 409.
 */
export const routesIa: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    const code = (error as { code?: string }).code ?? "";
    const sql = ERREURS_SQL[code];
    if (sql) throw new AppError(409, sql[0], sql[1]);
    if (error instanceof ErreurLlm) throw new AppError(502, error.code, error.message);
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "CONFLIT", "Modification simultanée : réessayez.");
    }
    throw error;
  });
  await app.register(routesIaParametres);
  await app.register(routesIaPrompts);
  await app.register(routesIaGenerations);
  await app.register(routesIaCouts);
};
