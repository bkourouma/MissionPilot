#!/usr/bin/env bash
# Active la connexion « un clic » (démonstration publique) sur le serveur de STAGING/DÉMONSTRATION.
# Exécuté SUR le serveur, lu depuis l'entrée standard depuis le poste de travail :
#
#   ssh alliance 'bash -s -- --dry-run' < deploy/activer-demo.sh          # à blanc : rien n'est modifié
#   ssh alliance 'bash -s -- --arriere-plan' < deploy/activer-demo.sh     # réel (obligatoire : survit à la déconnexion)
#   ssh alliance 'tail -f /home/deployer/activer-demo.log'                # suivre l'avancement (10 à 14 minutes)
#
# (« alliance » = alias SSH du poste de travail ; forme explicite : ssh -p 2222 deployer@147.93.44.169.)
#
# Idempotent : on peut le relancer (voir --si-necessaire : sans lui, un nouveau semis coupe le site 10 à 14 minutes).
# NE PAS l'utiliser sur une vraie production : avec DEMO_PUBLIQUE=oui, tout visiteur ouvre sans mot de passe la
# session de n'importe quel compte de démonstration (docs/workflows/DEPLOIEMENT.md, section (f) ; SECURITY.md §3, §15).
#
# Étapes (journal horodaté, arrêt au premier échec) :
#   1. contrôles préalables : environnement, image, clé IA absente, SMTP_HOST=smtp.invalid, disque, seeds dans l'image ;
#   2. garde-fou « aucune donnée réelle » (sortie 3 si un cabinet ou un super admin réel existe) ;
#   3. sauvegarde de la base (sauvegarde.sh fait aussi une ROTATION : il supprime les dumps de plus de 7 jours) ;
#   4. DEMO_PUBLIQUE=oui ajoutée à missionpilot.env (copie missionpilot.env.avant-demo) ;
#   5. semis (API arrêtée) : seed-defaut puis seed-tenant-demo. Si un semis échoue, l'environnement est RESTAURÉ
#      (DEMO_PUBLIQUE retirée) puis l'API et le web sont relancés ;
#   6. recréation api + web, santé locale, GET /api/auth/demo en local puis en public, récapitulatif.
#
# Limite : le trap de reprise ne couvre ni SIGKILL ni l'arrêt brutal du serveur. En cas de doute, sur le serveur :
#   cd /home/deployer/missionpilot && docker compose --env-file /home/deployer/missionpilot.env \
#     -f docker-compose.prod.yml up -d --force-recreate api web
#
# Codes de sortie : 0 succès ; 1 échec ; 2 option inconnue ou mode non choisi ; 3 donnée réelle détectée.
# Ce script ne contient aucun secret, n'affiche jamais missionpilot.env ni une URL de connexion à la base,
# n'envoie rien ailleurs que vers le serveur lui-même et ne supprime ni volume ni base.
#
# Variables surchargeables (tests) : HOME_DIR, DEPLOY_DIR, ENV_FILE, COMPOSE_FILE, LAST_GOOD, BACKUP_DIR, LOG_FILE,
# LOCK_FILE, URL_PUBLIQUE, SANTE_LOCALE, DB_SERVICE, DB_NAME, DB_USER, MIN_DISK_GO, ATTENTE_SANTE, SEMIS_TIMEOUT.
set -euo pipefail
# Une déconnexion SSH en premier plan ne doit pas tuer le script (SIGPIPE) entre « stop api » et la reprise.
trap '' PIPE

# --- configuration ------------------------------------------------------------------------------------------
configurer() {
  HOME_DIR="${HOME_DIR:-/home/deployer}"
  DEPLOY_DIR="${DEPLOY_DIR:-$HOME_DIR/missionpilot}"
  ENV_FILE="${ENV_FILE:-$HOME_DIR/missionpilot.env}"
  COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
  LAST_GOOD="${LAST_GOOD:-$HOME_DIR/missionpilot.last-good}"
  BACKUP_DIR="${BACKUP_DIR:-$HOME_DIR/backups/missionpilot}"
  LOG_FILE="${LOG_FILE:-$HOME_DIR/activer-demo.log}"
  LOCK_FILE="${LOCK_FILE:-$HOME_DIR/activer-demo.lock}"
  URL_PUBLIQUE="${URL_PUBLIQUE:-https://cabinetpilot.allianceconsultants.net}"
  SANTE_LOCALE="${SANTE_LOCALE:-http://127.0.0.1:3050}"
  DB_SERVICE="${DB_SERVICE:-postgres}"
  DB_NAME="${DB_NAME:-missionpilot}"
  DB_USER="${DB_USER:-missionpilot_owner}"
  MIN_DISK_GO="${MIN_DISK_GO:-5}"
  ATTENTE_SANTE="${ATTENTE_SANTE:-40}" # nombre d'essais de 3 s
  SEMIS_TIMEOUT="${SEMIS_TIMEOUT:-45m}"
  DRY_RUN=0 SMTP_OK=0 FORCER=0 ARRIERE_PLAN=0 PREMIER_PLAN=0 SI_NECESSAIRE=0 ENFANT=0
  API_ARRETEE=0 DEMO_POSEE=0 NOMBRE="" LISTE_DEMO=""
}

# --- utilitaires --------------------------------------------------------------------------------------------
# log tolère une sortie fermée (déconnexion SSH) : le journal ne doit jamais interrompre l'opération.
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" 2> /dev/null || true; }
echec() { log "ECHEC : $*"; exit 1; }

aide() {
  cat <<'FIN'
Usage : bash activer-demo.sh [options]   (ou : ssh alliance 'bash -s -- [options]' < deploy/activer-demo.sh)

  --arriere-plan                 relance le script avec setsid nohup (journal : activer-demo.log) et rend la main
                                 (OBLIGATOIRE pour un run réel, sauf --premier-plan)
  --premier-plan                 run réel dans ce terminal (déconseillé : une coupure SSH peut laisser le site arrêté)
  --dry-run                      n'écrit rien et n'exécute aucune commande docker mutante ; affiche le plan
  --si-necessaire                ne fait rien si GET /api/auth/demo liste déjà « Lagune » et « Tenant démo »
  --smtp-ok                      accepte un SMTP_HOST réel (sinon il doit valoir smtp.invalid ; absent = échec)
  --forcer-donnees-existantes    passe outre le garde-fou « aucune donnée réelle » (cabinet ou super admin réel)
  --aide                         cet écran

Codes de sortie : 0 succès ; 1 échec ; 2 option inconnue ou mode non choisi ; 3 donnée réelle détectée.
Voir docs/workflows/DEPLOIEMENT.md, section (f).
FIN
}

lire_options() {
  local a
  for a in "$@"; do
    case "$a" in
      --dry-run) DRY_RUN=1 ;;
      --smtp-ok) SMTP_OK=1 ;;
      --forcer-donnees-existantes) FORCER=1 ;;
      --arriere-plan) ARRIERE_PLAN=1 ;;
      --premier-plan) PREMIER_PLAN=1 ;;
      --si-necessaire) SI_NECESSAIRE=1 ;;
      --enfant-interne) ENFANT=1 ;; # posé par la relance en arrière-plan
      --aide | -h | --help) aide; exit 0 ;;
      *) echo "Option inconnue : $a" >&2; aide >&2; exit 2 ;;
    esac
  done
}

# Commande docker compose : dcs laisse l'entrée standard libre, dc la coupe (évite de manger le script lu par bash -s).
dcs() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
dc() { dcs "$@" < /dev/null; }
mutant() {
  if [ "$DRY_RUN" = 1 ]; then log "[dry-run] ne lance pas : $*"; return 0; fi
  "$@"
}

# Valeur d'une variable de missionpilot.env (dernière occurrence, guillemets retirés). Jamais affichée par ce script.
lire_var() {
  awk -v nom="$1" -v q="'" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" nom "=" {
      v = substr($0, index($0, "=") + 1); gsub("^[[:space:]]+|[[:space:]]+$", "", v); gsub("[\"" q "]", "", v); r = v; t = 1
    }
    END { if (t) print r }' "$ENV_FILE"
}
var_presente() { awk -v nom="$1" '$0 ~ "^[[:space:]]*(export[[:space:]]+)?" nom "="{f=1} END{exit !f}' "$ENV_FILE"; }

# --- 1. contrôles préalables --------------------------------------------------------------------------------
controles_prealables() {
  log "1/6 contrôles préalables"
  [ -f "$ENV_FILE" ] || echec "fichier d'environnement absent : $ENV_FILE"
  [ -d "$DEPLOY_DIR" ] || echec "dossier de déploiement absent : $DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  [ -f "$COMPOSE_FILE" ] || echec "compose absent : $DEPLOY_DIR/$COMPOSE_FILE"
  [ -f "$LAST_GOOD" ] || echec "image courante inconnue (fichier absent : $LAST_GOOD) ; lancer d'abord un déploiement"
  MP_IMAGE="$(head -n 1 "$LAST_GOOD" | tr -d '[:space:]')"
  [[ "$MP_IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] || echec "contenu invalide dans $LAST_GOOD"
  export MP_IMAGE
  log "    image : $MP_IMAGE"

  # Le semis refuse de tourner avec une clé IA : on refuse avant, sans rien arrêter.
  if [ -n "${OPENROUTER_API_KEY:-}" ] || [ -n "$(lire_var OPENROUTER_API_KEY)" ]; then
    echec "OPENROUTER_API_KEY est définie (environnement ou missionpilot.env) : le semis la refuse. La retirer (valeur non affichée) et ne pas la remettre tant que DEMO_PUBLIQUE=oui."
  fi
  verifier_smtp
  verifier_disque
  command -v curl > /dev/null || echec "curl absent"
  dc config -q || echec "compose invalide"
  verifier_seeds_dans_image
  log "    contrôles préalables OK"
}

# L'API refuse de démarrer sans SMTP_HOST hors développement : absent ou vide = échec ; seul smtp.invalid (muet) passe.
verifier_smtp() {
  local hote
  hote="$(lire_var SMTP_HOST)"
  if [ -z "$hote" ]; then
    echec "SMTP_HOST absent ou vide : l'API refuserait de démarrer. Y mettre smtp.invalid (e-mails muets) dans missionpilot.env."
  elif [ "$hote" = "smtp.invalid" ]; then
    log "    SMTP muet (smtp.invalid)"
  elif [ "$SMTP_OK" = 1 ]; then
    log "    AVERTISSEMENT : SMTP_HOST réel, accepté par --smtp-ok (des e-mails de visiteurs pourraient partir)"
  else
    echec "SMTP_HOST n'est pas smtp.invalid : refus (des e-mails de visiteurs partiraient). Le passer à smtp.invalid, ou --smtp-ok."
  fi
}

verifier_disque() {
  local libre_ko
  libre_ko="$(df -Pk "$HOME_DIR" | awk 'NR==2 {print $4}')"
  [[ "$libre_ko" =~ ^[0-9]+$ ]] || echec "espace disque illisible"
  if [ "$libre_ko" -lt $((MIN_DISK_GO * 1024 * 1024)) ]; then
    echec "espace disque insuffisant : $((libre_ko / 1024 / 1024)) Go libres, $MIN_DISK_GO Go requis"
  fi
  log "    disque : $((libre_ko / 1024 / 1024)) Go libres"
}

# Pré-vol AVANT tout arrêt : l'image courante doit contenir les deux scripts de semis (working_dir /app/apps/api).
verifier_seeds_dans_image() {
  dc run --rm --no-deps -T api test -f src/db/seed-defaut.ts -a -f src/db/seed-tenant-demo.ts \
    || echec "l'image $MP_IMAGE ne contient pas src/db/seed-defaut.ts et seed-tenant-demo.ts : déployer une version qui les inclut"
  log "    seeds présents dans l'image"
}

# --- 2. garde-fou « aucune donnée réelle » -----------------------------------------------------------------
sql() {
  dc exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -X -At -F ' | ' -c "$1"
}

# Requête de comptage ; le résultat va dans NOMBRE. Un entier est exigé : jamais de « fail open » sur une sortie inattendue.
compter() {
  NOMBRE="$(sql "$1")" || echec "requête en échec (PostgreSQL injoignable, ou migrations 0570/0571 absentes ?)"
  [[ "$NOMBRE" =~ ^[0-9]+$ ]] || echec "réponse PostgreSQL inattendue (attendu un entier)"
}

verifier_migrations() {
  local ok
  ok="$(sql "SELECT (to_regproc('demo_lister_comptes') IS NOT NULL AND to_regclass('super_admins') IS NOT NULL)")" \
    || echec "PostgreSQL injoignable (service $DB_SERVICE démarré ? voir mp ps)"
  [ "$ok" = "t" ] || echec "migrations absentes (demo_lister_comptes ou super_admins, migrations 0570-0583) : déployer d'abord une version qui les applique"
}

garde_donnees_reelles() {
  log "2/6 garde-fou : aucune donnée réelle"
  verifier_migrations
  local cabinets reels admins
  cabinets="$(sql "SELECT nom, 'est_demo=' || est_demo, 'actif=' || actif FROM cabinets ORDER BY nom")" \
    || echec "requête cabinets en échec"
  if [ -z "$cabinets" ]; then log "    aucun cabinet (base neuve)"; else
    log "    cabinets existants (nom | est_demo | actif) :"
    { echo "$cabinets" | sed 's/^/      /'; } 2> /dev/null || true
  fi
  compter "SELECT count(*) FROM cabinets WHERE NOT est_demo"; reels="$NOMBRE"
  compter "SELECT count(*) FROM super_admins WHERE NOT est_demo"; admins="$NOMBRE"
  log "    cabinets réels : $reels ; super admins non démo : $admins"
  if [ "$reels" -gt 0 ] || [ "$admins" -gt 1 ]; then
    if [ "$FORCER" = 1 ]; then
      log "    AVERTISSEMENT : données existantes, passées outre par --forcer-donnees-existantes"
    else
      log "REFUS : le serveur contient des données non démo (cabinet réel ou plus d'un super admin réel)."
      log "        Activer la démonstration publique ici exposerait ces données. --forcer-donnees-existantes pour passer outre."
      exit 3
    fi
  fi
}

# --- 3. sauvegarde ------------------------------------------------------------------------------------------
sauvegarder() {
  log "3/6 sauvegarde de la base"
  if [ "$DRY_RUN" = 1 ]; then log "[dry-run] sauvegarde vers $BACKUP_DIR (non exécutée)"; return 0; fi
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  local fichier n
  if [ -f "$DEPLOY_DIR/sauvegarde.sh" ]; then
    log "    via sauvegarde.sh (fait aussi sa rotation : dumps de plus de 7 jours supprimés)"
    ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" BACKUP_DIR="$BACKUP_DIR" bash "$DEPLOY_DIR/sauvegarde.sh" < /dev/null \
      || echec "sauvegarde.sh en échec"
    fichier="$(ls -t "$BACKUP_DIR"/missionpilot-*.dump 2> /dev/null | head -n 1 || true)"
  else
    log "    sauvegarde.sh absent : pg_dump -Fc équivalent"
    fichier="$BACKUP_DIR/missionpilot-avant-demo-$(date '+%Y%m%d-%H%M%S').dump"
    if ! dc exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$fichier.partial"; then
      rm -f "$fichier.partial"; echec "pg_dump en échec"
    fi
    [ -s "$fichier.partial" ] || { rm -f "$fichier.partial"; echec "pg_dump a produit un fichier vide"; }
    n="$(dcs exec -T "$DB_SERVICE" pg_restore --list < "$fichier.partial" | grep -vc '^;')" \
      || { rm -f "$fichier.partial"; echec "dump illisible par pg_restore --list"; }
    [ "$n" -gt 0 ] || { rm -f "$fichier.partial"; echec "dump sans contenu"; }
    mv "$fichier.partial" "$fichier"
  fi
  [ -n "$fichier" ] && [ -s "$fichier" ] || echec "sauvegarde introuvable ou vide"
  chmod 600 "$fichier"
  log "    sauvegarde OK : $fichier ($(wc -c < "$fichier") octets)"
}

# --- 4. DEMO_PUBLIQUE ---------------------------------------------------------------------------------------
poser_demo_publique() {
  log "4/6 DEMO_PUBLIQUE=oui dans l'environnement"
  if var_presente DEMO_PUBLIQUE; then
    [ "$(lire_var DEMO_PUBLIQUE)" = "oui" ] || echec "DEMO_PUBLIQUE existe avec une autre valeur : la corriger à la main (valeurs non affichées)"
    log "    déjà posée, rien à faire"
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then log "[dry-run] ajouterait DEMO_PUBLIQUE=oui en fin de $ENV_FILE (copie .avant-demo)"; return 0; fi
  if [ ! -e "$ENV_FILE.avant-demo" ]; then
    install -m 600 "$ENV_FILE" "$ENV_FILE.avant-demo"
    log "    copie de sécurité : $ENV_FILE.avant-demo (mode 600)"
  fi
  DEMO_POSEE=1
  [ -z "$(tail -c 1 "$ENV_FILE")" ] || printf '\n' >> "$ENV_FILE" # fin de ligne manquante
  printf 'DEMO_PUBLIQUE=oui\n' >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "    ligne ajoutée (mode 600 conservé)"
}

# --- 5. semis -----------------------------------------------------------------------------------------------
# Reprise, quoi qu'il arrive (échec, signal, sortie normale) : si CETTE exécution a posé DEMO_PUBLIQUE et que le
# semis n'est pas terminé, on restaure l'environnement AVANT de relancer l'API, pour ne pas exposer un Tenant démo
# à moitié construit. Puis l'API et le web sont recréés ensemble.
reprise() {
  local code=$?
  trap - EXIT
  if [ "$DEMO_POSEE" = 1 ] && [ "$code" -ne 0 ] && [ -f "$ENV_FILE.avant-demo" ]; then
    if cat "$ENV_FILE.avant-demo" > "$ENV_FILE"; then
      log "reprise : environnement restauré (DEMO_PUBLIQUE retirée). Base peut-être partiellement semée : voir DEPLOIEMENT.md (d) et (e)."
    else
      log "ECHEC de la restauration de l'environnement : retirer DEMO_PUBLIQUE à la main (copie : $ENV_FILE.avant-demo)"
    fi
  fi
  if [ "$API_ARRETEE" = 1 ]; then
    log "reprise : redémarrage de l'API et du web"
    dc up -d --force-recreate api web || log "ECHEC du redémarrage : lancer à la main : mp up -d --force-recreate api web"
    API_ARRETEE=0
  fi
  exit "$code"
}

lancer_semis() {
  # timeout lance un programme externe : on utilise donc docker compose directement (entrée standard coupée).
  mutant timeout "$SEMIS_TIMEOUT" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    run --rm -T api node_modules/.bin/tsx "$1" --confirmer-demo < /dev/null
}

semer() {
  log "5/6 semis (API arrêtée ; 10 à 14 minutes ; /connexion indisponible pendant ce temps)"
  [ "$DRY_RUN" = 1 ] || API_ARRETEE=1
  mutant dc stop api
  log "    seed-defaut (Lagune Conseil & Associés (démo), super admin de démonstration)"
  lancer_semis src/db/seed-defaut.ts
  log "    seed-tenant-demo (Tenant démo)"
  lancer_semis src/db/seed-tenant-demo.ts
  DEMO_POSEE=0 # semis complet : plus de restauration, même si l'étape 6 échoue
  log "    semis terminé"
}

# --- 6. redémarrage et vérifications ------------------------------------------------------------------------
attendre_sante() {
  local i
  for i in $(seq 1 "$ATTENTE_SANTE"); do
    if curl -fsS --max-time 5 "$SANTE_LOCALE/api/sante" > /dev/null 2>&1 \
      && curl -fsS --max-time 5 -o /dev/null "$SANTE_LOCALE/connexion" 2> /dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# Compte les comptes listés par cabinet à partir du JSON de GET /api/auth/demo (python3 si présent).
resumer_demo() {
  local json="$1"
  if python3 -c "import sys" > /dev/null 2>&1; then
    printf '%s' "$json" | PYTHONIOENCODING=utf-8 python3 -c '
import json, sys
d = json.load(sys.stdin)
cabs = d.get("cabinets", d) if isinstance(d, dict) else d
print("    %d cabinet(s) listé(s)" % len(cabs))
for c in cabs:
    print("      - %s : %d compte(s)" % (c.get("nom"), len(c.get("comptes", []))))
print("    super admin de démonstration : %s" % ("oui" if d.get("superAdmin") else "non indiqué"))
'
  else
    log "    python3 absent : décompte global seulement ($(grep -o '"email"' <<< "$json" | wc -l) e-mail(s) dans la réponse)"
  fi
}

# GET /api/auth/demo sur une base d'URL : 200 et clé « cabinets » exigés ; « Tenant démo » absent = avertissement.
verifier_liste_demo() {
  local base="$1" etiquette="$2" json
  json="$(curl -fsS --max-time 20 "$base/api/auth/demo")" \
    || echec "GET /api/auth/demo ($etiquette) ne répond pas 200 (404 : DEMO_PUBLIQUE non lue ?)"
  grep -q '"cabinets"' <<< "$json" || echec "réponse inattendue de /api/auth/demo ($etiquette)"
  if grep -q 'Tenant démo' <<< "$json"; then
    log "    GET /api/auth/demo ($etiquette) : 200, « Tenant démo » listé"
  else
    log "    AVERTISSEMENT : « Tenant démo » absent de la liste ($etiquette) ; renommé par un visiteur ? Voir DEPLOIEMENT.md (d)."
  fi
  grep -q 'Lagune' <<< "$json" || log "    AVERTISSEMENT : « Lagune » absent de la liste ($etiquette)"
  LISTE_DEMO="$json"
}

redemarrer_et_verifier() {
  log "6/6 redémarrage et vérifications"
  mutant dc up -d --force-recreate api web
  API_ARRETEE=0
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] attendrait $SANTE_LOCALE/api/sante et /connexion, puis lirait /api/auth/demo en local et sur $URL_PUBLIQUE"
    return 0
  fi
  attendre_sante || { dc logs --tail 60 api web || true; echec "contrôle de santé local en échec (api/web non sains)"; }
  log "    santé locale OK"
  verifier_liste_demo "$SANTE_LOCALE" "local"
  resumer_demo "$LISTE_DEMO" || true # simple confort : le décompte n'est pas un critère de réussite
  verifier_liste_demo "$URL_PUBLIQUE" "public"
}

recapitulatif() {
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY-RUN terminé : rien n'a été modifié (aucune écriture, aucune commande docker mutante)."
    return 0
  fi
  log "TERMINE : démonstration publique active."
  log "    Connexion : $URL_PUBLIQUE/connexion (bloc « Mode démonstration » ; accès super admin sous le formulaire)"
  log "    SÉCURITÉ : mots de passe de démonstration PUBLICS (dépôt) et accès SANS mot de passe pour tout visiteur."
  log "    Serveur de staging/démonstration uniquement ; désactivation : DEPLOIEMENT.md (c). Journal : $LOG_FILE"
}

# --- relance en arrière-plan --------------------------------------------------------------------------------
# Lu depuis l'entrée standard (bash -s), le script n'a pas de fichier : on écrit une copie faite de ses fonctions.
# La copie se supprime elle-même dès son démarrage (rm -f "$0"), bash garde le fichier ouvert.
relancer_en_arriere_plan() {
  local copie arg args=(--enfant-interne) lanceur=(nohup)
  for arg in "$@"; do [ "$arg" = "--arriere-plan" ] || args+=("$arg"); done
  copie="$(mktemp "$HOME_DIR/.activer-demo.XXXXXX")"
  { echo '#!/usr/bin/env bash'; echo 'set -euo pipefail'; echo "trap '' PIPE"; declare -f
    echo 'rm -f -- "$0"'; echo 'principal "$@"'; } > "$copie"
  : >> "$LOG_FILE"
  chmod 600 "$LOG_FILE" "$copie"
  command -v setsid > /dev/null && lanceur=(setsid nohup)
  "${lanceur[@]}" bash "$copie" "${args[@]}" >> "$LOG_FILE" 2>&1 < /dev/null &
  log "relancé en arrière-plan (PID $!). Suivre : tail -f $LOG_FILE"
}

# Verrou contre un double lancement. « tester » : teste puis relâche (le parent) ; sinon garde le verrou (fd 9).
verrouiller() {
  [ "$DRY_RUN" = 1 ] && return 0
  command -v flock > /dev/null || { log "    flock absent : pas de verrou contre un double lancement"; return 0; }
  if [ "${1:-}" = "tester" ]; then
    ( exec 9> "$LOCK_FILE"; flock -n 9 ) || echec "un autre semis est en cours (verrou $LOCK_FILE)"
  else
    exec 9> "$LOCK_FILE"
    flock -n 9 || echec "un autre semis est en cours (verrou $LOCK_FILE)"
  fi
}

# Vrai si l'API locale liste déjà les deux cabinets de démonstration.
deja_active() {
  local json
  json="$(curl -fsS --max-time 10 "$SANTE_LOCALE/api/auth/demo" 2> /dev/null)" || return 1
  grep -q 'Lagune' <<< "$json" && grep -q 'Tenant démo' <<< "$json"
}

principal() {
  configurer
  lire_options "$@"
  umask 077
  if [ "$DRY_RUN" = 1 ]; then
    log "MODE DRY-RUN : aucune écriture, aucune commande docker mutante"
  elif [ "$ARRIERE_PLAN" = 0 ] && [ "$PREMIER_PLAN" = 0 ] && [ "$ENFANT" = 0 ]; then
    echo "Choisir le mode : --arriere-plan (recommandé, survit à la déconnexion SSH), --premier-plan (déconseillé) ou --dry-run." >&2
    exit 2
  elif [ "$PREMIER_PLAN" = 1 ]; then
    log "AVERTISSEMENT : premier plan. Une coupure SSH ou un SIGKILL pendant le semis peut laisser l'API arrêtée : mp up -d --force-recreate api web."
  fi
  if [ "$ARRIERE_PLAN" = 1 ] && [ "$DRY_RUN" = 0 ]; then
    verrouiller tester
    controles_prealables
    garde_donnees_reelles
    relancer_en_arriere_plan "$@"
    return 0
  fi
  verrouiller
  controles_prealables
  if [ "$SI_NECESSAIRE" = 1 ] && deja_active; then
    log "--si-necessaire : la démonstration liste déjà « Lagune » et « Tenant démo », rien à faire."
    return 0
  fi
  garde_donnees_reelles
  if [ "$DRY_RUN" = 0 ]; then trap reprise EXIT; trap 'exit 130' INT TERM HUP; fi
  sauvegarder
  poser_demo_publique
  semer
  redemarrer_et_verifier
  trap - EXIT
  recapitulatif
}

principal "$@"
