#!/usr/bin/env bash
# Test réel de deploy/sauvegarde.sh et deploy/restauration.sh sur un PostgreSQL JETABLE.
# Rejouable ; nettoie derrière lui (conteneur, volume, dossier temporaire), même en cas d'échec.
# Ne touche à aucune base existante : conteneur mp-sauvegarde-test, projet compose mp-sauvegarde-test.
#
#   bash deploy/test-sauvegarde.sh            (depuis la racine du dépôt, pnpm install fait, Docker démarré)
#   MP_TEST_PORT=55471 bash deploy/test-sauvegarde.sh   (port local du conteneur de test, 127.0.0.1 seulement)
#
# Étapes : démarrage → migrations du dépôt → sauvegarde → rotation (faux fichiers) → restauration
# dans une base jetable → comparaison des nombres de tables et de migrations → nettoyage.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MP_TEST_PORT:-55471}"
PROJET=mp-sauvegarde-test
tmp="$(mktemp -d)"
# Chemin lisible par docker compose (Windows : forme C:/...).
tmp_c="$tmp"; command -v cygpath >/dev/null 2>&1 && tmp_c="$(cygpath -m "$tmp")"

log() { echo "[test] $*"; }
echec() { echo "[test] ÉCHEC : $*" >&2; exit 1; }

dc() { docker compose -p "$PROJET" --env-file "$tmp_c/test.env" -f "$tmp_c/compose.yml" "$@"; }
nettoyer() {
  log "nettoyage"
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap nettoyer EXIT

mkdir -p "$tmp/backups"
echo "POSTGRES_PASSWORD=test_owner_pw" > "$tmp/test.env"
cat > "$tmp/compose.yml" <<YML
name: $PROJET
services:
  postgres:
    image: postgres:16-alpine
    container_name: mp-sauvegarde-test
    command: ["postgres", "-c", "max_locks_per_transaction=256"]
    environment:
      POSTGRES_USER: missionpilot_owner
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: missionpilot_src
    ports:
      - "127.0.0.1:$PORT:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U missionpilot_owner -d missionpilot_src"]
      interval: 2s
      timeout: 3s
      retries: 30
volumes:
  pgdata:
YML

log "démarrage du PostgreSQL jetable (127.0.0.1:$PORT)"
dc up -d --wait postgres >/dev/null

log "migrations du dépôt"
(
  cd "$racine"
  DATABASE_OWNER_URL="postgres://missionpilot_owner:test_owner_pw@127.0.0.1:$PORT/missionpilot_src" \
  DATABASE_URL="postgres://missionpilot_app:test_app_pw@127.0.0.1:$PORT/missionpilot_src" \
    pnpm --filter @missionpilot/api db:migrate | tail -c 300
)

psql_src() { dc exec -T postgres psql -U missionpilot_owner -d "$1" -tA -c "$2"; }
cpt_tables() { psql_src "$1" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" | tr -d '\r'; }
cpt_migr() { psql_src "$1" "SELECT count(*) FROM schema_migrations" | tr -d '\r'; }
src_tables="$(cpt_tables missionpilot_src)"; src_migr="$(cpt_migr missionpilot_src)"
log "source : tables=$src_tables migrations=$src_migr"
[ "$src_tables" -gt 0 ] && [ "$src_migr" -gt 0 ] || echec "source vide"

export COMPOSE_FILE="$tmp_c/compose.yml" ENV_FILE="$tmp_c/test.env" COMPOSE_PROJECT="$PROJET" \
  SERVICE=postgres DB_NAME=missionpilot_src DB_USER=missionpilot_owner BACKUP_DIR="$tmp_c/backups" KEEP_DAYS=7

log "fichiers de rotation : 2 anciens (8 j), 1 récent (3 j), 1 au nom différent (30 j)"
cd "$tmp/backups"
: > missionpilot-20200101-000000.dump; : > missionpilot-20200102-000000.dump
: > missionpilot-recent.dump; : > autre-fichier-ancien.txt
touch -d '8 days ago' missionpilot-20200101-000000.dump missionpilot-20200102-000000.dump
touch -d '3 days ago' missionpilot-recent.dump
touch -d '30 days ago' autre-fichier-ancien.txt

log "sauvegarde"
bash "$racine/deploy/sauvegarde.sh"

[ ! -e missionpilot-20200101-000000.dump ] && [ ! -e missionpilot-20200102-000000.dump ] || echec "ancien dump non supprimé"
[ -e missionpilot-recent.dump ] || echec "dump de 3 jours supprimé à tort"
[ -e autre-fichier-ancien.txt ] || echec "fichier au nom différent supprimé"
nouveau="$(ls missionpilot-2???????-??????.dump | tail -1)"
[ -s "$nouveau" ] || echec "nouveau dump absent ou vide"
[ "$(stat -c %a "$nouveau")" = "600" ] || log "avertissement : droits $(stat -c %a "$nouveau") (attendu 600 ; non fiable sous Windows)"
ls *.partial >/dev/null 2>&1 && echec "fichier .partial résiduel"
log "rotation OK (2 supprimés, récent et autre conservés)"
cd "$racine"

log "refus de la base de production"
if bash deploy/restauration.sh "$tmp_c/backups/$nouveau" missionpilot_src >/dev/null 2>&1; then
  echec "la restauration vers une base existante aurait dû être refusée"
fi

if bash deploy/restauration.sh "$tmp_c/backups/$nouveau" missionpilot >/dev/null 2>&1; then echec "la base missionpilot aurait dû être refusée"; fi

log "restauration vers une base jetable"
bash deploy/restauration.sh "$tmp_c/backups/$nouveau" missionpilot_restore
r_tables="$(cpt_tables missionpilot_restore)"; r_migr="$(cpt_migr missionpilot_restore)"
log "restaurée : tables=$r_tables migrations=$r_migr"
[ "$r_tables" = "$src_tables" ] && [ "$r_migr" = "$src_migr" ] || echec "écart source/restauration"

log "RÉSULTAT : OK (tables $src_tables = $r_tables, migrations $src_migr = $r_migr)"
