/**
 * Carte de triangulation (PRV-05) : sources × dimensions, avec les zones non
 * couvertes signalées AVANT l'analyse.
 *
 * - Colonnes : les cinq types de source, toujours dans l'ordre canonique ;
 *   les zones non couvertes ne portent que sur les types ATTENDUS (tous par
 *   défaut : une mission sans observation de terrain le déclare).
 * - Une dimension est couverte si au moins une preuve retenue s'y rattache,
 *   triangulée si ses preuves retenues viennent d'au moins `typesMinimum`
 *   types de source distincts (2 par défaut).
 * - Une preuve moins fiable que `fiabiliteMinimale` (D par défaut : toutes
 *   comptent) est écartée et signalée ; un rattachement à une dimension
 *   inconnue est ignoré et signalé (dimension retirée du référentiel).
 */
import { ErreurPreuves } from "./erreurs";
import {
  comparerIdentifiants,
  estFiabilitePreuve,
  estTypeSourcePreuve,
  rangFiabilite,
  TYPES_SOURCE_PREUVE,
  verifierPreuve,
  type FiabilitePreuve,
  type TypeSourcePreuve,
} from "./preuve";

/** Nombre de types de source distincts pour qu'une dimension soit triangulée. */
export const TYPES_MINIMUM_TRIANGULATION_DEFAUT = 2;

export interface PreuveDimensionnee {
  readonly id: string;
  readonly typeSource: TypeSourcePreuve;
  readonly fiabilite: FiabilitePreuve;
  /** Dimensions (ou hypothèses, risques) que la preuve éclaire. */
  readonly dimensions: readonly string[];
}

export interface OptionsTriangulation {
  readonly typesAttendus?: readonly TypeSourcePreuve[];
  readonly typesMinimum?: number;
  readonly fiabiliteMinimale?: FiabilitePreuve;
}

export interface CelluleTriangulation {
  readonly dimension: string;
  readonly typeSource: TypeSourcePreuve;
  readonly preuves: number;
  readonly meilleureFiabilite: FiabilitePreuve | null;
}

export interface DimensionTriangulee {
  readonly dimension: string;
  readonly typesCouverts: readonly TypeSourcePreuve[];
  /** Types attendus sans aucune preuve retenue sur cette dimension. */
  readonly typesManquants: readonly TypeSourcePreuve[];
  readonly preuves: number;
  readonly couverte: boolean;
  readonly triangulee: boolean;
}

export interface ZoneNonCouverte {
  readonly dimension: string;
  readonly typeSource: TypeSourcePreuve;
}

export interface CarteTriangulation {
  /** Dimensions dans l'ordre reçu. */
  readonly dimensions: readonly DimensionTriangulee[];
  /** Cellules dimension × type de source (ordre des dimensions, puis des types). */
  readonly cellules: readonly CelluleTriangulation[];
  readonly zonesNonCouvertes: readonly ZoneNonCouverte[];
  readonly dimensionsNonCouvertes: readonly string[];
  /** Couvertes, mais par moins de `typesMinimum` types de source. */
  readonly dimensionsSousTriangulees: readonly string[];
  /** Rattachements à une dimension inconnue (ignorés), triés. */
  readonly rattachementsInconnus: readonly {
    readonly preuve: string;
    readonly dimension: string;
  }[];
  /** Preuves sous la fiabilité minimale (écartées), triées. */
  readonly preuvesEcartees: readonly string[];
}

function optionsValidees(options: OptionsTriangulation): {
  attendus: readonly TypeSourcePreuve[];
  minimum: number;
  rangMax: number;
} {
  const attendus = options.typesAttendus ?? TYPES_SOURCE_PREUVE;
  const minimum = options.typesMinimum ?? TYPES_MINIMUM_TRIANGULATION_DEFAUT;
  const fiabiliteMinimale = options.fiabiliteMinimale ?? "D";
  if (!attendus.every(estTypeSourcePreuve) || new Set(attendus).size !== attendus.length) {
    throw new ErreurPreuves("OPTIONS_INVALIDES", "Types de source attendus invalides.");
  }
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > TYPES_SOURCE_PREUVE.length) {
    throw new ErreurPreuves("OPTIONS_INVALIDES", "Nombre minimal de types de source invalide.");
  }
  if (!estFiabilitePreuve(fiabiliteMinimale)) {
    throw new ErreurPreuves("OPTIONS_INVALIDES", "Fiabilité minimale inconnue.");
  }
  return { attendus, minimum, rangMax: rangFiabilite(fiabiliteMinimale) };
}

function verifierDimensions(dimensions: readonly string[]): void {
  const vues = new Set<string>();
  for (const d of dimensions) {
    if (typeof d !== "string" || d === "" || vues.has(d)) {
      throw new ErreurPreuves("DIMENSION_INVALIDE", "Dimension absente ou en double.");
    }
    vues.add(d);
  }
}

type Comptes = Map<TypeSourcePreuve, { preuves: number; meilleure: FiabilitePreuve }>;

/** Construit la carte de triangulation des preuves sur les dimensions données. */
export function carteTriangulation(
  dimensions: readonly string[],
  preuves: readonly PreuveDimensionnee[],
  options: OptionsTriangulation = {},
): CarteTriangulation {
  const { attendus, minimum, rangMax } = optionsValidees(options);
  verifierDimensions(dimensions);
  const parDimension = new Map<string, Comptes>(dimensions.map((d) => [d, new Map()]));
  const inconnus: { preuve: string; dimension: string }[] = [];
  const ecartees: string[] = [];
  const ids = new Set<string>();

  for (const preuve of preuves) {
    verifierPreuve(preuve, false);
    if (ids.has(preuve.id)) throw new ErreurPreuves("PREUVE_INVALIDE", "Preuve en double.");
    ids.add(preuve.id);
    if (!Array.isArray(preuve.dimensions)) {
      throw new ErreurPreuves("PREUVE_INVALIDE", "Dimensions de la preuve absentes.");
    }
    if (rangFiabilite(preuve.fiabilite) > rangMax) {
      ecartees.push(preuve.id);
      continue;
    }
    for (const dimension of new Set(preuve.dimensions)) {
      const comptes = parDimension.get(dimension);
      if (!comptes) {
        inconnus.push({ preuve: preuve.id, dimension: String(dimension) });
        continue;
      }
      const c = comptes.get(preuve.typeSource);
      if (!c) comptes.set(preuve.typeSource, { preuves: 1, meilleure: preuve.fiabilite });
      else {
        c.preuves += 1;
        if (rangFiabilite(preuve.fiabilite) < rangFiabilite(c.meilleure)) {
          c.meilleure = preuve.fiabilite;
        }
      }
    }
  }

  const cellules: CelluleTriangulation[] = [];
  const zonesNonCouvertes: ZoneNonCouverte[] = [];
  const lignes = dimensions.map((dimension): DimensionTriangulee => {
    const comptes = parDimension.get(dimension)!;
    let total = 0;
    for (const typeSource of TYPES_SOURCE_PREUVE) {
      const c = comptes.get(typeSource);
      total += c?.preuves ?? 0;
      cellules.push({
        dimension,
        typeSource,
        preuves: c?.preuves ?? 0,
        meilleureFiabilite: c?.meilleure ?? null,
      });
    }
    const typesCouverts = TYPES_SOURCE_PREUVE.filter((t) => comptes.has(t));
    const typesManquants = TYPES_SOURCE_PREUVE.filter(
      (t) => attendus.includes(t) && !comptes.has(t),
    );
    typesManquants.forEach((typeSource) => zonesNonCouvertes.push({ dimension, typeSource }));
    return {
      dimension,
      typesCouverts,
      typesManquants,
      preuves: total,
      couverte: total > 0,
      triangulee: typesCouverts.length >= minimum,
    };
  });

  inconnus.sort(
    (a, b) =>
      comparerIdentifiants(a.preuve, b.preuve) || comparerIdentifiants(a.dimension, b.dimension),
  );
  return {
    dimensions: lignes,
    cellules,
    zonesNonCouvertes,
    dimensionsNonCouvertes: lignes.filter((l) => !l.couverte).map((l) => l.dimension),
    dimensionsSousTriangulees: lignes
      .filter((l) => l.couverte && !l.triangulee)
      .map((l) => l.dimension),
    rattachementsInconnus: inconnus,
    preuvesEcartees: ecartees.sort(comparerIdentifiants),
  };
}
