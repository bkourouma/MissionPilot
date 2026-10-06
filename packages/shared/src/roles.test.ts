import { describe, expect, it } from "vitest";
import { aPermission, PERMISSIONS, PERMISSIONS_PAR_ROLE, ROLES } from "./roles";

describe("droits par rôle", () => {
  it("chaque rôle a une liste de droits connus", () => {
    for (const role of ROLES) {
      for (const p of PERMISSIONS_PAR_ROLE[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it("les coûts, taux et marges ne sont visibles que des associés et gestionnaires (FIN-02)", () => {
    const voient = ROLES.filter((r) => aPermission([r], "finance.lire"));
    expect(voient.sort()).toEqual(["associe", "gestionnaire"]);
  });

  it("un consultant ne peut ni valider un temps ni émettre une facture", () => {
    expect(aPermission(["consultant"], "temps.valider")).toBe(false);
    expect(aPermission(["consultant"], "facture.emettre")).toBe(false);
  });

  it("les droits de plusieurs rôles s'additionnent", () => {
    expect(aPermission(["consultant", "ressources"], "affectation.gerer")).toBe(true);
  });
});
