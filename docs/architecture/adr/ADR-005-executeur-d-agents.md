# ADR-005 : Exécuteur d'agents IA et niveaux d'autonomie

## Statut

Accepté

## Date

2026-10-08. Mis à jour le 2026-10-10 : le rejeu réel des évaluations sur
OpenRouter est construit (section « Évaluations de non-régression »). Mis à jour
le 2026-10-11 : le copilote conversationnel (AGT-08) est construit (section
« Copilote »).

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
  composant qui appelle un modèle pour produire un contenu. Chaque exécution passe par
  lui, avec la garde des chiffres, le masquage, le plafond de coût et la trace existants.
  Seule exception : le routage du copilote, qui ne produit aucun contenu (voir « Copilote
  conversationnel »).
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
- **Copilote conversationnel (AGT-08)** (migrations `0271` à `0274`,
  `apps/api/src/copilote/`, `routes/copilote.ts`, moteur pur
  `packages/engines/src/copilote`) : une seule interface pour interroger MissionPilot
  en français, dans les droits de l'utilisateur. Principe : **l'IA ROUTE, le code
  RÉPOND**.
  - **Le modèle ne voit aucune donnée.** Il reçoit le message de l'utilisateur
    (masqué, neutralisé puis encadré comme donnée non fiable, AGT-07) et le catalogue
    des seuls outils PERMIS à cet utilisateur ; il renvoie un choix strict
    `{ outil, parametres }` (schéma Zod strict sur liste fermée, sans identifiant).
    Toute autre sortie (JSON invalide, outil inconnu ou non permis) est refusée. La
    réponse affichée vient de gabarits déterministes du moteur à partir des services
    existants : jamais un texte ni un chiffre du modèle. **Mode sans IA** : sans
    activation de l'IA par le cabinet, sans `ia.utiliser`, sans clé, au plafond mensuel,
    en erreur ou sur sortie refusée, un routage déterministe du moteur répond
    (signalé « mode sans IA » avec sa raison). Les appels s'inscrivent dans
    `ia_consommations` (colonne `copilote`, `0272`, trois origines possibles : demande de
    génération, évaluation, échange du copilote) et comptent dans le plafond mensuel.
  - **Écart assumé avec « un seul point d'appel »** : le routage n'est PAS une demande de
    l'orchestrateur (pas de `ia_demandes`, pas de garde des chiffres puisque rien ne
    revient du modèle que le choix d'un outil) ; il réutilise néanmoins le fournisseur
    unique (`ia/fournisseur.ts`), le masquage, la neutralisation, les réservations de
    coût et le plafond de l'orchestrateur, avec une seule tentative par appel payant.
  - **Outils** : six outils de LECTURE (mes tâches, feuilles de temps à soumettre,
    résumé d'une mission, KPI au rouge de mes missions, factures échues, recherche
    unifiée CAP-07), chacun sous la permission de l'écran qui sert la même information
    et la visibilité des missions ; une seule ACTION modifiante, `creer_tache`.
  - **Action confirmée, jamais directe** : le copilote n'exécute JAMAIS une action
    modifiante. Il enregistre une proposition (`copilote_actions`, `0271` : paramètres
    déjà validés et résolus, résumé en français construit par le code, empreinte SHA-256,
    expiration à 5 minutes, états terminaux figés par `MPG10` et `MPG11`) ; la confirmation
    se fait par le MÊME utilisateur, une seule fois (ligne verrouillée), avant l'expiration,
    avec ses permissions revérifiées et l'empreinte relue, puis passe par le service
    commun de création de tâche (`collaboration/taches.ts`, aussi celui de
    `POST /taches-collaboration`), sous ses droits.
  - **Niveau d'autonomie N2 pour les actions** : proposer et confirmer exigent un niveau
    effectif de l'agent « copilote » d'au moins **N2** (409
    `COPILOTE_ACTION_NON_AUTORISEE`) ; la lecture reste permise dès N1 ; N0 ou
    l'agent désactivé arrêtent tout (409 `COPILOTE_DESACTIVE`). La proposition est le
    brouillon, la confirmation la validation humaine du niveau N2. Le registre standard
    (ajout seul) relève donc le plafond du copilote de N1 à N2 par une version 2
    (`0273`) ; un cabinet qui le plafonne à N1 interdit toute écriture. **Valeur à
    valider** (DECISIONS.md).
  - **Conservation** : le texte des propositions terminées est anonymisé au bout de
    30 jours (`0274`, fonction `SECURITY DEFINER` `anonymiser_copilote_actions`, bornée au
    cabinet du contexte, job `copilote_purge` à 02:30 UTC) ; aucune conversation n'est
    conservée et le journal ne contient jamais le texte d'un message.
  - **Limite** : le masquage repose sur des formats (adresses, numéros…), pas sur des
    noms : un nom propre tapé dans le message part en clair vers le fournisseur. Aucune
    vérification avec un vrai modèle n'a eu lieu (aucune clé) : la qualité du routage et le
    format JSON réel renvoyé ne sont pas vérifiés (SECURITY.md §15).

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
- Copilote : aucune vérification avec un vrai modèle (aucune clé en développement) ; seul
  un fournisseur factice a servi aux tests. La qualité du routage, le format JSON réel
  renvoyé et le coût réel d'un échange restent à constater ; en attendant, le routage
  déterministe du moteur couvre les formulations simples. Un nom propre saisi dans un
  message (collaborateur, client) part en clair au fournisseur. Les valeurs de départ
  (30 messages par 10 minutes et par utilisateur, 1 000 caractères, 5 minutes de validité
  d'une proposition, N2, 30 jours de conservation, 5 évaluations « KPI au rouge » par
  10 minutes) sont à valider (DECISIONS.md).
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
- **Copilote qui répond avec du texte de modèle, sur des données du cabinet** — enverrait
  des données de cabinet et de clients au fournisseur et rendrait possible un chiffre ou
  une affirmation non issus d'un moteur ; le routage seul (outil et paramètres) suffit
  à comprendre la demande.
- **Copilote qui exécute lui-même une action** — contraire à « toute action modifiante est
  confirmée » (PRD complémentaire §7) ; la proposition à confirmer, à usage unique, sépare
  la compréhension de la demande de l'écriture.

## Liens

- PRD complémentaire, §7 (AGT-01 à AGT-11), §10, §16, §17 ; `docs/DECISIONS.md`.
- `packages/engines/src/autonomie/`, `packages/engines/src/contribution/`,
  `packages/engines/src/qualite/`.
- `apps/api/src/ia/orchestrateur.ts`, `apps/api/src/routes/agents.ts` (rempli
  par le lot AGT), `apps/api/src/agents/evaluations-openrouter.ts` et migration
  `0270` (rejeu réel).
- Copilote (AGT-08) : migrations `0271` (propositions d'actions, `MPG10-11`), `0272`
  (origine « copilote » dans `ia_consommations`), `0273` (registre : plafond N2),
  `0274` (anonymisation et planification de la purge) ; `apps/api/src/copilote/`,
  `apps/api/src/routes/copilote.ts`, `apps/api/src/collaboration/taches.ts`,
  `packages/engines/src/copilote/` ; tests `apps/api/test/copilote*.test.ts`.
- ADR-002 (file `jobs`), ADR-003 (OpenRouter), ADR-004 (référentiel de méthodes).
