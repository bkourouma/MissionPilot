import type { FastifyPluginAsync } from "fastify";
import {
  hypotheseAssertionSchema,
  hypotheseCreationSchema,
  hypotheseLienSchema,
  hypotheseVersionSchema,
  verdictProposeSchema,
  verdictValidationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { dossierAccessible, elementAccessible, exigerAussi } from "../due-diligence/acces.js";
import {
  corrigerHypothese,
  creerAssertionHypothese,
  creerHypothese,
  lireHypotheses,
  modifierLien,
} from "../due-diligence/hypotheses.js";
import { journalDd } from "../due-diligence/journal.js";
import {
  lireVerdict,
  listerVerdicts,
  proposerVerdict,
  validerVerdict,
} from "../due-diligence/verdicts.js";
import { paramsId } from "../http/outils.js";

/*
 * Hypothèses, liens, verdicts (DD-09, SPEC-3b §8.3, R16 à R23). Erreurs traduites par le plugin
 * parent (`routes/due-diligence.ts`). Un verdict est proposé par un membre de l'équipe puis VALIDÉ
 * par un tiers (`dd.valider`, séparation des tâches API et base).
 */
export const routesDueDiligenceHypotheses: FastifyPluginAsync = async (app) => {
  app.get("/dd/dossiers/:id/hypotheses", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, false);
      return lireHypotheses(db, mission.id, dossier.id);
    });
  });

  app.post("/dd/dossiers/:id/hypotheses", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = hypotheseCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const h = await creerHypothese(db, auth, dossier.id, c);
      await journalDd(db, auth, "dd_hypothese_creee", "dd_element", h.id, {
        dossier_id: id,
        parent_id: c.parent_id,
      });
      return h;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/hypotheses/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = hypotheseVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element } = await elementAccessible(db, auth, id, "hypothese", true, "Hypothèse");
      const v = await corrigerHypothese(db, auth, element, c);
      await journalDd(db, auth, "dd_hypothese_modifiee", "dd_element", id, {
        version: v,
        retire: c.retire,
      });
      return v;
    });
    reply.status(201);
    return { version };
  });

  app.post("/dd/hypotheses/:id/liens", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = hypotheseLienSchema.parse(request.body);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element, mission } = await elementAccessible(
        db,
        auth,
        id,
        "hypothese",
        true,
        "Hypothèse",
      );
      await modifierLien(db, auth, mission, element, c);
      await journalDd(db, auth, "dd_lien_modifie", "dd_element", id, {
        assertion_id: c.assertion_id,
        action: c.action,
        sens: c.sens,
      });
    });
    reply.status(201);
    return { ok: true };
  });

  app.post("/dd/hypotheses/:id/assertions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    exigerAussi(auth, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = hypotheseAssertionSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element, mission } = await elementAccessible(
        db,
        auth,
        id,
        "hypothese",
        true,
        "Hypothèse",
      );
      const a = await creerAssertionHypothese(db, auth, mission, element, c);
      await journalDd(db, auth, "dd_lien_modifie", "dd_element", id, {
        assertion_id: a.assertion_id,
        action: "lier",
        sens: c.sens,
        classe_risque: c.classe_risque,
      });
      return a;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/hypotheses/:id/verdicts", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = verdictProposeSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element, dossier, mission } = await elementAccessible(
        db,
        auth,
        id,
        "hypothese",
        true,
        "Hypothèse",
      );
      const v = await proposerVerdict(db, auth, mission.id, dossier.id, element, c);
      await journalDd(db, auth, "dd_verdict_propose", "dd_verdict", v.id, {
        hypothese_id: id,
        verdict: c.verdict,
        indication_moteur: v.indication_moteur,
        nb_citees: c.assertions_citees.length,
      });
      return v;
    });
    reply.status(201);
    return cree;
  });

  app.get("/dd/hypotheses/:id/verdicts", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await elementAccessible(db, auth, id, "hypothese", false, "Hypothèse");
      return { elements: await listerVerdicts(db, id) };
    });
  });

  app.post("/dd/verdicts/:id/validation", async (request, reply) => {
    const auth = exiger(request, "dd.valider");
    const { id } = paramsId.parse(request.params);
    const c = verdictValidationSchema.parse(request.body);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const verdict = await lireVerdict(db, id);
      const { mission } = await dossierAccessible(db, auth, verdict.dossier_id, true, "Verdict");
      await validerVerdict(db, auth, mission.id, verdict, c);
      await journalDd(
        db,
        auth,
        c.decision === "valide" ? "dd_verdict_valide" : "dd_verdict_rejete",
        "dd_verdict",
        id,
        { hypothese_id: verdict.hypothese_id, verdict: verdict.verdict },
      );
    });
    reply.status(201);
    return { ok: true };
  });
};
