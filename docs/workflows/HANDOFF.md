# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (règle posée dans AGENTS.md et CLAUDE.md).

## Mode d'emploi

- Une section par branche, la plus récente en haut. Réécrire la section de sa
  branche au lieu d'empiler des entrées : ce fichier décrit l'état présent, pas
  l'historique (l'historique, c'est `git log`).
- Supprimer la section d'une branche une fois fusionnée dans
  `main`.
- Dates absolues (`AAAA-MM-JJ`), jamais « hier ».
- Chaque worktree a sa copie : en cas de conflit à la fusion, garder les deux
  sections de branche, elles sont indépendantes.
- Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`), pas
  ici.
- Pas de secret, pas de donnée personnelle, pas de contenu de `.env`.

Modèle de section :

```markdown
## Branche `type/sujet` — AAAA-MM-JJ

**État :** en cours | prêt à relire | bloqué
**Dernier commit :** `abc1234` résumé

Fait :

- …

Reste à faire :

- …

Pièges et décisions :

- …
```

---

## Branche `feat/socle-monorepo` — 2026-10-06

**État :** en cours (vague 1 de réalisation)
**Dernier commit :** `4c0e8e0` socle monorepo, API, RLS, authentification

Fait :

- Cadrage validé par l'utilisateur (voir `docs/DECISIONS.md`) : V1 puis V2
  enchaînées, saisie des temps paramétrable (demi-journée ou heure), zone
  UEMOA, catalogue de conseil. ADR-001 à 003 (PR #3).
- Socle (PR #4) : monorepo pnpm, API Fastify, migration 0001 (RLS, sessions,
  audit en ajout seul, file `jobs`), droits par rôle, 19 tests sur PostgreSQL.
- Base de développement dédiée : conteneur `missionpilot-postgres`, port 55440
  (`pnpm db:up`). Les autres conteneurs PostgreSQL de la machine sont à
  d'autres projets : ne jamais y toucher.

En cours (agents, non commités) :

- `packages/engines/src/planning` : unités, calendrier UEMOA, budget/temps,
  capacité, recalage.
- `packages/engines/src/finance` : monnaie, budget, rentabilité, facturation.
- `apps/api` : référentiels (utilisateurs, invitations, cabinet, clients,
  collaborateurs, grades, catalogue, audit, seed), migrations 0002–0009.
- `apps/web` : shell, design system, connexion.

Reste à faire (ordre) : vague 2 = missions, planification, affectations, plan
de charge, congés ; vague 3 = temps, budget, alertes ; vague 4 = facturation,
encaissements, indicateurs, rentabilité ; puis V2 (questionnaires, notation,
planification stratégique, KPI, portail client, OpenRouter).

Pièges et décisions :

- Tests API : une seule base `missionpilot_test`, réinitialisée à chaque
  exécution ; ne jamais lancer deux suites API en parallèle.
- Migrations : plages réservées par agent pour éviter les collisions
  (0002–0009 référentiels, 0010–0019 missions, 0020–0029 temps, 0030+ finance).
- Les fêtes musulmanes (lunaires) sont saisies par le cabinet, non calculées ;
  les fériés nationaux par pays sont des valeurs par défaut à faire valider.
- Pas de `.env` : valeurs de développement par défaut dans `apps/api/src/config.ts`.
