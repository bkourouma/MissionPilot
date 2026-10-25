import { aPermission, type Role } from "@missionpilot/shared";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { lire } from "./outils.js";
import type { Responsable } from "./kpi-types.js";

/*
 * Acteurs d'une mission pour l'étape « kpi » : qui dirige, qui conduit, qui est dans l'équipe,
 * retrouvés à l'exécution (le casting est posé par la phase « missions »). Les droits réels
 * s'appliquent : gérer les KPI exige le directeur ou le chef de la mission ; saisir une mesure
 * exige aussi d'être membre de l'équipe ou propriétaire du KPI.
 */

export interface ActeursMission {
  chef: CleCompte;
  directeur: CleCompte;
  /** Membres de l'équipe qui peuvent saisir des mesures (consultants), dans l'ordre des clés. */
  membres: CleCompte[];
  /** Qui saisit les mesures côté cabinet : chef, directeur puis membres. */
  saisie: CleCompte[];
}

function cleDe(ctx: ContexteTenantDemo, utilisateurId: string | null): CleCompte | null {
  if (!utilisateurId) return null;
  const e = Object.entries(ctx.utilisateurs).find(([, id]) => id === utilisateurId);
  return e ? (e[0] as CleCompte) : null;
}

export async function acteursMission(
  ctx: ContexteTenantDemo,
  missionId: string,
): Promise<ActeursMission> {
  const [m] = await lire<{ directeur_id: string | null; chef_id: string | null }>(
    ctx,
    "SELECT directeur_id, chef_id FROM missions WHERE id = $1",
    [missionId],
  );
  const chef = cleDe(ctx, m?.chef_id ?? null) ?? "chef.mission";
  const directeur = cleDe(ctx, m?.directeur_id ?? null) ?? "directeur.mission";
  const equipe = await lire<{ utilisateur_id: string; roles: Role[] }>(
    ctx,
    `SELECT e.utilisateur_id, u.roles FROM mission_equipe e
       JOIN utilisateurs u ON u.id = e.utilisateur_id
      WHERE e.mission_id = $1 AND u.actif ORDER BY u.email`,
    [missionId],
  );
  const membres = equipe
    .filter((e) => aPermission(e.roles, "kpi.saisir"))
    .map((e) => cleDe(ctx, e.utilisateur_id))
    .filter((c): c is CleCompte => c !== null && c !== chef && c !== directeur);
  return { chef, directeur, membres, saisie: [chef, directeur, ...membres] };
}

/** Clé du compte pour un rôle de la mission ; `rang` répartit les « membres » de façon stable. */
export function cleResponsable(a: ActeursMission, r: Responsable, rang = 0): CleCompte {
  if (r === "chef") return a.chef;
  if (r === "directeur") return a.directeur;
  return a.membres.length > 0 ? (a.membres[rang % a.membres.length] as CleCompte) : a.chef;
}

export const sessionDe = (ctx: ContexteTenantDemo, cle: CleCompte): SessionDemo => ctx.session(cle);

/** Auteur d'une saisie côté cabinet : stable (pas de hasard), réparti entre chef, directeur, équipe. */
export function auteurSaisie(a: ActeursMission, indiceKpi: number, mois: number): CleCompte {
  const tirage = (indiceKpi * 5 + mois * 3) % 10;
  if (a.membres.length === 0) return tirage < 6 ? a.chef : a.directeur;
  if (tirage < 3) return a.chef;
  if (tirage < 4) return a.directeur;
  return a.membres[(indiceKpi + mois) % a.membres.length] as CleCompte;
}

export interface ComptesPortail {
  dirigeant?: CleCompte;
  contributeur?: CleCompte;
}

/** Comptes du portail (dirigeant, contributeur) rattachés au client, s'il en existe. */
export async function comptesPortail(
  ctx: ContexteTenantDemo,
  clientId: string,
): Promise<ComptesPortail> {
  const lignes = await lire<{ utilisateur_id: string }>(
    ctx,
    "SELECT utilisateur_id FROM utilisateurs_portail WHERE client_id = $1 AND statut = 'actif'",
    [clientId],
  );
  const cles = lignes
    .map((l) => cleDe(ctx, l.utilisateur_id))
    .filter((c): c is CleCompte => c !== null)
    .sort();
  const comptes: ComptesPortail = {};
  for (const c of cles) {
    if (c.startsWith("dirigeant.client") && !comptes.dirigeant) comptes.dirigeant = c;
    if (c.startsWith("contributeur.client") && !comptes.contributeur) comptes.contributeur = c;
  }
  return comptes;
}
