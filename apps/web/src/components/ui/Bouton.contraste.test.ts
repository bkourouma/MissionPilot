import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Contrastes WCAG des jetons de formulaire et de bouton, en clair et en sombre. */
const css = readFileSync(resolve(__dirname, "../../styles/tokens.css"), "utf8");

function bloc(selecteur: string): Record<string, string> {
  const debut = css.indexOf(`${selecteur} {`);
  const fin = css.indexOf("\n}", debut);
  const corps = css.slice(debut, fin);
  const jetons: Record<string, string> = {};
  for (const m of corps.matchAll(/(--mp-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    jetons[m[1]!] = m[2]!;
  }
  return jetons;
}

const clair = bloc(":root");
const sombre = { ...clair, ...bloc(':root[data-theme="dark"]') };

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const themes = { clair, sombre } as const;

describe.each(Object.entries(themes))("jetons %s", (_nom, t) => {
  const v = (k: string) => {
    const valeur = t[k];
    if (!valeur) throw new Error(`Jeton manquant : ${k}`);
    return valeur;
  };

  it("texte du bouton danger ≥ 4,5:1, au repos et au survol", () => {
    expect(contraste(v("--mp-sur-danger"), v("--mp-danger"))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(v("--mp-sur-danger"), v("--mp-danger-survol"))).toBeGreaterThanOrEqual(4.5);
  });

  it("placeholder ≥ 4,5:1 sur la surface d'un champ", () => {
    expect(contraste(v("--mp-placeholder"), v("--mp-surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("contour de contrôle (repos et survol) ≥ 3:1 sur la surface et sur le fond", () => {
    for (const k of ["--mp-bordure-controle", "--mp-bordure-controle-survol"]) {
      expect(contraste(v(k), v("--mp-surface"))).toBeGreaterThanOrEqual(3);
      expect(contraste(v(k), v("--mp-fond"))).toBeGreaterThanOrEqual(3);
    }
  });

  it("anneau de focus ≥ 3:1 sur le fond et sur la surface", () => {
    expect(contraste(v("--mp-focus"), v("--mp-fond"))).toBeGreaterThanOrEqual(3);
    expect(contraste(v("--mp-focus"), v("--mp-surface"))).toBeGreaterThanOrEqual(3);
  });

  it("texte doux lisible sur champ désactivé et sur champ en lecture seule", () => {
    expect(contraste(v("--mp-texte-doux"), v("--mp-surface-2"))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(v("--mp-texte"), v("--mp-fond-lecture-seule"))).toBeGreaterThanOrEqual(4.5);
  });

  it("texte sur survol de ligne ≥ 4,5:1", () => {
    expect(contraste(v("--mp-texte"), v("--mp-survol-ligne"))).toBeGreaterThanOrEqual(4.5);
  });

  it("textes de statut sur leur fond ≥ 4,5:1 (alerte, badge, carte)", () => {
    for (const s of ["succes", "attention", "danger", "neutre", "info"]) {
      expect(contraste(v(`--mp-${s}`), v(`--mp-${s}-fond`))).toBeGreaterThanOrEqual(4.5);
      expect(contraste(v("--mp-texte"), v(`--mp-${s}-fond`))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
