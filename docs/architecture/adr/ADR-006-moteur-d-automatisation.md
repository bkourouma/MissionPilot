# ADR-006 : Moteur d'automatisation (événements, règles, garde, journal)

## Statut

Acceptée

## Date

2026-10-08

## Contexte

Le PRD complémentaire (§8, AUT-01 à AUT-06) demande qu'un cabinet automatise
ses suites de travail (jalon atteint, questionnaire sans réponse, KPI au rouge,
clôture demandée) sans code, et que ces automatisations ne contournent ni les
droits, ni les séparations des tâches, ni la validation humaine. Les modules
existants (missions, questionnaires, KPI, facturation, agents IA) ont chacun
leur circuit d'approbation ; une automatisation qui écrit « pour eux » est donc
le point où ces garanties peuvent se perdre.

Contraintes qui pèsent sur la décision (AGENTS.md, « Règles propres au
projet ») :

- **Isolation entre cabinets** : tout est sous la sécurité au niveau des lignes
  du cabinet ; rien n'est visible du portail client.
- **L'IA propose, l'expert dispose** : aucun contenu R2 ou R3 n'atteint un
  client par une automatisation ; l'autonomie N4 vers les clients est limitée à
  la classe R0, avec un coupe-circuit par cabinet (DECISIONS.md, 2026-10-08 ;
  ADR-005).
- **Pas de chiffre produit par un modèle** : une action ne calcule rien ; elle
  appelle les services qui s'appuient sur `packages/engines`.
- **Écriture métier d'abord** : publier un événement ne doit jamais faire
  échouer l'écriture du module qui le publie (jalon coché, mission signée,
  questionnaire clos).
- **File de tâches** : ADR-002 (table `jobs` PostgreSQL, `FOR UPDATE SKIP
  LOCKED`) ; pas de courtier de messages.

## Décision

- **Événements publiés par les modules, de façon non bloquante.** Un catalogue
  fermé d'événements (`CATALOGUE_EVENEMENTS`,
  `packages/shared/src/schemas/automatisation.ts` : `mission.signee`,
  `mission.jalon_atteint`, `mission.cloture_demandee`, `questionnaire.clos`,
  `questionnaire.sans_reponse`, `kpi.rouge_deux_periodes`) déclare pour chaque
  code ses champs typés ; le contenu n'admet que des valeurs scalaires (aucun
  objet, aucun montant). Trois sources alimentent la table
  `automatisation_evenements` (migration `0301`), toutes **idempotentes par clé**
  (unique par cabinet) :
  - un **déclencheur SQL** `AFTER UPDATE` sur la table du module (jalon atteint,
    mission signée, questionnaire clos ; `0302`), **non bloquant** : toute erreur
    est absorbée par une sous-transaction plpgsql et l'écriture métier se
    poursuit ; rien n'est publié depuis une transaction du portail client ;
  - le **service interne** `publierEvenement` (`automatisation/evenements.ts`),
    destiné à être appelé dans la transaction du module : il ne lève jamais, un
    `SAVEPOINT` annule la seule publication et l'incident est consigné côté
    serveur. Au 2026-10-08, seule la détection quotidienne l'appelle : aucun
    module ne publie `mission.cloture_demandee`, présent au catalogue et dans la
    bibliothèque standard mais sans émetteur (écart connu, voir ci-dessous) ;
  - la **détection quotidienne** des événements nés du temps (questionnaire
    resté sans réponse aux paliers J+3, J+7, J+10, J+14 ; KPI rouge deux
    périodes de suite) : job `automatisation_detection` planifié une fois par
    jour (clé `automatisation_detection:AAAA-MM-JJ`, 7 h 30 UTC) par une fonction
    `SECURITY DEFINER` étroite (`planifier_detection_automatisation`, `0302`) ;
    les décisions « dû ou non » viennent du moteur
    (`packages/engines/src/automatisation/detection.ts`), l'API ne fait que
    publier.
- **Règles déclencheur → conditions → actions** (AUT-02). Une automatisation
  écoute un code d'événement ; sa condition est un arbre typé (`tous`,
  `au_moins_un`, `non`, `comparaison`, `renseigne` ; profondeur 4, 30 nœuds)
  évalué par le moteur pur sur le contenu NORMALISÉ de l'événement (champs
  déclarés seulement) ; ses actions (10 au plus) sont choisies dans un
  **registre fermé** (`REGISTRE_ACTIONS_AUTOMATISATION` : créer une tâche,
  notifier, brouillon tracé, facture en brouillon, appeler un agent IA, relancer
  les répondants d'un questionnaire). Chaque entrée du registre dit la
  permission exigée, la classe de risque, si l'action atteint le client et si
  elle s'annule. Les textes sont des gabarits qui ne citent que les champs de
  l'événement. Une bibliothèque standard (AUT-03, quatre automatisations)
  s'ajoute au cabinet inactive.
- **Versions immuables.** La définition vit dans `automatisation_versions`
  (ajout seul) ; l'en-tête `automatisations` ne porte que l'état courant (active,
  version courante, responsable). Une modification de définition ajoute une
  version ; l'historique n'est jamais réécrit (`MPU01`).
- **Garde d'une action** (AUT-05), fonction pure
  `garderActionAutomatisation` (`packages/engines/src/automatisation/garde.ts`),
  appliquée à chaque action AVANT exécution et enregistrée avec elle : aucun
  coupe-circuit actif (cabinet, automatisation, N4 pour tout envoi au client) ;
  vers le client, classe R0 seulement (R2 et R3 jamais, N4 réservé à R0) ; pour
  l'appel d'un agent, niveau d'autonomie effectif de sa brique au moins N2 ;
  l'exécutant détient la permission de l'action ; l'exécutant voit la mission de
  l'événement. Tous les refus sont listés. La règle « vers le client hors R0 »
  est doublée en base (`MPU04`).
- **Exécution sous l'identité du responsable.** Une automatisation s'exécute avec
  les droits ACTUELS (relus à chaque exécution) de son **responsable**, la
  personne qui l'a ACTIVÉE (`mode_execution = responsable`, par défaut) ; pour un
  événement qui a une personne à son origine, le mode `declencheur` exécute dans
  les droits de cette personne (une personne du portail client n'est jamais
  exécutant). Pour que ce principe tienne, **toute modification de la définition
  d'une automatisation active la désactive** dans la même transaction, la
  réactivation rendant son auteur responsable : sans cela, un directeur de
  mission sans `facture.emettre` ferait créer des brouillons de facture sous
  l'identité d'un associé. Seuls nom et description se modifient sans effet.
- **Coupe-circuits** (AUT-06) : un par cabinet (arrête toutes les
  automatisations) et un par automatisation, en ajout seul ; couper exige
  `automatisation.gerer`, **lever est réservé à un associé** (doublé en base,
  `MPU02`). Le coupe-circuit N4 des agents IA (ADR-005) bloque en plus tout envoi
  automatique au client. Un événement traité pendant la coupure est journalisé
  « bloqué » et n'est pas rejoué à la levée ; l'appel d'un agent, parti dans sa
  propre file, relit les coupe-circuits et l'activation avant d'appeler le modèle.
- **Simulation sans effet** (AUT-04) : une définition (brouillon ou existante)
  est rejouée par le moteur sur les événements passés de son code, avec la même
  garde (droits et visibilité de l'exécutant, coupe-circuits actuels, niveau des
  agents), sans aucune écriture métier ; l'automatisation naît inactive et seuls
  les événements postérieurs à son activation la déclenchent. Débit plafonné par
  utilisateur.
- **Jobs de la table `jobs`** (ADR-002) : le traitement d'un événement
  (`automatisation_evenement`, clé unique par événement), l'appel d'un agent
  (`automatisation_agent`, une seule tentative, pour ne pas appeler deux fois un
  modèle payant) et la détection quotidienne sont des jobs enregistrés dans
  `REGISTRE_JOBS` (`apps/api/src/jobs/registre.ts`). Le job d'événement tourne
  dans le contexte RLS du cabinet ; chaque action s'exécute dans un `SAVEPOINT` :
  l'échec de l'une n'annule pas les autres. Les notifications créées sont
  renvoyées au worker, qui envoie les e-mails après validation.
- **Journal d'exécutions en ajout seul** (AUT-06) : événements, exécutions
  (issue : déclenchée, conditions non remplies, bloquée), actions avec leur
  décision de garde et leur clé d'idempotence (cabinet, automatisation,
  événement, rang), résultats, annulations et brouillons tracés sont des tables
  sans `UPDATE` ni `DELETE` (`MPU01`). Une exécution est unique par
  (automatisation, événement) et une action par clé : un job rejoué ne refait
  rien. La lecture est soumise à la visibilité des missions.
- **Annulation quand c'est possible** : seules les actions marquées annulables
  dans le registre (facture en brouillon, brouillon tracé), réussies et pas déjà
  annulées s'annulent, une fois (`MPU03`), par la permission de gestion des
  automatisations ET celle de l'action ; l'effet est défait par le même circuit
  qu'un humain (facture encore en brouillon supprimée, brouillon annulé). Un
  brouillon tracé reçoit une décision humaine unique (validé, modifié, rejeté).
- **Plafonds de départ** : 50 automatisations actives par cabinet (verrou
  consultatif à l'activation), 30 simulations par utilisateur sur 10 minutes
  (DECISIONS.md, « Précisions issues de l'audit des vagues 2 et 3 », à valider).

## Conséquences positives

- Les garanties du dépôt (droits, visibilité, séparation des tâches, validation
  humaine, classes de risque) se vérifient en UN point (la garde) et sont
  rejouables : la simulation et l'exécution utilisent le même code.
- Publier un événement ne peut pas casser une écriture métier ; une panne du
  moteur laisse l'application utilisable.
- Le journal prouve ce qui a été décidé, par qui, selon quelle version, et ce
  qui a été refusé et pourquoi.
- Pas de composant à exploiter de plus : la file `jobs` et PostgreSQL suffisent
  (ADR-002).

## Conséquences négatives

- Un événement publié par déclencheur SQL dont l'insertion échoue est perdu
  (seul un avertissement est émis) : le choix « non bloquant » prime sur
  l'exhaustivité ; la détection quotidienne rattrape seulement les événements
  nés du temps.
- Désactiver l'automatisation à chaque changement de définition force une
  réactivation (donc un changement de responsable) pour des corrections
  mineures de texte.
- Un événement traité pendant un coupe-circuit n'est pas rejoué à la levée :
  une automatisation coupée perd les événements de la période (choix sûr,
  documenté dans l'écran).
- Écart connu : `mission.cloture_demandee` n'a pas d'émetteur dans le code
  (la clôture n'appelle pas `publierEvenement`) ; l'automatisation standard
  « rappel de check-list à la clôture » ne se déclenche donc pas tant qu'un
  module ne la publie pas.
- Le catalogue d'événements et le registre d'actions sont fermés : toute
  nouvelle action ou tout nouvel événement est un changement de code, de test et
  de migration, pas une configuration.
- Les plafonds (50 actives, 30 simulations par 10 minutes, 500 événements
  rejoués par simulation) sont des valeurs de départ à calibrer.
- Le niveau « appeler un agent » exige un agent à niveau effectif N2 : tant
  qu'aucun agent n'est évalué sur un vrai modèle en production (ADR-005), cette
  action est refusée par la garde.

## Alternatives écartées

- **Courtier de messages ou bus d'événements externe (Redis, NATS…)** — un
  composant de plus à exploiter, une garantie de livraison à re-démontrer ; la
  table `jobs` donne déjà l'exécution unique (ADR-002).
- **Publication par un service appelé après l'écriture, sans déclencheur SQL** —
  un module oublié ou un chemin d'écriture contourné ne publierait rien ; le
  déclencheur couvre toutes les écritures des tables observées.
- **Publication bloquante (l'échec de l'événement annule l'écriture métier)** —
  une panne du moteur d'automatisation bloquerait la facturation ou la clôture.
- **Exécution avec un compte système aux droits étendus** — contourne les
  séparations des tâches : une automatisation pourrait faire ce qu'aucun
  humain du cabinet n'a le droit de faire. L'identité d'un humain, relue à
  chaque exécution, garde les droits dans leurs limites.
- **Actions libres (scripts, appels HTTP, SQL) écrites par le cabinet** — surface
  d'attaque et d'injection incontrôlable (AGT-07) ; un registre fermé d'actions
  typées reste auditable.
- **Modification d'une version en place** — ferait exécuter un texte différent de
  celui qui a été simulé et validé ; la version immuable permet de relire ce qui
  a tourné.
- **Rejeu des événements bloqués à la levée du coupe-circuit** — pourrait
  déclencher en rafale, vers des clients, des actions devenues sans objet.

## Liens

- PRD complémentaire, §8 (AUT-01 à AUT-06) ; `docs/DECISIONS.md` (autonomie N4
  limitée à R0 ; « Précisions issues de l'audit des vagues 2 et 3 »).
- `packages/engines/src/automatisation/` (conditions, garde, planification,
  simulation, détection, gabarits) ; `packages/shared/src/schemas/automatisation.ts`.
- `apps/api/src/automatisation/` (`evenements.ts`, `execution.ts`, `actions.ts`,
  `regles.ts`, `coupe-circuits.ts`, `simulation.ts`, `journal.ts`,
  `detection.ts`), `apps/api/src/routes/automatisation.ts`,
  `apps/api/src/jobs/registre.ts`.
- Migrations `0300` (règles, versions, coupe-circuits), `0301` (événements,
  exécutions, actions, résultats, annulations, brouillons), `0302` (publication
  par la base, planification de la détection) ; SQLSTATE `MPU01` à `MPU05`.
- ADR-002 (file `jobs`), ADR-005 (exécuteur d'agents, N4 et coupe-circuit),
  `docs/governance/SECURITY.md`.
