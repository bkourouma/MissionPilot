import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  arbitrageSchema,
  assertionCorrectionSchema,
  assertionCreationSchema,
  assertionsQuerySchema,
  contradictionsQuerySchema,
  controleQuerySchema,
  dimensionCreationSchema,
  dimensionModificationSchema,
  lienPreuveSchema,
  preuveCorrectionSchema,
  preuveCreationSchema,
  preuvesQuerySchema,
  triangulationQuerySchema,
} from "@missionpilot/shared";
import { z } from "zod";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { peutModifierMission, type MissionAcces } from "../missions/acces.js";
import {
  exigerMissionEcrivable,
  exigerMissionLisible,
  peutVoirNominatif,
} from "../preuves/acces.js";
import {
  assertionsDePreuve,
  dimensionsDeMission,
  lireAssertion,
  lirePreuve,
  listerAssertions,
  listerPreuves,
  liensCourants,
  versionsDePreuve,
  type AssertionCourante,
  type PreuveCourante,
} from "../preuves/donnees.js";
import {
  ajouterArbitrage,
  ajouterLien,
  corrigerAssertion,
  corrigerPreuve,
  creerAssertion,
  creerDimension,
  creerPreuve,
} from "../preuves/ecriture.js";
import { traduireErreurPreuves } from "../preuves/erreurs.js";
import {
  assertionsFragilesDeMission,
  carteDeMission,
  chargerEtat,
  contradictionsDeMission,
  controleDeMission,
  detailAssertion,
  elementAssertion,
} from "../preuves/synthese.js";
import { vuePreuve } from "../preuves/vues.js";

/**
 * Registre des preuves (PRV-01 à PRV-05, PRD complémentaire §6), monté sous /api.
 *
 * - Droits : `preuve.lire` (lecture), `preuve.ecrire` (écriture, arbitrage) et, en plus, la
 *   visibilité de la mission (écriture : mission non clôturée), `preuves/acces.ts`. Aucune route
 *   n'est ouverte au portail client (`LISTE_BLANCHE_PORTAIL`, tables `portail_interdit`).
 * - Ajout seul (migrations 0240 à 0242) : une correction est une nouvelle version avec motif, un
 *   lien retiré est un événement, un arbitrage est une décision datée et signée. Aucune route
 *   PUT, aucun DELETE destructif.
 * - L'indice de solidité, les contradictions, la carte de triangulation et le contrôle PRV-03 sont
 *   calculés par `packages/engines/src/preuves` (`preuves/evaluation.ts`, `preuves/synthese.ts`).
 * - Chaque écriture est journalisée dans sa transaction, sans extrait ni verbatim.
 */

const paramsMissionDimension = z.object({ id: z.string().uuid(), dimensionId: z.string().uuid() });
const paramsLien = z.object({ id: z.string().uuid(), preuveId: z.string().uuid() });

function journal(
  db: Db,
  auth: Auth,
  action: string,
  entite: string,
  id: string,
  details: Record<string, unknown> = {},
) {
  return journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite,
    entiteId: id,
    details,
  });
}

function curseurNumero(curseur: string | undefined): string | null {
  const apres = decoderCurseur(curseur);
  if (apres && !/^\d{1,19}$/.test(apres[0]))
    throw requeteInvalide("Curseur de pagination invalide.");
  return apres?.[0] ?? null;
}

/** Preuve servie à l'utilisateur, nominatif masqué selon ses droits. */
function vueSelonDroits(auth: Auth, mission: MissionAcces, p: Omit<PreuveCourante, "cle_tri">) {
  return vuePreuve(p, peutVoirNominatif(auth, mission, p));
}

async function preuveAccessible(db: Db, auth: Auth, id: string, ecriture: boolean) {
  const preuve = await lirePreuve(db, id);
  if (!preuve) throw introuvable("Preuve");
  const mission = ecriture
    ? await exigerMissionEcrivable(db, auth, preuve.mission_id, "Preuve")
    : await exigerMissionLisible(db, auth, preuve.mission_id, "Preuve");
  return { preuve, mission };
}

async function assertionAccessible(db: Db, auth: Auth, id: string, ecriture: boolean) {
  const assertion = await lireAssertion(db, id);
  if (!assertion) throw introuvable("Assertion");
  const mission = ecriture
    ? await exigerMissionEcrivable(db, auth, assertion.mission_id, "Assertion")
    : await exigerMissionLisible(db, auth, assertion.mission_id, "Assertion");
  return { assertion, mission };
}

async function detailPreuve(db: Db, auth: Auth, mission: MissionAcces, preuve: PreuveCourante) {
  const versions = await versionsDePreuve(db, preuve.id);
  return {
    ...vueSelonDroits(auth, mission, preuve),
    versions: versions.map((v) => vueSelonDroits(auth, mission, v)),
    assertions: await assertionsDePreuve(db, preuve.id),
  };
}

function routesPreuvesLecture(app: FastifyInstance) {
  app.get("/missions/:id/preuves", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    const q = preuvesQuerySchema.parse(request.query);
    const apres = curseurNumero(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionLisible(db, auth, id);
      const lignes = await listerPreuves(db, id, q, apres, q.limite, {
        tous: peutModifierMission(auth, mission),
        utilisateurId: auth.utilisateurId,
      });
      const page = paginer(lignes, q.limite);
      return {
        elements: page.elements.map((p) => vueSelonDroits(auth, mission, p)),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.get("/preuves/:id", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { preuve, mission } = await preuveAccessible(db, auth, id, false);
      return detailPreuve(db, auth, mission, preuve);
    });
  });

  app.get("/missions/:id/preuves/dimensions", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionLisible(db, auth, id);
      return { elements: await dimensionsDeMission(db, id, false) };
    });
  });

  app.get("/missions/:id/preuves/triangulation", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    const q = triangulationQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionLisible(db, auth, id);
      return carteDeMission(db, id, {
        typesAttendus: q.types_attendus,
        typesMinimum: q.types_minimum,
        fiabiliteMinimale: q.fiabilite_minimale,
      });
    });
  });

  app.get("/missions/:id/preuves/contradictions", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    const q = contradictionsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionLisible(db, auth, id);
      return contradictionsDeMission(db, auth, mission, q.resolues === "oui");
    });
  });

  app.get("/missions/:id/preuves/controle", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    const q = controleQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionLisible(db, auth, id);
      return controleDeMission(db, id, q.livrable);
    });
  });
}

function routesAssertionsLecture(app: FastifyInstance) {
  app.get("/missions/:id/assertions", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    const q = assertionsQuerySchema.parse(request.query);
    const apres = curseurNumero(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionLisible(db, auth, id);
      const lignes = await listerAssertions(db, id, q, apres, q.limite);
      const page = paginer(lignes, q.limite);
      const lues = lignes.slice(0, q.limite);
      const etat = await chargerEtat(db, id, lues);
      const parId = new Map(lues.map((a) => [a.id, a]));
      return {
        elements: page.elements.map((a) =>
          elementAssertion(parId.get(a.id) as AssertionCourante, etat.evaluations.get(a.id)),
        ),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.get("/missions/:id/assertions/fragiles", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    const q = controleQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionLisible(db, auth, id);
      return { elements: await assertionsFragilesDeMission(db, id, { livrable: q.livrable }) };
    });
  });

  app.get("/assertions/:id", async (request) => {
    const auth = exiger(request, "preuve.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { assertion, mission } = await assertionAccessible(db, auth, id, false);
      return detailAssertion(db, auth, mission, assertion);
    });
  });
}

function routesPreuvesEcriture(app: FastifyInstance) {
  app.post("/missions/:id/preuves", async (request, reply) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = preuveCreationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionEcrivable(db, auth, id);
      const preuveId = await creerPreuve(db, auth, mission, c);
      await journal(db, auth, "preuve.creer", "preuve", preuveId, {
        mission_id: id,
        type_source: c.type_source,
        fiabilite: c.fiabilite,
        nominatif: c.nominatif,
      });
      const preuve = (await lirePreuve(db, preuveId))!;
      return detailPreuve(db, auth, mission, preuve);
    });
    reply.status(201);
    return vue;
  });

  app.post("/preuves/:id/versions", async (request, reply) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = preuveCorrectionSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { preuve, mission } = await preuveAccessible(db, auth, id, true);
      const version = await corrigerPreuve(db, auth, preuve, c);
      await journal(db, auth, "preuve.corriger", "preuve", id, {
        mission_id: mission.id,
        version,
        fiabilite_avant: preuve.fiabilite,
        fiabilite_apres: c.fiabilite,
        accord_nominatif_avant: preuve.accord_nominatif,
        accord_nominatif_apres: c.accord_nominatif,
      });
      return detailPreuve(db, auth, mission, (await lirePreuve(db, id))!);
    });
    reply.status(201);
    return vue;
  });

  app.post("/missions/:id/preuves/dimensions", async (request, reply) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = dimensionCreationSchema.parse(request.body);
    const dimension = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionEcrivable(db, auth, id);
      const dimensionId = await creerDimension(db, auth, id, c.code, c.libelle);
      await journal(db, auth, "preuve.dimension.creer", "preuve_dimension", dimensionId, {
        mission_id: id,
        code: c.code,
      });
      return (await dimensionsDeMission(db, id, false)).find((d) => d.id === dimensionId);
    });
    reply.status(201);
    return dimension;
  });

  app.patch("/missions/:id/preuves/dimensions/:dimensionId", async (request) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id, dimensionId } = paramsMissionDimension.parse(request.params);
    const c = dimensionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionEcrivable(db, auth, id);
      const r = await db.query(
        `UPDATE preuve_dimensions SET libelle = coalesce($3, libelle), actif = coalesce($4, actif)
         WHERE id = $1 AND mission_id = $2 RETURNING id, code, libelle, actif, cree_le`,
        [dimensionId, id, c.libelle ?? null, c.actif ?? null],
      );
      if (!r.rows[0]) throw introuvable("Dimension");
      await journal(db, auth, "preuve.dimension.modifier", "preuve_dimension", dimensionId, {
        mission_id: id,
        libelle: c.libelle !== undefined,
        actif: c.actif,
      });
      return r.rows[0];
    });
  });
}

function routesAssertionsEcriture(app: FastifyInstance) {
  app.post("/missions/:id/assertions", async (request, reply) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = assertionCreationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionEcrivable(db, auth, id);
      const assertionId = await creerAssertion(db, auth, mission, c);
      await journal(db, auth, "assertion.creer", "assertion", assertionId, {
        mission_id: id,
        classe_risque: c.classe_risque,
        avis_expert: c.avis_expert,
        signe: c.avis_expert && c.signer_avis,
      });
      return detailAssertion(db, auth, mission, (await lireAssertion(db, assertionId))!);
    });
    reply.status(201);
    return vue;
  });

  app.post("/assertions/:id/versions", async (request, reply) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = assertionCorrectionSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { assertion, mission } = await assertionAccessible(db, auth, id, true);
      const version = await corrigerAssertion(db, auth, assertion, c);
      await journal(db, auth, "assertion.corriger", "assertion", id, {
        mission_id: mission.id,
        version,
        classe_risque_avant: assertion.classe_risque,
        classe_risque_apres: c.classe_risque,
        statut_avant: assertion.statut,
        statut_apres: c.statut,
        signe: c.avis_expert && c.signer_avis,
      });
      return detailAssertion(db, auth, mission, (await lireAssertion(db, id))!);
    });
    reply.status(201);
    return vue;
  });

  app.post("/assertions/:id/liens", async (request, reply) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = lienPreuveSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { assertion, mission } = await assertionAccessible(db, auth, id, true);
      const preuve = await lirePreuve(db, c.preuve_id);
      if (!preuve || preuve.mission_id !== mission.id) throw introuvable("Preuve");
      const existant = (await liensCourants(db, mission.id, [id])).find(
        (l) => l.preuve_id === c.preuve_id,
      );
      if (existant?.sens === c.sens) throw conflit("Cette preuve est déjà liée dans ce sens.");
      await ajouterLien(db, auth, mission.id, id, c.preuve_id, "lier", c.sens);
      await journal(db, auth, "assertion.lier", "assertion", id, {
        mission_id: mission.id,
        preuve_id: c.preuve_id,
        sens: c.sens,
        sens_avant: existant?.sens ?? null,
      });
      return detailAssertion(db, auth, mission, assertion);
    });
    reply.status(201);
    return vue;
  });

  app.delete("/assertions/:id/liens/:preuveId", async (request) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id, preuveId } = paramsLien.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { assertion, mission } = await assertionAccessible(db, auth, id, true);
      const existant = (await liensCourants(db, mission.id, [id])).find(
        (l) => l.preuve_id === preuveId,
      );
      if (!existant) throw introuvable("Lien");
      await ajouterLien(db, auth, mission.id, id, preuveId, "delier", null);
      await journal(db, auth, "assertion.delier", "assertion", id, {
        mission_id: mission.id,
        preuve_id: preuveId,
        sens: existant.sens,
      });
      return detailAssertion(db, auth, mission, assertion);
    });
  });

  app.post("/assertions/:id/arbitrages", async (request, reply) => {
    const auth = exiger(request, "preuve.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = arbitrageSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { assertion, mission } = await assertionAccessible(db, auth, id, true);
      const preuve = await lirePreuve(db, c.preuve_id);
      const lien = (await liensCourants(db, mission.id, [id])).find(
        (l) => l.preuve_id === c.preuve_id,
      );
      if (!preuve || !lien) throw introuvable("Preuve liée");
      await ajouterArbitrage(
        db,
        auth,
        mission.id,
        assertion,
        preuve,
        lien.sens,
        c.decision,
        c.motif,
      );
      await journal(db, auth, "preuve.arbitrer", "assertion", id, {
        mission_id: mission.id,
        preuve_id: c.preuve_id,
        preuve_version: preuve.version,
        decision: c.decision,
      });
      return detailAssertion(db, auth, mission, assertion);
    });
    reply.status(201);
    return vue;
  });
}

export const routesPreuves: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurPreuves(error);
  });
  routesPreuvesLecture(app);
  routesAssertionsLecture(app);
  routesPreuvesEcriture(app);
  routesAssertionsEcriture(app);
};
