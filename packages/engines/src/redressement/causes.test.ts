import { describe, expect, it } from "vitest";
import {
  CAUSES_MAX,
  CAUSE_DESCRIPTION_MAX,
  CAUSE_LIBELLE_MAX,
  DOMAINE_CRITERE_ALERTE,
  NIVEAUX_CONFIANCE_CAUSE,
  VERSION_CAUSES,
  cartographieDeRepli,
  contexteChiffresCauses,
  entreeCausesExploitable,
  libelleDomaineCause,
  normaliserCartographie,
  syntheseContexteCauses,
  type EntreeCauses,
} from "./causes";
import { CRITERES_ALERTE } from "./alerte";
import { ErreurRedressement } from "./erreurs";
import { CLES_RATIO_REDRESSEMENT, type RatioRedressement, type RatiosExercice } from "./ratios";
import { DOMAINES_URGENCE } from "./urgence";

const cause = (extra: Record<string, unknown> = {}) => ({
  domaine: "tresorerie",
  libelle: "Encaissements tardifs",
  description: "Hypothèse à confirmer.",
  ...extra,
});

const echoue = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurRedressement);
    expect((e as ErreurRedressement).code).toBe("ENTREE_INVALIDE");
    return (e as ErreurRedressement).message;
  }
  throw new Error("Une erreur était attendue.");
};

const calcule = (valeur: number): RatioRedressement => ({
  valeur,
  statut: "calcule",
  raison: null,
  manquants: [],
});
const ratiosA = (): RatiosExercice => {
  const ratios = {} as Record<(typeof CLES_RATIO_REDRESSEMENT)[number], RatioRedressement>;
  for (const cle of CLES_RATIO_REDRESSEMENT) {
    ratios[cle] = calcule(cle === "bfr_jours" ? 54 : 13_636);
  }
  ratios.marge_nette = {
    valeur: null,
    statut: "non_calculable",
    raison: "postes_manquants",
    manquants: ["resultat_net"],
  };
  return { exercice: 2025, devise: "XOF", postes: {}, ratios };
};

const entreeVide = (): EntreeCauses => ({
  urgence: null,
  alerte: null,
  ratios: null,
  tresorerie: null,
});
const entreePleine = (): EntreeCauses => ({
  urgence: {
    domaines: [
      { domaine: "tresorerie", voyant: "rouge", pourcentage: 75 },
      { domaine: "activite", voyant: "orange", pourcentage: 30 },
      { domaine: "exploitation", voyant: "vert", pourcentage: 0 },
      { domaine: "social", voyant: "non_evalue", pourcentage: null },
      { domaine: "financement", voyant: "vert", pourcentage: 10 },
    ],
  },
  alerte: {
    score: 62,
    niveau: "eleve",
    criteres: [
      { critere: "liquidite_generale", statut: "rouge" },
      { critere: "croissance_ca", statut: "orange" },
      { critere: "endettement", statut: "vert" },
      { critere: "bfr_jours", statut: "non_evalue" },
    ],
  },
  ratios: ratiosA(),
  tresorerie: {
    semainesTension: [4, 5, 6],
    premiereSemaineTension: 4,
    besoinFinancement: 25_000_000,
    devise: "XOF",
  },
});

describe("normaliserCartographie", () => {
  it("valide, assigne les identifiants libres et garde ceux fournis", () => {
    const c = normaliserCartographie({
      causes: [
        cause({ id: "c02" }),
        cause({ libelle: "Stocks excessifs", domaine: "exploitation", confiance: "eleve" }),
        cause({ libelle: "Dépendance à un client", domaine: "activite" }),
      ],
    });
    expect(c.version).toBe(VERSION_CAUSES);
    expect(c.causes.map((x) => x.id)).toEqual(["c02", "c01", "c03"]);
    expect(c.causes[1]?.confiance).toBe("eleve");
    expect(c.causes[0]).not.toHaveProperty("confiance");
  });

  it("accepte une confiance nulle comme absente et supprime les espaces de bord", () => {
    const c = normaliserCartographie({
      causes: [cause({ confiance: null, libelle: "  Marge en baisse  " })],
    });
    expect(c.causes[0]?.libelle).toBe("Marge en baisse");
    expect(c.causes[0]).not.toHaveProperty("confiance");
  });

  it("refuse une entrée qui n'est pas une cartographie", () => {
    for (const mauvaise of [null, undefined, 3, "x", [], {}, { causes: "x" }, { causes: [] }]) {
      echoue(() => normaliserCartographie(mauvaise));
    }
  });

  it("refuse trop de causes", () => {
    const causes = Array.from({ length: CAUSES_MAX + 1 }, (_, i) =>
      cause({ libelle: `Cause numéro ${i}` }),
    );
    echoue(() => normaliserCartographie({ causes }));
    expect(normaliserCartographie({ causes: causes.slice(0, CAUSES_MAX) }).causes).toHaveLength(
      CAUSES_MAX,
    );
  });

  it("refuse une cause mal formée", () => {
    echoue(() => normaliserCartographie({ causes: [null] }));
    echoue(() => normaliserCartographie({ causes: [[]] }));
    echoue(() => normaliserCartographie({ causes: [cause({ inconnu: 1 })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ domaine: "juridique" })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ domaine: undefined })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ confiance: 80 })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ confiance: "certain" })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ id: "x1" })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ id: 3 })] }));
  });

  it("borne les textes et refuse les caractères de contrôle", () => {
    echoue(() => normaliserCartographie({ causes: [cause({ libelle: "" })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ libelle: "   " })] }));
    echoue(() => normaliserCartographie({ causes: [cause({ libelle: 12 })] }));
    echoue(() =>
      normaliserCartographie({ causes: [cause({ libelle: "x".repeat(CAUSE_LIBELLE_MAX + 1) })] }),
    );
    echoue(() =>
      normaliserCartographie({
        causes: [cause({ description: "x".repeat(CAUSE_DESCRIPTION_MAX + 1) })],
      }),
    );
    echoue(() => normaliserCartographie({ causes: [cause({ description: "a\u0000b" })] }));
    expect(
      normaliserCartographie({
        causes: [
          cause({
            libelle: "x".repeat(CAUSE_LIBELLE_MAX),
            description: "y\nz".repeat(10),
          }),
        ],
      }).causes,
    ).toHaveLength(1);
  });

  it("refuse les doublons (domaine + libellé, accents et casse ignorés) et les identifiants répétés", () => {
    echoue(() =>
      normaliserCartographie({
        causes: [cause({ libelle: "Trésorerie tendue" }), cause({ libelle: "TRESORERIE  tendue" })],
      }),
    );
    echoue(() =>
      normaliserCartographie({
        causes: [
          cause({ id: "c01" }),
          cause({ id: "c01", libelle: "Autre cause", domaine: "social" }),
        ],
      }),
    );
    // Même libellé dans deux domaines différents : admis.
    expect(
      normaliserCartographie({
        causes: [cause(), cause({ domaine: "social" })],
      }).causes,
    ).toHaveLength(2);
  });

  it("les messages ne recopient jamais la valeur saisie", () => {
    const m = echoue(() =>
      normaliserCartographie({ causes: [cause({ domaine: "SECRET-DOMAINE" })] }),
    );
    expect(m).not.toContain("SECRET");
  });

  it("expose les niveaux de confiance fixes et les libellés de domaine", () => {
    expect(NIVEAUX_CONFIANCE_CAUSE).toEqual(["faible", "moyen", "eleve"]);
    expect(DOMAINES_URGENCE.map(libelleDomaineCause)).toEqual([
      "Trésorerie",
      "Activité",
      "Exploitation",
      "Social",
      "Financement",
    ]);
  });
});

describe("cartographieDeRepli", () => {
  it("construit une cause par domaine porteur de signal, dans l'ordre de la grille", () => {
    const c = cartographieDeRepli(entreePleine());
    expect(c.causes.map((x) => x.domaine)).toEqual(["tresorerie", "activite"]);
    expect(c.causes.map((x) => x.id)).toEqual(["c01", "c02"]);
    expect(c.causes[0]?.confiance).toBe("moyen");
    expect(c.causes[1]?.confiance).toBe("faible");
    const t = c.causes[0]?.description ?? "";
    expect(t).toContain("voyant d'urgence du domaine est rouge");
    expect(t).toContain("liquidité générale : rouge");
    expect(t).toContain("semaines de tension");
    expect(t).toContain("Hypothèse à confirmer par le consultant");
  });

  it("est déterministe et ne contient aucun nombre", () => {
    expect(cartographieDeRepli(entreePleine())).toEqual(cartographieDeRepli(entreePleine()));
    const texte = JSON.stringify(cartographieDeRepli(entreePleine()).causes);
    expect(/\d/.test(texte.replace(/"id":"c\d\d"/g, ""))).toBe(false);
  });

  it("sans signal, une cause unique à identifier ; la cartographie reste valide", () => {
    for (const e of [
      entreeVide(),
      { ...entreePleine(), alerte: null, urgence: null, tresorerie: null },
    ]) {
      const c = cartographieDeRepli(e);
      expect(c.causes).toHaveLength(1);
      expect(c.causes[0]).toMatchObject({
        id: "c01",
        domaine: "exploitation",
        confiance: "faible",
      });
    }
    const calme = cartographieDeRepli({
      ...entreePleine(),
      urgence: { domaines: [{ domaine: "social", voyant: "vert", pourcentage: 0 }] },
      alerte: { score: 3, niveau: "faible", criteres: [] },
      tresorerie: {
        semainesTension: [],
        premiereSemaineTension: null,
        besoinFinancement: 0,
        devise: "XOF",
      },
    });
    expect(calme.causes[0]?.libelle).toBe("Causes à identifier avec le client");
  });

  it("couvre les cinq domaines et tous les critères", () => {
    expect(Object.keys(DOMAINE_CRITERE_ALERTE).sort()).toEqual([...CRITERES_ALERTE].sort());
    const tout = cartographieDeRepli({
      urgence: {
        domaines: DOMAINES_URGENCE.map((domaine) => ({
          domaine,
          voyant: "rouge" as const,
          pourcentage: 80,
        })),
      },
      alerte: null,
      ratios: null,
      tresorerie: null,
    });
    expect(tout.causes).toHaveLength(5);
    // Tous les critères défavorables : chacun apparaît dans la description de son domaine.
    const critiques = cartographieDeRepli({
      urgence: null,
      alerte: {
        score: 90,
        niveau: "critique",
        criteres: CRITERES_ALERTE.map((critere) => ({ critere, statut: "rouge" as const })),
      },
      ratios: null,
      tresorerie: null,
    });
    expect(critiques.causes.map((x) => x.domaine)).toEqual([
      "tresorerie",
      "activite",
      "exploitation",
      "financement",
    ]);
  });
});

describe("contexteChiffresCauses", () => {
  it("ne reprend que des sorties de moteurs, ratios non calculables exclus", () => {
    const c = contexteChiffresCauses(entreePleine());
    const par = (libelle: string) => c.find((x) => x.libelle.startsWith(libelle));
    expect(par("Score d'alerte précoce")).toEqual({
      libelle: "Score d'alerte précoce",
      valeur: 62,
      unite: "sur 100",
    });
    expect(par("Liquidité générale")).toMatchObject({ valeur: 136.36, unite: "%" });
    expect(par("Besoin en fonds de roulement")).toMatchObject({ valeur: 54, unite: "jours" });
    expect(par("Marge nette")).toBeUndefined();
    expect(par("Semaines de tension")).toMatchObject({ valeur: 3 });
    expect(par("Première semaine")).toMatchObject({ valeur: 4 });
    expect(par("Besoin de financement")).toMatchObject({ valeur: 25_000_000, unite: "XOF" });
    // Domaine non évalué : pas de pourcentage.
    expect(c.filter((x) => x.libelle.startsWith("Urgence, domaine"))).toHaveLength(4);
    expect(c.every((x) => Number.isFinite(x.valeur))).toBe(true);
  });

  it("est vide sans donnée, et omet score et première semaine absents", () => {
    expect(contexteChiffresCauses(entreeVide())).toEqual([]);
    const c = contexteChiffresCauses({
      ...entreeVide(),
      alerte: { score: null, niveau: "insuffisant", criteres: [] },
      tresorerie: {
        semainesTension: [],
        premiereSemaineTension: null,
        besoinFinancement: 0,
        devise: "EUR",
      },
    });
    expect(c.map((x) => x.libelle)).toEqual([
      "Semaines de tension de trésorerie projetées",
      "Besoin de financement de la trésorerie",
    ]);
  });
});

describe("entreeCausesExploitable et syntheseContexteCauses", () => {
  it("détecte l'absence de toute donnée", () => {
    expect(entreeCausesExploitable(entreeVide())).toBe(false);
    for (const cle of ["urgence", "alerte", "ratios", "tresorerie"] as const) {
      expect(entreeCausesExploitable({ ...entreeVide(), [cle]: entreePleine()[cle] })).toBe(true);
    }
  });

  it("rend une synthèse qualitative sans nombre", () => {
    const s = syntheseContexteCauses(entreePleine());
    expect(s).toContain("Urgence, domaine trésorerie : voyant rouge");
    expect(s).toContain("Indicateur liquidité générale : rouge");
    expect(s).toContain("Niveau d'alerte précoce : eleve");
    expect(s).toContain("des semaines de tension sont projetées");
    expect(s).not.toContain("endettement");
    expect(/\d/.test(s)).toBe(false);
    expect(
      syntheseContexteCauses({
        ...entreeVide(),
        tresorerie: {
          semainesTension: [],
          premiereSemaineTension: null,
          besoinFinancement: 0,
          devise: "XOF",
        },
      }),
    ).toContain("aucune semaine de tension");
    expect(syntheseContexteCauses(entreeVide())).toBe("(aucune donnée de diagnostic)");
  });
});
