import { buildApp } from "./app.js";
import { loadConfig, workerActif } from "./config.js";
import { trousseauDepuisConfig } from "./auth/chiffrement.js";
import { createDatabase } from "./db/pool.js";
import { registreAvecEmails } from "./notifications/file-email.js";
import { WorkerJobs } from "./jobs/worker.js";
import { REGISTRE_JOBS, registreAvecStockage } from "./jobs/registre.js";
import { stockageDe } from "./stockage/index.js";

const config = loadConfig();
const db = createDatabase(config);
const app = await buildApp(config, db);
const worker = workerActif(config)
  ? new WorkerJobs(db, {
      mailer: app.mailer,
      registre: registreAvecEmails(
        app.mailer,
        trousseauDepuisConfig(config),
        registreAvecStockage(REGISTRE_JOBS, () => stockageDe(config)),
      ),
      journal: (m) => app.log.warn(m),
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
