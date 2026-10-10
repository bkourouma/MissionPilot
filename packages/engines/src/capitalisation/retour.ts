import { ErreurCapitalisation } from "./erreurs";
import { sommeCentiemes } from "./temps";

/**
 * Écarts du retour d'expérience (CAP-01) : temps réel de la mission et de chaque brique comparé
 * à sa référence (budget des tâches rattachées, à défaut temps type de la brique dans la
 * méthode). Écart relatif en POUR MILLE entier (moitié au plus loin de zéro) ; un dépassement
 * ou une sous-consommation est signalé au-delà du seuil (200 ‰ = 20 % par défaut, à calibrer).
 */

export const SEUIL_ECART_POUR_MILLE_PAR_DEFAUT = 200;

export interface BriqueRetour {
  brique_code: string;
  budget_centiemes: number;
  realise_centiemes: number;
  /** Temps type de la brique dans la méthode de la mission (centièmes), s'il existe. */
  temps_type_centiemes: number | null;
}

export type ReferenceEcart = "budget" | "temps_type";

export interface EcartBrique extends BriqueRetour {
  reference: ReferenceEcart | null;
  reference_centiemes: number | null;
  ecart_centiemes: number | null;
  ecart_pour_mille: number | null;
  depassement: boolean;
  sous_consommation: boolean;
}

export interface EcartsRetour {
  total: {
    budget_centiemes: number;
    realise_centiemes: number;
    ecart_centiemes: number;
    ecart_pour_mille: number | null;
  };
  briques: EcartBrique[];
  depassements: string[];
  sous_consommations: string[];
}

/** (réel − référence) / référence en pour mille entier, moitié au plus loin de zéro. */
export function ecartPourMille(realise: number, reference: number): number | null {
  if (reference <= 0) return null;
  const num = (realise - reference) * 1000;
  const absolu = Math.floor((2 * Math.abs(num) + reference) / (2 * reference));
  return absolu === 0 ? 0 : Math.sign(num) * absolu;
}

function ecartBrique(b: BriqueRetour, seuil: number): EcartBrique {
  sommeCentiemes([b.budget_centiemes, b.realise_centiemes, b.temps_type_centiemes ?? 0]);
  const reference: ReferenceEcart | null =
    b.budget_centiemes > 0
      ? "budget"
      : b.temps_type_centiemes !== null && b.temps_type_centiemes > 0
        ? "temps_type"
        : null;
  const ref =
    reference === "budget"
      ? b.budget_centiemes
      : reference === "temps_type"
        ? b.temps_type_centiemes
        : null;
  const pm = ref === null ? null : ecartPourMille(b.realise_centiemes, ref);
  return {
    ...b,
    reference,
    reference_centiemes: ref,
    ecart_centiemes: ref === null ? null : b.realise_centiemes - ref,
    ecart_pour_mille: pm,
    depassement: pm !== null && pm > seuil,
    sous_consommation: pm !== null && pm < -seuil,
  };
}

export function ecartsRetour(
  entree: {
    budget_centiemes: number;
    realise_centiemes: number;
    briques: readonly BriqueRetour[];
  },
  seuilPourMille: number = SEUIL_ECART_POUR_MILLE_PAR_DEFAUT,
): EcartsRetour {
  if (!Number.isInteger(seuilPourMille) || seuilPourMille < 0 || seuilPourMille > 10_000) {
    throw new ErreurCapitalisation("SEUIL_INVALIDE", "Seuil d'écart invalide (0 à 10 000 ‰).");
  }
  sommeCentiemes([entree.budget_centiemes, entree.realise_centiemes]);
  const briques = entree.briques.map((b) => ecartBrique(b, seuilPourMille));
  return {
    total: {
      budget_centiemes: entree.budget_centiemes,
      realise_centiemes: entree.realise_centiemes,
      ecart_centiemes: entree.realise_centiemes - entree.budget_centiemes,
      ecart_pour_mille: ecartPourMille(entree.realise_centiemes, entree.budget_centiemes),
    },
    briques,
    depassements: briques.filter((b) => b.depassement).map((b) => b.brique_code),
    sous_consommations: briques.filter((b) => b.sous_consommation).map((b) => b.brique_code),
  };
}

/** « +12,5 % », « −3 % », « 0 % » depuis un écart en pour mille. */
export function formaterPourMille(pm: number): string {
  if (!Number.isInteger(pm)) {
    throw new ErreurCapitalisation("SEUIL_INVALIDE", "Écart en pour mille non entier.");
  }
  const absolu = Math.abs(pm);
  const entier = Math.trunc(absolu / 10);
  const dec = absolu % 10;
  const signe = pm > 0 ? "+" : pm < 0 ? "−" : "";
  return `${signe}${entier}${dec === 0 ? "" : `,${dec}`} %`;
}

/** Écart en pour mille → pour cent exact (125 → 12.5), pour la liste blanche des chiffres de l'IA. */
export function pourCentDepuisPourMille(pm: number): number {
  if (!Number.isInteger(pm)) {
    throw new ErreurCapitalisation("SEUIL_INVALIDE", "Écart en pour mille non entier.");
  }
  const absolu = Math.abs(pm);
  return Number(`${pm < 0 ? "-" : ""}${Math.trunc(absolu / 10)}.${absolu % 10}`);
}
