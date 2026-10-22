import type { ResultatIngestion, UsageIngestion } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import type { DocumentIngestion } from "./documents.js";
import { structurerEtatFinancier } from "./etat-financier.js";
import type { DependancesIngestion } from "./fabrique.js";
import { structurerDd } from "./structuration-dd.js";
import { structurerStandard } from "./structuration-standard.js";
import type { PageExtraite } from "./types.js";

/*
 * Structuration d'un document selon son usage (ADR-009) : seconde étape de la chaîne, après l'extraction du
 * texte des pages. Un STRUCTUREUR lit le document et ses pages et renvoie le résultat ; le job
 * `ingestion_structuration` passe ensuite le document en `termine`.
 *
 * CONTRAT d'un structureur :
 * - il s'exécute dans la transaction du job (`ctx.db`, RLS du cabinet, déjà sous un SAVEPOINT du job : une
 *   erreur SQL ne fait pas échouer la transaction entière) ; les appels à l'orchestrateur IA passent par
 *   `ctx.database` (transactions COURTES séparées, jamais la transaction du job) ;
 * - `ctx.auth` est l'AUTEUR du document, reconstruit à partir de `cree_par` (utilisateur inactif : le job
 *   échoue `UTILISATEUR_INACTIF` avant d'appeler le structureur) : les droits de l'auteur s'appliquent
 *   (visibilité, `ia.utiliser`) ;
 * - il lève `ErreurIngestion(code)` (code de `CODES_ERREUR_INGESTION`) pour un échec DÉFINITIF du document ;
 *   toute autre erreur est une panne passagère (le job est repris, `ERREUR_INTERNE` à la dernière tentative) ;
 * - il ne modifie PAS le statut du document ; il peut renvoyer `etat_financier_id` (usage état financier).
 */

export interface PageIngeree extends PageExtraite {
  /** Nombre de caractères du texte. */
  nb_caracteres: number;
}

export interface ContexteStructuration {
  document: DocumentIngestion;
  pages: PageIngeree[];
  db: Db;
  database: Database;
  auth: Auth;
  deps: DependancesIngestion;
  /** Horloge du job. */
  maintenant: Date;
}

export interface ResultatStructuration {
  resultat: ResultatIngestion;
  etat_financier_id?: string | null;
}

export type Structureur = (ctx: ContexteStructuration) => Promise<ResultatStructuration>;

/** Un structureur par usage. */
export const STRUCTUREURS: Record<UsageIngestion, Structureur> = {
  etat_financier: structurerEtatFinancier,
  dd_rapport: structurerDd,
  dd_salle: structurerDd,
  standard_historique: structurerStandard,
};
