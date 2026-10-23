Reporté dans la documentation le 2026-10-23 (lot 9g).

# Lot 13a : cause racine des écrans périmés après écriture (A-04, R-01) et des liens sans effet (R-02)

Anomalies de la recette finale du 2026-10-23 (`docs/recette/2026-10-23-recette-finale.md`, R-01 et
R-02 ; fiches `BUG-2026-10-22-004`, `BUG-2026-10-23-001` et `BUG-2026-10-23-002` du bus d'agents).
Aucune migration, aucun changement de l'API, de `next.config.mjs` ni des dépendances.

## Cause racine (démontrée)

Défaut du React embarqué par Next 15.5.28 pour l'App Router (`next/dist/compiled/react-dom`,
version `19.2.0-canary-0bdb9206-20250818`, pas le `react@19.3.0` du `package.json`, qui ne sert
qu'au routeur `pages`). Ce n'est ni un cache de données, ni l'onglet en arrière-plan, ni
`useRafraichir`, ni la file d'actions du routeur.

1. `router.refresh()` (ou une navigation par `<Link>`) lance une transition. Le rendu de la
   transition suspend dans une frontière `<Suspense>` déjà affichée : celle que Next pose pour
   `src/app/(app)/loading.tsx` (et les `loading.tsx` imbriqués).
2. Pendant que React attend en cédant la main, une ligne du flux RSC arrive. Le morceau Flight
   concerné passe à l'état `resolved_model` (données reçues, initialisation paresseuse).
3. À la reprise, React ne tient pas ce statut pour « résolu ». Il déroule donc la suspension :
   `throwException`, branche « frontière Suspense ». Il marque le rendu « suspendu avec délai »
   (`renderDidSuspendDelayIfPossible`), puis attache son écouteur de réveil (`attachPingListener`).
4. `ReactPromise.prototype.then` initialise alors le morceau et rappelle l'écouteur
   **de façon synchrone**, pendant le rendu. `pingSuspendedRoot`, appelé en plein rendu, avec un
   statut déjà à 4, ne fait rien. En fin de rendu, `markRootSuspended` efface `pingedLanes`.
5. Les données sont là, mais plus rien ne relance le rendu : la racine garde la voie de la transition
   « suspendue » (`root.suspendedLanes`) et l'ancien écran reste affiché. Toute mise à jour d'état non
   transitoire (`markRootUpdated`) efface cet état et la transition aboutit aussitôt : une frappe, le
   `setAbandonne(true)` du secours à 8 s (d'où les ≈ 8,1 s), la relance à 1,5 s quand elle tombe
   bien, ou la minuterie de 60 s de la cloche des notifications (d'où les 30 à 60 s de R-02).

Preuves relevées dans le navigateur (build de production, onglet au premier plan, 61-62 images/s) :

- état de la racine React (`document.__reactContainer$….stateNode`) relevé toutes les 20 ms. La voie
  de transition passe à `suspendedLanes` environ 100 ms après le clic et y reste, avec
  `pingedLanes = 0`, jusqu'à 8,1 s. À 1 s, la file d'actions du routeur est vide (`pending: null`),
  la promesse de l'action est `fulfilled` et le cache du nouvel état est complet (tous les `rsc`
  résolus) ;
- journal des `then(ping, ping)` (prototype `ReactPromise` de Flight et `Promise`). Dans chaque essai
  bloqué, le dernier écouteur est attaché par la branche « frontière Suspense » de `throwException`
  (colonne 115477 du morceau `75019b68-….js`, fonction `iO` = `attachPingListener`), sur un morceau
  Flight au statut `resolved_model`, rappelé dans la même milliseconde ;
- reproduction sans le crochet : `POST` direct, puis `window.next.router.refresh()` nu. La donnée
  n'apparaît pas en 10 s (3 essais sur 3), la racine garde trois voies suspendues, puis une seule
  frappe dans un champ affiche tout en 300 ms ;
- suppression : une mise à jour d'état non transitoire 500 ms après le clic affiche la donnée à
  ≈ 530 ms, avec une seule requête `_rsc` (3 essais sur 3).

Écarté par expérience : feuilles de style à « commit suspendu » (toutes à `loading = 5`), chargement
d'images, `unresolvedThenable` du routeur (jamais appelé), action asynchrone intriquée
(`ReactSharedInternals.S` sans action ; voies de transition différentes à chaque essai).

Pourquoi certains parcours étaient rapides : tout dépend de l'ordre d'arrivée des lignes du flux RSC
par rapport aux pauses du rendu. Une page dont la dernière ligne utile arrive pendant une pause bloque,
une autre non. Le compte joue (directeur ou associée) parce que le contenu et la taille de la page
changent. Sur ce poste, le blocage était systématique pour la veille (16 sur 16) et les créanciers du
directeur.

## Correctif

Contournement général, sans requête réseau, dans un composant commun monté une fois :

- `apps/web/src/components/shell/debloqueur.ts` (noyau pur) : `estRessourceDeRendu`, qui retient
  une réponse RSC de la même origine (`_rsc`) ou un morceau `/_next/static/chunks/` ;
  `ajouterEcheances`, qui fusionne à 25 ms les échéances proches ; `creerDebloqueur`, qui tient une
  seule minuterie et fait une seule relance par lot d'échéances échues.
- `apps/web/src/components/shell/DebloqueurRendu.tsx` (client, rend `null`) : un
  `PerformanceObserver` de type `resource`. À chaque réponse de rendu, il programme 4 mises à jour
  d'état minuscules et non transitoires (`setTic`) à +40, +150, +400 et +1 000 ms. Chacune efface
  l'état « suspendu » de la racine, et la transition bloquée aboutit. Sans transition bloquée, React
  ne re-rend qu'un composant vide.
- `apps/web/src/app/layout.tsx` : `<DebloqueurRendu />` à côté de `<HorsLigne />`. Il couvre le
  cabinet, le portail, la connexion et l'invitation, les `router.refresh()` des formulaires (environ
  250 composants), les `router.push` et `replace` (modèle financier) et les liens `<Link>` (R-02).
- `useRafraichir` est inchangé, hors une phrase de documentation : la relance à 1,5 s et le secours à
  8 s restent des filets de sécurité. `FormulaireConnexion` n'est pas touché.

Pourquoi pas ailleurs : supprimer les `loading.tsx` retirerait les squelettes de navigation. Une
montée de version de Next ou de React sort du périmètre. Corriger les ~250 appelants un par un
laisserait les navigations bloquées.

## Mesures (build de production `next start`, base `missionpilot_recfin2`, onglet au premier plan, 61-62 images/s)

Format : délai de l'API / délai d'affichage de la donnée sans rechargement / nombre de `_rsc` /
bouton libéré (ms). Mesure par sonde injectée (MutationObserver, PerformanceObserver), clic réel du
bouton par `click()`.

| Parcours (compte) | Avant | Après |
| --- | --- | --- |
| Veille, « Ajouter l'avis » (associée), 16 essais | 16 sur 16 entre 8 087 et 8 179 ms, 2 `_rsc` | 16 sur 16 entre 192 et 277 ms, 1 `_rsc` |
| `next.router.refresh()` nu après `POST` (veille) | 3 sur 3 jamais affiché en 10 s | 4 sur 4 entre 211 et 259 ms |
| Créanciers (directeur), 4 essais | 8 095 à 8 182 ms, 2 `_rsc`, bouton « Ajout… » bloqué 8 080 à 8 165 ms | 273 à 321 ms, 1 `_rsc`, bouton libre au même instant |
| Modèle financier, « Enregistrer une nouvelle version » (associée) | 1 essai sur 4 bloqué plus de 10 s (débloqué par le clic suivant), sinon 85 à 304 ms | 4 sur 4 entre 273 et 321 ms, 1 `_rsc` |
| Import d'état financier CSV, ligne de l'état dans la liste (associée), 6 essais | 3 sur 6 bloqués (8 099, 8 097, 8 178 ms), 1 à 1 696 ms, 2 à 174-250 ms | 6 sur 6 entre 185 et 216 ms, 2 `_rsc` (actualisation + préchargement du nouveau lien) |
| Causes racines : proposition (directeur) | 8 278 ms, 2 `_rsc` | 433 et 444 ms, 1 `_rsc` ; 343 ms (associée) |
| Causes racines : validation (associée) | 8 127 ms, 2 `_rsc`, « Validation… » 8 094 ms | 330 ms, 1 `_rsc` |
| R-02, lien `/appels-offres` → `/appels-offres/veille` (associée) | 3 sur 3 sans effet après 8 s ; second clic sans effet | 10 sur 10 navigations entre 81 et 407 ms |

Objectifs : donnée visible en moins de 1 s dans au moins 15 essais sur 16 (atteint : 16 sur 16 sur
la veille, 100 % ailleurs) ; au plus 2 `_rsc` par écriture (atteint) ; aucun bouton verrouillé plus de
2 s (atteint, 321 ms au plus). Aucune erreur console.

## R-02

Même cause. La navigation d'un `<Link>` est une transition. Son rendu suspend sous la frontière de
`(app)/loading.tsx` et perd son réveil : l'URL et l'écran restent inchangés alors que le `_rsc` a
répondu. Un second clic ne débloque rien, car il ne lance qu'une nouvelle transition, sans mise à
jour urgente. Le déblocage arrivait avec la prochaine mise à jour d'état, en pratique la minuterie de
60 s de `ClocheNotifications` : d'où « 30 à 60 s ». Corrigé par le même composant (mesures ci-dessus).

## Tests

- `apps/web/src/components/shell/debloqueur.test.ts` (13 tests, minuteries simulées, sans jsdom) :
  filtre des ressources (RSC, morceaux, API, CSS, autre origine, paramètre voisin `x_rsc`, nom
  illisible), échéances (tri, fusion, immutabilité), relances aux pas par défaut, rafale de
  10 signaux bornée à 6 relances au plus, une seule relance quand plusieurs échéances sont échues
  ensemble, arrêt au démontage, reprogrammation après une série.
- `pnpm --filter @missionpilot/web test` : 156 fichiers, 2 370 tests, contre 2 357 avant le lot.

## Risques et limites

- Contournement d'un défaut de React. Le test unitaire ne couvre que le noyau pur : la preuve de bout
  en bout est la mesure dans le navigateur. À revoir à chaque montée de Next ou de React. Si une
  version embarquée corrige le réveil synchrone, le composant devient inutile mais reste inoffensif.
- Il s'appuie sur Resource Timing (`PerformanceObserver`, type `resource`). Un navigateur sans cette
  API garde le comportement d'origine, avec les filets de `useRafraichir`. Un blocage qui
  surviendrait plus d'une seconde après la dernière réponse RSC ou le dernier morceau ne serait pas
  rattrapé : aucun cas observé.
- Coût : jusqu'à 4 rendus d'un composant vide après chaque réponse RSC (fusionnés pendant les
  rafales de préchargement). Une mise à jour urgente peut interrompre un rendu de transition en
  cours, qui reprend aussitôt.
- Non mesuré : téléphone réel, Firefox, Safari.

## Lignes à reporter (par le Pilote ; fichiers hors du périmètre du lot)

- **HANDOFF.md** : « Lot 13a : A-04/R-01 et R-02 corrigés à la racine. Cause : perte du réveil
  de React 19.2 canary (embarqué par Next 15.5) sous une frontière Suspense quand un morceau Flight
  est en `resolved_model`. Contournement global `DebloqueurRendu` dans le layout racine. Mesures dans
  `docs/workflows/notes-lots/lot-13a.md`. À retester par la recette : veille, créanciers du
  directeur, modèle financier, import d'état, causes, liens. »
- **CODING_STANDARDS.md** (section web) : « Ne pas retirer `DebloqueurRendu` du layout racine tant
  que Next embarque un React sans correctif du réveil synchrone (lot 13a). Après une écriture,
  utiliser `useRafraichir` ou `useFormulaire` : ne pas ajouter de minuterie, de rechargement complet
  ni de `router.refresh()` répété pour « forcer » l'affichage. Un écran périmé se diagnostique par
  `root.suspendedLanes`, voir la note du lot 13a. »
- **SECURITY.md** : rien à reporter. Aucune donnée lue, aucune requête émise, aucun nouvel en-tête. Le
  composant ne lit que les noms des ressources de la page (Resource Timing, même origine).
