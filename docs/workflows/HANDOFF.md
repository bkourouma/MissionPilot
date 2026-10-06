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

## Branche `chore/acc-adapt` — 2026-10-06

**État :** prêt à relire
**Dernier commit :** `3c3c728` chore: architecture agentique acc-standard v0.1.0 (sur `main`)

Fait :

- Architecture agentique `acc-standard` 0.1.0 posée sur `main`
  (profils : base) et poussée sur GitHub.
- `/acc-adapt` exécuté sans code applicatif : `AGENTS.md` (structure,
  commandes, règles, pièges), `CLAUDE.md` (table de chargement), `SECURITY.md`
  (actifs, acteurs, données personnelles, points ouverts), `CODING_STANDARDS.md`
  (localisation, tests, dette), `ADR-000` et `RUNBOOK.md` (prérequis, Lefthook).

Reste à faire :

- Trancher les désaccords entre le PRD et `docs/DECISIONS.md` (voir
  `AGENTS.md`, « Pièges connus »), puis noter chaque choix dans un ADR.
- Relancer `/acc-adapt` dès le premier code : il reste des `TODO(acc-adapt)`
  dans `AGENTS.md`, `RUNBOOK.md`, `CODING_STANDARDS.md`, `SECURITY.md`,
  `.claude/rules/review-checklist.md` (chemins `paths:` réels) et
  `.claude/skills/run-missionpilot/SKILL.md`.
- Installer Lefthook (`package.json`), relancer
  `node scripts/install-git-hooks.cjs`, puis vérifier avec
  `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor`.
- Compléter `acc.config.json` (`commands`, `ports`, `hooks.preCommit`,
  `guard.protectedPaths`) et relancer `apply`.

Pièges et décisions :

- Les fichiers gérés (voir `.acc/manifest.json`) ne se modifient pas
  localement : `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE update` les remplacerait ou signalerait un
  conflit.
- Les règles ajoutées sont celles de la spécification, pas du code : elles
  sont marquées « décidées, non implémentées » pour que `security-auditor` ne
  les prenne pas pour des contrôles existants.
