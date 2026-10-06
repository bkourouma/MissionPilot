import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { FAUX_HASH, verifyPassword } from "../auth/password.js";
import { COOKIE_SESSION, DUREE_SESSION_MS, hacherJeton, nouveauJeton } from "../auth/session.js";
import { AppError } from "../errors.js";
import { creerLimiteur } from "../auth/limiteur.js";
import { cookieSecurise } from "../config.js";

const connexionSchema = z.object({
  email: z.string().email().max(254),
  mot_de_passe: z.string().min(1).max(200),
});

const FENETRE_MS = 15 * 60 * 1000;
const ESSAIS_MAX = 10;

export const routesAuth: FastifyPluginAsync = async (app) => {
  const limiteur = creerLimiteur(ESSAIS_MAX, FENETRE_MS);

  app.post("/connexion", async (request, reply) => {
    const { email, mot_de_passe } = connexionSchema.parse(request.body);
    const cle = email.toLowerCase();
    if (!limiteur.reserver(cle)) {
      throw new AppError(
        429,
        "TROP_DE_TENTATIVES",
        "Trop de tentatives. Réessayez dans quelques minutes.",
      );
    }

    const trouve = await app.db.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM trouver_connexion($1)", [email]);
      return r.rows[0] as
        | { utilisateur_id: string; cabinet_id: string; mot_de_passe_hash: string; actif: boolean }
        | undefined;
    });
    // Toujours calculer un hachage : le temps de réponse ne révèle pas si l'e-mail existe.
    const valide = await verifyPassword(mot_de_passe, trouve?.mot_de_passe_hash ?? FAUX_HASH);
    if (!trouve || !valide || !trouve.actif) {
      throw new AppError(401, "IDENTIFIANTS_INVALIDES", "E-mail ou mot de passe incorrect.");
    }
    limiteur.liberer(cle);

    const jeton = nouveauJeton();
    await app.db.withTenant(trouve.cabinet_id, async (db) => {
      await db.query(
        `INSERT INTO sessions (cabinet_id, utilisateur_id, jeton_hash, expire_le)
         VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
        [trouve.cabinet_id, trouve.utilisateur_id, hacherJeton(jeton), String(DUREE_SESSION_MS)],
      );
      await journaliser(db, {
        cabinetId: trouve.cabinet_id,
        utilisateurId: trouve.utilisateur_id,
        action: "connexion",
        entite: "utilisateur",
        entiteId: trouve.utilisateur_id,
      });
    });
    reply.setCookie(COOKIE_SESSION, jeton, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecurise(app.config),
      path: "/",
      maxAge: DUREE_SESSION_MS / 1000,
    });
    return { ok: true };
  });

  app.post("/deconnexion", async (request, reply) => {
    const jeton = request.cookies[COOKIE_SESSION];
    if (jeton && request.auth) {
      await app.db.withTenant(request.auth.cabinetId, (db) =>
        db.query("DELETE FROM sessions WHERE jeton_hash = $1", [hacherJeton(jeton)]),
      );
    }
    reply.clearCookie(COOKIE_SESSION, { path: "/" });
    return { ok: true };
  });

  app.get("/moi", async (request) => {
    const auth = exiger(request);
    return {
      utilisateur: { id: auth.utilisateurId, email: auth.email, nom: auth.nom, roles: auth.roles },
      cabinet_id: auth.cabinetId,
    };
  });
};
