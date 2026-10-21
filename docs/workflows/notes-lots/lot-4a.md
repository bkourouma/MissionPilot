# Notes du lot 4a : référentiel de méthodes (STD-11 complet) et revue à froid (QUA-05)

Mises à jour EXACTES à reporter par le superviseur dans les documents interdits au lot
(`SECURITY.md`, `DECISIONS.md`, `CODING_STANDARDS.md`, `review-checklist.md`, `HANDOFF.md`).
Branche `orch/2026-10-20-reste-lot-4a`, aucun commit.

## Migrations

- `0210_standard_facteurs_modification.sql` : `GRANT UPDATE (libelle, description, valeurs, min, max)`
  sur `facteurs_contexte` au rôle applicatif + déclencheur `controler_modification_facteur`
  (SQLSTATE `MQS01`, `MQS02`).
- `0287_qualite_froide_campagnes.sql`, `0288_qualite_froide_revue.sql`,
  `0289_qualite_froide_actions.sql` (SQLSTATE `MQQ01` à `MQQ12`).
- CODING_STANDARDS §1 : prochains libres STD `0211`, QUA `0290`.

## SQLSTATE (SECURITY.md §5 ter et CODING_STANDARDS)

| SQLSTATE | Code d'API                    | HTTP | Sens                                                                 |
| -------- | ----------------------------- | ---- | -------------------------------------------------------------------- |
| MQS01    | `FACTEUR_FIGE`                | 409  | identité, type, porteur d'un facteur figés ; facteur du standard     |
| MQS02    | `FACTEUR_RETRAIT_INTERDIT`    | 409  | valeur d'énumération retirée ou borne resserrée                      |
| MQQ01    | `FROIDE_HISTORIQUE_IMMUABLE`  | 409  | historique des actions en ajout seul                                 |
| MQQ02    | `FROIDE_CAMPAGNE_FIGEE`       | 409  | critères, graine, population, échantillon figés après le tirage      |
| MQQ03    | `RELECTEUR_NON_INDEPENDANT`   | 409  | séparation des tâches du relecteur (doublée en base)                 |
| MQQ04    | `REVUE_FROIDE_TERMINEE`       | 409  | revue terminée figée                                                 |
| MQQ05    | `MISSION_TIREE_INVALIDE`      | 409  | mission tirée non clôturée ou d'un autre cabinet                     |
| MQQ06    | `ACTION_TRANSITION_IMPOSSIBLE`| 409  | transition de statut d'action interdite                              |
| MQQ07    | `RELECTEUR_NON_HABILITE`      | 409  | relecteur sans rôle associé, directeur de mission ou expert métier   |
| MQQ08    | `RESPONSABLE_INVALIDE`        | 400  | responsable d'action inactif ou inconnu                              |
| MQQ09    | `PLAFOND_ATTEINT`             | 409  | 100 constats par revue, 500 actions par campagne                     |
| MQQ10    | `REVUES_NON_TERMINEES`        | 409  | clôture de campagne avant la fin des revues                          |
| MQQ11    | `REVUE_ETAT_IMPOSSIBLE`       | 409  | état de revue incompatible                                           |
| MQQ12    | `CONSTAT_INVALIDE`            | 409  | constat lié à une action hors revue terminée de la campagne          |

Codes émis par l'API seule : `POPULATION_TROP_GRANDE`, `POPULATION_VIDE`, `GRILLE_INCOMPLETE`
(`details.manquants`), `GRILLE_SANS_NOTE`, `CAMPAGNE_CLOSE`, `ACTION_CLOSE`, `ECHEANCE_PASSEE`,
`MISSION_DEJA_TIREE`, `STANDARD_LECTURE_SEULE` (facteur du standard, 403). Réutilisés : `VERSION_PUBLIEE`,
`VERSION_INCOHERENTE`, `CONTEXTE_INVALIDE`.

## Permissions (`roles.ts`)

- `qualite.froide.gerer` : associé seul (tirage, affectation, clôture, plan d'amélioration).
- `qualite.froide.relire` : associé, directeur de mission, expert métier (relecteur indépendant).
- Les responsables d'actions suivent leurs actions avec `mission.lire`.

## Routes ajoutées

- STD (sous `/api`) : `PATCH /methodes/versions/:id/elements/:enfantId`,
  `PATCH …/rubriques/:enfantId`, `PUT …/cas-types/:enfantId`, `PATCH /standard/facteurs/:id`
  (`standard.gerer`), `POST /methodes/versions/:id/apercu` (`standard.lire`). `GET …/validation`
  renvoie en plus `categories` (six catégories) et les nouveaux codes d'anomalie.
- QUA : 19 routes sous `/api/qualite/revue-froide/**` (`routes/qualite-froide.ts`), aucune dans
  `LISTE_BLANCHE_PORTAIL` (403 portail testé).

## Recherches mécaniques (review-checklist) à rejouer

19 routes ajoutées en QUA (toutes protégées par `exiger`, y compris `exigerLectureRevue`), 5 en STD ;
tous les `z.object` neufs sont `.strict()` ; 4 migrations neuves ; pas de `SELECT *`.

## DECISIONS.md : valeurs provisoires à faire valider

- Grille de revue à froid v1 : 8 critères et leurs poids (3, 3, 3, 2, 2, 2, 2, 2) ; notes 1 à 5.
- Seuils de conclusion `SEUILS_REVUE_FROIDE` : conforme >= 75, réserves >= 50, sinon non conforme ;
  constat critique => non conforme ; constat majeur => au mieux réserves ; couverture < 0,5 => jamais
  « conforme ».
- Plafonds : échantillon 100 missions, population 5000, 100 constats par revue, 500 actions par
  campagne.
- Tirage : empreinte 53 bits (cyrb53) sur `graine:id`, tourniquet entre strates (type de mission ou
  directeur) ; missions déjà tirées exclues par défaut.
- Relecteur indépendant : ni directeur, chef, membre d'équipe, affecté du planning, créateur,
  clôtureur, signataire de la mission, ni auteur, ouvreur, valideur, signataire ou attestateur d'un
  suivi qualité de la mission.
- Contrôle de cohérence : `REGLES_CONTRADICTOIRES` (deux règles actives de même priorité et de
  condition identique aux effets contraires) est une ERREUR bloquante ; `CONFLIT_MEME_PRIORITE`
  (conditions différentes) reste un avertissement.

## HANDOFF.md

- STD-11 complet et QUA-05 livrés (branche du lot 4a) ; retirer « QUA-05 » et « STD-11 complet » des
  dettes de la vague 1 du lot C. STD-13 et STD-14 restent à faire.
- NON vérifié : aucun écran ouvert dans un navigateur (éditeur, aperçu, revue à froide) ; contrat
  `GET /methodes/versions/:id` (`brique_id`, `cas`) lu dans le code, à confirmer en recette.
- Piège : deux implémentations alignées de l'indépendance du relecteur (moteur
  `evaluerIndependanceRelecteur` et déclencheur `qualite_froide_violations()` de la 0287) ; la grille
  « complète » (8 critères) est codée en dur dans le déclencheur : une grille v2 exige une migration ;
  l'habilitation du relecteur (MQQ07) reprend les rôles de `qualite.froide.relire`.
- Piège : dans le barrel `@missionpilot/engines`, `GraviteConstat` (notation) et `ActionPlan`
  (redressement) existaient : les types de la revue à froide y sont exportés sous
  `GraviteConstatRevue` et `ActionPlanAmelioration`.
