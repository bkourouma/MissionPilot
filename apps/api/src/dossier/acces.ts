import { aPermission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { filtreVisibilite } from "../missions/acces.js";

/*
 * RÈGLE DE VISIBILITÉ DES DOSSIERS CLIENTS (DOS-01, écrite ici, testée dans
 * test/dossier-client.test.ts)
 *
 * 1. Toute route exige d'abord `dossier.lire` (lecture) ou `dossier.ecrire`
 *    (écriture, export) ; l'isolation entre cabinets est assurée par RLS.
 * 2. Avec « mission.lire_toutes » (associé, directeur de mission), l'utilisateur
 *    voit le dossier de tout client du cabinet.
 * 3. Sans elle (chef de mission, consultant, expert métier), il ne voit que le
 *    dossier d'un client dont il voit au moins une mission (directeur, chef ou
 *    membre de l'équipe : règle de `missions/acces.ts`). La fiche client
 *    (`clients.lire`) n'ouvre PAS le dossier : faits, finances et fiabilité du
 *    client sont plus sensibles que son annuaire.
 * 4. Un dossier invisible répond 404, comme un client d'un autre cabinet.
 * 5. Les données FIN-02 du cabinet (coûts, taux, marges) n'entrent jamais dans
 *    le dossier : il ne porte que des données DU CLIENT (faits, facteurs,
 *    états financiers), quelle que soit la permission `finance.lire`.
 */

export const voitTousLesDossiers = (auth: Auth) => aPermission(auth.roles, "mission.lire_toutes");

/**
 * Fragment SQL de visibilité d'un dossier pour l'alias de table `c` (clients), avec deux
 * paramètres : (voit_tout boolean, utilisateur_id uuid).
 */
export function filtreDossierVisible(pVoitTout: number, pUtilisateur: number): string {
  return `($${pVoitTout}::boolean OR EXISTS (SELECT 1 FROM missions m
    WHERE m.client_id = c.id AND ${filtreVisibilite(pVoitTout, pUtilisateur)}))`;
}

export interface ClientDossier {
  id: string;
  raison_sociale: string;
  forme_juridique: string | null;
  rccm: string | null;
  secteur: string | null;
  pays: string;
  taille: string | null;
  actif: boolean;
}

/** Client dont le dossier est visible, ou 404. */
export async function exigerDossierVisible(
  db: Db,
  auth: Auth,
  clientId: string,
): Promise<ClientDossier> {
  const r = await db.query(
    `SELECT c.id, c.raison_sociale, c.forme_juridique, c.rccm, c.secteur, c.pays, c.taille, c.actif
     FROM clients c WHERE c.id = $1 AND ${filtreDossierVisible(2, 3)}`,
    [clientId, voitTousLesDossiers(auth), auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Dossier");
  return r.rows[0] as ClientDossier;
}

/**
 * Sérialise les écritures d'un même dossier (plafonds de volume, état courant d'un
 * exercice, instantané de fiabilité) : verrou consultatif de transaction.
 */
export async function verrouillerDossier(db: Db, clientId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`dossier:${clientId}`]);
}

/** Date civile du jour (UTC) : date de référence des valeurs courantes et de la fiabilité. */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}
