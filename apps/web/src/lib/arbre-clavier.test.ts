import { describe, expect, it } from "vitest";
import {
  actionClavierArbre,
  aplatirArbre,
  appliquerRepli,
  elementFocalisable,
  type NoeudNavigable,
} from "./arbre-clavier";

const n = (id: string, ...enfants: NoeudNavigable[]): NoeudNavigable => ({ id, enfants });
const arbre = [n("a", n("a1", n("a1x")), n("a2")), n("b"), n("c", n("c1"))];

describe("aplatirArbre", () => {
  it("liste tous les nœuds dépliés avec niveau et parent", () => {
    const v = aplatirArbre(arbre, new Set());
    expect(v.map((x) => x.id)).toEqual(["a", "a1", "a1x", "a2", "b", "c", "c1"]);
    expect(v.find((x) => x.id === "a1x")).toMatchObject({ niveau: 3, parentId: "a1" });
    expect(v.find((x) => x.id === "b")).toMatchObject({
      niveau: 1,
      aEnfants: false,
      deplie: false,
    });
  });
  it("omet les enfants d'un nœud replié", () => {
    const v = aplatirArbre(arbre, new Set(["a"]));
    expect(v.map((x) => x.id)).toEqual(["a", "b", "c", "c1"]);
    expect(v[0]).toMatchObject({ aEnfants: true, deplie: false });
  });
});

describe("actionClavierArbre", () => {
  const v = aplatirArbre(arbre, new Set());
  it("flèches haut/bas, Début, Fin", () => {
    expect(actionClavierArbre(v, "a", "ArrowDown")).toEqual({ type: "focus", id: "a1" });
    expect(actionClavierArbre(v, "a1", "ArrowUp")).toEqual({ type: "focus", id: "a" });
    expect(actionClavierArbre(v, "a", "ArrowUp")).toBeNull();
    expect(actionClavierArbre(v, "c1", "ArrowDown")).toBeNull();
    expect(actionClavierArbre(v, "b", "Home")).toEqual({ type: "focus", id: "a" });
    expect(actionClavierArbre(v, "b", "End")).toEqual({ type: "focus", id: "c1" });
  });
  it("droite : plie/déplie puis descend au premier enfant ; feuille sans effet", () => {
    expect(actionClavierArbre(v, "a", "ArrowRight")).toEqual({ type: "focus", id: "a1" });
    const replie = aplatirArbre(arbre, new Set(["a"]));
    expect(actionClavierArbre(replie, "a", "ArrowRight")).toEqual({ type: "deplier", id: "a" });
    expect(actionClavierArbre(v, "b", "ArrowRight")).toBeNull();
  });
  it("gauche : replie un nœud déplié, sinon remonte au parent", () => {
    expect(actionClavierArbre(v, "a", "ArrowLeft")).toEqual({ type: "replier", id: "a" });
    expect(actionClavierArbre(v, "a2", "ArrowLeft")).toEqual({ type: "focus", id: "a" });
    expect(actionClavierArbre(v, "b", "ArrowLeft")).toBeNull();
  });
  it("touche inconnue ou nœud absent : rien", () => {
    expect(actionClavierArbre(v, "a", "Enter")).toBeNull();
    expect(actionClavierArbre(v, "zzz", "ArrowDown")).toBeNull();
  });
});

describe("repli et focalisation", () => {
  it("appliquerRepli ajoute ou retire sans muter", () => {
    const base = new Set<string>();
    const replie = appliquerRepli(base, { type: "replier", id: "a" });
    expect([...replie]).toEqual(["a"]);
    expect(base.size).toBe(0);
    expect(appliquerRepli(replie, { type: "deplier", id: "a" }).size).toBe(0);
    expect(appliquerRepli(replie, { type: "focus", id: "x" })).toEqual(replie);
  });
  it("elementFocalisable retombe sur le premier si le courant est masqué", () => {
    const v = aplatirArbre(arbre, new Set(["a"]));
    expect(elementFocalisable(v, "c")).toBe("c");
    expect(elementFocalisable(v, "a1")).toBe("a");
    expect(elementFocalisable(v, null)).toBe("a");
    expect(elementFocalisable([], "a")).toBeNull();
  });
});
