# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

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
