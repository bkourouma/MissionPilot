# Lot 8c : découpage des gros fichiers web

Dette « fichiers web de plus de 400 lignes » (CODING_STANDARDS §10). Aucun changement de
comportement : chaque fichier d'origine reste le point d'entrée et ré-exporte ses sous-modules
(`export *` ou liste explicite quand des aides internes partagées ne doivent pas devenir publiques).
Tous les fichiers résultants font moins de 400 lignes (plus gros : `SaisieQuestionnaire.tsx`, 394).

Découpages (lignes avant -> après, dans `apps/web/src/lib/` sauf mention) :

- `plan-modele.ts` 1308 -> 32 : `-types`, `-format`, `-lignes-base`, `-lignes-bilan`, `-lignes-flux`, `-etats`, `-scenarios`, `-versions`, `-comparaison`, `-api`.
- `plan-hypotheses.ts` 721 -> 152 : `-saisie`, `-lecture`, `-corps`.
- `plan-vivant.ts` 651 -> 116 : `-types`, `-libelles`, `-ecarts`, `-saisie`.
- `plan-ateliers.ts` 602 -> 90 : `-types`, `-presentation`, `-saisie`.
- `plan-elements.ts` 580 -> 19 : `-saisie`, `-controles`, `-liens`, `-texte`.
- `redressement-saisie.ts` 1157 -> 135 : `-base`, `-correspondance`, `-seuils`, `-tresorerie`, `-creanciers`, `-plan`.
- `redressement.ts` 896 -> 259 : `-chemins`, `-droits`, `-libelles`, `-formes`, `-plan`, `-messages`.
- `notation-augmentee.ts` 1144 -> 15 : `-types`, `-analyse`, `-banque`, `-calibration`, `-erreurs`, `-parametres`, `-commun`.
- `notation.ts` 820 -> 23 : `-types`, `-libelles`, `-droits`, `-saisies`, `-chemins`, `-choix`.
- `kpi.ts` 1025 -> 199 : `-types`, `-libelles`, `-chemins`, `-droits`.
- `kpi-pilotage.ts` 1013 -> 53 : `-types`, `-chemins`, `-libelles`, `-saisies`.
- `kpi-saisie.ts` 658 -> 252 : `-nombres`, `-definition`.
- `banque-ao.ts` 950 -> 16 : `-types`, `-libelles`, `-saisie-cv`, `-saisie-offres`, `-messages`, `-saisie-base`.
- `appels-offres.ts` 761 -> 20 : `-types`, `-libelles`, `-chemins`, `-saisies`, `-evaluations`, `-saisie-base`.
- `canaux.ts` 878 -> 33 : `-chemins`, `-libelles`, `-comptes`, `-numeros`, `-journal`, `-saisies`, `-simulateur`, `-onglets`, `-utilitaires`.
- `questionnaires-definition.ts` 805 -> 23 : `-socle`, `-construction`, `-edition`, `-conditions`, `-controle`, `-reponses`, `-utilitaires`.
- `questionnaires.ts` 766 -> 23 : `-types`, `-libelles`, `-actions`, `-envoi`, `-erreurs`, `-pages`.
- `qualite.ts` 647 -> 16 : `-types`, `-libelles`, `-chemins`, `-validation`, `-uuid`.
- `portail-gestion.ts` 627 -> 13 : `-types`, `-acces`, `-partages`, `-resume`.
- `services-candidats.ts` 606 -> 15 : `-types`, `-libelles`, `-mission`, `-guichets`, `-rapprochement`, `-outils`.
- `portail-questionnaires.ts` 605 -> 125 : `-contrats`, `-libelles`, `-refus`, `-fins`.
- `portail.ts` 582 -> 118 : `portail-contrats`, `portail-menus`, `portail-jalons`, `portail-liens`, `portail-erreurs`.
- `missions.ts` 597 -> 98 : `-types`, `-motifs`, `-filtres`, `-droits`, `-saisie`, `-signature`.
- `indicateurs.ts` 590 -> 107 : `-types`, `-definitions`, `-nombre`, `-statuts`, `-affichage`.
- `ia.ts` 576 -> 81 : `-parametres`, `-plafond`, `-modeles`, `-prompts`, `-couts`.
- `import-temps.ts` 573 -> 30 : `-fichier`, `-source`, `-etapes`, `-erreurs`, `-rapport`.
- `capitalisation.ts` 564 -> 14 : `-types`, `-droits`, `-libelles`, `-chemins`, `-saisie`.
- `preuves.ts` 562 -> 20 : `-types`, `-libelles`, `-chemins`, `-droits`, `-format`, `-url`.
- `agents.ts` 562 -> 14 : `-types`, `-droits`, `-libelles`, `-saisie`, `-chemins`.
- Composants : `ArbreDecoupage.tsx` 657 -> 90 (`ArbreDecoupagePhase/Lot/Tache/Outils.tsx`, `arbre-decoupage-types.ts`) ; `ActionsMission.tsx` 582 -> 180 (`ActionsMissionSignature/Copie.tsx`) ; `SaisieQuestionnaire.tsx` 572 -> 394 (`SaisieQuestionnaireVue.tsx`, `saisie-questionnaire-outils.ts`) ; `Commentaires.tsx` 561 -> 232 (`CommentairesElement/Saisie.tsx`) ; `ActionsAo.tsx` 551 -> 46 (`ActionsAoBouton/Evaluation/Texte/Exigence/Etape.tsx`).

Points d'attention : `Libelle` (type) devient exporté de `portail.ts` (ajout sans conflit) ;
dans `SaisieQuestionnaire`, `finParLecture` retourne la fin et la vue, `onFin` est appelé dans le
composant (hors du `try`, sans effet pratique, `onFin` n'étant qu'un `setState`).
