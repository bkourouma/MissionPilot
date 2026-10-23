import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Garde de non-régression (R-05, A-10) : aucun test visuel n'existe, on vérifie donc que les règles
 * qui empêchent les mots coupés en pleine lettre du tableau « Échantillon » restent présentes, et
 * que la somme des largeurs minimales des colonnes tient dans la largeur utile à 1036 px de
 * viewport (1036 - menu 240 - marges 2 x 32 = 732 px ; 736 px à 768 px, sans menu).
 */
const css = readFileSync(join(__dirname, "../components/qualite/froide.css"), "utf8");
const bloc = (selecteur: string): string => {
  const i = css.indexOf(selecteur);
  expect(i, `sélecteur absent : ${selecteur}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
};

const PLAFOND_REM = 44; // 704 px < 732 px utiles
const base = ".mp-froide__echantillon .mp-tableau";
const COLONNES = [
  "Mission",
  "Client",
  "Directeur",
  "Clôture",
  "Statut",
  "Relecteur",
  "Score et conclusion",
];

const largeurMin = (colonne: string): number => {
  const m = /min-width:\s*([\d.]+)rem/.exec(bloc(`${base} td[data-libelle="${colonne}"]`));
  expect(m, `min-width (rem) absent pour ${colonne}`).not.toBeNull();
  return Number(m![1]);
};

describe("froide.css, tableau Échantillon", () => {
  it("ne coupe pas les mots au-delà de 640 px", () => {
    const b = bloc(`${base} th,\n  ${base} td {\n    padding-inline`);
    expect(b).toContain("overflow-wrap: normal");
    expect(b).toContain("word-break: normal");
    expect(css).not.toMatch(/word-break:\s*(break-all|break-word)/);
  });
  it("garde entêtes, dates et statuts sur une ligne", () => {
    expect(bloc(`${base} th {`)).toContain("white-space: nowrap");
    expect(bloc(`${base} td[data-libelle="Clôture"]`)).toContain("white-space: nowrap");
    expect(bloc(`${base} td[data-libelle="Statut"]`)).toContain("white-space: nowrap");
  });
  it("garde la somme des largeurs minimales sous le plafond (pas de défilement à 768/1036/1280 px)", () => {
    const somme = COLONNES.reduce((total, c) => total + largeurMin(c), 0);
    expect(somme).toBeLessThanOrEqual(PLAFOND_REM);
    expect(largeurMin("Relecteur")).toBeGreaterThanOrEqual(largeurMin("Directeur"));
  });
  it("garde le défilement dans le cadre en repli de sécurité", () => {
    expect(bloc(`  ${base} {\n    overflow-x: auto`)).toContain("overflow-x: auto");
  });
  it("garde le sélecteur de relecteur à la largeur de sa cellule (A-10)", () => {
    const b = bloc(`${base} td .mp-champ__controle`);
    expect(b).toContain("max-width: 100%");
    expect(b).toContain("min-width: 0");
    const champ = /td \.mp-champ \{\s*min-width:\s*([\d.]+)rem/.exec(css);
    expect(champ).not.toBeNull();
    expect(Number(champ![1])).toBeLessThanOrEqual(largeurMin("Relecteur"));
  });
});
