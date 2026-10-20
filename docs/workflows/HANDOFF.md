# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---
## Situation de `main` — 2026-10-20 (vague 4 fusionnée)

**État :** `main` = `3d5a252`. Il porte les vagues 0 à 3 (PR n° 7), le rejeu OpenRouter (n° 8), le brief,
le copilote et l'événement de clôture demandée (n° 9) et la **vague 4** fusionnée le 2026-10-20 par
l'utilisateur, dans l'ordre et en merge commit : n° 12 lot 3a **redressement** (`23c0e1c`), n° 13 lot 3b
**due diligence** (`777c9aa`), n° 14 lot 3c **canaux, signatures et transcriptions simulés** (`3d5a252`).
L'arbre de `main` est identique à la tête validée du lot 3c (`fb83e46`). ADR-008, 010, 011, 012 et 013
acceptées le 2026-10-14 (mode simulé seulement pour 008, 010 et 013). 180 migrations.

**Ménage post-fusion fait (2026-10-20)** : `pnpm install` sur `main` ; `pnpm db:migrate` sur les trois
bases de développement (`missionpilot`, `missionpilot_demo`, `missionpilot_recette` : 180 migrations,
0480–0548 appliquées) ; worktrees `.claude/worktrees/{redressement,dd,canaux}` et branches locales
supprimés (les branches distantes restent). **Non fait** : purge des ~75 bases `missionpilot_*_test` et
des bases de recette `missionpilot_{rec2fa,rec3b,rec3c,recint,canaux2,tfa,v6}` (suppression de données :
accord de l'utilisateur requis) ; arrêt des serveurs de recette `mp-node.exe` s'ils tournent encore
(aucun n'a été vu le 2026-10-20 à 13:30).

**Vérifié avant fusion** (sur la pointe de chaque lot, une suite API à la fois) : Prettier, eslint,
typecheck ; API 3a 1961 tests, 3b 2187 (1 échec `kpi-alertes`, instable sous charge, vert seul), 3c 2313
verts ; web 1808 ; build de production ; audits de sécurité des trois lots (0 critique, importants
corrigés) ; recette navigateur du 2026-10-20 sans bloquant ; signature menée de bout en bout par script
avec les comptes de démonstration à 2FA (`associe.2fa@`, `dirigeant.client.2fa@`, `db:code-2fa-demo`).
La suite API n'a pas été rejouée après les correctifs de recette du 2026-10-20 (web seulement).

**NON vérifié** : tout vrai fournisseur (OpenRouter, signature, WhatsApp/SMS, transcription : aucune clé,
aucun envoi) ; mise en page mobile ; rafraîchissement d'écran après écriture (fiche créancier, notes,
verdicts, signatures) **à confirmer devant un écran affiché** : le serveur rend les données à jour mais le
DOM ne changeait pas dans un navigateur masqué ; erreur React n° 418 vue une fois, non reproduite ;
`/agents/evaluations` jamais ouvert ; simulateur WhatsApp et saisie KPI par messagerie dans le navigateur.

**Décisions qui attendent l'utilisateur** :

- PRD complémentaire §21 : n° 4 (autonomie N4 vers les clients), n° 6 (services candidats : recommandé
  diagnostic flash puis business plan bancable), n° 7 (attestation vérifiable), n° 8 (WhatsApp Business).
- Clé OpenRouter de test ; fournisseurs réels de signature, messagerie, transcription (SPEC-3c §17,
  O-01 à O-27) ; hébergement et déploiement (aucune cible choisie).
- Juridique : conservation (CV des appels d'offres, texte IA, rapports, données du client),
  RED-13 (repères OHADA), valeur probante de la signature, consentements, ARTCI.
- Expert métier : seuils d'alerte par secteur et grille d'urgence du redressement, modèles sectoriels
  DD-07 ; FIN-02 sur les montants du client en redressement ; validation du plan de redressement
  réservée au directeur de la mission ou non.
- Valeurs provisoires de `DECISIONS.md` (plafonds, débits, seuils ; liste ci-dessous).

**Reste à faire — plan par lots (ordre conseillé ; chaque lot : branche depuis `main`, eslint, tsc,
Prettier, tests des 4 paquets, suite API complète, audit en lecture seule, recette navigateur, PR) :**

- **B — Consolidation avant pilote** : dettes de sécurité de `SECURITY.md` §15 (file `jobs` FIFO partagée
  entre cabinets → équité par cabinet ; garde de provenance par fonction `SECURITY DEFINER` réservée au
  job ; débit du brief tenu en mémoire → PostgreSQL ; routage du copilote via `orchestrateur.ts` ;
  masquage des noms propres vers le modèle ; liaison du modèle routé à l'activation) ; `IMPORT_INVALIDE`
  en `AppError` ; `semaineQuerySchema` borné ; pages de 200 sur `/api/missions` et `/api/opportunites` ;
  confirmation du rafraîchissement client et de l'erreur n° 418 sur écran affiché ; mineurs repoussés des
  recettes (vague 2 : copilote ; 3a : libellés « prévu », marge en points, note vide, secteur non prérempli,
  seuils v1 jamais « Remplacée » ; 3b : `role="tree"`, noms de fichiers des rapports, code `dd.pestel.*`
  affiché ; 3c : en-tête `attachment`) ; fichiers web de plus de 400 lignes ; tests instables
  `kpi-alertes` et `salle-mission-durcissement`.
- **C — Lacunes fonctionnelles V3** : AUT-10 (rapport d'avancement hebdomadaire au client) ; copilote
  étendu (registre `ACTIONS`) et sources du brief écartées ; dettes de la vague 1 (QUA-05, DOS-05, STD-11
  complet, STD-13, STD-14, PRV-06 web, AGT-06 cache et agent contradicteur, rapport d'état financier) ;
  vague 3 non livrée (PLA-15, 16, 18, NOT-12 simulateur, CAP-03, CAP-04, AO-01 veille multi-sources).
- **D — ADR-009 ingestion et OCR** : à rédiger puis livrer ; débloque DOS-03 (extraction IA d'un PDF),
  DD-02 (import de rapports), DD-10 (lecture IA de la salle de données).
- **E — Suites des services de la vague 4** : 3a-bis (RED-03 check-lists, RED-04 causes racines par IA,
  RED-08 rapport de clôture et re-notation, RED-09 suivi post-mission, RED-15 tableau partagé, trésorerie
  mensuelle et covenants, seed, « voyant rouge » dans le brief et l'automatisation) ; 3b-bis (portail
  investisseur, DD-07 dès que le contenu expert existe) ; 3c-bis (branchement `kpi/suivi.ts` O-26, seeds,
  média entrant en flux, SPEC-3c lignes 430 et 1109 à aligner).
- **F — Services candidats** (après la décision n° 6) : par assemblage de briques du référentiel de
  méthodes, sans code spécifique quand c'est possible.
- **G — Industrialisation et pilote V1** : CI GitHub (aucune aujourd'hui), cible d'hébergement et
  déploiement (accord requis), sauvegardes et restauration, observabilité, SMTP réel, vérification mobile,
  recette E2E complète, jeu de démonstration ; jalon du PRD : pilote dans 2 à 3 cabinets (fin mars 2027).
- **H — Branchements réels** (bloqués par les décisions ci-dessus) : OpenRouter réel, adaptateurs de
  signature, messagerie et transcription, connecteurs DD-02 ; AUT-11 (staffing, V4).
- **I — Vague 5 Réseau** (condition : 10 cabinets adhérents) : observatoire, attestation vérifiable,
  place de marché des méthodes, connecteurs, marque blanche.

**Valeurs provisoires** (`DECISIONS.md`, laissées en l'état) : plafonds des vagues 2 et 3 (50
automatisations actives, 30 simulations par 10 minutes, 20 dépôts par pièce, 500 Mo par demande, 30 dépôts
du portail par 10 minutes, 20 dossiers et 50 extractions par fiche d'appel d'offres, 100 gabarits de CV,
30 propositions de portefeuille par 10 minutes, 60 recherches par minute, 10 dossiers de revue par
10 minutes, 50 déclarations de niveau par couple) ; plancher de confiance NOT-11 (0,3, 2 répondants) ;
rejeu OpenRouter (2 USD par évaluation, 5 rejeux par 24 h, 8 min, péremptions 1 h et 30 min) ; brief
(seuils de gravité, 60 requêtes par 10 minutes, lots de 500, anti-répétition de 10 minutes) ; copilote
(30 messages par 10 minutes, 1000 caractères, 5 minutes, N2, 30 jours, purge à 02:30 UTC) ; valeurs des
sections « Redressement », « Due diligence » et « Canaux » ; jours de budget visibles d'un consultant
dans « Écarts » (FIN-02 ne vise que les montants : à confirmer).

**Pièges :**

- **Serveurs de recette** : lancer l'API et le web comme processus DÉTACHÉS (PowerShell
  `Start-Process`) sous un nom d'exécutable distinct (copie de `node.exe` renommée) : une commande qui
  tue `node.exe` les arrêtait en pleine recette. L'API met ~40 s à répondre ; le premier chargement
  d'une page en mode dev prend 10 à 60 s. Trois origines (`localhost`, `127.0.0.1`, `[::1]`) ont des
  cookies séparés et sont acceptées par la garde d'origine : jusqu'à trois testeurs en parallèle. Le
  groupe d'onglets de l'extension Chrome est partagé entre les testeurs : chacun crée son onglet et
  vérifie l'origine avant d'agir. Le navigateur intégré de l'application Claude a cessé de répondre
  pendant la recette (volet masqué) : Chrome (extension) a été utilisé.
- **Next dev** : un bloc dupliqué dans un fichier par deux éditions concurrentes cassait la
  compilation d'une page ; le typecheck global le détecte : le relancer après tout lot d'agents
  parallèles avant de commiter.
- **Page serveur** : ne jamais passer une FONCTION à un composant client (propriétés sérialisables
  seulement ; cas de `/methodes/[id]`, corrigé par `versionDans`).
- **Tests API** : une base par agent (`DATABASE_URL` / `DATABASE_OWNER_URL` vers `missionpilot_<id>`,
  suffixe `_test` ajouté) ; le global-setup supprime et recrée le schéma de la base de test à
  chaque exécution ; jamais deux suites API en parallèle sur la même base ; la suite complète dure
  20 à 47 minutes (la lancer détachée). PostgreSQL du projet : conteneur `missionpilot-postgres`
  (port 55440), à relancer par `pnpm db:up` après un redémarrage de Docker. Les bases
  `missionpilot_*_test` créées par les agents s'accumulent : à purger.
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 (prochains libres : AGT `0275`, AUT `0305`,
  redressement `0487`, due diligence `0509`, canaux `0549`) ;
  un fichier qui référence une table d'un autre domaine a un numéro PLUS GRAND ; migrations commitées
  = immuables (0480–0548 le sont depuis les PR n° 12 à 14) ; `rapports_mission` et `fichier_orphelin`
  sont redéfinies par 0508 et 0548 : toute nouvelle redéfinition reprend l'UNION des valeurs ; toute
  nouvelle colonne qui référence `fichiers` est couverte par l'inventaire automatique de
  `fichiers-orphelins-references.test.ts`.
- **SQLSTATE** : plus aucune lettre libre après `Z` (redressement `MPZ01-20`, due diligence `MPZ21-32`)
  et `H` (canaux) : les lots suivants prennent un second préfixe de deux lettres (`MQ…`).
- **Recette** : préférer `next build` puis `next start` (port 3110, `WEB_ORIGIN=http://localhost:3110`
  pour l'API) : en mode dev le volet navigateur reste sur « Chargement de la page… » ; le port 3100 peut
  être pris par un autre projet ; Docker Desktop arrêté → le démarrer puis `docker start
  missionpilot-postgres` ; signer exige une 2FA active (comptes `*.2fa@` du seed).
- **Jobs** : toute constante `TYPE_JOB_*` exportée doit figurer dans `REGISTRE_JOBS`
  (`jobs-registre.test.ts`).
- **Dates métier** bornées par un CHECK SQL : `dateIsoBorneeSchema` (2000 à 2100).
- **Recherches mécaniques** de `.claude/rules/review-checklist.md` : à relancer avant chaque
  livraison (relevé du 2026-10-14, valable pour `main` : 813 routes dont 9 sans `exiger`, 723 `z.object`
  tous stricts, 180 migrations, 27 lignes à la recherche n° 16).
- **Évaluations locales** d'agents : elles prouvent le câblage d'un prompt, pas la qualité d'un
  modèle (ADR-005) ; hors développement et test, elles n'activent rien.
- **Agents** : `dev-complex-high` (implémentation, Sonnet 5.5 effort high), `code-reviewer`,
  `security-auditor`, `ui-tester` (lecture, recette) ; limite de 10 agents en parallèle ; un agent
  teste sur sa propre base ; aucun agent ne commite.
- Base de développement `missionpilot` : contient des données de recette ; le cabinet de
  démonstration Abidjan se crée par `db:seed-demo` (RUNBOOK). Base de recette
  `missionpilot_recette` (cabinet Lagune, comptes de démonstration, connexion rapide sans mot de
  passe avec `CONNEXION_RAPIDE_DEMO=oui`) : données préfixées RECETTE-A à RECETTE-R3 laissées par la
  recette ; la mission « Kora » y est clôturée.
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR` obligatoires ;
  `WEB_ORIGIN` = adresse exacte du web (sinon 403 `ORIGINE_REFUSEE`) ; `CHROMIUM_PATH` pour les PDF.

Valeurs métier de la V1 et de la V2 à faire valider (posées par défaut) : TVA 18 %, retenue à la
source désactivée, seuils d'approbation 5 M / 25 M / 10 M XOF (validés par l'utilisateur le
2026-10-06), IS 25 %, actualisation 12 %, codes SYSCOHADA indicatifs, libellés des classes A à E
(`apps/web/src/lib/notation.ts`), modèles IA recommandés et tarifs (`ia/modeles.ts`), taux USD de
départ (`ia/couts.ts`), plafond IA 50 USD, suivi KPI quotidien à 7 h UTC, conservation du texte IA
365 jours et des rapports 3 ans (**avis du conseil juridique requis**), mention de la contribution
IA activée par défaut. Seuils de la vague 1 à calibrer au pilote : poids de fiabilité A–D, plafond 2
et seuils 0,75 / 0,5 de solidité ; promotion d'autonomie 50 exécutions / 95 % / 90 jours ;
modification majeure au-delà de 25 % ; incident majeur → N2.
