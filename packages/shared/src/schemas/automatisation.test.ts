import { describe, expect, it } from "vitest";
import { aPermission, ROLES, ROLES_CLIENT } from "../roles";
import {
  actionAutomatisationSchema,
  avancementGenerationSchema,
  avancementListeQuerySchema,
  avancementModificationSchema,
  avancementParametresModificationSchema,
  avancementVersionSchema,
  chargeAvancementHebdoSchema,
  contenuAvancementSchema,
  contenuAvancementPortailSchema,
  projeterContenuAvancementPortail,
  LIBELLES_STATUT_AVANCEMENT_RAPPORT,
  LIBELLES_STATUT_COMMENTAIRE_AVANCEMENT,
  STATUTS_AVANCEMENT_RAPPORT,
  STATUTS_COMMENTAIRE_AVANCEMENT,
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

describe("rapport d'avancement hebdomadaire (AUT-10)", () => {
  it("la charge de la tâche est stricte", () => {
    const id = "5c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a11";
    expect(chargeAvancementHebdoSchema.safeParse({ semaine: "2026-10-19" }).success).toBe(true);
    expect(
      chargeAvancementHebdoSchema.safeParse({ semaine: "2026-10-19", apres_id: id, lot: 2 })
        .success,
    ).toBe(true);
    for (const mauvaise of [
      {},
      { semaine: "2026-02-30" },
      { semaine: "2026-10-19", lot: 0 },
      { semaine: "2026-10-19", apres_id: "x" },
      { semaine: "2026-10-19", autre: 1 },
    ]) {
      expect(chargeAvancementHebdoSchema.safeParse(mauvaise).success).toBe(false);
    }
  });

  it("la modification ne porte que l'introduction et le commentaire, jamais les chiffres", () => {
    expect(
      avancementModificationSchema.safeParse({ version: 1, commentaire: "Bon mois." }).success,
    ).toBe(true);
    const vide = avancementModificationSchema.safeParse({ version: 1, introduction: "  " });
    expect(vide.success && vide.data.introduction).toBe(null);
    for (const mauvaise of [
      { version: 1 },
      { commentaire: "x" },
      { version: 0, commentaire: "x" },
      { version: 1, commentaire: "x", contenu: {} },
      { version: 1, commentaire: "x", avancement: 90 },
      { version: 1, commentaire: "a".repeat(4001) },
      { version: 1, introduction: "a".repeat(2001) },
    ]) {
      expect(
        avancementModificationSchema.safeParse(mauvaise).success,
        JSON.stringify(mauvaise),
      ).toBe(false);
    }
  });

  it("régénération, validation, génération manuelle et liste", () => {
    expect(avancementVersionSchema.safeParse({ version: 3 }).success).toBe(true);
    expect(avancementVersionSchema.safeParse({}).success).toBe(false);
    expect(avancementVersionSchema.safeParse({ version: 3, x: 1 }).success).toBe(false);
    expect(avancementGenerationSchema.safeParse({}).success).toBe(true);
    expect(avancementGenerationSchema.safeParse({ semaine: "2026-10-19" }).success).toBe(true);
    expect(avancementGenerationSchema.safeParse({ semaine: "2026-10-20" }).success).toBe(false);
    expect(avancementListeQuerySchema.parse({}).limite).toBe(26);
    expect(avancementListeQuerySchema.safeParse({ limite: "0" }).success).toBe(false);
    expect(avancementListeQuerySchema.safeParse({ avant: "2026-10-19" }).success).toBe(true);
  });

  it("le paramètre du cabinet refuse l'envoi par e-mail", () => {
    expect(avancementParametresModificationSchema.safeParse({ actif: false }).success).toBe(true);
    expect(
      avancementParametresModificationSchema.safeParse({ actif: true, envoi_email: false }).success,
    ).toBe(true);
    const refus = avancementParametresModificationSchema.safeParse({
      actif: true,
      envoi_email: true,
    });
    expect(refus.success).toBe(false);
    expect(JSON.stringify(refus)).toContain("e-mail");
    expect(avancementParametresModificationSchema.safeParse({ envoi_email: false }).success).toBe(
      false,
    );
  });

  it("le contenu écarte les clés inconnues (liste blanche) et libellés de statut", () => {
    const contenu = {
      version: 1,
      semaine: "2026-10-19",
      semaine_fin: "2026-10-25",
      date_reference: "2026-10-21",
      mission: { intitule: "M", statut: "en_cours", budget_jours: 99 },
      avancement: { pourcentage: 40, elements: 3 },
      jalons: {
        total: 0,
        atteints: { nombre: 0, elements: [] },
        en_retard: { nombre: 0, elements: [] },
        a_venir: { nombre: 0, elements: [] },
        sans_date: 0,
      },
      kpis: { total: 0, vert: 0, orange: 0, rouge: 0, non_evalue: 0, elements: [] },
      livrables: { total: 0, partages: 0, non_partages: 0, elements: [] },
      faits_saillants: [{ code: "avancement", texte: "Avancement physique : 40 %." }],
      cout_total: 1000,
    };
    const lu = contenuAvancementSchema.parse(contenu);
    expect(JSON.stringify(lu)).not.toContain("budget_jours");
    expect(JSON.stringify(lu)).not.toContain("cout_total");
    expect(contenuAvancementSchema.safeParse({ ...contenu, version: 2 }).success).toBe(false);
    expect(LIBELLES_STATUT_AVANCEMENT_RAPPORT.valide).toBe("Validé");
    expect(LIBELLES_STATUT_COMMENTAIRE_AVANCEMENT.brouillon_ia).toBe("Brouillon IA à relire");
    expect(STATUTS_AVANCEMENT_RAPPORT).toEqual(["brouillon", "valide"]);
    expect(STATUTS_COMMENTAIRE_AVANCEMENT).toEqual(["vide", "brouillon_ia", "redige"]);
  });
  it("projection portail : sans non_partages, total = partagés, liste blanche stricte", () => {
    const contenu = contenuAvancementSchema.parse({
      version: 1,
      semaine: "2026-10-19",
      semaine_fin: "2026-10-25",
      date_reference: "2026-10-21",
      mission: { intitule: "M", statut: "en_cours" },
      avancement: { pourcentage: 40, elements: 3 },
      jalons: {
        total: 0,
        atteints: { nombre: 0, elements: [] },
        en_retard: { nombre: 0, elements: [] },
        a_venir: { nombre: 0, elements: [] },
        sans_date: 0,
      },
      kpis: { total: 0, vert: 0, orange: 0, rouge: 0, non_evalue: 0, elements: [] },
      livrables: {
        total: 5,
        partages: 2,
        non_partages: 3,
        elements: [{ nom: "Rapport", type: "livrable", version: 1 }],
      },
      faits_saillants: [
        { code: "avancement", texte: "Avancement physique : 40 %." },
        { code: "livrables", texte: "5 livrables partagés." },
      ],
    });
    const p = projeterContenuAvancementPortail(contenu);
    expect(p.livrables).toEqual({
      total: 2,
      partages: 2,
      elements: [{ nom: "Rapport", type: "livrable", version: 1 }],
    });
    expect(JSON.stringify(p)).not.toContain("non_partages");
    expect(p.faits_saillants.find((f) => f.code === "livrables")?.texte).toBe(
      "2 livrables partagés.",
    );
    expect(contenuAvancementPortailSchema.safeParse(p).success).toBe(true);
    expect(
      contenuAvancementPortailSchema.safeParse({
        ...p,
        livrables: { ...p.livrables, non_partages: 3 },
      }).success,
    ).toBe(false);
    const aucun = projeterContenuAvancementPortail({
      ...contenu,
      livrables: { total: 4, partages: 0, non_partages: 4, elements: [] },
    });
    expect(aucun.livrables.total).toBe(0);
    expect(aucun.faits_saillants.some((f) => f.code === "livrables")).toBe(false);
  });
});
