import { describe, expect, it } from "vitest";
import type { Role } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import type { ResumeModele } from "./plan-modele";
import {
  AVERTISSEMENT_PARTAGE,
  cheminCreationPlan,
  cheminElements,
  cheminHistorique,
  cheminPartage,
  cheminPlan,
  cheminPlansMission,
  cheminValidationElement,
  cheminVersionsElement,
  decompteStatuts,
  droitsPlan,
  ELEMENTS_PLAN_MAX,
  etatPlanChange,
  HORIZON_PLAN,
  hrefModele,
  hrefPlan,
  hrefPlans,
  libelleElement,
  libellePerspective,
  libelleStatutContenu,
  libelleStatutInitiative,
  libelleVersionElement,
  lireCurseur,
  manquesPartage,
  MESSAGE_ELEMENTS_MAX,
  MESSAGE_INTROUVABLE_PLAN,
  MESSAGE_MISSION_CLOTUREE,
  messageEcriture,
  messagePlan,
  OPTIONS_HORIZON,
  RAISON_AUTEUR_CONTENU,
  RAISON_AUTEUR_MODELE,
  raisonCreationImpossible,
  raisonValidationElement,
  raisonValidationModele,
  STATUT_CONTENU_PLAN,
  structurerPlan,
  TYPES_UNIQUES,
  validerCreationPlan,
  type ContextePlan,
  type ElementPlan,
} from "./plan-strategique";

const DIRECTEUR = "d0000000-0000-4000-8000-000000000001";
const CHEF = "c0000000-0000-4000-8000-000000000002";
const MOI = "a0000000-0000-4000-8000-000000000003";

function ctx(roles: Role[], utilisateurId = MOI, statut = "en_cours"): ContextePlan {
  return { roles, utilisateurId, mission: { directeur_id: DIRECTEUR, chef_id: CHEF, statut } };
}

let compteur = 0;
function element(partiel: Partial<ElementPlan> & Pick<ElementPlan, "type">): ElementPlan {
  compteur += 1;
  return {
    id: `e${compteur}`,
    parent_id: null,
    cree_par: MOI,
    cree_le: "2027-01-01T00:00:00Z",
    version: 1,
    statut_contenu: "brouillon",
    retire: false,
    donnees: {},
    auteur_id: MOI,
    auteur_nom: "Awa Koné",
    version_le: "2027-01-01T00:00:00Z",
    ...partiel,
  };
}

const modele = (validation: ResumeModele["validation"], version = 2): ResumeModele => ({
  id: "m",
  version,
  moteur: "engines/plan-strategique@1",
  commentaire: null,
  cree_par: MOI,
  auteur_nom: "Awa Koné",
  calcule_le: "2027-01-01T00:00:00Z",
  validation,
  equilibre: true,
  synthese: [],
  alertes: [],
});

describe("statuts et libellés", () => {
  it("brouillon propre au plan, les autres repris des contenus IA (texte et icône)", () => {
    expect(STATUT_CONTENU_PLAN.brouillon.libelle).toBe("Brouillon");
    expect(STATUT_CONTENU_PLAN.brouillon_ia.libelle).toBe("Brouillon IA");
    expect(STATUT_CONTENU_PLAN.modifie.libelle).toBe("Modifié");
    expect(STATUT_CONTENU_PLAN.valide.libelle).toBe("Validé");
    expect(libelleStatutContenu("inconnu")).toBe("Statut inconnu");
    expect(libellePerspective("apprentissage")).toBe("Apprentissage et croissance");
    expect(libellePerspective("x")).toBe("Perspective non précisée");
    expect(libelleStatutInitiative("en_cours")).toBe("En cours");
    expect(HORIZON_PLAN).toEqual({ defaut: 5, min: 3, max: 5 });
    expect(TYPES_UNIQUES).toEqual(["diagnostic", "swot", "vision_mission"]);
  });

  it("libellé d'un élément et d'une version", () => {
    expect(libelleElement(element({ type: "axe", donnees: { titre: "Croissance" } }))).toBe(
      "Axe stratégique « Croissance »",
    );
    expect(libelleElement(element({ type: "swot", retire: true }))).toBe("Analyse SWOT (retiré)");
    expect(
      libelleVersionElement({
        version: 3,
        statut_contenu: "valide",
        auteur_nom: "Kofi",
        cree_le: "2027-01-12T14:05:00Z",
      }),
    ).toBe("Version 3 · Validé · par Kofi · 12 janv. 2027 à 14:05");
  });
});

describe("droits d'affichage (l'API reste juge)", () => {
  it("chef de la mission : crée, rédige, valide, partage ; non dispensé", () => {
    expect(droitsPlan(ctx(["chef_mission"], CHEF))).toEqual({
      responsable: true,
      dispense: false,
      cloturee: false,
      creer: true,
      rediger: true,
      valider: true,
      partager: true,
    });
  });

  it("directeur de la mission dispensé ; associé dispensé ; consultant rédige seulement", () => {
    expect(droitsPlan(ctx(["directeur_mission"], DIRECTEUR)).dispense).toBe(true);
    const associe = droitsPlan(ctx(["associe"]));
    expect(associe.responsable && associe.dispense && associe.partager).toBe(true);
    const consultant = droitsPlan(ctx(["consultant"]));
    expect(consultant).toMatchObject({
      creer: false,
      rediger: true,
      valider: false,
      partager: false,
    });
    const expert = droitsPlan(ctx(["expert_metier"]));
    expect(expert).toMatchObject({ creer: false, rediger: false, valider: false });
  });

  it("chef d'une autre mission : rédige mais ne crée ni ne valide", () => {
    expect(droitsPlan(ctx(["chef_mission"]))).toMatchObject({
      responsable: false,
      creer: false,
      rediger: true,
      valider: false,
    });
  });

  it("mission clôturée : lecture seule", () => {
    const d = droitsPlan(ctx(["associe"], MOI, "cloturee"));
    expect(d).toMatchObject({
      cloturee: true,
      creer: false,
      rediger: false,
      valider: false,
      partager: false,
    });
    expect(raisonCreationImpossible(ctx(["associe"], MOI, "cloturee"))).toBe(
      MESSAGE_MISSION_CLOTUREE,
    );
  });

  it("raison de non-création", () => {
    expect(raisonCreationImpossible(ctx(["chef_mission"], CHEF))).toBeNull();
    expect(raisonCreationImpossible(ctx(["expert_metier"]))).toContain("consulter");
    expect(raisonCreationImpossible(ctx(["consultant"]))).toContain("responsable de la mission");
  });

  it("validation d'un contenu : l'auteur de la version courante est écarté sauf dispense", () => {
    const e = element({ type: "axe", auteur_id: CHEF, statut_contenu: "modifie" });
    expect(raisonValidationElement(e, ctx(["chef_mission"], CHEF))).toBe(RAISON_AUTEUR_CONTENU);
    expect(raisonValidationElement(e, ctx(["directeur_mission"], DIRECTEUR))).toBeNull();
    expect(
      raisonValidationElement(
        { ...e, auteur_id: DIRECTEUR },
        ctx(["directeur_mission"], DIRECTEUR),
      ),
    ).toBeNull();
    expect(
      raisonValidationElement({ ...e, statut_contenu: "valide" }, ctx(["chef_mission"], CHEF)),
    ).toBeNull();
    expect(raisonValidationElement(e, ctx(["consultant"], CHEF))).toBeNull();
  });

  it("validation d'une version du modèle : l'auteur est écarté sauf dispense", () => {
    const v = { validation: null, cree_par: CHEF };
    expect(raisonValidationModele(v, ctx(["chef_mission"], CHEF))).toBe(RAISON_AUTEUR_MODELE);
    expect(
      raisonValidationModele({ ...v, cree_par: DIRECTEUR }, ctx(["directeur_mission"], DIRECTEUR)),
    ).toBeNull();
    expect(raisonValidationModele(v, ctx(["associe"], CHEF))).toBeNull();
  });
});

describe("structure du plan", () => {
  it("axes → objectifs → initiatives, initiatives d'axe, orphelins", () => {
    const axe = element({ type: "axe" });
    const objectif = element({ type: "objectif", parent_id: axe.id });
    const i1 = element({ type: "initiative", parent_id: objectif.id });
    const i2 = element({ type: "initiative", parent_id: axe.id });
    const perdu = element({ type: "initiative", parent_id: "inconnu" });
    const diag = element({ type: "diagnostic" });
    const s = structurerPlan([diag, axe, objectif, i1, i2, perdu]);
    expect(s.diagnostic?.id).toBe(diag.id);
    expect(s.swot).toBeNull();
    expect(s.axes).toHaveLength(1);
    expect(s.axes[0]!.objectifs[0]!.objectif.id).toBe(objectif.id);
    expect(s.axes[0]!.objectifs[0]!.initiatives.map((e) => e.id)).toEqual([i1.id]);
    expect(s.axes[0]!.initiatives.map((e) => e.id)).toEqual([i2.id]);
    expect(s.orphelins.map((e) => e.id)).toEqual([perdu.id]);
  });

  it("décompte des statuts", () => {
    expect(
      decompteStatuts([
        { statut_contenu: "valide" },
        { statut_contenu: "modifie" },
        { statut_contenu: "brouillon" },
      ]),
    ).toEqual({ total: 3, valides: 1, aValider: 2 });
  });
});

describe("partage au client : ce qui manque", () => {
  it("plan vide", () => {
    expect(manquesPartage({ elements: [], modele: null })).toEqual([
      "Le plan ne contient encore aucun contenu (diagnostic, SWOT, axes…).",
    ]);
  });

  it("contenus non validés (retirés compris) et dernière version du modèle non validée", () => {
    const m = manquesPartage({
      elements: [
        element({ type: "axe", donnees: { titre: "Export" }, statut_contenu: "valide" }),
        element({ type: "swot", version: 2, statut_contenu: "modifie" }),
        element({
          type: "initiative",
          donnees: { titre: "Filiale" },
          retire: true,
          statut_contenu: "modifie",
          version: 4,
        }),
      ],
      modele: modele(null, 3),
    });
    expect(m).toEqual([
      "Analyse SWOT : version 2 au statut « Modifié », à faire valider.",
      "Initiative « Filiale » (retiré) : version 4 au statut « Modifié », à faire valider.",
      "Modèle financier : la dernière version (version 3) n'est pas validée.",
    ]);
  });

  it("tout validé : rien ne manque", () => {
    expect(
      manquesPartage({
        elements: [element({ type: "diagnostic", statut_contenu: "valide" })],
        modele: modele({ valide_par: CHEF, valideur_nom: "Kofi", valide_le: "2027-01-02" }),
      }),
    ).toEqual([]);
    expect(AVERTISSEMENT_PARTAGE).toContain("retire immédiatement ce partage");
  });
});

describe("messages d'erreur", () => {
  it("séparation des tâches, contenu non validé, 404, 409, 403 selon l'action", () => {
    expect(
      messagePlan(
        new ErreurApi(
          "VALIDATION_REQUISE",
          "L'auteur d'un contenu ne le valide pas lui-même.",
          403,
        ),
      ),
    ).toBe("Séparation des tâches : L'auteur d'un contenu ne le valide pas lui-même.");
    expect(messagePlan(new ErreurApi("CONTENU_NON_VALIDE", "Partage refusé.", 409))).toContain(
      "Faites valider chaque contenu",
    );
    expect(messagePlan(new ErreurApi("INTROUVABLE", "x", 404))).toBe(MESSAGE_INTROUVABLE_PLAN);
    expect(
      messagePlan(new ErreurApi("CONFLIT", "Contenu identique à la version courante.", 409)),
    ).toBe("Contenu identique à la version courante.");
    expect(messagePlan(new ErreurApi("INTERDIT", "x", 403), "creer")).toContain("crée un plan");
    expect(messagePlan(new ErreurApi("INTERDIT", "x", 403), "valider")).toContain(
      "valide un contenu",
    );
    expect(
      messagePlan(
        new ErreurApi("REQUETE_INVALIDE", "Gains annuels : exactement 5 valeurs attendues.", 400),
      ),
    ).toBe("Gains annuels : exactement 5 valeurs attendues.");
    expect(etatPlanChange(new ErreurApi("CONFLIT", "x", 409))).toBe(true);
    expect(etatPlanChange(new Error("x"))).toBe(false);
  });
});

describe("chemins", () => {
  it("pages et API", () => {
    expect(hrefPlans("m")).toBe("/missions/m/plan");
    expect(hrefPlan("m", "p")).toBe("/missions/m/plan/p");
    expect(hrefModele("m", "p")).toBe("/missions/m/plan/p/modele");
    expect(hrefModele("m", "p", { version: 3, de: 1, a: 2 })).toBe(
      "/missions/m/plan/p/modele?version=3&de=1&a=2",
    );
    expect(hrefModele("m", "p", { curseur: "x y" })).toBe("/missions/m/plan/p/modele?curseur=x+y");
    expect(cheminPlansMission("m", 20, null)).toBe("/api/missions/m/plans?limite=20");
    expect(cheminPlansMission("m", 20, "c")).toBe("/api/missions/m/plans?limite=20&curseur=c");
    expect(cheminCreationPlan("m")).toBe("/api/missions/m/plans");
    expect(cheminPlan("p")).toBe("/api/plans/p");
    expect(cheminPartage("p")).toBe("/api/plans/p/partage");
    expect(cheminElements("p")).toBe("/api/plans/p/elements");
    expect(cheminVersionsElement("p", "e")).toBe("/api/plans/p/elements/e/versions");
    expect(cheminValidationElement("p", "e")).toBe("/api/plans/p/elements/e/validation");
    expect(cheminHistorique("p", "e", 10, null)).toBe(
      "/api/plans/p/elements/e/historique?limite=10",
    );
    expect(cheminHistorique("p", "e", 10, "k")).toBe(
      "/api/plans/p/elements/e/historique?limite=10&curseur=k",
    );
  });

  it("curseur lu dans l'URL", () => {
    expect(lireCurseur("abc")).toBe("abc");
    expect(lireCurseur(["a", "b"])).toBe("a");
    expect(lireCurseur("")).toBeNull();
    expect(lireCurseur("x".repeat(501))).toBeNull();
    expect(lireCurseur(undefined)).toBeNull();
  });
});

describe("création d'un plan", () => {
  it("horizon de 3 à 5 ans (5 par défaut), titre et devise contrôlés", () => {
    expect(OPTIONS_HORIZON.map((o) => o.valeur)).toEqual(["3", "4", "5"]);
    expect(OPTIONS_HORIZON[2]!.libelle).toBe("5 ans (par défaut)");
    expect(validerCreationPlan({ titre: " Plan 2027 ", horizon: "5", devise: "XOF" })).toEqual({
      ok: true,
      charge: { titre: "Plan 2027", horizon: 5, devise: "XOF" },
    });
    const r = validerCreationPlan({ titre: "", horizon: "6", devise: "GNF" });
    expect(r).toEqual({
      ok: false,
      erreurs: {
        titre: "Donnez un titre au plan.",
        horizon: "Horizon de 3 à 5 ans.",
        devise: "Choisissez une devise.",
      },
    });
    expect(validerCreationPlan({ titre: "x".repeat(201), horizon: "4,5", devise: "EUR" }).ok).toBe(
      false,
    );
  });
});

describe("messages d'écriture", () => {
  it("statut de la version créée et retrait du partage", () => {
    const e = { version: 2, statut_contenu: "modifie" as const };
    expect(messageEcriture("version", e, false)).toBe(
      "Version 2 enregistrée au statut « Modifié » : elle doit être validée par un responsable de la mission.",
    );
    expect(
      messageEcriture("creation", { version: 1, statut_contenu: "brouillon" }, true),
    ).toContain("Le partage au client a été retiré");
    expect(messageEcriture("validation", { version: 3, statut_contenu: "valide" }, false)).toBe(
      "Version 3 validée.",
    );
    expect(messageEcriture("retrait", e, false)).toContain("reste dans l'historique");
    expect(ELEMENTS_PLAN_MAX).toBe(300);
    expect(MESSAGE_ELEMENTS_MAX).toContain("300 contenus");
  });

  it("lien de retour d'enregistrement du modèle", () => {
    expect(hrefModele("m", "p", { version: 4, enregistree: true, partageRetire: true })).toBe(
      "/missions/m/plan/p/modele?version=4&enregistree=1&partage_retire=1",
    );
  });
});
