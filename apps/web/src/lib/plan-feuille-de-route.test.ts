import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import { formaterDate as d } from "./format";
import {
  cheminFeuilleDeRoute,
  cheminRecalage,
  datesPrevues,
  explicationsInitiative,
  grilleFeuilleDeRoute,
  hrefFeuilleDeRoute,
  initiativesARecaler,
  libelleDecalage,
  libellePeriodeFeuille,
  lirePas,
  messageFeuilleDeRoute,
  messageRecalage,
  periodeInitiative,
  resumeRecalage,
  titreInitiative,
  type FeuilleDeRoute,
  type InitiativeFeuilleDeRoute,
} from "./plan-feuille-de-route";

function ini(
  id: string,
  partiel: Partial<InitiativeFeuilleDeRoute> = {},
): InitiativeFeuilleDeRoute {
  return {
    id,
    parent_id: null,
    titre: `Initiative ${id}`,
    responsable_id: null,
    debut: "2027-01-01",
    echeance: "2027-03-31",
    debut_recale: "2027-01-01",
    echeance_recalee: "2027-03-31",
    decalage_jours: 0,
    recalee: false,
    dependances: [],
    contrainte_par: null,
    conflits: [],
    dependances_ignorees: [],
    critique: false,
    statut: "a_lancer",
    statut_libelle: "À lancer",
    statut_contenu: "brouillon",
    periode_debut: "2027-T1",
    periode_fin: "2027-T1",
    ...partiel,
  };
}

const feuille: FeuilleDeRoute = {
  plan_id: "p",
  pas: "trimestre",
  periodes: [
    { periode: "2027-T1", initiatives: ["a"] },
    { periode: "2027-T2", initiatives: ["b"] },
  ],
  initiatives: [
    ini("a", { critique: true }),
    ini("b", {
      debut: "2027-03-01",
      echeance: "2027-03-31",
      debut_recale: "2027-04-01",
      echeance_recalee: "2027-05-01",
      decalage_jours: 31,
      recalee: true,
      contrainte_par: "a",
      dependances: ["a"],
    }),
  ],
  recalage: {
    fin: "2027-05-01",
    chemin_critique: ["a", "b"],
    nombre_recalees: 1,
    nombre_conflits: 0,
  },
};

describe("feuille de route : mise en forme (aucune date recalculée)", () => {
  it("pas lu dans l'URL, trimestre par défaut", () => {
    expect(lirePas(undefined)).toBe("trimestre");
    expect(lirePas("semestre")).toBe("semestre");
    expect(lirePas(["semestre", "x"])).toBe("semestre");
    expect(lirePas("mois")).toBe("trimestre");
  });

  it("libellés de période et de décalage", () => {
    expect(libellePeriodeFeuille("2027-T1")).toBe("T1 2027");
    expect(libellePeriodeFeuille("2027-S2")).toBe("S2 2027");
    expect(libellePeriodeFeuille("autre")).toBe("autre");
    expect(libelleDecalage(0)).toBe("aucun");
    expect(libelleDecalage(1)).toBe("+1 jour");
    expect(libelleDecalage(46)).toBe("+46 jours");
  });

  it("période recalée et dates prévues", () => {
    const b = feuille.initiatives[1]!;
    expect(periodeInitiative(b)).toBe(`Du ${d("2027-04-01")} au ${d("2027-05-01")}`);
    expect(periodeInitiative({ debut_recale: null, echeance_recalee: "2027-05-01" })).toBe(
      `Jalon au ${d("2027-05-01")}`,
    );
    expect(datesPrevues(b)).toBe(`prévue du ${d("2027-03-01")} au ${d("2027-03-31")}`);
    expect(datesPrevues({ recalee: true, debut: null, echeance: "2027-03-31" })).toBe(
      `prévue au ${d("2027-03-31")}`,
    );
    expect(datesPrevues(feuille.initiatives[0]!)).toBeNull();
  });

  it("grille : présence par période, dans l'ordre de l'API", () => {
    expect(grilleFeuilleDeRoute(feuille).map((l) => [l.initiative.id, l.cases])).toEqual([
      ["a", [true, false]],
      ["b", [false, true]],
    ]);
    expect(initiativesARecaler(feuille)).toEqual(["b"]);
  });

  it("explications : recalage, conflit, dépendances ignorées", () => {
    expect(explicationsInitiative(feuille.initiatives[1]!, feuille)).toEqual([
      "Recalée de +31 jours : elle attend la fin de « Initiative a ».",
    ]);
    const conflit = ini("c", {
      conflits: ["a", "b"],
      statut: "en_cours",
      statut_libelle: "En cours",
      dependances_ignorees: ["z"],
    });
    expect(explicationsInitiative(conflit, feuille)).toEqual([
      "Conflit : « Initiative a », « Initiative b » se terminent après son début ; ses dates ne sont pas recalées car elle est en cours.",
      "Dépendance sans effet (initiative retirée ou abandonnée) : « initiative retirée du plan ».",
    ]);
    const un = ini("d", { conflits: ["a"], dependances_ignorees: ["y", "z"] });
    expect(explicationsInitiative(un, feuille)[0]).toContain("se termine après");
    expect(explicationsInitiative(un, feuille)[1]).toContain("Dépendances sans effet");
    expect(explicationsInitiative(feuille.initiatives[0]!, feuille)).toEqual([]);
    expect(titreInitiative("a", feuille)).toBe("Initiative a");
  });

  it("résumé du recalage", () => {
    expect(resumeRecalage(feuille)).toBe(
      `1 initiative à recaler, aucun conflit ; fin des initiatives au ${d("2027-05-01")}.`,
    );
    expect(
      resumeRecalage({
        recalage: { fin: null, chemin_critique: [], nombre_recalees: 0, nombre_conflits: 2 },
      }),
    ).toBe("Aucune initiative à recaler, 2 conflits.");
    expect(
      resumeRecalage({
        recalage: { fin: null, chemin_critique: [], nombre_recalees: 3, nombre_conflits: 1 },
      }),
    ).toBe("3 initiatives à recaler, 1 conflit.");
  });

  it("messages", () => {
    const r = {
      plan_id: "p",
      appliquees: [
        { id: "b", version: 2, decalage_jours: 31, debut: null, echeance: "2027-05-01" },
      ],
    };
    expect(messageRecalage(r, false)).toBe(
      "1 initiative recalée : nouvelle version à faire valider.",
    );
    expect(messageRecalage({ ...r, appliquees: [...r.appliquees, ...r.appliquees] }, true)).toBe(
      "2 initiatives recalées : nouvelles versions à faire valider. Le partage au client a été retiré.",
    );
    expect(messageFeuilleDeRoute(new ErreurApi("CONFLIT", "x", 409))).toContain("a changé");
    expect(messageFeuilleDeRoute(new ErreurApi("ACCES_REFUSE", "x", 403))).toContain("rôle");
    expect(messageFeuilleDeRoute(new ErreurApi("INTROUVABLE", "x", 404))).toContain("introuvable");
    expect(messageFeuilleDeRoute(new ErreurApi("DEPENDANCE_CYCLIQUE", "Cycle.", 400))).toBe(
      "Cycle.",
    );
  });

  it("chemins", () => {
    expect(hrefFeuilleDeRoute("m", "p")).toBe("/missions/m/plan/p/feuille-de-route");
    expect(hrefFeuilleDeRoute("m", "p", "trimestre")).toBe("/missions/m/plan/p/feuille-de-route");
    expect(hrefFeuilleDeRoute("m", "p", "semestre")).toBe(
      "/missions/m/plan/p/feuille-de-route?pas=semestre",
    );
    expect(cheminFeuilleDeRoute("p", "semestre")).toBe(
      "/api/plans/p/feuille-de-route?pas=semestre",
    );
    expect(cheminRecalage("p")).toBe("/api/plans/p/feuille-de-route/recalage");
  });
});
