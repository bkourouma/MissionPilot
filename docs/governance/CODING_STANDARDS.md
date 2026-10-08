# Conventions de code — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les conventions **observées dans le code** (état de la
branche `feat/vague-2-automatisation`, 2026-10-08 ; vague 1 commitée, vagues 2 et 3 dans
l'arbre de travail, non commitées), avec un fichier de référence pour chacune, pas un idéal. Les
contrôles mécaniques sont dans `.claude/rules/review-checklist.md`.

## 1. Organisation du dépôt

Monorepo pnpm (ADR-001), TypeScript strict (`tsconfig.base.json`), modules ESM.

| Dossier             | Rôle                                                                 | Peut importer                         |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `packages/engines`  | moteurs de calcul purs, sans E/S : planning, finance, questionnaires, notation, KPI, plan stratégique et modèle financier, et pour les vagues 2 et 3 automatisation, clôture, prévisions, appels d'offres, banque de CV, offre financière, capitalisation | rien d'applicatif |
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
  | `0200–0206`   | référentiel de méthodes (lot STD) : dictionnaire, facteurs, services et notes de contexte (`0200`), méthodes, versions et contenu (`0201`), mission figée, dérogations (`0202`), comité méthode (`0203`), amorçage du standard : dictionnaire (`0204`) et méthodes Notation et Plan stratégique (`0205`) ; notation calculée depuis la méthode de la mission (`0206`, intégration de la vague 1 : `notation_versions_methode`) ; durcissements d'audit : garde de publication d'une variante (`0207`, `MPM07-08`), standard visible seulement publié (`0208`), validations exigées pour approuver une dérogation (`0209`) |
  | `0220–0224`   | dossier client (lot DOS) : faits et décisions (`0220`), facteurs de contexte (`0221`), états financiers, lignes et décisions (`0222`), instantanés de fiabilité et exports (`0223`), acceptation automatique à tolérance nulle seulement (`0224`) |
  | `0240–0243`   | registre des preuves (lot PRV) : preuves, versions et dimensions (`0240`), assertions et versions (`0241`), liens et arbitrages (`0242`), durcissement d'audit (`0243`, `MPV06-07`) |
  | `0260–0268`   | agents IA (lot AGT) : registre (`0260`), briques et exécutions (`0261`), autonomie (`0262`), contributions et plafonds (`0263`), jeux d'essai et évaluations de non-régression (`0264`), fournisseur d'évaluation et exécution sous non-régression (`0265`), validation d'une sortie conforme (`0266`), gardes de rôle (`0267`) ; `0268` : `fichier_orphelin` étendu aux références de fichiers des preuves et du dossier client (fonction transversale, numérotée après `0267` parce qu'elle cite des tables créées par `0220`–`0221` et `0240`) |
  | `0280–0286`   | qualité (lot QUA) : suivis et gardes (`0280`), définitions de terminé et vérifications (`0281`), revue guidée (`0282`), validations et signatures (`0283`), acceptation de mission (`0284`), satisfaction (`0285`), durcissement d'audit (`0286`, `MPY08-11`) |
  | `0300–0302`   | moteur d'automatisation (lot AUT-CORE, vague 2, ADR-006) : automatisations, versions immuables de leur définition et coupe-circuits (`0300`, AUT-02, AUT-06), événements publiés, exécutions, actions gardées, résultats, annulations et brouillons tracés (`0301`, AUT-01, AUT-05), événements publiés par la base et planification quotidienne de la détection (`0302`, `SECURITY DEFINER`) ; `MPU01-05` ; `0303` n'existe pas |
  | `0320–0323`   | check-list de clôture (AUT-08, vague 2) : modèle du cabinet (`0320`), vérifications en ajout seul (`0321`, `MPX01`), dérogations motivées (`0322`, `MPX02`), séparation des tâches entre dérogation et clôture (`0323`, `MPX03`) |
  | `0330–0332`   | salle de mission (CLI-01, vague 2) : demandes documentaires, pièces, dépôts et historique du statut (`0330`, `MPL01-05`), `fichier_orphelin` étendu à `salle_depots.fichier_id` et `octets_stockage_utilises` en `SECURITY DEFINER` (`0331`), durcissement d'audit : mission clôturée, plafonds et débit des dépôts, acceptation par le déposant (`0332`, `MPL06-09`) |
  | `0360–0363`   | appels d'offres (lot AO-A, vague 3, plage réservée `0360–0379`) : fiches, événements, évaluations et décisions go/no-go (`0360`, AO-01, AO-02), dossiers, extractions, matrice de conformité et son suivi (`0361`, AO-03), rétro-planning (`0362`, AO-08), acquittement des nombres non vérifiés d'une extraction (`0363`, `MPA07`) ; `MPA01-07` |
  | `0380–0386`   | banques et offres d'appels d'offres (lot AO-B, vague 3, plage réservée `0380–0399`) : banque de CV, versions datées et gabarits par bailleur (`0380`, AO-04), références, versions et pièces justificatives (`0381`, AO-05), offres techniques, versions et validations (`0382`, AO-06), offres financières et versions calculées (`0383`, AO-07), `fichier_orphelin` étendu aux pièces (`0384`, reprend aussi `salle_depots` de `0331`), séparation des tâches à la validation d'une offre technique (`0385`, `MPW05`), anonymisation d'un CV (`0386`, `anonymiser_cv_ao`, `MPW06`) ; `MPW01-06` |
  | `0400–0404`   | notation augmentée (lot NOT, vague 2, plage réservée `0400–0419`) : banque d'items versionnée et sélections du questionnaire adaptatif (`0400`, NOT-09, `MPN08-09`), paramètres et indices de confiance, garde de publication (`0401`, NOT-11, `MPN10`), calibration entre évaluateurs (`0402`, NOT-13, `MPN11`), initiatives types, impacts observés et plans d'action de notation (`0403`, NOT-17, `MPN12` ; bibliothèque `notation_initiatives_types` à rapprocher de celle du lot PLA, PLA-13), plancher du seuil (0,3) et de la cible de répondants (2) de confiance (`0404`, contraintes `CHECK`) |
  | `0420–0424`   | plans stratégiques augmentés (lot PLA, plage réservée `0420–0439`) : cascade en graphe (`0420`, PLA-12), bibliothèque d'initiatives types (`0421`, PLA-13, `MPS07`) et son amorçage standard (`0422`), priorisation du portefeuille et arbitrage tracé (`0423`, PLA-14, `MPS08`), modèle de rapport « dossier bancaire » (`0424`, PLA-17, `MPR03`) |
  | `0440–0445`   | pilotage augmenté des KPI (lot KPI, vague 2, plage réservée `0440–0459`) : arbres d'indicateurs et nœuds (`0440`, KPI-13), revues de performance et décisions (`0441`, KPI-17), actions correctives et leurs événements (`0442`, KPI-18), compte rendu figé à la tenue de la revue (`0443`, `MPK22`), action rattachée à une revue tenue seulement (`0444`, `MPK26-27`), plafonds d'un arbre appliqués à la réactivation et au total (`0445`, `MPK12-13`) ; `MPK10-16` et `MPK20-27` |
  | `0460–0465`   | capitalisation (lot CAP, vague 3, plage réservée `0460–0479`) : retours d'expérience versionnés et recherche plein texte (`0460`, CAP-01), base d'estimation par brique (`0461`, CAP-02), analyse des dérogations (`0462`, CAP-05), matrice de compétences (`0463`, CAP-06), index de la recherche unifiée (`0464`, CAP-07), durcissements d'audit : déclarations de niveau bornées, validation du retour réservée à un responsable (`0465`, `MPJ06-08`) ; `MPJ01-08` |

  Plages libres : `0151–0159`, `0161–0169`, `0170–0179`, `0185–0199`. Plages
  réservées par lot (PRD complémentaire) : `0200–0219` référentiel de méthodes
  (STD), `0220–0239` dossier client (DOS), `0240–0259` registre des preuves
  (PRV), `0260–0279` agents IA (AGT), `0280–0299` qualité (QUA), `0360–0379`
  appels d'offres (AO-A), `0380–0399` banques et offres d'appels d'offres
  (AO-B), `0400–0419` notation augmentée (NOT), `0420–0439` plans stratégiques
  augmentés (PLA), `0460–0479` capitalisation (CAP) ; déclarées dans l'en-tête
  des migrations de leur lot. Pour l'automatisation (`0300–0319`), la clôture
  (`0320–0329`), la salle de mission (`0330–0339`) et les KPI augmentés
  (`0440–0459`), aucune migration ne déclare de plage : ces bornes sont la
  convention de ce document (à confirmer ; `0340–0359` reste sans affectation).
  Un durcissement issu d'audit prend le numéro suivant de son domaine. Prochain
  numéro libre au 2026-10-08 : plans (V1) `0185`, automatisation `0303`,
  clôture `0324`, salle de mission `0333`, AO-A `0364`, AO-B `0387`, notation
  augmentée `0405`, plans augmentés `0425`, KPI augmentés `0446`,
  capitalisation `0466` (STD `0210`, DOS `0225`, PRV `0244`, AGT `0269`, QUA
  `0287`). Une migration **commitée** n'est jamais modifiée : on ajoute un
  fichier (voir §10 : l'outil ne le vérifie pas). Une migration encore **non
  commitée** peut être corrigée sur place, à condition de recréer les bases qui
  l'ont appliquée (les bases de test le sont à chaque exécution). Au 2026-10-08,
  les 43 migrations des vagues 2 et 3 (`0300`–`0465`) ne sont pas commitées ;
  `origin/main` en compte 105.
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
  `I` IA, `P` portail, `Q` questionnaires, `N` notation (`MPN01-07`, dont
  `MPN06-07` du calcul par la méthode, `0206`, puis `MPN08-12` de la notation
  augmentée, `0400`–`0403`), `K` KPI (`MPK01-07`, puis `MPK10-16` et
  `MPK20-27` du pilotage augmenté, `0440`–`0445`), `S` plans stratégiques
  (`MPS01-06`, puis `MPS07-08` de la bibliothèque et du portefeuille, `0421` et
  `0423`), `R` rapports (`MPR01-02`, `0131`, puis `MPR03` du dossier bancaire,
  `0424`), `Y` qualité (`MPY01-11`, `0280`–`0286`), `V` preuves
  (`MPV01-07`, `0240`–`0243`), `O` dossier client (`MPO01-04`,
  `0220`–`0224`), `G` agents IA (`MPG01-08`, `0260`–`0267`), `M`
  référentiel de méthodes (`MPM01-08`, `0201`–`0209`), `U` automatisation
  (`MPU01-05`, `0300`–`0301`), `X` check-list de clôture (`MPX01-03`,
  `0321`–`0323`), `L` salle de mission (`MPL01-09`, `0330` et `0332`), `A`
  appels d'offres (`MPA01-07`, `0360`–`0363`), `W` banques et offres d'appels
  d'offres (`MPW01-06`, `0380`–`0386`), `J` capitalisation (`MPJ01-08`,
  `0460`–`0465`). `MPT01` ne désigne plus que les feuilles de temps :
  l'identité figée des tâches assignées est `MPC02` (`0076`). Un nouveau code
  prend un numéro libre de sa lettre (liste : `SECURITY.md` §6).
  **Codes à plusieurs sens** (relevé du 2026-10-08, à ne pas aggraver) : un code
  désigne une FAMILLE de refus, et c'est l'API qui choisit le message ; un
  nouveau cas prend un NUMÉRO NEUF plutôt que de rejoindre une famille.
  `MPW01` : ajout seul d'une banque ou d'une offre (`0380`, `0386`) mais aussi
  pièce de référence qui ne se modifie que par son retrait motivé (`0381`) ;
  `MPW03` : rattachement incohérent d'une référence (mission et client, `0381`)
  mais aussi validation d'une autre version que la dernière (`0382`, `0385`) ;
  `MPL05` : modèle, demande ou pièce figés (identité, demande envoyée, close,
  `0330`, `0332`) ; `MPS02` : incohérence de plan, de version ou d'initiative
  (`0180`–`0184`, `0420`, `0423`) ; `MPK24` : décision hors d'une revue tenue ou
  dans une revue clôturée (`0441`) ; `MPN04` : publication ou validation par un
  expert métier, étendue de la notation (`0146`) aux grilles (`0145`) et aux
  items de la banque (`0400`). `MPK10`, `MPK11` et `MPK16` couvrent plusieurs
  tables de `0440`–`0445`.
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
  `questionnaires/`, `notation/`, `kpi/`, `plans/`, `rapports/`, puis, vagues 1 à 3,
  `agents/`, `dossier/`, `preuves/`, `qualite/`, `standard/`, `automatisation/`,
  `cloture/`, `salle-mission/`, `previsions/`, `appels-offres/`, `banque-ao/`,
  `capitalisation/`) : accès aux données et règles, dans la transaction reçue (`Db`). Une fonction ne
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
  une erreur Zod, 400, ou pour une `AppError` qui en porte : champs en LISTE
  BLANCHE `CHAMPS_DETAILS_PUBLICS` d'`errors.ts` — `violations`, `erreurs`,
  `manquants` —, tableaux tronqués à 200) produite par `setErrorHandler`
  d'`app.ts` ; un plugin ne rend pas sa propre réponse d'erreur, il traduit puis
  relance (modèle `routes/qualite.ts`) ; une erreur
  inattendue répond 500 `ERREUR_INTERNE` et ne journalise que message, code,
  contrainte et table.
- Les violations PostgreSQL attendues (unicité 23505, référence 23503, SQLSTATE
  `MP…`) se traduisent par `traduireErreursPg` (`db/outils.ts`) ou par la couche
  métier du domaine (`finance/erreurs.ts`, `kpi/erreurs.ts`, `plans/erreurs.ts`,
  `questionnaires/erreurs.ts`, `agents/erreurs.ts` (`traduireErreurAgents`,
  aussi pour `MPG04` des routes `ia-prompts.ts` et `ia-parametres.ts`), table
  `ERREURS_SQL` de `routes/portail.ts`).
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
(`dateFacturationSchema`, doublé par des contraintes en base, `0040`). Toute date
métier bornée par un `CHECK` SQL (échéances, observations, dates de plan ou de
salle de mission) utilise `dateIsoBorneeSchema` (`schemas/commun.ts` : date
valide comprise entre 2000 et 2100), sinon une date valide mais hors bornes
donne un 500 (SQLSTATE 23514) au lieu d'un 400 ; le 23514 qui échappe au schéma
se traduit en 400 par la couche d'erreurs du domaine. Modèles :
`schemas/salle-mission.ts`, `schemas/plans-augmentes.ts`.
Mise en page de droite à gauche : sans objet.

## 7. Tests

- **Vitest partout** (`pnpm test` = `pnpm -r test`). API : tests sur **vrai
  PostgreSQL** dans `apps/api/test/*.test.ts` (143 fichiers), base dédiée
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
  `packages/shared/src/schemas`, objets `.strict()` (547 `z.object` vérifiés
  le 2026-10-08 sur `feat/vague-2-automatisation`, tous stricts dans leur chaîne
  d'appels ; `rg` sans `-U` n'en voit que 109, ceux écrits sur une seule ligne) ;
  le même schéma sert l'API et le web.
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
- **Dossier client (lot DOS)** : extraction des états financiers par l'IA depuis
  un PDF non branchée (DOS-03 : saisie, CSV et Excel seulement) ; groupes et
  filiales (DOS-05) non faits ; le lecteur Excel partagé (`lireClasseurTemps`,
  `temps/import-excel.ts`) ne rend pas le nom de la feuille lue ni des messages
  propres aux états financiers (« lignes de temps ») ; listes du dossier bornées
  par plafond (5 000 faits, 2 000 valeurs de facteurs, 60 états) plutôt que
  paginées (`dossier/faits.ts`, `facteurs.ts`, `etats.ts`).
- **Vague 1, intégration** (relevé du 2026-10-08) : l'import refusé du dossier
  (`IMPORT_INVALIDE`, `routes/dossier-client.ts`) rend encore sa réponse d'erreur
  à la main au lieu d'une `AppError` avec `details.erreurs` ; la citation d'une
  assertion dans l'annexe des sources (PRV-06, `rapports/sources.ts`) repose sur
  le texte libre `livrable` ; une définition de terminé « notation » copiée avant
  le 2026-10-08 garde l'item `notation_publiee` (`qualite/definitions.ts`).
- **Listes bornées sans curseur (vagues 2 et 3)** (relevé du 2026-10-08) : lectures
  plafonnées au lieu d'être paginées. Lot KPI : `MAX_LIGNES_PILOTAGE` (500, lecture
  `LIMIT 501` par `limiteLecturePilotage()`, `kpi/pilotage-donnees.ts`) pour les
  décisions, actions et événements d'une revue ou d'une action, arbres d'une mission (`kpi/revues.ts`,
  `kpi/actions.ts`, `kpi/arbres.ts`), `MESURES_EXPORTEES_MAX` (2 000,
  `kpi/tableau.ts`) ; le drapeau `tronque` est rendu. Idem pour les alertes
  d'appels d'offres (`ALERTES_FICHES_MAX`, 500, `appels-offres/retroplanning.ts`)
  et les modèles de la salle de mission (`SALLE_MODELES_MAX`, 500,
  `salle-mission/modeles.ts`). **Sans signal de troncature** : `listerGabarits`
  (`banque-ao/cv.ts`, `GABARITS_LISTE_MAX` = 200, standard compris) et la matrice
  de compétences (`capitalisation/competences.ts`, `matrice` : tous les
  collaborateurs actifs par toutes les compétences actives, sans plafond ; seules
  les déclarations sont bornées, 50 par couple, `MPJ07`). `estimationParBrique`
  (`capitalisation/estimation.ts`, `OBSERVATIONS_MAX` 20 000, `BRIQUES_MAX` 1 000)
  et l'analyse des dérogations (`capitalisation/derogations.ts`,
  `DEROGATIONS_MAX` 20 000) chargent jusqu'à 20 000 lignes en mémoire (`tronque`
  rendu).
- **`semaineQuerySchema`** (`packages/shared/src/schemas/temps.ts`) n'est pas
  borné : `dateIsoSchema` et non `dateIsoBorneeSchema` ; il sert la lecture de la
  feuille de temps et le pré-remplissage (`routes/feuilles-temps.ts`,
  `routes/previsions.ts`). L'effet d'une date extrême n'a pas été testé. Les
  autres schémas de dates (`appels-offres`, `banque-ao`, `kpi`, `kpi-pilotage`)
  emploient `dateIsoSchema` : à vérifier au cas par cas s'ils visent une colonne à
  `CHECK` de bornes.
- **Fonctions de plus de 60 lignes** (§8 vise moins de 50 ; relevé du 2026-10-08
  par l'API du compilateur TypeScript, fonctions imbriquées et rappels compris,
  tests exclus) : 652 au total, dont 106 plugins ou rappels de `routes/`, 432 dans
  `apps/web` (composants et pages), 23 dans `packages/engines` et 81 dans la
  logique de l'API. Les plus longues de l'API hors routes : `ia/orchestrateur.ts`
  `executerDemande` (271) et `preparer` (142), `temps/import.ts`
  `importerTableau` (209), `temps/suivi.ts` `assembler` (179), `app.ts`
  `buildApp` (166), `finance/bilan.ts` `enregistrerBilanCloture` (132),
  `previsions/donnees.ts` `chargerDonneesPrevision` (132), `ia/fournisseur.ts`
  (129 et 113), `facturation/factures.ts` `creerBrouillon` (114). Vagues 2 et 3 :
  `automatisation/simulation.ts` `simulerSurLePasse` (110),
  `automatisation/execution.ts` `executerUneAction` (100),
  `kpi/dossier-revue.ts` `sectionsSituation` (95), `salle-mission/donnees.ts`
  `vueDemande` (90), `salle-mission/decisions.ts` `verserAuDossier` (88),
  `kpi/revues.ts` `genererOrdreDuJour` (84), `cloture/evaluation.ts`
  `evaluerCloture` (78). Moteurs : `plan-strategique/modele.ts`
  `calculerDepuisNormalisees` (236), `previsions/preremplissage.ts` (141),
  `kpi/qualite-donnees.ts` (128). Pas de réécriture rétroactive : à découper au
  prochain passage.
- **Fichiers de plus de 400 lignes** (hors tests, `wc -l`, 2026-10-08) : 122 au
  total (56 dans le web, 53 dans l'API, 13 dans les paquets). Web, vagues 2 et 3 :
  `lib/banque-ao.ts` (833), `lib/kpi-pilotage.ts` (771), `lib/appels-offres.ts`
  (759), `components/appels-offres/ActionsAo.tsx` (545), `lib/portail.ts` (521),
  `app/(app)/temps/GrilleTemps.tsx` (499), `components/connaissances/FormulairesConnaissances.tsx`
  (480), `lib/navigation.ts` (475), `lib/capitalisation.ts` (467),
  `components/banque-ao/FormulairesOffres.tsx` (451),
  `app/(app)/missions/[id]/kpi/page.tsx` (420). API : `notation/notations.ts`
  (685), `kpi/revues.ts` (588). Les plus longs, plus anciens : `lib/plan-modele.ts`
  (1 308), `lib/kpi.ts` (1 025), `lib/methodes.ts` (931).
- **Vagues 2 et 3, intégration** : `mission.cloture_demandee` figure au catalogue
  d'événements et dans la bibliothèque standard d'automatisations mais aucun
  module ne la publie (`automatisation/evenements.ts`, ADR-006) ; les automatisations
  qui l'écoutent ne se déclenchent donc pas.
