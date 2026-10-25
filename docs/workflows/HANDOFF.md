# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## DÉCISIONS EN ATTENTE (utilisateur) — 2026-10-23

Rien de ce qui suit n'est fait sans l'utilisateur ; tout est préparé et sans effet tant qu'il n'agit pas.

- **Fusionner la PR du chantier** (super admin, démo, sauvegarde, PDF) : le déploiement part à la fusion (`deploy.yml`) et appliquera les
  migrations `0570–0583`. Avant de fusionner : décider si le profil seccomp des rapports PDF doit partir avec (voir ci-dessous).
- **SMTP** : `SMTP_HOST=smtp.invalid` et `MAIL_FROM` provisoires dans `/home/deployer/missionpilot.env` ; aucun e-mail ne part. Fournir le vrai SMTP.
- **Démo publique** : ne pas poser `DEMO_PUBLIQUE=oui` sur le serveur sans décision (mot de passe du tenant de démonstration public dans le
  dépôt). Procédure : `DEPLOIEMENT.md` (activer, désactiver, remise à zéro). Premier **vrai** super admin : `db:creer-super-admin` sur le serveur.
- **Rapports PDF** : profil seccomp dédié `deploy/seccomp-chromium.json` (sandbox de Chromium active, jamais `--no-sandbox`), testé en
  LOCAL seulement ; à valider sur le noyau du serveur (`user.max_user_namespaces`, AppArmor, voir `DEPLOIEMENT.md` « Limites connues »).
  Il assouplit le confinement du conteneur `api` (espaces de noms utilisateur) : décision de sécurité à confirmer.
- **Sauvegarde de la base** : `deploy/sauvegarde.sh`, `restauration.sh`, `test-sauvegarde.sh` prêts et testés en local (rotation 7 jours),
  **non installés** sur le serveur (crontab à poser par l'utilisateur) ; copie hors serveur et sauvegarde du volume des fichiers à décider.
- **Bases de développement locales** (environ 210 bases de test sur le conteneur `missionpilot-postgres`) : aucune purge faite ; à décider.
- **Reste technique du chantier** : cabinet désactivé laissant actifs invitations, jobs planifiés, webhooks de canaux, 2FA (SECURITY §15) ;
  plafonds permanents de la démo et remise à zéro à scripter ; 2FA et déblocage du limiteur pour le super admin ; listes plateforme non paginées.

---

## Branche `orch/2026-10-24-tenant-demo` — 2026-10-24 (cabinet de démonstration « Tenant démo »)

**État.** Chantier demandé par l'utilisateur le 2026-10-24 : en plus de « Lagune Conseil & Associés (démo) », un cabinet « Tenant démo »
(`est_demo`, cabinet de deux ans d'activité, 48 comptes actifs (cabinet 20 : associe 3, directeur_mission 2, chef_mission 2, consultant 5, ressources 2, gestionnaire 2, expert_metier 2, expert_externe 2 ; portail 28 : client_dirigeant 13, client_contributeur 12, client_investisseur 3), dont 2 comptes à 2FA non listés par la connexion « un clic » (46 comptes listés : 19 cabinet + 27 portail), 11 missions dont 5 terminées de types différents, toutes les tables
utiles remplies), semé par `pnpm --filter @missionpilot/api db:seed-tenant-demo [--phase=<nom>] [--confirmer-demo]`. Base
`origin/main` @ `a2d7be6` (PR n° 18, super admin, fusionnée). Branche d'intégration `orch/2026-10-24-tenant-demo` (HEAD `dc44786` au 2026-10-25), un lot = une branche `orch/2026-10-24-tenant-demo-lot-N`, copies `D:\APP\MissionPilot-worktrees\tenant-demo-lot-N`. Suivi,
brief commun et inventaire des 216 tables : `D:\APP\MissionPilot\.orchestration\2026-10-24-tenant-demo\` (local, exclu de git).
Décision consignée, **à valider par l'utilisateur** : `DECISIONS.md` (« Tenant démo »), dont l'hypothèse H1 (nom exact « Tenant démo »).
**Rien n'est sur `main`** ; PR vers `main` à ouvrir. **Fusionner dans `main` déclenche le déploiement de production (`deploy.yml`) : accord
explicite de l'utilisateur requis.** Pas de nouvelle migration.

**Fait (par lot).**

| Lot | Contenu |
| --- | --- |
| 0 | Inventaire de couverture des tables (216 à remplir, 12 vides) |
| 1 | Socle : cabinet, comptes (tous rôles et types de collaborateurs), paramètres, grades, collaborateurs, absences, clients, contacts, dossiers, portail ; contrat de phase (`tenant-demo/contexte.ts`, `phases/index.ts`), horloge fictive et hasard à graine |
| 2a | Phase `missions` : casting des 11 missions, équipe, budget figé, signature, démarrage, pipeline ; devises par client (Gabon en USD) ; levée bornée de 7 déclencheurs (`missions/declencheurs.ts`) |
| 2b | Phase `gestion` (temps, facturation, encaissements, rapports, salle de mission, ingestion, portail et collaboration, clôture des 5 missions terminées) : fusionnée dans l'intégration (tous les lots 1 à 8 le sont, HEAD `cfabfe1` avant le lot 9) |
| 3 | Phase `notation-plans` : notation, plans stratégiques, KPI, questionnaires |
| 4 | Phase `redressement-dd` : preuves, redressement, due diligence |
| 5 | Phase `appels-offres-canaux` : appels d'offres, canaux, capitalisation, observatoire, services candidats ; 2 comptes signataires à 2FA |
| 6 | Phase `ia-qualite-standard` : IA (coûts simulés), agents, automatisation, copilote, qualité, standard et méthodes |
| 7 | Connexion « un clic » : Tenant démo dans le sélecteur, vérification dans le navigateur |
| 8 | Documentation (ce lot) : RUNBOOK « Tenant démo », DEPLOIEMENT (e), SECURITY §3 et §15, CODING_STANDARDS §1, DECISIONS, checklist (relevé du 2026-10-24), ce carnet |

**Clôture des 5 missions terminées (ajout du 2026-10-25, phase `gestion`).** Le semis déclare le reste à faire final nul par la vraie route ;
il lève les alertes de consommation à la clôture (les alertes d'atterrissage au-dessus du budget restent actives volontairement : 8) ;
il termine le suivi des KPI avant la clôture (`missions/kpi-fin-suivi.ts`) ; les documents partagés sont servis avec un petit PDF fictif ;
la lettre de mission SICAFE est antidatée au jour de signature.

**Reste à faire.**

- **Dette** : les rapports validés du Tenant démo le sont par `UPDATE` SQL faute de route de validation ; à remplacer par une route.
- **Décision produit à prendre (M2 de la recette) : marge à 100 % sur les missions XAF, EUR et USD.** `collaborateur_couts` est unique par
  date quelle que soit la devise et le moteur de marge ignore les coûts exprimés dans une autre devise que celle de la mission : ces
  missions affichent des coûts internes à 0 et une marge de 100 % ; seules SICAFE (57 %) et Sahel Coton (58 %), en XOF, ont une marge
  significative. Suggestion : parité fixe XOF/XAF (même valeur), et faire évoluer le moteur de marge pour convertir les coûts (EUR, USD)
  au taux figé de la mission. Non traité dans le semis.
- **Limites connues des données** (recette finale du 2026-10-25, aucune bloquante) : occupation et facturabilité basses (environ 18 % et
  15 %), taux de réalisation de 157 % ; l'espace investisseur contient peu de contenu ; horodatages techniques (`cree_le`, `saisie_le`…
  de nombreuses tables) et `journal_audit` à la date RÉELLE du semis, donc l'historique d'audit d'une mission clôturée en 2025 se lit comme
  postérieur à sa clôture ; 10 horodatages de `signatures_preuves` postérieurs à la clôture (inclus dans la chaîne de hachage, non
  antidatables sans la rompre) ; taux négociés EUR/USD (`taux_clients`) de 2,2 à 2,8 fois les taux du budget de la même mission ;
  avertissement pg `client.query() already executing` dans `plans/ateliers.ts` (`cloreAtelier`) ; semis non strictement reproductible
  entre le mode public et le mode normal (4 050 lignes de temps contre 4 089 : horloge réelle et ordre d'exécution) ; `kpi_definitions.debut_suivi` vaut 2026-01-01 pour 3 KPI des missions 1 et 2, clôturées en 2025 ; `salle_demandes` et `salle_pieces` portent des horodatages techniques à la date réelle du semis.
- **Horodatages et lettres au semis (ajout du 2026-10-25)** : `cap_recommandations.cree_le` (11 lignes), `cap_efficacite_mesures.calcule_le` (8)
  et `lignes_temps.cree_le` (3, Brasseries du Wouri) portent l'horloge RÉELLE du semis ; les lettres de mission « (DÉMONSTRATION) » de Banque du
  Sahel et de Gabon Offshore sont datées du jour du semis (la lettre SICAFE, elle, est antidatée au jour de signature) ; le message final du
  socle affiche « 25 comptes » (cosmétique : le cabinet en compte 48 actifs).
- **Constats applicatifs hors semis, NON corrigés** (recette navigateur) : rechargement dur (F5) en mode développement qui laisse le
  squelette « Chargement » (hydratation bloquée, à reconfirmer sur un build de production) ; tableau de bord sans graphique (cartes de
  chiffres seulement) ; le chef de mission voit Finance et Paramètres dans le menu mais reçoit 403 ; carnet de commandes différent selon
  le rôle (« signé moins déjà facturé » pour le directeur de mission) ; marque « MissionPilot » restante côté web (la refonte CabinetPilot
  n'est pas dans cette branche) ; libellé à revoir dans `EcheancierMission.tsx:180`.
- **Nettoyage** : supprimer le dossier `C:\Users\BABA\AppData\Local\Temp\claude\D--APP-MissionPilot\23299cbb-f4db-4ee4-af85-2151d270ecad\apps`
  (extraction `git archive`).
- **Défaut applicatif NON corrigé (onglet Découpage)** : l'onglet affiche toujours « Réalisé 0 j / Reste = budget », car `agregerDecoupage`
  (`apps/api/src/missions/decoupage.ts`) met `realise: 0` en dur. Correctif possible : faire utiliser `calculerSuiviMission` (`temps/suivi.ts`)
  par la route `/missions/:id/synthese`. À traiter en suite, hors semis.
- Décisions de l'utilisateur : valider `DECISIONS.md` « Tenant démo » (H1 nom exact, devises, coûts IA simulés, 2FA au secret public) ;
  **nettoyage à faire APRÈS accord de l'utilisateur** : supprimer le cabinet « Tenant démo » PARTIEL créé par erreur par un agent dans la
  base de développement `missionpilot` (id `13970f72-2bc1-4df1-ad88-6639ace95b71`, semis lancé sans `DATABASE_OWNER_URL` ni
  `DATABASE_URL` : pas de suppression sans accord, de nombreuses tables le référencent) ; purger les bases jetables `missionpilot_td*`,
  `missionpilot_verif*`, `missionpilot_full*` et `missionpilot_final*` (même règle) ; supprimer le fichier `D:	mp_verif4_tsc.log`.
- Corriger côté API l'avertissement pg `client.query() already executing` émis par `cloreAtelier` (`apps/api/src/plans/ateliers.ts:411` ;
  hors périmètre du seed).
- Recherche n° 8 de la checklist : tranchée au lot 9, la commande exclut `**/tenant-demo/**` (données de démonstration ; 77 arrondis de
  génération de données, dont des conversions de devise fixes, hors de l'API en service).

**Pièges.**

- **Une base par agent** : jamais deux suites API (ni deux semis) sur la même base ; le global-setup recrée le schéma de test à chaque
  exécution. Bases de travail `missionpilot_td<lot>` pour le semis, dérivées en `_test` pour les tests ; `missionpilot_verif*` pour les
  vérificateurs.
- **Variables d'environnement à exporter à CHAQUE appel du shell** (`DATABASE_OWNER_URL`, `DATABASE_URL`) : l'outil Bash repart d'un
  environnement neuf. Sans elles, le semis vise la base de développement `missionpilot` (c'est ainsi que le cabinet partiel y est né).
- **Watchdog de 600 s** : un outil qui coupe une commande silencieuse interrompt le semis en cours de phase. Lancer en arrière-plan et
  surveiller le journal. Une phase interrompue repart d'une base NEUVE (RUNBOOK « Tenant démo »).
- **Docker se bloque** parfois sous charge (conteneur `missionpilot-postgres` ou Docker Desktop) : `docker start missionpilot-postgres`,
  attendre `healthy`, relancer Docker Desktop si besoin ; ne pas lancer de requêtes pendant ce temps.
- **Durées** : une suite `seed-tenant-demo*.test.ts` prend de 3 à 17 minutes sous charge (plusieurs lots en parallèle) ; le semis
  complet dure 10 à 14 minutes selon la machine (mesure finale du 2026-10-25 sur la tête finale, base neuve : 846 s, soit environ 14 min, dont la phase `gestion` 391 s ; rejeu 20 s). Plafonner à 2 suites API simultanées par lot.
- **Limite des liaisons de méthode** : `mission_methodes` est en ajout seul et non antidatée ; 3 liaisons du lot 5 sont postérieures à la
  clôture de leur mission (SECURITY §15).
- **Rétro-planning d'un appel d'offres** (`ao-fiches-encours.ts`) : calculé à partir de la date RÉELLE, donc le jeu de données change avec
  le jour du semis ; et toute écriture par route porte l'horloge réelle (une journée après la date fictive).
- Le semis refuse de tourner si `OPENROUTER_API_KEY` est définie ; le retirer de l'environnement du terminal.
- **Rejeu du semis** : ne crée aucun doublon métier, mais n'est pas strictement inerte. Il relit le socle par les routes et modifie `grades`, `parametres_temps`, `journal_audit` et `sessions`.
- Serveur : arrêter le conteneur `api` pendant un semis (verrous brefs) ; `DEPLOIEMENT.md` (e).

**Vérifié.**

- Documentation (lot 8) : recherches mécaniques de la checklist relancées sur la copie `tenant-demo-lot-8` (HEAD `231b25e`), sauf
  `pnpm audit` (réseau, aucun `package.json` de dépendances ne change) : n° 1 passe de 4 à 5 (`tenant-demo/index.ts:53`), n° 3 de 14 à 16
  (`seed-tenant-demo.ts:54` et `:60`), n° 8 de 24 à 76, n° 9 de 5 à 7, n° 11 de 1 732 à 1 847 gabarits ; les autres sont inchangées
  (1 002 routes dont 14 sans `exiger`, 240 migrations, 42 `GRANT EXECUTE`). Prettier propre sur les fichiers touchés.
- Documentation (lot 10) : recherches de la checklist relancées sur `dc44786` (n° 8 : 24 avec la glob `!**/tenant-demo/**` ; n° 11 : 1 926 gabarits,
  1 875 hors `db/seed*`, 837 interpolations, 249 expressions, dont 194 gabarits et 2 interpolations constantes dans `db/tenant-demo` ; n° 28 :
  `apps/api/package.json:33`), qui remplacent les chiffres du lot 8 ci-dessus.
- Tests de chaque domaine : rapports des lots dans `suivi.md` (non relancés par le lot 8, qui ne touche aucun code).
- Vérifications du 2026-10-25 sur l'intégration : typecheck, lint et prettier propres ; tests `shared` 532, `engines` 2 240 (couverture
  99,88 %), `web` 2 611 ; build web ; 9 suites API ciblées vertes.
- Lot 9 : `seed-tenant-demo-ia-qualite-standard.test.ts` (459 lignes) scindé en `seed-tenant-demo-ia-agents.test.ts` et
  `seed-tenant-demo-qualite-standard.test.ts` (outils communs : `seed-tenant-demo-iqs-outils.ts`) ; tsc, eslint et prettier propres,
  suites non lancées (à faire tourner par le superviseur).
- Semis complet final mesuré le 2026-10-25 sur la tête finale de la branche (bases neuves, toutes phases, rejeu sûr : 20 s, toutes les phases
  `deja_faite`) : 846 s (environ 14 min), mode public non remesuré sur cette tête ; 7 phases (socle puis `missions`, `notation-plans`,
  `redressement-dd`, `appels-offres-canaux`, `ia-qualite-standard`, `gestion`, cette dernière 391 s) ; 11 missions
  dont 5 clôturées ; 48 comptes actifs (cabinet 20 : associe 3, directeur_mission 2, chef_mission 2, consultant 5, ressources 2, gestionnaire 2, expert_metier 2, expert_externe 2 ; portail 28 : client_dirigeant 13, client_contributeur 12, client_investisseur 3), dont 2 comptes à 2FA non listés par la connexion « un clic » (46 comptes listés : 19 cabinet + 27 portail) ; seules 9 tables sur 356 restent
  volontairement vides (automatisation_coupe_circuits, autonomie_coupe_circuit, ia_alertes_plafond, ia_alertes_plafond_mission,
  ia_cache_reponses, ia_reservations, journal_plateforme, plateforme_sessions, saisies_idempotence), identiques dans les deux modes.
- Recette navigateur finale du 2026-10-25 (15 profils testés, aucun 5xx, droits FIN-02 et portail respectés) : anomalies restantes = marge à
  100 % sur les missions hors XOF (décision M2, ci-dessus), carnet de commandes variable selon le rôle, portail investisseur SICAFÉ vide,
  tableau de bord de l'associé sans bloc « missions en cours ».

---

## Branche `orch/2026-10-23-super-admin` — 2026-10-23 (super admin de plateforme, tenants, connexion de démonstration)

**État.** Chantier demandé par l'utilisateur le 2026-10-23 : un super admin crée des tenants (cabinets) et leurs comptes ; un script
sème un tenant par défaut avec tous les rôles ; une page de connexion « un clic » permet de choisir un espace puis un compte. Base
`main` @ `9fdf052` (PR n° 17, déploiement, fusionnée). Branche d'intégration `orch/2026-10-23-super-admin`, un lot = une branche
`orch/2026-10-23-super-admin-lot-N` (tiret, pas de barre : conflit de refs avec la branche d'intégration), copies de travail
`D:\APP\MissionPilot-worktrees\super-admin-lot-N`. Suivi, décisions D1 à D6 et hypothèses :
`D:\APP\MissionPilot\.orchestration\2026-10-23-super-admin\suivi.md` (local, exclu de git). Décision consignée : `DECISIONS.md`
(« Super admin de plateforme et démonstration publique »). **Rien n'est sur `main`** tant que l'utilisateur n'a pas
fusionné la PR (branche poussée sur `origin`) (merge commit, jamais de rebase).

**Livré (par lot).**

| Lot | Contenu |
| --- | --- |
| 1 | Super admin : migrations `0570–0573` (`cabinets.actif` / `est_demo` réservés au propriétaire, `trouver_connexion` et `resoudre_session` redéfinies, tables `super_admins`, `plateforme_sessions`, `journal_plateforme`, 11 fonctions `plateforme_*`), SQLSTATE `MQP01-06`, routes `/api/plateforme/*` (cookie `mp_plateforme`), tests `plateforme-*` |
| 2a | `db:seed-defaut` (tenant « Lagune Conseil & Associés (démo) » avec un compte par rôle, portail compris, marqué `est_demo`, plus super admin de démonstration) et `db:creer-super-admin` (premier vrai super admin, mot de passe affiché une fois) |
| 2b | Connexion « un clic » multi-cabinets (`GET /api/auth/demo`, `POST /api/auth/demo/connexion`, `/connexion-plateforme`), interrupteur `DEMO_PUBLIQUE`, migrations `0580–0582` (fonctions `demo_*`, refus du mot de passe public hors démo, bac à sable du super admin de démonstration) |
| 3 | Web : `/connexion` (bloc « Mode démonstration », choix du super admin ou d'un cabinet puis d'un compte), console `/plateforme` (cabinets, comptes), middleware de cookie `mp_plateforme` |
| 4 | Documentation (ce lot) : CODING_STANDARDS §1, §2, §10 ; SECURITY §3, §4, §6, §10, §15 ; RUNBOOK ; DEPLOIEMENT ; AGENTS « Pièges connus » ; DECISIONS ; checklist (relevé tête finale du 2026-10-23, super admin) ; commentaires SQL devenus faux (0570, 0573, 0580, test `plateforme-sql`) |
| 5 | Liste de démo sans comptes 2FA : migration `0583` (fonction interne `demo_tfa_bloquante`, non accordée ; `demo_lister_comptes` redéfinie) ; `GET /api/auth/demo` ne liste plus les comptes à 2FA active ou obligatoire, plancher `TOTP_REQUIS=oui` compris (`routes/connexion-demo-public.ts`) ; un compte non listé mais connu reste refusé en 403 `CONNEXION_RAPIDE_2FA` (« listé implique trouvable », la réciproque est fausse) |
| 6 | Web : un clic sur la carte « Super administrateur » de `/connexion` connecte directement (plus d'étape de confirmation) |
| 7 | Documentation finale (ce lot) : CODING_STANDARDS (`0580–0583`, prochains libres démo `0584–0589`), SECURITY §3 et §4, checklist (relevé lot 7), RUNBOOK, DEPLOIEMENT (durée du semis, ~50 s sur base vide) |

Chiffres de la tête (checklist) : 1 002 routes dont 14 sans `exiger`, 904 `z.object` dans `packages/shared` dont 893 `.strict()` (+10 `z.object` stricts
dans `apps/api`), 240 migrations (avec `0583`), 42 `GRANT EXECUTE`.

**Vérifié.** Lot 1 : 81 tests plateforme verts, suite API 3 503 / 3 504 (suivi du 2026-10-23 ; l'échec, `kpi-alertes`, est un délai sous
charge). Documentation (lot 4) : recherches mécaniques de la checklist relancées sur la tête (sauf `pnpm audit`, réseau) ; Prettier propre sur
les fichiers touchés (binaire du dépôt principal : le worktree du lot 4 n'a pas de `node_modules`) ; ESLint non exécuté (même cause) ; le lot 4
ne change que des commentaires hors de `docs/`.
**Tête d'intégration (lots 1 à 7, avant la fusion des branches ops), vérifiée le 2026-10-23** : typecheck, eslint, Prettier, tests engines et shared, web
(2 560 tests), build web de production verts ; suite API complète : 3 619 verts sur 3 623, les 4 échecs (`ingestion-standard`,
`jobs-reveil` ×2, `kpi-alertes`) sont des dépassements de délai sous charge et passent seuls (43/43). Recette navigateur : connexion un clic du
super admin et d'un associé, création d'un cabinet depuis la console. Pas rejoués : recette mobile 375 px, parcours d'erreur de la console.

**NON vérifié (à ne pas affirmer).**

- **Recette navigateur** de `/connexion` (parcours super admin et cabinet, compte client vers `/portail`, refus 2FA), de la console
  `/plateforme` (création d'un cabinet, mot de passe affiché une fois, désactivation, 409 du dernier associé) et de la mise en page mobile :
  jamais ouverts dans un navigateur.
- **Suite API complète à rejouer sur la tête finale** (lots 1, 2a, 2b, 3 fusionnés) : seule la suite du lot 1 a été rejouée en entier.
  Échecs connus sensibles à la charge : `jobs-reveil`, `kpi-alertes`, `kpi-pilotage` (les rejouer seuls avant de conclure, 3 ou 4
  suites au plus sur un même PostgreSQL).
- Le semis `db:seed-defaut --confirmer-demo` et `db:creer-super-admin` **sur le serveur** (image de production, `mp run --rm api …`) :
  procédures écrites dans `DEPLOIEMENT.md`, jamais exécutées. La CI GitHub n'a pas encore vu ces fichiers.
- Aucun envoi réel d'e-mail, aucune démonstration publique activée sur le serveur.

**Pièges.**

- `cabinets.actif` / `est_demo` : déclencheur, modifiables par le seul propriétaire ou les fonctions `plateforme_*` ; un test qui les change
  doit passer par le propriétaire (`test/plateforme-outils.ts`). Un nouveau chemin d'authentification doit tenir compte de `cabinets.actif`.
- `DEMO_PUBLIQUE=oui` ouvre une connexion sans mot de passe dans tout `NODE_ENV` : jamais dans la CI, jamais sur un serveur avec données
  réelles. Les mots de passe du cabinet de démonstration et du super admin de démonstration sont des constantes publiques du dépôt.
- `TOTP_REQUIS=oui` rend les comptes de démonstration inconnectables en un clic (403 `CONNEXION_RAPIDE_2FA`).
- Le limiteur est partagé par adresse (`plateforme:…`, `demo:…`, `demo-plateforme:…`) : 10 essais ratés bloquent 15 minutes, pas de déblocage
  pour un super admin.
- Seed de démonstration publique : tous les jobs qu'il crée sont passés en `echec` (« Neutralisé… ») ; des écrans peuvent les afficher.
- Migrations : plages `0570–0573` et `0580–0582` consommées ; prochains libres `0574–0579`, `0583–0589` (CODING_STANDARDS §1). Un test qui crée des
  cabinets `est_demo` doit les remettre à faux ou les désactiver (sinon la liste « un clic » des autres fichiers change).
- Le suivi du chantier est un fichier local exclu de git : le conserver jusqu'à la fusion.

**Reste à faire (par priorité).**

1. **Recette navigateur** du chantier, puis **suite API complète** sur la tête finale ; fusion de la PR (utilisateur).
2. **Cabinet désactivé** : faire tenir compte de `cabinets.actif` à `resoudre_invitation` et `resoudre_invitation_portail`, aux jobs planifiés
   (`planifier_*`), aux webhooks des canaux et à la 2FA (lot de suite à planifier, SECURITY.md §15).
3. **Plafonds et remise à zéro de la démonstration** : les plafonds du bac à sable (30 cabinets, 40 comptes) sont permanents et la démonstration
   publique est vandalisable ; écrire `db:reinitialiser-demo` (suppression des seuls cabinets `est_demo`, nouveau semis) et une tâche planifiée.
   Aujourd'hui : SQL propriétaire seulement (DEPLOIEMENT « Remise à zéro »).
4. **2FA et réinitialisation du mot de passe du super admin** (aucun aujourd'hui) ; **outil de déblocage du limiteur** pour les super admins.
5. **Pagination** des listes de la plateforme (aujourd'hui sans curseur, dette déclarée, CODING_STANDARDS §10).
6. **Valider H1, H2, H3** (DECISIONS) ; décider du SMTP muet pour la démonstration (e-mails de visiteurs vers des adresses `.test`).
7. **Purge du worktree** : `D:\APP\MissionPilot-worktrees\super-admin-lot-1`, `-2a`, `-2b`, `-3`, `-4` et les branches `orch/2026-10-23-super-admin-lot-*`
   après fusion (suppression de dossiers et de branches : accord requis).
8. **Déploiement du serveur (reste de la branche `ci/deploiement-vps`, fusionnée en PR n° 17, serveur amorcé et déployé le 2026-10-23)** : renseigner le
   vrai SMTP dans `/home/deployer/missionpilot.env` (valeur provisoire `smtp.invalid`) ; décider du rendu PDF en conteneur (Chromium sans sandbox,
   DEPLOIEMENT « Limites connues ») ; décider d'une sauvegarde de `missionpilot_pgdata` (aucune en place) ; créer le premier cabinet et le premier vrai
   super admin en production (DEPLOIEMENT (a)).

**Commandes de reprise.**

```bash
cd D:/APP/MissionPilot-worktrees/super-admin-lot-4         # ou le worktree d'intégration
git status && git log --oneline 9fdf052..HEAD              # lots 1, 2a, 2b, 3 fusionnés
pnpm typecheck && pnpm lint && pnpm format
# tests ciblés (une base de test dédiée, suffixe _test ; jamais deux suites sur la même base)
pnpm --filter @missionpilot/api exec vitest run test/plateforme-sql.test.ts test/plateforme-routes.test.ts test/plateforme-acces.test.ts \
  test/plateforme-bac-a-sable.test.ts test/demo-sql.test.ts test/demo-routes.test.ts test/demo-plateforme-motdepasse.test.ts \
  test/seed-defaut.test.ts test/creer-super-admin.test.ts test/connexion-demo.test.ts test/isolation.test.ts
pnpm --filter @missionpilot/web exec vitest run src/lib/plateforme src/lib/demo-connexion
pnpm --filter @missionpilot/api db:seed-defaut             # tenant de démonstration local
```

---

## Branche `orch/2026-10-20-reste` — 2026-10-23 (PR n° 16 fusionnée dans `main`, merge commit `378c48d`)

**État.** `main` = `3d5a252` (vagues 0 à 4 : gestion de mission, fondations, automatisation, services
augmentés, appels d'offres, redressement, due diligence, canaux simulés). La branche
`orch/2026-10-20-reste` (poussée sur `origin`) porte tout le reste du plan des lots B à F du HANDOFF du
2026-10-20, plus la CI GitHub, la recette navigateur et ses corrections. Elle se fusionne en **merge
commit** (jamais de rebase : l'historique par lot est voulu). Rien n'est sur `main` tant que
l'utilisateur n'a pas fusionné la PR.

**Livré (un lot = une branche `orch/2026-10-20-reste-lot-N`, commits par domaine).**

| Lot | Contenu |
| --- | --- |
| 1 | Socle IA : réclamation équitable des jobs par cabinet (0305) ; garde de provenance du rejeu par fonctions `SECURITY DEFINER` (0275) ; activation d'un prompt liée au modèle routé (0276) ; débit du brief en base (0550) ; copilote par l'orchestrateur, noms propres masqués, 2 actions et 2 lectures de plus ; 3 sources de plus au brief |
| 2 | Redressement 3a-bis : check-lists, causes racines par IA (brouillon), rapport de clôture et re-notation (0551), suivi après mission, trésorerie mensuelle et covenants ; validation réservée au directeur de la mission (409 `DIRECTEUR_REQUIS` sans directeur, doublée en base, 0492) |
| 3 | Due diligence : portail investisseur (0509), modèles sectoriels vides (0511, DD-07) ; canaux : alertes KPI sortantes (option désactivée par défaut, 0549), média entrant en flux, seeds |
| 4a | Éditeur de méthodes complet (STD-11, aperçu, cohérence) ; revue à froid des missions clôturées (QUA-05) |
| 4b | Groupes et filiales (DOS-05, conversion EUR/XAF/XOF au taux fixe, USD exclu) ; citations cliquables (PRV-06) ; rapport d'état financier (0552) |
| 4c | Rapport d'avancement hebdomadaire au client (AUT-10, jamais d'e-mail) ; cache chiffré des réponses IA, plafond de coût par mission, routage par tâche (AGT-06) ; agent contradicteur |
| 5a | Simulateur de note (NOT-12) ; ateliers en ligne (PLA-15) ; Monte-Carlo à graine (PLA-16) ; plan vivant (PLA-18) |
| 5b | Efficacité des recommandations (CAP-03) ; observatoire inter-cabinets réservé aux contributeurs, seuils hors appelant (CAP-04) ; veille des appels d'offres simulée (AO-01) |
| 6 | Import de documents (ADR-009) : états financiers PDF/Excel (DOS-03), rapports et salle de données de la due diligence (DD-02, DD-10), amorçage du standard (STD-13) ; PDF hostiles contrôlés hors boucle d'événements |
| 7 | Services candidats : diagnostic flash (pas de prix par défaut) et business plan bancable (« sur devis »), guichets de financement |
| 8a | CI GitHub Actions (qualité + API en 4 partitions, PostgreSQL 16) — **jamais exécutée sur GitHub** |
| 8b, 8c | Dettes (voyant rouge dans le brief, paginations, seuils d'anonymat, `paramsId` strict, dates de temps bornées) ; 34 gros fichiers web découpés |
| 9a à 9g | Documentation consolidée (SECURITY, CODING_STANDARDS, DECISIONS, checklist, RUNBOOK, ADR, SPEC), y compris les lots 13a et 13b et le recomptage final (9g) |
| 10 | Corrections de la recette navigateur du 2026-10-22 (A-01 à A-12) ; `ajouterPreuve` rejoue l'horodatage sous charge ; tests instables fiabilisés |
| 11 | OCR local (`tesseract.js` 7.0.0, hors ligne, données `fra`/`eng` vendorées avec empreintes) pour les PDF scannés ; toujours revue humaine |
| 12 | `next` 15.5.28 et `fastify` 5.12.6 (avis critique/haut/bas) ; derniers `router.refresh()` migrés vers `useRafraichir` |
| 13a | A-04 : cause racine trouvée (défaut du React canary embarqué par Next 15.5.28 : un « ping » perdu quand une transition suspend) ; contournement `DebloqueurRendu` monté au layout racine, mesuré à 242–347 ms sur onglet au premier plan |
| 13b | Corrections de la recette finale du 2026-10-23 : R-03 (synthèse DD lit la décision dans `dd_note_validations`), R-04 à R-09, A-05, A-09 ; R-08 : le worker est réveillé après le COMMIT d'un import (rattrapage 2 s, 30 s sinon) |

Détail, hypothèses H1–H32, plages de migrations, queue ≥ 0549 attribuée centralement et mesures de chaque
vérification : `D:\APP\MissionPilot\.orchestration\2026-10-20-reste\suivi.md` (local, exclu de git).
Chiffres du dernier recomptage des recherches mécaniques : voir `.claude/rules/review-checklist.md`
(relevé « tête finale » du 2026-10-23 : 990 routes dont 9 sans `exiger`, 904 `z.object` dont 893 `.strict()`, 232 migrations, 35 `GRANT EXECUTE`).

**Vérifié.** Typecheck, eslint, Prettier ; tests engines, shared, web ; build web de production (Next) ;
`pnpm audit --prod` sans vulnérabilité (2026-10-22) ; **suite API complète sur la tête finale (lots 1 à
13b, 2026-10-23) : 3 415 verts sur 3 416** ; le seul échec, `kpi-alertes`, est un dépassement de délai sous
charge et passe seul (9/9) ; web 2 378 tests, engines 2 240, shared 532 ; chaque lot a eu au moins un
vérificateur indépendant et une suite API complète sur sa branche ; recette navigateur du 2026-10-22 : 14
parcours sur 16 ; recette finale du 2026-10-23 (`docs/recette/2026-10-23-recette-finale.md`) : A-01 à A-12
retestées, A-04 mesurée sur un onglet au premier plan (rendu à 61 images/s), puis corrigée par les lots 13a et
13b (mesure 242–347 ms ; 77 tests API ciblés).

**NON vérifié (à ne pas affirmer).**

- La CI GitHub (`.github/workflows/ci.yml`) n'a jamais tourné : première exécution sur la PR ; ajuster
  `timeout-minutes` et la répartition des 4 partitions selon la durée réelle. Node 22.13 minimum partout
  (`engines`, CI, RUNBOOK, ADR-001) : requis pour le modèle de permissions de l'OCR.
- Le contournement `DebloqueurRendu` (A-04) est mesuré dans le navigateur sur un onglet au premier plan,
  mais c'est un contournement d'un défaut du React embarqué par Next : **à revoir à chaque montée de Next
  ou de React**. R-05 (largeur du tableau à 1 036 px) corrigé en CSS, non reconfirmé dans un navigateur
  après correction ; la nouvelle recette après lots 13a/13b n'a pas été rejouée en entier.
- Qualité de l'OCR sur de **vraies** liasses SYSCOHADA scannées (les tests utilisent des documents
  générés) ; JPX, CCITT, JBIG2 non testés ; `--permission` de Node sous Node 22 non éprouvé hors CI.
- Tout vrai fournisseur : OpenRouter (aucune clé), signature électronique, WhatsApp/SMS, transcription,
  SMTP. Aucun envoi réel n'a été fait.
- Mise en page mobile : 4 écrans seulement (recette du 2026-10-22), 375 px, sans défilement horizontal.
- Écrans jamais ouverts dans un navigateur : `/agents/evaluations`, simulateur WhatsApp, saisie KPI par
  messagerie ; accès aux agrégats de l'observatoire après contribution (bloqué par A-01 pendant la recette,
  corrigé depuis) ; refus d'activation du diagnostic flash sans prix ; commentaire IA du rapport
  hebdomadaire (pas de clé).

**Décisions de l'utilisateur pendant le chantier (2026-10-20 à 2026-10-22), toutes marquées VALIDÉES dans
`DECISIONS.md`.** Services candidats retenus : diagnostic flash puis business plan bancable. Alertes KPI
sortantes par messagerie : option du cabinet, désactivée par défaut. Note de due diligence périmée : reste
visible côté investisseur. Partage investisseur : associé et directeur de mission ; pièces au libre choix
(10 au plus). Relance par le copilote : jamais d'e-mail, une par facture et par jour. Brief : l'auteur est
toujours exclu de la validation de son propre travail ; révision de budget non figée = à valider ; un
jalon dépassé suffit pour « mission en retard ». Revue à froid : tout intervenant de la mission est exclu
des relecteurs ; le relecteur ne voit pas les jours consommés ; l'associé réaffecte, ne clôture pas. Groupes
: seuil de contrôle > 50 % ; devises converties au taux fixe XOF/XAF/EUR (655,957), USD exclu ; rapport
d'état financier réservé à `dossier.lire`. Diagnostic flash : aucun prix par défaut, activation
impossible sans prix ; gestion des services candidats et des guichets par l'associé et le directeur.
Observatoire : seuils de 5 entreprises et 3 cabinets calculés hors cabinet appelant, accès réservé aux
contributeurs. Efficacité des recommandations : 5 observations, effet à 30 jours. Import de documents :
noms masqués avant envoi à l'IA ; texte extrait conservé jusqu'à la décision + 90 jours ; **OCR local
installé sur le serveur, jamais de service externe**. Failles de `next` et `fastify` : correctifs gardés
malgré la règle d'âge de 14 jours (les versions n'ont que 8 et 9 jours ; faille critique). Garde réseau de l'OCR : limite documentée acceptée (2026-10-23), pare-feu sortant obligatoire à l'hébergement.

**À valider par l'utilisateur ou un expert (provisoire, dans la PR sous « À valider »).**

- Le business plan bancable peut s'activer sans prix (« sur devis »).
- La date d'efficacité s'affiche « 15 oct. 2026 » (format commun) et non JJ/MM/AAAA.
- Grille de revue à froid (8 critères pondérés, seuils 75/50), plafond de rejeux Monte-Carlo (5 par plan
  par 10 minutes, tous utilisateurs confondus), seuil de 3 contributeurs par méthode d'atelier, 20
  évaluations du voyant par requête de brief, seuils mémoire de l'import PDF (256 Mo / +512 Mo), toutes
  les valeurs listées par lot dans `DECISIONS.md`.
- Contenu des méthodes « diagnostic flash » et « business plan bancable » (briques, règles, cas types) :
  « à valider par un expert ».
- RED-04 : la validation des causes racines suit la règle « un consultant autre que l'auteur » ; la
  validation du plan et du bilan reste réservée au directeur de la mission.

**Décisions qui attendent l'utilisateur** (inchangées ou nouvelles).

- PRD complémentaire §21 : n° 4 (autonomie N4 vers les clients), n° 7 (attestation de notation
  vérifiable), n° 8 (WhatsApp Business comme canal officiel).
- Clé OpenRouter de test ; fournisseurs réels de signature, messagerie, transcription (SPEC-3c §17,
  O-01 à O-27) ; hébergement et déploiement (aucune cible choisie ; pare-feu sortant du serveur à prévoir
  pour l'OCR).
- Juridique : conservation (CV des appels d'offres, texte IA, rapports, données du client), RED-13
  (repères OHADA), valeur probante de la signature, consentements, ARTCI, durée de 90 jours du texte
  d'import.
- Expert métier : seuils d'alerte par secteur et grille d'urgence du redressement, modèles sectoriels
  DD-07, FIN-02 sur les montants du client en redressement.

**Reste à faire (par priorité).**

1. **Fusionner la PR** (utilisateur), observer la première exécution de la CI, corriger ce qu'elle révèle.
2. **Recette navigateur de contrôle** (R-05 à 1 036 px, OCR sur un vrai scan, mobile ; A-04 déjà mesurée).
3. **Dettes ouvertes** (détail : `SECURITY.md` §15 et `CODING_STANDARDS.md` §10) : **garde réseau de l'OCR
   contournable par la poignée native d'un socket** (un paquet UDP est sorti en essai ; précondition : code
   déjà exécuté dans le sous-processus ; renforcement non fait ; **limite acceptée par l'utilisateur le 2026-10-23, avec pare-feu sortant du
   serveur obligatoire à l'hébergement** ; un conteneur sans sortie reste une option si le risque change) ; parseur PDF et OCR dans le
   processus de l'API (sous-processus Node sans conteneur ni seccomp) ; `effacerObjetsMarques` efface
   tout objet marqué `retire` du cabinet (effet de bord possible sur les dépôts de salle de mission, à
   confirmer) ; M5 (relance de lecture avec les droits de l'auteur) et M7 (téléversement DD en trois
   transactions) ; lecture DD et documents DD non masqués avant envoi au modèle ; plafond IA par mission
   sans écran de réglage (API seule) ; rendu PDF/DOCX du rapport hebdomadaire non fait ; moteur NULL des
   briques `bancabilite_pla17`, `plan_financement`, `veille_guichets` (0561) ; ADR-001 dit encore « Node
   ≥ 20 » ; `SPEC-3b` §8.13 ajoutée (à garder ou retirer) ; commentaire de `0287` « MQQ01 à MQQ12 »
   (immuable) ; fichiers web encore au-dessus de 400 lignes (liste dans `CODING_STANDARDS.md` §10) ;
   rafraîchissement `FormulaireConnexion` volontairement direct.
4. **Vague 5 « Réseau »** (condition : 10 cabinets adhérents) : attestation vérifiable, place de marché des
   méthodes (STD-14), connecteurs, marque blanche ; NOT-14 (percentile) ; AUT-11 (staffing, V4).
5. **Branchements réels** quand les décisions ci-dessus sont prises : OpenRouter, signature, messagerie,
   transcription, connecteurs DD-02.
6. **Industrialisation et pilote V1** (jalon du PRD : pilote dans 2 à 3 cabinets, fin mars 2027) :
   hébergement et déploiement (accord requis), sauvegardes et restauration, observabilité, SMTP réel.

**Ménage non fait.** Environ 200 bases `missionpilot_o*` / `missionpilot_*_test` / `missionpilot_rec*` sur le
PostgreSQL de développement (suppression de données : accord requis) ; dossiers
`D:\APP\MissionPilot-worktrees\` (worktrees de lots fusionnés restés verrouillés par Windows : `reste-lot-6`,
`reste-lot-9e`, à supprimer à la main si besoin ; branches `orch/2026-10-20-reste-lot-*` locales et
distantes à supprimer après la fusion) ; fenêtre « Sécurité Windows » (pare-feu Node.js) possiblement
restée ouverte par la recette (lancer `next start` avec `-H 127.0.0.1`).

**Pièges.**

- **Docker Desktop se bloque souvent** (WSL arrêté, pipe `dockerDesktopLinuxEngine` introuvable) : arrêt
  forcé de `Docker Desktop` et `com.docker.backend`, `wsl --shutdown`, relance, puis
  `docker start missionpilot-postgres` et attendre l'état `healthy` (jusqu'à 90 s). Après un
  redémarrage brutal, PostgreSQL rejoue son journal.
- **Machine chargée** : 3 ou 4 suites API en parallèle au plus (au-delà : erreur 53200
  `max_locks_per_transaction` dans le global-setup) ; une base par agent (`missionpilot_<id>`, suffixe
  `_test` ajouté, schéma recréé à chaque exécution, jamais deux suites sur la même base) ; la suite complète
  dure 1 h à 2 h sous charge (la lancer détachée, journal et ligne `FIN <code>`) ; tests connus instables
  sous charge : `kpi-alertes`, `jobs`, `rapports-pdf` (Chromium), `rapports-api` « PDF réel »,
  `redressement-*`, `auth-limiteur`, `plan-de-charge-perf` : les rejouer seuls avant de conclure.
- **Orchestration d'agents** : la garde du mod `flux-autonome` plafonne les agents actifs (relevée à 20 le
  2026-10-21) ; une coupure réseau (`ENOTFOUND`) ou un redémarrage de l'application arrête tous les
  agents : état des lieux des fichiers (tronqués, octets NUL) puis reprise par `SendMessage` ; aucun agent
  ne commite ; un chef de lot ne lance pas plus de 4 exécutants. Commits signés
  `Co-Authored-By: Claude Sonnet 5.5` depuis le 2026-10-22.
- **Migrations** : prochains libres dans `CODING_STANDARDS.md` §1 (0527 après l'OCR, 0525 et 0526 utilisées ; la queue ≥ 0549 est
  attribuée centralement : redéfinition de `tentatives_auth_regles` après 0550, de `rapports_mission`
  après 0552 avec l'UNION des valeurs) ; migrations commitées = immuables.
- **SQLSTATE** : plus aucune lettre libre après `Z` et `H` ; second préfixe de deux lettres `MQ…`
  (`MQD`, `MQF`, `MQG`, `MQI`, `MQK`, `MQA`, `MQL`, `MQQ`, `MQS`, `MQU`, `MQV`).
- **Web** : `DebloqueurRendu` (layout racine) contourne le défaut du React canary de Next 15.5.28 : ne pas le retirer sans rejouer la mesure d'A-04 ; plus aucun `router.refresh()` direct hors `FormulaireConnexion` : utiliser `useRafraichir` ;
  un 403 métier explicite se tolère par `codes403Metier` (opt-in) dans `chargerServeur` ; ne jamais
  passer une fonction d'un composant serveur à un composant client ; build de production à lancer après
  tout découpage de fichiers web.
- **Serveurs de recette** : API et web comme processus DÉTACHÉS sous un nom d'exécutable distinct (copie de
  `node.exe` renommée) ; `next build` puis `next start` (port 3110, `WEB_ORIGIN=http://localhost:3110`) ;
  l'API met ~40 s à répondre ; trois origines (`localhost`, `127.0.0.1`, `[::1]`) pour trois testeurs ;
  `CONNEXION_RAPIDE_DEMO=oui` ; signer exige une 2FA active (comptes `*.2fa@`, `db:code-2fa-demo`).
- **Jobs** : le worker est réveillé après le COMMIT (`jobs/reveil.ts`, signal local au processus) ; toute constante `TYPE_JOB_*` exportée doit figurer dans `REGISTRE_JOBS`
  (`jobs-registre.test.ts`).
- **Dates métier** bornées par un CHECK SQL : `dateIsoBorneeSchema` (2000 à 2100) ; les tests dérivent leurs
  dates de `new Date()` (un déclencheur refuse les mesures futures).
- **Évaluations locales** d'agents : elles prouvent le câblage d'un prompt, pas la qualité d'un modèle
  (ADR-005) ; hors développement et test, elles n'activent rien.
- **Recherches mécaniques** de `.claude/rules/review-checklist.md` : à relancer avant chaque livraison.
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR` obligatoires ; `WEB_ORIGIN` =
  adresse exacte du web (sinon 403 `ORIGINE_REFUSEE`) ; `CHROMIUM_PATH` pour les PDF ; `OCR_LOCAL`
  (`auto` par défaut, `off` pour couper) pour l'OCR.

Valeurs métier de la V1 et de la V2 à faire valider (posées par défaut) : TVA 18 %, retenue à la source
désactivée, seuils d'approbation 5 M / 25 M / 10 M XOF (validés par l'utilisateur le 2026-10-06), IS 25 %,
actualisation 12 %, codes SYSCOHADA indicatifs, libellés des classes A à E
(`apps/web/src/lib/notation.ts`), modèles IA recommandés et tarifs (`ia/modeles.ts`), taux USD de départ
(`ia/couts.ts`), plafond IA 50 USD, suivi KPI quotidien à 7 h UTC, conservation du texte IA 365 jours et des
rapports 3 ans (**avis du conseil juridique requis**), mention de la contribution IA activée par défaut.
Seuils de la vague 1 à calibrer au pilote : poids de fiabilité A–D, plafond 2 et seuils 0,75 / 0,5 de
solidité ; promotion d'autonomie 50 exécutions / 95 % / 90 jours ; modification majeure au-delà de 25 % ;
incident majeur → N2.
