import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/pool.js";

const config = loadConfig();
const db = createDatabase(config);
const app = await buildApp(config, db);

const arret = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", arret);
process.on("SIGTERM", arret);

await app.listen({ port: config.API_PORT, host: "127.0.0.1" });
