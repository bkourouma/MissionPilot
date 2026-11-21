import { describe, expect, it } from "vitest";
import {
  basculerTous,
  CLE_GROUPES_RAIL,
  ecrireMemoireRail,
  groupesAOuvrir,
  indexClavier,
  lireGroupes,
  lireMemoireRail,
  serialiserGroupes,
  toutEstOuvert,
} from "./rail";

const CONNUS = ["piloter", "produire", "vendre"];

describe("serialiserGroupes / lireGroupes", () => {
  it("fait l'aller-retour, trié et sans doublon", () => {
    const brut = serialiserGroupes(["vendre", "piloter", "vendre"]);
    expect(brut).toBe('["piloter","vendre"]');
    expect(lireGroupes(brut, CONNUS)).toEqual(["piloter", "vendre"]);
  });

  it("ignore les identifiants inconnus et les valeurs de mauvais type", () => {
    expect(lireGroupes('["piloter","disparu",3,null]', CONNUS)).toEqual(["piloter"]);
  });

  it("distingue « tout replié » (liste vide) de « rien de mémorisé » (null)", () => {
    expect(lireGroupes("[]", CONNUS)).toEqual([]);
    expect(lireGroupes(null, CONNUS)).toBeNull();
    expect(lireGroupes("", CONNUS)).toBeNull();
  });

  it("renvoie null pour un JSON invalide ou un objet", () => {
    expect(lireGroupes("{pas du json", CONNUS)).toBeNull();
    expect(lireGroupes('{"a":1}', CONNUS)).toBeNull();
    expect(lireGroupes('"piloter"', CONNUS)).toBeNull();
  });
});

describe("lireMemoireRail / ecrireMemoireRail", () => {
  it("lit et écrit via un stockage injecté", () => {
    const donnees = new Map<string, string>();
    const stockage = {
      getItem: (c: string) => donnees.get(c) ?? null,
      setItem: (c: string, v: string) => void donnees.set(c, v),
    };
    expect(ecrireMemoireRail(stockage, ["produire"])).toBe(true);
    expect(donnees.get(CLE_GROUPES_RAIL)).toBe('["produire"]');
    expect(lireMemoireRail(stockage, CONNUS)).toEqual(["produire"]);
  });

  it("ne lève jamais quand le stockage est bloqué", () => {
    const bloque = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(lireMemoireRail(bloque, CONNUS)).toBeNull();
    expect(ecrireMemoireRail(bloque, ["piloter"])).toBe(false);
  });

  it("gère l'absence de stockage", () => {
    expect(lireMemoireRail(null, CONNUS)).toBeNull();
    expect(ecrireMemoireRail(undefined, ["piloter"])).toBe(false);
  });
});

describe("groupesAOuvrir", () => {
  it("garde toujours le groupe de la page courante ouvert", () => {
    expect(groupesAOuvrir([], ["vendre"])).toEqual(["vendre"]);
    expect(groupesAOuvrir(["piloter"], ["vendre"])).toEqual(["piloter", "vendre"]);
  });

  it("sans mémoire, seul le groupe actif est ouvert", () => {
    expect(groupesAOuvrir(null, ["produire"])).toEqual(["produire"]);
    expect(groupesAOuvrir(["produire"], ["produire"])).toEqual(["produire"]);
  });
});

describe("basculerTous", () => {
  it("replie tout quand tout est ouvert", () => {
    const tous = ["a", "b"];
    expect(toutEstOuvert(new Set(tous), tous)).toBe(true);
    expect(basculerTous(new Set(tous), tous).size).toBe(0);
  });

  it("déplie tout sinon", () => {
    const tous = ["a", "b"];
    expect(toutEstOuvert(new Set(["a"]), tous)).toBe(false);
    expect([...basculerTous(new Set(["a"]), tous)]).toEqual(["a", "b"]);
    expect([...basculerTous(new Set(), tous)]).toEqual(["a", "b"]);
  });

  it("ne considère pas « tout ouvert » une liste vide de groupes", () => {
    expect(toutEstOuvert(new Set(), [])).toBe(false);
  });
});

describe("indexClavier", () => {
  it("descend et monte sans boucler", () => {
    expect(indexClavier("ArrowDown", 0, 3)).toBe(1);
    expect(indexClavier("ArrowDown", 2, 3)).toBe(2);
    expect(indexClavier("ArrowUp", 2, 3)).toBe(1);
    expect(indexClavier("ArrowUp", 0, 3)).toBe(0);
  });

  it("Home et End vont aux extrémités", () => {
    expect(indexClavier("Home", 2, 5)).toBe(0);
    expect(indexClavier("End", 0, 5)).toBe(4);
  });

  it("depuis un élément hors liste (index -1), entre par le début ou la fin", () => {
    expect(indexClavier("ArrowDown", -1, 4)).toBe(0);
    expect(indexClavier("ArrowUp", -1, 4)).toBe(3);
  });

  it("laisse passer les autres touches et les listes vides", () => {
    expect(indexClavier("Tab", 1, 3)).toBeNull();
    expect(indexClavier("Enter", 1, 3)).toBeNull();
    expect(indexClavier("ArrowDown", 0, 0)).toBeNull();
  });
});
