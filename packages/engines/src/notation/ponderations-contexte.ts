import { ErreurNotation } from "./erreurs";
import { exigerGrilleValide, type GrilleNotation } from "./grille";

/**
 * Pondérations de CONTEXTE d'une grille de notation (ADR-004, niveau
 * « variante de contexte ») : une règle de modulation de la méthode
 * « Notation d'entreprise » peut fixer le poids d'une dimension de la grille
 * (effet `ponderation` dont la cible est une rubrique rattachée à cette
 * dimension). Le contexte est plus précis que la grille du cabinet : le poids
 * de contexte REMPLACE le poids par défaut de la dimension ET celui de chaque
 * surcharge sectorielle qui la nomme (le secteur est lui-même un facteur de
 * contexte, résolu plus haut dans l'héritage).
 *
 * Effet sur le calcul : les poids des dimensions sont normalisés à 100
 * (`poidsNormalises`) ; changer le poids d'une dimension change donc la part
 * de TOUTES les dimensions dans le score global, jamais le score d'une
 * dimension. Le calcul reste celui du moteur de notation, sur la grille
 * adaptée.
 *
 * Fonction pure : sans pondération, la grille rendue est la MÊME (identité),
 * ce qui garantit des résultats identiques à la V2. La grille adaptée est
 * revalidée (`exigerGrilleValide`).
 */

export interface PonderationContexte {
  readonly dimension: string;
  readonly poids: number;
}

export interface PonderationAppliquee {
  readonly dimension: string;
  readonly poidsAvant: number;
  readonly poidsApres: number;
  /** Surcharges sectorielles dont le poids de cette dimension a été remplacé. */
  readonly secteurs: readonly string[];
}

export function appliquerPonderationsContexte(
  grille: GrilleNotation,
  ponderations: readonly PonderationContexte[],
): { grille: GrilleNotation; appliquees: PonderationAppliquee[] } {
  if (ponderations.length === 0) return { grille, appliquees: [] };
  const parDimension = new Map<string, number>();
  for (const p of ponderations) {
    if (!grille.dimensions.some((d) => d.id === p.dimension)) {
      throw new ErreurNotation("DIMENSION_INCONNUE", `Dimension inconnue : « ${p.dimension} ».`);
    }
    if (parDimension.has(p.dimension)) {
      throw new ErreurNotation(
        "OPTIONS_INVALIDES",
        `Deux pondérations de contexte pour la dimension « ${p.dimension} ».`,
      );
    }
    if (!Number.isFinite(p.poids) || p.poids < 0) {
      throw new ErreurNotation("NOMBRE_INVALIDE", `Poids invalide pour « ${p.dimension} ».`);
    }
    parDimension.set(p.dimension, p.poids);
  }
  const appliquees: PonderationAppliquee[] = [];
  const dimensions = grille.dimensions.map((d) => {
    const poids = parDimension.get(d.id);
    if (poids === undefined) return d;
    const secteurs = (grille.secteurs ?? [])
      .filter((s) => s.poids.some((x) => x.dimension === d.id))
      .map((s) => s.secteur);
    appliquees.push({ dimension: d.id, poidsAvant: d.poids, poidsApres: poids, secteurs });
    return { ...d, poids };
  });
  const adaptee: GrilleNotation = {
    ...grille,
    dimensions,
    ...(grille.secteurs
      ? {
          secteurs: grille.secteurs.map((s) => ({
            ...s,
            poids: s.poids.map((x) => {
              const poids = parDimension.get(x.dimension);
              return poids === undefined ? x : { ...x, poids };
            }),
          })),
        }
      : {}),
  };
  exigerGrilleValide(adaptee);
  return { grille: adaptee, appliquees };
}
