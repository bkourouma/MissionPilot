/**
 * Hypothèses du modèle financier (PLA-06) : saisie, valeurs par défaut,
 * normalisation et validation.
 *
 * Conventions :
 * - montants en entiers d'unités mineures de la devise du plan (XOF par
 *   défaut, 0 décimale) ; taux en points de pourcentage (25 pour 25 %) ;
 *   délais en jours sur une année commerciale de 360 jours ;
 * - une hypothèse annuelle s'écrit soit d'une seule valeur (appliquée chaque
 *   année), soit d'un tableau d'exactement `horizon` valeurs ;
 * - l'année 1 est le premier exercice prévisionnel ; l'année 0 désigne la
 *   situation d'ouverture (dernier bilan réel) ;
 * - TVA ignorée : tous les montants sont hors taxes.
 *
 * Toute hypothèse hors bornes est refusée (`ErreurPlan`), jamais corrigée en
 * silence.
 */
import { DEVISES, type Devise } from "../finance/monnaie";
import { ErreurPlan, type CodeErreurPlan } from "./erreurs";

/** Horizon du plan (DECISIONS.md, PLA-06) : 5 ans par défaut, de 3 à 5 ans. */
export const HORIZON_PLAN_DEFAUT = 5;
export const HORIZON_PLAN_MIN = 3;
export const HORIZON_PLAN_MAX = 5;

/** Année commerciale utilisée pour les délais du BFR. */
export const JOURS_PAR_AN_BFR = 360;

/** Valeurs de départ, à valider par un expert-comptable. */
export const DEVISE_PLAN_DEFAUT: Devise = "XOF";
/** Impôt sur les sociétés : taux de droit commun en Côte d'Ivoire. */
export const TAUX_IMPOT_SOCIETES_DEFAUT = 25;
/** Taux d'actualisation des flux libres (VAN). */
export const TAUX_ACTUALISATION_DEFAUT = 12;

/** Valeur unique appliquée chaque année, ou une valeur par année. */
export type ParAnnee = number | readonly number[];

export type ModeRemboursement = "annuites_constantes" | "amortissement_constant";

export interface CategorieEffectif {
  readonly libelle: string;
  /** Équivalents temps plein par année (décimaux admis). */
  readonly effectifs: ParAnnee;
  /** Salaire brut annuel d'un équivalent temps plein, en année 1. */
  readonly salaireAnnuelBrut: number;
  /** Charges sociales patronales, en points du salaire brut. */
  readonly tauxChargesSociales: number;
  /** Revalorisation annuelle des salaires à partir de l'année 2, en points. */
  readonly revalorisationAnnuelle?: number;
}

export interface InvestissementPlan {
  readonly libelle: string;
  /** Année d'acquisition, de 1 à l'horizon. */
  readonly annee: number;
  readonly montant: number;
  /** Durée d'amortissement linéaire en années. */
  readonly dureeAmortissement: number;
}

export interface EmpruntPlan {
  readonly libelle: string;
  /**
   * Année de déblocage, de 0 à l'horizon. 0 = emprunt déjà en cours à
   * l'ouverture : `montant` est alors le capital restant dû et `duree` la durée
   * restante.
   */
  readonly anneeDeblocage: number;
  readonly montant: number;
  /** Taux d'intérêt annuel en points. */
  readonly tauxAnnuel: number;
  /** Durée totale en années, différé compris. */
  readonly duree: number;
  /** Années de différé d'amortissement (intérêts seuls). */
  readonly differe?: number;
  readonly mode?: ModeRemboursement;
}

export interface AugmentationCapital {
  readonly annee: number;
  readonly montant: number;
}

/** Bilan d'ouverture (année 0) ; tout est nul par défaut (création). */
export interface BilanOuverture {
  readonly immobilisationsNettes?: number;
  /** Durée d'amortissement restante des immobilisations d'ouverture. */
  readonly dureeResiduelleImmobilisations?: number;
  readonly stocks?: number;
  readonly creancesClients?: number;
  /** Trésorerie nette (négative = concours bancaires courants). */
  readonly tresorerie?: number;
  readonly capital?: number;
  /** Réserves et report à nouveau, résultat du dernier exercice affecté. */
  readonly reserves?: number;
  readonly dettesFournisseurs?: number;
  /** Déficits fiscaux reportables à l'ouverture. */
  readonly deficitsReportables?: number;
}

export interface HypothesesPlan {
  readonly devise?: Devise;
  /** Millésime du premier exercice prévisionnel (ex. 2027). */
  readonly premierExercice: number;
  /** De 3 à 5 ans, 5 par défaut. */
  readonly horizon?: number;
  /** Chiffre d'affaires hors taxes du dernier exercice réel (année 0). */
  readonly chiffreAffairesReference: number;
  /** Croissance annuelle du chiffre d'affaires, en points, dès l'année 1. */
  readonly croissanceChiffreAffaires: ParAnnee;
  /** Taux de marge brute (CA − achats consommés) / CA, en points. */
  readonly tauxMargeBrute: ParAnnee;
  /** Charges externes variables, en points du chiffre d'affaires. */
  readonly tauxChargesVariables?: ParAnnee;
  /** Charges externes fixes annuelles (loyers, services, impôts et taxes). */
  readonly chargesFixes?: ParAnnee;
  readonly effectifs?: readonly CategorieEffectif[];
  readonly investissements?: readonly InvestissementPlan[];
  readonly emprunts?: readonly EmpruntPlan[];
  readonly augmentationsCapital?: readonly AugmentationCapital[];
  /** Délai de paiement des clients, en jours de chiffre d'affaires. */
  readonly delaiClientsJours?: ParAnnee;
  /** Délai de paiement des fournisseurs, en jours d'achats et charges externes. */
  readonly delaiFournisseursJours?: ParAnnee;
  /** Rotation des stocks, en jours d'achats consommés. */
  readonly stocksJours?: ParAnnee;
  readonly tauxImpotSocietes?: number;
  /** Part du résultat positif de l'exercice N distribuée en N+1, en points. */
  readonly tauxDistributionDividendes?: number;
  /** Taux d'actualisation des flux libres, en points. */
  readonly tauxActualisation?: number;
  readonly bilanOuverture?: BilanOuverture;
}

/** Catégorie d'effectif normalisée : une valeur par année. */
export interface CategorieEffectifNormalisee {
  readonly libelle: string;
  readonly effectifs: readonly number[];
  readonly salaireAnnuelBrut: number;
  readonly tauxChargesSociales: number;
  readonly revalorisationAnnuelle: number;
}

export interface EmpruntNormalise {
  readonly libelle: string;
  readonly anneeDeblocage: number;
  readonly montant: number;
  readonly tauxAnnuel: number;
  readonly duree: number;
  readonly differe: number;
  readonly mode: ModeRemboursement;
}

export interface BilanOuvertureNormalise {
  readonly immobilisationsNettes: number;
  readonly dureeResiduelleImmobilisations: number;
  readonly stocks: number;
  readonly creancesClients: number;
  readonly tresorerie: number;
  readonly capital: number;
  readonly reserves: number;
  readonly dettesFournisseurs: number;
  readonly deficitsReportables: number;
}

/** Hypothèses complètes, une valeur par année, prêtes au calcul. */
export interface HypothesesNormalisees {
  readonly devise: Devise;
  readonly premierExercice: number;
  readonly horizon: number;
  readonly chiffreAffairesReference: number;
  readonly croissanceChiffreAffaires: readonly number[];
  readonly tauxMargeBrute: readonly number[];
  readonly tauxChargesVariables: readonly number[];
  readonly chargesFixes: readonly number[];
  readonly effectifs: readonly CategorieEffectifNormalisee[];
  readonly investissements: readonly InvestissementPlan[];
  readonly emprunts: readonly EmpruntNormalise[];
  readonly augmentationsCapital: readonly AugmentationCapital[];
  readonly delaiClientsJours: readonly number[];
  readonly delaiFournisseursJours: readonly number[];
  readonly stocksJours: readonly number[];
  readonly tauxImpotSocietes: number;
  readonly tauxDistributionDividendes: number;
  readonly tauxActualisation: number;
  readonly bilanOuverture: BilanOuvertureNormalise;
}

/** Valide l'horizon : entier de 3 à 5, 5 par défaut. */
export function validerHorizon(horizon: number | undefined): number {
  const h = horizon ?? HORIZON_PLAN_DEFAUT;
  if (!Number.isInteger(h) || h < HORIZON_PLAN_MIN || h > HORIZON_PLAN_MAX) {
    throw new ErreurPlan(
      "HORIZON_INVALIDE",
      `L'horizon du plan est un nombre entier d'années de ${HORIZON_PLAN_MIN} à ${HORIZON_PLAN_MAX} (reçu ${h}).`,
      "horizon",
    );
  }
  return h;
}

function parAnnee(valeur: ParAnnee, horizon: number, chemin: string): number[] {
  if (typeof valeur === "number") return Array.from({ length: horizon }, () => valeur);
  if (valeur.length !== horizon) {
    throw new ErreurPlan(
      "HYPOTHESE_INVALIDE",
      `${chemin} attend une valeur ou exactement ${horizon} valeurs (reçu ${valeur.length}).`,
      chemin,
    );
  }
  return [...valeur];
}

/**
 * Complète les valeurs par défaut et développe les hypothèses annuelles, puis
 * valide l'ensemble (`validerHypotheses`).
 */
export function normaliserHypotheses(h: HypothesesPlan): HypothesesNormalisees {
  const horizon = validerHorizon(h.horizon);
  const o = h.bilanOuverture ?? {};
  const normalisees: HypothesesNormalisees = {
    devise: h.devise ?? DEVISE_PLAN_DEFAUT,
    premierExercice: h.premierExercice,
    horizon,
    chiffreAffairesReference: h.chiffreAffairesReference,
    croissanceChiffreAffaires: parAnnee(
      h.croissanceChiffreAffaires,
      horizon,
      "croissanceChiffreAffaires",
    ),
    tauxMargeBrute: parAnnee(h.tauxMargeBrute, horizon, "tauxMargeBrute"),
    tauxChargesVariables: parAnnee(h.tauxChargesVariables ?? 0, horizon, "tauxChargesVariables"),
    chargesFixes: parAnnee(h.chargesFixes ?? 0, horizon, "chargesFixes"),
    effectifs: (h.effectifs ?? []).map((c, i) => ({
      libelle: c.libelle,
      effectifs: parAnnee(c.effectifs, horizon, `effectifs[${i}].effectifs`),
      salaireAnnuelBrut: c.salaireAnnuelBrut,
      tauxChargesSociales: c.tauxChargesSociales,
      revalorisationAnnuelle: c.revalorisationAnnuelle ?? 0,
    })),
    investissements: [...(h.investissements ?? [])],
    emprunts: (h.emprunts ?? []).map(normaliserEmprunt),
    augmentationsCapital: [...(h.augmentationsCapital ?? [])],
    delaiClientsJours: parAnnee(h.delaiClientsJours ?? 0, horizon, "delaiClientsJours"),
    delaiFournisseursJours: parAnnee(
      h.delaiFournisseursJours ?? 0,
      horizon,
      "delaiFournisseursJours",
    ),
    stocksJours: parAnnee(h.stocksJours ?? 0, horizon, "stocksJours"),
    tauxImpotSocietes: h.tauxImpotSocietes ?? TAUX_IMPOT_SOCIETES_DEFAUT,
    tauxDistributionDividendes: h.tauxDistributionDividendes ?? 0,
    tauxActualisation: h.tauxActualisation ?? TAUX_ACTUALISATION_DEFAUT,
    bilanOuverture: {
      immobilisationsNettes: o.immobilisationsNettes ?? 0,
      dureeResiduelleImmobilisations: o.dureeResiduelleImmobilisations ?? 0,
      stocks: o.stocks ?? 0,
      creancesClients: o.creancesClients ?? 0,
      tresorerie: o.tresorerie ?? 0,
      capital: o.capital ?? 0,
      reserves: o.reserves ?? 0,
      dettesFournisseurs: o.dettesFournisseurs ?? 0,
      deficitsReportables: o.deficitsReportables ?? 0,
    },
  };
  validerHypotheses(normalisees);
  return normalisees;
}

// --- Validation -------------------------------------------------------------

function invalide(chemin: string, attendu: string, recu: unknown): never {
  throw new ErreurPlan(
    "HYPOTHESE_INVALIDE",
    `${chemin} : ${attendu} attendu (reçu ${String(recu)}).`,
    chemin,
  );
}

/** Nombre fini dans [min, max] ; `minExclu` exclut la borne basse. */
function taux(chemin: string, x: number, min: number, max: number, minExclu = false): void {
  const borneBasse = minExclu ? x > min : x >= min;
  if (!Number.isFinite(x) || !borneBasse || x > max) {
    invalide(chemin, `un nombre ${minExclu ? ">" : "≥"} ${min} et ≤ ${max}`, x);
  }
}

function entierBorne(
  chemin: string,
  x: number,
  min: number,
  max: number,
  code: CodeErreurPlan = "HYPOTHESE_INVALIDE",
): void {
  if (!Number.isInteger(x) || x < min || x > max) {
    throw new ErreurPlan(
      code,
      `${chemin} : entier de ${min} à ${max} attendu (reçu ${x}).`,
      chemin,
    );
  }
}

/** Montant en unités mineures : entier sûr, positif ou nul sauf `signe`. */
function montantValide(chemin: string, x: number, positif: "positif" | "strict" | "signe"): void {
  const ok =
    Number.isSafeInteger(x) && (positif === "signe" || (positif === "strict" ? x > 0 : x >= 0));
  if (!ok) {
    const attendu =
      positif === "signe"
        ? "un montant entier en unités mineures"
        : positif === "strict"
          ? "un montant entier strictement positif en unités mineures"
          : "un montant entier positif ou nul en unités mineures";
    throw new ErreurPlan("MONTANT_INVALIDE", `${chemin} : ${attendu} (reçu ${x}).`, chemin);
  }
}

function libelleValide(chemin: string, libelle: string): void {
  if (typeof libelle !== "string" || libelle.trim() === "") {
    invalide(chemin, "un libellé non vide", libelle);
  }
}

function chaqueAnnee(
  valeurs: readonly number[],
  chemin: string,
  verifier: (chemin: string, x: number) => void,
): void {
  valeurs.forEach((x, i) => verifier(`${chemin}[${i}]`, x));
}

/** Valide des hypothèses normalisées (utilisé aussi après l'écart d'un scénario). */
export function validerHypotheses(h: HypothesesNormalisees): void {
  const n = h.horizon;
  if (!DEVISES.includes(h.devise))
    invalide("devise", `une devise parmi ${DEVISES.join(", ")}`, h.devise);
  entierBorne("premierExercice", h.premierExercice, 1900, 2200);
  montantValide("chiffreAffairesReference", h.chiffreAffairesReference, "positif");
  chaqueAnnee(h.croissanceChiffreAffaires, "croissanceChiffreAffaires", (c, x) =>
    taux(c, x, -100, 1000, true),
  );
  chaqueAnnee(h.tauxMargeBrute, "tauxMargeBrute", (c, x) => taux(c, x, 0, 100));
  chaqueAnnee(h.tauxChargesVariables, "tauxChargesVariables", (c, x) => taux(c, x, 0, 100));
  chaqueAnnee(h.chargesFixes, "chargesFixes", (c, x) => montantValide(c, x, "positif"));
  h.effectifs.forEach((cat, i) => {
    const c = `effectifs[${i}]`;
    libelleValide(`${c}.libelle`, cat.libelle);
    chaqueAnnee(cat.effectifs, `${c}.effectifs`, (ch, x) => taux(ch, x, 0, 1_000_000));
    montantValide(`${c}.salaireAnnuelBrut`, cat.salaireAnnuelBrut, "positif");
    taux(`${c}.tauxChargesSociales`, cat.tauxChargesSociales, 0, 100);
    taux(`${c}.revalorisationAnnuelle`, cat.revalorisationAnnuelle, -100, 100, true);
  });
  h.investissements.forEach((inv, i) => {
    const c = `investissements[${i}]`;
    libelleValide(`${c}.libelle`, inv.libelle);
    entierBorne(`${c}.annee`, inv.annee, 1, n, "INVESTISSEMENT_INVALIDE");
    montantValide(`${c}.montant`, inv.montant, "strict");
    entierBorne(
      `${c}.dureeAmortissement`,
      inv.dureeAmortissement,
      1,
      100,
      "INVESTISSEMENT_INVALIDE",
    );
  });
  h.emprunts.forEach((e, i) => validerEmprunt(e, `emprunts[${i}]`, n));
  h.augmentationsCapital.forEach((a, i) => {
    entierBorne(`augmentationsCapital[${i}].annee`, a.annee, 1, n);
    montantValide(`augmentationsCapital[${i}].montant`, a.montant, "strict");
  });
  chaqueAnnee(h.delaiClientsJours, "delaiClientsJours", (c, x) => taux(c, x, 0, 720));
  chaqueAnnee(h.delaiFournisseursJours, "delaiFournisseursJours", (c, x) => taux(c, x, 0, 720));
  chaqueAnnee(h.stocksJours, "stocksJours", (c, x) => taux(c, x, 0, 720));
  taux("tauxImpotSocietes", h.tauxImpotSocietes, 0, 100);
  taux("tauxDistributionDividendes", h.tauxDistributionDividendes, 0, 100);
  taux("tauxActualisation", h.tauxActualisation, -100, 1000, true);
  validerBilanOuverture(h);
}

/** Complète les valeurs par défaut d'un emprunt (annuités constantes, sans différé). */
export function normaliserEmprunt(e: EmpruntPlan): EmpruntNormalise {
  return {
    libelle: e.libelle,
    anneeDeblocage: e.anneeDeblocage,
    montant: e.montant,
    tauxAnnuel: e.tauxAnnuel,
    duree: e.duree,
    differe: e.differe ?? 0,
    mode: e.mode ?? "annuites_constantes",
  };
}

/** Valide un emprunt ; `anneeMax` borne l'année de déblocage (l'horizon). */
export function validerEmprunt(e: EmpruntNormalise, c: string, anneeMax: number): void {
  libelleValide(`${c}.libelle`, e.libelle);
  entierBorne(`${c}.anneeDeblocage`, e.anneeDeblocage, 0, anneeMax, "EMPRUNT_INVALIDE");
  montantValide(`${c}.montant`, e.montant, "strict");
  taux(`${c}.tauxAnnuel`, e.tauxAnnuel, 0, 100);
  entierBorne(`${c}.duree`, e.duree, 1, 50, "EMPRUNT_INVALIDE");
  entierBorne(`${c}.differe`, e.differe, 0, e.duree - 1, "EMPRUNT_INVALIDE");
  if (e.mode !== "annuites_constantes" && e.mode !== "amortissement_constant") {
    throw new ErreurPlan("EMPRUNT_INVALIDE", `${c}.mode inconnu (${String(e.mode)}).`, `${c}.mode`);
  }
}

function validerBilanOuverture(h: HypothesesNormalisees): void {
  const o = h.bilanOuverture;
  const c = "bilanOuverture";
  montantValide(`${c}.immobilisationsNettes`, o.immobilisationsNettes, "positif");
  montantValide(`${c}.stocks`, o.stocks, "positif");
  montantValide(`${c}.creancesClients`, o.creancesClients, "positif");
  montantValide(`${c}.tresorerie`, o.tresorerie, "signe");
  montantValide(`${c}.capital`, o.capital, "positif");
  montantValide(`${c}.reserves`, o.reserves, "signe");
  montantValide(`${c}.dettesFournisseurs`, o.dettesFournisseurs, "positif");
  montantValide(`${c}.deficitsReportables`, o.deficitsReportables, "positif");
  if (o.immobilisationsNettes > 0) {
    entierBorne(`${c}.dureeResiduelleImmobilisations`, o.dureeResiduelleImmobilisations, 1, 100);
  }
  const dettesFinancieres = h.emprunts
    .filter((e) => e.anneeDeblocage === 0)
    .reduce((s, e) => s + BigInt(e.montant), 0n);
  const actif =
    BigInt(o.immobilisationsNettes) +
    BigInt(o.stocks) +
    BigInt(o.creancesClients) +
    BigInt(o.tresorerie);
  const passif =
    BigInt(o.capital) + BigInt(o.reserves) + dettesFinancieres + BigInt(o.dettesFournisseurs);
  if (actif !== passif) {
    throw new ErreurPlan(
      "BILAN_OUVERTURE_DESEQUILIBRE",
      `Bilan d'ouverture déséquilibré : actif net ${actif} ≠ passif ${passif} ` +
        "(immobilisations + stocks + créances + trésorerie = capital + réserves + emprunts en cours + fournisseurs).",
      c,
    );
  }
}
