import type { FastifyInstance } from "fastify";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { trousseauDepuisConfig, type Trousseau } from "./chiffrement.js";
import type { Auth } from "./contexte.js";
import { tfaActive, verifierFacteur, type FacteurReconnu } from "./double-authentification.js";
import { creerLimiteur, type Limiteur } from "./limiteur.js";
import { FAUX_HASH, verifyPassword } from "./password.js";

/*
 * Reconfirmation de l'identité avant une action à fort impact (SOC-02,
 * constat M3) : mot de passe ET second facteur (code TOTP ou code de
 * secours), dans la même transaction que l'action.
 *
 * Actions concernées : désactivation de sa 2FA, régénération des codes de
 * secours, politique 2FA du cabinet, réinitialisation de la 2FA d'un autre
 * utilisateur, coordonnées bancaires du cabinet (IBAN, banque, autres
 * coordonnées). Pour ces dernières seulement, un utilisateur SANS 2FA active
 * confirme par son mot de passe seul (option `motDePasseSeulSiInactive`) :
 * le facteur « mot_de_passe » est alors journalisé et signalé aux associés ;
 * la 2FA reste à configurer (elle devient obligatoire si la politique du
 * cabinet l'impose à ses rôles, voir le crochet global d'app.ts). Les autres
 * actions exigent une 2FA active (409 TFA_INACTIVE sinon).
 *
 * Limitation (en mémoire, bornée, réservée AVANT le calcul) PARTAGÉE par
 * toutes les routes de l'application (une instance par base de données) :
 * - `limiteurReauth` : mot de passe redemandé, clé = e-mail ;
 * - `limiteurFacteur` : tout code de second facteur, clé = e-mail, tous écrans
 *   confondus (connexion, activation, confirmations) ; complété par le
 *   compteur d'échecs persistant de verifierFacteur.
 */

export interface CorpsConfirmation {
  mot_de_passe?: string | undefined;
  code?: string | undefined;
  code_secours?: string | undefined;
}

export type ContexteConfirmation =
  | "desactivation"
  | "codes_secours"
  | "politique_2fa"
  | "reinitialisation_2fa"
  | "coordonnees_bancaires";

export type FacteurConfirme = FacteurReconnu | "mot_de_passe";

export interface ServiceIdentite {
  readonly trousseau: Trousseau;
  readonly limiteurFacteur: Limiteur;
  reverifierMotDePasse(auth: Auth, motDePasse: string): Promise<void>;
  confirmerIdentite<T>(
    auth: Auth,
    corps: CorpsConfirmation,
    contexte: ContexteConfirmation,
    action: (db: Db, facteur: FacteurConfirme) => Promise<T>,
    options?: { motDePasseSeulSiInactive?: boolean },
  ): Promise<T>;
}

const FENETRE_MS = 15 * 60 * 1000;
const ESSAIS_MAX = 10;

export const tropDeTentatives = () =>
  new AppError(429, "TROP_DE_TENTATIVES", "Trop de tentatives. Réessayez dans quelques minutes.");
export const codeInvalide = () =>
  new AppError(401, "CODE_2FA_INVALIDE", "Code de vérification incorrect.");
const motDePasseInvalide = () =>
  new AppError(401, "MOT_DE_PASSE_INVALIDE", "Mot de passe incorrect.");
const confirmationRequise = (message: string) => new AppError(403, "CONFIRMATION_REQUISE", message);
const tfaInactive = (contexte: ContexteConfirmation) =>
  new AppError(
    409,
    "TFA_INACTIVE",
    contexte === "desactivation" || contexte === "codes_secours"
      ? "La double authentification n'est pas active."
      : "Activez d'abord votre double authentification : cette action l'exige.",
  );

const services = new WeakMap<object, ServiceIdentite>();

/** Service partagé de l'application (un par base de données décorée sur `app`). */
export function serviceIdentite(app: FastifyInstance): ServiceIdentite {
  let s = services.get(app.db);
  if (!s) {
    s = creerServiceIdentite(app);
    services.set(app.db, s);
  }
  return s;
}

function creerServiceIdentite(app: FastifyInstance): ServiceIdentite {
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

  async function confirmerIdentite<T>(
    auth: Auth,
    corps: CorpsConfirmation,
    contexte: ContexteConfirmation,
    action: (db: Db, facteur: FacteurConfirme) => Promise<T>,
    options: { motDePasseSeulSiInactive?: boolean } = {},
  ): Promise<T> {
    if (!corps.mot_de_passe) {
      throw confirmationRequise("Confirmez votre mot de passe pour cette action.");
    }
    await reverifierMotDePasse(auth, corps.mot_de_passe);
    const cle = auth.email.toLowerCase();
    const facteurFourni =
      corps.code !== undefined
        ? { code: corps.code }
        : corps.code_secours !== undefined
          ? { code_secours: corps.code_secours }
          : null;
    let reserve = false;
    // La transaction est validée après un code faux : l'échec compte (journal, compteur).
    const r = await app.db.withTenant(auth.cabinetId, async (db) => {
      if (!(await tfaActive(db, auth.utilisateurId))) {
        if (!options.motDePasseSeulSiInactive) return { statut: "inactive" as const };
        return { statut: "ok" as const, valeur: await action(db, "mot_de_passe") };
      }
      if (!facteurFourni) return { statut: "facteur_requis" as const };
      if (!limiteurFacteur.reserver(cle)) return { statut: "limite" as const };
      reserve = true;
      const facteur = await verifierFacteur(db, trousseau, auth.utilisateurId, facteurFourni);
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
      return { statut: "ok" as const, valeur: await action(db, facteur) };
    });
    if (r.statut === "inactive") throw tfaInactive(contexte);
    if (r.statut === "facteur_requis") {
      throw confirmationRequise("Saisissez un code de vérification ou un code de secours.");
    }
    if (r.statut === "limite") throw tropDeTentatives();
    if (r.statut === "code") throw codeInvalide();
    if (reserve) limiteurFacteur.liberer(cle);
    return r.valeur;
  }

  return { trousseau, limiteurFacteur, reverifierMotDePasse, confirmerIdentite };
}
