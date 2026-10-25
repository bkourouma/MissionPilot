import { hacherJeton, nouveauJeton } from "../../../auth/session.js";
import type { CleClient } from "../cles.js";
import { MOT_DE_PASSE_DEMO_TENANT } from "../constantes.js";
import {
  antidater,
  attendre,
  ouvrirSessionTenant,
  type ContexteTenantDemo,
  type SessionDemo,
} from "../contexte.js";
import { lire } from "./outils.js";

/*
 * Dirigeants du portail client invités aux ateliers (permission `portail.ateliers.participer` :
 * rôle client_dirigeant SEUL). Le socle ne fournit qu'un dirigeant par client (SICAFÉ,
 * Banque du Sahel) ; Baobab Assurances a le sien depuis l'étape « questionnaires ». Pour atteindre le
 * seuil de 3 contributeurs de l'anonymat, deux dirigeants de plus sont créés pour SICAFÉ et pour
 * Baobab par les VRAIES routes d'invitation puis d'acceptation (associé invitant ; jeton connu du
 * seed seulement, comme questionnaires-portail.ts). Idempotent : clé naturelle = e-mail.
 * Adresses en `@<client>.tenant-demo.test`, mot de passe de démonstration du cabinet.
 */

export type CleDirigeant =
  | "sicafe.dg"
  | "sicafe.dga"
  | "sicafe.operations"
  | "baobab.dg"
  | "baobab.dga"
  | "baobab.commercial";

interface DefDirigeant {
  client: CleClient;
  email: string;
  nom: string;
  /** Date d'ouverture du compte (avant le début de la mission du client). */
  depuis: string;
}

const DEFS: Record<CleDirigeant, DefDirigeant> = {
  "sicafe.dg": {
    client: "sicafe",
    email: "dirigeant.client@tenant-demo.test",
    nom: "Désiré Konan",
    depuis: "2025-01-20",
  },
  "sicafe.dga": {
    client: "sicafe",
    email: "k.brou@sicafe.tenant-demo.test",
    nom: "Koffi Brou",
    depuis: "2025-01-27",
  },
  "sicafe.operations": {
    client: "sicafe",
    email: "a.coulibaly@sicafe.tenant-demo.test",
    nom: "Awa Coulibaly",
    depuis: "2025-01-27",
  },
  "baobab.dg": {
    client: "baobab-assurances",
    email: "a.sarr@baobab-assurances.tenant-demo.test",
    nom: "Aminata Sarr",
    depuis: "2026-06-01",
  },
  "baobab.dga": {
    client: "baobab-assurances",
    email: "m.fall@baobab-assurances.tenant-demo.test",
    nom: "Mamadou Fall",
    depuis: "2026-06-03",
  },
  "baobab.commercial": {
    client: "baobab-assurances",
    email: "c.ndiaye@baobab-assurances.tenant-demo.test",
    nom: "Coumba Ndiaye",
    depuis: "2026-06-03",
  },
};

export interface Dirigeant {
  cle: CleDirigeant;
  email: string;
  utilisateurId: string;
  session: SessionDemo;
}

/** Invitation par la vraie route, jeton remplacé par un jeton connu (il n'existe que par e-mail), acceptation. */
async function inviterEtAccepter(ctx: ContexteTenantDemo, def: DefDirigeant): Promise<string> {
  // Invitation déjà en attente (reprise après un échec) : réutilisée, jamais doublée.
  const attente = await lire<{ id: string }>(
    ctx,
    "SELECT id FROM invitations WHERE cabinet_id = $1 AND lower(email) = lower($2) AND acceptee_le IS NULL",
    [ctx.cabinetId, def.email],
  );
  let invitationId = attente[0]?.id;
  if (!invitationId) {
    const inv = await ctx.session("associe").post("/api/portail/invitations", {
      email: def.email,
      client_id: ctx.client(def.client),
      roles: ["client_dirigeant"],
    });
    attendre(201, inv, `invitation portail ${def.email}`);
    invitationId = inv.json().id as string;
  }
  const jeton = nouveauJeton();
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    db.query("UPDATE invitations SET jeton_hash = $1 WHERE id = $2 AND acceptee_le IS NULL", [
      hacherJeton(jeton),
      invitationId,
    ]),
  );
  const acceptation = await ctx.app.inject({
    method: "POST",
    url: "/api/portail/invitations/accepter",
    payload: { jeton, nom: def.nom, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  attendre(201, acceptation, `acceptation portail ${def.email}`);
  return acceptation.json().utilisateur.id as string;
}

/** Les dirigeants demandés (créés au besoin), avec une session de portail ouverte. */
export async function assurerDirigeants(
  ctx: ContexteTenantDemo,
  cles: readonly CleDirigeant[],
): Promise<Record<CleDirigeant, Dirigeant>> {
  const resultat = {} as Record<CleDirigeant, Dirigeant>;
  for (const cle of cles) {
    const def = DEFS[cle];
    const lignes = await lire<{ id: string }>(
      ctx,
      "SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND lower(email) = lower($2)",
      [ctx.cabinetId, def.email],
    );
    let id = lignes[0]?.id;
    if (!id) {
      id = await inviterEtAccepter(ctx, def);
      await antidater(ctx, "utilisateurs", id, def.depuis);
      ctx.journal(`      compte de portail créé : ${def.email} (${def.nom})`);
    }
    resultat[cle] = {
      cle,
      email: def.email,
      utilisateurId: id,
      session: await ouvrirSessionTenant(ctx.app, def.email, id),
    };
  }
  return resultat;
}
