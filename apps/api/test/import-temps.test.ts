import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";
import { missionTemps, type MissionTemps } from "./temps-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let m: MissionTemps;
let gestionnaire: ApiUtilisateur;

const INTITULE = "Reprise historique Import";
const entete = "collaborateur;mission;tâche;date;jours";

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Import A");
  b = await preparerCabinet(ctx, "Cabinet Import B");
  m = await missionTemps(
    a,
    { Diagnostic: { senior: 10 } },
    { intitule: INTITULE, debut: "2025-06-02", fin: "2025-08-29" },
  );
  gestionnaire = await a.avecRoles(["gestionnaire"]);
});
afterAll(() => ctx.fermer());

const importer = (
  api: ApiUtilisateur | CabinetMissions["associe"],
  csv: string,
  simulation = true,
) => api.post(`/api/temps/import?simulation=${simulation}`, { csv });

describe("import de l'historique des temps (TPS-10)", () => {
  it("simulation : validation ligne par ligne, rapport d'erreurs, rien n'est écrit", async () => {
    const csv = [
      entete,
      `senior de Cabinet Import A;${INTITULE};Diagnostic;2025-06-02;1`,
      `Inconnu;${INTITULE};Diagnostic;2025-06-03;1`,
      `senior de Cabinet Import A;${INTITULE};Diagnostic;31/02/2025;1`,
      `senior de Cabinet Import A;${INTITULE};Diagnostic;2025-06-04;0,3`,
      `senior de Cabinet Import A;${INTITULE};Diagnostic;2025-06-02;1`,
      `senior de Cabinet Import B;${INTITULE};Diagnostic;2025-06-05;1`,
      `senior de Cabinet Import A;Autre mission;Diagnostic;2025-06-05;1`,
    ].join("\r\n");
    const r = await importer(gestionnaire, csv);
    expect(r.statusCode, r.body).toBe(200);
    const rapport = r.json();
    expect(rapport).toMatchObject({
      simulation: true,
      executee: false,
      lignes_lues: 7,
      lignes_valides: 1,
      feuilles: 1,
      jours_total: 1,
    });
    expect(rapport.erreurs.map((e: { ligne: number }) => e.ligne)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(rapport.erreurs[0].message).toMatch(/Collaborateur actif inconnu/);
    expect(rapport.erreurs[3].message).toMatch(/Doublon/);
    // Exécution avec erreurs : refusée, rien n'est importé.
    const exec = await importer(gestionnaire, csv, false);
    expect(exec.statusCode).toBe(400);
    expect(exec.json().erreur.code).toBe("IMPORT_INVALIDE");
    expect((await a.directeur.get(`/api/missions/${m.id}/suivi`)).json().arbre.realise).toBe(0);
  });

  it("exécution : feuilles validées d'origine import, prises dans le réalisé, sans doublon", async () => {
    const csv = [
      entete,
      `senior de Cabinet Import A;${INTITULE};Diagnostic;2025-06-02;1`,
      `senior de Cabinet Import A;${INTITULE};Diagnostic;03/06/2025;0,5`,
      `junior de Cabinet Import A;${INTITULE};diagnostic;2025-06-10;1`,
    ].join("\n");
    const r = await importer(gestionnaire, csv, false);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      executee: true,
      lignes_valides: 3,
      feuilles: 2,
      jours_total: 2.5,
      erreurs: [],
    });
    expect((await a.directeur.get(`/api/missions/${m.id}/suivi`)).json().arbre.realise).toBe(2.5);
    const feuilles = await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("SELECT statut, origine FROM feuilles_temps WHERE origine = 'import'"),
    );
    expect(feuilles.rows).toEqual([
      { statut: "validee", origine: "import" },
      { statut: "validee", origine: "import" },
    ]);
    const again = await importer(gestionnaire, csv);
    expect(again.json().erreurs[0].message).toMatch(/existe déjà/);
  });

  it("droits, bornes et format", async () => {
    expect((await importer(a.chef, `${entete}\n`)).statusCode).toBe(403);
    expect((await importer(gestionnaire, "nom;date\nX;2025-06-02")).statusCode).toBe(400);
    const trop = [entete, ...Array.from({ length: 5001 }, () => `x;y;z;2025-06-02;1`)].join("\n");
    expect((await importer(gestionnaire, trop)).statusCode).toBe(400);
    expect(
      (await gestionnaire.post("/api/temps/import?simulation=peut-etre", { csv: entete }))
        .statusCode,
    ).toBe(400);
    // Isolation : depuis B, la mission et les collaborateurs de A sont inconnus.
    const r = await importer(
      b.associe,
      `${entete}\nsenior de Cabinet Import A;${INTITULE};Diagnostic;2025-06-02;1`,
    );
    expect(r.json().erreurs[0].message).toMatch(/inconnu/);
  });
});
