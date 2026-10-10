/**
 * Calibration entre évaluateurs (NOT-13, PRD complémentaire §4.5 et §11.1) : double cotation
 * d'un échantillon de cas (une pratique d'une entreprise, notée sur l'échelle de la banque),
 * écart mesuré, cas à discuter en session de calibrage.
 *
 * Mesures (valeurs à calibrer au pilote) :
 * - par cas : nombre de cotations, niveaux minimal et maximal, écart (max − min), médiane ; un
 *   cas coté au moins deux fois est « doublement coté » ; il est en accord si l'écart est au plus
 *   la tolérance (0 par défaut : même niveau), sinon « à discuter » ;
 * - taux d'accord : cas en accord / cas doublement cotés (null s'il n'y en a aucun) ;
 * - écart moyen : moyenne des écarts des cas doublement cotés ;
 * - par évaluateur, sur les cas doublement cotés : biais = moyenne des écarts signés à la
 *   médiane du cas (positif : plus généreux que ses pairs), écart absolu moyen.
 * Arithmétique exacte (fractions), arrondi à 4 décimales (taux) ou 2 décimales (écarts).
 */
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import { ZERO, ajouter, arrondir, diviser, fraction, soustraire, type Fraction } from "./fraction";

export interface CotationCas {
  readonly cas: string;
  readonly evaluateur: string;
  readonly niveau: number;
}

export interface OptionsCalibration {
  readonly niveaux?: number;
  readonly tolerance?: number;
}

export interface MesureCas {
  readonly cas: string;
  readonly cotations: number;
  readonly min: number;
  readonly max: number;
  readonly ecart: number;
  readonly mediane: number;
  readonly accord: boolean | null;
}

export interface MesureEvaluateur {
  readonly evaluateur: string;
  readonly cotations: number;
  readonly casCompares: number;
  readonly biais: number | null;
  readonly ecartAbsoluMoyen: number | null;
}

export interface MesureCalibration {
  readonly tolerance: number;
  readonly casDoublementCotes: number;
  readonly casEnAccord: number;
  readonly tauxAccord: number | null;
  readonly ecartMoyen: number | null;
  readonly cas: readonly MesureCas[];
  readonly aDiscuter: readonly string[];
  readonly evaluateurs: readonly MesureEvaluateur[];
}

function verifier(cotations: readonly CotationCas[], options: OptionsCalibration) {
  const niveaux = options.niveaux ?? 5;
  const tolerance = options.tolerance ?? 0;
  const refus = (m: string) => new ErreurNotationAugmentee("COTATIONS_INVALIDES", m);
  if (!Number.isInteger(niveaux) || niveaux < 2 || niveaux > 10) throw refus("Échelle invalide.");
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance >= niveaux) {
    throw refus("Tolérance invalide.");
  }
  const vus = new Set<string>();
  for (const c of cotations) {
    if (!Number.isInteger(c.niveau) || c.niveau < 1 || c.niveau > niveaux) {
      throw refus(`Niveau hors échelle pour le cas « ${c.cas} ».`);
    }
    const cle = JSON.stringify([c.cas, c.evaluateur]);
    if (vus.has(cle)) throw refus(`Cas « ${c.cas} » coté deux fois par le même évaluateur.`);
    vus.add(cle);
  }
  return { tolerance };
}

function mediane(niveaux: readonly number[]): Fraction {
  const tries = [...niveaux].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  if (tries.length % 2 === 1) return fraction(BigInt(tries[milieu] as number));
  return fraction(BigInt((tries[milieu - 1] as number) + (tries[milieu] as number)), 2n);
}

const comparerTexte = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Mesure de la calibration d'une session (règles en tête du fichier). */
export function mesurerCalibration(
  cotations: readonly CotationCas[],
  options: OptionsCalibration = {},
): MesureCalibration {
  const { tolerance } = verifier(cotations, options);
  const parCas = new Map<string, CotationCas[]>();
  for (const c of cotations) parCas.set(c.cas, [...(parCas.get(c.cas) ?? []), c]);
  const medianes = new Map<string, Fraction>();
  const cas: MesureCas[] = [...parCas.entries()]
    .sort(([a], [b]) => comparerTexte(a, b))
    .map(([code, liste]) => {
      const niveaux = liste.map((c) => c.niveau);
      const min = Math.min(...niveaux);
      const max = Math.max(...niveaux);
      const m = mediane(niveaux);
      medianes.set(code, m);
      return {
        cas: code,
        cotations: liste.length,
        min,
        max,
        ecart: max - min,
        mediane: arrondir(m, 1),
        accord: liste.length < 2 ? null : max - min <= tolerance,
      };
    });
  const doubles = cas.filter((c) => c.accord !== null);
  const enAccord = doubles.filter((c) => c.accord === true).length;
  const parEvaluateur = new Map<string, { n: number; signes: Fraction[] }>();
  for (const c of cotations) {
    const e = parEvaluateur.get(c.evaluateur) ?? { n: 0, signes: [] };
    e.n += 1;
    if ((parCas.get(c.cas) ?? []).length >= 2) {
      e.signes.push(soustraire(fraction(BigInt(c.niveau)), medianes.get(c.cas) as Fraction));
    }
    parEvaluateur.set(c.evaluateur, e);
  }
  const moyenne = (valeurs: readonly Fraction[]) =>
    valeurs.length === 0
      ? null
      : arrondir(diviser(valeurs.reduce(ajouter, ZERO), fraction(BigInt(valeurs.length))), 2);
  return {
    tolerance,
    casDoublementCotes: doubles.length,
    casEnAccord: enAccord,
    tauxAccord:
      doubles.length === 0 ? null : arrondir(fraction(BigInt(enAccord), BigInt(doubles.length)), 4),
    ecartMoyen: moyenne(doubles.map((c) => fraction(BigInt(c.ecart)))),
    cas,
    aDiscuter: doubles.filter((c) => c.accord === false).map((c) => c.cas),
    evaluateurs: [...parEvaluateur.entries()]
      .sort(([a], [b]) => comparerTexte(a, b))
      .map(([evaluateur, e]) => ({
        evaluateur,
        cotations: e.n,
        casCompares: e.signes.length,
        biais: moyenne(e.signes),
        ecartAbsoluMoyen: moyenne(e.signes.map((s) => (s.num < 0n ? fraction(-s.num, s.den) : s))),
      })),
  };
}
