import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import { createDatabase } from "./pool.js";
import { configDemo, demoPubliqueConfirmee } from "./seed-demo.js";
import { EMAIL_FONDATEUR_TENANT, NOM_CABINET_TENANT_DEMO } from "./tenant-demo/constantes.js";
import { semerTenantDemo, type ResumeTenantDemo } from "./tenant-demo/index.js";

/*
 * Cabinet de démonstration « Tenant démo » : un cabinet de conseil qui EXISTE DEPUIS PLUS DE
 * DEUX ANS (activité d'octobre 2024 au 24 octobre 2026), ajouté à côté de « Lagune Conseil &
 * Associés (démo) » (seed-demo.ts, seed-defaut.ts), marqué `cabinets.est_demo` pour apparaître
 * dans le sélecteur de la page de connexion.
 *
 *   pnpm --filter @missionpilot/api db:seed-tenant-demo
 *
 * Une seule commande, idempotente : cabinet absent, il est créé par les vraies routes ; présent,
 * rien n'est dupliqué (le socle est repris, les phases déjà faites sont sautées). Options :
 * `--confirmer-demo` (démonstration publique, avec DEMO_PUBLIQUE=oui) et `--phase=<nom>`
 * (répétable : ne lancer que ces phases).
 *
 * Gardes identiques à seed-defaut.ts (`configDemo`) : développement/test avec bases locales ;
 * hors développement SEULEMENT si DEMO_PUBLIQUE=oui est défini ET `--confirmer-demo` passé
 * (alors aucune configuration SMTP n'est conservée). Aucun e-mail n'est envoyé : application
 * muette et, en mode public, envois neutralisés. Sur le serveur :
 *
 *   docker compose run --rm api node_modules/.bin/tsx src/db/seed-tenant-demo.ts --confirmer-demo
 *
 * Architecture et contrat des lots de domaine : voir tenant-demo/contexte.ts. Ce fichier
 * n'importe rien hors de `apps/api` et des paquets du dépôt : il tourne dans l'image de production.
 */

function afficher(resume: ResumeTenantDemo, publique: boolean): void {
  const { socle } = resume;
  console.log(
    `${NOM_CABINET_TENANT_DEMO} : ${socle.cabinetCree ? "créé" : "déjà présent"}, marqué démonstration ` +
      `(${socle.comptes} comptes, ${socle.collaborateurs} collaborateurs, ${socle.clients} clients).`,
  );
  for (const p of resume.phases) console.log(`  phase ${p.nom} : ${p.statut}`);
  console.log(
    `Compte fondateur : ${EMAIL_FONDATEUR_TENANT}. Mot de passe commun : MOT_DE_PASSE_DEMO_TENANT ` +
      `(voir tenant-demo/constantes.ts) : démonstration uniquement, jamais à ` +
      "réutiliser ailleurs.",
  );
  if (publique) {
    console.log("Mode démonstration publique : aucun e-mail envoyé, aucun job d'envoi conservé.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  let config: Config;
  try {
    config = configDemo(process.env, argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const database = createDatabase(config);
  const publique = demoPubliqueConfirmee(process.env, argv);
  const seulement = argv.filter((a) => a.startsWith("--phase=")).map((a) => a.slice(8));
  semerTenantDemo(database, config, { publique, ...(seulement.length ? { seulement } : {}) })
    .then((r) => afficher(r, publique))
    .catch((error: Error) => {
      console.error(`Échec du seed du Tenant démo : ${error.message}`);
      console.error(
        "Cabinet déjà présent : relancer la commande reprend ce qui manque sans rien dupliquer. " +
          "Phase interrompue en cours de route : repartir d'une base neuve.",
      );
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
