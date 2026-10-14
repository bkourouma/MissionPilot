import { describe, expect, it } from "vitest";
import {
  geometrieSoldes,
  libelleGraduation,
  lignesTableauSoldes,
  type SemaineSolde,
} from "./redressement-graphiques";

const semaine = (n: number, prevu: number, retenu = prevu, tension = false): SemaineSolde => ({
  semaine: n,
  debut: `2026-11-${String(n).padStart(2, "0")}`,
  fin: `2026-11-${String(n + 6).padStart(2, "0")}`,
  solde_cloture_prevu: prevu,
  solde_cloture_retenu: retenu,
  tension,
});

describe("geometrieSoldes", () => {
  it("place les soldes dans la zone, le plus haut en haut", () => {
    const g = geometrieSoldes([semaine(1, 0), semaine(2, 500), semaine(3, 1000)], null);
    expect(g.vide).toBe(false);
    expect(g.points).toHaveLength(3);
    const [a, b, c] = g.points;
    expect(a!.x).toBe(g.zone.gauche);
    expect(c!.x).toBe(g.zone.droite);
    expect(a!.yRetenu).toBeGreaterThan(b!.yRetenu);
    expect(b!.yRetenu).toBeGreaterThan(c!.yRetenu);
    for (const p of g.points) {
      expect(p.yRetenu).toBeGreaterThanOrEqual(g.zone.haut);
      expect(p.yRetenu).toBeLessThanOrEqual(g.zone.bas);
    }
    expect(g.abscisses.map((x) => x.libelle)).toEqual(["S1", "S2", "S3"]);
    expect(g.traitRetenu.split(" ")).toHaveLength(3);
    expect(g.ySeuil).toBeNull();
  });

  it("inclut le seuil dans l'échelle : la droite du seuil est toujours visible", () => {
    const g = geometrieSoldes([semaine(1, 1000), semaine(2, 2000)], -5000);
    expect(g.ySeuil).not.toBeNull();
    expect(g.ySeuil!).toBeLessThanOrEqual(g.zone.bas);
    expect(g.ySeuil!).toBeGreaterThan(g.points[0]!.yRetenu);
  });

  it("donne une plage minimale à une série constante (ligne non écrasée)", () => {
    const g = geometrieSoldes([semaine(1, 100), semaine(2, 100), semaine(3, 100)], null);
    expect(g.vide).toBe(false);
    const ys = new Set(g.points.map((p) => p.yRetenu));
    expect(ys.size).toBe(1);
    const y = [...ys][0]!;
    expect(y).toBeGreaterThan(g.zone.haut);
    expect(y).toBeLessThan(g.zone.bas);
    expect(g.graduations.length).toBeGreaterThanOrEqual(3);
  });

  it("gère une série constante à zéro", () => {
    const g = geometrieSoldes([semaine(1, 0), semaine(2, 0)], 0);
    expect(g.vide).toBe(false);
    expect(Number.isFinite(g.points[0]!.yRetenu)).toBe(true);
    expect(g.ySeuil).toBe(g.points[0]!.yRetenu);
  });

  it("gère un minimum négatif : le solde le plus bas est en bas, les graduations montent", () => {
    const g = geometrieSoldes([semaine(1, 500), semaine(2, -800), semaine(3, 200)], 0);
    const bas = g.points.reduce((m, p) => (p.yRetenu > m.yRetenu ? p : m));
    expect(bas.semaine).toBe(2);
    const valeurs = g.graduations.map((t) => t.valeur);
    expect([...valeurs].sort((x, y) => x - y)).toEqual(valeurs);
    expect(valeurs[0]!).toBeLessThan(-800);
    expect(valeurs.at(-1)!).toBeGreaterThan(500);
  });

  it("distingue le solde prévu du solde retenu et garde la marque de tension", () => {
    const g = geometrieSoldes([semaine(1, 100, 100), semaine(2, 300, -200, true)], null);
    expect(g.points[1]!.tension).toBe(true);
    expect(g.points[1]!.yPrevu).not.toBe(g.points[1]!.yRetenu);
    expect(g.traitPrevu).not.toBe(g.traitRetenu);
  });

  it("centre une semaine unique", () => {
    const g = geometrieSoldes([semaine(1, 100)], null);
    expect(g.points[0]!.x).toBe((g.zone.gauche + g.zone.droite) / 2);
  });

  it("rend une géométrie vide pour une série vide", () => {
    const g = geometrieSoldes([], 0);
    expect(g.vide).toBe(true);
    expect(g.points).toEqual([]);
    expect(g.traitRetenu).toBe("");
    expect(g.ySeuil).toBeNull();
  });
});

describe("tableau équivalent", () => {
  it("reprend les mêmes valeurs dans le même ordre", () => {
    const s = [semaine(1, 100, 100), semaine(2, 300, -200, true)];
    expect(lignesTableauSoldes(s)).toEqual([
      {
        semaine: 1,
        debut: "2026-11-01",
        fin: "2026-11-07",
        solde_prevu: 100,
        solde_retenu: 100,
        tension: false,
      },
      {
        semaine: 2,
        debut: "2026-11-02",
        fin: "2026-11-08",
        solde_prevu: 300,
        solde_retenu: -200,
        tension: true,
      },
    ]);
    expect(lignesTableauSoldes([])).toEqual([]);
  });

  it("formate les graduations en notation compacte", () => {
    expect(libelleGraduation(0)).toBe("0");
    expect(libelleGraduation(1_500_000).replace(/[\u00a0\u202f]/g, " ")).toMatch(/1,5 M/);
  });
});
