import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import {
  PLAFONDS_INGESTION,
  extractionDecisionSchema,
  extractionModificationSchema,
  ingestionDdQuerySchema,
  ingestionListeQuerySchema,
  numeroPageParamsSchema,
  TYPES_DOCUMENT_DD,
  type UsageIngestion,
} from "@missionpilot/shared";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { dossierAccessible, exigerAussi, type DossierLu } from "../due-diligence/acces.js";
import { journalDd } from "../due-diligence/journal.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { fichierTropVolumineux } from "../ingestion/erreurs.js";
import {
  creerDocument,
  detailDocument,
  lireDocument,
  listerDocuments,
  lirePage,
  relancerStructuration,
  vueDocument,
  type DocumentIngestion,
} from "../ingestion/documents.js";
import {
  deciderExtraction,
  lireExtraction,
  listerExtractions,
  modifierExtraction,
} from "../ingestion/extractions.js";
import { lireTeleversement } from "../stockage/fichiers.js";
import { gardeTailleMultipart } from "./fichiers.js";

/*
 * Ingestion de documents pour la due diligence (DD-02 rapports PDF, DD-10 salle de données ; ADR-009
 * décision 9), sous /api. Un document PDF ou XLSX est lu par l'IA en un RÉSUMÉ et des ÉLÉMENTS (page et
 * extrait recopié), proposés comme BROUILLON : « l'IA propose, l'expert dispose ». Valider un brouillon ne
 * pousse rien ailleurs (ni verdicts, ni registre des preuves, ni rapport) : la lecture reste consultable ici.
 *
 * Ordre de chaque route : permission par `exiger` AVANT tout accès aux données, puis le dossier DD du
 * document (`dossierAccessible` : 404 hors cabinet ou mission non visible ; écriture : mission verrouillée et
 * non clôturée, 409 MISSION_CLOTUREE). Un document d'un autre usage que DD répond 404. Aucune route n'est
 * dans `LISTE_BLANCHE_PORTAIL` (403 pour un compte du portail). Aucune réponse ne porte coût, clé de
 * stockage ni `fichier_id` ; le journal ne contient ni texte, ni extrait, ni énoncé, ni montant.
 * Le téléversement doit être validé par les droits AVANT la lecture du corps.
 */

const USAGE_DE_TYPE: Record<(typeof TYPES_DOCUMENT_DD)[number], UsageIngestion> = {
  rapport: "dd_rapport",
  salle: "dd_salle",
};
const USAGES_DD: readonly UsageIngestion[] = ["dd_rapport", "dd_salle"];

const listeQuerySchema = ingestionListeQuerySchema.extend({
  type: z.enum(TYPES_DOCUMENT_DD).optional(),
});
const paramsDoc = z.object({ docId: z.string().uuid() }).strict();
const paramsPage = paramsDoc.merge(numeroPageParamsSchema);

const tropVolumineux = () => fichierTropVolumineux(PLAFONDS_INGESTION.tailleOctetsPdf);

/**
 * Document DD (rapport ou salle) et son dossier, accessibles à l'appelant ; 404 sinon, au même libellé
 * qu'il n'existe pas, soit d'un autre cabinet, d'un autre usage ou d'une mission invisible.
 */
async function documentAccessible(
  db: Db,
  auth: Auth,
  docId: string,
  ecriture: boolean,
): Promise<{ doc: DocumentIngestion; dossier: DossierLu }> {
  const doc = await lireDocument(db, docId);
  if (!doc || doc.dd_dossier_id === null || !USAGES_DD.includes(doc.usage)) {
    throw introuvable("Document");
  }
  const { dossier } = await dossierAccessible(db, auth, doc.dd_dossier_id, ecriture, "Document");
  return { doc, dossier };
}

/** Extraction d'un document DD accessible (404 sinon). */
async function extractionAccessible(db: Db, auth: Auth, id: string, ecriture: boolean) {
  const x = await lireExtraction(db, id);
  const { doc, dossier } = await documentAccessible(db, auth, x.document_id, ecriture);
  return { x, doc, dossier };
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
    "/dd/dossiers/:id/documents",
    // Taille annoncée refusée avant toute lecture, même sans session (413).
    { onRequest: gardeTailleMultipart(tailleMax, tropVolumineux) },
    async (request, reply) => {
      const auth = exiger(request, "dd.ecrire");
      const { id } = paramsId.parse(request.params);
      const q = ingestionDdQuerySchema.parse(request.query);
      // Dossier visible et mission ouverte AVANT de lire le corps : un dossier d'autrui ne consomme rien.
      await app.db.withTenant(auth.cabinetId, (db) => dossierAccessible(db, auth, id, true));
      const recu = await lireTeleversement(request, tailleMax);
      const usage = USAGE_DE_TYPE[q.type];
      const vue = await creerDocument(app, auth, recu, { usage, dd_dossier_id: id });
      await app.db.withTenant(auth.cabinetId, (db) =>
        journalDd(db, auth, "dd_document_televerse", "ingestion_document", vue.id, {
          dossier_id: id,
          type: q.type,
        }),
      );
      reply.status(202);
      return vue;
    },
  );
};

export const routesIngestionDd: FastifyPluginAsync = async (app) => {
  await app.register(routesTeleversement);

  app.get("/dd/dossiers/:id/documents", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    const q = listeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      const usages = q.type ? [USAGE_DE_TYPE[q.type]] : USAGES_DD;
      const lignes = await listerDocuments(db, { dd_dossier_id: id, usages }, apres, q.limite);
      return paginer(lignes, q.limite);
    });
  });

  app.get("/dd/documents/:docId", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { docId } = paramsDoc.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { doc } = await documentAccessible(db, auth, docId, false);
      return detailDocument(db, doc);
    });
  });

  app.get("/dd/documents/:docId/pages/:numero", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { docId, numero } = paramsPage.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { doc } = await documentAccessible(db, auth, docId, false);
      return lirePage(db, doc.id, numero);
    });
  });

  // Relance de la lecture : IA indisponible ou rien trouvé, ou dernier brouillon rejeté.
  app.post("/dd/documents/:docId/lecture", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    exigerAussi(auth, "ia.utiliser");
    const { docId } = paramsDoc.parse(request.params);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { doc, dossier } = await documentAccessible(db, auth, docId, true);
      if (doc.statut !== "termine") throw conflit("Seul un document terminé se relit.");
      const extractions = await listerExtractions(db, doc.id);
      if (extractions.some((x) => x.statut === "brouillon_ia" || x.statut === "modifie")) {
        throw new AppError(
          409,
          "EXTRACTION_OUVERTE",
          "Un brouillon est déjà ouvert pour ce document : validez-le ou rejetez-le d'abord.",
        );
      }
      const relancable =
        doc.resultat === "ia_indisponible" ||
        doc.resultat === "rien_trouve" ||
        extractions[0]?.statut === "rejete";
      if (!relancable) {
        throw new AppError(
          409,
          "LECTURE_NON_RELANCABLE",
          "La lecture de ce document est déjà aboutie : rien à relancer.",
        );
      }
      await relancerStructuration(db, auth, doc.id, new Date());
      await journalDd(db, auth, "dd_document_relu", "ingestion_document", doc.id, {
        dossier_id: dossier.id,
      });
      const relu = await lireDocument(db, doc.id);
      return vueDocument(relu as DocumentIngestion);
    });
    reply.status(202);
    return vue;
  });

  app.patch("/dd/extractions/:id", async (request) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = extractionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await extractionAccessible(db, auth, id, true);
      const vue = await modifierExtraction(db, auth, id, c.contenu);
      await journalDd(db, auth, "dd_lecture_modifiee", "ingestion_extraction", id, {
        dossier_id: dossier.id,
      });
      return vue;
    });
  });

  app.post("/dd/extractions/:id/decision", async (request) => {
    const auth = exiger(request, "dd.valider");
    const { id } = paramsId.parse(request.params);
    const c = extractionDecisionSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await extractionAccessible(db, auth, id, true);
      const vue = await deciderExtraction(db, auth, id, c);
      await journalDd(db, auth, "dd_lecture_decidee", "ingestion_extraction", id, {
        dossier_id: dossier.id,
        decision: c.decision,
      });
      return vue;
    });
  });
};
