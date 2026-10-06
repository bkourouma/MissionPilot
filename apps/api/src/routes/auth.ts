import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import {
  connexion2faSchema,
  politiqueTfaSchema,
  ROLES_TFA_SENSIBLES,
  tfaActivationSchema,
  tfaConfirmationSchema,
  tfaInitialisationSchema,
  type Role,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { exiger, type Auth } from "../auth/contexte.js";
import {
  activer,
  consommerDefi,
  creerDefi,
  initialiser,
  lireEtat,
  remplacerCodesSecours,
  reserverTentativeDefi,
  rolesObligatoires,
  supprimerTfa,
  tfaActive,
  verifierFacteur,
  type Facteur,
} from "../auth/double-authentification.js";
import { creerLimiteur } from "../auth/limiteur.js";
import { creerSession, poserCookieSession } from "../auth/ouvrir-session.js";
import { FAUX_HASH, verifyPassword } from "../auth/password.js";
import { COOKIE_SESSION, hacherJeton, nouveauJeton } from "../auth/session.js";
import { uriOtpauth, base32Encoder } from "../auth/totp.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit } from "../errors.js";

const connexionSchema = z.object({
  email: z.string().email().max(254),
  mot_de_passe: z.string().min(1).max(200),
});

const FENETRE_MS = 15 * 60 * 1000;
const ESSAIS_MAX = 10;

const tropDeTentatives = () =>
  new AppError(429, "TROP_DE_TENTATIVES", "Trop de tentatives. Réessayez dans quelques minutes.");
const identifiantsInvalides = () =>
  new AppError(401, "IDENTIFIANTS_INVALIDES", "E-mail ou mot de passe incorrect.");
const defiInvalide = () =>
  new AppError(
    401,
    "DEFI_2FA_INVALIDE",
    "Vérification expirée ou déjà utilisée. Reconnectez-vous.",
  );
const codeInvalide = () =>
  new AppError(401, "CODE_2FA_INVALIDE", "Code de vérification incorrect.");
const motDePasseInvalide = () =>
  new AppError(401, "MOT_DE_PASSE_INVALIDE", "Mot de passe incorrect.");

const facteurDe = (v: { code?: string; code_secours?: string }): Facteur =>
  v.code !== undefined ? { code: v.code } : { code_secours: v.code_secours! };

/** Aucune réponse portant un secret (défi, secret TOTP, codes de secours) n'est mise en cache. */
const sansCache = (reply: FastifyReply) =>
  reply.header("cache-control", "no-store").header("pragma", "no-cache");

/*
 * Authentification (SOC-02).
 *
 * Connexion en deux temps quand la 2FA est active : POST /connexion vérifie
 * le mot de passe et renvoie un défi (jeton à usage unique, 5 min, haché en
 * base) SANS ouvrir de session ; POST /connexion/2fa ouvre la session avec un
 * code TOTP ou un code de secours.
 *
 * Limitation de tentatives (en mémoire, bornée, réservée AVANT le calcul) :
 * - `limiteur` : mot de passe à la connexion, clé = e-mail ;
 * - `limiteurReauth` : mot de passe redemandé (initialisation, désactivation,
 *   régénération), clé = e-mail ;
 * - `limiteurFacteur` : tout code de second facteur, clé = e-mail, tous
 *   écrans confondus ; complété par un plafond par défi, en base.
 *
 * Politique du cabinet : si la 2FA est obligatoire pour un rôle de
 * l'utilisateur et qu'il ne l'a pas activée, la session s'ouvre et /moi porte
 * `tfa_a_configurer: true`. Dans cette version, les routes sensibles ne sont
 * PAS bloquées : l'interface invite à configurer la 2FA.
 */
export const routesAuth: FastifyPluginAsync = async (app) => {
  const limiteur = creerLimiteur(ESSAIS_MAX, FENETRE_MS);
  const limiteurReauth = creerLimiteur(ESSAIS_MAX, FENETRE_MS);
  const limiteurFacteur = creerLimiteur(ESSAIS_MAX, FENETRE_MS);
  const trousseau = trousseauDepuisConfig(app.config);

  /** Revérifie le mot de passe de l'utilisateur connecté (limité, temps constant). */
  async function reverifierMotDePasse(auth: Auth, motDePasse: string): Promise<void> {
    const cle = auth.email.toLowerCase();
    if (!limiteurReauth.reserver(cle)) throw tropDeTentatives();
    const hash = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query("SELECT mot_de_passe_hash FROM utilisateurs WHERE id = $1", [
        auth.utilisateurId,
      ]);
      return r.rows[0]?.mot_de_passe_hash as string | undefined;
    });
    if (!(await verifyPassword(motDePasse, hash ?? FAUX_HASH)) || !hash) {
      throw motDePasseInvalide();
    }
    limiteurReauth.liberer(cle);
  }

  app.post("/connexion", async (request, reply) => {
    const { email, mot_de_passe } = connexionSchema.parse(request.body);
    const cle = email.toLowerCase();
    if (!limiteur.reserver(cle)) throw tropDeTentatives();

    const trouve = await app.db.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM trouver_connexion($1)", [email]);
      return r.rows[0] as
        | { utilisateur_id: string; cabinet_id: string; mot_de_passe_hash: string; actif: boolean }
        | undefined;
    });
    // Toujours calculer un hachage : le temps de réponse ne révèle pas si l'e-mail existe.
    const valide = await verifyPassword(mot_de_passe, trouve?.mot_de_passe_hash ?? FAUX_HASH);
    if (!trouve || !valide || !trouve.actif) throw identifiantsInvalides();
    limiteur.liberer(cle);

    const defi = nouveauJeton();
    const resultat = await app.db.withTenant(trouve.cabinet_id, async (db) => {
      if (await tfaActive(db, trouve.utilisateur_id)) {
        await creerDefi(db, trouve.cabinet_id, trouve.utilisateur_id, hacherJeton(defi));
        await journaliser(db, {
          cabinetId: trouve.cabinet_id,
          utilisateurId: trouve.utilisateur_id,
          action: "connexion_2fa_requise",
          entite: "utilisateur",
          entiteId: trouve.utilisateur_id,
        });
        return { etape: "2fa_requise" as const };
      }
      const jeton = await creerSession(db, trouve.cabinet_id, trouve.utilisateur_id);
      await journaliser(db, {
        cabinetId: trouve.cabinet_id,
        utilisateurId: trouve.utilisateur_id,
        action: "connexion",
        entite: "utilisateur",
        entiteId: trouve.utilisateur_id,
      });
      return { etape: "connecte" as const, jeton };
    });
    sansCache(reply);
    if (resultat.etape === "2fa_requise") return { ok: false, etape: "2fa_requise", defi };
    poserCookieSession(reply, app.config, resultat.jeton);
    return { ok: true, etape: "connecte" };
  });

  app.post("/connexion/2fa", async (request, reply) => {
    const corps = connexion2faSchema.parse(request.body);
    const defi = await app.db.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM resoudre_defi_2fa($1)", [hacherJeton(corps.defi)]);
      return r.rows[0] as
        { defi_id: string; cabinet_id: string; utilisateur_id: string; email: string } | undefined;
    });
    if (!defi) throw defiInvalide();
    const cle = defi.email.toLowerCase();
    if (!limiteurFacteur.reserver(cle)) throw tropDeTentatives();

    // La transaction est toujours validée : un échec compte (tentative du défi, journal).
    const resultat = await app.db.withTenant(defi.cabinet_id, async (db) => {
      if (!(await reserverTentativeDefi(db, defi.defi_id))) return { statut: "defi" as const };
      const facteur = await verifierFacteur(db, trousseau, defi.utilisateur_id, facteurDe(corps));
      if (!facteur) {
        await journaliser(db, {
          cabinetId: defi.cabinet_id,
          utilisateurId: defi.utilisateur_id,
          action: "2fa_echec",
          entite: "utilisateur",
          entiteId: defi.utilisateur_id,
          details: { contexte: "connexion" },
        });
        return { statut: "code" as const };
      }
      if (!(await consommerDefi(db, defi.defi_id))) return { statut: "defi" as const };
      const jeton = await creerSession(db, defi.cabinet_id, defi.utilisateur_id);
      await journaliser(db, {
        cabinetId: defi.cabinet_id,
        utilisateurId: defi.utilisateur_id,
        action: "connexion",
        entite: "utilisateur",
        entiteId: defi.utilisateur_id,
        details: { facteur },
      });
      return { statut: "ok" as const, jeton };
    });
    if (resultat.statut === "defi") throw defiInvalide();
    if (resultat.statut === "code") throw codeInvalide();
    limiteurFacteur.liberer(cle);
    sansCache(reply);
    poserCookieSession(reply, app.config, resultat.jeton);
    return { ok: true, etape: "connecte" };
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
    const etat = await app.db.withTenant(auth.cabinetId, (db) =>
      lireEtat(db, auth.cabinetId, auth.utilisateurId, auth.roles, app.config),
    );
    return {
      utilisateur: { id: auth.utilisateurId, email: auth.email, nom: auth.nom, roles: auth.roles },
      cabinet_id: auth.cabinetId,
      tfa_active: etat.active,
      tfa_a_configurer: etat.a_configurer,
    };
  });

  // --- Gestion de sa propre 2FA ------------------------------------------------

  app.get("/2fa", async (request) => {
    const auth = exiger(request);
    return app.db.withTenant(auth.cabinetId, (db) =>
      lireEtat(db, auth.cabinetId, auth.utilisateurId, auth.roles, app.config),
    );
  });

  app.post("/2fa/initialiser", async (request, reply) => {
    const auth = exiger(request);
    const { mot_de_passe } = tfaInitialisationSchema.parse(request.body);
    await reverifierMotDePasse(auth, mot_de_passe);
    const secret = await app.db.withTenant(auth.cabinetId, async (db) => {
      const s = await initialiser(db, trousseau, auth.cabinetId, auth.utilisateurId);
      if (!s) throw conflit("La double authentification est déjà active.");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "2fa_initialisation",
        entite: "utilisateur",
        entiteId: auth.utilisateurId,
      });
      return s;
    });
    sansCache(reply);
    // Seule et unique remise du secret : il n'est plus jamais renvoyé ensuite.
    return { secret: base32Encoder(secret), uri: uriOtpauth(secret, auth.email) };
  });

  app.post("/2fa/activer", async (request, reply) => {
    const auth = exiger(request);
    const { code } = tfaActivationSchema.parse(request.body);
    const cle = auth.email.toLowerCase();
    if (!limiteurFacteur.reserver(cle)) throw tropDeTentatives();
    const jetonCourant = request.cookies[COOKIE_SESSION];
    const r = await app.db.withTenant(auth.cabinetId, async (db) => {
      const res = await activer(db, trousseau, auth.cabinetId, auth.utilisateurId, code);
      if (res.statut === "code_invalide") {
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "2fa_echec",
          entite: "utilisateur",
          entiteId: auth.utilisateurId,
          details: { contexte: "activation" },
        });
      }
      if (res.statut === "activee") {
        // Les autres sessions ouvertes avant l'activation sont fermées.
        await db.query("DELETE FROM sessions WHERE utilisateur_id = $1 AND jeton_hash <> $2", [
          auth.utilisateurId,
          jetonCourant ? hacherJeton(jetonCourant) : "",
        ]);
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "2fa_activation",
          entite: "utilisateur",
          entiteId: auth.utilisateurId,
        });
      }
      return res;
    });
    if (r.statut === "non_initialisee") {
      throw new AppError(
        400,
        "TFA_NON_INITIALISEE",
        "Aucune configuration en attente : recommencez l'initialisation.",
      );
    }
    if (r.statut === "code_invalide") throw codeInvalide();
    limiteurFacteur.liberer(cle);
    sansCache(reply);
    return { codes_secours: r.codes };
  });

  /** Mot de passe ET second facteur ; journalise l'échec. Renvoie après validation. */
  async function confirmerIdentite(
    auth: Auth,
    corps: { mot_de_passe: string; code?: string; code_secours?: string },
    contexte: "desactivation" | "codes_secours",
    action: (db: Db) => Promise<unknown>,
  ): Promise<unknown> {
    await reverifierMotDePasse(auth, corps.mot_de_passe);
    const cle = auth.email.toLowerCase();
    if (!limiteurFacteur.reserver(cle)) throw tropDeTentatives();
    const r = await app.db.withTenant(auth.cabinetId, async (db) => {
      if (!(await tfaActive(db, auth.utilisateurId))) return { statut: "inactive" as const };
      const facteur = await verifierFacteur(db, trousseau, auth.utilisateurId, facteurDe(corps));
      if (!facteur) {
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "2fa_echec",
          entite: "utilisateur",
          entiteId: auth.utilisateurId,
          details: { contexte },
        });
        return { statut: "code" as const };
      }
      return { statut: "ok" as const, valeur: await action(db) };
    });
    if (r.statut === "inactive") {
      throw new AppError(409, "TFA_INACTIVE", "La double authentification n'est pas active.");
    }
    if (r.statut === "code") throw codeInvalide();
    limiteurFacteur.liberer(cle);
    return r.valeur;
  }

  app.post("/2fa/desactiver", async (request, reply) => {
    const auth = exiger(request);
    const corps = tfaConfirmationSchema.parse(request.body);
    await confirmerIdentite(auth, corps, "desactivation", async (db) => {
      await supprimerTfa(db, auth.utilisateurId);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "2fa_desactivation",
        entite: "utilisateur",
        entiteId: auth.utilisateurId,
      });
    });
    sansCache(reply);
    return { ok: true };
  });

  app.post("/2fa/codes-secours", async (request, reply) => {
    const auth = exiger(request);
    const corps = tfaConfirmationSchema.parse(request.body);
    const codes = (await confirmerIdentite(auth, corps, "codes_secours", async (db) => {
      const c = await remplacerCodesSecours(db, trousseau, auth.cabinetId, auth.utilisateurId);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "2fa_codes_secours_regeneres",
        entite: "utilisateur",
        entiteId: auth.utilisateurId,
      });
      return c;
    })) as string[];
    sansCache(reply);
    return { codes_secours: codes };
  });

  // --- Politique du cabinet ----------------------------------------------------

  app.get("/2fa/politique", async (request) => {
    const auth = exiger(request);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query("SELECT tfa_obligatoire FROM cabinets WHERE id = $1", [
        auth.cabinetId,
      ]);
      const cabinet = (r.rows[0]?.tfa_obligatoire ?? []) as Role[];
      return {
        roles_obligatoires: cabinet,
        roles_sensibles: ROLES_TFA_SENSIBLES,
        roles_obligatoires_effectifs: rolesObligatoires(cabinet, app.config),
        plancher_plateforme: app.config.TOTP_REQUIS === "oui",
      };
    });
  });

  app.put("/2fa/politique", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { roles_obligatoires } = politiqueTfaSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await db.query(
        "SELECT tfa_obligatoire FROM cabinets WHERE id = $1 FOR UPDATE",
        [auth.cabinetId],
      );
      await db.query("UPDATE cabinets SET tfa_obligatoire = $2 WHERE id = $1", [
        auth.cabinetId,
        roles_obligatoires,
      ]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "politique_2fa",
        entiteId: auth.cabinetId,
        details: {
          avant: avant.rows[0]?.tfa_obligatoire ?? [],
          apres: roles_obligatoires,
        },
      });
      return {
        roles_obligatoires,
        roles_sensibles: ROLES_TFA_SENSIBLES,
        roles_obligatoires_effectifs: rolesObligatoires(roles_obligatoires, app.config),
        plancher_plateforme: app.config.TOTP_REQUIS === "oui",
      };
    });
  });
};
