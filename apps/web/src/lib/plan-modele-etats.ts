/** Modèle financier du plan : états financiers, regroupement des lignes et mentions. */
import type { Langue } from "@missionpilot/shared";
import { groupeLigne, type EtatFinancier, type LigneEtat } from "./plan-modele-lignes-base";
import { LIGNES_BILAN, LIGNES_COMPTE_RESULTAT } from "./plan-modele-lignes-bilan";
import { LIGNES_FLUX, LIGNES_INDICATEURS } from "./plan-modele-lignes-flux";

export const ETATS_FINANCIERS: readonly EtatFinancier[] = [
  {
    cle: "compte_resultat",
    titre: "Compte de résultat prévisionnel",
    titreEn: "Projected income statement",
    lignes: LIGNES_COMPTE_RESULTAT,
  },
  {
    cle: "bilan",
    titre: "Bilan prévisionnel (clôture)",
    titreEn: "Projected balance sheet (closing)",
    lignes: LIGNES_BILAN,
  },
  {
    cle: "flux_tresorerie",
    titre: "Tableau des flux de trésorerie",
    titreEn: "Cash flow statement",
    lignes: LIGNES_FLUX,
  },
  {
    cle: "indicateurs",
    titre: "Indicateurs et ratios",
    titreEn: "KPIs and ratios",
    lignes: LIGNES_INDICATEURS,
  },
];

/** Lignes regroupées sous leurs intertitres (Actif, Passif…) ; un groupe sans titre en tête. */
export function grouperLignes(
  lignes: readonly LigneEtat[],
  langue: Langue = "fr",
): { titre: string | null; lignes: LigneEtat[] }[] {
  const groupes: { titre: string | null; lignes: LigneEtat[] }[] = [];
  for (const l of lignes) {
    const courant = groupes.at(-1);
    if (!courant || l.groupe) groupes.push({ titre: groupeLigne(l, langue) ?? null, lignes: [l] });
    else courant.lignes.push(l);
  }
  return groupes;
}

export const MENTION_SYSCOHADA =
  "Codes de postes SYSCOHADA révisé indicatifs, à confirmer par un expert-comptable avant tout usage normé. États simplifiés : amortissement linéaire en année pleine, impôt payé dans l'exercice, sans opérations hors activités ordinaires, cessions ni provisions.";

export const MENTION_SYSCOHADA_EN =
  "Indicative revised SYSCOHADA line item codes, to be confirmed by a chartered accountant before any normative use. Simplified statements: straight-line depreciation over full years, tax paid in the year, no non-ordinary activities, disposals or provisions.";

export const mentionSyscohada = (langue: Langue = "fr") =>
  langue === "en" ? MENTION_SYSCOHADA_EN : MENTION_SYSCOHADA;

export const MENTION_RATIOS_EN =
  "“—”: undefined value (for example negative equity, zero cash flow from operations or no debt).";

export const mentionRatios = (langue: Langue = "fr") =>
  langue === "en" ? MENTION_RATIOS_EN : MENTION_RATIOS;

export const MENTION_RATIOS =
  "« — » : valeur non définie (par exemple capitaux propres négatifs, capacité d'autofinancement nulle ou absence de dette).";
