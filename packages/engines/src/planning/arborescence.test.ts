import { describe, expect, it } from "vitest";
import { agregerArborescence, alertesArborescence, type NoeudPlanning } from "./arborescence";

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
    expect(arbre.suivi.ecartRelatif).toBe(0.05);
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
