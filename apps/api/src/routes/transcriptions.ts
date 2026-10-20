import multipart from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import {
  transcriptionCreationSchema,
  transcriptionIfMatchSchema,
  transcriptionParamSchema,
  transcriptionRejetSchema,
  transcriptionsQuerySchema,
  transcriptionTexteSchema,
  transcriptionValidationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { traduireErreurCanaux } from "../canaux/erreurs.js";
import {
  ajouterVersionHumaine,
  creerTranscription,
  detailTranscription,
  enregistrerAudio,
  fichierAudioDe,
  listerTranscriptions,
  rejeterTranscription,
  validerTranscription,
} from "../canaux/transcriptions.js";
import { AppError, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { exigerMissionModifiable, exigerMissionVisible } from "../missions/acces.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { lireTeleversement } from "../stockage/fichiers.js";
import { contentDisposition } from "../stockage/nom.js";
import { avecPlaceAnalyse, gardeTailleMultipart } from "./fichiers.js";

/*
 * Transcription d'un audio (AGT-11, ADR-013, lot 3c), sous /api. Fournisseur SIMULÉ : conteneur de
 * test seulement. L'audio se téléverse par un chemin DÉDIÉ (`POST /missions/:id/transcriptions/audio`,
 * même contrôle du contenu que `POST /fichiers`, qui n'admet pas l'audio), puis la transcription se
 * crée avec le consentement déclaré et référencé. Une transcription non validée ne sort pas de ces
 * routes. Fermées au portail (liste blanche). Mission visible TOUJOURS exigée ; 404 sinon.
 */
export const routesTranscriptions: FastifyPluginAsync = async (app) => {
  const tailleMax = app.config.FICHIER_TAILLE_MAX_OCTETS;
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
  app.setErrorHandler(async (error) => {
    throw traduireErreurCanaux(error);
  });
  const gardeTaille = gardeTailleMultipart(
    tailleMax,
    () =>
      new AppError(
        413,
        "FICHIER_TROP_VOLUMINEUX",
        `Fichier trop volumineux : ${Math.floor(tailleMax / (1024 * 1024))} Mo au plus.`,
      ),
  );

  app.post(
    "/missions/:id/transcriptions/audio",
    { onRequest: gardeTaille },
    async (request, reply) => {
      const auth = exiger(request, "transcription.gerer");
      const { id } = paramsId.parse(request.params);
      // Droits contrôlés AVANT de lire le corps.
      await app.db.withTenant(auth.cabinetId, (db) => exigerMissionModifiable(db, auth, id));
      const recu = await lireTeleversement(request, tailleMax);
      const fichier = await avecPlaceAnalyse(auth.cabinetId, () =>
        enregistrerAudio(app, auth, recu),
      );
      reply.status(201);
      return fichier;
    },
  );

  app.post("/missions/:id/transcriptions", async (request, reply) => {
    const auth = exiger(request, "transcription.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = transcriptionCreationSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const tid = await creerTranscription(db, auth, id, corps, new Date());
      return detailTranscription(db, auth, tid);
    });
    reply.status(201);
    return detail;
  });

  app.get("/missions/:id/transcriptions", async (request) => {
    const auth = exiger(request, "transcription.lire");
    const { id } = paramsId.parse(request.params);
    const q = transcriptionsQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const lignes = await listerTranscriptions(db, auth, id, q.statut, apres, q.limite);
      return paginer(lignes as unknown as { cle_tri: string; id: string }[], q.limite);
    });
  });

  app.get("/transcriptions/:id", async (request) => {
    const auth = exiger(request, "transcription.lire");
    const { id } = transcriptionParamSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailTranscription(db, auth, id));
  });

  app.put("/transcriptions/:id/texte", async (request) => {
    const auth = exiger(request, "transcription.gerer");
    const { id } = transcriptionParamSchema.parse(request.params);
    const corps = transcriptionTexteSchema.parse(request.body);
    const entete = request.headers["if-match"];
    const ifMatch = transcriptionIfMatchSchema.safeParse(
      Array.isArray(entete) ? entete[0] : entete,
    );
    if (!ifMatch.success) throw requeteInvalide("En-tête If-Match (numéro de version) attendu.");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await ajouterVersionHumaine(db, auth, id, corps.texte, ifMatch.data);
      return detailTranscription(db, auth, id);
    });
  });

  app.post("/transcriptions/:id/valider", async (request) => {
    const auth = exiger(request, "transcription.valider");
    const { id } = transcriptionParamSchema.parse(request.params);
    transcriptionValidationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await validerTranscription(db, auth, id);
      return detailTranscription(db, auth, id);
    });
  });

  app.post("/transcriptions/:id/rejeter", async (request) => {
    const auth = exiger(request, "transcription.valider");
    const { id } = transcriptionParamSchema.parse(request.params);
    const corps = transcriptionRejetSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await rejeterTranscription(db, auth, id, corps.motif);
      return detailTranscription(db, auth, id);
    });
  });

  // Route DÉDIÉE : `GET /fichiers/:id` traite l'audio cité par une transcription comme rattaché (404).
  app.get("/transcriptions/:id/audio", async (request, reply) => {
    const auth = exiger(request, "transcription.lire");
    const { id } = transcriptionParamSchema.parse(request.params);
    const f = await app.db.withTenant(auth.cabinetId, (db) => fichierAudioDe(db, auth, id));
    let flux;
    try {
      flux = await stockageDe(app.config).lire(auth.cabinetId, f.cle_stockage);
    } catch (error) {
      if (error instanceof FichierAbsent) throw introuvable("Audio");
      throw error;
    }
    return reply
      .header("Content-Type", f.type_mime)
      .header("Content-Length", String(f.taille))
      .header("Content-Disposition", contentDisposition(f.nom, "inline"))
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox; default-src 'none'")
      .header("Cache-Control", "private, no-store")
      .header("Cross-Origin-Resource-Policy", "same-site")
      .header("Referrer-Policy", "no-referrer")
      .send(flux);
  });
};
