import type { FastifyPluginAsync } from "fastify";
import {
  banqueListeQuerySchema,
  calibrationCreationSchema,
  clotureCalibrationSchema,
  cotationsCalibrationSchema,
  explicationNotationQuerySchema,
  impactInitiativeNotationSchema,
  initiativeNotationCreationSchema,
  initiativeNotationModificationSchema,
  initiativesNotationListeQuerySchema,
  itemBanqueCorpsSchema,
  listeNotationAugmenteeQuerySchema,
  parametresNotationSchema,
  planActionNotationSchema,
  selectionNotationSchema,
  versionNotationQuerySchema,
  type Permission,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { decoderCurseur, paramsId } from "../http/outils.js";
import {
  creerItem,
  listerItems,
  listerSelections,
  lireItem,
  modifierItem,
  selectionner,
  validerItem,
} from "../notation/banque.js";
import { traduireErreurNotationAugmentee } from "../notation/augmentee-erreurs.js";
import {
  cloturer,
  coter,
  creerCalibration,
  lireCalibration,
  listerCalibrations,
} from "../notation/calibration.js";
import { lireParametres, modifierParametres } from "../notation/confiance.js";
import {
  confianceVersion,
  constatsVersion,
  explicationVersion,
  versionOu404,
} from "../notation/explication.js";
import { exigerNotationVisible } from "../notation/notations.js";
import {
  ajouterImpact,
  creerInitiative,
  enregistrerPlan,
  lireInitiative,
  listerInitiatives,
  listerPlans,
  modifierInitiative,
  proposerPlan,
} from "../notation/plan-action.js";
import { exigerUnDe } from "../questionnaires/acces.js";

/*
 * Notation augmentée (PRD complémentaire §11.1), montée sous /api par routes/notation.ts.
 * Aucune route n'est ouverte au portail client (aucune n'est dans LISTE_BLANCHE_PORTAIL) ;
 * aucun appel IA ici (une proposition de l'IA passe par le contrôle du moteur, comme celle d'un
 * humain).
 *
 * - Lecture (banque, sélections, constats, confiance, explication, calibrations, initiatives,
 *   plans) : notation.lire, OU notation.gerer, OU notation.publier ; mission ou notation visible.
 * - Rédaction (items en brouillon, sessions et cotations de calibrage, initiatives et impacts) :
 *   notation.gerer OU notation.publier.
 * - Validation d'un item, clôture d'une session : notation.publier ET rôle expert_metier.
 * - Sélection adaptative d'une mission, plan d'action enregistré : notation.gerer.
 * - Paramètres de confiance : lecture comme la notation ; modification par cabinet.gerer.
 */

const LECTURE: readonly Permission[] = ["notation.lire", "notation.gerer", "notation.publier"];
const REDACTION: readonly Permission[] = ["notation.gerer", "notation.publier"];

export const routesNotationAugmentee: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurNotationAugmentee(error);
  });

  /* ----- NOT-09 : banque d'items et questionnaire adaptatif ----- */

  app.get("/notation/banque", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const q = banqueListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) =>
      listerItems(db, q, decoderCurseur(q.curseur), q.limite),
    );
  });

  app.post("/notation/banque", async (request, reply) => {
    const auth = exigerUnDe(request, REDACTION);
    const { contenu } = itemBanqueCorpsSchema.parse(request.body);
    const item = await app.db.withTenant(auth.cabinetId, (db) => creerItem(db, auth, contenu));
    reply.status(201);
    return item;
  });

  app.get("/notation/banque/:id", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireItem(db, id));
  });

  app.put("/notation/banque/:id", async (request) => {
    const auth = exigerUnDe(request, REDACTION);
    const { id } = paramsId.parse(request.params);
    const { contenu } = itemBanqueCorpsSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierItem(db, auth, id, contenu));
  });

  app.post("/notation/banque/:id/valider", async (request) => {
    const auth = exiger(request, "notation.publier");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => validerItem(db, auth, id));
  });

  app.post("/missions/:id/notation/selections", async (request, reply) => {
    const auth = exiger(request, "notation.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = selectionNotationSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => selectionner(db, auth, id, corps));
    reply.status(corps.enregistrer ? 201 : 200);
    return r;
  });

  app.get("/missions/:id/notation/selections", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const q = listeNotationAugmenteeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) =>
      listerSelections(db, auth, id, decoderCurseur(q.curseur), q.limite),
    );
  });

  /* ----- NOT-10 à NOT-12 : constats, confiance, explication ----- */

  app.get("/notations/:id/constats", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const { version } = versionNotationQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id);
      return constatsVersion(db, await versionOu404(db, notation, version));
    });
  });

  app.get("/notations/:id/confiance", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const { version } = versionNotationQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id);
      return confianceVersion(db, notation, await versionOu404(db, notation, version));
    });
  });

  app.get("/notations/:id/explication", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const { version, cible } = explicationNotationQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const notation = await exigerNotationVisible(db, auth, id);
      return explicationVersion(await versionOu404(db, notation, version), cible);
    });
  });

  app.get("/notation/parametres", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    return app.db.withTenant(auth.cabinetId, (db) => lireParametres(db));
  });

  app.put("/notation/parametres", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const corps = parametresNotationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierParametres(db, auth, corps));
  });

  /* ----- NOT-13 : calibration entre évaluateurs ----- */

  app.get("/notation/calibrations", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const q = listeNotationAugmenteeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) =>
      listerCalibrations(db, auth, decoderCurseur(q.curseur), q.limite),
    );
  });

  app.post("/notation/calibrations", async (request, reply) => {
    const auth = exigerUnDe(request, REDACTION);
    const corps = calibrationCreationSchema.parse(request.body);
    const s = await app.db.withTenant(auth.cabinetId, (db) => creerCalibration(db, auth, corps));
    reply.status(201);
    return s;
  });

  app.get("/notation/calibrations/:id", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireCalibration(db, auth, id));
  });

  app.post("/notation/calibrations/:id/cotations", async (request, reply) => {
    const auth = exigerUnDe(request, REDACTION);
    const { id } = paramsId.parse(request.params);
    const { cotations } = cotationsCalibrationSchema.parse(request.body);
    const s = await app.db.withTenant(auth.cabinetId, (db) => coter(db, auth, id, cotations));
    reply.status(201);
    return s;
  });

  app.post("/notation/calibrations/:id/cloturer", async (request) => {
    const auth = exiger(request, "notation.publier");
    const { id } = paramsId.parse(request.params);
    const { conclusion } = clotureCalibrationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => cloturer(db, auth, id, conclusion));
  });

  /* ----- NOT-17 : bibliothèque d'initiatives et plan d'action ----- */

  app.get("/notation/initiatives-types", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const q = initiativesNotationListeQuerySchema.parse(request.query);
    const actives = q.actives === undefined ? undefined : q.actives === "oui";
    return app.db.withTenant(auth.cabinetId, (db) =>
      listerInitiatives(db, actives, decoderCurseur(q.curseur), q.limite),
    );
  });

  app.post("/notation/initiatives-types", async (request, reply) => {
    const auth = exigerUnDe(request, REDACTION);
    const corps = initiativeNotationCreationSchema.parse(request.body);
    const i = await app.db.withTenant(auth.cabinetId, (db) => creerInitiative(db, auth, corps));
    reply.status(201);
    return i;
  });

  app.get("/notation/initiatives-types/:id", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireInitiative(db, id));
  });

  app.patch("/notation/initiatives-types/:id", async (request) => {
    const auth = exigerUnDe(request, REDACTION);
    const { id } = paramsId.parse(request.params);
    const corps = initiativeNotationModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierInitiative(db, auth, id, corps));
  });

  app.post("/notation/initiatives-types/:id/impacts", async (request, reply) => {
    const auth = exigerUnDe(request, REDACTION);
    const { id } = paramsId.parse(request.params);
    const corps = impactInitiativeNotationSchema.parse(request.body);
    const i = await app.db.withTenant(auth.cabinetId, (db) => ajouterImpact(db, auth, id, corps));
    reply.status(201);
    return i;
  });

  app.get("/notations/:id/plan-action/proposition", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const q = planActionNotationSchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      proposerPlan(db, await exigerNotationVisible(db, auth, id), q),
    );
  });

  app.post("/notations/:id/plans-action", async (request, reply) => {
    const auth = exiger(request, "notation.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = planActionNotationSchema.parse(request.body ?? {});
    const p = await app.db.withTenant(auth.cabinetId, async (db) =>
      enregistrerPlan(db, auth, await exigerNotationVisible(db, auth, id, true), corps),
    );
    reply.status(201);
    return p;
  });

  app.get("/notations/:id/plans-action", async (request) => {
    const auth = exigerUnDe(request, LECTURE);
    const { id } = paramsId.parse(request.params);
    const q = listeNotationAugmenteeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      listerPlans(
        db,
        await exigerNotationVisible(db, auth, id),
        decoderCurseur(q.curseur),
        q.limite,
      ),
    );
  });
};
