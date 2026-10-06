# ADR-001 : Monorepo pnpm, Fastify, Next.js, PostgreSQL avec RLS

## Statut

Accepté

## Date

2026-10-06

## Contexte

Le dépôt ne contient que la spécification. Le PRD recommande la stack
d'EcoleDigitale (monorepo pnpm, Fastify, Next.js, PostgreSQL avec RLS) sans
la trancher. Contraintes : isolation entre cabinets testée en CI (SOC-01),
chiffres calculés par un moteur testé (`packages/engines`, couverture ≥ 90 %),
coûts et marges visibles des seuls associés et gestionnaires, interface 100 %
française, utilisable en 3G, PWA.

## Décision

- Monorepo **pnpm** (Node ≥ 20, TypeScript strict) :
  - `apps/api` : Fastify, validation par Zod, accès PostgreSQL ;
  - `apps/web` : Next.js (App Router), interface en français, responsive/PWA ;
  - `packages/engines` : fonctions pures de calcul (temps, budget, marges,
    capacité, indicateurs), sans dépendance à la base ni au réseau ;
  - `packages/shared` : schémas Zod, types, constantes de rôles et de droits
    partagés entre API et web.
- **PostgreSQL 16+** avec sécurité au niveau des lignes : chaque table métier
  porte `cabinet_id` ; l'API ouvre une transaction par requête et fixe
  `app.cabinet_id` ; les politiques RLS filtrent sur ce paramètre. Le rôle
  applicatif n'est pas propriétaire des tables (sinon RLS contournée).
- Tests : Vitest. Les tests d'isolation s'exécutent contre un vrai PostgreSQL.
- Migrations SQL versionnées (`apps/api/migrations`), exécutées par un script
  maison minimal ; pas d'ORM, requêtes paramétrées uniquement.

## Conséquences positives

- Un seul langage ; types partagés entre front et back ; moteurs testables
  sans infrastructure.
- L'isolation entre cabinets tient en base, pas seulement dans le code.

## Conséquences négatives

- RLS impose une discipline : toute requête passe par la transaction
  contextualisée ; un oubli donne zéro ligne, pas une fuite (échec sûr).
- Sans ORM, les requêtes sont écrites à la main.

## Alternatives écartées

- **ORM (Prisma, Drizzle)** — la gestion de `SET LOCAL` par transaction et de
  RLS y est moins directe ; décision réversible si le volume de SQL pèse.
- **Isolation applicative seule (`WHERE cabinet_id`)** — un oubli fuit des
  données ; refusé par le PRD.

## Liens

- PRD, « Architecture et stack technique » ; SOC-01 ; `docs/governance/SECURITY.md`.
