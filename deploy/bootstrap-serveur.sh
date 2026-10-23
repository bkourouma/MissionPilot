#!/usr/bin/env bash
# Amorçage UNIQUE du VPS pour cabinetpilot.allianceconsultants.net (147.93.44.169). Additif : ne
# touche à aucune autre application. Rejouable : ne réécrit jamais un fichier d'environnement ou
# un certificat qui existent déjà.
#
#   ssh -p 2222 deployer@147.93.44.169 'bash -s' < deploy/bootstrap-serveur.sh
#
# Prérequis : le DNS de cabinetpilot.allianceconsultants.net pointe sur 147.93.44.169 ; sudo sans mot
# de passe pour deployer ; nginx et certbot installés (déjà le cas). Les secrets sont générés ici et
# ne sont jamais affichés. Après l'amorçage, renseigner SMTP_* dans le fichier d'environnement
# (voir docs/workflows/DEPLOIEMENT.md).
set -euo pipefail

DOMAINE=cabinetpilot.allianceconsultants.net
ENV_FILE=/home/deployer/missionpilot.env
DIR=/home/deployer/missionpilot

mkdir -p "$DIR"

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  pg_owner="$(openssl rand -hex 24)"
  pg_app="$(openssl rand -hex 24)"
  {
    echo "# Environnement de production de MissionPilot. Jamais dans git. Droits 600."
    echo "POSTGRES_PASSWORD=$pg_owner"
    echo "DATABASE_OWNER_URL=postgres://missionpilot_owner:$pg_owner@postgres:5432/missionpilot"
    echo "DATABASE_URL=postgres://missionpilot_app:$pg_app@postgres:5432/missionpilot"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "TFA_MASTER_KEY=$(openssl rand -hex 32)"
    echo "# À RENSEIGNER : l'API refuse de démarrer sans SMTP_HOST (e-mails d'invitation, 2FA, mot de passe)."
    echo "SMTP_HOST="
    echo "SMTP_PORT=587"
    echo "SMTP_TLS=starttls"
    echo "SMTP_USER="
    echo "SMTP_PASS="
    echo "MAIL_FROM="
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Fichier d'environnement créé : $ENV_FILE (secrets générés, SMTP à renseigner)"
else
  echo "Fichier d'environnement déjà présent : conservé"
fi

# Vhost HTTP seul, pour que certbot valide le challenge avant qu'un certificat existe.
if ! sudo test -e "/etc/letsencrypt/live/$DOMAINE/fullchain.pem"; then
  sudo tee "/etc/nginx/sites-available/$DOMAINE" > /dev/null <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAINE;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 503; }
}
CONF
  sudo ln -sfn "/etc/nginx/sites-available/$DOMAINE" "/etc/nginx/sites-enabled/$DOMAINE"
  sudo nginx -t
  sudo systemctl reload nginx
  sudo certbot certonly --webroot -w /var/www/html -d "$DOMAINE" --non-interactive --agree-tos
fi
echo "Certificat : $(sudo ls /etc/letsencrypt/live/$DOMAINE | tr '\n' ' ')"
