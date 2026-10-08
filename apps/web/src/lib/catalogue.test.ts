import { describe, expect, it } from "vitest";
import {
  construireArbre,
  joursAffiches,
  libelleEnfant,
  propositionDuplication,
  SAISIE_TYPE_VIDE,
  saisieDepuisElement,
  saisieDepuisType,
  validerElement,
  validerTypeMission,
  type ElementModele,
  type TypeMission,
} from "./catalogue";

const el = (
  id: string,
  parent_id: string | null,
  niveau: number,
  extra: Partial<ElementModele> = {},
): ElementModele => ({
  id,
  type_mission_id: "t",
  parent_id,
  niveau,
  libelle: id,
  ordre: 0,
  jours_par_grade: {},
  est_livrable: false,
  est_jalon: false,
  ...extra,
});

describe("construireArbre", () => {
  it("imbrique phases, lots et tâches en gardant l'ordre reçu", () => {
    const arbre = construireArbre([
      el("p1", null, 1),
      el("l1", "p1", 2),
      el("t1", "l1", 3),
      el("t2", "l1", 3),
      el("p2", null, 1),
    ]);
    expect(arbre.map((n) => n.id)).toEqual(["p1", "p2"]);
    expect(arbre[0]!.enfants[0]!.enfants.map((n) => n.id)).toEqual(["t1", "t2"]);
  });

  it("rattache à la racine un élément orphelin", () => {
    expect(construireArbre([el("l9", "absent", 2)]).map((n) => n.id)).toEqual(["l9"]);
  });

  it("propose l'enfant avec le bon article", () => {
    expect(libelleEnfant(1)).toBe("un lot");
    expect(libelleEnfant(2)).toBe("une tâche");
    expect(libelleEnfant(3)).toBeNull();
  });
});

describe("joursAffiches", () => {
  it("suit l'ordre des grades, ignore les zéros, garde un grade inconnu", () => {
    const grades = [
      { code: "junior", libelle: "Junior" },
      { code: "senior", libelle: "Senior" },
    ];
    expect(joursAffiches({ senior: 2, junior: 0.5, ancien: 1, manager: 0 }, grades)).toEqual([
      { code: "junior", libelle: "Junior", jours: 0.5 },
      { code: "senior", libelle: "Senior", jours: 2 },
      { code: "ancien", libelle: "ancien", jours: 1 },
    ]);
  });
});

describe("validerTypeMission", () => {
  it("construit l'équipe type et ignore les grades à zéro", () => {
    const r = validerTypeMission({
      ...SAISIE_TYPE_VIDE,
      code: "plan_strategique",
      libelle: " Plan stratégique ",
      duree_type_jours: "90",
      equipe: { senior: "2", junior: "", manager: "0" },
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        code: "plan_strategique",
        libelle: "Plan stratégique",
        domaine: null,
        mode_facturation: "forfait",
        duree_type_jours: 90,
        equipe_type: [{ grade_code: "senior", nombre: 2 }],
        actif: true,
      },
    });
  });

  it("refait la même charge depuis un type existant", () => {
    const t: TypeMission = {
      id: "1",
      code: "audit",
      libelle: "Audit",
      domaine: "Organisation",
      mode_facturation: "regie",
      duree_type_jours: null,
      equipe_type: [{ grade_code: "senior", nombre: 1 }],
      actif: false,
      a_valider: true,
    };
    const r = validerTypeMission(saisieDepuisType(t));
    expect(r.ok && r.charge).toEqual({
      code: "audit",
      libelle: "Audit",
      domaine: "Organisation",
      mode_facturation: "regie",
      duree_type_jours: null,
      equipe_type: [{ grade_code: "senior", nombre: 1 }],
      actif: false,
    });
  });

  it("signale code, durée et équipe invalides", () => {
    const r = validerTypeMission({
      ...SAISIE_TYPE_VIDE,
      code: "Plan Stratégique",
      libelle: "",
      mode_facturation: "gratuit",
      duree_type_jours: "1,5",
      equipe: { senior: "51" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "code",
        "duree_type_jours",
        "equipe.senior",
        "libelle",
        "mode_facturation",
      ]);
  });

  it("propose un code et un libellé de copie valides", () => {
    const p = propositionDuplication({ code: "x".repeat(40), libelle: "Audit" });
    expect(p.code).toHaveLength(40);
    expect(p.code.endsWith("_copie")).toBe(true);
    expect(p.libelle).toBe("Audit (copie)");
  });
});

describe("validerElement", () => {
  it("lit les jours au pas de la demi-journée", () => {
    expect(
      validerElement({
        libelle: "Diagnostic",
        ordre: "10",
        jours: { senior: "2,5", junior: "", manager: "0" },
        est_livrable: true,
        est_jalon: false,
      }),
    ).toEqual({
      ok: true,
      charge: {
        libelle: "Diagnostic",
        ordre: 10,
        jours_par_grade: { senior: 2.5 },
        est_livrable: true,
        est_jalon: false,
      },
    });
  });

  it("refuse un quart de journée et un ordre négatif", () => {
    const r = validerElement({
      libelle: "x",
      ordre: "-1",
      jours: { senior: "0,25" },
      est_livrable: false,
      est_jalon: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["jours.senior", "ordre"]);
  });

  it("fait l'aller-retour depuis un élément existant", () => {
    const s = saisieDepuisElement(
      el("t1", "l1", 3, { ordre: 20, jours_par_grade: { senior: 1.5 } }),
    );
    expect(s.jours).toEqual({ senior: "1,5" });
    const r = validerElement(s);
    expect(r.ok && r.charge.jours_par_grade).toEqual({ senior: 1.5 });
  });
});
