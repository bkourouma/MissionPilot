import { describe, expect, it } from "vitest";
import type { ObservatoireCasePubliee } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  estEtatMetierAgregats,
  etatPageObservatoire,
  formaterPeriode,
  indexerCases,
  libelleCase,
  libelleEffectifMinimum,
  libellesTranches,
  lignesRepartition,
  lireAdhesion,
  lireRetrait,
  messageObservatoire,
  nombreCasesPubliees,
  peutAdhererObservatoire,
  peutConsulterObservatoire,
  trouverCase,
} from "./observatoire";

describe("observatoire : droits et états", () => {
  it("associé : consulte et adhère ; directeur : consulte seulement", () => {
    expect(peutConsulterObservatoire(["associe"])).toBe(true);
    expect(peutAdhererObservatoire(["associe"])).toBe(true);
    expect(peutConsulterObservatoire(["directeur_mission"])).toBe(true);
    expect(peutAdhererObservatoire(["directeur_mission"])).toBe(false);
    expect(peutConsulterObservatoire(["consultant"])).toBe(false);
  });

  it("états de la page selon l'adhésion et le rôle", () => {
    expect(etatPageObservatoire({ active: true }, ["directeur_mission"])).toBe("adherent");
    expect(etatPageObservatoire({ active: false }, ["associe"])).toBe("adhesion_possible");
    expect(etatPageObservatoire({ active: false }, ["directeur_mission"])).toBe(
      "adhesion_a_demander",
    );
  });
});

describe("observatoire : mise en forme", () => {
  it("période, effectif minimum, tranches", () => {
    expect(formaterPeriode("2026-10-01")).toBe("octobre 2026");
    expect(formaterPeriode(null)).toBe("—");
    expect(libelleEffectifMinimum(15)).toBe("au moins 15 entreprises");
    expect(libelleEffectifMinimum(1)).toBe("au moins 1 entreprise");
    expect(libellesTranches()).toHaveLength(10);
    expect(libellesTranches()[0]).toBe("0-10");
    expect(libellesTranches()[9]).toBe("90-100");
  });

  it("répartition et grille", () => {
    expect(lignesRepartition([5, 95])).toEqual([
      { tranche: "0-50", pourcentage: 5 },
      { tranche: "50-100", pourcentage: 95 },
    ]);
    const cases: ObservatoireCasePubliee[] = [
      { secteur: "btp", taille: "pme", statut: "effectif_insuffisant" },
      {
        secteur: "services",
        taille: "tpe",
        statut: "publiee",
        effectif_minimum: 10,
        moyenne: 60,
        mediane: 61,
        q1: null,
        q3: null,
        repartition: null,
      },
    ];
    const idx = indexerCases(cases);
    expect(trouverCase(idx, "btp", "pme")?.statut).toBe("effectif_insuffisant");
    expect(trouverCase(idx, "btp", "tpe")).toBeUndefined();
    expect(nombreCasesPubliees({ cases })).toBe(1);
    expect(libelleCase(cases[0]!)).toBe("BTP et immobilier, PME");
  });
});

describe("observatoire : saisies et messages", () => {
  it("l'adhésion exige le consentement explicite", () => {
    expect(lireAdhesion({ consentement: false, motif: "" }).ok).toBe(false);
    expect(lireAdhesion({ consentement: true, motif: "  " })).toEqual({
      ok: true,
      charge: { consentement: true },
    });
    expect(lireAdhesion({ consentement: true, motif: " Partage " })).toEqual({
      ok: true,
      charge: { consentement: true, motif: "Partage" },
    });
    expect(lireAdhesion({ consentement: true, motif: "x".repeat(501) }).ok).toBe(false);
  });

  it("le retrait accepte un motif facultatif borné", () => {
    expect(lireRetrait({ motif: "" })).toEqual({ ok: true, charge: {} });
    expect(lireRetrait({ motif: "x".repeat(501) }).ok).toBe(false);
  });

  it("messages d'erreur propres", () => {
    expect(messageObservatoire(new ErreurApi("OBSERVATOIRE_RESERVE_ADHERENTS", "x", 403))).toMatch(
      /réservé aux cabinets contributeurs/,
    );
    expect(messageObservatoire(new Error("boum"))).toBeTruthy();
  });
});

describe("403 métier des agrégats", () => {
  it("reconnaît les états métier à afficher en information", () => {
    expect(estEtatMetierAgregats({ ok: false, code: "OBSERVATOIRE_CONTRIBUTION_REQUISE" })).toBe(
      true,
    );
    expect(estEtatMetierAgregats({ ok: false, code: "OBSERVATOIRE_RESERVE_ADHERENTS" })).toBe(true);
    expect(estEtatMetierAgregats({ ok: false, code: "INTERDIT" })).toBe(false);
    expect(estEtatMetierAgregats({ ok: false })).toBe(false);
    expect(estEtatMetierAgregats({ ok: true })).toBe(false);
  });
});
