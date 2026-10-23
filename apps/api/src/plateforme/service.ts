import type { Db, Database } from "../db/pool.js";
import { AppError, conflit, introuvable, nonAuthentifie, requeteInvalide } from "../errors.js";
import { hashPassword } from "../auth/password.js";
import { genererMotDePasse } from "./mot-de-passe.js";
import type {
  CreerCabinet,
  CreerUtilisateur,
  ModifierCabinet,
  ModifierUtilisateur,
} from "./schemas.js";
import type { SessionPlateforme } from "./session.js";

/*
 * Accès à la plateforme : UNIQUEMENT les fonctions SQL `plateforme_*` (SECURITY DEFINER),
 * jamais les tables. Chaque opération reçoit le haché du jeton, que la fonction revérifie
 * et qui journalise dans la même transaction. Aucun secret (mot de passe, haché, jeton)
 * ne figure dans une erreur ou un log.
 */

export interface CabinetPlateforme {
  id: string;
  nom: string;
  pays: string;
  actif: boolean;
  estDemo: boolean;
  creeLe: string;
}
export interface CabinetListe extends CabinetPlateforme {
  nbUtilisateurs: number;
  nbUtilisateursActifs: number;
}
export interface UtilisateurPlateforme {
  id: string;
  email: string;
  nom: string;
  roles: string[];
  actif: boolean;
  creeLe: string;
}
interface LigneCabinet {
  id: string;
  nom: string;
  pays: string;
  actif: boolean;
  est_demo: boolean;
  cree_le: string;
}
interface LigneUtilisateur {
  id: string;
  email: string;
  nom: string;
  roles: string[];
  actif: boolean;
  cree_le: string;
}

export const identifiantsInvalides = () =>
  new AppError(401, "IDENTIFIANTS_INVALIDES", "E-mail ou mot de passe incorrect.");

/**
 * Refus propres au super admin de démonstration (migration 0582) : MQP04 portant un indice
 * SQL (HINT) stable. Le message renvoyé est celui-ci, jamais le texte de l'erreur SQL.
 */
const REFUS_DEMO: Readonly<Record<string, string>> = {
  demo_email_test: "Une adresse en .test est exigée en mode démonstration.",
  demo_plafond_cabinets: "Plafond de la démonstration atteint : 30 cabinets au plus.",
  demo_plafond_utilisateurs:
    "Plafond de la démonstration atteint : 40 comptes au plus par cabinet.",
};

/** Traduit les erreurs `MQP` (et l'unicité d'e-mail) en erreurs d'API ; le reste remonte tel quel. */
export function traduireErreurPlateforme(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "MQP01") throw nonAuthentifie();
  if (code === "MQP02") throw introuvable("Cabinet");
  if (code === "MQP03") throw introuvable("Utilisateur");
  if (code === "MQP04") {
    const indice = (error as { hint?: unknown }).hint;
    if (typeof indice === "string" && Object.hasOwn(REFUS_DEMO, indice))
      throw requeteInvalide(REFUS_DEMO[indice]!);
    throw requeteInvalide("Données refusées : rôle, nom, e-mail ou pays invalide.");
  }
  if (code === "MQP05")
    throw new AppError(
      409,
      "DERNIER_ASSOCIE",
      "Le cabinet doit conserver au moins un associé actif.",
    );
  if (code === "23505") throw conflit("Un compte existe déjà avec cet e-mail.");
  throw error;
}

/** Transaction sans cabinet, erreurs traduites. */
async function operer<T>(database: Database, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await database.withoutTenant(fn);
  } catch (error) {
    return traduireErreurPlateforme(error);
  }
}

const versCabinet = (l: LigneCabinet): CabinetPlateforme => ({
  id: l.id,
  nom: l.nom,
  pays: l.pays,
  actif: l.actif,
  estDemo: l.est_demo,
  creeLe: l.cree_le,
});
const versUtilisateur = (l: LigneUtilisateur): UtilisateurPlateforme => ({
  id: l.id,
  email: l.email,
  nom: l.nom,
  roles: l.roles,
  actif: l.actif,
  creeLe: l.cree_le,
});

/** Mot de passe fourni, ou généré (renvoyé alors une seule fois), et son haché. */
async function preparerMotDePasse(
  fourni: string | undefined,
): Promise<{ hash: string; genere: string | null }> {
  const genere = fourni === undefined ? genererMotDePasse() : null;
  return { hash: await hashPassword(fourni ?? genere!), genere };
}

// --- Connexion (sans session) --------------------------------------------------

export interface ConnexionTrouvee {
  super_admin_id: string;
  mot_de_passe_hash: string;
  actif: boolean;
}

export async function trouverConnexion(
  database: Database,
  email: string,
): Promise<ConnexionTrouvee | undefined> {
  return operer(database, async (db) => {
    const r = await db.query("SELECT * FROM plateforme_trouver_connexion($1)", [email]);
    return r.rows[0] as ConnexionTrouvee | undefined;
  });
}

/** Un refus de la fonction (admin devenu inactif entre-temps) reste un échec d'identifiants. */
export async function ouvrirSession(
  database: Database,
  superAdminId: string,
  jetonHash: string,
): Promise<void> {
  try {
    await operer(database, (db) =>
      db.query("SELECT plateforme_ouvrir_session($1, $2)", [superAdminId, jetonHash]),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "NON_AUTHENTIFIE")
      throw identifiantsInvalides();
    throw error;
  }
}

/** Ne transmet que l'identifiant : ni l'e-mail saisi ni le mot de passe n'atteignent le journal. */
export async function echecConnexion(database: Database, superAdminId: string): Promise<void> {
  await operer(database, (db) => db.query("SELECT plateforme_echec_connexion($1)", [superAdminId]));
}

export async function resoudreSession(
  database: Database,
  jetonHash: string,
): Promise<SessionPlateforme | undefined> {
  return operer(database, async (db) => {
    const r = await db.query("SELECT * FROM plateforme_resoudre_session($1)", [jetonHash]);
    const l = r.rows[0] as
      { super_admin_id: string; email: string; nom: string; est_demo: boolean } | undefined;
    return (
      l && {
        superAdminId: l.super_admin_id,
        email: l.email,
        nom: l.nom,
        estDemo: l.est_demo,
        jetonHash,
      }
    );
  });
}

export async function fermerSession(database: Database, jetonHash: string): Promise<void> {
  await operer(database, (db) => db.query("SELECT plateforme_fermer_session($1)", [jetonHash]));
}

// --- Cabinets ------------------------------------------------------------------

async function lireCabinets(db: Db, jeton: string): Promise<CabinetListe[]> {
  const r = await db.query("SELECT * FROM plateforme_lister_cabinets($1)", [jeton]);
  return (
    r.rows as (LigneCabinet & { nb_utilisateurs: number; nb_utilisateurs_actifs: number })[]
  ).map((l) => ({
    ...versCabinet(l),
    nbUtilisateurs: l.nb_utilisateurs,
    nbUtilisateursActifs: l.nb_utilisateurs_actifs,
  }));
}

export const listerCabinets = (database: Database, jeton: string): Promise<CabinetListe[]> =>
  operer(database, (db) => lireCabinets(db, jeton));

async function lireUtilisateurs(
  db: Db,
  jeton: string,
  cabinetId: string,
): Promise<UtilisateurPlateforme[]> {
  const r = await db.query("SELECT * FROM plateforme_lister_utilisateurs($1, $2)", [
    jeton,
    cabinetId,
  ]);
  return (r.rows as LigneUtilisateur[]).map(versUtilisateur);
}

export const listerUtilisateurs = (
  database: Database,
  jeton: string,
  cabinetId: string,
): Promise<UtilisateurPlateforme[]> =>
  operer(database, (db) => lireUtilisateurs(db, jeton, cabinetId));

export async function creerCabinet(database: Database, jeton: string, corps: CreerCabinet) {
  const { hash, genere } = await preparerMotDePasse(corps.associe.motDePasse);
  return operer(database, async (db) => {
    const r = await db.query("SELECT * FROM plateforme_creer_cabinet($1, $2, $3, $4, $5, $6)", [
      jeton,
      corps.nom,
      corps.pays,
      corps.associe.email,
      corps.associe.nom,
      hash,
    ]);
    const cree = r.rows[0] as { cabinet_id: string; utilisateur_id: string };
    // Relecture dans la même transaction : la fonction de création ne renvoie que les identifiants.
    const cabinet = (await lireCabinets(db, jeton)).find((c) => c.id === cree.cabinet_id);
    const associe = (await lireUtilisateurs(db, jeton, cree.cabinet_id)).find(
      (u) => u.id === cree.utilisateur_id,
    );
    if (!cabinet || !associe) throw new Error("Cabinet créé introuvable à la relecture.");
    const entete: CabinetPlateforme = {
      id: cabinet.id,
      nom: cabinet.nom,
      pays: cabinet.pays,
      actif: cabinet.actif,
      estDemo: cabinet.estDemo,
      creeLe: cabinet.creeLe,
    };
    return { cabinet: entete, associe, motDePasseGenere: genere };
  });
}

export async function modifierCabinet(
  database: Database,
  jeton: string,
  cabinetId: string,
  corps: ModifierCabinet,
): Promise<CabinetPlateforme> {
  return operer(database, async (db) => {
    const r = await db.query("SELECT * FROM plateforme_modifier_cabinet($1, $2, $3, $4)", [
      jeton,
      cabinetId,
      corps.nom ?? null,
      corps.actif ?? null,
    ]);
    return versCabinet(r.rows[0] as LigneCabinet);
  });
}

// --- Utilisateurs --------------------------------------------------------------

export async function creerUtilisateur(
  database: Database,
  jeton: string,
  cabinetId: string,
  corps: CreerUtilisateur,
) {
  const { hash, genere } = await preparerMotDePasse(corps.motDePasse);
  return operer(database, async (db) => {
    const r = await db.query("SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, $4, $5, $6)", [
      jeton,
      cabinetId,
      corps.email,
      corps.nom,
      corps.roles,
      hash,
    ]);
    return {
      utilisateur: versUtilisateur(r.rows[0] as LigneUtilisateur),
      motDePasseGenere: genere,
    };
  });
}

export async function modifierUtilisateur(
  database: Database,
  jeton: string,
  cabinetId: string,
  utilisateurId: string,
  corps: ModifierUtilisateur,
): Promise<UtilisateurPlateforme> {
  return operer(database, async (db) => {
    const r = await db.query("SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, $4, $5)", [
      jeton,
      cabinetId,
      utilisateurId,
      corps.actif ?? null,
      corps.roles ?? null,
    ]);
    return versUtilisateur(r.rows[0] as LigneUtilisateur);
  });
}
