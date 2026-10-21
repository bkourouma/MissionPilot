/**
 * Synthèse multi-exercices des états financiers acceptés d'un dossier (rapport
 * d'état financier). Moteur pur et déterministe : l'API ne fait aucune
 * arithmétique, tous les chiffres dérivés du rapport sortent d'ici.
 *
 * Règles :
 * - un état par exercice (le courant accepté) ; deux états du même exercice
 *   lèvent EXERCICE_EN_DOUBLE, des devises différentes DEVISES_MIXTES ;
 * - les lignes sortent par exercice CROISSANT, quel que soit l'ordre d'entrée ;
 * - `ecartBilan` = actif − passif déclarés (null si l'un manque) ;
 * - les ratios (marge nette, variations) sont exprimés en points de base
 *   ENTIERS (1 234 = 12,34 %), obtenus par `ratioArrondi` (fraction à
 *   4 décimales, demi s'éloignant de zéro) puis multipliée par 10 000 ;
 * - marge nette = résultat / produits ; null si produits nuls ou absents ;
 * - variation = (N − N−1) / |N−1| par rapport à l'exercice IMMÉDIATEMENT
 *   précédent de la liste ; null si pas de précédent, valeur manquante ou
 *   précédent nul ;
 * - les variations ne sont calculées que si exercice = précédent + 1 ; sinon
 *   elles sont null et l'alerte EXERCICES_NON_CONSECUTIFS est levée.
 *
 * Alertes (codes stables) : ECART_BILAN, DONNEE_MANQUANTE,
 * EXERCICES_NON_CONSECUTIFS, ETAT_NON_CONFORME (accepté sous réserve),
 * ETAT_INCOMPLET.
 */

import { ratioArrondi } from "../commun/ratio";
import { ErreurDossier } from "./erreurs";
import type { TotauxEtatFinancier } from "./etat-financier";

export const CODES_ALERTE_SYNTHESE = [
  "ECART_BILAN",
  "DONNEE_MANQUANTE",
  "EXERCICES_NON_CONSECUTIFS",
  "ETAT_NON_CONFORME",
  "ETAT_INCOMPLET",
] as const;
export type CodeAlerteSynthese = (typeof CODES_ALERTE_SYNTHESE)[number];

export interface EtatPourSynthese {
  readonly exercice: number;
  /** AAAA-MM-JJ */
  readonly dateCloture: string;
  readonly devise: string;
  readonly totaux: TotauxEtatFinancier;
  readonly conforme: boolean;
  readonly complet: boolean;
  readonly acceptation: "automatique" | "humaine";
}

export interface AlerteSynthese {
  readonly code: CodeAlerteSynthese;
  readonly exercice: number;
  readonly message: string;
}

export interface LigneSyntheseExercice {
  readonly exercice: number;
  readonly dateCloture: string;
  readonly actif: number | null;
  readonly passif: number | null;
  readonly charges: number | null;
  readonly produits: number | null;
  readonly resultat: number | null;
  readonly ecartBilan: number | null;
  readonly margeNetteBps: number | null;
  readonly variationProduitsBps: number | null;
  readonly variationResultatBps: number | null;
  readonly variationActifBps: number | null;
  readonly variationExerciceConsecutif: boolean;
  readonly conforme: boolean;
  readonly complet: boolean;
  readonly acceptation: "automatique" | "humaine";
}

export interface SyntheseEtatsFinanciers {
  readonly devise: string | null;
  readonly exercices: readonly LigneSyntheseExercice[];
  readonly alertes: readonly AlerteSynthese[];
}

const POINTS_DE_BASE = 10_000;

function enBps(numerateur: number, denominateur: number): number | null {
  const r = ratioArrondi(numerateur, denominateur);
  return r === null ? null : Math.round(r * POINTS_DE_BASE);
}

function variation(courant: number | null, precedent: number | null): number | null {
  if (courant === null || precedent === null) return null;
  return enBps(courant - precedent, Math.abs(precedent));
}

const TOTAUX_CONTROLES = [
  ["actif", "l'actif"],
  ["passif", "le passif"],
  ["charges", "les charges"],
  ["produits", "les produits"],
  ["resultat", "le résultat"],
] as const;

export function syntheseEtatsFinanciers(
  etats: readonly EtatPourSynthese[],
): SyntheseEtatsFinanciers {
  const devises = new Set(etats.map((e) => e.devise));
  if (devises.size > 1) {
    throw new ErreurDossier(
      "DEVISES_MIXTES",
      "Les états financiers sont libellés dans des devises différentes : la synthèse est impossible.",
    );
  }
  const tries = [...etats].sort((a, b) => a.exercice - b.exercice);
  for (let i = 1; i < tries.length; i++) {
    if (tries[i]!.exercice === tries[i - 1]!.exercice) {
      throw new ErreurDossier(
        "EXERCICE_EN_DOUBLE",
        `Plusieurs états financiers portent sur l'exercice ${tries[i]!.exercice}.`,
      );
    }
  }

  const alertes: AlerteSynthese[] = [];
  const exercices: LigneSyntheseExercice[] = [];

  tries.forEach((e, i) => {
    const t = e.totaux;
    const prec = i > 0 ? tries[i - 1]! : null;
    const consecutif = prec !== null && e.exercice === prec.exercice + 1;
    if (prec !== null && !consecutif) {
      alertes.push({
        code: "EXERCICES_NON_CONSECUTIFS",
        exercice: e.exercice,
        message: `Les exercices ${prec.exercice} et ${e.exercice} ne sont pas consécutifs : aucune variation n'est calculée.`,
      });
    }
    const ecartBilan = t.actif !== null && t.passif !== null ? t.actif - t.passif : null;
    if (ecartBilan !== null && ecartBilan !== 0) {
      alertes.push({
        code: "ECART_BILAN",
        exercice: e.exercice,
        message: `Exercice ${e.exercice} : l'actif et le passif déclarés présentent un écart.`,
      });
    }
    for (const [cle, libelle] of TOTAUX_CONTROLES) {
      if (t[cle] === null) {
        alertes.push({
          code: "DONNEE_MANQUANTE",
          exercice: e.exercice,
          message: `Exercice ${e.exercice} : ${libelle} n'est pas renseigné.`,
        });
      }
    }
    if (!e.conforme) {
      alertes.push({
        code: "ETAT_NON_CONFORME",
        exercice: e.exercice,
        message: `Exercice ${e.exercice} : l'état n'est pas conforme aux contrôles ; il a été accepté sous réserve.`,
      });
    }
    if (!e.complet) {
      alertes.push({
        code: "ETAT_INCOMPLET",
        exercice: e.exercice,
        message: `Exercice ${e.exercice} : l'état est incomplet, certains contrôles n'ont pu être faits.`,
      });
    }
    const pt = consecutif ? prec.totaux : null;
    exercices.push({
      exercice: e.exercice,
      dateCloture: e.dateCloture,
      actif: t.actif,
      passif: t.passif,
      charges: t.charges,
      produits: t.produits,
      resultat: t.resultat,
      ecartBilan,
      margeNetteBps:
        t.resultat !== null && t.produits !== null ? enBps(t.resultat, t.produits) : null,
      variationProduitsBps: pt ? variation(t.produits, pt.produits) : null,
      variationResultatBps: pt ? variation(t.resultat, pt.resultat) : null,
      variationActifBps: pt ? variation(t.actif, pt.actif) : null,
      variationExerciceConsecutif: consecutif,
      conforme: e.conforme,
      complet: e.complet,
      acceptation: e.acceptation,
    });
  });

  return { devise: tries[0]?.devise ?? null, exercices, alertes };
}
