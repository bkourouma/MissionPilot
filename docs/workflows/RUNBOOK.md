# Runbook — MissionPilot

Lancer, configurer et dépanner le projet. En cas de désaccord avec
[AGENTS.md](../../AGENTS.md), AGENTS.md prime.

## Prérequis

- Git (`git --version` : 2.52 vérifié) et Node ≥ 20 pour les scripts du
  standard (`node -v` : 24.12 vérifié).
- Lefthook, pour les hooks git : absent de cette machine (voir Dépannage).

TODO(acc-adapt) : versions des outils de l'application (gestionnaire de
paquets, PostgreSQL, services externes) et comment les vérifier, une fois la
stack tranchée (voir « Pièges connus » d'`AGENTS.md`).

## Installation

```bash
# TODO(acc-adapt) : commande d'installation
node scripts/install-git-hooks.cjs    # hooks git Lefthook
```

### Fichiers d'environnement

TODO(acc-adapt) : fichiers `.env.example` à copier, variables obligatoires et
leur rôle (jamais leur valeur). Les agents ne lisent ni n'écrivent les `.env` :
leur création revient à l'utilisateur.

## Lancer

```bash
# TODO(acc-adapt) : commande de lancement en développement
```

## Ports

TODO(acc-adapt) : un tableau service → port, aligné sur `ports` dans
`acc.config.json`, et les variables qui doivent rester cohérentes entre
services (origines autorisées, URL d'API…).

## Commandes quotidiennes

```bash
```

## Bus d'agents

`.agent-bus/` (racine du checkout principal, commun à tous les worktrees,
ignoré par git, surchargeable par `AGENT_BUS_DIR`) porte les anomalies et le
journal des révisions échangés entre développement et recette :

```bash
node scripts/agent-bus.cjs help
node scripts/agent-bus.cjs list --state "prêt au retest"
```

## Worktrees git (`.claude/worktrees/*`)

Un `git worktree` n'a pas ses propres dépendances installées : les hooks git
(Lefthook, lint-staged) et les commandes du projet y échouent tant qu'elles ne
sont pas résolvables. Avant tout `git commit` dans un worktree, installer les
dépendances dans le worktree (choix par défaut, toujours sûr).

Un lien vers les dépendances du checkout principal (sous Windows, une
jonction : `mklink /J "<worktree>\node_modules" "<checkout principal>\node_modules"`)
évite une installation, mais seulement pour des outils qui suivent les liens
sans vérifier où ils mènent (hooks git, lint, typecheck). Il est à proscrire
quand un outil refuse un `node_modules` situé hors de la racine du projet :
c'est le cas de Turbopack (bundler par défaut de Next.js à partir de la
version 16), qui échoue au `dev` comme au `build` avec un lien symbolique ou
une jonction qui sort du dossier. Un lien partagé désynchronise aussi les
artefacts générés dans `node_modules` (client de base de données, types
générés…) quand les deux checkouts sont sur des révisions différentes.

TODO(acc-adapt) : préciser les dossiers de dépendances du projet, si un lien
est acceptable ici (bundler, outils) et les artefacts générés qu'il
désynchronise.

## Dépannage

### Hooks Lefthook

`.lefthook.yml` déclare un hook `pre-push` (`scripts/pre-push-guard.cjs`) qui
refuse une poussée vers une branche protégée (`git.protectedBranches`
d'`acc.config.json`). Un refus se corrige (passer par une branche puis une
PR), il ne se contourne pas. `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor` vérifie que les hooks
sont installés.

**Symptôme :** `node scripts/install-git-hooks.cjs` répond « Lefthook
introuvable : hooks git non installés » (code 0) et `doctor` avertit que
`pre-commit` et `pre-push` ne mentionnent pas lefthook. **Cause :** pas de
`package.json` donc pas de dépendance `lefthook`, et pas de binaire système.
**Correctif :** ajouter `lefthook` en dépendance de développement, ou
installer le binaire, puis relancer le script.

### Autres pannes connues

TODO(acc-adapt) : symptômes réellement rencontrés, cause et correctif (port
occupé, secret refusé au démarrage, origine refusée, tests lents…), une fois
l'application lancée.
