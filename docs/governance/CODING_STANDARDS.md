# Conventions de code — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les conventions **observées dans le code** (état de la
branche `feat/vague-0-reliquats`, 2026-10-08), avec un fichier de référence pour chacune, pas un idéal. Les
contrôles mécaniques sont dans `.claude/rules/review-checklist.md`.

## 1. Organisation du dépôt

Monorepo pnpm (ADR-001), TypeScript strict (`tsconfig.base.json`), modules ESM.

| Dossier             | Rôle                                                                 | Peut importer                         |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `packages/engines`  | moteurs de calcul purs, sans E/S : planning, finance, questionnaires, notation, KPI, plan stratégique et modèle financier | rien d'applicatif |
| `packages/shared`   | rôles, permissions, schémas Zod, types partagés                      | rien d'applicatif                     |
| `apps/api`          | API Fastify : `src/routes`, logique par domaine, `migrations`, `test`| `engines`, `shared`                   |
| `apps/web`          | interface Next.js (français), `src/app`, `src/lib`, `src/components` | `shared` (pas `engines`, vérifié : aucun import, seulement des commentaires) |

- Configuration de l'API : un seul point, `apps/api/src/config.ts`
  (`loadConfig`). `.env.example` à la racine documente les variables.
- Migrations SQL numérotées par plage de domaine dans `apps/api/migrations` :

  | Plage         | Domaine                                                            |
  | ------------- | ------------------------------------------------------------------ |
  | `0001–0008`   | socle, référentiels, durcissement                                  |
  | `0010–0015`   | pipeline, missions, découpage, budget, documents                   |
  | `0020–0021`   | planification                                                      |
  | `0030`, `0076`, `0122` | temps (`0076` : code de la tâche figée, `0122` : idempotence des saisies) |
  | `0040–0044`   | facturation                                                        |
  | `0050–0052`   | double authentification                                            |
  | `0060–0064`   | finance (encaissements, relances, bilans, plan comptable)          |
  | `0070–0075`   | fichiers, documents, justificatifs, commentaires, tâches           |
  | `0100–0104`   | IA (paramètres, prompts, générations, durcissement, conservation)  |
  | `0110–0115`   | portail client (rôles, partages, invitations, RLS, KPI)            |
  | `0120–0121`   | limiteur de tentatives persistant, pagination par curseur          |
  | `0130–0132`   | rapports générés (`0131` notation et plan, `0132` conservation)   |
  | `0140–0143`, `0148–0150` | questionnaires (`0148` : reprise des relances, `0149` : génération IA, `0150` : date limite) |
  | `0145–0147`   | notation (`0144` n'est pas utilisé)                                |
  | `0160`        | KPI                                                                |
  | `0180–0184`   | plans stratégiques, modèle financier, diagnostic, KPI d'objectif, dépendances |

  Plages libres : `0151–0159`, `0170–0179`, `0185–0199`. Plages réservées
  pour la suite (vagues 1 à 3 du PRD complémentaire) : `0200–0219` référentiel
  de méthodes (STD), `0220–0239` dossier client (DOS), `0240–0259` registre des
  preuves (PRV), `0260–0279` agents IA (AGT), `0280–0299` qualité (QUA). Un
  durcissement issu d'audit prend le numéro suivant de son domaine (prochain
  pour les plans : `0185`). Une migration **commitée** n'est jamais modifiée : on ajoute un
  fichier (voir §10 : l'outil ne le vérifie pas). Une migration encore **non
  commitée** peut être corrigée sur place, à condition de recréer les bases qui
  l'ont appliquée (les bases de test le sont à chaque exécution).
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
- **Permissions** : `domaine.action` (`finance.lire`, `facture.emettre`,
  `portail.kpi.saisir`), `packages/shared/src/roles.ts`.
- **Codes SQLSTATE métier** : `MP` + lettre de domaine + numéro. Lettres
  employées : `F` figé (propositions, budget, absences), `T` temps, `B`
  facturation, `E` encaissements et bilans, `D` documents, `C` commentaires,
  `I` IA, `P` portail, `Q` questionnaires, `N` notation, `K` KPI, `S` plans
  stratégiques, `R` rapports (`MPR01-02`, `0131`). `MPT01` ne désigne plus que
  les feuilles de temps : l'identité figée des tâches assignées est `MPC02`
  (`0076`). Un nouveau code prend un numéro libre de sa lettre (liste :
  `SECURITY.md` §6).
- **Codes d'erreur** : `MAJUSCULES_SOULIGNEES` (`NON_AUTHENTIFIE`, `INTERDIT`,
  `INTROUVABLE`, `REQUETE_INVALIDE`, `CONFLIT`, `ERREUR_INTERNE`, et codes de
  domaine comme `PORTAIL_ROUTE_INTERDITE`, `ORIGINE_REFUSEE`).

## 3. Couches et responsabilités

- **Routes** (`apps/api/src/routes/*.ts`) : plugin Fastify par ressource,
  enregistré sous `/api` via les regroupements `routes/*-routes.ts` /
  `referentiels.ts` (`app.ts`). Une route appelle `exiger(request, permission)`
  (ou `exigerPortail` côté portail), valide l'entrée par un schéma de
  `packages/shared`, ouvre `withTenant`, et délègue.
- **Logique par domaine** (`missions/`, `facturation/`, `finance/`,
  `planification/`, `temps/`, `auth/`, `notifications/`, `jobs/`, `stockage/`,
  `collaboration/`, `catalogue/`, et en V2 `ia/`, `portail/`,
  `questionnaires/`, `notation/`, `kpi/`, `plans/`, `rapports/`) : accès aux
  données et règles, dans la transaction reçue (`Db`). Une fonction ne
  commence pas sa propre transaction.
- **Calculs : uniquement dans `packages/engines`.** Jours, montants, TVA,
  remises, marges, ratios, conversions, échéanciers, scores de notation, KPI,
  modèle financier ne se calculent ni dans les routes, ni en SQL (aucun
  `SUM`/`AVG`), ni dans le web. Les montants sont des entiers d'unités mineures
  (FCFA : 1 unité ; EUR/USD : centimes) ; `Montant` du moteur, `montantSchema`
  (`schemas/commun.ts`). Les pourcentages sont validés à quatre décimales.
- **Base** : aucune requête hors `withTenant` / `withoutTenant`
  (`db/pool.ts`) ; les règles qui doivent tenir même si le code est contourné
  (immuabilité, numérotation, périodes closes, séparation des tâches de la
  notation et des plans, cloisonnement du portail) sont des déclencheurs ou des
  politiques SQL.
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
  métier du domaine (`finance/erreurs.ts`, `kpi/erreurs.ts`, `plans/erreurs.ts`,
  `questionnaires/erreurs.ts`, table `ERREURS_SQL` de `routes/portail.ts`).
- Ressource d'un autre cabinet, invisible ou non partagée : 404, jamais 403.

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
  PostgreSQL** dans `apps/api/test/*.test.ts` (101 fichiers), base dédiée
  `<nom>_test` créée à la volée et réinitialisée à chaque exécution
  (`test/global-setup.ts`, `test/urls.ts`) ; `fileParallelism: false` dans
  `apps/api/vitest.config.ts` : jamais deux suites API en parallèle sur la même
  base.
- **Plusieurs agents** : chacun sa base (`DATABASE_URL` /
  `DATABASE_OWNER_URL` vers `missionpilot_<id>`, suffixe `_test` ajouté),
  jamais deux suites API simultanées sur la même base (voir RUNBOOK).
- Helpers : `test/helpers.ts` (`demarrer`, `creerCabinet`, `proprietaire`) et
  `test/*-outils.ts` par domaine. Un changement de comportement s'accompagne
  d'un test ; une faille corrigée, d'un test de non-régression.
- Les garanties de base se testent avec le rôle applicatif réel
  (`isolation.test.ts`), pas avec le propriétaire. Le portail a ses tests
  d'inventaire : routes (`portail-acces.test.ts`), politiques
  (`isolation.test.ts`), sortie `horsContextePortail`
  (`portail-contexte.test.ts`).
- **Moteurs** : `packages/engines` exige une couverture ≥ 90 % (lignes,
  fonctions, branches, instructions), `vitest.config.ts` ; `pnpm test` y lance
  `--coverage` (relevé du 2026-10-06 : 100 % des lignes, 99,81 % des branches).
- Web : tests de la logique pure de `src/lib`, du `middleware` et du service
  worker (`src/lib/hors-ligne/sw.test.ts`) ; `apps/web/vitest.config.mts`.
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
  `packages/shared/src/schemas`, objets `.strict()` (256 `z.object` vérifiés
  le 2026-10-08, tous stricts) ; le même schéma sert l'API et le web.
- **Listes** : pagination par curseur opaque (`encoderCurseur`,
  `decoderCurseur`, `paginer` dans `apps/api/src/http/outils.ts`), lecture
  `LIMIT n+1`, limite bornée (`limite` 1 à 100, défaut 30, `schemas/facturation.ts`).
  `GET /missions` et `GET /opportunites` trient par `cree_le DESC, id DESC`
  avec comparaison de ligne et index dédiés (`0121`). Pas de `LIMIT` silencieux
  (un écart connu : voir §10).
- **Écritures** : verrou `FOR UPDATE` quand une règle dépend de l'état lu
  (ou verrou consultatif `pg_advisory_xact_lock` pour sérialiser un traitement
  de cabinet : plafond IA, import des temps), journalisation dans la même
  transaction.

## 9. Branches et commits

- Une branche `type/sujet` par changement, partant de `main`.
- Commits conventionnels (`feat(module): …`, `fix(module): …`,
  `docs: …`, `chore: …`), dans la langue du projet.
- Jamais de poussée directe ni forcée sur une branche protégée
  (main, master), jamais `--no-verify`.

## 10. Dette connue

Relevée dans le code le 2026-10-08 ; ne pas y ajouter sans citer le fichier.
La dette de sécurité est détaillée dans `docs/governance/SECURITY.md` §15.
Résolu depuis le relevé précédent : `LIMIT 500` des missions et opportunités
(pagination par curseur, `0121`), justificatif de débours en texte libre
(téléversement), limiteurs de tentatives en mémoire (persistants, `0120`) ;
en vague 0, collision de `MPT01` (`0076`), incohérence de `notation.publier`
(`roles.ts`), commentaire de `portail/contexte.ts`.

- **Listes de gestion du portail** plafonnées à 500 sans curseur
  (`routes/portail-gestion.ts`, `MAX_LISTE` : utilisateurs et invitations d'un
  client) : la troncature est désormais **signalée** (`tronque: true`) mais la
  liste n'est pas paginée.
- **Date d'atteinte d'un jalon** non horodatée en V1, approchée par la dernière
  modification (`finance/indicateurs.ts`).
- **Inversion de la parité EUR/FCFA** : `Number((1 / PARITE_EUR_FCFA).toFixed(10))`
  dans `routes/missions.ts` (`pariteFixe`), seul calcul de taux hors moteur ; à
  déplacer dans `packages/engines`.
- **Conservation IA non exposée** : `ia_parametres_cabinet.conservation_jours`
  (`0104`, 365 jours par défaut) n'est ni lisible ni modifiable par l'API IA
  (`routes/ia-parametres.ts`) ; durées par défaut des textes IA et des rapports
  à valider avec le conseil juridique (DECISIONS.md).
- **Rédaction assistée** du plan et des rapports de notation non faite : seules
  les routes `/api/ia/*` et la génération de questionnaires (`0149`) appellent
  l'orchestrateur.
- **Plan partagé jamais servi au portail** (tables du plan en
  `portail_interdit`).
- **Migrations sans somme de contrôle** : l'immuabilité d'une migration
  commitée repose sur la relecture (`db/migrate.ts`).
- **Pas de mécanisme de traduction** (§6) : l'anglais prévu en V2 impose
  d'extraire les libellés.
- **Volume** : deux tests de performance sont sensibles à la charge de la
  machine (seuil de 3 s) : `plan-de-charge-perf.test.ts` et
  `finance-indicateurs-perf.test.ts`.
