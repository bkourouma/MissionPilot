# Modèle de menace — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les mécanismes de sécurité **tels qu'implémentés
aujourd'hui** (état de la branche `feat/vague-0-reliquats`, 2026-10-08, V1 et V2 et reliquats de la vague 0), avec leur
fichier, pas un objectif. Il est lu par l'agent `security-auditor` et par
`/audit` : chaque contrôle listé ici doit pouvoir se vérifier dans le code. Les
chemins sont relatifs à la racine du dépôt ; `routes/`, `auth/`, `ia/`… sont
sous `apps/api/src/`. La numérotation des sections est citée ailleurs (code,
migrations, autres documents) : les ajouts de la V2 sont des sections « bis ».

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
  (`routes/portail-gestion.ts`) ; `auth/confirmer-identite.ts`. Pour l'IBAN,
  la clé et le plafond IA et le déblocage, un utilisateur sans 2FA active
  confirme par mot de passe seul (`motDePasseSeulSiInactive`) ; le journal le
  note.
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
  `planifier_conservation_ia` (`0104`), `planifier_purge_rapports` (`0132`).
  `purger_textes_ia` n'agit que sur le cabinet du contexte ; `ia_demandes_purgeables`
  (`0104`) n'est exécutable que par le propriétaire. Liste reproductible :
  `rg -n "GRANT EXECUTE" apps/api/migrations`. Certains déclencheurs de contrôle
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
  partage), commentaires. Inventaire : `test/portail-acces.test.ts` compare
  chaque route enregistrée à la liste.
- **Contexte RLS à chaque transaction** (`portail/contexte.ts`) : pour toute
  route listée, la garde range le client rattaché et l'utilisateur ; un
  rattachement désactivé ou un client archivé donne un client **sentinelle**
  (UUID nul, qui ne désigne aucun client). `db/pool.ts` pose alors
  `app.portail_client_id` et `app.portail_utilisateur_id` au début de CHAQUE
  transaction de la requête, `withTenant` comme `withoutTenant`. Exceptions
  (`sansContexte`) : connexion, déconnexion, profil d'authentification, sa
  propre 2FA, acceptations d'invitation ; leurs tables (`sessions`, `*_2fa`,
  `invitations`) sont `portail_interdit`. Seule sortie :
  `horsContextePortail`, employée uniquement par l'évaluation des alertes KPI
  après une saisie (`routes/portail-kpi.ts`), ce que vérifie
  `test/portail-contexte.test.ts`.
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
  contributeur désigné ; écrans web `/portail/kpi`). Tests : `isolation.test.ts` (« toute table à RLS porte
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
  351 gestionnaires de route, seuls `POST /auth/connexion`,
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
    (`MPS03`, `plan_valideur_dispense`, `0180`, `0181`).
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

## 5 ter. Qualité et responsabilité professionnelle (lot QUA, PRD complémentaire §10)

Code : `apps/api/src/qualite/`, `routes/qualite.ts`, migrations `0280`–`0285` (lettre de domaine
`Y`, `MPY01`–`MPY07`). Le moteur `packages/engines/src/qualite` juge les gardes ; l'API ne recode
pas la séparation des tâches.

- **Droits.** Consulter et parcourir : `mission.lire` ET mission visible (404 sinon, comme un
  livrable d'autrui). Ouvrir un suivi, vérifier la définition de terminé, attester, relever la
  classe, relecture du chef et second expert : `qualite.relire` ; ouvrir exige en plus la mission
  modifiable (chef, directeur ou associé, mission non clôturée). Signer, déclarer ou retirer une
  relation entre clients, décider d'une acceptation : `qualite.signer`. NPS du cabinet : associé seul
  (`qualite.signer` puis rôle `associe`). Les étapes « validation de l'auteur » et « validation du
  consultant » n'exigent que l'appartenance à la mission (le rôle consultant n'a pas
  `qualite.relire`). Aucune route n'est dans `LISTE_BLANCHE_PORTAIL` ; toutes les tables sont
  `portail_interdit`.
- **Classe de risque.** Fixée à l'ouverture à la classe minimale du type (rapport R2, notation R3,
  plan R3, questionnaire R2, état R3, autre R1), relevable, jamais abaissée : 409
  `CLASSE_SOUS_MINIMALE` / `CLASSE_ABAISSEE`, doublé en base (`MPY02`).
- **Validation = parcours + définition + garde.** Une étape est refusée (409) si : le suivi n'est pas
  en revue (`SUIVI_NON_EN_REVUE`), la définition de terminé n'est pas satisfaite
  (`DEFINITION_NON_SATISFAITE`), le relecteur LUI-MÊME n'a pas parcouru tous les éléments
  obligatoires (`PARCOURS_INCOMPLET` ; le « vu » d'un autre ne le dispense pas ; le signataire parcourt
  aussi), ou le moteur `evaluerGarde` relève une violation (`GARDE_VIOLEE`, avec `details.violations` :
  `AUTEUR_ATTENDU`, `CUMUL_INTERDIT`, `QUATRE_YEUX`…). Étape hors ordre ou non requise : 409. Un acteur
  non habilité : 403. Le moteur n'a pas de « cumul permis » configuré : un directeur qui relit ne signe
  pas dans la même garde R3 (réglage de petit cabinet non offert).
- **Définition de terminé.** Contrôles par du code déterministe (enregistrement du livrable, statut du
  contenu source, sections présentes, chiffres tracés) ; ce qu'il ne sait pas trancher est
  `non_evaluable` et ne se règle que par l'attestation motivée d'un humain ; un item non conforme ne
  s'atteste pas, on corrige le livrable. Les résultats sont en ajout seul. L'agent IA qualité (lot AGT)
  complètera ces contrôles sans les remplacer.
- **Signature (QUA-06).** Livrables R2 et R3 validés, par le directeur de la mission ou un associé.
  L'empreinte SHA-256 porte sur le CONTENU quand le module qualité sait le lire (somme du fichier du
  rapport, canonique JSON de la version de notation, du plan, du questionnaire), sinon sur le dossier
  de revue (`portee_empreinte`). Mention de contribution IA : politique du cabinet
  (`rapports/parametres.ts`, active par défaut). Un livrable signé est figé.
- **Acceptation (QUA-07).** Conflits calculés par le serveur depuis les relations DÉCLARÉES (même
  groupe, investisseur et cible, concurrent) et figés dans chaque évaluation ; l'API révèle la raison
  sociale du client lié et le NOMBRE de ses missions en cours, jamais leur intitulé. Accepter malgré un
  conflit exige un motif. Détection limitée aux relations déclarées : aucune recherche d'homonymes.
- **Satisfaction (QUA-08).** Note entière 0–10 saisie par le cabinet ; corrections en nouvelle ligne
  (dernier rang). Le NPS est calculé par le moteur pur `syntheseNps` (`packages/engines/src/nps`,
  entiers exacts), appelé par `qualite/satisfaction.ts`.
- **Branchements** (`qualite/branchements.ts`, service interne sans droit supplémentaire, dans la
  transaction de l'appelant qui a déjà exigé le sien) : génération d'un rapport → suivi `rapport`
  (R2) ; soumission en revue et publication d'une notation → suivi `notation` (R3). Éléments de la
  revue guidée déposés : assertions fragiles de la mission (`assertionsFragilesDeMission`), chiffres
  du livrable avec leur source, recommandations (initiatives du plan, recommandations candidates de
  la méthode) ; plafonds `BRANCHEMENT_MAX`, dépôt idempotent, rien sur un suivi validé ou signé.
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
  | `MPS01-06` | plan en ajout seul et rattachement figé, cohérence des éléments (dépendances, KPI d'objectif : `MPS02`), auteur ≠ valideur, partage d'un contenu non validé, 200 versions du modèle ou changements de lien (`MPS05`), notation liée non publiée ou d'un autre client (`MPS06`) | `0180`–`0184` |
  | `MPR01-02` | rapport de notation ou de plan : source (notation, plan, version du modèle) inexistante ou d'une autre mission (`MPR01`), notation non publiée (`MPR02`) | `0131` |
  | `MPY01-07` | qualité : historiques en ajout seul (`MPY01`), suivi (classe jamais abaissée, statut qui ne recule pas, livrable signé figé : `MPY02`), élément de revue ajouté après validation (`MPY03`), session de revue close une fois (`MPY04`), étape de garde hors état (`MPY05`), signature d'un suivi non validé ou d'une autre version (`MPY06`), relation de clients en double sens (`MPY07`) | `0280`–`0284` |
  | `MPV01-05` | registre des preuves : historique en ajout seul et champs figés d'une dimension (`MPV01`), cohérence mission, client, document, réponse ou lien (`MPV02`), versions consécutives (`MPV03`), avis d'expert signé par l'auteur de la version (`MPV04`), arbitrage d'une contradiction qui n'est plus courante (`MPV05`) | `0240`–`0242` |
  | `MPM01-06` | référentiel de méthodes : version publiée et son contenu immuables (`MPM01`), incohérence de propriétaire, de numérotation ou d'identité (`MPM02`), historiques en ajout seul (liaison des missions, validations de dérogation, propositions : `MPM03`), décision de dérogation définitive ou approuvée par son demandeur, quatre yeux (`MPM04`), circuit du comité méthode et relecteur ≠ auteur (`MPM05`), version liée à une mission non publiée, d'un autre cabinet ou plus ancienne (`MPM06`) | `0201`–`0203` |
  | `MPG01-05` | agents IA : historiques en ajout seul (`MPG01`), au-delà du plafond du standard ou agent inconnu (`MPG02`), changement de niveau d'autonomie refusé (`MPG03`), activation d'un prompt ou d'un modèle sans évaluation de non-régression réussie (`MPG04`), incohérence d'exécution, de décision, de contribution ou de jeu (`MPG05`) | `0260`–`0264` |
  | `MPO01-04` | dossier client : tout en ajout seul (`MPO01`), remplacement d'un fait (même client, catégorie et clé, jamais un fait rejeté) ou d'un état financier (état courant du même exercice, un seul courant par exercice) (`MPO02`), décision sur un enregistrement remplacé ou fait extrait par l'IA confirmé dans sa transaction de création (`MPO03`), lignes d'état ajoutées hors de l'ingestion, acceptation automatique d'un état en écart ou acceptation humaine d'un état en écart sans motif (`MPO04`) | `0220`–`0223` |

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

## 7. Assainissement des entrées et des sorties

- **Validation** : schémas Zod `.strict()` partagés (`packages/shared/src/schemas/`,
  372 `z.object`, tous stricts), corps JSON limité à 1 Mio (`app.ts`
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
  l'orchestrateur ; ni la notation, ni les plans, ni les rapports ne lancent de
  génération (rédaction assistée non faite).
- **Agents IA** (lot AGT de la vague 1, ADR-005, migrations `0260`–`0264`,
  `agents/`, `routes/agents.ts`) : l'orchestrateur reste le SEUL composant qui
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
    ne peut pas figurer dans le message système (400). Les signaux d'injection
    relevés sont tracés avec l'exécution (signal, pas barrière). Une sortie
    n'appelle aucun outil (`agents/garde-actions.ts`, `ACTION_DEPUIS_SORTIE`) ;
    une action modifiante exige un humain qui confirme, ou un événement sur une
    brique N4 (R0, coupe-circuit levé). Les contrats de sortie n'admettent aucun
    champ de commande (`ia/sortie-agent.ts`). Tests : `agents-injection.test.ts`,
    `agents-executions.test.ts`.
  - **Sorties validées** (AGT-02) : revalidation stricte contre le contrat de
    l'agent ; une sortie non conforme ne peut qu'être rejetée (409
    `SORTIE_AGENT_NON_CONFORME`, doublé en base `MPG05`).
  - **Autonomie** (AGT-03) : promotion en N3 ou N4 par un associé seul
    (`autonomie.decider`, doublé en base `MPG03`), palier par palier, sur
    éligibilité du moteur pur ; un incident majeur rétrograde automatiquement en
    N2 ; coupe-circuit N4 du cabinet (le lever : associé, `MPG03`). Historiques en
    ajout seul (`MPG01`, `REVOKE UPDATE, DELETE`).
  - **Non-régression** (AGT-04) : la base refuse l'activation d'une version de
    prompt doté d'un jeu d'essai, ou le choix d'un modèle pour sa tâche, sans
    évaluation réussie (`MPG04`, déclencheurs sur `ia_prompt_activations` et
    `ia_modeles_taches`) ; le premier jeu épingle la version active. Évaluations
    sur le fournisseur LOCAL déterministe (`ia/fournisseur-local.ts`), aucun
    appel externe. Les routes `routes/ia-prompts.ts` et `routes/ia-parametres.ts`
    traduisent `MPG04` en 409 `NON_REGRESSION_REQUISE` ; une nouvelle version d'un
    prompt doté d'un jeu d'essai est créée inactive quand `activer` est omis (409
    si `activer: true` explicite : elle n'a encore aucune évaluation). **Limite** :
    revenir au modèle recommandé n'est pas gardé.
  - **Transparence** (AGT-09) : agent, brique, niveau effectif, prompt, modèle,
    mode dégradé (AGT-10), sources, empreinte de l'entrée (jamais l'entrée en
    clair), décision humaine ; le coût est ABSENT sans `finance.lire` ;
    contribution (AGT-05) mesurée par le moteur pur, textes non recopiés
    (empreintes SHA-256). Plafond de coût par mission (AGT-06) vérifié avant
    l'appel, sans réservation (une estimation de dépassement possible).
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
  personne), 404 sinon, y compris pour un autre cabinet. Fermé au portail : le
  client télécharge un livrable partagé par `/api/portail/livrables/:id/fichier`.
  Réponse : type forcé au type détecté, `nosniff`,
  `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`,
  `attachment` par défaut (`inline` sur demande pour PDF et images seulement),
  téléchargement journalisé sans le contenu (`routes/fichiers.ts`).
- **Cycle de vie** : métadonnées en ajout seul (`REVOKE UPDATE, DELETE` sur
  `fichiers` et `fichiers_suppressions`, `0070`) ; un fichier non rattaché est
  purgé au bout de 24 h par le job `purge_fichiers_orphelins` (`stockage/purge.ts`).
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
  analyse antivirus, sauvegarde du dossier `STORAGE_DIR` (rien dans le dépôt),
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
  notation publiée (`MPR02`).
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
migrations `0240`–`0242`.

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
  verbatim masqué. Le journal ne reçoit jamais l'extrait.
- **Avis d'expert** : une assertion sans preuve peut être assumée comme avis
  d'expert, motivé puis signé ; la signature est celle de l'auteur de la version
  (`MPV04`), serveur seul décide (`signer_avis`), et ne se reporte pas sur la
  version suivante.
- **Bornes** (déni de service) : 5 000 preuves, 2 000 assertions et 100
  dimensions par mission ; 409 `PLAFOND_ATTEINT`. Les synthèses chargent la
  mission entière dans ces bornes.
- **API publique pour la revue guidée** (QUA-03) : `assertionsFragilesDeMission`
  (`preuves/synthese.ts`) et `GET /api/missions/:id/assertions/fragiles`.
- **Codes d'erreur** : `MISSION_CLOTUREE`, `PLAFOND_ATTEINT`, `DIMENSION_INCONNUE`,
  `DIMENSION_EXISTANTE`, `PREUVE_INCOHERENTE`, `PREUVE_HISTORIQUE_IMMUABLE`,
  `PREUVE_VERSION_CONCURRENTE`, `AVIS_EXPERT_INVALIDE`, `ARBITRAGE_INVALIDE`, et les
  codes du moteur (`PREUVE_INVALIDE`, `ASSERTION_INVALIDE`, `DIMENSION_INVALIDE`,
  `OPTIONS_INVALIDES`).
- **Limites connues** : une dimension se désactive mais ne se supprime pas ; la
  détection automatique des contradictions (agent contradicteur) n'existe pas
  encore, le lien « contre » est posé par un consultant ; le lien vers un fichier,
  une réponse ou un document n'est pas encore vérifié contre le droit de lecture du
  fichier ; PRV-06 : l'annexe des sources des rapports PDF et Word est faite
  (§8 bis), pas les citations cliquables des livrables web.

## 8 quater. Dossier client vivant (DOS-01 à DOS-07)

Routes de `routes/dossier-client.ts`, logique dans `apps/api/src/dossier/`, tables
des migrations `0220`–`0223`, moteurs `packages/engines/src/dossier/`.

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
  Accepter un état financier en écart exige un motif (`MPO04`) et un autre membre
  que l'importateur, sauf associé (`dossier/etats.ts`).
- **Jamais d'acceptation silencieuse** (DOS-03) : un état n'est accepté
  automatiquement que si le moteur `controlerEtatFinancier` conclut à
  `acceptationAutomatique` (aucun écart au-delà de la tolérance ET contrôles requis
  faisables : équilibre du bilan, résultat au bilan) ; la base le double (`MPO04` :
  `controles_ok` exigé, décision automatique dans la transaction d'ingestion). Sinon
  l'état part en revue avec ses constats. Chaque ligne garde sa référence (fichier,
  cellule Excel ou ligne CSV, page).
- **Fichiers reçus** : classeur .xlsx (`POST /dossiers/:id/etats-financiers/excel`,
  multipart encapsulé, `gardeTailleMultipart` avant l'authentification, dossier
  vérifié AVANT la lecture du corps, `avecPlaceAnalyse` puis lecteur borné
  `lireClasseurTemps` de `temps/import-excel.ts`) ou CSV en JSON (200 000
  caractères au plus). Le fichier n'est jamais conservé : nom assaini, empreinte
  SHA-256 et taille sont tracés avec l'état. Montants lus exactement par le moteur
  (`lireMontantTexte`, refus plutôt qu'arrondi).
- **Document cité en source** : un `document_id` doit être lisible par l'auteur
  (`exigerFichierLisible`, 404 sinon).
- **FIN-02** : le dossier ne porte que des données DU CLIENT (faits, facteurs, états
  financiers) ; aucune donnée de coût, taux ou marge du cabinet n'y entre, quelle
  que soit `finance.lire`. La frise ne projette que libellés et dates, chaque source
  selon les droits du lecteur (`mission.lire`, `notation.lire`, `kpi.lire`,
  `plan.lire`, mission visible).
- **Export** (DOS-07) : `GET /dossiers/:id/export?format=json|zip`
  (`dossier.ecrire`) ; contenu destiné au client, sans nom ni identifiant de membre
  du cabinet ; cellules CSV neutralisées contre l'injection de formule ; chaque
  export est tracé (`dossier_exports` : format, empreinte, taille, volumes) et
  journalisé (`dossier.exporter`) dans la même transaction ; `no-store`, `nosniff`.
- **Bornes** (déni de service, export borné) : 5 000 faits, 2 000 valeurs de
  facteurs et 60 états financiers (1 000 lignes chacun) par dossier, 409
  `DOSSIER_PLEIN` ; écritures d'un dossier sérialisées par verrou consultatif.
- **Codes d'erreur** : `VALIDATION_REQUISE`, `DOSSIER_PLEIN`, `DOSSIER_AJOUT_SEUL`,
  `REMPLACEMENT_INVALIDE`, `DECISION_INVALIDE`, `ACCEPTATION_REFUSEE`,
  `DEJA_DECIDE`, `DEJA_REMPLACE`, `IMPORT_INVALIDE` (lignes en erreur dans
  `erreur.details.erreurs`), `EXCEL_INVALIDE`, `FICHIER_TROP_VOLUMINEUX`,
  `FICHIERS_OCCUPE`, et les codes du moteur (`LIGNES_INVALIDES`,
  `CODE_LIGNE_INVALIDE`, `CODE_LIGNE_EN_DOUBLE`, `PARENT_INCONNU`,
  `PARENT_INVALIDE`, `CYCLE_PARENTS`, `ROLE_INVALIDE`, `MONTANT_INVALIDE`,
  `TOLERANCE_INVALIDE`).
- **Limites connues** : l'extraction par l'IA depuis un PDF (DOS-03) n'est pas
  branchée (la colonne `origine` l'accueillera) ; groupes et filiales (DOS-05) hors
  lot ; la feuille d'origine d'un classeur n'est pas nommée (première feuille
  visible) ; un fichier cité en source n'est pas protégé de la purge des fichiers
  orphelins (il doit être rattaché à un document de mission) ; barème de
  fiabilité et seuils de classe posés par défaut, à calibrer au pilote.

## 8 quinquies. Référentiel de méthodes (STD-01 à STD-12, ADR-004)

- **Standard partagé, lecture seule** (`0200`–`0205`) : les lignes du standard
  MissionPilot ont `cabinet_id` NULL, sont posées par migration (rôle
  propriétaire) et lues par tout cabinet par une politique PERMISSIVE
  `standard_lecture` **FOR SELECT** (`cabinet_id IS NULL AND app_cabinet_id() IS
  NOT NULL`) ; seule la politique `isolation` admet INSERT, UPDATE et DELETE, et
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
  (ou associé), quatre yeux. Le demandeur ne franchit que sa propre étape
  (`MPM04` en base, 403 `SEPARATION_DES_TACHES` à l'API). Comité méthode :
  relecteur ≠ auteur (`MPM05`).
- **Entrées** : règles au schéma `regleModulationSchema` (imbrication bornée
  avant l'analyse récursive), contexte contrôlé par `validerContexteModulation`
  (400 `CONTEXTE_INVALIDE`), contenu d'une version borné
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
  `MOTEUR_INCONNU`, `MODULATION_*` (400).
- **Limites connues** : le standard ne se publie que par migration (pas d'espace
  d'administration ACC) ; facteurs portés par le dossier client PROPOSÉS, pas
  appliqués d'office (`GET /missions/:id/methode/contexte-propose`,
  `standard.lire` ET `dossier.lire`, mission visible ; `standard/contexte-dossier.ts` :
  valeurs courantes sourcées, valeurs refusées par le moteur écartées avec la
  raison ; rien n'est écrit, l'utilisateur confirme en liant) ; seuils d'autonomie par
  classe (N2 au plus pour R2 et R3, N3 pour R1, N4 pour R0) posés par défaut, à
  valider.

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
  instance, 503 `FICHIERS_OCCUPE`, §8) ; KPI (20 000 périodes par requête, §5 bis).
  Pas de limite générale par IP : voir §15.

## 12. Données personnelles

Cadre visé (PRD) : loi ivoirienne n° 2013-450 (ARTCI), RGPD pour les clients
européens, registre des traitements. **Partiellement implémenté** : pas de registre,
pas de procédure d'effacement (l'effacement d'un
utilisateur est d'ailleurs bloqué par le `REVOKE DELETE` du §4 ; les comptes
se désactivent). Données personnelles réellement collectées : nom, e-mail,
rôles, coûts journaliers des collaborateurs, temps saisis, contacts clients,
comptes du portail, réponses aux questionnaires, mesures KPI saisies par le
client.

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
| Dépendances de développement : 15 constats via `vitest`                                                                                          | §14                                                                       |
| Registre des traitements, effacement, durées de conservation des autres données personnelles : non faits                                         | §12                                                                       |

## 16. Points ouverts

Décisions encore ouvertes dans le PRD (« Questions ouvertes ») : hébergement
(VPS ACC ou cloud avec région africaine) et obligations de facturation (facture
normalisée de la DGI ivoirienne).
