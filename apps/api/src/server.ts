import { buildApp } from "./app.js";
import { loadConfig, workerActif } from "./config.js";
import { createDatabase } from "./db/pool.js";
import { WorkerJobs } from "./jobs/worker.js";

const config = loadConfig();
const db = createDatabase(config);
const app = await buildApp(config, db);
const worker = workerActif(config)
  ? new WorkerJobs(db, { mailer: app.mailer, journal: (m) => app.log.warn(m) })
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
