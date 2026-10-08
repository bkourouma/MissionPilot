import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";
import { missionTemps } from "./temps-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let gestionnaire: ApiUtilisateur;

const INTITULE = "Reprise historique Concurrence";
const SENIOR = "senior de Cabinet Concurrence A";
const JUNIOR = "junior de Cabinet Concurrence A";
const ENTETE = "collaborateur;mission;tâche;date;jours";

const csv = (...lignes: string[]) => [ENTETE, ...lignes].join("\n");
const executer = (contenu: string) =>
  gestionnaire.post("/api/temps/import?simulation=false", { csv: contenu });

/** Attend qu'une transaction soit bloquée sur un verrou de ligne (INSERT en attente). */
async function attendreBlocage(db: Db): Promise<void> {
  for (let essai = 0; essai < 400; essai++) {
    const r = await db.query(
      "SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'",
    );
    if (r.rows[0].n > 0) return;
    await new Promise((fin) => setTimeout(fin, 25));
  }
  throw new Error("Aucune écriture bloquée observée");
}

const feuillesDeLaSemaine = (semaine: string) =>
  ctx.db.withTenant(a.cabinetId, async (db) => {
    const r = await db.query(
      `SELECT f.origine, count(l.id)::int AS lignes FROM feuilles_temps f
       LEFT JOIN lignes_temps l ON l.feuille_id = f.id
       WHERE f.semaine = $1 GROUP BY f.id, f.origine ORDER BY f.origine`,
      [semaine],
    );
    return r.rows;
  });

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Concurrence A");
  await missionTemps(
    a,
    { Diagnostic: { senior: 10 } },
    { intitule: INTITULE, debut: "2025-06-02", fin: "2025-08-29" },
  );
  gestionnaire = await a.avecRoles(["gestionnaire"]);
});
afterAll(() => ctx.fermer());

describe("import de l'historique des temps : exécutions concurrentes (TPS-10)", () => {
  it("même fichier exécuté deux fois en même temps : l'un passe, l'autre est refusé (pas de 500)", async () => {
    const contenu = csv(
      `${SENIOR};${INTITULE};Diagnostic;2025-06-02;1`,
      `${JUNIOR};${INTITULE};Diagnostic;2025-06-03;1`,
    );
    const reponses = await Promise.all([executer(contenu), executer(contenu)]);
    expect(
      reponses.map((r) => r.statusCode).sort(),
      reponses.map((r) => r.body).join("\n"),
    ).toEqual([200, 400]);
    const refus = reponses.find((r) => r.statusCode === 400);
    expect(refus?.json().erreur.code).toBe("IMPORT_INVALIDE");
    // Verrou par cabinet : la seconde exécution voit les feuilles de la première.
    expect(refus?.json().rapport.erreurs[0].message).toMatch(/existe déjà/);
    expect(await feuillesDeLaSemaine("2025-06-02")).toEqual([
      { origine: "import", lignes: 1 },
      { origine: "import", lignes: 1 },
    ]);
  });

  it("feuille créée pendant l'exécution (saisie concurrente) : 409 IMPORT_CONCURRENT, rien d'importé", async () => {
    const semaine = "2025-08-18";
    let execution: ReturnType<typeof executer> | undefined;
    // Transaction de saisie ouverte : l'import ne voit pas sa feuille, puis bute sur l'unicité.
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      await db.query(
        `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
         VALUES ($1, $2, $3, $4)`,
        [a.cabinetId, a.collaborateurs.senior, a.associeId, semaine],
      );
      execution = executer(csv(`${SENIOR};${INTITULE};Diagnostic;${semaine};1`));
      await attendreBlocage(db);
    });
    const r = await (execution as ReturnType<typeof executer>);
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("IMPORT_CONCURRENT");
    expect(await feuillesDeLaSemaine(semaine)).toEqual([{ origine: "saisie", lignes: 0 }]);
  });
});
