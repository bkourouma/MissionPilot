import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  afficherRatio,
  celluleRatio,
  cheminBancabilite,
  cheminDossierBancaire,
  hrefBancabilite,
  libelleVerdict,
  LIGNES_PLAN_FINANCEMENT,
  messageBancabilite,
  phraseSeuils,
  type PlanFinancementExercice,
} from "./plan-bancabilite";

describe("mise en forme des ratios", () => {
  it("affiche les valeurs entières du moteur sans les recalculer", () => {
    expect(afficherRatio("couverture_service_dette", 12_500)).toBe("1,25 x");
    expect(afficherRatio("capacite_remboursement", 53_333)).toBe("5,33 an(s)");
    expect(afficherRatio("bfr_jours", 108)).toBe("108 j");
    expect(afficherRatio("endettement", null)).toBe("—");
    expect(celluleRatio("endettement", { valeur: null, statut: "hors_seuil" })).toBe("Hors seuil");
    expect(celluleRatio("endettement", { valeur: 4_000, statut: "conforme" })).toBe("0,4 x");
    expect(libelleVerdict("a_renforcer")).toBe("À renforcer");
  });

  it("énonce les seuils indicatifs", () => {
    expect(
      phraseSeuils({
        couverture_service_dette_min_pb: 12_000,
        endettement_max_pb: 10_000,
        dette_nette_sur_ebe_max_pb: 30_000,
        capacite_remboursement_max_pb: 40_000,
        bfr_jours_max: 90,
      }),
    ).toContain("au moins 1,2 x");
  });

  it("lit chaque ligne du plan de financement", () => {
    const p: PlanFinancementExercice = {
      exercice: 2027,
      ressources: {
        capacite_autofinancement: 1,
        augmentations_capital: 2,
        emprunts_nouveaux: 3,
        diminution_bfr: 4,
        total: 10,
      },
      emplois: {
        investissements: 5,
        augmentation_bfr: 6,
        remboursements_emprunts: 7,
        dividendes: 8,
        total: 26,
      },
      solde: -16,
      solde_cumule: -16,
    };
    expect(LIGNES_PLAN_FINANCEMENT.map((l) => l.valeur(p))).toEqual([
      1, 2, 3, 4, 10, 5, 6, 7, 8, 26, -16, -16,
    ]);
  });
});

describe("messages et chemins", () => {
  it("explique le modèle non validé et traduit les refus", () => {
    expect(messageBancabilite(new ErreurApi("MODELE_NON_VALIDE", "x", 409))).toContain("VALIDÉE");
    expect(messageBancabilite(new ErreurApi("TROP_DE_RAPPORTS", "Trop.", 429))).toBe("Trop.");
    expect(messageBancabilite(new ErreurApi("INTROUVABLE", "x", 404))).toContain("introuvable");
    expect(messageBancabilite(new ErreurApi("CONFLIT", "Clôturée.", 409))).toBe("Clôturée.");
  });

  it("construit les chemins", () => {
    expect(hrefBancabilite("m", "p")).toBe("/missions/m/plan/p/bancabilite");
    expect(cheminBancabilite("p")).toBe("/api/plans/p/bancabilite");
    expect(cheminBancabilite("p", 2)).toBe("/api/plans/p/bancabilite?version=2");
    expect(cheminBancabilite("p", 0)).toBe("/api/plans/p/bancabilite");
    expect(cheminDossierBancaire("p", "docx")).toBe("/api/plans/p/dossier-bancaire?format=docx");
    expect(cheminDossierBancaire("p", "pdf", 3)).toBe(
      "/api/plans/p/dossier-bancaire?format=pdf&version=3",
    );
  });
});
