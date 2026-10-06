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

**État :** en cours (V1 complète côté API et écrans, reste lots transverses)
**PR :** [#4](https://github.com/bkourouma/MissionPilot/pull/4) (empilée sur #3), non fusionnées.

Fait (vérifié par le Pilote : typecheck, lint, prettier, tests, build web) :

- Cadrage validé (`docs/DECISIONS.md`), ADR-001 à 003 (PR #3).
- `packages/engines` : moteurs planning et finance purs, 228 tests, couverture
  100 % lignes.
- `apps/api` (~476 tests, migrations 0001–0075) : référentiels, pipeline,
  propositions, missions, découpage, budget figé, affectations, congés, plan
  de charge, temps, atterrissage, alertes, jobs, facturation (factures
  immuables, avoirs, débours, échéancier, taux négociés), encaissements,
  relances, balance âgée, encours, rentabilité, bilan de clôture, indicateurs
  du cabinet, export comptable SYSCOHADA, TOTP + SMTP, stockage de fichiers,
  versions de documents, commentaires, tâches assignées.
- `apps/web` (419 tests) : toutes les rubriques ci-dessus sauf fichiers,
  commentaires et tâches (voir « Reste à faire »).
- Six audits de sécurité/code relus ; tous les constats critiques, élevés et
  moyens corrigés avec un test de non-régression.
- Gouvernance : SECURITY.md, CODING_STANDARDS.md, review-checklist.md et
  RUNBOOK.md complétés à partir du code réel.
- `pnpm audit --prod` : aucune vulnérabilité (surcharge `postcss` ≥ 8.5.23).

Reste à faire (ordre) :

1. **Performance des indicateurs** : `finance/indicateurs.ts` et
   `temps/suivi.ts` font ~11 requêtes par mission (3 111 requêtes pour 280
   missions) ; `test/finance-indicateurs-perf.test.ts` échoue dans la suite
   complète sous charge (passe seul). Il faut une version en lot.
2. **Web** : téléversement des justificatifs de débours (le champ libre
   `justificatif` est refusé par l'API : 400 `JUSTIFICATIF_PAR_TELEVERSEMENT`),
   gestion des fichiers et versions de documents, commentaires, page
   « Mes tâches » (`/mes-taches`, lien déjà émis par l'API).
3. PDF des factures et documents (Chromium), DOCX/PPTX (SOC-07), import
   Excel, PWA hors ligne (service worker), liste des collaborateurs rattachés.
4. V2 : questionnaires, notation, planification stratégique + modèle
   financier, KPI, portail client ; l'IA (OpenRouter) attend le jalon
   SANKORIA (droits) : ne lancer que les parties sans IA tant que
   l'utilisateur n'a pas donné son feu vert.
5. Recette humaine des écrans (le navigateur intégré s'est révélé peu fiable
   pour la relecture visuelle) ; validations métier ci-dessous.

Pièges et décisions :

- Tests API : base `missionpilot_test` réinitialisée à chaque exécution ; ne
  jamais lancer deux suites API en parallèle. Pour plusieurs agents, chacun
  utilise ses propres variables `DATABASE_URL` / `DATABASE_OWNER_URL`
  (base `missionpilot_<id>` → `_test` créée à la volée). PostgreSQL dédié :
  conteneur `missionpilot-postgres` (port 55440) ; les autres conteneurs
  PostgreSQL de la machine appartiennent à d'autres projets.
- Migrations : 0001–0008 socle/référentiels, 0010–0015 missions, 0020–0021
  planification, 0030 temps, 0040–0044 facturation, 0050–0052 2FA, 0060–0064
  finance, 0070–0075 fichiers/commentaires ; prochaine plage libre : 0080.
- Agents : `dev-complex-high` (Opus, effort high) pour moteurs, API sensible
  et correctifs d'audit ; `dev-complex` (Opus, medium) pour le web ;
  `code-reviewer`/`ui-tester` Sonnet ; `dev-simple` Sonnet low
  (voir la mémoire de l'utilisateur).
- Décisions métier posées sans question, à faire valider : proposition validée
  par un associé (PRD MIS-05) ; taux de vente et coûts réservés à
  `finance.lire` ; TVA 18 % de départ, retenue désactivée ; relances J+7/15/30
  (envoi e-mail au client désactivé par défaut) ; comptes SYSCOHADA de départ
  (411, 4191, 706, 707, 4431, 4492, 521, 513, 571, 552) à valider par un
  expert-comptable ; seuils d'approbation 5 M / 25 M / 10 M FCFA ; rappels de
  temps vendredi 16 h et lundi 8 h UTC ; catalogue de conseil, taux, jours
  fériés par pays = valeurs de départ ; fêtes musulmanes saisies par le cabinet.
- Cabinet en EUR/USD : pas de grille FIN-15 propre (révision de budget refusée).
- Import des temps : CSV seulement (le paquet xlsx de npm a des vulnérabilités).
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR`
  obligatoires ; valeurs de développement refusées si la base n'est pas locale.
- Base de développement `missionpilot` : contient des données de recette
  (mission « Recette — Plan stratégique Kora », factures, encaissements) ;
  les comptes de démonstration sont dans `apps/api/src/db/seed.ts`.
