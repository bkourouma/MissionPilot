import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { AppError } from "../errors.js";
import { traduireErreurFacturation } from "../facturation/outils.js";
import { routesCommentaires } from "./commentaires.js";
import { routesFichiers } from "./fichiers.js";
import { routesTachesCollaboration } from "./taches-collaboration.js";

/** SQLSTATE des déclencheurs de la collaboration (migrations 0074, 0075, 0076) → 409. */
const ERREURS_SQL: Record<string, [string, string]> = {
  MPC01: ["COMMENTAIRE_FIGE", "Ce commentaire ne peut plus être modifié."],
  MPC02: ["TACHE_FIGEE", "Le créateur et l'élément lié d'une tâche sont figés."],
};

/**
 * Fichiers et collaboration, montés sous /api : stockage et téléchargement
 * des fichiers (SOC-05), justificatifs de débours (FIN-05), commentaires
 * contextuels et tâches assignées (SOC-08). Le multipart n'est enregistré
 * QUE dans ce périmètre (encapsulation Fastify) : les autres routes ne
 * l'acceptent pas.
 */
export const routesDocumentsCollaboration: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: app.config.FICHIER_TAILLE_MAX_OCTETS,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 50,
      headerPairs: 50,
    },
    throwFileSizeLimit: true,
  });
  app.setErrorHandler(async (error) => {
    const code = (error as { code?: string }).code ?? "";
    const sql = ERREURS_SQL[code];
    if (sql) throw new AppError(409, sql[0], sql[1]);
    // Débours figé (MPB02) et erreurs des moteurs : même traduction que la facturation.
    throw traduireErreurFacturation(error);
  });
  await app.register(routesFichiers);
  await app.register(routesCommentaires);
  await app.register(routesTachesCollaboration);
};
