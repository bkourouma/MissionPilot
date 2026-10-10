import type { FastifyPluginAsync } from "fastify";
import {
  ajustementNotationSchema,
  calculNotationSchema,
  grilleNotationCreationSchema,
  grilleNotationVersionCreationSchema,
  grilleNotationVersionModificationSchema,
  questionnaireListeQuerySchema,
  renvoiNotationSchema,
  versionNotationQuerySchema,
  type Permission,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { introuvable } from "../errors.js";
import { decoderCurseur, paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import {
  creerGrille,
  creerVersionGrille,
  lireGrille,
  lireVersionGrille,
  listerGrilles,
  modifierVersionGrille,
  validerVersionGrille,
} from "../notation/grilles.js";
import {
  ajuster,
  calculer,
  chargerVersion,
  creerNotation,
  exigerNotationVisible,
  notationDeMission,
  publier,
  rapport,
  renvoyer,
  resumeNotation,
  soumettreRevue,
  vueVersion,
} from "../notation/notations.js";
import { exigerUnDe } from "../questionnaires/acces.js";
import { routesNotationAugmentee } from "./notation-augmentee.js";

/*
 * Notation (service 1), montée sous /api (via routes/questionnaires.ts).
 *
 * - Lecture (grilles, notation, versions, rapport) : notation.lire, OU
 *   notation.gerer, OU notation.publier, mission visible.
 * - Grilles : rédaction par notation.gerer ou notation.publier (jamais
 *   notation.lire seul) ; validation
 *   d'une version par notation.publier ET le rôle expert_metier, jamais par
 *   son auteur ni son dernier modificateur (notation/grilles.ts, MPN04).
 * - Calcul, ajustement, soumission en revue : notation.gerer.
 * - Renvoi et publication : notation.publier ET le rôle expert_metier
 *   (NOT-07 : un associé sans ce rôle ne publie pas), séparation des tâches
 *   stricte (notation/notations.ts, déclencheur MPN04).
 * Aucun appel IA ici.
 */

const LECTURE: readonly Permission[] = ["notation.lire", "notation.gerer", "notation.publier"];
/** Rédaction des grilles (création, nouvelle version, brouillon) : jamais « notation.lire » seul. */
const REDACTION_GRILLES: readonly Permission[] = ["notation.gerer", "notation.publier"];

export const routesNotation: FastifyPluginAsync = async (app) => {
  app.get("/notation/grilles", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const q = questionnaireListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, (db) => listerGrilles(db, apres, q.limite));
  });

  app.post("/notation/grilles", async (request, reply) => {
    const auth = exigerUnDe(request, REDACTION_GRILLES);
    const corps = grilleNotationCreationSchema.parse(request.body);
    const grille = await app.db.withTenant(auth.cabinetId, (db) => creerGrille(db, auth, corps));
    reply.status(201);
    return grille;
  });

  app.get("/notation/grilles/:id", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireGrille(db, id));
  });

  app.post("/notation/grilles/:id/versions", async (request, reply) => {
    const auth = exigerUnDe(request, REDACTION_GRILLES);
    const { id } = paramsId.parse(request.params);
    const { contenu } = grilleNotationVersionCreationSchema.parse(request.body ?? {});
    const version = await app.db.withTenant(auth.cabinetId, (db) =>
      creerVersionGrille(db, auth, id, contenu),
    );
    reply.status(201);
    return version;
  });

  app.get("/notation/grilles/versions/:id", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireVersionGrille(db, id));
  });

  app.put("/notation/grilles/versions/:id", async (request) => {
    const auth = exigerUnDe(request, REDACTION_GRILLES);
    const { id } = paramsId.parse(request.params);
    const { contenu } = grilleNotationVersionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierVersionGrille(db, auth, id, contenu));
  });

  app.post("/notation/grilles/versions/:id/valider", async (request) => {
    const auth = exiger(request, "notation.publier");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => validerVersionGrille(db, auth, id));
  });

  app.get("/missions/:id/notation", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const notation = await notationDeMission(db, id);
      if (!notation) throw introuvable("Notation");
      return resumeNotation(db, notation);
    });
  });

  app.post("/missions/:id/notation", async (request, reply) => {
    const auth = exiger(request, "notation.gerer");
    const { id } = paramsId.parse(request.params);
    const notation = await app.db.withTenant(auth.cabinetId, async (db) =>
      resumeNotation(db, await creerNotation(db, auth, id)),
    );
    reply.status(201);
    return notation;
  });

  app.post("/notations/:id/calculs", async (request, reply) => {
    const auth = exiger(request, "notation.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = calculNotationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id, true);
      return vueVersion(db, await calculer(db, auth, notation, corps));
    });
    reply.status(201);
    return vue;
  });

  app.get("/notations/:id/version", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const { version } = versionNotationQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id);
      const v = await chargerVersion(db, notation.id, version);
      if (!v) throw introuvable("Version de notation");
      return vueVersion(db, v);
    });
  });

  app.post("/notations/:id/ajustements", async (request, reply) => {
    const auth = exiger(request, "notation.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = ajustementNotationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id, true);
      return vueVersion(db, await ajuster(db, auth, notation, corps));
    });
    reply.status(201);
    return vue;
  });

  app.post("/notations/:id/soumettre", async (request) => {
    const auth = exiger(request, "notation.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id, true);
      return vueVersion(db, await soumettreRevue(db, auth, notation));
    });
  });

  app.post("/notations/:id/renvoyer", async (request) => {
    const auth = exiger(request, "notation.publier");
    const { id } = paramsId.parse(request.params);
    const { motif } = renvoiNotationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id, true);
      return vueVersion(db, await renvoyer(db, auth, notation, motif));
    });
  });

  app.post("/notations/:id/publier", async (request) => {
    const auth = exiger(request, "notation.publier");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id, true);
      return vueVersion(db, await publier(db, auth, notation));
    });
  });

  app.get("/notations/:id/rapport", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const { version } = versionNotationQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      rapport(db, auth, await exigerNotationVisible(db, auth, id), version),
    );
  });

  // Notation augmentée (NOT-09 à NOT-13, NOT-17) : plugin enfant, traduction d'erreurs propre.
  await app.register(routesNotationAugmentee);
};
