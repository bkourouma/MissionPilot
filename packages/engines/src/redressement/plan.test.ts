import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import {
  type ActionPlan,
  STATUTS_ACTION_RED,
  type StatutActionRed,
  VOLETS_PLAN_RED,
  comparerContenusPlan,
  construireContenuPlan,
  evaluerPlanRedressement,
  organiserKanban,
  serialiserContenuPlan,
  transitionActionAdmise,
} from "./plan";

const action = (surcharges: Partial<ActionPlan> & { numero: number }): ActionPlan => ({
  titre: `Action ${surcharges.numero}`,
  volet: "quick_win",
  domaine: "tresorerie",
  echeance: "2026-12-01",
  statut: "a_faire",
  rang: 0,
  responsableId: "u1",
  levierCode: null,
  impactTresorerieUnique: null,
  impactResultatAnnuel: null,
  ...surcharges,
});

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.code;
    throw e;
  }
  return "AUCUNE";
};

describe("(P1) transitions", () => {
  it("matrice des 25 couples : 9 vrais et 16 faux", () => {
    const vrais: Record<StatutActionRed, StatutActionRed[]> = {
      a_faire: ["en_cours", "bloquee", "terminee", "abandonnee"],
      en_cours: ["bloquee", "terminee", "abandonnee"],
      bloquee: ["en_cours", "abandonnee"],
      terminee: [],
      abandonnee: [],
    };
    let nombreVrais = 0;
    for (const de of STATUTS_ACTION_RED) {
      for (const vers of STATUTS_ACTION_RED) {
        const attendu = vrais[de].includes(vers);
        expect(transitionActionAdmise(de, vers), `${de} → ${vers}`).toBe(attendu);
        if (attendu) nombreVrais += 1;
      }
    }
    expect(nombreVrais).toBe(9);
    expect(transitionActionAdmise("inconnu" as never, "a_faire")).toBe(false);
  });
});

describe("(P2) évaluation du plan", () => {
  const actions = [
    action({ numero: 1, volet: "quick_win", statut: "terminee", echeance: "2027-01-15" }),
    action({ numero: 2, volet: "quick_win", statut: "en_cours", echeance: "2026-10-15" }),
    action({ numero: 3, volet: "restructuration", statut: "a_faire", echeance: "2027-12-01" }),
    action({ numero: 4, volet: "restructuration", statut: "abandonnee", echeance: "2026-12-01" }),
    action({ numero: 5, volet: "quick_win", statut: "a_faire", echeance: "2027-06-01" }),
  ];
  const e = evaluerPlanRedressement(actions, "2026-11-01");

  it("avancement, retards et anomalies", () => {
    expect(e.parVolet.quick_win).toEqual({
      total: 3,
      terminees: 1,
      abandonnees: 0,
      enRetard: 1,
      avancementPb: 3333,
    });
    expect(e.parVolet.restructuration).toEqual({
      total: 2,
      terminees: 0,
      abandonnees: 1,
      enRetard: 0,
      avancementPb: 0,
    });
    expect(e.enRetard).toEqual([2]);
    expect(e.anomalies).toEqual([{ code: "QUICK_WIN_HORS_FENETRE", numero: 5, bloquante: false }]);
    expect(e.bloquantsValidation).toEqual([]);
  });

  it("(P3) liste vide : deux anomalies bloquantes ; avancement nul si tout est abandonné", () => {
    const vide = evaluerPlanRedressement([], "2026-11-01");
    expect(vide.anomalies).toEqual([
      { code: "AUCUNE_ACTION", numero: null, bloquante: true },
      { code: "AUCUN_QUICK_WIN", numero: null, bloquante: true },
    ]);
    expect(vide.bloquantsValidation).toEqual(["AUCUNE_ACTION", "AUCUN_QUICK_WIN"]);
    expect(vide.parVolet.quick_win.avancementPb).toBeNull();
    const seulementRestructuration = evaluerPlanRedressement(
      [action({ numero: 1, volet: "restructuration", echeance: "2027-12-01" })],
      "2026-11-01",
    );
    expect(seulementRestructuration.bloquantsValidation).toEqual(["AUCUN_QUICK_WIN"]);
    const toutAbandonne = evaluerPlanRedressement(
      [action({ numero: 1, statut: "abandonnee" })],
      "2026-11-01",
    );
    expect(toutAbandonne.parVolet.quick_win).toMatchObject({
      total: 1,
      abandonnees: 1,
      avancementPb: null,
    });
    expect(toutAbandonne.bloquantsValidation).toEqual(["AUCUNE_ACTION", "AUCUN_QUICK_WIN"]);
  });

  it("(P4) bornes des fenêtres", () => {
    const anomalies = (volet: ActionPlan["volet"], echeance: string) =>
      evaluerPlanRedressement(
        [action({ numero: 1 }), action({ numero: 2, volet, echeance })],
        "2026-11-01",
      ).anomalies.filter((a) => a.numero === 2);
    expect(anomalies("restructuration", "2027-05-01")).toEqual([
      { code: "RESTRUCTURATION_HORS_FENETRE", numero: 2, bloquante: false },
    ]);
    expect(anomalies("restructuration", "2027-05-02")).toEqual([]);
    expect(anomalies("restructuration", "2028-11-01")).toEqual([]);
    expect(anomalies("restructuration", "2028-11-02")).toEqual([
      { code: "RESTRUCTURATION_HORS_FENETRE", numero: 2, bloquante: false },
    ]);
    expect(anomalies("quick_win", "2027-05-01")).toEqual([]);
    expect(anomalies("quick_win", "2027-05-02")).toHaveLength(1);
  });

  it("(P5) impacts cumulés des actions non abandonnées", () => {
    const r = evaluerPlanRedressement(
      [
        action({ numero: 1, impactTresorerieUnique: 33_333_333, impactResultatAnnuel: 0 }),
        action({ numero: 2, impactTresorerieUnique: 18_000_000, impactResultatAnnuel: 30_000_000 }),
        action({ numero: 3, impactTresorerieUnique: null, impactResultatAnnuel: 50_400_000 }),
        action({
          numero: 4,
          statut: "abandonnee",
          impactTresorerieUnique: 99,
          impactResultatAnnuel: 99,
        }),
      ],
      "2026-11-01",
    );
    expect(r.impactTresorerieUnique).toBe(51_333_333);
    expect(r.impactResultatAnnuel).toBe(80_400_000);
  });

  it("une action terminée ou abandonnée n'est jamais en retard", () => {
    const r = evaluerPlanRedressement(
      [
        action({ numero: 1, statut: "terminee", echeance: "2026-01-01" }),
        action({ numero: 2, statut: "bloquee", echeance: "2026-01-01" }),
        action({ numero: 3, statut: "a_faire", echeance: "2026-11-01" }),
      ],
      "2026-11-01",
    );
    expect(r.enRetard).toEqual([2]);
  });

  it("entrées invalides : PLAN_INVALIDE ou DATE_INVALIDE", () => {
    expect(
      code(() =>
        evaluerPlanRedressement([action({ numero: 1 }), action({ numero: 1 })], "2026-11-01"),
      ),
    ).toBe("PLAN_INVALIDE");
    expect(code(() => evaluerPlanRedressement([action({ numero: 0 })], "2026-11-01"))).toBe(
      "PLAN_INVALIDE",
    );
    expect(
      code(() =>
        evaluerPlanRedressement([action({ numero: 1, volet: "x" as never })], "2026-11-01"),
      ),
    ).toBe("PLAN_INVALIDE");
    expect(
      code(() =>
        evaluerPlanRedressement([action({ numero: 1, statut: "x" as never })], "2026-11-01"),
      ),
    ).toBe("PLAN_INVALIDE");
    expect(
      code(() =>
        evaluerPlanRedressement([action({ numero: 1, domaine: "x" as never })], "2026-11-01"),
      ),
    ).toBe("PLAN_INVALIDE");
    expect(
      code(() =>
        evaluerPlanRedressement([action({ numero: 1, impactTresorerieUnique: 1.5 })], "2026-11-01"),
      ),
    ).toBe("PLAN_INVALIDE");
    expect(
      code(() =>
        evaluerPlanRedressement([action({ numero: 1, echeance: "2026-02-30" })], "2026-11-01"),
      ),
    ).toBe("DATE_INVALIDE");
    expect(code(() => evaluerPlanRedressement([], "2026-02-30"))).toBe("DATE_INVALIDE");
  });

  it("les deux volets sont ceux du PRD", () => {
    expect([...VOLETS_PLAN_RED]).toEqual(["quick_win", "restructuration"]);
  });
});

describe("(P6) kanban", () => {
  it("colonnes triées par rang, échéance, numéro ; colonnes vides présentes ; abandonnées à part", () => {
    const k = organiserKanban([
      action({ numero: 3, rang: 1, echeance: "2026-12-01" }),
      action({ numero: 2, rang: 1, echeance: "2026-11-01" }),
      action({ numero: 1, rang: 2, echeance: "2026-10-01" }),
      action({ numero: 4, rang: 1, echeance: "2026-11-01" }),
      action({ numero: 5, statut: "abandonnee" }),
      action({ numero: 6, statut: "terminee" }),
    ]);
    expect(k.colonnes.a_faire.map((a) => a.numero)).toEqual([2, 4, 3, 1]);
    expect(k.colonnes.en_cours).toEqual([]);
    expect(k.colonnes.bloquee).toEqual([]);
    expect(k.colonnes.terminee.map((a) => a.numero)).toEqual([6]);
    expect(k.abandonnees.map((a) => a.numero)).toEqual([5]);
    expect(Object.keys(k.colonnes)).toEqual(["a_faire", "en_cours", "bloquee", "terminee"]);
  });

  it("ne modifie pas son entrée", () => {
    const entree = [action({ numero: 2, rang: 5 }), action({ numero: 1, rang: 0 })];
    organiserKanban(entree);
    expect(entree.map((a) => a.numero)).toEqual([2, 1]);
  });
});

describe("(P7) contenu canonique du plan", () => {
  const base = [
    action({ numero: 2, titre: "B", impactResultatAnnuel: 5 }),
    action({ numero: 1, titre: "A", levierCode: "hausse_prix" }),
    action({ numero: 3, statut: "abandonnee" }),
  ];
  const chaine = (actions: ActionPlan[]) => serialiserContenuPlan(construireContenuPlan(actions));

  it("l'ordre d'entrée ne change pas la chaîne ; une abandonnée disparaît", () => {
    expect(chaine([...base].reverse())).toBe(chaine(base));
    expect(construireContenuPlan(base).actions.map((a) => a.numero)).toEqual([1, 2]);
    expect(construireContenuPlan(base).version).toBe(1);
  });

  it("statut et rang ne changent pas la chaîne ; échéance, titre, responsable la changent", () => {
    const ref = chaine(base);
    const modif = (numero: number, m: Partial<ActionPlan>) =>
      chaine(base.map((a) => (a.numero === numero ? { ...a, ...m } : a)));
    expect(modif(1, { statut: "en_cours" })).toBe(ref);
    expect(modif(1, { rang: 99 })).toBe(ref);
    expect(modif(1, { echeance: "2026-12-02" })).not.toBe(ref);
    expect(modif(1, { titre: "autre" })).not.toBe(ref);
    expect(modif(1, { responsableId: "u2" })).not.toBe(ref);
    expect(modif(1, { impactTresorerieUnique: 1 })).not.toBe(ref);
    expect(modif(1, { volet: "restructuration" })).not.toBe(ref);
    expect(modif(1, { domaine: "social" })).not.toBe(ref);
    expect(modif(1, { levierCode: null })).not.toBe(ref);
  });

  it("clés dans un ordre fixe", () => {
    const json = JSON.parse(chaine(base)) as {
      version: number;
      actions: Record<string, unknown>[];
    };
    expect(Object.keys(json)).toEqual(["version", "actions"]);
    expect(Object.keys(json.actions[0]!)).toEqual([
      "numero",
      "titre",
      "volet",
      "domaine",
      "echeance",
      "responsableId",
      "levierCode",
      "impactTresorerieUnique",
      "impactResultatAnnuel",
    ]);
    expect(Object.keys(construireContenuPlan(base).actions[0]!)).toContain("responsableId");
    expect(construireContenuPlan(base).actions[0]).not.toHaveProperty("statut");
    expect(construireContenuPlan(base).actions[0]).not.toHaveProperty("rang");
  });

  it("construire ne modifie pas son entrée", () => {
    const entree = [action({ numero: 2 }), action({ numero: 1 })];
    construireContenuPlan(entree);
    expect(entree.map((a) => a.numero)).toEqual([2, 1]);
  });
});

describe("(P8) écart avec la version validée", () => {
  it("ajoutée, retirée, modifiée", () => {
    const valide = construireContenuPlan([
      action({ numero: 2, titre: "avant" }),
      action({ numero: 3 }),
      action({ numero: 1 }),
    ]);
    const courant = construireContenuPlan([
      action({ numero: 1 }),
      action({ numero: 2, titre: "après" }),
      action({ numero: 6 }),
    ]);
    expect(comparerContenusPlan(courant, valide)).toEqual({
      ajoutees: [6],
      retirees: [3],
      modifiees: [2],
    });
  });

  it("contenus identiques : trois listes vides", () => {
    const c = construireContenuPlan([action({ numero: 1 }), action({ numero: 2 })]);
    expect(comparerContenusPlan(c, c)).toEqual({ ajoutees: [], retirees: [], modifiees: [] });
  });
});
