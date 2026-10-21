import type { FastifyPluginAsync } from "fastify";
import {
  redChecklistActivationSchema,
  redChecklistArchivageSchema,
  redChecklistModeleCreationSchema,
  redChecklistModelesQuerySchema,
  redChecklistPublicationSchema,
  redChecklistReponsesLotSchema,
  redChecklistVersionCreationSchema,
  redChecklistsQuerySchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { paramsId } from "../http/outils.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import {
  activerChecklist,
  archiverChecklist,
  checklistEcriture,
  checklistVisible,
  creerModele,
  creerVersionModele,
  detailChecklist,
  listerChecklists,
  lireModeles,
  publierVersionModele,
  referentielChecklists,
  saisirReponses,
} from "../redressement/checklists.js";

/*
 * Check-lists métier du redressement (RED-03, lot 2), plugin de routes/redressement.ts (qui traduit
 * les erreurs du module). Droits : `redressement.lire` (lecture des modèles et des check-lists),
 * `redressement.parametrer` (rédiger et publier les modèles du cabinet : associé et expert métier,
 * séparation des tâches à la publication), `redressement.ecrire` (activer, renseigner, archiver, avec
 * les règles d'accès au dossier). Les taux sortent du moteur. FERMÉ AU PORTAIL. Le contenu de départ
 * est provisoire, « à valider par un expert ».
 */
export const routesRedressementChecklists: FastifyPluginAsync = async (app) => {
  app.get("/redressement/checklists/referentiel", async (request, reply) => {
    exiger(request, "redressement.lire");
    reply.header("cache-control", "private");
    return referentielChecklists();
  });

  app.get("/redressement/checklists/modeles", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const q = redChecklistModelesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => lireModeles(db, auth, q.secteur));
  });

  app.post("/redressement/checklists/modeles", async (request, reply) => {
    const auth = exiger(request, "redressement.parametrer");
    const corps = redChecklistModeleCreationSchema.parse(request.body);
    const m = await app.db.withTenant(auth.cabinetId, (db) => creerModele(db, auth, corps));
    reply.status(201);
    return m;
  });

  app.post("/redressement/checklists/modeles/:id/versions", async (request, reply) => {
    const auth = exiger(request, "redressement.parametrer");
    const { id } = paramsId.parse(request.params);
    const corps = redChecklistVersionCreationSchema.parse(request.body);
    const v = await app.db.withTenant(auth.cabinetId, (db) =>
      creerVersionModele(db, auth, id, corps),
    );
    reply.status(201);
    return v;
  });

  app.post("/redressement/checklists/versions/:id/publication", async (request) => {
    const auth = exiger(request, "redressement.parametrer");
    const { id } = paramsId.parse(request.params);
    redChecklistPublicationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, (db) => publierVersionModele(db, auth, id));
  });

  app.get("/redressement/dossiers/:id/checklists", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const q = redChecklistsQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      listerChecklists(db, (await exigerDossierRedVisible(db, auth, id)).dossier, q.statut),
    );
  });

  app.post("/redressement/dossiers/:id/checklists", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redChecklistActivationSchema.parse(request.body);
    const c = await app.db.withTenant(auth.cabinetId, async (db) =>
      activerChecklist(db, auth, await exigerDossierRedEcriture(db, auth, id), corps),
    );
    reply.status(201);
    return c;
  });

  app.get("/redressement/checklists/:id", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { acces, checklist } = await checklistVisible(db, auth, id);
      return detailChecklist(db, auth, acces, checklist);
    });
  });

  app.post("/redressement/checklists/:id/reponses", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redChecklistReponsesLotSchema.parse(request.body);
    const c = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { acces, checklist } = await checklistEcriture(db, auth, id);
      return saisirReponses(db, auth, acces, checklist, corps);
    });
    reply.status(201);
    return c;
  });

  app.post("/redressement/checklists/:id/archivage", async (request) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = redChecklistArchivageSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { acces, checklist } = await checklistEcriture(db, auth, id);
      return archiverChecklist(db, auth, acces, checklist, corps.motif);
    });
  });
};
