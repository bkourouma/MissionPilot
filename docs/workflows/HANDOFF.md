# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## Branche `feat/rejeu-openrouter` — 2026-10-10 (chantier n° 1 : rejeu réel des évaluations d'agents)

**État :** `main` porte les vagues 0 à 3 (PR #7 fusionnée le 2026-10-10, merge commit
`b32c089`, vérifiée par une recette navigateur réelle). Cette branche, créée depuis `main`,
construit le **rejeu réel sur OpenRouter** des évaluations de non-régression (AGT-04, ADR-005) :
sans lui, aucun agent ne pouvait s'exécuter en production. Code, écran web, audit de sécurité
(0 critique, 3 importants corrigés) et documentation faits ; **PR à ouvrir, fusion non
autorisée** (l'accord de l'utilisateur couvrait la PR #7 seulement : demander au chef).

**Livré :** job `agents_evaluation_openrouter` (clé unique par demande, une seule tentative,
jamais de nouvel appel payant), table `agents_evaluations_demandes` (migration `0270`, SQLSTATE
`MPG09`), routes `POST /api/agents/prompts/:promptId/evaluations/openrouter` (`agent.gerer`) et
`GET …/evaluations/openrouter` (`agent.lire`), écran `/agents/evaluations`, garde de provenance
en base (une évaluation `openrouter` vient d'une demande et d'appels inscrits), plafonds de
coût (par évaluation, mensuel du cabinet), un rejeu en file ou en cours par cabinet, 5 rejeux par
24 h. Détail : ADR-005, `SECURITY.md` §7 bis et §15, `DECISIONS.md` (section « Rejeu réel
OpenRouter », toutes valeurs « à valider »).

**NON vérifié (à dire à chaque compte rendu) :** aucune clé OpenRouter n'existe dans
l'environnement de développement ; le vrai fournisseur n'a été exercé que contre un serveur
factice local. Un appel réel, la qualité d'un vrai modèle, les coûts et jetons réels et la
comparaison du modèle servi ne sont PAS vérifiés. Pour le faire : une clé OpenRouter de test dans
les paramètres IA d'un cabinet de recette, un jeu d'essai de quelques cas, puis lancer un rejeu
depuis `/agents/evaluations` (coût plafonné à 2 USD) ; l'écran n'a pas non plus été ouvert dans
un navigateur.

**Décisions de l'utilisateur (2026-10-10, relayées par le chef d'orchestre)** : conservation des
CV de la banque d'appels d'offres **ouverte, ne rien fixer avant l'avis du conseil juridique** ;
valeurs par défaut de `DECISIONS.md` laissées en l'état (provisoires) ; ordre des chantiers :
(1) rejeu OpenRouter (cette branche), (2) lacunes de la vague 2 (brief quotidien AUT-07,
copilote, événement `mission.cloture_demandee`), (3) vague 4. Compte rendu court au chef à la fin
de chaque chantier. Aucune CI GitHub n'existe sur ce dépôt : la vérification est locale
(eslint, tsc, Prettier, tests des 4 paquets).

**Reste à faire (par priorité) :**

1. **Ouvrir la PR du rejeu**, rendre compte au chef, attendre sa décision de fusion ; après
   fusion : `pnpm db:migrate` sur les bases de **développement** (`missionpilot`,
   `missionpilot_demo`, `missionpilot_recette`), supprimer cette section.
2. **Lacunes de la vague 2** (chantier n° 2) : brief quotidien (AUT-07) et copilote absents ;
   `mission.cloture_demandee` est au catalogue d'événements mais aucun code ne la publie
   (l'automatisation standard « rappel de check-list » ne peut pas se déclencher) ; AUT-10
   (rapport hebdomadaire client) et AUT-11 (staffing) non vérifiés ; PLA-15, 16, 18, NOT-12
   (simulateur), CAP-03, CAP-04, AO-01 (veille multi-sources) hors de ce qui est livré.
3. **Vague 4** (chantier n° 3) : services #2 et #5 augmentés, voix et WhatsApp, signature
   électronique (PRD complémentaire §18).
4. **Dettes de la vague 1** : QUA-05 ; DOS-05 ; STD-11 complet, STD-13, STD-14 ; extraction IA
   depuis un PDF (DOS-03) ; PRV-06 web ; AGT-06 cache, AGT-08 copilote, agent contradicteur ;
   `IMPORT_INVALIDE` du dossier à convertir en `AppError` ; rapport d'état financier.
5. **Dettes du rejeu** (`SECURITY.md` §15) : file `jobs` FIFO partagée entre cabinets (un rejeu
   de 8 à 13 min retarde les jobs de tous : piste d'une file dédiée aux jobs longs) ; garde de
   provenance contournable par du SQL arbitraire du même rôle applicatif (fonction SECURITY
   DEFINER réservée au job, non faite) ; liaison du modèle routé à l'activation (`prompt_evalue`
   avec `p_modele NULL`, antérieur au chantier ; filet à l'exécution) ; la liste des versions de
   prompt de l'écran vient d'une route qui exige `ia.utiliser`.
6. **Autres dettes** (`CODING_STANDARDS.md` §10, `SECURITY.md` §15) : accusé de réception de la
   salle traité hors file ; `executions.executant_id` à comparer au responsable courant dans le
   job d'agent d'une automatisation réactivée par un autre ; `semaineQuerySchema` (`temps.ts`) non
   borné ; dix pages web qui lisent `/api/missions` ou `/api/opportunites` demandent des pages de
   200 (au lieu de 500) ; génération « gabarit » d'un retour d'expérience qui remplace le texte
   rédigé ; pied de page « relu et validé par un consultant » sur un dossier de revue KPI en
   brouillon ; montants du PDF du dossier bancaire sans séparateur de milliers visible à
   l'extraction texte (le moteur insère U+202F : à vérifier à l'œil) ; un 503 signalé par le réseau
   sur l'export de CV alors que le fichier est valide ; champ d'échéance de la salle qui garde la
   valeur refusée après un échec ; messages d'erreur de formulaire qui persistent jusqu'au prochain
   envoi ; ADR-009 (ingestion, OCR) citée mais absente ; fichiers web de plus de 400 lignes et
   fonctions de plus de 60 lignes.
7. **Valeurs provisoires** (`DECISIONS.md`, laissées en l'état) : plafonds (50 automatisations
   actives, 30 simulations par 10 minutes, 20 dépôts par pièce, 500 Mo par demande, 30 dépôts du
   portail par 10 minutes, 20 dossiers et 50 extractions par fiche d'appel d'offres, 100 gabarits
   de CV, 30 propositions de portefeuille par 10 minutes, 60 recherches par minute, 10 dossiers de
   revue par 10 minutes, 50 déclarations de niveau par couple) ; plancher de confiance NOT-11
   (seuil 0,3, 2 répondants) ; estimation (effectif 3, statistiques détaillées dès 5) ; rejeu
   OpenRouter (2 USD par évaluation, 5 rejeux par 24 h, 8 min, péremptions 1 h et 30 min) ; les
   jours de budget sont visibles d'un consultant dans la section « Écarts » d'un retour (FIN-02 ne
   vise que les montants : à confirmer).

**Pièges :**

- **Serveurs de recette** : lancer l'API et le web comme processus DÉTACHÉS (PowerShell
  `Start-Process`) sous un nom d'exécutable distinct (copie de `node.exe` renommée) : une
  commande qui tue `node.exe` les arrêtait en pleine recette (deux fois). L'API met ~40 s à
  répondre ; le premier chargement d'une page en mode dev prend 10 à 60 s. Trois origines
  (`localhost`, `127.0.0.1`, `[::1]`) ont des cookies séparés et sont acceptées par la garde
  d'origine : jusqu'à trois testeurs en parallèle. Le groupe d'onglets de l'extension Chrome est
  partagé entre les testeurs : chacun doit créer son onglet et vérifier l'origine avant d'agir.
  Les serveurs de recette tournent sur `missionpilot_recette` : l'API de recette n'a PAS la
  migration `0270` ni le code de cette branche tant qu'elle n'est pas redémarrée dessus.
- **Next dev** : un bloc dupliqué dans un fichier par deux éditions concurrentes cassait la
  compilation d'une page ; le typecheck global le détecte : le relancer après tout lot d'agents
  parallèles avant de commiter.
- **Page serveur** : ne jamais passer une FONCTION à un composant client (propriétés
  sérialisables seulement ; cas de `/methodes/[id]`, corrigé par `versionDans`).
- **Tests API** : une base par agent (`DATABASE_URL` / `DATABASE_OWNER_URL` vers
  `missionpilot_<id>`, suffixe `_test` ajouté) ; le global-setup supprime et recrée le schéma de
  la base de test à chaque exécution ; jamais deux suites API en parallèle sur la même base ; la
  suite complète dure 20 à 47 minutes (la lancer détachée). PostgreSQL du projet : conteneur
  `missionpilot-postgres` (port 55440), à relancer par `pnpm db:up` après un redémarrage de
  Docker. Les bases `missionpilot_*_test` créées par les agents s'accumulent : à purger.
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 (prochain AGT libre : `0271`) ; un fichier
  qui référence une table d'un autre domaine a un numéro PLUS GRAND ; migrations commitées =
  immuables ; toute nouvelle colonne qui référence `fichiers` est couverte par l'inventaire
  automatique de `fichiers-orphelins-references.test.ts`.
- **Jobs** : toute constante `TYPE_JOB_*` exportée doit figurer dans `REGISTRE_JOBS`
  (`jobs-registre.test.ts`).
- **Dates métier** bornées par un CHECK SQL : `dateIsoBorneeSchema` (2000 à 2100).
- **Recherches mécaniques** de `.claude/rules/review-checklist.md` : à relancer avant chaque
  livraison (673 routes dont 8 sans `exiger`, 550 `z.object` tous stricts, 20 `GRANT EXECUTE`).
- **Évaluations locales** d'agents : elles prouvent le câblage d'un prompt, pas la qualité d'un
  modèle (ADR-005) ; hors développement et test, elles n'activent rien.
- **Agents** : `dev-complex-high` (implémentation, Sonnet 5.5 effort high), `code-reviewer`,
  `security-auditor`, `ui-tester` (lecture, recette) ; limite de 10 agents en parallèle ; un
  agent teste sur sa propre base ; aucun agent ne commite.
- Base de développement `missionpilot` : contient des données de recette ; le cabinet de
  démonstration Abidjan se crée par `db:seed-demo` (RUNBOOK). Base de recette
  `missionpilot_recette` (cabinet Lagune, comptes de démonstration, connexion rapide sans mot de
  passe avec `CONNEXION_RAPIDE_DEMO=oui`) : données préfixées RECETTE-A à RECETTE-R3 laissées par
  la recette ; la mission « Kora » y est clôturée.
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR` obligatoires ;
  `WEB_ORIGIN` = adresse exacte du web (sinon 403 `ORIGINE_REFUSEE`) ; `CHROMIUM_PATH` pour les
  PDF.

Valeurs métier de la V1 et de la V2 à faire valider (posées par défaut) : TVA 18 %, retenue à la
source désactivée, seuils d'approbation 5 M / 25 M / 10 M XOF (validés par l'utilisateur le
2026-10-06), IS 25 %, actualisation 12 %, codes SYSCOHADA indicatifs, libellés des classes A à E
(`apps/web/src/lib/notation.ts`), modèles IA recommandés et tarifs (`ia/modeles.ts`), taux USD de
départ (`ia/couts.ts`), plafond IA 50 USD, suivi KPI quotidien à 7 h UTC, conservation du texte IA
365 jours et des rapports 3 ans (**avis du conseil juridique requis**), mention de la contribution
IA activée par défaut. Seuils de la vague 1 à calibrer au pilote : poids de fiabilité A–D, plafond 2
et seuils 0,75 / 0,5 de solidité ; promotion d'autonomie 50 exécutions / 95 % / 90 jours ;
modification majeure au-delà de 25 % ; incident majeur → N2.
