import { describe, expect, it } from "vitest";
import { aPermission, PERMISSIONS_PAR_ROLE, ROLES } from "../roles";
import {
  decisionCompetenceSchema,
  estimationDemandeSchema,
  propositionDerogationsSchema,
  rechercheQuerySchema,
  retourValidationSchema,
  retourVersionSchema,
} from "./capitalisation";

describe("permissions de la capitalisation (CAP)", () => {
  it("connaissance.lire : associé, directeur, chef, consultant, expert métier", () => {
    const avec = ROLES.filter((r) => aPermission([r], "connaissance.lire"));
    expect(avec).toEqual([
      "associe",
      "directeur_mission",
      "chef_mission",
      "consultant",
      "expert_metier",
    ]);
  });

  it("competence.gerer : associé, directeur de mission, responsable des ressources", () => {
    const avec = ROLES.filter((r) => aPermission([r], "competence.gerer"));
    expect(avec).toEqual(["associe", "directeur_mission", "ressources"]);
  });

  it("competence.lire (matrice de tous) : associé, directeur de mission, ressources", () => {
    const avec = ROLES.filter((r) => aPermission([r], "competence.lire"));
    expect(avec).toEqual(["associe", "directeur_mission", "ressources"]);
    // Ni le chef de mission ni le gestionnaire, qui lisent pourtant les collaborateurs.
    for (const r of ["chef_mission", "gestionnaire"] as const) {
      expect(aPermission([r], "collaborateurs.lire")).toBe(true);
      expect(aPermission([r], "competence.lire")).toBe(false);
    }
  });

  it("jamais aux rôles du portail", () => {
    for (const r of ["client_dirigeant", "client_contributeur", "client_investisseur"] as const) {
      expect(PERMISSIONS_PAR_ROLE[r]).not.toContain("connaissance.lire");
      expect(PERMISSIONS_PAR_ROLE[r]).not.toContain("competence.gerer");
      expect(PERMISSIONS_PAR_ROLE[r]).not.toContain("competence.lire");
    }
  });
});

describe("schémas de la capitalisation", () => {
  it("version du retour : quatre sections non vides, objet strict", () => {
    const ok = { contexte: "a", methode: "b", ecarts: "c", lecons: "d" };
    expect(retourVersionSchema.safeParse(ok).success).toBe(true);
    expect(retourVersionSchema.safeParse({ ...ok, lecons: "  " }).success).toBe(false);
    expect(retourVersionSchema.safeParse({ ...ok, autre: 1 }).success).toBe(false);
    expect(retourValidationSchema.parse({ version: 2 })).toEqual({
      version: 2,
      acquitte_chiffres: false,
    });
  });

  it("estimation : briques dédoublonnées, effectif minimum borné", () => {
    expect(estimationDemandeSchema.parse({ briques: ["a", "a", "b"] }).briques).toEqual(["a", "b"]);
    expect(estimationDemandeSchema.safeParse({ briques: [] }).success).toBe(false);
    // Plancher de 3 : une durée de mission ne se déduit pas d'une ou deux observations.
    for (const n of [0, 1, 2, 21]) {
      expect(
        estimationDemandeSchema.safeParse({ briques: ["a"], effectif_minimum: n }).success,
      ).toBe(false);
    }
    expect(estimationDemandeSchema.safeParse({ briques: ["a"], effectif_minimum: 3 }).success).toBe(
      true,
    );
  });

  it("clé de groupe de dérogations et décision motivée", () => {
    const cle = "8f6a2b1e-3c4d-4e5f-9a0b-1c2d3e4f5a6b|entretiens_individuels|retirer_brique";
    expect(propositionDerogationsSchema.safeParse({ cle }).success).toBe(true);
    expect(propositionDerogationsSchema.safeParse({ cle: "x" }).success).toBe(false);
    expect(decisionCompetenceSchema.safeParse({ decision: "refusee" }).success).toBe(false);
    expect(
      decisionCompetenceSchema.safeParse({ decision: "refusee", commentaire: "Non" }).success,
    ).toBe(true);
  });

  it("recherche : deux caractères, types connus, limite bornée", () => {
    expect(rechercheQuerySchema.parse({ q: " kora " })).toEqual({ q: "kora", limite: 10 });
    expect(rechercheQuerySchema.parse({ q: "ko", types: "mission, preuve,mission" }).types).toEqual(
      ["mission", "preuve"],
    );
    expect(rechercheQuerySchema.safeParse({ q: "k" }).success).toBe(false);
    expect(rechercheQuerySchema.safeParse({ q: "ko", types: "autre" }).success).toBe(false);
    expect(rechercheQuerySchema.safeParse({ q: "ko", limite: "31" }).success).toBe(false);
  });
});
