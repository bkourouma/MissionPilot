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
| `/home/deployer/missionpilot/`               | `deploy.sh` et `docker-compose.prod.yml`, recopiés à chaque déploiement                          |
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
- **Sauvegarde** : scripts prêts mais **non installés** (voir « Sauvegarde de la base » ci-dessous).

## Sauvegarde de la base

> **NON installé sur le serveur : à faire par l'utilisateur.** Les scripts sont dans le dépôt, testés en local,
> mais `deploy.sh` et le workflow ne les copient pas : aucune sauvegarde n'existe aujourd'hui en production.

| Script                     | Rôle                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `deploy/sauvegarde.sh`     | `pg_dump -Fc` exécuté dans le conteneur `postgres`, fichier `missionpilot-AAAAMMJJ-HHMMSS.dump` dans `/home/deployer/backups/missionpilot/` (variable `BACKUP_DIR`) |
| `deploy/restauration.sh`   | restaure un dump dans une base **fraîche** et contrôle le résultat                              |
| `deploy/test-sauvegarde.sh`| test réel sur un PostgreSQL jetable local (conteneur `mp-sauvegarde-test`), nettoie derrière lui |

`sauvegarde.sh` : écriture atomique (`.partial` puis `mv`), droits 600 (dossier 700), contrôle « non vide et lisible
par `pg_restore --list` », journal horodaté, code de sortie non nul au moindre échec, aucun mot de passe lu ni affiché
(`pg_dump` passe par le socket local du conteneur). Rotation : supprime uniquement les `missionpilot-*.dump` de
`BACKUP_DIR` vieux de 7 jours ou plus (`KEEP_DAYS`, 7 par défaut), jamais un autre fichier.
`restauration.sh` : exige un nom de base cible explicite, refuse une base existante et refuse `missionpilot`
sauf `--ecraser-production` avec confirmation tapée (`ECRASER missionpilot`).

Dernier test (2026-10-23, local, 232 migrations du dépôt) : source 353 tables / 232 migrations, dump de 3,1 Mo
(6082 entrées), base restaurée 353 tables / 232 migrations, rotation conforme (dumps de 8 jours supprimés, dump de
3 jours et fichier au nom différent conservés).

### Installation manuelle sur le serveur

```bash
# depuis le poste de travail, à la racine du dépôt
scp -P 2222 deploy/sauvegarde.sh deploy/restauration.sh deployer@147.93.44.169:/home/deployer/missionpilot/

# sur le serveur
ssh -p 2222 deployer@147.93.44.169
chmod 750 /home/deployer/missionpilot/sauvegarde.sh /home/deployer/missionpilot/restauration.sh
mkdir -p /home/deployer/backups/missionpilot && chmod 700 /home/deployer/backups/missionpilot
bash /home/deployer/missionpilot/sauvegarde.sh        # première sauvegarde à la main
ls -l /home/deployer/backups/missionpilot/

crontab -e   # ajouter, tous les jours à 02:30 :
30 2 * * * /home/deployer/missionpilot/sauvegarde.sh >> /home/deployer/backups/missionpilot/sauvegarde.log 2>&1
```

Ces scripts ne sont pas recopiés par `deploy.sh` : en cas de mise à jour, les recopier à la main. Le journal
`sauvegarde.log` grossit lentement ; le faire tourner (logrotate) si besoin.

### Vérifier

- `tail -20 /home/deployer/backups/missionpilot/sauvegarde.log` : dernière ligne `rotation terminée`, pas de `ÉCHEC`.
- `ls -l /home/deployer/backups/missionpilot/` : un fichier par jour, 7 au plus, taille stable (non nulle), mode `-rw-------`.

### Restaurer

```bash
cd /home/deployer/missionpilot
# 1. dans une base de contrôle (sans risque) : base fraîche, nom explicite
bash restauration.sh /home/deployer/backups/missionpilot/missionpilot-AAAAMMJJ-HHMMSS.dump missionpilot_verif
#    -> affiche tables= et migrations= ; comparer avec la production
alias mp='docker compose --env-file /home/deployer/missionpilot.env -f docker-compose.prod.yml'
mp exec -T postgres psql -U missionpilot_owner -d postgres -c 'DROP DATABASE missionpilot_verif'   # ménage

# 2. remplacer la production (sinistre uniquement) : arrêter l'application, restaurer, relancer
mp stop api web
bash restauration.sh --ecraser-production /home/deployer/backups/missionpilot/<dump> missionpilot   # confirmation tapée
mp up -d --force-recreate api web
```

Le volume `missionpilot_stockage` (fichiers téléversés) n'est **pas** couvert par ces scripts : la base seule est
sauvegardée.

### Test de restauration conseillé chaque mois

Restaurer le dump le plus récent dans `missionpilot_verif` (étape 1 ci-dessus), vérifier que `tables` et
`migrations` correspondent à la production, puis supprimer la base de contrôle. Une sauvegarde jamais restaurée
n'est pas une sauvegarde.

### À décider

- **Copie hors serveur** : les dumps vivent sur le même disque que la base ; une panne du VPS perdrait les deux.
  Choisir une destination (autre serveur par `rsync`/`scp`, stockage objet chiffré) et ajouter la copie au cron.
- Durée de rétention (7 jours par défaut) et chiffrement des dumps hors serveur (ils contiennent toutes les données
  des cabinets).

## Limites connues

- **Rapports PDF (Chromium) indisponibles en conteneur** : Chromium refuse de démarrer sans sandbox et le profil
  seccomp par défaut de Docker interdit les espaces de noms utilisateur. `--no-sandbox` est interdit sans décision
  écrite (`SECURITY.md` §8 bis). Word et PowerPoint fonctionnent. Décision de sécurité à prendre : profil seccomp
  dédié, ou rendu PDF dans un conteneur séparé.
- **IP des clients** : l'API n'active pas `trustProxy` ; seule la limitation du webhook entrant (désactivé) utilise l'IP.
