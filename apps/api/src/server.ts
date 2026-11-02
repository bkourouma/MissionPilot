import { buildApp } from "./app.js";
import {
  activiteDemoActive,
  AVERTISSEMENT_ACTIVITE_DEMO,
  loadConfig,
  workerActif,
} from "./config.js";
import { trousseauDepuisConfig } from "./auth/chiffrement.js";
import { createDatabase } from "./db/pool.js";
import { registreAvecEmails } from "./notifications/file-email.js";
import { WorkerJobs } from "./jobs/worker.js";
import { REGISTRE_JOBS, registreAvecStockage } from "./jobs/registre.js";
import { stockageDe } from "./stockage/index.js";

const config = loadConfig();
const db = createDatabase(config);
const app = await buildApp(config, db);
// Activité de démonstration automatique (job « activite_demo », DT14) : planifiée par le worker de
// ce processus seulement si DEMO_ACTIVITE_AUTO l'active (config.ts) ; elle écrit dans les cabinets
// marqués démo, d'où l'avertissement au démarrage.
const activiteDemo = activiteDemoActive(config);
if (activiteDemo) app.log.warn(AVERTISSEMENT_ACTIVITE_DEMO);
const worker = workerActif(config)
  ? new WorkerJobs(db, {
      mailer: app.mailer,
      registre: registreAvecEmails(
        app.mailer,
        trousseauDepuisConfig(config),
        registreAvecStockage(REGISTRE_JOBS, () => stockageDe(config)),
      ),
      journal: (m) => app.log.warn(m),
      activiteDemo,
    })
  : null;

const arret = async () => {
  await worker?.arreter();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", arret);
process.on("SIGTERM", arret);

await app.listen({ port: config.API_PORT, host: "127.0.0.1" });
worker?.demarrer();
