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
- **Sauvegarde** : aucune n'est en place pour le volume `missionpilot_pgdata` (à décider : voir HANDOFF).

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

## Limites connues

- **Rapports PDF (Chromium) indisponibles en conteneur** : Chromium refuse de démarrer sans sandbox et le profil
  seccomp par défaut de Docker interdit les espaces de noms utilisateur. `--no-sandbox` est interdit sans décision
  écrite (`SECURITY.md` §8 bis). Word et PowerPoint fonctionnent. Décision de sécurité à prendre : profil seccomp
  dédié, ou rendu PDF dans un conteneur séparé.
- **IP des clients** : l'API n'active pas `trustProxy` ; seule la limitation du webhook entrant (désactivé) utilise l'IP.
