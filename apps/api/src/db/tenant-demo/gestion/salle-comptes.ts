import { ajouterJours } from "@missionpilot/engines";
import { hacherJeton, nouveauJeton } from "../../../auth/session.js";
import type { CleClient } from "../cles.js";
import { emailTenant, MOT_DE_PASSE_DEMO_TENANT } from "../constantes.js";
import {
  antidater,
  attendre,
  ouvrirSessionTenant,
  type ContexteTenantDemo,
  type SessionDemo,
} from "../contexte.js";
import { CLIENT_DE_MISSION, CLES_MISSIONS, type Casting } from "./casting.js";
import { DEPOSANTS_SUPPLEMENTAIRES, type DeposantDef } from "./donnees-salle.js";
import { accesPortailParClient } from "./portail-acces.js";

/*
 * Déposants du portail pour la salle de mission. Le socle ne dote que deux clients (SICAFÉ et
 * Banque du Sahel) de dirigeants et de contributeurs ; une demande documentaire ne s'envoie que s'il
 * existe au moins un destinataire actif sur le portail du client (409 SALLE_SANS_DESTINATAIRE). Les
 * autres clients du casting reçoivent donc UN compte de portail supplémentaire (donnees-salle.ts),
 * créé comme dans le socle : invitation par la route réelle, jeton connu du script, acceptation par la
 * route publique. Idempotent par adresse e-mail. Aucune connexion réelle, mot de passe de démonstration.
 */

async function utilisateurParEmail(ctx: ContexteTenantDemo, email: string): Promise<string | null> {
  const r = await ctx.proprietaire.query(
    "SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND lower(email) = lower($2)",
    [ctx.cabinetId, email],
  );
  return (r.rows[0]?.id as string | undefined) ?? null;
}

async function creerDeposant(
  ctx: ContexteTenantDemo,
  d: DeposantDef,
  depuis: string,
): Promise<{ id: string; email: string }> {
  const email = emailTenant(d.cle);
  const existant = await utilisateurParEmail(ctx, email);
  if (existant) return { id: existant, email };
  const inv = await ctx.session("associe").post("/api/portail/invitations", {
    email,
    client_id: ctx.client(d.client),
    roles: [d.role],
  });
  attendre(201, inv, `invitation ${email}`);
  const jeton = nouveauJeton();
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    db.query("UPDATE invitations SET jeton_hash = $1 WHERE id = $2 AND acceptee_le IS NULL", [
      hacherJeton(jeton),
      inv.json().id,
    ]),
  );
  const acceptation = await ctx.app.inject({
    method: "POST",
    url: "/api/portail/invitations/accepter",
    payload: { jeton, nom: d.nom, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  attendre(201, acceptation, `acceptation ${email}`);
  const id = acceptation.json().utilisateur.id as string;
  await antidater(ctx, "utilisateurs", id, depuis);
  return { id, email };
}

/** Sessions de portail (dirigeants et contributeurs) par client : comptes existants, sinon un compte ajouté. */
export async function ouvrirDeposants(
  ctx: ContexteTenantDemo,
  casting: Casting,
): Promise<Map<CleClient, SessionDemo[]>> {
  const parClient = new Map<CleClient, SessionDemo[]>();
  for (const [client, a] of await accesPortailParClient(ctx)) {
    const sessions = [a.dirigeant, a.contributeur].filter((s): s is SessionDemo => !!s);
    if (sessions.length > 0) parClient.set(client, sessions);
  }
  for (const d of DEPOSANTS_SUPPLEMENTAIRES) {
    if ((parClient.get(d.client)?.length ?? 0) > 0) continue;
    const cleMission = CLES_MISSIONS.find((k) => CLIENT_DE_MISSION[k] === d.client);
    const debut = cleMission ? casting.missions[cleMission]?.debut : null;
    const depuis = debut ? ajouterJours(debut, -14) : ctx.dateAvant(60);
    const { id, email } = await creerDeposant(ctx, d, depuis);
    parClient.set(d.client, [await ouvrirSessionTenant(ctx.app, email, id)]);
  }
  return parClient;
}
