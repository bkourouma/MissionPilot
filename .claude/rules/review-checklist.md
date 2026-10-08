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
ont été relevés le 2026-10-08 (branche `feat/vague-2-automatisation`, arbre de travail avec les vagues 2 et 3 non commitées) en lançant les commandes
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
  `apps/api/test/budget.test.ts`). **Le champ retiré ne doit pas se déduire** : une
  vue sans droit financier ne laisse pas retrouver la marge par un score, une
  recommandation, un éliminatoire ou un agrégat ; ceux-ci se RECALCULENT sans le
  champ (modèle `appels-offres/go-no-go.ts`, `vueEvaluation`).
- **Automatisation** (ADR-006) : une action s'exécute sous l'identité et les droits
  ACTUELS du responsable (la personne qui a activé l'automatisation) et passe par
  `garderActionAutomatisation` (R2 et R3 jamais vers le client, N4 réservé à R0,
  coupe-circuits) ; toute modification de définition DÉSACTIVE l'automatisation
  (`automatisation/regles.ts`, `modifierAutomatisation`), sinon le texte d'un autre
  s'exécuterait sous les droits du responsable. Toute constante `TYPE_JOB_*`
  exportée figure au `REGISTRE_JOBS` (`jobs/registre.ts`), sauf exclusion motivée
  (`TYPE_JOB_EMAIL`) : test `apps/api/test/jobs-registre.test.ts`, qui échoue sinon.
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
  Le contrôle API et le déclencheur disent la même règle, avec le même test de refus.
  **Circuit de validation d'un contenu IA ou d'une offre** : valideur ≠ demandeur ≠
  auteur, sauf associé, doublé en base ; modèles : offre technique (valideur ni
  créateur, ni auteur d'une version, ni demandeur de la génération : `MPW05`, `0385`,
  `banque-ao/offres-techniques.ts`), clôture (qui a accordé une dérogation en vigueur
  ne clôt pas : `MPX03`, `0323`, `cloture/evaluation.ts`), salle de mission (qui a
  déposé n'accepte pas : `MPL09`, `0332`, `salle-mission/decisions.ts`). Une
  exception explicite se justifie par le PRD (le chef valide la version IA du retour
  d'expérience qu'il a demandée, `capitalisation/retours.ts`, `MPJ08`).
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
  recréer) ; au 2026-10-08, seules les 43 migrations des vagues 2 et 3 ne sont pas
  commitées (`0300`–`0302`, `0320`–`0323`, `0330`–`0332`, `0360`–`0363`,
  `0380`–`0386`, `0400`–`0404`, `0420`–`0424`, `0440`–`0445`, `0460`–`0465`) ;
  celles de la vague 0, de la vague 1 (corrections d'audit comprises) et de
  l'intégration le sont.
  Une fonction SQL déjà définie se redéfinit par `CREATE OR REPLACE` dans une
  nouvelle migration numérotée APRÈS celles qui créent les tables qu'elle cite
  (modèle : `0268`, `fichier_orphelin`) ; toute nouvelle colonne qui référence
  `fichiers` s'ajoute à cette fonction, sinon la purge à 24 h efface le fichier
  (`rg -n "REFERENCES fichiers" apps/api/migrations` : chaque colonne doit figurer
  dans `fichier_orphelin` ; l'inventaire AUTOMATIQUE de
  `fichiers-orphelins-references.test.ts` couvre toute colonne `REFERENCES fichiers`
  et échoue sinon ; dernière définition : `0384`).
  Une migration qui référence la table d'un autre domaine prend un numéro plus
  grand que celle qui la crée (`0206`, pas `0151`, pour une table liée à
  `mission_methodes` de `0202`) : `migrate.ts` applique les fichiers par ordre
  de nom. `migrate.ts` ne vérifie pas de somme de contrôle : c'est la
  relecture qui garantit la règle (recherche n° 13). Les migrations V2 corrigées
  pendant la session du 2026-10-06 sont commitées depuis `6d62428` : elles sont
  désormais immuables. Plages réservées pour la suite : CODING_STANDARDS §1.
- **Dates métier** : une date bornée par un `CHECK` SQL utilise `dateIsoBorneeSchema`
  (`packages/shared/src/schemas/commun.ts`, 2000 à 2100) ; le SQLSTATE 23514 qui
  échappe au schéma se traduit en 400, jamais en 500 (couches d'erreurs des domaines,
  par ex. `salle-mission/erreurs.ts`, `plans/erreurs.ts`).
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
sur l'arbre de travail de `feat/vague-2-automatisation` (vague 1 commitée, vagues 2 et 3
non commitées). Toutes les recherches ont été relancées le même jour ; les écarts
avec l'ancien relevé (vague 1) sont expliqués ligne par ligne ci-dessous.

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

# 8. Arrondis dans l'API (hors moteur). Attendu : 9 lignes (7 avant les vagues 2 et 3),
#    toutes justifiées : auth/totp.ts (pas de temps), db/seed-demo.ts x2 (seed),
#    jobs/worker.ts (délai en secondes), stockage/fichiers.ts, routes/fichiers.ts,
#    routes/salle-mission.ts:109 et salle-mission/depots.ts:153 (taille en Mo dans un
#    message : les deux dernières sont NOUVELLES), routes/missions.ts:234 (inverse de la
#    parité EUR/FCFA, arrondi à numeric(20,10), dette) ; toute autre ligne est un
#    calcul de montant à déplacer
rg -n "Math\.(round|floor|ceil|trunc)|toFixed\(" apps/api/src

# 9. console.* hors seed et migrate. Attendu : 1 ligne (mailer.ts, transport
#    « journal » de développement)
rg -n "console\.(log|info|debug|warn|error)" apps/api/src --glob '!**/seed*' --glob '!**/migrate.ts'

# 10. Route sans exiger (par gestionnaire ; exigerPortail compte). Attendu
#     (2026-10-08, vagues 2 et 3 comprises) : "668 8" (477 avant ; 8 sans exiger, inchangé) puis 8 lignes (auth.ts connexion, connexion/2fa,
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

# 12. Schémas Zod non stricts. Attendu : 0 sur 547 z.object de
#     packages/shared/src/schemas (hors *.test.ts ; chaque z.object a .strict()
#     dans sa chaîne d'appels, y compris `z.object(...).partial().strict()`).
#     L'ancien « 373 » était un relevé périmé ; `rg -o "z\s*\.object\("` sans -U ne
#     voit que 109 appels écrits sur une seule ligne : ne PAS s'y fier. Script
#     ponctuel, pas rg : apparier les parenthèses en sautant chaînes, gabarits ET
#     commentaires (une apostrophe dans un commentaire français fausse un
#     appariement naïf), puis, après la parenthèse fermante, parcourir les appels
#     chaînés `.methode(...)` jusqu'à trouver `strict`. Compte de contrôle :
#     rg -U -c "z\s*\.object\(" packages/shared/src/schemas --glob '!*.test.ts'
#     (somme 547).

# 13. Migration existante modifiée ou supprimée dans l'historique git. Attendu : 0 ligne
git log --diff-filter=MD --name-only --format= -- apps/api/migrations | sort -u
# Dans une branche : git diff --name-status main -- apps/api/migrations
# ne doit montrer que des lignes « A » (ajouts) ; dossier : 148 fichiers au
# 2026-10-08 (`ls apps/api/migrations | wc -l`; 105 avant les vagues 2 et 3), dont 43
# non commitées, toutes des vagues 2 et 3 (`git status --short apps/api/migrations |
# wc -l` : 43, aucune ligne autre que « ?? » : ni modifiée ni supprimée) ; `origin/main`
# compte 105 migrations (vague 1 comprise, corrections d'audit commitées) : aucune
# modification ni suppression, 43 « A » à venir. La branche locale `main` est en
# retard : comparer à `origin/main`.

# 14. Textes d'interface en anglais (échantillon). Attendu : 0
rg -n ">\s*(Submit|Cancel|Save|Delete|Loading|Error|Login|Sign in|Logout|Search)\s*<" apps/web/src

# 15. Dépendances vulnérables (réseau requis). Attendu : « No known
#     vulnerabilities found » en production ; l'audit complet (pnpm audit)
#     relève 15 constats, tous via vitest (développement, SECURITY.md §14)
pnpm audit --prod

# 16. Fonctions SECURITY DEFINER accordées au rôle applicatif : relire chaque
#     migration qui en ajoute (search_path, REVOKE FROM PUBLIC) et comparer à
#     SECURITY.md §4. Attendu : 20 lignes (17 avant les vagues 2 et 3). Trois
#     nouvelles, toutes avec search_path figé et REVOKE ALL FROM PUBLIC :
#     `planifier_detection_automatisation` (`0302`, planification récurrente),
#     `octets_stockage_utilises` (`0331`, quota borné au cabinet du contexte),
#     `anonymiser_cv_ao` (`0386`, bornée au cabinet). Les fonctions `est_*` de
#     `0243` et `0267` sont d'appelant, sous la RLS du cabinet
rg -n "GRANT EXECUTE" apps/api/migrations

# 17. Écritures rejouables : tout en-tête Idempotency-Key passe par
#     temps/idempotence.ts. Attendu : 2 lignes (import et usage dans feuilles-temps.ts)
rg -n "ENTETE_IDEMPOTENCE|idempotency-key" apps/api/src --glob '!**/idempotence.ts'

# 18. Réception de fichiers : toute route multipart passe par avecPlaceAnalyse.
#     Attendu : 5 lignes (3 avant les vagues 2 et 3 : POST /fichiers, justificatif
#     de débours, classeur d'états financiers du dossier client ; nouvelles :
#     dépôt de la salle de mission par le cabinet, routes/salle-mission.ts:316, et par
#     le portail, :444). L'import Excel des temps (routes/import-temps.ts) n'y passe pas :
#     `lireClasseurTemps` a son propre sémaphore (temps/import-excel.ts)
rg -n "avecPlaceAnalyse\(" apps/api/src
```
