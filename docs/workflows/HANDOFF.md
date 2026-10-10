# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## Branche `feat/vague-2-automatisation` — 2026-10-10 (vagues 2 et 3 du PRD complémentaire)

**État :** les vagues 0 et 1 sont sur `main` (PR #5 et #6). Cette branche porte le code
des **vagues 2 et 3**, audité, corrigé, passé en **recette navigateur réelle** (Chrome, 4
lots puis une re-recette des corrections) et poussé : PR
[#7](https://github.com/bkourouma/MissionPilot/pull/7). Lots de code : `f9953a3`
automatisation, `d53ad40` clôture, `491438e` salle de mission, `e0e0333` prévisions,
`6e7c1c7` notation augmentée, `5d97558` plans augmentés, `ed39fce` KPI, `adeab6e` appels
d'offres, `d8353f9` capitalisation, `bcd2487` intégration ; puis documentation, huit
commits de corrections de recette (`530043b` à `50b312d`) et `e9cfc3c` (page méthode).
Les commits intermédiaires des dix lots de code ne se compilent pas isolément
(permissions, exports et liste blanche du portail sont dans `bcd2487`) : seule la pointe est
vérifiée.

**Décisions de l'utilisateur (2026-10-10, relayées par le chef d'orchestre)** : fusion de la
PR #7 dans `main` autorisée, en **merge commit** (pas de squash), UNIQUEMENT après une
re-recette sans anomalie bloquante ni importante, puis `pnpm db:migrate` sur les bases de
**développement** seulement ; valeurs par défaut de `DECISIONS.md` laissées en l'état
(provisoires) ; **conservation des CV de la banque d'appels d'offres : ouverte, ne rien fixer
avant l'avis du conseil juridique** ; ordre des chantiers après la fusion : (1) rejeu réel
OpenRouter des évaluations de non-régression, (2) lacunes de la vague 2 (brief quotidien
AUT-07, copilote, événement `mission.cloture_demandee`), (3) vague 4. Compte rendu court au
chef à la fin de chaque chantier. Aucune CI GitHub n'existe sur ce dépôt : la vérification
est locale.

**Vérifié le 2026-10-10 sur la pointe** : `eslint`, `tsc` (4 paquets) et `pnpm format`
verts ; shared 149 tests, moteurs 1085 (couverture 99,93 %), web 1410 ; API 144 fichiers et
1575 tests (suite complète sur `missionpilot_test`, ~47 min). Voir la fin de cette section
pour le résultat de la dernière relance avant la fusion.

**Recette navigateur (2026-10-10, 11 testeurs, base `missionpilot_recette`)** : tout a été
joué dans Chrome par l'interface. Corrigé à la suite : bouton « Nouvelle demande » de la
salle masqué par un lien étiré, « undefined écarts » de la clôture, retrait d'un dépôt, onglets
Paramètres, rétro-planning dont « Confier à » restait vide (pagination à 500 contre un plafond
API de 200), écrans de la banque d'items, des calibrations et des paramètres de confiance
(entièrement absents), retour d'expérience ouvrable seulement par l'API (désormais ouvert
automatiquement à la clôture et par bouton), anonymisation d'un CV sans écran, unités
incompatibles dans un arbre KPI, action non rattachable à une revue, page de détail d'une
méthode illisible (fonction passée à un composant client). Fichiers PDF vérifiés sur disque :
dossier de revue KPI (brouillon, mention confidentielle neutre), dossier bancaire (sans annexe
Sources), CV (conforme). Non testé faute de données ou de compte : 403 d'un compte
associé+expert métier, vue à l'aveugle avec plusieurs évaluateurs, estimation sous 5
observations réelles, masquage de « Écarts » pour un expert métier hors équipe (couvert par les
tests API), anonymisation d'un CV jusqu'au bout (reconfirmation par mot de passe).

**Reste à faire (par priorité) :**

1. **Fusionner la PR #7** (merge commit) quand la dernière vérification locale est verte ;
   rejouer `pnpm db:migrate` sur les bases de développement (`missionpilot`,
   `missionpilot_demo`, `missionpilot_recette` est déjà à jour) ; supprimer cette section.
2. **Rejeu réel OpenRouter** pour les évaluations de non-régression (file `jobs` plafonnée) :
   sans lui aucun agent ne tourne en production (ADR-005, `SECURITY.md` §15). Chantier n° 1.
3. **Lacunes de la vague 2** (chantier n° 2) : brief quotidien (AUT-07) et copilote absents ;
   `mission.cloture_demandee` est au catalogue d'événements mais aucun code ne la publie
   (l'automatisation standard « rappel de check-list » ne peut pas se déclencher) ; AUT-10
   (rapport hebdomadaire client) et AUT-11 (staffing) non vérifiés ; PLA-15, 16, 18, NOT-12
   (simulateur), CAP-03, CAP-04, AO-01 (veille multi-sources) hors de ce qui est livré.
4. **Vague 4** (chantier n° 3) : services #2 et #5 augmentés, voix et WhatsApp, signature
   électronique (PRD complémentaire §18).
5. **Dettes de la vague 1** : QUA-05 ; DOS-05 ; STD-11 complet, STD-13, STD-14 ; extraction IA
   depuis un PDF (DOS-03) ; PRV-06 web ; AGT-06 cache, AGT-08 copilote, agent contradicteur ;
   `IMPORT_INVALIDE` du dossier à convertir en `AppError` ; rapport d'état financier.
6. **Dettes nouvelles** (`CODING_STANDARDS.md` §10, `SECURITY.md` §15) : accusé de réception de
   la salle traité hors file ; `executions.executant_id` à comparer au responsable courant
   dans le job d'agent d'une automatisation désactivée puis réactivée par un autre ;
   `semaineQuerySchema` (`temps.ts`) non borné ; dix pages web qui lisent `/api/missions` ou
   `/api/opportunites` demandent des pages de 200 (au lieu de 500) depuis le plafond sûr de
   `lib/pagination.ts` ; génération « gabarit » d'un retour d'expérience qui remplace le texte
   rédigé (l'ancien reste dans la version précédente) ; pied de page « relu et validé par un
   consultant » sur un dossier de revue KPI en brouillon ; montants du PDF du dossier bancaire
   sans séparateur de milliers visible à l'extraction texte (le moteur insère U+202F : à vérifier
   à l'œil) ; un 503 signalé par le réseau sur l'export de CV alors que le fichier est valide ;
   champ d'échéance de la salle qui garde la valeur refusée après un échec ; messages d'erreur
   de formulaire qui persistent jusqu'au prochain envoi ; ADR-009 (ingestion, OCR) citée mais
   absente ; fichiers web de plus de 400 lignes et fonctions de plus de 60 lignes.
7. **Valeurs provisoires** (`DECISIONS.md`, laissées en l'état) : plafonds (50 automatisations
   actives, 30 simulations par 10 minutes, 20 dépôts par pièce, 500 Mo par demande, 30 dépôts du
   portail par 10 minutes, 20 dossiers et 50 extractions par fiche d'appel d'offres, 100 gabarits
   de CV, 30 propositions de portefeuille par 10 minutes, 60 recherches par minute, 10 dossiers de
   revue par 10 minutes, 50 déclarations de niveau par couple) ; plancher de confiance NOT-11
   (seuil 0,3, 2 répondants) ; estimation (effectif 3, statistiques détaillées dès 5) ; le
   gestionnaire n'a plus la rubrique « Connaissances » sauf « Mes compétences » ; les jours de
   budget sont visibles d'un consultant dans la section « Écarts » d'un retour (FIN-02 ne vise que
   les montants : à confirmer).

**Pièges :**

- **Serveurs de recette** : lancer l'API et le web comme processus DÉTACHÉS (PowerShell
  `Start-Process`) sous un nom d'exécutable distinct (copie de `node.exe` renommée) : une
  commande qui tue `node.exe` les arrêtait en pleine recette (deux fois). L'API met ~40 s à
  répondre ; le premier chargement d'une page en mode dev prend 10 à 60 s. Trois origines
  (`localhost`, `127.0.0.1`, `[::1]`) ont des cookies séparés et sont acceptées par la garde
  d'origine : jusqu'à trois testeurs en parallèle. Le groupe d'onglets de l'extension Chrome est
  partagé entre les testeurs : chacun doit créer son onglet et vérifier l'origine avant d'agir.
- **Next dev** : un bloc dupliqué dans un fichier par deux éditions concurrentes
  (`lib/salle-mission.ts`) cassait la compilation d'une page ; le typecheck global le détecte :
  le relancer après tout lot d'agents parallèles avant de commiter.
- **Page serveur** : ne jamais passer une FONCTION à un composant client (propriétés
  sérialisables seulement ; cas de `/methodes/[id]`, corrigé par `versionDans`).
- **Tests API** : une base par agent (`DATABASE_URL` / `DATABASE_OWNER_URL` vers
  `missionpilot_<id>`, suffixe `_test` ajouté) ; le global-setup supprime et recrée le schéma de
  la base de test à chaque exécution ; jamais deux suites API en parallèle sur la même base.
  PostgreSQL du projet : conteneur `missionpilot-postgres` (port 55440), à relancer par
  `pnpm db:up` après un redémarrage de Docker. Les bases `missionpilot_*_test` créées par les
  agents s'accumulent : à purger quand plus personne ne les utilise.
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 (prochains numéros libres par domaine) ;
  un fichier qui référence une table d'un autre domaine a un numéro PLUS GRAND ; migrations
  commitées = immuables ; toute nouvelle colonne qui référence `fichiers` est couverte par
  l'inventaire automatique de `fichiers-orphelins-references.test.ts`.
- **Jobs** : toute constante `TYPE_JOB_*` exportée doit figurer dans `REGISTRE_JOBS`
  (`jobs-registre.test.ts`).
- **Dates métier** bornées par un CHECK SQL : `dateIsoBorneeSchema` (2000 à 2100).
- **Recherches mécaniques** de `.claude/rules/review-checklist.md` : à relancer avant chaque
  livraison (668 routes dont 8 sans `exiger` au 2026-10-08, 547 `z.object` tous stricts, 20
  `GRANT EXECUTE`).
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
