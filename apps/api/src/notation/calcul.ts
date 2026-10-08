import {
  detecterEcarts,
  noterQuestionnaire,
  noterRepondants,
  preparerReponses,
  type DefinitionQuestionnaire,
  type EcartRepondants,
  type GrilleNotation,
  type Reponses,
  type ResultatNotation,
} from "@missionpilot/engines";

/*
 * Calcul d'une notation par le CHEMIN V2 (mission sans méthode liée) : appel
 * direct des moteurs, sans aucun calcul dans l'API. Extrait tel quel de
 * `calculer` (notations.ts) pour servir de référence au test de
 * non-régression du calcul depuis la méthode (`via-methode.ts`).
 */

/** Entrées d'un calcul, lues par `calculer` (questionnaire, réponses soumises, grille). */
export interface EntreesCalculNotation {
  grille: GrilleNotation;
  definition: DefinitionQuestionnaire;
  /** Questionnaire collectif (une réponse commune) ou individuel (un jeu par répondant). */
  collectif: boolean;
  soumises: readonly { repondant_id: string | null; reponses: Reponses }[];
  options: { strategie: "ignorer" | "penaliser"; secteur?: string };
}

export interface CalculNotationMoteur {
  resultat: ResultatNotation;
  ecarts: EcartRepondants[];
}

/** Calcul V2 : `noterQuestionnaire` (collectif) ou `noterRepondants` + `detecterEcarts`. */
export function calculerV2(e: EntreesCalculNotation): CalculNotationMoteur {
  const { grille, definition: def, options } = e;
  const resultat = e.collectif
    ? noterQuestionnaire(
        grille,
        def,
        (e.soumises[0] as (typeof e.soumises)[number]).reponses,
        options,
      )
    : noterRepondants(
        grille,
        e.soumises.map((s) => {
          const p = preparerReponses(grille, def, s.reponses);
          return {
            repondant: s.repondant_id as string,
            reponses: p.reponses,
            nonApplicables: p.nonApplicables,
          };
        }),
        options,
      );
  const ecarts = e.collectif
    ? []
    : detecterEcarts(
        def,
        e.soumises.map((s) => ({ repondant: s.repondant_id as string, reponses: s.reponses })),
      );
  return { resultat, ecarts };
}
