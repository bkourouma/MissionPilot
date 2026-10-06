import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import {
  connexion2faSchema,
  estUtilisateurPortail,
  politiqueTfaModificationSchema,
  ROLES_TFA_SENSIBLES,
  tfaActivationSchema,
  tfaConfirmationSchema,
  tfaInitialisationSchema,
  type Role,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import {
  codeInvalide,
  serviceIdentite,
  tropDeTentatives,
  type ContexteConfirmation,
  type CorpsConfirmation,
} from "../auth/confirmer-identite.js";
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
import { associesActifs, notifierAvecEmailEnFile } from "../notifications/notifier.js";

const connexionSchema = z.object({
  email: z.string().email().max(254),
  mot_de_passe: z.string().min(1).max(200),
});

const identifiantsInvalides = () =>
  new AppError(401, "IDENTIFIANTS_INVALIDES", "E-mail ou mot de passe incorrect.");
const defiInvalide = () =>
  new AppError(
    401,
    "DEFI_2FA_INVALIDE",
    "Vérification expirée ou déjà utilisée. Reconnectez-vous.",
  );

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
 * Limitation de tentatives (en base, partagée entre instances, bornée,
 * réservée AVANT le calcul ; auth/limiteur.ts) :
 * - `limiteur` : mot de passe à la connexion, clé = e-mail ; un gestionnaire du
 *   cabinet peut débloquer un utilisateur (routes/limiteur-admin.ts) ;
 * - mot de passe redemandé et codes de second facteur : limiteurs PARTAGÉS
 *   par toute l'application (auth/confirmer-identite.ts), complétés par un
 *   plafond par défi et par le compteur d'échecs persistant (verifierFacteur).
 *
 * Politique du cabinet : si la 2FA est obligatoire pour un rôle de
 * l'utilisateur et qu'il ne l'a pas activée, la session s'ouvre, /moi porte
 * `tfa_a_configurer: true`, et le crochet global d'app.ts répond 403
 * TFA_A_CONFIGURER sur toute route hors /api/auth/*, /api/sante et
 * /api/invitations/accepter tant qu'elle n'est pas activée.
 */
export const routesAuth: FastifyPluginAsync = async (app) => {
  const identite = serviceIdentite(app);
  const { limiteurFacteur, trousseau } = identite;
  // 10 essais par 15 min glissantes : règles de l'espace « connexion », en base (0120).
  const limiteur = creerLimiteur(app.db, "connexion", trousseau);
  const reverifierMotDePasse = identite.reverifierMotDePasse;

  /** Alerte e-mail (en file) de tous les associés actifs, dans la transaction courante. */
  async function alerterAssocies(
    db: Db,
    auth: Auth,
    alerte: { type: string; titre: string; corps: string; lien: string },
  ): Promise<void> {
    for (const id of await associesActifs(db)) {
      await notifierAvecEmailEnFile(db, trousseau, {
        cabinetId: auth.cabinetId,
        destinataireId: id,
        ...alerte,
      });
    }
  }

  app.post("/connexion", async (request, reply) => {
    const { email, mot_de_passe } = connexionSchema.parse(request.body);
    const cle = email.toLowerCase();
    if (!(await limiteur.reserver(cle))) throw tropDeTentatives();

    const trouve = await app.db.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM trouver_connexion($1)", [email]);
      return r.rows[0] as
        | { utilisateur_id: string; cabinet_id: string; mot_de_passe_hash: string; actif: boolean }
        | undefined;
    });
    // Toujours calculer un hachage : le temps de réponse ne révèle pas si l'e-mail existe.
    const valide = await verifyPassword(mot_de_passe, trouve?.mot_de_passe_hash ?? FAUX_HASH);
    if (!trouve || !valide || !trouve.actif) throw identifiantsInvalides();
    await limiteur.liberer(cle);

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
    if (!(await limiteurFacteur.reserver(cle))) throw tropDeTentatives();

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
    await limiteurFacteur.liberer(cle);
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
      // Utilisateur du portail client (SOC-09) : le web l'oriente vers /api/portail/*.
      portail: estUtilisateurPortail(auth.roles),
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
    if (!(await limiteurFacteur.reserver(cle))) throw tropDeTentatives();
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
    await limiteurFacteur.liberer(cle);
    sansCache(reply);
    return { codes_secours: r.codes };
  });

  /** Mot de passe ET second facteur (auth/confirmer-identite.ts), dans la transaction de l'action. */
  const confirmerIdentite = <T>(
    auth: Auth,
    corps: CorpsConfirmation,
    contexte: ContexteConfirmation,
    action: (db: Db) => Promise<T>,
  ): Promise<T> => identite.confirmerIdentite(auth, corps, contexte, (db) => action(db));

  /** Refus (409) si la politique du cabinet impose la 2FA à l'un des rôles de l'utilisateur. */
  async function exigerDesactivationPermise(db: Db, auth: Auth): Promise<void> {
    const etat = await lireEtat(db, auth.cabinetId, auth.utilisateurId, auth.roles, app.config);
    if (etat.obligatoire) {
      throw new AppError(
        409,
        "TFA_OBLIGATOIRE",
        "La double authentification est obligatoire pour votre rôle : elle ne se désactive pas.",
      );
    }
  }

  app.post("/2fa/desactiver", async (request, reply) => {
    const auth = exiger(request);
    const corps = tfaConfirmationSchema.parse(request.body);
    // Avant la confirmation (aucun code consommé en vain), puis dans sa transaction.
    await app.db.withTenant(auth.cabinetId, (db) => exigerDesactivationPermise(db, auth));
    await confirmerIdentite(auth, corps, "desactivation", async (db) => {
      await db.query("SELECT 1 FROM cabinets WHERE id = $1 FOR SHARE", [auth.cabinetId]);
      await exigerDesactivationPermise(db, auth);
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
    const codes = await confirmerIdentite(auth, corps, "codes_secours", async (db) => {
      const c = await remplacerCodesSecours(db, trousseau, auth.cabinetId, auth.utilisateurId);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "2fa_codes_secours_regeneres",
        entite: "utilisateur",
        entiteId: auth.utilisateurId,
      });
      return c;
    });
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

  /**
   * Politique 2FA du cabinet : « cabinet.gerer », mot de passe ET second
   * facteur de l'auteur (2FA active exigée), alerte e-mail de tous les associés.
   */
  app.put("/2fa/politique", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { roles_obligatoires, ...confirmation } = politiqueTfaModificationSchema.parse(
      request.body,
    );
    return confirmerIdentite(auth, confirmation, "politique_2fa", async (db) => {
      const avant = await db.query(
        "SELECT tfa_obligatoire FROM cabinets WHERE id = $1 FOR UPDATE",
        [auth.cabinetId],
      );
      const rolesAvant = (avant.rows[0]?.tfa_obligatoire ?? []) as string[];
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
        details: { avant: rolesAvant, apres: roles_obligatoires },
      });
      await alerterAssocies(db, auth, {
        type: "securite_politique_tfa",
        titre: "Politique de double authentification du cabinet modifiée",
        corps: [
          `Modifiée par ${auth.nom}.`,
          `Rôles soumis avant : ${rolesAvant.join(", ") || "aucun"}.`,
          `Rôles soumis après : ${roles_obligatoires.join(", ") || "aucun"}.`,
          "Si ce changement n'est pas attendu, vérifiez le journal d'audit.",
        ].join("\n"),
        lien: "/parametres/utilisateurs",
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
