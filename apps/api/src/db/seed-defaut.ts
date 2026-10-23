import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ROLES, ROLES_CLIENT, type Role } from "@missionpilot/shared";
import { hashPassword } from "../auth/password.js";
import type { Config } from "../config.js";
import { createDatabase, type Database } from "./pool.js";
import {
  completerRolesClientDemo,
  semerPortailDemo,
  type ComptePortail,
} from "./seed-demo-portail.js";
import {
  configDemo,
  demoPubliqueConfirmee,
  emailAbidjan,
  MOT_DE_PASSE_DEMO_ABIDJAN,
  neutraliserEnvois,
  NOM_CABINET_ABIDJAN,
  semerDemoAbidjan,
} from "./seed-demo.js";

/*
 * Tenant PAR DÉFAUT de démonstration : le cabinet « Lagune Conseil & Associés (démo) »
 * (`seed-demo.ts`, avec le portail client de `seed-demo-portail.ts`), un compte actif sans 2FA
 * pour CHAQUE rôle du cabinet (`ROLES`) et du portail client (`ROLES_CLIENT`), marqué
 * `cabinets.est_demo = true`, plus un SUPER ADMIN de démonstration (`super_admins.est_demo`).
 *
 *   pnpm --filter @missionpilot/api db:seed-defaut
 *
 * Une seule commande, idempotente : cabinet absent, il est créé (plusieurs minutes, par les vraies
 * routes) ; présent, rien n'est dupliqué : le portail est repris s'il manque, un compte est ajouté
 * pour tout rôle qui n'en aurait plus, le drapeau `est_demo` est posé (UPDATE avec le rôle
 * propriétaire, même si le cabinet existait avant), le super admin de démonstration est créé s'il
 * manque. `est_demo` n'est JAMAIS posé sur un autre cabinet : le cabinet visé est celui du compte
 * fondateur, et il doit porter le nom exact du cabinet de démonstration (sinon refus net).
 *
 * Les comptes à 2FA (`seed-demo-2fa.ts`) restent semés par `seed-demo.ts` pour les parcours de
 * signature, mais ne comptent pas dans la couverture des rôles (la connexion en un clic les refuse).
 *
 * Gardes (`configDemo`) : développement/test avec bases locales ; hors développement SEULEMENT si
 * DEMO_PUBLIQUE=oui est défini ET l'option `--confirmer-demo` est passée. Dans ce second cas
 * aucune configuration SMTP n'est conservée (jamais de connexion SMTP, adresses en `.test`), et
 * seul le tenant marqué démonstration est écrit. Sur le serveur :
 *
 *   docker compose run --rm api node_modules/.bin/tsx src/db/seed-defaut.ts --confirmer-demo
 *
 * (avec DEMO_PUBLIQUE=oui dans l'environnement du serveur). Ce fichier n'importe rien hors de
 * `apps/api` et des paquets du dépôt : il tourne dans l'image de production.
 */

/** Mot de passe du super admin de démonstration (démonstration seulement, jamais à réutiliser). */
export const MOT_DE_PASSE_DEMO_SUPER_ADMIN = "Demo-SuperAdmin-2026";
export const EMAIL_SUPER_ADMIN_DEMO = "superadmin@demo.missionpilot.test";
export const NOM_SUPER_ADMIN_DEMO = "Super administrateur (démo)";

export interface ResumeDefaut {
  cabinetId: string;
  /** Vrai si le cabinet a été créé par cette exécution. */
  cabinetCree: boolean;
  /** Vrai si le portail client a été (re)semé par cette exécution (cabinet préexistant). */
  portailRepris: boolean;
  /** Adresses des comptes ajoutés pour couvrir un rôle manquant. */
  comptesAjoutes: string[];
  superAdminCree: boolean;
}

/* ----- Cabinet de démonstration ----- */

/**
 * Identifiant du cabinet de démonstration s'il existe (cabinet du compte fondateur). Refuse net
 * si l'adresse fondatrice appartient à un cabinet qui n'a pas le nom du cabinet de démonstration.
 */
export async function trouverCabinetDemo(
  database: Database,
  proprietaire: pg.Client,
): Promise<{ id: string; actif: boolean } | null> {
  const ancre = await database.withoutTenant(async (c) => {
    const r = await c.query("SELECT cabinet_id FROM trouver_connexion($1)", [
      emailAbidjan("associe"),
    ]);
    return (r.rows[0]?.cabinet_id as string | undefined) ?? null;
  });
  if (!ancre) return null;
  const r = await proprietaire.query("SELECT nom, actif FROM cabinets WHERE id = $1", [ancre]);
  if (r.rows[0]?.nom !== NOM_CABINET_ABIDJAN) {
    throw new Error(
      `L'adresse ${emailAbidjan("associe")} appartient à un cabinet qui n'est pas « ` +
        `${NOM_CABINET_ABIDJAN} » : refus, rien n'a été écrit (aucun drapeau de démonstration).`,
    );
  }
  return { id: ancre, actif: r.rows[0].actif as boolean };
}

/** Pose `est_demo` sur CE cabinet et sur aucun autre (rôle propriétaire, réservé par déclencheur). */
async function marquerCabinetDemo(proprietaire: pg.Client, cabinetId: string): Promise<void> {
  const r = await proprietaire.query(
    "UPDATE cabinets SET est_demo = true WHERE id = $1 AND nom = $2",
    [cabinetId, NOM_CABINET_ABIDJAN],
  );
  if (r.rowCount !== 1) throw new Error("Le cabinet de démonstration n'a pas pu être marqué.");
}

/* ----- Couverture des rôles ----- */

/**
 * Rôles pour lesquels le cabinet a au moins un compte ACTIF sans 2FA active (rôles du portail :
 * rattachement actif à un client). C'est ce que la connexion en un clic peut proposer.
 */
export async function rolesCouverts(database: Database, cabinetId: string): Promise<Set<Role>> {
  const lignes = await database.withTenant(cabinetId, async (c) => {
    const r = await c.query(
      `SELECT u.roles,
              EXISTS (SELECT 1 FROM utilisateurs_2fa f
                      WHERE f.utilisateur_id = u.id AND f.active_le IS NOT NULL) AS avec_2fa,
              EXISTS (SELECT 1 FROM utilisateurs_portail p
                      WHERE p.utilisateur_id = u.id AND p.statut = 'actif') AS portail_actif
       FROM utilisateurs u WHERE u.actif`,
    );
    return r.rows as { roles: string[]; avec_2fa: boolean; portail_actif: boolean }[];
  });
  const clients = new Set<string>(ROLES_CLIENT);
  const couverts = new Set<Role>();
  for (const l of lignes) {
    if (l.avec_2fa) continue;
    for (const role of l.roles) {
      if (clients.has(role) && !l.portail_actif) continue;
      couverts.add(role as Role);
    }
  }
  return couverts;
}

/** Ajoute, par SQL propriétaire du cabinet, un compte pour chaque rôle du cabinet donné. */
async function ajouterComptesCabinet(
  database: Database,
  cabinetId: string,
  roles: readonly string[],
): Promise<string[]> {
  if (roles.length === 0) return [];
  const hash = await hashPassword(MOT_DE_PASSE_DEMO_ABIDJAN);
  const emails: string[] = [];
  await database.withTenant(cabinetId, async (c) => {
    for (const role of roles) {
      const email = emailAbidjan(`${role.replace(/_/g, ".")}.complement`);
      const existant = await c.query("SELECT id FROM utilisateurs WHERE lower(email) = $1", [
        email,
      ]);
      if (existant.rowCount) {
        await c.query("UPDATE utilisateurs SET actif = true WHERE id = $1", [existant.rows[0].id]);
      } else {
        await c.query(
          `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [cabinetId, email, `Compte ${role} (démo)`, [role], hash],
        );
      }
      emails.push(email);
    }
  });
  return emails;
}

/** Complète les comptes pour que chaque rôle de `TOUS_LES_ROLES` soit couvert ; renvoie les ajouts. */
export async function completerRoles(
  database: Database,
  config: Config,
  cabinetId: string,
): Promise<string[]> {
  const couverts = await rolesCouverts(database, cabinetId);
  const ajoutes = await ajouterComptesCabinet(
    database,
    cabinetId,
    ROLES.filter((r) => !couverts.has(r)),
  );
  const clients = ROLES_CLIENT.filter((r) => !couverts.has(r));
  return [
    ...ajoutes,
    ...(await completerRolesClientDemo(database, config, clients as ComptePortail["role"][])),
  ];
}

/* ----- Super admin de démonstration ----- */

/**
 * Crée le super admin de démonstration (`est_demo = true`) s'il n'existe pas. Un super admin
 * existant à cette adresse mais NON marqué démonstration est un vrai compte : refus net (le
 * seed ne le marque jamais, sinon il deviendrait connectable sans mot de passe).
 */
export async function semerSuperAdminDemo(proprietaire: pg.Client): Promise<boolean> {
  const lire = () =>
    proprietaire.query("SELECT est_demo FROM super_admins WHERE lower(email) = lower($1)", [
      EMAIL_SUPER_ADMIN_DEMO,
    ]);
  let existant = await lire();
  let cree = false;
  if (!existant.rowCount) {
    const hash = await hashPassword(MOT_DE_PASSE_DEMO_SUPER_ADMIN);
    const r = await proprietaire.query(
      `INSERT INTO super_admins (email, nom, mot_de_passe_hash, est_demo)
       VALUES ($1, $2, $3, true) ON CONFLICT (lower(email)) DO NOTHING`,
      [EMAIL_SUPER_ADMIN_DEMO, NOM_SUPER_ADMIN_DEMO, hash],
    );
    cree = r.rowCount === 1;
    existant = await lire();
  }
  if (existant.rows[0]?.est_demo !== true) {
    throw new Error(
      `Un super admin réel existe déjà à l'adresse ${EMAIL_SUPER_ADMIN_DEMO} : refus, ` +
        "il n'est pas marqué démonstration et ne le sera pas.",
    );
  }
  return cree;
}

/* ----- Orchestration ----- */

/** Cabinet, comptes, portail, drapeaux de démonstration et super admin de démonstration. */
export async function semerDefaut(
  baseBrute: Database,
  config: Config,
  options: { publique: boolean; journal?: (ligne: string) => void },
): Promise<ResumeDefaut> {
  const journal = options.journal ?? console.log;
  // Démonstration publique : aucun job d'envoi créé par le seed ne survit à sa transaction.
  const database = options.publique ? neutraliserEnvois(baseBrute) : baseBrute;
  const proprietaire = new pg.Client({ connectionString: config.DATABASE_OWNER_URL });
  await proprietaire.connect();
  try {
    const existant = await trouverCabinetDemo(database, proprietaire);
    let cabinetId: string;
    let portailRepris = false;
    if (existant) {
      cabinetId = existant.id;
      if (!existant.actif) {
        journal("Attention : le cabinet de démonstration est désactivé (console plateforme).");
      }
      journal(`${NOM_CABINET_ABIDJAN} existe déjà : il est complété, pas recréé.`);
      // Reprise d'un semis interrompu avant le portail (null si les comptes du portail existent).
      portailRepris = (await semerPortailDemo(database, config)) !== null;
    } else {
      journal(`Création de ${NOM_CABINET_ABIDJAN} (plusieurs minutes)…`);
      const r = await semerDemoAbidjan(database, config);
      if (!r) throw new Error("Le cabinet de démonstration existe déjà (création concurrente).");
      cabinetId = r.cabinetId;
    }
    const comptesAjoutes = await completerRoles(database, config, cabinetId);
    await marquerCabinetDemo(proprietaire, cabinetId);
    const superAdminCree = await semerSuperAdminDemo(proprietaire);
    return { cabinetId, cabinetCree: !existant, portailRepris, comptesAjoutes, superAdminCree };
  } finally {
    await proprietaire.end();
  }
}

function afficher(resume: ResumeDefaut, publique: boolean): void {
  console.log(
    `${NOM_CABINET_ABIDJAN} : ${resume.cabinetCree ? "créé" : "déjà présent"}, marqué démonstration.`,
  );
  if (resume.portailRepris) console.log("Portail client de démonstration repris.");
  for (const email of resume.comptesAjoutes) console.log(`Compte ajouté pour un rôle : ${email}`);
  console.log(
    `Super admin de démonstration : ${EMAIL_SUPER_ADMIN_DEMO} (${resume.superAdminCree ? "créé" : "déjà présent"}).`,
  );
  console.log(
    "Mots de passe : MOT_DE_PASSE_DEMO_ABIDJAN (seed-demo.ts) pour les comptes du cabinet et du " +
      "portail, MOT_DE_PASSE_DEMO_SUPER_ADMIN (seed-defaut.ts) pour le super admin : " +
      "démonstration uniquement, jamais à réutiliser ailleurs.",
  );
  if (publique) {
    console.log("Mode démonstration publique : aucun e-mail envoyé, aucun job d'envoi conservé.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let config: Config;
  try {
    config = configDemo(process.env, process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const database = createDatabase(config);
  const publique = demoPubliqueConfirmee(process.env, process.argv.slice(2));
  semerDefaut(database, config, { publique })
    .then((r) => afficher(r, publique))
    .catch((error: Error) => {
      console.error(`Échec du seed du tenant par défaut : ${error.message}`);
      console.error(
        "Cabinet déjà présent : relancer la commande complète ce qui manque sans rien dupliquer. " +
          "Cabinet à moitié semé à la création : repartir d'une base neuve.",
      );
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
