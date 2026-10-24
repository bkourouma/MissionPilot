#!/usr/bin/env bash
# Sauvegarde de la base PostgreSQL de MissionPilot, exécutée SUR le serveur (cron ou à la main).
# NON installée sur le serveur : voir docs/workflows/DEPLOIEMENT.md, section « Sauvegarde de la base ».
#
#   bash sauvegarde.sh
#
# Ce que fait le script :
#   1. pg_dump au format custom (-Fc) DANS le conteneur postgres ;
#   2. écriture atomique : fichier .partial, contrôle, puis mv vers missionpilot-AAAAMMJJ-HHMMSS.dump (mode 600) ;
#   3. contrôle : fichier non vide et lisible par pg_restore --list ;
#   4. rotation : supprime les missionpilot-*.dump de plus de KEEP_DAYS jours, et rien d'autre.
# Aucun mot de passe n'est lu ni affiché (pg_dump passe par le socket local du conteneur).
# Variables surchargeables (utilisées par deploy/test-sauvegarde.sh pour viser un conteneur de test) :
#   COMPOSE_FILE, ENV_FILE, SERVICE, DB_NAME, DB_USER, BACKUP_DIR, KEEP_DAYS, COMPOSE_PROJECT
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/home/deployer/missionpilot.env}"
SERVICE="${SERVICE:-postgres}"
DB_NAME="${DB_NAME:-missionpilot}"
DB_USER="${DB_USER:-missionpilot_owner}"
BACKUP_DIR="${BACKUP_DIR:-/home/deployer/backups/missionpilot}"
KEEP_DAYS="${KEEP_DAYS:-7}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
dc() {
  local args=(--env-file "$ENV_FILE")
  [ -n "${COMPOSE_PROJECT:-}" ] && args+=(-p "$COMPOSE_PROJECT")
  docker compose "${args[@]}" -f "$COMPOSE_FILE" "$@"
}

[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && [ "$KEEP_DAYS" -ge 1 ] || { log "ÉCHEC : KEEP_DAYS invalide ($KEEP_DAYS)"; exit 1; }
[ -f "$ENV_FILE" ] || { log "ÉCHEC : fichier d'environnement absent : $ENV_FILE"; exit 1; }
[ -f "$COMPOSE_FILE" ] || { log "ÉCHEC : compose absent : $COMPOSE_FILE"; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

horodatage="$(date '+%Y%m%d-%H%M%S')"
final="$BACKUP_DIR/missionpilot-$horodatage.dump"
partiel="$final.partial"
# Le fichier partiel est supprimé en cas d'échec (jamais un dump valide).
trap 'rm -f "$partiel"' EXIT

log "sauvegarde de $DB_NAME (service $SERVICE) vers $final"
dc exec -T "$SERVICE" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$partiel"

[ -s "$partiel" ] || { log "ÉCHEC : dump vide"; exit 1; }
nb_entrees="$(dc exec -T "$SERVICE" pg_restore --list < "$partiel" | grep -vc '^;')" \
  || { log "ÉCHEC : dump illisible par pg_restore --list"; exit 1; }
[ "$nb_entrees" -gt 0 ] || { log "ÉCHEC : dump sans contenu"; exit 1; }

chmod 600 "$partiel"
mv "$partiel" "$final"
log "OK : $final ($(wc -c < "$final") octets, $nb_entrees entrées)"

# Rotation : uniquement des fichiers réguliers missionpilot-*.dump, directement dans BACKUP_DIR.
supprimes=0
while IFS= read -r -d '' ancien; do
  rm -f -- "$ancien"
  log "rotation : supprimé $(basename "$ancien")"
  supprimes=$((supprimes + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'missionpilot-*.dump' -mtime "+$((KEEP_DAYS - 1))" -print0)
log "rotation terminée : $supprimes supprimé(s), ancienneté maximale $KEEP_DAYS jours"
