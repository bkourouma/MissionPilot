import { describe, expect, it } from "vitest";
import { ROLES } from "@missionpilot/shared";
import {
  ongletsClient,
  saisieDepuisTaux,
  saisieTauxVide,
  validerModificationTaux,
  validerTaux,
  voitTauxNegocies,
} from "./taux-clients";

describe("voitTauxNegocies", () => {
  it("réserve la grille aux associés et gestionnaires (finance.lire et taux.gerer)", () => {
    for (const role of ROLES) {
      expect(voitTauxNegocies([role])).toBe(role === "associe" || role === "gestionnaire");
    }
  });
});

describe("ongletsClient", () => {
  it("n'ajoute l'onglet des taux qu'avec les droits financiers", () => {
    expect(ongletsClient("c", ["associe"]).map((o) => o.id)).toEqual(["fiche", "taux"]);
    expect(ongletsClient("c", ["chef_mission"]).map((o) => o.id)).toEqual(["fiche"]);
  });
});

describe("validerTaux", () => {
  it("produit la charge en unités mineures", () => {
    expect(
      validerTaux({
        ...saisieTauxVide("XOF"),
        grade_id: "g1",
        taux: "350 000",
        valide_du: "2026-01-01",
      }),
    ).toEqual({
      ok: true,
      charge: {
        grade_id: "g1",
        taux: 350000,
        devise: "XOF",
        valide_du: "2026-01-01",
        valide_au: null,
      },
    });
    const eur = validerTaux({ ...saisieTauxVide("EUR"), grade_id: "g1", taux: "800,50" });
    expect(eur.ok && eur.charge.taux).toBe(80050);
  });

  it("refuse un grade absent, une devise inconnue, une validité inversée", () => {
    const r = validerTaux({
      grade_id: "",
      taux: "x",
      devise: "GBP",
      valide_du: "2026-12-31",
      valide_au: "2026-01-01",
    });
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual([
      "devise",
      "grade_id",
      "taux",
      "valide_au",
    ]);
  });

  it("modifie le taux et la validité", () => {
    const t = {
      id: "t",
      client_id: "c",
      grade_id: "g",
      grade_code: "senior",
      grade_libelle: "Senior",
      taux: 400000,
      devise: "XOF" as const,
      valide_du: null,
      valide_au: "2026-12-31",
      cree_le: "",
      modifie_le: "",
    };
    expect(validerModificationTaux(saisieDepuisTaux(t), "XOF")).toEqual({
      ok: true,
      charge: { taux: 400000, valide_du: null, valide_au: "2026-12-31" },
    });
    expect(validerModificationTaux({ ...saisieDepuisTaux(t), taux: "" }, "XOF").ok).toBe(false);
  });
});
