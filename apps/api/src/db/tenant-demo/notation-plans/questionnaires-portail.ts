import { hacherJeton, nouveauJeton } from "../../../auth/session.js";
import type { CleClient, CleCompte } from "../cles.js";
import { MOT_DE_PASSE_DEMO_TENANT } from "../constantes.js";
import {
  attendre,
  ouvrirSessionTenant,
  type ContexteTenantDemo,
  type SessionDemo,
} from "../contexte.js";
import { COMPTES_PORTAIL } from "../donnees-comptes.js";
import { lire } from "./outils.js";

/*
 * Répondants du portail client des questionnaires. Les comptes du socle (SICAFÉ et Banque du
 * Sahel) sont réutilisés ; les contacts des clients qui n'avaient pas de compte (Sahel Coton,
 * Baobab Assurances) et un troisième répondant pour Sahel Coton reçoivent un compte de portail
 * par les VRAIES routes d'invitation puis d'acceptation (idempotent : clé naturelle = e-mail).
 * Les clés sont locales à ce module (`CleCompte` du contexte n'est pas étendue).
 */

export type CleRepondant =
  | "sicafe.dg"
  | "sicafe.daf"
  | "banque.dg"
  | "banque.controle"
  | "banque.risques"
  | "coton.dg"
  | "coton.daf"
  | "coton.production"
  | "baobab.dg"
  | "baobab.technique"
  | "baobab.rh";

interface DefRepondant {
  /** Compte du socle réutilisé tel quel. */
  existant?: CleCompte;
  client: CleClient;
  email?: string;
  nom?: string;
  fonction?: string;
  role?: "client_dirigeant" | "client_contributeur";
  /** Date d'ouverture du compte (avant le début de la première mission du client). */
  depuis?: string;
}

const DEFS: Record<CleRepondant, DefRepondant> = {
  "sicafe.dg": { existant: "dirigeant.client", client: "sicafe" },
  "sicafe.daf": { existant: "contributeur.client", client: "sicafe" },
  "banque.dg": { existant: "dirigeant.client.2", client: "banque-sahel" },
  "banque.controle": { existant: "contributeur.client.2", client: "banque-sahel" },
  "banque.risques": {
    client: "banque-sahel",
    email: "f.zongo@banque-sahel.tenant-demo.test",
    nom: "Fatimata Zongo",
    fonction: "Directrice des risques et de la conformité",
    role: "client_contributeur",
    depuis: "2026-08-17",
  },
  "coton.dg": {
    client: "sahel-coton",
    email: "s.diarra@sahel-coton.tenant-demo.test",
    nom: "Seydou Diarra",
    fonction: "Directeur général",
    role: "client_dirigeant",
    depuis: "2025-01-27",
  },
  "coton.daf": {
    client: "sahel-coton",
    email: "k.coulibaly@sahel-coton.tenant-demo.test",
    nom: "Kadiatou Coulibaly",
    fonction: "Directrice financière",
    role: "client_contributeur",
    depuis: "2025-01-27",
  },
  "coton.production": {
    client: "sahel-coton",
    email: "f.sissoko@sahel-coton.tenant-demo.test",
    nom: "Fanta Sissoko",
    fonction: "Responsable production et qualité",
    role: "client_contributeur",
    depuis: "2025-01-29",
  },
  "baobab.dg": {
    client: "baobab-assurances",
    email: "a.sarr@baobab-assurances.tenant-demo.test",
    nom: "Aminata Sarr",
    fonction: "Directrice générale",
    role: "client_dirigeant",
    depuis: "2026-06-01",
  },
  "baobab.technique": {
    client: "baobab-assurances",
    email: "m.gueye@baobab-assurances.tenant-demo.test",
    nom: "Mor Gueye",
    fonction: "Directeur technique",
    role: "client_contributeur",
    depuis: "2026-06-01",
  },
  "baobab.rh": {
    client: "baobab-assurances",
    email: "n.ba@baobab-assurances.tenant-demo.test",
    nom: "Nogaye Ba",
    fonction: "Directrice des ressources humaines",
    role: "client_contributeur",
    depuis: "2026-06-03",
  },
};

export interface Repondant {
  cle: CleRepondant;
  utilisateurId: string;
  fonction: string;
  session: SessionDemo;
}

/** Invitation par la vraie route, jeton connu du seed (il n'existe que dans l'e-mail), acceptation. */
async function inviterEtAccepter(
  ctx: ContexteTenantDemo,
  def: DefRepondant,
  email: string,
  nom: string,
): Promise<string> {
  const inv = await ctx.session("associe").post("/api/portail/invitations", {
    email,
    client_id: ctx.client(def.client),
    roles: [def.role],
  });
  attendre(201, inv, `invitation portail ${email}`);
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
    payload: { jeton, nom, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  attendre(201, acceptation, `acceptation portail ${email}`);
  return acceptation.json().utilisateur.id as string;
}

/** Répondants du portail (créés au besoin), par clé. */
export async function assurerRepondants(
  ctx: ContexteTenantDemo,
): Promise<Record<CleRepondant, Repondant>> {
  const resultat = {} as Record<CleRepondant, Repondant>;
  for (const [cle, def] of Object.entries(DEFS) as [CleRepondant, DefRepondant][]) {
    if (def.existant) {
      const compte = COMPTES_PORTAIL.find((c) => c.cle === def.existant);
      resultat[cle] = {
        cle,
        utilisateurId: ctx.utilisateurs[def.existant] as string,
        fonction: compte?.fonction ?? "",
        session: ctx.session(def.existant),
      };
      continue;
    }
    const email = def.email as string;
    const nom = def.nom as string;
    const lignes = await lire<{ id: string }>(
      ctx,
      "SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND lower(email) = lower($2)",
      [ctx.cabinetId, email],
    );
    let id = lignes[0]?.id;
    if (!id) {
      id = await inviterEtAccepter(ctx, def, email, nom);
      // Compte ouvert avant la première mission du client (les routes créent tout « maintenant »).
      await ctx.proprietaire.query(
        "UPDATE utilisateurs SET cree_le = $1::timestamptz WHERE id = $2",
        [`${def.depuis}T12:00:00Z`, id],
      );
    }
    resultat[cle] = {
      cle,
      utilisateurId: id,
      fonction: def.fonction as string,
      session: await ouvrirSessionTenant(ctx.app, email, id),
    };
  }
  return resultat;
}
