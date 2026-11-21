import { describe, expect, it } from "vitest";
import { NAVIGATION, type EntreeNavigation } from "../../lib/navigation";
import { MODULES_QUOTIDIEN, pluriel, repartirModules } from "./modules-accueil";

const entree = (id: string, disponible = true): EntreeNavigation => ({
  id,
  libelle: id,
  href: `/${id}`,
  permission: null,
  disponible,
  icone: "dossier",
  description: id,
});

describe("repartirModules", () => {
  it("met les modules du quotidien d'abord, dans l'ordre fixé, sans doublon avec les groupes", () => {
    const r = repartirModules([entree("missions"), entree("mon-brief"), entree("clients")]);
    expect(r.quotidien.map((e) => e.id)).toEqual(["mon-brief", "missions"]);
    const dansGroupes = r.groupes.flatMap((g) => g.entrees.map((e) => e.id));
    expect(dansGroupes).toEqual(["clients"]);
    expect(r.nbDisponibles).toBe(3);
  });

  it("ignore un module du quotidien absent (droit manquant) sans en inventer", () => {
    const r = repartirModules([entree("clients")]);
    expect(r.quotidien).toEqual([]);
    expect(r.groupes.flatMap((g) => g.entrees.map((e) => e.id))).toEqual(["clients"]);
  });

  it("isole les modules indisponibles hors des groupes et du quotidien", () => {
    const r = repartirModules([
      entree("mon-brief", false),
      entree("clients"),
      entree("finance", false),
    ]);
    expect(r.indisponibles.map((e) => e.id)).toEqual(["mon-brief", "finance"]);
    expect(r.quotidien).toEqual([]);
    expect(r.groupes.flatMap((g) => g.entrees.map((e) => e.id))).toEqual(["clients"]);
    expect(r.nbDisponibles).toBe(1);
  });

  it("exclut l'entrée « Tableau de bord » et gère une liste vide", () => {
    const r = repartirModules([entree("tableau-de-bord")]);
    expect(r).toEqual({ quotidien: [], groupes: [], indisponibles: [], nbDisponibles: 0 });
    expect(repartirModules([])).toEqual(r);
  });

  it("ne garde que des identifiants existants dans la table de navigation", () => {
    const ids = new Set(NAVIGATION.map((e) => e.id));
    for (const id of MODULES_QUOTIDIEN) expect(ids.has(id)).toBe(true);
  });

  it("garde l'anglais des groupes", () => {
    const r = repartirModules([entree("clients")], "en");
    expect(r.groupes[0]?.libelle).toBe("Sell");
  });

  it("accorde le pluriel à partir de 2", () => {
    expect([0, 1, 2].map(pluriel)).toEqual([false, false, true]);
  });
});
