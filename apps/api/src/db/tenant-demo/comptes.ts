import { hashPassword } from "../../auth/password.js";
import { hacherJeton, nouveauJeton } from "../../auth/session.js";
import {
  antidater,
  attendre,
  ouvrirSessionTenant,
  type CompteTenant,
  type ContexteTenantDemo,
} from "./contexte.js";
import type { CleCompte } from "./cles.js";
import {
  EMAIL_FONDATEUR_TENANT,
  emailTenant,
  MOT_DE_PASSE_DEMO_TENANT,
  NOM_CABINET_TENANT_DEMO,
} from "./constantes.js";
import { COMPTES_CABINET, COMPTES_PORTAIL } from "./donnees-comptes.js";

/*
 * Cabinet « Tenant démo » et ses comptes (cabinet, puis portail client).
 *
 * Tout est idempotent par clé naturelle (adresse e-mail) : un compte déjà présent n'est ni
 * recréé ni dupliqué, seule sa session est rouverte et le contexte rempli. Les comptes sont créés
 * par les vraies routes d'invitation (POST /api/invitations puis /accepter), comme un vrai
 * cabinet : seul le cabinet et son associé fondateur passent par la fonction SQL `creer_cabinet`
 * (il n'existe pas de route de création de cabinet, c'est aussi ce que fait seed-demo.ts).
 *
 * Aucun compte n'a de 2FA : la connexion « un clic » (GET /api/auth/demo) les propose tous.
 */

/**
 * Cabinet « Tenant démo » s'il existe (cabinet du compte fondateur). Refus net si l'adresse
 * fondatrice appartient à un cabinet qui n'a pas ce nom : rien n'est écrit.
 */
export async function trouverCabinetTenant(
  ctx: Pick<ContexteTenantDemo, "database" | "proprietaire">,
): Promise<{ id: string; actif: boolean } | null> {
  const ancre = await ctx.database.withoutTenant(async (c) => {
    const r = await c.query("SELECT cabinet_id FROM trouver_connexion($1)", [
      EMAIL_FONDATEUR_TENANT,
    ]);
    return (r.rows[0]?.cabinet_id as string | undefined) ?? null;
  });
  if (!ancre) return null;
  const r = await ctx.proprietaire.query("SELECT nom, actif FROM cabinets WHERE id = $1", [ancre]);
  if (r.rows[0]?.nom !== NOM_CABINET_TENANT_DEMO) {
    throw new Error(
      `L'adresse ${EMAIL_FONDATEUR_TENANT} appartient à un cabinet qui n'est pas « ` +
        `${NOM_CABINET_TENANT_DEMO} » : refus, rien n'a été écrit (aucun drapeau de démonstration).`,
    );
  }
  return { id: ancre, actif: r.rows[0].actif as boolean };
}

/** Pose `est_demo` sur CE cabinet et sur aucun autre (rôle propriétaire, réservé par déclencheur). */
export async function marquerCabinetTenant(
  ctx: Pick<ContexteTenantDemo, "proprietaire" | "cabinetId">,
): Promise<void> {
  const r = await ctx.proprietaire.query(
    "UPDATE cabinets SET est_demo = true WHERE id = $1 AND nom = $2",
    [ctx.cabinetId, NOM_CABINET_TENANT_DEMO],
  );
  if (r.rowCount !== 1) throw new Error("Le cabinet « Tenant démo » n'a pas pu être marqué.");
}

/**
 * Trouve ou crée le cabinet et son associé fondateur ; renseigne `ctx.cabinetId`. Renvoie vrai si
 * le cabinet vient d'être créé. Le cabinet est antidaté au début de l'activité.
 */
export async function assurerCabinet(ctx: ContexteTenantDemo): Promise<boolean> {
  const existant = await trouverCabinetTenant(ctx);
  if (existant) {
    ctx.cabinetId = existant.id;
    if (!existant.actif) ctx.journal("Attention : le cabinet Tenant démo est désactivé.");
    return false;
  }
  const fondateur = COMPTES_CABINET[0];
  if (!fondateur) throw new Error("Aucun compte fondateur défini.");
  const hash = await hashPassword(MOT_DE_PASSE_DEMO_TENANT);
  ctx.cabinetId = await ctx.database.withoutTenant(async (c) => {
    const r = await c.query("SELECT creer_cabinet($1, 'CI', $2, $3, $4) AS id", [
      NOM_CABINET_TENANT_DEMO,
      EMAIL_FONDATEUR_TENANT,
      fondateur.nom,
      hash,
    ]);
    return r.rows[0].id as string;
  });
  await antidater(ctx, "cabinets", ctx.cabinetId, fondateur.depuis);
  return true;
}

/** Identifiant d'un utilisateur du cabinet par adresse, ou null. */
async function utilisateurParEmail(ctx: ContexteTenantDemo, email: string): Promise<string | null> {
  return ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const r = await db.query("SELECT id FROM utilisateurs WHERE lower(email) = lower($1)", [email]);
    return (r.rows[0]?.id as string | undefined) ?? null;
  });
}

/**
 * Invitation par la vraie route, jeton connu du script (la route ne le renvoie pas, il n'existe
 * que dans l'e-mail), puis acceptation par la vraie route publique. Renvoie l'identifiant du
 * nouvel utilisateur.
 */
async function inviterEtAccepter(
  ctx: ContexteTenantDemo,
  urlInvitation: string,
  urlAcceptation: string,
  corps: Record<string, unknown>,
  email: string,
  nom: string,
): Promise<string> {
  const inviteur = ctx.session("associe");
  const inv = await inviteur.post(urlInvitation, corps);
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
    url: urlAcceptation,
    payload: { jeton, nom, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  attendre(201, acceptation, `acceptation ${email}`);
  return acceptation.json().utilisateur.id as string;
}

async function enregistrer(
  ctx: ContexteTenantDemo,
  compte: CompteTenant,
  depuis: string,
): Promise<void> {
  ctx.comptes[compte.cle] = compte;
  ctx.utilisateurs[compte.cle] = compte.utilisateurId;
  ctx.sessions[compte.cle] = await ouvrirSessionTenant(ctx.app, compte.email, compte.utilisateurId);
  await antidater(ctx, "utilisateurs", compte.utilisateurId, depuis);
}

/**
 * Comptes du CABINET (au moins 2 par rôle de `ROLES`, voir donnees-comptes.ts) : le fondateur
 * (déjà créé avec le cabinet) ouvre sa session, puis invite tous les autres. Remplit
 * `ctx.comptes`, `ctx.utilisateurs` et `ctx.sessions`. Idempotent.
 */
export async function assurerComptesCabinet(ctx: ContexteTenantDemo): Promise<void> {
  for (const def of COMPTES_CABINET) {
    const email = emailTenant(def.cle);
    let id = await utilisateurParEmail(ctx, email);
    if (!id) {
      if (def.cle === "associe") throw new Error("Le compte fondateur est introuvable.");
      id = await inviterEtAccepter(
        ctx,
        "/api/invitations",
        "/api/invitations/accepter",
        { email, roles: [def.role] },
        email,
        def.nom,
      );
    }
    // Le fondateur doit pouvoir inviter les suivants : sa session est ouverte en premier.
    await enregistrer(
      ctx,
      { cle: def.cle, email, nom: def.nom, role: def.role, utilisateurId: id },
      def.depuis,
    );
  }
}

/**
 * Comptes du PORTAIL client (3 rôles de `ROLES_CLIENT`, 2 comptes chacun, rattachés aux clients
 * de `donnees-comptes.ts`). Les clients doivent déjà exister (`ctx.clients`). Invitation puis
 * acceptation par les vraies routes du portail. Idempotent.
 */
export async function assurerComptesPortail(ctx: ContexteTenantDemo): Promise<void> {
  for (const def of COMPTES_PORTAIL) {
    const email = emailTenant(def.cle);
    let id = await utilisateurParEmail(ctx, email);
    if (!id) {
      id = await inviterEtAccepter(
        ctx,
        "/api/portail/invitations",
        "/api/portail/invitations/accepter",
        { email, client_id: ctx.client(def.client), roles: [def.role] },
        email,
        def.nom,
      );
    }
    await enregistrer(
      ctx,
      { cle: def.cle as CleCompte, email, nom: def.nom, role: def.role, utilisateurId: id },
      def.depuis,
    );
  }
}
