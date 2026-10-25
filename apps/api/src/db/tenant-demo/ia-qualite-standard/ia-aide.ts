import type { Role } from "@missionpilot/shared";
import type { Auth } from "../../../auth/contexte.js";
import type { DependancesIa } from "../../../ia/orchestrateur.js";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { midi, type MissionLot } from "./commun.js";

/*
 * Aides communes aux modules « ia » et « agents » du seed Tenant démo : refus de toute clé
 * fournisseur (aucun appel réseau), identité (`Auth`) d'un compte du seed, dépendances de
 * l'orchestrateur à horloge fictive, résolution des acteurs d'une mission.
 */

/**
 * Garde-fou : une clé OpenRouter dans la configuration ferait appeler le fournisseur réel dès que
 * l'IA est activée. Le seed s'arrête plutôt que de risquer un appel réseau ou une dépense.
 */
export function exigerSansCle(ctx: ContexteTenantDemo): void {
  if (ctx.config.OPENROUTER_API_KEY?.trim()) {
    throw new Error(
      "OPENROUTER_API_KEY est définie : le seed IA du Tenant démo refuse de tourner avec une clé " +
        "(aucun appel réseau). Retirez la variable pour semer.",
    );
  }
}

/** Identité d'un compte du seed, au format des services internes (sans passer par une route). */
export function authDe(ctx: ContexteTenantDemo, cle: CleCompte): Auth {
  const c = ctx.comptes[cle];
  if (!c) throw new Error(`Compte « ${cle} » introuvable dans le contexte.`);
  return {
    utilisateurId: c.utilisateurId,
    cabinetId: ctx.cabinetId,
    email: c.email,
    nom: c.nom,
    roles: [c.role as Role],
  };
}

/**
 * Dépendances de l'orchestrateur : configuration en mode test (comme l'application montée par le
 * seed : évaluation locale admise, aucun envoi) et, si `quand` (ISO) est fourni, horloge FIXÉE à
 * cet instant pour dater la demande, la génération et la consommation (sinon horloge réelle). Aucune clé : le repli gabarit s'applique.
 */
export function depsIa(ctx: ContexteTenantDemo, quand?: string): DependancesIa {
  const config = { ...ctx.config, NODE_ENV: "test" as const };
  return quand === undefined ? { config } : { config, horloge: () => new Date(quand) };
}

/** Clé du compte qui porte cet identifiant d'utilisateur. */
export function cleDeUtilisateur(
  ctx: ContexteTenantDemo,
  utilisateurId: string | null,
): CleCompte | undefined {
  if (!utilisateurId) return undefined;
  return (Object.entries(ctx.utilisateurs) as [CleCompte, string][]).find(
    ([, id]) => id === utilisateurId,
  )?.[0];
}

export interface ActeursMission {
  chef: CleCompte;
  directeur: CleCompte;
}

/** Chef et directeur d'une mission (clés de compte du seed), lus en base. */
export async function acteursMission(
  ctx: ContexteTenantDemo,
  mission: Pick<MissionLot, "id">,
): Promise<ActeursMission | null> {
  const r = await ctx.proprietaire.query<{ chef_id: string | null; directeur_id: string | null }>(
    "SELECT chef_id, directeur_id FROM missions WHERE id = $1",
    [mission.id],
  );
  const chef = cleDeUtilisateur(ctx, r.rows[0]?.chef_id ?? null);
  const directeur = cleDeUtilisateur(ctx, r.rows[0]?.directeur_id ?? null);
  return chef && directeur ? { chef, directeur } : null;
}

/** Horodatage ISO d'un jour fictif, à l'heure `heure` (UTC) et `minute` minutes. */
export const instant = (jourISO: string, heure: number, minute = 0): string =>
  midi(jourISO, (heure - 12) * 60 + minute);

/** Nom lisible d'un client (raison sociale), pour les textes d'entrée. */
export async function nomClient(ctx: ContexteTenantDemo, clientId: string): Promise<string> {
  const r = await ctx.proprietaire.query<{ raison_sociale: string }>(
    "SELECT raison_sociale FROM clients WHERE id = $1",
    [clientId],
  );
  return r.rows[0]?.raison_sociale ?? "le client";
}
