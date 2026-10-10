import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  controleClotureSchema,
  historiqueClotureQuerySchema,
} from "@missionpilot/shared";
import { z } from "zod";
import { exiger } from "../auth/contexte.js";
import { accorderDerogation, attester, retirerDerogation } from "../cloture/derogations.js";
import {
  CONTROLES_CLOTURE_FINANCIERS,
  evaluerCloture,
  vueEvaluation,
} from "../cloture/evaluation.js";
import { traduireErreurCloture } from "../cloture/erreurs.js";
import { lireHistorique } from "../cloture/historique.js";
import { enregistrerModele, lireModele } from "../cloture/modele.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionModifiable, exigerMissionVisible } from "../missions/acces.js";

/**
 * AUT-08 : check-list de clôture bloquante (PRD complémentaire), montée sous /api.
 *
 * Droits : `mission.lire` pour lire le modèle et l'état d'une mission (visibilité de la mission
 * toujours exigée en plus, 404 sinon) ; `cabinet.gerer` pour paramétrer le modèle ; `mission.planifier`
 * (et mission modifiable) pour évaluer avec enregistrement et attester ; `mission.cloturer`
 * (directeur de mission, associé) pour accorder ou retirer une dérogation. La route de clôture
 * elle-même (`POST /missions/:id/cloturer`) refuse en 409 `CLOTURE_BLOQUEE`. Aucune route n'est
 * ouverte au portail client (liste blanche fermée). Résultats et dérogations en ajout seul
 * (migrations 0321 et 0322) ; seuls des compteurs d'écarts sont servis, jamais un montant, et
 * sans `facture.lire` ceux des contrôles financiers sont absents. Séparation des tâches : qui a
 * accordé une dérogation ne clôt pas la mission, sauf associé (MPX03, 0323).
 */

const paramsControle = z
  .object({ id: z.string().uuid(), controle: controleClotureSchema })
  .strict();

export const routesCloture: FastifyPluginAsync = async (app) => {
  // Traduction seule (MPX01 à MPX03, 23514) : l'enveloppe est produite par le gestionnaire d'app.ts.
  app.setErrorHandler(async (error) => {
    throw traduireErreurCloture(error);
  });

  app.get("/cloture/modele", async (request) => {
    const auth = exiger(request, "mission.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => ({ items: await lireModele(db) }));
  });

  app.put("/cloture/modele", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    return app.db.withTenant(auth.cabinetId, async (db) => ({
      items: await enregistrerModele(db, auth, request.body),
    }));
  });

  app.get("/missions/:id/cloture", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      return {
        statut_mission: mission.statut,
        ...vueEvaluation(auth, await evaluerCloture(db, id)),
      };
    });
  });

  app.post("/missions/:id/cloture/evaluer", async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionModifiable(db, auth, id);
      return {
        statut_mission: mission.statut,
        ...vueEvaluation(
          auth,
          await evaluerCloture(db, id, { persister: { auth, declencheur: "evaluation" } }),
        ),
      };
    });
  });

  app.get("/missions/:id/cloture/historique", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const q = historiqueClotureQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const h = await lireHistorique(db, id, q.limite, {
        verifications: q.curseur_verifications,
        derogations: q.curseur_derogations,
      });
      if (aPermission(auth.roles, "facture.lire")) return h;
      // Sans `facture.lire` : pas de nombre d'écarts des contrôles financiers.
      return {
        ...h,
        verifications: h.verifications.map((v) => {
          if (!CONTROLES_CLOTURE_FINANCIERS.includes(v.controle as never)) return v;
          return Object.fromEntries(Object.entries(v).filter(([cle]) => cle !== "nombre_ecarts"));
        }),
      };
    });
  });

  app.post("/missions/:id/cloture/derogations", async (request, reply) => {
    const auth = exiger(request, "mission.cloturer");
    const { id } = paramsId.parse(request.params);
    const evaluation = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      await accorderDerogation(db, auth, id, request.body);
      return vueEvaluation(auth, await evaluerCloture(db, id));
    });
    reply.status(201);
    return evaluation;
  });

  app.post("/missions/:id/cloture/derogations/:controle/retrait", async (request) => {
    const auth = exiger(request, "mission.cloturer");
    const { id, controle } = paramsControle.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      await retirerDerogation(db, auth, id, controle, request.body);
      return vueEvaluation(auth, await evaluerCloture(db, id));
    });
  });

  app.post("/missions/:id/cloture/attestations", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const evaluation = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      await attester(db, auth, id, request.body);
      return vueEvaluation(auth, await evaluerCloture(db, id));
    });
    reply.status(201);
    return evaluation;
  });
};
