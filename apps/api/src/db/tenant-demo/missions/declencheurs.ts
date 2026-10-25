import type pg from "pg";

/*
 * Transaction d'antidatage du seed : remonte des DATES (jamais du contenu) en SQL du rôle
 * propriétaire, en levant le temps strictement nécessaire les déclencheurs d'immuabilité qui
 * protègent des lignes figées.
 *
 * Garanties : (1) `lock_timeout` 5 s et `statement_timeout` 60 s, locaux à la transaction ;
 * (2) les UPDATE qui n'ont besoin d'aucune levée passent AVANT (`avant`) ; (3) verrous pris, puis
 * déclencheurs levés, dans un ordre alphabétique FIXE des tables, commun à tous les appelants
 * (pas d'interblocage) ; (4) déclencheurs rétablis juste après `pendant` ; (5) une erreur annule
 * tout, y compris les levées (DDL transactionnelle). Requêtes littérales : aucun nom de table
 * ni de déclencheur n'est interpolé.
 */

interface Instructions {
  verrou: string;
  lever: string;
  rendre: string;
}

/** Déclencheurs levables, par table, dans l'ordre alphabétique des tables. */
const INSTRUCTIONS = {
  bilans_mission: {
    verrou: "LOCK TABLE bilans_mission IN SHARE ROW EXCLUSIVE MODE",
    lever: "ALTER TABLE bilans_mission DISABLE TRIGGER bilans_mission_controle",
    rendre: "ALTER TABLE bilans_mission ENABLE TRIGGER bilans_mission_controle",
  },
  budget_versions: {
    verrou: "LOCK TABLE budget_versions IN SHARE ROW EXCLUSIVE MODE",
    lever: "ALTER TABLE budget_versions DISABLE TRIGGER budget_versions_figees",
    rendre: "ALTER TABLE budget_versions ENABLE TRIGGER budget_versions_figees",
  },
  cloture_verifications: {
    verrou: "LOCK TABLE cloture_verifications IN SHARE ROW EXCLUSIVE MODE",
    lever: "ALTER TABLE cloture_verifications DISABLE TRIGGER cloture_verifications_ajout_seul",
    rendre: "ALTER TABLE cloture_verifications ENABLE TRIGGER cloture_verifications_ajout_seul",
  },
  mission_documents: {
    verrou: "LOCK TABLE mission_documents IN SHARE ROW EXCLUSIVE MODE",
    lever: "ALTER TABLE mission_documents DISABLE TRIGGER mission_documents_statut",
    rendre: "ALTER TABLE mission_documents ENABLE TRIGGER mission_documents_statut",
  },
  propositions: {
    verrou: "LOCK TABLE propositions IN SHARE ROW EXCLUSIVE MODE",
    lever: "ALTER TABLE propositions DISABLE TRIGGER propositions_figee",
    rendre: "ALTER TABLE propositions ENABLE TRIGGER propositions_figee",
  },
  qualite_satisfactions: {
    verrou: "LOCK TABLE qualite_satisfactions IN SHARE ROW EXCLUSIVE MODE",
    lever: "ALTER TABLE qualite_satisfactions DISABLE TRIGGER qualite_satisfactions_ajout_seul",
    rendre: "ALTER TABLE qualite_satisfactions ENABLE TRIGGER qualite_satisfactions_ajout_seul",
  },
  retours_experience: {
    verrou: "LOCK TABLE retours_experience IN SHARE ROW EXCLUSIVE MODE",
    lever: "ALTER TABLE retours_experience DISABLE TRIGGER retours_experience_controle",
    rendre: "ALTER TABLE retours_experience ENABLE TRIGGER retours_experience_controle",
  },
} as const satisfies Record<string, Instructions>;

export type TableProtegee = keyof typeof INSTRUCTIONS;

/** Noms des 7 déclencheurs concernés (vérifiés par les tests : tous à l'état « O » au repos). */
export const NOMS_DECLENCHEURS: readonly string[] = [
  "bilans_mission_controle",
  "budget_versions_figees",
  "cloture_verifications_ajout_seul",
  "mission_documents_statut",
  "propositions_figee",
  "qualite_satisfactions_ajout_seul",
  "retours_experience_controle",
];

const ORDRE = Object.keys(INSTRUCTIONS) as TableProtegee[];

export async function transactionAntidatage(
  c: pg.Client,
  options: {
    /** Tables dont le déclencheur doit être levé pendant `pendant`. */
    tables: readonly TableProtegee[];
    /** UPDATE qui n'ont besoin d'aucune levée. */
    avant?: (c: pg.Client) => Promise<void>;
    /** UPDATE qui exigent la levée. */
    pendant: (c: pg.Client) => Promise<void>;
  },
): Promise<void> {
  const choisies = ORDRE.filter((t) => options.tables.includes(t));
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL lock_timeout = '5s'");
    await c.query("SET LOCAL statement_timeout = '60s'");
    await options.avant?.(c);
    for (const t of choisies) await c.query(INSTRUCTIONS[t].verrou);
    for (const t of choisies) await c.query(INSTRUCTIONS[t].lever);
    await options.pendant(c);
    for (const t of choisies) await c.query(INSTRUCTIONS[t].rendre);
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}
