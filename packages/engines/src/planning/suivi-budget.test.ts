import { describe, expect, it } from "vitest";
import { agregerArborescence, alertesArborescence, type NoeudPlanning } from "./arborescence";
import {
  avancementPhysique,
  calculerSuivi,
  detecterAlertes,
  performanceMission,
  sommerLignes,
  statutCouleur,
} from "./suivi-budget";

/** Exemple chiffré du PRD : mission « Audit organisationnel », semaine 6. */
const AUDIT: NoeudPlanning = {
  id: "audit",
  niveau: "mission",
  libelle: "Audit organisationnel",
  enfants: [
    { id: "diag", niveau: "phase", budget: 12, realise: 13.5, resteAFaire: 0 },
    { id: "analyse", niveau: "phase", budget: 8, realise: 7, resteAFaire: 1 },
    { id: "reco", niveau: "phase", budget: 15, realise: 6, resteAFaire: 10 },
    { id: "plan", niveau: "phase", budget: 10, realise: 0, resteAFaire: 10 },
    { id: "restitution", niveau: "phase", budget: 5, realise: 0, resteAFaire: 5 },
  ],
};

describe("calcul de suivi (TPS-05)", () => {
  it("calcule atterrissage, écart et consommation", () => {
    expect(calculerSuivi({ budget: 15, realise: 6, resteAFaire: 10 })).toEqual({
      budget: 15,
      realise: 6,
      resteAFaire: 10,
      atterrissage: 16,
      ecart: 1,
      ecartRelatif: 1 / 15,
      consommation: 6 / 15,
    });
  });

  it("ne divise jamais par un budget nul", () => {
    const s = calculerSuivi({ budget: 0, realise: 2, resteAFaire: 1 });
    expect(s.consommation).toBeNull();
    expect(s.ecartRelatif).toBeNull();
    expect(s.ecart).toBe(3);
  });

  it("évite les erreurs flottantes", () => {
    expect(calculerSuivi({ budget: 0.3, realise: 0.1, resteAFaire: 0.2 }).ecart).toBe(0);
    expect(
      sommerLignes([
        { budget: 0.1, realise: 0.1, resteAFaire: 0.1 },
        { budget: 0.2, realise: 0.2, resteAFaire: 0.2 },
      ]),
    ).toEqual({ budget: 0.3, realise: 0.3, resteAFaire: 0.3 });
  });

  it("refuse les valeurs négatives ou non finies", () => {
    expect(() => calculerSuivi({ budget: -1, realise: 0, resteAFaire: 0 })).toThrow(/Budget/);
    expect(() => calculerSuivi({ budget: 1, realise: Number.NaN, resteAFaire: 0 })).toThrow(
      /Réalisé/,
    );
    expect(() => calculerSuivi({ budget: 1, realise: 0, resteAFaire: -0.5 })).toThrow(/Reste/);
  });
});

describe("exemple du PRD « Audit organisationnel »", () => {
  const arbre = agregerArborescence(AUDIT);

  it("reproduit le total 50 / 26,5 / 26 / 52,5 / +2,5 (+5 %)", () => {
    expect(arbre.suivi).toMatchObject({
      budget: 50,
      realise: 26.5,
      resteAFaire: 26,
      atterrissage: 52.5,
      ecart: 2.5,
      consommation: 0.53,
    });
    expect(arbre.suivi.ecartRelatif).toBeCloseTo(0.05, 12);
    expect(arbre.libelle).toBe("Audit organisationnel");
  });

  it("reproduit les lignes par phase", () => {
    const lignes = arbre.enfants.map((e) => [e.id, e.suivi.atterrissage, e.suivi.ecart]);
    expect(lignes).toEqual([
      ["diag", 13.5, 1.5],
      ["analyse", 8, 0],
      ["reco", 16, 1],
      ["plan", 10, 0],
      ["restitution", 5, 0],
    ]);
  });

  it("colore chaque phase avec les seuils par défaut", () => {
    expect(arbre.enfants.map((e) => e.couleur)).toEqual([
      "rouge",
      "orange",
      "rouge",
      "vert",
      "vert",
    ]);
    // 52,5 = 105 % pile : pas rouge (comparaison stricte), orange car > 100 %.
    expect(arbre.couleur).toBe("orange");
  });

  it("collecte les alertes de toute l'arborescence", () => {
    const alertes = alertesArborescence(arbre).map((a) => `${a.noeudId}:${a.type}`);
    expect(alertes).toEqual([
      "audit:atterrissage_superieur_budget",
      "diag:consommation_seuil",
      "diag:atterrissage_superieur_budget",
      "analyse:consommation_seuil",
      "reco:atterrissage_superieur_budget",
    ]);
  });
});

describe("couleurs et alertes (TPS-06, TPS-07)", () => {
  it("passe à l'orange à 80 % de consommation pile", () => {
    expect(statutCouleur({ budget: 10, realise: 8, resteAFaire: 2 })).toBe("orange");
    expect(statutCouleur({ budget: 10, realise: 7.9, resteAFaire: 2 })).toBe("vert");
  });

  it("gère le budget nul", () => {
    expect(statutCouleur({ budget: 0, realise: 0, resteAFaire: 0 })).toBe("vert");
    expect(statutCouleur({ budget: 0, realise: 0, resteAFaire: 0.5 })).toBe("rouge");
    expect(detecterAlertes({ budget: 0, realise: 0, resteAFaire: 0 })).toEqual([]);
    expect(detecterAlertes({ budget: 0, realise: 1, resteAFaire: 0 }).map((a) => a.type)).toEqual([
      "consommation_seuil",
      "atterrissage_superieur_budget",
    ]);
  });

  it("accepte des seuils paramétrés", () => {
    const seuils = {
      consommationOrangePct: 90,
      atterrissageOrangePct: 110,
      atterrissageRougePct: 120,
    };
    expect(statutCouleur({ budget: 10, realise: 8, resteAFaire: 3 }, seuils)).toBe("vert");
    expect(statutCouleur({ budget: 10, realise: 9, resteAFaire: 0 }, seuils)).toBe("orange");
    expect(statutCouleur({ budget: 10, realise: 5, resteAFaire: 6.5 }, seuils)).toBe("orange");
    expect(statutCouleur({ budget: 10, realise: 5, resteAFaire: 7.5 }, seuils)).toBe("rouge");
    expect(detecterAlertes({ budget: 10, realise: 8, resteAFaire: 2 }, 90)).toEqual([]);
    expect(detecterAlertes({ budget: 10, realise: 9, resteAFaire: 1 }, 90)[0]?.message).toMatch(
      /90 %/,
    );
  });
});

describe("arborescence", () => {
  it("remonte tâche > lot > phase et ignore les valeurs des nœuds parents", () => {
    const arbre = agregerArborescence({
      id: "m",
      niveau: "mission",
      budget: 999,
      enfants: [
        {
          id: "p",
          niveau: "phase",
          enfants: [
            {
              id: "l",
              niveau: "lot",
              enfants: [{ id: "t1", niveau: "tache", budget: 2, realise: 1 }],
            },
            { id: "t2", niveau: "tache", budget: 3, resteAFaire: 1 },
          ],
        },
      ],
    });
    expect(arbre.suivi).toMatchObject({ budget: 5, realise: 1, resteAFaire: 1, atterrissage: 2 });
    expect(arbre.libelle).toBeUndefined();
    expect(agregerArborescence({ id: "x", niveau: "tache" }).suivi.atterrissage).toBe(0);
  });

  it("refuse un niveau incohérent", () => {
    expect(() =>
      agregerArborescence({ id: "t", niveau: "tache", enfants: [{ id: "p", niveau: "phase" }] }),
    ).toThrow(/Niveau incohérent/);
    expect(() =>
      agregerArborescence({ id: "p", niveau: "phase", enfants: [{ id: "q", niveau: "phase" }] }),
    ).toThrow(RangeError);
  });

  it("utilise le seuil de consommation passé aux alertes", () => {
    const arbre = agregerArborescence({ id: "t", niveau: "tache", budget: 10, realise: 8.5 });
    expect(alertesArborescence(arbre, 90)).toEqual([]);
    expect(alertesArborescence(arbre)).toHaveLength(1);
  });
});

describe("avancement physique et performance (TPS-08)", () => {
  it("pondère les livrables et jalons", () => {
    expect(avancementPhysique([])).toBeNull();
    expect(avancementPhysique([{ atteint: true }, { atteint: false }])).toBe(0.5);
    expect(
      avancementPhysique([
        { atteint: true, poids: 3 },
        { atteint: false, poids: 1 },
      ]),
    ).toBe(0.75);
    expect(avancementPhysique([{ atteint: false, poids: 0 }])).toBeNull();
    expect(() => avancementPhysique([{ atteint: true, poids: -1 }])).toThrow(/Poids/);
  });

  it("compare l'avancement au consommé", () => {
    const p = performanceMission(0.4, { budget: 50, realise: 26.5 });
    expect(p.consommation).toBe(0.53);
    expect(p.indice).toBeCloseTo(0.4 / 0.53, 12);
    expect(p.ecartPoints).toBeCloseTo(-0.13, 12);
    expect(performanceMission(0.6, { budget: 10, realise: 5 }).indice).toBeCloseTo(1.2, 12);
  });

  it("renvoie null sans consommation ou sans budget", () => {
    expect(performanceMission(0.2, { budget: 10, realise: 0 })).toEqual({
      avancement: 0.2,
      consommation: 0,
      indice: null,
      ecartPoints: 0.2,
    });
    expect(performanceMission(0.2, { budget: 0, realise: 3 })).toMatchObject({
      consommation: null,
      indice: null,
      ecartPoints: null,
    });
  });

  it("refuse un avancement hors [0 ; 1]", () => {
    expect(() => performanceMission(1.2, { budget: 1, realise: 1 })).toThrow(RangeError);
    expect(() => performanceMission(-0.1, { budget: 1, realise: 1 })).toThrow(RangeError);
    expect(() => performanceMission(Number.NaN, { budget: 1, realise: 1 })).toThrow(RangeError);
  });
});
