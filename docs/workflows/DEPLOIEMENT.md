# Déploiement — cabinetpilot.allianceconsultants.net

Serveur de **staging/démonstration** (depuis le 2026-10-27, voir (f) ; la vraie production sera une autre instance) sur le VPS
Alliance (`147.93.44.169`, SSH port 2222, utilisateur `deployer`), qui héberge déjà une vingtaine d'applications derrière nginx. Le déploiement passe **toujours par GitHub** : jamais de copie à la main.

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

## Super admin de plateforme et démonstration publique

Toutes les commandes se lancent sur le serveur, depuis `/home/deployer/missionpilot`, avec l'alias `mp` ci-dessus. Les
scripts utilisent l'image déjà déployée (`mp run --rm api …` : conteneur jetable, `working_dir` `/app/apps/api`, même
`missionpilot.env`, donc `DATABASE_OWNER_URL`). Aucune de ces opérations n'est faite par la CI ni par `deploy.sh`.
Ne jamais afficher, copier dans un ticket ni journaliser le contenu de `missionpilot.env` ni un mot de passe.

### (a) Créer le premier VRAI super admin

```bash
mp run --rm api node_modules/.bin/tsx src/db/creer-super-admin.ts --email prenom.nom@exemple.org --nom "Prénom Nom"
```

- Le **mot de passe est généré et affiché UNE seule fois** à la fin de la commande : le noter aussitôt dans un
  gestionnaire de mots de passe, il ne sera plus jamais affiché (aucun outil de réinitialisation : SECURITY.md §15).
  Lancer la commande dans un terminal interactif, pas dans un journal conservé (CI, redirection vers un fichier).
- Pour choisir le mot de passe : variable `SUPER_ADMIN_MOT_DE_PASSE` (préférable à l'option `--mot-de-passe`, qui reste dans
  l'historique du shell) ; il n'est alors jamais réaffiché.
- Codes de sortie : 0 succès ; 1 arguments, configuration ou échec technique ; 2 e-mail déjà pris. Le script ne modifie jamais
  un super admin existant et ne pose jamais `est_demo`.
- Ensuite : `https://cabinetpilot.allianceconsultants.net/plateforme/connexion` (lien « Accès administrateur de la plateforme »
  sous le formulaire de `/connexion`). Pas de 2FA pour le super admin : choisir un mot de passe long et unique.

### (b) Activer la démonstration publique

> **À n'activer que sur un serveur de DÉMONSTRATION, sans donnée réelle.** Avec `DEMO_PUBLIQUE=oui`, n'importe quel visiteur
> ouvre, sans mot de passe, la session de n'importe quel compte du cabinet de démonstration (associé compris) et du super admin
> de démonstration. Leurs mots de passe sont des constantes PUBLIQUES du dépôt. Ne jamais l'activer sur le serveur de
> production d'un vrai cabinet, ni y mettre de données réelles (SECURITY.md §3 et §15).

1. Ajouter la ligne `DEMO_PUBLIQUE=oui` à `/home/deployer/missionpilot.env` (mode 600, éditeur du serveur ; ne pas afficher le
   fichier).
2. Semer le tenant de démonstration (le script exige la variable ET l'option `--confirmer-demo` ; il retire toute configuration
   SMTP, n'écrit que le tenant marqué démonstration et neutralise ses jobs ; plusieurs minutes) :

   ```bash
   mp run --rm api node_modules/.bin/tsx src/db/seed-defaut.ts --confirmer-demo
   ```

   Durée : `pnpm --filter @missionpilot/api db:seed-defaut` met environ 50 s sur une base vide (relevé de la recette locale) ;
   avec `DEMO_PUBLIQUE=oui` et `--confirmer-demo` sur le serveur, le délai est du même ordre. Première installation : le
   lancer une fois, puis vérifier le bloc de connexion (étape 4). Les comptes à 2FA active ou obligatoire n'y sont pas listés.

3. Recréer l'API et le web ensemble (la variable est lue au démarrage ; l'API journalise alors l'avertissement de démonstration
   publique) :

   ```bash
   mp up -d --force-recreate api web
   ```

4. Vérifier : `https://cabinetpilot.allianceconsultants.net/connexion` affiche le bloc « Mode démonstration » ; `GET /api/auth/demo`
   répond 200 (404 sinon : voir RUNBOOK, « Dépannage »).

Précautions : la variable reste dans `missionpilot.env`, donc **tout redéploiement la conserve** ; exiger un SMTP absent ou muet
(`smtp.invalid`, voir HANDOFF) tant que la démonstration est ouverte, les e-mails de visiteurs partant sinon par le vrai SMTP ;
sauvegarder la base juste après le semis (voir (d)).

### (c) Désactiver la démonstration

1. Retirer la ligne `DEMO_PUBLIQUE` de `missionpilot.env`, puis `mp up -d --force-recreate api web`. Effets : `GET /api/auth/demo` et
   les routes `/demo/connexion*` répondent 404 ; le super admin de démonstration **ne peut plus se connecter par mot de passe**
   (refusé tant que la démonstration est inactive).
2. Les comptes du cabinet de démonstration, eux, **gardent leur mot de passe public** et restent connectables par le formulaire :
   désactiver ou supprimer ce cabinet, en SQL avec le rôle propriétaire (le déclencheur réserve `actif` et `est_demo` au
   propriétaire). Désactivation (réversible : coupe à l'instant la connexion et les sessions de tous ses comptes) :

   ```bash
   mp exec postgres psql -U missionpilot_owner -d missionpilot -c "UPDATE cabinets SET actif = false WHERE est_demo"
   mp exec postgres psql -U missionpilot_owner -d missionpilot -c "UPDATE super_admins SET actif = false WHERE est_demo"
   ```

   La suppression complète (cabinet, ses comptes et ses données) n'a pas de script : à ne faire qu'après une sauvegarde, avec une
   requête relue (de nombreuses tables référencent le cabinet) ; préférer la désactivation. Un cabinet désactivé laisse encore
   actifs des chemins annexes (invitations en attente, jobs planifiés, webhooks de canaux, 2FA : SECURITY.md §15).

### (d) Remise à zéro de la démonstration

**État actuel : pas de remise à zéro automatique ni de script.** La démonstration publique est vandalisable (un visiteur peut
renommer ou désactiver le cabinet de démonstration, changer des mots de passe, remplir les plafonds de 30 cabinets et de 40 comptes)
et les plafonds sont permanents. Ce qui existe aujourd'hui, par SQL avec le rôle propriétaire et après sauvegarde :

- réactiver ce qui a été désactivé : `UPDATE cabinets SET actif = true WHERE est_demo AND nom = 'Lagune Conseil & Associés (démo)'` ;
  `db:seed-defaut --confirmer-demo` (relancé comme en (b), idempotent) recrée les comptes manquants, mais ne remet ni les noms ni
  les mots de passe modifiés ;
- repartir d'une base neuve (le volume `missionpilot_pgdata` supprimé puis `deploy.sh` pour les migrations, puis (a) et (b)) :
  ne convient QUE si le serveur ne contient que de la démonstration ;
- restaurer une sauvegarde faite juste après le semis : aucune sauvegarde n'est en place (voir « Exploitation »).

À prévoir : un script `db:reinitialiser-demo` (suppression des seuls cabinets `est_demo` puis nouveau semis) et une tâche
planifiée ; il n'existe pas. Suivi : HANDOFF, section `orch/2026-10-23-super-admin`.

### (e) Semer le « Tenant démo » (cabinet à historique long)

Chantier du 2026-10-24 (décision à valider : DECISIONS.md, « Tenant démo »). Cabinet « Tenant démo » (adresses `@tenant-demo.test`,
48 comptes actifs, 11 missions, deux ans d'activité fictive), à côté de « Lagune Conseil & Associés (démo) » ; description, phases
et reprise : `docs/workflows/RUNBOOK.md`, « Tenant démo ». Mêmes précautions que (b) : serveur de DÉMONSTRATION sans donnée réelle,
`DEMO_PUBLIQUE=oui` dans `missionpilot.env` AVANT la commande (le script exige la variable ET `--confirmer-demo`, retire toute
configuration SMTP et neutralise les jobs qu'il crée).

```bash
mp stop api    # le semis pose des verrous brefs (lock_timeout 5 s) : arrêter l'API pendant la fenêtre
mp run --rm api node_modules/.bin/tsx src/db/seed-tenant-demo.ts --confirmer-demo
mp up -d --force-recreate api web    # le web partage l'espace réseau de l'API : recréer les deux
```

L'étape centrale est l'équivalent de `docker compose run --rm api node_modules/.bin/tsx src/db/seed-tenant-demo.ts
--confirmer-demo` depuis `/home/deployer/missionpilot`.

- **Fenêtre sans visiteurs** : planifier le semis quand personne n'utilise la démonstration. Il dure 10 à 14 minutes sur une machine de développement (mesuré le 2026-10-25) ; l'API est arrêtée et `/connexion` indisponible pendant ce temps. Ne pas lancer deux semis à la
  fois. Le lancer dans un terminal qui survit à la déconnexion (`tmux`), pas dans une session SSH fragile.
- **Aucune clé IA** : le semis échoue net si `OPENROUTER_API_KEY` est définie dans `missionpilot.env` (aucun appel réseau, aucun
  coût ; coûts IA SIMULÉS). Si le serveur a une clé pour un autre usage, la retirer le temps du semis puis la remettre.
- **Reprise** : cabinet complet, relancer ne change rien ; phase échouée, repartir d'une base NEUVE (RUNBOOK). Sur un serveur de
  démonstration seul, cela signifie la remise à zéro de (d) : volume supprimé, `deploy.sh` pour les migrations, puis (a), (b)
  et (e).
- **Remise à zéro** : toujours pas de script. Après un vandalisme, le plus sûr est de repartir d'une base neuve ((d)), puis de
  resemer Lagune (`seed-defaut.ts --confirmer-demo`, étape (b)) et le Tenant démo (cette étape). Sauvegarder la base juste après le
  semis complet (« Sauvegarde de la base ») donne un point de restauration plus rapide qu'un nouveau semis.
- **Vérifier** : `/connexion` propose « Tenant démo » (46 comptes listés sur 48 actifs ; les 2 comptes à 2FA des signatures n'y figurent pas). Le bloc
  est borné à 50 cabinets et 50 comptes par cabinet (migration `0580`).
- **Limites des données** : horodatages des routes en horloge réelle (une journée après la date fictive), voir RUNBOOK.

### (f) Serveur de staging/démonstration : activation en une commande

**Décision (2026-10-27).** Le serveur `cabinetpilot.allianceconsultants.net` est un serveur de **staging + démonstration pour des
prospects**, pas une production. La vraie production sera une **autre instance**, sans `DEMO_PUBLIQUE`, avec SMTP réel et clé IA
propre. Ce serveur ne doit donc jamais recevoir de donnée réelle de cabinet.

`deploy/activer-demo.sh` enchaîne (b) et (e) : contrôles (fichier d'environnement, image de `last-good` contenant les seeds,
migrations présentes, `OPENROUTER_API_KEY` absente, `SMTP_HOST=smtp.invalid`, 5 Go libres), garde-fou « aucune donnée réelle »,
sauvegarde, `DEMO_PUBLIQUE=oui`, semis de Lagune puis du Tenant démo (API arrêtée, `timeout 45m` par semis), recréation de
`api` et `web`, santé locale et vérification de `GET /api/auth/demo` en local puis en public. Il ne contient aucun secret,
n'affiche jamais `missionpilot.env` et ne supprime ni volume ni base. Test local avec de faux outils : `bash deploy/test-activer-demo.sh`.

`ssh alliance` est un alias du poste de travail (`~/.ssh/config`) ; forme explicite : `ssh -p 2222 deployer@147.93.44.169`.

```bash
ssh alliance 'bash -s -- --dry-run' < deploy/activer-demo.sh        # à blanc : lectures seules, rien n'est modifié
ssh alliance 'bash -s -- --arriere-plan' < deploy/activer-demo.sh   # réel : survit à la déconnexion
ssh alliance 'tail -f /home/deployer/activer-demo.log'              # suivre (10 à 14 minutes)
```

**Avant de lancer** (sur le serveur, sans afficher le fichier) :

- mettre `SMTP_HOST=smtp.invalid` dans `/home/deployer/missionpilot.env` (l'API refuse de démarrer sans `SMTP_HOST` : absent ou vide
  fait échouer le script ; un SMTP réel aussi, sauf `--smtp-ok`) ;
- retirer `OPENROUTER_API_KEY` s'il y en a une, et **ne pas la remettre tant que `DEMO_PUBLIQUE=oui`** (des visiteurs feraient
  consommer des appels IA payants) ;
- ne lancer aucun déploiement (CI) pendant le semis : `deploy.sh` recrée `api` et `web` et casserait le semis ; attendre la ligne
  `TERMINE` du journal.

| Option                        | Effet                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--arriere-plan`              | **obligatoire pour un run réel** : contrôles en direct, puis semis relancé par `setsid nohup` (journal `activer-demo.log`)     |
| `--premier-plan`              | run réel dans le terminal, avec avertissement (une coupure SSH peut laisser le site arrêté)                                    |
| `--dry-run`                   | aucune écriture ni commande docker mutante ; lectures (SQL, `compose config`, test des seeds) permises                         |
| `--si-necessaire`             | ne fait rien si `GET /api/auth/demo` liste déjà « Lagune » et « Tenant démo »                                                  |
| `--smtp-ok`                   | accepte un `SMTP_HOST` réel                                                                                                    |
| `--forcer-donnees-existantes` | passe outre le refus (sortie 3) si un cabinet non démo ou plus d'un super admin réel existe                                     |
| `--aide`                      | rappel des options                                                                                                             |

Codes de sortie : 0 succès ; 1 échec ; 2 option inconnue ou mode non choisi ; 3 donnée réelle détectée.

- **Indisponibilité** : l'API est arrêtée pendant le semis, donc `/connexion` et toute l'application sont hors service 10 à 14 minutes.
  **Relancer le script sans `--si-necessaire` refait le semis et recoupe le site 10 à 14 minutes**, même si tout est déjà en place.
- **Reprise sur échec** : si un semis échoue, un `trap` restaure d'abord l'environnement (`DEMO_PUBLIQUE` retirée, depuis
  `missionpilot.env.avant-demo`, pour ne pas exposer un Tenant démo à moitié construit), puis recrée `api` et `web`. Ce `trap` ne
  couvre **ni SIGKILL ni l'arrêt brutal du serveur**, et un run en premier plan peut être interrompu par la coupure SSH : d'où
  `--arriere-plan`. Commande de secours, sur le serveur : `cd /home/deployer/missionpilot && mp up -d --force-recreate api web`.
  Après un semis à moitié fait : base neuve ((d) et (e)), sauf Lagune arrêté après son portail, que la relance complète (voir
  « Incident du 2026-10-27 » ci-dessous).
- **Sauvegarde** : avant toute écriture, via `sauvegarde.sh` s'il est dans le dossier (qui fait aussi une **rotation** : il supprime les
  dumps de plus de 7 jours), sinon `pg_dump -Fc` vers `/home/deployer/backups/missionpilot` (mode 600). C'est le point de retour d'avant démonstration.
- **Désactivation** : voir (c) (retirer `DEMO_PUBLIQUE`, désactiver les cabinets et super admins `est_demo`). `missionpilot.env.avant-demo`
  (mode 600) garde l'environnement d'avant l'activation.
- **Remise à zéro** : toujours manuelle, voir (d).
- **Risques** : mots de passe de démonstration publics dans le dépôt ; tout visiteur ouvre sans mot de passe la session de n'importe quel
  compte listé (associé compris) ; vandalisme possible (renommage, désactivation, mots de passe changés) ; plafonds permanents de 30 cabinets
  et 40 comptes ; aucun e-mail ne part (SMTP `smtp.invalid`) et aucune IA n'est appelée (coûts SIMULÉS).

**Incident du 2026-10-27 et correctif.** Sur le serveur, `seed-defaut.ts --confirmer-demo` a échoué après une vingtaine de secondes :
« Un fournisseur de canal simulé est réservé au développement local : aucun fournisseur réel n'est disponible. » Cause : les
seeds montent une application EN PROCESSUS (sans port, appels par `inject`) avec des ports de canaux SIMULÉS (`seed-demo-canaux.ts`
pour Lagune, `tenant-demo/appels-offres-canaux/canaux-contexte.ts` pour le Tenant démo), et la fabrique `creerCanaux` les refusait
hors base locale (`contexteCanauxSimulesAdmis` : la base du serveur est sur l'hôte `postgres`, pas sur `localhost`). Les tests locaux
ne le voyaient pas, la base y étant toujours locale. Reproduit en local (NODE_ENV=production, base jointe par un nom d'hôte non local) :
même message, Lagune laissé à moitié (`est_demo = false`, sans canaux, redressement ni services candidats, sans super admin démo).

Correctif (branche `orch/2026-10-27-serveur-demo`) :

- `creerCanaux(config, { seedDemonstrationPublique: true })` : option de CODE, passée seulement par ces deux seeds quand la démonstration
  publique est confirmée (`DEMO_PUBLIQUE=oui` ET `--confirmer-demo`, déjà vérifiés par `configDemo`). Jamais lue depuis l'environnement
  ni la configuration ; `loadConfig`, `canauxParDefaut` et le serveur ne la passent jamais : l'API de production refuse toujours les
  fournisseurs simulés (tests dans `apps/api/test/config.test.ts`). Les routes du simulateur (`/api/canaux/simulateur/*`) ne sont
  admises hors local que pour les ports créés avec cette option (`simulateurCanauxAdmis`), donc dans l'application du seed seulement.
- Tenant démo : le simulateur WhatsApp signe ses événements avec un secret de webhook ÉPHÉMÈRE (aléatoire, propre au processus du seed)
  quand le serveur n'en a pas.
- `seed-defaut.ts` reprend, sur un Lagune déjà présent, les étapes qui suivent le portail (comptes 2FA, canaux, redressement, services
  candidats), toutes idempotentes : relancer la commande COMPLÈTE le Lagune laissé à moitié, sans doublon, et pose `est_demo`.
- Recoupement (audit du 2026-10-27) : l'option n'est admise que si la configuration porte aussi `DEMO_PUBLIQUE=oui`, et `semerDefaut`,
  `semerDemoAbidjan` et `semerCanauxDemo` refusent un drapeau `publique` sans cette variable. Un test vérifie la reprise d'un Lagune
  arrêté après le portail, et qu'un cabinet voisin reste intact (toutes ses lignes, hash du mot de passe compris).

**Relance sur le serveur après déploiement du correctif.** Lagune à moitié semé porte `est_demo = false` : le garde-fou de
`activer-demo.sh` le compte comme cabinet réel (sortie 3). Après avoir vérifié dans le journal du `--dry-run` que le seul cabinet non démo
est « Lagune Conseil & Associés (démo) » et qu'il n'y a pas d'autre super admin réel que celui de (a), relancer avec
`--arriere-plan --forcer-donnees-existantes`. En attendant, ses comptes ont des mots de passe PUBLICS et restent connectables par le
formulaire : désactiver ce cabinet comme en (c) (`UPDATE cabinets SET actif = false WHERE nom = 'Lagune Conseil & Associés (démo)'`), puis
le réactiver (`actif = true`) juste avant le semis : un cabinet désactivé n'est pas réactivé par le seed et ses comptes ne peuvent plus
ouvrir de session, ce qui ferait échouer la reprise.

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
