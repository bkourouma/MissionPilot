import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listeExclusionCreationSchema,
  listeExclusionVersionSchema,
  signalConstatSchema,
  signalCreationSchema,
  signalVersionSchema,
  signauxQuerySchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { dossierAccessible } from "../due-diligence/acces.js";
import {
  corrigerListe,
  creerListe,
  listerListes,
  versionsDeLaListe,
  vueListe,
} from "../due-diligence/filtrage.js";
import { curseurNumero, journalDd } from "../due-diligence/journal.js";
import {
  constaterSignal,
  corrigerSignal,
  creerSignal,
  listerSignaux,
  signauxDuDossier,
  versionsDuSignal,
  vueSignal,
} from "../due-diligence/signaux.js";
import { paginer, paramsId } from "../http/outils.js";

/*
 * Référentiels du cabinet (SPEC-3b §8.4 et §8.6) : bibliothèque de signaux d'alerte (DD-11, R24 à
 * R29) et listes d'exclusion (DD-14, R35 à R38). Lecture : `dd.lire` ; création et correction :
 * `dd.referentiel.gerer` (cabinet entier, sans mission). Le constat d'un signal sur un dossier
 * (R29) suit la mission du dossier. Erreurs traduites par le plugin parent.
 */

const paramsSignalDossier = z.object({ id: z.string().uuid(), signalId: z.string().uuid() });

/** `GET /dd/listes-exclusion` (SPEC-3b §8.6, R35) : page de listes, filtrable par client. */
const listesQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
    client_id: z.string().uuid().optional(),
  })
  .strict();

/** `GET /dd/listes-exclusion/:id/versions` : une version pèse jusqu'à 200 Ko, donc par pages. */
const versionsListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(20).default(10),
    curseur: z.string().max(500).optional(),
  })
  .strict();

export const routesDueDiligenceReferentiel: FastifyPluginAsync = async (app) => {
  /* ----- Signaux d'alerte ----- */

  app.get("/dd/signaux", async (request) => {
    const auth = exiger(request, "dd.lire");
    const q = signauxQuerySchema.parse(request.query);
    const apres = curseurNumero(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const lignes = await listerSignaux(db, q, apres);
      const page = paginer(lignes, q.limite);
      return {
        elements: page.elements.map((s) => vueSignal(s as never)),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.post("/dd/signaux", async (request, reply) => {
    const auth = exiger(request, "dd.referentiel.gerer");
    const c = signalCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const s = await creerSignal(db, auth, c);
      await journalDd(db, auth, "dd_signal_cree", "dd_signal", s.id, {
        code: c.code,
        famille: c.famille,
        gravite_indicative: c.gravite_indicative,
      });
      return s;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/signaux/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.referentiel.gerer");
    const { id } = paramsId.parse(request.params);
    const c = signalVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const v = await corrigerSignal(db, auth, id, c);
      await journalDd(db, auth, "dd_signal_modifie", "dd_signal", id, {
        version: v,
        actif: c.actif,
        gravite_indicative: c.gravite_indicative,
      });
      return v;
    });
    reply.status(201);
    return { version };
  });

  app.get("/dd/signaux/:id/versions", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => ({
      elements: await versionsDuSignal(db, id),
    }));
  });

  app.get("/dd/dossiers/:id/signaux", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      return { elements: await signauxDuDossier(db, id) };
    });
  });

  app.post("/dd/dossiers/:id/signaux/:signalId/constats", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id, signalId } = paramsSignalDossier.parse(request.params);
    const c = signalConstatSchema.parse(request.body);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      await constaterSignal(db, auth, dossier, signalId, c);
      await journalDd(db, auth, "dd_constat_signal", "dd_dossier", id, {
        signal_id: signalId,
        etat: c.etat,
        risque_id: c.risque_id,
      });
    });
    reply.status(201);
    return { ok: true };
  });

  /* ----- Listes d'exclusion ----- */

  app.get("/dd/listes-exclusion", async (request) => {
    const auth = exiger(request, "dd.lire");
    const q = listesQuerySchema.parse(request.query);
    const apres = curseurNumero(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const lignes = await listerListes(
        db,
        { limite: q.limite, clientId: q.client_id ?? null },
        apres,
      );
      const page = paginer(lignes, q.limite);
      return {
        elements: page.elements.map((l) => vueListe(l as never)),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.post("/dd/listes-exclusion", async (request, reply) => {
    const auth = exiger(request, "dd.referentiel.gerer");
    const c = listeExclusionCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const l = await creerListe(db, auth, c);
      await journalDd(db, auth, "dd_liste_creee", "dd_liste_exclusion", l.id, {
        client_id: c.client_id,
        regles: c.regles.length,
      });
      return l;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/listes-exclusion/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.referentiel.gerer");
    const { id } = paramsId.parse(request.params);
    const c = listeExclusionVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const v = await corrigerListe(db, auth, id, c);
      await journalDd(db, auth, "dd_liste_modifiee", "dd_liste_exclusion", id, {
        version: v,
        regles: c.regles.length,
      });
      return v;
    });
    reply.status(201);
    return { version };
  });

  app.get("/dd/listes-exclusion/:id/versions", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    const q = versionsListeQuerySchema.parse(request.query);
    const apres = curseurNumero(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const page = paginer(await versionsDeLaListe(db, id, q.limite, apres), q.limite);
      return {
        elements: page.elements.map(({ id: _id, ...version }) => version),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });
};
