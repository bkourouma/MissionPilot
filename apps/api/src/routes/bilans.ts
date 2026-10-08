import type { FastifyPluginAsync } from "fastify";
import { retourExperienceSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { AppError } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { estAssocie, exigerMissionVisible } from "../missions/acces.js";
import { droitsBudget } from "../missions/outils.js";
import { finDelaiRetour, lireBilan, vueBilan } from "../finance/bilan.js";

/**
 * Bilan de clôture d'une mission (cycle de vie). Lecture : « mission.lire »
 * sur une mission visible ; montants et marges seulement avec
 * « finance.lire » (blocs ABSENTS sinon). Retour d'expérience : le directeur
 * de la mission (ou un associé), dans les 30 jours suivant la clôture.
 */
export const routesBilans: FastifyPluginAsync = async (app) => {
  app.get("/missions/:id/bilan", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return vueBilan(await lireBilan(db, id), droitsBudget(auth));
    });
  });

  app.patch("/missions/:id/bilan/retour-experience", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const { texte } = retourExperienceSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id, true);
      if (mission.directeur_id !== auth.utilisateurId && !estAssocie(auth)) {
        throw new AppError(
          403,
          "INTERDIT",
          "Le retour d'expérience est rédigé par le directeur de la mission.",
        );
      }
      const bilan = await lireBilan(db, id, true);
      if (Date.now() > finDelaiRetour(bilan).getTime()) {
        throw new AppError(
          409,
          "DELAI_DEPASSE",
          "Le retour d'expérience se complète dans les 30 jours suivant la clôture.",
        );
      }
      await db.query(
        `UPDATE bilans_mission SET retour_experience = $2, retour_modifie_par = $3,
           retour_modifie_le = now() WHERE id = $1`,
        [bilan.id, texte, auth.utilisateurId],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "retour_experience",
        entite: "bilan_mission",
        entiteId: bilan.id,
        details: { mission_id: id, longueur: texte.length },
      });
      return vueBilan(await lireBilan(db, id), droitsBudget(auth));
    });
  });
};
