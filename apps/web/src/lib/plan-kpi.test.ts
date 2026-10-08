import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminKpiObjectif,
  cheminKpiPlan,
  decompteObjectifsKpi,
  hrefDetailKpi,
  hrefKpiPlan,
  messageKpiPlan,
  objectifsActifs,
  peutCreerKpiPlan,
  saisieDepuisObjectif,
  validerKpiObjectif,
  type ObjectifAvecKpi,
} from "./plan-kpi";

const objectif = (partiel: Partial<ObjectifAvecKpi> = {}): ObjectifAvecKpi => ({
  id: "o1",
  parent_id: "a1",
  version: 1,
  statut_contenu: "valide",
  retire: false,
  titre: "Fidéliser les clients",
  perspective: "clients",
  indicateur: "Taux de satisfaction",
  cible: "90 %",
  kpis: [],
  ...partiel,
});

const kpi = {
  id: "k1",
  libelle: "Satisfaction",
  unite: "%",
  perspective: "clients",
  frequence: "trimestrielle",
  actif: true,
  objectif_version: 1,
  cree_le: "2026-10-08T00:00:00Z",
};

describe("KPI issus des objectifs (PLA-10)", () => {
  it("saisie préremplie depuis l'objectif, cible chiffrée laissée vide", () => {
    expect(saisieDepuisObjectif(objectif(), "2026-10-08")).toEqual({
      libelle: "Taux de satisfaction",
      description: "Issu de l'objectif « Fidéliser les clients » (cible : 90 %).",
      unite: "",
      perspective: "clients",
      sens: "plus_haut_mieux",
      nature: "stock",
      frequence: "trimestrielle",
      debut_suivi: "2026-10-01",
      cible: "",
    });
    const sansIndicateur = saisieDepuisObjectif(
      objectif({ indicateur: null, cible: null, perspective: null }),
      "2026-10-08",
    );
    expect(sansIndicateur).toMatchObject({
      libelle: "Fidéliser les clients",
      description: "Issu de l'objectif « Fidéliser les clients ».",
      perspective: "",
    });
  });

  it("contrôle : celui du module KPI (unité obligatoire, cible numérique)", () => {
    const s = saisieDepuisObjectif(objectif(), "2026-10-08");
    const vide = validerKpiObjectif(s, "2026-10-08");
    expect(vide.ok).toBe(false);
    if (!vide.ok) expect(vide.erreurs.unite).toBeDefined();
    const ok = validerKpiObjectif({ ...s, unite: "%", cible: "90" }, "2026-10-08");
    expect(ok).toMatchObject({
      ok: true,
      charge: {
        libelle: "Taux de satisfaction",
        unite: "%",
        perspective: "clients",
        sens: "plus_haut_mieux",
        nature: "stock",
        frequence: "trimestrielle",
        debut_suivi: "2026-10-01",
        cible: 90,
      },
    });
    const illisible = validerKpiObjectif({ ...s, unite: "%", cible: "beaucoup" }, "2026-10-08");
    expect(illisible.ok).toBe(false);
  });

  it("objectifs actifs et décompte", () => {
    const p = {
      objectifs: [
        objectif({ kpis: [kpi] }),
        objectif({ id: "o2" }),
        objectif({ id: "o3", retire: true, kpis: [kpi] }),
      ],
    };
    expect(objectifsActifs(p).map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(decompteObjectifsKpi(p)).toBe("1 objectif sur 2 a au moins un KPI.");
    expect(
      decompteObjectifsKpi({
        objectifs: [objectif({ kpis: [kpi] }), objectif({ id: "o2", kpis: [kpi] })],
      }),
    ).toBe("2 objectifs sur 2 ont au moins un KPI.");
    expect(decompteObjectifsKpi({ objectifs: [] })).toBe("Aucun objectif dans ce plan.");
  });

  it("droit d'affichage : plan.ecrire et kpi.gerer, mission ouverte", () => {
    expect(peutCreerKpiPlan(["chef_mission"], false)).toBe(true);
    expect(peutCreerKpiPlan(["chef_mission"], true)).toBe(false);
    expect(peutCreerKpiPlan(["consultant"], false)).toBe(false);
    expect(peutCreerKpiPlan(["expert_metier"], false)).toBe(false);
  });

  it("messages et chemins", () => {
    expect(messageKpiPlan(new ErreurApi("ACCES_REFUSE", "x", 403))).toContain("gérer les KPI");
    expect(messageKpiPlan(new ErreurApi("INTROUVABLE", "x", 404))).toContain("introuvable");
    expect(messageKpiPlan(new ErreurApi("CONFLIT", "Cet objectif est retiré du plan.", 409))).toBe(
      "Cet objectif est retiré du plan.",
    );
    expect(messageKpiPlan(new ErreurApi("REQUETE_INVALIDE", "Unité trop longue.", 400))).toBe(
      "Unité trop longue.",
    );
    expect(hrefKpiPlan("m", "p")).toBe("/missions/m/plan/p/kpi");
    expect(hrefDetailKpi("m", "k")).toBe("/missions/m/kpi/k");
    expect(cheminKpiPlan("p")).toBe("/api/plans/p/kpi");
    expect(cheminKpiObjectif("p", "o")).toBe("/api/plans/p/objectifs/o/kpi");
  });
});
