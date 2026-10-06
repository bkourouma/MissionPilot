/**
 * Écarts entre répondants (NOT-05, partie déterministe).
 *
 * Sur chaque question de Likert, l'écart est la différence entre le niveau le
 * plus haut et le plus bas donnés par les répondants qui y ont répondu (la
 * question doit être visible pour eux). Un écart supérieur ou égal au seuil
 * (en niveaux d'échelle, 2 par défaut) est signalé. La détection d'incohérences
 * par l'IA viendra en complément ; elle ne remplace pas ce calcul.
 *
 * Le résultat ne dépend pas de l'ordre des répondants : questions dans
 * l'ordre de la définition, répondants triés par identifiant.
 */
import { ErreurQuestionnaire } from "./erreurs";
import type { DefinitionQuestionnaire, Reponses } from "./types";
import { etatQuestionnaire } from "./visibilite";

export interface ReponsesRepondant {
  readonly repondant: string;
  readonly reponses: Reponses;
}

export interface EcartRepondants {
  readonly question: string;
  readonly libelle: string;
  readonly min: number;
  readonly max: number;
  readonly ecart: number;
  readonly repondantsMin: readonly string[];
  readonly repondantsMax: readonly string[];
  readonly nombreRepondants: number;
}

export const SEUIL_ECART_DEFAUT = 2;

/** Questions de Likert sur lesquelles les répondants divergent d'au moins `seuil` niveaux. */
export function detecterEcarts(
  def: DefinitionQuestionnaire,
  jeux: readonly ReponsesRepondant[],
  options: { readonly seuil?: number } = {},
): EcartRepondants[] {
  const seuil = options.seuil ?? SEUIL_ECART_DEFAUT;
  if (!Number.isInteger(seuil) || seuil < 1) {
    throw new ErreurQuestionnaire("OPTIONS_INVALIDES", "Le seuil d'écart doit être un entier ≥ 1.");
  }
  const ids = jeux.map((j) => j.repondant);
  if (new Set(ids).size !== ids.length) {
    throw new ErreurQuestionnaire("REPONDANT_INVALIDE", "Un répondant figure deux fois.");
  }
  const etats = [...jeux]
    .sort((a, b) => (a.repondant < b.repondant ? -1 : 1))
    .map((j) => ({ repondant: j.repondant, valeurs: etatQuestionnaire(def, j.reponses).valeurs }));

  const ecarts: EcartRepondants[] = [];
  for (const q of def.sections.flatMap((s) => s.questions)) {
    if (q.type !== "likert") continue;
    const niveaux = etats.flatMap((e) => {
      const v = e.valeurs.get(q.id);
      return v === undefined ? [] : [{ repondant: e.repondant, niveau: v as number }];
    });
    if (niveaux.length < 2) continue;
    const min = Math.min(...niveaux.map((n) => n.niveau));
    const max = Math.max(...niveaux.map((n) => n.niveau));
    if (max - min < seuil) continue;
    ecarts.push({
      question: q.id,
      libelle: q.libelle,
      min,
      max,
      ecart: max - min,
      repondantsMin: niveaux.filter((n) => n.niveau === min).map((n) => n.repondant),
      repondantsMax: niveaux.filter((n) => n.niveau === max).map((n) => n.repondant),
      nombreRepondants: niveaux.length,
    });
  }
  return ecarts;
}
