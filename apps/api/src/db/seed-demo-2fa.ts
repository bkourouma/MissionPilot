import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import { chiffrer, trousseauDepuisConfig, type Trousseau } from "../auth/chiffrement.js";
import { aadSecret, remplacerCodesSecours } from "../auth/double-authentification.js";
import { hashPassword } from "../auth/password.js";
import { base32Decoder, totp } from "../auth/totp.js";
import { dossierStockage, type Config } from "../config.js";
import { createDatabase, type Database, type Db } from "./pool.js";
import { CLIENT_PORTAIL_DEMO, inviterEtAccepter } from "./seed-demo-portail.js";
import {
  attendre,
  configDemo,
  emailAbidjan,
  MOT_DE_PASSE_DEMO_ABIDJAN,
  NOM_CABINET_ABIDJAN,
  ouvrirSession,
} from "./seed-demo.js";

/*
 * Comptes de démonstration AVEC double authentification active, pour jouer de bout en bout
 * les actions qui l'exigent (signature d'un document : 409 TFA_INACTIVE sans elle). Jamais en
 * production : mêmes gardes que `seed-demo.ts` (NODE_ENV local, bases locales).
 *
 *   pnpm --filter @missionpilot/api db:seed-demo-2fa     (base déjà peuplée par db:seed-demo)
 *   pnpm --filter @missionpilot/api db:code-2fa-demo     (affiche le code à 6 chiffres du moment)
 *
 * Le secret TOTP est CONSTANT et publié ci-dessous : n'importe qui peut calculer le code. C'est
 * voulu pour la recette locale, et c'est pourquoi la connexion rapide refuse ces comptes (elle ne
 * contourne jamais la 2FA) : on se connecte par le formulaire (e-mail, mot de passe commun
 * `MOT_DE_PASSE_DEMO_ABIDJAN`, puis le code). Pour ajouter une application d'authentification :
 * saisir le secret ci-dessous (clé de configuration manuelle).
 */

/** 20 octets en base32 : secret TOTP de TOUS les comptes 2FA de démonstration. */
export const SECRET_2FA_DEMO_BASE32 = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export const COMPTE_ASSOCIE_2FA = {
  cle: "associe.2fa",
  nom: "Fanta Doumbia",
  role: "associe",
} as const;

export const COMPTE_DIRIGEANT_2FA = {
  cle: "dirigeant.client.2fa",
  role: "client_dirigeant" as const,
  nom: "Salimata Bakayoko",
  fonction: "Directrice générale adjointe",
};

/** Code TOTP à 6 chiffres valable à l'instant `maintenantMs`. */
export function codeDemo2fa(maintenantMs = Date.now()): string {
  return totp(base32Decoder(SECRET_2FA_DEMO_BASE32), maintenantMs);
}

/**
 * Active la 2FA d'un utilisateur existant avec le secret de démonstration (écrase une 2FA non
 * confirmée ; ne touche pas une 2FA déjà active) et génère ses codes de secours (non conservés
 * par le script : la recette utilise le code TOTP). Renvoie faux si une 2FA active existait.
 */
export async function activer2faDemo(
  db: Db,
  trousseau: Trousseau,
  cabinetId: string,
  utilisateurId: string,
): Promise<boolean> {
  const c = chiffrer(
    trousseau,
    "totp",
    base32Decoder(SECRET_2FA_DEMO_BASE32),
    aadSecret(utilisateurId),
  );
  const r = await db.query(
    `INSERT INTO utilisateurs_2fa (utilisateur_id, cabinet_id, secret_chiffre, cle_version, active_le)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (utilisateur_id) DO UPDATE
       SET secret_chiffre = EXCLUDED.secret_chiffre, cle_version = EXCLUDED.cle_version,
           dernier_pas = NULL, active_le = now()
       WHERE utilisateurs_2fa.active_le IS NULL
     RETURNING utilisateur_id`,
    [utilisateurId, cabinetId, c.donnees, c.version],
  );
  if (!r.rowCount) return false;
  await remplacerCodesSecours(db, trousseau, cabinetId, utilisateurId);
  return true;
}

async function existe(database: Database, email: string): Promise<boolean> {
  return database.withoutTenant(async (c) => {
    const r = await c.query("SELECT 1 FROM trouver_connexion($1)", [email]);
    return (r.rowCount ?? 0) > 0;
  });
}

export interface Resume2fa {
  comptes: { email: string; nom: string; role: string }[];
}

/** Crée les deux comptes 2FA ; `null` s'ils existent déjà. */
export async function semerComptes2faDemo(
  database: Database,
  config: Config,
): Promise<Resume2fa | null> {
  if (!(await existe(database, emailAbidjan("associe")))) {
    throw new Error(
      `Le cabinet « ${NOM_CABINET_ABIDJAN} » n'existe pas dans cette base : lancer d'abord db:seed-demo.`,
    );
  }
  const emailAssocie2fa = emailAbidjan(COMPTE_ASSOCIE_2FA.cle);
  const emailDirigeant2fa = emailAbidjan(COMPTE_DIRIGEANT_2FA.cle);
  if (await existe(database, emailAssocie2fa)) return null;
  if (!(await existe(database, emailAbidjan("dirigeant.client")))) {
    throw new Error(
      "Les comptes du portail de démonstration n'existent pas : lancer db:seed-demo-portail.",
    );
  }
  const stockage = dossierStockage({ NODE_ENV: config.NODE_ENV, STORAGE_DIR: config.STORAGE_DIR });
  const app = await buildApp(
    { ...config, NODE_ENV: "test", TOTP_REQUIS: "non", STORAGE_DIR: stockage },
    database,
  );
  try {
    const associe = await ouvrirSession(app, emailAbidjan("associe"), "");
    const moi = await associe.get("/api/auth/moi");
    attendre(200, moi, "profil de l'associé");
    const cabinetId = moi.json().cabinet_id as string;
    const clients = await associe.get(
      `/api/clients?q=${encodeURIComponent(CLIENT_PORTAIL_DEMO)}&limite=10`,
    );
    attendre(200, clients, "clients");
    const client = (clients.json().elements as { id: string; raison_sociale: string }[]).find(
      (c) => c.raison_sociale === CLIENT_PORTAIL_DEMO,
    );
    if (!client) throw new Error(`Client « ${CLIENT_PORTAIL_DEMO} » introuvable.`);

    // Associé du cabinet : même insertion que le seed principal (mot de passe commun).
    const hash = await hashPassword(MOT_DE_PASSE_DEMO_ABIDJAN);
    const associe2faId = await database.withTenant(cabinetId, async (db) => {
      const r = await db.query(
        `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [cabinetId, emailAssocie2fa, COMPTE_ASSOCIE_2FA.nom, [COMPTE_ASSOCIE_2FA.role], hash],
      );
      return r.rows[0].id as string;
    });
    // Dirigeant client : invitation et acceptation par les vraies routes du portail.
    await inviterEtAccepter(app, database, cabinetId, associe, client.id, COMPTE_DIRIGEANT_2FA);
    const trousseau = trousseauDepuisConfig(config);
    await database.withTenant(cabinetId, async (db) => {
      const dirigeant = await db.query("SELECT id FROM utilisateurs WHERE lower(email) = $1", [
        emailDirigeant2fa,
      ]);
      await activer2faDemo(db, trousseau, cabinetId, associe2faId);
      await activer2faDemo(db, trousseau, cabinetId, dirigeant.rows[0].id as string);
    });
    return {
      comptes: [
        { email: emailAssocie2fa, nom: COMPTE_ASSOCIE_2FA.nom, role: "associe" },
        { email: emailDirigeant2fa, nom: COMPTE_DIRIGEANT_2FA.nom, role: "client_dirigeant" },
      ],
    };
  } finally {
    await app.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--code")) {
    console.log(codeDemo2fa());
  } else {
    let config: Config;
    try {
      config = configDemo();
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
    const database = createDatabase(config);
    semerComptes2faDemo(database, config)
      .then((r) => {
        if (!r) {
          console.error("Les comptes 2FA de démonstration existent déjà : rien n'a été écrit.");
          process.exitCode = 2;
          return;
        }
        console.log("Comptes de démonstration avec double authentification active :");
        for (const c of r.comptes) console.log(`  ${c.email} : ${c.nom} (${c.role})`);
        console.log(
          "Connexion par le formulaire : e-mail, mot de passe commun (MOT_DE_PASSE_DEMO_ABIDJAN " +
            "dans apps/api/src/db/seed-demo.ts), puis le code à 6 chiffres donné par " +
            "`pnpm --filter @missionpilot/api db:code-2fa-demo`. Secret TOTP constant (recette " +
            "locale seulement) : SECRET_2FA_DEMO_BASE32 dans apps/api/src/db/seed-demo-2fa.ts.",
        );
      })
      .catch((error: Error) => {
        console.error(`Échec du seed des comptes 2FA de démonstration : ${error.message}`);
        process.exitCode = 1;
      })
      .finally(() => database.close());
  }
}
