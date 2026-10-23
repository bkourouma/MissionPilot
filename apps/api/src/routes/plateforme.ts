import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { serviceIdentite, tropDeTentatives } from "../auth/confirmer-identite.js";
import { creerLimiteur } from "../auth/limiteur.js";
import { FAUX_HASH, verifyPassword } from "../auth/password.js";
import { hacherJeton, nouveauJeton } from "../auth/session.js";
import { demoConnexionActive } from "../config.js";
import type { Database } from "../db/pool.js";
import { nonAuthentifie } from "../errors.js";
import {
  connexionSchema,
  creerCabinetSchema,
  creerUtilisateurSchema,
  modifierCabinetSchema,
  modifierUtilisateurSchema,
  paramsCabinet,
  paramsUtilisateur,
} from "../plateforme/schemas.js";
import * as service from "../plateforme/service.js";
import {
  COOKIE_PLATEFORME,
  effacerCookiePlateforme,
  poserCookiePlateforme,
  type SessionPlateforme,
} from "../plateforme/session.js";
import { sansCache } from "./auth.js";

const UUID_NUL = "00000000-0000-0000-0000-000000000000";

/** Super admin marqué démonstration (fonction SQL dédiée : un booléen, rien d'autre). */
async function superAdminDemo(database: Database, id: string): Promise<boolean> {
  return database.withoutTenant(async (db) => {
    const r = await db.query("SELECT demo_super_admin_est_demo($1) AS demo", [id]);
    return r.rows[0]?.demo === true;
  });
}

/** Session plateforme de la requête, ou 401 `NON_AUTHENTIFIE`. */
export function exigerPlateforme(request: FastifyRequest): SessionPlateforme {
  if (!request.plateforme) throw nonAuthentifie();
  return request.plateforme;
}

/*
 * Super admin de plateforme : gestion des cabinets et de leurs comptes, JAMAIS de donnée métier.
 *
 * - Cookie `mp_plateforme` seul (la session de cabinet `mp_session` n'est pas lue ici, et ce
 *   cookie n'est lu par aucune route de cabinet) ; le crochet de résolution est celui du plugin
 *   (encapsulé : limité aux routes ci-dessous).
 * - Accès aux données uniquement par les fonctions SQL `plateforme_*` (plateforme/service.ts) ;
 *   chacune revérifie la session (haché du jeton) et journalise dans sa transaction.
 * - Connexion : limiteur de l'espace `connexion`, clé `plateforme:<email>`, réservé AVANT le
 *   calcul ; réponse 401 uniforme ; hachage factice pour égaliser le temps.
 * - Les mots de passe générés ne sont renvoyés que dans la réponse de création (`no-store`).
 */
export const routesPlateforme: FastifyPluginAsync = async (app) => {
  const limiteur = creerLimiteur(app.db, "connexion", serviceIdentite(app).trousseau);
  app.decorateRequest("plateforme", null);

  app.addHook("onRequest", async (request) => {
    const jeton = request.cookies[COOKIE_PLATEFORME];
    if (!jeton) return;
    request.plateforme = (await service.resoudreSession(app.db, hacherJeton(jeton))) ?? null;
  });

  app.post("/connexion", async (request, reply) => {
    const { email, motDePasse } = connexionSchema.parse(request.body);
    const cle = `plateforme:${email.toLowerCase()}`;
    if (!(await limiteur.reserver(cle))) throw tropDeTentatives();

    const trouve = await service.trouverConnexion(app.db, email);
    // Toujours calculer un hachage : le temps de réponse ne révèle pas si l'e-mail existe.
    const valide = await verifyPassword(motDePasse, trouve?.mot_de_passe_hash ?? FAUX_HASH);
    // Mot de passe public d'un super admin de démonstration : refusé tant que la démo est
    // inactive (un serveur qui quitte la démo ne garde pas un super admin ouvert). Même
    // requête que l'e-mail existe ou non, même réponse que tout identifiant invalide.
    const demoFermee =
      !demoConnexionActive(app.config) &&
      (await superAdminDemo(app.db, trouve?.super_admin_id ?? UUID_NUL));
    if (!trouve || !valide || !trouve.actif || demoFermee) {
      // Même appel que l'e-mail existe ou non (identifiant nul : la fonction ne journalise
      // rien) : le temps de réponse ne révèle pas si le compte existe.
      await service.echecConnexion(app.db, trouve?.super_admin_id ?? UUID_NUL);
      throw service.identifiantsInvalides();
    }
    await limiteur.liberer(cle);

    const jeton = nouveauJeton();
    await service.ouvrirSession(app.db, trouve.super_admin_id, hacherJeton(jeton));
    const session = await service.resoudreSession(app.db, hacherJeton(jeton));
    if (!session) throw service.identifiantsInvalides();
    sansCache(reply);
    poserCookiePlateforme(reply, app.config, jeton);
    return {
      ok: true,
      superAdmin: { id: session.superAdminId, email: session.email, nom: session.nom },
    };
  });

  app.post("/deconnexion", async (request, reply) => {
    const jeton = request.cookies[COOKIE_PLATEFORME];
    if (jeton) await service.fermerSession(app.db, hacherJeton(jeton));
    effacerCookiePlateforme(reply);
    return { ok: true };
  });

  app.get("/moi", async (request) => {
    const s = exigerPlateforme(request);
    return { superAdmin: { id: s.superAdminId, email: s.email, nom: s.nom, estDemo: s.estDemo } };
  });

  app.get("/cabinets", async (request) => {
    const s = exigerPlateforme(request);
    return { elements: await service.listerCabinets(app.db, s.jetonHash) };
  });

  app.post("/cabinets", async (request, reply) => {
    const s = exigerPlateforme(request);
    const corps = creerCabinetSchema.parse(request.body);
    const resultat = await service.creerCabinet(app.db, s.jetonHash, corps);
    sansCache(reply);
    return reply.status(201).send(resultat);
  });

  app.patch("/cabinets/:id", async (request) => {
    const s = exigerPlateforme(request);
    const { id } = paramsCabinet.parse(request.params);
    const corps = modifierCabinetSchema.parse(request.body);
    return { cabinet: await service.modifierCabinet(app.db, s.jetonHash, id, corps) };
  });

  app.get("/cabinets/:id/utilisateurs", async (request) => {
    const s = exigerPlateforme(request);
    const { id } = paramsCabinet.parse(request.params);
    return { elements: await service.listerUtilisateurs(app.db, s.jetonHash, id) };
  });

  app.post("/cabinets/:id/utilisateurs", async (request, reply) => {
    const s = exigerPlateforme(request);
    const { id } = paramsCabinet.parse(request.params);
    const corps = creerUtilisateurSchema.parse(request.body);
    const resultat = await service.creerUtilisateur(app.db, s.jetonHash, id, corps);
    sansCache(reply);
    return reply.status(201).send(resultat);
  });

  app.patch("/cabinets/:id/utilisateurs/:uid", async (request) => {
    const s = exigerPlateforme(request);
    const { id, uid } = paramsUtilisateur.parse(request.params);
    const corps = modifierUtilisateurSchema.parse(request.body);
    return { utilisateur: await service.modifierUtilisateur(app.db, s.jetonHash, id, uid, corps) };
  });
};
