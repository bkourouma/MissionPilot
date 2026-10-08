# Runbook — MissionPilot

Lancer, configurer et dépanner le projet. En cas de désaccord avec
[AGENTS.md](../../AGENTS.md), AGENTS.md prime.

## Prérequis

| Outil          | Version attendue                       | Vérifié le 2026-10-06 |
| -------------- | -------------------------------------- | --------------------- |
| Node           | ≥ 20 (`engines` du `package.json`)     | 24.12.0               |
| pnpm           | 10 (`packageManager` : 10.26.2)        | 10.26.2               |
| Docker         | pour PostgreSQL (`docker-compose.yml`) | 29.1.3                |
| PostgreSQL     | 16, conteneur `missionpilot-postgres`  | image `postgres:16-alpine` |
| Git            | 2.x                                    | 2.52                  |
| Lefthook       | dépendance de développement du dépôt   | `node_modules/.bin/lefthook` présent |
| Chrome/Chromium | facultatif : rapports PDF (`CHROMIUM_PATH`) | Chrome sous Windows seulement (aucun essai sous Linux) |

Vérifier : `node -v`, `pnpm -v`, `docker --version`. Les autres conteneurs
PostgreSQL de la machine sont à d'autres projets : n'y pas toucher.

## Installation

```bash
pnpm install                                   # dépendances ; lance aussi les hooks git (script prepare)
pnpm db:up                                     # PostgreSQL de développement (conteneur missionpilot-postgres)
pnpm db:migrate                                # migrations (rôle propriétaire) ; crée le rôle applicatif
pnpm --filter @missionpilot/api db:seed        # données de démonstration (développement et test seulement)
```

`pnpm db:up` ne fait que `docker compose up -d postgres` ; attendre l'état
« healthy » (`docker ps`) avant de migrer. Les migrations sont rejouables : seules
les migrations manquantes s'appliquent (table `schema_migrations`). Le seed est
idempotent et refuse de tourner si `NODE_ENV` n'est pas local.

### Fichiers d'environnement

Aucun fichier `.env` n'est nécessaire en développement : les valeurs par défaut
de `apps/api/src/config.ts` reprennent `.env.example`, et ne sont admises que
si `NODE_ENV` est absent, `development` ou `test` **et** que les deux URL de
base désignent `localhost`, `127.0.0.1` ou `::1`. Les agents ne lisent ni
n'écrivent les `.env` : leur création revient à l'utilisateur. Variables
(jamais leurs valeurs ici) :

| Variable                    | Rôle                                                                                   | Obligatoire hors développement |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `NODE_ENV`                  | `production` pour un serveur ; local sinon                                             | oui                            |
| `DATABASE_OWNER_URL`        | rôle propriétaire : migrations seulement                                               | oui                            |
| `DATABASE_URL`              | rôle applicatif `missionpilot_app` (sans BYPASSRLS), utilisé par l'API                 | oui                            |
| `API_PORT`                  | port de l'API (défaut 4100)                                                            | non                            |
| `WEB_PORT`                  | documenté dans `.env.example` ; le port du web est fixé à 3100 par les scripts du web  | non                            |
| `WEB_ORIGIN`                | origine autorisée par CORS et par la garde d'origine anti-CSRF (défaut `http://localhost:3100`) ; en production, l'adresse **exacte** à laquelle les navigateurs ouvrent le web | oui (adresse réelle du web) |
| `API_URL`                   | adresse de l'API pour le relais `/api/*` du web ; lue **au build** de Next             | oui (reconstruire si elle change) |
| `SESSION_SECRET`            | secret de session, 32 caractères minimum ; clé de version 1 du chiffrement             | oui, différent du défaut       |
| `TFA_MASTER_KEY`            | secret maître (HKDF) : 2FA, e-mails en file, clés IA des cabinets, empreintes du limiteur ; 32 car. min., ≠ `SESSION_SECRET` ; le changer remet les compteurs du limiteur à zéro | oui, différent du défaut |
| `TFA_MASTER_KEY_PRECEDENTE` | ancienne clé pendant une rotation                                                      | non                            |
| `SMTP_HOST`, `SMTP_PORT`    | transport e-mail ; sans hôte, journal local (affiché en développement, muet en test) ; port par défaut 465 si TLS `implicite`, sinon 587 | `SMTP_HOST` oui |
| `SMTP_USER`, `SMTP_PASS`    | identifiants SMTP, à fournir ensemble, jamais journalisés                              | non                            |
| `SMTP_TLS`                  | `implicite` (465), `starttls` (587) ; `aucun` refusé hors développement et test        | non (jamais `aucun`)           |
| `MAIL_FROM`                 | expéditeur, adresse ASCII, obligatoire dès que `SMTP_HOST` est défini                  | oui avec SMTP                  |
| `TOTP_REQUIS`               | `oui` impose la 2FA aux rôles sensibles de tous les cabinets (plancher plateforme)     | non                            |
| `CONNEXION_RAPIDE_DEMO`     | `oui` : liste des comptes de démonstration sur la page de connexion, un clic ouvre la session **sans mot de passe** (recette locale, voir « Cabinet de démonstration ») ; défaut `non` ; `oui` refusé au démarrage hors `NODE_ENV` local avec bases locales | jamais (interdit)  |
| `STORAGE_DRIVER`            | `disque` (défaut) ; `s3` est refusé au démarrage (non implémenté)                      | non                            |
| `STORAGE_DIR`               | dossier **absolu** des fichiers téléversés, hors du dépôt, jamais servi en statique ; défaut en développement `~/.missionpilot/stockage` (en test : dossier temporaire) | oui |
| `FICHIER_TAILLE_MAX_OCTETS` | plafond par fichier téléversé (défaut 15 Mo, de 1 Kio à 100 Mo)                        | non                            |
| `QUOTA_STOCKAGE_CABINET_OCTETS` | quota de stockage par cabinet (défaut 2 Go, 1 Mo au minimum)                       | non                            |
| `CHROMIUM_PATH`             | Chrome/Chromium des rapports PDF, chemin **absolu** vérifié au démarrage ; absent : Chrome installé en développement Windows, sinon PDF indisponible (503) | non (oui pour les PDF) |
| `JOBS_WORKER`               | `actif` ou `inactif` ; actif par défaut, inactif par défaut en test                    | non                            |
| `OPENROUTER_API_KEY`        | clé IA **de plateforme** (facultative, jamais journalisée) : sert aux cabinets qui ont activé l'IA sans clé propre ; sans aucune clé, gabarits déterministes | non |
| `OPENROUTER_BASE_URL`       | point d'accès OpenRouter (défaut `https://openrouter.ai/api/v1`) ; HTTPS obligatoire, HTTP admis pour la seule boucle locale | non |
| `IA_TIMEOUT_MS`             | délai maximal d'un appel au modèle (défaut 60 000, de 1 000 à 300 000)                 | non                            |
| `IA_PLAFOND_PLATEFORME_MICRO_USD` | plafond mensuel IA par cabinet payé par la plateforme, en µUSD (défaut 50 USD, au plus 100 000 USD) ; avec la clé de plateforme, plafond effectif = min(ce plafond, celui du cabinet) | non |

### Comptes de démonstration

Cabinet « Cabinet Démo » : un compte par rôle, adresse
`<role>@demo.missionpilot.test` (rôle avec `.` à la place de `_`, ex.
`directeur.mission@…`). Le mot de passe est la constante `MOT_DE_PASSE_DEMO` de
`apps/api/src/db/seed.ts` : ne pas le recopier ailleurs. Comptes de test locaux
uniquement.

### Cabinet de démonstration pour la recette humaine

```bash
pnpm --filter @missionpilot/api db:seed-demo
```

Crée le cabinet fictif « Lagune Conseil & Associés (démo) » (Abidjan) :
un compte par rôle, `<role>@lagune-conseil.test` (rôle avec `.` à la place de
`_`, plus `consultant.junior@…`), cinq clients, catalogue de conseil,
collaborateurs avec grades et coûts, quatre missions (en proposition, signée
avec budget figé, en cours avec temps validés, clôturée avec deux factures
émises et un encaissement partiel du solde), absences et notifications. Tout
passe par les routes réelles (`app.inject`) ; seule l'émission des factures à
une date passée appelle la fonction métier `emettre`. Le mot de passe commun est
la constante `MOT_DE_PASSE_DEMO_ABIDJAN` de `apps/api/src/db/seed-demo.ts` : ne
pas le recopier ailleurs.

- **Refus** si `NODE_ENV` n'est pas local, si `DATABASE_URL` ou
  `DATABASE_OWNER_URL` ne désigne pas la machine locale, ou si `SMTP_HOST` est
  défini (aucun e-mail ne doit partir).
- **Pas de doublon** : si le cabinet existe déjà, le script n'écrit rien et sort
  avec le code 2. Un échec en cours de route laisse un cabinet partiel : repartir
  d'une base neuve (migrations appliquées) avant de relancer.
- Durée : de l'ordre de la minute (hachage des mots de passe, une quinzaine de
  feuilles de temps). Les dates sont relatives au jour du lancement.

#### Comptes du portail client de démonstration

```bash
pnpm --filter @missionpilot/api db:seed-demo-portail
```

`db:seed-demo` l'exécute déjà en fin de course : cette commande sert à ajouter
le portail à une base **déjà peuplée** par une version antérieure de
`db:seed-demo` (ex. la base de recette `missionpilot_demo`). Mêmes gardes que
`db:seed-demo` (`NODE_ENV` local, bases locales, pas de `SMTP_HOST`) ; refus
net (code 1) si le cabinet de démonstration n'existe pas, et (code 2, rien
n'est écrit) si les comptes du portail existent déjà. Non destructif ; durée
d'une minute environ. Tout passe par les routes réelles : invitations,
acceptation, partages par un associé, validation d'un jalon par le client,
envoi de questionnaires, KPI et mesures.

| Compte (`@lagune-conseil.test`)  | Nom                    | Rôle                  |
| -------------------------------- | ---------------------- | --------------------- |
| `dirigeant.client`               | Jean-Baptiste Kouadio  | Dirigeant client      |
| `contributeur.client`            | Nadège Yapi            | Contributeur client   |
| `investisseur.client`            | Moussa Coulibaly       | Investisseur          |

Même mot de passe commun que les comptes du cabinet. Client rattaché :
« Cacao Savane Export (fictif) », qui porte déjà la mission clôturée du seed
et ses deux factures émises (acompte soldé, solde réglé à 40 %). Le seed y
ajoute une mission **en cours** (« Accompagnement à la mise en œuvre du plan
Cacao Savane », budget figé), car une mission clôturée ne reçoit plus ni jalon,
ni document, ni questionnaire, ni KPI. Contenu :

- **Partages** (faits par l'associé) : les deux missions avec jalons et
  factures, la lettre de mission et le livrable « Synthèse du diagnostic
  stratégique » (PDF valide, contenu rédigé avec l'IA puis **validé** par le
  directeur), contact principal = directeur de mission (Yao Kouassi).
- **Jalons** de la mission en cours : « Cadrage validé… » atteint **et validé**
  par le dirigeant client ; « Diagnostic stratégique restitué » atteint,
  **à valider** (tester la validation avec le dirigeant) ; un jalon à venir.
- **Factures** : deux émises, dont FA-…-00002 avec encaissement partiel (en
  retard) ; visibles du dirigeant (pas du contributeur ni de l'investisseur :
  droits du rôle).
- **Questionnaires** (envoyés par le chef de mission) : « Questionnaire
  préliminaire des dirigeants » en mode **par fonction** (dirigeant : Directeur
  général ; contributrice : Directrice administrative et financière), date
  limite à J+14, **brouillon de réponse commencé** par la contributrice ;
  « Notation de la compétitivité… » en mode **collectif**, date limite
  **dépassée à dessein** (la date n'est qu'indicative : on peut encore répondre).
- **KPI** (mission en cours) : « Chiffre d'affaires mensuel » (cible 450 M FCFA),
  « Délai moyen de recouvrement des créances » (cible 45 jours, plus bas
  mieux), « Satisfaction des planteurs partenaires » (trimestriel, cible 85 %) ;
  la contributrice en est contributeur désigné ; mesures saisies par le cabinet
  puis la dernière par elle depuis le portail.
- **Notifications** : celles que ces actions génèrent (questionnaires à
  compléter pour les deux répondants, jalon validé et alertes côté cabinet).
- Aucune 2FA sur ces comptes et politique 2FA du portail désactivée (sinon la
  connexion rapide serait refusée). Les PDF sont écrits dans le stockage de
  développement (`~/.missionpilot/stockage`, ou `STORAGE_DIR`).

**Connexion rapide (sans mot de passe)** pour la recette : démarrer l'API avec
`CONNEXION_RAPIDE_DEMO=oui` ; la page de connexion affiche alors le bloc
« Comptes de démonstration (environnement local) » en deux groupes, « Espace
cabinet » et « Espace client (portail) », et un clic sur un compte ouvre sa
session (un compte client arrive dans `/portail`).

```bash
CONNEXION_RAPIDE_DEMO=oui pnpm dev                                   # bash : API et web
CONNEXION_RAPIDE_DEMO=oui pnpm --filter @missionpilot/api dev        # bash : API seule
```

```powershell
$env:CONNEXION_RAPIDE_DEMO = "oui"; pnpm dev                         # PowerShell
Remove-Item Env:CONNEXION_RAPIDE_DEMO                                # désactiver ensuite
```

- La variable se lit **au démarrage de l'API** : relancer l'API après l'avoir
  posée ou retirée (le web n'a pas besoin d'être reconstruit, il lit la liste à
  chaque affichage de la page).
- Seuls les comptes actifs `@lagune-conseil.test` du cabinet semé par
  `db:seed-demo` sont listés, comptes du portail compris (s'ils ont un
  rattachement actif à un client actif) ; un compte dont la 2FA est active ou
  obligatoire (politique du cabinet, `TOTP_REQUIS=oui`, ou politique 2FA du
  portail pour un compte client) est refusé : utiliser le formulaire.
- Refus de démarrage si `NODE_ENV` n'est pas `development` ou `test` (ou
  absent), ou si une URL de base n'est pas locale. Jamais sur un serveur.
- Sans la variable, les routes n'existent pas (404) et la page n'affiche rien
  de plus.

## Lancer

```bash
pnpm dev     # API (tsx watch, 4100) et web (next dev -p 3100) en parallèle
```

Sonde de l'API : `GET http://localhost:4100/api/sante` (sans authentification).
Le worker de jobs démarre avec l'API (rappels de temps, relances des factures
et des questionnaires, suivi quotidien des KPI, générations IA, purge des
fichiers orphelins, file d'e-mails) ; `JOBS_WORKER=inactif` le coupe. L'IA est
désactivée par défaut dans chaque cabinet : tant qu'un associé ne l'active pas
(`/parametres/ia`), les générations utilisent les gabarits déterministes. L'interface est sur
`http://localhost:3100` (connexion avec un compte de démonstration).

## Ports

Alignés sur `ports` d'`acc.config.json`.

| Service    | Port  | Remarque                                                             |
| ---------- | ----- | -------------------------------------------------------------------- |
| API        | 4100  | écoute sur `127.0.0.1` seulement (`server.ts`) ; `API_PORT`          |
| Web        | 3100  | fixé dans `apps/web/package.json` ; relaie `/api/*` vers `API_URL`   |
| PostgreSQL | 55440 | publié sur `127.0.0.1` seulement (`docker-compose.yml`)              |

Doivent rester cohérents : `WEB_ORIGIN` (CORS de l'API) avec l'adresse
réellement servie par le web, et `API_URL` (build du web) avec `API_PORT`.

## Commandes quotidiennes

```bash
pnpm typecheck                                 # tsc dans chaque paquet
pnpm lint                                      # eslint
pnpm format                                    # prettier --check (les docs en sont exclues)
pnpm test                                      # Vitest, tous les paquets
pnpm --filter @missionpilot/api exec vitest run test/factures.test.ts   # un fichier de tests API
pnpm --filter @missionpilot/engines test       # moteurs, avec couverture ≥ 90 %
pnpm --filter @missionpilot/web build          # build de production du web
```

### Tests API et base de test

- Les tests API utilisent la base `<nom>_test` (par défaut `missionpilot_test`),
  créée à la volée sur le même serveur ; `test/global-setup.ts` **supprime et
  recrée le schéma `public`** de cette base à chaque exécution, puis applique
  les migrations. La base de développement n'est jamais touchée.
- **Jamais deux suites API en parallèle** (même base) : un seul `vitest` API à la
  fois, dans toutes les sessions et tous les worktrees qui visent le même
  PostgreSQL. Vitest lui-même exécute les fichiers l'un après l'autre.
- Pour une base de test distincte (deuxième worktree, CI) : fournir
  `DATABASE_OWNER_URL` et `DATABASE_URL` pointant vers une autre base ou un
  autre serveur local ; le nom de base reçoit le suffixe `_test` s'il manque
  (`test/urls.ts`), et le global-setup refuse un nom qui ne finit pas par
  `_test`. Les URL doivent rester sur un hôte local (règle de `loadConfig`).

## Bus d'agents

`.agent-bus/` (racine du checkout principal, commun à tous les worktrees,
ignoré par git, surchargeable par `AGENT_BUS_DIR`) porte les anomalies et le
journal des révisions échangés entre développement et recette :

```bash
node scripts/agent-bus.cjs help
node scripts/agent-bus.cjs list --state "prêt au retest"
```

## Worktrees git (`.claude/worktrees/*`)

Un `git worktree` n'a pas ses propres dépendances installées : les hooks git
(Lefthook, lint-staged) et les commandes du projet y échouent tant qu'elles ne
sont pas résolvables. Avant tout `git commit` dans un worktree, lancer
`pnpm install` dans le worktree (choix par défaut, toujours sûr).

Un lien vers les dépendances du checkout principal (sous Windows, une
jonction : `mklink /J "<worktree>\node_modules" "<checkout principal>\node_modules"`)
évite une installation, mais seulement pour des outils qui suivent les liens
sans vérifier où ils mènent (hooks git, lint, typecheck). Il est à proscrire
pour `apps/web` : Next.js 15 (`next dev` / `next build`) et Turbopack refusent
un `node_modules` situé hors de la racine du projet. Avec pnpm, `node_modules`
de chaque paquet (`apps/*`, `packages/*`) contient des liens vers le magasin :
une jonction globale désynchronise aussi ces liens quand les deux checkouts sont
sur des révisions différentes. Pour les tests API d'un worktree : base de test
distincte (voir « Tests API et base de test »), jamais en parallèle d'une autre
suite sur la même base.

## Dépannage

### Hooks Lefthook

`.lefthook.yml` déclare un hook `pre-push` (`scripts/pre-push-guard.cjs`) qui
refuse une poussée vers une branche protégée (`git.protectedBranches`
d'`acc.config.json`). Un refus se corrige (passer par une branche puis une
PR), il ne se contourne pas. `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor` vérifie que les hooks
sont installés.

**Symptôme :** `node scripts/install-git-hooks.cjs` répond « Lefthook
introuvable : hooks git non installés » (code 0). **Cause :** dépendances non
installées (`node_modules` absent, par exemple dans un worktree neuf).
**Correctif :** `pnpm install` (le script `prepare` relance l'installation des
hooks), ou `node scripts/install-git-hooks.cjs` ensuite. État vérifié le
2026-10-06 : le binaire `lefthook` est dans `node_modules/.bin` et le hook
`pre-push` est présent dans `.git/hooks`.

### Autres pannes connues

- **Relation ou fonction 2FA introuvable** (erreur 500 sur les requêtes
  authentifiées ; l'erreur PostgreSQL cite `utilisateurs_2fa`, `defis_2fa` ou
  `etat_tfa_session`) : migrations `0050`–`0052` non appliquées sur la base
  utilisée. Correctif : `pnpm db:migrate`, puis relancer l'API.
- **Port occupé** (`EADDRINUSE` sur 4100 ou 3100 ; PostgreSQL : le conteneur ne
  démarre pas sur 55440) : une ancienne instance tourne encore. Identifier le
  processus (`netstat -ano | findstr :4100` sous Windows), l'arrêter, relancer.
  Changer `API_PORT` impose de reconstruire le web (`API_URL`).
- **L'API refuse de démarrer** : lire le message de `loadConfig` (il ne cite
  jamais de secret). Causes : `NODE_ENV` oublié avec une base non locale ;
  valeur de développement conservée hors développement ; `TFA_MASTER_KEY` égal à
  `SESSION_SECRET` ; `SMTP_HOST` absent ou `SMTP_TLS=aucun` en production ;
  `SMTP_USER` sans `SMTP_PASS` ; `STORAGE_DIR` absent ou relatif ;
  `CHROMIUM_PATH` relatif ou inexistant ; `OPENROUTER_BASE_URL` en HTTP hors
  boucle locale ; `CONNEXION_RAPIDE_DEMO=oui` hors développement local.
- **Bloc « Comptes de démonstration » absent** : l'API ne tourne pas avec
  `CONNEXION_RAPIDE_DEMO=oui` (relancer l'API), ou elle est injoignable par le
  web (`API_URL`). Bloc présent mais vide : lancer `db:seed-demo` sur la base
  utilisée ; groupe « Espace client » vide : lancer `db:seed-demo-portail`.
- **`DATABASE_URL doit utiliser le rôle missionpilot_app`** (migrations) :
  l'URL applicative pointe vers un autre rôle.
- **Erreurs de connexion à PostgreSQL** juste après `pnpm db:up` : le conteneur
  n'est pas encore « healthy » ; attendre quelques secondes.
- **Le web répond 404 ou 502 sur `/api/*`** : `API_URL` est figée au build de
  Next ; la corriger puis reconstruire (`pnpm --filter @missionpilot/web build`)
  ou relancer `next dev`. Vérifier aussi que l'API tourne.
- **Build web** : `next build` échoue avec un `node_modules` partagé par
  jonction (voir « Worktrees ») ; `pnpm install` dans le dossier concerné.
- **Cookie de session absent après connexion** : `WEB_ORIGIN` ne correspond pas
  à l'origine réellement utilisée par le navigateur (CORS avec credentials), ou
  accès en HTTP à un serveur configuré `production` (cookie `secure`).
- **Toute action (enregistrer, se connecter…) répond 403 `ORIGINE_REFUSEE`**
  alors que les lectures passent : le navigateur ouvre le web à une adresse
  différente de `WEB_ORIGIN` (autre nom d'hôte, IP au lieu du nom, autre port,
  `http` au lieu de `https`). La garde d'origine d'`app.ts` compare l'en-tête
  `Origin` des POST, PUT, PATCH et DELETE à `WEB_ORIGIN`. En production,
  corriger `WEB_ORIGIN` pour qu'il soit exactement l'adresse publique du web,
  puis redémarrer l'API. En développement et en test, `localhost`,
  `127.0.0.1` et `[::1]` au même port sont équivalents ; un autre port ou un
  autre nom reste refusé.
- **Rapport PDF : 503** : aucun navigateur trouvé. Hors développement Windows
  (où Chrome installé est repris), définir `CHROMIUM_PATH` (chemin absolu d'un
  Chrome ou Chromium existant ; l'API refuse de démarrer si le chemin est faux).
  503 `RENDU_OCCUPE` : deux rendus en cours, ou déjà un pour ce cabinet ;
  réessayer. 504 : rendu de plus de 30 s. Le relais Next attend jusqu'à 90 s
  (`experimental.proxyTimeout`). Word et PowerPoint n'ont pas besoin de Chrome.
- **Chrome sous Linux** (non essayé) : l'API ne passe pas `--no-sandbox`. Faire
  tourner l'API sous un utilisateur **non root** sur un noyau qui autorise les
  espaces de noms utilisateur (ou fournir la sandbox SUID de Chromium) ; ne pas
  ajouter `--no-sandbox` sans décision écrite (`docs/governance/SECURITY.md`
  §8 bis).
- **Import Excel : 503 `IMPORT_EXCEL_OCCUPE`** : deux lectures de classeur sont
  déjà en cours sur cette instance ; réessayer. 409 `IMPORT_CONCURRENT` : une
  feuille de temps a été saisie pendant l'import ; relancer la simulation.
- **Tests de volume lents ou en échec** (`plan-de-charge-perf.test.ts`,
  `finance-indicateurs-perf.test.ts`) : seuils de temps sensibles à la charge de
  la machine (autre suite, antivirus, Docker). Relancer le fichier seul avant
  d'y voir une régression.
- **Tests API qui échouent en désordre ou « relation does not exist »** :
  deux suites API ont tourné en même temps sur la même base de test (le
  global-setup recrée le schéma). Arrêter l'une, relancer l'autre.
- **Compte de démonstration refusé** : le seed n'a pas été lancé sur la base
  migrée, ou l'e-mail ne reprend pas la forme `<role>@demo.missionpilot.test`.
