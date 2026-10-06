# Conventions de code — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les conventions **observées dans le code** (état au commit
`cdaf666`), avec un fichier de référence pour chacune, pas un idéal. Les
contrôles mécaniques sont dans `.claude/rules/review-checklist.md`.

## 1. Organisation du dépôt

Monorepo pnpm (ADR-001), TypeScript strict (`tsconfig.base.json`), modules ESM.

| Dossier             | Rôle                                                                 | Peut importer                         |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `packages/engines`  | moteurs de calcul purs (planning, finance), sans E/S                 | rien d'applicatif                     |
| `packages/shared`   | rôles, permissions, schémas Zod, types partagés                      | rien d'applicatif                     |
| `apps/api`          | API Fastify : `src/routes`, logique par domaine, `migrations`, `test`| `engines`, `shared`                   |
| `apps/web`          | interface Next.js (français), `src/app`, `src/lib`, `src/components` | `shared` (pas `engines`, vérifié)     |

- Configuration de l'API : un seul point, `apps/api/src/config.ts`
  (`loadConfig`). `.env.example` à la racine documente les variables.
- Migrations SQL numérotées par plage de domaine dans `apps/api/migrations` :
  `0001–0008` socle, référentiels et durcissement ; `0010–0015` pipeline,
  missions, budget, documents ; `0020–0021` planification ; `0030` temps ;
  `0040–0044` facturation ; `0050–0052` double authentification ;
  `0060–0063` finance (encaissements, relances, bilans, plan comptable). Un
  durcissement issu d'audit prend le numéro suivant du domaine. Une migration
  appliquée n'est jamais modifiée (voir §10 : l'outil ne le vérifie pas).
- Les imports relatifs de l'API portent l'extension `.js` (ex.
  `import … from "../audit.js"`).
- Le web appelle l'API uniquement par `/api/*` relayé par Next
  (`apps/web/next.config.mjs`).

## 2. Nommage

- **Base de données** : français sans accents, `snake_case`, pour tables et
  colonnes (`journal_audit`, `mot_de_passe_hash`, `cree_le`, `sequences_facturation`).
  Pluriel pour les tables d'entités. Montants en colonnes `bigint` ; identifiants
  `uuid` ; `cabinet_id` sur toute table métier.
- **Code** : identifiants métier en français (`exigerMissionVisible`,
  `journaliser`, `creerLimiteur`), types et fonctions en `camelCase`, constantes
  en `MAJUSCULES` (`DUREE_SESSION_MS`). Fichiers en `kebab-case`
  (`double-authentification.ts`, `confirmer-identite.ts`).
- **JSON de l'API** : clés en `snake_case` français (`mot_de_passe`,
  `tfa_active`, `curseur_suivant`), identique aux colonnes.
- **Permissions** : `domaine.action` (`finance.lire`, `facture.emettre`),
  `packages/shared/src/roles.ts`.
- **Codes SQLSTATE métier** : `MP` + lettre de domaine + numéro (`MPF` figé,
  `MPT` temps, `MPB` facturation, `MPE` encaissements).
- **Codes d'erreur** : `MAJUSCULES_SOULIGNEES` (`NON_AUTHENTIFIE`, `INTERDIT`,
  `INTROUVABLE`, `REQUETE_INVALIDE`, `CONFLIT`, `ERREUR_INTERNE`).

## 3. Couches et responsabilités

- **Routes** (`apps/api/src/routes/*.ts`) : plugin Fastify par ressource,
  enregistré sous `/api` via les regroupements `routes/*-routes.ts` /
  `referentiels.ts` (`app.ts`). Une route appelle `exiger(request, permission)`,
  valide l'entrée par un schéma de `packages/shared`, ouvre `withTenant`, et
  délègue.
- **Logique par domaine** (`missions/`, `facturation/`, `finance/`,
  `planification/`, `temps/`, `auth/`, `notifications/`, `jobs/`) : accès aux
  données et règles, dans la transaction reçue (`Db`). Une fonction ne
  commence pas sa propre transaction.
- **Calculs : uniquement dans `packages/engines`.** Jours, montants, TVA,
  remises, marges, ratios, conversions, échéanciers ne se calculent ni dans
  les routes, ni en SQL (aucun `SUM`/`AVG` de montants), ni dans le web. Les
  montants sont des entiers d'unités mineures (FCFA : 1 unité ; EUR/USD :
  centimes) ; `Montant` du moteur, `montantSchema` (`schemas/commun.ts`). Les
  pourcentages sont validés à quatre décimales.
- **Base** : aucune requête hors `withTenant` / `withoutTenant`
  (`db/pool.ts`) ; les règles qui doivent tenir même si le code est contourné
  (immuabilité, numérotation, périodes closes) sont des déclencheurs SQL.
- **Web** : `app/` pages et layouts, `lib/` logique pure testée, `components/`
  composants ; la garde d'une page est `exigerPermission` (`lib/session.ts`).

## 4. Erreurs

- Erreur métier : `AppError(statut, code, message)` et ses fabriques
  (`nonAuthentifie`, `interdit`, `introuvable`, `requeteInvalide`, `conflit`) dans
  `apps/api/src/errors.ts`. Messages en français, sans donnée sensible.
- Enveloppe unique `{ "erreur": { "code", "message" } }` (plus `details` pour
  une erreur Zod, 400) produite par `setErrorHandler` d'`app.ts` ; une erreur
  inattendue répond 500 `ERREUR_INTERNE` et ne journalise que message, code,
  contrainte et table.
- Les violations PostgreSQL attendues (unicité 23505, référence 23503, SQLSTATE
  `MP…`) se traduisent par `traduireErreursPg` (`db/outils.ts`) ou par la couche
  métier du domaine (`finance/erreurs.ts`).
- Ressource d'un autre cabinet ou invisible : 404, jamais 403.

## 5. Configuration

- Point d'entrée unique : `loadConfig` (`apps/api/src/config.ts`), schéma Zod,
  messages d'erreur sans valeur de secret.
- Valeurs par défaut : seulement celles du dictionnaire `DEV`, identiques à
  `.env.example`, refusées hors développement et test et avec une base non
  locale. Jamais de valeur par défaut pour un secret en dehors de `DEV`.
- Côté web, seule `API_URL` est lue (sans secret) ; pas de `NEXT_PUBLIC_*`.

## 6. Textes affichés et internationalisation

Interface 100 % française en V1 (PRD, « Localisation »), anglais en V2. Il
n'existe pas encore de mécanisme de traduction : les libellés sont écrits en
français dans le code (`apps/web/src`), les rôles ont leurs libellés dans
`ROLE_LIBELLES` (`packages/shared/src/roles.ts`). Dates affichées `JJ/MM/AAAA`,
montants formatés par le moteur (`formaterMontant`). Dates d'API : `AAAA-MM-JJ`
(`dateIsoSchema`), bornées pour la facturation à 2000–2100
(`dateFacturationSchema`, doublé par des contraintes en base, `0040`).
Mise en page de droite à gauche : sans objet.

## 7. Tests

- **Vitest partout** (`pnpm test` = `pnpm -r test`). API : tests sur **vrai
  PostgreSQL** dans `apps/api/test/*.test.ts` (48 fichiers), base dédiée
  `<nom>_test` créée à la volée et réinitialisée à chaque exécution
  (`test/global-setup.ts`, `test/urls.ts`) ; `fileParallelism: false` dans
  `apps/api/vitest.config.ts` : jamais deux suites API en parallèle.
- Helpers : `test/helpers.ts` (`demarrer`, `creerCabinet`, `proprietaire`) et
  `test/*-outils.ts` par domaine. Un changement de comportement s'accompagne
  d'un test ; une faille corrigée, d'un test de non-régression.
- Les garanties de base se testent avec le rôle applicatif réel
  (`isolation.test.ts`), pas avec le propriétaire.
- **Moteurs** : `packages/engines` exige une couverture ≥ 90 % (lignes,
  fonctions, branches, instructions), `vitest.config.ts` ; `pnpm test` y lance
  `--coverage`.
- Web : tests de la logique pure de `src/lib` et du `middleware`
  (`apps/web/vitest.config.mts`).
- Commandes ciblées : `pnpm --filter @missionpilot/api exec vitest run
  test/factures.test.ts` ; `pnpm --filter @missionpilot/engines test`.

## 8. Taille et forme du code

- Une fonction nouvellement écrite vise moins de 50 lignes ; au-delà, se
  demander si un découpage est possible. Ce n'est pas une réécriture
  rétroactive du code existant.
- Un changement de comportement est accompagné d'au moins un test qui
  l'exerce.
- Pas de nouvelle erreur de typage ou de lint dans un fichier qui en était
  exempt. Prettier : 100 colonnes, guillemets doubles, virgule finale
  (`.prettierrc.json`) ; ESLint `typescript-eslint` recommandé, variables
  inutilisées interdites hors préfixe `_`.
- **Validation** : chaque corps, paramètre ou requête passe par un schéma Zod de
  `packages/shared/src/schemas`, objets `.strict()` (143 `z.object` vérifiés) ;
  le même schéma sert l'API et le web.
- **Listes** : pagination par curseur opaque (`encoderCurseur`,
  `decoderCurseur`, `paginer` dans `apps/api/src/http/outils.ts`), lecture
  `LIMIT n+1`, limite bornée (`limite` 1 à 100, défaut 30, `schemas/facturation.ts`).
  Pas de `LIMIT` silencieux (deux écarts : voir §10).
- **Écritures** : verrou `FOR UPDATE` quand une règle dépend de l'état lu,
  journalisation dans la même transaction.

## 9. Branches et commits

- Une branche `type/sujet` par changement, partant de `main`.
- Commits conventionnels (`feat(module): …`, `fix(module): …`,
  `docs: …`, `chore: …`), dans la langue du projet.
- Jamais de poussée directe ni forcée sur une branche protégée
  (main, master), jamais `--no-verify`.

## 10. Dette connue

Relevée dans le code le 2026-10-06 ; ne pas y ajouter sans citer le fichier.
La dette de sécurité est détaillée dans `docs/governance/SECURITY.md` §15.

- **`LIMIT 500` sans pagination** sur `GET /missions` (`routes/missions.ts`) et
  `GET /opportunites` (`routes/opportunites.ts`) : troncature silencieuse.
- **Justificatif de débours** : chemin texte saisi par le client, en attente du
  téléversement (`routes/debours.ts`, en-tête).
- **Date d'atteinte d'un jalon** non horodatée en V1, approchée par la dernière
  modification (`finance/indicateurs.ts`).
- **Inversion de la parité EUR/FCFA** : `Number((1 / PARITE).toFixed(10))` dans
  `routes/missions.ts` (`pariteFixe`), seul calcul de taux hors moteur ; à
  déplacer dans `packages/engines`.
- **Migrations sans somme de contrôle** : l'immuabilité d'une migration
  appliquée repose sur la relecture (`db/migrate.ts`).
- **Pas de mécanisme de traduction** (§6) : l'anglais prévu en V2 impose
  d'extraire les libellés.
- **Limiteurs de tentatives en mémoire** par processus (`auth/limiteur.ts`).
- **Volume** : un test de performance de plan de charge et d'indicateurs est
  sensible à la charge de la machine : seuils de temps (3 s pour les indicateurs) dans `plan-de-charge-perf.test.ts` et
  `finance-indicateurs-perf.test.ts`.
- **Écarts de documentation** : `docs/workflows/HANDOFF.md` contient encore
  des états anciens (nombres de tests, section dupliquée), à réécrire par
  son propriétaire.
