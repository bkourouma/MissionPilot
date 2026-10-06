import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "@missionpilot/shared";
import { hashPassword } from "../auth/password.js";
import { semerCatalogueConseil } from "../catalogue/catalogue-conseil.js";
import { loadConfig } from "../config.js";
import { createDatabase, type Database, type Db } from "./pool.js";

/*
 * Données de démonstration locales (jamais en production). Toutes les
 * entreprises et personnes sont fictives.
 */

/** Mot de passe des comptes de démonstration : comptes de test locaux uniquement. */
export const MOT_DE_PASSE_DEMO = "Demo-MissionPilot-2026";
export const NOM_CABINET_DEMO = "Cabinet Démo";

const UTILISATEURS_DEMO: readonly { role: Role; nom: string }[] = [
  { role: "associe", nom: "Awa Koné" },
  { role: "directeur_mission", nom: "Yao Kouassi" },
  { role: "chef_mission", nom: "Mariam Traoré" },
  { role: "consultant", nom: "Koffi N'Guessan" },
  { role: "ressources", nom: "Fatou Diallo" },
  { role: "gestionnaire", nom: "Serge Bamba" },
  { role: "expert_metier", nom: "Aminata Ouattara" },
  { role: "expert_externe", nom: "Ibrahim Sanogo" },
];

export const emailDemo = (role: Role) => `${role.replace(/_/g, ".")}@demo.missionpilot.test`;

const CLIENTS_DEMO = [
  {
    raison_sociale: "Kora Agro-Industries (fictif)",
    forme: "SA",
    rccm: "CI-ABJ-DEMO-B-0001",
    cc: "DEMO0001A",
    secteur: "Agro-industrie",
    taille: "grande_entreprise",
  },
  {
    raison_sociale: "Lagune Microfinance (fictif)",
    forme: "SA",
    rccm: "CI-ABJ-DEMO-B-0002",
    cc: "DEMO0002B",
    secteur: "Microfinance",
    taille: "pme",
  },
  {
    raison_sociale: "Transports Akwaba (fictif)",
    forme: "SARL",
    rccm: "CI-ABJ-DEMO-B-0003",
    cc: "DEMO0003C",
    secteur: "Transport et logistique",
    taille: "pme",
  },
  {
    raison_sociale: "Mutuelle des Enseignants Démo (fictif)",
    forme: "Mutuelle",
    rccm: null,
    cc: "DEMO0004D",
    secteur: "Assurance",
    taille: "eti",
  },
] as const;

/** Collaborateurs : rôle de l'utilisateur rattaché (ou null pour un externe), grade, coût journalier FCFA. */
const COLLABORATEURS_DEMO = [
  {
    nom: "Awa Koné",
    role: "associe",
    grade: "associe",
    type: "interne",
    cout: 300_000,
    competences: ["Stratégie", "Gouvernance"],
  },
  {
    nom: "Yao Kouassi",
    role: "directeur_mission",
    grade: "directeur",
    type: "interne",
    cout: 220_000,
    competences: ["Organisation", "Conduite du changement"],
  },
  {
    nom: "Mariam Traoré",
    role: "chef_mission",
    grade: "manager",
    type: "interne",
    cout: 150_000,
    competences: ["Pilotage de projet", "Finance"],
  },
  {
    nom: "Koffi N'Guessan",
    role: "consultant",
    grade: "senior",
    type: "interne",
    cout: 90_000,
    competences: ["Analyse financière", "Modélisation"],
  },
  {
    nom: "Aminata Ouattara",
    role: "expert_metier",
    grade: "manager",
    type: "interne",
    cout: 160_000,
    competences: ["Microfinance"],
  },
  {
    nom: "Ibrahim Sanogo",
    role: "expert_externe",
    grade: "senior",
    type: "externe",
    cout: null,
    competences: ["Fiscalité"],
  },
] as const;

async function trouverOuCreerCabinet(database: Database, hash: string): Promise<string> {
  const email = emailDemo("associe");
  return database.withoutTenant(async (db) => {
    const existant = await db.query("SELECT cabinet_id FROM trouver_connexion($1)", [email]);
    if (existant.rows[0]) return existant.rows[0].cabinet_id as string;
    const r = await db.query("SELECT creer_cabinet($1, 'CI', $2, $3, $4) AS id", [
      NOM_CABINET_DEMO,
      email,
      "Awa Koné",
      hash,
    ]);
    return r.rows[0].id as string;
  });
}

async function semerUtilisateurs(
  db: Db,
  cabinetId: string,
  hash: string,
): Promise<Map<Role, string>> {
  const ids = new Map<Role, string>();
  for (const u of UTILISATEURS_DEMO) {
    const email = emailDemo(u.role);
    const existant = await db.query("SELECT id FROM utilisateurs WHERE lower(email) = $1", [email]);
    const id =
      existant.rows[0]?.id ??
      (
        await db.query(
          `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [cabinetId, email, u.nom, [u.role], hash],
        )
      ).rows[0].id;
    ids.set(u.role, id as string);
  }
  return ids;
}

async function semerClients(db: Db, cabinetId: string): Promise<void> {
  for (const c of CLIENTS_DEMO) {
    const existe = await db.query("SELECT 1 FROM clients WHERE raison_sociale = $1", [
      c.raison_sociale,
    ]);
    if (existe.rowCount) continue;
    const r = await db.query(
      `INSERT INTO clients (cabinet_id, raison_sociale, forme_juridique, rccm, compte_contribuable,
         secteur, pays, taille, adresse)
       VALUES ($1, $2, $3, $4, $5, $6, 'CI', $7, 'Abidjan, Côte d''Ivoire') RETURNING id`,
      [cabinetId, c.raison_sociale, c.forme, c.rccm, c.cc, c.secteur, c.taille],
    );
    await db.query(
      `INSERT INTO contacts_client (cabinet_id, client_id, nom, fonction, email, principal)
       VALUES ($1, $2, 'Contact Démo', 'Directeur général', $3, true)`,
      [cabinetId, r.rows[0].id, `contact.${r.rows[0].id.slice(0, 8)}@client.demo.test`],
    );
  }
}

async function semerCollaborateurs(
  db: Db,
  cabinetId: string,
  ids: Map<Role, string>,
): Promise<void> {
  for (const c of COLLABORATEURS_DEMO) {
    const existe = await db.query("SELECT 1 FROM collaborateurs WHERE nom = $1", [c.nom]);
    if (existe.rowCount) continue;
    const grade = await db.query("SELECT id FROM grades WHERE code = $1", [c.grade]);
    const r = await db.query(
      `INSERT INTO collaborateurs (cabinet_id, utilisateur_id, nom, grade_id, competences, secteurs,
         langues, type)
       VALUES ($1, $2, $3, $4, $5, '{}', '{français}', $6) RETURNING id`,
      [
        cabinetId,
        c.type === "interne" ? (ids.get(c.role) ?? null) : null,
        c.nom,
        grade.rows[0]?.id ?? null,
        c.competences,
        c.type,
      ],
    );
    await db.query(
      `INSERT INTO collaborateur_couts (cabinet_id, collaborateur_id, cout_journalier, cout_achat,
         devise, depuis_le)
       VALUES ($1, $2, $3, $4, 'XOF', date_trunc('year', current_date)::date)`,
      [cabinetId, r.rows[0].id, c.cout, c.type === "interne" ? null : 200_000],
    );
  }
}

/** Crée ou complète le cabinet de démonstration. Idempotent. */
export async function seed(database: Database, env = process.env): Promise<string> {
  if (env.NODE_ENV === "production") {
    throw new Error("Le seed de démonstration ne s'exécute jamais en production.");
  }
  const hash = await hashPassword(MOT_DE_PASSE_DEMO);
  const cabinetId = await trouverOuCreerCabinet(database, hash);
  await database.withTenant(cabinetId, async (db) => {
    const ids = await semerUtilisateurs(db, cabinetId, hash);
    await semerCatalogueConseil(db, cabinetId);
    await semerClients(db, cabinetId);
    await semerCollaborateurs(db, cabinetId, ids);
  });
  return cabinetId;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.env.NODE_ENV === "production") {
    console.error("Le seed de démonstration ne s'exécute jamais en production.");
    process.exit(1);
  }
  const database = createDatabase(loadConfig());
  seed(database)
    .then(() => {
      console.log(`${NOM_CABINET_DEMO} prêt. Comptes : <role>@demo.missionpilot.test`);
      console.log(
        "(ex. associe@demo.missionpilot.test) ; mot de passe : MOT_DE_PASSE_DEMO dans src/db/seed.ts",
      );
    })
    .catch((error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
