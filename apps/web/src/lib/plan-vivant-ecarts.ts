/** Plan vivant (PLA-18) : lignes des tableaux d'écarts et phrase d'explication de l'écart d'EBE. */
import { formaterMontantMineur, formaterPourcentage, type Devise } from "./format";
import {
  formaterEcart,
  formaterEcartRelatif,
  LIBELLE_MESURES,
  LIBELLE_NON_SAISI,
  LIBELLE_NON_SIGNIFICATIF,
  LIBELLE_SIGNIFICATIF,
  montantOuNonSaisi,
} from "./plan-vivant-libelles";
import type {
  EcartMesure,
  EcartsAnnuels,
  EcartsCumules,
  EcartsTrimestre,
  ExplicationEcartEbe,
} from "./plan-vivant-types";

// --- Tableaux d'écarts ------------------------------------------------------------------------

export interface LigneEcart {
  cle: string;
  mesure: string;
  prevu: string;
  reel: string;
  ecart: string;
  ecartRelatif: string;
  significatif: boolean;
  /** Texte de la colonne « Seuil » : le marqueur ne repose jamais sur la couleur seule. */
  marqueur: string;
}

function ligneDe(
  cle: string,
  mesure: string,
  m: EcartMesure,
  devise: Devise,
  reelLibelle?: (v: number | null) => string,
): LigneEcart {
  return {
    cle,
    mesure,
    prevu: formaterMontantMineur(m.prevu, devise),
    reel: reelLibelle ? reelLibelle(m.reel) : montantOuNonSaisi(m.reel, devise),
    ecart: formaterEcart(m.ecart, devise),
    ecartRelatif: formaterEcartRelatif(m.ecartRelatifPointsDeBase),
    significatif: m.significatif,
    marqueur:
      m.reel === null
        ? LIBELLE_NON_SAISI
        : m.significatif
          ? LIBELLE_SIGNIFICATIF
          : LIBELLE_NON_SIGNIFICATIF,
  };
}

export function lignesTrimestre(e: EcartsTrimestre, devise: Devise): LigneEcart[] {
  const c = `t${e.trimestre}`;
  return [
    ligneDe(`${c}-ca`, LIBELLE_MESURES.chiffreAffaires, e.chiffreAffaires, devise),
    ligneDe(
      `${c}-ebe`,
      LIBELLE_MESURES.excedentBrutExploitation,
      e.excedentBrutExploitation,
      devise,
    ),
    ligneDe(`${c}-rn`, LIBELLE_MESURES.resultatNet, e.resultatNet, devise),
    ligneDe(`${c}-tr`, LIBELLE_MESURES.tresorerieFin, e.tresorerieFin, devise),
  ];
}

export function lignesCumul(e: EcartsCumules, devise: Devise): LigneEcart[] {
  const c = `cumul${e.trimestre}`;
  return [
    ligneDe(`${c}-ca`, LIBELLE_MESURES.chiffreAffaires, e.chiffreAffaires, devise),
    ligneDe(
      `${c}-ebe`,
      LIBELLE_MESURES.excedentBrutExploitation,
      e.excedentBrutExploitation,
      devise,
    ),
    ligneDe(`${c}-rn`, LIBELLE_MESURES.resultatNet, e.resultatNet, devise),
  ];
}

export function lignesAnnuelles(e: EcartsAnnuels, devise: Devise): LigneEcart[] {
  return [
    ligneDe("an-ca", LIBELLE_MESURES.chiffreAffaires, e.chiffreAffaires, devise),
    ligneDe("an-ebe", LIBELLE_MESURES.excedentBrutExploitation, e.excedentBrutExploitation, devise),
    ligneDe("an-rn", LIBELLE_MESURES.resultatNet, e.resultatNet, devise),
    ligneDe("an-tr", LIBELLE_MESURES.tresorerieCloture, e.tresorerieCloture, devise),
  ];
}

/** Titre du tableau cumulé : « Cumul à fin du trimestre 2 ». */
export const titreCumul = (trimestre: number) =>
  `Cumul depuis le début de l'exercice, à fin du trimestre ${trimestre}`;

/** Nombre de lignes significatives d'une série d'écarts (pour le résumé annoncé). */
export function compterSignificatifs(lignes: readonly Pick<LigneEcart, "significatif">[]): number {
  return lignes.filter((l) => l.significatif).length;
}

// --- Explication de l'écart d'EBE -------------------------------------------------------------

/**
 * Phrase rédigée à partir des FAITS du moteur (effet volume, effet de marge, taux de marge), sans
 * aucun calcul : elle ne fait que nommer le sens des montants signés fournis.
 */
export function phraseEcartEbe(
  e: ExplicationEcartEbe | null,
  trimestres: number,
  devise: Devise,
): string {
  if (!e) {
    return "La décomposition de l'écart d'EBE n'est pas disponible : le chiffre d'affaires prévu est nul.";
  }
  const m = (v: number) => formaterMontantMineur(Math.abs(v), devise);
  const sens = (v: number, plus: string, moins: string) => (v > 0 ? plus : v < 0 ? moins : "égal");
  const periode =
    trimestres <= 1 ? "le premier trimestre" : `les ${trimestres} premiers trimestres`;
  const phrases = [
    e.ecartEbe === 0
      ? `Sur ${periode}, l'EBE réalisé (${m(e.ebeReel)}) est égal à l'EBE prévu.`
      : `Sur ${periode}, l'EBE réalisé (${m(e.ebeReel)}) est ${sens(e.ecartEbe, "supérieur", "inférieur")} de ${m(e.ecartEbe)} à l'EBE prévu (${m(e.ebePrevu)}).`,
    e.effetVolume === 0
      ? "L'effet volume est nul."
      : `L'effet volume est ${sens(e.effetVolume, "favorable", "défavorable")} de ${m(e.effetVolume)} : le chiffre d'affaires réalisé (${m(e.chiffreAffairesReel)}) est ${e.chiffreAffairesReel >= e.chiffreAffairesPrevu ? "supérieur" : "inférieur"} au prévu (${m(e.chiffreAffairesPrevu)}).`,
    e.effetMarge === 0
      ? "L'effet de marge est nul."
      : `L'effet de marge est ${sens(e.effetMarge, "favorable", "défavorable")} de ${m(e.effetMarge)} : le taux de marge d'EBE est de ${formaterPourcentage(
          (e.tauxMargeReelPointsDeBase ?? 0) / 10_000,
          2,
        )} contre ${formaterPourcentage(e.tauxMargePrevuPointsDeBase / 10_000, 2)} prévu.`,
  ];
  return phrases.join(" ");
}
