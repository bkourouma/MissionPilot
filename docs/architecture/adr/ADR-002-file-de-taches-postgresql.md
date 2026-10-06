# ADR-002 : File de tâches en table PostgreSQL

## Statut

Accepté

## Date

2026-10-06

## Contexte

Le PRD cite BullMQ (Redis) pour les générations IA et les rapports ;
`docs/DECISIONS.md` retient une table `jobs` PostgreSQL. Il faut aussi
exécuter les rappels de feuilles de temps, les relances, les clôtures
mensuelles et le rendu PDF.

## Décision

File de tâches en table `jobs` PostgreSQL, consommée par `SELECT … FOR UPDATE
SKIP LOCKED`, avec statut, tentatives, reprise sur échec, planification
(`run_at`) et progression. Chaque job porte `cabinet_id` et s'exécute dans
le contexte RLS de son cabinet. Redis n'est pas déployé en V1.

## Conséquences positives

- Un composant de moins à exploiter ; exécution unique garantie.
- Jobs transactionnels avec les données métier (pas de double écriture).

## Conséquences négatives

- Débit inférieur à Redis ; suffisant pour 100 cabinets / 5 000 utilisateurs.
  À réévaluer si le volume l'exige (Redis reste dans `docker-compose.yml` en option).

## Alternatives écartées

- **BullMQ** — composant supplémentaire sans besoin de débit démontré.

## Liens

- `docs/DECISIONS.md`, « Décisions techniques » ; ADR-001.
