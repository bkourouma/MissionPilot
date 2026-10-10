# Modèle de menace — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les mécanismes de sécurité **tels qu'implémentés
aujourd'hui** (état de la branche `feat/vague-2-automatisation`, 2026-10-08,
V1 et V2, vagues 0 et 1, lots des vagues 2 et 3 : automatisation, clôture, salle
de mission, appels d'offres, capitalisation, notation et plans augmentés, pilotage
des KPI ; ces derniers lots sont dans l'arbre de travail, non commités), avec leur
fichier, pas un objectif. Il est lu par l'agent `security-auditor` et par
`/audit` : chaque contrôle listé ici doit pouvoir se vérifier dans le code. Les
chemins sont relatifs à la racine du dépôt ; `routes/`, `auth/`, `ia/`… sont
sous `apps/api/src/`. La numérotation des sections est citée ailleurs (code,
migrations, autres documents) : les ajouts des vagues suivantes sont des
sections « bis », « ter », « quater »… ; les nombres de ce document (routes,
tables, lignes de `GRANT EXECUTE`) ont été relevés le 2026-10-08 dans cet arbre
de travail.

## 1. Actifs à protéger

- **Données financières d'un cabinet** : honoraires, budgets, factures,
  encaissements, relances, indicateurs, export comptable (`finance/`,
  `facturation/`).
- **Données internes confidentielles (FIN-02)** : coûts journaliers
  (`collaborateur_couts`), grilles de taux (grades, clients, propositions) et
  marges. Réservées aux associés et gestionnaires (permission `finance.lire`).
- **Coordonnées bancaires du cabinet** (IBAN, banque) : leur modification
  détourne des paiements (`routes/parametres-facturation.ts`).
- **Secrets d'authentification** : secrets TOTP, codes de secours, jetons de
  session, hachés de mots de passe.
- **Identité légale des clients** (RCCM, compte contribuable) et contacts.
- **Journal d'audit** et historiques immuables (budget figé, factures émises,
  notations publiées, mesures KPI, contenus validés).
- **Données des entreprises clientes (V2)** : réponses aux questionnaires,
  notations, plans stratégiques et modèle financier (états prévisionnels,
  masse salariale), KPI et mesures saisies par le client.
- **Comptes du portail client** (§4 bis) : une fuite entre deux clients d'un
  même cabinet est une fuite de données d'entreprise.
- **Clé API OpenRouter du cabinet** (chiffrée) et **budget IA** (plafonds) :
  une clé substituée détournerait les contenus envoyés vers un autre compte
  (§7 bis).
- **Rapports générés** (PDF, Word, PowerPoint) et leur niveau de
  confidentialité (§8 bis).
- **Pièces déposées par le client** dans la salle de mission (§8 septies) et
  **CV des experts** de la banque des appels d'offres (§6) : contenus de tiers
  et données personnelles (parcours, diplômes, nationalité facultative).
- **Définitions d'automatisation** (§5 quinquies) : elles s'exécutent sous
  l'identité et les droits d'une personne du cabinet ; les altérer ou les
  déclencher à tort revient à agir au nom de cette personne.
- **Évaluations individuelles** : niveaux de compétence déclarés et validés des
  collaborateurs (§5 sexies).

## 2. Acteurs et frontières de confiance

| Frontière                       | Mécanisme                                              | Fichier                                             |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Cabinet ↔ cabinet               | RLS PostgreSQL + FK composites (§4)                    | `apps/api/migrations/`, `apps/api/src/db/pool.ts`   |
| Rôle ↔ rôle dans un cabinet     | Permissions par rôle (§5)                              | `packages/shared/src/roles.ts`                      |
| Utilisateur ↔ mission           | Règle de visibilité des missions                       | `missions/acces.ts`                                 |
| Client ↔ cabinet, client ↔ client | Liste blanche de routes + contexte RLS du portail (§4 bis) | `portail/garde.ts`, `portail/contexte.ts`, `migrations/0110`–`0115` |
| Navigateur ↔ API                | Cookie de session httpOnly, relais `/api` du web, garde d'origine (§11) | `auth/ouvrir-session.ts`, `app.ts`, `apps/web/next.config.mjs` |
| API ↔ base                      | Rôle applicatif non propriétaire, sans BYPASSRLS       | `db/migrate.ts`, `migrations/0001_socle.sql`        |
| API ↔ SMTP                      | TLS vérifié, STARTTLS sans repli en clair              | `notifications/smtp.ts`                             |
| API ↔ OpenRouter                | URL de configuration seule, HTTPS, masquage, plafonds (§7 bis) | `ia/fournisseur.ts`, `ia/orchestrateur.ts`  |
| API ↔ Chrome headless           | JavaScript coupé, requêtes interceptées, profil jetable (§8 bis) | `rapports/pdf.ts`                         |
| Automatisation ↔ identité       | Actions dans les droits actuels du responsable, garde du moteur, coupe-circuits (§5 quinquies) | `automatisation/`, `migrations/0300`–`0302` |
| Client → cabinet (dépôt de pièces) | Une seule route d'écriture du portail, plafonds, type détecté par le contenu (§8 septies) | `salle-mission/`, `migrations/0330`–`0332` |

Acteurs réels (rôles de `packages/shared/src/roles.ts`) :

- **Cabinet** (`ROLES`) : associé, directeur de mission, chef de mission,
  consultant, responsable des ressources, gestionnaire administratif et
  financier, expert métier, expert externe. Seuls l'associé (toutes les
  permissions du cabinet) et le gestionnaire possèdent `finance.lire`. Le
  `directeur_mission` détient `budget.reviser`, `facture.valider` et
  `debours.valider`, mais pas `finance.lire`. Les permissions `plan.*` et
  `kpi.*` ne sont données ni aux ressources ni au gestionnaire (masse salariale
  et états du client, commentaire de `PERMISSIONS`).
- **Portail client** (`ROLES_CLIENT`, V2) : dirigeant client, contributeur
  client, investisseur (profil seulement, V3). Famille disjointe des rôles du
  cabinet, permissions `portail.*` seulement (§4 bis).
- **Permissions des vagues 2 et 3** (`packages/shared/src/roles.ts`, test
  `roles.test.ts`) : `automatisation.lire` (associé, directeur de mission, chef
  de mission) et `automatisation.gerer` (associé, directeur) ; `salle.lire`
  (associé, directeur, chef, consultant, expert métier) et `salle.gerer` (les
  mêmes sauf l'expert métier) ; `ao.lire` (associé, directeur, chef, consultant,
  gestionnaire, expert métier), `ao.gerer` (associé, directeur, chef,
  consultant) et `ao.decider` (associé seul) ; `connaissance.lire` (associé, directeur, chef, consultant, expert
  métier), `competence.gerer` et `competence.lire` (associé, directeur de
  mission, ressources) ; `portail.salle.deposer` (client dirigeant et client
  contributeur seulement, jamais un rôle du cabinet). Le gestionnaire n'a que
  `ao.lire` (offre financière, §6) ; l'expert externe n'en a aucune.

Menaces visées : un cabinet qui lit ou écrit chez un autre ; un utilisateur du
portail qui lit les données internes du cabinet ou celles d'un autre client ;
un utilisateur interne qui voit des coûts/marges sans droit ; un collaborateur
qui valide son propre travail ; un contenu IA ou un chiffre inventé qui atteint
le client sans validation ; falsification d'une facture émise, du journal,
d'une période clôturée ou d'une notation publiée ; vol de session ou de secret
depuis une fuite de base ; force brute sur mot de passe ou code 2FA ; fichier
piégé (PDF actif, classeur Excel piégé) ; déni de service par calcul ou rendu
coûteux ; injection SQL, CSV, e-mail ou HTML.

## 3. Authentification

- **Mots de passe** : scrypt (N = 16384, sel de 16 octets, 64 octets de clé),
  comparaison en temps constant ; un hachage factice est calculé quand l'e-mail
  est inconnu, pour égaliser le temps de réponse (`auth/password.ts`,
  `routes/auth.ts` `POST /connexion`).
- **Session** : jeton aléatoire de 32 octets, **seul son SHA-256 est stocké**
  (`sessions.jeton_hash`) ; durée 12 h (`auth/session.ts`). Cookie
  `mp_session` : `httpOnly`, `sameSite=lax`, `secure` hors développement et test
  (`auth/ouvrir-session.ts`, `config.ts` `cookieSecurise`). La session est
  résolue dans le crochet `onRequest` d'`app.ts` par la fonction
  `resoudre_session` (utilisateur actif et session non expirée).
- **Limiteur de tentatives** : persistant et partagé entre instances (table
  `tentatives_auth`, migration `0120`). Le rôle applicatif n'a aucun droit sur
  la table (RLS sans politique, privilèges retirés) et passe par trois
  fonctions `SECURITY DEFINER` : `reserver_tentative_auth`,
  `liberer_tentatives_auth`, `debloquer_tentatives_auth`. Règles fixées en
  base par espace (`tentatives_auth_regles`), jamais par l'appelant :
  `connexion`, `reauth` (mot de passe redemandé) et `facteur` (tout code de
  second facteur), 10 essais par fenêtre **glissante** de 15 min, 1 000 000
  de clés par espace. Clé = empreinte **HMAC-SHA-256** de l'e-mail normalisé,
  clé dérivée par HKDF de `TFA_MASTER_KEY` (usage `limiteur`) : ni l'e-mail en
  clair ni l'adresse IP ne sont stockés. Tentative réservée sous verrou de ligne
  avant le calcul coûteux. Espace plein : seule une clé expirée ou à moins de
  50 % du plafond dans la fenêtre est évincée ; si toutes sont protégées, la
  nouvelle clé est refusée (`auth/limiteur.ts`). Horloge de la base ; le
  réglage `app.horloge_test` n'est honoré que dans une base dont le nom finit
  par `_test` (preuve : `auth-limiteur-horloge.test.ts`, qui rejoue la fonction
  dans une base temporaire hors `_test`). Une rotation de `TFA_MASTER_KEY` remet les compteurs à zéro (au
  plus une fenêtre). Test : `auth-limiteur.test.ts`.
- **Déblocage de connexion** : `POST /api/cabinet/utilisateurs/:id/debloquer-connexion`
  (`cabinet.gerer`, 404 avant reconfirmation pour un utilisateur d'autrui,
  reconfirmation, journal `deblocage_connexion`) n'efface que l'espace
  `connexion`, jamais `facteur` (`routes/limiteur-admin.ts`).
- **TOTP (RFC 6238 / 4226)** : HMAC-SHA-1, 6 chiffres, pas de 30 s, fenêtre
  ±1, comparaison en temps constant, anti-rejeu par dernier pas accepté et
  verrou `FOR UPDATE` (`auth/totp.ts`, `auth/double-authentification.ts`).
- **Chiffrement des secrets** : AES-256-GCM, nonce de 96 bits, AAD liant le
  chiffré à sa ligne, clés dérivées par HKDF-SHA-256 de `TFA_MASTER_KEY`, une
  clé par usage (`totp`, `codes_secours`, `file_email`, `limiteur` pour
  l'empreinte du limiteur, `ia_cle_api`, `ia_entree`), version de clé stockée
  pour la rotation (`TFA_MASTER_KEY_PRECEDENTE`) ; `auth/chiffrement.ts`.
- **Codes de secours** : 10 codes, stockés en empreinte HMAC à clé dérivée,
  usage unique par `UPDATE` atomique (`auth/double-authentification.ts`).
- **Défi de connexion 2FA** : jeton à usage unique, 5 min, haché en base,
  5 tentatives par défi ; blocage progressif persistant après échecs
  consécutifs (5 → 1 min, 8 → 15 min, 12 → 1 h) avec alerte e-mail à 8 et 12
  (`routes/auth.ts`, `double-authentification.ts` `dureeBlocageMs`).
- **2FA obligatoire** : politique par cabinet (`cabinets.tfa_obligatoire`,
  rôles `associe`, `directeur_mission`, `gestionnaire`), plancher plateforme
  `TOTP_REQUIS=oui` et, pour le portail, `portail_parametres.tfa_obligatoire`
  appliquée par la garde du portail (`portail/garde.ts`). Le crochet
  `preHandler` d'`app.ts` répond `403 TFA_A_CONFIGURER` à tout utilisateur
  concerné sans 2FA, sauf sur `/api/sante`, `/api/auth/*`,
  `/api/invitations/accepter` et `/api/portail/invitations/accepter`
  (`routeLibreSans2fa`, le motif de route est comparé, jamais l'URL brute).
- **Reconfirmation d'identité** (mot de passe + second facteur) avant :
  désactivation de sa 2FA, régénération des codes de secours, politique 2FA du
  cabinet, réinitialisation de la 2FA d'autrui, coordonnées bancaires, clé API
  IA du cabinet (définir ou retirer) et hausse du plafond IA
  (`routes/ia-parametres.ts`), déblocage de connexion
  (`routes/limiteur-admin.ts`), politique 2FA du portail
  (`routes/portail-gestion.ts`), raccourcissement de la durée de conservation
  des rapports (`routes/rapports.ts`, contexte `conservation_rapports`) et
  anonymisation d'un CV de la banque des appels d'offres
  (`routes/banque-ao.ts`, contexte `anonymisation_cv`, `cabinet.gerer`) ;
  `auth/confirmer-identite.ts`. Pour l'IBAN, la clé et le plafond IA, le
  déblocage, la conservation des rapports et l'anonymisation d'un CV, un
  utilisateur sans 2FA active confirme par mot de passe seul
  (`motDePasseSeulSiInactive`) ; le journal le note.
- **Réponses sensibles** (défi, secret TOTP, codes de secours, paramètres IA) :
  `cache-control: no-store` (`routes/auth.ts` `sansCache`,
  `routes/ia-parametres.ts`). Le secret TOTP n'est remis qu'une fois, à
  l'initialisation.
- **Invitations internes** : jeton haché, expirant, inutilisable si l'inviteur
  n'est plus un associé actif ; `resoudre_invitation` n'accepte plus que les
  invitations sans client (`0112`).
- **Invitations du portail** : jeton haché, 7 jours ; résolues par
  `resoudre_invitation_portail` (`0112`) : jeton valide non consommé, client
  actif, rôles client seulement, auteur encore actif **et encore habilité pour
  ce client à l'acceptation** (associé, directeur de mission, ou chef de
  mission qui dirige encore une mission du client). Rôles et client viennent de
  la base, jamais du corps. À la création : 409 si une invitation interne ou au
  portail d'un autre client est en attente pour l'e-mail, alerte de tous les
  associés à chaque invitation (`routes/portail-gestion.ts`).
- **Connexion rapide de démonstration** (recette humaine locale,
  `routes/connexion-demo.ts`) : session **sans mot de passe**, traitée comme
  une porte dérobée potentielle. Garde-fous : désactivée par défaut ; les
  routes n'existent (sinon 404) que si `CONNEXION_RAPIDE_DEMO=oui` **et**
  `NODE_ENV` local (jamais `production`) **et** les deux URL de base locales
  (`connexionRapideDemoActive`, revérifié à l'enregistrement) ; `oui` dans un
  autre contexte fait refuser le démarrage (`verifierConnexionRapideDemo`,
  `config.ts`). `GET /api/auth/comptes-demo` (publique) ne renvoie que e-mail,
  nom et rôles (au plus 50) des comptes actifs en `@lagune-conseil.test` du
  cabinet « Lagune Conseil & Associés (démo) » titulaire du compte fondateur
  `associe@lagune-conseil.test` (retrouvé par `trouver_connexion` : aucune
  nouvelle fonction en base) ; jamais un autre cabinet, même homonyme ou du
  même domaine. Elle couvre aussi les comptes du **portail client de
  démonstration** (`db/seed-demo-portail.ts`, rôles client), mêmes garde-fous :
  même filtre (domaine, cabinet de démo) et, en plus, un rattachement actif à
  un client actif ; refus 2FA y compris pour la politique 2FA du portail ; la
  session ouverte reste soumise à la liste blanche du portail
  (`PORTAIL_ROUTE_INTERDITE`). `POST /api/auth/connexion-demo`
  réserve d'abord une tentative du limiteur `connexion` (compteur partagé avec
  le mot de passe), répond le même 401 `COMPTE_DEMO_INCONNU` pour tout e-mail
  hors de cette liste, **refuse (403 `CONNEXION_RAPIDE_2FA`) tout compte dont
  la 2FA est active ou obligatoire** (politique du cabinet ou `TOTP_REQUIS`),
  puis ouvre la session comme `POST /connexion` (session hachée, cookie
  httpOnly, `no-store`, audit `connexion` avec `demo: true`). Garde d'origine
  et crochet 2FA d'`app.ts` inchangés (motifs sous `/api/auth/*`). Le web
  (`app/connexion/`) lit la liste côté serveur et n'affiche le bloc que sur une
  réponse 200 (`lib/connexion-demo.ts`). Risque : §15. Test :
  `test/connexion-demo.test.ts`, `test/config.test.ts`.

## 4. Isolation entre cabinets et cloisonnement des données

- **Contexte de cabinet** : `withTenant(cabinetId, fn)` ouvre une transaction,
  valide l'UUID, puis `SELECT set_config('app.cabinet_id', $1, true)` (portée
  transaction : le contexte ne fuit pas) ; `apps/api/src/db/pool.ts`. Aucune
  requête métier ne s'exécute hors `withTenant` ou `withoutTenant`. Pendant une
  requête du portail, `pool.ts` pose aussi le contexte du portail à chaque
  transaction (§4 bis).
- **RLS** : chaque table portant `cabinet_id` (et `cabinets`) a
  `ENABLE ROW LEVEL SECURITY` et une politique `isolation` (`USING` et
  `WITH CHECK` sur `app_cabinet_id()`), voir `migrations/0001_socle.sql` puis
  chaque migration de table. Sans contexte, aucune ligne n'est visible (échec
  sûr). Tests d'inventaire : `apps/api/test/isolation.test.ts` (« toute table
  portant cabinet_id (ou cabinets) a RLS activée et une politique », « toute
  table lisible par le rôle applicatif a RLS activée », et les deux tests du
  portail cités au §4 bis).
- **Rôle applicatif** `missionpilot_app` : créé `NOSUPERUSER NOBYPASSRLS`,
  non propriétaire des tables (`db/migrate.ts`) ; les migrations tournent avec
  le rôle propriétaire (`DATABASE_OWNER_URL`). Les privilèges par défaut ne
  donnent que SELECT/INSERT/UPDATE/DELETE ; les `REVOKE` sont décrits en §6.
  Test : `isolation.test.ts` « le rôle applicatif n'est ni superutilisateur,
  ni BYPASSRLS, ni propriétaire des tables ».
- **Fonctions accordées au rôle applicatif** (`GRANT EXECUTE`, toutes
  `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE ALL … FROM
  PUBLIC`) : `trouver_connexion`, `resoudre_session`, `resoudre_invitation`,
  `creer_cabinet`, `reserver_job` (`0001`) ; `date_temps_cloturee`,
  `reserver_job_a`, `planifier_job_cabinets`, `liberer_jobs_bloques`
  (`0030`) ; `resoudre_defi_2fa` (`0050`) ; `etat_tfa_session` (`0052`) ;
  `planifier_relances_factures` (`0061`) ; `planifier_purge_fichiers`
  (`0073`) ; `resoudre_invitation_portail` (`0112`, qui redéfinit aussi
  `resoudre_invitation`) ; `notification_existe` (`0114`) ;
  `portail_kpi_mission_cloturee` (`0115`) ; `reserver_tentative_auth`,
  `liberer_tentatives_auth`, `debloquer_tentatives_auth` (`0120`) ;
  `planifier_suivi_kpi` (`0160`) ; vague 0 : `purger_textes_ia` et
  `planifier_conservation_ia` (`0104`), `planifier_purge_rapports` (`0132`) ;
  vagues 2 et 3 : `planifier_detection_automatisation` (`0302`, clé de job
  `automatisation_detection:AAAA-MM-JJ` imposée, une tâche par cabinet ayant une
  automatisation sur un événement détecté), `octets_stockage_utilises` (`0331`,
  redéfinie en `SECURITY DEFINER`, bornée à `app_cabinet_id()` : la somme d'une
  transaction du portail verrait sinon seulement les fichiers de son client et
  sous-estimerait le quota ; ne renvoie qu'un nombre au code serveur) et
  `anonymiser_cv_ao` (`0386`, bornée au cabinet du contexte, refusée dans une
  transaction du portail, CV déjà anonymisé : `MPW06`).
  `purger_textes_ia` n'agit que sur le cabinet du contexte ; `ia_demandes_purgeables`
  (`0104`) n'est exécutable que par le propriétaire. Liste reproductible :
  `rg -n "GRANT EXECUTE" apps/api/migrations` (20 lignes au 2026-10-08). Certains déclencheurs de contrôle
  sont aussi `SECURITY DEFINER` pour lire hors visibilité RLS (`0010`, `0013`,
  `0043`, `0060`…). `reprendre_relances_questionnaire` (`0148`) n'est pas
  `SECURITY DEFINER` et n'est exécutable que par le propriétaire.
- **Clés étrangères composites** `(cabinet_id, id)` : une ligne ne peut pas
  référencer une ligne d'un autre cabinet, même avec un identifiant valide
  (par exemple `0005_grades_collaborateurs.sql`, `0043_factures.sql`).
- **Référence d'autrui = inexistante** : une mission invisible ou d'un autre
  cabinet répond 404 comme une mission inexistante
  (`missions/acces.ts` `exigerMissionVisible`) ; même principe pour les
  échéances (`routes/echeancier.ts`), les générations IA, les notations, les
  plans et le portail (404 uniforme, §4 bis).
- **Suppression** : `REVOKE DELETE ON cabinets, utilisateurs` pour le rôle
  applicatif, afin que les actions `ON DELETE CASCADE` ne puissent pas effacer
  le journal (`0008_durcissement.sql`).

## 4 bis. Portail client (SOC-09)

Défense en deux barrières indépendantes : l'application (liste blanche,
permissions `portail.*`) et la base (politiques RESTRICTIVES posées quel que
soit le code appelant).

- **Rôles disjoints** : `client_dirigeant`, `client_contributeur`,
  `client_investisseur` ne se cumulent jamais avec un rôle du cabinet (CHECK
  `utilisateurs_roles_check` et `invitations_roles_famille`) et un utilisateur
  ne change jamais de famille (déclencheur, `MPP01`) ; `0110`. Ils ne
  détiennent que des permissions `portail.*`, qu'aucun rôle interne n'a
  (`PERMISSIONS_PORTAIL_CLIENT`, `roles.ts`). Un utilisateur du portail ne peut
  être désigné ni dans une équipe, ni chef ou directeur, ni collaborateur, ni
  assignataire d'une tâche, ni contact principal (déclencheur
  `refuser_utilisateur_portail`, 23503, `0113`). Rattachement à un client figé
  (`MPP01`, `0111`).
- **Garde de routes** (`portail/garde.ts`) : liste blanche
  `LISTE_BLANCHE_PORTAIL`, méthode + motif Fastify **exact**, aucun préfixe.
  Crochet `onRequest` : une route enregistrée absente de la liste répond 403
  `PORTAIL_ROUTE_INTERDITE` avant tout accès aux données ; une route inconnue
  garde son 404. Délibérément absentes : politique 2FA du cabinet, gestion du
  portail (`portail.gerer`), `/api/fichiers/:id` (le livrable partagé se
  télécharge par `/api/portail/livrables/:id/fichier`, qui revérifie le
  partage), commentaires, et tout le moteur d'automatisation, la clôture, les
  appels d'offres, la capitalisation, les prévisions et les routes du cabinet de
  la salle de mission. Routes ajoutées en vague 2 : `GET` et `HEAD`
  `/api/portail/salle/demandes`, `GET /api/portail/salle/demandes/:id` et
  `POST /api/portail/salle/pieces/:id/depots`, sous la permission
  `portail.salle.deposer` (§8 septies). Inventaire : `test/portail-acces.test.ts`
  compare chaque route enregistrée à la liste. Les deux routes ajoutées après la
  recette du 2026-10-10, `GET /api/appels-offres/assignables` et
  `GET /api/capitalisation/retours/a-ouvrir`, n'y figurent pas : elles restent
  fermées au portail (403 `PORTAIL_ROUTE_INTERDITE`, §6 AO-A et §5 sexies).
- **Contexte RLS à chaque transaction** (`portail/contexte.ts`) : pour toute
  route listée, la garde range le client rattaché et l'utilisateur ; un
  rattachement désactivé ou un client archivé donne un client **sentinelle**
  (UUID nul, qui ne désigne aucun client). `db/pool.ts` pose alors
  `app.portail_client_id` et `app.portail_utilisateur_id` au début de CHAQUE
  transaction de la requête, `withTenant` comme `withoutTenant`. Exceptions
  (`sansContexte`) : connexion, déconnexion, profil d'authentification, sa
  propre 2FA, acceptations d'invitation ; leurs tables (`sessions`, `*_2fa`,
  `invitations`) sont `portail_interdit`. Seule sortie :
  `horsContextePortail`, employée par deux traitements internes qui ne renvoient
  rien au client : l'évaluation des alertes KPI après une saisie
  (`routes/portail-kpi.ts`) et la suite d'un dépôt de la salle de mission,
  c'est-à-dire l'accusé de réception R0 et l'information de l'équipe, qui lisent
  le coupe-circuit N4 et l'équipe de la mission et n'écrivent que des tables
  internes (`salle-mission/accuses.ts`). `test/portail-contexte.test.ts`
  inventorie les usages (exactement ces deux fichiers) : tout nouvel usage met
  ce test à jour.
- **Politiques RESTRICTIVES** (`0113`, `0114`, `0115`, puis chaque migration
  V2) : `portail_interdit` (rien de visible ni de modifiable) sur les tables
  internes (coûts, taux, budgets, temps, équipe, commentaires, débours…), les
  secrets, `jobs`, toutes les tables `ia_*`, la notation (`0147`), les plans
  (`0180`–`0184`, dont le lien vers une notation et les KPI d'objectif), les
  rapports (`0130`) et leurs paramètres (`0132`), l'historique IA des
  questionnaires (`0149`), les clés d'idempotence des saisies de temps (`0122`),
  les paramètres et alertes KPI ;
  `journal_audit` : écriture seule. `portail` en **lecture** filtrée, doublée de
  `portail_sans_insert`, `portail_sans_update`, `portail_sans_delete` : client,
  missions partagées, jalons partagés, documents partagés au contenu validé et
  leurs fichiers, factures émises ou annulées partagées (lignes, imputations),
  fiche du cabinet, utilisateurs interlocuteurs (soi, contact principal,
  directeurs et chefs des missions partagées, auteurs des questionnaires
  reçus), ses notifications, envois et répondants de questionnaires qui le
  concernent. Tables d'**écriture** du portail (`portail` FOR ALL) :
  `portail_validations_jalons`, `questionnaire_reponses` (sa réponse),
  `kpi_mesures` (politique `origine` : mesure « portail » saisie par un
  contributeur désigné ; écrans web `/portail/kpi`), `salle_depots` (SON dépôt,
  `origine = 'portail'`, déposant = l'utilisateur de la transaction) et
  `salle_piece_evenements` (seul l'événement « reçue » qu'il signe), ces deux
  tables en ajout seul (`0330`, MPL01). En lecture seule pour le portail, avec
  `portail_sans_insert`, `portail_sans_update` et `portail_sans_delete` :
  `salle_demandes` (demandes envoyées ou closes de SON client), `salle_pieces` et
  `salle_accuses` ; `salle_modeles` et `salle_relances` sont `portail_interdit`.
  **Table `fichiers`** (`0331`) : `portail_sans_insert` est remplacée par
  `portail_depot` (insertion dans une transaction du portail seulement si
  `envoye_par` est l'utilisateur du portail) et la politique `portail` de lecture
  admet en plus SES propres fichiers et ceux des dépôts de la salle visibles du
  portail, à côté des livrables partagés ; le contenu n'est jamais servi au
  portail par ces routes, seules les métadonnées (nom, type, taille) sont
  projetées. Tests : `isolation.test.ts` (« toute table à RLS porte
  une politique RESTRICTIVE portail ou portail_interdit », « aucune politique
  du portail n'est permissive »).
- **Fonctions étroites du portail** : `resoudre_invitation_portail` (§3) ;
  `notification_existe` (`0114`, ne révèle que l'existence d'un identifiant
  déjà connu, pour admettre l'insertion d'une notification) ;
  `portail_kpi_mission_cloturee` (`0115`, renvoie seulement « mission
  clôturée » pour un KPI dont l'utilisateur est contributeur désigné, sinon
  NULL).
- **Réponses** (`portail/acces.ts`, `routes/portail.ts`) : chaque route exige
  sa permission `portail.*` et un rattachement actif (`exigerPortail`) ;
  inexistant, d'un autre client, d'un autre cabinet ou non partagé : **même
  404**. Projections explicites, jamais de coût, taux, marge, budget interne,
  équipe, auteur ni nom d'un membre du cabinet hors contact principal. Tout
  accès est journalisé dans la même transaction. **Rien n'est partagé par
  défaut** : le cabinet partage explicitement missions, jalons, factures et
  documents (`portail_partages`, `PUT` par client). `/api/portail/moi` ne
  révèle le nombre de missions, de documents et la présence de factures qu'aux
  rôles qui détiennent la permission de lecture correspondante.
- **Risque accepté** : `mot_de_passe_hash` reste lisible par le rôle
  applicatif, qui le relit pour la reconfirmation d'identité ; dans le
  contexte du portail, seules les lignes d'utilisateurs ci-dessus sont
  visibles et aucune route du portail ne projette cette colonne (en-tête de
  `0114`).

## 5. Autorisations

- **Permissions par rôle** : `PERMISSIONS_PAR_ROLE` et `aPermission` dans
  `packages/shared/src/roles.ts` ; test `packages/shared/src/roles.test.ts`.
  Chaque route appelle `exiger(request, permission?)` (`auth/contexte.ts` :
  401 sans session, 403 sans droit), directement ou par `exigerPortail`. Sur
  673 gestionnaires de route (2026-10-10), seuls `POST /auth/connexion`,
  `/auth/connexion/2fa`, `/auth/deconnexion`, `GET /auth/comptes-demo` et
  `POST /auth/connexion-demo` (démonstration, §3), `GET /sante`,
  `POST /invitations/accepter` et `POST /portail/invitations/accepter` ne
  l'appellent pas (recherche mécanique n° 10 de
  `.claude/rules/review-checklist.md`).
- **Visibilité des missions** : règle écrite en tête de `missions/acces.ts` :
  `mission.lire_toutes` donne tout le cabinet ; sinon seulement les missions
  dont on est directeur, chef ou membre d'équipe. Modifier exige
  `mission.modifier_toutes` ou d'être directeur/chef, et une mission
  clôturée est refusée (409). Le fragment SQL `filtreVisibilite` est réutilisé
  par les requêtes de finance, de facturation, de plan de charge, d'IA, de
  notation et de plans. Les permissions `plan.*`, `kpi.*` et `notation.*`
  s'ajoutent toujours à la visibilité de la mission.
- **Séparation des tâches** : l'auteur ne valide pas son propre travail, sauf
  associé : débours (`facturation/outils.ts`), factures (auteur, soumetteur et
  tous les modificateurs du brouillon exclus, `facturation/factures.ts`),
  contre-passations d'encaissement (`finance/encaissements.ts`), révision de
  budget (directeur de mission), import des temps (l'importateur valide, jamais
  ses propres temps, `temps/import.ts`). V2 :
  - contenu IA : le valideur n'est ni le demandeur ni l'auteur d'aucune
    version, sauf associé ; un contenu lié à une mission est validé par son
    chef, son directeur ou un associé (`ia/generations.ts`) ;
  - questionnaire d'origine IA : le valideur n'est ni le demandeur ni l'auteur
    d'un rang de l'historique, sauf associé (`questionnaires/generation-ia.ts`),
    et la base exige que le dernier rang soit « valide » avant la validation de la
    version (`MPQ08`, `0149`) ;
  - version de grille de notation : validée par un `expert_metier` qui n'en
    est ni l'auteur ni le dernier modificateur (`MPN04`, `0145`) ;
  - notation : publication et renvoi par un `expert_metier` **seulement**, même
    face à un associé sans ce rôle (DECISIONS.md, NOT-07 ; `notation.publier`
    n'est plus dans l'ensemble de l'associé, `RESERVEES_A_UN_ROLE`, `roles.ts`) ;
    le publieur n'est
    ni l'auteur du calcul, ni d'un ajustement, ni de la soumission (`MPN04`,
    `0146` ; `notation/notations.ts`) ;
  - plan stratégique : l'auteur d'un contenu ou d'une version du modèle
    financier ne la valide pas, sauf associé ou directeur de la mission
    (`MPS03`, `plan_valideur_dispense`, `0180`, `0181`) ;
  - clôture de mission : l'auteur d'une dérogation en vigueur ne clôt pas la
    mission, sauf associé (409 `DEROGATION_PAR_CLOTUREUR`, `MPX03`, §8 sexies) ;
  - salle de mission : on n'accepte pas le dépôt qu'on a fait soi-même, sauf
    associé (409 `ACCEPTATION_PAR_DEPOSANT`, `MPL09`, §8 septies) ;
  - appels d'offres : la décision go/no-go est réservée à l'associé (`MPA03`) ;
    le valideur d'une offre technique n'est ni son créateur, ni l'auteur d'une
    version, ni le demandeur d'un brouillon IA, sauf associé (403
    `APPROBATION_REQUISE`, `MPW05`, §6) ;
  - compétences : un niveau ne se valide ni par la personne évaluée, ni par son
    déclarant sauf associé (403 `SEPARATION_DES_TACHES`, `MPJ04`, §5 sexies) ;
  - retour d'expérience : la validation revient à un associé, au chef ou au
    directeur de la mission ET à l'utilisateur de la session (403
    `VALIDATION_RESERVEE`, `MPJ08`) ; **exception voulue**, conforme au PRD : le
    chef peut valider la version IA qu'il a lui-même demandée (« l'IA propose,
    l'expert dispose ») ;
  - confiance d'une notation : qui cumule le rôle `expert_metier` ne modifie pas
    le seuil de confiance qu'il doit franchir en publiant (403
    `SEPARATION_DES_TACHES`, §5 bis) ;
  - automatisations : modifier la définition d'une automatisation active la
    désactive (le responsable ne fait pas exécuter le texte d'un autre sous son
    identité), et lever un coupe-circuit est réservé à l'associé (`MPU02`,
    §5 quinquies).
- **Notifications** (SOC-08) : un utilisateur ne lit et ne marque que les
  siennes, toute requête filtre sur `destinataire_id` et une notification
  d'autrui répond 404 (`routes/notifications.ts`) ; dans le portail, la
  politique `0114` le double. Création par `notifier`
  (`notifications/notifier.ts`) : destinataire actif du même cabinet, texte brut
  (chevrons et caractères de contrôle retirés), titre sur une ligne, lien
  relatif interne vérifié (`lienInterneSur`), aucun montant ni coût dans le
  texte (règle de l'appelant, non contrôlée mécaniquement). Le doublon par
  e-mail, quand il y en a un, part après la transaction (`envoyerEmails`) ou est
  mis en file chiffrée (`notifierAvecEmailEnFile`, §7).
- **Fichiers** : l'accès est décidé par l'entité rattachée, revérifié à chaque
  lecture (§8) ; `fichiers` porte `cabinet_id` avec une politique `isolation`
  (`0070`).
- **Contrôle côté web** : `apps/web/src/middleware.ts` ne teste que la
  présence du cookie (premier filtre) ; la garde réelle est `obtenirSession` /
  `exigerPermission` (`apps/web/src/lib/session.ts`) qui interroge l'API. Le web
  n'est jamais la source de vérité des droits.

## 5 bis. Questionnaires, notation, KPI et plans (V2)

- **Questionnaires** (SOC-10, SOC-11 ; `questionnaires/`, `0140`–`0143`, `0148`–`0150`) :
  rédaction, validation et envoi par `questionnaire.gerer` ; seule une version
  validée s'envoie ; répondants désignés avant l'envoi, dirigeants ou
  contributeurs **actifs du client de la mission** (`MPQ03`) ; une réponse
  soumise est verrouillée (`MPQ04`). Dans le portail, envois et répondants sont
  en lecture seule, le répondant n'écrit que sa réponse et les saisies sont
  sérialisées par un verrou consultatif sur l'envoi
  (`questionnaires/portail.ts`). Relances automatiques J+3 et J+7 par jobs
  `relance_questionnaire` (historique en ajout seul, `MPQ05`, `0142`) ; la
  migration `0148` remet en attente les seules relances passées en échec
  « type de job inconnu » avant l'inscription du handler. La **date limite**
  d'un envoi est appliquée : aucune réponse ne se soumet après elle (jour UTC
  inclus ; 409 `DATE_LIMITE_DEPASSEE` dans `questionnaires/portail.ts`, doublé
  par `MPQ07`, `0150`) ; le cabinet prolonge en repoussant ou retirant la date.
  **Génération par l'IA** (SOC-11, `POST /questionnaires/generation-ia`,
  `questionnaire.gerer` et `ia.utiliser`, `0149`) : passe par l'orchestrateur
  (§7 bis), crée une version 1 en brouillon et un historique de contenu en ajout
  seul (`questionnaire_ia_historique` : brouillon IA, modifié, validé ; `MPQ06`) ;
  une version d'origine IA ne se valide que si son dernier rang est « valide »
  (`MPQ08`), donc jamais sans un consultant. La définition est construite par le
  code (échelles fixes) : aucun chiffre ne vient du modèle.
- **Notation** (NOT-01 à NOT-07 ; `notation/`, `0145`–`0147`) : tout score
  sort du moteur (`packages/engines`) ; chaque calcul crée une version en ajout
  seul (`MPN01`) ; transitions de revue contrôlées en base (`MPN03`) ;
  publication réservée à l'expert métier avec séparation des tâches (§5,
  `MPN04`) ; grille validée figée (`MPN05`). Tables `portail_interdit`.
  **Calcul depuis le référentiel** (vague 1, `notation/via-methode.ts`, `0206`) :
  une mission liée à une méthode calcule sa notation depuis la méthode effective
  (briques désignant les moteurs par code, MÊMES moteurs que la V2 ; résultats
  identiques tant qu'aucune règle n'ajuste le calcul, test
  `notation-methode.test.ts`) ; la version enregistre la version de méthode, la
  liaison courante et les journaux de modulation et d'exécution
  (`notation_versions_methode`, ajout seul `MPN06`, liaison courante de la mission
  `MPN07`, `portail_interdit`). Une pondération de contexte ne vient que d'une
  règle validée par le comité méthode, est appliquée par le moteur pur
  `appliquerPonderationsContexte` et tracée (poids avant et après) ; tout autre
  ajustement est tracé comme sans effet. **Publication** d'une notation d'une
  mission liée à une méthode : circuit `MPN04` ET suivi qualité de la version
  SIGNÉ (409 `SUIVI_QUALITE_NON_SIGNE`, §5 ter) ; sans méthode, inchangé.
- **KPI** (KPI-01 à KPI-05 ; `kpi/`, `0160`) : permissions `kpi.lire`,
  `kpi.gerer`, `kpi.saisir` ; côté portail, `portail.kpi.saisir` et
  désignation explicite comme contributeur du KPI (`kpi_contributeurs`,
  écrits par le cabinet seul). Historique en ajout seul (`MPK05`), au plus 20
  corrections par mesure (`MPK07`). Volume borné (déni de service) : date
  d'arrêté entre le 2000-01-01 et aujourd'hui + 366 jours
  (`packages/shared/src/schemas/kpi.ts`), au plus 20 000 périodes évaluées par
  requête (400 `KPI_TROP_DE_PERIODES`), export limité aux 36 dernières
  périodes et à 2 000 lignes de mesure par KPI (`kpi/tableau.ts`). L'export
  est journalisé (`kpi.exporter`) ; la série du tableau de bord a sa propre route
  (`GET /missions/:id/kpi/series`, `kpi.lire`), qui n'écrit pas d'entrée
  d'export. Saisie du client : écrans `/portail/kpi` sur les routes
  `/api/portail/kpi*`.
- **Plans stratégiques** (PLA-01 à PLA-11 ; `plans/`, `0180`–`0184`) :
  permissions `plan.lire`, `plan.ecrire`, `plan.valider` ; contenus et
  versions du modèle financier en ajout seul (`MPS01`), au plus 200 versions du
  modèle (`MPS05`). Le partage au client exige un contenu entièrement validé
  (`MPS04`) et est **retiré** à toute écriture qui produit un contenu non
  validé (création d'élément, version brouillon ou modifiée, nouvelle version
  du modèle ; `plans/partage.ts`, journal `plan.retirer_partage`). Aucune
  route du portail ne sert encore un plan : les tables sont `portail_interdit`.
  Vague 0 : **dépendances** entre initiatives (PLA-05, `0184`) dans le contenu
  versionné, contrôlées par le moteur (cycles) puis par la base (`MPS02` : autre
  initiative du même plan, 20 au plus) ; recalage de la feuille de route
  recalculé par le moteur à chaque lecture (`plan.ecrire` pour l'appliquer) ;
  **KPI créés depuis un objectif** (PLA-10, `0183`, `plan.ecrire` et
  `kpi.gerer`, rattachement en ajout seul) ; **lien du diagnostic vers une
  notation publiée** (`0182`, `plan.ecrire` et `notation.lire`, historique en
  ajout seul de 200 changements au plus ; notation non publiée ou d'un autre
  client refusée : `MPS06`, 409 `NOTATION_NON_PUBLIEE`).
- **Notation augmentée** (NOT-09 à NOT-13, NOT-17 ; `notation/banque.ts`, `confiance.ts`,
  `explication.ts`, `calibration.ts`, `plan-action.ts`, `routes/notation-augmentee.ts`,
  `0400`–`0403`, toutes les tables `portail_interdit`, aucune route au portail, aucun appel IA) :
  **banque d'items** versionnée, validée par un expert métier ni auteur ni dernier modificateur
  (`MPN04`), figée une fois validée (`MPN08`) ; une **sélection** (questionnaire adaptatif) ne cite
  que des items validés et une de leurs formulations validées (`MPN09`, ajout seul) : une
  proposition de l'IA passe par le même contrôle du moteur (`controlerProposition`) que celle d'un
  humain. **Indice de confiance** (moteur `indiceConfiance`, solidité des preuves par le moteur
  `preuves` : seules les assertions « retenues » rattachées à une dimension comptent, ni brouillon ni
  abandonnées ; agrégat sans verbatim ni répondant) : la publication le recalcule et l'enregistre dans
  sa transaction (`notation_confiances`, ajout seul) ; le booléen `publiable` (comparaison de l'indice
  EXACT au seuil, l'indice affiché étant arrondi) fait foi ; sous le seuil du cabinet, 409
  `CONFIANCE_INSUFFISANTE`, doublé en base (`MPN10` : sans indice publiable de la même transaction,
  l'événement « publication » est refusé ; un seuil enregistré plus bas que le seuil courant aussi).
  Le seuil et la cible de répondants se modifient par `cabinet.gerer` (associé) seulement, journalisé,
  et **refusé (403 `SEPARATION_DES_TACHES`) à qui cumule le rôle `expert_metier`** : celui qui publie ne
  baisse pas le seuil qu'il doit franchir. Un plancher borne les paramètres : seuil ≥ 0,3 et au moins 2
  répondants (schéma partagé et CHECK de `0404`, posés `NOT VALID` : une ligne antérieure plus basse
  reste telle quelle jusqu'à sa prochaine modification ; valeurs à calibrer au pilote).
  **Calibration** (NOT-13) : cotation à l'aveugle, une par cas et par évaluateur, ajout seul, session
  close figée (`MPN11`) ; tant que la session est ouverte, chacun ne voit que SES cotations et
  l'avancement ; un expert métier ne voit les cotations des autres et la mesure des écarts que pour
  les cas qu'il a lui-même cotés (un expert qui n'a rien coté n'en voit aucun) ; tout est visible une
  fois la session close. Une session qui cite une notation n'est lue que si sa mission est visible. **Plan d'action** : bibliothèque `notation_initiatives_types`
  (retrait, jamais suppression), impacts et plans en ajout seul (`MPN12`). La banque d'items est
  privée à chaque cabinet (RLS, aucune ligne partagée).
- **Plans augmentés** (PLA-12 à PLA-14, PLA-17 ; `plans/cascade.ts`, `bibliotheque.ts`,
  `portefeuille.ts`, `bancabilite.ts`, `rapports/dossier-bancaire.ts`, `routes/plans-augmentes.ts`,
  `0420`–`0424`) : neuf tables (`plan_porteurs`, `plan_cascade_noeuds`, `plan_cascade_versions`,
  `initiatives_types`, `initiative_type_versions`, `initiative_type_observations`,
  `plan_initiatives_origines`, `plan_portefeuille_evaluations`, `plan_portefeuille_arbitrages`),
  toutes `portail_interdit`, aucune route au portail ; `plan.lire`, `plan.ecrire`, `plan.valider`,
  `standard.gerer` pour la bibliothèque. **Bibliothèque d'initiatives** : le standard
  (`cabinet_id` nul, huit initiatives posées par migration, `0422`) est en lecture seule pour le rôle
  applicatif (politique `standard_lecture`, seule `isolation` admet l'écriture) et l'API refuse de le
  modifier (409 `STANDARD_IMMUABLE`) : le cabinet crée une variante qui reprend le même code (`MPS07`,
  qui contrôle aussi propriétaire et numéros de version des versions et le rattachement des
  observations). **Arbitrage de portefeuille** : `plan.valider` ET responsable de la mission ; la
  proposition est recalculée par le moteur avec les contraintes reçues, jamais reçue du navigateur ;
  chaque écart à la proposition exige un motif (400 `MOTIF_REQUIS`, doublé en base : `MPS08`) ; tout
  est figé en ajout seul. La **proposition** de portefeuille (sans écriture métier) est plafonnée à 30
  par utilisateur et par 10 minutes (429 `TROP_DE_PROPOSITIONS`, comptée sur `journal_audit`).
  **Dossier bancaire** (`0424`) : destiné à une banque, il exige `plan.lire` ET `plan.valider`
  (en plus de `mission.lire`) et une version VALIDÉE du modèle financier (409 `MODELE_NON_VALIDE`,
  doublé en base : `MPR03`) ; il ne reprend PAS l'annexe « Sources » du plan (registre des preuves
  interne du cabinet) et ne porte que des contenus validés (§8 bis). Les lectures de versions de la
  bibliothèque sont bornées (`LIMIT n+1`, indicateur `versions_tronquees`). Les dates d'échéance de
  ces lots utilisent `dateIsoBorneeSchema` (2000-01-01 à 2100-12-31, `packages/shared/src/schemas/commun.ts`),
  l'intervalle des CHECK SQL ; une violation de CHECK qui échapperait au schéma (SQLSTATE 23514) est
  traduite en 400 `REQUETE_INVALIDE`, jamais en 500.

## 5 ter. Qualité et responsabilité professionnelle (lot QUA, PRD complémentaire §10)

Code : `apps/api/src/qualite/`, `routes/qualite.ts`, migrations `0280`–`0286` (lettre de domaine
`Y`, `MPY01`–`MPY11` ; `0286` : durcissement issu de l'audit du 2026-10-08). Le moteur `packages/engines/src/qualite` juge les gardes ; l'API ne recode
pas la séparation des tâches.

- **Droits.** Consulter et parcourir : `mission.lire` ET mission visible (404 sinon, comme un
  livrable d'autrui). Ouvrir un suivi, vérifier la définition de terminé, attester, relever la
  classe, relecture du chef et second expert : `qualite.relire` ; ouvrir exige en plus la mission
  modifiable (chef, directeur ou associé, mission non clôturée). Signer, déclarer ou retirer une
  relation entre clients, décider d'une acceptation : `qualite.signer` ; une NOUVELLE évaluation
  d'acceptation après une décision exige aussi `qualite.signer`. Lister les relations entre clients exige
  `clients.lire` en plus de `qualite.relire`, et leur note interne n'est servie qu'à `qualite.signer`.
  NPS du cabinet : associé seul (`qualite.signer` puis rôle `associe`). Les étapes « validation de l'auteur » et « validation du
  consultant » n'exigent que l'appartenance à la mission (le rôle consultant n'a pas
  `qualite.relire`). Aucune route n'est dans `LISTE_BLANCHE_PORTAIL` ; toutes les tables sont
  `portail_interdit`.
- **Classe de risque.** Fixée à l'ouverture à la classe minimale du type (rapport R2, notation R3,
  plan R3, questionnaire R2, état R3, autre R1), relevable, jamais abaissée : 409
  `CLASSE_SOUS_MINIMALE` / `CLASSE_ABAISSEE`, doublé en base (`MPY02`).
- **Auteur du livrable.** Pour un type que le module qualité sait lire (rapport, notation, plan,
  questionnaire), l'auteur est celui du module : le corps ne le remplace pas et ne le déclare pas « agent »
  (400 `AUTEUR_IMPOSE`, ce qui désactiverait les contrôles de cumul). Pour un type opaque (`etat`, `autre`),
  l'auteur désigné est un membre actif de la mission (400 `AUTEUR_NON_MEMBRE`, doublé en base : `MPY11`).
- **Validation = parcours + définition + garde.** Une étape est refusée (409) si : le suivi n'est pas
  en revue (`SUIVI_NON_EN_REVUE`), la définition de terminé n'est pas satisfaite
  (`DEFINITION_NON_SATISFAITE`), le relecteur LUI-MÊME n'a pas parcouru tous les éléments
  obligatoires (`PARCOURS_INCOMPLET` ; le « vu » d'un autre ne le dispense pas ; le signataire parcourt
  aussi), ou le moteur `evaluerGarde` relève une violation (`GARDE_VIOLEE`, avec `details.violations` :
  `AUTEUR_ATTENDU`, `CUMUL_INTERDIT`, `QUATRE_YEUX`…). Étape hors ordre ou non requise : 409. Un acteur
  non habilité : 403. Un livrable R2 ou R3 ne se valide ni ne se signe sur un parcours sans aucun élément
  obligatoire (409 `PARCOURS_VIDE`, doublé en base : `MPY08`). Le moteur n'a pas de « cumul permis » configuré : un directeur qui relit ne signe
  pas dans la même garde R3 (réglage de petit cabinet non offert).
- **Revue figée sur le contenu relu.** L'empreinte SHA-256 du contenu (`empreinte_revue`) est posée une seule
  fois au passage en revue, puis figée en base (`MPY02`) ; l'API la recalcule avant chaque étape de garde et
  avant la signature et refuse un livrable modifié depuis (409 `LIVRABLE_MODIFIE_APRES_REVUE`). Un suivi ouvert
  avant `0286` la reçoit à sa prochaine vérification ; un type opaque n'a pas d'empreinte. Un élément obligatoire
  déposé APRÈS une étape de garde ajoute l'événement `elements_apres_validation` : l'étape est à reconfirmer par
  son auteur, qui parcourt le nouvel élément (409 `ETAPE_A_RECONFIRMER` pour qui la rejouerait entre-temps).
- **Définition de terminé.** Contrôles par du code déterministe (enregistrement du livrable, statut du
  contenu source, sections présentes, chiffres tracés) ; ce qu'il ne sait pas trancher est
  `non_evaluable` et ne se règle que par l'attestation motivée d'un humain, jamais celle de l'auteur du livrable (409
  `ATTESTATION_PAR_AUTEUR`, doublé en base : `MPY10`) ; un item non conforme ne s'atteste pas, on corrige le
  livrable. Les résultats sont en ajout seul. L'agent IA qualité (lot AGT)
  complètera ces contrôles sans les remplacer.
- **Signature (QUA-06).** Livrables R2 et R3 validés, par le directeur de la mission ou un associé.
  L'empreinte SHA-256 porte sur le CONTENU quand le module qualité sait le lire (somme du fichier du
  rapport, canonique JSON de la version de notation, du plan, du questionnaire), sinon sur le dossier
  de revue (`portee_empreinte`). Mention de contribution IA : politique du cabinet
  (`rapports/parametres.ts`, active par défaut). Un livrable signé est figé.
- **Acceptation (QUA-07).** Conflits calculés par le serveur depuis les relations DÉCLARÉES (même
  groupe, investisseur et cible, concurrent) et figés dans chaque évaluation ; l'API révèle la raison
  sociale du client lié et le NOMBRE de ses missions en cours, jamais leur intitulé. Accepter malgré un
  conflit exige un motif. Une fois une décision prise (hors « en attente »), le niveau de risque retenu ne
  descend plus sous celui de la dernière évaluation (409 `NIVEAU_RISQUE_ABAISSE`, doublé en base : `MPY09`).
  Une relation entre clients ne se supprime pas (`MPY01` sur `DELETE`) : son retrait est un événement en ajout
  seul (`qualite_relations_retraits`, une seule fois : 409 `RELATION_DEJA_RETIREE`) ; l'unicité (`MPY07`, dans
  les deux sens, sous verrou consultatif de la paire) ne porte que sur les relations actives, une relation
  retirée peut donc être déclarée de nouveau. Détection limitée aux relations déclarées : aucune recherche
  d'homonymes.
- **Satisfaction (QUA-08).** Note entière 0–10 saisie par le cabinet ; corrections en nouvelle ligne
  (dernier rang). L'`origine` de la note est tracée (`saisie_par_equipe` par défaut : saisie par le cabinet
  pour le compte du client ; `client` : réservée à une saisie directe par le client) sans changer le calcul du NPS. Le NPS est calculé par le moteur pur `syntheseNps` (`packages/engines/src/nps`,
  entiers exacts), appelé par `qualite/satisfaction.ts`.
- **Branchements** (`qualite/branchements.ts`, service interne sans droit supplémentaire, dans la
  transaction de l'appelant qui a déjà exigé le sien) : génération d'un rapport → suivi `rapport`
  (R2) ; soumission en revue et publication d'une notation → suivi `notation` (R3). Éléments de la
  revue guidée déposés : assertions fragiles de la mission (`assertionsFragilesDeMission`), chiffres
  du livrable avec leur source, recommandations (initiatives du plan, recommandations candidates de
  la méthode). La source d'un élément est RÉSOLUE par le serveur (`source_type` : `moteur` pour un calcul
  d'un moteur, `preuve` pour une preuve du registre de la mission désignée par `preuve_id`) ; seul le service
  interne la pose, et un chiffre n'est « tracé » que si sa source est résolue ; plafonds `BRANCHEMENT_MAX`, dépôt idempotent, rien sur un suivi validé ou signé.
  Définition de terminé « notation » : version **soumise en revue ou publiée** (`notation_soumise`),
  pour permettre la signature avant la publication exigée d'une mission liée à une méthode.
- **Audit.** Chaque action journalise (`qualite.suivi.ouvrir`, `qualite.verifier`, `qualite.attester`,
  `qualite.valider`, `qualite.signer`, `qualite.classe.relever`, `qualite.element.vu`,
  `qualite.session.*`, `qualite.acceptation.evaluer`, `qualite.relation.*`,
  `qualite.satisfaction.saisir`) sans le texte des commentaires.
- **Limites connues.** Temps de revue : session plafonnée à 2 h (une session oubliée n'enfle pas le
  temps) ; pas de revue à froid (QUA-05, V4) ; le module des plans n'ouvre pas le suivi d'un plan
  (seul son RAPPORT généré est suivi) ; pas de génération de rapport d'état financier (type `etat`),
  donc pas de branchement ; une définition « notation » copiée dans un cabinet avant le 2026-10-08
  garde l'item `notation_publiee` (nouvelle version de définition à créer).

## 5 quater. Pilotage augmenté des KPI (KPI-13, KPI-15, KPI-17, KPI-18)

Lot KPI de la vague 2 (PRD complémentaire §11.4, migrations `0440`–`0442`, code
`apps/api/src/kpi/{arbres,qualite-donnees,actions,revues,revues-donnees,dossier-revue,pilotage-donnees}.ts`,
routes `routes/kpi-pilotage.ts` montées par `routes/kpi.ts`, test `test/kpi-pilotage.test.ts` ;
migrations `0443`–`0445` : durcissements issus de l'audit du lot).

- **Cloisonnement** : sept tables (`kpi_arbres`, `kpi_arbre_noeuds`, `kpi_revues`,
  `kpi_revue_decisions`, `kpi_revue_decision_evenements`, `kpi_actions`,
  `kpi_action_evenements`), toutes à RLS (`isolation`) et `portail_interdit`, clés étrangères
  composites `(cabinet_id, …)`, `DELETE` retiré au rôle applicatif (un nœud se désactive, une
  revue s'annule). Aucune route n'est dans `LISTE_BLANCHE_PORTAIL` : un utilisateur du portail
  reçoit 403 `PORTAIL_ROUTE_INTERDITE` (testé). Un identifiant invisible, inconnu ou d'un autre
  cabinet répond le même 404.
- **Droits** (aucune permission nouvelle) : lire = `kpi.lire` et mission visible ; arbres et
  revues (créer, éditer, générer l'ordre du jour, tenir, clôturer, annuler, décisions) =
  `kpi.gerer` et mission modifiable non clôturée ; actions (créer, modifier, statut,
  commentaire) = `kpi.saisir` ET directeur/chef, propriétaire du KPI, membre de l'équipe ou
  responsable de l'action ; statut d'une décision = `kpi.saisir` ET directeur/chef ou responsable
  de la décision. Responsable, animateur : membre actif de la mission qui lit les KPI (400 sinon,
  jamais un compte du portail).
- **Historiques et états terminaux** : événements des actions et des décisions en ajout seul
  (`MPK05`, `REVOKE UPDATE, DELETE`) ; action terminée ou abandonnée et décision exécutée ou
  abandonnée figées (`MPK25`, `MPK26`) ; revue tenue : ordre du jour, date d'arrêté, titre,
  **dossier** et **compte rendu** figés (`MPK22` ; le compte rendu se saisit tant que la revue est
  planifiée ou à l'instant de la tenue, `0443`, aucun historique de versions n'étant nécessaire) ;
  clôture refusée tant qu'une décision ou une action liée est ouverte (`MPK23`, aussi en API :
  409 `KPI_REVUE_OUVERTE` avec la liste des `manquants`) ; une action ne se rattache qu'à une revue
  TENUE et non clôturée (`MPK27`, `0444` : lecture de la revue sous `FOR SHARE`, ce qui sérialise
  l'insertion avec la clôture) ; l'API répond alors 409 `KPI_ACTION_REVUE` (revue non tenue ou
  déjà clôturée, message explicite). Plafonds de l'arbre (`MPK13`, `0445`) : 50 nœuds actifs, aussi à la
  RÉACTIVATION d'un nœud (sous un parent actif : `MPK12`), et 200 nœuds au total, désactivés compris
  (un nœud ne se supprime pas), de sorte qu'une lecture ne tronque jamais l'arbre en silence.
  Chaque écriture appelle `journaliser` dans sa transaction.
- **Garde-fous de saisie** : un commentaire est obligatoire pour déclarer une décision « exécutée »
  (schéma `kpiDecisionStatutSchema`) et pour une `date_effet` d'action de plus de 31 jours dans le
  passé (`DELAI_DATE_EFFET_SANS_MOTIF_JOURS` : elle fixe les fenêtres avant/après de l'efficacité) ;
  une alerte inconnue ou rattachée à un autre KPI répond le même 404 « Alerte » (aucune
  confirmation d'existence) ; les lectures de décisions, d'actions et d'événements sont plafonnées
  à 500 lignes avec l'indicateur `tronque` (`kpi/pilotage-donnees.ts`), jamais en silence.
- **Calculs** : tous dans `packages/engines/src/kpi` (arbre, unités, qualité, efficacité, ordre du
  jour), en arithmétique exacte ; l'efficacité d'une action n'est jamais stockée ni saisie, elle est
  recalculée à chaque lecture. Aucun contenu produit par un modèle de langage.
- **Unités d'un arbre** (recette du 2026-10-10) : une relation « somme » n'additionne que des
  KPI de même unité (« 55 jours + 72 % » est refusé) ; un « produit » admet des unités différentes.
  Contrôle par fonctions pures (`packages/engines/src/kpi/arbre-unites.ts`), appliqué par l'API APRÈS
  la création ou la modification d'un nœud, dans la même transaction (`kpi/arbres.ts`) : 409
  `KPI_ARBRE_UNITES`, l'écriture est annulée. Seules les NOUVELLES incohérences sont refusées : un
  arbre ancien, ou dont un KPI a changé d'unité, reste modifiable, et la lecture des contributions
  les signale par `avertissements_unites` sans bloquer. La relation somme ou produit d'un nœud se
  modifie depuis l'interface (même route, mêmes droits `kpi.gerer`).
- **Dossier de revue** : rendu par le moteur de rapports (PDF, Word, PowerPoint) depuis un
  modèle de contenu validé, texte brut échappé, plafonds du modèle ; **non conservé** (aucune
  ligne de `rapports_mission`, aucun fichier) ; il porte le statut « brouillon » et reste
  **confidentiel** (valeurs de KPI du client, aucun circuit de validation) : les rendus PDF, Word
  et PowerPoint (`rapports/html.ts`, `docx.ts`, `pptx.ts`) affichent la mention neutre
  « Confidentiel : document interne, réservé aux personnes autorisées » ; plafond de 10
  téléchargements par utilisateur et par 10 minutes (429 `TROP_DE_DOSSIERS_REVUE`) : la
  réservation est inscrite dans `journal_audit` AVANT le rendu, sous un verrou consultatif propre
  à l'utilisateur (`reserverTelechargementDossier`), de sorte que des demandes simultanées se
  sérialisent et que seuls dix rendus passent (un rendu en échec consomme sa réservation) ; PDF 503
  `RENDU_PDF_INDISPONIBLE` sans navigateur configuré. Contrairement à un rapport enregistré, il
  n'ouvre pas de suivi qualité (QUA) : dette notée ci-dessous.
- **Risques acceptés** : pas de quatre yeux sur la clôture d'une revue ni sur l'exécution d'une
  décision (le responsable de la mission peut clore ce qu'il a lui-même décidé) ; le dossier
  téléchargé n'est pas horodaté contre la falsification une fois sorti de la plateforme ; seuils
  et poids du moteur sont des valeurs de départ à calibrer (`DECISIONS.md`).

## 5 quinquies. Moteur d'automatisation (AUT-01 à AUT-06)

Lot de la vague 2 (PRD complémentaire §8, ADR-006 ; migrations `0300`–`0302`, code
`apps/api/src/automatisation/`, routes `routes/automatisation.ts`, tests
`test/automatisation-regles.test.ts` et `test/automatisation-execution.test.ts`).

- **Cloisonnement** : dix tables (`automatisations`, `automatisation_versions`,
  `automatisation_coupe_circuits`, `automatisation_evenements`, `automatisation_executions`,
  `automatisation_actions`, `automatisation_action_resultats`, `automatisation_annulations`,
  `automatisation_brouillons`, `automatisation_brouillon_decisions`), toutes à RLS (`isolation`) et
  `portail_interdit`, clés étrangères composites, `DELETE` retiré au rôle applicatif. Les 17 routes
  ne sont jamais dans `LISTE_BLANCHE_PORTAIL` (403 `PORTAIL_ROUTE_INTERDITE`) ; rien n'est publié
  depuis une transaction du portail (`automatisation_publier_base` et `publierEvenement` retournent
  sans effet). Un identifiant inconnu, d'un autre cabinet ou d'une mission invisible répond le même
  404.
- **Droits** : `automatisation.lire` (catalogue, liste, détail, simulation, journal des exécutions,
  brouillons : associé, directeur, chef de mission), `automatisation.gerer` (créer, modifier, activer,
  couper, annuler : associé et directeur). Annuler exige en plus la permission de l'action annulée
  et la mission visible. Décider d'un brouillon (validé, modifié, rejeté, une seule fois) revient au
  chef ou au directeur de sa mission (ou à qui modifie toutes les missions) : « l'IA propose,
  l'expert dispose » étendu aux automatisations. Le journal ne liste que les exécutions sans mission
  ou d'une mission visible.
- **Historiques en ajout seul** (`MPU01`, `REVOKE UPDATE, DELETE` et déclencheur) : versions de
  définition, coupe-circuits, événements, exécutions, actions, résultats, annulations, brouillons et
  décisions ; on corrige par un nouvel enregistrement. Garde-fous doublés en base : lever un
  coupe-circuit est réservé à un associé actif (`MPU02`, doublé par l'API : 403 `ACTION_RESERVEE`) ;
  seule une action annulable et réussie s'annule, une fois (`MPU03`, 409 `ANNULATION_IMPOSSIBLE`) ;
  aucune action vers le client autorisée hors classe R0 (`MPU04`, 409 `GARDE_AUTOMATISATION`) ; version
  courante présente et événement identique à la définition, résultat d'action compatible avec la
  garde (une action refusée ne peut qu'être « refusée », une autorisée ne l'est jamais), action d'une
  exécution « déclenchée » seulement (`MPU05`, 409 `AUTOMATISATION_INCOHERENTE`). Le registre
  d'actions est doublé par CHECK : seule `relance_questionnaire` va vers le client, seuls les
  brouillons (note, facture en brouillon) sont annulables.
- **Identité d'exécution** (AUT-05) : les actions s'exécutent dans les droits ACTUELS d'une personne
  du cabinet, relus à chaque exécution (jamais un rôle du portail) : par défaut le **responsable**,
  c'est-à-dire la personne qui a ACTIVÉ l'automatisation (« compte d'automatisation » restreint aux
  six actions typées du registre, chacune contrôlant sa permission et la visibilité de la mission),
  ou le **déclencheur** de l'événement (aucun pour un événement système ou de la base : l'action est
  alors refusée, `EXECUTANT_INDISPONIBLE`). Seuls les événements publiés APRÈS l'activation
  déclenchent l'automatisation (`active_depuis`) ; le passé se simule. **Séparation des tâches** :
  modifier la DÉFINITION d'une automatisation active la DÉSACTIVE dans la même transaction (journal
  `desactivation`, cause « modification de la définition »), car sinon le texte d'un directeur
  s'exécuterait sous l'identité d'un associé ; la réactivation rend son auteur responsable. Nom et
  description seuls ne changent rien à l'exécution.
- **Garde du moteur** (`garderActionAutomatisation`, `packages/engines`) : chaque action est
  décidée avant exécution, la décision est ENREGISTRÉE avec l'action (`autorisee`, liste `refus`) :
  coupe-circuit du cabinet, de l'automatisation ou N4 des agents (§7 bis) ; contenu R2 ou R3 jamais
  vers le client, N4 réservé à R0 ; niveau effectif de la brique de l'agent appelé ; droits de
  l'exécutant ; mission visible. Une action vers le client (relance d'un questionnaire) est de classe
  R0. Une action refusée est tracée « refusée » (code `GARDE_REFUSEE`), une action en échec n'annule pas
  les autres (SAVEPOINT) ; l'idempotence est celle de la clé (automatisation, événement, rang).
- **Appel d'un agent** : la décision de la garde part dans le job `automatisation_agent` (une
  tentative), exécuté plus tard : le job RELIT les coupe-circuits du cabinet et de l'automatisation
  et l'état `active`, et n'appelle pas l'agent si l'un bloque (résultat « ignoree », code
  `COUPE_CIRCUIT`, raison dans `details`, y compris `AUTOMATISATION_INACTIVE`). Un événement traité
  pendant une coupure est journalisé « bloquée » et n'est PAS rejoué à la levée. Le déclencheur
  `MPU05` admet « ignoree » pour une action autorisée. Limite connue : §15.
- **Événements** : publiés par les modules (service `publierEvenement`, idempotent par clé, non
  bloquant, contenu validé contre les champs DÉCLARÉS du catalogue : aucun champ libre ni objet, jamais
  un montant), par la base (déclencheurs sur jalon atteint, mission signée, questionnaire clos,
  `automatisation_publier_base`, sous-transaction qui absorbe ses erreurs) et par la détection
  quotidienne (`automatisation_detection`, 7 h 30 UTC, questionnaire sans réponse et KPI au rouge). Trois
  jobs inscrits dans `jobs/registre.ts` : `automatisation_evenement`, `automatisation_agent`,
  `automatisation_detection` (test `jobs-registre.test.ts`, §7 bis). La planification quotidienne passe par
  la fonction `SECURITY DEFINER` `planifier_detection_automatisation` (§4).
- **Plafonds** (valeurs de départ, à valider, `DECISIONS.md`) : 50 automatisations ACTIVES par cabinet,
  sous verrou consultatif (409 `PLAFOND_AUTOMATISATIONS_ATTEINT`, `MAX_AUTOMATISATIONS_ACTIVES`) ; 30
  simulations par utilisateur et par 10 minutes (429 `TROP_DE_SIMULATIONS`, comptées sur
  `journal_audit`, `SIMULATIONS_PAR_FENETRE`) ; une simulation rejoue au plus 500 événements passés,
  sans effet, avec la MÊME garde qu'à l'exécution et les seuls événements sans mission ou de missions
  visibles de l'utilisateur ; définition de 64 Kio au plus (CHECK).
- **Diagnostic** : un incident inattendu (action en échec par une erreur non métier, publication
  refusée par la base) est consigné dans le journal de l'application (`app.log`,
  `automatisation/diagnostic.ts`) avec message, code, contrainte et table, jamais le `detail`
  PostgreSQL ni le contenu d'un événement ou d'une action ; le résultat servi n'en dit rien (code
  `ERREUR_INTERNE`). Le coupe-circuit des automatisations (cabinet : `POST /automatisations/coupe-circuit`,
  une automatisation : `POST /automatisations/:id/coupe-circuit`) est distinct du coupe-circuit N4 des
  agents (§7 bis), que la garde consulte aussi.
- **Journal** : création, modification, activation, désactivation, coupure et levée, annulation,
  décision de brouillon, simulation (`simulation_automatisation`, sans le contenu des événements).
- **Limite** : `GET /automatisations` et `GET /automatisations/:id` montrent les définitions
  (gabarits de texte compris) à tout détenteur de `automatisation.lire` du cabinet, chef de mission
  compris ; aucune donnée financière n'y entre.

## 5 sexies. Capitalisation, compétences et recherche (CAP-01, 02, 05, 06, 07)

Lot de la vague 3 (PRD complémentaire §12 ; migrations `0460`–`0465`, code
`apps/api/src/capitalisation/`, routes `routes/capitalisation.ts`, 23 routes, tests
`test/capitalisation.test.ts` et `test/capitalisation-cloture.test.ts`). Aucune route dans
`LISTE_BLANCHE_PORTAIL`.

- **Cloisonnement** : neuf tables (`retours_experience`, `retour_experience_versions`,
  `cap_taches_briques`, `cap_temps_briques`, `cap_propositions_derogations`, `competences`,
  `competence_declarations`, `competence_decisions`, `competence_preuves`), toutes à RLS et
  `portail_interdit`. Historiques en ajout seul (`MPJ01`) ; la mission visible est TOUJOURS exigée en
  plus de la permission pour ce qui s'y rattache.
- **Droits** : `connaissance.lire` (retours d'expérience, recherche, briques observées) ;
  ouvrir, rédiger, générer par l'IA (`ia.utiliser` en plus) et valider un retour : `mission.planifier` ET
  responsable de la mission (chef, directeur ou associé) ; `standard.gerer` pour l'analyse des
  dérogations (comité méthode) ; rattacher une tâche à une brique : `mission.planifier`, refusé sur une
  mission clôturée (`MPJ03`). **Validation d'un retour** : un associé, le chef ou le directeur de la
  mission ET l'utilisateur de la session (`app.utilisateur_id`, posé avant l'`UPDATE`), 403
  `VALIDATION_RESERVEE`, doublé en base (`MPJ08`) ; exception voulue (§5) : le chef peut valider la
  version IA qu'il a demandée. Versions en ajout seul, validation définitive d'une version existante
  (`MPJ02`).
- **Ouverture automatique du retour (CAP-01)** : `POST /missions/:id/cloturer` (§8 sexies) ouvre le
  retour dans la transaction de la clôture, après la mise à jour du statut (noyau `creerRetourSiAbsent`,
  `capitalisation/retours.ts`). Elle ne contourne aucune règle de clôture : le droit `mission.cloturer`,
  l'état « à clôturer » et `exigerClotureAutorisee` (dont `MPX03`) sont contrôlés AVANT, et seul un
  brouillon du gabarit est créé (aucune validation, aucun contenu IA ; le retour reste invisible sans
  `connaissance.lire`). L'ouverture s'exécute dans un SAVEPOINT (`cap_ouverture_retour`) : une
  erreur l'annule seule et ne bloque JAMAIS la clôture ; l'échec est inscrit au journal d'audit
  (`capitalisation.retour.ouvrir_echec`, motif tronqué à 300 caractères) et au journal applicatif ;
  un succès est journalisé `capitalisation.retour.ouvrir` ; un retour déjà ouvert est ignoré sans
  écriture. Rattrapage des missions déjà closes : `GET /capitalisation/retours/a-ouvrir`
  (`connaissance.lire`, filtre `filtreVisibilite` : seules les missions VISIBLES de l'utilisateur,
  statut « cloturee » sans retour, pagination par curseur) ; son champ `peut_ouvrir` (associé, chef ou
  directeur de la mission) n'est qu'un confort d'affichage, l'ouverture manuelle
  (`POST /capitalisation/missions/:id/retour`) reste seule juge (`mission.planifier` ET responsable).
- **FIN-02 et jours** : la section « Écarts » (temps réels, budget) et les données de trace
  `donnees.temps` / `donnees.ecarts` d'un retour sont ABSENTES sans `budget.lire_jours`, y compris
  dans la recherche : ni dans l'extrait ni dans le texte interrogé (sinon la recherche serait un
  oracle sur des jours que l'API ne montre pas). `POST /capitalisation/estimation` exige
  `connaissance.lire` ET `budget.lire_jours` (l'expert métier n'a pas le second).
  **Observation de la recette du 2026-10-10, décision produit à confirmer** : `budget.lire_jours`
  est détenu par l'associé, le directeur de mission, le chef, le consultant, les ressources et le
  gestionnaire (`roles.ts`) ; un consultant membre de l'équipe d'une mission clôturée (donc visible pour lui)
  voit ainsi les JOURS de budget et de temps réel de la section « Écarts » de son retour. FIN-02 ne
  vise que les coûts, taux, marges et montants, pas les jours : c'est conforme à la règle écrite,
  mais à confirmer avec le commanditaire (`DECISIONS.md`).
- **Estimation par brique** (CAP-02, moteur `estimerBriques`) : sans nom ni mission ; effectif
  minimum de 3 (plancher du moteur et du schéma, 3 à 20, défaut 3), aucun effectif inférieur au
  minimum n'est rendu ; quartiles, extrêmes et valeurs atypiques seulement à partir de 5 observations
  (sur 3 ou 4 valeurs ils redonneraient les durées individuelles) ; repli du contexte vers la brique,
  puis « insuffisant ».
- **Dérogations** (CAP-05) : les effectifs portent sur tout le cabinet (agrégats), le texte d'un motif
  n'est lu que pour une mission visible ; la description d'une proposition au standard ne cite que
  des effectifs et le groupe, jamais un motif, un mot tiré des motifs ni une mission (elle est lisible
  de rôles qui n'ont pas accès à ces missions) ; un groupe déjà proposé n'est pas reproposé.
- **Compétences** (CAP-06) : le référentiel s'écrit avec `competence.gerer` ; la matrice de TOUS les
  collaborateurs (donnée d'évaluation individuelle) exige `competence.lire` ; temps et preuves de la
  matrice seulement avec `budget.lire_jours` (champs absents sinon) ; les autres rôles ne voient que
  leur propre vue (`/capitalisation/competences/moi`, `temps.saisir`). Une déclaration de niveau est en
  attente à raison d'une par couple (collaborateur, compétence) (`MPJ06`, 409 `DECLARATION_EN_ATTENTE`)
  et plafonnée à 50 par couple (`MPJ07`, 409 `PLAFOND_DECLARATIONS`), sous verrou consultatif ; la
  décision revient à `competence.gerer` ET ni la personne évaluée ni son déclarant, sauf associé
  (`MPJ04`, 403 `SEPARATION_DES_TACHES`).
- **Recherche unifiée** (CAP-07, `capitalisation/recherche.ts`) : plein texte français, DANS les droits
  de l'utilisateur : chaque source exige sa permission, chaque résultat appartient à une mission
  visible, rapports au niveau lisible et dont le fichier n'est ni supprimé ni purgé, preuves à la
  version courante sans verbatim nominatif masqué, retours d'expérience validés seulement ; plafond de
  60 recherches par utilisateur et par minute (429 `TROP_DE_RECHERCHES`, comptées sur `journal_audit`) ;
  chaque recherche est journalisée SANS le texte cherché. Index GIN sur les mêmes expressions (`0464`) ;
  aucune donnée copiée. Aucune agrégation entre cabinets : l'observatoire inter-cabinets (CAP-04,
  adhésion volontaire, `DECISIONS.md`) n'existe pas.
- **Prévisions et pré-remplissage** (AUT-12, AUT-09) : voir §6.

## 6. Confidentialité financière (FIN-02) et historique immuable

- **Champs ABSENTS sans `finance.lire`** (jamais masqués à zéro ni à `null`
  sauf mention contraire) : coûts, taux de vente, marges, rentabilité. Appliqué
  dans `missions/budget.ts`, `routes/budget.ts`, `routes/propositions.ts`,
  `routes/grades.ts`, `routes/collaborateurs.ts`, `routes/taux-clients.ts`,
  `routes/finance-analyses.ts`, `routes/indicateurs.ts`, `routes/bilans.ts` ;
  en V2, coût, modèle et jetons d'une génération IA (`ia/generations.ts`) et
  rapports de niveau `finance` (§8 bis). Tests : `budget.test.ts`,
  `durcissement-missions.test.ts`, `finance-indicateurs.test.ts`,
  `collaborateurs.test.ts`. Exception documentée : sur le document de facture,
  les montants unitaires de régie sont rendus « — » sans `finance.lire`
  (`facturation/document.ts`).
- **Journal d'audit** : `journaliser(db, …)` dans la même transaction que
  l'action (`audit.ts`) ; `REVOKE UPDATE, DELETE ON journal_audit` pour le rôle
  applicatif (`0001`) ; test `isolation.test.ts`. Les actions 2FA, les
  changements de coordonnées bancaires (IBAN masqué par `masquerIban`), de
  paramètres IA (clé jamais journalisée) et les accès du portail y figurent.
- **Immuabilité par déclencheurs** (SQLSTATE dédiés, traduits par les routes) :

  | Code       | Objet figé                                                                  | Migration            |
  | ---------- | --------------------------------------------------------------------------- | -------------------- |
  | `MPF01`    | budget initial et versions de budget, signature de mission                  | `0011`, `0013`, `0015` |
  | `MPF02`    | proposition figée                                                           | `0010`               |
  | `MPF03`    | absences (statut seul modifiable)                                           | `0020`, `0021`       |
  | `MPT01-04` | feuille soumise/validée, période de temps clôturée, correction décidée      | `0030`               |
  | `MPB01`    | facture soumise ou émise (corrigée par avoir), lignes, liens                | `0043`, `0044`       |
  | `MPB02`    | débours validé, justificatif                                                | `0041`, `0072`       |
  | `MPB03`    | échéance facturée                                                           | `0042`, `0043`       |
  | `MPB04`    | numérotation de factures                                                    | `0043`, `0044`       |
  | `MPE01-02` | encaissements et imputations en ajout seul, contre-passations               | `0060`               |
  | `MPE03`    | bilan de clôture (snapshot)                                                 | `0062`               |
  | `MPE04`    | retour d'expérience au-delà de 30 jours après la clôture                    | `0062`               |
  | `MPD01`    | statut et contenu validé des documents de mission (valideur ≠ auteur)       | `0071`               |
  | `MPC01`    | commentaire (délai de modification, commentaire supprimé)                   | `0074`               |
  | `MPC02`    | identité d'une tâche assignée figée (ne partage plus `MPT01`)               | `0075`, `0076`       |
  | `MPI01-04` | historique IA en ajout seul (seule exception : anonymisation du texte par `purger_textes_ia`), versions de prompt consécutives, identité d'une demande figée, contenu validé définitif | `0101`, `0102`, `0104` |
  | `MPP01-03` | famille de rôles et rattachement du portail, partage invalide, validation de jalon définitive | `0110`, `0111` |
  | `MPQ01-05` | modèle et version validée de questionnaire, envoi, répondants, réponse soumise, relances en ajout seul | `0140`–`0142` |
  | `MPQ06-08` | historique IA d'un questionnaire en ajout seul et rangs consécutifs (`MPQ06`), soumission après la date limite refusée (`MPQ07`), version d'origine IA validée sans validation humaine (`MPQ08`) | `0149`, `0150` |
  | `MPN01-07` | notation en ajout seul, cohérence du calcul, revue, publication par un expert et séparation des tâches (`MPN04`), grille figée (`MPN05`), calcul par la méthode en ajout seul (`MPN06`) et lié à la liaison courante de la mission (`MPN07`) | `0145`, `0146`, `0206` |
  | `MPK01-07` | champs figés d'un KPI, client de la mission, KPI inactif, date déjà mesurée, ajout seul, date hors suivi, 20 corrections | `0160` |
  | `MPK10-16`, `MPK20-27` | pilotage augmenté : rattachement d'un KPI, d'une alerte, d'une revue ou d'une décision à une autre mission (`MPK10`), champ figé (`MPK11`), parent de nœud invalide, aussi à la réactivation (`MPK12`), arbre trop grand : 50 nœuds actifs, 200 au total (`MPK13`), coefficient ≠ 1 sous un produit (`MPK14`), nœud non désactivable (`MPK15`), mission clôturée (`MPK16`), revue : statut initial, transition, contenu et compte rendu figés à la tenue, clôture avec suivi ouvert (`MPK20`–`MPK23`), décision hors revue tenue ou transition invalide (`MPK24`, `MPK25`), transition d'action invalide (`MPK26`), action rattachée à une revue qui n'est pas tenue (`MPK27`) | `0440`–`0445` |
  | `MPS01-08` | plan en ajout seul et rattachement figé, cohérence des éléments (dépendances, KPI d'objectif, cascade, évaluations de portefeuille : `MPS02`), auteur ≠ valideur, partage d'un contenu non validé, 200 versions du modèle ou changements de lien (`MPS05`), notation liée non publiée ou d'un autre client (`MPS06`), bibliothèque d'initiatives : variante qui ne reprend pas le code du standard, propriétaire ou numéro de version incohérent, observation sur une initiative d'un plan (`MPS07`), arbitrage de portefeuille incohérent ou écart sans motif (`MPS08`) | `0180`–`0184`, `0420`–`0423` |
  | `MPR01-03` | rapport de notation, de plan ou de dossier bancaire : source (notation, plan, version du modèle) inexistante ou d'une autre mission (`MPR01`), notation non publiée (`MPR02`), dossier bancaire sans version VALIDÉE du modèle financier (`MPR03`) | `0131`, `0424` |
  | `MPY01-11` | qualité : historiques en ajout seul, dont les relations entre clients et leurs retraits (`MPY01`), suivi (classe jamais abaissée, statut qui ne recule pas, livrable signé figé, empreinte du contenu relu figée : `MPY02`), élément de revue ajouté après validation (`MPY03`), session de revue close une fois (`MPY04`), étape de garde hors état (`MPY05`), signature d'un suivi non validé ou d'une autre version (`MPY06`), relation de clients en double, dans les deux sens (`MPY07`), validation ou signature sur un parcours de revue sans élément obligatoire (`MPY08`), niveau de risque d'acceptation abaissé après une décision (`MPY09`), attestation d'un item par l'auteur du livrable (`MPY10`), auteur désigné d'un livrable opaque qui n'est pas membre actif de la mission (`MPY11`) | `0280`–`0286` |
  | `MPV01-07` | registre des preuves : historique en ajout seul et champs figés d'une dimension (`MPV01`), cohérence mission, client, document, réponse ou lien, fichier lié rattaché à la mission ou au client de la preuve (ou orphelin téléversé par la personne qui saisit, jamais supprimé), auteur désigné membre actif de la mission (`MPV02`), versions consécutives (`MPV03`), avis d'expert signé par l'auteur de la version et par un expert métier ou un associé (`MPV04`), arbitrage d'une contradiction qui n'est plus courante (`MPV05`), classe de risque d'une assertion abaissée hors expert métier ou associé (`MPV06`), contradiction levée par l'auteur de l'assertion ou de la preuve contraire hors associé (`MPV07`) | `0240`–`0243` |
  | `MPM01-08` | référentiel de méthodes : version publiée et son contenu immuables (`MPM01`), incohérence de propriétaire, de numérotation ou d'identité (`MPM02`), historiques en ajout seul (liaison des missions, validations de dérogation, propositions : `MPM03`), décision de dérogation définitive, approuvée par son demandeur ou sans les validations exigées par sa classe de risque, quatre yeux (`MPM04`), circuit du comité méthode et relecteur ≠ auteur (`MPM05`), version liée à une mission non publiée, d'un autre cabinet ou plus ancienne (`MPM06`), variante publiée qui abaisse la classe de risque ou relève le niveau d'autonomie d'une brique du standard (`MPM07`), variante publiée par le créateur de la version hors associé (`MPM08`) | `0201`–`0203`, `0207`, `0209` |
  | `MPG01-09` | agents IA : historiques en ajout seul (`MPG01`), au-delà du plafond du standard ou agent inconnu (`MPG02`), changement de niveau d'autonomie refusé (`MPG03`), activation d'un prompt, choix d'un modèle ou exécution d'agent sans évaluation de non-régression réussie et admise (`MPG04`), incohérence d'exécution, de décision, de contribution ou de jeu (`MPG05`), validation d'un contenu issu d'une sortie d'agent non conforme (`MPG06`), classe de risque d'une brique sous le plancher de la méthode ou R0 déclarée hors associé (`MPG07`), restriction posée par un associé levée par un non-associé ou décision sur une exécution par qui n'en est ni le déclencheur, ni le chef ou directeur de la mission, ni associé (`MPG08`), demande de rejeu réel incohérente : transition d'état interdite, demande terminée modifiée, jeu ou prompt étranger, évaluation `openrouter` sans demande en cours du même prompt, jeu et modèle ou sans ses appels inscrits, demande « reussie » sans évaluation réussie issue d'elle (`MPG09`, traduit en 409 `EVALUATION_INCOHERENTE`) | `0260`–`0267`, `0270` |
  | `MPO01-04` | dossier client : tout en ajout seul (`MPO01`), remplacement d'un fait (même client, catégorie et clé, jamais un fait rejeté) ou d'un état financier (état courant du même exercice, un seul courant par exercice) (`MPO02`), décision sur un enregistrement remplacé ou fait extrait par l'IA confirmé dans sa transaction de création (`MPO03`), lignes d'état ajoutées hors de l'ingestion, acceptation automatique d'un état en écart ou de tolérance non nulle, acceptation humaine d'un état en écart ou de tolérance non nulle sans motif (`MPO04`) | `0220`–`0224` |
  | `MPX01-03` | clôture de mission (AUT-08) : historiques des vérifications et des dérogations en ajout seul (`MPX01`), dérogation accordée ou retirée par un utilisateur qui n'est ni associé ni directeur de mission actif (`MPX02`), clôture par l'auteur d'une dérogation en vigueur hors associé (`MPX03`) | `0320`–`0323` |
  | `MPU01-05` | moteur d'automatisation : historiques en ajout seul (`MPU01`), coupe-circuit levé par un non-associé (`MPU02`), annulation d'une action non annulable ou non réussie (`MPU03`), action vers le client autorisée hors classe R0 (`MPU04`), version courante absente ou événement incohérent, action d'une exécution non déclenchée, résultat incompatible avec la garde (`MPU05`) | `0300`, `0301` |
  | `MPL01-09` | salle de mission : historiques en ajout seul (`MPL01`), transition de statut d'une pièce refusée (`MPL02`), dépôt refusé : demande non envoyée, pièce déjà acceptée, fichier d'un autre déposant, déposant non rattaché au client (`MPL03`), incohérence mission, client, demande ou pièce (`MPL04`), demande ou pièce figée (`MPL05`), mission clôturée : dépôt, envoi ou création refusés, clôture refusée s'il reste une demande envoyée (`MPL06`), plafond de dépôts : 20 par pièce, 500 Mo par demande (`MPL07`), débit des dépôts du portail : 30 par utilisateur et par 10 minutes (`MPL08`), acceptation d'un dépôt par son déposant hors associé (`MPL09`) | `0330`, `0332` |
  | `MPA01-07` | appels d'offres (lot AO-A) : historiques en ajout seul et champs figés (événements, évaluations, décisions, dossiers, suivi de la matrice ; identité d'une fiche, d'une exigence ou d'une étape ; tâche d'une étape liée une fois : `MPA01`), transition de statut non admise (`MPA02`), décision go/no-go par un non-associé, hors statut attendu ou sur une évaluation qui n'est pas la dernière, statut « en réponse » ou « no-go » sans la décision correspondante (`MPA03`), dépôt avec une matrice vide ou une exigence obligatoire ni conforme ni sans objet (`MPA04`), extraction déjà tranchée (`MPA05`), matrice ou rétro-planning modifiés hors préparation de la réponse (`MPA06`), extraction validée sans acquittement de ses nombres non vérifiés (`MPA07`) | `0360`–`0363` |
  | `MPW01-06` | banques et offres d'appels d'offres (lot AO-B) : tout en ajout seul, seuls le retrait motivé d'une pièce (une fois) et l'anonymisation d'un CV (`MPW01`), versions consécutives (`MPW02`), mission d'une référence qui n'est pas celle du client cité ou validation d'une version d'offre technique qui n'est pas la dernière (`MPW03`), validation d'un brouillon IA sans acquittement de ses nombres non vérifiés (`MPW04`), validation d'une offre technique par son créateur, l'auteur d'une version ou le demandeur d'un brouillon IA hors associé (`MPW05`), CV inconnu, déjà anonymisé ou nouvelle version sur un CV anonymisé (`MPW06`) | `0380`–`0383`, `0385`, `0386` |
  | `MPJ01-08` | capitalisation : historiques en ajout seul (`MPJ01`), circuit du retour d'expérience : validation définitive d'une version existante, versions consécutives (`MPJ02`), rattachement tâche-brique sur une mission clôturée (`MPJ03`), niveau de compétence validé par la personne évaluée ou par son déclarant hors associé (`MPJ04`), incohérence mission, retour, collaborateur ou compétence (`MPJ05`), déclaration de niveau déjà en attente pour le couple (`MPJ06`), plus de 50 déclarations par couple (`MPJ07`), retour validé par qui n'est ni associé, ni chef, ni directeur de la mission, ou n'est pas l'utilisateur de la session (`MPJ08`) | `0460`–`0463`, `0465` |
  | `MPN08-12` | notation augmentée : item de banque validé figé, créé hors brouillon ou incohérent avec son contenu (`MPN08`), sélection d'items en ajout seul citant un item non validé, une formulation hors de l'item ou un item en double (`MPN09`), indice de confiance en ajout seul ou sous le seuil courant, publication sans indice publiable de la même transaction (`MPN10`), session de calibrage figée hors clôture par un expert métier, cotation sur session close, cas inconnu ou niveau hors échelle (`MPN11`), initiative type supprimée ou code figé, impacts et plans d'action en ajout seul, plan sur une version d'une autre notation (`MPN12`) ; plancher du seuil de confiance (≥ 0,3) et de la cible de répondants (≥ 2) par CHECK `NOT VALID`, sans SQLSTATE dédié | `0400`–`0404` |

  Ajout seul par `REVOKE UPDATE, DELETE` (ou `DELETE` seul), entre autres :
  fichiers, révisions et suppressions de commentaires (`0070`, `0074`),
  `relances_factures` (`0061`), `ia_generations` et `ia_consommations`
  (`0102`, l'anonymisation de `0104` exceptée), `portail_validations_jalons`
  (`0111`), `rapports_mission` (`0130`), `questionnaire_ia_historique` (`0149`),
  `plan_diagnostic_notations` (`0182`), `plan_objectif_kpis` (`0183`) ; UPDATE
  seul révoqué sur `saisies_idempotence` (`0122`).
- **Numérotation sans trou** : `sequences_facturation` (clé cabinet, nature,
  exercice) n'accepte qu'un incrément de un (`MPB04`, `0043`), le numéro est
  attribué à l'émission sous verrou (`facturation/factures.ts`), `DELETE`
  révoqué.
- **Montants et scores** : entiers en unités mineures (`bigint`) calculés par
  `packages/engines` (voir CODING_STANDARDS §3) ; le LLM n'en produit aucun
  (AGENTS.md), la garde-chiffres le contrôle (§7 bis).

**Prévisions du cabinet et pré-remplissage des temps (AUT-12, AUT-09).**
`GET /api/previsions` (chiffre d'affaires et charge sur 12 mois) exige `finance.lire` :
associés et gestionnaires seuls, la réponse entière est refusée (403) aux autres rôles, rien
n'est masqué par un zéro ; il agrège tout le cabinet (ces deux rôles détiennent aussi
`mission.lire_toutes`), sans coût journalier ni marge. Aucune table nouvelle, aucune migration,
aucun SQLSTATE. `GET /api/temps/preremplissage` (`temps.saisir`) est en LECTURE SEULE : il ne crée
ni feuille ni ligne, ne lit que les données du consultant connecté (ses affectations et sa
propre activité), ne propose que des tâches qui lui sont affectées, jamais sur un mois clôturé
ni une feuille soumise ; l'enregistrement passe toujours par le circuit habituel de la feuille.
Aucune de ces routes n'est dans `LISTE_BLANCHE_PORTAIL`. Test : `test/previsions.test.ts`
(base `missionpilot_prev`). La date de référence des prévisions est bornée (`dateIsoBorneeSchema`) ;
la semaine du pré-remplissage ne l'est pas (`semaineQuerySchema`, dette : §15).

**Appels d'offres, lot AO-A (AO-01 à AO-03, AO-08).** Migrations `0360`–`0363`, code
`apps/api/src/appels-offres/`, routes `routes/appels-offres.ts` (24 routes, 50 avec le lot AO-B), moteur
`packages/engines/src/appels-offres`, tests `test/appels-offres.test.ts` et
`test/appels-offres-ia.test.ts` (base `missionpilot_aoa`). Neuf tables (`appels_offres`,
`appels_offres_evenements`, `ao_evaluations`, `ao_decisions`, `ao_dossiers`, `ao_extractions`,
`ao_exigences`, `ao_exigences_suivi`, `ao_retroplanning_etapes`), toutes à RLS `isolation` et
`portail_interdit`, clés étrangères composites, `DELETE` retiré au rôle applicatif ; aucune route
dans `LISTE_BLANCHE_PORTAIL`. Droits : `ao.lire`, `ao.gerer`, `ao.decider` (associé seul, doublé
en base : décideur associé actif, `MPA03`) ; `ia.utiliser` en plus pour l'extraction par l'IA,
`tache.assigner` pour confier une étape, l'assigné devant lui-même détenir `ao.lire` (la tâche porte
le nom de l'appel d'offres). Le menu « Confier à » se nourrit de `GET /api/appels-offres/assignables`
(`tache.assigner`, sans exiger `collaborateurs.lire`) : il ne rend que les utilisateurs ACTIFS du cabinet
(RLS) dont un rôle porte `ao.lire` (`ROLES_CABINET` filtrés par `aPermission`, jamais un rôle du
portail), avec `utilisateur_id`, `nom` et `grade_libelle` seulement (aucune donnée financière, aucun
e-mail), plafonné à 200 avec l'indicateur `tronquee` ; il n'expose donc pas le reste des utilisateurs
(`personnesAssignables`, `appels-offres/retroplanning.ts`) ; fermé au portail (§4 bis). Le plafond est de 20 dossiers et de 50 extractions par fiche. Une
extraction qui cite des nombres non vérifiés ne se valide qu'une fois ceux-ci acquittés (409 côté API,
doublé en base : `MPA07`, `0363`). **FIN-02** : la marge estimée d'une évaluation go/no-go ne
se saisit qu'avec `finance.lire` (403 `MARGE_RESERVEE`) ; sans ce droit, la réponse ne porte ni la
marge, ni sa cible, ni la note du critère marge, ni l'éliminatoire « marge non positive », ni
l'indicateur `marge_renseignee` (champs absents), et le score, la recommandation et les
éliminatoires sont RECALCULÉS par le moteur SANS la marge à partir des entrées (`vueEvaluation`) :
servir le score ou la recommandation enregistrés avec la marge permettrait de déduire la note de
marge, et un « no go » trahirait une marge nulle ou négative. Le journal ne porte jamais la
marge ni le contenu d'un dossier. **AGT-07** : le dossier d'appel d'offres (texte collé ou fichier
TEXTE de 1 Mo au plus, lu borné ; aucune clé vers `fichiers`, donc rien à ajouter à
`fichier_orphelin`) est une donnée non fiable : signaux d'injection relevés et conservés, dossier
et titre transmis à l'orchestrateur comme variables non fiables (encadrées, masquées, jamais dans
les consignes) ; la sortie n'est qu'un BROUILLON dont rien n'entre dans la matrice sans validation
humaine ; aucune action n'est déclenchée par le contenu (test d'injection). Aucun appel externe :
la veille est une saisie ou un import manuel ; l'adresse de l'avis (http ou https seulement,
contrôlée en base) n'est jamais visitée par le serveur. **Risques acceptés** : les fiches sont
visibles de tout détenteur de `ao.lire` du cabinet (donnée commerciale, comme le pipeline) ; le
nom et le statut de la tâche liée à une étape sont montrés à ces mêmes lecteurs ; poids et seuils
du rapprochement et du go/no-go sont des valeurs de départ à calibrer (`DECISIONS.md`).

**Banques et offres des appels d'offres (AO-04 à AO-07, lot AO-B).** Migrations `0380`–`0386`,
code `apps/api/src/banque-ao/`, routes `routes/banque-ao.ts` (`/api/banque-ao/*`, 26 routes), moteurs
`packages/engines/src/banque-cv` et `offre-financiere`, tests `test/banque-ao-{cv,references,offres}.test.ts`
(base `missionpilot_aob`). Onze tables (`ao_cv`, `ao_cv_versions`, `ao_cv_gabarits`,
`ao_references`, `ao_reference_versions`, `ao_attestations`, `ao_offres_techniques`,
`ao_offre_technique_versions`, `ao_offre_technique_validations`, `ao_offres_financieres`,
`ao_offre_financiere_versions`), toutes à RLS `isolation` et `portail_interdit`, clés étrangères
composites ; `ao_cv_gabarits` admet en plus des gabarits STANDARD (`cabinet_id` nul, politique
`standard_lecture` en lecture seule). Tout est en ajout seul (`REVOKE UPDATE, DELETE`, `MPW01`) :
une correction est une nouvelle version motivée (`MPW02` versions consécutives) ; seule une pièce
justificative se retire, une fois et motivée (colonnes de retrait seules accordées en `UPDATE`) ;
le retrait est réservé à qui a ajouté la pièce, à un associé ou à un directeur de mission (403
`RETRAIT_PIECE_INTERDIT` sinon, code propre depuis le 2026-10-10 ; avant, 403 `INTERDIT`). Aucune route dans `LISTE_BLANCHE_PORTAIL`. Droits : `ao.lire`, `ao.gerer` ; **FIN-02** : l'offre
financière (taux journaliers) exige `ao.lire` ET `finance.lire` pour toute lecture, simulation
comprise, et `taux.gerer` en plus pour écrire (associé, gestionnaire) ; le journal n'en porte ni
taux ni montant. Le montant d'une référence est celui du marché (public), pas une donnée FIN-02.
Un CV ne porte aucun coût. **Pièces** : fichier téléversé par `POST /api/fichiers` puis rattaché
sous verrou (`exigerFichierRattachable` : orphelin, de l'utilisateur, récent) ;
`fichier_orphelin` est redéfinie en `0384` avec `ao_attestations` (pièce non retirée) EN PLUS de
toutes les références antérieures, `salle_depots` (`0331`) comprise ; téléchargement par
`GET /api/banque-ao/attestations/:id/fichier` seulement (`ao.lire` revérifié, pièce non retirée,
mêmes en-têtes que `GET /fichiers/:id`, journalisé) : `GET /fichiers/:id` traite un fichier cité par
une pièce non retirée comme rattaché (comme un dépôt de la salle de mission) et répond 404 hors de
ces routes dédiées, même à son auteur (`stockage/fichiers.ts`, `exigerFichierLisible`) ; une pièce
retirée libère son fichier, que la purge à 24 h efface (la ligne et ses métadonnées restent). Une mission citée par une référence doit être visible de
l'utilisateur (404 sinon) et appartenir au client cité (`MPW03`). **IA (AGT-07)** : l'offre
technique passe par l'orchestrateur (`ia.utiliser` en plus) ; termes de référence et objectifs
du client sont des variables NON FIABLES (encadrées, masquées, jamais dans les consignes) ; le
modèle ne rédige que la compréhension et la méthodologie, le planning (temps type saisis dans la
méthode, sans calcul) et l'équipe (années d'expérience du moteur) sont construits par le code ;
repli déterministe sans clé ou au plafond. Une version n'est utilisable qu'une fois VALIDÉE par
un humain, la dernière seulement (`MPW03`), nombres non vérifiés du brouillon acquittés (409
`CHIFFRES_A_ACQUITTER`, `MPW04`). **Séparation des tâches** (`0385`) : le valideur n'est ni le créateur
de l'offre, ni l'auteur d'une version (brouillon ou modification), ni le demandeur d'une génération IA,
sauf associé (403 `APPROBATION_REQUISE`, doublé en base : `MPW05`). Le détail d'une offre
(`GET /api/banque-ao/offres-techniques/:id`) porte `peut_valider`, calculé par la même fonction
(`estValideurDistinct`) : confort d'affichage qui désactive le bouton, l'API reste seule juge. Une version qui contient encore un
repère du gabarit (« [À rédiger par l'expert : » ou « [À adapter par l'expert ») est refusée (409
`OFFRE_A_COMPLETER`) : le texte de repli du code ne se valide pas tel quel.
Méthode liée : `standard.lire` en plus, version publiée et visible (404 sinon). **Export d'un CV**
au format d'un bailleur (Word, PDF par l'infrastructure de rapports, texte échappé, non conservé)
: 20 exports par utilisateur et par 10 minutes (429 `TROP_D_EXPORTS_CV`). **Anonymisation d'un CV**
(`0386`, départ d'une personne, droit à l'effacement ; `POST /api/banque-ao/cv/:id/anonymisation`) :
`cabinet.gerer`, motif, reconfirmation d'identité (mot de passe, et code si la 2FA est active ; contexte
`anonymisation_cv`, §3) ; irréversible, par la fonction `SECURITY DEFINER` `anonymiser_cv_ao` (§4) qui
remplace le nom, détache le collaborateur et vide le contenu de chaque version ; les déclencheurs
d'ajout seul de `ao_cv` et `ao_cv_versions` n'admettent QUE cette transition (jamais un `UPDATE` libre ni
un `DELETE`) ; plus de nouvelle version, d'export ni d'offre sur un CV anonymisé (409 `CV_ANONYME`,
`MPW06`) ; le journal ne porte ni nom ni contenu. L'écran web (`AnonymisationCv`) demande le motif, la
reconfirmation (mot de passe, et code si la 2FA est active) puis une confirmation en deux temps, et vide
les champs secrets après une tentative refusée ; la liste des CV porte `anonymise` (booléen déduit de
`anonymise_le`, aucune donnée personnelle de plus). **Plafonds** : 100 gabarits de CV par cabinet
(`GABARITS_CABINET_MAX`). Les dossiers d'appel d'offres sont des contenus clients NON fiables (AGT-07,
§6 AO-A). **Risques acceptés** : les CV (données personnelles des experts : parcours, diplômes,
nationalité facultative) sont lisibles de tout détenteur de `ao.lire` du cabinet ; le texte d'une offre
technique DÉJÀ rédigée (section « organisation ») peut citer le nom d'un expert : ces versions sont en
ajout seul et ne sont pas réécrites par l'anonymisation ; aucune durée de conservation automatique des CV
n'est posée (à valider, `DECISIONS.md`, §12) ; les gabarits standard de CV par bailleur sont indicatifs
(`DECISIONS.md`).

## 7. Assainissement des entrées et des sorties

- **Validation** : schémas Zod `.strict()` partagés (`packages/shared/src/schemas/`,
  550 `z.object`, tous stricts), corps JSON limité à 1 Mio (`app.ts`
  `bodyLimit`) ; paramètres `id` en UUID (`http/outils.ts`). Les erreurs Zod
  renvoient 400 `REQUETE_INVALIDE`. Une `AppError` ne transmet de `details` que
  les champs de la liste blanche `CHAMPS_DETAILS_PUBLICS` (`errors.ts` :
  `violations`, `erreurs`, `manquants` ; tableaux tronqués à 200) : jamais une
  trace, une requête, un `detail` PostgreSQL ou une valeur de secret.
- **SQL** : requêtes paramétrées (`$n`). Les interpolations dans un gabarit SQL
  sont des constantes de code, des fragments construits depuis des listes fixes
  (`clauseSet`, noms de colonnes validés `^[a-z_]+$`, `db/outils.ts` ;
  `filtreVisibilite` ; listes `COLONNES_*`), des choix entre constantes selon une
  valeur d'enum validée, ou `FOR UPDATE`. Inventaire reproductible dans la
  checklist de relecture (n° 11). `motifContient` échappe les jokers `ILIKE`
  (`http/outils.ts`).
- **HTML** : le document de facture échappe tout texte (`facturation/document.ts`
  `echapper`) et est servi avec `Content-Security-Policy: default-src 'none';
  style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';
  frame-ancestors 'none'`, `nosniff`, `private, no-store`
  (`routes/factures.ts`). Le HTML des rapports est échappé et porte sa propre
  CSP (`rapports/html.ts`, `CSP_RAPPORT`). Aucun `dangerouslySetInnerHTML` ni
  `innerHTML` dans `apps/web/src`.
- **CSV** : l'export comptable neutralise les formules par un préfixe `'` et est
  servi en `attachment` avec `nosniff` et `private, no-store`
  (`finance/export.ts`, `routes/export-comptable.ts`). L'import des temps
  accepte le CSV et le classeur `.xlsx` (§8, « Import Excel ») ; les deux passent
  par le même contrôle (`temps/import.ts`).
- **E-mail** : adresse ASCII stricte (`ADRESSE_ASCII` dans `config.ts`),
  sujet sur une ligne sans caractère de contrôle, encodé RFC 2047, corps en
  base64, aucune citation du texte du serveur dans les erreurs
  (`notifications/smtp.ts`). Les e-mails en file sont chiffrés
  (`usage file_email`, `notifications/charge-email.ts`).
- **Erreurs** : enveloppe `{erreur:{code,message}}` ; une erreur 500 ne renvoie
  jamais le détail, et la journalisation ne retient que message, code,
  contrainte et table (le champ `detail` PostgreSQL peut citer des données) ;
  `app.ts` `setErrorHandler`.
- **Secrets jamais journalisés** : aucun `console.log` ni `log.*` ne reçoit de
  secret ; les messages SMTP, IA et de configuration ne citent pas la valeur
  (`config.ts`, `notifications/smtp.ts`, `ia/fournisseur.ts`). Le transport
  « journal » de développement n'affiche le contenu des e-mails qu'en
  développement (`notifications/mailer.ts`).
- **Idempotence des saisies de temps** (`temps/idempotence.ts`, `0122`) : en-tête
  `Idempotency-Key` (8 à 100 caractères `A-Za-z0-9_-`, sinon 400) de
  `PUT /feuilles-temps/:id/lignes`. La clé est enregistrée dans la transaction de
  la saisie (une saisie refusée n'en laisse pas) avec l'empreinte SHA-256 du
  contenu ; un rejeu identique ne ré-applique rien et répond l'état courant
  (`Idempotency-Replayed: true`), même clé pour une autre feuille ou un autre
  contenu : 409 `CLE_IDEMPOTENCE_REUTILISEE`. Unicité par cabinet, utilisateur et
  clé ; clés de plus de 30 jours supprimées au fil des saisies ; table fermée au
  portail. Sans l'en-tête, le comportement est inchangé.
- **Dates métier bornées** : une date qui alimente une colonne à `CHECK` SQL (2000-01-01 à
  2100-12-31) passe par `dateIsoBorneeSchema` (`packages/shared/src/schemas/commun.ts`) ; le
  SQLSTATE 23514 qui échapperait au schéma est traduit en 400 `REQUETE_INVALIDE` par la couche
  d'erreurs du domaine, jamais en 500. Exception connue : `semaineQuerySchema` (§15).
- **File de tâches** : toute constante `TYPE_JOB_*` exportée par le code a son handler dans
  `jobs/registre.ts` (sinon le worker ne l'exécuterait jamais et la file se remplirait en silence) ;
  `test/jobs-registre.test.ts` l'impose par un inventaire automatique des sources, seule
  `TYPE_JOB_EMAIL` en étant exclue (handler fourni par `registreAvecEmails`). Y figurent désormais
  `relance_salle_mission` (§8 septies) et les trois jobs d'automatisation (§5 quinquies).

## 7 bis. IA (ADR-003)

- **Désactivée par défaut** : `ia_parametres_cabinet.ia_activee` est faux par
  défaut, ligne absente comprise (`0103`, `ia/parametres.ts`) ; sans activation
  ou sans clé, les générations passent par des gabarits déterministes
  signalés comme tels (`ia/gabarits.ts`).
- **Clé du cabinet** : AES-256-GCM par le trousseau, usage `ia_cle_api`, AAD
  `ia_cle_api:<cabinet>` (un chiffré recopié dans un autre cabinet ne se
  déchiffre pas). Déchiffrée seulement au moment de l'appel ; jamais renvoyée
  (les routes ne rendent que `cle_configuree`), jamais journalisée (le journal
  note « définie » ou « retirée »). Définir ou retirer la clé, ou relever le
  plafond, exige la reconfirmation d'identité (§3) ; chaque changement de clé
  alerte tous les associés (notification et e-mail en file). Chiffré écrit avec
  une clé maître précédente : rechiffré avec la clé courante à sa première
  lecture réussie. Chiffré **illisible** : repli sur gabarit et alerte
  `ia_cle_illisible` aux associés (une par jour au plus), **jamais** de bascule
  sur la clé de plateforme (`ia/parametres.ts` `resoudreCle`).
- **Entrée envoyée au modèle** : jamais stockée en clair (empreinte HMAC et
  liste des champs dans `ia_demandes`) ; une demande en file porte son entrée
  chiffrée (usage `ia_entree`) dans la charge du job, effacée à la fin du job
  ou à l'annulation (`0102`).
- **Fournisseur** (`ia/fournisseur.ts`, seul module qui appelle un modèle) :
  URL = `OPENROUTER_BASE_URL` de la configuration seule (HTTPS, HTTP admis pour
  la boucle locale ; pas de SSRF), redirections refusées,
  `provider.data_collection = "deny"`, délai `IA_TIMEOUT_MS`, reprise limitée
  (429, 5xx, réseau ; jamais après un délai dépassé), réponse plafonnée lue en
  flux, journal sans prompt, sans clé, sans contenu. Modèles : format en liste
  blanche en base (`ia_modeles_taches`, `0100`) et seuls les modèles au tarif
  connu sont acceptés (`ia/modeles.ts`).
- **Coût et quotas** (`ia/couts.ts`) : plafond mensuel du cabinet (défaut
  50 USD) ; avec la clé de plateforme, plafond effectif = plus petit de celui
  du cabinet et d'`IA_PLAFOND_PLATEFORME_MICRO_USD` (défaut 50 USD). Le coût
  estimé de chaque appel est **réservé** avant l'appel sous verrou consultatif
  du cabinet (`ia_reservations`, `0103`) et compté avec la consommation ; au
  plus 10 appels simultanés par cabinet (429), 50 générations par utilisateur
  et par jour civil UTC ; une réservation orpheline expire après 30 min ;
  alertes à 80 % et 100 % du plafond. Coûts lisibles avec `ia.configurer` et
  `finance.lire` (`routes/ia-couts.ts`).
- **Masquage avant envoi** (`ia/masquage.ts`) : forme NFKC, jetons déjà
  présents dans l'entrée neutralisés ; remplacés par des jetons stables
  (démasqués localement, table jamais persistée) : adresses e-mail, termes
  sensibles fournis explicitement (personnes, organisations, lieux ; casse,
  accents et séparateurs souples), IBAN, RCCM, numéros de contribuable
  introduits par un mot-clé (CC, NCC, IFU, NINEA, NIF…), téléphones
  internationaux et nationaux. **Limites** : un nom propre absent de la liste
  des termes passe en clair, un identifiant hors des formats connus aussi, un
  jeton altéré par le modèle n'est pas démasqué.
- **Garde-chiffres** (`ia/garde-chiffres.ts`) : tout nombre de la sortie absent
  de la liste blanche des valeurs calculées par les moteurs (tolérance
  d'affichage et 5 % relatifs) marque la génération `chiffres_non_verifies` ;
  la validation exige alors un acquittement explicite. Nombres triviaux
  ignorés : numérotation consécutive depuis 1 (50 au plus), années et dates
  présentes dans les entrées, jetons connus du masque, identifiants courts
  collés à des lettres (deux chiffres au plus : « T1 », « 4G »). **Limite** :
  un nombre écrit en lettres ou en chiffres romains n'est pas détecté.
- **Validation humaine** (SOC-06, `ia/generations.ts`) : versions en ajout seul
  (`ia_generations`) ; « valider » fige le contenu (`MPI04`) ; séparation des
  tâches (§5) ; seul un contenu validé est `livrable_client`, et **jamais** un
  essai fait avec un prompt « exemple ». Toutes les tables `ia_*` sont
  `portail_interdit` (`0114`).
- **Conservation** (`0104`, `ia/conservation.ts`) : le texte démasqué d'une
  génération est anonymisé (texte vidé, données effacées, drapeaux de chiffres
  remis à zéro ; version, statut, auteur, empreintes, coût conservés) quand la
  dernière version de sa demande a plus de `conservation_jours` jours (365 par
  défaut, 30 à 3 650 par cabinet). Le rôle applicatif n'a toujours aucun droit
  UPDATE : la purge passe par la fonction `SECURITY DEFINER` `purger_textes_ia`
  (cabinet du contexte seulement), appelée par le job `ia_conservation`
  (un job par cabinet et par jour, clé `ia_conservation:AAAA-MM-JJ`, planifié
  seulement si une demande est purgeable). Le déclencheur d'ajout seul
  n'autorise que cette anonymisation. Durée par défaut **à valider avec le conseil
  juridique** ; `conservation_jours` n'est pas encore exposé par l'API IA.
- **Périmètre réel** : les routes génériques `/api/ia/*` et la génération de
  questionnaires (`questionnaires/generation-ia.ts`, §5 bis) appellent
  l'orchestrateur, ainsi que, depuis les vagues 2 et 3, l'extraction d'exigences et
  la rédaction de l'offre technique des appels d'offres (§6), le brouillon de retour
  d'expérience (`capitalisation/ia.ts`, §5 sexies) et l'appel d'un agent par une
  automatisation (job `automatisation_agent`, §5 quinquies, qui passe par
  `executerAgent`) ; ni la notation, ni les plans, ni les rapports ne lancent de
  génération (rédaction assistée non faite).
- **Agents IA** (lot AGT de la vague 1, ADR-005, migrations `0260`–`0267` et
  `0270`, `agents/`, `routes/agents.ts`) : l'orchestrateur reste le SEUL composant qui
  appelle un modèle ; une exécution d'agent EST une demande de l'orchestrateur
  (`agents/executions.ts` : `executerAgent`, `enregistrerExecutionAgent`).
  - **Droits du déclencheur** : `ia.utiliser` et les permissions déclarées par
    l'agent (`agents_registre.droits`), mission visible ; un agent désactivé
    (409 `AGENT_INACTIF`) ou une brique en N0 (409 `AUTONOMIE_N0`) n'exécutent
    rien. Registre standard sans `cabinet_id`, en lecture seule pour le rôle
    applicatif (politique `lecture`, `REVOKE`) ; un cabinet ne peut que
    restreindre (`MPG02`).
  - **Données non fiables** (AGT-07, `ia/donnees-non-fiables.ts`) : une variable
    déclarée `variablesNonFiables` est masquée, neutralisée (NFKC, invisibles et
    marques de direction retirés, délimiteurs `<<<`/`>>>` et accolades cassés)
    puis encadrée (consigne explicite, bloc étiqueté au même identifiant) ; elle
    ne peut pas figurer dans le message système (400). Pour un agent qui LIT du
    contenu client (`lit_contenu_client`), toute variable d'entrée est non fiable par
    défaut, sauf celles que l'appelant déclare explicitement fiables
    (`variablesFiables` : texte produit par le cabinet ou par le code) ; le gabarit
    système d'un tel agent ne peut porter ni variable non fiable ni `{{chiffres}}`
    (libellés possiblement repris d'une saisie du client). La neutralisation précède
    le masquage (un terme sensible coupé par un caractère invisible serait sinon
    envoyé en clair) ; la famille de caractères invisibles retirés est étendue et
    leur seule présence est un signal (`caracteres_invisibles`). Les signaux d'injection
    relevés sont tracés avec l'exécution (signal, pas barrière). Une sortie
    n'appelle aucun outil (`agents/garde-actions.ts`, `ACTION_DEPUIS_SORTIE`) ;
    une action modifiante exige un humain qui confirme, ou un événement sur une
    brique N4 (R0, coupe-circuit levé). Les contrats de sortie n'admettent aucun
    champ de commande (`ia/sortie-agent.ts`). Tests : `agents-injection.test.ts`,
    `agents-executions.test.ts`.
  - **Sorties validées** (AGT-02) : revalidation stricte contre le contrat de
    l'agent ; une sortie non conforme ne peut qu'être rejetée (409
    `SORTIE_AGENT_NON_CONFORME`, doublé en base `MPG06`, `0266`).
  - **Autonomie** (AGT-03) : promotion en N3 ou N4 par un associé seul
    (`autonomie.decider`, doublé en base `MPG03`), palier par palier, sur
    éligibilité du moteur pur ; un incident majeur rétrograde automatiquement en
    N2, et le signaler exige `agent.gerer` ou `autonomie.decider` (un incident mineur
    reste ouvert à `agent.lire`) ; coupe-circuit N4 du cabinet (le lever : associé,
    `MPG03`). L'éligibilité ne compte pas les exécutions en mode dégradé (aucun modèle,
    elles ne mesurent pas l'agent). Rôles doublés en base (`0267`) : décider d'une
    exécution est réservé à son déclencheur, au chef ou au directeur de la mission, ou à
    un associé (403 `ACTION_RESERVEE`, `MPG08`) ; une restriction posée par un associé ne
    se lève (réactivation, niveau relevé) que par `autonomie.decider` (`MPG08`) ; la
    classe de risque d'une brique n'est jamais sous le plancher des `methode_briques` du
    même code (409 `CLASSE_RISQUE_SOUS_PLANCHER`, `MPG07`) et une brique R0 est réservée à
    `autonomie.decider` (403 `ACTION_RESERVEE`, `MPG07`). Contributions sans mission : lues
    par `agent.gerer`, leur auteur ou le déclencheur de l'exécution mesurée. Historiques en
    ajout seul (`MPG01`, `REVOKE UPDATE, DELETE`).
  - **Non-régression** (AGT-04) : la base refuse l'activation d'une version de
    prompt doté d'un jeu d'essai, ou le choix d'un modèle pour sa tâche, sans
    évaluation réussie (`MPG04`, déclencheurs sur `ia_prompt_activations` et
    `ia_modeles_taches`) ; le premier jeu épingle la version active. Évaluations
    sur le fournisseur LOCAL déterministe (`ia/fournisseur-local.ts`), aucun
    appel externe : il renvoie l'écho des messages rendus (ADR-005). Une évaluation
    LOCALE réussie prouve le rendu des messages avec les variables du jeu, la présence
    ou l'absence des éléments exigés par les critères, les listes blanches de chiffres
    et une sortie constructible selon le schéma ; elle ne prouve ni la qualité
    rédactionnelle d'un modèle ni sa résistance à l'injection. Elle n'est donc admise
    que par le réglage de transaction `app.evaluation_locale_admise`, posé par l'API
    en développement et en test seulement (`reglerEvaluationLocale`, `0265`) ; en
    production, seule une évaluation `openrouter` active un prompt ou un modèle
    (réglage absent : strict). Un agent n'exécute qu'un prompt dont la version active
    a un jeu d'essai ET une évaluation réussie et admise sur le modèle routé (409
    `JEU_ESSAI_REQUIS`, `NON_REGRESSION_REQUISE`, doublé en base `MPG04` sur
    `agents_executions`). Un jeu d'essai (ajout seul) ne perd ni cas ni critère sans
    `autonomie.decider` (409 `JEU_ESSAI_AFFAIBLI`, `details.manquants`) ; les variables
    et chiffres des cas ne sont lus que par l'auteur du jeu ou `agent.gerer`
    (`donnees_cas_masquees` pour les autres). **Conséquence** : en production, seule
    une évaluation `openrouter` rend un agent exécutable ; elle naît du rejeu réel
    (ci-dessous). Les routes `routes/ia-prompts.ts` et `routes/ia-parametres.ts`
    traduisent `MPG04` en 409 `NON_REGRESSION_REQUISE` ; une nouvelle version d'un
    prompt doté d'un jeu d'essai est créée inactive quand `activer` est omis (409
    si `activer: true` explicite : elle n'a encore aucune évaluation). **Limite** :
    revenir au modèle recommandé n'est pas gardé.
  - **Rejeu réel sur OpenRouter** (AGT-04, migration `0270`,
    `agents/evaluations-openrouter.ts`, job `agents_evaluation_openrouter`) :
    - **Provenance** : une évaluation `fournisseur = 'openrouter'` n'existe que née d'une
      DEMANDE (table `agents_evaluations_demandes`, `portail_interdit`, états terminaux
      figés) ; `CHECK` (`fournisseur <> 'openrouter'` ou demande et statut renseignés) et
      déclencheur qui exige une demande EN COURS du même prompt, jeu et modèle, le même
      nombre de cas et, pour une évaluation réussie, au moins `cas_total` appels inscrits en
      succès dans `ia_consommations` (colonne `evaluation_demande_id`) ; SQLSTATE `MPG09`
      (409 `EVALUATION_INCOHERENTE`). Une évaluation incomplète, échouée ou arrêtée par un
      plafond a `reussie = false` et ne peut jamais activer. **Limite** : ces gardes arrêtent
      un `INSERT` direct ou un code qui oublierait la provenance ; elles n'arrêtent pas du SQL
      arbitraire exécuté par le même rôle applicatif (§15).
    - **Coût** : plafond par évaluation de 2 USD (`PLAFOND_EVALUATION_MICRO_USD`, à valider)
      vérifié avant chaque appel sur le coût engagé et l'estimation du cas ; plafond mensuel du
      cabinet réservé avant chaque appel (`reserverAppel`) ; les appels comptent dans
      `ia_consommations` comme toute génération. Refus à la demande : 409 `JEU_ESSAI_ABSENT`,
      `IA_DESACTIVEE`, `IA_NON_CONFIGUREE` (jamais de repli sur le fournisseur local),
      `PLAFOND_IA_ATTEINT`, `PLAFOND_EVALUATION_ESTIME`, `EVALUATION_EN_COURS` (un seul rejeu
      en file ou en cours par cabinet : index unique partiel), `EVALUATION_DEJA_REUSSIE` ; 429
      `TROP_DE_REJEUX` (5 par 24 heures glissantes et par cabinet, à valider) ; 400 pour un
      modèle sans tarif connu ou une variable de cas insérée dans les consignes du prompt. Durée
      maximale d'un rejeu : 8 minutes (à valider) ; une demande en file depuis plus d'une heure ou
      en cours depuis plus de 30 minutes est réputée interrompue (à valider). Les coupe-circuits
      IA du cabinet et des agents sont relus avant chaque appel ; le coupe-circuit N4 ne
      s'applique pas (appels internes). Statuts : `en_file`, `en_cours`, `reussie`,
      `echouee`, `incomplete`, `ignoree` (aucun appel) ; causes dans
      `CAUSES_EVALUATION_OPENROUTER` (`packages/shared/src/schemas/agents.ts`).
    - **Aucune nouvelle tentative d'un appel payant** : `tentatives_max = 1`, clé de job
      `agents_evaluation_openrouter:<demande>`, fournisseur construit avec une seule tentative ;
      seule une demande « en_file » démarre. Un modèle servi différent du modèle demandé
      (`memeModele`, variante après « : » ignorée) rend l'évaluation échouée
      (`MODELE_SERVI_DIFFERENT`).
    - **FIN-02** : coût, estimation, plafond et jetons (de la demande et de chaque cas) sont
      ABSENTS des réponses sans `finance.lire` (`vueDemande`, `vueEvaluation`), jamais masqués
      par un zéro ; le détail par cas ne porte que des codes de raison, jamais le texte produit.
    - **Clé API** : jamais dans la réponse, le journal, une erreur ni la charge du job (elle ne
      porte que l'identifiant de la demande) ; résolue au moment de l'appel (`resoudreCle`).
    - **Séparation des tâches** : demander un rejeu exige `agent.gerer` (expert métier,
      associé) ; activer un prompt ou choisir un modèle exige `ia.configurer` (associé seul) :
      qui demande l'évaluation n'est pas, par son seul rôle, qui active ; la base exige
      l'évaluation réussie quelle que soit la personne.
    - **Contenu d'un jeu d'essai** : le rejeu masque avec une liste de termes sensibles VIDE
      (`creerMasque([])`) ; un jeu d'essai ne contient donc jamais de contenu client réel (textes
      fictifs ou anonymisés), règle DOCUMENTÉE, non contrôlée par le code. Les variables de cas
      sont traitées comme données non fiables (neutralisées puis encadrées, AGT-07).
    - Tests : `agents-evaluations-openrouter.test.ts` (l'aide `evaluation-reelle.ts` sème une
      évaluation légitime en propriétaire, jamais par un `INSERT` forgé).
  - **Transparence** (AGT-09) : agent, brique, niveau effectif, prompt, modèle,
    mode dégradé (AGT-10), sources, empreinte de l'entrée (jamais l'entrée en
    clair), décision humaine ; le coût est ABSENT sans `finance.lire` ;
    contribution (AGT-05) mesurée par le moteur pur, textes non recopiés
    (empreintes SHA-256). Plafond de coût par mission (AGT-06) vérifié avant
    l'appel sous verrou consultatif de la mission, dans la transaction qui réserve le coût
    (deux exécutions simultanées sont sérialisées).
    Toutes les tables `agents_*` et `autonomie_*` sont `portail_interdit`.

## 8. Fichiers privés

Le téléversement existe (SOC-05, FIN-05) : versions de documents de mission
(`POST /fichiers`, permission `document.ecrire`) et justificatifs de débours
(`POST /debours/:id/justificatif`). Le chemin libre d'avant est refusé (400
`JUSTIFICATIF_PAR_TELEVERSEMENT`). Les rapports générés sont aussi des fichiers
du stockage (§8 bis).

- **Stockage** : disque local seulement (`stockage/disque.ts`) ; `s3` est un
  point d'extension non implémenté, refusé au démarrage (`config.ts`). Racine =
  `STORAGE_DIR` (absolue, obligatoire hors développement, hors du dépôt,
  jamais servie en statique). Clé de stockage = 16 octets aléatoires générés par
  le serveur, rangée sous le cabinet ; le chemin final est recalculé et vérifié
  sous la racine ; dossiers en 0700, fichiers en 0600, écriture temporaire
  exclusive puis renommage. La clé n'est jamais renvoyée par l'API.
- **Réception** : multipart, un seul fichier, aucun champ, une seule partie
  (`routes/documents-routes.ts`) ; plafond `FICHIER_TAILLE_MAX_OCTETS` (15 Mo
  par défaut) lu en flux ; au plus 4 réceptions simultanées par instance
  (constante `FICHIERS_ANALYSES_SIMULTANEES_MAX`, plus 2 par cabinet, `routes/fichiers.ts`, pas une
  variable d'environnement), sinon 503 `FICHIERS_OCCUPE` ; une requête qui **annonce** (`Content-Length`) plus
  que ce plafond et 64 Kio d'enveloppe est refusée en 413 avant
  l'authentification (`gardeTailleMultipart`, `routes/fichiers.ts`) ; quota
  par cabinet `QUOTA_STOCKAGE_CABINET_OCTETS` (2 Go) contrôlé sous verrou, au
  plus 20 téléversements non rattachés par utilisateur (`stockage/fichiers.ts`).
- **Type** : détecté par le CONTENU, jamais par l'en-tête ni la seule
  extension, et l'extension doit correspondre au type ; liste blanche PDF, PNG,
  JPEG, WebP, DOCX, XLSX, PPTX, CSV, TXT ; refus des exécutables, archives,
  HTML/SVG/XML, documents Office à macros ou à objets embarqués
  (`stockage/detection.ts`, 415 `TYPE_FICHIER_REFUSE`). Nom d'origine assaini
  (`stockage/nom.ts`).
- **PDF** (`stockage/detection.ts`) : noms actifs refusés (JavaScript, JS,
  Launch, EmbeddedFile(s), RichMedia, et en nom entier XFA et 3D) là où un
  lecteur les lit comme des noms. Analyse syntaxique **stricte** de la
  structure (objets, xref, trailers ; données de flux exclues), garde contre
  les lectures divergentes (objet ou trailer caché dans une chaîne, un
  commentaire ou un flux) ; flux d'objets (`ObjStm`) décompressés (sans filtre
  ou Flate sans paramètres) sous plafonds `PLAFONDS_PDF` : 8 Mio par flux,
  32 Mio cumulés, ratio 100 au-delà de 64 Kio, 4 096 flux ; un flux d'objets
  indécodable (autre filtre, chiffrement, bombe) est refusé. Fichier non
  conforme : repli strict (recherche sur tout le fichier, flux compris, et refus
  de tout marqueur de flux d'objets). Hors périmètre : `/URI`, `/SubmitForm`,
  `/GoToR`, `/ImportData` ; `/OpenAction` et `/AA` seuls ne sont pas refusés.
  Barrière de premier niveau : pas d'antivirus.
- **Lecture** : `GET /fichiers/:id` authentifié, accès revérifié à CHAQUE appel
  selon l'entité rattachée (version de document : mission visible ; justificatif :
  débours visible ; rapport : §8 bis ; orphelin : son seul auteur ; supprimé :
  personne ; cité par un dépôt de la salle de mission ou par une pièce
  justificative non retirée d'une référence d'appel d'offres : traité comme
  rattaché, donc 404 ici, même pour son auteur, la lecture se faisant par la
  route dédiée `GET /missions/:id/salle/depots/:depotId/fichier` ou
  `GET /banque-ao/attestations/:id/fichier`, qui revérifient leurs droits à
  chaque appel), 404 sinon, y compris pour un autre cabinet. Fermé au portail : le
  client télécharge un livrable partagé par `/api/portail/livrables/:id/fichier`.
  Réponse : type forcé au type détecté, `nosniff`,
  `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`,
  `attachment` par défaut (`inline` sur demande pour PDF et images seulement),
  téléchargement journalisé sans le contenu (`routes/fichiers.ts`).
- **Cycle de vie** : métadonnées en ajout seul (`REVOKE UPDATE, DELETE` sur
  `fichiers` et `fichiers_suppressions`, `0070`) ; un fichier non rattaché est
  purgé au bout de 24 h par le job `purge_fichiers_orphelins` (`stockage/purge.ts`).
  « Non rattaché » est décidé par la fonction SQL `fichier_orphelin` : elle liste TOUTES les
  références à `fichiers` (documents de mission, justificatifs de débours, rapports, versions de
  preuve, faits et facteurs du dossier client, dépôts de la salle de mission, pièces d'appels
  d'offres non retirées, suppressions) ; dernière définition : `0384` (reprend `0268`, `0331`).
  Toute migration qui ajoute une colonne `REFERENCES fichiers` la redéfinit (`CREATE OR REPLACE`,
  numéro après la table citée) et reprend toutes les références, sinon la purge efface un
  fichier encore cité ; l'inventaire AUTOMATIQUE de `test/fichiers-orphelins-references.test.ts`
  lit les migrations et échoue pour toute colonne non citée, sans liste d'exceptions. Retirer un
  dépôt de la salle l'inscrit dans `fichiers_suppressions` (motif « retire ») : le fichier sort des
  quotas et n'est plus servi ; une pièce d'appel d'offres retirée devient orpheline et est purgée à
  24 h.
- **Import Excel** (TPS-10, `temps/import-excel.ts`, `routes/import-temps.ts`) :
  classeur analysé en mémoire, jamais enregistré. 413 annoncé avant toute
  lecture, 2 Mio au plus, signature ZIP exigée (un `.xls` ou classeur chiffré
  est refusé). Archive relue par un **lecteur ZIP maison** : répertoire central
  cohérent et entièrement consommé, ni ZIP64, ni chiffrement, ni doublon, ni
  chevauchement ; 200 entrées, 16 Mio décompressés, ratio 100 par entrée de
  plus de 256 Kio. Contenu : aucune macro, liaison externe, connexion de
  données ni DTD ; 10 feuilles, 20 000 lignes XML, 100 000 cellules,
  20 000 styles au plus. ExcelJS ne reçoit qu'une archive **reconstruite** à
  partir des seules entrées validées ; formules jamais évaluées. Au plus 2
  lectures simultanées par instance (503 `IMPORT_EXCEL_OCCUPE`). L'import
  lui-même est limité à 5 000 lignes ; les exécutions d'un cabinet sont
  sérialisées par un verrou consultatif, et une feuille créée par une saisie
  pendant l'import répond 409 `IMPORT_CONCURRENT` (`temps/import.ts`).
- **Non couvert** : chiffrement des fichiers au repos (le disque l'assure ou non),
  analyse antivirus (y compris pour les fichiers qu'un tiers externe, le client, téléverse par le
  portail et que le cabinet lit : §15), sauvegarde du dossier `STORAGE_DIR` (rien dans le dépôt),
  plafond de réceptions simultanées **par cabinet** (le sémaphore de `POST
  /fichiers` et des justificatifs est global à l'instance et pris avant la lecture
  du corps, §15). Non vérifié : le comportement du stockage sous
  Windows (permissions 0700/0600).

## 8 bis. Rapports générés (SOC-07)

- **Trace** : `rapports_mission` (`0130`), ajout seul, une ligne par rapport
  écrite par le serveur et reliée au fichier du stockage. Un rapport **n'est
  pas** un document de mission : un fichier téléversé sous le même nom ne peut
  pas passer pour un rapport généré.
- **Modèles** : état d'avancement, **rapport de notation** (version publiée
  seulement, `0131`) et **rapport de plan stratégique** (contenus validés
  seulement), en PDF et Word (PowerPoint pour l'état d'avancement). La source
  (`notation_id` ou `plan_id`, `version_source`) est contrôlée par un
  déclencheur : appartenance à la mission et au cabinet courant (`MPR01`),
  notation publiée (`MPR02`). **Dossier bancaire** (PLA-17, `0424`, `POST
  /api/plans/:id/dossier-bancaire`) : modèle `dossier_bancaire`, destiné à une banque ; il exige
  `mission.lire`, `plan.lire` ET `plan.valider`, une version VALIDÉE du modèle financier (409
  `MODELE_NON_VALIDE`, doublé en base : `MPR03`), ne reprend que des contenus validés et PAS l'annexe
  « Sources » (registre des preuves interne) ; niveau « plan », même suivi qualité et mêmes plafonds
  que les autres rapports. Le **dossier de revue de performance** des KPI (§5 quater) est rendu par
  la même infrastructure (PDF, Word, PowerPoint) mais n'est pas enregistré ; il porte la mention
  de confidentialité neutre des rendus.
- **Niveau** calculé par le code d'après les sections incluses
  (`rapports/niveaux.ts`) : `base`, `jours` (`budget.lire_jours`), `finance`
  (`budget.lire_jours` et `finance.lire`), `notation` (`notation.lire`), `plan`
  (`plan.lire`). Lecture revérifiée à **chaque**
  appel : mission visible, `mission.lire` et permissions du niveau, sans
  condition d'auteur (`stockage/fichiers.ts`).
- **Débit** : au plus 10 générations par utilisateur sur 10 minutes glissantes
  (429 `TROP_DE_RAPPORTS`), compté sous le verrou de stockage ; rapport de
  20 Mio au plus (413) ; mission non clôturée (`rapports/enregistrement.ts`,
  `rapports/rendu.ts`).
- **Barrière Chrome headless** (`rapports/pdf.ts`, puppeteer-core, aucun
  navigateur téléchargé) : JavaScript de la page désactivé ; **toutes** les
  requêtes interceptées, seule la navigation initiale vers une adresse fictive
  reçoit le document (CSP `default-src 'none'`), le reste est refusé (réseau,
  `file:`, `data:`, service workers) ; résolution DNS neutralisée ; extensions
  et services d'arrière-plan coupés ; liaison par tube (aucun port de
  débogage) ; profil jetable créé pour chaque rendu et supprimé à la fin ;
  délai de 30 s (504), fermeture bornée puis SIGKILL ; au plus 2 rendus
  simultanés et 1 par cabinet (503 `RENDU_OCCUPE`). Navigateur = `CHROMIUM_PATH`
  (absolu, vérifié au démarrage) ou, en développement Windows seulement, Chrome
  installé ; sinon PDF indisponible (503). Aucun `--no-sandbox` n'est passé.
- **Conservation** (`0132`, `rapports/purge.ts`) : le fichier d'un rapport est
  purgé au-delà de `rapports_parametres.conservation_jours` (1 095 jours par
  défaut, 90 à 3 650 par cabinet) par le job `purge_rapports` (un par cabinet et
  par jour, clé `purge_rapports:AAAA-MM-JJ`, fonction `SECURITY DEFINER`
  `planifier_purge_rapports`). La purge marque le fichier supprimé (motif
  « conservation ») puis efface l'objet ; la ligne `rapports_mission` reste comme
  trace, le rapport disparaît des listes et son téléchargement répond 404. Durée
  **à valider avec le conseil juridique**.
- **Paramètres du cabinet** (`GET` et `PUT /api/rapports/parametres`,
  `cabinet.gerer`, table `rapports_parametres` fermée au portail) : durée de
  conservation et **mention de la contribution de l'IA** en pied de page (active
  par défaut, texte par défaut ou personnalisé de 300 caractères au plus, sans
  caractère de contrôle).
- **Suivi qualité et sources** (vague 1) : chaque rapport généré ouvre son suivi
  qualité R2 dans la transaction d'enregistrement (§5 ter). Les rapports de
  notation et de plan portent l'annexe « Annexe — Sources » (PRV-06,
  `rapports/sources.ts`, PDF et Word) : assertions RETENUES dont le livrable
  désigne le rapport, preuves numérotées avec type, date et fiabilité ; un verbatim
  nominatif sans accord est masqué pour TOUS (`vuePreuve(…, false)`) ; annexe
  produite seulement si le générateur a `preuve.lire`.
- **PDF de facture** (`GET /api/factures/:id/pdf`, `facture.lire`, mission
  visible, `routes/factures-pdf.ts`) : même document HTML échappé que le document
  de facture (§7), imprimé par la même barrière Chrome ; rendu à chaque demande,
  jamais stocké, servi en pièce jointe (`sandbox`, `nosniff`), téléchargement
  journalisé ; fermé au portail. Pas de limite par utilisateur (seuls les
  sémaphores de rendu, §15).

## 8 ter. Registre des preuves (PRV-01 à PRV-05)

Routes de `routes/preuves.ts`, logique dans `apps/api/src/preuves/`, tables des
migrations `0240`–`0242`, durcissement `0243` (audit du 2026-10-08).

- **Droits** : `preuve.lire` (lecture) et `preuve.ecrire` (enregistrer, corriger,
  lier, délier, arbitrer, déclarer une dimension), plus la visibilité de la
  mission (`preuves/acces.ts`). Écrire exige une mission visible et NON clôturée
  (409 `MISSION_CLOTUREE`) mais pas le droit de « modifier » la mission : un
  membre de l'équipe recueille des preuves. Mission invisible, d'un autre cabinet,
  preuve ou assertion d'autrui : même 404. Aucune route n'est ouverte au portail
  client : `portail_interdit` sur les sept tables, aucune entrée dans
  `LISTE_BLANCHE_PORTAIL`.
- **Ajout seul** : preuves, assertions, liens et arbitrages ne se modifient ni ne
  se suppriment (`REVOKE UPDATE, DELETE`, déclencheur `MPV01`, même pour le
  propriétaire). Une correction est une nouvelle version avec motif, un lien retiré
  est un événement `delier`, un arbitrage est une décision datée au nom de
  l'arbitre. Seules les dimensions (libellé, état actif) se modifient. Chaque
  écriture est journalisée (`preuve.*`, `assertion.*`) sans extrait ni verbatim.
- **Indice et lecture** : calculés par le moteur (`indiceSolidite`,
  `contradictionsAArbitrer`, `carteTriangulation`, `detecterAssertionsSansPreuve`)
  via `preuves/evaluation.ts` ; jamais reçus d'une requête (corps `.strict()`), ni
  recalculés en SQL ou dans le web. Poids, plafond et seuils : valeurs de départ à
  calibrer au pilote.
- **Contradiction résolue** : le dernier arbitrage du couple (assertion, preuve)
  vise la version COURANTE de la preuve et date d'après le dernier événement de
  lien (horodatage à la microseconde). Corriger la preuve ou la relier rouvre la
  contradiction.
- **Verbatim nominatif** : `nominatif` marque un extrait qui identifie une
  personne, `accord_nominatif` l'accord de cette personne. Sans accord, l'API
  masque l'extrait, la source précise et les liens vers la source (`masque: true`)
  pour tous sauf l'auteur désigné de la preuve, la personne qui l'a saisie et ceux
  qui modifient la mission (`preuves/vues.ts`, `acces.ts`) ; la recherche libre ne lit pas un
  verbatim masqué. Le journal ne reçoit jamais l'extrait. Un entretien ou un questionnaire est
  nominatif par défaut (`nominatif` omis), les autres types non ; l'accord ne s'applique qu'à un
  extrait nominatif.
- **Avis d'expert** : une assertion sans preuve peut être assumée comme avis
  d'expert, motivé puis signé ; la signature est celle de l'auteur de la version ET
  réservée à un expert métier ou un associé (403 côté API, `MPV04` en base), serveur
  seul décide (`signer_avis`), et ne se reporte pas sur la version suivante. Abaisser
  la classe de risque d'une assertion est réservé aux mêmes (409
  `CLASSE_RISQUE_ABAISSEE`, `MPV06`).
- **Cohérence des liens et auteurs** (`MPV02`) : un fichier lié est un document de la
  mission, la source d'un fait du dossier du client de la mission, ou un fichier orphelin
  téléversé par la personne qui saisit ; jamais un fichier supprimé ; une correction peut
  garder celui de la version précédente. L'auteur désigné est la personne qui saisit,
  l'auteur de la version précédente ou un membre actif de la mission (400
  `AUTEUR_NON_MEMBRE`). Un fichier cité par une version de preuve n'est pas orphelin :
  la purge à 24 h ne l'efface pas (`fichier_orphelin`, migration `0268`).
- **Séparation des tâches de l'arbitrage** : « contradiction levée » est refusée à l'auteur
  de l'assertion (identité ou version courante) et à l'auteur ou au saisisseur de la
  version arbitrée de la preuve contraire, sauf associé (409 `ARBITRAGE_PAR_AUTEUR`,
  `MPV07`).
- **Bornes** (déni de service) : 5 000 preuves, 2 000 assertions et 100
  dimensions par mission ; 409 `PLAFOND_ATTEINT`. Les synthèses chargent la
  mission entière dans ces bornes.
- **API publique pour la revue guidée** (QUA-03) : `assertionsFragilesDeMission`
  (`preuves/synthese.ts`) et `GET /api/missions/:id/assertions/fragiles`.
- **Codes d'erreur** : `MISSION_CLOTUREE`, `PLAFOND_ATTEINT`, `DIMENSION_INCONNUE`,
  `DIMENSION_EXISTANTE`, `PREUVE_INCOHERENTE`, `PREUVE_HISTORIQUE_IMMUABLE`,
  `PREUVE_VERSION_CONCURRENTE`, `AVIS_EXPERT_INVALIDE`, `ARBITRAGE_INVALIDE`,
  `CLASSE_RISQUE_ABAISSEE`, `ARBITRAGE_PAR_AUTEUR`, `AUTEUR_NON_MEMBRE` (400), et les
  codes du moteur (`PREUVE_INVALIDE`, `ASSERTION_INVALIDE`, `DIMENSION_INVALIDE`,
  `OPTIONS_INVALIDES`).
- **Limites connues** : une dimension se désactive mais ne se supprime pas ; la
  détection automatique des contradictions (agent contradicteur) n'existe pas
  encore, le lien « contre » est posé par un consultant ; le lien vers un fichier
  est vérifié par rattachement (`MPV02`), pas contre le droit de lecture du fichier ;
  PRV-06 : l'annexe des sources des rapports PDF et Word est faite
  (§8 bis), pas les citations cliquables des livrables web.

## 8 quater. Dossier client vivant (DOS-01 à DOS-07)

Routes de `routes/dossier-client.ts`, logique dans `apps/api/src/dossier/`, tables
des migrations `0220`–`0224`, moteurs `packages/engines/src/dossier/`.

- **Droits et visibilité** (règle écrite en tête de `dossier/acces.ts`) :
  `dossier.lire` pour lire, `dossier.ecrire` pour écrire et exporter, toujours sur
  un dossier VISIBLE : tout client avec `mission.lire_toutes`, sinon seulement un
  client dont on voit au moins une mission (directeur, chef, équipe). La fiche
  client (`clients.lire`) n'ouvre pas le dossier. Dossier invisible, d'un autre
  cabinet ou inexistant : même 404. Aucune route n'est ouverte au portail client :
  `portail_interdit` sur les sept tables, aucune entrée dans `LISTE_BLANCHE_PORTAIL`.
- **Ajout seul** : faits, décisions, facteurs, états, lignes, décisions d'état,
  instantanés de fiabilité et exports ne se modifient ni ne se suppriment
  (`REVOKE UPDATE, DELETE`, déclencheurs `MPO01`, même pour le propriétaire). Une
  correction est un nouveau fait (ou état) qui REMPLACE l'ancien (`MPO02`) ; le
  statut se dérive (proposé, confirmé, rejeté, remplacé). Chaque écriture est
  journalisée (`dossier_fait`, `dossier_facteur`, `dossier_etat_financier`) sans
  la valeur du fait.
- **Séparation des tâches** : une proposition humaine n'est pas confirmée par son
  auteur, sauf associé (403 `VALIDATION_REQUISE`, `dossier/faits.ts`) ; l'auteur
  peut la retirer (rejet motivé). Un fait extrait par l'IA (`origine = 'ia'`) est
  toujours proposé et ne se confirme jamais dans sa transaction de création
  (`MPO03`) : donnée SOURCÉE, pas un chiffre produit par l'IA (DECISIONS.md).
  Créer directement un fait « confirmé » est réservé à l'associé (403
  `VALIDATION_REQUISE`) : les autres proposent, un autre membre confirme. Accepter un
  état financier en écart, de tolérance non nulle ou qui remplace un état accepté par un
  humain exige un motif (`MPO04`) et un autre membre que l'importateur, sauf associé
  (`dossier/etats.ts`).
- **Jamais d'acceptation silencieuse** (DOS-03) : un état n'est accepté
  automatiquement que si le moteur `controlerEtatFinancier` conclut à
  `acceptationAutomatique` (aucun écart au-delà de la tolérance ET contrôles requis
  faisables : équilibre du bilan, résultat au bilan), si la tolérance choisie par
  l'importateur est NULLE et s'il ne remplace pas un état accepté par un humain ; la
  base le double (`MPO04` : `controles_ok` et tolérance nulle exigés, décision automatique
  dans la transaction d'ingestion). Sinon l'état part en revue avec ses constats. Chaque ligne garde sa référence (fichier,
  cellule Excel ou ligne CSV, page).
- **Fichiers reçus** : classeur .xlsx (`POST /dossiers/:id/etats-financiers/excel`,
  multipart encapsulé, `gardeTailleMultipart` avant l'authentification, dossier
  vérifié AVANT la lecture du corps, `avecPlaceAnalyse` puis lecteur borné
  `lireClasseurTemps` de `temps/import-excel.ts`) ou CSV en JSON (200 000
  caractères au plus). Le fichier n'est jamais conservé : nom assaini, empreinte
  SHA-256 et taille sont tracés avec l'état. Montants lus exactement par le moteur
  (`lireMontantTexte`, refus plutôt qu'arrondi).
- **Document cité en source** : un `document_id` doit être lisible par l'auteur
  (`exigerFichierLisible`, 404 sinon) ; un fichier cité par un fait ou un facteur n'est
  pas orphelin et n'est pas purgé (`fichier_orphelin`, migration `0268`).
- **Facteurs de contexte** : code, type et valeur sont validés contre le dictionnaire
  `facteurs_contexte` (400 `CONTEXTE_INVALIDE`), comme le contexte d'une mission.
- **FIN-02** : le dossier ne porte que des données DU CLIENT (faits, facteurs, états
  financiers) ; aucune donnée de coût, taux ou marge du cabinet n'y entre, quelle
  que soit `finance.lire`. La frise ne projette que libellés et dates, chaque source
  selon les droits du lecteur (`mission.lire`, `notation.lire`, `kpi.lire`,
  `plan.lire`, mission visible).
- **Export** (DOS-07) : `GET /dossiers/:id/export?format=json|zip`
  (`dossier.ecrire`) ; contenu destiné au client, sans nom ni identifiant de membre
  du cabinet et sans les motifs des décisions (internes au cabinet) ; cellules CSV neutralisées contre l'injection de formule ; chaque
  export est tracé (`dossier_exports` : format, empreinte, taille, volumes) et
  journalisé (`dossier.exporter`) dans la même transaction ; `no-store`, `nosniff`.
- **Bornes** (déni de service, export borné) : 5 000 faits, 2 000 valeurs de
  facteurs et 60 états financiers (1 000 lignes chacun) par dossier, 409
  `DOSSIER_PLEIN` ; écritures d'un dossier sérialisées par verrou consultatif.
- **Codes d'erreur** : `VALIDATION_REQUISE`, `DOSSIER_PLEIN`, `DOSSIER_AJOUT_SEUL`,
  `REMPLACEMENT_INVALIDE`, `DECISION_INVALIDE`, `ACCEPTATION_REFUSEE`,
  `DEJA_DECIDE`, `DEJA_REMPLACE`, `CONTEXTE_INVALIDE` (400), `IMPORT_INVALIDE` (lignes en erreur dans
  `erreur.details.erreurs`), `EXCEL_INVALIDE`, `FICHIER_TROP_VOLUMINEUX`,
  `FICHIERS_OCCUPE`, et les codes du moteur (`LIGNES_INVALIDES`,
  `CODE_LIGNE_INVALIDE`, `CODE_LIGNE_EN_DOUBLE`, `PARENT_INCONNU`,
  `PARENT_INVALIDE`, `CYCLE_PARENTS`, `ROLE_INVALIDE`, `MONTANT_INVALIDE`,
  `TOLERANCE_INVALIDE`).
- **Limites connues** : l'extraction par l'IA depuis un PDF (DOS-03) n'est pas
  branchée (la colonne `origine` l'accueillera) ; groupes et filiales (DOS-05) hors
  lot ; la feuille d'origine d'un classeur n'est pas nommée (première feuille
  visible) ; barème de
  fiabilité et seuils de classe posés par défaut, à calibrer au pilote.

## 8 quinquies. Référentiel de méthodes (STD-01 à STD-12, ADR-004)

- **Standard partagé, lecture seule** (`0200`–`0205`) : les lignes du standard
  MissionPilot ont `cabinet_id` NULL, sont posées par migration (rôle
  propriétaire) et lues par tout cabinet par une politique PERMISSIVE
  `standard_lecture` **FOR SELECT** (`cabinet_id IS NULL AND app_cabinet_id() IS
  NOT NULL`) qui, depuis `0208`, ne rend que les versions PUBLIÉES du standard et leur
  contenu (un brouillon du standard reste invisible du rôle applicatif) ; seule la politique `isolation` admet INSERT, UPDATE et DELETE, et
  `NULL = app_cabinet_id()` n'est jamais vrai : le rôle applicatif ne crée, ne
  modifie ni ne supprime aucune ligne du standard (test `standard-referentiel`).
  Sans contexte de cabinet, rien n'est visible ; le portail ne voit rien
  (`portail_interdit` sur toutes les tables du lot). Les références croisées
  (variante → standard, mission → version) passent par des déclencheurs
  `SECURITY INVOKER` : une ligne d'un autre cabinet est invisible sous RLS, donc
  refusée comme inexistante (`MPM02`, `MPM06`) ; contenu d'une version : même
  propriétaire que la version (`MPM02`). Aucune fonction `SECURITY DEFINER`.
- **Immuabilité** : version publiée et son contenu figés (`MPM01`, même pour le
  propriétaire) ; une version se crée en brouillon ; `mission_methodes`,
  `derogation_validations` en ajout seul (`MPM03`, `REVOKE UPDATE, DELETE`) ;
  dictionnaire, facteurs, services et notes en ajout seul pour le rôle
  applicatif (`REVOKE UPDATE, DELETE`).
- **Variante du cabinet** (STD-02, `0207`) : publier une variante exige le quatre yeux
  (le créateur de la version ne la publie pas, sauf associé : 403 `SEPARATION_DES_TACHES`,
  `MPM08`) et refuse qu'elle abaisse la classe de risque ou relève le niveau d'autonomie
  d'une brique du standard dont elle part (anomalies `CLASSE_ABAISSEE` et
  `AUTONOMIE_RELEVEE` de `standard/coherence.ts` ; 409 `VERSION_INCOHERENTE`, `MPM07`
  en base). Une proposition au standard n'est ni relue ni publiée par son auteur (la
  publication reste permise à un associé : 403 `SEPARATION_DES_TACHES`).
- **Droits** (`routes/standard.ts`) : `standard.lire` (catalogue, dictionnaire,
  simulation, contrôle, cas types, tableau des dérogations limité aux missions
  visibles) ; `standard.gerer` (variante, méthode, brouillon, publication,
  dictionnaire et notes du cabinet, comité méthode) ; mission : `standard.lire` et
  mission visible pour lire, plus `mission.planifier` et mission modifiable pour
  lier, changer le contexte ou migrer ; `methode.deroger` et mission modifiable
  pour demander une dérogation. Approbation d'une dérogation selon la classe de
  risque EFFECTIVE de la brique (jamais abaissée) par le moteur `qualite`
  (`evaluerGarde`) : R0 et R1 approuvées à la demande (garde automatique ou
  validation de l'auteur) ; R2 relecture du chef ou du directeur de la mission
  (ou associé) ; R3 en plus revue d'un expert métier et signature du directeur
  (ou associé), quatre yeux. Le demandeur ne franchit que sa propre étape et la base refuse d'approuver une
  dérogation sans les validations de sa classe (`MPM04` ; `0209`, miroir des gardes du
  moteur `qualite`) ; 403 `SEPARATION_DES_TACHES` à l'API. Comité méthode :
  relecteur ≠ auteur (`MPM05`).
- **Entrées** : règles au schéma `regleModulationSchema` (imbrication bornée
  avant l'analyse récursive), contexte contrôlé par `validerContexteModulation`
  (400 `CONTEXTE_INVALIDE`), motif obligatoire quand le contexte active ou retire une
  brique de classe R2 ou R3 (400 `MOTIF_REQUIS`, à la liaison comme au changement de
  contexte), contenu d'une version borné
  (`BORNES_VERSION_METHODE` : 50 étapes, 300 briques, 500 éléments, 100
  rubriques, 500 règles, 100 cas types ; 409 `PLAFOND_ATTEINT`), 200 facteurs
  par cabinet (verrou consultatif). Les règles ne sont jamais évaluées par l'IA :
  moteur pur, journal d'application conservé avec la mission.
- **Codes d'erreur** : `STANDARD_LECTURE_SEULE` (403), `VERSION_PUBLIEE`,
  `VERSION_INCOHERENTE`, `NOTES_VERSION_REQUISES`, `VARIANTE_EXISTANTE`,
  `METHODE_DEJA_LIEE`, `VERSION_NON_LIABLE`, `REFERENTIEL_INCOHERENT`,
  `HISTORIQUE_AJOUT_SEUL`, `DEROGATION_DECIDEE`, `DEROGATION_DECISION_REFUSEE`,
  `ETAPE_INATTENDUE`, `PROPOSITION_TRANSITION_REFUSEE`, `PLAFOND_ATTEINT` (409) ;
  `SEPARATION_DES_TACHES`, `RELECTEUR_ATTENDU` (403) ; `CONTEXTE_INVALIDE`,
  `MOTIF_REQUIS`, `MOTEUR_INCONNU`, `MODULATION_*` (400).
- **Limites connues** : le standard ne se publie que par migration (pas d'espace
  d'administration ACC) ; facteurs portés par le dossier client PROPOSÉS, pas
  appliqués d'office (`GET /missions/:id/methode/contexte-propose`,
  `standard.lire` ET `dossier.lire`, mission visible ; `standard/contexte-dossier.ts` :
  valeurs courantes sourcées, valeurs refusées par le moteur écartées avec la
  raison ; rien n'est écrit, l'utilisateur confirme en liant) ; seuils d'autonomie par
  classe (N2 au plus pour R2 et R3, N3 pour R1, N4 pour R0) posés par défaut, à
  valider.

## 8 sexies. Check-list de clôture des missions (AUT-08)

- **Contrôles nommés, jamais de règle libre.** Le modèle du cabinet (`cloture_modele_items`, `0320`)
  ne désigne que des contrôles d'une liste fermée (`CONTROLES_CLOTURE`, `packages/shared`), codés dans
  `apps/api/src/cloture/controles.ts`. Un contrôle renvoie un NOMBRE D'ÉCARTS entier ; le solde des
  factures vient du moteur de finance (`situationPaiement`), aucun montant n'est calculé en SQL ni
  servi. La décision (clôture autorisée, items bloquants) est celle du moteur `decisionCloture`
  (`packages/engines/src/cloture`).
- **Droits.** Lire le modèle et l'état d'une mission : `mission.lire` (mission visible, 404 sinon) ;
  paramétrer le modèle : `cabinet.gerer` (journalisé) ; évaluer avec enregistrement et attester :
  `mission.planifier` ET mission modifiable ; accorder ou retirer une dérogation : `mission.cloturer`
  (associé, directeur de mission) ET mission modifiable, doublé en base par `MPX02`. Aucune route
  n'est ouverte au portail ; les trois tables portent `portail_interdit`. **FIN-02** : le nombre
  d'écarts des contrôles financiers (`factures_emises`, `encaissements_soldes`) est ABSENT de
  l'évaluation et de l'historique sans `facture.lire` (jamais un zéro) ; l'état de l'item (conforme,
  bloqué…) reste servi (`vueEvaluation`, `routes/cloture.ts`). L'historique
  (`GET /missions/:id/cloture/historique`, `mission.lire` et mission visible) est paginé par curseur,
  une page par table (vérifications, dérogations).
- **Séparation des tâches** (`0323`, `MPX03`) : l'auteur d'une dérogation EN VIGUEUR (dernière ligne
  « accordée » d'un contrôle de la mission) ne clôt pas la mission, sauf s'il est associé (409
  `DEROGATION_PAR_CLOTUREUR`) ; sans cette règle, un directeur de mission déroge à un item bloquant puis
  clôt seul. `exigerClotureAutorisee` et le déclencheur disent la même règle ; le déclencheur ne
  s'applique qu'au passage à « cloturee » d'une mission qui ne l'était pas.
- **Historiques en ajout seul.** `cloture_verifications` (`0321`) et `cloture_derogations` (`0322`) :
  `REVOKE UPDATE, DELETE` et déclencheur `MPX01`. Une dérogation exige un motif de 10 à 500 caractères
  (CHECK en base) ; elle se retire par une nouvelle ligne. La dernière ligne d'un couple (mission,
  contrôle) fait foi.
- **Clôture refusée.** `POST /missions/:id/cloturer` appelle `exigerClotureAutorisee` dans sa
  transaction : 409 `CLOTURE_BLOQUEE`, codes des items bloquants dans `details.manquants`. La
  vérification de clôture n'est enregistrée qu'en cas de succès (la transaction d'un refus est
  annulée). C'est la SEULE route qui pose le statut `cloturee` (les transitions simples de
  `routes/missions.ts` l'excluent) : elle exige `mission.cloturer` et une mission « à clôturer ». Dans
  la même transaction, elle CLOT d'abord les demandes de la salle de mission encore « envoyées »
  (`cloreDemandesDeMission` ; le nombre figure dans les détails du journal `cloture`) ; le déclencheur `MPL06` refuse la
  clôture sinon (§8 septies). Elle ouvre ENSUITE le retour d'expérience de la mission (CAP-01), dans un
  SAVEPOINT dont l'échec ne bloque jamais la clôture (§5 sexies). Les SQLSTATE `MPX…` et `MPL…` sont
  traduits (jamais une 500).
- **Valeurs par défaut** (tant que le cabinet n'a pas paramétré, à valider) : temps validés, débours
  traités, factures émises et livrables signés bloquants ; encaissements soldés et satisfaction
  demandée actifs mais non bloquants ; capitalisation faite inactive (attestation humaine : aucun contrôle ne
  lit encore le retour d'expérience du module de capitalisation, §5 sexies).

## 8 septies. Salle de mission (CLI-01)

Lot de la vague 2 (PRD complémentaire §13 ; migrations `0330`–`0332`, code
`apps/api/src/salle-mission/`, routes `routes/salle-mission.ts`, tests `test/salle-mission.test.ts`,
`test/salle-mission-durcissement.test.ts`). Le cabinet prépare des demandes de pièces, les envoie au
client, qui dépose ses fichiers depuis le portail ; le cabinet accepte ou rejette. C'est la seule
fonction du portail qui écrit un fichier (§4 bis).

- **Cloisonnement** : sept tables (`salle_modeles`, `salle_demandes`, `salle_pieces`, `salle_depots`,
  `salle_piece_evenements`, `salle_accuses`, `salle_relances`), toutes à RLS (`isolation`) ; politiques
  du portail : `portail_interdit` sur les modèles et les relances, lecture seule (`portail` en `FOR
  SELECT` doublée de `portail_sans_insert`, `portail_sans_update`, `portail_sans_delete`) sur les
  demandes envoyées ou closes de SON client, leurs pièces et les accusés, et politique `portail` `FOR
  ALL` serrée sur `salle_depots` et `salle_piece_evenements` (§4 bis). Les dépôts et les événements
  de pièce sont en ajout seul (`REVOKE UPDATE, DELETE`, `MPL01`).
- **Routes du cabinet** : `salle.lire` (lecture) et `salle.gerer` (modèles, demandes, pièces, envoi,
  clôture, relance manuelle, acceptation, rejet, dépôt reçu hors portail, retrait d'un dépôt), toujours
  sur une mission VISIBLE ; toute écriture exige en plus la mission non clôturée (409) et verrouille la
  mission. Une demande ou un dépôt d'une autre mission, d'une mission invisible ou d'un autre cabinet
  répond le même 404. Le fichier d'un dépôt se lit par `GET /missions/:id/salle/depots/:depotId/fichier`
  (`salle.lire`, revérifié à chaque appel, journalisé, mêmes en-têtes que `GET /fichiers/:id`) ;
  `GET /api/fichiers/:id` le traite comme rattaché et répond 404 (§8). Verser un dépôt au dossier de
  la mission exige `salle.gerer` ET `document.ecrire`.
- **Routes du portail** (dans `LISTE_BLANCHE_PORTAIL`, permission `portail.salle.deposer`, réservée
  à `client_dirigeant` et `client_contributeur`) : `GET` et `HEAD /api/portail/salle/demandes`,
  `GET /api/portail/salle/demandes/:id`, `POST /api/portail/salle/pieces/:id/depots`. Brouillon, autre
  client, autre cabinet, inexistant : le MÊME 404 du portail ; le partage de la mission n'est pas requis
  (envoyer une demande est un partage explicite). Projection explicite : ni mission, ni auteur, ni
  équipe, ni historique interne, ni relance ; pour chaque pièce, son statut, le motif d'un rejet et les
  dépôts de son entreprise (nom, type, taille, date, « déposé par moi », accusé). Les accès sont
  journalisés dans la transaction (`portail_lecture`, `portail_depot`).
- **Dépôt** : le corps est lu APRÈS les contrôles de droits (pièce déposable, plafonds), puis
  revérifié sous verrous (pièce, demande ; verrou consultatif par utilisateur du portail pour que le
  débit se compte sans course). Le fichier passe par le pipeline commun (`enregistrerFichier` : type
  détecté par le contenu, liste blanche, quota du cabinet par `octets_stockage_utilises`, §4 et §8,
  sémaphore `avecPlaceAnalyse`). Un rejeu du même contenu pour la même pièce répond 200 sans rien
  réécrire (empreinte SHA-256).
- **Garde-fous en base** : `MPL01` ajout seul ; `MPL02` transitions d'une pièce (reçue, acceptée,
  rejetée ; décision réservée au cabinet ; la réception est signée par le déposant) ; `MPL03` dépôt
  sur une demande non envoyée ou une pièce déjà acceptée, fichier absent ou d'un autre déposant,
  déposant non rattaché au client, utilisateur du portail qui déposerait « hors portail » ; `MPL04`
  incohérence de mission, client, demande ou pièce ; `MPL05` demande ou pièce figée (une demande
  envoyée ne se supprime pas, on la clôt ; ses pièces sont figées) ; **`MPL06` mission clôturée** :
  dépôt, envoi et création de demande refusés, et la mission ne se clôt pas tant qu'une demande est
  « envoyée » (l'API les clôt d'abord, §8 sexies) ; **`MPL07` plafonds de dépôts** ; **`MPL08` débit
  des dépôts du portail** ; **`MPL09` séparation des tâches** : un utilisateur n'accepte pas un dépôt
  qu'il a lui-même fait, sauf associé. Une acceptation CITE obligatoirement le dépôt retenu, et seul ce
  dépôt peut être versé au dossier de mission (une fois).
- **Plafonds** (déni de service : un client ne remplit pas le quota de stockage du cabinet ; mêmes
  valeurs dans `packages/shared/src/schemas/salle-mission.ts` et dans le déclencheur, en littéraux) :
  20 dépôts non rejetés et non retirés par pièce ; 500 Mo de dépôts non retirés par demande ; 30
  dépôts par utilisateur du portail et par fenêtre de 10 minutes, comptés sur `salle_depots` (le
  journal d'audit est `portail_interdit` en contexte portail) ; le plafond de dépôts atteint répond 409
  `DEPOTS_PLAFOND`, le débit 429 `DEPOTS_TROP_RAPIDES`. Autres bornes : 100 pièces par demande, 200
  demandes par mission, 500 modèles par cabinet.
- **Retrait d'un dépôt** (`DELETE /missions/:id/salle/depots/:depotId`, `salle.gerer`, mission
  modifiable) : réservé aux dépôts NON acceptés et non versés au dossier (409 sinon, vérifié sous
  verrou de la pièce) ; le fichier est inscrit dans `fichiers_suppressions` (motif « retire »), journal
  `salle_depot_retire` ; l'objet est effacé du stockage après la validation de la transaction. La ligne
  du dépôt et son historique restent. L'écran du cabinet propose ce retrait par le bouton « Retirer ce
  dépôt » (recette du 2026-10-10) ; l'API reste seule juge (409 pour un dépôt accepté ou versé).
- **Accusé de réception et relances (classe R0 vers le client)** : après un dépôt du portail, un
  accusé automatique (notification et e-mail, tracé dans `salle_accuses`, journal `accuse_reception`
  sans auteur) et l'information du chef et du directeur partent HORS du contexte du portail
  (`horsContextePortail`, §4 bis), après la transaction du dépôt ; le coupe-circuit N4 des agents
  (§7 bis) ou un déposant devenu inactif SUSPEND l'accusé (tracé et journalisé). Les relances J−3, J+1
  et J+7 sont des jobs `relance_salle_mission` (file PostgreSQL, clé par demande, palier et échéance ;
  inscrits dans `jobs/registre.ts`, test `jobs-registre.test.ts`), suspendues par le même
  coupe-circuit N4 ; l'alerte interne de J+7 part quand même ; la relance manuelle, décidée par un
  humain, n'y est pas soumise.
- **Risques acceptés** : un tiers externe (le client) téléverse des fichiers que le cabinet ouvre,
  sans antivirus (barrière de premier niveau : type par le contenu, §8) ; l'accusé de réception est
  traité hors file (§15).

## 9. Paiements et webhooks

Sans objet : aucun prestataire de paiement ni webhook entrant. Les
encaissements sont saisis par un gestionnaire (`routes/encaissements.ts`,
permission `encaissement.gerer`), imputés par le moteur sous verrou, et
corrigés seulement par contre-passation (§6). Mobile Money est prévu en V2.

## 10. Secrets et configuration

- **Point d'entrée unique** : `loadConfig` (`apps/api/src/config.ts`), validé
  par Zod au démarrage. Seul `.env.example` est versionné ; les agents ne lisent
  ni n'écrivent les `.env` (AGENTS.md, refus dans `.claude/settings.json`).
- **Valeurs de développement** (`DEV`) : admises seulement si `NODE_ENV` est
  absent, `development` ou `test` **et** que les deux URL de base désignent
  l'hôte local ; sinon l'API refuse de démarrer. Hors développement, une valeur
  égale à celle de développement est refusée (test : `test/config.test.ts`).
- **Secrets distincts** : `TFA_MASTER_KEY` ≠ `SESSION_SECRET` ; la clé
  précédente ≠ la courante ; `SESSION_SECRET` sert de clé de version 1 pour les
  chiffrés antérieurs (`auth/chiffrement.ts`).
- **SMTP** : hors développement et test, `SMTP_HOST` est obligatoire et
  `SMTP_TLS=aucun` refusé ; `SMTP_USER` et `SMTP_PASS` vont ensemble ;
  `MAIL_FROM` obligatoire avec un hôte (`verifierConfigEmail`).
- **IA** : `OPENROUTER_API_KEY` (clé de plateforme, facultative, jamais
  journalisée), `OPENROUTER_BASE_URL` (HTTPS obligatoire hors boucle locale),
  `IA_TIMEOUT_MS` (1 s à 300 s), `IA_PLAFOND_PLATEFORME_MICRO_USD` (0 à
  100 000 USD). La clé propre à un cabinet est en base, chiffrée (§7 bis).
- **Rapports** : `CHROMIUM_PATH`, chemin absolu d'un fichier existant, refusé
  au démarrage sinon.
- **Connexion rapide de démonstration** : `CONNEXION_RAPIDE_DEMO` (`oui` ou
  `non`, défaut `non`) ; `oui` refusé au démarrage hors `NODE_ENV` local avec
  bases locales (§3).
- **Côté web** : seule `API_URL` est lue (`next.config.mjs`,
  `lib/api-serveur.ts`), sans secret ; aucune variable `NEXT_PUBLIC_*`. Le
  navigateur n'atteint l'API que par `/api/*` relayé sur l'origine du web, de
  sorte que le cookie reste en même origine.

## 11. Réseau

- L'API écoute sur `127.0.0.1` (`server.ts`) ; le port PostgreSQL est publié sur
  `127.0.0.1:55440` seulement (`docker-compose.yml`).
- CORS : une seule origine, `WEB_ORIGIN`, avec credentials (`app.ts`).
- **Garde d'origine (CSRF)** : crochet `onRequest` d'`app.ts`, avant la session
  et toute lecture du corps : une requête POST, PUT, PATCH ou DELETE dont
  l'en-tête `Origin` diffère de `WEB_ORIGIN` (ou vaut `null`, ou est multiple)
  répond 403 `ORIGINE_REFUSEE`. En développement et en test seulement,
  `localhost`, `127.0.0.1` et `[::1]` (même schéma, même port) sont équivalents
  (`originesAcceptees`) ; jamais en production. Une requête sans `Origin`
  (client hors navigateur, appels serveur du web) passe. Hypothèse : le relais
  Next ne réécrit que `Host` et transmet l'`Origin` du navigateur ; son délai
  est porté à 90 s pour les rapports (`experimental.proxyTimeout`,
  `apps/web/next.config.mjs`).
- En-têtes du web : `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `X-Powered-By` retiré
  (`apps/web/next.config.mjs`).
- Sorties réseau de l'API : SMTP (§2), OpenRouter (HTTPS, §7 bis) ; Chrome
  headless n'a aucun accès réseau (§8 bis).
- **Limites de débit et de volume** : secrets d'authentification (§3) ; IA
  (plafond, 10 appels simultanés par cabinet, 50 générations par jour et par
  utilisateur, §7 bis) ; rapports (10 par 10 min et par utilisateur, 2 rendus
  PDF simultanés dont 1 par cabinet, §8 bis) ; import Excel (2 lectures
  simultanées par instance, §8) ; réceptions de fichiers (4 simultanées par
  instance, 503 `FICHIERS_OCCUPE`, §8) ; KPI (20 000 périodes par requête, §5 bis ;
  10 dossiers de revue par utilisateur et par 10 minutes, §5 quater) ; automatisation
  (50 automatisations actives par cabinet, 30 simulations par utilisateur et par 10 minutes,
  §5 quinquies) ; salle de mission (20 dépôts par pièce, 500 Mo par demande, 30 dépôts du portail par
  utilisateur et par 10 minutes, §8 septies) ; appels d'offres (20 exports de CV par utilisateur et par
  10 minutes, 20 dossiers et 50 extractions par fiche, 100 gabarits de CV par cabinet, §6) ;
  capitalisation (60 recherches par utilisateur et par minute, 50 déclarations de niveau par couple,
  §5 sexies) ; plans (30 propositions de portefeuille par utilisateur et par 10 minutes, §5 bis).
  Pas de limite générale par IP : voir §15.

## 12. Données personnelles

Cadre visé (PRD) : loi ivoirienne n° 2013-450 (ARTCI), RGPD pour les clients
européens, registre des traitements. **Partiellement implémenté** : pas de registre,
pas de procédure d'effacement (l'effacement d'un
utilisateur est d'ailleurs bloqué par le `REVOKE DELETE` du §4 ; les comptes
se désactivent). Données personnelles réellement collectées : nom, e-mail,
rôles, coûts journaliers des collaborateurs, temps saisis, contacts clients,
comptes du portail, réponses aux questionnaires, mesures KPI saisies par le
client ; vagues 2 et 3 : CV des experts (parcours, diplômes, nationalité
facultative), niveaux de compétence déclarés et validés des collaborateurs,
fichiers déposés par le client dans la salle de mission.

- **Envoi à un fournisseur IA** : seulement quand le cabinet a activé l'IA et
  qu'une clé existe ; texte masqué selon §7 bis (limites incluses),
  `data_collection = "deny"` demandé à OpenRouter. La clause « pas
  d'entraînement sur les données » reste à vérifier modèle par modèle avant le
  pilote (DECISIONS.md, ADR-003).
- **Conservation** (vague 0, durées **posées par défaut, à valider avec le
  conseil juridique**) : le texte **démasqué** de `ia_generations` est anonymisé
  après 365 jours (`0104`, job `ia_conservation`, §7 bis) ; le fichier des
  rapports est purgé après 3 ans (`0132`, job `purge_rapports`, §8 bis). Restent
  sans durée : les autres données personnelles (temps, coordonnées, réponses aux
  questionnaires, mesures KPI, journal d'audit) ; `conservation_jours` de l'IA
  n'est pas exposé par l'API IA.
- **Effacement ciblé** (vague 3) : seul le CV d'un expert de la banque des appels
  d'offres s'anonymise à la demande (`anonymiser_cv_ao`, §6) ; aucune durée de
  conservation automatique n'est posée pour les CV (à valider avec le conseil
  juridique, `DECISIONS.md`), et les offres techniques déjà rédigées gardent le
  texte qu'elles citent. Les niveaux de compétence, les fichiers de la salle de
  mission et les retours d'expérience n'ont ni procédure d'effacement ni durée.

## 13. Conduite à tenir en cas de faille

1. Ne pas publier le détail de la faille dans un canal public (ticket, PR
   ouverte, message).
2. Prévenir le responsable du projet (l'utilisateur de la session ; à nommer
   avant tout pilote client).
3. Corriger sur une branche dédiée, avec un test qui reproduit la faille.
4. Évaluer l'exposition (journaux, données touchées) et la documenter.
5. En cas de fuite de `TFA_MASTER_KEY` : faire tourner la clé (ancienne valeur
   dans `TFA_MASTER_KEY_PRECEDENTE`) ; les chiffrés sont repris à leur première
   utilisation (la clé IA d'un cabinet est rechiffrée à sa première lecture
   réussie) et les compteurs du limiteur repartent de zéro.
6. En cas de fuite d'une clé OpenRouter : la révoquer chez le fournisseur, puis
   la remplacer ou la retirer (`PUT /api/ia/parametres`, reconfirmation) ; pour
   la clé de plateforme, changer `OPENROUTER_API_KEY` et redémarrer.

## 14. Dépendances

`pnpm audit --prod` est à lancer à chaque livraison et au moins une fois par
mois (action récurrente, non automatisée aujourd'hui). Résultat du 2026-10-06
(commit `40144b5`) : **aucune vulnérabilité** en production, grâce aux
surcharges `pnpm.overrides` du `package.json` racine : `postcss` ≥ 8.5.23 (via
`next`), `image-size` ≥ 2.0.3 (via `pptxgenjs`), `uuid` ≥ 11.1.1 (via
`exceljs`). L'audit complet (`pnpm audit`) relève 15 constats (4 critiques,
2 hauts, 9 modérés ; 9 avis distincts), tous dans les dépendances de
développement via `vitest` (`apps/api`, `packages/engines` : `vitest`,
`@vitest/mocker`, `tinypool`, `vite`, `esbuild`) : à traiter par une montée de
version de Vitest.

Ajouter une dépendance exige de justifier le choix : le SMTP, le TOTP, le
chiffrement et l'appel OpenRouter (`fetch`) sont écrits sur `node:*` sans
bibliothèque. Bibliothèques ajoutées en V2 (commit `41603e5`) : `docx`,
`pptxgenjs` (rapports Word et PowerPoint), `puppeteer-core` (pilotage de
Chrome, sans navigateur téléchargé) et `exceljs` (import Excel). `exceljs`
remplace le paquet `xlsx` de npm, écarté pour ses vulnérabilités connues ; il
ne reçoit jamais le fichier d'origine mais une archive reconstruite après
contrôle (§8).

## 15. Risques acceptés et dette de sécurité connue

Chaque ligne cite sa source ; ne rien y ajouter sans fichier.

| Risque ou dette                                                                                                                                  | Source                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Fichiers téléversés non chiffrés au repos par l'application, sans analyse antivirus ; stockage disque local seulement (S3 non implémenté)          | `stockage/detection.ts`, `stockage/s3.ts`, `config.ts`                    |
| Coordonnées bancaires : masquées à l'écran de paramétrage sans `facture.emettre`, mais lisibles sur toute facture par un détenteur de `facture.lire` (choix assumé : l'IBAN est imprimé sur les factures) | `routes/parametres-facturation.ts` (en-tête), `facturation/document.ts` |
| Routes sensibles protégées seulement par le crochet 2FA global et leur permission ; pas de reconfirmation par route hors la liste du §3         | `app.ts`, `auth/confirmer-identite.ts`                                    |
| Pas de jeton CSRF dédié : défense = `SameSite=Lax` et garde d'origine ; une requête sans en-tête `Origin` passe ; hypothèse sur le relais Next (§11) | `app.ts` (`origineRefusee`), `apps/web/next.config.mjs`                   |
| Pas d'en-têtes de sécurité sur les réponses JSON de l'API (ni HSTS, ni CSP du web, hors document de facture et fichiers) ; l'API n'est pas censée être exposée directement | `app.ts`, `apps/web/next.config.mjs`                                      |
| Pas de limitation de débit générale par IP (X-Forwarded-For falsifiable, l'API voit l'IP du relais web)                                         | `auth/limiteur.ts` (en-tête)                                              |
| Limiteur par e-mail : un tiers qui connaît seulement l'e-mail peut bloquer la connexion de son titulaire ; parade = déblocage par `cabinet.gerer` | `auth/limiteur.ts`, `routes/limiteur-admin.ts`                            |
| Connexion rapide de démonstration : avec `CONNEXION_RAPIDE_DEMO=oui`, quiconque atteint l'API locale ouvre sans secret la session d'un compte de démo sans 2FA (associé compris, ou compte client du portail de démonstration) ; acceptable sur un poste de développement seulement ; un serveur dont `NODE_ENV` serait local et la base sur la même machine passerait la garde | `routes/connexion-demo.ts`, `config.ts` (`connexionRapideDemoActive`) |
| `mot_de_passe_hash` lisible par le rôle applicatif (reconfirmation d'identité) ; atténué dans le portail par la politique `portail` des utilisateurs | `migrations/0114_portail_rls_complements.sql`                             |
| IA : masquage limité aux termes déclarés et aux formats connus ; garde-chiffres aveugle aux nombres en lettres ; clause « pas d'entraînement » à vérifier par modèle | `ia/masquage.ts`, `ia/garde-chiffres.ts`, `ia/fournisseur.ts`            |
| Durées de conservation par défaut (texte IA 365 jours, rapports 3 ans) posées sans avis juridique ; `conservation_jours` de l'IA non exposé par l'API IA | `migrations/0104_ia_conservation.sql`, `migrations/0132_rapports_conservation.sql`, `ia/conservation.ts` |
| Chrome headless testé seulement sous Windows ; sous Linux, la sandbox du navigateur est à prévoir (aucun `--no-sandbox`, utilisateur non root)  | `rapports/pdf.ts`                                                         |
| Réception des fichiers : la place du sémaphore (4 par instance, 2 par cabinet) n'est prise qu'après la lecture du corps ; les tampons en lecture ne sont bornés que par `fileSize` et le délai de réception de 5 min | `routes/fichiers.ts`, `app.ts` |
| Plan partagé au client jamais servi par le portail : le partage est prêt côté cabinet, aucune route du portail ne le lit | `plans/partage.ts`, `portail/garde.ts`                                    |
| Date d'atteinte d'un jalon non horodatée : approchée par la dernière modification (indicateur de respect des jalons)                            | `finance/indicateurs.ts`                                                  |
| Migrations appliquées par nom, sans somme de contrôle : l'immuabilité d'une migration appliquée est une convention de relecture, non vérifiée par l'outil | `db/migrate.ts`                                                           |
| Rejeu réel des évaluations d'agents (levée de l'ancienne dette « agents inutilisables en production ») : aucune clé OpenRouter dans l'environnement de développement, le vrai fournisseur n'a été exercé que contre un serveur factice local ; AUCUN appel réel n'a eu lieu, donc qualité d'un vrai modèle, coûts et jetons réels et comparaison du modèle servi non vérifiés (un identifiant daté renvoyé par OpenRouter ferait échouer tout rejeu, sans danger) | `agents/evaluations-openrouter.ts` (`memeModele`), `ia/fournisseur.ts`, `test/agents-evaluations-openrouter.test.ts` |
| Rejeu réel : la file `jobs` est FIFO globale entre cabinets, un rejeu de 8 à 13 minutes (`DUREE_MAX_EVALUATION_MS` plus un appel) retarde les jobs de tous les cabinets, et chaque cabinet peut en avoir un (N cabinets, N rejeux) ; plafond par évaluation (2 USD), 5 rejeux par 24 heures, durée maximale et péremptions (1 h en file, 30 min en cours) sont des valeurs de départ à valider | `agents/evaluations-openrouter.ts`, `jobs/worker.ts`, `ia/modeles.ts`, `DECISIONS.md` |
| Rejeu réel : la garde de provenance en base (`MPG09`, `0270`) reste contournable par du SQL arbitraire du même rôle applicatif, qui peut forger la demande, les appels inscrits et l'évaluation ; la garde complète (fonction `SECURITY DEFINER` réservée au job, `REVOKE INSERT, UPDATE` pour le rôle applicatif) n'est pas faite. Autres limites : `prompt_evalue` avec `p_modele` nul (activation d'un prompt) ne lie pas l'activation au modèle routé (antérieur au chantier ; filet à l'exécution par `exigerPromptEvalue`) ; l'interdiction de contenu client réel dans un jeu d'essai est documentée, non contrôlée (le masque d'un rejeu n'a aucun terme sensible) | `migrations/0270_agents_evaluations_openrouter.sql`, `migrations/0265_agents_evaluations_fournisseur.sql`, `agents/executions.ts` (`exigerPromptEvalue`) |
| Automatisation, observation non traitée : le job d'appel d'agent relit le responsable COURANT de l'automatisation, alors que la garde a décidé sous l'identité de l'exécution ; une action d'agent déjà autorisée sous l'ancienne identité peut donc partir sous la nouvelle si l'automatisation est désactivée puis réactivée par une autre personne avant le job (parade possible : comparer `automatisation_executions.executant_id` au responsable courant avant l'appel, en mode « responsable ») | `automatisation/execution.ts` (`lireActionAgent`, `creerHandlerAgentAutomatisation`) |
| Automatisation : 50 automatisations actives par cabinet et 30 simulations par utilisateur et par 10 minutes sont des valeurs de départ « à valider » ; la définition d'une automatisation (gabarits de texte) est lisible de tout détenteur de `automatisation.lire`, chef de mission compris ; un événement traité pendant une coupure n'est pas rejoué à la levée | `automatisation/regles.ts`, `automatisation/simulation.ts`, `automatisation/coupe-circuits.ts`, `DECISIONS.md` |
| KPI : pas de quatre yeux sur la clôture d'une revue ni sur l'exécution d'une décision (le responsable peut clore ce qu'il a décidé) ; le dossier de revue, non enregistré, n'ouvre pas de suivi qualité (QUA) et n'est pas horodaté contre la falsification une fois sorti de la plateforme | `kpi/revues.ts`, `kpi/dossier-revue.ts`, `routes/kpi-pilotage.ts` (§5 quater) |
| Salle de mission : un tiers externe (le client) téléverse des fichiers que le cabinet ouvre, sans antivirus ; l'accusé de réception d'un dépôt est traité hors file, après la transaction : si le processus s'arrête entre les deux, l'accusé n'est pas rejoué (l'échec est seulement journalisé) | `salle-mission/accuses.ts` (`suiteDepotPortail`), `stockage/detection.ts` (§8 septies) |
| CV de la banque des appels d'offres : lisibles de tout détenteur de `ao.lire` ; aucune durée de conservation automatique (à valider) ; le texte d'une offre technique déjà rédigée peut citer le nom d'un expert et n'est pas réécrit par l'anonymisation (versions en ajout seul) | `banque-ao/cv.ts`, `migrations/0386_ao_cv_anonymisation.sql`, `DECISIONS.md` |
| Capitalisation : le chef de mission peut valider la version IA du retour d'expérience qu'il a lui-même demandée (exception voulue, conforme au PRD, `MPJ08` n'exige qu'un responsable de la mission) ; niveaux de compétence, fichiers de la salle et retours d'expérience sans durée de conservation ni procédure d'effacement | `capitalisation/retours.ts`, `migrations/0465_capitalisation_durcissement.sql` |
| `semaineQuerySchema` (`packages/shared/src/schemas/temps.ts`) n'est pas borné : une semaine extrême sur `GET /api/temps/preremplissage` et `GET /api/feuilles-temps/semaine` n'est pas testée (contrairement aux dates bornées par `dateIsoBorneeSchema`) | `routes/previsions.ts`, `routes/feuilles-temps.ts` |
| Seuils, poids et plafonds des vagues 2 et 3 (confiance de notation, go/no-go, estimation, plafonds de débit) : valeurs de départ à calibrer au pilote ; valeurs de départ du rejeu réel des évaluations d'agents (2 USD par évaluation, 5 rejeux par 24 heures, 8 minutes, péremptions 1 h et 30 min) : voir les lignes « Rejeu réel » | `DECISIONS.md`, `notation/confiance.ts`, `appels-offres/go-no-go.ts` |
| Recette navigateur du 2026-10-10, observations non tranchées. **Jours de budget** : un consultant membre de l'équipe voit les JOURS de budget et de temps réel dans la section « Écarts » d'un retour d'expérience (`budget.lire_jours`, FIN-02 ne vise que les montants) : décision produit à confirmer | `capitalisation/retours.ts` (`sansJours`), `packages/shared/src/roles.ts`, `DECISIONS.md` |
| Retour d'expérience : générer la version « gabarit » (sans clé IA, plafond atteint ou sortie inexploitable) inscrit une NOUVELLE version qui remplace le texte courant rédigé par un humain ; l'ancien texte reste lisible dans la version précédente (ajout seul), rien n'est perdu mais l'écran n'avertit pas | `capitalisation/ia.ts` (`genererRetourIa`), `capitalisation/retours.ts` (`inscrireVersionGeneree`) |
| Dossier de revue KPI en brouillon : `GET /kpi/revues/:id/dossier` lui ajoute la mention IA par défaut du cabinet en pied de page (« …tout contenu préparé avec l'aide de l'IA a été relu et validé par un consultant »), alors que ce dossier n'a aucun circuit de validation, ne porte pas de contenu IA et reste « brouillon » et confidentiel : mention trompeuse à retirer du dossier ou à conditionner (constaté à la recette, confirmé dans le code) | `routes/kpi-pilotage.ts` (`mention_pied`), `rapports/parametres.ts` (`MENTION_IA_DEFAUT`) |
| Montants du PDF du dossier bancaire : à l'extraction du texte, ils paraissent sans séparateur de milliers alors que le moteur insère l'espace fine U+202F ; à vérifier visuellement sur un PDF réel | `plans/bancabilite.ts`, `rapports/pdf.ts`, `packages/engines/src/finance/monnaie.ts` |
| Export d'un CV : un message d'erreur réseau 503 a été signalé alors que le fichier produit est valide ; cause non établie, à clarifier | `routes/banque-ao.ts` (`/banque-ao/cv/:id/export`), `rapports/pdf.ts` |
| L'événement `mission.cloture_demandee` n'est publié par aucun module (les automatisations qui l'écoutent ne se déclenchent pas) ; brief quotidien (AUT-07) et copilote (AGT-08) absents | `packages/shared/src/schemas/automatisation.ts`, `automatisation/evenements.ts`, ADR-005, ADR-006 |
| Pages web qui lisent `/api/missions` ou `/api/opportunites` : dix pages demandent des pages de 200 (plafond sûr) alors que ces deux routes admettent 500 : plus d'appels, sans perte de données ; la liste est signalée tronquée au-delà de 20 pages (CODING_STANDARDS §10) | `apps/web/src/lib/pagination.ts` |
| Dépendances de développement : 15 constats via `vitest`                                                                                          | §14                                                                       |
| Registre des traitements, effacement, durées de conservation des autres données personnelles : non faits                                         | §12                                                                       |

## 16. Points ouverts

Décisions encore ouvertes dans le PRD (« Questions ouvertes ») : hébergement
(VPS ACC ou cloud avec région africaine) et obligations de facturation (facture
normalisée de la DGI ivoirienne).

Points ouverts des vagues 2 et 3 (à trancher avant le pilote, `DECISIONS.md`) :

- **Durées de conservation** : CV de la banque des appels d'offres, niveaux de compétence,
  fichiers déposés dans la salle de mission, retours d'expérience (§12). Avis du conseil juridique
  à obtenir, comme pour les textes IA et les rapports.
- **Antivirus** pour les fichiers téléversés par un tiers externe (salle de mission, §8 septies) :
  à décider avec le choix d'hébergement.
- **Valeurs de départ** : plafonds d'automatisation (50 actives, 30 simulations par 10 minutes),
  seuils de confiance de la notation, poids du go/no-go et du rapprochement, effectifs de
  l'estimation, heure de la détection quotidienne (07:30 UTC).
- **Automatisation** : lier l'appel d'un agent à l'identité décidée par la garde (§15) ; rejeu des
  événements bloqués par un coupe-circuit, aujourd'hui volontairement absent.
- **Salle de mission** : mise en file de l'accusé de réception (§15).
- **Rejeu réel des évaluations d'agents** (§7 bis, §15) : valider les valeurs de départ
  (plafond de 2 USD par évaluation, 5 rejeux par 24 heures, durée maximale de 8 minutes,
  péremptions de 1 h et 30 min, un rejeu par cabinet) ; constater un premier rejeu réel avec
  une clé (modèle servi, coûts, jetons) ; décider de la garde complète de provenance
  (fonction `SECURITY DEFINER`) et d'une file `jobs` dédiée aux jobs longs.
- **Bornes de dates** : `semaineQuerySchema` (§15).
- **Jours de budget dans les retours d'expérience** : un consultant membre de l'équipe lit les jours
  de la section « Écarts » (§5 sexies, §15) ; décision produit à confirmer (`DECISIONS.md`).
- **Recette du 2026-10-10, à clarifier** (§15) : pied de page « relu et validé par un consultant » sur
  le dossier de revue KPI en brouillon ; séparateurs de milliers des montants du PDF du dossier
  bancaire ; message réseau 503 sur l'export d'un CV alors que le fichier est valide ; génération du
  gabarit d'un retour qui remplace le texte rédigé (ancienne version conservée).
- **Lacunes de la vague 2** : publication de `mission.cloture_demandee`, brief quotidien (AUT-07) et
  copilote (AGT-08) (§15).
