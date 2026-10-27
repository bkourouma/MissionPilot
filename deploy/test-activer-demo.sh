#!/usr/bin/env bash
# Test de deploy/activer-demo.sh avec de FAUX docker, curl, flock (aucun vrai docker, aucun réseau, aucun serveur).
# Rejouable ; tout se passe dans un dossier temporaire supprimé en sortie.
#
#   bash deploy/test-activer-demo.sh
#
# Scénarios : dry-run sans écriture, mode non choisi, cabinet non démo (3), sortie psql non numérique, migrations
# absentes, seeds absents de l'image, clé IA, SMTP absent / réel / --smtp-ok, échec du semis (environnement restauré
# et API relancée), stdout fermé (SIGPIPE), verrou occupé, relance idempotente, --si-necessaire, --arriere-plan.
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/activer-demo.sh"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
ok=0 ko=0

# --- faux outils -------------------------------------------------------------------------------------------
mkdir -p "$tmp/bin"
cat > "$tmp/bin/docker" <<'E'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$*" in
  *"to_regproc"*) echo "${FAKE_MIGRATIONS:-t}" ;;
  *"psql"*"FROM cabinets ORDER"*) cat "$FAKE_CABINETS" ;;
  *"psql"*"FROM cabinets WHERE NOT"*) echo "${FAKE_REELS:-0}" ;;
  *"psql"*"FROM super_admins"*) echo "${FAKE_ADMINS:-0}" ;;
  *"pg_dump"*) echo "PGDMP-fake" ;;
  *"pg_restore --list"*) printf '; entete\n1; table x\n' ;;
  *"--no-deps"*) [ -z "${FAKE_NOSEED:-}" ] || exit 1 ;;
  *"seed-tenant-demo.ts"*) [ -z "${FAKE_SEED_FAIL:-}" ] || exit 9 ;;
esac
exit 0
E
cat > "$tmp/bin/curl" <<'E'
#!/usr/bin/env bash
echo "curl $*" >> "$FAKE_LOG"
case "$*" in
  *auth/demo*) echo '{"superAdmin":{"email":"s@x"},"cabinets":[{"id":"1","nom":"Lagune Conseil (démo)","comptes":[{"email":"a@x"},{"email":"b@x"}]},{"id":"2","nom":"Tenant démo","comptes":[{"email":"c@x"}]}]}' ;;
esac
exit 0
E
cat > "$tmp/bin/flock" <<'E'
#!/usr/bin/env bash
[ -z "${FAKE_FLOCK_BUSY:-}" ]
E
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH"

# --- outils de test ----------------------------------------------------------------------------------------
n=0
monter() { # sandbox neuf ; variables d'environnement pour le script
  n=$((n + 1)); S="$tmp/s$n"; mkdir -p "$S/home/missionpilot"
  printf 'POSTGRES_PASSWORD=x\nSMTP_HOST=smtp.invalid\n' > "$S/home/missionpilot.env"; chmod 600 "$S/home/missionpilot.env"
  echo "ghcr.io/x/y:abc" > "$S/home/missionpilot.last-good"
  : > "$S/home/missionpilot/docker-compose.prod.yml"
  echo "Lagune | est_demo=true | actif=true" > "$S/cab.txt"
  : > "$S/calls.log"
  export HOME_DIR="$S/home" FAKE_LOG="$S/calls.log" FAKE_CABINETS="$S/cab.txt" MIN_DISK_GO=0 ATTENTE_SANTE=1
  unset FAKE_REELS FAKE_ADMINS FAKE_MIGRATIONS FAKE_NOSEED FAKE_SEED_FAIL FAKE_FLOCK_BUSY OPENROUTER_API_KEY
}
lancer() { sortie="$(bash "$script" "$@" 2>&1)"; code=$?; }
verifier() { # verifier "nom" commande...
  local nom="$1"; shift
  if "$@"; then ok=$((ok + 1)); echo "  ok   $nom"; else ko=$((ko + 1)); echo "  ECHEC $nom"; fi
}
code_est() { [ "$code" = "$1" ]; }
pas_appel() { ! grep -q -- "$1" "$FAKE_LOG"; }
appel() { grep -q -- "$1" "$FAKE_LOG"; }
ligne_de() { grep -n -- "$1" "$FAKE_LOG" | head -n1 | cut -d: -f1; }
apres() { local a b; a="$(ligne_de "$1")"; b="$(grep -n -- "$2" "$FAKE_LOG" | tail -n1 | cut -d: -f1)"; [ -n "$a" ] && [ -n "$b" ] && [ "$b" -gt "$a" ]; }
nb_demo() { grep -c '^DEMO_PUBLIQUE=oui$' "$S/home/missionpilot.env" || true; }

echo "[test] dry-run : aucune écriture"
monter; avant="$(cksum < "$S/home/missionpilot.env")"
lancer --dry-run
verifier "code 0" code_est 0
verifier "environnement inchangé" test "$avant" = "$(cksum < "$S/home/missionpilot.env")"
verifier "pas de copie .avant-demo" test ! -e "$S/home/missionpilot.env.avant-demo"
verifier "pas de sauvegarde" test ! -d "$S/home/backups"
verifier "pas d'arrêt de l'API" pas_appel " stop api"
verifier "pas de recréation" pas_appel "up -d"
verifier "pas de semis" pas_appel "tsx"
verifier "pas de pg_dump" pas_appel "pg_dump"
verifier "message final" grep -q "rien n'a été modifié" <<< "$sortie"

echo "[test] mode non choisi"
monter; lancer
verifier "code 2" code_est 2
verifier "aucun appel docker" test ! -s "$FAKE_LOG"

echo "[test] garde-fou et validations"
monter; export FAKE_REELS=1; lancer --premier-plan
verifier "cabinet non démo : code 3" code_est 3
verifier "API jamais arrêtée" pas_appel " stop api"
monter; export FAKE_ADMINS=2; lancer --premier-plan
verifier "2 super admins réels : code 3" code_est 3
monter; export FAKE_REELS=1; lancer --premier-plan --forcer-donnees-existantes
verifier "--forcer-donnees-existantes : code 0" code_est 0
monter; export FAKE_REELS="ERREUR: relation absente"; lancer --premier-plan
verifier "sortie psql non numérique : échec" code_est 1
verifier "message explicite" grep -q "inattendue" <<< "$sortie"
verifier "API jamais arrêtée" pas_appel " stop api"
monter; export FAKE_MIGRATIONS=f; lancer --premier-plan
verifier "migrations absentes : échec" code_est 1
monter; export FAKE_NOSEED=1; lancer --premier-plan
verifier "seeds absents de l'image : échec" code_est 1
verifier "API jamais arrêtée" pas_appel " stop api"
monter; export OPENROUTER_API_KEY=cle-factice; lancer --premier-plan
verifier "clé IA (environnement du processus) : code 1" code_est 1
monter; echo "OPENROUTER_API_KEY=cle-factice" >> "$S/home/missionpilot.env"; lancer --premier-plan
verifier "clé IA (missionpilot.env) : code 1" code_est 1
verifier "valeur jamais affichée" bash -c '! grep -q cle-factice <<< "$1"' _ "$sortie"
monter; printf 'POSTGRES_PASSWORD=x\n' > "$S/home/missionpilot.env"; lancer --premier-plan
verifier "SMTP absent : code 1" code_est 1
monter; printf 'SMTP_HOST=smtp.exemple.org\n' > "$S/home/missionpilot.env"; lancer --premier-plan
verifier "SMTP réel : code 1" code_est 1
monter; printf 'SMTP_HOST=smtp.exemple.org\n' > "$S/home/missionpilot.env"; lancer --premier-plan --smtp-ok
verifier "SMTP réel + --smtp-ok : code 0" code_est 0

echo "[test] exécution réelle (faux outils) et ordre des étapes"
monter; lancer --premier-plan
verifier "code 0" code_est 0
verifier "sauvegarde faite (fichier non vide)" bash -c 'ls "$1"/home/backups/missionpilot/*.dump >/dev/null 2>&1' _ "$S"
verifier "DEMO_PUBLIQUE posée une fois" test "$(nb_demo)" = 1
verifier "copie .avant-demo sans DEMO_PUBLIQUE" bash -c '! grep -q DEMO_PUBLIQUE "$1"' _ "$S/home/missionpilot.env.avant-demo"
verifier "ordre : pg_dump avant stop" apres "pg_dump" " stop api"
verifier "ordre : stop avant seed-defaut" apres " stop api" "seed-defaut.ts --confirmer-demo"
verifier "ordre : seed-defaut avant seed-tenant" apres "seed-defaut.ts --confirmer-demo" "seed-tenant-demo.ts --confirmer-demo"
verifier "ordre : seed-tenant avant recréation" apres "seed-tenant-demo.ts --confirmer-demo" "up -d --force-recreate api web"
first_env="$(cksum < "$S/home/missionpilot.env.avant-demo")"
lancer --premier-plan
verifier "relance idempotente : code 0" code_est 0
verifier "relance : toujours une seule ligne DEMO_PUBLIQUE" test "$(nb_demo)" = 1
verifier "relance : .avant-demo inchangée" test "$first_env" = "$(cksum < "$S/home/missionpilot.env.avant-demo")"

echo "[test] échec du semis : environnement restauré, API relancée"
monter; export FAKE_SEED_FAIL=1; lancer --premier-plan
verifier "code non nul" test "$code" -ne 0
verifier "DEMO_PUBLIQUE retirée" test "$(nb_demo)" = 0
verifier "environnement identique à l'original" test "$(cksum < "$S/home/missionpilot.env")" = "$(cksum < "$S/home/missionpilot.env.avant-demo")"
verifier "API et web recréés après l'échec" apres "seed-tenant-demo.ts --confirmer-demo" "up -d --force-recreate api web"
verifier "renvoi vers DEPLOIEMENT.md" grep -q "DEPLOIEMENT.md" <<< "$sortie"

echo "[test] stdout fermé (déconnexion SSH simulée)"
monter
bash "$script" --premier-plan 2>&1 | head -n 1 > /dev/null
code=${PIPESTATUS[0]}
verifier "code 0 malgré le tube fermé" code_est 0
verifier "semis terminé puis API recréée" apres "seed-tenant-demo.ts --confirmer-demo" "up -d --force-recreate api web"
monter; export FAKE_SEED_FAIL=1
bash "$script" --premier-plan 2>&1 | head -n 1 > /dev/null
code=${PIPESTATUS[0]}
verifier "tube fermé + semis en échec : API relancée" apres " stop api" "up -d --force-recreate api web"
verifier "tube fermé + semis en échec : environnement restauré" test "$(nb_demo)" = 0
monter
bash "$script" --premier-plan >&- 2>&-
code=$?
verifier "stdout/stderr fermés : code 0 et API recréée" bash -c '[ "$1" = 0 ] && grep -q "up -d --force-recreate api web" "$2"' _ "$code" "$FAKE_LOG"

echo "[test] verrou occupé"
monter; export FAKE_FLOCK_BUSY=1; lancer --premier-plan
verifier "code 1" code_est 1
verifier "API jamais arrêtée" pas_appel " stop api"
verifier "message" grep -q "autre semis" <<< "$sortie"

echo "[test] --si-necessaire"
monter; lancer --premier-plan --si-necessaire
verifier "code 0" code_est 0
verifier "rien à faire : pas d'arrêt" pas_appel " stop api"
verifier "rien à faire : pas de sauvegarde" test ! -d "$S/home/backups"

echo "[test] --arriere-plan"
monter; lancer --arriere-plan
verifier "le parent rend la main (code 0)" code_est 0
for _ in $(seq 1 60); do grep -q "TERMINE\|ECHEC" "$S/home/activer-demo.log" 2> /dev/null && break; sleep 0.5; done
verifier "journal : TERMINE" grep -q "TERMINE" "$S/home/activer-demo.log"
verifier "copie temporaire supprimée" bash -c '! ls "$1"/home/.activer-demo.* >/dev/null 2>&1' _ "$S"
verifier "DEMO_PUBLIQUE posée" test "$(nb_demo)" = 1

echo
echo "[test] $ok réussi(s), $ko échec(s)"
[ "$ko" = 0 ]
