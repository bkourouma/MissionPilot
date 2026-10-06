# Modèle de menace — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les mécanismes de sécurité **tels qu'implémentés
aujourd'hui** (état du dépôt au commit `cdaf666`), avec leur fichier, pas un
objectif. Il est lu par l'agent `security-auditor` et par `/audit` : chaque
contrôle listé ici doit pouvoir se vérifier dans le code. Les chemins sont
relatifs à la racine du dépôt.

## 1. Actifs à protéger

- **Données financières d'un cabinet** : honoraires, budgets, factures,
  encaissements, relances, indicateurs, export comptable (`apps/api/src/finance/`,
  `apps/api/src/facturation/`).
- **Données internes confidentielles (FIN-02)** : coûts journaliers
  (`collaborateur_couts`), grilles de taux (grades, clients, propositions) et
  marges. Réservées aux associés et gestionnaires (permission `finance.lire`).
- **Coordonnées bancaires du cabinet** (IBAN, banque) : leur modification
  détourne des paiements (`routes/parametres-facturation.ts`).
- **Secrets d'authentification** : secrets TOTP, codes de secours, jetons de
  session, hachés de mots de passe.
- **Identité légale des clients** (RCCM, compte contribuable) et contacts.
- **Journal d'audit** et historiques immuables (budget figé, factures émises).
- Hors V1, pas encore implémentés : états financiers clients, clé
  OpenRouter (ADR-003, `OPENROUTER_API_KEY` est lue par `config.ts` mais aucun
  appel n'existe), pièces justificatives (voir §5).

## 2. Acteurs et frontières de confiance

| Frontière                       | Mécanisme                                              | Fichier                                             |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Cabinet ↔ cabinet               | RLS PostgreSQL + FK composites (§4)                    | `apps/api/migrations/`, `apps/api/src/db/pool.ts`   |
| Rôle ↔ rôle dans un cabinet     | Permissions par rôle (§5)                              | `packages/shared/src/roles.ts`                      |
| Utilisateur ↔ mission           | Règle de visibilité des missions                       | `apps/api/src/missions/acces.ts`                    |
| Navigateur ↔ API                | Cookie de session httpOnly, relais `/api` du web       | `apps/api/src/auth/ouvrir-session.ts`, `apps/web/next.config.mjs` |
| API ↔ base                      | Rôle applicatif non propriétaire, sans BYPASSRLS       | `apps/api/src/db/migrate.ts`, `migrations/0001_socle.sql` |
| API ↔ SMTP                      | TLS vérifié, STARTTLS sans repli en clair              | `apps/api/src/notifications/smtp.ts`                |

Acteurs réels (rôles de `packages/shared/src/roles.ts`) : associé,
directeur de mission, chef de mission, consultant, responsable des
ressources, gestionnaire administratif et financier, expert métier, expert
externe. Seuls l'associé (toutes les permissions) et le gestionnaire
possèdent `finance.lire`. Le `directeur_mission` détient `budget.reviser`,
`facture.valider` et `debours.valider`, mais pas `finance.lire`.

**Portail client (V2)** : non implémenté. Aucun rôle client n'existe dans
`ROLES`. Quand il arrivera, il devra être un acteur distinct, jamais un rôle de
cabinet, avec ses propres tests d'isolation (voir ADR à écrire).

Menaces visées : un cabinet qui lit ou écrit chez un autre ; un utilisateur
interne qui voit des coûts/marges sans droit ; un collaborateur qui valide son
propre travail ; falsification d'une facture émise, du journal ou d'une
période clôturée ; vol de session ou de secret 2FA depuis une fuite de base ;
force brute sur mot de passe ou code 2FA ; injection SQL, CSV, e-mail ou HTML.

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
- **Limiteur de tentatives** : en mémoire, borné (10 000 clés), clé = e-mail,
  tentative réservée avant le calcul coûteux ; une entrée bloquée n'est jamais
  évincée (`auth/limiteur.ts`). 10 essais par fenêtre de 15 min à la connexion
  (`routes/auth.ts`). Limiteurs partagés pour la reconfirmation du mot de passe
  et les codes de second facteur (`auth/confirmer-identite.ts`).
- **TOTP (RFC 6238 / 4226)** : HMAC-SHA-1, 6 chiffres, pas de 30 s, fenêtre
  ±1, comparaison en temps constant, anti-rejeu par dernier pas accepté et
  verrou `FOR UPDATE` (`auth/totp.ts`, `auth/double-authentification.ts`).
- **Chiffrement des secrets** : AES-256-GCM, nonce de 96 bits, AAD liant le
  chiffré à sa ligne, clés dérivées par HKDF-SHA-256 de `TFA_MASTER_KEY`, une
  clé par usage (`totp`, `codes_secours`, `file_email`), version de clé stockée
  pour la rotation (`TFA_MASTER_KEY_PRECEDENTE`) ; `auth/chiffrement.ts`.
- **Codes de secours** : 10 codes, stockés en empreinte HMAC à clé dérivée,
  usage unique par `UPDATE` atomique (`auth/double-authentification.ts`).
- **Défi de connexion 2FA** : jeton à usage unique, 5 min, haché en base,
  5 tentatives par défi ; blocage progressif persistant après échecs
  consécutifs (5 → 1 min, 8 → 15 min, 12 → 1 h) avec alerte e-mail à 8 et 12
  (`routes/auth.ts`, `double-authentification.ts` `dureeBlocageMs`).
- **2FA obligatoire** : politique par cabinet (`cabinets.tfa_obligatoire`,
  rôles `associe`, `directeur_mission`, `gestionnaire`) et plancher plateforme
  `TOTP_REQUIS=oui`. Le crochet `preHandler` d'`app.ts` répond `403
  TFA_A_CONFIGURER` à tout utilisateur concerné sans 2FA, sauf sur `/api/sante`,
  `/api/auth/*` et `/api/invitations/accepter` (`routeLibreSans2fa`, le motif de
  route est comparé, jamais l'URL brute).
- **Reconfirmation d'identité** (mot de passe + second facteur) avant :
  désactivation de sa 2FA, régénération des codes de secours, politique 2FA du
  cabinet, réinitialisation de la 2FA d'autrui, coordonnées bancaires
  (`auth/confirmer-identite.ts`). Pour l'IBAN seulement, un utilisateur sans 2FA
  active confirme par mot de passe seul ; le journal le note.
- **Réponses sensibles** (défi, secret TOTP, codes de secours) : `cache-control:
  no-store` (`routes/auth.ts` `sansCache`). Le secret TOTP n'est remis qu'une
  fois, à l'initialisation.
- **Invitations** : jeton haché, expirant, inutilisable si l'inviteur n'est plus
  un associé actif (`resoudre_invitation`, `migrations/0008_durcissement.sql`).

## 4. Isolation entre cabinets et cloisonnement des données

- **Contexte de cabinet** : `withTenant(cabinetId, fn)` ouvre une transaction,
  valide l'UUID, puis `SELECT set_config('app.cabinet_id', $1, true)` (portée
  transaction : le contexte ne fuit pas) ; `apps/api/src/db/pool.ts`. Aucune
  requête métier ne s'exécute hors `withTenant` ou `withoutTenant`.
- **RLS** : chaque table portant `cabinet_id` (et `cabinets`) a
  `ENABLE ROW LEVEL SECURITY` et une politique `isolation` (`USING` et
  `WITH CHECK` sur `app_cabinet_id()`), voir `migrations/0001_socle.sql` puis
  chaque migration de table. Sans contexte, aucune ligne n'est visible (échec
  sûr). Test d'inventaire : `apps/api/test/isolation.test.ts` (« toute table
  portant cabinet_id (ou cabinets) a RLS activée et une politique »).
- **Rôle applicatif** `missionpilot_app` : créé `NOSUPERUSER NOBYPASSRLS`,
  non propriétaire des tables (`db/migrate.ts`) ; les migrations tournent avec
  le rôle propriétaire (`DATABASE_OWNER_URL`). Les privilèges par défaut ne
  donnent que SELECT/INSERT/UPDATE/DELETE ; les `REVOKE` sont décrits en §6.
  Test : `isolation.test.ts` « le rôle applicatif n'est ni superutilisateur,
  ni BYPASSRLS, ni propriétaire des tables ».
- **Fonctions `SECURITY DEFINER`** : étroites, `search_path = public, pg_temp`,
  `REVOKE ALL … FROM PUBLIC` puis `GRANT EXECUTE` au seul rôle applicatif :
  `trouver_connexion`, `resoudre_session`, `resoudre_invitation`,
  `creer_cabinet`, `reserver_job` (`0001`), `reserver_job_a`,
  `planifier_job_cabinets` (`0030`), `resoudre_defi_2fa` (`0050`),
  `etat_tfa_session` (`0052`). Elles servent aux appels sans cabinet connu
  (`withoutTenant`). Certains déclencheurs de contrôle sont aussi
  `SECURITY DEFINER` pour lire hors visibilité RLS (`0010`, `0013`, `0043`,
  `0060`).
- **Clés étrangères composites** `(cabinet_id, id)` : une ligne ne peut pas
  référencer une ligne d'un autre cabinet, même avec un identifiant valide
  (par exemple `0005_grades_collaborateurs.sql`, `0043_factures.sql`).
- **Référence d'autrui = inexistante** : une mission invisible ou d'un autre
  cabinet répond 404 comme une mission inexistante
  (`missions/acces.ts` `exigerMissionVisible`) ; même principe pour les
  échéances (`routes/echeancier.ts`).
- **Suppression** : `REVOKE DELETE ON cabinets, utilisateurs` pour le rôle
  applicatif, afin que les actions `ON DELETE CASCADE` ne puissent pas effacer
  le journal (`0008_durcissement.sql`).

## 5. Autorisations

- **Permissions par rôle** : `PERMISSIONS_PAR_ROLE` et `aPermission` dans
  `packages/shared/src/roles.ts` ; test `packages/shared/src/roles.test.ts`.
  Chaque route appelle `exiger(request, permission?)` (`auth/contexte.ts` :
  401 sans session, 403 sans droit). Sur 203 gestionnaires de route, seuls
  `POST /auth/connexion`, `/auth/connexion/2fa`, `/auth/deconnexion`,
  `GET /sante` et `POST /invitations/accepter` ne l'appellent pas (recherche
  mécanique dans `.claude/rules/review-checklist.md`).
- **Visibilité des missions** : règle écrite en tête de `missions/acces.ts` :
  `mission.lire_toutes` donne tout le cabinet ; sinon seulement les missions
  dont on est directeur, chef ou membre d'équipe. Modifier exige
  `mission.modifier_toutes` ou d'être directeur/chef, et une mission
  clôturée est refusée (409). Le fragment SQL `filtreVisibilite` est réutilisé
  par les requêtes de finance, de facturation et de plan de charge.
- **Séparation des tâches** : l'auteur ne valide pas son propre travail, sauf
  associé : débours (`facturation/outils.ts`), factures (auteur, soumetteur et
  tous les modificateurs du brouillon exclus, `facturation/factures.ts`),
  contre-passations d'encaissement (`finance/encaissements.ts`), révision de
  budget (directeur de mission).
- **Contrôle côté web** : `apps/web/src/middleware.ts` ne teste que la
  présence du cookie (premier filtre) ; la garde réelle est `obtenirSession` /
  `exigerPermission` (`apps/web/src/lib/session.ts`) qui interroge l'API. Le web
  n'est jamais la source de vérité des droits.

## 6. Confidentialité financière (FIN-02) et historique immuable

- **Champs ABSENTS sans `finance.lire`** (jamais masqués à zéro ni à `null`
  sauf mention contraire) : coûts, taux de vente, marges, rentabilité. Appliqué
  dans `missions/budget.ts`, `routes/budget.ts`, `routes/propositions.ts`,
  `routes/grades.ts`, `routes/collaborateurs.ts`, `routes/taux-clients.ts`,
  `routes/finance-analyses.ts`, `routes/indicateurs.ts`, `routes/bilans.ts`.
  Tests : `budget.test.ts`, `durcissement-missions.test.ts`,
  `finance-indicateurs.test.ts`, `collaborateurs.test.ts`. Exception
  documentée : sur le document de facture, les montants unitaires de régie sont
  rendus « — » sans `finance.lire` (`facturation/document.ts`).
- **Journal d'audit** : `journaliser(db, …)` dans la même transaction que
  l'action (`audit.ts`) ; `REVOKE UPDATE, DELETE ON journal_audit` pour le rôle
  applicatif (`0001`) ; test `isolation.test.ts`. Les actions 2FA et les
  changements de coordonnées bancaires y figurent (IBAN masqué par
  `masquerIban`).
- **Immuabilité par déclencheurs** (SQLSTATE dédiés, traduits par les routes) :

  | Code      | Objet figé                                                                  | Migration            |
  | --------- | --------------------------------------------------------------------------- | -------------------- |
  | `MPF01`   | budget initial et versions de budget, signature de mission                  | `0011`, `0013`, `0015` |
  | `MPF02`   | proposition figée                                                           | `0010`               |
  | `MPF03`   | absences (statut seul modifiable)                                           | `0020`, `0021`       |
  | `MPT01-04`| feuille soumise/validée, période de temps clôturée, correction décidée      | `0030`               |
  | `MPB01`   | facture soumise ou émise (corrigée par avoir), lignes, liens                | `0043`, `0044`       |
  | `MPB02`   | débours validé                                                              | `0041`               |
  | `MPB03`   | échéance facturée                                                           | `0042`               |
  | `MPB04`   | numérotation de factures                                                    | `0043`, `0044`       |
  | `MPE01-02`| encaissements et imputations en ajout seul, contre-passations               | `0060`               |
  | `MPE03`   | bilan de clôture (snapshot)                                                 | `0062`               |

  `relances_factures` est aussi en ajout seul (`0061`).
- **Numérotation sans trou** : `sequences_facturation` (clé cabinet, nature,
  exercice) n'accepte qu'un incrément de un (`MPB04`, `0043`), le numéro est
  attribué à l'émission sous verrou (`facturation/factures.ts`), `DELETE`
  révoqué.
- **Montants** : entiers en unités mineures (`bigint`) calculés par
  `packages/engines` (voir CODING_STANDARDS §3) ; le LLM n'en produit aucun
  (AGENTS.md).

## 7. Assainissement des entrées et des sorties

- **Validation** : schémas Zod `.strict()` partagés (`packages/shared/src/schemas/`),
  corps limité à 1 Mio (`app.ts` `bodyLimit`) ; paramètres `id` en UUID
  (`http/outils.ts`). Les erreurs Zod renvoient 400 `REQUETE_INVALIDE`.
- **SQL** : requêtes paramétrées (`$n`). Les rares interpolations dans un
  gabarit SQL sont des constantes de code ou des fragments construits depuis des
  listes fixes : `clauseSet` (noms de colonnes validés `^[a-z_]+$`, clés d'un
  schéma strict, `db/outils.ts`), `filtreVisibilite`, `FOR UPDATE`,
  listes `COLONNES_*`. Inventaire reproductible dans la checklist de relecture.
  `motifContient` échappe les jokers `ILIKE` (`http/outils.ts`).
- **HTML** : le document de facture échappe tout texte (`facturation/document.ts`
  `echapper`) et est servi avec `Content-Security-Policy: default-src 'none';
  style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';
  frame-ancestors 'none'`, `nosniff`, `private, no-store`
  (`routes/factures.ts`). Aucun `dangerouslySetInnerHTML` dans `apps/web/src`.
- **CSV** : l'export comptable neutralise les formules par un préfixe `'` et est
  servi en `attachment` avec `nosniff` et `private, no-store`
  (`finance/export.ts`, `routes/export-comptable.ts`) ; l'import de temps est en
  CSV seulement (le paquet `xlsx` a des vulnérabilités connues, voir
  `docs/workflows/HANDOFF.md`).
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
  secret ; les messages SMTP et de configuration ne citent pas la valeur
  (`config.ts`, `notifications/smtp.ts`). Le transport « journal » de
  développement n'affiche le contenu des e-mails qu'en développement
  (`notifications/mailer.ts`).

## 8. Fichiers privés

Aucun téléversement de fichier n'existe : les documents de mission et les
justificatifs de débours sont des métadonnées texte. La dette est décrite en
tête de `apps/api/src/routes/debours.ts` (voir §12). Règle à appliquer quand le
stockage arrivera : clé générée par le serveur et préfixée par le cabinet, service
par route authentifiée qui revérifie la visibilité, jamais en statique.

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
- **Côté web** : seule `API_URL` est lue (`next.config.mjs`,
  `lib/api-serveur.ts`), sans secret ; aucune variable `NEXT_PUBLIC_*`. Le
  navigateur n'atteint l'API que par `/api/*` relayé sur l'origine du web, de
  sorte que le cookie reste en même origine.

## 11. Réseau

- L'API écoute sur `127.0.0.1` (`server.ts`) ; le port PostgreSQL est publié sur
  `127.0.0.1:55440` seulement (`docker-compose.yml`).
- CORS : une seule origine, `WEB_ORIGIN`, avec credentials (`app.ts`).
- En-têtes du web : `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `X-Powered-By` retiré
  (`apps/web/next.config.mjs`).
- Limites de débit : uniquement sur les secrets d'authentification (§3). Pas de
  limite générale par IP : voir §12.

## 12. Données personnelles

Cadre visé (PRD) : loi ivoirienne n° 2013-450 (ARTCI), RGPD pour les clients
européens, registre des traitements. **Non implémenté** : pas de registre,
pas de durée de conservation, pas de procédure d'effacement (l'effacement d'un
utilisateur est d'ailleurs bloqué par le `REVOKE DELETE` du §4 ; les comptes
se désactivent). Données personnelles réellement collectées : nom, e-mail,
rôles, coûts journaliers des collaborateurs, temps saisis, contacts clients.
Rien n'est envoyé à un fournisseur IA aujourd'hui.

## 13. Conduite à tenir en cas de faille

1. Ne pas publier le détail de la faille dans un canal public (ticket, PR
   ouverte, message).
2. Prévenir le responsable du projet (l'utilisateur de la session ; à nommer
   avant tout pilote client).
3. Corriger sur une branche dédiée, avec un test qui reproduit la faille.
4. Évaluer l'exposition (journaux, données touchées) et la documenter.
5. En cas de fuite de `TFA_MASTER_KEY` : faire tourner la clé (ancienne valeur
   dans `TFA_MASTER_KEY_PRECEDENTE`) ; les chiffrés sont repris à leur première
   utilisation.

## 14. Dépendances

`pnpm audit --prod` est à lancer à chaque livraison et au moins une fois par
mois (action récurrente, non automatisée aujourd'hui). Résultat du 2026-10-06 :
4 vulnérabilités (2 hautes, 2 modérées), toutes dans `postcss` embarqué par
`next` (chemin `apps/web > next > postcss`, versions ≤ 8.5.22, corrigé en
≥ 8.5.23) ; à traiter par une mise à jour de Next.js. Ajouter une dépendance
exige de justifier le choix : le SMTP, le TOTP et le chiffrement sont écrits
sur `node:*` sans bibliothèque.

## 15. Risques acceptés et dette de sécurité connue

Chaque ligne cite sa source ; ne rien y ajouter sans fichier.

| Risque ou dette                                                                                                                                  | Source                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Justificatif de débours : simple chemin texte saisi par le client, non lu ni servi ; à remplacer par un téléversement géré par le serveur (F5)  | tête de `apps/api/src/routes/debours.ts`                                  |
| `GET /parametres-facturation` renvoie l'IBAN complet à tout détenteur de `facture.lire` ou `cabinet.gerer` (seuls journal et alertes le masquent) | `apps/api/src/routes/parametres-facturation.ts`                           |
| Limiteurs de tentatives en mémoire, par processus : réinitialisés au redémarrage, non partagés entre instances ; le blocage 2FA persistant en base atténue pour le second facteur seulement | `auth/limiteur.ts`, `auth/confirmer-identite.ts`                          |
| Routes sensibles protégées seulement par le crochet 2FA global et leur permission ; pas de reconfirmation par route hors la liste du §3         | `app.ts`, `auth/confirmer-identite.ts`                                    |
| Pas de jeton CSRF dédié : la défense repose sur `SameSite=Lax` et l'origine CORS unique                                                          | `auth/ouvrir-session.ts`, `app.ts`                                        |
| Pas d'en-têtes de sécurité sur les réponses JSON de l'API (ni HSTS, ni CSP du web, hors document de facture) ; l'API n'est pas censée être exposée directement | `apps/api/src/app.ts`, `apps/web/next.config.mjs`                         |
| Pas de limitation de débit générale par IP (X-Forwarded-For falsifiable, l'API voit l'IP du relais web)                                         | `auth/limiteur.ts` (en-tête)                                              |
| Date d'atteinte d'un jalon non horodatée : approchée par la dernière modification (indicateur de respect des jalons)                            | `apps/api/src/finance/indicateurs.ts`                                     |
| Migrations appliquées par nom, sans somme de contrôle : l'immuabilité d'une migration appliquée est une convention de relecture, non vérifiée par l'outil | `apps/api/src/db/migrate.ts`                                              |
| `GET /missions` et `GET /opportunites` : `LIMIT 500` sans curseur (troncature silencieuse au-delà)                                               | `routes/missions.ts`, `routes/opportunites.ts`                            |
| Dépendances : 4 vulnérabilités `postcss` via `next`                                                                                              | §14                                                                       |
| Registre des traitements, durée de conservation, effacement : non faits                                                                          | §12                                                                       |

## 16. Points ouverts

Décisions encore ouvertes dans le PRD (« Questions ouvertes ») : hébergement
(VPS ACC ou cloud avec région africaine) et obligations de facturation (facture
normalisée de la DGI ivoirienne).
