import type { FastifyPluginAsync } from "fastify";
import {
  annulationActionAutomatisationSchema,
  AUTOMATISATIONS_STANDARD,
  automatisationCreationSchema,
  automatisationModificationSchema,
  automatisationsQuerySchema,
  brouillonsAutomatisationQuerySchema,
  CATALOGUE_EVENEMENTS,
  coupeCircuitAutomatisationSchema,
  decisionBrouillonAutomatisationSchema,
  definitionAutomatisationSchema,
  executionsAutomatisationQuerySchema,
  paramsAutomatisationStandardSchema,
  REGISTRE_ACTIONS_AUTOMATISATION,
  simulationAutomatisationSchema,
  simulationDefinitionSchema,
  SOURCE_EVENEMENT_LIBELLES,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import {
  changerCoupeCircuitAutomatisation,
  lireCoupeCircuitAutomatisation,
} from "../automatisation/coupe-circuits.js";
import { brancherDiagnostic } from "../automatisation/diagnostic.js";
import { avecErreursAutomatisation } from "../automatisation/erreurs.js";
import {
  annulerAction,
  deciderBrouillon,
  listerBrouillons,
  listerExecutions,
} from "../automatisation/journal.js";
import {
  ajouterStandard,
  changerActivation,
  creerAutomatisation,
  detailAutomatisation,
  exigerDefinitionValide,
  lireAutomatisation,
  listerAutomatisations,
  modifierAutomatisation,
} from "../automatisation/regles.js";
import { simulerSurLePasse } from "../automatisation/simulation.js";
import type { Db } from "../db/pool.js";
import { paramsId } from "../http/outils.js";

/**
 * AUT-01 à AUT-06 (PRD complémentaire §8, ADR-006) : catalogue des événements et registre des
 * actions, automatisations du cabinet (bibliothèque standard, versions), simulation sur les
 * événements passés, journal des exécutions et annulation, brouillons tracés, coupe-circuits.
 *
 * Permissions : `automatisation.lire` (catalogue, liste, détail, simulation, journal,
 * brouillons), `automatisation.gerer` (création, modification, activation, coupure, annulation
 * — avec en plus la permission de l'action annulée) ; lever un coupe-circuit revient à un
 * associé (403 ACTION_RESERVEE, doublé en base MPU02) ; décider d'un brouillon revient au chef
 * ou au directeur de sa mission. Les actions elles-mêmes ne s'exécutent jamais dans une route :
 * le worker les exécute (file `jobs`) dans les droits du compte d'automatisation ou du
 * déclencheur. Aucune route n'est ouverte au portail client (`LISTE_BLANCHE_PORTAIL`).
 *
 * Les incidents inattendus du moteur (action en échec, publication refusée par la base) sont
 * consignés dans le journal de l'application (`app.log`, automatisation/diagnostic.ts) ; le
 * worker tourne dans le même processus. Les simulations sont plafonnées par utilisateur (429).
 */
export const routesAutomatisation: FastifyPluginAsync = async (app) => {
  const debrancher = brancherDiagnostic((entree, message) => app.log.warn(entree, message));
  app.addHook("onClose", async () => debrancher());

  const tx = <T>(cabinetId: string, fn: (db: Db) => Promise<T>) =>
    app.db.withTenant(cabinetId, (db) => avecErreursAutomatisation(() => fn(db)));

  app.get("/automatisations/catalogue", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    return tx(auth.cabinetId, async (db) => {
      const r = await db.query(
        "SELECT standard_code, id FROM automatisations WHERE standard_code IS NOT NULL",
      );
      const ajoutees = new Map(r.rows.map((l) => [l.standard_code as string, l.id as string]));
      return {
        evenements: Object.entries(CATALOGUE_EVENEMENTS).map(([code, e]) => ({
          code,
          ...e,
          source_libelle: SOURCE_EVENEMENT_LIBELLES[e.source],
        })),
        actions: Object.entries(REGISTRE_ACTIONS_AUTOMATISATION).map(([type, m]) => ({
          type,
          ...m,
        })),
        standard: AUTOMATISATIONS_STANDARD.map((s) => ({
          ...s,
          automatisation_id: ajoutees.get(s.code) ?? null,
        })),
      };
    });
  });

  app.get("/automatisations", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    const q = automatisationsQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => listerAutomatisations(db, q));
  });

  app.post("/automatisations", async (request, reply) => {
    const auth = exiger(request, "automatisation.gerer");
    const c = automatisationCreationSchema.parse(request.body);
    const cree = await tx(auth.cabinetId, async (db) =>
      detailAutomatisation(db, await creerAutomatisation(db, auth, c)),
    );
    reply.status(201);
    return cree;
  });

  app.post("/automatisations/standard/:code", async (request, reply) => {
    const auth = exiger(request, "automatisation.gerer");
    const { code } = paramsAutomatisationStandardSchema.parse(request.params);
    const cree = await tx(auth.cabinetId, async (db) =>
      detailAutomatisation(db, await ajouterStandard(db, auth, code)),
    );
    reply.status(201);
    return cree;
  });

  app.get("/automatisations/coupe-circuit", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    return tx(auth.cabinetId, (db) => lireCoupeCircuitAutomatisation(db, null));
  });

  app.post("/automatisations/coupe-circuit", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    const d = coupeCircuitAutomatisationSchema.parse(request.body);
    return tx(auth.cabinetId, (db) => changerCoupeCircuitAutomatisation(db, auth, null, d));
  });

  app.post("/automatisations/simulation", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    const s = simulationDefinitionSchema.parse(request.body);
    return tx(auth.cabinetId, async (db) => {
      await exigerDefinitionValide(db, s.definition);
      return simulerSurLePasse(db, auth, s.definition, { depuis: s.depuis, limite: s.limite });
    });
  });

  app.get("/automatisations/executions", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    const q = executionsAutomatisationQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => listerExecutions(db, auth, q));
  });

  app.post("/automatisations/actions/:id/annuler", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    const { id } = paramsId.parse(request.params);
    const { motif } = annulationActionAutomatisationSchema.parse(request.body);
    await tx(auth.cabinetId, (db) => annulerAction(db, auth, id, motif));
    return { annulee: true };
  });

  app.get("/automatisations/brouillons", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    const q = brouillonsAutomatisationQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => listerBrouillons(db, auth, q));
  });

  app.post("/automatisations/brouillons/:id/decision", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    const { id } = paramsId.parse(request.params);
    const d = decisionBrouillonAutomatisationSchema.parse(request.body);
    return tx(auth.cabinetId, (db) => deciderBrouillon(db, auth, id, d));
  });

  app.get("/automatisations/:id", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    const { id } = paramsId.parse(request.params);
    return tx(auth.cabinetId, (db) => detailAutomatisation(db, id));
  });

  app.patch("/automatisations/:id", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    const { id } = paramsId.parse(request.params);
    const m = automatisationModificationSchema.parse(request.body);
    return tx(auth.cabinetId, async (db) => {
      await modifierAutomatisation(db, auth, id, m);
      return detailAutomatisation(db, id);
    });
  });

  app.post("/automatisations/:id/activer", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    const { id } = paramsId.parse(request.params);
    return tx(auth.cabinetId, async (db) => {
      await changerActivation(db, auth, id, true);
      return detailAutomatisation(db, id);
    });
  });

  app.post("/automatisations/:id/desactiver", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    const { id } = paramsId.parse(request.params);
    return tx(auth.cabinetId, async (db) => {
      await changerActivation(db, auth, id, false);
      return detailAutomatisation(db, id);
    });
  });

  app.post("/automatisations/:id/coupe-circuit", async (request) => {
    const auth = exiger(request, "automatisation.gerer");
    const { id } = paramsId.parse(request.params);
    const d = coupeCircuitAutomatisationSchema.parse(request.body);
    return tx(auth.cabinetId, async (db) => {
      await lireAutomatisation(db, id, true);
      return changerCoupeCircuitAutomatisation(db, auth, id, d);
    });
  });

  app.post("/automatisations/:id/simulation", async (request) => {
    const auth = exiger(request, "automatisation.lire");
    const { id } = paramsId.parse(request.params);
    const s = simulationAutomatisationSchema.parse(request.body ?? {});
    return tx(auth.cabinetId, async (db) => {
      const a = await lireAutomatisation(db, id);
      return simulerSurLePasse(db, auth, definitionAutomatisationSchema.parse(a.definition), {
        depuis: s.depuis,
        limite: s.limite,
        automatisationId: id,
        responsableId: a.active ? (a.responsable_id as string) : auth.utilisateurId,
      });
    });
  });
};
