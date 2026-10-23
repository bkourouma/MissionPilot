# Recette finale de contrôle du chantier « reste » — 2026-10-23

Deuxième recette navigateur, courte, de la branche d'intégration finale `orch/2026-10-20-reste-recette2`,
révision `1edb5f2c8a86138f3a318f0c2f7eeaf0799a3b62`. Elle retient surtout trois points : le retest des
anomalies A-01 à A-12 de la première recette (`2026-10-22-recette-integration.md`), corrigées par le lot 10 ;
la mesure de A-04 sur un onglet réellement au premier plan ; l'import de documents et l'OCR. Aucun code
modifié, rien de commité.

## Environnement

| Élément | Valeur |
| --- | --- |
| Base | `missionpilot_recfin2`, neuve et dédiée : migrations complètes, `db:seed-demo` avec portail, 2FA, canaux, redressement et services candidats. **Conservée** en fin de recette. |
| API | port 4110, `NODE_ENV=development`, `CONNEXION_RAPIDE_DEMO=oui`, `WEB_ORIGIN=http://localhost:3110`, `OCR_LOCAL=auto`, WhatsApp et transcription `simule`, signature `local`, aucune clé IA, aucun SMTP |
| Web | `next build` (`API_URL=http://localhost:4110`, `NODE_ENV=production`), puis deux `next start -p 3110` en `NODE_ENV=production`, l'un sur `-H 127.0.0.1`, l'autre sur `-H ::1` |
| Processus | détachés, exécutable renommé `mp-recette2.exe` (copie de `node.exe`) dans le scratchpad de session, arrêtés en fin de recette |
| Pare-feu | aucune fenêtre « Sécurité Windows » observée (écoute sur la boucle locale seulement) |
| Navigateur | Chrome (extension), un testeur à la fois, sur trois origines : `localhost` (T1, T4), `127.0.0.1` (T2), `[::1]` (T3). Volet intégré de l'application pour le mobile à 375 px (T3, T4), car Chrome ne descend pas sous 654 px de large. |
| Testeurs | 4 agents `ui-tester`, passés l'un après l'autre |

**Onglet au premier plan.** Les onglets du groupe de l'extension s'ouvrent dans une fenêtre existante,
sans y devenir l'onglet actif. Le rendu y est alors bridé : `requestAnimationFrame` a été mesuré à 4 ou
5 images par seconde alors que `visibilityState` indiquait `visible`. Un script (UI Automation) sélectionne
l'onglet MissionPilot et met sa fenêtre devant. Le rendu monte alors à **61-62 images par seconde**.
Chaque testeur a vérifié cette valeur avant ses séries d'écritures. Toutes les mesures ci-dessous ont été
prises dans cet état. Les testeurs sont passés l'un après l'autre, car le groupe de l'extension partage
une seule fenêtre et une fenêtre n'a qu'un onglet actif.

## Synthèse

| Parcours | Résultat | Anomalies |
| --- | --- | --- |
| A-04 : rafraîchissement après écriture (onglet au premier plan) | **échoué** | R-01, R-02 |
| Retest A-01 Observatoire | passé (agrégats après un mois clos : non vérifiable) | R-06 |
| Retest A-02 Modèle sectoriel DD | passé | — |
| Retest A-03 Validation des causes racines | passé | — |
| Retest A-05 Codes bruts | partiel | A-05 résiduel |
| Retest A-06 Groupe | passé | — |
| Retest A-07 Copilote (expiration) | passé | — |
| Retest A-08 Devise du plan vivant | passé | R-09 (en-têtes) |
| Retest A-09 Erreur de synthèse | partiel | A-09 résiduel |
| Retest A-10 Tableau à 1036 px | passé (débordement corrigé) | R-05 |
| Retest A-11 Date ISO | passé | — |
| Retest A-12 Bannière du modèle financier | passé | — |
| Due diligence : dossier, hypothèses, verdicts, note | passé | R-03, R-04 |
| Import d'états financiers : xlsx, PDF texte, PDF scanné (OCR), PDF vide, faux fichier | passé | R-07, R-08 |
| Due diligence : onglet Documents | partiel (`ia_indisponible` propre ; lecture IA non vérifiable sans clé) | — |
| Amorçage du standard | partiel (import et `ia_indisponible` propres, aucun taux ni honoraire affiché ; aucune proposition sans clé) | — |
| Régression `/brief` | passé | R-09 |
| Régression `/copilote` | passé | — |
| Rapport d'avancement hebdomadaire et portail | passé | R-01 (validation à 1,6 s), R-09 |
| Services candidats | passé (refus d'activation sans prix non atteignable par l'interface) | — |
| Signature 2FA | passé | — |
| Ateliers | passé | — |
| Mobile 375 px (observatoire, services candidats, veille, avancement au portail, import d'état et détail) | passé | — |

Anomalies : aucune bloquante ; **3 majeures** (R-01, R-02, R-03) ; **6 mineures nouvelles** (R-04 à R-09)
et **2 mineures résiduelles** (A-05, A-09). Corrigées et passées : A-01, A-02, A-03, A-06, A-07, A-08,
A-10, A-11, A-12. Journaux de l'API sur toute la recette : **aucun statut 5xx**, aucune entrée de niveau
warn/error. Seul `api.err` contient l'avertissement de dépréciation `pg` « client.query() when the client
is already executing a query ». Aucune erreur console applicative : les seules erreurs relevées viennent
de l'extension ou du volet intégré.

Bus d'agents : nouvelles anomalies `BUG-2026-10-23-001` à `009`. Retests consignés sur
`BUG-2026-10-22-001` à `012` : 9 passent à `passé` ; 004, 005 et 009 restent ouverts, avec la note de
retest. Aucune correction n'a été annoncée pendant la recette, il n'y a donc pas eu de cycle de retest de
correction : les anomalies ouvertes attendent le développement.

## Mesures A-04 (onglet au premier plan, 61-62 images/s)

Méthode : un script injecté avant le clic, qui ne fait qu'écouter (MutationObserver et PerformanceObserver).
Il relève le délai de réponse de l'API (tApi), celui d'apparition de la donnée dans le DOM sans rechargement
(tAffiche) et le nombre de requêtes `_rsc` après l'écriture. Critères : tAffiche inférieur à 1 s, au plus
2 requêtes `_rsc`, bouton jamais verrouillé plus de 8 s.

### Veille des appels d'offres, « Ajouter l'avis », 16 essais (associé)

| Essai | tApi (ms) | tAffiche (ms) | `_rsc` |
| --- | --- | --- | --- |
| 01 | 268 | 469 | 1 |
| 02 | 112 | 280 | 1 |
| 03 | 160 | 1 796 | 2 |
| 04 | 67 | 207 | 1 |
| 05 | 100 | ≈ 8 150 | 2 |
| 06 | mesure perdue (outil) | — | — |
| 07 | 89 | 8 159 | 2 |
| 08 | 140 | 8 190 | 2 |
| 09 | 101 | 8 136 | 2 |
| 10 | 70 | 8 111 | 2 |
| 11 | 106 | 8 158 | 2 |
| 12 | 131 | 8 174 | 2 |
| 13 | 95 | > 9 300 | 2 |
| 14 | 107 | 8 137 | 2 |
| 15 | 58 | 8 101 | 2 |
| 16 | 117 | 274 | 1 |

Bilan sur 15 essais mesurés : 4 sous 1 s, 1 à 1,8 s, 9 vers 8,1 s et 1 au-delà de 9,3 s. Le libellé « Ajout… »
du bouton dure de 60 à 160 ms. Le bouton redevient ensuite désactivé parce que le formulaire est vide, ce
qui ne constitue pas un verrouillage. Les 16 avis sont présents après rechargement, sans doublon, et aucun
rechargement complet n'a eu lieu. Un 17e essai de contrôle a affiché en 307 ms.

### Autres écrans

| Écriture (compte) | tApi (ms) | tAffiche (ms) | `_rsc` | Verdict |
| --- | --- | --- | --- | --- |
| Créancier 1, 2, 3 (directeur) | 111 / 83 / 68 | 8 148 / 8 128 / 8 103 | 2 | échec, bouton « Ajout… » verrouillé ≈ 8,1 s |
| Créancier 4, 5 (associé) | 86 / 99 | 427 / 357 | 1 | OK |
| Proposition de causes, versions 2 et 3 (chef de mission) | 190 | 488 / 528 | 1 | OK |
| Validation des causes (consultant non auteur) | 80 | 2 273 | 2 | échec |
| Validation des causes (associé) | 113 | 8 530 | 2 | échec |
| Modèle sectoriel DD (associé) | 188 | 436 | 1 | OK |
| DD : dossier, 3 hypothèses, 3 verdicts, validations, note, soumission, validation | 55 à 174 | 216 à 646 | 1 ou 2 (+ préchargements d'onglets) | OK |
| Signature cabinet (Fanta Doumbia) → « 1 sur 2 » | 260 | 472 | 1 | OK |
| Signature portail (Salimata Bakayoko) → « 2 sur 2 » | 231 | 467 | 1 | OK |
| Plan, atelier, invitation, clôture d'atelier | 67 à 117 | 295 à 526 | 1 | OK (ouverture et vote constatés à jour à 3 s) |
| Préparation du rapport d'avancement | 161 | 549 | 1 | OK |
| Validation du rapport d'avancement | 52 | 1 649 | 2 | échec (1,6 s) |
| Prix du diagnostic flash | 63 | 231 | 1 | OK |
| Participation de groupe A → B | 91 | 1 720 | 4 | échec (1,7 s) |
| Enregistrement d'une version du modèle financier (T3, constat) | 201 reçu | > 8 s | — | échec |
| Ligne d'un import d'état financier (T4, constat) | — | ≈ 8,2 s | — | échec |

Conclusion : le défaut A-04 **n'était pas un artefact des onglets en arrière-plan**. Sur un onglet à
61 images/s, la première actualisation (`router.refresh()` dans une transition) n'est souvent pas
appliquée. La donnée n'apparaît qu'à la relance (≈ 1,6 s) ou au délai de secours (≈ 8,1 s), selon
l'écran et l'essai. Aucun verrouillage de plus de 8 s n'a été vu, sauf la durée du libellé d'attente sur les
créanciers (≈ 8,1 s).

## Anomalies

### R-01 — A-04 confirmé : écran à jour seulement ≈ 8,1 s ou ≈ 1,6 s après une écriture réussie (majeur) — `BUG-2026-10-23-001` (suite de `BUG-2026-10-22-004`)

- Écrans : `/appels-offres/veille` (associé) ; `/missions/<id>/redressement/creanciers` (directeur) ;
  `/missions/<id>/redressement/diagnostic` (validation) ; `/missions/<id>/avancement/<rapport>`
  (validation) ; `/dossiers/<id>/groupe` (participation) ; `/missions/<id>/plan/<planId>/modele`
  (enregistrement) ; `/dossiers/<id>/finances` (ligne d'import).
- Étapes : 1. onglet au premier plan (61 images/s) ; 2. saisir la donnée ; 3. cliquer l'action ; 4. attendre
  sans recharger.
- Attendu : écran à jour en moins de 1 s.
- Observé : POST/PUT 200 ou 201 en moins de 300 ms. Le premier `_rsc` répond 200 sans effet à l'écran,
  une relance part vers 1,6 s, et la mise à jour n'arrive qu'à la relance ou à 8,1 s (`DELAI_SECOURS_MS`).
  Sur les créanciers, aucun message de succès n'apparaît à 3 s et le bouton reste en « Ajout… » 8,1 s. Les
  données sont bien enregistrées, sans doublon ni rechargement complet. Les écrans de due diligence, la
  signature, les ateliers et le prix, eux, s'affichent en moins de 0,7 s.
- Fréquence : veille 11 essais sur 15 au-delà de 1 s ; créanciers 3 sur 5 ; causes 2 sur 2 ; rapport et
  groupe 2 sur 2.
- Piste (sans correction) : `apps/web/src/components/formulaires/useRafraichir.ts` (`DELAI_RELANCE_MS`
  1 500, `DELAI_SECOURS_MS` 8 000) et `useFormulaire.ts:64`. La transition de `router.refresh()` n'est
  pas validée avant la relance ou le secours.
- Capture : aucune de l'état périmé (fenêtre de 8 s non attrapée).

### R-02 — Navigation par lien interne parfois non validée pendant 30 à 60 s (majeur provisoire) — `BUG-2026-10-23-002`

- Écrans : `/missions/<id>/signatures` (lien vers la demande « Lettre de mission - signature electronique
  (DÉMONSTRATION) ») ; `/dossiers/<id>/groupe` (lien « Depuis ce dossier »). Compte : associé.
- Attendu : navigation en moins de 1 s.
- Observé : `_rsc` reçu en 94 à 144 ms, mais l'URL et l'écran ne changent qu'après 30 s à plus de 60 s. Un
  second clic n'y change rien. Aucune erreur console. Le symptôme rappelle R-01 (transition non validée).
- Fréquence : 2 clics sur environ 28, non reproduit à la demande.

### R-03 — Synthèse du dossier DD : note validée affichée « En attente de validation » (majeur) — `BUG-2026-10-23-003`

- Écran : `/missions/<id>/due-diligence/<dossierId>`, carte « Note au comité ». Comptes : associé, chef de
  mission.
- Étapes : 1. créer une note, la soumettre, puis la faire valider par un associé ; 2. ouvrir la synthèse du
  dossier.
- Attendu : « Validée · Version 2 », comme sur `/note`.
- Observé : « En attente de validation · Version 2 ». `derniereNote` (`apps/api/src/due-diligence/synthese.ts`,
  lignes 155 à 175) renvoie l'état de la dernière version, qui reste `soumise` en base (vérifié par
  SELECT), sans tenir compte de la validation. Le comité peut donc lire un état faux.
- Fréquence : 2 sur 2. Capture : `captures-2/T1-01-synthese-dd-note-validee-affichee-en-attente.jpg`.

### R-04 — Verdict DD : message contradictoire pour un associé auteur (mineur) — `BUG-2026-10-23-004`

- Écran : `/missions/<id>/due-diligence/<dossierId>/hypotheses/<id>`. Compte : associé, auteur du verdict.
- Observé : le texte « Vous avez proposé ce verdict : une autre personne doit le valider » s'affiche alors
  que « Valider » et « Rejeter » sont actifs. La validation réussit (201), ce qui est conforme à la dispense
  de l'associé. Pour la note, le texte précise bien « un associé peut le faire ».

### R-05 — Revue à froid à 1036 px : colonnes écrasées, mots coupés (mineur) — `BUG-2026-10-23-005`

- Écran : `/qualite/revue-froide/<campagneId>`, associé, `innerWidth` 1036.
- Observé : A-10 est corrigé (plus de débordement, sélecteur entièrement lisible). Mais les colonnes sont
  très étroites : « Direct/eur », « Clôtur/e », « Ya/o Ko/uas/si », date « 20/26 ». Avec le formulaire
  d'affectation ouvert, la colonne Directeur tombe à 49 px.
- Captures : `captures-2/T3-01-revue-froide-echantillon-1036.jpg`,
  `captures-2/T3-02-revue-froide-echantillon-selecteur-ouvert-1036.png`.

### R-06 — Observatoire : « Vos données ont été versées » alors que rien n'est versé (mineur) — `BUG-2026-10-23-006`

- Écran : `/observatoire`. Comptes : associé, directeur de mission.
- Observé : le message de succès (`FormulairesObservatoire.tsx:132`) s'affiche alors que
  `obs_contributions` reste vide, faute de notation publiée. Le directeur, qui n'a pas de bouton de
  versement, voit « Versez d'abord vos données… ». Le retrait d'adhésion part sans confirmation (décision à
  prendre côté spécification).

### R-07 — Import : présentation du détail d'un document (mineur) — `BUG-2026-10-23-007`

- Écran : `/dossiers/<id>/finances/documents/<docId>`, associé.
- Observé :
  - carte « Résultat » en liste plate, où libellés et valeurs ont le même style ;
  - postes de total sans code source affichés « L1_13 », « L1_17 », « L2_5 », « L2_9 », y compris dans
    un contrôle (« Résultat du compte de résultat (L1_17) ») ;
  - PDF vide en échec : « Aucune page lue pour l'instant. » ;
  - la phrase d'aide sur l'OCR des états financiers (« l'état obtenu part toujours en revue… ») est
    reprise sur les imports de due diligence et d'amorçage.
- Capture : `captures-2/T4-01-resume-sans-distinction-libelles.jpg`.

### R-08 — Import : traitement différé jusqu'au cycle suivant du worker (mineur) — `BUG-2026-10-23-008`

- Observé : traitement d'environ 8 à 10 s pour le xlsx, 25 s pour le PDF texte de 2 pages, 31 s pour le
  scan, 10 s pour la due diligence et 24 s pour l'amorçage. L'OCR seul prend pourtant 2 à 4 s par page. La
  boucle `WorkerJobs` ne repasse que toutes les 30 s (`apps/api/src/jobs/worker.ts:162`), alors que le
  RUNBOOK annonce « à l'envoi ». Pendant l'OCR, la liste reste à « En attente de lecture ».

### R-09 — Présentation : formats et devise (mineur) — `BUG-2026-10-23-009`

- Portail, détail d'un rapport d'avancement : périodes de KPI affichées « 2026-09 », « 2026-T3 ».
- Plan, modèle et plan vivant : en-têtes « … · XOF » et « montants en XOF », alors que les explications
  sont en « FCFA ».
- `/brief?date=…` en rejeu : une feuille de temps et un congé marqués « Aujourd'hui ».

### A-05 résiduel — Aperçu de méthode : « Lecture des indicateurs : saisonniere » (mineur) — `BUG-2026-10-22-005` (reste ouvert)

- Écran : `/methodes/versions/<id>/apercu`, associé. Services candidats et revue à froid sont corrigés.
- Observé : la valeur de formulation reste brute, sans accent (`apps/web/src/lib/methodes-apercu.ts`, vers
  la ligne 174). Capture : `captures-2/T3-03-apercu-methode-saisonniere-brut.jpg`.

### A-09 résiduel — Revue à froid : bandeau d'erreur API périmé au-dessus de la confirmation (mineur) — `BUG-2026-10-22-009` (reste ouvert)

- Écran : `/qualite/revue-froide/echantillons/<id>`, expert métier.
- Observé : l'erreur de champ « synthèse obligatoire » disparaît bien à la frappe. En revanche, après le
  refus « La grille doit être complète… » et la complétion de la grille, le bandeau « La revue n'a pas pu
  être terminée » reste affiché au-dessus du panneau « Terminer et figer cette revue ? ». Cause :
  `f.erreurGlobale` n'est pas vidé (`apps/web/src/components/qualite/FroideTerminer.tsx`). Capture :
  `captures-2/T3-04-revue-erreur-api-perimee-avec-panneau.jpg`.

## Observations sans anomalie ouverte

- Brief : seul le texte d'un lien est cliquable, pas la ligne entière.
- Groupe, vue depuis la société de tête : le nœud de niveau 2 n'affiche pas sa part directe.
- Rapport d'avancement : « Enregistrer » sans message de succès visible. « Suggérer un commentaire (IA) »
  est proposé alors que l'IA du cabinet n'est pas activée (non cliqué).
- Due diligence et amorçage : sans clé, la lecture se termine toujours en `ia_indisponible`, quel que soit
  le réglage du cabinet (`apps/api/src/ingestion/ia-lignes.ts` : sans clé, aucune ligne). L'IA du cabinet n'a
  donc pas été activée : le faire n'aurait rien prouvé.
- Volet intégré : erreurs « An unknown error occurred when fetching the script » et « Chargement de la
  page… » resté dans le DOM, propres au volet.
- Journal de l'API : 24 réponses 404 sur `GET /api/missions/:id/redressement`, pour des missions sans
  dossier de redressement. C'est un signal attendu, pas une erreur.

## Détail des parcours réussis (états finaux observés)

- **A-01** : adhésion sans redirection, après rechargement aussi (2 fois). Bandeau « Votre cabinet est
  contributeur ». Message « Versez d'abord vos données… ». « Verser les données du cabinet » et « Se
  retirer de l'observatoire » sont présents.
- **A-02** : « Modèle ajouté à la bibliothèque. » (201). Le modèle apparaît dans l'encart « Points à
  examiner » du dossier DD du même secteur.
- **A-03** : l'auteur est bloqué, avec l'explication « … doit être validée par un autre consultant. Un
  associé peut la valider lui-même. » Après rechargement : « Validé · Validée par Adjoua Kacou »
  (consultant non auteur).
- **A-06** : vue depuis la tête, Transports Akwaba au niveau 0 à 100 %, filiale A à 60 %, B cumulée à
  30 %. Vue depuis B cohérente.
- **A-07** : badge « Expirée » et une seule consigne. « Reformuler », puis confirmation : commentaire
  visible sur la fiche.
- **A-08** : brouillon d'explication en FCFA uniquement.
- **A-11** : « mise en œuvre le 15 oct. 2026 ».
- **A-12** : la bannière mentionne la dispense de l'associé et du directeur. Version 1 « Validée par Yao
  Kouassi ».
- **Due diligence** : création du dossier, 3 hypothèses, verdicts validés par une autre personne,
  soumission refusée tant qu'un verdict n'est pas validé, note soumise puis validée par un associé.
- **États financiers** :
  - (a) xlsx : accepté automatiquement, total actif 16 200 000, citations de cellule ;
  - (b) PDF texte : accepté automatiquement, totaux 16 550 000 équilibrés, références de page, aucune IA ;
  - (c) PDF scanné : méthode « Reconnaissance de caractères (OCR local) », confiance de page 95 %,
    alerte « Lu par reconnaissance de caractères… jamais accepté automatiquement », état **En revue**,
    chaque montant « lu par OCR : à vérifier (confiance de la page : 95 %) ». Les **12 lignes sont
    identiques à la vérité terrain** (`MANIFESTE.json`). Durée ≈ 31 s. L'acceptation exige un motif ;
  - (d) PDF vide : « Aucun texte n'a pu être lu dans ce document (page blanche ou illisible). Fournissez un
    PDF avec texte ou un scan plus net. » ;
  - (e) docx renommé en .pdf puis en .xlsx : 415 et « Envoi refusé : L'extension du nom ne correspond pas
    au contenu du fichier. », aucun document créé.
  - Aucun écran n'a mentionné `TEXTE_PURGE`, ce qui est attendu sur une base neuve.
- **DD Documents** : « IA indisponible : à relancer », avec le message « Rien n'a été inventé… » et le bouton
  « Relancer la lecture ». La relance aboutit au même résultat.
- **Amorçage** : variante « Diagnostic flash (cabinet) » v1 en brouillon. Import du document historique :
  « IA indisponible ». Aucun taux ni honoraire n'est affiché. Le consultant reçoit 403 sur la page.
- **Signature 2FA** : connexion rapide refusée aux comptes 2FA, consultation puis signature des deux
  parties. Résultat : « Signée · 2 sur 2 », « Dossier scellé », « Chaîne de preuves vérifiée ».
- **Ateliers** : plan, atelier (vote par points), invitations, ouverture, vote, clôture définitive.
  « Agrégats masqués : au moins 3 participants requis » avec un seul contributeur.
- **Brief** : sources et liens corrects ; rejeu `?date=`, et date invalide ramenée au jour ; le portail est
  redirigé vers `/portail`.
- **Rapport d'avancement** : préparé, enregistré, validé puis figé. Visible du dirigeant au portail sans
  donnée financière interne ; l'investisseur est refusé.
- **Services candidats** : prix effacé puis rétabli à 1 000 000 XOF « DÉMONSTRATION ». Mission « RECFIN2-T2
  mission flash » créée et liée à « Diagnostic flash — version 1 ». Aucun code brut.
- **Mobile 375 px** : `scrollWidth = innerWidth = 375` sur `/observatoire`, `/services-candidats`,
  `/appels-offres/veille`, `/portail/avancement` et son détail, `/dossiers/<id>/finances` et le détail d'un
  document. Le menu mobile est utilisable. Captures `captures-2/T3-mobile-*.jpg` et
  `captures-2/T4-mobile-*.jpg`.

## Non vérifié, et pourquoi

- Agrégats de l'observatoire après la contribution d'un mois clos : aucune notation publiée dans le seed,
  aucune horloge de test ni journal manipulable par l'interface, et aucune écriture en base n'est admise.
- Lecture IA simulée en brouillon (due diligence, amorçage), avec sa validation par un autre utilisateur :
  sans clé, le code aboutit toujours à `ia_indisponible`. Aucune clé ne devait être saisie.
- Refus d'activation du diagnostic flash sans prix : le type est déjà activé par le seed, et aucun écran ne
  permet de le désactiver.
- RED-04, partie « validation du plan et du bilan réservée au directeur » : non rouverte (déjà vue le
  2026-10-22).
- Contribution du dirigeant à un atelier, et agrégats à 3 participants ou plus : le client Kora n'a pas de
  compte portail.
- Code `TYPE_DOCUMENT_REFUSE` lui-même : seuls le statut 415 et le message français ont été vus.
- Mobile dans Chrome à 375 px : impossible (largeur minimale de 654 px), fait dans le volet intégré.
- Capture d'un état périmé A-04 : la fenêtre de 8 s n'a pas été attrapée.
- Tout fournisseur réel ; tout envoi réel (aucun).

## Données de recette laissées dans `missionpilot_recfin2`

Préfixe `RECFIN2-T1` à `RECFIN2-T4` :

- avis de veille 01 à 17 ;
- créanciers 1 à 5 du dossier « Redressement Transports Akwaba (fictif) » ;
- cartographies de causes v2 et v3, validées ;
- modèle sectoriel ; dossier DD « RECFIN2-T1 DD », avec hypothèses, verdicts, note validée et document
  d'import ;
- signature de démonstration menée à 2 sur 2 ;
- plan « RECFIN2-T2 plan », avec atelier clos, modèle financier v1 validé, réalisé, re-prévision et
  explication ;
- commentaire du copilote ; rapport d'avancement validé ; mission « RECFIN2-T2 mission flash » ;
- clients « RECFIN2-T2 Filiale A et B » et leurs participations ;
- adhésion à l'observatoire, active, avec un versement vide ;
- recommandation d'efficacité ; campagne de revue à froid avec un échantillon figé ;
- sur Kora : états financiers 2022, 2023 et 2024 et un document en échec (2021) ;
- variante de méthode « Diagnostic flash (cabinet) » avec un document d'amorçage.

Prix du diagnostic flash rétabli à 1 000 000 XOF. IA du cabinet non activée.
