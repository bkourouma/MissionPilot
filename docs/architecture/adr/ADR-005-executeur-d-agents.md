# ADR-005 : Exécuteur d'agents IA et niveaux d'autonomie

## Statut

Accepté

## Date

2026-10-08

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
  - **Nature du fournisseur local** : l'évaluation disponible aujourd'hui
    s'exécute sur un fournisseur LOCAL déterministe qui renvoie l'écho des
    messages rendus (`ia/fournisseur-local.ts`, `ia/evaluation.ts`). Réussie, elle
    prouve le câblage du prompt (rendu avec les variables du jeu, éléments exigés ou
    interdits par les critères, listes blanches de chiffres, sortie constructible selon
    le schéma) ; elle ne prouve ni la qualité rédactionnelle d'un modèle ni sa
    résistance à l'injection. Elle n'est donc admise que par le réglage de transaction
    `app.evaluation_locale_admise`, que l'API pose hors production seulement (migration
    `0265`) ; en production, seule une évaluation `openrouter` active un prompt ou un
    modèle.
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
  changement de prompt ou de modèle.
- Tant que le rejeu réel sur OpenRouter par la file `jobs` n'est pas construit,
  aucune évaluation `openrouter` n'existe : en production, aucun agent ne
  s'exécute (dette notée dans SECURITY.md §15 et HANDOFF.md).
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
  par le lot AGT).
- ADR-002 (file `jobs`), ADR-003 (OpenRouter), ADR-004 (référentiel de méthodes).
