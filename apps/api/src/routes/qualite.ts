import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  attestationSchema,
  classeRelevementSchema,
  elementsRevueSchema,
  relationClientSchema,
  satisfactionSyntheseQuerySchema,
  signatureSchema,
  suiviListeQuerySchema,
  suiviOuvertureSchema,
  validationEtapeSchema,
  TYPES_LIVRABLE,
} from "@missionpilot/shared";
import { z } from "zod";
import { exiger } from "../auth/contexte.js";
import { interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import {
  declarerRelation,
  evaluerAcceptation,
  lireAcceptation,
  listerRelations,
  retirerRelation,
} from "../qualite/acceptation.js";
import { DEFINITIONS_PAR_DEFAUT } from "../qualite/definitions.js";
import { exigerSuivi } from "../qualite/donnees.js";
import { traduireErreurQualite } from "../qualite/erreurs.js";
import {
  releverClasse,
  signerSuivi,
  validerEtape,
  validerSiGardeSatisfaite,
} from "../qualite/garde.js";
import {
  ajouterElementsRevue,
  demarrerSession,
  marquerVu,
  terminerSession,
} from "../qualite/revue.js";
import {
  lireSatisfactions,
  saisirSatisfaction,
  syntheseSatisfactionCabinet,
} from "../qualite/satisfaction.js";
import { detailSuivi, listerSuivis, ouvrirSuivi } from "../qualite/suivis.js";
import { attesterItem, verifierDefinition } from "../qualite/verification.js";

/*
 * Qualité et responsabilité professionnelle (QUA-01 à QUA-04, QUA-06 à QUA-08, PRD complémentaire
 * §10), monté sous /api. Droits : `mission.lire` pour consulter et parcourir (la visibilité de la
 * mission est TOUJOURS exigée en plus, 404 sinon), `qualite.relire` pour ouvrir, vérifier,
 * attester, relever la classe et tenir les étapes de relecture, `qualite.signer` pour signer et
 * décider d'une acceptation. Les gardes par classe et la séparation des tâches sont jugées par le
 * moteur (`evaluerGarde`). Aucune route n'est ouverte au portail client (liste blanche fermée).
 * Historiques en ajout seul (migrations 0280 à 0285) ; chaque action est journalisée.
 */

const paramsSuiviElement = z
  .object({ id: z.string().uuid(), element_id: z.string().uuid() })
  .strict();
const paramsSuiviItem = z.object({ id: z.string().uuid(), item_id: z.string().uuid() }).strict();
const queryRelations = z.object({ client_id: z.string().uuid().optional() }).strict();

function routesSuivis(app: FastifyInstance) {
  app.get("/qualite/suivis", async (request) => {
    const auth = exiger(request, "mission.lire");
    const q = suiviListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerSuivis(db, auth, q));
  });

  app.post("/qualite/suivis", async (request, reply) => {
    const auth = exiger(request, "qualite.relire");
    const corps = suiviOuvertureSchema.parse(request.body);
    const id = await app.db.withTenant(auth.cabinetId, async (db) => {
      const suivi = await ouvrirSuivi(db, auth, corps);
      return suivi.id;
    });
    reply.status(201);
    return app.db.withTenant(auth.cabinetId, (db) => detailSuivi(db, auth, id));
  });

  app.get("/qualite/suivis/:id", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailSuivi(db, auth, id));
  });

  app.post("/qualite/suivis/:id/classe", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const { id } = paramsId.parse(request.params);
    const corps = classeRelevementSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi, mission } = await exigerSuivi(db, auth, id, true);
      await releverClasse(db, auth, suivi, mission, corps.classe, corps.motif);
      return detailSuivi(db, auth, id);
    });
  });

  app.get("/qualite/definitions", async (request) => {
    const auth = exiger(request, "qualite.relire");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT DISTINCT ON (d.type_livrable) d.id, d.type_livrable, d.version, d.libelle
         FROM qualite_definitions d ORDER BY d.type_livrable, d.version DESC`,
      );
      const items = await db.query(
        `SELECT definition_id, code, libelle, controle, obligatoire, ordre
         FROM qualite_definition_items ORDER BY ordre, code`,
      );
      const parType = new Map(r.rows.map((l) => [l.type_livrable as string, l]));
      return {
        elements: TYPES_LIVRABLE.flatMap((type) => {
          const l = parType.get(type);
          if (l) {
            return [
              {
                type_livrable: type,
                libelle: l.libelle as string,
                version: l.version as number,
                par_defaut: false,
                items: items.rows.filter((i) => i.definition_id === l.id),
              },
            ];
          }
          const defaut = DEFINITIONS_PAR_DEFAUT[type];
          return defaut
            ? [
                {
                  type_livrable: type,
                  libelle: defaut.libelle,
                  version: 1,
                  par_defaut: true,
                  items: defaut.items,
                },
              ]
            : [];
        }),
      };
    });
  });
}

function routesRevue(app: FastifyInstance) {
  app.post("/qualite/suivis/:id/verification", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi } = await exigerSuivi(db, auth, id, true);
      await verifierDefinition(db, auth, suivi);
      await validerSiGardeSatisfaite(db, auth, suivi);
      return detailSuivi(db, auth, id);
    });
  });

  app.post("/qualite/suivis/:id/verification/:item_id/attestation", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const { id, item_id } = paramsSuiviItem.parse(request.params);
    const corps = attestationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi } = await exigerSuivi(db, auth, id, true);
      await attesterItem(db, auth, suivi, item_id, corps.commentaire);
      return detailSuivi(db, auth, id);
    });
  });

  app.post("/qualite/suivis/:id/elements", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const { id } = paramsId.parse(request.params);
    const corps = elementsRevueSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerSuivi(db, auth, id, true);
      await ajouterElementsRevue(
        db,
        auth.cabinetId,
        auth.utilisateurId,
        { suiviId: id },
        corps.elements,
      );
      return detailSuivi(db, auth, id);
    });
  });

  app.post("/qualite/suivis/:id/elements/:element_id/vu", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id, element_id } = paramsSuiviElement.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi } = await exigerSuivi(db, auth, id, true);
      await marquerVu(db, auth, suivi, element_id);
      return detailSuivi(db, auth, id);
    });
  });

  app.post("/qualite/suivis/:id/sessions", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi } = await exigerSuivi(db, auth, id, true);
      const { session } = await demarrerSession(db, auth, suivi);
      return { session, ...(await detailSuivi(db, auth, id)) };
    });
  });

  app.post("/qualite/sessions/:id/terminer", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi_id, session } = await terminerSession(db, auth, id);
      return { session, ...(await detailSuivi(db, auth, suivi_id)) };
    });
  });
}

function routesGarde(app: FastifyInstance) {
  app.post("/qualite/suivis/:id/validations", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const corps = validationEtapeSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi, mission } = await exigerSuivi(db, auth, id, true);
      await validerEtape(db, auth, suivi, mission, corps.etape, corps.commentaire ?? null);
      return detailSuivi(db, auth, id);
    });
  });

  app.post("/qualite/suivis/:id/signature", async (request) => {
    const auth = exiger(request, "qualite.signer");
    const { id } = paramsId.parse(request.params);
    const corps = signatureSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { suivi, mission } = await exigerSuivi(db, auth, id, true);
      await signerSuivi(db, auth, suivi, mission, corps.commentaire ?? null);
      return detailSuivi(db, auth, id);
    });
  });
}

function routesAcceptationEtSatisfaction(app: FastifyInstance) {
  app.get("/qualite/missions/:id/acceptation", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireAcceptation(db, auth, id));
  });

  app.post("/qualite/missions/:id/acceptation", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await evaluerAcceptation(db, auth, id, request.body);
      return lireAcceptation(db, auth, id);
    });
  });

  app.get("/qualite/relations-clients", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const q = queryRelations.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerRelations(db, q.client_id ?? null));
  });

  app.post("/qualite/relations-clients", async (request, reply) => {
    const auth = exiger(request, "qualite.signer");
    const corps = relationClientSchema.parse(request.body);
    const relation = await app.db.withTenant(auth.cabinetId, (db) =>
      declarerRelation(db, auth, corps),
    );
    reply.status(201);
    return relation;
  });

  app.delete("/qualite/relations-clients/:id", async (request, reply) => {
    const auth = exiger(request, "qualite.signer");
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, (db) => retirerRelation(db, auth, id));
    return reply.status(204).send();
  });

  app.get("/qualite/missions/:id/satisfactions", async (request) => {
    const auth = exiger(request, "qualite.relire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireSatisfactions(db, auth, id));
  });

  app.post("/qualite/missions/:id/satisfactions", async (request, reply) => {
    const auth = exiger(request, "qualite.relire");
    const { id } = paramsId.parse(request.params);
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      return saisirSatisfaction(db, auth, id, request.body);
    });
    reply.status(201);
    return resultat;
  });

  // Agrégat de satisfaction du cabinet : visible de l'associé seul (QUA-08).
  app.get("/qualite/satisfaction/synthese", async (request) => {
    const auth = exiger(request, "qualite.signer");
    if (!auth.roles.includes("associe")) throw interdit();
    const q = satisfactionSyntheseQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => syntheseSatisfactionCabinet(db, q));
  });
}

export const routesQualite: FastifyPluginAsync = async (app) => {
  // Traduction seule : l'enveloppe (et `details.violations` d'une ErreurGarde) est
  // produite par le gestionnaire unique d'app.ts.
  app.setErrorHandler(async (error) => {
    throw traduireErreurQualite(error);
  });
  routesSuivis(app);
  routesRevue(app);
  routesGarde(app);
  routesAcceptationEtSatisfaction(app);
};
