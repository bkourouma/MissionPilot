import { hacherJeton, nouveauJeton } from "../../../auth/session.js";
import { codeDemo2fa, activer2faDemo } from "../../seed-demo-2fa.js";
import { MOT_DE_PASSE_DEMO_TENANT, emailTenant } from "../constantes.js";
import { corps, type ContexteCanaux } from "./canaux-contexte.js";
import { sql } from "./outils.js";

/*
 * Signataires AVEC double authentification, pour la demande de signature menée à son terme.
 *
 * Signer un document exige un second facteur ACTIF (409 `TFA_INACTIVE` sinon) et aucun compte du
 * socle n'en a (connexion « un clic » sans code). Plutôt que de contourner la règle (appeler le
 * service de signature sans reconfirmation, ou activer la 2FA d'un compte de démonstration du
 * socle, ce qui changerait sa connexion), le module crée DEUX comptes dédiés, comme
 * `seed-demo-2fa.ts` le fait pour le cabinet de Lagune : un associé (partie cabinet) et un
 * dirigeant du client (partie client). Ils sont créés par les vraies routes d'invitation, leur 2FA
 * est activée avec le secret de démonstration CONSTANT de `seed-demo-2fa.ts` (SECRET_2FA_DEMO_BASE32,
 * code du moment : `pnpm --filter @missionpilot/api db:code-2fa-demo`) ; mot de passe commun du
 * cabinet. Ils ne servent qu'à signer ; la connexion « un clic » les refuse (elle ne contourne
 * jamais la 2FA). Désactivables par un associé (route des utilisateurs) sans effet sur le reste.
 */

export const SIGNATAIRE_CABINET_2FA = {
  email: emailTenant("signataire.associe.2fa"),
  nom: "Awa Coulibaly (signataire 2FA, démonstration)",
  depuis: "2026-03-02",
} as const;

export const SIGNATAIRE_CLIENT_2FA = {
  email: emailTenant("signataire.dirigeant.sicafe.2fa"),
  nom: "Kouadio Yao (signataire 2FA, démonstration)",
  depuis: "2026-03-02",
} as const;

export interface Signataire2fa {
  email: string;
  utilisateurId: string;
}

async function utilisateurParEmail(cc: ContexteCanaux, email: string): Promise<string | null> {
  const r = await sql<{ id: string }>(
    cc.ctx,
    "SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND lower(email) = lower($2)",
    [cc.ctx.cabinetId, email],
  );
  return r[0]?.id ?? null;
}

/** Invitation par la vraie route, jeton connu du script, puis acceptation par la route publique. */
async function inviterEtAccepter(
  cc: ContexteCanaux,
  urlInvitation: string,
  urlAcceptation: string,
  invitation: Record<string, unknown>,
  nom: string,
): Promise<string> {
  const inv = corps<{ id: string }>(
    201,
    await cc.appel("associe", "POST", urlInvitation, invitation),
    `invitation ${String(invitation["email"])}`,
  );
  const jeton = nouveauJeton();
  await cc.ctx.database.withTenant(cc.ctx.cabinetId, (db) =>
    db.query("UPDATE invitations SET jeton_hash = $1 WHERE id = $2 AND acceptee_le IS NULL", [
      hacherJeton(jeton),
      inv.id,
    ]),
  );
  const acc = await cc.app.inject({
    method: "POST",
    url: urlAcceptation,
    payload: { jeton, nom, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  return corps<{ utilisateur: { id: string } }>(201, acc, "acceptation d'invitation").utilisateur
    .id;
}

async function assurerCompte(
  cc: ContexteCanaux,
  def: { email: string; nom: string; depuis: string },
  creer: () => Promise<string>,
): Promise<Signataire2fa> {
  let id = await utilisateurParEmail(cc, def.email);
  if (!id) {
    id = await creer();
    await cc.ctx.proprietaire.query(
      "UPDATE utilisateurs SET cree_le = $1::timestamptz WHERE id = $2",
      [`${def.depuis}T09:00:00Z`, id],
    );
  }
  return { email: def.email, utilisateurId: id };
}

/** Comptes de signature : créés sans 2FA, session ouverte, PUIS 2FA activée (une seule fois). */
export async function assurerSignataires2fa(
  cc: ContexteCanaux,
  clientSicafeId: string,
): Promise<{ cabinet: Signataire2fa; client: Signataire2fa }> {
  const cabinet = await assurerCompte(cc, SIGNATAIRE_CABINET_2FA, () =>
    inviterEtAccepter(
      cc,
      "/api/invitations",
      "/api/invitations/accepter",
      { email: SIGNATAIRE_CABINET_2FA.email, roles: ["associe"] },
      SIGNATAIRE_CABINET_2FA.nom,
    ),
  );
  const client = await assurerCompte(cc, SIGNATAIRE_CLIENT_2FA, () =>
    inviterEtAccepter(
      cc,
      "/api/portail/invitations",
      "/api/portail/invitations/accepter",
      {
        email: SIGNATAIRE_CLIENT_2FA.email,
        client_id: clientSicafeId,
        roles: ["client_dirigeant"],
      },
      SIGNATAIRE_CLIENT_2FA.nom,
    ),
  );
  return { cabinet, client };
}

/** Active la 2FA de démonstration d'un compte (sans effet si elle est déjà active). */
export async function activer2fa(cc: ContexteCanaux, utilisateurId: string): Promise<void> {
  await cc.ctx.database.withTenant(cc.ctx.cabinetId, (db) =>
    activer2faDemo(db, cc.trousseau, cc.ctx.cabinetId, utilisateurId),
  );
}

/** Cookie d'une session ouverte par la route de connexion (en deux temps si la 2FA est active). */
export async function ouvrirSession2fa(cc: ContexteCanaux, email: string): Promise<string> {
  let r = await cc.app.inject({
    method: "POST",
    url: "/api/auth/connexion",
    payload: { email, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  const premier = corps<{ etape: string; defi?: string }>(200, r, `connexion ${email}`);
  if (premier.etape === "2fa_requise") {
    r = await cc.app.inject({
      method: "POST",
      url: "/api/auth/connexion/2fa",
      payload: { defi: premier.defi, code: await codeSuivant(email) },
    });
    corps(200, r, `connexion 2FA ${email}`);
  }
  const c = r.cookies[0];
  if (!c) throw new Error(`Pas de cookie de session pour ${email}`);
  return `${c.name}=${c.value}`;
}

const PAS_MS = 30_000;
const derniersPas = new Map<string, number>();

/**
 * Code TOTP du moment pour un nouveau pas : un code ne sert qu'une fois par pas de 30 s et par
 * utilisateur (anti-rejeu), le module attend donc le pas suivant si ce compte a déjà servi.
 */
export async function codeSuivant(email: string): Promise<string> {
  const pas = Math.floor(Date.now() / PAS_MS);
  if (pas <= (derniersPas.get(email) ?? -1)) {
    await new Promise((fin) => setTimeout(fin, (pas + 1) * PAS_MS - Date.now() + 500));
  }
  derniersPas.set(email, Math.floor(Date.now() / PAS_MS));
  return codeDemo2fa();
}
