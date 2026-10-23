import type { FastifyPluginAsync } from "fastify";
import { groupeQuerySchema, participationCreationSchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { exigerDossierVisible } from "../dossier/acces.js";
import { avecErreursDossier } from "../dossier/erreurs.js";
import { ajouterParticipation, historiqueParticipations, lireGroupe } from "../dossier/groupes.js";
import { requeteInvalide } from "../errors.js";
import { paramsId } from "../http/outils.js";

/**
 * Groupes et filiales du dossier client (DOS-05, PRD complémentaire §5) : structure de
 * détention en ajout seul et consolidation simple des indicateurs (lecture indicative, pas une
 * consolidation comptable légale). Lecture : `dossier.lire` ; écriture : `dossier.ecrire` ;
 * toujours sur un dossier VISIBLE (404 sinon, y compris l'autre partie d'une participation).
 * Aucune route n'est ouverte au portail client (absentes de `LISTE_BLANCHE_PORTAIL`) et la
 * réponse ne porte aucune donnée FIN-02 du cabinet.
 */
export const routesDossierGroupes: FastifyPluginAsync = async (app) => {
  app.get("/dossiers/:id/groupe", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    const q = groupeQuerySchema.parse(request.query);
    return avecErreursDossier(() =>
      app.db.withTenant(auth.cabinetId, async (db) => {
        await exigerDossierVisible(db, auth, id);
        return lireGroupe(db, auth, id, q);
      }),
    );
  });

  app.get("/dossiers/:id/participations", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerDossierVisible(db, auth, id);
      return { elements: await historiqueParticipations(db, auth, id) };
    });
  });

  app.post("/dossiers/:id/participations", async (request, reply) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id } = paramsId.parse(request.params);
    const corps = participationCreationSchema.parse(request.body);
    if (id !== corps.detenteur_id && id !== corps.filiale_id) {
      throw requeteInvalide("Le dossier doit être le détenteur ou la filiale de la participation.");
    }
    const cree = await avecErreursDossier(() =>
      app.db.withTenant(auth.cabinetId, async (db) => {
        await exigerDossierVisible(db, auth, corps.detenteur_id);
        await exigerDossierVisible(db, auth, corps.filiale_id);
        const nouvelle = await ajouterParticipation(db, auth, corps);
        return (await historiqueParticipations(db, auth, id)).find((p) => p.id === nouvelle);
      }),
    );
    reply.status(201);
    return cree;
  });
};
