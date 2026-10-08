import { describe, expect, it } from "vitest";
import { aPermission, ROLES, ROLES_CLIENT } from "../roles";
import {
  actionAutomatisationSchema,
  AUTOMATISATIONS_STANDARD,
  automatisationCreationSchema,
  automatisationModificationSchema,
  CATALOGUE_EVENEMENTS,
  CODES_AUTOMATISATION_STANDARD,
  conditionAutomatisationBorneeSchema,
  decisionBrouillonAutomatisationSchema,
  definitionAutomatisationSchema,
  evenementDuCatalogue,
  REGISTRE_ACTIONS_AUTOMATISATION,
  simulationDefinitionSchema,
  TYPES_ACTION_AUTOMATISATION,
} from "./automatisation";

const qui = (p: Parameters<typeof aPermission>[1]) =>
  [...ROLES, ...ROLES_CLIENT].filter((r) => aPermission([r], p)).sort();

describe("permissions de l'automatisation (AUT)", () => {
  it("lecture : associé, directeur et chef de mission ; gestion : associé et directeur", () => {
    expect(qui("automatisation.lire")).toEqual(["associe", "chef_mission", "directeur_mission"]);
    expect(qui("automatisation.gerer")).toEqual(["associe", "directeur_mission"]);
  });
});

describe("catalogue et registre", () => {
  it("chaque événement déclare mission_id et des champs typés", () => {
    for (const [code, e] of Object.entries(CATALOGUE_EVENEMENTS)) {
      expect(code).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
      expect(e.champs.mission_id.type, code).toBe("identifiant");
    }
    expect(evenementDuCatalogue("mission.jalon_atteint")?.source).toBe("base");
    expect(evenementDuCatalogue("toString")).toBeNull();
  });

  it("seule la relance est envoyée au client, et elle est R0", () => {
    for (const t of TYPES_ACTION_AUTOMATISATION) {
      const m = REGISTRE_ACTIONS_AUTOMATISATION[t];
      if (m.vers_client) expect(m.classe_risque, t).toBe("R0");
    }
    expect(
      TYPES_ACTION_AUTOMATISATION.filter((t) => REGISTRE_ACTIONS_AUTOMATISATION[t].vers_client),
    ).toEqual(["relance_questionnaire"]);
  });
});

describe("bibliothèque standard (AUT-03)", () => {
  it("quatre automatisations valides, codes uniques", () => {
    expect(CODES_AUTOMATISATION_STANDARD).toHaveLength(4);
    expect(new Set(CODES_AUTOMATISATION_STANDARD).size).toBe(4);
    for (const a of AUTOMATISATIONS_STANDARD) {
      expect(definitionAutomatisationSchema.safeParse(a.definition).success, a.code).toBe(true);
    }
  });
});

describe("schémas", () => {
  const definition = {
    evenement_code: "questionnaire.sans_reponse",
    condition: { type: "comparaison", champ: "jours_sans_reponse", operateur: "egal", valeur: 10 },
    actions: [{ type: "notifier", destinataires: ["chef_mission"], titre: "Alerte" }],
  };

  it("complète les valeurs par défaut", () => {
    const d = definitionAutomatisationSchema.parse(definition);
    expect(d.mode_execution).toBe("responsable");
    expect(d.actions[0]).toEqual({
      type: "notifier",
      destinataires: ["chef_mission"],
      titre: "Alerte",
      corps: "",
    });
    expect(
      definitionAutomatisationSchema.parse({ ...definition, condition: undefined }).condition,
    ).toBeNull();
  });

  it("refuse champ supplémentaire, événement inconnu, action inconnue, doublons", () => {
    expect(definitionAutomatisationSchema.safeParse({ ...definition, autre: 1 }).success).toBe(
      false,
    );
    expect(
      definitionAutomatisationSchema.safeParse({ ...definition, evenement_code: "x.y" }).success,
    ).toBe(false);
    expect(actionAutomatisationSchema.safeParse({ type: "supprimer" }).success).toBe(false);
    expect(
      actionAutomatisationSchema.safeParse({
        type: "notifier",
        destinataires: ["chef_mission", "chef_mission"],
        titre: "x",
      }).success,
    ).toBe(false);
    expect(actionAutomatisationSchema.safeParse({ type: "facture_brouillon", x: 1 }).success).toBe(
      false,
    );
    expect(definitionAutomatisationSchema.safeParse({ ...definition, actions: [] }).success).toBe(
      false,
    );
  });

  it("borne l'imbrication d'une condition avant l'analyse récursive", () => {
    let c: unknown = { type: "renseigne", champ: "titre" };
    for (let i = 0; i < 20; i++) c = { type: "non", condition: c };
    expect(conditionAutomatisationBorneeSchema.safeParse(c).success).toBe(false);
    expect(
      conditionAutomatisationBorneeSchema.safeParse({
        type: "tous",
        conditions: [
          { type: "comparaison", champ: "titre", operateur: "dans", valeur: ["a", "b"] },
        ],
      }).success,
    ).toBe(true);
    expect(
      conditionAutomatisationBorneeSchema.safeParse({ type: "renseigne", champ: "Titre" }).success,
    ).toBe(false);
  });

  it("création, modification, simulation et décision", () => {
    expect(automatisationCreationSchema.safeParse({ nom: "A", definition }).success).toBe(true);
    expect(automatisationModificationSchema.safeParse({}).success).toBe(false);
    expect(automatisationModificationSchema.safeParse({ nom: "B" }).success).toBe(true);
    expect(simulationDefinitionSchema.parse({ definition }).limite).toBe(200);
    expect(simulationDefinitionSchema.safeParse({ definition, limite: 501 }).success).toBe(false);
    expect(decisionBrouillonAutomatisationSchema.safeParse({ decision: "validee" }).success).toBe(
      true,
    );
    expect(decisionBrouillonAutomatisationSchema.safeParse({ decision: "modifiee" }).success).toBe(
      false,
    );
    expect(
      decisionBrouillonAutomatisationSchema.safeParse({ decision: "validee", texte_final: "x" })
        .success,
    ).toBe(false);
    expect(decisionBrouillonAutomatisationSchema.safeParse({ decision: "rejetee" }).success).toBe(
      false,
    );
    expect(
      decisionBrouillonAutomatisationSchema.safeParse({ decision: "rejetee", motif: "Hors sujet" })
        .success,
    ).toBe(true);
  });
});
