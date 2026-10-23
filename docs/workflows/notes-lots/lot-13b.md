# Lot 13b : corrections de la recette finale du 2026-10-23

Anomalies R-03 à R-09, A-05 et A-09 résiduelles (`docs/recette/2026-10-23-recette-finale.md`). Les
écritures sans rafraîchissement d'écran (R-01, R-02, A-04) sont traitées par un autre lot.

## Choix notables

- **R-03, source de vérité de l'état d'une note.** La dernière version d'une note reste `soumise` en
  base une fois jugée (migration 0507) : la décision vit dans `dd_note_validations` (une ligne par
  version). La synthèse du dossier (`derniereNote`, `due-diligence/synthese.ts`) joint cette table et
  déduit `validee` / `rejetee`, comme `etatDeNote` (`notes.ts`) pour les écrans de notes. Les écrans
  web lisaient déjà les quatre états.
- **R-04.** Un associé est dispensé de la séparation des tâches (`peutValiderSansConflit`) : le message
  « une autre personne doit le valider » n'est plus affiché qu'à l'auteur non associé
  (`messageAuteurVerdict`, `lib/due-diligence.ts`). L'API était correcte.
- **R-06.** Le message de versement de l'observatoire vient du nombre `versees` renvoyé par l'API.
  Le retrait d'adhésion reste sans confirmation : arbitrage de spécification en attente.
- **R-07.** Un code de ligne généré (`L1_13`) s'affiche « Poste sans code source (page 1, ligne 13) »
  (`libellePosteEtat`) ; la cible d'un contrôle, « page 1, ligne 17 » (`libelleCibleControle`). Les
  codes du document (`TA1`) restent tels quels. L'aide OCR ne s'affiche que pour l'import d'un état
  financier.
- **R-09.** `libelleDevise` (`lib/format.ts`) écrit « FCFA » pour XOF et XAF dans les en-têtes et
  consignes du plan et du redressement ; un brief rejoué à une date passée écrit « Ce jour-là » et non
  « Aujourd'hui » ; les périodes de KPI du rapport d'avancement passent par `libellePeriode`.

## R-08 : latence des jobs d'ingestion

Le worker de jobs attendait son intervalle (30 s) avant de traiter un document importé. Un signal en
mémoire (`apps/api/src/jobs/reveil.ts` : `signalerJobCree` et `ecouterJobCree`) est désormais émis par
`mettreEnFileExtraction` et `mettreEnFileStructuration` après l'INSERT. `WorkerJobs.demarrer` s'y abonne
et avance son prochain cycle à 400 ms (`delaiReveilMs`), délai qui laisse l'INSERT se valider si
l'appelant est dans une transaction. Plusieurs signaux rapprochés donnent un seul cycle, et deux cycles
ne tournent jamais en parallèle. Un cycle qui a traité au moins un job est suivi d'un cycle à 1 s
(`delaiEnchainementMs`), pour enchaîner extraction puis structuration. Un cycle vide ramène à
l'intervalle normal : aucune scrutation rapide permanente, donc aucun coût en base supplémentaire.
`reserver_job_a` (équité par cabinet, 0305) et les migrations sont inchangées. `arreter()` se
désabonne et supprime la minuterie.

Correctif de revue : le signal part APRÈS le COMMIT (`creerDocument` après `enregistrerFichier`, et
routes de relance `ingestion-dd.ts` / `ingestion-standard.ts` après leur transaction), plus dans la
transaction. Filet : un cycle déclenché par un signal qui revient vide programme UN cycle de rattrapage
à 2 s (`delaiRattrapageMs`), une seule fois, avant de retomber à l'intervalle normal.

Limites : le signal est local au processus. Un worker lancé dans un autre processus que l'API, ou une
API sans worker (tests), garde l'intervalle normal. Un job créé par un autre chemin que ces deux
fonctions n'émet pas de signal. Test : `apps/api/test/jobs-reveil.test.ts` (job créé puis signalé,
traité en moins de 1 s avec un intervalle de 60 s).

## Limites connues

- R-05 : les largeurs minimales des 7 colonnes de l'échantillon totalisent 43,75 rem (700 px) pour
  732 px utiles à 1036 px de viewport (736 px à 768 px, 976 px à 1280 px) ; Client et Directeur passent à
  la ligne aux espaces. Seule une garde CSS (`qualite-froide-css.test.ts`) existe : le rendu à 768,
  1036 et 1280 px doit être confirmé en navigateur (marge faible, 32 px).
- A-09 : si la grille se complète sans que la synthèse change et sans clic sur « Terminer », le
  bandeau reste jusqu'au prochain clic.
