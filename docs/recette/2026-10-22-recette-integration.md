# Recette d'intégration du chantier « reste » — 2026-10-22

Recette navigateur de la branche d'intégration `orch/2026-10-20-reste-recette`, révision
`0270e466dfe67175fce2964be0db68d9e157a941` (merge du lot 8c). Premier passage des écrans des
nouveaux lots dans un navigateur. Aucun code modifié, rien de commité.

## Environnement

| Élément | Valeur |
| --- | --- |
| Base | `missionpilot_recfin`, neuve et dédiée (180+ migrations, `db:seed-demo` avec portail, 2FA, canaux, redressement, services candidats) |
| API | port 4110, `NODE_ENV=development`, `CONNEXION_RAPIDE_DEMO=oui`, `WEB_ORIGIN=http://localhost:3110`, WhatsApp et transcription `simule`, signature `local`, aucune clé IA, aucun SMTP |
| Web | `next build` (`API_URL=http://localhost:4110`) puis `next start -p 3110` |
| Processus | détachés, exécutable renommé `mp-recette.exe` (copie de `node.exe`) dans le scratchpad de session, arrêtés en fin de recette |
| Navigateurs | Chrome (extension) sur trois origines : `localhost` (T1), `127.0.0.1` (T2, T5), `[::1]` (T3) ; volet intégré de l'application Claude pour T4 (`localhost`, cookies séparés) |
| Testeurs | 5 agents `ui-tester` : T1 à T4 en parallèle, puis T5 seul pour les retests |

Limites de l'environnement, à garder en tête pour lire les résultats :

- Les onglets pilotés par l'extension n'étaient pas l'onglet actif de la fenêtre : rendu bridé
  (`requestAnimationFrame` mesuré à environ 1 Hz) alors que `visibilityState` est émulé à `visible`.
  Voir A-04.
- `next start` lancé avec `NODE_ENV=development` (avertissement « non-standard NODE_ENV » de Next) et
  à l'écoute de toutes les interfaces : cela a ouvert une fenêtre « Sécurité Windows » (pare-feu,
  Node.js) laissée sans réponse. Une prochaine recette passera `-H 127.0.0.1` et `NODE_ENV=production`
  au seul processus web.
- Le volet intégré (T4) n'a pas de visionneuse PDF ; le PDF en ligne a été revérifié dans Chrome (T5).
- Aucun fournisseur réel (OpenRouter, signature, messagerie, transcription) : les contenus IA sont des
  gabarits déterministes.

## Synthèse

| Parcours | Résultat | Anomalies |
| --- | --- | --- |
| Socle IA : `/brief` | passé | — |
| Socle IA : `/copilote` | passé | A-07 |
| Redressement | passé avec écarts | A-03, A-04 |
| Due diligence et portail investisseur | passé, sauf modèles sectoriels | A-02 |
| Signature 2FA (document en ligne) | passé | — |
| Méthodes : éditeur | passé | A-05 |
| Méthodes : revue à froid | passé | A-05, A-09, A-10 |
| Dossier client : Groupe, citations, état financier | passé | A-06 |
| Plans : ateliers, Monte-Carlo, plan vivant | passé | A-08, A-12 |
| Rapport d'avancement hebdomadaire et portail | passé (commentaire IA non testable sans clé) | — |
| Capitalisation : efficacité | passé | A-11 |
| Capitalisation : observatoire | **échoué** | A-01 |
| Capitalisation : veille des appels d'offres | passé | A-04 |
| Services candidats | passé (refus « sans prix » non atteignable) | A-05 |
| Paramètres IA : cache et routage | passé | — |
| Mobile 375 px (`/brief`, fiche mission, `/portail`, `/connexion`) | passé | — |

Anomalies : 1 bloquante, 3 majeures (dont A-04 à confirmer), 8 mineures. Aucune erreur 500 sur
`/api/` (journaux de l'API : aucun statut 5xx) ; aucune erreur console applicative (seules des erreurs
propres à l'extension ou au volet).

Bus d'agents : anomalies `BUG-2026-10-22-001` à `012`, état `nouveau` (`node scripts/agent-bus.cjs
list`). Aucune correction n'a été annoncée pendant la recette : pas de retest de correction.

## Anomalies

### A-01 — Observatoire inaccessible dès l'adhésion (bloquant) — `BUG-2026-10-22-001`

- Écran : `/observatoire`. Comptes : associé (Awa Koné), directeur de mission (Yao Kouassi).
- Étapes :
  1. Cabinet non adhérent. En associé, ouvrir `/observatoire`.
  2. Cocher le consentement, saisir un motif, cliquer « Adhérer à l'observatoire » (POST 201).
  3. Observer, recharger, puis refaire en directeur de mission.
- Attendu : page du cabinet contributeur, carte « Vos contributions », bouton « Verser les données du
  cabinet », message d'attente (versement pris en compte le mois suivant).
- Observé : redirection vers `/acces-refuse` (« ERREUR 403 … Votre rôle ne vous permet pas … ») à chaque
  chargement. `GET /api/observatoire/agregats` répond 403 `OBSERVATOIRE_CONTRIBUTION_REQUISE` ; la page
  (`apps/web/src/app/(app)/observatoire/page.tsx:90`) le charge par `chargerServeur`, qui redirige tout
  403 vers `/acces-refuse` (`apps/web/src/lib/api-serveur.ts:69`). Versement et retrait de l'adhésion ne
  sont proposés que sur cette page : le cabinet adhérent ne peut plus rien faire par l'interface.
- Fréquence : 6 sur 6 (T1 et T5, deux comptes).
- Captures : `captures/T1-05-observatoire-acces-refuse-apres-adhesion.jpg`,
  `captures/T5-02-observatoire-acces-refuse.jpg`.

### A-02 — Modèles sectoriels de due diligence : création impossible (majeur) — `BUG-2026-10-22-002`

- Écran : `/parametres/due-diligence/modeles`. Compte : associé.
- Étapes : secteur « Agriculture, sylviculture et pêche », analyse PESTEL, une catégorie, un point,
  « Ajouter le modèle ».
- Attendu : « Modèle ajouté à la bibliothèque », modèle applicable à un dossier.
- Observé : bandeau « Modèle refusé — Certaines valeurs ont été refusées. Vérifiez les champs
  signalés » sans aucun champ signalé ; `POST /api/dd/modeles-secteur` 400 `REQUETE_INVALIDE`,
  « Unrecognized key(s) in object: 'actif' ». Le web envoie `actif: true` à la création
  (`apps/web/src/lib/due-diligence-modeles.ts`, vers la ligne 199) ; `modeleSecteurCreationSchema`
  est strict et sans `actif` (`packages/shared/src/schemas/due-diligence.ts:751`). L'application d'un
  modèle à un dossier n'a donc pas pu être testée.
- Fréquence : 4 sur 4 (T4 et T5). Capture : `captures/T5-03-modele-sectoriel-400.jpg`.

### A-03 — Causes racines : validation réservée au directeur dans l'interface (majeur) — `BUG-2026-10-22-003`

- Écran : `/missions/02803f27-ad25-429b-9899-3c2c7ece5076/redressement/diagnostic`.
- Comptes : chef de mission (autrice), consultant non auteur, associé non directeur, directeur.
- Étapes : en chef de mission, « Demander une proposition à l'IA » ; ouvrir la page en consultant non
  auteur, puis en associé non directeur.
- Attendu : « Valider » proposé à un consultant autre que l'auteur (RED-04 dans `docs/DECISIONS.md` et
  `notes-lots/lot-2.md`, bandeau de la page « à valider par un consultant » ; `validerCauses` côté API
  n'exige que `redressement.ecrire` et refuse seulement l'auteur, sauf associé).
- Observé : seul le directeur de la mission voit « Valider » ; le bouton suit `droits.valider`
  (`redressement.valider` et réserve du directeur : `apps/api/src/redressement/dossiers.ts:166`,
  `apps/web/src/lib/redressement-droits.ts:44`, `diagnostic/page.tsx:158`). Écart entre interface, API
  et spécification, à arbitrer (corriger le code ou la règle).
- Fréquence : 3 sur 3 (T2, T5).

### A-04 — Affichage périmé après une écriture réussie (majeur provisoire, à confirmer) — `BUG-2026-10-22-004`

- Écrans : `/appels-offres/veille` (référence) ; aussi covenants, check-lists et causes racines du
  redressement, Groupe, bilan de clôture, règles de méthode, simulation Monte-Carlo, modèle financier,
  signature côté cabinet, soumission d'une note de due diligence.
- Étapes : en associé, `/appels-offres/veille`, saisir un intitulé, « Ajouter l'avis », attendre 5 s
  sans recharger, puis recharger.
- Attendu : compteur et liste à jour sans rechargement.
- Observé : message « Avis ajouté à la veille. », POST 201, `GET veille?_rsc=` 200 avec le contenu à
  jour, mais le DOM reste périmé (jusqu'à 85 s) ; une frappe clavier ou un rechargement débloque
  l'affichage. T3 a obtenu deux simulations identiques en recliquant sur une page restée vide ; T5 n'a
  créé aucun doublon en un seul clic. Les 503 sur `_rsc` signalés par l'outil réseau sont des artefacts
  (Performance API : 200 ; aucun 5xx dans les journaux de l'API ; rafales de requêtes `_rsc` par curl
  toutes en 200).
- Fréquence : 9 essais périmés sur 16 (T5) ; vu par les cinq testeurs.
- Réserve : tous les onglets étaient en arrière-plan avec un rendu bridé (voir « Environnement »). Le
  HANDOFF signalait déjà ce point « à confirmer devant un écran affiché ». À trancher sur un onglet
  réellement au premier plan, ou un profil Chrome sans extension, avant toute correction : si le défaut
  persiste, piste du commit de transition React retardé après `router.refresh()`
  (`apps/web/src/components/formulaires/useFormulaire.ts:64`).
- Capture : `captures/T5-01-veille-succes-affichage-perime.jpg`.

### A-05 — Codes techniques bruts affichés (mineur) — `BUG-2026-10-22-005`

- `/services-candidats` (business plan) : « La rubrique « solidite_plan_financement » n'a aucun exemple
  d'ancrage ».
- `/methodes/versions/<id>/apercu` : « brique:swot », « recfin_t3_a », « lu : taille = "micro" »,
  « lecture_indicateurs : saisonniere », « kpi_pertes_post_recolte ».
- `/qualite/revue-froide/echantillons/<id>` : « 8 critère(s) sans évaluation (conformite_methode,
  solidite_preuves, …) ».
- Attendu : libellés français. Fréquence : systématique.

### A-06 — Groupe : part cumulée de la société de tête fausse vue depuis une filiale (mineur) — `BUG-2026-10-22-006`

- Écran : `/dossiers/439429d2-51fc-442c-990d-27769bcec5e0/groupe` (filiale B). Compte : associé.
- Données : Akwaba détient A à 60 %, A détient B à 50 %.
- Attendu : la racine « Transports Akwaba — Niveau 0 » à 100 %. Observé : « Part cumulée : 30 % ».

### A-07 — Copilote : consigne d'expiration affichée deux fois (mineur) — `BUG-2026-10-22-007`

- Écran : `/copilote`, associé, proposition d'action laissée 5 minutes.
- Observé : « Cette proposition a expiré : reformulez… » puis « Cette proposition n'est plus valable.
  Reformulez… » (`components/copilote/CarteAction.tsx`). Capture : `captures/T1-02-copilote-reformuler.jpg`.

### A-08 — Plan vivant : devise « XOF » dans l'explication, « FCFA » à l'écran (mineur) — `BUG-2026-10-22-008`

- Écran : `/missions/<id>/plan/<planId>/plan-vivant`, directeur. Brouillon d'explication (gabarit).

### A-09 — Revue à froid : erreur « synthèse obligatoire » restée affichée (mineur) — `BUG-2026-10-22-009`

- Écran : `/qualite/revue-froide/echantillons/<id>`, expert métier. L'erreur reste affichée après la
  saisie de la synthèse, à côté du panneau « Terminer et figer cette revue ? ».

### A-10 — Revue à froid : tableau « Échantillon » qui déborde, sélecteur tronqué à 1036 px (mineur) — `BUG-2026-10-22-010`

- Écran : `/qualite/revue-froide/<campagneId>`, associé. Défilement horizontal interne, « Chois… ».

### A-11 — Efficacité : date au format ISO (mineur) — `BUG-2026-10-22-011`

- Écran : `/connaissances/efficacite`, associé : « mise en oeuvre le 2026-10-15 ».
  Capture : `captures/T1-04-efficacite-mesure.jpg`.

### A-12 — Modèle financier : bannière de validation incomplète (mineur) — `BUG-2026-10-22-012`

- Écran : `/missions/<id>/plan/<planId>/modele`, directeur. La bannière exige un validateur « autre que
  son auteur » ; le directeur valide sa propre version sans refus, conformément à la dispense de
  `apps/api/src/plans/acces.ts:108` que la bannière ne mentionne pas.

## Observations sans anomalie ouverte

- Paramètres IA : « Désactiver et vider le cache » agit sans confirmation (le code ne reconfirme que si
  l'API le demande) ; à trancher côté spécification.
- Clôture du redressement : l'associé non directeur voit « Valider le bilan » (refus expliqué au clic),
  le chef de mission voit seulement le texte de réserve. Cohérent avec les droits, traitement différent.
- Dossier clos « Redressement express » : la page Suivi permet d'enregistrer un relevé (voulu par le
  lot 2 : le suivi s'écrit mission clôturée).
- Services candidats : modification du prix sans boîte de confirmation (message « Prix fixe
  enregistré. »).
- Publication d'une version de méthode : passage à « Publiée » après quelques secondes, sans message de
  succès distinct (probablement lié à A-04).
- Page `/missions/<id>/kpi` (mission de redressement) : période par défaut « Du 1 janv. 2000 au
  23 oct. 2027 », non approfondi.
- Copilote : la conversation restaurée garde « Je propose l'action ci-dessous » sans la carte
  (cartes volontairement non restaurées, `notes-lots/lot-1.md`).

## Détail des parcours réussis (états finaux observés)

- **Brief** : nouvelles sources (offre technique à valider, plan à valider, relance prête), voyant
  rouge du redressement avec motif et lien, rejeu à une date passée (`?date=`), date invalide
  ramenée au jour ; portail redirigé vers `/portail` (403 `PORTAIL_ROUTE_INTERDITE`).
- **Copilote** : commentaire et relance après confirmation, effets visibles (commentaire sur la fiche,
  relance « Préparé, non envoyé »), deuxième relance du jour refusée, annulation, expiration et
  « Reformuler », refus sous N1 puis niveau standard N2 rétabli, conversation conservée puis effacée à
  la déconnexion et par le bouton.
- **Redressement** : réponse de check-list persistée ; modèle de check-list publié par un associé autre
  que l'autrice (l'autrice n'a pas « Publier ») ; causes brouillon IA → modifié → validé avec
  historique ; covenants v2 et trésorerie réalisée recalculées ; bilan de clôture : refus de l'associé
  non directeur, du directeur auteur, et « mission sans directeur » (409), validation par le directeur
  d'une version établie par le chef de mission, rapports PDF et Word ; 403 propres pour ressources et
  gestionnaire, 404 sur le fichier du rapport.
- **Due diligence** : dossier, hypothèse (verdict validé par une autre personne), note soumise puis
  validée par un associé, rapport PDF ; option portail investisseur activée, investisseur invité, note
  non validée non publiable (409 `NOTE_NON_VALIDEE`), publication visible en portail investisseur avec sa
  pièce PDF ; investisseur sans accès aux dossiers internes ni à « Avancement ».
- **Signature 2FA** : connexion rapide refusée aux comptes 2FA ; code faux refusé ; signature refusée
  sans consultation (409) ; signature des deux parties, statut « Signée · 2 sur 2 », chaîne de preuves
  complète ; document servi `inline` et affiché dans la visionneuse PDF de Chrome
  (`captures/T5-04-signature-document-en-ligne.png`, capture du bureau entier : ne pas la publier telle
  quelle).
- **Méthodes** : variante du cabinet, élément modifié, règles contradictoires bloquant la publication,
  aperçu de mission, publication confirmée, notes de version exigées, auteur ≠ publieur pour l'expert ;
  consultant en lecture seule.
- **Revue à froid** : campagne, tirage reproductible (empreinte), relecteur non indépendant refusé,
  grille et constat, synthèse exigée, revue figée « Conforme avec réserves », action créée et close par
  son seul responsable.
- **Dossier client** : participation et conversion EUR → XOF à 655,957 (totaux vérifiés), cycle refusé
  sans écriture, citations [n] sur notation et plan et page de citation, 404 propre sur preuve inconnue,
  rapport d'état financier PDF et Word.
- **Plans** : atelier (bornes, ouverture après invitation), contribution du dirigeant au portail avec
  refus des répartitions hors règle, participation 100 %, agrégats masqués sous 3 participants, résultats
  vote et Borda vérifiés avec 3 contributeurs, non-invités refusés ; Monte-Carlo borné, « Rejouer à
  l'identique » même empreinte ; plan vivant : réalisé, re-prévision et écarts vérifiés.
- **Rapport d'avancement** : préparation, enregistrement, validation confirmée puis figée (409
  `RAPPORT_VALIDE`) ; brouillon invisible au portail (404), rapport validé visible du dirigeant et du
  contributeur sans donnée financière interne ; investisseur et consultant refusés.
- **Capitalisation** : recommandation d'efficacité, mise en œuvre et mesure ; veille : import CSV avec
  ligne 4 en erreur, réimport sans doublon, rapprochement expliqué, avis retenu, fiche d'appel d'offres
  créée, saisie manuelle ; refus pour ressources et portail.
- **Services candidats** : prix modifié et persistant, mission créée avec sa méthode, guichets fictifs
  et rapprochement, lien « Proposer un diagnostic flash » prérempli depuis la fiche client ; consultant
  et ressources en lecture seule.
- **Paramètres IA** : cache activé puis désactivé et vidé (persistance vérifiée), routage visible ;
  consultant redirigé vers `/acces-refuse`.
- **Mobile 375 px** : `scrollWidth = innerWidth = 375` sur les quatre écrans, navigation utilisable.

## Non vérifié, et pourquoi

- Commentaire IA du rapport d'avancement et refus 409 `COMMENTAIRE_IA_A_RELIRE` : sans clé, la
  suggestion n'est pas produite (repli silencieux prévu) ; aucune clé ne devait être saisie.
- Refus d'activation du diagnostic flash sans prix : le seed pose un prix et active le type ; le cas
  n'est atteignable qu'en supprimant ce prix, écarté.
- Accès aux agrégats de l'observatoire après contribution : exige un versement retenu d'un mois
  précédent, et bloqué par A-01.
- Application d'un modèle sectoriel à un dossier : bloquée par A-02.
- Re-notation comparée de la clôture : aucune notation publiée deux fois.
- Modification d'une rubrique à ancrages dans l'éditeur de méthodes : la méthode modifiée n'en a pas.
- Ateliers avec les comptes 2FA, initiatives et feuille de route du plan : hors du temps de recette.
- A-04 sur un onglet réellement au premier plan (voir « Environnement »).
- Tout fournisseur réel ; tout envoi réel (aucun).

## Données de recette laissées dans `missionpilot_recfin`

Préfixe `RECFIN-T1` à `RECFIN-T5` : commentaire et relance du copilote, restrictions d'agent (état
final N2), adhésion à l'observatoire avec un versement vide, avis de veille et une fiche d'appel
d'offres, offre technique, recommandation d'efficacité ; modèle de check-list publié, cartographies de
causes v2 (validée) et v3 (brouillon), covenants v2 à v4, plans de financement v2 et v3, réalisé de
trésorerie, bilans de clôture et rapports ; prix du diagnostic flash passé à 1 200 000 XOF, mission
« RECFIN-T2 Diagnostic flash » (sans directeur) ; clients « RECFIN-T2 Filiale A et B » et
participations ; variantes de méthode, campagne de revue à froid ; plans, ateliers, simulations,
re-prévision ; dossier de due diligence, notes, publication investisseur ; rapport d'avancement validé ;
signature de démonstration menée à 2 sur 2. Réglages modifiés : IA du cabinet activée (sans clé),
option portail investisseur activée.
