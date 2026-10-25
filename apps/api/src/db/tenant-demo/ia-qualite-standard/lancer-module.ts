import { configDemo } from "../../seed-demo.js";
import { createDatabase } from "../../pool.js";
import { semerTenantDemo } from "../index.js";
import { MODULES as MODULES_PHASE, MODULES_APRES_CLOTURE } from "./modules.js";
import { assurerMissionsSubstituts, cloturerSubstituts } from "./substituts-missions.js";

/*
 * OUTIL DE DÉVELOPPEMENT : exécute un ou plusieurs modules de la phase « ia-qualite-standard »
 * (noms de `MODULES`, ou `revues-froides` : étape d'après clôture) sur la base désignée par
 * DATABASE_OWNER_URL / DATABASE_URL, sans marquer la phase comme faite. Reprend le socle
 * (idempotent), crée au besoin les missions de substitution (ouvertes, comme avec le lot 2a), puis
 * lance les modules demandés dans l'ordre. Un module est idempotent : on peut le relancer.
 *
 *   npx tsx src/db/tenant-demo/ia-qualite-standard/lancer-module.ts ia agents
 */
const MODULES = { ...MODULES_PHASE, ...MODULES_APRES_CLOTURE };
const noms = process.argv.slice(2);
const inconnus = noms.filter((n) => !(n in MODULES));
if (noms.length === 0 || inconnus.length > 0) {
  console.error(
    `Modules disponibles : ${Object.keys(MODULES).join(", ")} (reçu : ${noms.join(" ")})`,
  );
  process.exit(1);
}
const config = configDemo(process.env, []);
const database = createDatabase(config);
semerTenantDemo(database, config, {
  publique: false,
  phases: [
    {
      nom: `dev-modules-${Date.now()}`,
      executer: async (ctx) => {
        const n = await assurerMissionsSubstituts(ctx);
        if (n > 0) ctx.journal(`${n} mission(s) de substitution créée(s).`);
        for (const nom of noms) {
          ctx.journal(`Module « ${nom} »…`);
          // Étape d'après clôture : on simule la clôture finale de la phase « gestion ».
          if (nom in MODULES_APRES_CLOTURE) await cloturerSubstituts(ctx);
          await MODULES[nom as keyof typeof MODULES](ctx);
        }
      },
    },
  ],
})
  .catch((e: Error) => {
    console.error(e.stack ?? e.message);
    process.exitCode = 1;
  })
  .finally(() => database.close());
