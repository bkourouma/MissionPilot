import { describe, expect, it } from "vitest";
import * as qualite from "./index";
import {
  classeRisqueMax,
  ErreurQualite,
  estClasseRisque,
  evaluerGarde,
  gardesRequises,
  rangClasseRisque,
  type ValidationGarde,
} from "./index";

const v = (etape: ValidationGarde["etape"], acteur: string, habilite?: boolean): ValidationGarde =>
  habilite === undefined ? { etape, acteur } : { etape, acteur, habilite };

describe("classes de risque", () => {
  it("ordonne R0 < R1 < R2 < R3 et prend la plus élevée", () => {
    expect(rangClasseRisque("R0")).toBe(0);
    expect(rangClasseRisque("R3")).toBe(3);
    expect(classeRisqueMax(["R1", "R3", "R2"])).toBe("R3");
    expect(classeRisqueMax(["R0"])).toBe("R0");
    expect(classeRisqueMax([])).toBeNull();
  });

  it("reconnaît une classe valide", () => {
    expect(estClasseRisque("R2")).toBe(true);
    expect(estClasseRisque("R4")).toBe(false);
    expect(estClasseRisque(2)).toBe(false);
  });
});

describe("gardesRequises (QUA-01)", () => {
  it("R0 : automatique et journalisée, sans étape humaine", () => {
    expect(gardesRequises("R0")).toEqual({
      classe: "R0",
      etapes: [],
      automatique: true,
      journalisation: true,
      quatreYeux: false,
      signature: false,
    });
  });

  it("R1 : validation de l'auteur", () => {
    expect(gardesRequises("R1").etapes).toEqual(["validation_auteur"]);
  });

  it("R2 : validation du consultant puis relecture du chef de mission", () => {
    expect(gardesRequises("R2").etapes).toEqual([
      "validation_consultant",
      "relecture_chef_mission",
    ]);
    expect(gardesRequises("R2").quatreYeux).toBe(false);
  });

  it("R3 : R2, second expert et signature du directeur", () => {
    const g = gardesRequises("R3");
    expect(g.etapes).toEqual([
      "validation_consultant",
      "relecture_chef_mission",
      "revue_second_expert",
      "signature_directeur_mission",
    ]);
    expect(g).toMatchObject({ automatique: false, quatreYeux: true, signature: true });
  });

  it("refuse une classe inconnue", () => {
    expect(() => gardesRequises("R9" as never)).toThrow(ErreurQualite);
    try {
      gardesRequises("R9" as never);
    } catch (e) {
      expect((e as ErreurQualite).code).toBe("CLASSE_INVALIDE");
    }
  });
});

describe("evaluerGarde", () => {
  it("R0 est complète sans validation", () => {
    const r = evaluerGarde("R0", []);
    expect(r).toMatchObject({ complete: true, automatique: true, manquantes: [] });
    expect(r.prochaineEtape).toBeNull();
  });

  it("R1 : l'auteur valide ; un autre acteur est refusé", () => {
    expect(evaluerGarde("R1", [v("validation_auteur", "u1")], { auteur: "u1" }).complete).toBe(
      true,
    );
    const r = evaluerGarde("R1", [v("validation_auteur", "u2")], { auteur: "u1" });
    expect(r.complete).toBe(false);
    expect(r.violations).toEqual([
      { code: "AUTEUR_ATTENDU", roles: ["validation_auteur"], acteur: "u2" },
    ]);
  });

  it("R1 sans auteur humain : tout acteur habilité valide", () => {
    expect(evaluerGarde("R1", [v("validation_auteur", "u2")]).complete).toBe(true);
    expect(evaluerGarde("R1", [v("validation_auteur", "u2")], { auteur: null }).complete).toBe(
      true,
    );
  });

  it("R2 : dit ce qui manque, dans l'ordre", () => {
    const r = evaluerGarde("R2", []);
    expect(r.manquantes).toEqual(["validation_consultant", "relecture_chef_mission"]);
    expect(r.prochaineEtape).toBe("validation_consultant");
    const r2 = evaluerGarde("R2", [v("validation_consultant", "c1")], { auteur: "c1" });
    expect(r2.etapesFaites).toEqual(["validation_consultant"]);
    expect(r2.prochaineEtape).toBe("relecture_chef_mission");
    expect(r2.complete).toBe(false);
  });

  it("R2 : le relecteur n'est ni le valideur ni l'auteur", () => {
    const ok = evaluerGarde(
      "R2",
      [v("validation_consultant", "c1"), v("relecture_chef_mission", "m1")],
      {
        auteur: "c1",
      },
    );
    expect(ok.complete).toBe(true);
    const memeActeur = evaluerGarde(
      "R2",
      [v("validation_consultant", "c1"), v("relecture_chef_mission", "c1")],
      { auteur: "a1" },
    );
    expect(memeActeur.violations).toEqual([
      {
        code: "CUMUL_INTERDIT",
        roles: ["validation_consultant", "relecture_chef_mission"],
        acteur: "c1",
      },
    ]);
    const auteurRelit = evaluerGarde(
      "R2",
      [v("validation_consultant", "c1"), v("relecture_chef_mission", "a1")],
      { auteur: "a1" },
    );
    expect(auteurRelit.violations[0]).toMatchObject({
      code: "CUMUL_INTERDIT",
      roles: ["auteur", "relecture_chef_mission"],
    });
  });

  it("R3 : quatre yeux jamais cumulables, même déclarés permis", () => {
    const validations = [
      v("validation_consultant", "c1"),
      v("relecture_chef_mission", "m1"),
      v("revue_second_expert", "c1"),
      v("signature_directeur_mission", "d1"),
    ];
    const r = evaluerGarde("R3", validations, {
      auteur: "a1",
      cumulsPermis: [["validation_consultant", "revue_second_expert"]],
    });
    expect(r.complete).toBe(false);
    expect(r.violations).toEqual([
      {
        code: "QUATRE_YEUX",
        roles: ["validation_consultant", "revue_second_expert"],
        acteur: "c1",
      },
    ]);
    const auteurExpert = evaluerGarde(
      "R3",
      [
        v("validation_consultant", "c1"),
        v("relecture_chef_mission", "m1"),
        v("revue_second_expert", "a1"),
        v("signature_directeur_mission", "d1"),
      ],
      { auteur: "a1" },
    );
    expect(auteurExpert.violations.map((x) => x.code)).toEqual(["QUATRE_YEUX"]);
  });

  it("R3 : un cumul déclaré permis est accepté (directeur qui relit et signe)", () => {
    const validations = [
      v("validation_consultant", "c1"),
      v("relecture_chef_mission", "d1"),
      v("revue_second_expert", "e1"),
      v("signature_directeur_mission", "d1"),
    ];
    expect(evaluerGarde("R3", validations, { auteur: "c1" }).violations).toEqual([
      {
        code: "CUMUL_INTERDIT",
        roles: ["relecture_chef_mission", "signature_directeur_mission"],
        acteur: "d1",
      },
    ]);
    const permis = evaluerGarde("R3", validations, {
      auteur: "c1",
      cumulsPermis: [["signature_directeur_mission", "relecture_chef_mission"]],
    });
    expect(permis.complete).toBe(true);
    expect(permis.etapesFaites).toHaveLength(4);
  });

  it("signale doublons, acteur non habilité et étapes superflues", () => {
    const r = evaluerGarde("R2", [
      v("validation_consultant", "c1", false),
      v("validation_consultant", "c2"),
      v("relecture_chef_mission", "m1", true),
      v("signature_directeur_mission", "d1"),
      v("validation_auteur", "c1"),
    ]);
    expect(r.violations).toEqual([
      { code: "ACTEUR_NON_HABILITE", roles: ["validation_consultant"], acteur: "c1" },
      { code: "ETAPE_EN_DOUBLE", roles: ["validation_consultant"], acteur: "c2" },
    ]);
    expect(r.etapesSuperflues).toEqual(["validation_auteur", "signature_directeur_mission"]);
    expect(r.complete).toBe(false);
  });

  it("refuse une validation ou des options mal formées", () => {
    expect(() => evaluerGarde("R2", [{ etape: "inconnue" as never, acteur: "x" }])).toThrow(
      ErreurQualite,
    );
    expect(() => evaluerGarde("R2", [v("validation_consultant", "")])).toThrow(ErreurQualite);
    expect(() => evaluerGarde("R2", [], { cumulsPermis: [["auteur", "auteur"]] })).toThrow(
      ErreurQualite,
    );
    expect(() =>
      evaluerGarde("R2", [], { cumulsPermis: [["auteur", "inconnu" as never]] }),
    ).toThrow(ErreurQualite);
  });
});

describe("API publique du domaine qualité", () => {
  it("expose les moteurs", () => {
    for (const nom of [
      "ErreurQualite",
      "CLASSES_RISQUE",
      "ETAPES_GARDE",
      "gardesRequises",
      "evaluerGarde",
      "classeRisqueMax",
    ]) {
      expect(qualite).toHaveProperty(nom);
    }
  });
});
