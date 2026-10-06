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

  it("seul un associé valide une proposition (PRD, MIS-05)", () => {
    const valident = ROLES.filter((r) => aPermission([r], "proposition.valider"));
    expect(valident).toEqual(["associe"]);
  });

  it("modifier toute mission : associé et directeur ; lire toutes ne suffit pas", () => {
    const modifient = ROLES.filter((r) => aPermission([r], "mission.modifier_toutes"));
    expect(modifient.sort()).toEqual(["associe", "directeur_mission"]);
    expect(aPermission(["gestionnaire"], "mission.lire_toutes")).toBe(true);
    expect(aPermission(["ressources"], "mission.modifier_toutes")).toBe(false);
  });

  it("un consultant ne peut ni valider un temps ni émettre une facture", () => {
    expect(aPermission(["consultant"], "temps.valider")).toBe(false);
    expect(aPermission(["consultant"], "facture.emettre")).toBe(false);
  });

  it("facturation (FIN-05, FIN-07, FIN-15) : matrice des 8 rôles", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      ROLES.filter((r) => aPermission([r], p)).sort();
    expect(qui("debours.saisir")).toEqual([...ROLES].sort());
    expect(qui("debours.valider")).toEqual(["associe", "chef_mission", "directeur_mission"]);
    expect(qui("facture.lire")).toEqual([
      "associe",
      "chef_mission",
      "directeur_mission",
      "gestionnaire",
    ]);
    expect(qui("facture.emettre")).toEqual(["associe", "gestionnaire"]);
    expect(qui("facture.valider")).toEqual(["associe", "directeur_mission"]);
    expect(qui("taux.gerer")).toEqual(["associe", "gestionnaire"]);
    // Celui qui émet n'approuve pas seul : seul l'associé cumule les deux droits.
    expect(
      ROLES.filter(
        (r) => aPermission([r], "facture.emettre") && aPermission([r], "facture.valider"),
      ),
    ).toEqual(["associe"]);
  });

  it("collaboration (SOC-08) : matrice des 8 rôles", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      ROLES.filter((r) => aPermission([r], p)).sort();
    // Tous les rôles internes commentent ; l'expert externe est borné par la visibilité.
    expect(qui("commentaire.ecrire")).toEqual([...ROLES].sort());
    expect(qui("tache.assigner")).toEqual([
      "associe",
      "chef_mission",
      "directeur_mission",
      "gestionnaire",
      "ressources",
    ]);
  });

  it("les droits de plusieurs rôles s'additionnent", () => {
    expect(aPermission(["consultant", "ressources"], "affectation.gerer")).toBe(true);
  });
});
