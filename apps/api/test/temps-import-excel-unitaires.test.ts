import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX,
  lireArchive,
  lireClasseurTemps,
  modeleExcelTemps,
  reconstruireArchive,
} from "../src/temps/import-excel.js";

const ENTETE = ["Collaborateur", "Mission", "Tâche", "Date", "Jours"];

async function classeur(lignes: ExcelJS.CellValue[][]): Promise<Buffer> {
  const c = new ExcelJS.Workbook();
  const f = c.addWorksheet("Temps");
  for (const l of lignes) f.addRow(l);
  return Buffer.from((await c.xlsx.writeBuffer()) as ArrayBuffer);
}

/*
 * Tests sans base de données de `import-excel.ts` : état du module (modèle en cache,
 * sémaphore des lectures) et archive reconstruite. Un fichier à part : le modèle doit
 * n'avoir jamais été généré dans ce module quand le premier test s'exécute.
 */
describe("import Excel : modèle, lectures simultanées, archive reconstruite", () => {
  it("modèle : un échec de génération n'est pas gardé en cache", async () => {
    const espion = vi
      .spyOn(ExcelJS.Workbook.prototype, "addWorksheet")
      .mockImplementationOnce(() => {
        throw new Error("panne simulée");
      });
    try {
      await expect(modeleExcelTemps()).rejects.toThrow("panne simulée");
    } finally {
      espion.mockRestore();
    }
    const modele = await modeleExcelTemps();
    expect(modele.readUInt32LE(0)).toBe(0x04034b50);
    // Succès : le même classeur est ensuite resservi.
    expect(await modeleExcelTemps()).toBe(modele);
  });

  it(`au plus ${IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX} lectures simultanées : 503 au-delà, places rendues`, async () => {
    const valide = await classeur([ENTETE, ["X", "Y", "Z", "2025-06-02", 1]]);
    const lectures = Array.from({ length: IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX + 1 }, () =>
      lireClasseurTemps(valide),
    );
    const resultats = await Promise.allSettled(lectures);
    expect(resultats.map((r) => r.status)).toEqual([
      ...Array.from({ length: IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX }, () => "fulfilled"),
      "rejected",
    ]);
    expect((resultats.at(-1) as PromiseRejectedResult).reason).toMatchObject({
      statut: 503,
      code: "IMPORT_EXCEL_OCCUPE",
    });
    // Les places sont rendues, y compris après un refus.
    await expect(lireClasseurTemps(Buffer.from("pas un classeur"))).rejects.toMatchObject({
      statut: 400,
    });
    const encore = await Promise.all([lireClasseurTemps(valide), lireClasseurTemps(valide)]);
    expect(encore.map((t) => t.entete)).toEqual([ENTETE, ENTETE]);
  });

  it("archive reconstruite : mêmes entrées et contenus, stockée, relue par ExcelJS", async () => {
    const origine = lireArchive(await classeur([ENTETE, ["X", "Y", "Z", "2025-06-02", 1]]));
    const reconstruite = reconstruireArchive(origine);
    const relue = lireArchive(reconstruite);
    expect([...relue.keys()]).toEqual([...origine.keys()]);
    for (const [nom, donnees] of origine) expect(relue.get(nom)?.equals(donnees), nom).toBe(true);
    // Méthode 0 (stockée) pour chaque en-tête local : aucune décompression côté ExcelJS.
    expect(reconstruite.readUInt16LE(8)).toBe(0);
    const c = new ExcelJS.Workbook();
    await c.xlsx.load(reconstruite as unknown as ExcelJS.Buffer);
    expect((c.worksheets[0]?.getRow(1).values as unknown[]).slice(1)).toEqual(ENTETE);
  });
});
