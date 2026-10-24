import pg from "pg";
import { buildApp } from "../../app.js";
import { dossierStockage, type Config } from "../../config.js";
import type { Database } from "../pool.js";
import { neutraliserEnvois } from "../seed-demo.js";
import {
  creerContexte,
  marquerPhase,
  phaseDejaFaite,
  type ContexteTenantDemo,
} from "./contexte.js";
import { PHASES, type PhaseTenantDemo } from "./phases/index.js";
import { semerSocle, type ResumeSocle } from "./socle.js";

/*
 * Orchestrateur du seed « Tenant démo » : le socle (socle.ts), puis les phases de domaine
 * (phases/index.ts) dans l'ordre. Point d'entrée en ligne de commande : ../seed-tenant-demo.ts.
 *
 * Gardes : ce module ne les porte pas, le point d'entrée les applique avant tout (`configDemo` :
 * développement/test avec bases locales, ou DEMO_PUBLIQUE=oui + `--confirmer-demo`). Ici, la
 * démonstration publique enveloppe la base par `neutraliserEnvois` (aucun job d'envoi ne survit
 * à sa transaction) ; l'application est montée en NODE_ENV=test (transport muet) dans tous les cas.
 *
 * Idempotence : le socle est repris sans doublon ; une phase déjà marquée faite (journal d'audit,
 * action `semis_tenant_demo`) est sautée. Une phase qui échoue n'est pas marquée : une relance la
 * rejoue (la phase doit alors reprendre sans doublon ou échouer clairement, voir contexte.ts).
 * Cabinet à moitié semé par une phase interrompue : repartir d'une base neuve.
 */

export interface OptionsTenantDemo {
  /** Démonstration publique confirmée (voir `demoPubliqueConfirmee`). */
  publique: boolean;
  journal?: (ligne: string) => void;
  /** Phases à exécuter (par défaut `PHASES`) : sert aux tests. */
  phases?: readonly PhaseTenantDemo[];
  /** Ne lancer que ces phases (noms de `PHASES`) ; le socle est toujours repris. */
  seulement?: readonly string[];
}

export interface ResumeTenantDemo {
  socle: ResumeSocle;
  phases: { nom: string; statut: "executee" | "deja_faite" | "ignoree" }[];
}

export async function semerTenantDemo(
  baseBrute: Database,
  config: Config,
  options: OptionsTenantDemo,
): Promise<ResumeTenantDemo> {
  const journal = options.journal ?? console.log;
  // Démonstration publique : aucun job d'envoi créé par le seed ne survit à sa transaction.
  const database = options.publique ? neutraliserEnvois(baseBrute) : baseBrute;
  const proprietaire = new pg.Client({ connectionString: config.DATABASE_OWNER_URL });
  await proprietaire.connect();
  // NODE_ENV=test : application muette (aucun journal HTTP, aucun transport de messages).
  const stockage = dossierStockage({ NODE_ENV: config.NODE_ENV, STORAGE_DIR: config.STORAGE_DIR });
  const app = await buildApp(
    { ...config, NODE_ENV: "test", TOTP_REQUIS: "non", STORAGE_DIR: stockage },
    database,
  );
  try {
    const ctx: ContexteTenantDemo = creerContexte({
      config,
      database,
      app,
      proprietaire,
      publique: options.publique,
      journal,
    });
    const socle = await semerSocle(ctx);
    const phases: ResumeTenantDemo["phases"] = [];
    for (const phase of options.phases ?? PHASES) {
      if (options.seulement && !options.seulement.includes(phase.nom)) {
        phases.push({ nom: phase.nom, statut: "ignoree" });
      } else if (await phaseDejaFaite(ctx, phase.nom)) {
        phases.push({ nom: phase.nom, statut: "deja_faite" });
      } else {
        journal(`Phase « ${phase.nom} »…`);
        await phase.executer(ctx);
        await marquerPhase(ctx, phase.nom);
        phases.push({ nom: phase.nom, statut: "executee" });
      }
    }
    return { socle, phases };
  } finally {
    await app.close();
    await proprietaire.end();
  }
}
