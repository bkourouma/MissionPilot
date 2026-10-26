import { hacherJeton, nouveauJeton } from "../../../auth/session.js";
import { MOT_DE_PASSE_DEMO_TENANT, emailTenant } from "../constantes.js";
import {
  antidater,
  attendre,
  ouvrirSessionTenant,
  type ContexteTenantDemo,
  type SessionDemo,
} from "../contexte.js";
import { lire } from "./dd-outils.js";

/*
 * Compte investisseur du portail pour le client de la due diligence Mboa Solaire.
 *
 * Constat : les deux comptes investisseurs du socle (`investisseur.client` → SICAFÉ,
 * `investisseur.client.2` → Banque du Sahel Microfinance) ne sont rattachés ni à « Mboa Énergie
 * Solaire » ni à un client de la due diligence, et le rattachement d'un compte du portail à un
 * client n'est modifiable par aucune route. Or une invitation n'est admissible que pour un
 * investisseur du CLIENT du dossier (DD_PORTAIL_COMPTE_NON_ADMISSIBLE). On ajoute donc, sans rien
 * modifier au socle, UN compte investisseur supplémentaire pour Mboa, créé comme le socle crée ses
 * comptes : invitation par la vraie route du portail, jeton connu du seed, acceptation par la
 * route publique. Idempotent (compte retrouvé par son adresse).
 */

export const CLE_INVESTISSEUR_MBOA = "investisseur.mboa";
const NOM_INVESTISSEUR_MBOA = "Aminata Nkoulou";

export interface InvestisseurMboa {
  utilisateurId: string;
  session: SessionDemo;
}

export async function assurerInvestisseurMboa(
  ctx: ContexteTenantDemo,
  associe: SessionDemo,
  clientId: string,
  jourCreation: string,
): Promise<InvestisseurMboa> {
  const email = emailTenant(CLE_INVESTISSEUR_MBOA);
  const existant = await ctx.proprietaire.query("SELECT id FROM utilisateurs WHERE email = $1", [
    email,
  ]);
  let id = (existant.rows[0] as { id: string } | undefined)?.id ?? "";
  if (id === "") {
    const inv = await associe.post("/api/portail/invitations", {
      email,
      client_id: clientId,
      roles: ["client_investisseur"],
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
      payload: { jeton, nom: NOM_INVESTISSEUR_MBOA, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
    });
    attendre(201, acceptation, `acceptation ${email}`);
    id = acceptation.json().utilisateur.id as string;
    await antidater(ctx, "utilisateurs", id, jourCreation);
  }
  return { utilisateurId: id, session: await ouvrirSessionTenant(ctx.app, email, id) };
}

interface PublicationListee {
  id: string;
  titre: string;
  version: number;
  nb_pieces: number;
}

/** Publications que le compte voit sur le portail (le plus récent d'abord). */
export async function publicationsVisibles(session: SessionDemo): Promise<PublicationListee[]> {
  const r = await lire<{ elements: PublicationListee[] }>(
    session,
    "/api/portail/due-diligence/publications",
    "publications du portail",
  );
  return r.elements;
}

/** Contrôle de bout en bout : liste, détail et téléchargement de la première pièce (HTTP 200). */
export async function verifierLecture(
  session: SessionDemo,
  attenduId: string,
  piecesAttendues: number,
): Promise<void> {
  const liste = await publicationsVisibles(session);
  if (liste.length !== 1 || liste[0]?.id !== attenduId) {
    throw new Error(
      `Le portail devrait montrer la seule publication ${attenduId} : ${JSON.stringify(liste)}.`,
    );
  }
  const detail = await lire<{ pieces: { id: string }[] }>(
    session,
    `/api/portail/due-diligence/publications/${attenduId}`,
    "détail de la publication",
  );
  if (detail.pieces.length !== piecesAttendues) {
    throw new Error(`Pièces attendues : ${piecesAttendues}, vues : ${detail.pieces.length}.`);
  }
  const piece = detail.pieces[0];
  if (!piece) throw new Error("Aucune pièce visible sur le portail.");
  const f = await session.get(
    `/api/portail/due-diligence/publications/${attenduId}/pieces/${piece.id}/fichier`,
  );
  attendre(200, f, "téléchargement d'une pièce par l'investisseur");
}
