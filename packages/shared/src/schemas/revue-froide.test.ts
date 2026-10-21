import { describe, expect, it } from "vitest";
import {
  actionFroideModificationSchema,
  campagneFroideCreationSchema,
  CRITERES_REVUE_FROIDE,
  evaluationRevueFroideSchema,
} from "./qualite";
import {
  apercuMissionSchema,
  facteurModificationSchema,
  rubriqueModificationSchema,
} from "./standard";

const criteres = { periode_debut: "2026-01-01", periode_fin: "2026-06-30" };

describe("revue à froid (QUA-05) : schémas", () => {
  it("la grille compte huit critères aux poids positifs et aux codes uniques", () => {
    expect(CRITERES_REVUE_FROIDE).toHaveLength(8);
    expect(new Set(CRITERES_REVUE_FROIDE.map((c) => c.code)).size).toBe(8);
    for (const c of CRITERES_REVUE_FROIDE) expect(c.poids).toBeGreaterThan(0);
  });

  it("un tirage exige une période ordonnée, une taille bornée et une graine sobre", () => {
    const ok = campagneFroideCreationSchema.safeParse({ intitule: "S1", criteres, taille: 5 });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.criteres.exclure_deja_revues).toBe(true);
      expect(ok.data.criteres.stratifier_par).toBeNull();
    }
    const inversee = campagneFroideCreationSchema.safeParse({
      intitule: "S1",
      criteres: { periode_debut: "2026-07-01", periode_fin: "2026-06-30" },
      taille: 5,
    });
    expect(inversee.success).toBe(false);
    for (const taille of [0, 101, 1.5]) {
      expect(
        campagneFroideCreationSchema.safeParse({ intitule: "S", criteres, taille }).success,
      ).toBe(false);
    }
    expect(
      campagneFroideCreationSchema.safeParse({ intitule: "S", criteres, taille: 3, graine: "a b" })
        .success,
    ).toBe(false);
    expect(
      campagneFroideCreationSchema.safeParse({ intitule: "S", criteres, taille: 3, extra: 1 })
        .success,
    ).toBe(false);
  });

  it("un critère sans objet exige un commentaire", () => {
    const base = { critere: "usage_ia" };
    expect(evaluationRevueFroideSchema.safeParse({ ...base, note: null }).success).toBe(false);
    expect(
      evaluationRevueFroideSchema.safeParse({ ...base, note: null, commentaire: "Pas d'IA." })
        .success,
    ).toBe(true);
    expect(evaluationRevueFroideSchema.safeParse({ ...base, note: 6 }).success).toBe(false);
    expect(evaluationRevueFroideSchema.safeParse({ ...base, note: 3 }).success).toBe(true);
  });

  it("clôturer une action exige un commentaire ; une modification vide est refusée", () => {
    expect(actionFroideModificationSchema.safeParse({ statut: "faite" }).success).toBe(false);
    expect(
      actionFroideModificationSchema.safeParse({ statut: "faite", commentaire: "Fait." }).success,
    ).toBe(true);
    expect(actionFroideModificationSchema.safeParse({ statut: "en_cours" }).success).toBe(true);
    expect(actionFroideModificationSchema.safeParse({}).success).toBe(false);
  });
});

describe("éditeur de méthodes (STD-11) : schémas de modification", () => {
  it("l'aperçu accepte un contexte vide par défaut et refuse une clé inconnue", () => {
    const r = apercuMissionSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(apercuMissionSchema.safeParse({ contexte: {}, x: 1 }).success).toBe(false);
  });

  it("un facteur : doublons de valeurs et bornes inversées refusés", () => {
    const v = (code: string) => ({ code, libelle: code });
    expect(facteurModificationSchema.safeParse({ valeurs: [v("a"), v("a")] }).success).toBe(false);
    expect(facteurModificationSchema.safeParse({ min: 5, max: 1 }).success).toBe(false);
    expect(facteurModificationSchema.safeParse({ valeurs: [v("a"), v("b")], min: 0 }).success).toBe(
      true,
    );
    expect(facteurModificationSchema.safeParse({ code: "x" }).success).toBe(false);
  });

  it("une rubrique modifiée garde cinq niveaux ordonnés ; son code ne change pas", () => {
    const niveaux = [1, 2, 3, 4, 5].map((niveau) => ({ niveau, description: `N${niveau}` }));
    expect(rubriqueModificationSchema.safeParse({ ancrages: niveaux }).success).toBe(true);
    expect(rubriqueModificationSchema.safeParse({ ancrages: niveaux.slice(1) }).success).toBe(
      false,
    );
    expect(rubriqueModificationSchema.safeParse({ code: "autre" }).success).toBe(false);
  });
});
