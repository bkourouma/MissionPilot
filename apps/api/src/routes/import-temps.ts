import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { importTempsQuerySchema, importTempsSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { envoyerEmails, type NotificationCreee } from "../notifications/notifier.js";
import { lireTeleversement } from "../stockage/fichiers.js";
import { importerTableau, tableauCsv, type TableauImport } from "../temps/import.js";
import {
  IMPORT_EXCEL_TAILLE_MAX,
  lireClasseurTemps,
  modeleExcelTemps,
  tropVolumineux,
  TYPE_XLSX,
} from "../temps/import-excel.js";
import { lireParametresTemps } from "../temps/outils.js";
import { evaluerAlertes } from "../temps/suivi.js";
import { gardeTailleMultipart } from "./fichiers.js";

/**
 * Import de l'historique des temps (TPS-10), depuis un CSV (corps JSON) ou un
 * classeur Excel .xlsx (multipart, champ « fichier ») : simulation par défaut
 * (`?simulation=true`), exécution avec `?simulation=false`. Une exécution
 * avec erreurs est refusée (400) et renvoie le rapport ligne par ligne. Les
 * deux formats passent par le même pipeline (`importerTableau`). Un modèle
 * Excel est téléchargeable. Le téléversement Excel est filtré avant toute
 * lecture du corps : origine par la garde globale (CSRF, `origineRefusee` dans
 * `app.ts`), taille annoncée par `gardeTailleMultipart` ; deux exécutions
 * simultanées d'un cabinet sont sérialisées (`importerTableau`).
 */
async function importer(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  auth: Auth,
  simulation: boolean,
  tableau: TableauImport,
) {
  const { rapport, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
    const p = await lireParametresTemps(db, auth.cabinetId);
    const resultat = await importerTableau(db, auth, tableau, p, simulation);
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
}

/** Excel : multipart enregistré dans ce seul périmètre (encapsulation Fastify). */
const routesImportExcel: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: IMPORT_EXCEL_TAILLE_MAX,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 50,
      headerPairs: 50,
    },
    throwFileSizeLimit: true,
  });

  app.post(
    "/temps/import/excel",
    // Taille annoncée refusée avant toute lecture, même sans session (413).
    { onRequest: gardeTailleMultipart(IMPORT_EXCEL_TAILLE_MAX, tropVolumineux) },
    async (request, reply) => {
      const auth = exiger(request, "temps.importer");
      const q = importTempsQuerySchema.parse(request.query);
      // Analyse en mémoire seulement : le classeur n'est jamais enregistré ni renvoyé.
      const recu = await lireTeleversement(request, IMPORT_EXCEL_TAILLE_MAX);
      // Lecture et contrôles du classeur hors transaction (aucune connexion tenue).
      const tableau = await lireClasseurTemps(recu.contenu);
      return importer(app, request, reply, auth, q.simulation === "true", tableau);
    },
  );
};

export const routesImportTemps: FastifyPluginAsync = async (app) => {
  app.post("/temps/import", async (request, reply) => {
    const auth = exiger(request, "temps.importer");
    const q = importTempsQuerySchema.parse(request.query);
    const { csv } = importTempsSchema.parse(request.body);
    return importer(app, request, reply, auth, q.simulation === "true", tableauCsv(csv));
  });

  /** Modèle Excel : en-tête attendu et mode d'emploi. */
  app.get("/temps/import/modele.xlsx", async (request, reply) => {
    exiger(request, "temps.importer");
    const contenu = await modeleExcelTemps();
    return reply
      .header("content-type", TYPE_XLSX)
      .header("content-disposition", 'attachment; filename="modele-import-temps.xlsx"')
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store")
      .send(contenu);
  });

  await app.register(routesImportExcel);
};
