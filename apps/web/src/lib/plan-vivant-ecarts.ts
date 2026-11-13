/** Plan vivant (PLA-18) : lignes des tableaux d'écarts et phrase d'explication de l'écart d'EBE. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { formaterMontantMineur, formaterPourcentage, type Devise } from "./format";
import {
  formaterEcart,
  formaterEcartRelatif,
  libelleMesures,
  libelleNonSaisi,
  libelleNonSignificatif,
  libelleSignificatif,
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
  langue: Langue,
  reelLibelle?: (v: number | null) => string,
): LigneEcart {
  return {
    cle,
    mesure,
    prevu: formaterMontantMineur(m.prevu, devise, langue),
    reel: reelLibelle ? reelLibelle(m.reel) : montantOuNonSaisi(m.reel, devise, langue),
    ecart: formaterEcart(m.ecart, devise, langue),
    ecartRelatif: formaterEcartRelatif(m.ecartRelatifPointsDeBase, langue),
    significatif: m.significatif,
    marqueur:
      m.reel === null
        ? libelleNonSaisi(langue)
        : m.significatif
          ? libelleSignificatif(langue)
          : libelleNonSignificatif(langue),
  };
}

export function lignesTrimestre(
  e: EcartsTrimestre,
  devise: Devise,
  langue: Langue = "fr",
): LigneEcart[] {
  const c = `t${e.trimestre}`;
  const L = libelleMesures(langue);
  return [
    ligneDe(`${c}-ca`, L.chiffreAffaires, e.chiffreAffaires, devise, langue),
    ligneDe(`${c}-ebe`, L.excedentBrutExploitation, e.excedentBrutExploitation, devise, langue),
    ligneDe(`${c}-rn`, L.resultatNet, e.resultatNet, devise, langue),
    ligneDe(`${c}-tr`, L.tresorerieFin, e.tresorerieFin, devise, langue),
  ];
}

export function lignesCumul(e: EcartsCumules, devise: Devise, langue: Langue = "fr"): LigneEcart[] {
  const c = `cumul${e.trimestre}`;
  const L = libelleMesures(langue);
  return [
    ligneDe(`${c}-ca`, L.chiffreAffaires, e.chiffreAffaires, devise, langue),
    ligneDe(`${c}-ebe`, L.excedentBrutExploitation, e.excedentBrutExploitation, devise, langue),
    ligneDe(`${c}-rn`, L.resultatNet, e.resultatNet, devise, langue),
  ];
}

export function lignesAnnuelles(
  e: EcartsAnnuels,
  devise: Devise,
  langue: Langue = "fr",
): LigneEcart[] {
  const L = libelleMesures(langue);
  return [
    ligneDe("an-ca", L.chiffreAffaires, e.chiffreAffaires, devise, langue),
    ligneDe("an-ebe", L.excedentBrutExploitation, e.excedentBrutExploitation, devise, langue),
    ligneDe("an-rn", L.resultatNet, e.resultatNet, devise, langue),
    ligneDe("an-tr", L.tresorerieCloture, e.tresorerieCloture, devise, langue),
  ];
}

/** Titre du tableau cumulé : « Cumul à fin du trimestre 2 ». */
export const titreCumul = (trimestre: number, langue: Langue = "fr") =>
  creerTraduire(langue)(
    `Cumul depuis le début de l'exercice, à fin du trimestre ${trimestre}`,
    `Cumulative since the start of the fiscal year, at the end of quarter ${trimestre}`,
  );

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
  langue: Langue = "fr",
): string {
  if (langue === "en") return phraseEcartEbeEn(e, trimestres, devise);
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

function phraseEcartEbeEn(
  e: ExplicationEcartEbe | null,
  trimestres: number,
  devise: Devise,
): string {
  if (!e) {
    return "The EBITDA variance breakdown is not available: planned revenue is zero.";
  }
  const langue: Langue = "en";
  const m = (v: number) => formaterMontantMineur(Math.abs(v), devise, langue);
  const sens = (v: number, plus: string, moins: string) => (v > 0 ? plus : v < 0 ? moins : "equal");
  const periode = trimestres <= 1 ? "the first quarter" : `the first ${trimestres} quarters`;
  const phrases = [
    e.ecartEbe === 0
      ? `Over ${periode}, actual EBITDA (${m(e.ebeReel)}) is equal to planned EBITDA.`
      : `Over ${periode}, actual EBITDA (${m(e.ebeReel)}) is ${m(e.ecartEbe)} ${sens(e.ecartEbe, "higher", "lower")} than planned EBITDA (${m(e.ebePrevu)}).`,
    e.effetVolume === 0
      ? "The volume effect is zero."
      : `The volume effect is ${sens(e.effetVolume, "favorable", "unfavorable")} by ${m(e.effetVolume)}: actual revenue (${m(e.chiffreAffairesReel)}) is ${e.chiffreAffairesReel >= e.chiffreAffairesPrevu ? "higher" : "lower"} than planned (${m(e.chiffreAffairesPrevu)}).`,
    e.effetMarge === 0
      ? "The margin effect is zero."
      : `The margin effect is ${sens(e.effetMarge, "favorable", "unfavorable")} by ${m(e.effetMarge)}: the EBITDA margin is ${formaterPourcentage(
          (e.tauxMargeReelPointsDeBase ?? 0) / 10_000,
          2,
          langue,
        )} versus ${formaterPourcentage(e.tauxMargePrevuPointsDeBase / 10_000, 2, langue)} planned.`,
  ];
  return phrases.join(" ");
}
