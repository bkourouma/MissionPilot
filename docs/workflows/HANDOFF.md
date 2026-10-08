# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## Branche `feat/vague-2-automatisation` — 2026-10-08 (vagues 2 et 3 du PRD complémentaire)

**État :** les vagues 0 et 1 sont sur `main` (PR
[#5](https://github.com/bkourouma/MissionPilot/pull/5) et
[#6](https://github.com/bkourouma/MissionPilot/pull/6) fusionnées). Cette
branche porte le code des **vagues 2 et 3**, audité et corrigé, commité en dix lots
(`f9953a3` automatisation, `d53ad40` clôture, `491438e` salle de mission, `e0e0333`
prévisions, `6e7c1c7` notation augmentée, `5d97558` plans augmentés, `ed39fce` KPI,
`adeab6e` appels d'offres, `d8353f9` capitalisation, `bcd2487` intégration), puis un
commit de documentation. **Non poussée, aucune PR ouverte, aucune recette dans un
navigateur.** Les commits intermédiaires ne se compilent pas isolément (les
permissions, les exports et la liste blanche du portail sont dans le dernier commit
de code) ; seule la pointe de la branche est vérifiée.

**Vérifié le 2026-10-08 sur la pointe de la branche** : `eslint`, `tsc` (4 paquets) et
`pnpm format` verts ; shared 149 tests, moteurs 1077 (couverture 99,93 %), web 1334 ;
API 143 fichiers et 1563 tests (suite complète sur `missionpilot_test`, 1529 s).

**Livré (migrations `0300`–`0465`, 148 fichiers au total) :**

- **Vague 2** : automatisation (AUT-01 à 06 : événements, règles, versions, garde,
  coupe-circuits, simulation, brouillons ; `0300`–`0302`, ADR-006) ; clôture bloquante
  (AUT-08, `0320`–`0323`) ; salle de mission et dépôts du portail (CLI-01,
  `0330`–`0332`) ; prévisions (AUT-12) et pré-remplissage des temps (AUT-09) ;
  notation augmentée (NOT-09 à 13, 17 ; `0400`–`0404`) ; plans augmentés (PLA-12 à
  15, 17 et dossier bancaire ; `0420`–`0424`) ; pilotage des KPI (KPI-13, 15, 17, 18 ;
  `0440`–`0445`).
- **Vague 3** : appels d'offres (AO-01 à 08 ; `0360`–`0363`, `0380`–`0386`) ;
  capitalisation (CAP-01, 02, 05 à 07 ; `0460`–`0465`).
- **Audit des vagues 2 et 3** (dix agents en lecture seule, puis six agents de
  correction, 2026-10-08) : 0 critique, 21 constats Important corrigés ; le détail des
  règles est dans `SECURITY.md` (§5 quinquies, §5 sexies, §8 septies, §6 pour les
  SQLSTATE) et les valeurs posées par défaut dans `DECISIONS.md` (section « audit des
  vagues 2 et 3 »).

**Reste à faire (par priorité) :**

1. **Pousser la branche, ouvrir la PR** (la fusion reste à l'utilisateur) ; rejouer
   `pnpm db:migrate` sur les bases de développement existantes (les migrations
   `0300`–`0465` s'ajoutent ; les bases de test se recréent seules).
2. **Recette navigateur** de tous les écrans des vagues 0 à 3 (aucune faite) : portail
   (salle de mission, dépôts, KPI, factures, questionnaires), missions → clôture, KPI
   (arbres, revues, actions), notation (banque, calibration, analyse), plan (cascade,
   bibliothèque, portefeuille, bancabilité, dossier bancaire), appels d'offres et
   banques, connaissances (retours, estimation, compétences, recherche), prévisions,
   pré-remplissage des temps.
3. **Lacunes fonctionnelles de la vague 2** : brief quotidien (AUT-07) et copilote
   absents ; AUT-10 (rapport hebdomadaire client) et AUT-11 (staffing) non vérifiés ;
   `mission.cloture_demandee` est au catalogue d'événements mais **aucun code ne la
   publie** (l'automatisation standard « rappel de check-list » ne peut donc pas se
   déclencher) ; PLA-15, 16, 18, NOT-12 simulateur à confirmer ; AO-01 (veille
   multi-sources), CAP-03 et CAP-04 hors de ce qui est livré.
4. **Dettes de la vague 1 toujours ouvertes** : rejeu réel OpenRouter pour les
   évaluations de non-régression (file `jobs` plafonnée ; **sans lui aucun agent ne tourne
   en production**, ADR-005) ; QUA-05 ; DOS-05 ; STD-11 complet, STD-13, STD-14 ;
   extraction IA depuis un PDF (DOS-03) ; PRV-06 web ; AGT-06 cache, AGT-08 copilote,
   agent contradicteur ; `IMPORT_INVALIDE` du dossier à convertir en `AppError` ;
   génération d'un rapport d'état financier.
5. **Dettes nouvelles** (`CODING_STANDARDS.md` §10 et `SECURITY.md` §15) : accusé de
   réception de la salle traité hors file (non rejoué après un arrêt) ; comparer
   `executions.executant_id` au responsable courant dans le job d'agent d'une
   automatisation désactivée puis réactivée par un autre ; `semaineQuerySchema`
   (`temps.ts`) non borné (`GET /temps/preremplissage`, effet d'une semaine extrême non
   testé) ; listes plafonnées sans curseur ; ADR-009 (ingestion, OCR) cité mais absent ;
   unification de `normaliserLibelle` et `normaliserTerme` (moteurs AO) ; fichiers web de
   plus de 400 lignes et fonctions de plus de 60 lignes.
6. **Valeurs à faire valider** (posées par défaut, `DECISIONS.md`) : plafonds
   (50 automatisations actives, 30 simulations par 10 minutes, 20 dépôts par pièce, 500 Mo
   par demande, 30 dépôts du portail par 10 minutes, 20 dossiers et 50 extractions par
   fiche d'appel d'offres, 100 gabarits de CV, 30 propositions de portefeuille par
   10 minutes, 60 recherches par minute, 10 dossiers de revue par 10 minutes, 50 déclarations
   de niveau par couple) ; plancher de confiance NOT-11 (seuil 0,3, 2 répondants) ;
   estimation (effectif 3, statistiques détaillées dès 5) ; **conservation des CV de la
   banque d'appels d'offres : aucune durée automatique, anonymisation à la demande (avis du
   conseil juridique requis)** ; le gestionnaire n'a plus la rubrique « Connaissances ».

**Pièges :**

- **Tests API** : une base par agent (`DATABASE_URL` / `DATABASE_OWNER_URL` vers
  `missionpilot_<id>`, suffixe `_test` ajouté) ; le global-setup supprime et recrée le
  schéma de la base de test à chaque exécution ; jamais deux suites API en parallèle sur
  la même base. La suite complète dépasse 20 minutes ; lancer des fichiers ciblés pendant
  le développement. PostgreSQL du projet : conteneur `missionpilot-postgres` (port 55440).
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 (prochains numéros libres par
  domaine) ; un fichier qui référence une table d'un autre domaine a un numéro PLUS
  GRAND ; migrations commitées = immuables, on corrige par un nouveau fichier ; toute
  nouvelle colonne qui référence `fichiers` est couverte par l'inventaire automatique
  de `fichiers-orphelins-references.test.ts`.
- **Jobs** : toute constante `TYPE_JOB_*` exportée doit figurer dans `REGISTRE_JOBS`
  (`jobs-registre.test.ts`), sinon le worker rejette le job (c'était le cas des relances
  de la salle avant l'audit).
- **Dates métier** bornées par un CHECK SQL : `dateIsoBorneeSchema` (2000 à 2100).
- **Recherches mécaniques** de `.claude/rules/review-checklist.md` recalculées le
  2026-10-08 : 668 routes dont 8 sans `exiger` ; 547 `z.object`, tous stricts (le « 109 »
  vient d'un `rg` sans `-U`) ; 20 `GRANT EXECUTE` ; 5 `avecPlaceAnalyse(`.
- **Évaluations locales** d'agents : elles prouvent le câblage d'un prompt, pas la
  qualité d'un modèle (ADR-005) ; hors développement et test, elles n'activent rien.
- **Agents** : `dev-complex-high` (implémentation, Sonnet 5.5 effort high) et
  `code-reviewer`, `security-auditor` (lecture, effort medium) ; limite de 10 agents en
  parallèle ; un agent teste sur sa propre base ; aucun agent ne commite.
- Base de développement `missionpilot` : contient des données de recette ; le cabinet de
  démonstration Abidjan se crée par `db:seed-demo` (RUNBOOK). La date limite du
  questionnaire collectif de démonstration est dépassée à dessein (409 à la soumission) :
  à prolonger pour la recette.
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR` obligatoires ;
  `WEB_ORIGIN` = adresse exacte du web (sinon 403 `ORIGINE_REFUSEE`) ; `CHROMIUM_PATH`
  pour les PDF.

Valeurs métier de la V1 et de la V2 à faire valider (posées par défaut) : TVA 18 %,
retenue à la source désactivée, seuils d'approbation 5 M / 25 M / 10 M XOF (validés par
l'utilisateur le 2026-10-06), IS 25 %, actualisation 12 %, codes SYSCOHADA indicatifs,
libellés des classes A à E (`apps/web/src/lib/notation.ts`), modèles IA recommandés et
tarifs (`ia/modeles.ts`), taux USD de départ (`ia/couts.ts`), plafond IA 50 USD, suivi
KPI quotidien à 7 h UTC, conservation du texte IA 365 jours et des rapports 3 ans (**avis
du conseil juridique requis**), mention de la contribution IA activée par défaut.
Seuils de la vague 1 à calibrer au pilote : poids de fiabilité A–D, plafond 2 et seuils
0,75 / 0,5 de solidité ; promotion d'autonomie 50 exécutions / 95 % / 90 jours ;
modification majeure au-delà de 25 % ; incident majeur → N2.
