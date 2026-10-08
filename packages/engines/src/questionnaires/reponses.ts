/**
 * Validation d'un jeu de réponses et progression (SOC-10).
 *
 * - Une question obligatoire n'est exigée que si elle est visible.
 * - La réponse à une question invisible (ou inconnue) est écartée du jeu
 *   nettoyé et listée dans `ecartees` : elle ne compte ni dans la notation ni
 *   dans la progression.
 * - Le mode `brouillon` (sauvegarde automatique) contrôle les valeurs saisies
 *   sans exiger les obligatoires ; le mode `soumission` exige tout.
 */
import { ErreurQuestionnaire, type Anomalie } from "./erreurs";
import {
  estVide,
  lireReponse,
  type DefinitionQuestionnaire,
  type Reponses,
  type ValeurReponse,
} from "./types";
import { validerReponse } from "./valeurs";
import { etatQuestionnaire } from "./visibilite";

export type ModeValidation = "brouillon" | "soumission";

export interface ReponseEcartee {
  readonly question: string;
  readonly raison: "invisible" | "inconnue";
}

export interface ResultatValidationReponses {
  readonly valide: boolean;
  /** Réponses valides, normalisées, aux seules questions visibles (clés dans l'ordre de la définition). */
  readonly reponses: Readonly<Record<string, ValeurReponse>>;
  /** Anomalies par question (`chemin` = identifiant de la question). */
  readonly erreurs: readonly Anomalie[];
  readonly ecartees: readonly ReponseEcartee[];
}

/** Valide un jeu de réponses complet selon la visibilité courante. */
export function validerReponses(
  def: DefinitionQuestionnaire,
  reponses: Reponses,
  mode: ModeValidation = "soumission",
): ResultatValidationReponses {
  const etat = etatQuestionnaire(def, reponses);
  const visibles = new Set(etat.visibles.map((q) => q.id));
  const connues = new Set(def.sections.flatMap((s) => s.questions.map((q) => q.id)));
  const erreurs: Anomalie[] = [];
  const propres: Record<string, ValeurReponse> = {};

  for (const q of etat.visibles) {
    const r = validerReponse(q, lireReponse(reponses, q.id));
    if (!r.valide) {
      erreurs.push({ code: r.code, chemin: q.id, message: r.message });
    } else if (r.valeur !== null) {
      propres[q.id] = r.valeur;
    } else if (q.obligatoire && mode === "soumission") {
      erreurs.push({
        code: "OBLIGATOIRE",
        chemin: q.id,
        message: "Cette question est obligatoire.",
      });
    }
  }

  const ecartees: ReponseEcartee[] = Object.keys(reponses)
    .filter((id) => !estVide(lireReponse(reponses, id)) && !visibles.has(id))
    .sort()
    .map((id) => ({ question: id, raison: connues.has(id) ? "invisible" : "inconnue" }));

  return { valide: erreurs.length === 0, reponses: propres, erreurs, ecartees };
}

/** Lève `REPONSES_INVALIDES` avec le détail si le jeu n'est pas valide ; rend le jeu nettoyé. */
export function exigerReponsesValides(
  def: DefinitionQuestionnaire,
  reponses: Reponses,
  mode: ModeValidation = "soumission",
): Readonly<Record<string, ValeurReponse>> {
  const r = validerReponses(def, reponses, mode);
  if (!r.valide) {
    throw new ErreurQuestionnaire(
      "REPONSES_INVALIDES",
      `Réponses invalides (${r.erreurs.length} anomalie(s)).`,
      r.erreurs,
    );
  }
  return r.reponses;
}

export interface Progression {
  readonly questionsVisibles: number;
  readonly questionsRepondues: number;
  readonly obligatoiresVisibles: number;
  readonly obligatoiresRepondues: number;
  /**
   * Part des questions obligatoires visibles qui ont une réponse valide, en
   * pourcentage entier arrondi à l'inférieur (100 seulement si tout est
   * répondu) ; 100 si aucune question obligatoire n'est visible.
   */
  readonly pourcentage: number;
  /** Vrai si toutes les obligatoires visibles sont répondues. */
  readonly complet: boolean;
}

/** Progression de la saisie : seules les réponses valides aux questions visibles comptent. */
export function progression(def: DefinitionQuestionnaire, reponses: Reponses): Progression {
  const { visibles, valeurs } = etatQuestionnaire(def, reponses);
  const obligatoires = visibles.filter((q) => q.obligatoire);
  const obligatoiresRepondues = obligatoires.filter((q) => valeurs.has(q.id)).length;
  const pourcentage =
    obligatoires.length === 0
      ? 100
      : Math.floor((100 * obligatoiresRepondues) / obligatoires.length);
  return {
    questionsVisibles: visibles.length,
    questionsRepondues: valeurs.size,
    obligatoiresVisibles: obligatoires.length,
    obligatoiresRepondues,
    pourcentage,
    complet: obligatoiresRepondues === obligatoires.length,
  };
}
