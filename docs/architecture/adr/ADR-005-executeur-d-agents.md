# ADR-005 : Exécuteur d'agents IA et niveaux d'autonomie

## Statut

Accepté

## Date

2026-10-08. Mis à jour le 2026-10-10 : le rejeu réel des évaluations sur
OpenRouter est construit (section « Évaluations de non-régression »).

## Contexte

L'orchestrateur IA de la V2 (`apps/api/src/ia/orchestrateur.ts`, ADR-003)
appelle OpenRouter derrière une interface unique, masque les données
identifiantes, applique une garde des chiffres (liste blanche construite par le
code depuis les moteurs), un plafond de coût et la validation humaine de toute
génération. Le PRD complémentaire (§7, §16, §17) en fait le socle d'une
**équipe d'agents** aux rôles bornés (avant-vente, cadrage, collecte,
documentaire, entretien, terrain, analyste, contradicteur, rédacteur, qualité,
PMO, veille, capitalisation, copilote), dont l'autonomie **se mérite, se mesure
et se retire** (principe 4).

Contraintes : l'IA propose, l'expert dispose ; aucun chiffre publié ne vient du
modèle (un chiffre EXTRAIT d'un document client est une donnée sourcée, utilisée
seulement après contrôles déterministes ou confirmation humaine, DECISIONS.md) ;
isolation entre cabinets (RLS) ; un agent agit dans les droits de l'utilisateur
qui le déclenche ; N4 vers les clients limité à la classe R0 avec un
coupe-circuit par cabinet (DECISIONS.md, 2026-10-08).

## Décision

- **L'orchestrateur devient un exécuteur d'agents** : il reste le SEUL
  composant qui appelle un modèle. Chaque exécution passe par lui, avec la
  garde des chiffres, le masquage, le plafond de coût et la trace existants.
- **Registre des agents** (AGT-01, plage `0260–0279`, lot AGT) : par agent,
  mission, entrées, outils autorisés (liste fermée), schéma de sortie (Zod
  strict, AGT-02), briques couvertes, niveau d'autonomie maximal. Le registre
  standard est versionné comme le référentiel de méthodes (ADR-004) ; un
  cabinet ne peut que restreindre (`agent.gerer` : associé, expert métier).
- **Niveaux d'autonomie N0 à N4 par brique et par cabinet** (AGT-03), calculés
  par le moteur pur `packages/engines/src/autonomie` :
  `niveauEffectif(plafond de la brique, niveau accordé, classe de risque)`
  (N4 seulement en R0, coupe-circuit qui ramène N4 à N3) ;
  `evaluerPromotion` dit si une brique N2 est ÉLIGIBLE à N3 (≥ 50 exécutions,
  ≥ 95 % acceptées sans modification majeure, aucun incident majeur sur
  90 jours) — la promotion exige la **décision d'un associé**
  (`autonomie.decider`), enregistrée et journalisée ; `retrogradationAuto`
  ramène une brique N3 ou N4 à N2 au premier incident majeur, sans
  intervention humaine.
- **Évaluations de non-régression** (AGT-04) : jeu d'essai de référence par
  brique ; tout changement de prompt, de modèle ou de schéma de sortie rejoue le
  jeu avant activation ; aucune activation sans évaluation réussie. Les
  exécutions d'évaluation sur un vrai modèle passent par la file `jobs`
  (ADR-002) et sont plafonnées en coût.
  - **Nature du fournisseur local** : l'évaluation « locale » (`POST
    /api/agents/evaluations`, enregistrée désormais toujours `local`)
    s'exécute sur un fournisseur LOCAL déterministe qui renvoie l'écho des
    messages rendus (`ia/fournisseur-local.ts`, `ia/evaluation.ts`). Réussie, elle
    prouve le câblage du prompt (rendu avec les variables du jeu, éléments exigés ou
    interdits par les critères, listes blanches de chiffres, sortie constructible selon
    le schéma) ; elle ne prouve ni la qualité rédactionnelle d'un modèle ni sa
    résistance à l'injection. Elle n'est donc admise que par le réglage de transaction
    `app.evaluation_locale_admise`, que l'API pose hors production seulement (migration
    `0265`) ; en production, seule une évaluation `openrouter` active un prompt ou un
    modèle.
  - **Rejeu réel sur OpenRouter** (migration `0270`,
    `apps/api/src/agents/evaluations-openrouter.ts`) : un job
    `agents_evaluation_openrouter` rejoue le dernier jeu d'essai d'une version de
    prompt sur le VRAI fournisseur, avec les mêmes critères que l'évaluation locale
    (`preparerCasEvaluation`, `jugerSortieCas` de `ia/evaluation.ts`), et enregistre
    une évaluation `fournisseur = 'openrouter'` (ajout seul). Elle seule active un
    prompt ou un modèle et autorise l'exécution d'un agent en production (`MPG04`).
    Routes : `POST /api/agents/prompts/:promptId/evaluations/openrouter` (`agent.gerer`,
    202), `GET /api/agents/evaluations/openrouter/:id` et
    `GET /api/agents/prompts/:promptId/evaluations/openrouter` (`agent.lire`).
    - **Coût plafonné** : plafond PAR évaluation de 2 USD
      (`PLAFOND_EVALUATION_MICRO_USD`, à valider), en plus du plafond mensuel du
      cabinet (réservation avant chaque appel, appels inscrits dans
      `ia_consommations`) ; estimation prudente refusée à la demande si elle dépasse
      déjà le plafond ; au-delà en cours de route, l'évaluation est INCOMPLÈTE et ne
      peut jamais activer. Durée maximale de 8 minutes (à valider).
    - **Jamais de nouvelle tentative d'un appel payant** : `tentatives_max = 1`, clé
      de job unique par demande, une erreur du fournisseur arrête l'évaluation.
    - **Limites de demande** : un seul rejeu en file ou en cours par cabinet, 5 par
      24 heures glissantes (à valider), jamais de rejeu d'une combinaison (prompt, jeu
      courant, modèle) déjà réussie. Un modèle servi différent du modèle demandé fait
      échouer l'évaluation (`MODELE_SERVI_DIFFERENT`).
    - **Provenance garantie en base** : table `agents_evaluations_demandes`,
      une évaluation `openrouter` n'existe que née d'une demande en cours du même
      prompt, jeu et modèle, et réussie seulement avec au moins un appel réussi
      inscrit par cas (`MPG09`). Garde contournable par du SQL arbitraire du même rôle
      applicatif : dette notée (SECURITY.md §15).
    - **Séparation des tâches** : demander un rejeu exige `agent.gerer` (expert
      métier, associé) ; activer un prompt ou choisir un modèle exige `ia.configurer`
      (associé seul).
  - **Exécution réservée aux prompts évalués** : un agent n'exécute que la version
    active d'un prompt qui a un jeu d'essai et une évaluation réussie et admise sur le
    modèle routé de sa tâche (409 `JEU_ESSAI_REQUIS`, `NON_REGRESSION_REQUISE`,
    doublé en base, `MPG04` sur `agents_executions`). Exiger un jeu d'essai pour CHAQUE
    activation de prompt serait une décision produit (DECISIONS.md) : non imposée.
- **Contribution de l'IA mesurée par livrable** (AGT-05) par le moteur pur
  `packages/engines/src/contribution` : distance d'édition en mots entre le
  brouillon IA et le texte validé (coût borné, estimation prudente signalée
  au-delà), part du brouillon conservée (pour-cent entier), modification
  majeure à seuil paramétrable (25 % par défaut, à calibrer), temps de revue.
  Ces mesures alimentent la promotion d'autonomie et la mention de contribution
  (QUA-06, choix du cabinet).
- **Données clients non fiables** (AGT-07) : documents, réponses et messages
  des clients sont des DONNÉES, jamais des instructions. Ils sont transmis au
  modèle dans un bloc délimité et étiqueté, après masquage ; aucune action
  n'est déclenchée par leur contenu ; un agent n'appelle que les outils de son
  rôle, et toute action modifiante d'un outil passe par les mêmes droits,
  séparations des tâches et confirmations qu'un humain (AGT-08, AUT-05). Des
  tests d'injection en CI accompagnent chaque agent qui lit un contenu client.
- **Transparence** (AGT-09) : chaque sortie conserve sources, version de prompt,
  modèle, coût, niveau d'autonomie effectif et décision humaine (exigence
  non fonctionnelle « 100 % des exécutions », PRD §16).
- **Garde humaine par classe de risque** : la sortie d'un agent suit la garde de
  la classe de sa brique (moteur `packages/engines/src/qualite`,
  `gardesRequises`, `evaluerGarde`) ; aucun contenu R2 ou R3 n'atteint le client
  sans les validations requises.

## Conséquences positives

- La part de l'IA devient une mesure, pas une affirmation ; l'autonomie suit
  les résultats et se retire au premier incident.
- Un seul point d'appel aux modèles : sécurité, coût et trace restent
  centralisés.
- Les règles d'autonomie et de contribution sont des fonctions pures testées à
  100 %, rejouables pour un audit.

## Conséquences négatives

- Les évaluations de non-régression ont un coût IA récurrent à chaque
  changement de prompt ou de modèle : plafonné (2 USD par évaluation, 5 rejeux par
  cabinet et par 24 heures, plafond mensuel du cabinet), mais réel, payé avec la clé
  du cabinet ou celle de la plateforme.
- La file `jobs` est FIFO globale entre cabinets : un rejeu (8 minutes au plus, plus
  la durée d'un appel, soit 13 minutes au pire) retarde les autres jobs de tous les
  cabinets ; un rejeu par cabinet, donc plusieurs en même temps avec plusieurs cabinets.
- Aucune vérification réelle à ce jour : aucune clé OpenRouter n'existe en
  développement, le fournisseur réel n'a été exercé que contre un serveur factice
  local. La qualité d'un vrai modèle, les coûts et jetons réels et la comparaison du
  modèle servi (un identifiant daté renvoyé par OpenRouter ferait échouer le rejeu,
  sans danger) restent à constater au premier rejeu réel (SECURITY.md §15).
- La mesure par distance d'édition ignore la qualité sémantique : un
  relecteur peut garder la forme et changer le sens ; la revue guidée (QUA-03)
  reste indispensable.
- Les seuils (50 exécutions, 95 %, 90 jours, 25 %) sont des valeurs de départ
  à calibrer au pilote.

## Alternatives écartées

- **Agents autonomes avec outils libres (frameworks d'agents génériques)** —
  surface d'attaque par injection trop large, droits difficiles à borner,
  traçabilité incomplète.
- **Autonomie fixée une fois pour toutes par brique** — contraire au principe
  « l'autonomie se mérite et se retire ».
- **Mesure de contribution par auto-déclaration du consultant** — non
  vérifiable, biaisée.

## Liens

- PRD complémentaire, §7 (AGT-01 à AGT-11), §10, §16, §17 ; `docs/DECISIONS.md`.
- `packages/engines/src/autonomie/`, `packages/engines/src/contribution/`,
  `packages/engines/src/qualite/`.
- `apps/api/src/ia/orchestrateur.ts`, `apps/api/src/routes/agents.ts` (rempli
  par le lot AGT), `apps/api/src/agents/evaluations-openrouter.ts` et migration
  `0270` (rejeu réel).
- ADR-002 (file `jobs`), ADR-003 (OpenRouter), ADR-004 (référentiel de méthodes).
