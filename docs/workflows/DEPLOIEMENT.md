# Déploiement — cabinetpilot.allianceconsultants.net

Production sur le VPS Alliance (`147.93.44.169`, SSH port 2222, utilisateur `deployer`), qui héberge déjà une
vingtaine d'applications derrière nginx. Le déploiement passe **toujours par GitHub** : jamais de copie à la main.

```text
push sur main ──> .github/workflows/deploy.yml
                   ├─ ci        barrière qualité (ci.yml : typecheck, lint, tests, API en 4 partitions)
                   ├─ build     image Docker (Dockerfile) construite sur GitHub, poussée sur GHCR
                   └─ deploy    scp + ssh : deploy/deploy.sh sur le serveur
                                 pull → migrations → api + web → contrôles de santé → retour arrière si échec

Internet ─443─> nginx (hôte, Let's Encrypt) ─> 127.0.0.1:3050 ─> conteneur api (4100, 127.0.0.1)
                                                                  └ conteneur web (Next, 3100) : même espace réseau
                                                 conteneur postgres : réseau Docker interne, aucun port publié
```

Le web relaie `/api/*` vers l'API (`API_URL=http://127.0.0.1:4100`, figée au build) ; l'API n'écoute que sur
`127.0.0.1`, donc le conteneur `web` partage l'espace réseau de `api` (`network_mode: service:api`).

## Lancer un déploiement

- **Automatique** : fusion d'une PR vers `main`.
- **Manuel** : onglet Actions → « Deploy » → _Run workflow_ (choisir la branche), ou
  `gh workflow run deploy.yml --ref <branche>`.
- Le dépôt est **public** : `deploy.yml` ne doit jamais avoir de déclencheur `pull_request` (les secrets seraient
  exposés au code d'un fork), et aucun runner auto-hébergé ne doit y être branché.

## Éléments sur le serveur (hors git)

| Élément                                      | Rôle                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/home/deployer/missionpilot.env` (mode 600) | secrets : mots de passe PostgreSQL, `SESSION_SECRET`, `TFA_MASTER_KEY`, SMTP. Créé par `deploy/bootstrap-serveur.sh` |
| `/home/deployer/missionpilot/`               | `deploy.sh`, `docker-compose.prod.yml` et `seccomp-chromium.json`, recopiés à chaque déploiement |
| `/home/deployer/missionpilot.last-good`      | image de la dernière version saine (cible du retour arrière)                                     |
| volumes Docker `missionpilot_pgdata`, `missionpilot_stockage` | base et fichiers téléversés : survivent aux redéploiements                      |
| `/etc/nginx/sites-available/cabinetpilot.allianceconsultants.net` | copie de `deploy/nginx-cabinetpilot.conf`                                   |
| `authorized_keys` de `deployer`              | clé `github-actions-missionpilot`, dédiée à ce dépôt (la révoquer en retirant cette ligne)        |

Secrets GitHub du dépôt : `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` (empreinte du
serveur, pas de confiance au premier contact). L'image est lue sur GHCR avec le `GITHUB_TOKEN` du job, passé par
l'entrée standard de `deploy.sh` et jamais écrit sur disque (`docker logout` en sortie).

## Première installation (déjà faite le 2026-10-23)

```bash
ssh -p 2222 deployer@147.93.44.169 'bash -s' < deploy/bootstrap-serveur.sh   # env + certificat
sudo cp deploy/nginx-cabinetpilot.conf /etc/nginx/sites-available/cabinetpilot.allianceconsultants.net
sudo ln -sfn /etc/nginx/sites-available/cabinetpilot.allianceconsultants.net /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Le DNS de `cabinetpilot.allianceconsultants.net` doit pointer sur `147.93.44.169` avant le certificat.

## Exploitation

```bash
ssh -p 2222 deployer@147.93.44.169
cd /home/deployer/missionpilot
alias mp='docker compose --env-file /home/deployer/missionpilot.env -f docker-compose.prod.yml'
mp ps                       # état
mp logs --tail 100 api web  # journaux
```

- **SMTP** : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_TLS`, `MAIL_FROM` dans
  `missionpilot.env`, puis relancer un déploiement (ou `mp up -d --force-recreate api web`). L'API refuse de démarrer
  sans `SMTP_HOST`.
- **Redémarrer l'API seule casse le web** (il partage son espace réseau) : toujours recréer `api` et `web` ensemble.
- **Retour arrière manuel** : `MP_IMAGE=$(cat /home/deployer/missionpilot.last-good) mp up -d --force-recreate api web`.
- **Sauvegarde** : aucune n'est en place pour le volume `missionpilot_pgdata` (à décider : voir HANDOFF).

## Limites connues

- **Rapports PDF (Chromium) : solution prête, jamais éprouvée sur le serveur.** Chromium garde sa sandbox (aucun
  `--no-sandbox`, `SECURITY.md` §8 bis) mais le profil seccomp par défaut de Docker interdit les espaces de noms
  utilisateur dont elle a besoin (« No usable sandbox! », API : 503 `RENDU_PDF_INDISPONIBLE`). Le service `api` utilise
  donc le profil dédié `deploy/seccomp-chromium.json` (`security_opt: seccomp=./seccomp-chromium.json`) : profil par
  défaut de Docker 29.1.3 (moby/profiles seccomp v0.1.0) plus `clone` et `unshare` pour les seuls drapeaux
  `CLONE_NEWUSER`, `CLONE_NEWPID` et `CLONE_NEWNET` ; `clone3` reste refusé (ENOSYS, repli sur `clone`), `setns`
  reste réservé à `CAP_SYS_ADMIN`. Ni `privileged`, ni `cap_add`, ni `seccomp=unconfined`. Le workflow copie le profil
  à côté du compose ; `deploy.sh` refuse de partir sans lui et, après les contrôles de santé, lance un Chromium de
  vérification dans le conteneur (avertissement « ⚠ » dans le journal du déploiement s'il échoue : le déploiement
  n'est pas annulé, Word et PowerPoint n'en dépendent pas).
  - **Testé en local seulement** (Docker Desktop 29.1.3, noyau WSL2 6.6.87.2) : sans le profil, Chromium échoue ; avec
    lui, `chromium --headless=new` démarre sans `--no-sandbox` (rendu et zygote dans leurs propres espaces de noms
    utilisateur et processus) et `htmlEnPdf` (le code de l'API) produit un PDF. Le noyau du serveur n'est pas celui de
    Docker Desktop : **aucun déploiement n'a été fait et le serveur n'a pas été consulté**.
  - **À vérifier sur le serveur avant ou au premier déploiement** (le noyau doit autoriser les espaces de noms
    utilisateur non privilégiés, ce que Docker ne peut pas contourner) :
    `sysctl user.max_user_namespaces` (doit être > 0), `sysctl kernel.unprivileged_userns_clone` (doit valoir 1 ;
    la clé n'existe pas sur tous les noyaux : son absence est normale) et, sous Ubuntu 23.10 ou plus récent,
    `sysctl kernel.apparmor_restrict_unprivileged_userns` (1 = restriction active : voir ci-dessous). Test direct,
    équivalent à celui de `deploy.sh` : `mp exec -T api chromium --headless=new --disable-gpu
    --user-data-dir=/tmp/cr --dump-dom about:blank` doit afficher `<html><head></head><body></body></html>`. Si
    la valeur est insuffisante, c'est un réglage du serveur à décider par l'administrateur (jamais `--no-sandbox`) ;
    si AppArmor restreint les espaces de noms, il faut un profil AppArmor adapté et non son retrait global.
  - Sans ce prérequis, la fonction reste désactivée de fait : l'API répond 503 `RENDU_PDF_INDISPONIBLE`
    (« navigateur introuvable ou en échec ») ; la solution de repli serait un conteneur de rendu séparé (non réalisé).
- **IP des clients** : l'API n'active pas `trustProxy` ; seule la limitation du webhook entrant (désactivé) utilise l'IP.
