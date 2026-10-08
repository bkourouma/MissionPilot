import { dechiffrer, trousseauDepuisConfig } from "../auth/chiffrement.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import type { HandlerJob } from "../jobs/registre.js";
import {
  aadEntree,
  chargeJobIaSchema,
  entreeIaSchema,
  executerDemande,
  type DependancesIa,
  type EntreeIa,
  type Transacteur,
} from "./orchestrateur.js";
import { USAGE_ENTREE_IA } from "./parametres.js";

/*
 * Job `ia_generation` (file PostgreSQL, ADR-002) : exécute une demande mise
 * en file par `mettreEnFile`, dans le contexte RLS de son cabinet ; l'horloge
 * est celle du worker (injectable).
 *
 * - L'exécution (réservation du plafond, appel, clôture) se fait en
 *   transactions COURTES SÉPARÉES de celle du job (`ctx.database`) : la
 *   réservation et la consommation sont visibles des autres appels pendant
 *   l'appel, au lieu de rester enfermées dans la transaction longue du job.
 * - Reprise : une panne passagère du fournisseur (429, 5xx, délai) ou trop
 *   d'appels simultanés lève l'erreur (réservation soldée, coût éventuel
 *   inscrit) et le worker reprend le job plus tard.
 * - À la DERNIÈRE tentative, aucune erreur ne remonte : la demande passe
 *   « echec » (code du fournisseur, ou ERREUR_INTERNE pour une erreur
 *   inattendue), sa réservation est soldée et la charge chiffrée effacée.
 * - La charge (entrée chiffrée) est effacée dès que la demande est close ;
 *   une demande annulée ou déjà close ne déclenche aucun appel. Une charge
 *   illisible ou une demande inconnue terminent le job sans appel.
 *
 * Ce module n'importe du registre que des TYPES : registre.ts l'importe à
 * son tour (pas de cycle à l'évaluation).
 */

let dependancesParDefaut: DependancesIa | null = null;

/** Dépendances du worker de l'application : configuration de l'environnement. */
export function dependancesIaParDefaut(): DependancesIa {
  dependancesParDefaut ??= { config: loadConfig() };
  return dependancesParDefaut;
}

async function effacerCharge(db: Db, jobId: string): Promise<void> {
  await db.query("UPDATE jobs SET charge = '{}'::jsonb WHERE id = $1", [jobId]);
}

async function echouer(db: Db, demandeId: string, code: string, maintenant: Date): Promise<void> {
  await db.query(
    `UPDATE ia_demandes SET statut = 'echec', progression = 100, termine_le = $2, erreur_code = $3
     WHERE id = $1 AND statut IN ('en_file', 'en_cours')`,
    [demandeId, maintenant, code],
  );
  await db.query("DELETE FROM ia_reservations WHERE demande_id = $1", [demandeId]);
}

export function creerHandlerIaGeneration(dependances: () => DependancesIa): HandlerJob {
  return async (ctx) => {
    const charge = chargeJobIaSchema.safeParse(ctx.charge);
    if (!charge.success) {
      // Charge effacée (demande annulée) ou altérée : rien à exécuter.
      await effacerCharge(ctx.db, ctx.jobId);
      return [];
    }
    const demandeId = charge.data.demande_id;
    const deps = { ...dependances(), horloge: () => ctx.maintenant };
    const dem = await ctx.db.query("SELECT statut FROM ia_demandes WHERE id = $1", [demandeId]);
    if (!dem.rows[0] || !["en_file", "en_cours"].includes(dem.rows[0].statut as string)) {
      await effacerCharge(ctx.db, ctx.jobId);
      return [];
    }
    let entree: EntreeIa;
    try {
      const clair = dechiffrer(
        trousseauDepuisConfig(deps.config),
        USAGE_ENTREE_IA,
        { version: charge.data.v, donnees: Buffer.from(charge.data.d, "base64") },
        aadEntree(ctx.cabinetId, demandeId),
      );
      entree = entreeIaSchema.parse(JSON.parse(clair.toString("utf8")));
    } catch {
      await echouer(ctx.db, demandeId, "ENTREE_ILLISIBLE", ctx.maintenant);
      await effacerCharge(ctx.db, ctx.jobId);
      return [];
    }
    const database = ctx.database;
    if (!database) {
      // Hors worker (sans base de l'application) : pas d'appel dans la transaction du job.
      await echouer(ctx.db, demandeId, "ERREUR_INTERNE", ctx.maintenant);
      await effacerCharge(ctx.db, ctx.jobId);
      return [];
    }
    const job = await ctx.db.query("SELECT tentatives, tentatives_max FROM jobs WHERE id = $1", [
      ctx.jobId,
    ]);
    const derniereTentative =
      !job.rows[0] || (job.rows[0].tentatives as number) >= (job.rows[0].tentatives_max as number);
    const transacteur: Transacteur = (fn) => database.withTenant(ctx.cabinetId, fn);
    try {
      const resultat = await executerDemande(transacteur, deps, ctx.cabinetId, demandeId, entree, {
        derniereTentative,
      });
      await effacerCharge(ctx.db, ctx.jobId);
      return resultat.notifications;
    } catch (error) {
      if (!derniereTentative) throw error; // reprise par le worker
      // Dernière tentative : toute erreur est interceptée (échec, charge effacée).
      await transacteur((db) => echouer(db, demandeId, "ERREUR_INTERNE", ctx.maintenant)).catch(
        () => undefined,
      );
      await effacerCharge(ctx.db, ctx.jobId);
      return [];
    }
  };
}
