import { describe, expect, it } from "vitest";
import {
  actionsStatutProposition,
  arbreProposition,
  droitsMontants,
  peutCreerMission,
  propositionModifiable,
  propositionVisible,
  validerEquipe,
  validerGeneration,
  validerJoursParGrade,
  validerTaux,
  type PropositionDetaillee,
} from "./propositions";

const cibles = (
  statut: Parameters<typeof actionsStatutProposition>[0],
  roles: Parameters<typeof actionsStatutProposition>[1],
) => actionsStatutProposition(statut, roles).map((a) => a.cible);

describe("actions de statut par rôle", () => {
  it("laisse le chef de mission soumettre un brouillon mais pas valider", () => {
    expect(cibles("brouillon", ["chef_mission"])).toEqual(["a_valider"]);
    expect(cibles("a_valider", ["chef_mission"])).toEqual([]);
  });

  it("réserve la validation et le renvoi en brouillon à l'associé (proposition.valider)", () => {
    expect(cibles("a_valider", ["associe"]).sort()).toEqual(["brouillon", "validee"]);
    expect(cibles("a_valider", ["directeur_mission"])).toEqual([]);
  });

  it("enchaîne envoi puis réponse du client, et rien après", () => {
    expect(cibles("validee", ["chef_mission"])).toEqual(["envoyee"]);
    expect(cibles("envoyee", ["chef_mission"]).sort()).toEqual(["acceptee", "refusee"]);
    expect(cibles("acceptee", ["associe"])).toEqual([]);
    expect(cibles("refusee", ["associe"])).toEqual([]);
  });

  it("ne propose rien à un rôle sans pipeline.gerer", () => {
    expect(cibles("brouillon", ["consultant"])).toEqual([]);
    expect(cibles("envoyee", ["gestionnaire"])).toEqual([]);
  });

  it("demande une confirmation pour la validation et la réponse du client", () => {
    const a = actionsStatutProposition("a_valider", ["associe"]);
    expect(a.find((x) => x.cible === "validee")?.confirmer).toBe(true);
    expect(a.find((x) => x.cible === "brouillon")?.confirmer).toBe(false);
  });

  it("ne modifie qu'un brouillon et ne crée de mission que depuis une proposition acceptée", () => {
    expect(propositionModifiable("brouillon")).toBe(true);
    expect(propositionModifiable("validee")).toBe(false);
    expect(peutCreerMission("acceptee", ["chef_mission"])).toBe(true);
    expect(peutCreerMission("envoyee", ["associe"])).toBe(false);
    expect(peutCreerMission("acceptee", ["consultant"])).toBe(false);
  });
});

const detaillee: PropositionDetaillee = {
  id: "p",
  opportunite_id: "o",
  type_mission_id: "t",
  numero: 1,
  intitule: "P",
  devise: "XOF",
  date_reference: "2026-10-01",
  equipe: [],
  statut: "brouillon",
  validee_le: null,
  envoyee_le: null,
  repondue_le: null,
  cree_le: "",
  modifie_le: "",
  elements: [],
  taux: { senior: 350_000 },
  chiffrage: {
    devise: "XOF",
    jours_total: 10,
    honoraires_total: 3_500_000,
    par_grade: [{ grade_code: "senior", jours: 10, taux_journalier: 350_000, montant: 3_500_000 }],
    taux_manquants: [],
  },
};

describe("masquage financier des propositions", () => {
  it("garde tout pour l'associé (finance.lire)", () => {
    const v = propositionVisible(detaillee, droitsMontants(["associe"]));
    expect(v.taux).toEqual({ senior: 350_000 });
    expect(v.chiffrage.par_grade[0]).toMatchObject({
      taux_journalier: 350_000,
      montant: 3_500_000,
    });
    expect(v.chiffrage.honoraires_total).toBe(3_500_000);
  });

  it("retire taux et montants par grade au chef de mission, garde le total d'honoraires", () => {
    const v = propositionVisible(detaillee, droitsMontants(["chef_mission"]));
    expect(v.taux).toBeUndefined();
    expect(v.chiffrage.par_grade[0]).toEqual({ grade_code: "senior", jours: 10 });
    expect(v.chiffrage.honoraires_total).toBe(3_500_000);
    expect(JSON.stringify(v)).not.toMatch(/taux_journalier|"montant"|"taux"/);
  });

  it("retire aussi le total sans budget.lire_montants", () => {
    const v = propositionVisible(detaillee, { totaux: false, unitaires: false });
    expect(v.chiffrage.honoraires_total).toBeUndefined();
  });

  it("tolère une réponse d'API déjà filtrée (champs absents)", () => {
    const sansTaux: PropositionDetaillee = { ...detaillee };
    delete sansTaux.taux;
    const v = propositionVisible(
      {
        ...sansTaux,
        chiffrage: { ...detaillee.chiffrage, par_grade: [{ grade_code: "senior", jours: 10 }] },
      },
      droitsMontants(["associe"]),
    );
    expect(v.taux).toBeUndefined();
    expect(v.chiffrage.par_grade[0]?.grade_code).toBe("senior");
  });
});

describe("saisies d'une proposition", () => {
  it("lit les jours par grade au centième et ignore les vides et les zéros", () => {
    expect(validerJoursParGrade({ senior: "2,25", junior: "", manager: "0" })).toEqual({
      ok: true,
      charge: { jours_par_grade: { senior: 2.25 } },
    });
    const r = validerJoursParGrade({ senior: "1,234", junior: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["junior", "senior"]);
  });

  it("valide l'équipe proposée", () => {
    expect(validerEquipe({ senior: "2", junior: "" })).toEqual({
      ok: true,
      charge: { equipe: [{ grade_code: "senior", nombre: 2 }] },
    });
    expect(validerEquipe({ senior: "1,5" }).ok).toBe(false);
  });

  it("convertit les taux en unités mineures et retire un taux vidé", () => {
    expect(validerTaux({ senior: "1 500,50", junior: "" }, "EUR")).toEqual({
      ok: true,
      charge: { taux: { senior: 150_050, junior: null } },
    });
    expect(validerTaux({ senior: "350000,5" }, "XOF").ok).toBe(false);
  });

  it("exige un type pour générer une proposition", () => {
    expect(validerGeneration({ type_mission_id: "", intitule: "" }).ok).toBe(false);
    expect(
      validerGeneration({ type_mission_id: "0b6c2d1e-0000-4000-8000-000000000002", intitule: " " }),
    ).toEqual({ ok: true, charge: { type_mission_id: "0b6c2d1e-0000-4000-8000-000000000002" } });
  });

  it("reconstruit l'arbre du découpage", () => {
    const e = (id: string, parent_id: string | null, niveau: number) => ({
      id,
      parent_id,
      niveau,
      libelle: id,
      ordre: 0,
      est_livrable: false,
      est_jalon: false,
      jours_par_grade: {},
    });
    const arbre = arbreProposition([e("p", null, 1), e("l", "p", 2), e("t", "l", 3)]);
    expect(arbre).toHaveLength(1);
    expect(arbre[0]?.enfants[0]?.enfants[0]?.id).toBe("t");
  });
});
