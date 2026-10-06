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
| `WEB_ORIGIN`                | origine autorisée par CORS (défaut `http://localhost:3100`)                            | oui (adresse réelle du web)    |
| `API_URL`                   | adresse de l'API pour le relais `/api/*` du web ; lue **au build** de Next             | oui (reconstruire si elle change) |
| `SESSION_SECRET`            | secret de session, 32 caractères minimum ; clé de version 1 du chiffrement             | oui, différent du défaut       |
| `TFA_MASTER_KEY`            | secret maître du chiffrement 2FA et des e-mails en file, 32 car. min., ≠ `SESSION_SECRET` | oui, différent du défaut    |
| `TFA_MASTER_KEY_PRECEDENTE` | ancienne clé pendant une rotation                                                      | non                            |
| `SMTP_HOST`, `SMTP_PORT`    | transport e-mail ; sans hôte, journal local (développement et test seulement)          | `SMTP_HOST` oui                |
| `SMTP_USER`, `SMTP_PASS`    | identifiants SMTP, à fournir ensemble, jamais journalisés                              | non                            |
| `SMTP_TLS`                  | `implicite` (465), `starttls` (587) ; `aucun` refusé hors développement                | non (jamais `aucun`)           |
| `MAIL_FROM`                 | expéditeur, adresse ASCII, obligatoire dès que `SMTP_HOST` est défini                  | oui avec SMTP                  |
| `TOTP_REQUIS`               | `oui` impose la 2FA aux rôles sensibles de tous les cabinets (plancher plateforme)     | non                            |
| `JOBS_WORKER`               | `actif` ou `inactif` ; actif par défaut, inactif par défaut en test                    | non                            |
| `OPENROUTER_API_KEY`        | clé IA (V2, aucun appel aujourd'hui)                                                   | non                            |

### Comptes de démonstration

Cabinet « Cabinet Démo » : un compte par rôle, adresse
`<role>@demo.missionpilot.test` (rôle avec `.` à la place de `_`, ex.
`directeur.mission@…`). Le mot de passe est la constante `MOT_DE_PASSE_DEMO` de
`apps/api/src/db/seed.ts` : ne pas le recopier ailleurs. Comptes de test locaux
uniquement.

## Lancer

```bash
pnpm dev     # API (tsx watch, 4100) et web (next dev -p 3100) en parallèle
```

Sonde de l'API : `GET http://localhost:4100/api/sante` (sans authentification).
Le worker de jobs démarre avec l'API (rappels de temps, relances, file
d'e-mails) ; `JOBS_WORKER=inactif` le coupe. L'interface est sur
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
  `SMTP_USER` sans `SMTP_PASS`.
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
- **Tests de volume lents ou en échec** (`plan-de-charge-perf.test.ts`,
  `finance-indicateurs-perf.test.ts`) : seuils de temps sensibles à la charge de
  la machine (autre suite, antivirus, Docker). Relancer le fichier seul avant
  d'y voir une régression.
- **Tests API qui échouent en désordre ou « relation does not exist »** :
  deux suites API ont tourné en même temps sur la même base de test (le
  global-setup recrée le schéma). Arrêter l'une, relancer l'autre.
- **Compte de démonstration refusé** : le seed n'a pas été lancé sur la base
  migrée, ou l'e-mail ne reprend pas la forme `<role>@demo.missionpilot.test`.
