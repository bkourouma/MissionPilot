import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import {
  PLAFONDS_INGESTION,
  ingestionEtatQuerySchema,
  ingestionListeQuerySchema,
  numeroPageParamsSchema,
} from "@missionpilot/shared";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { exigerDossierVisible } from "../dossier/acces.js";
import { avecErreursDossier } from "../dossier/erreurs.js";
import { exigerDateClotureCoherente } from "../dossier/etats.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { fichierTropVolumineux } from "../ingestion/erreurs.js";
import {
  creerDocument,
  detailDocument,
  exigerDocument,
  listerDocuments,
  lirePage,
} from "../ingestion/documents.js";
import { lireTeleversement } from "../stockage/fichiers.js";
import { gardeTailleMultipart } from "./fichiers.js";
import { routesIngestionDd } from "./ingestion-dd.js";
import { routesIngestionStandard } from "./ingestion-standard.js";

/*
 * Ingestion de documents (lot 6, ADR-009), sous /api. Socle de l'ingestion et DOS-03 : états financiers
 * d'un dossier client lus dans un PDF ou un classeur Excel (liasse).
 *
 * - `POST /dossiers/:id/etats-financiers/document` (`dossier.ecrire`) : multipart (champ « fichier »),
 *   paramètres dans la requête ; répond 202 avec la vue du document ; la lecture se fait en tâche de fond
 *   (jobs `ingestion_extraction` puis `ingestion_structuration`), l'état financier naît ensuite avec ses
 *   contrôles (acceptation automatique seulement si tout passe, sinon revue).
 * - `GET /dossiers/:id/ingestions`, `.../:docId`, `.../:docId/pages/:numero` (`dossier.lire`).
 *
 * Ordre : permission AVANT tout accès aux données, puis dossier visible (404 sinon, y compris pour un autre
 * cabinet) AVANT de lire le corps ; un document d'un autre dossier répond 404. Aucune route n'est dans
 * `LISTE_BLANCHE_PORTAIL` : un compte du portail reçoit 403. Aucune réponse ne porte de coût, de clé de
 * stockage ou de nom non assaini ; le journal d'audit ne contient ni texte, ni extrait, ni montant.
 * Les plugins DD et standard (autres exécutants) sont enregistrés ici.
 */

function surDossier<T>(
  app: FastifyInstance,
  auth: Auth,
  clientId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return avecErreursDossier(() =>
    app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerDossierVisible(db, auth, clientId);
      return fn(db);
    }),
  );
}

const tropVolumineux = () => fichierTropVolumineux(PLAFONDS_INGESTION.tailleOctetsPdf);

const paramsDocument = z.object({ id: z.string().uuid(), docId: z.string().uuid() }).strict();
const paramsPage = paramsDocument.merge(numeroPageParamsSchema);

/** Téléversement d'un état financier : multipart enregistré dans ce seul périmètre (encapsulation Fastify). */
const routesEtatDocument: FastifyPluginAsync = async (app) => {
  const tailleMax = PLAFONDS_INGESTION.tailleOctetsPdf;
  await app.register(multipart, {
    limits: {
      fileSize: tailleMax,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 50,
      headerPairs: 50,
    },
    throwFileSizeLimit: true,
  });

  app.post(
    "/dossiers/:id/etats-financiers/document",
    // Taille annoncée refusée avant toute lecture, même sans session (413).
    { onRequest: gardeTailleMultipart(tailleMax, tropVolumineux) },
    async (request, reply) => {
      const auth = exiger(request, "dossier.ecrire");
      const { id } = paramsId.parse(request.params);
      const q = ingestionEtatQuerySchema.parse(request.query);
      // Dossier visible AVANT de lire le corps : un dossier d'autrui ne consomme rien.
      await surDossier(app, auth, id, async () => undefined);
      // Date incohérente refusée avant tout stockage.
      exigerDateClotureCoherente({ exercice: q.exercice, date_cloture: q.date_cloture });
      const recu = await lireTeleversement(request, tailleMax);
      const vue = await creerDocument(app, auth, recu, {
        usage: "etat_financier",
        client_id: id,
        parametres: {
          exercice: q.exercice,
          date_cloture: q.date_cloture,
          devise: q.devise,
          tolerance: q.tolerance,
        },
      });
      reply.status(202);
      return vue;
    },
  );
};

export const routesIngestion: FastifyPluginAsync = async (app) => {
  await app.register(routesEtatDocument);

  app.get("/dossiers/:id/ingestions", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    const q = ingestionListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return surDossier(app, auth, id, async (db) => {
      const lignes = await listerDocuments(
        db,
        { client_id: id, usages: ["etat_financier"] },
        apres,
        q.limite,
      );
      return paginer(lignes, q.limite);
    });
  });

  app.get("/dossiers/:id/ingestions/:docId", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id, docId } = paramsDocument.parse(request.params);
    return surDossier(app, auth, id, async (db) => {
      const doc = await exigerDocument(db, docId, { client_id: id, usages: ["etat_financier"] });
      return detailDocument(db, doc);
    });
  });

  app.get("/dossiers/:id/ingestions/:docId/pages/:numero", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id, docId, numero } = paramsPage.parse(request.params);
    return surDossier(app, auth, id, async (db) => {
      const doc = await exigerDocument(db, docId, { client_id: id, usages: ["etat_financier"] });
      return lirePage(db, doc.id, numero);
    });
  });

  await app.register(routesIngestionDd);
  await app.register(routesIngestionStandard);
};
