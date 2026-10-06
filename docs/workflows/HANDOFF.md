# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## Branche `feat/socle-monorepo` — 2026-10-06

**État :** V1 et V2 livrées en code et poussées ; prêt à relire ; **aucune
recette dans un navigateur**.
**Dernier commit :** `40144b5` feat(web): V2 portail client, IA,
questionnaires, notation, KPI, plan, rapports, hors ligne (le distant est au
même commit).
**PR :** [#4](https://github.com/bkourouma/MissionPilot/pull/4) (vers
`feat/decisions-et-socle`) et [#3](https://github.com/bkourouma/MissionPilot/pull/3)
(vers `main`) ouvertes, non fusionnées ; le titre de #4 ne cite encore que la V1.

Livré :

- **V1** : référentiels, pipeline, propositions, missions, budget figé,
  planification, temps, facturation, encaissements, finance, indicateurs,
  export SYSCOHADA, 2FA + SMTP, fichiers, documents, commentaires, tâches.
- **V2** (`7578543` shared, `a8a6fca` engines, `6d62428` API, `40144b5` web) :
  IA OpenRouter (désactivée par défaut, gabarits sans clé), portail client,
  questionnaires (relances J+3/J+7), notation, KPI, plans stratégiques et
  modèle financier, rapports d'état d'avancement (PDF, Word, PowerPoint),
  import Excel des temps, PWA hors ligne (file des saisies de temps).
- **Gouvernance réalignée au `40144b5`** : `SECURITY.md`,
  `CODING_STANDARDS.md`, `.claude/rules/review-checklist.md` (recherches
  mécaniques recalculées), `RUNBOOK.md`.

Vérifications du 2026-10-06 :

- Tests : API 86 fichiers / 891 tests (mesure du Pilote) ; web 71 / 1047,
  engines 50 / 649 (couverture 100 % lignes, 99,81 % branches), shared 14 / 89
  (relancés à la mise à jour des documents).
- Build Next, typecheck et lint verts (Pilote) ; `pnpm format` vert.
- `pnpm audit --prod` : aucune vulnérabilité. `pnpm audit` complet : 15
  constats, tous via `vitest` (développement).

Non vérifié : aucune recette navigateur ; aucun appel OpenRouter réel ; Chrome
(PDF) essayé seulement sous Windows ; aucun vrai classeur Excel ; pas d'essai de
bout en bout web + API.

Reste à faire et dettes (fichier de référence entre parenthèses) :

1. **Recette des écrans** (aucune faite) : portail (`/portail/*` : missions,
   factures, questionnaires, sécurité, invitation) ; missions → KPI,
   notation, plan et modèle, questionnaires, rapports, documents ; menus
   Questionnaires et Notation ; paramètres IA (et essai), portail, import des
   temps ; saisie des temps hors ligne ; puis les écrans V1.
2. **Saisie KPI depuis le portail** : routes `/api/portail/kpi*` présentes,
   aucun écran web ne les appelle.
3. **Conservation** : `ia_generations` garde le texte démasqué sans durée
   (`0102`) ; rapports jamais purgés (`0130`) ; durée et purge à décider.
4. **Série KPI du tableau de bord** chargée par l'export, qui écrit une entrée
   d'audit `kpi.exporter` à chaque affichage (`components/kpi/EvolutionKpi.tsx`) :
   route de série dédiée à prévoir.
5. **Hors ligne** : pas de clé d'idempotence côté API pour le rejeu des saisies
   (`lib/hors-ligne/envoi.ts`, PUT complet).
6. **Questionnaires** : date limite stockée et affichée mais non appliquée à la
   soumission (`questionnaires/portail.ts`).
7. **Fichiers** : donner à `routes/fichiers.ts` la même garde que l'import
   Excel (sémaphore d'analyse simultanée ; la garde de taille 413 existe déjà).
8. **Limiteur** : test qui prouve que `app.horloge_test` est ignoré hors d'une
   base `_test` (`0120`).
9. **Dépendances de développement** : monter Vitest (vitest, vite, tinypool,
   esbuild).
10. **Droits** : `notation.publier` est dans l'ensemble « tout » de l'associé
    alors que la publication exige `expert_metier` (`roles.ts`, `MPN04`).
11. **Plans** : comparaison de versions sans écarts calculés (moteur à
    compléter, `plans/modele.ts`) ; lien du diagnostic vers une notation publiée
    (migration `0182` prévue, rien dans le dépôt) ; PLA-05 (dépendances et
    recalage de la feuille de route) et PLA-10 (KPI créés depuis les objectifs)
    non faits ; plan partagé jamais servi au portail (tables `portail_interdit`).
12. **IA métier** : SOC-11 (génération de questionnaires) et rédaction assistée
    (plan, rapports de notation) non faites ; seules les routes `/api/ia/*`
    appellent l'orchestrateur.
13. **Rapports** : notation et plan en PDF/Word à faire (seul modèle :
    `etat_avancement`) ; PDF de la facture (document HTML seulement).
14. Petites dettes listées dans `CODING_STANDARDS.md` §10 (`MAX_LISTE` 500 du
    portail, collision `MPT01`, commentaire de `portail/contexte.ts`) et risques
    de `SECURITY.md` §15 (Chrome sous Linux, masquage, garde-chiffres).

Valeurs métier à faire valider (posées par défaut) : TVA 18 %, retenue à la
source désactivée, seuils d'approbation 5 M / 25 M / 10 M XOF (validés par
l'utilisateur le 2026-10-06), IS 25 %, actualisation 12 %, codes SYSCOHADA
indicatifs, libellés des classes A à E proposés (« Très avancé », « Avancé »,
« Intermédiaire », « Fragile », « Critique », `apps/web/src/lib/notation.ts`),
modèles IA recommandés et tarifs (`ia/modeles.ts`), taux USD de départ
(`ia/couts.ts`), plafond IA 50 USD, suivi KPI quotidien à 7 h UTC.

Pièges et conventions :

- **Tests API** : une base par agent (`DATABASE_URL` / `DATABASE_OWNER_URL`
  vers `missionpilot_<id>`, suffixe `_test` ajouté) ; le global-setup supprime
  et recrée le schéma de la base de test à chaque exécution ; jamais deux suites
  API en parallèle sur la même base ; lancer les suites l'une après l'autre. PostgreSQL du projet :
  conteneur `missionpilot-postgres` (port 55440), les autres conteneurs sont à
  d'autres projets.
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 ; les migrations V2
  sont commitées (`6d62428`) donc immuables ; corriger par un nouveau fichier.
- **Agents** : `dev-extra` et `review-extra` (Opus, effort extra,
  `.claude/agents/`, non encore commités) appliquent la consigne permanente de
  l'utilisateur du 2026-10-06 : effort maximal pour tous les agents du Pilote.
- Base de développement `missionpilot` : contient des données de recette ; le
  cabinet de démonstration Abidjan se crée par `db:seed-demo` (RUNBOOK).
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR`
  obligatoires ; `WEB_ORIGIN` = adresse exacte du web (sinon 403
  `ORIGINE_REFUSEE`) ; `CHROMIUM_PATH` pour les PDF.
