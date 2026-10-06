import { describe, expect, it } from "vitest";
import { calculerScenariosPlan, type HypothesesPlan, type ResultatPlanFinancier } from "./index";

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function generateur(graine: number) {
  let a = graine >>> 0;
  const suivant = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const entier = (min: number, max: number) => min + Math.floor(suivant() * (max - min + 1));
  /** Décimal à `d` décimales dans [min, max]. */
  const decimal = (min: number, max: number, d = 2) => {
    const p = 10 ** d;
    return entier(Math.round(min * p), Math.round(max * p)) / p;
  };
  return { entier, decimal, choix: <T>(xs: readonly T[]) => xs[entier(0, xs.length - 1)] as T };
}

function hypothesesAleatoires(graine: number): HypothesesPlan {
  const g = generateur(graine);
  const horizon = g.entier(3, 5);
  const parAnnee = (min: number, max: number, d = 2) =>
    g.entier(0, 1) === 0
      ? g.decimal(min, max, d)
      : Array.from({ length: horizon }, () => g.decimal(min, max, d));
  const emprunts = Array.from({ length: g.entier(0, 3) }, (_, i) => {
    const duree = g.entier(1, 8);
    return {
      libelle: `Emprunt ${i + 1}`,
      anneeDeblocage: g.entier(0, horizon),
      montant: g.entier(1, 50_000_000),
      tauxAnnuel: g.decimal(0, 15),
      duree,
      differe: g.entier(0, duree - 1),
      mode: g.choix(["annuites_constantes", "amortissement_constant"] as const),
    };
  });
  const immobilisationsNettes = g.entier(0, 1) === 0 ? 0 : g.entier(1, 80_000_000);
  const stocks = g.entier(0, 10_000_000);
  const creancesClients = g.entier(0, 20_000_000);
  const tresorerie = g.entier(-10_000_000, 30_000_000);
  const dettesFournisseurs = g.entier(0, 15_000_000);
  const capital = g.entier(0, 50_000_000);
  const dettesEnCours = emprunts
    .filter((e) => e.anneeDeblocage === 0)
    .reduce((s, e) => s + e.montant, 0);
  // Les réserves équilibrent le bilan d'ouverture (report à nouveau éventuellement débiteur).
  const reserves =
    immobilisationsNettes +
    stocks +
    creancesClients +
    tresorerie -
    capital -
    dettesEnCours -
    dettesFournisseurs;
  return {
    premierExercice: g.entier(2025, 2035),
    horizon,
    devise: g.choix(["XOF", "XAF", "EUR", "USD"] as const),
    chiffreAffairesReference: g.entier(0, 2_000_000_000),
    croissanceChiffreAffaires: parAnnee(-60, 80),
    tauxMargeBrute: parAnnee(5, 95),
    tauxChargesVariables: parAnnee(0, 20),
    chargesFixes:
      g.entier(0, 1) === 0
        ? g.entier(0, 300_000_000)
        : Array.from({ length: horizon }, () => g.entier(0, 300_000_000)),
    effectifs: Array.from({ length: g.entier(0, 3) }, (_, i) => ({
      libelle: `Catégorie ${i + 1}`,
      effectifs: parAnnee(0, 40, 1),
      salaireAnnuelBrut: g.entier(0, 20_000_000),
      tauxChargesSociales: g.decimal(0, 30),
      revalorisationAnnuelle: g.decimal(-5, 10),
    })),
    investissements: Array.from({ length: g.entier(0, 4) }, (_, i) => ({
      libelle: `Investissement ${i + 1}`,
      annee: g.entier(1, horizon),
      montant: g.entier(1, 200_000_000),
      dureeAmortissement: g.entier(1, 20),
    })),
    emprunts,
    augmentationsCapital: Array.from({ length: g.entier(0, 2) }, () => ({
      annee: g.entier(1, horizon),
      montant: g.entier(1, 100_000_000),
    })),
    delaiClientsJours: parAnnee(0, 120, 0),
    delaiFournisseursJours: parAnnee(0, 120, 0),
    stocksJours: parAnnee(0, 90, 1),
    tauxImpotSocietes: g.decimal(0, 35),
    tauxDistributionDividendes: g.decimal(0, 100, 0),
    tauxActualisation: g.decimal(0, 25),
    bilanOuverture: {
      immobilisationsNettes,
      dureeResiduelleImmobilisations: immobilisationsNettes > 0 ? g.entier(1, 15) : 0,
      stocks,
      creancesClients,
      tresorerie,
      capital,
      reserves,
      dettesFournisseurs,
      deficitsReportables: g.entier(0, 20_000_000),
    },
  };
}

function verifierCoherence(r: ResultatPlanFinancier, h: HypothesesPlan): void {
  const o = r.hypotheses.bilanOuverture;
  let tresorerie = o.tresorerie;
  let dotationsCumulees = 0;
  let acquisitionsCumulees = 0;
  for (const a of r.annees) {
    const { compteResultat: cr, bilan: b, fluxTresorerie: f, controle: c } = a;
    // Équilibre du bilan.
    expect(c.equilibre).toBe(true);
    expect(b.totalActif).toBe(b.totalPassif);
    expect(b.totalActif).toBe(
      b.immobilisationsNettes + b.stocks + b.creancesClients + b.tresorerieActif,
    );
    expect(b.totalPassif).toBe(
      b.capitauxPropres + b.dettesFinancieres + b.dettesFournisseurs + b.tresoreriePassif,
    );
    expect(b.capitauxPropres).toBe(b.capital + b.reserves + b.resultatExercice);
    expect(b.tresorerieNette).toBe(b.tresorerieActif - b.tresoreriePassif);
    expect(Math.min(b.tresorerieActif, b.tresoreriePassif)).toBe(0);
    // Soldes du compte de résultat.
    expect(cr.margeBrute).toBe(cr.chiffreAffaires - cr.achatsConsommes);
    expect(cr.excedentBrutExploitation).toBe(cr.valeurAjoutee - cr.chargesPersonnel);
    expect(cr.resultatNet).toBe(cr.resultatActivitesOrdinaires - cr.impotSurResultat);
    expect(cr.impotSurResultat).toBeGreaterThanOrEqual(0);
    // Tableau des flux.
    expect(f.tresorerieOuverture).toBe(tresorerie);
    expect(f.capaciteAutofinancement).toBe(cr.resultatNet + cr.dotationsAmortissements);
    expect(f.variationTresorerie).toBe(
      f.fluxActivitesOperationnelles + f.fluxInvestissement + f.fluxFinancement,
    );
    expect(f.tresorerieCloture).toBe(f.tresorerieOuverture + f.variationTresorerie);
    expect(f.tresorerieCloture).toBe(b.tresorerieNette);
    tresorerie = f.tresorerieCloture;
    dotationsCumulees += cr.dotationsAmortissements;
    acquisitionsCumulees += f.acquisitionsImmobilisations;
    expect(b.immobilisationsNettes).toBe(
      o.immobilisationsNettes + acquisitionsCumulees - dotationsCumulees,
    );
    expect(b.immobilisationsNettes).toBeGreaterThanOrEqual(0);
  }
  // Dettes : ouverture + nouveaux − remboursements = clôture.
  const ouverture = (h.emprunts ?? [])
    .filter((e) => e.anneeDeblocage === 0)
    .reduce((s, e) => s + e.montant, 0);
  const mouvements = r.annees.reduce(
    (s, a) => s + a.fluxTresorerie.empruntsNouveaux - a.fluxTresorerie.remboursementsEmprunts,
    0,
  );
  expect(r.annees.at(-1)?.bilan.dettesFinancieres).toBe(ouverture + mouvements);
  expect(r.equilibre).toBe(true);
}

describe("équilibre du bilan sur des cas aléatoires déterministes", () => {
  it("actif = passif et cohérence des trois états, scénarios compris (300 cas)", () => {
    let alertes = 0;
    for (let graine = 1; graine <= 300; graine += 1) {
      const h = hypothesesAleatoires(graine);
      const s = calculerScenariosPlan(h, {
        optimiste: { croissanceChiffreAffaires: 5, tauxMargeBrute: 2, chargesFixes: -5 },
        pessimiste: { croissanceChiffreAffaires: -5, tauxMargeBrute: -2, delaiClientsJours: 15 },
      });
      for (const r of [s.base, s.optimiste, s.pessimiste]) {
        verifierCoherence(r, h);
        expect(r.alertes.some((a) => a.code === "BILAN_DESEQUILIBRE")).toBe(false);
        alertes += r.alertes.length;
      }
    }
    // Les tirages couvrent aussi des situations dégradées.
    expect(alertes).toBeGreaterThan(0);
  });

  it("même graine, mêmes chiffres", () => {
    expect(calculerScenariosPlan(hypothesesAleatoires(42))).toEqual(
      calculerScenariosPlan(hypothesesAleatoires(42)),
    );
  });
});
