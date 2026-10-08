import type { FastifyPluginAsync } from "fastify";
import {
  generationCreationSchema,
  generationModificationSchema,
  generationsQuerySchema,
  generationValidationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import {
  annulerGeneration,
  listerGenerations,
  lireVue,
  modifierGeneration,
  validerGeneration,
} from "../ia/generations.js";
import { genererContenu, mettreEnFile, type DemandeContenu } from "../ia/orchestrateur.js";
import { envoyerEmails } from "../notifications/notifier.js";

/*
 * Générations IA (ia.utiliser) : génération manuelle de TEST avec un prompt
 * « exemple » (les services de conseil appellent l'orchestrateur
 * directement), lecture paginée par curseur, détail avec progression et
 * historique des versions, modification, validation, annulation.
 *
 * La route de test ne reçoit NI chiffres de contexte, NI source « moteur »,
 * NI mission (400, schéma partagé) : la liste blanche de la garde-chiffres
 * est construite par le code des services à partir des moteurs de calcul.
 *
 * Contrat : toute réponse porte `statut_contenu` (null tant qu'aucun contenu
 * n'existe) et `livrable_client` (vrai seulement après validation humaine,
 * jamais pour un essai avec un prompt « exemple »).
 */

export const routesIaGenerations: FastifyPluginAsync = async (app) => {
  const deps = () => ({
    config: app.config,
    journal: (e: unknown) => app.log.info({ ia: e }),
  });

  app.post("/ia/generations", async (request, reply) => {
    const auth = exiger(request, "ia.utiliser");
    const c = generationCreationSchema.parse(request.body);
    const demande: DemandeContenu = {
      promptNom: c.prompt_nom,
      variables: c.variables,
      termesSensibles: c.termes_sensibles,
      sources: c.sources,
      utilisateur: auth,
      repliSiPlafond: c.repli_si_plafond,
      exempleSeulement: true,
    };
    if (c.mode === "file") {
      const id = await app.db.withTenant(auth.cabinetId, (db) => mettreEnFile(db, deps(), demande));
      const vue = await app.db.withTenant(auth.cabinetId, (db) => lireVue(db, auth, id));
      return reply.status(202).send(vue);
    }
    const { demandeId, resultat } = await genererContenu(app.db, deps(), demande);
    await envoyerEmails(app.mailer, resultat.notifications, (m) => app.log.warn(m));
    const vue = await app.db.withTenant(auth.cabinetId, (db) => lireVue(db, auth, demandeId));
    return reply.status(201).send(vue);
  });

  app.get("/ia/generations", async (request) => {
    const auth = exiger(request, "ia.utiliser");
    const q = generationsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerGenerations(db, auth, q));
  });

  app.get("/ia/generations/:id", async (request) => {
    const auth = exiger(request, "ia.utiliser");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireVue(db, auth, id));
  });

  app.post("/ia/generations/:id/modifier", async (request) => {
    const auth = exiger(request, "ia.utiliser");
    const { id } = paramsId.parse(request.params);
    const { texte } = generationModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await modifierGeneration(db, auth, id, texte);
      return lireVue(db, auth, id);
    });
  });

  app.post("/ia/generations/:id/valider", async (request) => {
    const auth = exiger(request, "ia.utiliser");
    const { id } = paramsId.parse(request.params);
    const v = generationValidationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await validerGeneration(db, auth, id, v.acquitte_chiffres === true);
      return lireVue(db, auth, id);
    });
  });

  app.post("/ia/generations/:id/annuler", async (request) => {
    const auth = exiger(request, "ia.utiliser");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await annulerGeneration(db, auth, id);
      return lireVue(db, auth, id);
    });
  });
};
