Reporté dans la documentation le 2026-10-21 (lot 9a).

# Notes du lot 8a : intégration continue GitHub Actions

Branche `orch/2026-10-20-reste-lot-8a`, aucun commit. Le dépôt n'avait aucune CI (pas de dossier
`.github`).

## Ce que fait la CI (`.github/workflows/ci.yml`)

- **Déclencheurs** : `pull_request` vers `main` et `workflow_dispatch` seulement (pas à chaque push).
- **`concurrency`** : une nouvelle exécution sur la même PR (ou la même branche lancée à la main)
  annule la précédente. **`permissions: contents: read`**. Aucun secret.
- **Job `qualite`** (20 min max) : `actions/checkout@v4`, `pnpm/action-setup@v4` (version lue dans
  `packageManager`, soit pnpm 10.26.2), `actions/setup-node@v4` (Node 20, cache pnpm), puis
  `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm format`,
  `pnpm --filter @missionpilot/engines test` (couverture, seuils 90 % de leur `vitest.config.ts`),
  puis les tests de `@missionpilot/shared` et `@missionpilot/web`.
- **Job `api`** : matrice de 4 partitions (`npx vitest run --shard=i/4` dans `apps/api`,
  `fail-fast: false`, 45 min max). Chaque partition a son propre runner, donc son propre PostgreSQL :
  la règle « jamais deux suites API sur la même base » est respectée. PostgreSQL 16 est lancé par
  `docker run postgres:16-alpine ... postgres -c max_locks_per_transaction=256` (un service GitHub
  n'accepte pas d'arguments de commande ; sans ce réglage, `DROP SCHEMA ... CASCADE` du global-setup
  dépasse les verrous). L'attente utilise `pg_isready -h 127.0.0.1` (TCP, car le serveur temporaire
  d'initialisation de l'image n'écoute que sur socket Unix). `DATABASE_OWNER_URL` et `DATABASE_URL`
  reprennent les valeurs publiques de développement de `.env.example` / `apps/api/src/config.ts`
  (hôte `127.0.0.1:55440`, base `missionpilot`, que le global-setup suffixe en `missionpilot_test`).
  Aucune étape de migration ni de création de rôle : le global-setup appelle `migrate()`, qui crée le
  rôle applicatif `missionpilot_app`.
- **Reprise sur échec** : `apps/api/vitest.config.ts` active `retry: process.env.CI ? 1 : 0` (les
  tests connus instables sous charge : kpi-alertes, jobs, canaux-kpi-suivi, auth-limiteur). Hors CI,
  comportement inchangé (GitHub Actions définit `CI=true`).

## Comment la relancer

- Sur la PR : onglet « Checks » puis « Re-run failed jobs » (relance seulement les partitions en
  échec), ou pousser un nouveau commit (annule l'exécution précédente).
- À la main : onglet « Actions » puis « CI » puis « Run workflow » (choisir la branche), ou
  `gh workflow run CI --ref <branche>`.
- Pour reproduire une partition en local : voir RUNBOOK, « Tests API et base de test », avec
  `npx vitest run --shard=i/4` dans `apps/api` et une base dédiée.

## À reporter par le superviseur

### `docs/workflows/RUNBOOK.md`

- Section « Tests API et base de test » (phrase sur la CI) : préciser que la CI GitHub
  (`.github/workflows/ci.yml`) lance les tests API en 4 partitions `--shard=i/4`, chacune sur un
  PostgreSQL 16 jetable (`docker run`, `max_locks_per_transaction=256`, port 55440 sur 127.0.0.1) ;
  pour rejouer une partition : `cd apps/api && npx vitest run --shard=1/4`.
- Ajouter une courte section « Intégration continue » : déclencheurs (PR vers `main`,
  `workflow_dispatch`), jobs `qualite` et `api`, relance (voir ci-dessus), `retry: 1` seulement si
  `CI` est défini.

### `AGENTS.md`

- Retirer toute mention « Aucune CI GitHub » (devenue fausse). Dans les commandes ou les pièges
  connus, ajouter : « CI GitHub : `.github/workflows/ci.yml` (PR vers `main` et lancement manuel) ;
  le job `api` est partitionné en 4 ; une modification de `apps/api/vitest.config.ts`, du global-setup
  ou de `docker-compose.yml` (`max_locks_per_transaction`) doit rester cohérente avec le workflow. »
- Les deux renvois « imposée en CI » (couverture des moteurs, RLS) deviennent vrais : rien à changer.

### `docs/workflows/HANDOFF.md`

- Consigner : CI ajoutée mais **jamais exécutée sur GitHub** à la livraison du lot (voir limites) ;
  vérifier la première exécution sur la PR du lot et corriger au besoin.
- Recommander (hors dépôt) : déclarer les jobs `qualite` et `api (partition i/4)` comme contrôles
  requis dans la protection de la branche `main`, une fois la première exécution verte.

## Limites et vérifications

- **Non exécuté sur GitHub** : la CI n'a pas pu être lancée depuis la session. Vérifié en local :
  syntaxe YAML (`js-yaml`) et conformité au schéma GitHub Actions (`@action-validator/cli`),
  `prettier --check` du workflow, commandes du job `qualite`, et une partition
  (`vitest run --shard=1/4` avec `CI=true`) sur une base dédiée.
- Mesure locale de la partition 1/4 : 54 fichiers, 606 tests verts en environ 19 minutes (machine
  chargée par d'autres sessions) ; la limite de 45 minutes par partition laisse de la marge, à revoir
  après la première exécution réelle.
- Actions épinglées par version majeure (`@v4`) ; image `postgres:16-alpine` (identique à
  `docker-compose.yml`).
- Les partitions de Vitest répartissent les fichiers par hachage : les durées ne sont pas égales.
  Si l'une dépasse nettement les autres, ajuster le nombre de partitions.
- Les tests API n'ont pas besoin de Chrome ni de service externe (puppeteer-core non lancé dans les
  tests ; canaux et IA simulés).
