#!/usr/bin/env bash
# Déploiement de MissionPilot sur le VPS, exécuté SUR le serveur par .github/workflows/deploy.yml
# (le workflow copie ce fichier et docker-compose.prod.yml dans /home/deployer/missionpilot/).
# Idempotent : on peut le relancer à la main.
#
#   MP_IMAGE=ghcr.io/bkourouma/missionpilot:<sha> GHCR_USER=<compte> bash deploy.sh < jeton-ghcr
#
# Entrée standard : jeton de lecture de GHCR (docker login). Ce que fait le script :
#   1. contrôles préalables (fichier d'environnement, compose valide) ;
#   2. docker pull de l'image, démarrage de PostgreSQL ;
#   3. migrations (rôle propriétaire ; crée aussi le rôle applicatif) ;
#   4. démarrage de l'API puis du web ;
#   5. contrôles de santé (local, puis URL publique). Au moindre échec : retour à la version
#      précédente (fichier last-good) et sortie en ÉCHEC, pour que le workflow reste rouge ;
#   6. version mémorisée dans last-good, nettoyage des vieilles images.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=/home/deployer/missionpilot.env
LAST_GOOD=/home/deployer/missionpilot.last-good
URL_PUBLIQUE=https://cabinetpilot.allianceconsultants.net

: "${MP_IMAGE:?MP_IMAGE absente}"
: "${GHCR_USER:?GHCR_USER absent}"
[ -f "$ENV_FILE" ] || { echo "Fichier d'environnement absent : $ENV_FILE (voir docs/workflows/DEPLOIEMENT.md)"; exit 1; }
export MP_IMAGE

dc() { docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }

echo "→ connexion à GHCR"
docker login ghcr.io -u "$GHCR_USER" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

precedente=""
[ -f "$LAST_GOOD" ] && precedente="$(cat "$LAST_GOOD")"

sante() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 5 http://127.0.0.1:3050/api/sante >/dev/null 2>&1 \
      && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3050/connexion 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

dc config -q
echo "→ pull $MP_IMAGE"
docker pull "$MP_IMAGE"
dc up -d --wait postgres

echo "→ migrations"
dc run --rm --no-deps -w /app/apps/api api node_modules/.bin/tsx src/db/migrate.ts

echo "→ démarrage"
dc up -d --force-recreate api web

if sante && curl -fsS --max-time 15 -o /dev/null "$URL_PUBLIQUE/api/sante"; then
  echo "$MP_IMAGE" > "$LAST_GOOD"
  docker image prune -f >/dev/null
  echo "✔ déploiement réussi : $MP_IMAGE"
  exit 0
fi

echo "✘ contrôle de santé en échec"
dc logs --tail 60 api web || true
if [ -n "$precedente" ] && [ "$precedente" != "$MP_IMAGE" ]; then
  echo "→ retour à $precedente"
  MP_IMAGE="$precedente" dc up -d --force-recreate api web || true
fi
exit 1
