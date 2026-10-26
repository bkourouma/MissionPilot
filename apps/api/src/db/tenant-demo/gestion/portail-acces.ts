import type { CleClient } from "../cles.js";
import { ouvrirSessionTenant, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";

/*
 * Accès au portail client par client, tous comptes confondus (socle et autres lots) : le Tenant
 * démo plafonne ses comptes actifs (la liste de connexion rapide est tronquée à 50) ; la phase
 * `gestion` réutilise donc les comptes ACTIFS existants (dirigeants et contributeurs, mot de passe
 * commun du cabinet) et n'en crée qu'en l'absence de tout compte pour un client.
 */

export interface AccesClient {
  dirigeant?: SessionDemo;
  contributeur?: SessionDemo;
  /** Jour de création du plus ancien de ces comptes (AAAA-MM-JJ). */
  depuis: string;
}

/** Accès d'un client qui a au moins un dirigeant actif. */
export type AccesDirigeant = AccesClient & { dirigeant: SessionDemo };

export async function accesPortailParClient(
  ctx: ContexteTenantDemo,
): Promise<Map<CleClient, AccesClient>> {
  const lignes = await ctx.proprietaire.query(
    `SELECT u.id, u.email, u.roles, p.client_id, (u.cree_le AT TIME ZONE 'UTC')::date::text AS depuis
       FROM utilisateurs u JOIN utilisateurs_portail p ON p.utilisateur_id = u.id
      WHERE u.cabinet_id = $1 AND u.actif AND p.statut = 'actif'
      ORDER BY u.cree_le, u.id`,
    [ctx.cabinetId],
  );
  const cles = Object.entries(ctx.clients) as [CleClient, string][];
  const acces = new Map<CleClient, AccesClient>();
  for (const l of lignes.rows as {
    id: string;
    email: string;
    roles: string[];
    client_id: string;
    depuis: string;
  }[]) {
    const client = cles.find(([, id]) => id === l.client_id)?.[0];
    if (!client) continue;
    const dirigeant = l.roles.includes("client_dirigeant");
    const contributeur = l.roles.includes("client_contributeur");
    if (!dirigeant && !contributeur) continue;
    const courant = acces.get(client) ?? { depuis: l.depuis };
    if (dirigeant && !courant.dirigeant) {
      courant.dirigeant = await ouvrirSessionTenant(ctx.app, l.email, l.id);
    } else if (contributeur && !courant.contributeur) {
      courant.contributeur = await ouvrirSessionTenant(ctx.app, l.email, l.id);
    }
    acces.set(client, courant);
  }
  return acces;
}
