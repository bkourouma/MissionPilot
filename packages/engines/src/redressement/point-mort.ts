/**
 * Point mort (RED-06) : seuil de rentabilité, marge de sécurité et point mort en jours, à
 * partir de trois montants du client sur une période (chiffre d'affaires, charges variables,
 * charges fixes). Arithmétique exacte en `BigInt` ; jours sur 360 par défaut (base du
 * modèle financier). Le seuil est arrondi PAR EXCÈS : c'est le premier chiffre d'affaires qui
 * couvre les charges fixes.
 */
import { PB, exigerEntier, quotientArrondi, versNombreSur } from "./commun";

export interface EntreePointMort {
  /** Entier ≥ 0, sur la période. */
  readonly chiffreAffaires: number;
  /** Entier ≥ 0. */
  readonly chargesVariables: number;
  /** Entier ≥ 0. */
  readonly chargesFixes: number;
  /** 1..366, défaut 360 (base du modèle financier). */
  readonly periodeJours?: number;
}
export type StatutPointMort =
  "beneficiaire" | "equilibre" | "deficitaire" | "non_calculable" | "impossible";
export interface ResultatPointMort {
  readonly statut: StatutPointMort;
  readonly periodeJours: number;
  /** CA − charges variables (peut être négative). */
  readonly margeCoutVariable: number;
  /** Marge / CA, pb ; null si CA ≤ 0. */
  readonly tauxMargeCoutVariablePb: number | null;
  /** Marge − charges fixes. */
  readonly resultatExploitation: number;
  /** Charges fixes × CA / marge, arrondi PAR EXCÈS ; null si non calculable ou impossible. */
  readonly seuilRentabilite: number | null;
  /** CA − seuil (négatif si déficitaire). */
  readonly margeSecurite: number | null;
  /** Marge de sécurité / CA, pb. */
  readonly margeSecuritePb: number | null;
  /** Charges fixes × période / marge, jours entiers (demi s'éloignant de zéro). */
  readonly pointMortJours: number | null;
}

const PERIODE_PAR_DEFAUT = 360;

export function calculerPointMort(e: EntreePointMort): ResultatPointMort {
  const periodeJours = exigerEntier(
    e.periodeJours ?? PERIODE_PAR_DEFAUT,
    1,
    366,
    "ENTREE_INVALIDE",
    "Période en jours",
  );
  const ca = BigInt(
    exigerEntier(
      e.chiffreAffaires,
      0,
      Number.MAX_SAFE_INTEGER,
      "ENTREE_INVALIDE",
      "Chiffre d'affaires",
    ),
  );
  const variables = BigInt(
    exigerEntier(
      e.chargesVariables,
      0,
      Number.MAX_SAFE_INTEGER,
      "ENTREE_INVALIDE",
      "Charges variables",
    ),
  );
  const fixes = BigInt(
    exigerEntier(e.chargesFixes, 0, Number.MAX_SAFE_INTEGER, "ENTREE_INVALIDE", "Charges fixes"),
  );
  const marge = ca - variables;
  const resultat = marge - fixes;
  const base = {
    periodeJours,
    margeCoutVariable: versNombreSur(marge),
    resultatExploitation: versNombreSur(resultat),
  };
  const sansSeuil = {
    seuilRentabilite: null,
    margeSecurite: null,
    margeSecuritePb: null,
    pointMortJours: null,
  };
  if (ca === 0n) {
    return { ...base, statut: "non_calculable", tauxMargeCoutVariablePb: null, ...sansSeuil };
  }
  const taux = versNombreSur(quotientArrondi(marge * PB, ca));
  if (marge <= 0n) {
    return { ...base, statut: "impossible", tauxMargeCoutVariablePb: taux, ...sansSeuil };
  }
  // Plafond de la division exacte : fixes × CA / marge, arrondi par excès.
  const produit = fixes * ca;
  const seuil = (produit + marge - 1n) / marge;
  const margeSecurite = ca - seuil;
  return {
    ...base,
    statut: resultat > 0n ? "beneficiaire" : resultat === 0n ? "equilibre" : "deficitaire",
    tauxMargeCoutVariablePb: taux,
    seuilRentabilite: versNombreSur(seuil),
    margeSecurite: versNombreSur(margeSecurite),
    margeSecuritePb: versNombreSur(quotientArrondi(margeSecurite * PB, ca)),
    pointMortJours: versNombreSur(quotientArrondi(fixes * BigInt(periodeJours), marge)),
  };
}
