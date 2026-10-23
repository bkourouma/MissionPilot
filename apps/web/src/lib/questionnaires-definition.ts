/**
 * Définitions de questionnaires (SOC-10) côté web : édition immuable (sections, questions,
 * options, conditions d'affichage), contrôle de FORME local par le schéma partagé
 * (`definitionQuestionnaireSchema`), localisation lisible des anomalies et mise en forme des
 * réponses. Logique pure, testée dans `questionnaires-definition.test.ts`.
 *
 * La COHÉRENCE d'une définition (références des conditions, cycles, profondeur, échelles,
 * doublons) est jugée par le moteur `validerDefinition` de `@missionpilot/engines`, que l'API
 * applique à chaque enregistrement et à la validation d'une version : le web n'importe pas les
 * moteurs (CODING_STANDARDS §1), il affiche les anomalies rendues par l'API (code, chemin,
 * message). Les garde-fous locaux (profondeur des conditions, opérateurs selon le type de la
 * question citée) évitent seulement de construire une définition que l'API refuserait.
 */

export * from "./questionnaires-definition-socle";
export * from "./questionnaires-definition-construction";
export * from "./questionnaires-definition-edition";
export * from "./questionnaires-definition-conditions";
export * from "./questionnaires-definition-controle";
export * from "./questionnaires-definition-reponses";
