#!/usr/bin/env bash
# Restauration d'un dump MissionPilot dans une base FRAÎCHE du conteneur postgres.
# NON installée sur le serveur : voir docs/workflows/DEPLOIEMENT.md, section « Sauvegarde de la base ».
#
#   bash restauration.sh <fichier.dump> <base_cible>
#   bash restauration.sh --ecraser-production <fichier.dump> missionpilot
#
# Garde-fous : la base cible doit être nommée explicitement et ne pas exister (elle est créée ici).
# « missionpilot » est refusée, sauf avec --ecraser-production ET une confirmation tapée ; dans ce
# cas SEULEMENT, la base est supprimée (connexions coupées) puis recréée avant la restauration.
# Contrôles finaux : nombre de tables du schéma public, schema_migrations et nombre de migrations.
# Variables : COMPOSE_FILE, ENV_FILE, SERVICE, DB_USER, PROD_DB, COMPOSE_PROJECT (comme sauvegarde.sh).
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/home/deployer/missionpilot.env}"
SERVICE="${SERVICE:-postgres}"
DB_USER="${DB_USER:-missionpilot_owner}"
PROD_DB="${PROD_DB:-missionpilot}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
usage() { echo "Usage : $0 [--ecraser-production] <fichier.dump> <base_cible>"; exit 2; }
dc() {
  local args=(--env-file "$ENV_FILE")
  [ -n "${COMPOSE_PROJECT:-}" ] && args+=(-p "$COMPOSE_PROJECT")
  docker compose "${args[@]}" -f "$COMPOSE_FILE" "$@"
}
psql_c() { dc exec -T "$SERVICE" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -tA "$@"; }

ecraser=0
if [ "${1:-}" = "--ecraser-production" ]; then ecraser=1; shift; fi
[ "$#" -eq 2 ] || usage
dump="$1"
cible="$2"

[ -f "$dump" ] && [ -s "$dump" ] || { log "ÉCHEC : dump absent ou vide : $dump"; exit 1; }
[[ "$cible" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { log "ÉCHEC : nom de base invalide : $cible"; exit 1; }
[ -f "$ENV_FILE" ] || { log "ÉCHEC : fichier d'environnement absent : $ENV_FILE"; exit 1; }

if [ "$cible" = "$PROD_DB" ]; then
  [ "$ecraser" -eq 1 ] || { log "REFUS : $cible est la base de production ; utiliser une autre base, ou --ecraser-production"; exit 1; }
  echo "ATTENTION : la base $cible va être SUPPRIMÉE puis remplacée par $dump."
  echo "Arrêter l'API et le web avant (mp stop api web). Pour confirmer, taper : ECRASER $cible"
  read -r confirmation
  [ "$confirmation" = "ECRASER $cible" ] || { log "Abandon : confirmation incorrecte"; exit 1; }
elif [ "$ecraser" -eq 1 ]; then
  log "ÉCHEC : --ecraser-production n'a de sens que pour la base $PROD_DB"; exit 1
fi

existe="$(psql_c -c "SELECT 1 FROM pg_database WHERE datname = '$cible'")"
if [ -n "$existe" ]; then
  [ "$ecraser" -eq 1 ] || { log "REFUS : la base $cible existe déjà (choisir un nouveau nom)"; exit 1; }
  psql_c -c "DROP DATABASE \"$cible\" WITH (FORCE)" >/dev/null
fi
psql_c -c "CREATE DATABASE \"$cible\" OWNER \"$DB_USER\"" >/dev/null
log "base $cible créée, restauration de $dump"

dc exec -T "$SERVICE" pg_restore -U "$DB_USER" -d "$cible" --no-owner --role="$DB_USER" --exit-on-error < "$dump"

tables="$(dc exec -T "$SERVICE" psql -U "$DB_USER" -d "$cible" -tA -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
migrations="$(dc exec -T "$SERVICE" psql -U "$DB_USER" -d "$cible" -tA -c "SELECT count(*) FROM schema_migrations")" \
  || { log "ÉCHEC : schema_migrations absente"; exit 1; }
[ "$tables" -gt 0 ] && [ "$migrations" -gt 0 ] || { log "ÉCHEC : restauration vide (tables=$tables, migrations=$migrations)"; exit 1; }
log "OK : base $cible restaurée, tables=$tables migrations=$migrations"
