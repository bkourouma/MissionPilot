/**
 * Modèle financier prévisionnel (PLA-06, PLA-07) : compte de résultat, bilan
 * et tableau des flux de trésorerie au format SYSCOHADA révisé simplifié,
 * indicateurs et alertes. Fonction pure et déterministe : mêmes hypothèses,
 * mêmes chiffres, au franc près.
 *
 * Règles de calcul (exercice t, de 1 à l'horizon) :
 * - CA_t = CA_0 × Π(1 + g_k), produit exact, arrondi une fois ;
 * - achats consommés = CA × (1 − taux de marge brute) ; charges externes =
 *   CA × taux de charges variables + charges fixes ;
 * - personnel = Σ ETP × salaire × (1 + revalorisation)^(t−1) × (1 + charges
 *   sociales), arrondi par catégorie ;
 * - amortissement linéaire en année pleine dès l'année d'acquisition (pas de
 *   prorata temporis dans un modèle annuel) ; part tronquée, le reste sur la
 *   dernière annuité ; immobilisations d'ouverture sur leur durée résiduelle ;
 * - intérêts et remboursements selon l'échéancier (`emprunts.ts`) ;
 * - impôt sur les sociétés au taux du plan sur le résultat des activités
 *   ordinaires positif, après imputation des déficits reportables (sans
 *   limite de durée dans l'horizon) ; payé dans l'exercice (pas de dette
 *   fiscale de clôture) ; pas d'impôt minimum forfaitaire ;
 * - BFR = stocks (jours d'achats consommés) + créances clients (jours de CA)
 *   − fournisseurs (jours d'achats et charges externes), base 360 jours ;
 * - dividendes : part du résultat positif de N versée en N+1 ;
 * - trésorerie nette = trésorerie d'ouverture + Σ variations du tableau des
 *   flux ; négative, elle figure au passif (concours bancaires), sans frais
 *   financiers de découvert (pas de calcul circulaire) ;
 * - pas d'opération hors activités ordinaires (HAO), ni cession, ni provision.
 *
 * Le bilan est reconstruit poste par poste, indépendamment de la trésorerie
 * issue du tableau des flux : le contrôle actif = passif vérifie donc la
 * cohérence des trois états.
 */
import { diviserArrondi } from "../finance/calcul-exact";
import type { Devise } from "../finance/monnaie";
import { detecterAlertesPlan, type AlertePlan } from "./alertes";
import { valeurActuelleNette, tauxRendementInterne } from "./actualisation";
import { construireEcheancier, echeancesExactes, type EcheancierEmprunt } from "./emprunts";
import {
  UN,
  appliquer,
  fraction,
  maximum,
  minimum,
  pourcent,
  produit,
  puissance,
  ratioEntiers,
  unPlus,
  versEntier,
} from "./exact";
import {
  JOURS_PAR_AN_BFR,
  normaliserHypotheses,
  type HypothesesNormalisees,
  type HypothesesPlan,
} from "./hypotheses";

/** Compte de résultat (soldes significatifs de gestion SYSCOHADA). */
export interface CompteResultatPrevisionnel {
  readonly chiffreAffaires: number;
  readonly achatsConsommes: number;
  readonly margeBrute: number;
  readonly chargesExternesVariables: number;
  readonly chargesExternesFixes: number;
  readonly valeurAjoutee: number;
  readonly chargesPersonnel: number;
  readonly excedentBrutExploitation: number;
  readonly dotationsAmortissements: number;
  readonly resultatExploitation: number;
  readonly fraisFinanciers: number;
  readonly resultatFinancier: number;
  readonly resultatActivitesOrdinaires: number;
  readonly impotSurResultat: number;
  readonly resultatNet: number;
}

/** Bilan de clôture simplifié. */
export interface BilanPrevisionnel {
  readonly immobilisationsNettes: number;
  readonly stocks: number;
  readonly creancesClients: number;
  readonly tresorerieActif: number;
  readonly totalActif: number;
  readonly capital: number;
  readonly reserves: number;
  readonly resultatExercice: number;
  readonly capitauxPropres: number;
  readonly dettesFinancieres: number;
  readonly dettesFournisseurs: number;
  readonly tresoreriePassif: number;
  readonly totalPassif: number;
  /** Trésorerie-actif − trésorerie-passif. */
  readonly tresorerieNette: number;
  readonly besoinFondsRoulement: number;
}

/** Tableau des flux de trésorerie (TFT SYSCOHADA révisé, méthode indirecte). */
export interface FluxTresoreriePrevisionnel {
  readonly tresorerieOuverture: number;
  readonly capaciteAutofinancement: number;
  /** Augmentation du BFR (une hausse consomme de la trésorerie). */
  readonly variationBesoinFondsRoulement: number;
  readonly fluxActivitesOperationnelles: number;
  readonly acquisitionsImmobilisations: number;
  readonly fluxInvestissement: number;
  readonly augmentationsCapital: number;
  readonly dividendesVerses: number;
  readonly fluxCapitauxPropres: number;
  readonly empruntsNouveaux: number;
  readonly remboursementsEmprunts: number;
  readonly fluxCapitauxEtrangers: number;
  readonly fluxFinancement: number;
  readonly variationTresorerie: number;
  readonly tresorerieCloture: number;
}

export interface IndicateursExercice {
  readonly excedentBrutExploitation: number;
  readonly resultatNet: number;
  readonly capaciteAutofinancement: number;
  readonly tresorerieFinExercice: number;
  /** Chiffre d'affaires qui couvre les charges fixes ; `null` si la marge sur coûts variables est ≤ 0. */
  readonly pointMort: number | null;
  /** Date du point mort en jours d'une année de 360 jours (> 360 : non atteint). */
  readonly pointMortJours: number | null;
  /** Taux de marge sur coûts variables (fraction à 4 décimales). */
  readonly tauxMargeCoutsVariables: number | null;
  /** Impôt calculé sur le résultat d'exploitation, sans dette ni déficit. */
  readonly impotNormatif: number;
  /** EBE − impôt normatif − variation du BFR − investissements. */
  readonly fluxLibre: number;
  /** Dettes financières − trésorerie nette. */
  readonly endettementNet: number;
  /** Dettes financières / capitaux propres ; `null` si capitaux propres ≤ 0. */
  readonly ratioEndettement: number | null;
  /** Dettes financières / CAF, en années ; `null` si CAF ≤ 0. */
  readonly capaciteRemboursement: number | null;
  /** Capitaux propres / total du bilan. */
  readonly autonomieFinanciere: number | null;
  /** (EBE − impôt) / (intérêts + remboursements) ; `null` sans service de la dette. */
  readonly couvertureServiceDette: number | null;
}

export interface ControleEquilibre {
  readonly totalActif: number;
  readonly totalPassif: number;
  readonly ecart: number;
  readonly equilibre: boolean;
}

export interface ExercicePrevisionnel {
  /** Année du plan, de 1 à l'horizon. */
  readonly annee: number;
  /** Millésime de l'exercice. */
  readonly exercice: number;
  readonly compteResultat: CompteResultatPrevisionnel;
  readonly bilan: BilanPrevisionnel;
  readonly fluxTresorerie: FluxTresoreriePrevisionnel;
  readonly indicateurs: IndicateursExercice;
  readonly controle: ControleEquilibre;
}

export interface SynthesePlan {
  readonly chiffreAffairesFinal: number;
  readonly resultatNetCumule: number;
  readonly capaciteAutofinancementCumulee: number;
  readonly tresorerieFinale: number;
  readonly fluxLibres: readonly number[];
  readonly tauxActualisation: number;
  /** VAN des flux libres des années 1 à l'horizon. */
  readonly valeurActuelleNette: number;
  /** TRI des flux libres (fraction à 4 décimales), `null` s'il n'est pas défini. */
  readonly tauxRendementInterne: number | null;
}

export interface ResultatPlanFinancier {
  readonly devise: Devise;
  readonly horizon: number;
  readonly premierExercice: number;
  readonly hypotheses: HypothesesNormalisees;
  readonly annees: readonly ExercicePrevisionnel[];
  readonly echeanciers: readonly EcheancierEmprunt[];
  readonly synthese: SynthesePlan;
  /** Vrai si actif = passif à chaque clôture. */
  readonly equilibre: boolean;
  readonly alertes: readonly AlertePlan[];
}

/**
 * Références indicatives des postes dans les états SYSCOHADA révisé (à
 * confirmer par un expert-comptable avant tout export normé).
 */
export const REFERENCES_SYSCOHADA = {
  compteResultat: {
    chiffreAffaires: "XB",
    valeurAjoutee: "XC",
    excedentBrutExploitation: "XD",
    resultatExploitation: "XE",
    resultatFinancier: "XF",
    resultatActivitesOrdinaires: "XG",
    impotSurResultat: "RS",
    resultatNet: "XI",
  },
  bilan: {
    immobilisationsNettes: "AZ",
    stocks: "BB",
    creancesClients: "BI",
    tresorerieActif: "BT",
    totalActif: "BZ",
    capital: "CA",
    resultatExercice: "CJ",
    capitauxPropres: "CP",
    dettesFinancieres: "DD",
    dettesFournisseurs: "DJ",
    tresoreriePassif: "DT",
    totalPassif: "DZ",
  },
  fluxTresorerie: {
    tresorerieOuverture: "ZA",
    capaciteAutofinancement: "FA",
    fluxActivitesOperationnelles: "ZB",
    fluxInvestissement: "ZC",
    fluxCapitauxPropres: "ZD",
    fluxCapitauxEtrangers: "ZE",
    fluxFinancement: "ZF",
    variationTresorerie: "ZG",
    tresorerieCloture: "ZH",
  },
} as const;

/** Part de l'annuité `rang` (1..duree) d'un amortissement linéaire sans perte. */
function annuiteAmortissement(valeur: bigint, duree: number, rang: number): bigint {
  if (rang < 1 || rang > duree) return 0n;
  const base = valeur / BigInt(duree);
  return rang === duree ? valeur - base * BigInt(duree - 1) : base;
}

/** Fraction « jours / 360 ». */
function jours(nombre: number) {
  const r = fraction(nombre);
  return { num: r.num, den: r.den * BigInt(JOURS_PAR_AN_BFR) };
}

/** Calcule le modèle financier à partir des hypothèses saisies. */
export function calculerPlanFinancier(hypotheses: HypothesesPlan): ResultatPlanFinancier {
  return calculerDepuisNormalisees(normaliserHypotheses(hypotheses));
}

/** Calcule le modèle à partir d'hypothèses déjà normalisées et validées. */
export function calculerDepuisNormalisees(h: HypothesesNormalisees): ResultatPlanFinancier {
  const o = h.bilanOuverture;
  const prets = h.emprunts.map((e) => ({ e, lignes: echeancesExactes(e) }));
  const caReference = BigInt(h.chiffreAffairesReference);
  const immoOuverture = BigInt(o.immobilisationsNettes);
  const tauxIS = pourcent(h.tauxImpotSocietes);
  const tauxDistribution = pourcent(h.tauxDistributionDividendes);

  let facteurCA = UN;
  let bfrPrecedent = BigInt(o.stocks) + BigInt(o.creancesClients) - BigInt(o.dettesFournisseurs);
  let tresorerie = BigInt(o.tresorerie);
  let immobilisations = immoOuverture;
  let capital = BigInt(o.capital);
  let reserves = BigInt(o.reserves);
  let resultatPrecedent = 0n;
  let deficits = BigInt(o.deficitsReportables);

  const annees: ExercicePrevisionnel[] = [];
  for (let t = 1; t <= h.horizon; t += 1) {
    const i = t - 1;
    // --- Compte de résultat
    facteurCA = produit(facteurCA, unPlus(h.croissanceChiffreAffaires[i] as number));
    const ca = appliquer(caReference, facteurCA);
    const marge = pourcent(h.tauxMargeBrute[i] as number);
    const achats = appliquer(ca, { num: marge.den - marge.num, den: marge.den });
    const variables = appliquer(ca, pourcent(h.tauxChargesVariables[i] as number));
    const fixes = BigInt(h.chargesFixes[i] as number);
    const externes = variables + fixes;
    const valeurAjoutee = ca - achats - externes;
    const personnel = h.effectifs.reduce(
      (s, c) =>
        s +
        appliquer(
          BigInt(c.salaireAnnuelBrut),
          produit(
            fraction(c.effectifs[i] as number),
            puissance(unPlus(c.revalorisationAnnuelle), t - 1),
            unPlus(c.tauxChargesSociales),
          ),
        ),
      0n,
    );
    const ebe = valeurAjoutee - personnel;
    const dotations =
      annuiteAmortissement(immoOuverture, o.dureeResiduelleImmobilisations, t) +
      h.investissements.reduce(
        (s, inv) =>
          s + annuiteAmortissement(BigInt(inv.montant), inv.dureeAmortissement, t - inv.annee + 1),
        0n,
      );
    const resultatExploitation = ebe - dotations;
    let interets = 0n;
    let remboursements = 0n;
    let empruntsNouveaux = 0n;
    let dettesFinancieres = 0n;
    for (const { e, lignes } of prets) {
      if (e.anneeDeblocage === t) empruntsNouveaux += BigInt(e.montant);
      if (e.anneeDeblocage > t) continue;
      let rembourseCumule = 0n;
      for (const l of lignes) {
        if (l.annee === t) {
          interets += l.interets;
          remboursements += l.amortissement;
        }
        if (l.annee <= t) rembourseCumule += l.amortissement;
      }
      dettesFinancieres += BigInt(e.montant) - rembourseCumule;
    }
    const rao = resultatExploitation - interets;
    let impot = 0n;
    if (rao <= 0n) {
      deficits -= rao;
    } else {
      const imputation = minimum(deficits, rao);
      deficits -= imputation;
      impot = appliquer(rao - imputation, tauxIS);
    }
    const resultatNet = rao - impot;

    // --- Besoin en fonds de roulement
    const stocks = appliquer(achats, jours(h.stocksJours[i] as number));
    const creances = appliquer(ca, jours(h.delaiClientsJours[i] as number));
    const fournisseurs = appliquer(achats + externes, jours(h.delaiFournisseursJours[i] as number));
    const bfr = stocks + creances - fournisseurs;
    const variationBfr = bfr - bfrPrecedent;

    // --- Tableau des flux de trésorerie
    const acquisitions = h.investissements
      .filter((inv) => inv.annee === t)
      .reduce((s, inv) => s + BigInt(inv.montant), 0n);
    const apports = h.augmentationsCapital
      .filter((a) => a.annee === t)
      .reduce((s, a) => s + BigInt(a.montant), 0n);
    const dividendes = resultatPrecedent > 0n ? appliquer(resultatPrecedent, tauxDistribution) : 0n;
    const caf = resultatNet + dotations;
    const fluxOperationnels = caf - variationBfr;
    const fluxInvestissement = -acquisitions;
    const fluxCapitauxPropres = apports - dividendes;
    const fluxCapitauxEtrangers = empruntsNouveaux - remboursements;
    const fluxFinancement = fluxCapitauxPropres + fluxCapitauxEtrangers;
    const variationTresorerie = fluxOperationnels + fluxInvestissement + fluxFinancement;
    const tresorerieOuverture = tresorerie;
    tresorerie += variationTresorerie;

    // --- Bilan, reconstruit poste par poste
    immobilisations += acquisitions - dotations;
    capital += apports;
    reserves += resultatPrecedent - dividendes;
    const capitauxPropres = capital + reserves + resultatNet;
    const tresorerieActif = maximum(tresorerie, 0n);
    const tresoreriePassif = maximum(-tresorerie, 0n);
    const totalActif = immobilisations + stocks + creances + tresorerieActif;
    const totalPassif = capitauxPropres + dettesFinancieres + fournisseurs + tresoreriePassif;

    // --- Indicateurs
    const impotNormatif = resultatExploitation > 0n ? appliquer(resultatExploitation, tauxIS) : 0n;
    const margeCoutsVariables = ca - achats - variables;
    const chargesFixesTotales = fixes + personnel + dotations + interets;
    const pointMortAtteignable = margeCoutsVariables > 0n;

    annees.push({
      annee: t,
      exercice: h.premierExercice + i,
      compteResultat: {
        chiffreAffaires: versEntier(ca),
        achatsConsommes: versEntier(achats),
        margeBrute: versEntier(ca - achats),
        chargesExternesVariables: versEntier(variables),
        chargesExternesFixes: versEntier(fixes),
        valeurAjoutee: versEntier(valeurAjoutee),
        chargesPersonnel: versEntier(personnel),
        excedentBrutExploitation: versEntier(ebe),
        dotationsAmortissements: versEntier(dotations),
        resultatExploitation: versEntier(resultatExploitation),
        fraisFinanciers: versEntier(interets),
        resultatFinancier: versEntier(-interets),
        resultatActivitesOrdinaires: versEntier(rao),
        impotSurResultat: versEntier(impot),
        resultatNet: versEntier(resultatNet),
      },
      bilan: {
        immobilisationsNettes: versEntier(immobilisations),
        stocks: versEntier(stocks),
        creancesClients: versEntier(creances),
        tresorerieActif: versEntier(tresorerieActif),
        totalActif: versEntier(totalActif),
        capital: versEntier(capital),
        reserves: versEntier(reserves),
        resultatExercice: versEntier(resultatNet),
        capitauxPropres: versEntier(capitauxPropres),
        dettesFinancieres: versEntier(dettesFinancieres),
        dettesFournisseurs: versEntier(fournisseurs),
        tresoreriePassif: versEntier(tresoreriePassif),
        totalPassif: versEntier(totalPassif),
        tresorerieNette: versEntier(tresorerie),
        besoinFondsRoulement: versEntier(bfr),
      },
      fluxTresorerie: {
        tresorerieOuverture: versEntier(tresorerieOuverture),
        capaciteAutofinancement: versEntier(caf),
        variationBesoinFondsRoulement: versEntier(variationBfr),
        fluxActivitesOperationnelles: versEntier(fluxOperationnels),
        acquisitionsImmobilisations: versEntier(acquisitions),
        fluxInvestissement: versEntier(fluxInvestissement),
        augmentationsCapital: versEntier(apports),
        dividendesVerses: versEntier(dividendes),
        fluxCapitauxPropres: versEntier(fluxCapitauxPropres),
        empruntsNouveaux: versEntier(empruntsNouveaux),
        remboursementsEmprunts: versEntier(remboursements),
        fluxCapitauxEtrangers: versEntier(fluxCapitauxEtrangers),
        fluxFinancement: versEntier(fluxFinancement),
        variationTresorerie: versEntier(variationTresorerie),
        tresorerieCloture: versEntier(tresorerie),
      },
      indicateurs: {
        excedentBrutExploitation: versEntier(ebe),
        resultatNet: versEntier(resultatNet),
        capaciteAutofinancement: versEntier(caf),
        tresorerieFinExercice: versEntier(tresorerie),
        pointMort: pointMortAtteignable
          ? versEntier(diviserArrondi(chargesFixesTotales * ca, margeCoutsVariables))
          : null,
        pointMortJours: pointMortAtteignable
          ? versEntier(
              diviserArrondi(chargesFixesTotales * BigInt(JOURS_PAR_AN_BFR), margeCoutsVariables),
            )
          : null,
        tauxMargeCoutsVariables: ratioEntiers(margeCoutsVariables, ca),
        impotNormatif: versEntier(impotNormatif),
        fluxLibre: versEntier(ebe - impotNormatif - variationBfr - acquisitions),
        endettementNet: versEntier(dettesFinancieres - tresorerie),
        ratioEndettement:
          capitauxPropres > 0n ? ratioEntiers(dettesFinancieres, capitauxPropres) : null,
        capaciteRemboursement: caf > 0n ? ratioEntiers(dettesFinancieres, caf) : null,
        autonomieFinanciere: ratioEntiers(capitauxPropres, totalPassif),
        couvertureServiceDette: ratioEntiers(ebe - impot, interets + remboursements),
      },
      controle: {
        totalActif: versEntier(totalActif),
        totalPassif: versEntier(totalPassif),
        ecart: versEntier(totalActif - totalPassif),
        equilibre: totalActif === totalPassif,
      },
    });

    bfrPrecedent = bfr;
    resultatPrecedent = resultatNet;
  }

  const fluxLibres = annees.map((a) => a.indicateurs.fluxLibre);
  const derniere = annees[annees.length - 1] as ExercicePrevisionnel;
  return {
    devise: h.devise,
    horizon: h.horizon,
    premierExercice: h.premierExercice,
    hypotheses: h,
    annees,
    echeanciers: h.emprunts.map(construireEcheancier),
    synthese: {
      chiffreAffairesFinal: derniere.compteResultat.chiffreAffaires,
      resultatNetCumule: versEntier(
        annees.reduce((s, a) => s + BigInt(a.compteResultat.resultatNet), 0n),
      ),
      capaciteAutofinancementCumulee: versEntier(
        annees.reduce((s, a) => s + BigInt(a.indicateurs.capaciteAutofinancement), 0n),
      ),
      tresorerieFinale: derniere.bilan.tresorerieNette,
      fluxLibres,
      tauxActualisation: h.tauxActualisation,
      valeurActuelleNette: valeurActuelleNette(fluxLibres, h.tauxActualisation, 1),
      tauxRendementInterne: tauxRendementInterne(fluxLibres),
    },
    equilibre: annees.every((a) => a.controle.equilibre),
    alertes: detecterAlertesPlan(annees),
  };
}
