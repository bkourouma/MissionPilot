# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## Branche `feat/vague-1-fondations` — 2026-10-08 (Vague 1, fondations V3)

**État :** fondations (`8a09a4f`) et cinq lots commités : STD `8705479`, DOS
`93ebf47`, PRV `e10532a`, AGT `e55bd8e`, QUA `ca7f9d7`, puis `798df06`
(tests de navigation, verrous PostgreSQL) et `72ae0d2` (intégration transversale,
commitée). **Corrections d'audit de sécurité des cinq lots faites dans l'arbre de
travail, non commitées** (section suivante). Aucune recette navigateur.
**Dernier commit :** `72ae0d2`.

**Vague 1 — corrections d'audit (2026-10-08, non commitées) :** dix migrations
nouvelles, toutes à AJOUTER dans une base existante (`pnpm db:migrate` ; les bases de
test se recréent seules) : `0207`–`0209` (STD), `0224` (DOS), `0243` (PRV),
`0265`–`0267` (AGT), `0268` (purge des fichiers), `0286` (QUA). Détail des règles :
`SECURITY.md` §5 ter, §6, §7 bis, §8 ter à §8 quinquies ; décisions laissées :
`DECISIONS.md`.

- **Perte de données corrigée** : `fichier_orphelin` (`0130`) ignorait
  `preuve_versions.fichier_id`, `dossier_faits.source_document_id` et
  `dossier_facteurs.source_document_id` ; un fichier cité seulement par l'une d'elles
  était purgé à 24 h. `0268` les ajoute (numérotée après `0267` parce qu'elle cite des
  tables créées par `0220`–`0221` et `0240`) ; test `fichiers-orphelins-references.test.ts`
  (base `missionpilot_orph`).
- **STD/DOS** : variante du cabinet sans classe abaissée ni autonomie relevée (`MPM07`,
  `CLASSE_ABAISSEE`, `AUTONOMIE_RELEVEE`) et jamais publiée par son créateur sauf associé
  (`MPM08`) ; `SEPARATION_DES_TACHES` étendu à la publication d'une variante et d'une
  proposition ; `MPM04` couvre l'approbation d'une dérogation sans les validations de sa
  classe ; `standard_lecture` ne montre que les versions publiées du standard ;
  `MOTIF_REQUIS` quand le contexte active ou retire une brique R2 ou R3 ; fait créé
  directement « confirmé » réservé à l'associé (`VALIDATION_REQUISE`) ; acceptation
  automatique d'un état seulement à tolérance nulle et sans remplacer un état accepté par un
  humain (`MPO04`) ; export remis au client sans les motifs de décision ; facteurs du dossier
  validés contre le dictionnaire.
- **PRV/QUA** : signature d'avis réservée à `expert_metier`/associé (`MPV04`),
  `CLASSE_RISQUE_ABAISSEE` (`MPV06`), `ARBITRAGE_PAR_AUTEUR` (`MPV07`), `MPV02` étendu
  (fichier rattaché, auteur membre actif), nominatif par défaut pour entretien et
  questionnaire ; qualité : auteur imposé du suivi (`AUTEUR_IMPOSE`, `MPY11`), `PARCOURS_VIDE`
  (`MPY08`), éléments de revue tracés par `source_type`, `ETAPE_A_RECONFIRMER`,
  `empreinte_revue` et `LIVRABLE_MODIFIE_APRES_REVUE`, `NIVEAU_RISQUE_ABAISSE` (`MPY09`),
  retrait d'une relation entre clients en événement d'ajout seul, `ATTESTATION_PAR_AUTEUR`
  (`MPY10`), `clients.lire` pour les relations, origine de la note de satisfaction.
- **AGT** : évaluation locale admise seulement hors production (`app.evaluation_locale_admise`,
  `0265`) ; un agent n'exécute qu'un prompt à jeu d'essai et évaluation réussie
  (`JEU_ESSAI_REQUIS`, `NON_REGRESSION_REQUISE`, `MPG04`) ; `JEU_ESSAI_AFFAIBLI` ; `MPG06`
  doublant `SORTIE_AGENT_NON_CONFORME` ; variables non fiables par défaut pour les agents qui
  lisent du contenu client ; rôles doublés en base (`MPG07`, `MPG08`, `ACTION_RESERVEE`,
  `CLASSE_RISQUE_SOUS_PLANCHER`) ; verrou consultatif du plafond par mission ; promotion
  d'autonomie sans le mode dégradé.
- **Conséquence à ne pas oublier** : en production, aucune exécution d'agent n'est possible
  tant que le rejeu réel sur OpenRouter par la file `jobs` n'est pas construit (aucune
  évaluation `openrouter` n'existe). Dette notée (`SECURITY.md` §15, ADR-005).

**Vague 1 — fait (lots commités) :** référentiel de méthodes versionné, héritage
standard → cabinet → contexte → mission, modulation, dérogations, comité méthode
(STD, `0200`–`0205`) ; dossier client vivant, états financiers contrôlés par
moteur, fiabilité, frise, export (DOS, `0220`–`0223`) ; registre des preuves,
assertions, solidité, triangulation, contradictions (PRV, `0240`–`0242`) ;
registre des agents, autonomie N0–N4, non-régression, contenus clients non fiables
(AGT, `0260`–`0264`) ; classes R0–R3, revue guidée, quatre yeux, signature,
acceptation, satisfaction (QUA, `0280`–`0285`).

**Vague 1 — intégration transversale (commitée en `72ae0d2`, 2026-10-08) :**

- **Condition de passage** (« la notation tourne sur le référentiel avec des
  résultats identiques à la V2 ») : une mission liée à une méthode calcule sa
  notation DEPUIS la méthode effective (`notation/via-methode.ts` : briques
  `notation_repondants`, `ecarts_perception`, `calcul_note` de `0205`, désignées
  par leur code moteur, exécutées par les MÊMES moteurs que la V2) ; chemin V2
  extrait tel quel dans `notation/calcul.ts`. Chaque version enregistre la version
  de méthode, la liaison courante, le journal de modulation et le journal
  d'exécution (`notation_versions_methode`, migration **`0206`**, `MPN06` ajout
  seul, `MPN07` liaison non courante). Test `notation-methode.test.ts` : 7
  combinaisons (grilles générique et cabinet, secteurs, stratégies, individuel et
  collectif) STRICTEMENT identiques avec quatre règles actives sans effet sur le
  calcul. Ce qui change quand une règle ajuste le calcul : pondération d'une
  rubrique rattachée à une dimension de la grille (moteur pur
  `appliquerPonderationsContexte`, poids remplacé aussi dans les surcharges
  sectorielles, normalisation à 100) ; seuil de la brique des écarts ; brique de
  calcul retirée (409 `METHODE_NOTATION_INCOMPLETE`) ; tout autre ajustement est
  tracé dans `execution.non_appliques`.
- **Qualité branchée** (`qualite/branchements.ts`) : génération d'un rapport
  (état d'avancement, notation, plan) → suivi `rapport` R2 ; soumission et
  publication d'une notation → suivi `notation` R3 ; éléments de revue guidée :
  assertions fragiles, chiffres avec leur source, recommandations (initiatives du
  plan, recommandations candidates de la méthode). Mission liée à une méthode :
  publication = circuit `MPN04` ET suivi de la version **signé** (409
  `SUIVI_QUALITE_NON_SIGNE`) ; sans méthode, comportement V2 inchangé. Définition de
  terminé « notation » : item `notation_soumise` (en revue ou publiée) au lieu de
  `notation_publiee` (sinon la signature avant publication était impossible).
- **Dossier → méthode** : `GET /api/missions/:id/methode/contexte-propose`
  (`standard.lire` ET `dossier.lire`) propose le contexte depuis le dossier
  (`lireContexteClient`), sourcé, valeurs refusées écartées avec la raison ; l'écran
  de liaison le pré-remplit, l'utilisateur confirme en liant.
- **PRV-06** : annexe « Annexe — Sources » des rapports de notation et de plan (PDF
  et Word, `rapports/sources.ts`) : assertions RETENUES dont le livrable désigne le
  rapport, preuves numérotées avec fiabilité, verbatim nominatif sans accord masqué
  pour tous ; seulement si le générateur a `preuve.lire`.
- **Corrections** : `MPG04` traduit en 409 `NON_REGRESSION_REQUISE` par
  `routes/ia-prompts.ts` et `routes/ia-parametres.ts` ; une nouvelle version d'un
  prompt doté d'un jeu d'essai est créée INACTIVE si `activer` est omis, 409 si
  `activer: true` explicite ; NPS déplacé dans `packages/engines/src/nps`
  (`syntheseNps`, `ErreurNps`) ; `AppError.details` transmis par le gestionnaire
  unique d'`app.ts` en liste blanche (`violations`, `erreurs`, `manquants`,
  tableaux tronqués à 200) et gestionnaire de réponse propre au plugin qualité
  retiré ; web : onglets « Méthode » (`standard.lire`) et « Qualité » (suivi
  filtré sur la mission, `/qualite?mission=`) dans la rubrique mission.

**Reste à faire (vague 1) :** commit des corrections d'audit ci-dessus (migrations
comprises) ; recette navigateur de tous les écrans V3 ; **rejeu réel OpenRouter pour les
évaluations de non-régression** (file `jobs`, plafonné ; sans lui, aucun agent en
production) ; STD-11 complet ; STD-13 et STD-14 ; QUA-05 (revue à froid) ; DOS-05 (groupes
et filiales) ; extraction IA depuis un PDF (DOS-03) ; PRV-06 web (citations cliquables) ;
AGT-06 cache ; AGT-08 copilote ; agent contradicteur ; `IMPORT_INVALIDE` du dossier encore
envoyé à la main (`routes/dossier-client.ts`, à convertir en `AppError` avec
`details.erreurs`) ; génération d'un rapport d'état financier (type `etat`) inexistante,
donc non branchée ; calibrations listées ci-dessous ; **vagues 2 et 3** du PRD
complémentaire.

**Pièges :**

- **Ordre des migrations** : un fichier qui référence une table d'un lot doit
  avoir un numéro PLUS GRAND que la migration qui la crée (`0206` et non `0151`
  pour `notation_versions_methode`, qui référence `mission_methodes` de `0202`).
- **Suivi qualité des notations** : ouvert dès la SOUMISSION en revue ; une
  définition « notation » déjà copiée dans un cabinet (`qualite_definitions`)
  garde l'ancien item `notation_publiee` : pour ce cabinet, une notation liée à
  une méthode ne peut pas être signée avant publication (nouvelle version de
  définition à créer). Les bases neuves prennent la nouvelle définition.
- **Annexe des sources** : la citation repose sur le texte libre `livrable` de
  l'assertion (contient « notation » ou « plan », sans casse ni accents).
- Recherche n° 12 : 373 `z.object`, tous stricts ; recherche n° 10 : 477 routes
  dont 8 sans `exiger` ; 105 fichiers de migration, dont 10 non commités
  (`.claude/rules/review-checklist.md`).
- Seuils posés par défaut, **à calibrer au pilote** : poids de fiabilité A–D,
  plafond 2 et seuils 0,75 / 0,5 de solidité ; promotion 50 exécutions / 95 % /
  90 jours ; modification majeure au-delà de 25 % ; incident majeur → N2.
- Tests API d'intégration sur la base `missionpilot_int` ; test des références de
  fichiers sur `missionpilot_orph`.
- **Purge des fichiers** : toute nouvelle colonne qui référence `fichiers` s'ajoute à
  `fichier_orphelin` (nouvelle migration `CREATE OR REPLACE`), sinon le fichier est effacé
  à 24 h.
- **Évaluations locales** : elles prouvent le câblage d'un prompt, pas la qualité d'un
  modèle (ADR-005) ; hors développement et test, elles n'activent rien.

---

## Branche `feat/vague-0-reliquats` — 2026-10-08

**État :** V1 et V2 sur `main` (PR [#3](https://github.com/bkourouma/MissionPilot/pull/3)
et [#4](https://github.com/bkourouma/MissionPilot/pull/4) fusionnées le
2026-10-08). La vague 0 (reliquats de la V2) est faite dans l'arbre de travail,
**non commitée** ; **aucune recette dans un navigateur**.
**Dernier commit :** `4002d71` (fusion de #3 dans `main`) ; la branche n'a pas
encore de commit propre.

**Recette E2E (2026-10-07, non commité) :** scénario `docs/recette/SCENARIO-E2E-MISSION-ORGANISATION.md` joué jusqu'à E25 ; E26 bloquait à cause du seed `seed-demo.ts`, corrigé (mission Kora à L0−10 semaines). Anomalie A03 (bandeau « service momentanément indisponible », `_rsc` en 503) **non reproduite** ; seule trace : un `Failed to proxy … ECONNREFUSED` du relais Next vers l'API, qui produit exactement ce bandeau. À rejouer avec le serveur API surveillé. A01 (contact principal) et A02 (badge « Brouillon » non rafraîchi) à confirmer à la main. La date limite du questionnaire collectif de démonstration est dépassée à dessein : la soumission y est désormais refusée (409), à prolonger pour la recette (RUNBOOK) ; le commentaire du seed (`db/seed-demo-portail.ts`) dit encore « indication ».

**PRD complémentaire (2026-10-08, à valider) :** `docs/PRD complémentaire — MissionPilot, le cabinet d'expertise augmenté.md` : référentiel de méthodes (STD), dossier client vivant (DOS), preuves (PRV), agents IA (AGT), automatisation (AUT), appels d'offres (AO), qualité (QUA), capitalisation (CAP), expérience client (CLI), services augmentés. Les décisions 1 à 8 de sa section 21 sont tranchées (`docs/DECISIONS.md`). **Vagues 1 à 3 à venir** ; plages de migrations réservées dans `CODING_STANDARDS.md` §1 (STD 0200, DOS 0220, PRV 0240, AGT 0260, QUA 0280).

**Vague 0 livrée** (migrations `0076`, `0104`, `0122`, `0131`, `0132`, `0149`, `0150`, `0182`–`0184`) :

- **Plans** : PLA-05 dépendances et recalage de la feuille de route (moteur `packages/engines/src/plan-strategique/feuille-de-route.ts`, `MPS02`, routes `/plans/:id/feuille-de-route` et `/recalage`) ; PLA-10 KPI créés depuis un objectif (`plan_objectif_kpis`, `0183`) ; comparaison de versions avec écarts calculés (`engines/.../comparaison.ts`) ; lien du diagnostic vers une notation publiée (`0182`, `MPS06`, 409 `NOTATION_NON_PUBLIEE`).
- **Questionnaires** : SOC-11 génération par l'IA (`0149`, `questionnaire_ia_historique`, `MPQ06`, `MPQ08`) ; date limite appliquée (`0150`, `MPQ07`, 409 `DATE_LIMITE_DEPASSEE`).
- **Rapports** : notation et plan en PDF et Word (`0131`, `MPR01-02`, lettre `R`) ; PDF de la facture (`GET /api/factures/:id/pdf`) ; conservation des rapports (`0132`, 3 ans, job `purge_rapports`) et mention de la contribution IA en pied de page (réglage par cabinet, `GET`/`PUT /api/rapports/parametres`).
- **IA** : conservation du texte démasqué (`0104`, 365 jours, job `ia_conservation`).
- **Temps** : idempotence des saisies (`0122`, en-tête `Idempotency-Key`) ; `MPC02` remplace `MPT01` pour les tâches (`0076`).
- **Divers** : sémaphore de réception des fichiers (4 par instance, 2 par cabinet, 503 `FICHIERS_OCCUPE`, constante `FICHIERS_ANALYSES_SIMULTANEES_MAX`, pas une variable d'environnement) ; test de l'horloge du limiteur (`auth-limiteur-horloge.test.ts`) ; `notation.publier` retiré de l'ensemble de l'associé ; `MAX_LISTE` du portail : troncature signalée par `tronque` ; écrans `/portail/kpi` (saisie KPI du client) ; route de série `GET /api/missions/:id/kpi/series` sans entrée d'audit d'export.

**Corrections d'audit en cours d'intégration (non vérifiées dans le code au 2026-10-08, un agent les applique en parallèle) :** copie d'un brouillon IA bloquée ; sémaphore des fichiers pris après la lecture du corps, plafond par cabinet ; garde de date de `purger_textes_ia` ; reconfirmation d'identité pour réduire la conservation des rapports ; section financière du plan reproduite seulement si validée ; débit de la facture PDF ; factorisation de la création de KPI. Relire `SECURITY.md` §8 et §15 (décrits tels que le code est aujourd'hui) une fois ces corrections intégrées.

Vérifications du 2026-10-08 (mesure du Pilote, avant les corrections d'audit) :

- Tests : API 101 fichiers / 1008 tests ; web 80 / 1112 ; engines 52 / 678 ; shared 15 / 93.
- Typecheck, lint et `pnpm format` verts.
- Recherches mécaniques de `.claude/rules/review-checklist.md` recalculées le 2026-10-08 (351 routes dont 8 sans `exiger`, 256 `z.object`, 70 migrations).
- `pnpm audit --prod` : aucune vulnérabilité au 2026-10-06 (non relancé). `pnpm audit` complet : 15 constats, tous via `vitest` (développement).

Non vérifié : aucune recette navigateur ; aucun appel OpenRouter réel ; Chrome (PDF) essayé seulement sous Windows ; aucun vrai classeur Excel ; pas d'essai de bout en bout web + API.

Reste à faire et dettes (fichier de référence entre parenthèses) :

1. **Recette des écrans** (aucune faite) : portail (`/portail/*` : missions, factures, questionnaires, KPI, sécurité, invitation) ; missions → KPI, notation, plan (feuille de route, KPI, diagnostic) et modèle, questionnaires (génération IA), rapports, documents ; menus Questionnaires et Notation ; paramètres IA (et essai), portail, import des temps ; saisie des temps hors ligne ; puis les écrans V1.
2. **Conservation IA non exposée** : `conservation_jours` (`ia_parametres_cabinet`, `0104`) n'est ni lisible ni modifiable par l'API IA (`routes/ia-parametres.ts`).
3. **Plan partagé jamais servi au portail** (tables du plan en `portail_interdit`, `plans/partage.ts`).
4. **Rédaction assistée par l'IA** du plan et des rapports de notation non faite ; seules les routes `/api/ia/*` et la génération de questionnaires appellent l'orchestrateur.
5. **Dépendances de développement** : monter Vitest (vitest, vite, tinypool, esbuild).
6. **Petites dettes** de `CODING_STANDARDS.md` §10 (`MAX_LISTE` 500 du portail sans curseur, parité EUR/FCFA hors moteur…) et risques de `SECURITY.md` §15 (Chrome sous Linux, masquage, garde-chiffres, sémaphore de fichiers global, durées de conservation).
7. **Vagues 1 à 3** du PRD complémentaire (référentiel de méthodes, dossier client, preuves, agents, qualité), à planifier après validation du PRD.

Valeurs métier à faire valider (posées par défaut) : TVA 18 %, retenue à la
source désactivée, seuils d'approbation 5 M / 25 M / 10 M XOF (validés par
l'utilisateur le 2026-10-06), IS 25 %, actualisation 12 %, codes SYSCOHADA
indicatifs, libellés des classes A à E proposés (« Très avancé », « Avancé »,
« Intermédiaire », « Fragile », « Critique », `apps/web/src/lib/notation.ts`),
modèles IA recommandés et tarifs (`ia/modeles.ts`), taux USD de départ
(`ia/couts.ts`), plafond IA 50 USD, suivi KPI quotidien à 7 h UTC, conservation du texte IA 365 jours et des rapports 3 ans (**avis du conseil juridique requis**), mention de la contribution IA activée par défaut en pied de page des rapports.

Pièges et conventions :

- **Tests API** : une base par agent (`DATABASE_URL` / `DATABASE_OWNER_URL`
  vers `missionpilot_<id>`, suffixe `_test` ajouté) ; le global-setup supprime
  et recrée le schéma de la base de test à chaque exécution ; jamais deux suites
  API en parallèle sur la même base ; lancer les suites l'une après l'autre. PostgreSQL du projet :
  conteneur `missionpilot-postgres` (port 55440), les autres conteneurs sont à
  d'autres projets.
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 ; les migrations V2
  sont commitées (`6d62428`) donc immuables ; corriger par un nouveau fichier.
  Celles de la vague 0 (`0076`, `0104`, `0122`, `0131`, `0132`, `0149`, `0150`,
  `0182`–`0184`) sont non commitées : encore corrigeables sur place (recréer les
  bases qui les ont appliquées), immuables dès le commit.
- **Agents** : `dev-extra` et `review-extra` (Opus, effort extra,
  `.claude/agents/`, non encore commités) appliquent la consigne permanente de
  l'utilisateur du 2026-10-06 : effort maximal pour tous les agents du Pilote.
- Base de développement `missionpilot` : contient des données de recette ; le
  cabinet de démonstration Abidjan se crée par `db:seed-demo` (RUNBOOK).
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR`
  obligatoires ; `WEB_ORIGIN` = adresse exacte du web (sinon 403
  `ORIGINE_REFUSEE`) ; `CHROMIUM_PATH` pour les PDF.
