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

**État :** en cours (vagues 1 à 3 livrées ; reste finance, écrans temps/planning, V2)
**Dernier commit poussé :** `6b26c60` écrans des référentiels

Fait (vérifié par le Pilote : typecheck, lint, prettier, 706 tests) :

- Cadrage validé (voir `docs/DECISIONS.md`) : V1 puis V2 enchaînées, saisie des
  temps paramétrable, zone UEMOA, catalogue de conseil. ADR-001 à 003 (PR #3).
- Socle (PR #4) : monorepo pnpm, RLS, sessions, audit en ajout seul, file `jobs`.
- `packages/engines` : moteurs planning et finance purs, 228 tests, couverture
  100 % lignes / 99,4 % branches ; plan de charge optimisé (100 × 26 en 0,2 s).
- `apps/api` (247 tests, migrations 0001–0030) : référentiels, pipeline,
  propositions, missions, découpage, budget figé, documents, affectations,
  congés, plan de charge, « Mon planning », re-planification, notifications,
  feuilles de temps, reste à faire, atterrissage, alertes, clôture mensuelle,
  import CSV, worker de jobs (rappels du vendredi et du lundi).
- `apps/web` (199 tests) : shell, référentiels, pipeline, propositions,
  missions, découpage, planning, budget.
- Trois audits de sécurité et de code relus ; tous les constats critiques,
  élevés et moyens corrigés avec un test de non-régression.

Reste à faire (ordre) : facturation, encaissements, débours, rentabilité,
indicateurs du cabinet, export comptable (FIN) ; écrans web du plan de charge,
de « Mon planning », de la feuille de temps, de la facturation et des
indicateurs ; TOTP ; transport e-mail réel ; import Excel ; puis V2
(questionnaires, notation, planification stratégique, KPI, portail client,
OpenRouter, rapports PDF/DOCX/PPTX).

Pièges et décisions :

- …
```

---

## Branche `feat/socle-monorepo` — 2026-10-06

**État :** en cours (vagues 1 à 3 livrées ; reste finance, écrans temps/planning, V2)
**Dernier commit poussé :** `6b26c60` écrans des référentiels

Fait (vérifié par le Pilote : typecheck, lint, prettier, 514 tests) :

- Cadrage validé (voir `docs/DECISIONS.md`) : V1 puis V2 enchaînées, saisie des
  temps paramétrable, zone UEMOA, catalogue de conseil. ADR-001 à 003 (PR #3).
- Socle (PR #4) : monorepo pnpm, RLS, sessions, audit en ajout seul, file `jobs`.
- `packages/engines` : moteurs planning et finance purs, 221 tests, couverture
  100 % lignes / 99,4 % branches. Pas encore branchés dans les routes sauf
  budget/synthèse des missions.
- `apps/api` : référentiels (utilisateurs, invitations, cabinet, fériés, clients,
  collaborateurs, grades, catalogue, audit), pipeline, propositions, missions,
  découpage, budget figé, documents. Migrations 0001–0014. 152 tests.
- `apps/web` : shell, design system, écrans des référentiels. 124 tests.
- Audits de sécurité et de code relus (vague 1 corrigée ; vague 2 : 4 constats
  élevés en cours de correction par un agent, migrations 0015+).

En cours (agents, non commités) : correctifs d'audit API (fuite de coût par la
comparaison de versions, grille de taux dans les propositions, taux de change
figé, séparation des tâches de validation) ; écrans web pipeline/missions.

Reste à faire (ordre) : affectations, congés, plan de charge, « Mon planning »
(PLN-04 à PLN-10) ; temps, atterrissage, alertes (TPS) ; facturation,
encaissements, indicateurs, rentabilité (FIN) ; TOTP ; transport e-mail réel ;
puis V2 (questionnaires, notation, planification stratégique, KPI, portail
client, OpenRouter).

Pièges et décisions :

- Tests API : une seule base `missionpilot_test`, réinitialisée à chaque
  exécution ; jamais deux suites API en parallèle. PostgreSQL dédié :
  conteneur `missionpilot-postgres` (port 55440, `pnpm db:up`) ; les autres
  conteneurs PostgreSQL de la machine sont à d'autres projets, n'y pas toucher.
- Migrations : 0001–0008 référentiels et durcissement, 0010–0015 missions,
  0020–0021 planification, 0030 temps ; finance à partir de 0040.
- Décisions métier posées sans question : une proposition est validée par un
  associé (PRD MIS-05) ; les taux de vente par grade et les coûts sont réservés
  à `finance.lire` (AGENTS.md) ; taux de change EUR/FCFA figé à 655,957.
- Fêtes musulmanes saisies chaque année par le cabinet ; fériés nationaux par
  pays = valeurs par défaut à faire valider par le métier ; taux de vente et
  jours types du catalogue de conseil = valeurs de départ à valider.
- Grille d'approbation FIN-15 (5 M / 25 M / 10 M FCFA) : valeurs par défaut du
  moteur, à faire valider. Cabinet en EUR/USD : pas de grille, révision refusée.
- Import des temps : CSV seulement (le paquet xlsx de npm a des vulnérabilités
  connues). Rappels de temps à 16 h / 8 h UTC, à valider par le métier.
- Aucun transport e-mail réel : les invitations ne partiraient pas en production.
- Pas de `.env` : valeurs de développement par défaut dans `apps/api/src/config.ts`,
  refusées hors développement et test.
