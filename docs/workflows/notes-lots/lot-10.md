# Lot 10 : corrections des anomalies de la recette navigateur du 2026-10-22

Corrections des anomalies A-01 à A-12 de la recette d'intégration (rapport
`docs/recette/2026-10-22-recette-integration.md` de la branche de recette, fiches
`BUG-2026-10-22-001` à `012` du bus d'agents), plus une dette de commentaire et trois tests API
sensibles à la charge. Aucune migration, aucun changement de l'API ni de `docs/DECISIONS.md`.

## Correctifs

- **A-01 (bloquant).** `appelerApiServeur` et `chargerServeur` (`apps/web/src/lib/api-serveur.ts`)
  acceptent une liste opt-in `codes403Metier` : un 403 dont le code y figure ne redirige plus vers
  `/acces-refuse` et devient `{ ok: false, message, statut, code }`. `TFA_A_CONFIGURER`,
  `PORTAIL_ROUTE_INTERDITE`, `INTERDIT` et tout code non listé gardent leur redirection. La page
  `/observatoire` tolère `OBSERVATOIRE_CONTRIBUTION_REQUISE` (et `OBSERVATOIRE_RESERVE_ADHERENTS`) sur les
  agrégats : message de l'API en information, puis « Vos contributions » (versement) et retrait
  d'adhésion toujours proposés. Audit des autres pages : les seuls 403 métier sur des routes GET sont
  ces deux codes de l'observatoire ; tous les autres 403 à code métier sont sur des écritures.
- **A-02.** La création d'un modèle sectoriel DD n'envoie plus `actif` (le schéma de création est strict,
  seule la nouvelle version l'accepte ; le modèle naît actif : `DEFAULT true`, migration 0511). Tests web
  et API (`apps/api/test/dd-modeles.test.ts`).
- **A-03.** `validationCauses` (`apps/web/src/lib/redressement-droits.ts`) reproduit `validerCauses` de
  l'API : droit d'écriture, version au brouillon, refus de quiconque figure dans l'historique de la
  version (auteur d'un rang), sauf l'associé. « Valider » est visible pour tout utilisateur que l'API
  autoriserait ; pour l'auteur il est désactivé avec une explication visible. `droits.valider` (bilan de
  clôture, covenants) est inchangé.
- **A-04 (à confirmer).** Voir ci-dessous.
- **A-05.** Table de libellés et replis lisibles (`apps/web/src/lib/codes-lisibles.ts`) : rubriques de
  services candidats, clés de l'aperçu de méthode (briques, règles, lectures, cibles, recommandations)
  construites depuis les données de la méthode, codes de critères de la revue à froid. Le repli pour un
  code inconnu remplace les soulignés par des espaces. Limite : une règle de méthode sans `libelle` garde
  un repli sans accents (par exemple « Recfin t3 a »). Le journal de modulation partagé change aussi
  d'affichage dans le simulateur et la page des missions de méthode.
- **A-06.** Défaut d'affichage. Le moteur est juste : vu depuis la filiale B, la part cumulée d'un
  détenteur est sa part dans B (60 % x 50 % = 30 % pour la société de tête). La vue « depuis la tête »
  (`aplatirStructure`, `apps/web/src/lib/dossier-groupes.ts`) réutilisait ce détenteur comme racine en
  forçant le niveau 0, donc affichait 30 %. La racine affiche maintenant 100 % (part directe vide). Le
  champ API `structure.tete` est inchangé (valide en vue « client »).
- **A-07.** La ligne d'expiration est masquée quand la consigne de reprise (« Reformuler ») est affichée
  (`afficherLigneExpiration`).
- **A-08.** `libelleDeviseAffichage` (`apps/api/src/plans/reprevision-explication.ts`) : XOF et XAF
  s'écrivent « FCFA » dans le texte de l'explication (les codes stockés ne changent pas).
- **A-09.** L'erreur de synthèse disparaît dès que la synthèse est modifiée ou que le panneau de
  confirmation s'ouvre.
- **A-10.** Règles CSS propres à la section « Échantillon » (`froide.css`) : cellules à la ligne, sélecteur
  du relecteur à pleine largeur. Justifié par lecture du CSS, non revérifié dans un navigateur.
- **A-11.** La mise en oeuvre d'une recommandation s'affiche avec `formaterDate` (« 15 oct. 2026 », le
  format commun de l'application) et non plus en ISO. Écart avec le brief, qui citait JJ/MM/AAAA : un
  formateur numérique reste à ajouter dans `format.ts` si on le veut strictement.
- **A-12.** La bannière de validation du modèle financier précise que l'associé et le directeur de la
  mission peuvent valider leur propre version (`TEXTE_REGLE_VALIDATION_MODELE`).
- **Dette.** Le commentaire de `apps/api/src/qualite/froide-revue.ts` dit « MQQ01 à MQQ13 (migrations
  0287 à 0290) » (MQQ13 est dans 0290). La migration 0287 n'est pas touchée.

## A-04 : affichage périmé après une écriture

Lecture de Next 15.5.27 (`app-router-instance.js`) :

- `router.refresh()` s'exécute déjà dans un `startTransition` ; l'envelopper ne change rien.
- Deux rafraîchissements rapprochés ne sont pas perdus (mis en file). Seule une navigation concurrente
  marque l'action en cours comme abandonnée. L'hypothèse « rafraîchissement abandonné par Next » des
  anciens hooks n'est donc pas étayée.
- Mécanisme plausible : le commit de la transition (RSC reçu en 200) est ordonnancé à basse priorité,
  alors que les mises à jour urgentes du composant (message de succès, fin d'envoi) s'affichent aussitôt ;
  sur un onglet bridé (environ 1 Hz) l'écran reste périmé. Une frappe (événement urgent) le débloque.
  Non prouvé.
- Aucun `useState(props)` masquant de nouvelles données n'a été trouvé dans les écrans cités.

Correctif général : `apps/web/src/components/formulaires/useRafraichir.ts` (rafraîchissement dans la
transition du composant, `enAttente` jusqu'à l'arrivée des données, une relance à 1,5 s, abandon à 8 s,
tests). `useFormulaire`, `useAttenteRafraichissement`, `useFermetureDifferee` l'utilisent, et les 70
fichiers qui appelaient `router.refresh()` en direct ont été migrés (sauf `FormulaireConnexion`,
volontairement).

- Plafond réel de l'attente : 8 s. Sans `cle`, `enAttente` suit la transition React mais un état
  `abandonne` posé à 8 s la lève même si la requête RSC n'a pas répondu (remis à zéro à chaque nouveau
  `rafraichir`) ; avec `cle`, l'attente tombe au changement de `cle` ou à 8 s.
- Plusieurs instances du hook dans un même composant (ActionsProposition, GrilleTemps, ActionsGrille,
  ParcoursRevue, ValiderItemBanque, ActivationKpi, NotationDiagnostic, PartagePlan,
  RecalageFeuilleDeRoute, ValidationVersionModele, ElementPlanCarte) : la relance à 1,5 s est
  dédoublonnée au niveau du module (`autoriserRelance`, une relance par fenêtre de 500 ms ; une seule
  requête `_rsc` de relance par page, `router.refresh()` rechargeant toute la page). Les transitions des
  autres instances restent en cours et aboutissent avec la même réponse.
- Conflit éventuel avec le lot 6 : `apps/web/src/components/dossier/ImportEtat.tsx` (import d'états
  financiers, périmètre du lot 6) a reçu UNIQUEMENT ce changement de 3 lignes : import de `useRafraichir`
  à la place de `useRouter`, `const { rafraichir } = useRafraichir();`, `rafraichir()` à la place de
  `router.refresh()`.
- Le projet n'a pas de jsdom : seul le noyau pur du hook est testé.

À confirmer sur un onglet visible au premier plan (ou un profil Chrome sans extension) :

1. A-04 : après « Ajouter l'avis » sur `/appels-offres/veille`, la liste se met à jour en moins d'une
   seconde (16 essais) ; si le défaut persiste, la cause est ailleurs (navigation concurrente, `loading.tsx`
   / Suspense).
2. Aucun bouton verrouillé plus que la durée du chargement des données.
3. Pas de rafale de requêtes `_rsc` due à la relance de 1,5 s (au plus une par page).
4. A-10 : plus de défilement horizontal ni de sélecteur tronqué à 1036 px.
5. A-01 : parcours complet de l'observatoire après adhésion (versement, retrait).

## Tests API sensibles à la charge

- `redressement-cloture.test.ts` (PDF sans navigateur) : la lenteur venait du lancement d'un vrai Chrome
  (repli sous Windows quand `CHROMIUM_PATH` est absent). Le test pose temporairement
  `NODE_ENV = production` sans `CHROMIUM_PATH` (restauré en `finally`), le refus 503 est immédiat,
  timeout 90 s. L'assertion `[201, 503]` est resserrée à `503`, conforme au titre.
- `signatures-routes.test.ts` : les horodatages du test ne sont pas en cause. `ajouterPreuve`
  (`apps/api/src/canaux/preuves.ts`) lisait `clock_timestamp()` puis faisait l'INSERT dans une seconde
  requête ; le déclencheur de la migration 0547 (inchangée) refuse un écart de plus de 5 s. Un processus
  affamé de CPU entre les deux dépassait la fenêtre (409 `PREUVE_IMMUABLE`, reproduit sous charge).
  Correctif API (décision du superviseur) : l'horodatage entre dans l'empreinte calculée côté API, il ne
  peut donc pas être pris dans l'INSERT lui-même ; l'INSERT est protégé par un point de sauvegarde et,
  si le déclencheur refuse l'horodatage (MPH10 « horodatage »), il est rejoué avec une horloge relue
  (3 essais au plus). Les autres refus MPH10 (rang, empreinte) ne sont pas rejoués. Test de non-régression
  (`journal de preuves`) : un `pg_sleep(5,5 s)` est injecté avant le premier INSERT ; sans le rejeu le test
  échoue, avec il passe. Le `retry: 2` des `describe` est retiré ; les dates restent dérivées de la base.
- `kpi-alertes.test.ts` : échec non reproduit en 14 exécutions sous charge. Le message vient du courriel
  de rappel (envoyé par le worker après la transaction du job) absent au moment de l'assertion. Timeout
  90 s et attente bornée (30 s).
- Ne pas lancer plus de 3 ou 4 suites API en parallèle sur ce PostgreSQL (erreur 53200,
  `max_locks_per_transaction`, dans le global-setup).
