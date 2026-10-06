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
ont été relevés le 2026-10-06 (commit `cdaf666`) ; un autre résultat est un
écart à expliquer, pas à ignorer. Détail des mécanismes :
`docs/governance/SECURITY.md` et `docs/governance/CODING_STANDARDS.md`.

## Sécurité et cloisonnement des données

- **Toute table portant `cabinet_id` a RLS et une politique `isolation`**
  (`USING` et `WITH CHECK`), avec FK composites `(cabinet_id, id)` vers les
  tables du même cabinet. Modèle : `apps/api/migrations/0043_factures.sql`.
  Garde : test d'inventaire `apps/api/test/isolation.test.ts` (« toute table
  portant cabinet_id… »), à ne pas contourner par une liste d'exceptions.
- **Aucun accès à la base hors `withTenant` / `withoutTenant`**
  (`apps/api/src/db/pool.ts`). `withoutTenant` n'appelle que des fonctions
  `SECURITY DEFINER` étroites (`trouver_connexion`, `resoudre_session`…).
- **Toute nouvelle fonction `SECURITY DEFINER`** : `SET search_path = public,
  pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` au rôle applicatif
  seul (modèle `0001_socle.sql`).
- **Un identifiant reçu se vérifie avant lecture ou écriture** : mission par
  `exigerMissionVisible` / `exigerMissionModifiable`
  (`apps/api/src/missions/acces.ts`), le reste par une requête qui filtre sur
  le cabinet (RLS) et la visibilité ; une ressource d'autrui répond 404, comme
  une ressource inexistante.
- **Chaque route appelle `exiger(request, permission)`**
  (`apps/api/src/auth/contexte.ts`), avec la permission la plus étroite de
  `packages/shared/src/roles.ts`. Liste blanche sans `exiger` : `POST
  /auth/connexion`, `/auth/connexion/2fa`, `/auth/deconnexion`, `GET /sante`,
  `POST /invitations/accepter`. Toute nouvelle route publique est à justifier ;
  un nouveau préfixe sans 2FA se déclare dans `routeLibreSans2fa` (`app.ts`).
- **Données FIN-02** (coûts, taux, marges, rentabilité) : champs ABSENTS de la
  réponse sans `finance.lire`, jamais masqués par un zéro ; un test « sans
  droit » accompagne chaque nouvelle réponse financière (modèle
  `apps/api/test/budget.test.ts`).
- **Séparation des tâches** : une validation ne revient pas à l'auteur (sauf
  associé) ; modèle `apps/api/src/finance/encaissements.ts`.
- **Historique immuable** : une table historique reçoit un déclencheur à
  SQLSTATE `MP…` et un `REVOKE` (modèles `0043`, `0060`) ; on corrige par
  nouvel enregistrement (avoir, contre-passation, révision), jamais par
  `UPDATE` ; chaque action sensible appelle `journaliser` dans la même
  transaction (`apps/api/src/audit.ts`).
- **Migration immuable** : une migration appliquée ne se modifie pas, on ajoute
  un fichier dans la bonne plage (voir CODING_STANDARDS §1). `migrate.ts` ne
  vérifie pas de somme de contrôle : c'est la relecture qui garantit la règle.
- **Entrées** : schéma Zod `.strict()` partagé, requêtes paramétrées ; une
  interpolation dans un gabarit SQL n'est admise que pour une constante, un
  fragment construit (`clauseSet`, `filtreVisibilite`) ou `FOR UPDATE`.
- **Secrets** : jamais dans un journal, une erreur, une réponse ou un message
  de test ; les réponses qui portent un secret sont `no-store`
  (`apps/api/src/routes/auth.ts` `sansCache`).
- **Action à fort impact** (IBAN, 2FA, politique) : reconfirmation par
  `serviceIdentite(app).confirmerIdentite` (`auth/confirmer-identite.ts`).

## Erreurs

- Les routes lèvent `AppError` via `nonAuthentifie`, `interdit`, `introuvable`,
  `requeteInvalide`, `conflit` (`apps/api/src/errors.ts`) ; l'enveloppe
  `{ erreur: { code, message } }` est produite par le seul gestionnaire de
  `apps/api/src/app.ts`. Pas de réponse d'erreur ad hoc, pas de
  `throw new Error` dans une route (message en français, sans donnée
  sensible).
- Les violations d'unicité et de référence se traduisent par
  `traduireErreursPg` (`apps/api/src/db/outils.ts`) ; les SQLSTATE `MP…`
  par la couche métier concernée, jamais en 500.

## Configuration

- Les variables d'environnement se lisent dans `apps/api/src/config.ts`
  (`loadConfig`) ; seules exceptions : `API_URL` dans
  `apps/web/src/lib/api-serveur.ts` et `apps/web/next.config.mjs`, et le garde du
  seed. Pas de valeur par défaut pour un secret hors de l'objet `DEV` de
  `config.ts`. Toute variable ajoutée entre dans `.env.example` (sans valeur
  sensible), dans `config.ts` et dans le tableau du RUNBOOK.
- Aucune variable `NEXT_PUBLIC_*` : rien de secret côté navigateur.

## Interface et textes affichés

- Tout texte affiché, message d'erreur et libellé est en français
  (PRD, « Localisation ») ; les identifiants de code restent ceux de
  CODING_STANDARDS §2.
- Le navigateur n'appelle l'API que par `/api/*` via `apps/web/src/lib/api.ts`
  (cookie httpOnly, jamais de jeton en JavaScript) ; pas de `localStorage` pour
  un secret ni un jeton (seul usage : brouillon de feuille de temps,
  `components/temps/useSauvegardeFeuille.ts`).
- Les droits côté web (`exigerPermission`, `lib/navigation.ts`) sont un confort
  d'affichage ; la source de vérité reste l'API.
- Pas de `dangerouslySetInnerHTML`.

## Tests obligatoires

- Une route ajoutée : test d'API sur vrai PostgreSQL (`apps/api/test/*.test.ts`)
  qui couvre 401, 403, le cas nominal et l'accès d'un autre cabinet.
- Une table ajoutée : elle est couverte par l'inventaire de
  `isolation.test.ts` ; un historique immuable ajoute un test de refus
  (modèles `factures.test.ts`, `finance-encaissements.test.ts`).
- Une règle de calcul : test dans `packages/engines` (couverture ≥ 90 %
  imposée par `packages/engines/vitest.config.ts`).
- Une permission ajoutée : `packages/shared/src/roles.test.ts`.
- Une variable de configuration : `apps/api/test/config.test.ts`.
- Un écran : test de la logique dans `apps/web/src/lib/*.test.ts`.

## Recherches mécaniques

À lancer depuis la racine (ripgrep). « Attendu » = résultat du 2026-10-06.

```bash
# 1. Pas de client PostgreSQL hors pool.ts et migrate.ts. Attendu : 2 lignes
rg -n "new (pg\.)?(Pool|Client)\(" apps/api/src

# 2. Pas d'appel direct au pool hors db/pool.ts. Attendu : 1 ligne (pool.connect)
rg -n "\bpool\.(query|connect)" apps/api/src

# 3. Lectures de process.env hors tests. Attendu : 4 lignes
#    (config.ts, seed.ts x2, web/lib/api-serveur.ts)
rg -n "process\.env" apps/api/src apps/web/src --glob '!*.test.*'

# 4. dangerouslySetInnerHTML / innerHTML dans le web. Attendu : 0
rg -n "dangerouslySetInnerHTML|innerHTML" apps/web/src

# 5. Variables exposées au navigateur. Attendu : 0
rg -n "NEXT_PUBLIC_" apps

# 6. Agrégats SQL de montants (les calculs vont dans packages/engines). Attendu : 0
rg -n "SUM\(|AVG\(" apps/api/src --glob '!db/seed*'

# 7. LIMIT littéral > 1 (toute liste est paginée par curseur, LIMIT $n).
#    Attendu : 3 lignes dont 2 écarts connus (dette) : routes/missions.ts:457 et
#    routes/opportunites.ts:143 (LIMIT 500) ; le LIMIT 2 de db/seed-planification.ts
#    est du seed.
rg -n "\bLIMIT [0-9]+" apps/api/src | grep -v "LIMIT 1\b"

# 8. Arrondis dans l'API (hors moteur). Attendu : 3 lignes, toutes justifiées :
#    totp.ts (pas de temps), jobs/worker.ts (délai en secondes),
#    routes/missions.ts:207 (inverse de la parité EUR/FCFA, arrondi à
#    numeric(20,10)) ; toute autre ligne est un calcul de montant à déplacer
rg -n "Math\.(round|floor|ceil|trunc)|toFixed\(" apps/api/src

# 9. console.* hors seed et migrate. Attendu : 1 ligne (mailer.ts, transport
#    « journal » de développement)
rg -n "console\.(log|info|debug|warn|error)" apps/api/src --glob '!**/seed*' --glob '!**/migrate.ts'

# 10. Route sans exiger (par gestionnaire). Attendu : "203 5" puis 5 lignes
#     (connexion, connexion/2fa, deconnexion, sante, invitations/accepter)
node -e '
const fs=require("fs");let n=0;const s=[];
for(const f of fs.readdirSync("apps/api/src/routes")){const t=fs.readFileSync("apps/api/src/routes/"+f,"utf8");
const re=/app\.(get|post|put|patch|delete)\(\s*(["`][^"`]*["`])/g;let m;const p=[];
while((m=re.exec(t)))p.push([m.index,m[1],m[2]]);
p.forEach((x,i)=>{n++;if(!/exiger/.test(t.slice(x[0],i+1<p.length?p[i+1][0]:t.length)))s.push(f+" "+x[1]+" "+x[2]);});}
console.log(n,s.length);console.log(s.join("\n"));'

# 11. Interpolations dans les gabarits SQL : relire chaque expression qui n'est
#     pas une constante, un fragment (set.sql, filtreVisibilite(...)) ou un
#     FOR UPDATE. Les listes COLONNES_*, ELEMENTS.*.colonnes, CHAMPS.join et
#     `cle`/`portee`/`maj` sont des constantes de code. Relevé du 2026-10-06 :
#     376 requêtes en gabarit, 185 interpolations, aucune valeur issue d'une
#     requête HTTP. Pas de commande rg fiable (les gabarits s'étendent sur
#     plusieurs lignes) : extraire les gabarits qui suivent « .query( » par script.

# 12. Schémas Zod non stricts. Attendu : 0 sur 143 z.object( de
#     packages/shared/src/schemas (chaque z.object est suivi de .strict() dans sa
#     chaîne). Vérifié par un script ponctuel, pas par rg.

# 13. Migration existante modifiée ou supprimée dans l'historique git. Attendu : 0 ligne
git log --diff-filter=MD --name-only --format= -- apps/api/migrations | sort -u
# Dans une branche : git diff --name-status main -- apps/api/migrations
# ne doit montrer que des lignes « A » (ajouts).

# 14. Textes d'interface en anglais (échantillon). Attendu : 0
rg -n ">\s*(Submit|Cancel|Save|Delete|Loading|Error|Login|Sign in|Logout|Search)\s*<" apps/web/src

# 15. Dépendances vulnérables (réseau requis). Attendu à ce jour : 4 constats
#     postcss via next (voir SECURITY.md §14)
pnpm audit --prod
```
