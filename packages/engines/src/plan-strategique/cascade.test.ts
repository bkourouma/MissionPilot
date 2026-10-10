import { describe, expect, it } from "vitest";
import { analyserCascade, pourcentageEntier, type NoeudCascade } from "./cascade";
import { ErreurPlan } from "./erreurs";

const n = (
  id: string,
  type: NoeudCascade["type"],
  parentId: string | null,
  porteurId: string | null = "u1",
  extra: Partial<NoeudCascade> = {},
): NoeudCascade => ({ id, type, parentId, titre: id, porteurId, ...extra });

/** Cascade complète, sans aucun trou. */
const complete: NoeudCascade[] = [
  n("v", "vision", null),
  n("a", "axe", "v"),
  n("o", "objectif", "a"),
  n("k", "kpi", "o"),
  n("i", "initiative", "o"),
  n("p", "projet", "i"),
  n("j", "jalon", "p", "u2", { echeance: "2027-06-30", statut: "prevu" }),
];

describe("analyserCascade", () => {
  it("rend l'arbre en profondeur, sans trou, couverture complète", () => {
    const r = analyserCascade(complete, "2027-01-01");
    expect(r.racines).toEqual(["v"]);
    expect(r.noeuds.map((x) => [x.id, x.profondeur])).toEqual([
      ["v", 0],
      ["a", 1],
      ["o", 2],
      ["k", 3],
      ["i", 3],
      ["p", 4],
      ["j", 5],
    ]);
    expect(r.noeuds[2]?.enfants).toEqual(["k", "i"]);
    expect(r.trous).toEqual([]);
    expect(r.synthese).toEqual({ bloquant: 0, important: 0, information: 0 });
    expect(r.couverture).toEqual({
      noeudsActifs: 7,
      noeudsAvecPorteur: 7,
      tauxPorteurs: 100,
      objectifs: 1,
      objectifsAvecKpi: 1,
      tauxKpi: 100,
    });
    expect(r.compteurs).toEqual({
      vision: 1,
      axe: 1,
      objectif: 1,
      initiative: 1,
      projet: 1,
      jalon: 1,
      kpi: 1,
    });
  });

  it("signale les trous de structure avec leur gravité", () => {
    const r = analyserCascade(
      [
        n("a", "axe", null),
        n("a2", "axe", null),
        n("o", "objectif", "a"),
        n("i", "initiative", "a", null),
        n("p", "projet", "i"),
        n("j", "jalon", "p", "u1", { echeance: "2026-12-31", statut: "prevu" }),
        n("j2", "jalon", "p", "u1", { echeance: "2026-12-31", statut: "atteint" }),
      ],
      "2027-01-01",
    );
    const codes = r.trous.map((t) => [t.code, t.noeudId, t.gravite]);
    expect(codes).toEqual([
      ["VISION_ABSENTE", null, "important"],
      ["AXE_SANS_OBJECTIF", "a2", "important"],
      ["OBJECTIF_SANS_KPI", "o", "bloquant"],
      ["OBJECTIF_SANS_INITIATIVE", "o", "important"],
      ["SANS_PORTEUR", "i", "bloquant"],
      ["INITIATIVE_HORS_OBJECTIF", "i", "information"],
      ["JALON_EN_RETARD", "j", "important"],
    ]);
    expect(r.synthese).toEqual({ bloquant: 2, important: 4, information: 1 });
    expect(r.couverture.tauxPorteurs).toBe(86);
    expect(r.couverture.tauxKpi).toBe(0);
  });

  it("initiative sans projet, projet sans jalon, gravités du porteur manquant", () => {
    const r = analyserCascade(
      [
        n("v", "vision", null, null),
        n("a", "axe", "v"),
        n("o", "objectif", "a", null),
        n("k", "kpi", "o", null),
        n("i", "initiative", "o"),
        n("i2", "initiative", "o"),
        n("p", "projet", "i2", null),
      ],
      "2027-01-01",
    );
    expect(r.trous.map((t) => [t.code, t.noeudId, t.gravite])).toEqual([
      ["SANS_PORTEUR", "v", "information"],
      ["SANS_PORTEUR", "o", "important"],
      ["SANS_PORTEUR", "k", "important"],
      ["INITIATIVE_SANS_PROJET", "i", "information"],
      ["SANS_PORTEUR", "p", "bloquant"],
      ["PROJET_SANS_JALON", "p", "important"],
    ]);
  });

  it("place à la racine un nœud orphelin (parent absent ou de type non admis)", () => {
    const r = analyserCascade(
      [
        n("v", "vision", null),
        n("o", "objectif", "inconnu"),
        n("k", "kpi", "v"),
        n("j", "jalon", null),
      ],
      "2027-01-01",
    );
    expect(r.racines).toEqual(["v", "o", "k", "j"]);
    expect(r.noeuds.filter((x) => x.orphelin).map((x) => x.id)).toEqual(["o", "k", "j"]);
    expect(r.trous.filter((t) => t.code === "NOEUD_ORPHELIN")).toHaveLength(3);
  });

  it("un axe ou une vision dont le parent est absent ou non admis est orphelin", () => {
    const r = analyserCascade(
      [
        n("v", "vision", "fantome"),
        n("a1", "axe", "inconnu"),
        n("o0", "objectif", "a1"),
        n("a2", "axe", "o0"),
        n("a3", "axe", null),
      ],
      "2027-01-01",
    );
    // Les racines sans parentId restent admises ; celles qui portent un parentId sans parent admis
    // sont signalées (et placées à la racine).
    expect(r.noeuds.filter((x) => x.orphelin).map((x) => x.id)).toEqual(["v", "a1", "a2"]);
    expect(r.racines).toEqual(["v", "a1", "a2", "a3"]);
  });

  it("un nœud inactif orphelin n'est pas signalé orphelin", () => {
    const r = analyserCascade(
      [
        n("v", "vision", null),
        { ...n("o", "objectif", "inconnu"), actif: false },
        { ...n("a", "axe", "inconnu"), actif: false },
      ],
      "2027-01-01",
    );
    expect(r.noeuds.filter((x) => x.orphelin)).toEqual([]);
    expect(r.trous.filter((t) => t.code === "NOEUD_ORPHELIN")).toEqual([]);
    expect(r.racines).toEqual(["v", "o", "a"]);
  });

  it("un nœud inactif ne couvre rien et n'a pas de trou", () => {
    const r = analyserCascade(
      [
        n("v", "vision", null),
        n("a", "axe", "v"),
        n("o", "objectif", "a"),
        n("k", "kpi", "o", null, { actif: false }),
        n("i", "initiative", "o", null, { actif: false }),
      ],
      "2027-01-01",
    );
    expect(r.trous.map((t) => [t.code, t.noeudId])).toEqual([
      ["OBJECTIF_SANS_KPI", "o"],
      ["OBJECTIF_SANS_INITIATIVE", "o"],
    ]);
    expect(r.couverture.noeudsActifs).toBe(3);
    expect(r.noeuds.find((x) => x.id === "k")?.actif).toBe(false);
  });

  it("plan vide : vision absente, couvertures à 100", () => {
    const r = analyserCascade([], "2027-01-01");
    expect(r.trous.map((t) => t.code)).toEqual(["VISION_ABSENTE"]);
    expect(r.couverture.tauxPorteurs).toBe(100);
    expect(r.couverture.tauxKpi).toBe(100);
  });

  it("refuse un nœud en double, un type inconnu, une date invalide", () => {
    expect(() => analyserCascade([n("a", "axe", null), n("a", "axe", null)], "2027-01-01")).toThrow(
      ErreurPlan,
    );
    expect(() =>
      analyserCascade([{ ...n("a", "axe", null), type: "x" as never }], "2027-01-01"),
    ).toThrow(/Type de nœud/);
    expect(() => analyserCascade([], "2027-02-30")).toThrow(/référence/);
    expect(() =>
      analyserCascade([n("j", "jalon", null, "u", { echeance: "2027-13-01" })], "2027-01-01"),
    ).toThrow(/Échéance/);
  });
});

describe("pourcentageEntier", () => {
  it("arrondit demi vers le haut, 100 sans dénominateur", () => {
    expect(pourcentageEntier(1, 8)).toBe(13);
    expect(pourcentageEntier(1, 3)).toBe(33);
    expect(pourcentageEntier(2, 3)).toBe(67);
    expect(pourcentageEntier(0, 0)).toBe(100);
  });
});
