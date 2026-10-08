import { randomInt } from "node:crypto";
import {
  estUtilisateurPortail,
  NOMBRE_CODES_SECOURS,
  ROLES_TFA_SENSIBLES,
  type Role,
} from "@missionpilot/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { notifierAvecEmailEnFile } from "../notifications/notifier.js";
import { chiffrer, dechiffrer, empreinte, type Trousseau } from "./chiffrement.js";
import { nouveauSecretTotp, verifierTotp } from "./totp.js";

/*
 * Double authentification TOTP (SOC-02) : accès aux données, dans la
 * transaction courante (contexte RLS du cabinet de l'utilisateur).
 *
 * - Secret TOTP chiffré (AAD = identifiant de l'utilisateur), jamais renvoyé
 *   après l'initialisation, jamais journalisé.
 * - Anti-rejeu : la ligne est verrouillée (FOR UPDATE) et seul un pas de
 *   temps postérieur au dernier pas accepté est admis.
 * - Codes de secours : empreinte HMAC à clé dérivée, usage unique (UPDATE
 *   atomique « utilise_le IS NULL »).
 */

/** Délai pour confirmer une initialisation avec un premier code. */
export const DELAI_INITIALISATION_MIN = 15;
/** Durée de vie d'un défi de connexion. */
export const DUREE_DEFI_MS = 5 * 60 * 1000;
/** Tentatives de code par défi. */
export const TENTATIVES_PAR_DEFI = 5;

export type Facteur = { code: string } | { code_secours: string };
export type FacteurReconnu = "totp" | "code_secours";

const aadSecret = (utilisateurId: string) => `totp:${utilisateurId}`;

// Sans caractères ambigus (0/o, 1/l/i) ; 31 symboles, 10 caractères ≈ 49 bits.
const ALPHABET_SECOURS = "abcdefghjkmnpqrstuvwxyz23456789";

export function normaliserCodeSecours(code: string): string {
  return code.replace(/[\s-]/g, "").toLowerCase();
}

/** Codes de secours affichables « xxxxx-xxxxx » (tirage uniforme). */
export function genererCodesSecours(n = NOMBRE_CODES_SECOURS): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    let c = "";
    for (let i = 0; i < 10; i++) c += ALPHABET_SECOURS[randomInt(ALPHABET_SECOURS.length)];
    codes.add(`${c.slice(0, 5)}-${c.slice(5)}`);
  }
  return [...codes];
}

const empreinteCode = (t: Trousseau, version: number, utilisateurId: string, code: string) =>
  empreinte(t, "codes_secours", version, `${utilisateurId}:${normaliserCodeSecours(code)}`);

/** Rôles pour lesquels la 2FA est obligatoire : politique du cabinet, plancher plateforme. */
export function rolesObligatoires(
  politiqueCabinet: readonly string[],
  config: Pick<Config, "TOTP_REQUIS">,
): string[] {
  const roles = new Set(politiqueCabinet);
  if (config.TOTP_REQUIS === "oui") for (const r of ROLES_TFA_SENSIBLES) roles.add(r);
  return [...roles];
}

export interface EtatTfa {
  active: boolean;
  activee_le: string | null;
  codes_secours_restants: number;
  obligatoire: boolean;
  /** Obligatoire pour l'un de ses rôles et pas encore activée. */
  a_configurer: boolean;
}

export async function lireEtat(
  db: Db,
  cabinetId: string,
  utilisateurId: string,
  roles: readonly Role[],
  config: Pick<Config, "TOTP_REQUIS">,
): Promise<EtatTfa> {
  const r = await db.query(
    `SELECT c.tfa_obligatoire, t.active_le,
       (SELECT count(*)::int FROM codes_secours_2fa s
        WHERE s.utilisateur_id = $2 AND s.utilise_le IS NULL) AS restants,
       COALESCE((SELECT p.tfa_obligatoire FROM portail_parametres p WHERE p.cabinet_id = c.id),
                false) AS tfa_portail
     FROM cabinets c
     LEFT JOIN utilisateurs_2fa t ON t.utilisateur_id = $2 AND t.active_le IS NOT NULL
     WHERE c.id = $1`,
    [cabinetId, utilisateurId],
  );
  const ligne = r.rows[0] as
    | { tfa_obligatoire: string[]; active_le: Date | null; restants: number; tfa_portail: boolean }
    | undefined;
  const politique = rolesObligatoires(ligne?.tfa_obligatoire ?? [], config);
  // Utilisateur du portail (SOC-09) : politique du portail du cabinet (portail_parametres).
  const obligatoire = estUtilisateurPortail(roles)
    ? ligne?.tfa_portail === true
    : roles.some((role) => politique.includes(role));
  const active = Boolean(ligne?.active_le);
  return {
    active,
    activee_le: ligne?.active_le ? ligne.active_le.toISOString() : null,
    codes_secours_restants: active ? (ligne?.restants ?? 0) : 0,
    obligatoire,
    a_configurer: obligatoire && !active,
  };
}

export async function tfaActive(db: Db, utilisateurId: string): Promise<boolean> {
  const r = await db.query(
    "SELECT 1 FROM utilisateurs_2fa WHERE utilisateur_id = $1 AND active_le IS NOT NULL",
    [utilisateurId],
  );
  return Boolean(r.rowCount);
}

/**
 * Initialisation : nouveau secret en attente (remplace une initialisation non
 * confirmée). Renvoie le secret en clair, à remettre UNE fois à l'utilisateur ;
 * null si la 2FA est déjà active.
 */
export async function initialiser(
  db: Db,
  t: Trousseau,
  cabinetId: string,
  utilisateurId: string,
): Promise<Buffer | null> {
  const secret = nouveauSecretTotp();
  const c = chiffrer(t, "totp", secret, aadSecret(utilisateurId));
  const r = await db.query(
    `INSERT INTO utilisateurs_2fa (utilisateur_id, cabinet_id, secret_chiffre, cle_version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (utilisateur_id) DO UPDATE
       SET secret_chiffre = EXCLUDED.secret_chiffre, cle_version = EXCLUDED.cle_version,
           dernier_pas = NULL, cree_le = now()
       WHERE utilisateurs_2fa.active_le IS NULL
     RETURNING utilisateur_id`,
    [utilisateurId, cabinetId, c.donnees, c.version],
  );
  return r.rowCount ? secret : null;
}

interface LigneTfa {
  cabinet_id: string;
  secret_chiffre: Buffer;
  cle_version: number;
  dernier_pas: string | null;
  active_le: Date | null;
  echecs: number;
  bloque_jusqu_au: Date | null;
}

/** Vérifie un code TOTP sur la ligne verrouillée ; met à jour le dernier pas (et rechiffre si besoin). */
async function verifierCodeTotp(
  db: Db,
  t: Trousseau,
  utilisateurId: string,
  ligne: LigneTfa,
  code: string,
  maintenantMs: number,
): Promise<boolean> {
  let secret: Buffer;
  try {
    secret = dechiffrer(
      t,
      "totp",
      { version: ligne.cle_version, donnees: ligne.secret_chiffre },
      aadSecret(utilisateurId),
    );
  } catch {
    return false;
  }
  const dernier = ligne.dernier_pas === null ? null : Number(ligne.dernier_pas);
  const pas = verifierTotp(secret, code, maintenantMs, dernier);
  if (pas === null) return false;
  if (ligne.cle_version !== t.versionActuelle) {
    // Rotation : rechiffrement avec la clé actuelle à la première utilisation.
    const c = chiffrer(t, "totp", secret, aadSecret(utilisateurId));
    await db.query(
      "UPDATE utilisateurs_2fa SET dernier_pas = $2, secret_chiffre = $3, cle_version = $4 WHERE utilisateur_id = $1",
      [utilisateurId, pas, c.donnees, c.version],
    );
  } else {
    await db.query("UPDATE utilisateurs_2fa SET dernier_pas = $2 WHERE utilisateur_id = $1", [
      utilisateurId,
      pas,
    ]);
  }
  return true;
}

/**
 * Confirme l'initialisation avec un premier code. Renvoie les codes de
 * secours en clair (à afficher UNE fois), ou null si aucune initialisation
 * valide n'est en attente ou si le code est faux.
 */
export async function activer(
  db: Db,
  t: Trousseau,
  cabinetId: string,
  utilisateurId: string,
  code: string,
  maintenantMs = Date.now(),
): Promise<
  | { statut: "non_initialisee" }
  | { statut: "code_invalide" }
  | { statut: "activee"; codes: string[] }
> {
  const r = await db.query(
    `SELECT cabinet_id, secret_chiffre, cle_version, dernier_pas, active_le, echecs, bloque_jusqu_au
     FROM utilisateurs_2fa WHERE utilisateur_id = $1 AND active_le IS NULL
       AND cree_le > now() - make_interval(mins => $2)
     FOR UPDATE`,
    [utilisateurId, DELAI_INITIALISATION_MIN],
  );
  const ligne = r.rows[0] as LigneTfa | undefined;
  if (!ligne) return { statut: "non_initialisee" };
  if (!(await verifierCodeTotp(db, t, utilisateurId, ligne, code, maintenantMs))) {
    return { statut: "code_invalide" };
  }
  await db.query("UPDATE utilisateurs_2fa SET active_le = now() WHERE utilisateur_id = $1", [
    utilisateurId,
  ]);
  const codes = await remplacerCodesSecours(db, t, cabinetId, utilisateurId);
  return { statut: "activee", codes };
}

/** Remplace tous les codes de secours ; renvoie les nouveaux en clair. */
export async function remplacerCodesSecours(
  db: Db,
  t: Trousseau,
  cabinetId: string,
  utilisateurId: string,
): Promise<string[]> {
  await db.query("DELETE FROM codes_secours_2fa WHERE utilisateur_id = $1", [utilisateurId]);
  const codes = genererCodesSecours();
  await db.query(
    `INSERT INTO codes_secours_2fa (cabinet_id, utilisateur_id, code_hash, cle_version)
     SELECT $1, $2, h, $4 FROM unnest($3::text[]) AS h`,
    [
      cabinetId,
      utilisateurId,
      codes.map((c) => empreinteCode(t, t.versionActuelle, utilisateurId, c)),
      t.versionActuelle,
    ],
  );
  return codes;
}

/**
 * Blocage progressif après des échecs CONSÉCUTIFS (constat M5), persistant en
 * base : 5 échecs → 1 min, 8 → 15 min, 12 → 1 h (à chaque nouvel échec au-delà
 * du palier). Remis à zéro par un succès.
 */
export function dureeBlocageMs(echecs: number): number | null {
  if (echecs >= 12) return 60 * 60 * 1000;
  if (echecs >= 8) return 15 * 60 * 1000;
  if (echecs >= 5) return 60 * 1000;
  return null;
}

/** Paliers à partir desquels l'utilisateur est prévenu par e-mail. */
export const ECHECS_ALERTE = [8, 12] as const;

export class ErreurTfaBloquee extends AppError {
  constructor() {
    super(
      429,
      "TFA_BLOQUEE",
      "Trop de codes de vérification incorrects : réessayez dans quelques minutes.",
    );
  }
}

/** Enregistre un échec sur la ligne verrouillée ; alerte l'utilisateur à 8 et 12 échecs. */
async function enregistrerEchec(
  db: Db,
  t: Trousseau,
  utilisateurId: string,
  ligne: LigneTfa,
  maintenantMs: number,
): Promise<void> {
  const echecs = Math.min(ligne.echecs + 1, 10_000);
  const duree = dureeBlocageMs(echecs);
  await db.query(
    "UPDATE utilisateurs_2fa SET echecs = $2, bloque_jusqu_au = $3 WHERE utilisateur_id = $1",
    [utilisateurId, echecs, duree === null ? null : new Date(maintenantMs + duree)],
  );
  if ((ECHECS_ALERTE as readonly number[]).includes(echecs)) {
    await notifierAvecEmailEnFile(db, t, {
      cabinetId: ligne.cabinet_id,
      destinataireId: utilisateurId,
      type: "securite_tfa_echecs",
      titre: "Codes de vérification incorrects répétés sur votre compte",
      corps: [
        `${echecs} codes de vérification incorrects ont été saisis à la suite sur votre compte.`,
        "La vérification est temporairement bloquée.",
        "Si ce n'était pas vous, votre mot de passe est connu d'un tiers : changez-le",
        "et prévenez un associé du cabinet.",
      ].join("\n"),
      lien: "/compte",
    });
  }
}

/**
 * Vérifie un second facteur d'un utilisateur dont la 2FA est active. Un code
 * de secours reconnu est consommé. Renvoie le facteur reconnu, ou null.
 *
 * Sous le verrou de la ligne (FOR UPDATE) : refus sans vérification pendant
 * un blocage (ErreurTfaBloquee, 429), compteur d'échecs consécutifs incrémenté
 * à chaque code faux et remis à zéro au succès. L'appelant VALIDE la
 * transaction après un échec (sinon le compteur ne serait pas enregistré).
 * Le limiteur en mémoire des routes reste la première barrière.
 */
export async function verifierFacteur(
  db: Db,
  t: Trousseau,
  utilisateurId: string,
  facteur: Facteur,
  maintenantMs = Date.now(),
): Promise<FacteurReconnu | null> {
  const r = await db.query(
    `SELECT cabinet_id, secret_chiffre, cle_version, dernier_pas, active_le, echecs, bloque_jusqu_au
     FROM utilisateurs_2fa WHERE utilisateur_id = $1 AND active_le IS NOT NULL FOR UPDATE`,
    [utilisateurId],
  );
  const ligne = r.rows[0] as LigneTfa | undefined;
  if (!ligne) return null;
  if (ligne.bloque_jusqu_au && ligne.bloque_jusqu_au.getTime() > maintenantMs) {
    throw new ErreurTfaBloquee();
  }
  let reconnu: FacteurReconnu | null;
  if ("code" in facteur) {
    reconnu = (await verifierCodeTotp(db, t, utilisateurId, ligne, facteur.code, maintenantMs))
      ? "totp"
      : null;
  } else {
    const empreintes = t
      .versions()
      .map((v) => empreinteCode(t, v, utilisateurId, facteur.code_secours));
    const consomme = await db.query(
      `UPDATE codes_secours_2fa SET utilise_le = now()
       WHERE utilisateur_id = $1 AND utilise_le IS NULL AND code_hash = ANY ($2::text[])
       RETURNING id`,
      [utilisateurId, empreintes],
    );
    reconnu = consomme.rowCount ? "code_secours" : null;
  }
  if (reconnu === null) {
    await enregistrerEchec(db, t, utilisateurId, ligne, maintenantMs);
  } else if (ligne.echecs > 0 || ligne.bloque_jusqu_au) {
    await db.query(
      "UPDATE utilisateurs_2fa SET echecs = 0, bloque_jusqu_au = NULL WHERE utilisateur_id = $1",
      [utilisateurId],
    );
  }
  return reconnu;
}

/** Supprime la 2FA d'un utilisateur (secret, codes de secours, défis en cours). */
export async function supprimerTfa(db: Db, utilisateurId: string): Promise<boolean> {
  const r = await db.query("DELETE FROM utilisateurs_2fa WHERE utilisateur_id = $1", [
    utilisateurId,
  ]);
  await db.query("DELETE FROM codes_secours_2fa WHERE utilisateur_id = $1", [utilisateurId]);
  await db.query("DELETE FROM defis_2fa WHERE utilisateur_id = $1", [utilisateurId]);
  return Boolean(r.rowCount);
}

/** Crée un défi de connexion (haché en base) ; purge les défis périmés de l'utilisateur. */
export async function creerDefi(
  db: Db,
  cabinetId: string,
  utilisateurId: string,
  defiHash: string,
): Promise<void> {
  await db.query(
    `DELETE FROM defis_2fa WHERE utilisateur_id = $1
       AND (expire_le <= now() OR consomme_le IS NOT NULL)`,
    [utilisateurId],
  );
  await db.query(
    `INSERT INTO defis_2fa (cabinet_id, utilisateur_id, defi_hash, expire_le)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
    [cabinetId, utilisateurId, defiHash, String(DUREE_DEFI_MS)],
  );
}

/** Réserve une tentative sur le défi AVANT la vérification ; faux si épuisé, expiré ou consommé. */
export async function reserverTentativeDefi(db: Db, defiId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE defis_2fa SET tentatives = tentatives + 1
     WHERE id = $1 AND consomme_le IS NULL AND expire_le > now() AND tentatives < $2
     RETURNING id`,
    [defiId, TENTATIVES_PAR_DEFI],
  );
  return Boolean(r.rowCount);
}

/** Consomme le défi (usage unique) ; faux s'il l'a déjà été. */
export async function consommerDefi(db: Db, defiId: string): Promise<boolean> {
  const r = await db.query(
    "UPDATE defis_2fa SET consomme_le = now() WHERE id = $1 AND consomme_le IS NULL RETURNING id",
    [defiId],
  );
  return Boolean(r.rowCount);
}
