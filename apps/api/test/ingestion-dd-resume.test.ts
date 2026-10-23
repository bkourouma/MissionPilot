/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activerIa, demarrerIngestion, type ContexteIngestion } from "./ingestion-outils.js";
import {
  LIGNES_RAPPORT_OK,
  ingererDd,
  pdfRapport,
  preparerIngestionDd,
  repondreLignes,
  type ScenarioIngestionDd,
} from "./ingestion-dd-outils.js";

/*
 * Résumé d'une lecture de due diligence (DD-02, DD-10) : un nombre de 3 chiffres ou plus du résumé doit se
 * retrouver dans la page citée, à la lecture de l'IA (ligne rejetée) comme à la correction humaine (400).
 */

let ctx: ContexteIngestion;
let s: ScenarioIngestionDd;
let n = 0;

beforeAll(async () => {
  ctx = await demarrerIngestion();
  s = await preparerIngestionDd(ctx, "Résumé DD");
  await activerIa(s.a.associe);
}, 240_000);
afterAll(async () => {
  await ctx?.fermer();
});

const lire = async (lignes: string[]) => {
  repondreLignes(ctx, lignes);
  const { document } = await ingererDd(
    ctx,
    s.a.chef,
    s.dossierId,
    "rapport",
    `resume-${++n}.pdf`,
    pdfRapport(),
  );
  return document as any;
};

describe("résumé : nombres vérifiés dans la page citée", () => {
  it("lecture de l'IA : un résumé qui cite un chiffre inventé n'est pas retenu", async () => {
    const d = await lire([
      "RESUME | 1 | Chiffre d'affaires de 99 999 000 000 FCFA.",
      "RESUME | 1 | Un litige fiscal de 350 000 000 FCFA est en cours.",
      ...LIGNES_RAPPORT_OK.slice(1),
    ]);
    expect(d.extractions).toHaveLength(1);
    expect(d.extractions[0].contenu.resume).toEqual([
      { page: 1, texte: "Un litige fiscal de 350 000 000 FCFA est en cours." },
    ]);
  });

  it("correction humaine : 400 clair si le résumé cite un nombre introuvable dans la page citée", async () => {
    const d = await lire(LIGNES_RAPPORT_OK);
    const x = d.extractions[0];
    const url = `/api/dd/extractions/${x.id}`;
    const avec = (resume: { page: number; texte: string }[]) => ({
      contenu: { ...x.contenu, resume },
    });

    const faux = await s.consultantEquipe.patch(
      url,
      avec([{ page: 1, texte: "Chiffre d'affaires de 13 000 000 000 FCFA." }]),
    );
    expect(faux.statusCode).toBe(400);
    expect(faux.json().erreur.message).toBe("Le résumé cite un nombre introuvable dans la page 1.");

    // Le nombre existe, mais sur la page 1 : citer la page 2 est refusé.
    const autrePage = await s.consultantEquipe.patch(
      url,
      avec([{ page: 2, texte: "Un litige fiscal de 350 000 000 FCFA." }]),
    );
    expect(autrePage.statusCode).toBe(400);
    expect(autrePage.json().erreur.message).toContain("page 2");

    const ok = await s.consultantEquipe.patch(
      url,
      avec([
        { page: 1, texte: "Un litige fiscal de 350 000 000 FCFA est en cours." },
        { page: 2, texte: "Trois clients, deux exercices." },
      ]),
    );
    expect(ok.statusCode).toBe(200);
  });
});
