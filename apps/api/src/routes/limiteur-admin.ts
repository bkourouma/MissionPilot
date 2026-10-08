import type { FastifyPluginAsync } from "fastify";
import { confirmationIdentiteSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { serviceIdentite } from "../auth/confirmer-identite.js";
import { exiger } from "../auth/contexte.js";
import { creerLimiteur } from "../auth/limiteur.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";

/** E-mail d'un utilisateur du cabinet courant (RLS), ou null. */
async function emailUtilisateur(db: Db, id: string, verrouiller = false): Promise<string | null> {
  const r = await db.query(
    `SELECT email FROM utilisateurs WHERE id = $1 ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  return (r.rows[0]?.email as string | undefined) ?? null;
}

/**
 * Déblocage de la connexion d'un utilisateur (compromis accepté du limiteur
 * persistant, auth/limiteur.ts) : un tiers qui connaît seulement l'e-mail peut
 * épuiser les 10 essais de connexion de son titulaire. Un gestionnaire du cabinet
 * (« cabinet.gerer ») efface alors le compteur `connexion` de cet utilisateur.
 *
 * - Utilisateur d'un autre cabinet ou inexistant : 404, avant toute reconfirmation
 *   (aucun code consommé en vain).
 * - Reconfirmation de l'auteur (`mot_de_passe`, et `code` ou `code_secours` si sa
 *   2FA est active ; mot de passe seul sinon, noté au journal),
 *   auth/confirmer-identite.ts.
 * - Seul l'espace `connexion` est effacé : le blocage des codes de second facteur
 *   (`facteur`) suppose le mot de passe et protège la 2FA d'une attaque en cours.
 * - Journal d'audit dans la même transaction : `deblocage_connexion`, avec l'état
 *   bloqué ou non et le facteur de reconfirmation.
 */
export const routesLimiteurAdmin: FastifyPluginAsync = async (app) => {
  const identite = serviceIdentite(app);
  const limiteurConnexion = creerLimiteur(app.db, "connexion", identite.trousseau);

  app.post("/cabinet/utilisateurs/:id/debloquer-connexion", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    const confirmation = confirmationIdentiteSchema.parse(request.body ?? {});
    await app.db.withTenant(auth.cabinetId, async (db) => {
      if (!(await emailUtilisateur(db, id))) throw introuvable("Utilisateur");
    });
    return identite.confirmerIdentite(
      auth,
      confirmation,
      "deblocage_connexion",
      async (db, facteur) => {
        const email = await emailUtilisateur(db, id, true);
        if (!email) throw introuvable("Utilisateur");
        // Dans la transaction de l'action : effacement et journal ensemble.
        const etaitBloquee = await limiteurConnexion.debloquer(email, db);
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "deblocage_connexion",
          entite: "utilisateur",
          entiteId: id,
          details: { etait_bloquee: etaitBloquee, facteur },
        });
        return { ok: true, etait_bloquee: etaitBloquee };
      },
      { motDePasseSeulSiInactive: true },
    );
  });
};
