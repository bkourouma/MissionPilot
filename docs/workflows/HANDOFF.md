# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## Lot 3b (due diligence) — branche `feat/vague-4-due-diligence` — 2026-10-14

**Terminé et commité par domaine, PR ouverte (fusion par le chef).** Vérifié sur la pointe : typecheck, eslint, Prettier verts ; shared 226, engines 1261, web 1602 ; suite API complète 169 fichiers, 1993 tests dont 1 échec isolé (`kpi-alertes`, test sensible à la charge machine, qui passe seul : même flottement vu sur le lot 3c) ; build web de production réussi ; deux audits de sécurité (le second : 0 critique, 4 importants et 7 mineurs, tous corrigés, test `dd-corrections-2.test.ts`). Recette navigateur courte (base `missionpilot_rec3b`, Chrome intégré, port 3110) : onglet « Due diligence », formulaire de nouveau dossier, pages en 200, refus gestionnaire, ressources, expert externe et portail 403, anonyme 401. **NON vérifié** : parcours complet de saisie dans le navigateur (hypothèses, verdicts, filtrage, note), mise en page mobile ; DD-02 (connecteurs) simulé, DD-10 (ADR-009 absente) et DD-07 repoussés. Piège : les migrations 0500–0508 ont été corrigées sur place (0503, 0505) : recréer les bases qui les avaient appliquées ; `rapports_mission` et `fichier_orphelin` sont redéfinies par 0508 et par 0548 du lot 3c : la dernière appliquée doit reprendre l'UNION des valeurs.

## Situation de `main` — 2026-10-11 (après la fusion de la PR n° 9, chantier n° 2 terminé)

**État :** `main` porte les vagues 0 à 3 (PR #7, merge commit `b32c089`, recette navigateur
réelle), le rejeu réel des évaluations OpenRouter (PR #8, `79155dd`) et les lacunes de la vague 2
(PR #9, merge commit `f548d54`, fusionnée par le chef d'orchestre) : **événement
`mission.cloture_demandee`** (0303), **brief quotidien par rôle** (AUT-07, 0304), **copilote
conversationnel** (AGT-08, 0271 à 0274). Audits de sécurité (0 critique, 3 importants corrigés +
mineurs) et recette navigateur courte faits. Le chantier n° 3 (vague 4) part de `main` sur sa
propre branche et ajoute sa section au-dessus de celle-ci.

**VÉRIFICATIONS RÉELLES OUVERTES (rien n'a été vérifié avec un vrai modèle ni dans un
navigateur) :**

- **OpenRouter réel : OUVERT.** Aucune clé OpenRouter n'existe dans l'environnement de
  développement et seul l'utilisateur peut en fournir une (décision du chef, 2026-10-11) :
  NE PAS en chercher, NE RIEN dépenser. Non vérifiés : le rejeu d'évaluation (PR #8), le routage
  du copilote par un vrai modèle (qualité, format JSON réellement rendu, coûts et jetons réels),
  la comparaison du modèle servi. Pour le faire : une clé de test dans les paramètres IA d'un
  cabinet de recette, un jeu d'essai de quelques cas, lancer un rejeu depuis `/agents/evaluations`
  (plafonné à 2 USD), puis poser quelques questions à `/copilote`.
- **Écran jamais ouvert dans un navigateur** : `/agents/evaluations` (rejeu). `/brief`, la carte
  « Brief du jour » et `/copilote` ont eu une recette navigateur courte le 2026-10-11 (Chrome réel,
  base `missionpilot_recette`, API relancée avec la connexion rapide) : aucun bloquant ; affichage,
  brief vide et rempli, liens, FIN-02, confirmation à usage unique, annulation, proposition
  expirée, autre utilisateur (404), refus sous N1 puis reprise à N2, portail fermé : observés.
  **Non vérifié** : la mise en page mobile (le redimensionnement n'a pas pris effet dans Chrome) et
  les captures (instables). Corrigé après recette : suggestion « factures échues » alignée sur
  l'outil du serveur ; dates du brief en JJ/MM/AAAA. **Constats mineurs repoussés** : « mes
  missions en retard » et « qui est en retard sur les feuilles » (équipe) ne sont pas compris ;
  « Refusée » affiché deux fois après un refus N1 et plus de bouton pour reprendre la proposition ;
  « Crée une tâche : » proposé sous N1 ; message refusé qui reste dans le champ ; conversation non
  conservée au rechargement ; fiche `/agents` du copilote sans la création de tâche ; formulations
  (« Aucun KPI au rouge sur 1 de vos missions ») ; « cherche » refusé au rôle ressources
  (permission `connaissance.lire`, à confirmer).
- Les trois bases de développement (`missionpilot`, `missionpilot_demo`, `missionpilot_recette`)
  ont les 155 migrations (0271 à 0274, 0303 et 0304 appliquées le 2026-10-11). Des données de
  démonstration ont été ajoutées par la recette dans la base de recette (3 tâches du chef de
  mission, 2 écritures de restriction du copilote).

**Livré :**

- **Événement `mission.cloture_demandee`** : déclencheur SQL non bloquant au passage de
  `missions.statut` à `a_cloturer` (clé par passage, anti-répétition de 10 minutes) ; l'automatisation
  standard « rappel de check-list de clôture » se déclenche de bout en bout. Conséquence : le mode
  d'exécution `declencheur` est refusé pour tout événement du catalogue.
- **Brief quotidien** : calcul déterministe sans IA (moteur pur), 27 types d'éléments en trois
  familles (À décider, Ça dérive, Prêt à envoyer), chaque source derrière sa permission et la
  visibilité de mission, FIN-02, séparation des tâches ; `GET /api/brief` ; job `brief_quotidien`
  (7 h UTC, jours ouvrés, lots de 500 avec suite, notification interne, jamais d'e-mail) ; page
  `/brief` et carte du tableau de bord.
- **Copilote** : l'IA route, le code répond (le modèle ne reçoit aucune donnée) ; 6 outils de
  lecture et 1 action (`creer_tache`) jamais exécutée sans confirmation à usage unique (5 min,
  niveau d'autonomie ≥ N2, plafond du standard relevé de N1 à N2 par `0273`) ; purge à 30 jours ;
  page `/copilote` ; permissions `brief.lire` et `copilote.utiliser`.
- Durcissement collatéral : les comptes du portail client ne sont plus jamais assignables ni
  mentionnables (`authDe`), y compris par `POST` et `PATCH /taches-collaboration`.

**Décisions de l'utilisateur (2026-10-10 et 2026-10-11, relayées par le chef d'orchestre)** :
conservation des CV de la banque d'appels d'offres **ouverte** (avis du conseil juridique) ; valeurs
par défaut de `DECISIONS.md` provisoires ; fusions décidées par le chef ; ordre des chantiers :
(1) rejeu OpenRouter (fait, PR #8), (2) lacunes de la vague 2 (fait, PR #9), (3) vague 4. Compte
rendu court au chef à la fin de chaque chantier. Aucune CI GitHub : vérification locale (eslint,
tsc, Prettier, tests des 4 paquets).

**Reste à faire (par priorité) :**

1. **Chantier n° 3 (vague 4)** : voir le point 3 ; branche depuis `main`, mêmes vérifications
   (eslint, tsc, Prettier, tests des 4 paquets sur la pointe, audit en lecture seule, recette
   navigateur courte), fusion par le chef.
2. **Lacunes restantes de la vague 2** : AUT-10 (rapport d'avancement hebdomadaire au client,
   généré et validé par le chef de mission), AUT-11 (staffing, V4 au PRD) ; le copilote n'a qu'une
   action et six outils de lecture : à étendre (le registre `ACTIONS` est prévu pour ça) ; sources du
   brief écartées (offres techniques, plans, révisions de budget, rapports « validés non diffusés »
   faute de trace de diffusion).
3. **Vague 4** (chantier n° 3) : services #2 et #5 augmentés, voix et WhatsApp, signature
   électronique (PRD complémentaire §18) ; PLA-15, 16, 18, NOT-12 (simulateur), CAP-03, CAP-04,
   AO-01 (veille multi-sources) hors de ce qui est livré.
4. **Dettes de la vague 1** : QUA-05 ; DOS-05 ; STD-11 complet, STD-13, STD-14 ; extraction IA
   depuis un PDF (DOS-03) ; PRV-06 web ; AGT-06 cache, agent contradicteur ; `IMPORT_INVALIDE` du
   dossier à convertir en `AppError` ; rapport d'état financier.
5. **Dettes du rejeu et du copilote** (`SECURITY.md` §15) : file `jobs` FIFO partagée entre
   cabinets ; garde de provenance contournable par du SQL arbitraire du même rôle (fonction
   SECURITY DEFINER réservée au job) ; liaison du modèle routé à l'activation ; routage du copilote
   qui appelle le fournisseur sans passer par `orchestrateur.ts` (écart assumé, à valider) ; noms
   propres tapés dans un message du copilote partis en clair vers le modèle (masquage par formats
   seulement) ; plafond de débit du brief tenu en mémoire (n instances = n fois 60) ; la `date`
   rejouée du brief n'est pas persistée.
6. **Autres dettes** (`CODING_STANDARDS.md` §10, `SECURITY.md` §15) : accusé de réception de la
   salle traité hors file ; `executions.executant_id` à comparer au responsable courant dans le job
   d'agent d'une automatisation réactivée par un autre ; `semaineQuerySchema` non borné ; dix pages
   web qui lisent `/api/missions` ou `/api/opportunites` demandent des pages de 200 ; génération
   « gabarit » d'un retour d'expérience qui remplace le texte rédigé ; pied de page « relu et validé
   par un consultant » sur un dossier de revue KPI en brouillon ; montants du PDF du dossier bancaire
   sans séparateur de milliers visible à l'extraction texte (le moteur insère U+202F : à vérifier à
   l'œil) ; 503 signalé par le réseau sur l'export de CV alors que le fichier est valide ; ADR-009
   (ingestion, OCR) citée mais absente ; fichiers web de plus de 400 lignes, fonctions de plus de 60
   lignes.
7. **Valeurs provisoires** (`DECISIONS.md`, laissées en l'état) : plafonds de la vague 2 et 3
   (50 automatisations actives, 30 simulations par 10 minutes, 20 dépôts par pièce, 500 Mo par
   demande, 30 dépôts du portail par 10 minutes, 20 dossiers et 50 extractions par fiche d'appel
   d'offres, 100 gabarits de CV, 30 propositions de portefeuille par 10 minutes, 60 recherches par
   minute, 10 dossiers de revue par 10 minutes, 50 déclarations de niveau par couple) ; plancher de
   confiance NOT-11 (0,3, 2 répondants) ; rejeu OpenRouter (2 USD par évaluation, 5 rejeux par 24 h,
   8 min, péremptions 1 h et 30 min) ; brief (seuils de gravité, 60 requêtes par 10 minutes, lots de
   500, anti-répétition de 10 minutes de l'événement de clôture) ; copilote (30 messages par
   10 minutes, 1000 caractères, 5 minutes, N2, 30 jours, 5 « KPI au rouge » par 10 minutes, purge à
   02:30 UTC) ; les jours de budget sont visibles d'un consultant dans la section « Écarts » d'un
   retour (FIN-02 ne vise que les montants : à confirmer).

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
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 (prochains libres : AGT `0275`, AUT `0305`) ;
  un fichier qui référence une table d'un autre domaine a un numéro PLUS GRAND ; migrations commitées
  = immuables (0271 à 0274, 0303 et 0304 le sont depuis la PR n° 9) ; toute
  nouvelle colonne qui référence `fichiers` est couverte par l'inventaire automatique de
  `fichiers-orphelins-references.test.ts`.
- **Jobs** : toute constante `TYPE_JOB_*` exportée doit figurer dans `REGISTRE_JOBS`
  (`jobs-registre.test.ts`).
- **Dates métier** bornées par un CHECK SQL : `dateIsoBorneeSchema` (2000 à 2100).
- **Recherches mécaniques** de `.claude/rules/review-checklist.md` : à relancer avant chaque
  livraison (677 routes dont 8 sans `exiger`, 574 `z.object` tous stricts, 23 `GRANT EXECUTE`).
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
