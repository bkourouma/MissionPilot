---
paths:
  - "apps/**/*.ts"
  - "apps/**/*.tsx"
  - "apps/**/*.sql"
  - "apps/**/*.mjs"
  - "packages/**/*.ts"
---

# Contrôles de relecture propres à MissionPilot

Complète le tronc commun de `.claude/agents/code-reviewer.md` et
`.claude/agents/security-auditor.md`. AGENTS.md prime en cas de désaccord.
Chaque contrôle cite le fichier de référence qui montre la bonne pratique et,
si possible, une recherche mécanique qui repère l'écart. Les nombres attendus
ont été relevés le 2026-10-08 (branche `feat/vague-1-fondations`, arbre de travail avec les corrections d'audit de la vague 1) en lançant les commandes
ci-dessous ; un autre résultat est un écart à expliquer, pas à ignorer. Détail
des mécanismes : `docs/governance/SECURITY.md` et
`docs/governance/CODING_STANDARDS.md`.

## Sécurité et cloisonnement des données

- **Toute table portant `cabinet_id` a RLS et une politique `isolation`**
  (`USING` et `WITH CHECK`), avec FK composites `(cabinet_id, id)` vers les
  tables du même cabinet. Modèle : `apps/api/migrations/0043_factures.sql`.
  Garde : test d'inventaire `apps/api/test/isolation.test.ts` (« toute table
  portant cabinet_id… »), à ne pas contourner par une liste d'exceptions.
- **Toute nouvelle table à RLS reçoit une politique RESTRICTIVE du portail** :
  `portail_interdit` (rien de visible ni de modifiable dans une transaction du
  portail) par défaut ; `portail` en `FOR SELECT` filtré sur le client, doublé
  de `portail_sans_insert`, `portail_sans_update`, `portail_sans_delete`, si le
  portail doit la lire ; `portail` `FOR ALL` seulement pour une table où le
  portail écrit. Jamais une politique `portail%` permissive. Modèles : `0113`,
  `0114`, `0160` (`kpi_mesures`), `0122` (`saisies_idempotence`). Garde : `isolation.test.ts` (« toute table à
  RLS porte une politique RESTRICTIVE portail ou portail_interdit », « aucune
  politique du portail n'est permissive »), sans exception.
- **Toute route qu'un utilisateur du portail doit atteindre s'ajoute
  explicitement à `LISTE_BLANCHE_PORTAIL`** (`apps/api/src/portail/garde.ts`) :
  méthode et motif Fastify EXACT, jamais un préfixe ; une route ajoutée sous
  `/api/portail` reste fermée (403 `PORTAIL_ROUTE_INTERDITE`) tant qu'elle n'y
  figure pas. `sansContexte` est réservé à la propre session, à la propre 2FA
  et aux jetons d'invitation. La route appelle `exigerPortail` et lit par
  `avecPortail` (`portail/acces.ts`), répond le même 404 pour inexistant,
  d'autrui ou non partagé, et ne projette rien d'interne. Garde :
  `test/portail-acces.test.ts` (inventaire des routes enregistrées).
- **`horsContextePortail`** (`portail/contexte.ts`) : unique sortie du contexte
  RLS du portail, réservée à un traitement interne qui ne renvoie rien au
  client ; tout nouvel usage met à jour `test/portail-contexte.test.ts`.
- **Aucun accès à la base hors `withTenant` / `withoutTenant`**
  (`apps/api/src/db/pool.ts`). `withoutTenant` n'appelle que des fonctions
  `SECURITY DEFINER` étroites (`trouver_connexion`, `resoudre_session`…).
- **Toute nouvelle fonction `SECURITY DEFINER`** : `SET search_path = public,
  pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` au rôle applicatif
  seul (modèles `0001_socle.sql`, `0120_limiteur_tentatives.sql`), paramètres
  validés, et rien de plus que ce que l'appelant connaît déjà (modèle
  `notification_existe`, `0114`).
- **Un identifiant reçu se vérifie avant lecture ou écriture** : mission par
  `exigerMissionVisible` / `exigerMissionModifiable`
  (`apps/api/src/missions/acces.ts`), le reste par une requête qui filtre sur
  le cabinet (RLS) et la visibilité ; une ressource d'autrui répond 404, comme
  une ressource inexistante.
- **Chaque route appelle `exiger(request, permission)`**
  (`apps/api/src/auth/contexte.ts`, ou `exigerPortail` qui l'appelle), avec la
  permission la plus étroite de `packages/shared/src/roles.ts`. Liste blanche
  sans `exiger` : `POST /auth/connexion`, `/auth/connexion/2fa`,
  `/auth/deconnexion`, `GET /sante`, `POST /invitations/accepter`,
  `POST /portail/invitations/accepter`, et `GET /auth/comptes-demo`,
  `POST /auth/connexion-demo` (`routes/connexion-demo.ts`, enregistrées
  seulement si `connexionRapideDemoActive` de `config.ts`). Toute nouvelle route
  publique est à justifier ; un nouveau motif sans 2FA se déclare dans
  `routeLibreSans2fa` (`app.ts`). Aucune autre ouverture de session sans secret :
  elle passerait par la même garde de configuration et refuserait tout compte à
  2FA active ou obligatoire (`test/connexion-demo.test.ts`).
- **Données FIN-02** (coûts, taux, marges, rentabilité, coût IA) : champs
  ABSENTS de la réponse sans `finance.lire`, jamais masqués par un zéro ; un
  test « sans droit » accompagne chaque nouvelle réponse financière (modèle
  `apps/api/test/budget.test.ts`).
- **Séparation des tâches** : une validation ne revient pas à l'auteur (sauf
  associé) ; modèle `apps/api/src/finance/encaissements.ts`. Règles plus
  strictes doublées en base : publication d'une notation par un
  `expert_metier` qui n'est ni auteur du calcul, ni d'un ajustement, ni de la
  soumission (`MPN04`, `0146`) ; plan : auteur ≠ valideur sauf associé ou
  directeur de la mission (`MPS03`, `0180`). Trois contrôles de la vague 1, à
  retrouver dans tout nouveau circuit de validation : **arbitrage** d'une
  contradiction (« levée » refusée à l'auteur de l'assertion ou de la preuve
  contraire sauf associé : `MPV07`, `preuves/ecriture.ts`) ; **attestation** d'un
  item de la définition de terminé (refusée à l'auteur du livrable : `MPY10`,
  `qualite/verification.ts`) ; **publication d'une variante** du référentiel (refusée
  au créateur de la version sauf associé : `MPM08`, `standard/methodes.ts`), comme la
  publication d'une proposition au standard (`standard/propositions.ts`). Le
  contrôle API et le déclencheur disent la même règle, avec le même test de refus.
- **Contenu IA** : passe par l'orchestrateur (`ia/orchestrateur.ts`) ; la
  liste blanche de chiffres est construite par le code depuis les moteurs,
  jamais reçue d'une requête ; seul un contenu validé (et jamais un essai sur
  prompt « exemple ») est livrable au client (`ia/generations.ts`) ; la clé
  API n'est ni renvoyée ni journalisée (`ia/parametres.ts`).
- **Fonction de purge ou d'anonymisation** (`purger_textes_ia`,
  `planifier_conservation_ia`, `planifier_purge_rapports`) : `SECURITY DEFINER`,
  bornée au cabinet du contexte (`app_cabinet_id()`), paramètres validés, clé de
  job au format imposé, `GRANT EXECUTE` au rôle applicatif seul ; le déclencheur
  d'ajout seul n'admet que l'anonymisation prévue, jamais un `UPDATE` libre
  (modèle `0104_ia_conservation.sql`). Toute durée de conservation par défaut
  est notée « à valider » (DECISIONS.md).
- **Un livrable produit ouvre son suivi qualité** (vague 1) : rapport généré
  (R2) et notation soumise ou publiée (R3) passent par
  `qualite/branchements.ts` (`assurerSuiviLivrable`, `ajouterElementsRevue`) dans
  la transaction du module ; une notation d'une mission liée à une méthode ne se
  publie qu'avec son suivi SIGNÉ (`SUIVI_QUALITE_NON_SIGNE`) en plus de `MPN04`.
  Un calcul qui lit le référentiel appelle les MÊMES moteurs que le chemin direct
  et trace tout ajustement (modèle `notation/via-methode.ts`, test de
  non-régression `notation-methode.test.ts`).
- **Un rapport n'est pas un document de mission** : il s'enregistre dans
  `rapports_mission` avec son niveau calculé (`rapports/niveaux.ts`,
  `rapports/enregistrement.ts`), jamais dans `mission_documents` ; sa lecture
  revérifie mission visible et permissions du niveau à chaque appel. Un nouveau
  modèle de rapport (notation, plan : `0131`) ajoute son niveau au `CHECK`, sa
  source au déclencheur `controler_source_rapport` (`MPR01-02`), ne reproduit
  que du contenu validé ou publié, et applique la mention IA et la conservation
  du cabinet (`rapports/parametres.ts`, `rapports/purge.ts`). Un rendu PDF
  (rapport ou facture) passe par `rapports/pdf.ts` ; une route qui l'appelle a
  un plafond de débit par utilisateur (modèle : `routes/factures-pdf.ts`, 429).
- **Écriture rejouable** (file hors ligne, nouvelle tentative réseau) :
  `Idempotency-Key` enregistrée dans la transaction de l'écriture, empreinte du
  contenu, rejeu sans effet et 409 si la clé est réutilisée à tort (modèle
  `temps/idempotence.ts`, `0122`) ; un rejeu ne doit jamais écraser une écriture
  plus récente.
- **Historique immuable** : une table historique reçoit un déclencheur à
  SQLSTATE `MP…` (lettre du domaine, numéro libre : CODING_STANDARDS §2) et un
  `REVOKE` (modèles `0043`, `0060`, `0146`) ; on corrige par nouvel
  enregistrement (avoir, contre-passation, révision, nouvelle version), jamais
  par `UPDATE` ; chaque action sensible appelle `journaliser` dans la même
  transaction (`apps/api/src/audit.ts`).
- **Migrations** : une migration **commitée** ne se modifie pas, on ajoute un
  fichier dans la bonne plage (CODING_STANDARDS §1) ; une migration encore
  **non commitée** peut être corrigée sur place (bases qui l'ont appliquée à
  recréer) ; au 2026-10-08, seules les dix migrations des corrections d'audit de la
  vague 1 ne sont pas commitées (`0207`–`0209`, `0224`, `0243`, `0265`–`0268`, `0286`) ;
  celles de la vague 0, des lots de la vague 1 et de l'intégration (`0206`) le sont.
  Une fonction SQL déjà définie se redéfinit par `CREATE OR REPLACE` dans une
  nouvelle migration numérotée APRÈS celles qui créent les tables qu'elle cite
  (modèle : `0268`, `fichier_orphelin`) ; toute nouvelle colonne qui référence
  `fichiers` s'ajoute à cette fonction, sinon la purge à 24 h efface le fichier
  (`rg -n "REFERENCES fichiers" apps/api/migrations` : chaque colonne doit figurer
  dans `fichier_orphelin`, test `fichiers-orphelins-references.test.ts`).
  Une migration qui référence la table d'un autre domaine prend un numéro plus
  grand que celle qui la crée (`0206`, pas `0151`, pour une table liée à
  `mission_methodes` de `0202`) : `migrate.ts` applique les fichiers par ordre
  de nom. `migrate.ts` ne vérifie pas de somme de contrôle : c'est la
  relecture qui garantit la règle (recherche n° 13). Les migrations V2 corrigées
  pendant la session du 2026-10-06 sont commitées depuis `6d62428` : elles sont
  désormais immuables. Plages réservées pour la suite : CODING_STANDARDS §1.
- **Entrées** : schéma Zod `.strict()` partagé, requêtes paramétrées ; une
  interpolation dans un gabarit SQL n'est admise que pour une constante, un
  fragment construit (`clauseSet`, `filtreVisibilite`), un choix entre
  constantes selon un enum validé, ou `FOR UPDATE`.
- **Fichiers reçus** : type par le contenu (`stockage/detection.ts`), garde de
  taille annoncée avant l'authentification (`gardeTailleMultipart`,
  `routes/fichiers.ts`), une seule partie multipart, place prise dans le sémaphore de réception
  (`avecPlaceAnalyse`, 503 `FICHIERS_OCCUPE`) ; un format complexe
  (classeur, archive) passe par un lecteur borné avant toute bibliothèque
  (modèle `temps/import-excel.ts`).
- **Secrets** : jamais dans un journal, une erreur, une réponse ou un message
  de test ; les réponses qui portent un secret sont `no-store`
  (`apps/api/src/routes/auth.ts` `sansCache`).
- **Action à fort impact** (IBAN, 2FA, politique, clé et plafond IA, déblocage
  de connexion) : reconfirmation par `serviceIdentite(app).confirmerIdentite`
  (`auth/confirmer-identite.ts`).

## Erreurs

- Les routes lèvent `AppError` via `nonAuthentifie`, `interdit`, `introuvable`,
  `requeteInvalide`, `conflit` (`apps/api/src/errors.ts`) ; l'enveloppe
  `{ erreur: { code, message } }` est produite par le seul gestionnaire de
  `apps/api/src/app.ts`, qui transmet aussi `details` d'une `AppError` en
  liste blanche (`CHAMPS_DETAILS_PUBLICS` d'`errors.ts` : `violations`,
  `erreurs`, `manquants`). Pas de réponse d'erreur ad hoc (un plugin traduit
  puis relance, modèle `routes/qualite.ts`), pas de `throw new Error` dans une
  route (message en français, sans donnée sensible).
- Les violations d'unicité et de référence se traduisent par
  `traduireErreursPg` (`apps/api/src/db/outils.ts`) ; les SQLSTATE `MP…`
  par la couche métier concernée, jamais en 500.

## Configuration

- Les variables d'environnement se lisent dans `apps/api/src/config.ts`
  (`loadConfig`) ; seules exceptions : `API_URL` dans
  `apps/web/src/lib/api-serveur.ts` et `apps/web/next.config.mjs`, et les gardes
  des seeds (`db/seed.ts`, `db/seed-demo.ts`). Pas de valeur par défaut pour un
  secret hors de l'objet `DEV` de `config.ts`. Toute variable ajoutée entre dans
  `.env.example` (sans valeur sensible), dans `config.ts` et dans le tableau du
  RUNBOOK.
- Aucune variable `NEXT_PUBLIC_*` : rien de secret côté navigateur.

## Interface et textes affichés

- Tout texte affiché, message d'erreur et libellé est en français
  (PRD, « Localisation ») ; les identifiants de code restent ceux de
  CODING_STANDARDS §2.
- Le navigateur n'appelle l'API que par `/api/*` via `apps/web/src/lib/api.ts`
  (cookie httpOnly, jamais de jeton en JavaScript). Pas de `localStorage` ni
  d'IndexedDB pour un secret ou un jeton ; usages admis : brouillon et file hors
  ligne des saisies de temps (`components/temps/useSauvegardeFeuille.ts`,
  `lib/file-sauvegarde.ts`, `lib/hors-ligne/magasins.ts`,
  `lib/hors-ligne/file-temps.ts`, reprise dans `app/(app)/temps/GrilleTemps.tsx`).
  Le service worker (`public/sw.js`) vide la file hors ligne à la déconnexion et
  ne met jamais en cache `/api/*` ni une page authentifiée.
- Les droits côté web (`exigerPermission`, `lib/navigation.ts`) sont un confort
  d'affichage ; la source de vérité reste l'API.
- Pas de `dangerouslySetInnerHTML`.

## Tests obligatoires

- Une route ajoutée : test d'API sur vrai PostgreSQL (`apps/api/test/*.test.ts`)
  qui couvre 401, 403, le cas nominal et l'accès d'un autre cabinet ; une route
  du portail couvre en plus l'autre client et le non-partagé (même 404).
- Une table ajoutée : elle est couverte par les inventaires de
  `isolation.test.ts` (RLS et politique du portail) ; un historique immuable
  ajoute un test de refus (modèles `factures.test.ts`,
  `finance-encaissements.test.ts`).
- Une règle de calcul : test dans `packages/engines` (couverture ≥ 90 %
  imposée par `packages/engines/vitest.config.ts`).
- Une permission ajoutée : `packages/shared/src/roles.test.ts`.
- Une variable de configuration : `apps/api/test/config.test.ts`.
- Un écran : test de la logique dans `apps/web/src/lib/*.test.ts`.

## Recherches mécaniques

À lancer depuis la racine (ripgrep 15). « Attendu » = résultat du 2026-10-08
sur l'arbre de travail de `feat/vague-1-fondations` (lots de la vague 1 commités,
intégration transversale non commitée). Les recherches 1 à 9, 14 et 17 ont été relancées le même jour avant les
corrections d'audit : résultats inchangés ; les recherches 10, 12, 13 et 16 l'ont été
après.

```bash
# 1. Pas de client PostgreSQL hors pool.ts et migrate.ts. Attendu : 2 lignes
rg -n "new (pg\.)?(Pool|Client)\(" apps/api/src

# 2. Pas d'appel direct au pool hors db/pool.ts. Attendu : 1 ligne (pool.connect)
rg -n "\bpool\.(query|connect)" apps/api/src

# 3. Lectures de process.env hors tests. Attendu : 5 lignes
#    (config.ts, seed.ts x2, seed-demo.ts, web/lib/api-serveur.ts)
rg -n "process\.env" apps/api/src apps/web/src --glob '!*.test.*'

# 4. dangerouslySetInnerHTML / innerHTML dans le web. Attendu : 0
rg -n "dangerouslySetInnerHTML|innerHTML" apps/web/src

# 5. Variables exposées au navigateur. Attendu : 0
rg -n "NEXT_PUBLIC_" apps

# 6. Agrégats SQL (les calculs vont dans packages/engines). Attendu : 0
rg -n "SUM\(|AVG\(" apps/api/src --glob '!db/seed*'

# 7. LIMIT littéral > 1 (toute liste est paginée par curseur, LIMIT $n).
#    Attendu : 1 ligne, le LIMIT 2 de db/seed-planification.ts (seed). Ne voit
#    pas un plafond passé en paramètre : MAX_LISTE (500) de
#    routes/portail-gestion.ts est une dette connue (CODING_STANDARDS §10).
rg -n "\bLIMIT [0-9]+" apps/api/src | grep -v "LIMIT 1\b"

# 8. Arrondis dans l'API (hors moteur). Attendu : 7 lignes, toutes justifiées :
#    auth/totp.ts (pas de temps), db/seed-demo.ts x2 (seed), jobs/worker.ts
#    (délai en secondes), stockage/fichiers.ts et routes/fichiers.ts (taille en
#    Mo dans un message), routes/missions.ts:230 (inverse de la parité EUR/FCFA,
#    arrondi à numeric(20,10), dette) ; toute autre ligne est un calcul de
#    montant à déplacer
rg -n "Math\.(round|floor|ceil|trunc)|toFixed\(" apps/api/src

# 9. console.* hors seed et migrate. Attendu : 1 ligne (mailer.ts, transport
#    « journal » de développement)
rg -n "console\.(log|info|debug|warn|error)" apps/api/src --glob '!**/seed*' --glob '!**/migrate.ts'

# 10. Route sans exiger (par gestionnaire ; exigerPortail compte). Attendu
#     (2026-10-08, après les corrections d'audit) : "477 8" puis 8 lignes (auth.ts connexion, connexion/2fa,
#     deconnexion ; connexion-demo.ts comptes-demo, connexion-demo ; sante.ts ;
#     utilisateurs.ts et portail-gestion.ts invitations/accepter)
node -e '
const fs=require("fs");let n=0;const s=[];
for(const f of fs.readdirSync("apps/api/src/routes")){const t=fs.readFileSync("apps/api/src/routes/"+f,"utf8");
const re=/app\.(get|post|put|patch|delete)\(\s*(["`][^"`]*["`])/g;let m;const p=[];
while((m=re.exec(t)))p.push([m.index,m[1],m[2]]);
p.forEach((x,i)=>{n++;if(!/exiger/.test(t.slice(x[0],i+1<p.length?p[i+1][0]:t.length)))s.push(f+" "+x[1]+" "+x[2]);});}
console.log(n,s.length);console.log(s.join("\n"));'

# 11. Interpolations dans les gabarits SQL : relire chaque expression qui n'est
#     pas une constante, un fragment (set.sql, filtreVisibilite(...),
#     visibilite(...), filtreContributeur(...)), un choix entre constantes selon
#     un enum validé ou un FOR UPDATE. Relevé du 2026-10-06 (script ponctuel :
#     pour chaque « .query( » suivi d'un gabarit, extraire les ${…} en suivant
#     l'imbrication ; fichiers *.test.ts exclus) : 577 gabarits dans
#     apps/api/src (534 hors db/seed*), 299 interpolations, 105 expressions
#     distinctes, aucune valeur issue d'une requête HTTP. Pas de commande rg
#     fiable (les gabarits s'étendent sur plusieurs lignes).

# 12. Schémas Zod non stricts. Attendu : 0 sur 373 z.object de
#     packages/shared/src/schemas (hors *.test.ts ; chaque z.object est suivi
#     de .strict() dans sa chaîne). Script ponctuel, pas rg : apparier les
#     parenthèses en sautant chaînes ET commentaires (une apostrophe dans un
#     commentaire français fausse un appariement naïf). Compte de contrôle :
#     rg -U -c "z\s*\.object\(" packages/shared/src/schemas --glob '!*.test.ts'
#     (somme 373).

# 13. Migration existante modifiée ou supprimée dans l'historique git. Attendu : 0 ligne
git log --diff-filter=MD --name-only --format= -- apps/api/migrations | sort -u
# Dans une branche : git diff --name-status main -- apps/api/migrations
# ne doit montrer que des lignes « A » (ajouts) ; dossier : 105 fichiers au
# 2026-10-08 (`ls apps/api/migrations | wc -l`), dont 10 non commitées (corrections
# d'audit : `0207`–`0209`, `0224`, `0243`, `0265`–`0268`, `0286`) ; contre
# `origin/main` (60 migrations) : 35 « A » suivis (vague 0, lots de la vague 1 et
# `0206`), 45 une fois les dix autres commitées. La branche locale `main` est en
# retard : comparer à `origin/main`.

# 14. Textes d'interface en anglais (échantillon). Attendu : 0
rg -n ">\s*(Submit|Cancel|Save|Delete|Loading|Error|Login|Sign in|Logout|Search)\s*<" apps/web/src

# 15. Dépendances vulnérables (réseau requis). Attendu : « No known
#     vulnerabilities found » en production ; l'audit complet (pnpm audit)
#     relève 15 constats, tous via vitest (développement, SECURITY.md §14)
pnpm audit --prod

# 16. Fonctions SECURITY DEFINER accordées au rôle applicatif : relire chaque
#     migration qui en ajoute (search_path, REVOKE FROM PUBLIC) et comparer à
#     SECURITY.md §4. Attendu : 17 lignes (inchangé par les corrections d'audit :
#     aucune nouvelle fonction SECURITY DEFINER ; les fonctions `est_*` de `0243`
#     et `0267` sont d'appelant, sous la RLS du cabinet)
rg -n "GRANT EXECUTE" apps/api/migrations

# 17. Écritures rejouables : tout en-tête Idempotency-Key passe par
#     temps/idempotence.ts. Attendu : 2 lignes (import et usage dans feuilles-temps.ts)
rg -n "ENTETE_IDEMPOTENCE|idempotency-key" apps/api/src --glob '!**/idempotence.ts'

# 18. Réception de fichiers : toute route multipart passe par avecPlaceAnalyse.
#     Attendu : 3 lignes (POST /fichiers, justificatif de débours, classeur
#     d'états financiers du dossier client)
rg -n "avecPlaceAnalyse\(" apps/api/src
```
