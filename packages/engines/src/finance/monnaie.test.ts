import { describe, expect, it } from "vitest";
import {
  PARITE_EUR_FCFA,
  additionner,
  appliquerPourcentage,
  comparer,
  convertir,
  convertirVersDevise,
  figerTauxChange,
  formaterMontant,
  montant,
  montantDepuisDecimal,
  multiplier,
  oppose,
  pariteUnitaire,
  repartir,
  repartirEgalement,
  sommer,
  soustraire,
  zero,
  type Montant,
} from "./monnaie";

const xof = (v: number): Montant => montant(v, "XOF");
const eur = (v: number): Montant => montant(v, "EUR");
const valeurs = (ms: readonly Montant[]): number[] => ms.map((m) => m.valeur);
const total = (ms: readonly Montant[]): number => ms.reduce((s, m) => s + m.valeur, 0);

describe("construction", () => {
  it("n'accepte que des entiers d'unités mineures", () => {
    expect(xof(1_500_000)).toEqual({ valeur: 1_500_000, devise: "XOF" });
    expect(() => xof(1.5)).toThrow(expect.objectContaining({ code: "MONTANT_INVALIDE" }));
    expect(() => eur(2 ** 60)).toThrow(expect.objectContaining({ code: "MONTANT_INVALIDE" }));
  });

  it("convertit une saisie décimale sans arrondi silencieux", () => {
    expect(montantDepuisDecimal(1234.5, "EUR")).toEqual(eur(123_450));
    expect(montantDepuisDecimal(0.1, "USD").valeur).toBe(10);
    expect(montantDepuisDecimal(1_500_000, "XOF")).toEqual(xof(1_500_000));
    expect(() => montantDepuisDecimal(1234.567, "EUR")).toThrow(/trop de décimales/);
    expect(() => montantDepuisDecimal(10.5, "XOF")).toThrow(
      expect.objectContaining({ code: "MONTANT_INVALIDE" }),
    );
  });
});

describe("opérations", () => {
  it("additionne, soustrait et somme dans une même devise", () => {
    expect(additionner(xof(100), xof(250))).toEqual(xof(350));
    expect(soustraire(xof(100), xof(250))).toEqual(xof(-150));
    expect(sommer([xof(1), xof(2), xof(3)], "XOF")).toEqual(xof(6));
    expect(sommer([], "EUR")).toEqual(zero("EUR"));
  });

  it("refuse les devises différentes", () => {
    const attendu = expect.objectContaining({ code: "DEVISE_DIFFERENTE" });
    expect(() => additionner(xof(100), eur(100))).toThrow(attendu);
    expect(() => soustraire(xof(100), montant(100, "XAF"))).toThrow(attendu);
    expect(() => sommer([eur(1)], "XOF")).toThrow(attendu);
    expect(() => comparer(eur(1), montant(1, "USD"))).toThrow(attendu);
  });

  it("compare et prend l'opposé (sans zéro négatif)", () => {
    expect(comparer(xof(1), xof(2))).toBe(-1);
    expect(comparer(xof(2), xof(2))).toBe(0);
    expect(comparer(xof(3), xof(2))).toBe(1);
    expect(oppose(xof(5))).toEqual(xof(-5));
    expect(Object.is(oppose(xof(0)).valeur, 0)).toBe(true);
  });
});

describe("multiplication : arrondi au plus proche, demi loin de zéro", () => {
  it("multiplie jours × taux", () => {
    // 2,5 j × 350 000 FCFA = 875 000 FCFA, exact.
    expect(multiplier(xof(350_000), 2.5)).toEqual(xof(875_000));
    // 0,5 j × 333,33 € = 166,665 € → 16 666,5 centimes → 16 667.
    expect(multiplier(eur(33_333), 0.5)).toEqual(eur(16_667));
    // Symétrie : −16 666,5 → −16 667.
    expect(multiplier(eur(-33_333), 0.5)).toEqual(eur(-16_667));
    // 0,1 × 3 vaut 0,30000000000000004 en flottant : 100 × ce facteur = 30.
    expect(multiplier(xof(100), 0.1 * 3)).toEqual(xof(30));
  });

  it("applique un pourcentage en points", () => {
    expect(appliquerPourcentage(xof(1_000_000), 18)).toEqual(xof(180_000));
    expect(appliquerPourcentage(xof(1_005), 7.5)).toEqual(xof(75)); // 75,375
    expect(appliquerPourcentage(xof(1_010), 5)).toEqual(xof(51)); // 50,5
    expect(appliquerPourcentage(xof(-1_010), 5)).toEqual(xof(-51));
  });
});

describe("répartition sans perte", () => {
  it("donne le reste à la dernière part", () => {
    expect(valeurs(repartirEgalement(xof(100), 3))).toEqual([33, 33, 34]);
    expect(valeurs(repartir(xof(10_000_000), [30, 40, 30]))).toEqual([
      3_000_000, 4_000_000, 3_000_000,
    ]);
    expect(valeurs(repartir(xof(-100), [1, 1, 1]))).toEqual([-33, -33, -34]);
  });

  it("ne produit jamais de part négative pour un total positif", () => {
    const parts = repartir(
      xof(5),
      Array.from({ length: 10 }, () => 1),
    );
    expect(total(parts)).toBe(5);
    expect(parts.every((p) => p.valeur >= 0)).toBe(true);
  });

  it("conserve le total pour des poids décimaux", () => {
    const parts = repartir(eur(100_001), [33.33, 33.33, 33.34]);
    expect(total(parts)).toBe(100_001);
    expect(valeurs(parts)).toEqual([33_330, 33_330, 33_341]);
  });

  it("refuse des poids invalides", () => {
    const attendu = expect.objectContaining({ code: "REPARTITION_INVALIDE" });
    expect(() => repartir(xof(100), [])).toThrow(attendu);
    expect(() => repartir(xof(100), [-1, 2])).toThrow(attendu);
    expect(() => repartir(xof(100), [0, 0])).toThrow(attendu);
    expect(() => repartirEgalement(xof(100), 0)).toThrow(attendu);
    expect(() => repartirEgalement(xof(100), 1.5)).toThrow(attendu);
  });
});

describe("conversion au taux figé (FIN-04)", () => {
  const eurXof = figerTauxChange("EUR", "XOF", PARITE_EUR_FCFA, "2026-10-06");

  it("fige un taux immuable", () => {
    expect(Object.isFrozen(eurXof)).toBe(true);
    expect(eurXof).toEqual({
      source: "EUR",
      cible: "XOF",
      taux: 655.957,
      dateFixation: "2026-10-06",
    });
  });

  it("convertit en tenant compte des décimales", () => {
    // 1 000,00 € = 100 000 centimes × 655,957 × 10^(0−2) = 655 957 FCFA.
    expect(convertir(eur(100_000), eurXof)).toEqual(xof(655_957));
    // 0,01 € = 6,55957 FCFA → 7.
    expect(convertir(eur(1), eurXof)).toEqual(xof(7));
    const xofEur = figerTauxChange("XOF", "EUR", 1 / PARITE_EUR_FCFA, "2026-10-06");
    expect(convertir(xof(655_957), xofEur)).toEqual(eur(100_000));
    const usdEur = figerTauxChange("USD", "EUR", 0.92, "2026-10-06");
    expect(convertir(montant(10_000, "USD"), usdEur)).toEqual(eur(9_200));
    const identite = figerTauxChange("XOF", "XOF", 1, "2026-10-06");
    expect(convertir(xof(42), identite)).toEqual(xof(42));
  });

  it("refuse un taux invalide ou mal appliqué", () => {
    const attendu = expect.objectContaining({ code: "TAUX_CHANGE_INVALIDE" });
    expect(() => figerTauxChange("EUR", "XOF", 0, "2026-10-06")).toThrow(attendu);
    expect(() => figerTauxChange("EUR", "XOF", -1, "2026-10-06")).toThrow(attendu);
    expect(() => figerTauxChange("XOF", "XOF", 2, "2026-10-06")).toThrow(attendu);
    expect(() => figerTauxChange("EUR", "XOF", 655.957, "06/10/2026")).toThrow(
      expect.objectContaining({ code: "DATE_INVALIDE" }),
    );
    expect(() => convertir(montant(100, "USD"), eurXof)).toThrow(attendu);
  });
});

describe("coûts ramenés dans la devise de la mission (taux figé de la mission)", () => {
  const eurXof = figerTauxChange("EUR", "XOF", PARITE_EUR_FCFA, "2026-10-06");
  const usdXof = figerTauxChange("USD", "XOF", 600, "2026-10-06");
  const usd = (v: number): Montant => montant(v, "USD");
  const xaf = (v: number): Montant => montant(v, "XAF");

  it("reconnaît la parité unitaire (même devise, XOF et XAF)", () => {
    expect(pariteUnitaire("EUR", "EUR")).toBe(true);
    expect(pariteUnitaire("XOF", "XAF")).toBe(true);
    expect(pariteUnitaire("XAF", "XOF")).toBe(true);
    expect(pariteUnitaire("EUR", "USD")).toBe(false);
    expect(pariteUnitaire("XOF", "EUR")).toBe(false);
  });

  it("laisse inchangé un montant déjà dans la devise de la mission, même sans taux", () => {
    expect(convertirVersDevise(xof(350_000), "XOF")).toEqual(xof(350_000));
    expect(convertirVersDevise(eur(53_357), "EUR", eurXof)).toEqual(eur(53_357));
    expect(convertirVersDevise(usd(1), "USD")).toEqual(usd(1));
  });

  it("EUR : coût en FCFA divisé par le taux figé, arrondi au centime", () => {
    // 350 000 FCFA / 655,957 = 533,5715… € → 53 357 centimes.
    expect(convertirVersDevise(xof(350_000), "EUR", eurXof)).toEqual(eur(53_357));
    expect(convertirVersDevise(xof(655_957), "EUR", eurXof)).toEqual(eur(100_000));
    // Un coût en XAF passe par la parité XAF = XOF.
    expect(convertirVersDevise(xaf(350_000), "EUR", eurXof)).toEqual(eur(53_357));
  });

  it("USD : 1 USD = 600 FCFA, demi-centime arrondi en s'éloignant de zéro", () => {
    // 350 000 / 600 = 583,333… $ → 58 333 centimes.
    expect(convertirVersDevise(xof(350_000), "USD", usdXof)).toEqual(usd(58_333));
    expect(convertirVersDevise(xof(3), "USD", usdXof)).toEqual(usd(1)); // 0,5 → 1
    expect(convertirVersDevise(xof(9), "USD", usdXof)).toEqual(usd(2)); // 1,5 → 2
    expect(convertirVersDevise(xof(-3), "USD", usdXof)).toEqual(usd(-1));
    expect(convertirVersDevise(xof(1), "USD", usdXof)).toEqual(usd(0)); // 0,1667 → 0
  });

  it("XOF ↔ XAF : parité fixe 1 pour 1, sans taux", () => {
    expect(convertirVersDevise(xof(350_000), "XAF")).toEqual(xaf(350_000));
    expect(convertirVersDevise(xaf(275_000), "XOF")).toEqual(xof(275_000));
    const xafXof = figerTauxChange("XAF", "XOF", 1, "2026-10-06");
    expect(convertirVersDevise(xof(350_000), "XAF", xafXof)).toEqual(xaf(350_000));
  });

  it("applique le taux dans le sens direct quand le montant est dans la devise source", () => {
    expect(convertirVersDevise(eur(100_000), "XOF", eurXof)).toEqual(xof(655_957));
    expect(convertirVersDevise(eur(100_000), "XAF", eurXof)).toEqual(xaf(655_957));
  });

  it("rend null sans taux, ou avec un taux qui ne relie pas les deux devises", () => {
    expect(convertirVersDevise(xof(350_000), "EUR")).toBeNull();
    expect(convertirVersDevise(xof(350_000), "USD", eurXof)).toBeNull();
    expect(convertirVersDevise(usd(10_000), "EUR", eurXof)).toBeNull();
    expect(convertirVersDevise(eur(10_000), "USD", usdXof)).toBeNull();
  });

  it("refuse un taux non positif ou non fini", () => {
    const nul = { source: "EUR", cible: "XOF", taux: 0, dateFixation: "2026-10-06" } as const;
    expect(() => convertirVersDevise(xof(1), "EUR", nul)).toThrow(
      expect.objectContaining({ code: "TAUX_CHANGE_INVALIDE" }),
    );
    expect(() => convertirVersDevise(xof(1), "EUR", { ...nul, taux: -655.957 })).toThrow(
      expect.objectContaining({ code: "TAUX_CHANGE_INVALIDE" }),
    );
    expect(() => convertirVersDevise(xof(1), "EUR", { ...nul, taux: Number.NaN })).toThrow(
      expect.objectContaining({ code: "NOMBRE_INVALIDE" }),
    );
  });
});

describe("formatage fr-FR", () => {
  const fine = " ";
  const insecable = " ";

  it.each<[Montant, string]>([
    [xof(1_500_000), `1${fine}500${fine}000${insecable}FCFA`],
    [montant(999, "XAF"), `999${insecable}FCFA`],
    [eur(123_450), `1${fine}234,50${insecable}€`],
    [eur(5), `0,05${insecable}€`],
    [montant(-1_200, "USD"), `-12,00${insecable}$US`],
    [xof(0), `0${insecable}FCFA`],
    [eur(-123_456_789), `-1${fine}234${fine}567,89${insecable}€`],
  ])("%o → %s", (m, attendu) => {
    expect(formaterMontant(m)).toBe(attendu);
  });
});
