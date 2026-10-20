import { describe, expect, it } from "vitest";
import {
  comparerElementsBrief,
  composerBrief,
  ErreurBrief,
  FAMILLE_DU_TYPE,
  graviteSelonSeuils,
  LIBELLES_TYPE_BRIEF,
  qualifierCandidat,
  rangGravite,
  TYPES_ELEMENT_BRIEF,
  TYPES_PAR_FAMILLE,
  type CandidatBrief,
  type ElementBrief,
  type FaitsBrief,
  type SourceBrief,
  type TypeElementBrief,
} from "./index";

const REF = "2026-10-12";

function candidat(
  type: TypeElementBrief,
  faits: FaitsBrief,
  extra: Partial<CandidatBrief> = {},
): CandidatBrief {
  return {
    type,
    entite_id: "e1",
    mission_id: null,
    entite_libelle: null,
    mission_libelle: null,
    lien: "/x",
    faits,
    ...extra,
  };
}

const attente = (depuis: string | null): FaitsBrief => ({ nature: "attente", depuis });

describe("gravité selon des seuils", () => {
  it("monte aux seuils, bornes incluses", () => {
    const seuils = { moyenne: 3, haute: 7 };
    expect(graviteSelonSeuils(2, seuils)).toBe("basse");
    expect(graviteSelonSeuils(3, seuils)).toBe("moyenne");
    expect(graviteSelonSeuils(6, seuils)).toBe("moyenne");
    expect(graviteSelonSeuils(7, seuils)).toBe("haute");
    expect(rangGravite("haute")).toBeGreaterThan(rangGravite("moyenne"));
    expect(rangGravite("moyenne")).toBeGreaterThan(rangGravite("basse"));
  });
});

describe("types d'éléments", () => {
  it("chaque type a un libellé français et une famille", () => {
    for (const t of TYPES_ELEMENT_BRIEF) {
      expect(LIBELLES_TYPE_BRIEF[t].length).toBeGreaterThan(5);
      expect(["decider", "deriver", "envoyer"]).toContain(FAMILLE_DU_TYPE[t]);
    }
    expect(new Set(TYPES_ELEMENT_BRIEF).size).toBe(TYPES_ELEMENT_BRIEF.length);
  });
});

describe("ce qui attend (décider, envoyer)", () => {
  it("l'ancienneté part de la date d'attente et fait monter la gravité", () => {
    const e = (depuis: string | null) =>
      qualifierCandidat(candidat("debours_a_valider", attente(depuis)), REF) as ElementBrief;
    expect(e("2026-10-12")).toMatchObject({ anciennete_jours: 0, gravite: "basse" });
    expect(e("2026-10-09")).toMatchObject({ anciennete_jours: 3, gravite: "moyenne" });
    expect(e("2026-10-05")).toMatchObject({ anciennete_jours: 7, gravite: "haute" });
    // Sans date, ou date future : ancienneté nulle, jamais négative.
    expect(e(null)).toMatchObject({ anciennete_jours: 0, gravite: "basse" });
    expect(e("2026-10-20")).toMatchObject({ anciennete_jours: 0 });
  });

  it("un type bloquant n'est jamais de gravité basse (plancher)", () => {
    const f = qualifierCandidat(candidat("facture_a_approuver", attente("2026-10-12")), REF);
    expect(f?.gravite).toBe("moyenne");
    const h = qualifierCandidat(candidat("derogation_a_accorder", attente("2026-09-01")), REF);
    expect(h?.gravite).toBe("haute");
  });

  it("le libellé porte le type en français et le libellé d'entité, sans contenu client", () => {
    const e = qualifierCandidat(
      candidat("facture_a_approuver", attente(null), { entite_libelle: "FAC-2026-0003" }),
      REF,
    );
    expect(e?.libelle).toBe("Facture à approuver : FAC-2026-0003");
    expect(e?.famille).toBe("decider");
    const sans = qualifierCandidat(candidat("debours_a_valider", attente(null)), REF);
    expect(sans?.libelle).toBe("Débours à valider");
  });

  it("tronque un libellé d'entité trop long", () => {
    const e = qualifierCandidat(
      candidat("debours_a_valider", attente(null), { entite_libelle: "x".repeat(500) }),
      REF,
    );
    expect(e?.libelle).toHaveLength(200);
    expect(e?.libelle.endsWith("…")).toBe(true);
  });
});

describe("échéances dépassées", () => {
  const retard = (type: TypeElementBrief, echeance: string) =>
    qualifierCandidat(candidat(type, { nature: "retard", echeance }), REF);

  it("pas d'élément tant que l'échéance n'est pas dépassée", () => {
    expect(retard("tache_en_retard", REF)).toBeNull();
    expect(retard("tache_en_retard", "2026-10-13")).toBeNull();
  });

  it("jalon, tâche, feuille, questionnaire : 3 jours moyenne, 14 jours haute", () => {
    expect(retard("jalon_en_retard", "2026-10-11")).toMatchObject({
      anciennete_jours: 1,
      gravite: "basse",
      libelle: "Jalon en retard (1 jour de retard)",
    });
    expect(retard("tache_en_retard", "2026-10-09")?.gravite).toBe("moyenne");
    expect(retard("feuille_non_soumise", "2026-09-28")).toMatchObject({
      gravite: "haute",
      libelle: "Feuille de temps non soumise (14 jours de retard)",
    });
    expect(retard("questionnaire_sans_reponse", "2026-10-01")?.famille).toBe("deriver");
  });

  it("facture échue : relances à J+15, alerte à J+45", () => {
    expect(retard("facture_echue", "2026-10-02")?.gravite).toBe("basse");
    expect(retard("facture_echue", "2026-09-27")?.gravite).toBe("moyenne");
    expect(retard("facture_echue", "2026-08-28")?.gravite).toBe("haute");
  });

  it("le montant et la devise ne passent que s'ils sont fournis", () => {
    const avec = qualifierCandidat(
      candidat(
        "facture_echue",
        { nature: "retard", echeance: "2026-10-01" },
        { montant: 1000, devise: "XOF" },
      ),
      REF,
    );
    expect(avec).toMatchObject({ montant: 1000, devise: "XOF" });
    const sans = retard("facture_echue", "2026-10-01") as ElementBrief;
    expect("montant" in sans).toBe(false);
    expect("devise" in sans).toBe(false);
  });
});

describe("KPI", () => {
  const kpi = (statuts: ("vert" | "orange" | "rouge")[], depuis: string | null = "2026-09-30") =>
    qualifierCandidat(candidat("kpi_rouge", { nature: "kpi", statuts, depuis }), REF);

  it("rouge sur la dernière période close : haute", () => {
    expect(kpi(["rouge"])).toMatchObject({
      type: "kpi_rouge",
      gravite: "haute",
      anciennete_jours: 12,
    });
    expect(kpi(["rouge", "vert"])?.type).toBe("kpi_rouge");
  });

  it("orange deux périodes de suite : moyenne ; un seul orange ou vert : rien", () => {
    expect(kpi(["orange", "orange"])).toMatchObject({
      type: "kpi_orange_consecutif",
      gravite: "moyenne",
    });
    expect(kpi(["orange"])).toBeNull();
    expect(kpi(["orange", "vert"])).toBeNull();
    expect(kpi(["vert", "rouge"])).toBeNull();
    expect(kpi([])).toBeNull();
  });

  it("sans date de période, l'ancienneté est nulle", () => {
    expect(kpi(["rouge"], null)?.anciennete_jours).toBe(0);
  });
});

describe("atterrissage au-delà du budget", () => {
  const atterrissage = (budget: number, jours: number) =>
    qualifierCandidat(
      candidat("atterrissage_depasse", {
        nature: "atterrissage",
        jours_budget: budget,
        jours_atterrissage: jours,
      }),
      REF,
    );

  it("exactement 5 % : pas d'alerte ; au-delà : moyenne, avec l'écart", () => {
    expect(atterrissage(100, 105)).toBeNull();
    expect(atterrissage(100, 90)).toBeNull();
    expect(atterrissage(100, 105.01)).toMatchObject({ gravite: "moyenne", ecart_pct: 5 });
    expect(atterrissage(20, 22.5)).toMatchObject({
      gravite: "moyenne",
      ecart_pct: 12.5,
      libelle: "Atterrissage au-delà du budget (+12,5 %)",
      anciennete_jours: 0,
    });
  });

  it("au-delà de 15 % : haute", () => {
    expect(atterrissage(100, 115)?.gravite).toBe("moyenne");
    expect(atterrissage(100, 116)).toMatchObject({ gravite: "haute", ecart_pct: 16 });
  });

  it("budget nul ou atterrissage invalide : non évaluable", () => {
    expect(atterrissage(0, 10)).toBeNull();
    expect(atterrissage(-5, 10)).toBeNull();
    expect(atterrissage(10, -1)).toBeNull();
  });
});

describe("cohérence de l'entrée", () => {
  it("refuse une nature de faits qui ne correspond pas au type", () => {
    expect(() => qualifierCandidat(candidat("facture_echue", attente(null)), REF)).toThrow(
      ErreurBrief,
    );
    expect(() =>
      qualifierCandidat(
        candidat("debours_a_valider", { nature: "retard", echeance: "2026-10-01" }),
        REF,
      ),
    ).toThrow(ErreurBrief);
  });

  it("refuse un type inconnu, un identifiant ou un lien vide", () => {
    expect(() =>
      qualifierCandidat(candidat("inconnu" as TypeElementBrief, attente(null)), REF),
    ).toThrow(/inconnu/);
    expect(() =>
      qualifierCandidat(candidat("debours_a_valider", attente(null), { lien: "" }), REF),
    ).toThrow(ErreurBrief);
    expect(() =>
      qualifierCandidat(candidat("debours_a_valider", attente(null), { entite_id: "" }), REF),
    ).toThrow(ErreurBrief);
  });

  it("une date invalide lève une erreur", () => {
    expect(() => composerBrief({ date_reference: "2026-13-40", sources: [] })).toThrow(ErreurBrief);
    expect(() => composerBrief({ date_reference: "pas une date", sources: [] })).toThrow(
      ErreurBrief,
    );
  });
});

describe("composition du brief", () => {
  const source = (
    famille: SourceBrief["famille"],
    candidats: CandidatBrief[],
    restants = 0,
  ): SourceBrief => ({ famille, candidats, restants });

  it("un jour sans rien à signaler donne un brief vide", () => {
    const b = composerBrief({ date_reference: REF, sources: [] });
    expect(b.vide).toBe(true);
    expect(b.total).toBe(0);
    for (const f of ["decider", "deriver", "envoyer"] as const) {
      expect(b.familles[f]).toEqual({ total: 0, tronque: false, elements: [] });
    }
    // Des sources dont aucun fait ne qualifie : toujours vide.
    const v = composerBrief({
      date_reference: REF,
      sources: [
        source("deriver", [
          candidat("tache_en_retard", { nature: "retard", echeance: "2026-10-30" }),
        ]),
      ],
    });
    expect(v.vide).toBe(true);
  });

  it("ordonne par gravité, puis ancienneté, puis type, puis identifiant", () => {
    const c = (id: string, type: TypeElementBrief, depuis: string) =>
      candidat(type, attente(depuis), { entite_id: id });
    const b = composerBrief({
      date_reference: REF,
      sources: [
        source("decider", [
          c("a", "debours_a_valider", "2026-10-12"), // basse, 0
          c("b", "debours_a_valider", "2026-10-01"), // haute, 11
          c("c", "feuille_a_valider", "2026-10-01"), // haute, 11, type après débours
          c("d", "debours_a_valider", "2026-09-01"), // haute, 41
          c("e", "debours_a_valider", "2026-10-01"), // haute, 11, identifiant après b
          c("f", "debours_a_valider", "2026-10-09"), // moyenne, 3
        ]),
      ],
    });
    expect(b.familles.decider.elements.map((e) => e.entite_id)).toEqual([
      "d",
      "b",
      "e",
      "c",
      "f",
      "a",
    ]);
    expect(b.vide).toBe(false);
  });

  it("borne chaque famille et rend le total réel avec `tronque`", () => {
    const candidats = Array.from({ length: 14 }, (_, i) =>
      candidat("debours_a_valider", attente("2026-10-01"), { entite_id: `e${i}` }),
    );
    const b = composerBrief({ date_reference: REF, sources: [source("decider", candidats, 6)] });
    expect(b.familles.decider.elements).toHaveLength(10);
    expect(b.familles.decider.total).toBe(20);
    expect(b.familles.decider.tronque).toBe(true);
    expect(b.total).toBe(20);
    const court = composerBrief({
      date_reference: REF,
      sources: [source("decider", candidats.slice(0, 3))],
      limite_par_famille: 3,
    });
    expect(court.familles.decider).toMatchObject({ total: 3, tronque: false });
  });

  it("les lignes non extraites d'une source comptent même sans candidat servi", () => {
    const b = composerBrief({ date_reference: REF, sources: [source("envoyer", [], 4)] });
    expect(b.familles.envoyer).toMatchObject({ total: 4, tronque: true, elements: [] });
    expect(b.vide).toBe(false);
  });

  it("écarte un doublon (même type, même entité), même venu de deux sources", () => {
    const c = candidat("debours_a_valider", attente(null), { entite_id: "x" });
    const b = composerBrief({
      date_reference: REF,
      sources: [source("decider", [c]), source("decider", [c])],
    });
    expect(b.familles.decider.total).toBe(1);
  });

  it("un type d'une autre famille que celle de la source est refusé", () => {
    expect(() =>
      composerBrief({
        date_reference: REF,
        sources: [source("deriver", [candidat("debours_a_valider", attente(null))])],
      }),
    ).toThrow(/n'appartient pas/);
  });

  it("une source incomplète marque la famille tronquée sans gonfler le total", () => {
    const c = candidat("debours_a_valider", attente(null), { entite_id: "x" });
    const b = composerBrief({
      date_reference: REF,
      sources: [{ famille: "decider", candidats: [c], restants: 0, incomplet: true }],
    });
    // Le total reste le nombre CERTAIN d'éléments ; `tronque` dit que ce nombre est un minimum.
    expect(b.familles.decider).toMatchObject({ total: 1, tronque: true });
    expect(b.familles.decider.elements).toHaveLength(1);
    expect(b.familles.deriver).toEqual({ total: 0, tronque: false, elements: [] });
    const complete = composerBrief({
      date_reference: REF,
      sources: [{ famille: "decider", candidats: [c], restants: 0, incomplet: false }],
    });
    expect(complete.familles.decider.tronque).toBe(false);
  });

  it("refuse des restants ou une limite invalides", () => {
    for (const restants of [-1, 1.5]) {
      expect(() =>
        composerBrief({ date_reference: REF, sources: [source("decider", [], restants)] }),
      ).toThrow(ErreurBrief);
    }
    for (const limite of [0, 51, 2.5]) {
      expect(() =>
        composerBrief({ date_reference: REF, sources: [], limite_par_famille: limite }),
      ).toThrow(ErreurBrief);
    }
  });

  it("le résultat est identique quel que soit l'ordre des candidats (déterminisme)", () => {
    const liste = ["a", "b", "c", "d"].map((id, i) =>
      candidat("debours_a_valider", attente(`2026-10-0${i + 1}`), { entite_id: id }),
    );
    const un = composerBrief({ date_reference: REF, sources: [source("decider", liste)] });
    const deux = composerBrief({
      date_reference: REF,
      sources: [source("decider", [...liste].reverse())],
    });
    expect(deux).toEqual(un);
  });

  it("comparerElementsBrief est un ordre total (égalité seulement pour le même élément)", () => {
    const e = qualifierCandidat(candidat("debours_a_valider", attente(null)), REF) as ElementBrief;
    expect(comparerElementsBrief(e, e)).toBe(0);
    expect(comparerElementsBrief(e, { ...e, entite_id: "z" })).toBe(-1);
    expect(comparerElementsBrief({ ...e, entite_id: "z" }, e)).toBe(1);
  });
});

describe("validations d'offre, de plan et de révision de budget", () => {
  const NOUVEAUX: readonly TypeElementBrief[] = [
    "offre_technique_a_valider",
    "plan_a_valider",
    "revision_budget_a_valider",
  ];

  it("trois types de plus dans « À décider » : 16 types, 30 au total, même barème d'ancienneté", () => {
    expect(TYPES_PAR_FAMILLE.decider).toHaveLength(16);
    expect(TYPES_ELEMENT_BRIEF).toHaveLength(30);
    for (const t of NOUVEAUX) {
      expect(FAMILLE_DU_TYPE[t]).toBe("decider");
      const e = (depuis: string) =>
        qualifierCandidat(candidat(t, attente(depuis)), REF) as ElementBrief;
      expect(e("2026-10-12")).toMatchObject({ anciennete_jours: 0, gravite: "basse" });
      expect(e("2026-10-09")).toMatchObject({ anciennete_jours: 3, gravite: "moyenne" });
      expect(e("2026-10-05")).toMatchObject({ anciennete_jours: 7, gravite: "haute" });
    }
  });

  it("le libellé français porte l'entité, jamais un montant", () => {
    const e = qualifierCandidat(
      candidat("revision_budget_a_valider", attente(null), { entite_libelle: "révision n° 2" }),
      REF,
    );
    expect(e?.libelle).toBe("Révision de budget à valider : révision n° 2");
    expect(e && "montant" in e).toBe(false);
  });
});
