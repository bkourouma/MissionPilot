/**
 * Bancabilité du plan (PLA-17) : ratios bancaires et plan de financement,
 * calculés UNIQUEMENT à partir des exercices d'un modèle financier déjà
 * calculé par le moteur (`calculerPlanFinancier`), sans nouvelle hypothèse.
 *
 * Ratios (entiers ; « pb » = points de base, 10 000 = 1) par exercice :
 * - couverture du service de la dette (DSCR) = (EBE − impôt sur le
 *   résultat) / (frais financiers + remboursements d'emprunts) ;
 * - endettement (gearing) = dettes financières / capitaux propres ;
 * - dette nette / EBE = (dettes financières − trésorerie nette) / EBE ;
 * - capacité de remboursement = dettes financières / CAF (en années, pb) ;
 * - BFR en jours de chiffre d'affaires = BFR × 360 / CA (jours entiers).
 * Divisions exactes en entiers, arrondi demi s'éloignant de zéro.
 *
 * Seuils bancaires indicatifs (`SEUILS_BANCABILITE_DEFAUT`, à calibrer avec
 * les banques partenaires) ; un ratio non calculable n'est jamais remplacé
 * par zéro : il est « sans objet » (pas de dette), « non calculable » (CA
 * nul) ou « hors seuil » quand le dénominateur nul ou négatif est lui-même un
 * signal d'alerte (capitaux propres ≤ 0, EBE ou CAF ≤ 0 avec une dette).
 *
 * Plan de financement : ressources (CAF, apports en capital, emprunts
 * nouveaux, baisse du BFR) et emplois (investissements, hausse du BFR,
 * remboursements, dividendes) de chaque exercice, solde et cumul.
 */
import { diviserArrondi } from "../finance/calcul-exact";
import { ErreurPlan } from "./erreurs";

/** Base des jours du BFR, comme le modèle (année de 360 jours). */
const JOURS_BFR = 360n;
const PB = 10_000n;

export interface ExerciceBancabilite {
  readonly exercice: number;
  readonly compteResultat: {
    readonly chiffreAffaires: number;
    readonly excedentBrutExploitation: number;
    readonly fraisFinanciers: number;
    readonly impotSurResultat: number;
  };
  readonly bilan: {
    readonly capitauxPropres: number;
    readonly dettesFinancieres: number;
    readonly tresorerieNette: number;
    readonly besoinFondsRoulement: number;
  };
  readonly fluxTresorerie: {
    readonly capaciteAutofinancement: number;
    readonly variationBesoinFondsRoulement: number;
    readonly acquisitionsImmobilisations: number;
    readonly augmentationsCapital: number;
    readonly dividendesVerses: number;
    readonly empruntsNouveaux: number;
    readonly remboursementsEmprunts: number;
  };
}

export interface SeuilsBancabilite {
  /** DSCR minimal (pb) : 12 000 = 1,2. */
  readonly couvertureServiceDetteMinPb: number;
  /** Dettes financières / capitaux propres maximal (pb). */
  readonly endettementMaxPb: number;
  /** Dette nette / EBE maximal (pb). */
  readonly detteNetteSurEbeMaxPb: number;
  /** Capacité de remboursement maximale (années, pb). */
  readonly capaciteRemboursementMaxPb: number;
  /** BFR maximal en jours de chiffre d'affaires. */
  readonly bfrJoursMax: number;
}

/** Seuils indicatifs d'usage bancaire (à calibrer : DECISIONS.md). */
export const SEUILS_BANCABILITE_DEFAUT: SeuilsBancabilite = {
  couvertureServiceDetteMinPb: 12_000,
  endettementMaxPb: 10_000,
  detteNetteSurEbeMaxPb: 30_000,
  capaciteRemboursementMaxPb: 40_000,
  bfrJoursMax: 90,
};

export type StatutRatio = "conforme" | "hors_seuil" | "sans_objet" | "non_calculable";

export interface RatioBancaire {
  /** Valeur entière (pb, ou jours pour le BFR) ; null si non calculable ou sans objet. */
  readonly valeur: number | null;
  readonly statut: StatutRatio;
}

export type CleRatioBancaire =
  | "couverture_service_dette"
  | "endettement"
  | "dette_nette_sur_ebe"
  | "capacite_remboursement"
  | "bfr_jours";

export const CLES_RATIOS_BANCAIRES: readonly CleRatioBancaire[] = [
  "couverture_service_dette",
  "endettement",
  "dette_nette_sur_ebe",
  "capacite_remboursement",
  "bfr_jours",
];

export interface PlanFinancementExercice {
  readonly exercice: number;
  readonly ressources: {
    readonly capaciteAutofinancement: number;
    readonly augmentationsCapital: number;
    readonly empruntsNouveaux: number;
    readonly diminutionBfr: number;
    readonly total: number;
  };
  readonly emplois: {
    readonly investissements: number;
    readonly augmentationBfr: number;
    readonly remboursementsEmprunts: number;
    readonly dividendes: number;
    readonly total: number;
  };
  readonly solde: number;
  readonly soldeCumule: number;
}

export type VerdictBancabilite = "favorable" | "a_renforcer" | "defavorable";

export interface AnalyseBancabilite {
  readonly seuils: SeuilsBancabilite;
  readonly exercices: readonly {
    readonly exercice: number;
    readonly ratios: Readonly<Record<CleRatioBancaire, RatioBancaire>>;
  }[];
  readonly planFinancement: readonly PlanFinancementExercice[];
  readonly totaux: {
    readonly ressources: number;
    readonly emplois: number;
    readonly solde: number;
  };
  /** Exercices hors seuil, par ratio. */
  readonly horsSeuil: Readonly<Record<CleRatioBancaire, readonly number[]>>;
  /**
   * « défavorable » : DSCR hors seuil ou capitaux propres négatifs sur un exercice ;
   * « à renforcer » : un autre ratio hors seuil ; « favorable » sinon.
   */
  readonly verdict: VerdictBancabilite;
}

const b = (n: number) => BigInt(n);

/** `num × échelle / den` arrondi (demi s'éloignant de zéro), en nombre. */
function quotient(num: bigint, den: bigint, echelle: bigint): number {
  return Number(diviserArrondi(num * echelle, den));
}

const sansObjet: RatioBancaire = { valeur: null, statut: "sans_objet" };
const nonCalculable: RatioBancaire = { valeur: null, statut: "non_calculable" };
const horsSeuilSansValeur: RatioBancaire = { valeur: null, statut: "hors_seuil" };

function borne(valeur: number, max: number | null, min: number | null): RatioBancaire {
  const hors = (max !== null && valeur > max) || (min !== null && valeur < min);
  return { valeur, statut: hors ? "hors_seuil" : "conforme" };
}

function ratiosExercice(
  e: ExerciceBancabilite,
  s: SeuilsBancabilite,
): Record<CleRatioBancaire, RatioBancaire> {
  const cr = e.compteResultat;
  const bl = e.bilan;
  const fl = e.fluxTresorerie;
  const service = b(cr.fraisFinanciers) + b(fl.remboursementsEmprunts);
  const dette = b(bl.dettesFinancieres);
  const detteNette = dette - b(bl.tresorerieNette);
  const ebe = b(cr.excedentBrutExploitation);
  const caf = b(fl.capaciteAutofinancement);
  return {
    couverture_service_dette:
      service <= 0n
        ? sansObjet
        : borne(
            quotient(ebe - b(cr.impotSurResultat), service, PB),
            null,
            s.couvertureServiceDetteMinPb,
          ),
    endettement:
      b(bl.capitauxPropres) <= 0n
        ? horsSeuilSansValeur
        : borne(quotient(dette, b(bl.capitauxPropres), PB), s.endettementMaxPb, null),
    dette_nette_sur_ebe:
      ebe > 0n
        ? borne(quotient(detteNette, ebe, PB), s.detteNetteSurEbeMaxPb, null)
        : detteNette > 0n
          ? horsSeuilSansValeur
          : sansObjet,
    capacite_remboursement:
      dette <= 0n
        ? sansObjet
        : caf > 0n
          ? borne(quotient(dette, caf, PB), s.capaciteRemboursementMaxPb, null)
          : horsSeuilSansValeur,
    bfr_jours:
      cr.chiffreAffaires <= 0
        ? nonCalculable
        : borne(
            quotient(b(bl.besoinFondsRoulement), b(cr.chiffreAffaires), JOURS_BFR),
            s.bfrJoursMax,
            null,
          ),
  };
}

function planFinancement(exercices: readonly ExerciceBancabilite[]): PlanFinancementExercice[] {
  let cumul = 0;
  return exercices.map((e) => {
    const f = e.fluxTresorerie;
    const variation = f.variationBesoinFondsRoulement;
    const ressources = {
      capaciteAutofinancement: f.capaciteAutofinancement,
      augmentationsCapital: f.augmentationsCapital,
      empruntsNouveaux: f.empruntsNouveaux,
      diminutionBfr: variation < 0 ? -variation : 0,
    };
    const emplois = {
      investissements: f.acquisitionsImmobilisations,
      augmentationBfr: variation > 0 ? variation : 0,
      remboursementsEmprunts: f.remboursementsEmprunts,
      dividendes: f.dividendesVerses,
    };
    const totalR = Object.values(ressources).reduce((s, v) => s + v, 0);
    const totalE = Object.values(emplois).reduce((s, v) => s + v, 0);
    cumul += totalR - totalE;
    return {
      exercice: e.exercice,
      ressources: { ...ressources, total: totalR },
      emplois: { ...emplois, total: totalE },
      solde: totalR - totalE,
      soldeCumule: cumul,
    };
  });
}

function controler(exercices: readonly ExerciceBancabilite[], s: SeuilsBancabilite): void {
  if (exercices.length === 0 || exercices.length > 10) {
    throw new ErreurPlan("BANCABILITE_INVALIDE", "De 1 à 10 exercices attendus.", "exercices");
  }
  exercices.forEach((e, i) => {
    const valeurs = [
      e.exercice,
      ...Object.values(e.compteResultat),
      ...Object.values(e.bilan),
      ...Object.values(e.fluxTresorerie),
    ];
    if (valeurs.some((v) => !Number.isSafeInteger(v))) {
      throw new ErreurPlan("BANCABILITE_INVALIDE", "Montants entiers attendus.", `exercices[${i}]`);
    }
  });
  for (const [cle, v] of Object.entries(s)) {
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000) {
      throw new ErreurPlan("BANCABILITE_INVALIDE", "Seuil hors bornes.", `seuils.${cle}`);
    }
  }
}

/** Ratios bancaires, plan de financement et verdict indicatif d'un modèle calculé. */
export function analyserBancabilite(
  exercices: readonly ExerciceBancabilite[],
  seuils: SeuilsBancabilite = SEUILS_BANCABILITE_DEFAUT,
): AnalyseBancabilite {
  controler(exercices, seuils);
  const lignes = exercices.map((e) => ({
    exercice: e.exercice,
    ratios: ratiosExercice(e, seuils),
  }));
  const horsSeuil = Object.fromEntries(
    CLES_RATIOS_BANCAIRES.map((cle) => [
      cle,
      lignes.filter((l) => l.ratios[cle].statut === "hors_seuil").map((l) => l.exercice),
    ]),
  ) as Record<CleRatioBancaire, number[]>;
  const plan = planFinancement(exercices);
  const capitauxNegatifs = exercices.some((e) => e.bilan.capitauxPropres <= 0);
  const verdict: VerdictBancabilite =
    horsSeuil.couverture_service_dette.length > 0 || capitauxNegatifs
      ? "defavorable"
      : CLES_RATIOS_BANCAIRES.some((c) => horsSeuil[c].length > 0)
        ? "a_renforcer"
        : "favorable";
  return {
    seuils,
    exercices: lignes,
    planFinancement: plan,
    totaux: {
      ressources: plan.reduce((s, p) => s + p.ressources.total, 0),
      emplois: plan.reduce((s, p) => s + p.emplois.total, 0),
      solde: plan.reduce((s, p) => s + p.solde, 0),
    },
    horsSeuil,
    verdict,
  };
}
