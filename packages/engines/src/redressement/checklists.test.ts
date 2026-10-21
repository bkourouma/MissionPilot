import { describe, expect, it } from "vitest";
import {
  CHECKLISTS_DEPART,
  ITEMS_CHECKLIST_MAX,
  ITEM_AIDE_MAX,
  ITEM_ID_MAX,
  ITEM_LIBELLE_MAX,
  REPONSES_CHECKLIST,
  SECTEURS_CHECKLIST,
  VERSION_CHECKLISTS,
  VERSION_CHECKLISTS_DEPART,
  checklistDepart,
  evaluerChecklist,
  validerModeleChecklist,
  type ItemChecklist,
  type ReponseChecklist,
} from "./checklists";
import { ErreurRedressement } from "./erreurs";
import { DOMAINES_URGENCE } from "./urgence";

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.code;
    throw e;
  }
  return "aucun";
};

const manquants = (f: () => unknown): readonly string[] => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.manquants;
    throw e;
  }
  return [];
};

const item = (id: string, domaine: ItemChecklist["domaine"], extra = {}): ItemChecklist => ({
  id,
  domaine,
  libelle: `Libellé de ${id} ?`,
  ...extra,
});

describe("check-lists de départ (RED-03)", () => {
  it("trois check-lists (industrie, services, commerce), de 8 à 10 items, à valider par un expert", () => {
    expect(CHECKLISTS_DEPART.map((c) => c.secteur)).toEqual(["industrie", "services", "commerce"]);
    expect(VERSION_CHECKLISTS_DEPART).toBe(1);
    for (const c of CHECKLISTS_DEPART) {
      expect(c.a_valider_par_un_expert, c.code).toBe(true);
      expect(c.items.length, c.code).toBeGreaterThanOrEqual(8);
      expect(c.items.length, c.code).toBeLessThanOrEqual(10);
      expect(() => validerModeleChecklist(c.items), c.code).not.toThrow();
      expect(SECTEURS_CHECKLIST).toContain(c.secteur);
      // Les cinq domaines de la grille d'urgence sont couverts.
      for (const d of DOMAINES_URGENCE) {
        expect(
          c.items.some((i) => i.domaine === d),
          `${c.code} ${d}`,
        ).toBe(true);
      }
    }
  });

  it("codes et identifiants uniques ; recherche par code", () => {
    const codes = CHECKLISTS_DEPART.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    const ids = CHECKLISTS_DEPART.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(checklistDepart("depart_commerce")?.secteur).toBe("commerce");
    expect(checklistDepart("inconnu")).toBeUndefined();
  });

  it("aucun terme juridique dans les formulations", () => {
    const interdits = ["cessation des paiements", "faillite", "défaillance", "état de crise"];
    for (const c of CHECKLISTS_DEPART) {
      for (const texte of [c.intitule, ...c.items.map((i) => i.libelle)]) {
        for (const mot of interdits) expect(texte.toLowerCase()).not.toContain(mot);
      }
    }
  });
});

describe("validerModeleChecklist", () => {
  it("accepte un modèle valide, avec ou sans aide", () => {
    expect(() =>
      validerModeleChecklist([
        item("a1", "tresorerie"),
        item("b-2_x", "social", { aide: "Voir le classeur" }),
        item("c3", "financement", { aide: null }),
      ]),
    ).not.toThrow();
  });

  it("refuse un nombre d'items hors bornes (0, 41) et un tableau absent", () => {
    expect(code(() => validerModeleChecklist([]))).toBe("ENTREE_INVALIDE");
    const trop = Array.from({ length: ITEMS_CHECKLIST_MAX + 1 }, (_, i) =>
      item(`i${i}`, "activite"),
    );
    expect(code(() => validerModeleChecklist(trop))).toBe("ENTREE_INVALIDE");
    expect(code(() => validerModeleChecklist(trop.slice(0, ITEMS_CHECKLIST_MAX)))).toBe("aucun");
    expect(code(() => validerModeleChecklist(undefined as unknown as ItemChecklist[]))).toBe(
      "ENTREE_INVALIDE",
    );
  });

  it("refuse un item mal formé, un identifiant invalide ou en double", () => {
    expect(code(() => validerModeleChecklist([null as unknown as ItemChecklist]))).toBe(
      "ENTREE_INVALIDE",
    );
    for (const id of ["", "A", "-x", "a b", "é", "x".repeat(ITEM_ID_MAX + 1)]) {
      expect(
        code(() => validerModeleChecklist([item(id, "social")])),
        id,
      ).toBe("ENTREE_INVALIDE");
    }
    expect(
      code(() => validerModeleChecklist([{ domaine: "social", libelle: "x" } as ItemChecklist])),
    ).toBe("ENTREE_INVALIDE");
    const doublon = () => validerModeleChecklist([item("a", "social"), item("a", "activite")]);
    expect(code(doublon)).toBe("ENTREE_INVALIDE");
    expect(manquants(doublon)).toEqual(["a"]);
    expect(code(() => validerModeleChecklist([item("x".repeat(ITEM_ID_MAX), "social")]))).toBe(
      "aucun",
    );
  });

  it("refuse un domaine inconnu, un libellé vide ou trop long, une aide trop longue", () => {
    expect(
      code(() => validerModeleChecklist([item("a", "juridique" as ItemChecklist["domaine"])])),
    ).toBe("ENTREE_INVALIDE");
    expect(code(() => validerModeleChecklist([item("a", "social", { libelle: "   " })]))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(
      code(() =>
        validerModeleChecklist([
          item("a", "social", { libelle: "x".repeat(ITEM_LIBELLE_MAX + 1) }),
        ]),
      ),
    ).toBe("ENTREE_INVALIDE");
    expect(
      code(() =>
        validerModeleChecklist([item("a", "social", { libelle: "x".repeat(ITEM_LIBELLE_MAX) })]),
      ),
    ).toBe("aucun");
    expect(
      code(() =>
        validerModeleChecklist([item("a", "social", { aide: "x".repeat(ITEM_AIDE_MAX + 1) })]),
      ),
    ).toBe("ENTREE_INVALIDE");
    expect(code(() => validerModeleChecklist([item("a", "social", { aide: "" })]))).toBe(
      "ENTREE_INVALIDE",
    );
    // Le message ne recopie pas la valeur saisie.
    try {
      validerModeleChecklist([item("a", "social", { libelle: "" })]);
    } catch (e) {
      expect((e as Error).message).not.toContain("Libellé de a");
    }
  });
});

describe("evaluerChecklist", () => {
  const items: ItemChecklist[] = [
    item("t1", "tresorerie"),
    item("t2", "tresorerie"),
    item("t3", "tresorerie"),
    item("t4", "tresorerie"),
    item("a1", "activite"),
    item("s1", "social"),
    item("s2", "social"),
  ];

  it("aucune réponse : rien n'est conforme, complétude 0 ; domaines vides sans taux", () => {
    const r = evaluerChecklist(items, {});
    expect(r.version).toBe(VERSION_CHECKLISTS);
    expect(r.complete).toBe(false);
    expect(r.non_renseignes).toEqual(["t1", "t2", "t3", "t4", "a1", "s1", "s2"]);
    expect(r.non_conformes).toEqual([]);
    expect(r.global).toMatchObject({
      total: 7,
      oui: 0,
      non_renseignes: 7,
      applicables: 7,
      completude_pb: 0,
      conformite_pb: 0,
    });
    expect(r.domaines.map((d) => d.domaine)).toEqual([...DOMAINES_URGENCE]);
    const exploitation = r.domaines.find((d) => d.domaine === "exploitation")!;
    expect(exploitation).toMatchObject({ total: 0, completude_pb: null, conformite_pb: null });
  });

  it("taux exacts par domaine : trésorerie oui/non/partiel/sans objet", () => {
    const r = evaluerChecklist(items, {
      t1: "oui",
      t2: "non",
      t3: "partiel",
      t4: "sans_objet",
      a1: "oui",
      s1: "oui",
    });
    const t = r.domaines.find((d) => d.domaine === "tresorerie")!;
    // Complétude : 4 renseignés sur 4. Conformité : (2×1 + 1) / (2×3) = 5000 pb.
    expect(t).toMatchObject({
      total: 4,
      oui: 1,
      non: 1,
      partiel: 1,
      sans_objet: 1,
      non_renseignes: 0,
      applicables: 3,
      completude_pb: 10_000,
      conformite_pb: 5000,
    });
    expect(r.domaines.find((d) => d.domaine === "activite")).toMatchObject({
      completude_pb: 10_000,
      conformite_pb: 10_000,
    });
    // Social : s2 non renseigné, il reste au dénominateur : 1 oui sur 2 applicables.
    expect(r.domaines.find((d) => d.domaine === "social")).toMatchObject({
      non_renseignes: 1,
      completude_pb: 5000,
      conformite_pb: 5000,
    });
    expect(r.non_conformes).toEqual(["t2"]);
    expect(r.partiels).toEqual(["t3"]);
    expect(r.non_renseignes).toEqual(["s2"]);
    expect(r.complete).toBe(false);
    // Global : renseignés 6 sur 7 = 8571 pb ; (2×3 + 1) / (2×6) = 5833 pb.
    expect(r.global).toMatchObject({ completude_pb: 8571, conformite_pb: 5833, applicables: 6 });
  });

  it("tout « oui » : 10 000 pb et liste complète ; tout « sans objet » : conformité nulle (null)", () => {
    const oui = Object.fromEntries(items.map((i) => [i.id, "oui" as const]));
    const r = evaluerChecklist(items, oui);
    expect(r.complete).toBe(true);
    expect(r.global).toMatchObject({ completude_pb: 10_000, conformite_pb: 10_000 });
    const so = Object.fromEntries(items.map((i) => [i.id, "sans_objet" as const]));
    const s = evaluerChecklist(items, so);
    expect(s.global).toMatchObject({ applicables: 0, completude_pb: 10_000, conformite_pb: null });
    expect(s.domaines.find((d) => d.domaine === "tresorerie")!.conformite_pb).toBeNull();
  });

  it("arrondi au point de base (demi vers le haut) et entiers exacts", () => {
    const trois = [item("a", "social"), item("b", "social"), item("c", "social")];
    const r = evaluerChecklist(trois, { a: "oui" });
    // 1/3 = 3333 pb ; conformité 2/6 = 3333 pb.
    expect(r.global.completude_pb).toBe(3333);
    expect(r.global.conformite_pb).toBe(3333);
    const deux = evaluerChecklist(trois, { a: "oui", b: "oui" });
    expect(deux.global.completude_pb).toBe(6667);
    expect(Number.isInteger(deux.global.conformite_pb)).toBe(true);
  });

  it("entrées invalides : item inconnu, réponse invalide, modèle invalide, prototype", () => {
    expect(code(() => evaluerChecklist(items, { zz: "oui" }))).toBe("QUESTION_INCONNUE");
    expect(manquants(() => evaluerChecklist(items, { zz: "oui" }))).toEqual(["zz"]);
    expect(code(() => evaluerChecklist(items, { t1: "peut-etre" as ReponseChecklist }))).toBe(
      "REPONSE_INVALIDE",
    );
    expect(code(() => evaluerChecklist([], {}))).toBe("ENTREE_INVALIDE");
    // Un identifiant hérité du prototype n'est pas une réponse.
    const r = evaluerChecklist([item("constructor", "social")], {});
    expect(r.non_renseignes).toEqual(["constructor"]);
  });

  it("les quatre réponses de référence sont bien celles du moteur", () => {
    expect([...REPONSES_CHECKLIST]).toEqual(["oui", "non", "partiel", "sans_objet"]);
  });
});
