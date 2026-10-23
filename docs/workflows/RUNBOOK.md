# Runbook — MissionPilot

Lancer, configurer et dépanner le projet. En cas de désaccord avec
[AGENTS.md](../../AGENTS.md), AGENTS.md prime.

Mis à jour le 2026-10-23 (lot 9g : réveil du worker de jobs et débloqueur de rendu des lots 13a et 13b), après le 2026-10-22 (lot 9f : OCR local du lot 11, Node 22.13 minimum, mises à jour de sécurité du lot 12).

## Prérequis

| Outil          | Version attendue                       | Vérifié le 2026-10-06 |
| -------------- | -------------------------------------- | --------------------- |
| Node           | ≥ 22.13 (`engines` du `package.json` racine ; **requis en production** pour l'OCR : modèle de permissions) ; 22.16 ou plus pour la surveillance mémoire complète de l'import de PDF | 24.12.0               |
| pnpm           | 10 (`packageManager` : 10.26.2)        | 10.26.2               |
| Docker         | pour PostgreSQL (`docker-compose.yml`) | 29.1.3                |
| PostgreSQL     | 16, conteneur `missionpilot-postgres`  | image `postgres:16-alpine` |
| Git            | 2.x                                    | 2.52                  |
| Lefthook       | dépendance de développement du dépôt   | `node_modules/.bin/lefthook` présent |
| Chrome/Chromium | facultatif : rapports PDF (`CHROMIUM_PATH`) | Chrome sous Windows seulement (aucun essai sous Linux) |

Aucun fichier `.nvmrc` ni `.node-version` n'existe : la version se choisit à la
main (toute version ≥ 22.13 ; la CI tourne sur Node 22, dernière version mineure). Vérifier : `node -v`,
`pnpm -v`, `docker --version`. Les autres conteneurs
PostgreSQL de la machine sont à d'autres projets : n'y pas toucher.

## Installation

```bash
pnpm install                                   # dépendances ; lance aussi les hooks git (script prepare)
pnpm db:up                                     # PostgreSQL de développement (conteneur missionpilot-postgres)
pnpm db:migrate                                # migrations (rôle propriétaire) ; crée le rôle applicatif
pnpm --filter @missionpilot/api db:seed        # données de démonstration (développement et test seulement)
```

`pnpm db:up` ne fait que `docker compose up -d postgres` ; attendre l'état
« healthy » (`docker ps`) avant de migrer. Les migrations sont rejouables : seules
les migrations manquantes s'appliquent (table `schema_migrations`). Le seed est
idempotent et refuse de tourner si `NODE_ENV` n'est pas local.

### Fichiers d'environnement

Aucun fichier `.env` n'est nécessaire en développement : les valeurs par défaut
de `apps/api/src/config.ts` reprennent `.env.example`, et ne sont admises que
si `NODE_ENV` est absent, `development` ou `test` **et** que les deux URL de
base désignent `localhost`, `127.0.0.1` ou `::1`. Les agents ne lisent ni
n'écrivent les `.env` : leur création revient à l'utilisateur. Variables
(jamais leurs valeurs ici) :

| Variable                    | Rôle                                                                                   | Obligatoire hors développement |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `NODE_ENV`                  | `production` pour un serveur ; local sinon                                             | oui                            |
| `DATABASE_OWNER_URL`        | rôle propriétaire : migrations seulement                                               | oui                            |
| `DATABASE_URL`              | rôle applicatif `missionpilot_app` (sans BYPASSRLS), utilisé par l'API                 | oui                            |
| `API_PORT`                  | port de l'API (défaut 4100)                                                            | non                            |
| `WEB_PORT`                  | documenté dans `.env.example` ; le port du web est fixé à 3100 par les scripts du web  | non                            |
| `WEB_ORIGIN`                | origine autorisée par CORS et par la garde d'origine anti-CSRF (défaut `http://localhost:3100`) ; en production, l'adresse **exacte** à laquelle les navigateurs ouvrent le web | oui (adresse réelle du web) |
| `API_URL`                   | adresse de l'API pour le relais `/api/*` du web ; lue **au build** de Next             | oui (reconstruire si elle change) |
| `SESSION_SECRET`            | secret de session, 32 caractères minimum ; clé de version 1 du chiffrement             | oui, différent du défaut       |
| `TFA_MASTER_KEY`            | secret maître (HKDF) : 2FA, e-mails en file, clés IA des cabinets, empreintes du limiteur ; 32 car. min., ≠ `SESSION_SECRET` ; le changer remet les compteurs du limiteur à zéro | oui, différent du défaut |
| `TFA_MASTER_KEY_PRECEDENTE` | ancienne clé pendant une rotation                                                      | non                            |
| `SMTP_HOST`, `SMTP_PORT`    | transport e-mail ; sans hôte, journal local (affiché en développement, muet en test) ; port par défaut 465 si TLS `implicite`, sinon 587 | `SMTP_HOST` oui |
| `SMTP_USER`, `SMTP_PASS`    | identifiants SMTP, à fournir ensemble, jamais journalisés                              | non                            |
| `SMTP_TLS`                  | `implicite` (465), `starttls` (587) ; `aucun` refusé hors développement et test        | non (jamais `aucun`)           |
| `MAIL_FROM`                 | expéditeur, adresse ASCII, obligatoire dès que `SMTP_HOST` est défini                  | oui avec SMTP                  |
| `TOTP_REQUIS`               | `oui` impose la 2FA aux rôles sensibles de tous les cabinets (plancher plateforme)     | non                            |
| `CONNEXION_RAPIDE_DEMO`     | `oui` : liste des comptes de démonstration sur la page de connexion, un clic ouvre la session **sans mot de passe** (recette locale, voir « Cabinet de démonstration ») ; défaut `non` ; `oui` refusé au démarrage hors `NODE_ENV` local avec bases locales | jamais (interdit)  |
| `DEMO_PUBLIQUE`             | `oui` : ouvre la connexion « un clic » (`GET /api/auth/demo`, `POST /api/auth/demo/connexion` et `/connexion-plateforme`) dans N'IMPORTE QUEL `NODE_ENV`, production comprise, pour les SEULS cabinets et super admins marqués `est_demo` ; le mot de passe du super admin de démonstration n'est refusé que si elle est inactive ; défaut `non` ; journalise un avertissement hors développement local ; relue au démarrage de l'API (recréer `api` et `web`) ; **à n'activer que sur un serveur de démonstration** (mots de passe de démonstration publics, SECURITY.md §3 et §15) | non (jamais en production réelle) |
| `STORAGE_DRIVER`            | `disque` (défaut) ; `s3` est refusé au démarrage (non implémenté)                      | non                            |
| `STORAGE_DIR`               | dossier **absolu** des fichiers téléversés, hors du dépôt, jamais servi en statique ; défaut en développement `~/.missionpilot/stockage` (en test : dossier temporaire) | oui |
| `FICHIER_TAILLE_MAX_OCTETS` | plafond par fichier téléversé (défaut 15 Mo, de 1 Kio à 100 Mo)                        | non                            |
| `QUOTA_STOCKAGE_CABINET_OCTETS` | quota de stockage par cabinet (défaut 2 Go, 1 Mo au minimum)                       | non                            |
| `CHROMIUM_PATH`             | Chrome/Chromium des rapports PDF, chemin **absolu** vérifié au démarrage ; absent : Chrome installé en développement Windows, sinon PDF indisponible (503) | non (oui pour les PDF) |
| `JOBS_WORKER`               | `actif` ou `inactif` ; actif par défaut, inactif par défaut en test                    | non                            |
| `OCR_LOCAL`                 | OCR des PDF scannés : `auto` (défaut, moteur local s'il est disponible), `local`, `simule` (développement et test seulement) ou `off` ; voir « OCR local » | non |
| `OPENROUTER_API_KEY`        | clé IA **de plateforme** (facultative, jamais journalisée) : sert aux cabinets qui ont activé l'IA sans clé propre ; sans aucune clé, gabarits déterministes | non |
| `OPENROUTER_BASE_URL`       | point d'accès OpenRouter (défaut `https://openrouter.ai/api/v1`) ; HTTPS obligatoire, HTTP admis pour la seule boucle locale | non |
| `IA_TIMEOUT_MS`             | délai maximal d'un appel au modèle (défaut 60 000, de 1 000 à 300 000)                 | non                            |
| `IA_PLAFOND_PLATEFORME_MICRO_USD` | plafond mensuel IA par cabinet payé par la plateforme, en µUSD (défaut 50 USD, au plus 100 000 USD) ; avec la clé de plateforme, plafond effectif = min(ce plafond, celui du cabinet) | non |
| `WHATSAPP_FOURNISSEUR`, `SMS_FOURNISSEUR`, `TRANSCRIPTION_FOURNISSEUR` | canaux externes **simulés** (lot 3c) : `aucun` (défaut, canal absent) ou `simule` (boîte du simulateur, aucun envoi réel, aucune clé, aucun réseau) ; toute valeur autre que `aucun` est **refusée au démarrage** hors `NODE_ENV` local avec bases locales | jamais (interdit ; laisser `aucun`) |
| `SIGNATURE_FOURNISSEUR`     | signature électronique **locale simulée** (sans valeur juridique) : `aucun` (défaut) ou `local` ; même refus hors développement local | jamais (interdit ; laisser `aucun`) |
| `WHATSAPP_WEBHOOK_SECRET`   | secret HMAC du webhook entrant des canaux, 32 caractères minimum, ≠ `SESSION_SECRET`, `TFA_MASTER_KEY` et ancien secret ; obligatoire dès qu'un fournisseur de messagerie est actif ; en développement, valeur de développement ; jamais journalisé | oui avec un fournisseur actif (donc jamais aujourd'hui) |
| `WHATSAPP_WEBHOOK_SECRET_PRECEDENT` | ancien secret du webhook pendant une rotation (32 caractères minimum, différent du courant)  | non                            |

### Comptes de démonstration

Cabinet « Cabinet Démo » : un compte par rôle, adresse
`<role>@demo.missionpilot.test` (rôle avec `.` à la place de `_`, ex.
`directeur.mission@…`). Le mot de passe est la constante `MOT_DE_PASSE_DEMO` de
`apps/api/src/db/seed.ts` : ne pas le recopier ailleurs. Comptes de test locaux
uniquement.

### Cabinet de démonstration pour la recette humaine

```bash
pnpm --filter @missionpilot/api db:seed-demo
```

Crée le cabinet fictif « Lagune Conseil & Associés (démo) » (Abidjan) :
un compte par rôle, `<role>@lagune-conseil.test` (rôle avec `.` à la place de
`_`, plus `consultant.junior@…`), cinq clients, catalogue de conseil,
collaborateurs avec grades et coûts, quatre missions (en proposition, signée
avec budget figé, en cours avec temps validés, clôturée avec deux factures
émises et un encaissement partiel du solde), absences et notifications. Tout
passe par les routes réelles (`app.inject`) ; seule l'émission des factures à
une date passée appelle la fonction métier `emettre`. Le mot de passe commun est
la constante `MOT_DE_PASSE_DEMO_ABIDJAN` de `apps/api/src/db/seed-demo.ts` : ne
pas le recopier ailleurs.

- **Refus** si `NODE_ENV` n'est pas local, si `DATABASE_URL` ou
  `DATABASE_OWNER_URL` ne désigne pas la machine locale, ou si `SMTP_HOST` est
  défini (aucun e-mail ne doit partir).
- **Pas de doublon** : si le cabinet existe déjà, le script n'écrit rien et sort
  avec le code 2. Un échec en cours de route laisse un cabinet partiel : repartir
  d'une base neuve (migrations appliquées) avant de relancer.
- Durée : de l'ordre de la minute (hachage des mots de passe, une quinzaine de
  feuilles de temps). Les dates sont relatives au jour du lancement.

#### Comptes du portail client de démonstration

```bash
pnpm --filter @missionpilot/api db:seed-demo-portail
```

`db:seed-demo` l'exécute déjà en fin de course : cette commande sert à ajouter
le portail à une base **déjà peuplée** par une version antérieure de
`db:seed-demo` (ex. la base de recette `missionpilot_demo`). Mêmes gardes que
`db:seed-demo` (`NODE_ENV` local, bases locales, pas de `SMTP_HOST`) ; refus
net (code 1) si le cabinet de démonstration n'existe pas, et (code 2, rien
n'est écrit) si les comptes du portail existent déjà. Non destructif ; durée
d'une minute environ. Tout passe par les routes réelles : invitations,
acceptation, partages par un associé, validation d'un jalon par le client,
envoi de questionnaires, KPI et mesures.

| Compte (`@lagune-conseil.test`)  | Nom                    | Rôle                  |
| -------------------------------- | ---------------------- | --------------------- |
| `dirigeant.client`               | Jean-Baptiste Kouadio  | Dirigeant client      |
| `contributeur.client`            | Nadège Yapi            | Contributeur client   |
| `investisseur.client`            | Moussa Coulibaly       | Investisseur          |

Même mot de passe commun que les comptes du cabinet. Client rattaché :
« Cacao Savane Export (fictif) », qui porte déjà la mission clôturée du seed
et ses deux factures émises (acompte soldé, solde réglé à 40 %). Le seed y
ajoute une mission **en cours** (« Accompagnement à la mise en œuvre du plan
Cacao Savane », budget figé), car une mission clôturée ne reçoit plus ni jalon,
ni document, ni questionnaire, ni KPI. Contenu :

### Comptes de démonstration avec double authentification (signature de bout en bout)

Signer un document exige une double authentification **active** (409 `TFA_INACTIVE` sinon) ; les comptes ci-dessus n'en ont pas. `db:seed-demo` crée donc, en fin de course, deux comptes de plus, et `pnpm --filter @missionpilot/api db:seed-demo-2fa` les ajoute à une base **déjà peuplée** (code 2, rien d'écrit, s'ils existent) :

| Compte (`@lagune-conseil.test`) | Nom               | Rôle             |
| ------------------------------- | ----------------- | ---------------- |
| `associe.2fa`                   | Fanta Doumbia     | Associé          |
| `dirigeant.client.2fa`          | Salimata Bakayoko | Dirigeant client |

La connexion rapide **refuse** ces comptes (`CONNEXION_RAPIDE_2FA`, elle ne contourne jamais la 2FA) : connexion par le formulaire avec l'adresse, le mot de passe commun, puis le code à 6 chiffres donné par `pnpm --filter @missionpilot/api db:code-2fa-demo`. Le secret TOTP est **constant et public** (`SECRET_2FA_DEMO_BASE32`, `apps/api/src/db/seed-demo-2fa.ts`) : recette locale seulement, jamais ailleurs ; pour une application d'authentification, le saisir comme clé de configuration manuelle. **Anti-rejeu** : un code n'est accepté qu'une fois ; après la connexion, attendre le pas de 30 s suivant et redemander le code avant de signer. Parcours : un associé demande la signature (Fanta Doumbia comme signataire du cabinet, Salimata Bakayoko comme signataire du client), chacun **consulte le document** puis signe en saisissant mot de passe et code.


- **Partages** (faits par l'associé) : les deux missions avec jalons et
  factures, la lettre de mission et le livrable « Synthèse du diagnostic
  stratégique » (PDF valide, contenu rédigé avec l'IA puis **validé** par le
  directeur), contact principal = directeur de mission (Yao Kouassi).
- **Jalons** de la mission en cours : « Cadrage validé… » atteint **et validé**
  par le dirigeant client ; « Diagnostic stratégique restitué » atteint,
  **à valider** (tester la validation avec le dirigeant) ; un jalon à venir.
- **Factures** : deux émises, dont FA-…-00002 avec encaissement partiel (en
  retard) ; visibles du dirigeant (pas du contributeur ni de l'investisseur :
  droits du rôle).
- **Questionnaires** (envoyés par le chef de mission) : « Questionnaire
  préliminaire des dirigeants » en mode **par fonction** (dirigeant : Directeur
  général ; contributrice : Directrice administrative et financière), date
  limite à J+14, **brouillon de réponse commencé** par la contributrice ;
  « Notation de la compétitivité… » en mode **collectif**, date limite
  **dépassée à dessein** : la soumission y est refusée (409 `DATE_LIMITE_DEPASSEE`) tant que le cabinet n'a pas repoussé la date limite de l'envoi (recette de la prolongation).
- **KPI** (mission en cours) : « Chiffre d'affaires mensuel » (cible 450 M FCFA),
  « Délai moyen de recouvrement des créances » (cible 45 jours, plus bas
  mieux), « Satisfaction des planteurs partenaires » (trimestriel, cible 85 %) ;
  la contributrice en est contributeur désigné ; mesures saisies par le cabinet
  puis la dernière par elle depuis le portail.
- **Notifications** : celles que ces actions génèrent (questionnaires à
  compléter pour les deux répondants, jalon validé et alertes côté cabinet).
- Aucune 2FA sur ces comptes et politique 2FA du portail désactivée (sinon la
  connexion rapide serait refusée). Les PDF sont écrits dans le stockage de
  développement (`~/.missionpilot/stockage`, ou `STORAGE_DIR`).

#### Canaux simulés, redressement et services candidats de démonstration

`db:seed-demo` ajoute, en fin de course et après les comptes du portail et les
comptes 2FA, trois sous-semis :

- **les canaux simulés** (`apps/api/src/db/seed-demo-canaux.ts`) : un compte
  WhatsApp simulé actif, avec la saisie de KPI activée (l'alerte KPI garde sa
  valeur par défaut, désactivée) ; deux destinataires, aux seuls numéros de test
  du simulateur : Salimata Bakayoko (`+2250000000012`, joignable, consentement
  donné depuis le portail) et Nadège Yapi (`+2250000000000`, non joignable,
  consentement recueilli par le cabinet avec sa référence) ; une relance vers le
  numéro non joignable (échec visible dans le journal d'envois) ; une demande de
  signature « Lettre de mission - signature electronique (DÉMONSTRATION) »,
  envoyée, avec Fanta Doumbia pour le cabinet et Salimata Bakayoko pour le client
  (2FA active, personne n'a encore signé) ; une transcription « DÉMONSTRATION » à
  relire. Aucun envoi réel, aucune clé, aucun appel réseau : les fournisseurs
  sont simulés ou locaux.
- **le redressement** (`apps/api/src/db/seed-demo-redressement.ts`), pour le client
  « Transports Akwaba (fictif) » : le dossier « Redressement Transports Akwaba
  (fictif) », actif et complet (états du client, diagnostic, trésorerie, créanciers,
  plan validé par le directeur de la mission, check-list, causes racines,
  covenants, bilan de clôture en brouillon), et le dossier « Redressement express
  Transports Akwaba (fictif) », clos par le directeur, avec son plan de suivi et un
  relevé.
- **les services candidats** (`apps/api/src/db/seed-demo-services-candidats.ts`,
  appelé par une ligne de `seed-demo.ts`), pour le client de démonstration du
  portail : le **prix du diagnostic flash**, fixé à 1 000 000 XOF et marqué
  `DÉMONSTRATION` (colonne `commentaire`), car le produit n'a aucun prix par
  défaut ; l'activation des types de mission « diagnostic flash » et « business
  plan bancable » ; une mission de chaque service, « Diagnostic flash
  (DÉMONSTRATION) » et « Business plan bancable (DÉMONSTRATION) », liées à leur
  méthode du standard ; deux **guichets de financement FICTIFS** (« Guichet fictif
  A » et « B », marqués `DÉMONSTRATION, à valider`, aucune source réelle). Tout passe
  par les routes de l'API (droits et journal d'audit), sans appel réseau. À voir
  dans l'interface, connecté en associé ou directeur de mission : pages
  `/services-candidats` (prix, activation, création d'une mission) et
  `/services-candidats/guichets` (liste et rapprochement) ; `/observatoire` n'est
  pas semé (adhésion et versement se font à la main).
- **les deux liens vers ces services** : la fiche d'un client **actif** affiche le
  bouton « Proposer un diagnostic flash » (visible avec `catalogue.lire`, il mène à
  `/services-candidats`) ; le brief quotidien (`/brief`) peut afficher un élément
  « voyant rouge » (famille « Ça dérive », lien `/missions/<id>/redressement`)
  seulement pour un dossier de redressement NON clos dont le voyant calculé est
  rouge, sur une mission visible et non clôturée, connecté avec `redressement.lire`.
  Le semis ne force pas ce cas : le dossier de démonstration actif n'y figure que
  si son état calculé est rouge (à vérifier dans l'interface, aucun montant n'y
  apparaît). Un dossier de redressement clos n'apparaît jamais dans le brief.

Sur une base déjà peuplée, ces trois sous-semis se relancent séparément ; il n'y a
pas de script npm dédié :

```bash
pnpm --filter @missionpilot/api exec tsx src/db/seed-demo-canaux.ts     # exige les comptes du portail et les comptes 2FA
cd apps/api && npx tsx src/db/seed-demo-redressement.ts                  # exige le cabinet de démonstration
pnpm --filter @missionpilot/api exec tsx src/db/seed-demo-services-candidats.ts   # exige le cabinet de démonstration
```

- Canaux : idempotent étape par étape. Un compte, un numéro, un consentement, un
  document, une demande ou une transcription déjà présents ne sont pas recréés ; si
  rien n'est créé, le script le dit et sort avec le code 0.
- Redressement : si le dossier « Redressement Transports Akwaba (fictif) » existe
  déjà, le script le vérifie avant toute écriture, n'écrit rien et sort avec le
  code 2.
- Services candidats : idempotent (missions retrouvées par intitulé, guichets par
  nom, prix posé seulement s'il n'est pas déjà personnalisé) ; sans rien à écrire,
  le script le dit et sort avec le code 0. Il échoue (code 1) si le client de
  démonstration du portail est absent : lancer d'abord `db:seed-demo`.

**Connexion rapide (sans mot de passe)** pour la recette : démarrer l'API avec
`CONNEXION_RAPIDE_DEMO=oui` ; la page de connexion affiche alors le bloc
« Comptes de démonstration (environnement local) » en deux groupes, « Espace
cabinet » et « Espace client (portail) », et un clic sur un compte ouvre sa
session (un compte client arrive dans `/portail`).

```bash
CONNEXION_RAPIDE_DEMO=oui pnpm dev                                   # bash : API et web
CONNEXION_RAPIDE_DEMO=oui pnpm --filter @missionpilot/api dev        # bash : API seule
```

```powershell
$env:CONNEXION_RAPIDE_DEMO = "oui"; pnpm dev                         # PowerShell
Remove-Item Env:CONNEXION_RAPIDE_DEMO                                # désactiver ensuite
```

- La variable se lit **au démarrage de l'API** : relancer l'API après l'avoir
  posée ou retirée (le web n'a pas besoin d'être reconstruit, il lit la liste à
  chaque affichage de la page).
- Seuls les comptes actifs `@lagune-conseil.test` du cabinet semé par
  `db:seed-demo` sont listés, comptes du portail compris (s'ils ont un
  rattachement actif à un client actif) ; un compte dont la 2FA est active ou
  obligatoire (politique du cabinet, `TOTP_REQUIS=oui`, ou politique 2FA du
  portail pour un compte client) est refusé : utiliser le formulaire.
- Refus de démarrage si `NODE_ENV` n'est pas `development` ou `test` (ou
  absent), ou si une URL de base n'est pas locale. Jamais sur un serveur.
- Sans la variable, les routes n'existent pas (404) et la page n'affiche rien
  de plus.

### Super admin de plateforme, tenant par défaut et démonstration « un clic »

Chantier du 2026-10-23 (sécurité : `docs/governance/SECURITY.md` §3, §4 et §15). Un **super admin de plateforme** crée
des cabinets (tenants) et leurs comptes, sans jamais lire de donnée métier ; il se connecte à la **console `/plateforme`**
avec un cookie et une session distincts de ceux d'un cabinet.

**Scripts** (base locale ; le rôle propriétaire est lu dans `DATABASE_OWNER_URL`) :

```bash
# Tenant de démonstration par défaut : cabinet « Lagune Conseil & Associés (démo) » avec un compte actif sans 2FA pour
# CHAQUE rôle du cabinet et du portail, marqué est_demo, plus le super admin de démonstration. Idempotent.
pnpm --filter @missionpilot/api db:seed-defaut

# Premier VRAI super admin (jamais marqué démonstration). Mot de passe généré et affiché UNE seule fois s'il n'est pas fourni.
pnpm --filter @missionpilot/api db:creer-super-admin -- --email prenom.nom@exemple.org --nom "Prénom Nom"
```

- `db:seed-defaut` : cabinet absent, il est créé (plusieurs minutes, par les routes réelles) ; présent, rien n'est dupliqué,
  le portail est repris s'il manque, un compte est ajouté pour tout rôle sans compte actif sans 2FA, `est_demo` est posé et
  le super admin de démonstration est créé. Mêmes gardes que `db:seed-demo` (base locale, pas de `SMTP_HOST`) ; refus net si
  l'adresse fondatrice appartient à un autre cabinet, ou si l'adresse du super admin de démonstration appartient à un super
  admin réel. Mots de passe : constantes **publiques** du dépôt (`MOT_DE_PASSE_DEMO_ABIDJAN` dans `seed-demo.ts`,
  `MOT_DE_PASSE_DEMO_SUPER_ADMIN` dans `seed-defaut.ts`) : démonstration uniquement, ne jamais les recopier ni les réutiliser.
- `db:creer-super-admin` : écrit avec le rôle propriétaire, ne modifie jamais un super admin existant. Mot de passe : option
  `--mot-de-passe`, sinon variable `SUPER_ADMIN_MOT_DE_PASSE` (évite l'historique du shell), sinon généré et affiché une seule
  fois (le noter aussitôt, rien ne le redonnera) ; un mot de passe fourni n'est jamais réaffiché. Codes de sortie : 0, 1
  (arguments, configuration ou échec technique), 2 (e-mail déjà pris).
- Sur le serveur (image de production, depuis `/home/deployer/missionpilot`, alias `mp` de `DEPLOIEMENT.md`) :

```bash
mp run --rm api node_modules/.bin/tsx src/db/creer-super-admin.ts --email prenom.nom@exemple.org --nom "Prénom Nom"
# DEMO_PUBLIQUE=oui doit être dans missionpilot.env AVANT cette commande ; --confirmer-demo est obligatoire
mp run --rm api node_modules/.bin/tsx src/db/seed-defaut.ts --confirmer-demo
```

  Procédures complètes (création, activation, désactivation, remise à zéro) : `docs/workflows/DEPLOIEMENT.md`.

**Comptes de démonstration** : le tenant par défaut est le cabinet « Lagune Conseil & Associés (démo) » décrit plus haut
(`<role>@lagune-conseil.test`, mot de passe commun = constante de `seed-demo.ts`). Le **super admin de démonstration** a
l'adresse `superadmin@demo.missionpilot.test` ; son mot de passe est la constante de `seed-defaut.ts` et n'est pas recopié
ici. Les adresses en `.test` ne doivent jamais être de vrais comptes (SECURITY.md §15).

**Page de connexion « un clic »** : quand la démonstration est active (`CONNEXION_RAPIDE_DEMO=oui` en local, ou
`DEMO_PUBLIQUE=oui`), `/connexion` affiche le bloc « Mode démonstration » : on choisit d'abord un espace (« Super
administrateur » ou un cabinet), puis, pour un cabinet, un compte (« Espace cabinet » ou « Espace client (portail) ») ; un
clic ouvre la session, sans e-mail ni mot de passe. Un clic sur la carte « Super administrateur » connecte DIRECTEMENT, sans étape
de confirmation, et mène à `/plateforme`. La liste n'affiche pas les comptes à 2FA active ou obligatoire (utiliser le formulaire
pour ceux-là).
Le lien « Accès administrateur de la plateforme », toujours affiché sous le formulaire, mène à `/plateforme/connexion`
(e-mail et mot de passe d'un super admin). Le bloc n'apparaît que si `GET /api/auth/demo` répond 200.

**Console `/plateforme`** : liste des cabinets (création avec son premier associé, activation et désactivation) puis page
d'un cabinet (comptes : création, rôles, activation et désactivation). Un mot de passe généré s'affiche une seule fois,
à la création. Désactiver un cabinet coupe à l'instant la connexion et les sessions de tous ses comptes. Le dernier associé
actif d'un cabinet ne se désactive pas (409 `DERNIER_ASSOCIE`). Le super admin de démonstration ne voit et ne crée que des
cabinets de démonstration, avec des adresses en `.test`, dans la limite de 30 cabinets et de 40 comptes par cabinet.

## Lancer

```bash
pnpm dev     # API (tsx watch, 4100) et web (next dev -p 3100) en parallèle
```

Sonde de l'API : `GET http://localhost:4100/api/sante` (sans authentification).
Le worker de jobs démarre avec l'API (rappels de temps, relances des factures
et des questionnaires, suivi quotidien des KPI, générations IA, purge des
fichiers orphelins, file d'e-mails, anonymisation du texte des générations IA
`ia_conservation` et purge des rapports `purge_rapports`, une fois par jour et par
cabinet concerné ; lot 6 : extraction et structuration des documents importés, à
l'envoi, et `ingestion_maintenance` une fois par jour, voir « Import de documents ») ;
`JOBS_WORKER=inactif` le coupe. L'IA est
désactivée par défaut dans chaque cabinet : tant qu'un associé ne l'active pas
(`/parametres/ia`), les générations utilisent les gabarits déterministes. L'interface est sur
`http://localhost:3100` (connexion avec un compte de démonstration).

## Rapport d'avancement hebdomadaire, cache IA et contradicteur (lot 4c)

Exploitation du lot 4c (AUT-10, AGT-06). Valeurs et droits : `docs/DECISIONS.md`, section « lot 4c ». **L'interface de
ce lot n'a pas été vérifiée dans un navigateur** (note du lot) : les libellés ci-dessous viennent du code, à confirmer
à la première recette.

### Job `avancement_hebdo`

- **Planification** : le worker de jobs (démarré avec l'API) appelle le planificateur récurrent ; du lundi au vendredi,
  il crée au plus une tâche par cabinet et par semaine (clé `avancement_hebdo:<lundi>`), prévue à 06:30 UTC, pour les
  cabinets qui ont au moins une mission signée ou en cours et n'ont pas désactivé la fonction. Rien le week-end.
  Traitement par lots de 25 missions, 40 lots au plus par semaine ; une mission qui a déjà un rapport pour la semaine
  est écartée.
- **En développement** : lancer `pnpm dev` un jour ouvré après 06:30 UTC (la tâche est alors due tout de suite), ou
  sans attendre, ouvrir l'onglet « Avancement » d'une mission et cliquer « Préparer le rapport de cette semaine »
  (génération manuelle, même moteur). `JOBS_WORKER=inactif` coupe le worker, donc le job.
- **Où voir les rapports** : onglet « Avancement » de la mission (`/missions/<id>/avancement`), section « Rapports
  d'avancement hebdomadaires ». Le chef de mission (à défaut le directeur) reçoit une notification interne « Rapport
  d'avancement à relire », sans e-mail.
- **Échecs** : un échec sur une mission n'arrête pas les autres ; il est consigné dans les journaux de l'API **sans
  contenu** (code, contrainte, table, identifiants de mission et de semaine). Une mission en échec n'est pas retentée
  avant la semaine suivante : utiliser le bouton manuel. Le dépassement des 40 lots est consigné de la même façon.
- **Désactiver** : carte « Paramètre du cabinet » de l'onglet « Avancement » (droit `automatisation.gerer`). L'envoi par
  e-mail est refusé par l'API et par la base : il n'existe pas.

### Cache des réponses IA et plafond par mission

- **Cache** : `/parametres/ia`, carte « Cache des réponses » (droit `ia.configurer`). Désactivé par défaut. Bouton
  « Activer le cache » ; durée de vie 24 h, non réglable. « Désactiver et vider le cache » supprime les entrées du
  cabinet. Une réponse servie par le cache est marquée `servie_par_cache` et compte en « Servies par le cache » dans
  la carte des coûts, à coût nul. Jamais utilisé par le copilote ni pour du contenu de client.
- **Plafond par mission** : `PUT /api/agents/missions/:id/plafond` (corps `plafond_micro_usd`, droit `ia.configurer`),
  `GET` au même chemin pour l'état. **Aucun écran** ne le règle dans le web actuel. Alertes aux associés à 80 % et à
  100 % (notification dans l'application, sans montant). Plafond atteint : l'appel IA rattaché à la mission est refusé.

### Onglet « Avancement » d'une mission et portail

- **Cabinet** : l'onglet apparaît avec le droit `avancement.lire` (associé, directeur de mission, chef de mission),
  sur les missions visibles. Modifier la note d'introduction et le commentaire, « Enregistrer », « Régénérer les
  chiffres » et « Valider le rapport » exigent en plus d'être associé, directeur ou chef de **cette** mission. Les
  chiffres ne se modifient pas à la main.
- **Valider un rapport** : ouvrir le rapport de la semaine (brouillon), relire, compléter, « Enregistrer », puis
  « Valider le rapport » et confirmer. Si un commentaire a été proposé par l'IA (« Suggérer un commentaire (IA) »), il
  faut d'abord cliquer « J'ai relu ce commentaire » (ou le réécrire ou l'effacer), sinon 409 `COMMENTAIRE_IA_A_RELIRE`.
  Un rapport validé est figé.
- **Portail** : entrée « Avancement » (`/portail/avancement`, titre « Avancement de vos missions »), pour
  `client_dirigeant` et `client_contributeur` seulement. Elle liste les rapports **validés** de leur client sur les
  missions partagées ; un brouillon, une autre mission ou un autre client donnent le même 404. Aucune donnée financière,
  aucun budget en jours, aucun temps par personne.
- **Compte de démonstration** : `dirigeant.client@lagune-conseil.test` ou `contributeur.client@lagune-conseil.test`
  (cabinet « Lagune Conseil & Associés (démo) », voir « Comptes du portail client de démonstration »). Le seed
  `db:seed-demo` **ne crée aucun rapport d'avancement** : pour en voir un côté portail, se connecter en
  `associe@lagune-conseil.test` (le chef de la mission du seed n'est pas garanti), ouvrir la mission en cours « Accompagnement à la
  mise en œuvre du plan Cacao Savane » (partagée avec le portail par le seed), préparer puis valider le rapport, puis se connecter
  en compte portail.

### Contradicteur (contre-analyse)

- **Préparer** (droit `agent.gerer`) : page « Autonomie des agents » (`/agents/autonomie`), carte « Revue contradictoire
  (agent contradicteur) » : « Préparer la revue contradictoire » (prompt et jeu d'essai, sans risque à relancer),
  puis lancer l'évaluation de non-régression.
- **Déclarer la brique** : même carte, « Déclarer la brique » avec le niveau d'autonomie maximal (N0 à N3, N2 proposé,
  classe R1). Sans cette déclaration, la revue répond 409 `BRIQUE_NON_DECLAREE`.
- **Utiliser** : sur un brouillon IA, bouton « Demander une contre-analyse » du panneau de contenu IA (droit
  `ia.utiliser`). Le résultat est un brouillon IA à part, non bloquant ; le brouillon relu n'est jamais modifié.
  Une seule revue à la fois par brouillon ; le plafond de la mission, le coupe-circuit ou le niveau N0 la refusent.

## Import de documents (états financiers, due diligence, amorçage du standard)

Exploitation du lot 6 (ADR-009 ; règles de sécurité : `docs/governance/SECURITY.md`, section « 8 undecies.
Ingestion de documents »). **L'interface de ce lot n'a pas été essayée dans un navigateur** (note du lot) :
les libellés viennent du code. Le lot 6 n'ajoute aucune variable d'environnement ; les plafonds sont des constantes du code. Seule exception, ajoutée par le lot 11 : `OCR_LOCAL` (voir « OCR local »).

### Où importer

| Usage                         | Page web                                                                                                                  | Route d'envoi                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| États financiers (DOS-03)     | carte d'import sur `/dossiers/[id]/finances` ; détail `.../finances/documents/[docId]`                                     | `POST /api/dossiers/:id/etats-financiers/document` (droit `dossier.ecrire`)            |
| Due diligence (DD-02, DD-10)  | onglet « Documents » du dossier DD (`/missions/[id]/due-diligence/[dossierId]/documents` ; détail `.../documents/[docId]`) | `POST /api/dd/dossiers/:id/documents?type=rapport` ou `type=salle` (droit `dd.ecrire`) |
| Amorçage du standard (STD-13) | `/methodes/versions/[id]/amorcage` ; détail `.../amorcage/[docId]`                                                         | `POST /api/methodes/versions/:id/amorcage/documents`                                   |

- **Formats** : PDF et classeur Excel `.xlsx`. Le type est décidé par le **contenu** du fichier ; autre chose :
  415 `TYPE_DOCUMENT_REFUSE`.
- **Plafonds** (`PLAFONDS_INGESTION`, `packages/shared/src/schemas/ingestion.ts` ; constantes, pas de variable) :
  PDF 10 Mo, XLSX 2 Mo (413 `FICHIER_TROP_VOLUMINEUX` au-delà) ; 60 pages ; 25 000 caractères par page et
  400 000 par document ; extraction 30 s ; 5 documents en traitement et 40 créations par 24 h glissantes et par
  cabinet (409 `INGESTION_PLEIN`) ; 40 000 caractères transmis au modèle.
- **Conservation** : le fichier est analysé puis **effacé** (jamais conservé). Le **texte des pages** reste en base
  jusqu'à la décision + 90 jours (job `ingestion_maintenance`), puis il est purgé ; les références de page restent.
- **Lecture IA** : pour la due diligence et l'amorçage, elle exige l'IA activée pour le cabinet (`/parametres/ia`,
  droit `ia.configurer`) avec une clé du cabinet ou la clé de plateforme `OPENROUTER_API_KEY`, et le droit
  `ia.utiliser` de l'utilisateur ; elle compte dans les plafonds et quotas IA du cabinet
  (`IA_PLAFOND_PLATEFORME_MICRO_USD`). Sans IA disponible, le document se termine avec le résultat
  `ia_indisponible` (rien n'est inventé) et la lecture se relance une fois l'IA configurée
  (`POST /api/dd/documents/:docId/lecture`, `POST /api/amorcage/documents/:docId/proposition`). Pour un état
  financier en PDF, l'IA est facultative : sans elle, des règles déterministes lisent le texte ; un classeur Excel
  se lit par règles seules.
- **OCR** : un PDF sans couche texte (scan) est lu par l'**OCR local** installé sur le serveur (lot 11, ADR-009
  décision 16), jamais par un service externe. Voir « OCR local » ci-dessous. Un état issu d'un OCR part toujours
  en revue humaine. Si l'OCR n'est pas disponible, le scan échoue avec `OCR_INDISPONIBLE` ; fournir alors un PDF
  avec texte (export du logiciel source, pas une photo), saisir l'état à la main, ou l'importer en CSV ou Excel.
- **Suivi** : la page de détail d'un document en cours se rafraîchit seule (toutes les 3 s).

### Jobs

| Type de job               | Déclenchement                                | Rôle                                                                                       |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ingestion_extraction`    | à l'envoi du document                        | extrait le texte des pages (PDF dans un `worker_thread`, XLSX par le lecteur de classeur), puis efface le fichier |
| `ingestion_structuration` | après l'extraction, et à une relance         | lit le texte (IA ou règles) et produit le brouillon (`ingestion_extractions`)              |
| `ingestion_maintenance`   | quotidien, **03 h 45 UTC**, par cabinet concerné (clé `ingestion_maintenance:AAAA-MM-JJ`) | purge le texte des pages décidées depuis 90 jours (fonction `SECURITY DEFINER` `purger_textes_ingestion`) et reprend les effacements d'objets échoués (fenêtre de 30 jours après le marquage) |

La planification quotidienne passe par `planifier_ingestion_maintenance` (migration `0524`), appelée par le
planificateur du worker (`apps/api/src/jobs/planificateur.ts`) ; les types sont déclarés dans
`apps/api/src/jobs/registre.ts`. `JOBS_WORKER=inactif` coupe aussi ces trois jobs : aucun document n'avance.

**Réveil du worker (lot 13b, R-08).** Le worker ne laisse plus passer son intervalle normal (30 s) avant de traiter un
document importé : la création du document (et la relance d'une ingestion de due diligence ou du standard) émet, APRÈS le
COMMIT, un signal en mémoire (`apps/api/src/jobs/reveil.ts`) qui avance le prochain cycle à 400 ms ; un cycle utile est
suivi d'un cycle à 1 s (extraction puis structuration), un cycle déclenché par signal qui revient vide est suivi d'un seul
rattrapage à 2 s, puis le worker retombe à 30 s. Le signal est local au processus : un worker lancé dans un autre
processus que l'API, ou une API sans worker (tests), garde l'intervalle de 30 s. Un document qui met 30 s à démarrer
alors qu'un worker tourne dans l'API est donc anormal : vérifier `JOBS_WORKER`, puis les journaux de l'API.

### OCR local

L'OCR (`tesseract.js` 7.0.0, WebAssembly) tourne **sur le serveur**, hors ligne, dans un sous-processus Node
isolé par document. Règles de sécurité : `docs/governance/SECURITY.md`, section « 8 undecies » ; décision et
mesures : ADR-009 (« Décision OCR (lot 11) ») et `docs/workflows/notes-lots/lot-11.md`.

- **Prérequis** : **aucun binaire système** (pas de `tesseract-ocr` à installer). `tesseract.js-core` ajoute
  environ 45 Mo à `node_modules` (`pnpm install`) ; les données de langue (`fra` + `eng`, `tessdata_fast`) pèsent
  5,2 Mo et sont **dans le dépôt** (`apps/api/ocr-data/`, avec `SHA256SUMS`). Aucun téléchargement à l'exécution.
- **Node 22.13 minimum, requis en production** : le sous-processus s'appuie sur le modèle de permissions de Node
  (`--permission`), qui n'existe qu'à partir de 22.13. Sur une version plus ancienne, ou si le drapeau manque,
  l'OCR est **refusé en production** (tout `NODE_ENV` autre que `development` ou `test`, **staging compris**) :
  le scan échoue `OCR_INDISPONIBLE`. Hors production, il est toléré avec un seul avertissement dans le journal.
- **Variable `OCR_LOCAL`** (facultative ; `.env.example`) : `auto` (défaut) = moteur local s'il est disponible,
  sinon rien en production (simulé en développement) ; en test (`NODE_ENV=test`), le simulé reste le défaut.
  `local` = moteur local demandé même en test. `simule` = moteur simulé (développement et test seulement).
  `off` = aucun moteur local (le scan échoue `OCR_INDISPONIBLE`).
- **Vérifier les données de langue** : `node scripts/ocr-verifier-donnees.cjs` (Node pur, sans réseau ; code de
  sortie 1 si une empreinte diffère). L'API fait la même vérification au premier usage : une empreinte fausse rend
  le moteur indisponible, sans bruit.
- **Pare-feu sortant à prévoir** : le moteur n'a besoin d'aucun accès réseau. Le garde réseau du sous-processus
  est une défense applicative ; **bloquer le trafic sortant du serveur d'API** (hors PostgreSQL, SMTP et IA
  configurés) reste à poser côté exploitation (dette ouverte, SECURITY §15).
- **Limites** : 30 pages scannées au plus, 240 s au total, 20 Mpx par image, 6 images par page ; 256 Mo de tas,
  coupure à 768 Mo de RSS, 60 s par étape ; une reconnaissance à la fois par processus d'API (file de 8). Mesuré :
  environ 2 à 4 s par page ; 30 pages en 60 à 70 s sur un poste de développement.
- **Mettre à jour le moteur ou les données** : voir `docs/workflows/notes-lots/lot-11.md` (« Mettre à jour le
  moteur ou les données ») et `apps/api/ocr-data/README.md`.
- **CI** : `OCR_LOCAL_EXIGE=1` (job `api`) rend obligatoires les tests du moteur réel ; sans lui, ils sont sautés
  avec un message si le moteur manque.

### Mémoire du worker PDF

- Un **pré-contrôle** (`pdf-controle.ts`, dans son propre `worker_thread`, délai de 5 s) refuse un PDF « bombe »
  (flux compressés qui gonflent) avant tout worker d'extraction.
- L'extraction est surveillée toutes les 150 ms : mémoire **externe** du worker à **256 Mo**, hausse du **RSS** du
  processus de **+512 Mo**. Si l'un est franchi, le worker est terminé et le document passe en échec `PLAFOND_TEXTE`.
- **Ne pas abaisser ces seuils en production** : ils sont mesurés sur des PDF légitimes (21 à 88 Mo externes) et
  ne sont abaissés que dans les tests.
- Au plus **2 extractions simultanées** par processus (`EXTRACTIONS_SIMULTANEES_MAX`) ; les autres attendent.
- **Node 22.16 ou plus** : la mesure de la mémoire externe (`worker.getHeapStatistics()`) n'existe qu'à partir de
  Node 22.16. En dessous, seule la surveillance du RSS joue (coupure plus lente : 4,5 s au lieu de 2,6 à 3,0 s sur
  le cas mesuré, pic plus haut) : fonctionnel, mais à éviter en production.

### Dépannage de l'import

- **Document « en cours » depuis plus de 30 minutes** : il n'est plus compté dans le quota de 5 documents en
  traitement. Vérifier que le worker tourne (`JOBS_WORKER` actif, API démarrée), puis téléverser de nouveau.
- **Refus `PLAFOND_TEXTE`** : PDF trop lourd à décompresser (flux de plus de 32 Mo, plus de 4 096 flux Flate, scan
  Flate brut de plus de 5 pages A4 en RVB, PDF abîmé), texte au-delà des plafonds de caractères, ou worker coupé
  par la surveillance mémoire. Re-soumettre un PDF régénéré ou compressé autrement (réexport, « imprimer en PDF »).
- **`OCR_INDISPONIBLE`** : scan sans OCR utilisable. Vérifier dans l'ordre : `OCR_LOCAL` n'est pas `off` ; Node
  ≥ 22.13 (`node -v`) ; `node scripts/ocr-verifier-donnees.cjs` ; `pnpm install` fait (dépendance `tesseract.js`).
  En production, une version de Node sans modèle de permissions suffit à le provoquer.
- **`OCR_ECHEC`** : le moteur a échoué (image trop dégradée ou page à plus de 60 images décodées, délai ou
  mémoire dépassés, file de 8 reconnaissances pleine, sous-processus coupé). Refaire le scan plus net ; relancer
  si la charge du serveur était en cause.
- **`IMAGE_TROP_GRANDE`** : une image dépasse 20 Mpx (un A4 scanné à 600 dpi fait environ 35 Mpx). Refaire le
  scan à 300-400 dpi.
- **`PDF_SANS_TEXTE`** : l'OCR a tourné et **n'a rien lu** (page blanche, scan négatif, image illisible) ; avant le
  lot 11 il signifiait « scan sans OCR ». Fournir un scan plus net ou un PDF avec texte. **`PDF_ILLISIBLE`** : PDF
  protégé ou corrompu. Un PDF qui mêle pages natives et pages scannées n'est lu que par sa couche texte.
- **404 `TEXTE_PURGE`** : le texte de la page a été purgé (décision + 90 jours) ; les références de page restent.
- **409 à la relance** : le texte du document est purgé (téléverser de nouveau), le document n'est pas terminé,
  un brouillon est déjà ouvert (`EXTRACTION_OUVERTE`) ou la lecture est déjà aboutie (`LECTURE_NON_RELANCABLE`).
- **409 `INGESTION_PLEIN`** : 5 documents en traitement ou 40 créations en 24 h pour ce cabinet ; attendre.
- **`pnpm install` refuse de s'exécuter** : Node inférieur à 22.13 (voir « Autres pannes connues »).

## Ports

Alignés sur `ports` d'`acc.config.json`.

| Service    | Port  | Remarque                                                             |
| ---------- | ----- | -------------------------------------------------------------------- |
| API        | 4100  | écoute sur `127.0.0.1` seulement (`server.ts`) ; `API_PORT`          |
| Web        | 3100  | fixé dans `apps/web/package.json` ; relaie `/api/*` vers `API_URL`   |
| PostgreSQL | 55440 | publié sur `127.0.0.1` seulement (`docker-compose.yml`)              |

Doivent rester cohérents : `WEB_ORIGIN` (CORS de l'API) avec l'adresse
réellement servie par le web, et `API_URL` (build du web) avec `API_PORT`.

## Commandes quotidiennes

```bash
pnpm typecheck                                 # tsc dans chaque paquet
pnpm lint                                      # eslint
pnpm format                                    # prettier --check (les docs en sont exclues)
pnpm test                                      # Vitest, tous les paquets
pnpm --filter @missionpilot/api exec vitest run test/factures.test.ts   # un fichier de tests API
pnpm --filter @missionpilot/engines test       # moteurs, avec couverture ≥ 90 %
pnpm --filter @missionpilot/web build          # build de production du web
```

### Tests API et base de test

- Les tests API utilisent la base `<nom>_test` (par défaut `missionpilot_test`),
  créée à la volée sur le même serveur ; `test/global-setup.ts` **supprime et
  recrée le schéma `public`** de cette base à chaque exécution, puis applique
  les migrations. La base de développement n'est jamais touchée.
- **Jamais deux suites API en parallèle** (même base) : un seul `vitest` API à la
  fois, dans toutes les sessions et tous les worktrees qui visent le même
  PostgreSQL. Vitest lui-même exécute les fichiers l'un après l'autre.
- **Pas plus de 3 ou 4 suites API à la fois sur un même PostgreSQL**, même avec des
  bases distinctes (`missionpilot_<id>`) : au-delà, le global-setup peut échouer avec
  l'erreur `53200` (`max_locks_per_transaction`).
- Pour une base de test distincte (deuxième worktree, CI) : fournir
  `DATABASE_OWNER_URL` et `DATABASE_URL` pointant vers une autre base ou un
  autre serveur local ; le nom de base reçoit le suffixe `_test` s'il manque
  (`test/urls.ts`), et le global-setup refuse un nom qui ne finit pas par
  `_test`. Les URL doivent rester sur un hôte local (règle de `loadConfig`).
- **CI GitHub** : `.github/workflows/ci.yml` lance les tests API en quatre
  partitions (`--shard=1/4` à `4/4`, job `api`). Chaque partition tourne sur son
  propre runner, avec son PostgreSQL 16 jetable (`docker run postgres:16-alpine`
  avec `max_locks_per_transaction=256`, port 55440 lié à `127.0.0.1`) : aucune
  partition ne partage donc une base avec une autre. Pour rejouer une partition
  en local, avec une base de test dédiée comme ci-dessus :
  `cd apps/api && npx vitest run --shard=1/4` (remplacer `1` par la partition
  voulue). `CI=true` reproduit le rejeu du runner (voir « Intégration continue »).

## Intégration continue

Workflow `.github/workflows/ci.yml`, nommé « CI ».

- **Déclencheurs** : `pull_request` vers `main` et `workflow_dispatch`
  (lancement manuel). Pas de déclenchement à chaque poussée.
- **Concurrence** : une nouvelle exécution sur la même PR (ou sur la même branche,
  lancée à la main) annule la précédente. Permissions réduites à la lecture du
  contenu ; aucun secret. Les URL de base du job `api` reprennent les valeurs
  publiques de développement, pour un PostgreSQL jetable lié à `127.0.0.1` du runner.
- **Version de Node** : Node 22 dans les deux jobs (`node-version: 22`, dernière version mineure, donc ≥ 22.13 comme l'exige `engines`).
- **Job `qualite`** (20 minutes au plus) : `pnpm install --frozen-lockfile`, puis
  `pnpm typecheck`, `pnpm lint`, `pnpm format`, les tests des moteurs (couverture
  ≥ 90 %), ceux de `shared`, ceux du web.
- **Job `api`** (45 minutes au plus par partition) : quatre partitions
  `--shard=i/4`, `fail-fast: false` (une partition en échec ne coupe pas les autres).
  Le détail est dans « Tests API et base de test ».
- **Rejeu** : `apps/api/vitest.config.ts` met `retry: 1` seulement si la variable
  `CI` est définie (GitHub Actions la définit) ; en local, `retry: 0`.
- **Relancer** : sur la PR, onglet « Checks », puis « Re-run failed jobs » (seules
  les parties en échec repartent). Ou pousser un commit, qui annule l'exécution en
  cours. Ou lancer à la main : onglet « Actions », « CI », « Run workflow » (choisir
  la branche), ou `gh workflow run CI --ref <branche>`. Le lancement manuel suppose
  que `ci.yml` figure sur la branche par défaut (`main`) : à vérifier tant que la
  CI n'y est pas fusionnée.
- **État** : la CI n'a jamais été exécutée sur GitHub à la livraison du lot 8a. Les
  vérifications faites en local portent sur la syntaxe et le schéma du workflow, les
  commandes du job `qualite` et une partition (`--shard=1/4` avec `CI=true`). À
  vérifier sur la première PR qui l'introduit, puis corriger au besoin. Une
  partition a été mesurée à environ 19 minutes sur une machine chargée : la limite
  de 45 minutes est à revoir après la première exécution réelle.
- **Hors dépôt** (réglage GitHub, à faire par l'utilisateur) : après une première
  exécution verte, déclarer `qualite` et les quatre partitions `api (partition i/4)`
  comme contrôles requis dans la protection de la branche `main`.

## Bus d'agents

`.agent-bus/` (racine du checkout principal, commun à tous les worktrees,
ignoré par git, surchargeable par `AGENT_BUS_DIR`) porte les anomalies et le
journal des révisions échangés entre développement et recette :

```bash
node scripts/agent-bus.cjs help
node scripts/agent-bus.cjs list --state "prêt au retest"
```

## Worktrees git (`.claude/worktrees/*`)

Un `git worktree` n'a pas ses propres dépendances installées : les hooks git
(Lefthook, lint-staged) et les commandes du projet y échouent tant qu'elles ne
sont pas résolvables. Avant tout `git commit` dans un worktree, lancer
`pnpm install` dans le worktree (choix par défaut, toujours sûr).

Un lien vers les dépendances du checkout principal (sous Windows, une
jonction : `mklink /J "<worktree>\node_modules" "<checkout principal>\node_modules"`)
évite une installation, mais seulement pour des outils qui suivent les liens
sans vérifier où ils mènent (hooks git, lint, typecheck). Il est à proscrire
pour `apps/web` : Next.js 15 (`next dev` / `next build`) et Turbopack refusent
un `node_modules` situé hors de la racine du projet. Avec pnpm, `node_modules`
de chaque paquet (`apps/*`, `packages/*`) contient des liens vers le magasin :
une jonction globale désynchronise aussi ces liens quand les deux checkouts sont
sur des révisions différentes. Pour les tests API d'un worktree : base de test
distincte (voir « Tests API et base de test »), jamais en parallèle d'une autre
suite sur la même base. Le worktree utilise le Node de la machine : Node 22.13 ou plus
(sinon `pnpm install` y refuse de s'exécuter).

## Dépannage

### Hooks Lefthook

`.lefthook.yml` déclare un hook `pre-push` (`scripts/pre-push-guard.cjs`) qui
refuse une poussée vers une branche protégée (`git.protectedBranches`
d'`acc.config.json`). Un refus se corrige (passer par une branche puis une
PR), il ne se contourne pas. `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor` vérifie que les hooks
sont installés.

**Symptôme :** `node scripts/install-git-hooks.cjs` répond « Lefthook
introuvable : hooks git non installés » (code 0). **Cause :** dépendances non
installées (`node_modules` absent, par exemple dans un worktree neuf).
**Correctif :** `pnpm install` (le script `prepare` relance l'installation des
hooks), ou `node scripts/install-git-hooks.cjs` ensuite. État vérifié le
2026-10-06 : le binaire `lefthook` est dans `node_modules/.bin` et le hook
`pre-push` est présent dans `.git/hooks`.

### Autres pannes connues

- **Relation ou fonction 2FA introuvable** (erreur 500 sur les requêtes
  authentifiées ; l'erreur PostgreSQL cite `utilisateurs_2fa`, `defis_2fa` ou
  `etat_tfa_session`) : migrations `0050`–`0052` non appliquées sur la base
  utilisée. Correctif : `pnpm db:migrate`, puis relancer l'API.
- **`pnpm install` échoue (« Unsupported engine », moteur incompatible)** : la version de
  Node est inférieure à 22.13 (`engines.node` du `package.json` racine). Installer Node 22.13
  ou plus (`node -v` pour vérifier), puis relancer `pnpm install`. Les PDF exigent
  Node ≥ 22 (`unpdf` 1.8.1), l'OCR Node ≥ 22.13 (modèle de permissions) ; la surveillance
  mémoire complète du worker d'import exige Node ≥ 22.16, sinon seule la surveillance du RSS joue.
- **L'écran ne se met plus à jour après une écriture, ou un lien du menu reste sans effet pendant plusieurs secondes**
  (A-04, R-01, R-02) : défaut du React embarqué par Next 15.5.28 (réveil perdu sous une frontière `Suspense`),
  contourné par le composant `DebloqueurRendu`, monté dans `apps/web/src/app/layout.tsx`. Si le symptôme revient
  (typiquement après une montée de `next` ou de `react`) : vérifier que le composant est toujours monté
  (`rg -n "DebloqueurRendu" apps/web/src/app/layout.tsx` rend 2 lignes), puis refaire une écriture sur un onglet au premier
  plan avec un build de production (`pnpm --filter @missionpilot/web build`, puis `start`) : la donnée doit apparaître
  en moins d'une seconde. Ne pas ajouter de minuterie ni de rechargement pour « forcer » l'affichage. Le diagnostic et
  la cause sont dans `docs/workflows/notes-lots/lot-13a.md` ; le composant est à revoir à chaque montée de Next ou de React.
- **Port occupé** (`EADDRINUSE` sur 4100 ou 3100 ; PostgreSQL : le conteneur ne
  démarre pas sur 55440) : une ancienne instance tourne encore. Identifier le
  processus (`netstat -ano | findstr :4100` sous Windows), l'arrêter, relancer.
  Changer `API_PORT` impose de reconstruire le web (`API_URL`).
- **L'API refuse de démarrer** : lire le message de `loadConfig` (il ne cite
  jamais de secret). Causes : `NODE_ENV` oublié avec une base non locale ;
  valeur de développement conservée hors développement ; `TFA_MASTER_KEY` égal à
  `SESSION_SECRET` ; `SMTP_HOST` absent ou `SMTP_TLS=aucun` en production ;
  `SMTP_USER` sans `SMTP_PASS` ; `STORAGE_DIR` absent ou relatif ;
  `CHROMIUM_PATH` relatif ou inexistant ; `OPENROUTER_BASE_URL` en HTTP hors
  boucle locale ; `CONNEXION_RAPIDE_DEMO=oui` hors développement local (la voie hors local est `DEMO_PUBLIQUE=oui`).
- **Bloc « Comptes de démonstration » absent** : l'API ne tourne pas avec
  `CONNEXION_RAPIDE_DEMO=oui` (relancer l'API), ou elle est injoignable par le
  web (`API_URL`). Bloc présent mais vide : lancer `db:seed-demo` sur la base
  utilisée ; groupe « Espace client » vide : lancer `db:seed-demo-portail`.
- **Démonstration « un clic » absente** (aucun bloc « Mode démonstration » sur `/connexion`) : `GET /api/auth/demo` répond 404 tant que ni
  `CONNEXION_RAPIDE_DEMO=oui` (local) ni `DEMO_PUBLIQUE=oui` n'est défini pour l'API ; sur un serveur, `DEMO_PUBLIQUE` doit être dans
  `missionpilot.env` ET l'API recréée (`mp up -d --force-recreate api web`). `GET /api/auth/demo` en 200 mais liste vide : aucun
  cabinet `est_demo` actif (lancer `db:seed-defaut`, ou `--confirmer-demo` sur le serveur ; ou le cabinet a été désactivé dans la
  console). Le bloc n'apparaît qu'après un 200 : le web lit la liste à chaque affichage, sans reconstruction.
- **Un compte de démonstration manque dans la liste « un clic »** : depuis `0583`, `GET /api/auth/demo` ne liste pas les comptes dont
  la 2FA est active ou obligatoire (politique du cabinet pour leurs rôles, du portail, ou plancher `TOTP_REQUIS=oui`, qui vide
  TOUTE la liste des comptes de cabinet et du portail). Ce n'est pas une panne : retirer la variable sur un serveur de démonstration,
  désactiver la 2FA du compte, ou se connecter par le formulaire (adresse, mot de passe, code à 6 chiffres).
- **Un compte de démonstration refuse le clic (403 `CONNEXION_RAPIDE_2FA`)** : le compte n'est plus listé mais reste connu (une
  liste web ancienne, ou un appel direct) et sa 2FA est active ou obligatoire. Règle : « listé implique trouvable », la réciproque est
  fausse. Même remède que ci-dessus.
- **Super admin : 401 « E-mail ou mot de passe incorrect »** : adresse ou mot de passe faux, compte inactif, ou, pour le super admin de
  démonstration, démonstration inactive (son mot de passe public est alors refusé). Dix échecs en 15 minutes sur la même adresse
  bloquent la connexion (429) ; aucun outil de déblocage pour un super admin, attendre la fin de la fenêtre. Console qui ramène à
  `/plateforme/connexion` : cookie `mp_plateforme` absent ou session expirée (8 h).
- **Un compte d'un cabinet désactivé ne se connecte plus** : normal (`cabinets.actif`). Le réactiver dans la console `/plateforme`.
- **`DATABASE_URL doit utiliser le rôle missionpilot_app`** (migrations) :
  l'URL applicative pointe vers un autre rôle.
- **Erreurs de connexion à PostgreSQL** juste après `pnpm db:up` : le conteneur
  n'est pas encore « healthy » ; attendre quelques secondes.
- **Le web répond 404 ou 502 sur `/api/*`** : `API_URL` est figée au build de
  Next ; la corriger puis reconstruire (`pnpm --filter @missionpilot/web build`)
  ou relancer `next dev`. Vérifier aussi que l'API tourne.
- **Build web** : `next build` échoue avec un `node_modules` partagé par
  jonction (voir « Worktrees ») ; `pnpm install` dans le dossier concerné.
- **Cookie de session absent après connexion** : `WEB_ORIGIN` ne correspond pas
  à l'origine réellement utilisée par le navigateur (CORS avec credentials), ou
  accès en HTTP à un serveur configuré `production` (cookie `secure`).
- **Toute action (enregistrer, se connecter…) répond 403 `ORIGINE_REFUSEE`**
  alors que les lectures passent : le navigateur ouvre le web à une adresse
  différente de `WEB_ORIGIN` (autre nom d'hôte, IP au lieu du nom, autre port,
  `http` au lieu de `https`). La garde d'origine d'`app.ts` compare l'en-tête
  `Origin` des POST, PUT, PATCH et DELETE à `WEB_ORIGIN`. En production,
  corriger `WEB_ORIGIN` pour qu'il soit exactement l'adresse publique du web,
  puis redémarrer l'API. En développement et en test, `localhost`,
  `127.0.0.1` et `[::1]` au même port sont équivalents ; un autre port ou un
  autre nom reste refusé.
- **Rapport PDF : 503** : aucun navigateur trouvé. Hors développement Windows
  (où Chrome installé est repris), définir `CHROMIUM_PATH` (chemin absolu d'un
  Chrome ou Chromium existant ; l'API refuse de démarrer si le chemin est faux).
  503 `RENDU_OCCUPE` : deux rendus en cours, ou déjà un pour ce cabinet ;
  réessayer. 504 : rendu de plus de 30 s. Le relais Next attend jusqu'à 90 s
  (`experimental.proxyTimeout`). Word et PowerPoint n'ont pas besoin de Chrome.
- **Chrome sous Linux** (non essayé) : l'API ne passe pas `--no-sandbox`. Faire
  tourner l'API sous un utilisateur **non root** sur un noyau qui autorise les
  espaces de noms utilisateur (ou fournir la sandbox SUID de Chromium) ; ne pas
  ajouter `--no-sandbox` sans décision écrite (`docs/governance/SECURITY.md`
  §8 bis).
- **Téléversement : 503 `FICHIERS_OCCUPE`** : 4 réceptions de fichiers sont déjà
  en cours sur cette instance (constante `FICHIERS_ANALYSES_SIMULTANEES_MAX` de
  `routes/fichiers.ts`, pas une variable d'environnement) ; réessayer.
- **Questionnaire : 409 `DATE_LIMITE_DEPASSEE`** : la date limite de l'envoi est
  passée ; le cabinet la repousse (ou la retire) pour rouvrir la soumission.
- **Plan : 409 `NOTATION_NON_PUBLIEE`** : le diagnostic ne se lie qu'à une version
  de notation publiée du même client.
- **PDF de facture** (`GET /api/factures/:id/pdf`) et rapports de notation et de
  plan : mêmes prérequis et mêmes 503 que le rapport PDF ci-dessus (Chrome,
  `CHROMIUM_PATH`, `RENDU_OCCUPE`). Un rapport de notation exige une version
  publiée.
- **Saisies de temps rejouées (hors ligne)** : l'en-tête `Idempotency-Key` évite
  d'écraser une saisie plus récente ; 409 `CLE_IDEMPOTENCE_REUTILISEE` si la même
  clé sert pour une autre feuille ou un autre contenu.
- **Import Excel : 503 `IMPORT_EXCEL_OCCUPE`** : deux lectures de classeur sont
  déjà en cours sur cette instance ; réessayer. 409 `IMPORT_CONCURRENT` : une
  feuille de temps a été saisie pendant l'import ; relancer la simulation.
- **Tests de volume lents ou en échec** (`plan-de-charge-perf.test.ts`,
  `finance-indicateurs-perf.test.ts`) : seuils de temps sensibles à la charge de
  la machine (autre suite, antivirus, Docker). Relancer le fichier seul avant
  d'y voir une régression.
- **Tests API qui échouent en désordre ou « relation does not exist »** :
  deux suites API ont tourné en même temps sur la même base de test (le
  global-setup recrée le schéma). Arrêter l'une, relancer l'autre.
- **Compte de démonstration refusé** : le seed n'a pas été lancé sur la base
  migrée, ou l'e-mail ne reprend pas la forme `<role>@demo.missionpilot.test`.
- **Canaux ou redressement de démonstration absents** : sous-semis non lancé sur
  cette base (voir « Canaux simulés et redressement de démonstration »). Les canaux
  exigent d'abord les comptes du portail et les comptes 2FA.
