import { describe, expect, it } from "vitest";
import {
  BAREME_FIABILITE_DOSSIER_DEFAUT,
  cleDateFrise,
  construireFrise,
  contexteDepuisFacteurs,
  controlerEtatFinancier,
  ErreurDossier,
  indiceFiabiliteDossier,
  lireMontantTexte,
  moisRevolus,
  validerLignesEtat,
  valeursCourantesDatees,
  type EntreeFiabiliteDossier,
  type EvenementFrise,
  type LigneEtatFinancier,
} from "./index";

/** Code d'erreur levé par `fn`, ou `null`. */
function codeErreur(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof ErreurDossier) return e.code;
    throw e;
  }
}

/** État équilibré : actif 1 000 = passif 1 000 ; produits 500 − charges 400 = 100 au bilan. */
function etatEquilibre(): LigneEtatFinancier[] {
  return [
    { code: "AD", section: "actif", montant: 600, parent: "AZ" },
    { code: "AI", section: "actif", montant: 0, parent: "AZ" },
    { code: "AZ", section: "actif", montant: 600 },
    { code: "BT", section: "actif", montant: 400 },
    { code: "BZ", section: "actif", montant: 1000, role: "total" },
    { code: "CA", section: "passif", montant: 500 },
    { code: "CJ", section: "passif", montant: 100, role: "resultat_exercice" },
    { code: "DJ", section: "passif", montant: 400 },
    { code: "DZ", section: "passif", montant: 1000, role: "total" },
    { code: "RA", section: "charges", montant: 400 },
    { code: "TA", section: "produits", montant: 500 },
    { code: "XI", section: "resultat", montant: 100, role: "resultat_net" },
  ];
}

describe("lireMontantTexte", () => {
  it("lit les entiers avec séparateurs de milliers, signes et parenthèses", () => {
    expect(lireMontantTexte("1 234 567", 0)).toBe(1234567);
    expect(lireMontantTexte("1\u00a0234\u202f567", 0)).toBe(1234567);
    expect(lireMontantTexte("1'234", 0)).toBe(1234);
    expect(lireMontantTexte("-12 000", 0)).toBe(-12000);
    expect(lireMontantTexte("\u221212", 0)).toBe(-12);
    expect(lireMontantTexte("(12 000)", 0)).toBe(-12000);
    expect(lireMontantTexte("-0", 0)).toBe(0);
    expect(lireMontantTexte("1234,00", 0)).toBe(1234);
  });

  it("lit les décimales exactement, sans flottant", () => {
    expect(lireMontantTexte("1 234,5", 2)).toBe(123450);
    expect(lireMontantTexte("0.07", 2)).toBe(7);
    expect(lireMontantTexte("1234.5", 2)).toBe(123450);
    expect(lireMontantTexte("12", 2)).toBe(1200);
  });

  it("refuse le texte, la notation scientifique, l'excès de précision et l'énorme", () => {
    expect(codeErreur(() => lireMontantTexte("abc", 0))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("1e21", 0))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("1.234.567", 0))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("12,5", 0))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("1,234", 2))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("(-12)", 0))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("", 0))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("1".repeat(41), 0))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => lireMontantTexte("1000000000000001", 0))).toBe("MONTANT_INVALIDE");
    expect(lireMontantTexte("1000000000000000", 0)).toBe(1_000_000_000_000_000);
    expect(codeErreur(() => lireMontantTexte("1", 5))).toBe("OPTIONS_INVALIDES");
    expect(codeErreur(() => lireMontantTexte("1", 1.5))).toBe("OPTIONS_INVALIDES");
  });
});

describe("controlerEtatFinancier", () => {
  it("accepte automatiquement un état équilibré et complet", () => {
    const c = controlerEtatFinancier(etatEquilibre());
    expect(c.conforme).toBe(true);
    expect(c.complet).toBe(true);
    expect(c.acceptationAutomatique).toBe(true);
    expect(c.totaux).toEqual({
      actif: 1000,
      passif: 1000,
      charges: 400,
      produits: 500,
      resultat: 100,
    });
    expect(c.constats.map((x) => [x.code, x.cible, x.statut])).toEqual([
      ["SOUS_TOTAL", "AZ", "ok"],
      ["TOTAL_SECTION", "actif", "ok"],
      ["TOTAL_SECTION", "passif", "ok"],
      ["EQUILIBRE_BILAN", null, "ok"],
      ["RESULTAT_COMPTE", "XI", "ok"],
      ["RESULTAT_BILAN", "CJ", "ok"],
    ]);
    expect(c.constats[0]?.lignes).toEqual(["AD", "AI"]);
  });

  it("détaille les écarts : bilan déséquilibré, sous-total, total et résultat faux", () => {
    const lignes = etatEquilibre().map((l) => {
      if (l.code === "AI") return { ...l, montant: 5 };
      if (l.code === "DJ") return { ...l, montant: 390 };
      if (l.code === "XI") return { ...l, montant: 90 };
      return l;
    });
    const c = controlerEtatFinancier(lignes);
    expect(c.conforme).toBe(false);
    expect(c.acceptationAutomatique).toBe(false);
    const ecarts = c.constats.filter((x) => x.statut === "ecart");
    expect(ecarts.map((x) => [x.code, x.cible, x.attendu, x.constate, x.ecart])).toEqual([
      ["SOUS_TOTAL", "AZ", 605, 600, -5],
      ["TOTAL_SECTION", "passif", 990, 1000, 10],
      ["RESULTAT_COMPTE", "XI", 100, 90, -10],
      ["RESULTAT_BILAN", "CJ", 90, 100, 10],
    ]);
  });

  it("applique la tolérance entière", () => {
    const lignes = etatEquilibre().map((l) => (l.code === "DJ" ? { ...l, montant: 401 } : l));
    expect(controlerEtatFinancier(lignes).conforme).toBe(false);
    const c = controlerEtatFinancier(lignes, { tolerance: 1 });
    expect(c.conforme).toBe(true);
    expect(c.tolerance).toBe(1);
    expect(codeErreur(() => controlerEtatFinancier(lignes, { tolerance: -1 }))).toBe(
      "TOLERANCE_INVALIDE",
    );
    expect(codeErreur(() => controlerEtatFinancier(lignes, { tolerance: 0.5 }))).toBe(
      "TOLERANCE_INVALIDE",
    );
  });

  it("calcule les totaux absents et le résultat par produits − charges", () => {
    const lignes: LigneEtatFinancier[] = [
      { code: "A1", section: "actif", montant: 300 },
      { code: "P1", section: "passif", montant: 250 },
      { code: "P2", section: "passif", montant: 50, role: "resultat_exercice" },
      { code: "C1", section: "charges", montant: 150 },
      { code: "R1", section: "produits", montant: 200 },
    ];
    const c = controlerEtatFinancier(lignes);
    expect(c.acceptationAutomatique).toBe(true);
    expect(c.constats.map((x) => x.code)).toEqual(["EQUILIBRE_BILAN", "RESULTAT_BILAN"]);
    expect(c.totaux.resultat).toBe(50);
  });

  it("n'accepte jamais sans bilan ou sans compte de résultat (contrôles requis)", () => {
    const bilanSeul: LigneEtatFinancier[] = [
      { code: "A1", section: "actif", montant: 100 },
      { code: "P1", section: "passif", montant: 100 },
    ];
    const c = controlerEtatFinancier(bilanSeul);
    expect(c.conforme).toBe(true);
    expect(c.complet).toBe(false);
    expect(c.acceptationAutomatique).toBe(false);
    expect(c.constats.find((x) => x.code === "RESULTAT_BILAN")?.statut).toBe("non_verifiable");
    expect(c.totaux.resultat).toBeNull();

    const compteSeul: LigneEtatFinancier[] = [
      { code: "C1", section: "charges", montant: 10 },
      { code: "R1", section: "produits", montant: 20 },
    ];
    const d = controlerEtatFinancier(compteSeul);
    expect(d.constats.map((x) => [x.code, x.statut])).toEqual([
      ["EQUILIBRE_BILAN", "non_verifiable"],
      ["RESULTAT_BILAN", "non_verifiable"],
    ]);
    expect(d.totaux).toEqual({
      actif: null,
      passif: null,
      charges: 10,
      produits: 20,
      resultat: 10,
    });
  });

  it("garde le résultat net déclaré sans charges ni produits", () => {
    const lignes: LigneEtatFinancier[] = [
      { code: "A1", section: "actif", montant: 100 },
      { code: "P1", section: "passif", montant: 70 },
      { code: "CJ", section: "passif", montant: 30, role: "resultat_exercice" },
      { code: "XI", section: "resultat", montant: 30, role: "resultat_net" },
    ];
    const c = controlerEtatFinancier(lignes);
    expect(c.acceptationAutomatique).toBe(true);
    expect(c.constats.some((x) => x.code === "RESULTAT_COMPTE")).toBe(false);
  });

  it("gère les sous-totaux imbriqués et les montants négatifs", () => {
    const lignes: LigneEtatFinancier[] = [
      { code: "A", section: "actif", montant: 50 },
      { code: "A.1", section: "actif", montant: 80, parent: "A" },
      { code: "A.1.1", section: "actif", montant: 80, parent: "A.1" },
      { code: "A.2", section: "actif", montant: -30, parent: "A" },
      { code: "P", section: "passif", montant: 50 },
    ];
    const c = controlerEtatFinancier(lignes);
    expect(c.constats.filter((x) => x.code === "SOUS_TOTAL").map((x) => x.statut)).toEqual([
      "ok",
      "ok",
    ]);
    expect(c.totaux.actif).toBe(50);
  });

  it("refuse une structure invalide avec un code stable", () => {
    const base = etatEquilibre();
    const cas: [LigneEtatFinancier[], string][] = [
      [[], "LIGNES_INVALIDES"],
      [[{ code: "x y", section: "actif", montant: 1 }], "CODE_LIGNE_INVALIDE"],
      [[...base, { code: "AD", section: "actif", montant: 1 }], "CODE_LIGNE_EN_DOUBLE"],
      [[{ code: "A", section: "bilan" as never, montant: 1 }], "LIGNES_INVALIDES"],
      [[{ code: "A", section: "actif", montant: 1.5 }], "MONTANT_INVALIDE"],
      [[{ code: "A", section: "actif", montant: 2e15 }], "MONTANT_INVALIDE"],
      [[{ code: "A", section: "actif", montant: 1, role: "autre" as never }], "ROLE_INVALIDE"],
      [[{ code: "A", section: "actif", montant: 1, role: "resultat_exercice" }], "ROLE_INVALIDE"],
      [[{ code: "A", section: "passif", montant: 1, role: "resultat_net" }], "ROLE_INVALIDE"],
      [[{ code: "A", section: "resultat", montant: 1 }], "ROLE_INVALIDE"],
      [
        [
          { code: "A", section: "actif", montant: 1 },
          { code: "T", section: "actif", montant: 1, role: "total", parent: "A" },
        ],
        "ROLE_INVALIDE",
      ],
      [
        [
          { code: "T1", section: "actif", montant: 1, role: "total" },
          { code: "T2", section: "actif", montant: 1, role: "total" },
        ],
        "ROLE_INVALIDE",
      ],
      [[{ code: "A", section: "actif", montant: 1, parent: "Z" }], "PARENT_INCONNU"],
      [[{ code: "A", section: "actif", montant: 1, parent: "A" }], "PARENT_INVALIDE"],
      [
        [
          { code: "A", section: "actif", montant: 1 },
          { code: "B", section: "passif", montant: 1, parent: "A" },
        ],
        "PARENT_INVALIDE",
      ],
      [
        [
          { code: "T", section: "actif", montant: 1, role: "total" },
          { code: "B", section: "actif", montant: 1, parent: "T" },
        ],
        "PARENT_INVALIDE",
      ],
      [
        [
          { code: "A", section: "actif", montant: 1, parent: "B" },
          { code: "B", section: "actif", montant: 1, parent: "A" },
        ],
        "CYCLE_PARENTS",
      ],
    ];
    for (const [lignes, code] of cas)
      expect(codeErreur(() => validerLignesEtat(lignes))).toBe(code);
    expect(
      codeErreur(() =>
        validerLignesEtat(
          Array.from({ length: 1001 }, (_, i) => ({
            code: `L${i}`,
            section: "actif" as const,
            montant: 1,
          })),
        ),
      ),
    ).toBe("LIGNES_INVALIDES");
    expect(codeErreur(() => validerLignesEtat(null as never))).toBe("LIGNES_INVALIDES");
  });

  it("refuse une somme qui sortirait du calcul exact", () => {
    const lignes = Array.from({ length: 10 }, (_, i) => ({
      code: `A${i}`,
      section: "actif" as const,
      montant: 1_000_000_000_000_000,
    }));
    expect(codeErreur(() => controlerEtatFinancier(lignes))).toBe("MONTANT_INVALIDE");
    const negatives = lignes.map((l) => ({ ...l, montant: -l.montant }));
    expect(codeErreur(() => controlerEtatFinancier(negatives))).toBe("MONTANT_INVALIDE");
  });

  it("est déterministe", () => {
    expect(controlerEtatFinancier(etatEquilibre())).toEqual(
      controlerEtatFinancier(etatEquilibre()),
    );
  });
});

describe("indiceFiabiliteDossier", () => {
  const entree = (e: Partial<EntreeFiabiliteDossier> = {}): EntreeFiabiliteDossier => ({
    certification: "certifies",
    partInformel: "faible",
    etats: [{ dateCloture: "2025-12-31", controlesOk: true }],
    fiabilitesFaits: ["A", "B"],
    dateReference: "2026-10-08",
    ...e,
  });

  it("classe A, analyses non indicatives pour des comptes certifiés, récents et cohérents", () => {
    const i = indiceFiabiliteDossier(entree());
    expect(i.points).toBe(100);
    expect(i.classe).toBe("A");
    expect(i.detail).toEqual({
      certification: 35,
      informel: 25,
      coherence: 20,
      anciennete: 10,
      sources: 10,
    });
    expect(i.analysesIndicatives).toBe(false);
    expect(i.moisDepuisDerniereCloture).toBe(9);
    expect(i.recommandations).toEqual([]);
  });

  it("marque indicatives les analyses de comptes non certifiés à informel fort (PRD §4.4)", () => {
    const i = indiceFiabiliteDossier(
      entree({
        certification: "non_certifies",
        partInformel: "forte",
        etats: [
          { dateCloture: "2023-12-31", controlesOk: true },
          { dateCloture: "2024-06-30", controlesOk: false },
        ],
        fiabilitesFaits: ["C", "D", "D", "A"],
      }),
    );
    expect(i.detail).toEqual({
      certification: 15,
      informel: 0,
      coherence: 10,
      anciennete: 5,
      sources: 2,
    });
    expect(i.points).toBe(32);
    expect(i.classe).toBe("D");
    expect(i.analysesIndicatives).toBe(true);
    expect(i.recommandations.map((r) => r.code)).toEqual([
      "COMPTES_NON_CERTIFIES",
      "INFORMEL_FORT",
      "ETATS_INCOHERENTS",
      "DONNEES_ANCIENNES",
      "SOURCES_FAIBLES",
    ]);
    expect(i.moisDepuisDerniereCloture).toBe(27);
  });

  it("dossier vide : classe D et recommandations de renseignement", () => {
    const i = indiceFiabiliteDossier(
      entree({ certification: null, partInformel: null, etats: [], fiabilitesFaits: [] }),
    );
    expect(i.points).toBe(0);
    expect(i.classe).toBe("D");
    expect(i.moisDepuisDerniereCloture).toBeNull();
    expect(i.recommandations.map((r) => r.code)).toEqual([
      "CERTIFICATION_INCONNUE",
      "INFORMEL_INCONNU",
      "AUCUN_ETAT_FINANCIER",
    ]);
  });

  it("classes B et C, comptes reconstitués, données trop anciennes", () => {
    const b = indiceFiabiliteDossier(entree({ partInformel: "moyenne", fiabilitesFaits: ["C"] }));
    expect(b.points).toBe(77);
    expect(b.classe).toBe("B");
    const c = indiceFiabiliteDossier(
      entree({ certification: "reconstitues", partInformel: "moyenne" }),
    );
    expect(c.points).toBe(57);
    expect(c.classe).toBe("C");
    expect(c.analysesIndicatives).toBe(true);
    expect(c.recommandations[0]?.code).toBe("COMPTES_RECONSTITUES");
    const vieux = indiceFiabiliteDossier(
      entree({ etats: [{ dateCloture: "2020-12-31", controlesOk: true }] }),
    );
    expect(vieux.detail.anciennete).toBe(0);
    const futur = indiceFiabiliteDossier(
      entree({ etats: [{ dateCloture: "2027-12-31", controlesOk: true }] }),
    );
    expect(futur.moisDepuisDerniereCloture).toBe(0);
  });

  it("accepte un barème calibré et refuse une date invalide", () => {
    const i = indiceFiabiliteDossier(entree(), {
      ...BAREME_FIABILITE_DOSSIER_DEFAUT,
      seuils: [101, 90, 80],
    });
    expect(i.classe).toBe("B");
    expect(codeErreur(() => indiceFiabiliteDossier(entree({ dateReference: "2026-02-30" })))).toBe(
      "DATE_INVALIDE",
    );
    expect(
      codeErreur(() =>
        indiceFiabiliteDossier(entree({ etats: [{ dateCloture: "x", controlesOk: true }] })),
      ),
    ).toBe("DATE_INVALIDE");
  });

  it("compte les mois révolus", () => {
    expect(moisRevolus("2025-12-31", "2026-10-08")).toBe(9);
    expect(moisRevolus("2025-01-15", "2025-02-15")).toBe(1);
    expect(moisRevolus("2025-01-15", "2025-02-14")).toBe(0);
  });
});

describe("construireFrise", () => {
  const ev = (type: EvenementFrise["type"], id: string, date: string): EvenementFrise => ({
    type,
    id,
    date,
    libelle: `${type} ${id}`,
  });

  it("fusionne, trie du plus récent au plus ancien et reste stable à date égale", () => {
    const f = construireFrise([
      [ev("mission", "m1", "2025-01-10"), ev("mission", "m2", "2026-03-01T10:00:00.000Z")],
      [ev("notation", "n1", "2026-03-01T10:00:00Z"), ev("notation", "n2", "2025-06-01")],
      [ev("alerte", "a1", "2025-01-10T00:00:00Z")],
    ]);
    expect(f.evenements.map((e) => e.id)).toEqual(["m2", "n1", "n2", "m1", "a1"]);
    expect(f.total).toBe(5);
    expect(f.tronquee).toBe(false);
  });

  it("ordre chronologique et troncature signalée", () => {
    const f = construireFrise(
      [
        [
          ev("fait", "f1", "2024-01-01"),
          ev("decision", "d1", "2023-01-01"),
          ev("fait", "f2", "2025-01-01"),
        ],
      ],
      { ordre: "ancien_d_abord", limite: 2 },
    );
    expect(f.evenements.map((e) => e.id)).toEqual(["d1", "f1"]);
    expect(f.tronquee).toBe(true);
    expect(construireFrise([]).evenements).toEqual([]);
  });

  it("refuse un événement ou des options invalides", () => {
    expect(codeErreur(() => construireFrise([[ev("autre" as never, "x", "2025-01-01")]]))).toBe(
      "EVENEMENT_INVALIDE",
    );
    expect(codeErreur(() => construireFrise([[ev("fait", "x", "2025-13-01")]]))).toBe(
      "EVENEMENT_INVALIDE",
    );
    expect(codeErreur(() => construireFrise([[ev("fait", "x", "2025-01-01T25:00:00Z")]]))).toBe(
      "EVENEMENT_INVALIDE",
    );
    expect(codeErreur(() => cleDateFrise(undefined as never))).toBe("EVENEMENT_INVALIDE");
    expect(codeErreur(() => construireFrise([], { limite: 0 }))).toBe("OPTIONS_INVALIDES");
    expect(codeErreur(() => construireFrise([], { ordre: "autre" as never }))).toBe(
      "OPTIONS_INVALIDES",
    );
    const trop = Array.from({ length: 20_001 }, (_, i) => ev("fait", `f${i}`, "2025-01-01"));
    expect(codeErreur(() => construireFrise([trop]))).toBe("OPTIONS_INVALIDES");
  });

  it("lit une date civile comme minuit UTC", () => {
    expect(cleDateFrise("2025-01-02")).toBe(Date.parse("2025-01-02T00:00:00Z"));
    expect(cleDateFrise("2025-01-02T03:04:05.123456Z")).toBe(
      Date.parse("2025-01-02T03:04:05.123Z"),
    );
  });
});

describe("valeurs courantes datées", () => {
  const v = (cle: string, dateEffet: string, rang: number, valeur: unknown) => ({
    cle,
    dateEffet,
    rang,
    valeur,
  });

  it("retient la date d'effet la plus récente non future, puis le dernier enregistré", () => {
    const valeurs = [
      v("taille", "2024-01-01", 1, "pme"),
      v("taille", "2025-01-01", 2, "eti"),
      v("taille", "2027-01-01", 3, "grande"),
      v("effectif", "2025-01-01", 4, 40),
      v("effectif", "2025-01-01", 5, 42),
      v("certifies", "2025-01-01", 6, true),
    ];
    expect(valeursCourantesDatees(valeurs, "2026-10-08").map((x) => [x.cle, x.valeur])).toEqual([
      ["certifies", true],
      ["effectif", 42],
      ["taille", "eti"],
    ]);
    expect(contexteDepuisFacteurs(valeurs, "2024-06-01")).toEqual({ taille: "pme" });
  });

  it("garde « __proto__ » comme une donnée", () => {
    const c = contexteDepuisFacteurs([v("__proto__", "2025-01-01", 1, "x")], "2026-01-01");
    expect(Object.keys(c)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(c)).toBe(Object.prototype);
  });

  it("refuse une date ou un rang invalide", () => {
    expect(codeErreur(() => valeursCourantesDatees([], "2026-13-01"))).toBe("DATE_INVALIDE");
    expect(codeErreur(() => valeursCourantesDatees([v("a", "x", 1, 1)], "2026-01-01"))).toBe(
      "DATE_INVALIDE",
    );
    expect(
      codeErreur(() => valeursCourantesDatees([v("a", "2025-01-01", Number.NaN, 1)], "2026-01-01")),
    ).toBe("OPTIONS_INVALIDES");
  });

  it("propage une erreur qui n'est pas du dossier", () => {
    expect(() =>
      codeErreur(() => {
        throw new Error("autre");
      }),
    ).toThrow("autre");
  });
});
