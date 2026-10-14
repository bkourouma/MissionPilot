import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  analysesQuerySchema,
  cadrageSchema,
  cadrageVersionSchema,
  etapeChaineCreationSchema,
  etapeChaineVersionSchema,
  pointCreationSchema,
  pointVersionSchema,
  risqueCreationSchema,
  risqueVersionSchema,
  risquesQuerySchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import {
  lireAnalyses,
  corrigerPoint,
  creerPoint,
  pointToucheLeRegistre,
} from "../due-diligence/analyses.js";
import { dossierAccessible, elementAccessible, exigerAussi } from "../due-diligence/acces.js";
import { corrigerEtape, creerEtape, lireChaine } from "../due-diligence/chaine.js";
import {
  cadrageCourant,
  corrigerCadrage,
  creerDossier,
  listerDossiers,
  versionsDuCadrage,
  vueDossier,
} from "../due-diligence/dossiers.js";
import { traduireErreurDueDiligence } from "../due-diligence/erreurs.js";
import { journalDd } from "../due-diligence/journal.js";
import {
  corrigerRisque,
  creerRisque,
  lireRisques,
  risqueToucheLeRegistre,
} from "../due-diligence/risques.js";
import { lireSynthese } from "../due-diligence/synthese.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionEcrivable, exigerMissionLisible } from "../preuves/acces.js";
import { routesDueDiligenceHypotheses } from "./due-diligence-hypotheses.js";
import { routesDueDiligenceMarche } from "./due-diligence-marche.js";
import { routesDueDiligenceNotes } from "./due-diligence-notes.js";
import { routesDueDiligenceReferentiel } from "./due-diligence-referentiel.js";

/**
 * Service #2 « Due diligence » (DD-01 à DD-15, SPEC-3b, ADR-012), monté sous /api.
 *
 * - Droits : `dd.lire`, `dd.ecrire`, `dd.valider`, `dd.referentiel.gerer` (`exiger` AVANT tout
 *   accès aux données), plus `preuve.ecrire` pour les routes qui écrivent dans le registre des
 *   preuves, et TOUJOURS la visibilité de la mission (404 sinon, y compris un autre cabinet).
 *   Écriture : mission verrouillée et non clôturée (409 MISSION_CLOTUREE). Aucune route n'est
 *   ouverte au portail client (`LISTE_BLANCHE_PORTAIL`, tables `portail_interdit`).
 * - Ajout seul (migrations 0500 à 0507) : une correction est une nouvelle version avec motif
 *   (`version_courante` exigée : 409 VERSION_PERIMEE), un lien retiré est un événement. Aucune
 *   route PUT ni DELETE.
 * - Tout nombre sort de packages/engines (`due-diligence`) ; une affirmation est une assertion du
 *   registre des preuves (`preuves/ecriture.ts`), sa solidité vient du moteur des preuves ; aucune
 *   IA, aucun job, aucun appel réseau.
 * - Chaque écriture est journalisée dans sa transaction, sans énoncé, motif ni extrait.
 * - Ce fichier : dossiers et cadrage (R01 à R06), analyses (R07 à R09), chaîne de valeur (R10 à
 *   R12), risques (R13 à R15) ; le reste est dans `due-diligence-*.ts`.
 */

function routesDossiers(app: FastifyInstance) {
  app.get("/missions/:id/dd/dossiers", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionLisible(db, auth, id);
      return { elements: await listerDossiers(db, id) };
    });
  });

  app.post("/missions/:id/dd/dossiers", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    exigerAussi(auth, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = cadrageSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionEcrivable(db, auth, id);
      const dossier = await creerDossier(db, auth, mission, c);
      await journalDd(db, auth, "dd_dossier_cree", "dd_dossier", dossier.id, {
        mission_id: id,
        type_operation: c.type_operation,
        devise: c.devise,
      });
      return dossier;
    });
    reply.status(201);
    return cree;
  });

  app.get("/dd/dossiers/:id", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, false);
      return vueDossier(db, dossier, mission);
    });
  });

  app.get("/dd/dossiers/:id/synthese", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, false);
      return lireSynthese(db, auth, mission, dossier);
    });
  });

  app.post("/dd/dossiers/:id/cadrage", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = cadrageVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const v = await corrigerCadrage(db, auth, dossier, c);
      await journalDd(db, auth, "dd_cadrage_modifie", "dd_dossier", id, { version: v });
      return v;
    });
    reply.status(201);
    return { version };
  });

  app.get("/dd/dossiers/:id/cadrage/versions", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      await cadrageCourant(db, id);
      return { elements: await versionsDuCadrage(db, id) };
    });
  });
}

function routesAnalyses(app: FastifyInstance) {
  app.get("/dd/dossiers/:id/analyses", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    const q = analysesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, false);
      return lireAnalyses(db, mission.id, dossier.id, q.analyse);
    });
  });

  app.post("/dd/dossiers/:id/points", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    exigerAussi(auth, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = pointCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, true);
      const p = await creerPoint(db, auth, mission, dossier.id, c);
      await journalDd(db, auth, "dd_point_cree", "dd_element", p.id, {
        dossier_id: id,
        analyse: c.analyse,
        categorie: c.categorie,
        classe_risque: c.classe_risque,
        avis_expert: c.avis_expert,
      });
      return p;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/points/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = pointVersionSchema.parse(request.body);
    if (pointToucheLeRegistre(c)) exigerAussi(auth, "preuve.ecrire");
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element, mission } = await elementAccessible(
        db,
        auth,
        id,
        "point_analyse",
        true,
        "Point",
      );
      const v = await corrigerPoint(db, auth, mission, element, c);
      await journalDd(db, auth, "dd_point_modifie", "dd_element", id, {
        version: v.version,
        assertion_version: v.assertion_version,
        retire: c.retire,
      });
      return v;
    });
    reply.status(201);
    return resultat;
  });
}

function routesChaine(app: FastifyInstance) {
  app.get("/dd/dossiers/:id/chaine", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, false);
      return lireChaine(db, mission.id, dossier.id);
    });
  });

  app.post("/dd/dossiers/:id/chaine/etapes", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = etapeChaineCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const e = await creerEtape(db, auth, dossier.id, c);
      await journalDd(db, auth, "dd_etape_creee", "dd_element", e.id, {
        dossier_id: id,
        ordre: c.ordre,
      });
      return e;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/etapes/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = etapeChaineVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element } = await elementAccessible(db, auth, id, "etape_chaine", true, "Étape");
      const v = await corrigerEtape(db, auth, element, c);
      await journalDd(db, auth, "dd_etape_modifiee", "dd_element", id, {
        version: v,
        retire: c.retire,
      });
      return v;
    });
    reply.status(201);
    return { version };
  });
}

function routesRisques(app: FastifyInstance) {
  app.get("/dd/dossiers/:id/risques", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    const q = risquesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, false);
      return lireRisques(db, mission.id, dossier.id, q);
    });
  });

  app.post("/dd/dossiers/:id/risques", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    exigerAussi(auth, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = risqueCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier, mission } = await dossierAccessible(db, auth, id, true);
      const r = await creerRisque(db, auth, mission, dossier.id, c);
      await journalDd(db, auth, "dd_risque_cree", "dd_element", r.id, {
        dossier_id: id,
        famille: c.famille,
        niveau: c.niveau,
        signal_id: c.signal_id,
        classe_risque: c.classe_risque,
      });
      return r;
    });
    reply.status(201);
    return cree;
  });

  app.post("/dd/risques/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = risqueVersionSchema.parse(request.body);
    if (risqueToucheLeRegistre(c)) exigerAussi(auth, "preuve.ecrire");
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { element, mission } = await elementAccessible(db, auth, id, "risque", true, "Risque");
      const v = await corrigerRisque(db, auth, mission, element, c);
      await journalDd(db, auth, "dd_risque_modifie", "dd_element", id, {
        version: v.version,
        assertion_version: v.assertion_version,
        niveau: c.niveau,
        retire: c.retire,
      });
      return v;
    });
    reply.status(201);
    return resultat;
  });
}

export const routesDueDiligence: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurDueDiligence(error);
  });
  routesDossiers(app);
  routesAnalyses(app);
  routesChaine(app);
  routesRisques(app);
  await app.register(routesDueDiligenceHypotheses);
  await app.register(routesDueDiligenceMarche);
  await app.register(routesDueDiligenceNotes);
  await app.register(routesDueDiligenceReferentiel);
};
