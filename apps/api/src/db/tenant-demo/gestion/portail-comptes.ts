import { ajouterJours } from "@missionpilot/engines";
import { hacherJeton, nouveauJeton } from "../../../auth/session.js";
import { MOT_DE_PASSE_DEMO_TENANT, emailTenant } from "../constantes.js";
import {
  antidater,
  ouvrirSessionTenant,
  type ContexteTenantDemo,
  type SessionDemo,
} from "../contexte.js";
import {
  ancrer,
  encadrer,
  heureISO,
  sansDeclencheurs,
  supprimerAvec,
} from "./collaboration-outils.js";
import { COMPTES_PORTAIL_AJOUTES, type DefComptePortail } from "./portail-donnees.js";
import { ok } from "./outils.js";

/*
 * COMPTES DU PORTAIL CLIENT ajoutés par la phase `gestion` : invitation par un associé
 * (`POST /api/portail/invitations`), acceptation par la route PUBLIQUE d'acceptation (le jeton
 * n'existe que dans l'e-mail : comme le socle, on le remplace par un jeton connu du script avant
 * d'accepter), connexion réelle du compte. Invitations en attente, expirée (jamais acceptée) et
 * révoquée (`DELETE /api/portail/invitations/:id`) pour le cycle de vie complet. Aucun envoi réel.
 *
 * Dates : invitation à `jour`, acceptation le lendemain ; création du compte, rattachement et
 * invitation sont remontés par SQL du propriétaire. Idempotent : repéré par l'adresse e-mail.
 */

export interface ComptePortailPret {
  def: DefComptePortail;
  utilisateurId: string;
  /** Jour d'activation du compte. */
  depuis: string;
  session: SessionDemo;
}

async function invitationExiste(ctx: ContexteTenantDemo, email: string): Promise<boolean> {
  const r = await ctx.proprietaire.query(
    `SELECT 1 FROM invitations WHERE cabinet_id = $1 AND lower(email) = lower($2)
     UNION ALL SELECT 1 FROM utilisateurs WHERE cabinet_id = $1 AND lower(email) = lower($2)`,
    [ctx.cabinetId, email],
  );
  return (r.rowCount ?? 0) > 0;
}

async function creer(ctx: ContexteTenantDemo, def: DefComptePortail): Promise<void> {
  const email = emailTenant(def.cle);
  const clientId = ctx.client(def.client);
  const associe = ctx.session("associe");
  const jeton = nouveauJeton();
  const sortie: { utilisateurId: string | null } = { utilisateurId: null };
  let invitationId = "";
  const { fenetre } = await encadrer(ctx, async () => {
    const inv = await associe.post("/api/portail/invitations", {
      email,
      client_id: clientId,
      roles: [def.role],
    });
    ok(201, inv, `invitation ${email}`);
    invitationId = inv.json().id as string;
    if (def.issue === "revoquee") {
      ok(
        200,
        await supprimerAvec(ctx, associe, `/api/portail/invitations/${invitationId}`),
        `révocation ${email}`,
      );
      return;
    }
    if (def.issue !== "accepte") return;
    await ctx.database.withTenant(ctx.cabinetId, (db) =>
      db.query("UPDATE invitations SET jeton_hash = $1 WHERE id = $2 AND acceptee_le IS NULL", [
        hacherJeton(jeton),
        invitationId,
      ]),
    );
    const a = await ctx.app.inject({
      method: "POST",
      url: "/api/portail/invitations/accepter",
      payload: { jeton, nom: def.nom, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
    });
    ok(201, a, `acceptation ${email}`);
    sortie.utilisateurId = a.json().utilisateur.id as string;
  });
  const invite = heureISO(def.jour, 9, 40);
  await ancrer(ctx, fenetre, invite, def.jour < ajouterJours(ctx.aujourdhui, -3));
  const active = ajouterJours(def.jour, 1);
  await sansDeclencheurs(ctx, async (c) => {
    const cree = def.issue === "accepte" ? heureISO(active, 10, 5) : invite;
    // Délai de 7 jours de la route ; révoquée : expirée le surlendemain ; expirée : sans réponse.
    const expire =
      def.issue === "revoquee"
        ? heureISO(ajouterJours(def.jour, 2), 15, 0)
        : heureISO(ajouterJours(def.jour, 7), 9, 40);
    await c.query(
      `UPDATE invitations
          SET cree_le = $2::timestamptz, expire_le = $3::timestamptz,
              acceptee_le = CASE WHEN acceptee_le IS NULL THEN NULL ELSE $4::timestamptz END
        WHERE id = $1`,
      [invitationId, invite, expire, cree],
    );
  });
  const utilisateurId = sortie.utilisateurId;
  if (utilisateurId) {
    await antidater(ctx, "utilisateurs", utilisateurId, active);
    await sansDeclencheurs(ctx, async (c) => {
      await c.query(
        `UPDATE utilisateurs_portail SET cree_le = $2::timestamptz, modifie_le = $2::timestamptz
          WHERE utilisateur_id = $1`,
        [utilisateurId, heureISO(active, 10, 5)],
      );
    });
  }
}

/** Crée les comptes manquants, ouvre leurs sessions et renvoie les comptes ACTIFS prêts à servir. */
export async function assurerComptesAjoutes(ctx: ContexteTenantDemo): Promise<ComptePortailPret[]> {
  const prets: ComptePortailPret[] = [];
  for (const def of COMPTES_PORTAIL_AJOUTES) {
    const email = emailTenant(def.cle);
    if (!(await invitationExiste(ctx, email))) await creer(ctx, def);
    if (def.issue !== "accepte") continue;
    const u = await ctx.proprietaire.query(
      "SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND lower(email) = lower($2)",
      [ctx.cabinetId, email],
    );
    const id = u.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`Compte du portail « ${email} » introuvable après création.`);
    prets.push({
      def,
      utilisateurId: id,
      depuis: ajouterJours(def.jour, 1),
      session: await ouvrirSessionTenant(ctx.app, email, id),
    });
  }
  ctx.journal(
    `  portail : ${prets.length} comptes ajoutés actifs, ${COMPTES_PORTAIL_AJOUTES.length - prets.length} invitations hors acceptation.`,
  );
  return prets;
}
