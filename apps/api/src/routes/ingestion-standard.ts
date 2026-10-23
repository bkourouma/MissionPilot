import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import {
  PLAFONDS_INGESTION,
  aPermission,
  extractionDecisionSchema,
  extractionModificationSchema,
  ingestionListeQuerySchema,
  numeroPageParamsSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { signalerJobCree } from "../jobs/reveil.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { fichierTropVolumineux } from "../ingestion/erreurs.js";
import {
  creerDocument,
  detailDocument,
  exigerDocument,
  listerDocuments,
  lirePage,
  relancerStructuration,
  vueDocument,
} from "../ingestion/documents.js";
import {
  deciderExtraction,
  lireExtraction,
  listerExtractions,
  modifierExtraction,
} from "../ingestion/extractions.js";
import { lireVersion } from "../standard/contenu.js";
import { traduireErreurStandard, versionPubliee } from "../standard/erreurs.js";
import { lireTeleversement } from "../stockage/fichiers.js";
import { gardeTailleMultipart } from "./fichiers.js";

/*
 * Amorçage du standard à partir de documents historiques (STD-13, ADR-009 décision 10), sous /api.
 *
 * - POST /methodes/versions/:id/amorcage/documents : téléversement (multipart, champ « fichier », PDF ou
 *   XLSX) vers un BROUILLON de méthode du cabinet ; 202 avec la vue du document ;
 * - GET /methodes/versions/:id/amorcage/documents ; GET /amorcage/documents/:docId (+ /pages/:numero) ;
 * - POST /amorcage/documents/:docId/proposition : relance de la structuration (`ia.utiliser` aussi) ;
 * - PATCH /amorcage/extractions/:id (correction) ; POST /amorcage/extractions/:id/decision (la validation
 *   APPLIQUE la proposition au brouillon par l'éditeur ; rien n'est publié, jamais).
 *
 * Ordre : permission `standard.gerer` AVANT tout accès aux données (un document d'historique du cabinet n'est
 * pas lisible de tous), puis version lue par RLS (404 pour un autre cabinet, pour le standard ou une version
 * inconnue ; 409 si la version cible d'un téléversement est publiée) AVANT de lire le corps.
 * HYPOTHÈSE MÉTIER (FIN-02, À VALIDER PAR LE MÉTIER) : le texte brut d'un document historique peut porter
 * des taux journaliers et des honoraires, données de gestion réservées à `finance.lire` ; GET
 * .../pages/:numero (texte d'une page) n'est donc servi qu'à l'AUTEUR du document ou à un détenteur de
 * `finance.lire` (403 sinon). La vue détail (métadonnées de pages sans texte) reste ouverte à
 * `standard.gerer`. Option prudente et réversible : lever la condition suffit à revenir en arrière. Un document d'un
 * autre usage répond 404. Aucune route n'est dans `LISTE_BLANCHE_PORTAIL` (403 portail). Aucune réponse ne
 * porte de coût, de clé de stockage ni d'identifiant de fichier. Journal : ids et compteurs seulement
 * (jamais de texte, d'extrait ni de code libre ; le journal de l'éditeur trace les codes qu'il crée).
 */

const USAGES = ["standard_historique"] as const;

const tropVolumineux = () => fichierTropVolumineux(PLAFONDS_INGESTION.tailleOctetsPdf);

const paramsDocument = z.object({ docId: z.string().uuid() }).strict();
const paramsPage = paramsDocument.merge(numeroPageParamsSchema);

/** MQG03 : version cible devenue publiée entre le contrôle et l'insertion. */
const SQL_VERSION_CIBLE = "MQG03";

/** Version du cabinet (404 : autre cabinet, standard ou inconnue) ; `brouillon` : 409 si publiée. */
async function versionDuCabinet(db: Db, id: string, brouillon: boolean) {
  const v = await lireVersion(db, id);
  if (v.cabinet_id === null) throw introuvable("Version de méthode");
  if (brouillon && v.statut !== "brouillon") throw versionPubliee();
  return v;
}

/** Téléversement : multipart enregistré dans ce seul périmètre (encapsulation Fastify). */
const routesTeleversement: FastifyPluginAsync = async (app) => {
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
    "/methodes/versions/:id/amorcage/documents",
    { onRequest: gardeTailleMultipart(tailleMax, tropVolumineux) },
    async (request, reply) => {
      const auth = exiger(request, "standard.gerer");
      const { id } = paramsId.parse(request.params);
      // Brouillon du cabinet vérifié AVANT de lire le corps : une version d'autrui ne consomme rien.
      await app.db.withTenant(auth.cabinetId, (db) => versionDuCabinet(db, id, true));
      const recu = await lireTeleversement(request, tailleMax);
      const vue = await creerDocument(app, auth, recu, {
        usage: "standard_historique",
        version_methode_id: id,
      });
      reply.status(202);
      return vue;
    },
  );
};

export const routesIngestionStandard: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    if ((error as { code?: string }).code === SQL_VERSION_CIBLE) throw versionPubliee();
    throw traduireErreurStandard(error);
  });

  await app.register(routesTeleversement);

  app.get("/methodes/versions/:id/amorcage/documents", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const q = ingestionListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await versionDuCabinet(db, id, false);
      const lignes = await listerDocuments(
        db,
        { version_methode_id: id, usages: USAGES },
        apres,
        q.limite,
      );
      return paginer(lignes, q.limite);
    });
  });

  app.get("/amorcage/documents/:docId", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { docId } = paramsDocument.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailDocument(db, await exigerDocument(db, docId, { usages: USAGES })),
    );
  });

  app.get("/amorcage/documents/:docId/pages/:numero", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { docId, numero } = paramsPage.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const doc = await exigerDocument(db, docId, { usages: USAGES });
      // FIN-02 (hypothèse à valider) : texte réservé à l'auteur ou à `finance.lire`.
      if (doc.cree_par !== auth.utilisateurId && !aPermission(auth.roles, "finance.lire")) {
        throw interdit();
      }
      return lirePage(db, doc.id, numero);
    });
  });

  app.post("/amorcage/documents/:docId/proposition", async (request, reply) => {
    exiger(request, "standard.gerer");
    const auth = exiger(request, "ia.utiliser");
    const { docId } = paramsDocument.parse(request.params);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const doc = await exigerDocument(db, docId, { usages: USAGES }, true);
      if (doc.statut !== "termine") throw conflit("Le document n'est pas encore lu.");
      if (doc.version_methode_id === null) throw introuvable("Version de méthode");
      await versionDuCabinet(db, doc.version_methode_id, true);
      const extractions = await listerExtractions(db, doc.id);
      if (extractions.some((x) => x.statut === "brouillon_ia" || x.statut === "modifie")) {
        throw new AppError(
          409,
          "EXTRACTION_OUVERTE",
          "Un brouillon est déjà ouvert pour ce document : validez-le ou rejetez-le d'abord.",
        );
      }
      const relancable =
        extractions.length === 0
          ? doc.resultat === "ia_indisponible" || doc.resultat === "rien_trouve"
          : extractions[0]?.statut === "rejete";
      if (!relancable)
        throw conflit("Ce document ne se relance pas : sa proposition est tranchée.");
      await relancerStructuration(db, auth, doc.id, new Date());
      return vueDocument(await exigerDocument(db, docId, { usages: USAGES }));
    });
    signalerJobCree(); // après le COMMIT de la relance
    reply.status(202);
    return vue;
  });

  /** Extraction d'un document d'amorçage (404 pour tout autre usage), sous le droit `standard.gerer`. */
  const extractionDuStandard = async (db: Db, id: string) => {
    const x = await lireExtraction(db, id);
    await exigerDocument(db, x.document_id, { usages: USAGES });
    return x;
  };

  app.patch("/amorcage/extractions/:id", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = extractionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await extractionDuStandard(db, id);
      return modifierExtraction(db, auth, id, corps.contenu);
    });
  });

  app.post("/amorcage/extractions/:id/decision", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = extractionDecisionSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await extractionDuStandard(db, id);
      return deciderExtraction(db, auth, id, corps);
    });
  });
};
