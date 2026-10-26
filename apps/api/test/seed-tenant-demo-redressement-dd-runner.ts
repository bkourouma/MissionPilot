import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../src/db/pool.js";
import { configDemo } from "../src/db/seed-demo.js";
import { semerTenantDemo } from "../src/db/tenant-demo/index.js";
import { creerMissionsCasting } from "./seed-tenant-demo-redressement-dd-outils.js";

/*
 * Lanceur de développement (hors suite de tests) : socle + casting minimal, puis les modules
 * demandés de tenant-demo/redressement-dd/, dans une base dont le nom est donné.
 *
 *   tsx test/seed-tenant-demo-redressement-dd-runner.ts <base> [<fichier>:<fonction> ...]
 *   ex. : tsx test/seed-tenant-demo-redressement-dd-runner.ts missionpilot_td4_red redressement:semerRedressement
 *
 * `<base>` doit exister et être migrée (un clone d'une base déjà semée convient). Un module déjà exécuté avec succès dans cette base est sauté ; un module échoué se
 * rejoue : repartir d'un clone neuf si la base est à moitié semée.
 */
const [base, ...modules] = process.argv.slice(2);
if (!base) {
  console.error("usage : runner <base> [<fichier>:<fonction> ...]");
  process.exit(1);
}
const remplacer = (u: string) => {
  const x = new URL(u);
  x.pathname = `/${base}`;
  return x.toString();
};
process.env.DATABASE_OWNER_URL = remplacer(
  process.env.DATABASE_OWNER_URL ??
    "postgres://missionpilot_owner:dev_only_owner_password@127.0.0.1:55440/x",
);
process.env.DATABASE_URL = remplacer(
  process.env.DATABASE_URL ?? "postgres://missionpilot_app:dev_only_app_password@127.0.0.1:55440/x",
);
const config = configDemo(process.env);
const database = createDatabase(config);
const dossier = path.resolve(import.meta.dirname, "../src/db/tenant-demo/redressement-dd");
const phases = [{ nom: "casting", executer: creerMissionsCasting }];
for (const m of modules) {
  const [fichier, fonction] = m.split(":");
  phases.push({
    nom: `run:${m}`,
    executer: async (ctx) => {
      const mod = await import(pathToFileURL(path.join(dossier, `${fichier}.ts`)).href);
      await mod[fonction as string](ctx);
    },
  });
}
semerTenantDemo(database, config, { publique: false, phases })
  .then((r) => console.log(r.phases.map((p) => `${p.nom}: ${p.statut}`).join("\n")))
  .catch((e: Error) => {
    console.error(`ÉCHEC : ${e.stack ?? e.message}`);
    process.exitCode = 1;
  })
  .finally(() => database.close());
