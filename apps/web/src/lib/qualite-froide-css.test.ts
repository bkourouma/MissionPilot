import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Garde de non-régression (R-05, A-10) : aucun test visuel n'existe, on vérifie donc que les règles
 * qui empêchent les mots coupés en pleine lettre du tableau « Échantillon » restent présentes.
 */
const css = readFileSync(join(__dirname, "../components/qualite/froide.css"), "utf8");
const bloc = (selecteur: string): string => {
  const i = css.indexOf(selecteur);
  expect(i, `sélecteur absent : ${selecteur}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
};

describe("froide.css, tableau Échantillon", () => {
  const base = ".mp-froide__echantillon .mp-tableau";
  it("ne coupe pas les mots au-delà de 640 px", () => {
    const b = bloc(`${base} th,\n  ${base} td {\n    overflow-wrap: normal`);
    expect(b).toContain("word-break: normal");
  });
  it("garde entêtes, dates et statuts sur une ligne", () => {
    expect(bloc(`${base} th {`)).toContain("white-space: nowrap");
    expect(bloc(`${base} td[data-libelle="Clôture"]`)).toContain("white-space: nowrap");
  });
  it("impose des largeurs minimales et un défilement dans le cadre", () => {
    expect(bloc(`${base} td[data-libelle="Directeur"]`)).toContain("min-width");
    expect(bloc(`${base} td[data-libelle="Relecteur"]`)).toContain("min-width");
    expect(bloc(`  ${base} {\n    overflow-x: auto`)).toContain("overflow-x: auto");
  });
  it("garde le sélecteur de relecteur à la largeur de sa cellule (A-10)", () => {
    const b = bloc(`${base} td .mp-champ__controle`);
    expect(b).toContain("max-width: 100%");
    expect(b).toContain("min-width: 0");
  });
});
