import { configDemo } from "../../seed-demo.js";
import { createDatabase } from "../../pool.js";
import { semerTenantDemo } from "../index.js";
import { executerEtapes } from "./etapes.js";
import { creerMissionsDeSecours } from "./missions-secours.js";

/*
 * Lanceur de DÉVELOPPEMENT de la phase « notation-plans » (jamais utilisé en production) :
 *   tsx src/db/tenant-demo/notation-plans/dev-lancer.ts [--etape=kpi] [--etape=notations]
 * Reprend le socle, crée les missions de secours absentes (missions-secours.ts), puis exécute les
 * étapes demandées (toutes sans option). La base visée est celle de DATABASE_OWNER_URL / DATABASE_URL.
 */
const argv = process.argv.slice(2);
const etapes = argv.filter((a) => a.startsWith("--etape=")).map((a) => a.slice(8));
// Nom unique par lancement : le marqueur de phase ne doit pas empêcher de rejouer des étapes.
const nomPhase = `dev-notation-plans-${Date.now()}`;
const config = configDemo(process.env, argv);
const database = createDatabase(config);
semerTenantDemo(database, config, {
  publique: false,
  seulement: [nomPhase],
  phases: [
    {
      nom: nomPhase,
      executer: async (ctx) => {
        await creerMissionsDeSecours(ctx);
        await executerEtapes(ctx, etapes.length ? etapes : undefined);
      },
    },
  ],
})
  .then(() => console.log("Terminé."))
  .catch((e: Error) => {
    console.error(`Échec : ${e.stack ?? e.message}`);
    process.exitCode = 1;
  })
  .finally(() => database.close());
