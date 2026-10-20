import type { FastifyPluginAsync } from "fastify";
import {
  dimensionnementCalculSchema,
  dimensionnementCreationSchema,
  dimensionnementVersionSchema,
  filtrageCreationSchema,
  filtrageDecisionSchema,
  planActionCreationSchema,
  planActionVersionSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { dossierAccessible, elementAccessible } from "../due-diligence/acces.js";
import { listerAjustements } from "../due-diligence/ajustements.js";
import {
  calculerAPerte,
  corrigerDimensionnement,
  creerDimensionnement,
  lireDimensionnement,
  lireDimensionnements,
  versionsDuDimensionnement,
} from "../due-diligence/dimensionnement.js";
import { creerFiltrage, decider, lireFiltrage, lireFiltrages } from "../due-diligence/filtrage.js";
import { journalDd } from "../due-diligence/journal.js";
import { corrigerAction, creerAction, lirePlan } from "../due-diligence/plan-100-jours.js";
import { paramsId } from "../http/outils.js";

/*
 * Marché (DD-12, R30 à R34), filtrage environnemental et social d'un dossier (DD-14, R39 à R41),
 * ajustements tracés (DD-08, R42) et plan des 100 jours (DD-15, R43 à R45), SPEC-3b §8.5 à §8.7.
 * Erreurs traduites par le plugin parent (`routes/due-diligence.ts`).
 */
export const routesDueDiligenceMarche: FastifyPluginAsync = async (app) => {
  /* ----- Dimensionnement de marché ----- */

  app.get("/dd/dossiers/:id/dimensionnements", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      return lireDimensionnements(db, id);
    });
  });

  app.post("/dd/dossiers/:id/dimensionnements", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = dimensionnementCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const d = await creerDimensionnement(db, auth, dossier, c);
      await journalDd(db, auth, "dd_dimensionnement_cree", "dd_dimensionnement", d.id, {
        dossier_id: id,
        methode: c.methode,
        ajustements: c.ajustements.length,
      });
      return d;
    });
    reply.status(201);
    return cree;
  });

  // Aperçu de saisie : aucun accès à la base, aucune écriture (entrée bornée par le schéma).
  app.post("/dd/dimensionnements/calculer", async (request) => {
    exiger(request, "dd.lire");
    const c = dimensionnementCalculSchema.parse(request.body);
    return calculerAPerte(c);
  });

  app.post("/dd/dimensionnements/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = dimensionnementVersionSchema.parse(request.body);
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const courant = await lireDimensionnement(db, id);
      const { dossier } = await dossierAccessible(
        db,
        auth,
        courant.dossier_id,
        true,
        "Dimensionnement",
      );
      const v = await corrigerDimensionnement(db, auth, dossier, courant, c);
      await journalDd(db, auth, "dd_dimensionnement_modifie", "dd_dimensionnement", id, {
        version: v.version,
        ajustements: c.ajustements.length,
      });
      return v;
    });
    reply.status(201);
    return resultat;
  });

  app.get("/dd/dimensionnements/:id/versions", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const courant = await lireDimensionnement(db, id);
      await dossierAccessible(db, auth, courant.dossier_id, false, "Dimensionnement");
      return { elements: await versionsDuDimensionnement(db, id) };
    });
  });

  /* ----- Filtrage environnemental et social ----- */

  app.get("/dd/dossiers/:id/filtrages", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, false);
      return lireFiltrages(db, mission.id, dossier.id);
    });
  });

  app.post("/dd/dossiers/:id/filtrages", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = filtrageCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const f = await creerFiltrage(db, auth, dossier, c);
      await journalDd(db, auth, "dd_filtrage_cree", "dd_filtrage", f.id, {
        dossier_id: id,
        liste_id: c.liste_id,
        touches: f.touches.length,
      });
      return f;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/filtrages/:id/decisions", async (request, reply) => {
    const auth = exiger(request, "dd.valider");
    const { id } = paramsId.parse(request.params);
    const c = filtrageDecisionSchema.parse(request.body);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const filtrage = await lireFiltrage(db, id);
      await dossierAccessible(db, auth, filtrage.dossier_id, true, "Filtrage");
      await decider(db, auth, filtrage, c);
      await journalDd(db, auth, "dd_exclusion_decidee", "dd_filtrage", id, {
        regle_code: c.regle_code,
        decision: c.decision,
      });
    });
    reply.status(201);
    return { ok: true };
  });

  /* ----- Ajustements tracés ----- */

  app.get("/dd/dossiers/:id/ajustements", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      return { elements: await listerAjustements(db, id) };
    });
  });

  /* ----- Plan des 100 jours ----- */

  app.get("/dd/dossiers/:id/plan-100j", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      return lirePlan(db, auth, id);
    });
  });

  app.post("/dd/dossiers/:id/plan-100j/actions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = planActionCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const a = await creerAction(db, auth, dossier, c);
      await journalDd(db, auth, "dd_action_creee", "dd_element", a.id, {
        dossier_id: id,
        jour_debut: c.jour_debut,
        jour_fin: c.jour_fin,
        statut_action: c.statut_action,
        plan_element_id: c.plan_element_id,
        kpi_id: c.kpi_id,
      });
      return a;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/actions/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = planActionVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element, dossier } = await elementAccessible(
        db,
        auth,
        id,
        "action_100j",
        true,
        "Action",
      );
      const v = await corrigerAction(db, auth, dossier, element, c);
      await journalDd(db, auth, "dd_action_modifiee", "dd_element", id, {
        version: v,
        statut_action: c.statut_action,
        retire: c.retire,
      });
      return v;
    });
    reply.status(201);
    return { version };
  });
};
