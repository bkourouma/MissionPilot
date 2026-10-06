import type { FastifyPluginAsync } from "fastify";
import { importTempsQuerySchema, importTempsSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { envoyerEmails, type NotificationCreee } from "../notifications/notifier.js";
import { importerTemps } from "../temps/import.js";
import { lireParametresTemps } from "../temps/outils.js";
import { evaluerAlertes } from "../temps/suivi.js";

/**
 * Import de l'historique des temps (TPS-10), CSV uniquement en V1 :
 * simulation par défaut (`?simulation=true`), exécution avec
 * `?simulation=false`. Une exécution avec erreurs est refusée (400) et
 * renvoie le rapport ligne par ligne.
 */
export const routesImportTemps: FastifyPluginAsync = async (app) => {
  app.post("/temps/import", async (request, reply) => {
    const auth = exiger(request, "temps.importer");
    const q = importTempsQuerySchema.parse(request.query);
    const { csv } = importTempsSchema.parse(request.body);
    const simulation = q.simulation === "true";
    const { rapport, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await lireParametresTemps(db, auth.cabinetId);
      const resultat = await importerTemps(db, auth, csv, p, simulation);
      const creees: NotificationCreee[] = [];
      if (resultat.rapport.executee) {
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "import",
          entite: "temps",
          details: {
            lignes: resultat.rapport.lignes_valides,
            feuilles: resultat.rapport.feuilles,
            jours: resultat.rapport.jours_total,
          },
        });
        for (const m of resultat.missions)
          creees.push(...(await evaluerAlertes(db, auth.cabinetId, m)));
      }
      return { rapport: resultat.rapport, notifications: creees };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    if (!simulation && !rapport.executee) {
      return reply.status(400).send({
        erreur: {
          code: "IMPORT_INVALIDE",
          message: `${rapport.erreurs.length} ligne(s) en erreur : rien n'a été importé.`,
        },
        rapport,
      });
    }
    return rapport;
  });
};
