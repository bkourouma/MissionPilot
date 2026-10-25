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
si possible, une recherche mécanique qui repère l'écart. Relevé tête finale du 2026-10-23 (super admin) : voir « Recherches
mécaniques », il remplace les lignes qui changent du relevé suivant. Le relevé tête finale du 2026-10-24 (Tenant démo)
remplace celui du 2026-10-23 pour les lignes qui changent (n° 1, 3, 8, 9 et 11) : relevé du 2026-10-24, branche orch/2026-10-24-tenant-demo. Les nombres attendus
ont été relevés le 2026-10-23 en lançant les commandes ci-dessous dans la copie de travail
`reste-lot-9g` (branche d'intégration finale, HEAD `fe24b89` = fusion du lot 13b, tous les lots fusionnés, documentation des
lots 9a à 9f reportée) : `main`, identique à
`origin/main` (merge commit `3d5a252`, PR n° 14, vague 4 fusionnée), plus les lots 1 (socle IA),
2 (redressement 3a-bis), 3 (due diligence 3b-bis, canaux 3c-bis), 4a (méthodes et revue à froide),
4b (dossier, preuves, finance), 4c (rapport d'avancement hebdomadaire, cache et plafonds IA,
contradicteur), 5a (plans et notation augmentés), 5b (capitalisation, observatoire,
veille des appels d'offres), 7 (services candidats), 8a (CI), 8b (dettes transverses : voyant
rouge du brief, revue à froide paginée, ateliers, rejeux Monte-Carlo, `paramsId` strict, pages de 500)
8c (découpage de 34 fichiers web), 6 (ingestion de documents : ADR-009, DOS-03, DD-02, DD-10, STD-13),
10 (corrections de la recette navigateur : hook `useRafraichir`, `codes403Metier`, horodatage des
preuves rejoué), 12 (derniers `router.refresh()`, `next` 15.5.28, `fastify` 5.12.6), 11 (OCR local
`tesseract.js`, migrations `0525`–`0526`), 13a (débloqueur de rendu `DebloqueurRendu`, écrans périmés A-04, R-01, R-02) et
13b (corrections de la recette finale R-03 à R-09 : état des notes de due diligence, signal de réveil du worker de jobs,
libellés) du chantier du 2026-10-20, non encore fusionnés dans `main`. Les valeurs de `main` restent entre parenthèses quand
elles expliquent un écart ; un autre résultat est un écart à expliquer, pas à ignorer. Les attendus
ne valent pour `main` qu'après la fusion de cette branche. Détail des mécanismes :
`docs/governance/SECURITY.md` et `docs/governance/CODING_STANDARDS.md`.

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
  `test/portail-acces.test.ts` (inventaire des routes enregistrées). **Toute
  route ajoutée à la liste met à jour cet inventaire ET l'inventaire de
  SECURITY.md §4 bis** ; le 2026-10-22 la liste compte, en plus de `main`, trois
  routes de l'investisseur (`GET`/`HEAD /api/portail/due-diligence/publications`,
  `…/publications/:id`, `…/publications/:id/pieces/:pieceId/fichier`, lot 3),
  trois routes d'ateliers (`GET /api/portail/ateliers`, `…/ateliers/:id`,
  `PUT …/ateliers/:id/contribution/:methode`, lot 5a) et deux routes de
  lecture des rapports d'avancement VALIDÉS (`GET`/`HEAD /api/portail/avancement`,
  `…/avancement/:id`, lot 4c, permission `portail.avancement.lire`) ; le
  redressement, la revue à froide, les groupes et le contradicteur
  (`/api/agents/revues-contradictoires`) n'en ont aucune (403 testé).
- **`horsContextePortail`** (`portail/contexte.ts`) : unique sortie du contexte
  RLS du portail, réservée à un traitement interne qui ne renvoie rien au
  client ; **cinq fichiers l'emploient au 2026-10-21** (`salle-mission/accuses.ts`,
  `routes/portail-kpi.ts`, `routes/portail-canaux.ts`, `routes/portail-signatures.ts`,
  `routes/due-diligence-portail-investisseur.ts`, ce dernier pour le téléchargement
  d'une pièce après contrôle dans `avecPortail`) ; tout nouvel usage met à jour
  l'inventaire de `test/portail-contexte.test.ts`.
- **Portail investisseur de la due diligence** (DD, lot 3 ; migration `0509`,
  `routes/due-diligence-portail*.ts`) : option du cabinet DÉSACTIVÉE par défaut ;
  cinq tables `dd_portail_*` en ajout seul, politique RESTRICTIVE `portail`
  (SELECT) + `portail_sans_insert/update/delete` ; `dd_notes`, `dd_note_versions`,
  `dd_dossiers`, `rapports_mission` restent `portail_interdit` ; aucun identifiant
  de dossier, de note, de mission ou de rapport, aucun nom de membre du cabinet,
  aucun coût n'est servi. Une politique à `NOT EXISTS (retraits)` laisse tout passer
  si la table des retraits est invisible du portail : les retraits portent le
  `client_id` de leur publication (`MQD06`). Partage réservé à `dd.portail.gerer`
  (associé, directeur de mission), option à `dd.portail.configurer` (associé seul).
- **Aucun accès à la base hors `withTenant` / `withoutTenant`**
  (`apps/api/src/db/pool.ts`). `withoutTenant` n'appelle que des fonctions
  `SECURITY DEFINER` étroites (`trouver_connexion`, `resoudre_session`…).
- **Signal de réveil du worker de jobs** (lot 13b, R-08 ; `apps/api/src/jobs/reveil.ts`, `jobs/worker.ts`) : tout code
  qui met un job en file appelle `signalerJobCree()` APRÈS le COMMIT de sa transaction, jamais dedans (le worker lirait
  avant la validation : le cycle de réveil, 400 ms, reviendrait vide). Un cycle déclenché par signal qui revient vide
  programme UN seul rattrapage à 2 s, puis le worker retombe à l'intervalle normal (30 s) ; un cycle utile est suivi d'un
  cycle à 1 s ; deux cycles ne tournent jamais en parallèle ; `arreter()` se désabonne. Le signal est LOCAL au processus
  (un worker d'un autre processus garde 30 s). Attendu : `signalerJobCree()` appelé en trois endroits seulement
  (`ingestion/documents.ts` `creerDocument`, `routes/ingestion-dd.ts`, `routes/ingestion-standard.ts`), jamais dans
  `mettreEnFileExtraction` ni `mettreEnFileStructuration` (recherche n° 30). `reserver_job_a` (équité par cabinet) et les
  migrations sont inchangés : aucune scrutation rapide permanente.
- **Toute nouvelle fonction `SECURITY DEFINER`** : `SET search_path = public,
  pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` au rôle applicatif
  seul (modèles `0001_socle.sql`, `0120_limiteur_tentatives.sql`), paramètres
  validés, et rien de plus que ce que l'appelant connaît déjà (modèle
  `notification_existe`, `0114`). Les fonctions de déclencheur (`garder_*`,
  `controler_*`) portent aussi `SET search_path = public, pg_temp` (modèle : les
  quatre `garder_*` de `0275`). Une fonction `SECURITY DEFINER` non accordée au
  rôle applicatif (internes de `0275` : `rejeu_controler_job`,
  `rejeu_demande_verrouillee`, `rejeu_controler_fin`) n'ajoute pas de ligne à la
  recherche n° 16.
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
  Un événement publié par la base (déclencheur SQL, `0302`, `0303`) est non bloquant,
  idempotent par clé (`0303` : mission ET horodatage du passage, avec une anti-répétition de
  10 minutes par mission), jamais publié depuis le portail ;
  un événement sans personne à son origine (source `base` ou `detection`) refuse le mode
  `declencheur` (`DECLENCHEUR_ABSENT`, `SOURCES_AVEC_PERSONNE`,
  `automatisation/definitions.ts`).
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
  publication d'une proposition au standard (`standard/propositions.ts`), et la validation d'un brouillon
  d'ingestion (`MQG02`, `ingestion/extractions.ts`, voir « Ingestion de documents »). Le
  contrôle API et le déclencheur disent la même règle, avec le même test de refus.
  **Séparations ajoutées par les lots du 2026-10-20**, les deux premières doublées en
  base : relecteur d'une revue à froide
  (QUA-05) indépendant, c'est-à-dire ni directeur, chef, membre d'équipe, affecté du
  planning, créateur, clôtureur ou signataire de la mission, ni auteur, ouvreur,
  valideur, signataire ou attestateur de son suivi qualité (`MQQ03`, `MQQ07`,
  déclencheur `qualite_froide_violations()` de `0287` ET moteur
  `evaluerIndependanceRelecteur` : deux implémentations alignées, un seul test de
  refus) ; validation d'un plan de redressement ET de son bilan de clôture réservée
  au directeur de la mission, une mission sans directeur ne valide ni l'un ni l'autre
  (409 `DIRECTEUR_REQUIS`, base `MPZ07`, `0492`, `redressement/plan.ts`) ;
  publication d'un modèle de check-list de redressement par un expert qui n'en est
  pas l'auteur sauf associé (`redressement/checklists*.ts`) ; validation de la
  cartographie des causes par un consultant ni demandeur ni auteur sauf associé
  (`redressement/causes.ts` : à relire, base non confirmée par la note du lot). Le brief n'exempte aucun associé : l'auteur est toujours exclu
  de ce qu'il doit valider (`brief/`).
  **Circuit de validation d'un contenu IA ou d'une offre** : valideur ≠ demandeur ≠
  auteur, sauf associé, doublé en base ; modèles : offre technique (valideur ni
  créateur, ni auteur d'une version, ni demandeur de la génération : `MPW05`, `0385`,
  `banque-ao/offres-techniques.ts`), clôture (qui a accordé une dérogation en vigueur
  ne clôt pas : `MPX03`, `0323`, `cloture/evaluation.ts`), salle de mission (qui a
  déposé n'accepte pas : `MPL09`, `0332`, `salle-mission/decisions.ts`). Une
  exception explicite se justifie par le PRD (le chef valide la version IA du retour
  d'expérience qu'il a demandée, `capitalisation/retours.ts`, `MPJ08`).
- **Contenu IA** : passe par l'orchestrateur (`ia/orchestrateur.ts`), SANS exception :
  le routage du copilote utilise lui aussi son point d'entrée `admettreSansDemande` /
  `appelerSansDemande` (aucun import de `fournisseurDepuisConfig` dans
  `apps/api/src/copilote/`, inventaire dans `test/copilote-masquage-noms.test.ts`) ; le
  fournisseur n'est appelé que depuis l'orchestrateur (et le rejeu
  `agents/evaluations-openrouter.ts`) ; dans `redressement/`, seul `causes-ia.ts` importe
  `ia/` (`test/redressement-sans-ia.test.ts`) ; la
  liste blanche de chiffres est construite par le code depuis les moteurs,
  jamais reçue d'une requête ; seul un contenu validé (et jamais un essai sur
  prompt « exemple ») est livrable au client (`ia/generations.ts`) ; la clé
  API n'est ni renvoyée ni journalisée (`ia/parametres.ts`).
- **Une évaluation de non-régression qui active un prompt (ou un modèle, ou autorise un
  agent) en production vient d'un appel réel, provenance vérifiée en base** : une
  évaluation `fournisseur = 'openrouter'` n'existe que née d'une demande de rejeu en
  cours (`agents_evaluations_demandes`) avec ses appels réussis inscrits dans
  `ia_consommations` (`CHECK` et déclencheur `MPG09`, migration `0270`). Depuis `0275`
  l'INSERT de l'évaluation `openrouter` n'est plus écrit par le code TypeScript : il est
  fait par la fonction `SECURITY DEFINER` `rejeu_evaluation_terminer`, appelée sous garde
  du job `agents_evaluation_openrouter` (`agents/evaluations-openrouter.ts`, qui ne contient
  plus d'`INSERT INTO agents_evaluations`), avec `rejeu_evaluation_demarrer` et
  `rejeu_evaluation_inscrire_appel` ; le rôle applicatif n'a plus qu'un INSERT limité aux
  12 colonnes d'une évaluation locale, celui de `agents_evaluations_demandes` à 8
  colonnes et son UPDATE à `statut`, `cause`, `termine_le`, `job_id` (SQLSTATE
  `MPG12` à `MPG15`) ; `POST /agents/evaluations` n'enregistre que `local`
  (`agents/evaluations.ts`). Le rejeu ne refait jamais un appel payant
  (`tentatives_max = 1`), respecte les plafonds (par évaluation, mensuel du cabinet) et
  ses coûts et jetons sont ABSENTS sans `finance.lire`. Un test qui a besoin d'une
  évaluation réelle la sème par `apps/api/test/evaluation-reelle.ts`, jamais par un
  `INSERT` « openrouter » forgé. Limite connue : du SQL arbitraire à plusieurs
  instructions du même rôle applicatif peut encore forger un rejeu (SECURITY.md §15).
  Recherche n° 21 : UNE ligne.
- **Une action proposée par un agent conversationnel n'est jamais exécutée sans
  confirmation à usage unique, à un niveau d'autonomie ≥ N2** (copilote, AGT-08) : le
  modèle ne reçoit AUCUNE donnée du cabinet ni du client (seulement le message masqué et le
  catalogue des outils PERMIS) et ne renvoie qu'un choix `{ outil, parametres }` validé par
  un schéma strict sur liste fermée ; la réponse vient de gabarits déterministes, jamais du
  texte du modèle (`copilote/routage-ia.ts`, `copilote/service.ts`), les noms CONNUS du
  cabinet étant masqués avant envoi (`copilote/noms-propres.ts`, liste de tables
  constante) ; l'action modifiante
  s'inscrit comme PROPOSITION (`copilote_actions`, `0271` : empreinte SHA-256, expiration
  5 minutes, états terminaux figés `MPG10-11`) et n'est exécutée que par la route de
  confirmation, pour le MÊME utilisateur (404 pour un autre), une fois (ligne verrouillée,
  statut `proposee` exigé), permissions revérifiées, niveau effectif de l'agent ≥ N2 (409
  `COPILOTE_ACTION_NON_AUTORISEE`), puis par le service commun du module concerné
  (`collaboration/taches.ts`), jamais par un `INSERT` direct (`copilote/actions.ts`). Une
  nouvelle action du copilote = une entrée de `ACTIONS` ET du catalogue du moteur, avec test
  (trois actions au 2026-10-21 : `creer_tache`, `ajouter_commentaire`, `planifier_relance`).
  `planifier_relance` : relance manuelle sans e-mail au client, une par facture et par jour,
  règle REVÉRIFIÉE à la confirmation sous verrou consultatif par facture (409
  `RELANCE_DEJA_ENREGISTREE`, `copilote/action-relance.ts`).
  Le journal ne contient jamais le texte du message. Un compte du portail n'est jamais
  assignable ni mentionnable (`authDe`, `collaboration/entites.ts`).
- **Plafond de débit** : compté sur `journal_audit` dans la transaction qui l'inscrit, sous
  verrou consultatif (modèles `routes/factures-pdf.ts`, `copilote/limites.ts`). **Un plafond
  tenu en mémoire est une exception documentée au modèle `journal_audit`** : il n'y en a plus
  aucune depuis le lot 1 du 2026-10-20 (`GET /api/brief`, `brief/debit.ts`, passe par le
  limiteur persistant : espace `brief_requetes`, 60 requêtes par 10 minutes et par utilisateur,
  compteur partagé entre instances, migration `0550`) ; toute nouvelle exception se justifie
  par écrit (une lecture répétée par la page d'accueil, jamais un acte sensible) et se
  déclare au §15 de SECURITY.md.
- **Limiteur persistant** (`auth/limiteur.ts`, `tentatives_auth_regles` : règles fixées EN
  BASE, modèles `0120`, `0544`, `0550_brief_limiteur.sql`) : le migrateur applique les
  fichiers par ordre de nom, la DERNIÈRE définition l'emporte. Toute redéfinition de
  `tentatives_auth_regles` porte donc un numéro SUPÉRIEUR au dernier qui la redéfinit (au
  2026-10-21 : `0550`) et reprend À L'IDENTIQUE les six espaces en vigueur (`connexion`,
  `reauth`, `facteur`, `webhook_canal`, `webhook_invalide`, `brief_requetes`) ; ni `0306` ni
  un numéro inférieur à `0550` ne peuvent la redéfinir (`0544` l'écraserait). Un espace de
  plus s'ajoute à `EspaceLimiteur` ET à la fonction ; un test compare les constantes du code
  aux règles de la base.
- **Brief quotidien** (AUT-07, `apps/api/src/brief/`) : calcul déterministe sans IA ; chaque
  source n'est lue que sous la permission de l'action qu'elle propose ET la visibilité des
  missions, ne propose pas à l'auteur ce qu'il doit valider (séparation des tâches), ne porte
  aucun montant sans `finance.lire` (FIN-02) et ne recopie aucun contenu client ; AUCUN
  associé n'est exempté de la séparation des tâches (plus strict que les routes) ; une
  révision de budget non figée est « à valider », un jalon dépassé fait une mission « en
  retard » ; une source à
  filtre final en code marque sa famille « tronquée » (`enSourceFiltree`) plutôt que de gonfler
  le total. Un type d'élément de plus : le moteur (`packages/engines/src/brief`), le schéma
  (`schemas/brief.ts`), une source et leurs tests (31 types en trois familles, 30 sources au
  2026-10-22). **Une source défaillante est isolée, elle ne met pas la requête entière en 500** :
  toute source qui appelle un moteur ou une lecture pouvant lever une erreur métier
  (`ErreurRedressement`) l'attrape dossier par dossier (élément ignoré, source marquée
  `interrompue`, famille tronquée) et borne le nombre d'évaluations par requête (modèle
  `voyantsRedressementRouges`, `brief/derives.ts` : 50 dossiers lus, `PLAFOND_EVALUATIONS_VOYANT` = 20
  évalués) ; le voyant rouge (`voyant_rouge`) est derrière `redressement.lire` ET la visibilité de la
  mission, ne lit pas les dossiers clos, et n'expose AUCUN montant ni devise même avec `finance.lire`
  (libellés de motifs critiques seulement).
- **Redressement** (service #5, lots 3a et 3a-bis ; `apps/api/src/redressement/`, `routes/redressement*.ts`,
  migrations `0480`–`0492` et `0551`, moteur `packages/engines/src/redressement`) : **30 tables** à RLS
  (15 du 3a, 15 du 3a-bis : `0487`–`0491`), `isolation`
  et RESTRICTIVE `portail_interdit`, FK composites `(cabinet_id, dossier_id, id)` (un enfant ne vise jamais
  le parent d'un autre dossier) ; **aucune route dans `LISTE_BLANCHE_PORTAIL`** et aucune fonction
  `SECURITY DEFINER` (la recherche n° 16 n'en compte aucune pour `0480`–`0492`). Chaque route résout l'identifiant reçu (dossier, créancier,
  action, version, seuils) PUIS la visibilité de la mission et répond le même 404 ; le verrou de dossier est
  pris AVANT toute lecture dont dépend une règle. **Séparation des tâches** : validation d'une version de plan
  et du bilan de clôture RÉSERVÉE au directeur de la mission (une mission sans directeur ne valide ni
  l'un ni l'autre : 409 `DIRECTEUR_REQUIS`, doublé en base par `0492`, `MPZ07` avec message distinct), le
  valideur restant ≠ créateur sauf associé, et publication de seuils (publieur ≠ auteur sauf associé, rôle
  `expert_metier` ou associé), à l'API ET en base (`MPZ07`), avec le même test de refus ; l'associé n'est
  dispensé que par `red_valideur_dispense`. Les tables du suivi post-mission (`0491`) exigent au contraire
  un dossier CLOS (`MPZ19`) et s'écrivent même mission clôturée (exception voulue) ; leurs alertes sont
  calculées à la lecture (aucun job, aucun envoi, aucun accès du portail). **FIN-02 traduit** : aucune donnée du cabinet (honoraires, budget,
  coûts, taux, marge) dans une réponse ni aucune jointure vers `budgets`, `factures`, `collaborateur_couts` ;
  les montants du client relèvent de `redressement.lire`, pas de `finance.lire` (test
  `redressement-fin02.test.ts`, le gestionnaire reçoit 403). **Aucun job, aucun calcul hors
  moteur, IA par un SEUL fichier** (`redressement/causes-ia.ts` → `ia/orchestrateur.ts`, jamais un
  fournisseur ; contexte réduit à des chiffres de moteur et des noms masqués ; une cartographie non
  validée n'entre jamais dans le rapport de clôture ; `redressement-sans-ia.test.ts` impose les deux
  et interdit `SUM(`, `AVG(`, `Math.round`, `toFixed(`) ; sommes en
  `BigInt`, `SOMME_HORS_LIMITES` traduit en 400. **Aucune qualification juridique** : ni « cessation des
  paiements », ni « faillite », ni « défaillance » dans une sortie du moteur ou un libellé ; la mention
  « indicatif » du score est fixe. Le journal d'audit, les notifications et les messages d'erreur ne portent ni
  montant, ni nom de créancier, ni condition de négociation, ni titre d'action, ni motif. Les ratios, la
  situation d'un créancier et l'avancement du plan se calculent à LA LECTURE et ne se stockent pas (seuls un
  score avec ses entrées et ses seuils, et l'impact d'un levier avec ses paramètres, sont des instantanés).
  Historiques en ajout seul (`MPZ01`) ; plafonds de volume dans les déclencheurs (`MPZ10`, `MPZ11`) ET en
  `LIMIT` littéral dans `redressement/` (recherche n° 7), débits (urgences, scores, versions de trésorerie)
  comptés sur `journal_audit` sous verrou consultatif. SQLSTATE : lettre `Z`, `MPZ01`–`MPZ20` employés
  (`MPZ12`–`MPZ20` par `0487`–`0491` ; `0492` réutilise `MPZ07`), `MPZ21`–`MPZ32` à la due diligence : la lettre
  est épuisée pour le redressement. Plan à relire : la validation recalcule l'empreinte depuis les actions actuelles
  (`RED_PLAN_MODIFIE`), `contenu` n'est jamais reçu d'un client.
- **Ateliers en ligne des plans** (PLA-15, lot 5a ; `0425`–`0426`, `routes/plans-ateliers.ts`,
  `routes/portail-ateliers.ts`) : `plan_ateliers`, `_options`, `_participants` en `portail` SELECT +
  `portail_sans_insert/update/delete` ; `_contributions` et `_contribution_lignes` en `portail` `FOR ALL`
  (SON client, SON utilisateur, atelier OUVERT où il est invité) ; la politique de `plan_atelier_participants` ne
  référence aucune autre table (récursion RLS) ; `plan_simulations_montecarlo`, `plan_realises`,
  `plan_reprevisions` restent `portail_interdit`. Les contributions individuelles ne sont jamais servies ;
  agrégats au cabinet APRÈS clôture seulement, **seuil de 3 contributeurs appliqué PAR MÉTHODE**
  (`appliquerSeuil`, `plans/ateliers-resultats.ts` : une méthode sous le seuil devient
  `{ resultat: null, masque_seuil: true, seuil_participants: 3 }`, `ayant_contribue` n'est plus servi, la synthèse
  IA ne cite que les méthodes publiées et refuse en 409 `ATELIER_AGREGATS_MASQUES` si aucune ne l'est) ;
  permission `portail.ateliers.participer` (`client_dirigeant` seul) ;
  même 404 pour inexistant, d'autrui, non invité ou non ouvert. La graine de Monte-Carlo est tirée par l'API
  (`crypto.randomInt`), jamais par le moteur. Le rejeu d'une simulation est plafonné à 5 par plan et par
  10 minutes, tous utilisateurs confondus (429 `TROP_DE_REJEUX`, table `plan_rejeux_montecarlo`, `0432` : RLS
  `isolation` + `portail_interdit`, verrou consultatif par plan, purge à une heure ; valeurs provisoires) ; la liste
  des candidats (`candidatsAtelier`) a des plafonds déclarés et renvoie `tronque: true` au lieu de paginer.
- **Groupes et filiales** (DOS-05, lot 4b ; `0225`, `dossier/`, `routes/dossier-groupes.ts`) : participations en
  ajout seul, parts en points de base, cycle (`MQF01`), total > 100 % (`MQF02`), fin sans détention antérieure
  (`MQF03`) et profondeur > 8 liens (`MQF04`) refusés à l'API ET en base, en 409 (l'auto-détention reste 400) ;
  la réponse ne porte que des données du client (identique avec ou sans `finance.lire`) ; un dossier non visible
  est un nœud anonyme (niveau et part). Conversion EUR/XAF/XOF au taux fixe par `finance/monnaie.ts`
  (`convertirMontantGroupe`, un seul arrondi), USD exclu et consolidation « partielle » ; jamais d'élimination
  intragroupe, jamais une consolidation légale.
- **Référentiel de méthodes et revue à froide** (STD-11, QUA-05, lot 4a ; `0210`, `0287`–`0289`) : un facteur du
  standard est en lecture seule (403 `STANDARD_LECTURE_SEULE`), identité, type et porteur figés (`MQS01`),
  valeur retirée ou borne resserrée refusées (`MQS02`) ; une campagne de revue figée après le tirage
  (`MQQ02`), une revue terminée figée (`MQQ04`), historique des actions en ajout seul (`MQQ01`), 19 routes sous
  `/api/qualite/revue-froide/**` sans entrée dans `LISTE_BLANCHE_PORTAIL` ; la grille complète (8 critères) est
  codée en dur dans le déclencheur de `0287` : une grille v2 exige une migration. `mes-revues` est paginée par
  curseur keyset propre à sa liste (tri à directions mixtes, `limite` 1 à 100, défaut 50, schéma strict) ; le
  relecteur d'une revue en cours ne se remplace pas (409 `REAFFECTATION_EN_REVUE`, doublé par `MQQ13`, `0290`).
- **Canaux simulés : alertes KPI sortantes** (lot 3 ; `canaux/alertes-kpi.ts`, `kpi/suivi.ts`, `0549`) : option du
  compte `alerte_kpi` DÉSACTIVÉE par défaut, mise en file seulement vers des responsables INTERNES à numéro
  vérifié et consentement accordé, aucune valeur chiffrée ni libellé de KPI, bloc sous `SAVEPOINT` (ne fait jamais
  échouer le suivi) ; un média reçu se lit en flux plafonné (`canaux/media-flux.ts`, `lireFluxPlafonne`), jamais
  en entier ; un PDF de signature servi `inline` garde type fixé, `nosniff`, `no-store` et une CSP sans
  `sandbox` (risque résiduel documenté : SECURITY.md).
- **Observatoire, efficacité et veille** (CAP-03, CAP-04, AO-01, lot 5b ; `0364`–`0367`, `0466`–`0467`,
  `0470`–`0472`, `capitalisation/`, `appels-offres/veille*.ts`) : tout accès inter-cabinets passe par
  `obs_agregats` SEULE (`SECURITY DEFINER`, `SET search_path = public, pg_temp`, `EXECUTE` retiré à `PUBLIC`
  puis accordé au rôle applicatif ; refus hors contexte de cabinet et dans le portail `MQK24`, sans adhésion
  active `MQK25`, indicateur inconnu `MQK26`) ; `obs_adhesion_active` (`0470`) est d'appelant, non
  `SECURITY DEFINER`. Les seuils (5 entreprises, 3 cabinets) se calculent HORS du cabinet appelant (colonnes
  `effectif_entreprises_autres` et `effectif_cabinets_autres`), le moteur
  (`packages/engines/src/capitalisation/observatoire.ts`) les re-vérifie et ils ne s'abaissent jamais : une
  case sous seuil n'est pas renvoyée du tout, jamais masquée par un zéro. Accès réservé aux CONTRIBUTEURS
  (`MQK27`, doublé dans `agregats()` : 403 `OBSERVATOIRE_CONTRIBUTION_REQUISE`). Gel mensuel (seuls les
  versements d'un mois civil UTC clos comptent), ré-adhésion prise en compte avec un NOUVEAU versement
  seulement, versements sérialisés par verrou consultatif (sans lui, doublement des entreprises d'un cabinet
  et seuil franchi à tort), marges calculées sur les seules cases publiées. Efficacité (CAP-03) : le plancher
  de 5 observations d'un score par contexte ne s'abaisse pas (schéma Zod ET moteur, 400 en dessous) et
  l'effectif d'un contexte sous le seuil n'est pas servi (`effectif: null`) ; la liste des recommandations
  masque libellé, mission, type d'initiative, secteur, taille et score d'une mission NON visible. Veille
  (AO-01) : adaptateurs SIMULÉS sans `fetch` ni `http` (un test le vérifie), l'URL d'un avis n'est jamais
  visitée, import plafonné (1 Mo, 200 avis), plafonds `MQA03` (5000 résultats par cabinet) et `MQA04` (500
  occurrences par résultat) ; un adaptateur réel exige un ADR (SSRF, délai, clé). Toute table nouvelle à RLS
  porte `portail_interdit` et AUCUNE route nouvelle n'entre dans `LISTE_BLANCHE_PORTAIL` (liste inchangée
  par ce lot). Collusion de contributeurs : limite assumée (SECURITY.md), non détectable par la revue.
- **Services candidats** (lot 7 ; `0560`–`0563`, `routes/services-candidats.ts`, `services-candidats/`,
  `packages/engines/src/services-candidats/guichets.ts`) : `guichets_financement` SANS suppression (on
  désactive), identité figée (`MQV01`, doublée en base), plafond de 500 par cabinet sous verrou consultatif
  `pg_advisory_xact_lock` puis comptage (`MQV02`, 409 `PLAFOND_GUICHETS_ATTEINT`), RLS `isolation` +
  `portail_interdit` sur `guichets_financement` et `services_candidats_parametres`. Droits
  `services_candidats.lire` (rôles de `catalogue.lire`) et `services_candidats.gerer` (associé ET directeur
  de mission) ; `expert_externe` sans aucun accès ; le rapprochement depuis un `client_id` exige en plus
  `dossier.lire` ET un client visible (404 sinon). AUCUN prix par défaut : le diagnostic flash ne s'active
  pas sans prix saisi (409 `PRIX_A_FIXER`), le business plan reste « sur devis » (montant nul admis). Le
  moteur `rapprocherGuichets` n'invente AUCUNE conversion de devise : devises différentes, critère
  « inconnu », jamais un taux. Contenu des deux méthodes et des guichets PROVISOIRE, `a_valider = true` ;
  aucune route de création de mission (routes `/missions` existantes), `rapports_mission` non modifiée.
  Huit routes, toutes sous `exiger`, aucune en liste blanche portail.
- **Cache des réponses IA** (AGT-06, lot 4c ; `0278`, `ia/cache.ts`, `ia/orchestrateur.ts`,
  `routes/ia-parametres.ts`) : `ia_parametres_cabinet.cache_actif` DÉSACTIVÉ par défaut (`DEFAULT false`),
  réglé par `PUT /api/ia/parametres`. Clé = HMAC-SHA-256 (`empreinte`, clé dérivée du serveur, usage
  `ia_entree`, matériau préfixé `ia_cache/v1`) de la forme canonique du cabinet, du prompt (nom, version,
  tâche, gabarits, schéma de sortie), du modèle et des entrées MASQUÉES : jamais du texte en clair. Contenu =
  réponse brute encore masquée, chiffrée AES-256-GCM avec AAD `ia_cache:<cabinet>:<clé>` (un chiffré recopié
  sur une autre ligne ne se déchiffre pas). Durée de vie 24 h, bornée par `CHECK (expire_le <= cree_le +
  interval '24 hours')` ET par `DUREE_CACHE_IA_MS` ; une entrée échue n'est jamais servie. Jamais de cache
  (`motifSansCache`) : cache désactivé, prompt `copilote|entretien|transcription` (`PROMPTS_SANS_CACHE`), variable
  de contenu client (non fiable), donnée identifiante restée en clair dans l'entrée ; pas d'écriture non plus pour
  une réponse qui porte une donnée identifiante ou que la garde-chiffres a signalée. Le cache est consulté dans
  `executerDemande` APRÈS les gardes (droit `ia.utiliser`, IA active, clé, coupe-circuit, plafond de mission puis
  réservation) ; il ne remplace que l'appel au fournisseur : la réponse servie repasse par `validerSortie` (Zod), la
  garde-chiffres et le démasquage, redevient un brouillon IA (validation humaine obligatoire) et s'inscrit dans
  `ia_consommations` à l'issue `cache` et à coût NUL (`CHECK`). Désactiver le cache vide les entrées
  (`viderCache`) dans la transaction qui règle `cache_actif` ; l'écriture prend `FOR SHARE` sur les paramètres
  (`ecrireCache`, et le déclencheur `ia_cache_reponses_actif`, `MQI01`, qui refuse toute écriture d'un cabinet au
  cache désactivé) : aucune entrée ne survit à un vidage concurrent. Table à `isolation` + `portail_interdit`, sans
  `UPDATE` pour le rôle applicatif. Limite assumée : un nom propre absent des termes sensibles part déjà au
  fournisseur ; le cache le garde au plus 24 h, chiffré, dans le seul cabinet. Tests : `ia-cache.test.ts`,
  `ia-cache-unitaires.test.ts`.
- **Plafond de coût IA par mission** (AGT-06, lot 4c ; `agents/plafonds.ts`, `ia/orchestrateur.ts`) : appliqué à
  TOUT appel IA rattaché à une mission (`entite.missionId`), pas seulement aux agents : contrôle à la préparation
  (`controlerPlafondMission`) PUIS re-contrôle dans `executerDemande` (`plafondMissionAvantReservation`, donc aussi
  pour le job `ia_generation`), sous le même verrou consultatif `pg_advisory_xact_lock` de la mission, juste avant la
  réservation ; une demande déjà réservée en mode immédiat n'est pas recontrôlée (sa réservation compterait contre
  elle). Ordre des verrous : mission, PUIS cabinet (`couts.ts`), jamais l'inverse. Le coût compte consommations et
  réservations en cours, en entiers (µUSD) ; le dépassement est borné par le coût estimé du dernier appel admis.
  Plafond atteint : refus 409 `PLAFOND_MISSION_ATTEINT`, ou gabarit si l'appelant a `repliSiPlafond` (le contradicteur
  le refuse). HORS CHAMP, documenté : `admettreSansDemande` / `appelerSansDemande` (copilote, sans mission) et les
  évaluations de non-régression. Alertes à 80 % et 100 % (`alertesPlafondMission`) : une fois par seuil et par valeur
  du plafond (`ia_alertes_plafond_mission`, clé primaire cabinet + mission + plafond + seuil, `ON CONFLICT DO
  NOTHING`, réarmée au changement de plafond), aux associés seulement, notification `ia_plafond_mission_alerte`
  sans montant et `email: false`. Test : `ia-plafond-mission.test.ts`.
- **Rapport d'avancement hebdomadaire** (AUT-10, lot 4c ; `0306`–`0308`, `automatisation/avancement*.ts`,
  `routes/automatisation-avancement.ts`, `routes/portail-avancement.ts`, `portail/avancement.ts`, moteur
  `packages/engines/src/avancement`) : les chiffres sortent du moteur seul (`composerAvancementHebdo`). Le portail
  ne lit QUE les rapports VALIDÉS de SON client sur mission partagée (politique RESTRICTIVE `portail` de `0307`,
  doublée de `portail_sans_insert/update/delete`, et filtre explicite `statut = 'valide' AND client_id = $1`) ;
  brouillon, autre mission, autre client ou autre cabinet répondent le même 404. La projection portail est
  explicite (`projeterContenuAvancementPortail`) : pas de `non_partages`, `livrables.total` = partagés, jamais
  `commentaire_ia`, validateur, version ni donnée financière ; `contenuAvancementSchema` (VOLONTAIREMENT non
  strict : clés inconnues ÉCARTÉES, c'est la liste blanche) relit le contenu avant toute projection, et le schéma
  portail est strict. Aucun code d'envoi d'e-mail propre à l'avancement : `avancement_parametres.envoi_email` est
  `CHECK (envoi_email = false)`, refusé par l'API (400) et jamais lu ; la notification interne `avancement_brouillon`
  (chef, à défaut directeur) est `email: false`. Un rapport VALIDÉ est figé (`MQU01`, aussi pour le propriétaire de
  la table), la validation est réservée à l'associé, au directeur ou au chef DE la mission (`MQU02`, doublé par
  l'API), `MQU03` à `MQU05` et `MQU07` (jamais de suppression). Un commentaire IA non relu bloque la validation
  (`CHECK` et 409 `COMMENTAIRE_IA_A_RELIRE`). Job `avancement_hebdo` : planifié par `planifier_avancement_hebdo`
  (`SECURITY DEFINER`, une tâche par cabinet et par semaine, clé `avancement_hebdo:<lundi>`), idempotent par
  `UNIQUE (mission_id, semaine)`, un échec isolé consigné SANS contenu (`sansContenu` : code, contrainte, table).
  Tests : `avancement-hebdo.test.ts`,
  `avancement-ia.test.ts`, `packages/engines` (moteur).
- **Agent contradicteur** (AGT-06, lot 4c ; `0279`, `agents/contradicteur.ts`, `routes/agents.ts`) : à la demande
  d'un consultant SEULEMENT (`AGENTS_SUR_DEMANDE_SEULEMENT`, 409 `AGENT_SUR_DEMANDE_SEULEMENT` sans l'origine
  « consultant » : aucune règle d'automatisation ne le déclenche), par `executerAgent` donc par l'orchestrateur
  (jamais un appel direct au fournisseur) et sous une brique `revue_contradictoire` déclarée (409
  `BRIQUE_NON_DECLAREE`). Sa sortie est un brouillon IA à part, jamais bloquante (`bloquante: false`) : aucune
  écriture sur le brouillon relu. UNE revue active (en file ou en cours) par brouillon, vérifiée par le code ET par
  l'index unique partiel `ia_demandes_revue_active_idx` (409 `REVUE_DEJA_ACTIVE`) ; `MQI50` en base (brouillon
  relu inconnu, revue relue, mission différente). Le brouillon relu est une DONNÉE non fiable (variable non fiable,
  jamais dans les consignes), le contexte est produit par le code (mission et registre des preuves comptés, sans
  contenu ni donnée financière) ; seuls les nombres du brouillon non signalés par sa garde-chiffres sont citables,
  tout autre nombre marque la revue « chiffres non vérifiés ». Plafond de mission atteint : REFUS
  (`repliSiPlafond: false`), et une sortie inexploitable ou en mode dégradé donne 502 `revueNonProduite` : jamais de
  revue vide qui laisserait croire à l'absence d'objection. Droits : `ia.utiliser` (routes), `agent.gerer` (route de
  préparation), droits du registre (`mission.lire`, `preuve.lire`) et visibilité de la mission (404 sinon). Aucune
  entrée dans `LISTE_BLANCHE_PORTAIL`. Le journal ne porte pas le contenu. Test : `agents-contradicteur.test.ts`.
- **Fonction de purge ou d'anonymisation** (`purger_textes_ia`,
  `planifier_conservation_ia` (redéfinie par `0278` à l'identique de `0104` plus le critère « entrée de cache échue »),
  `planifier_purge_rapports`, `anonymiser_copilote_actions`, `purger_textes_ingestion` et
  `planifier_ingestion_maintenance` de `0524`, `purger_textes_ingestion` redéfinie par `0526`) : `SECURITY DEFINER`,
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
  source au déclencheur `controler_source_rapport` (`MPR01-02`, `MPR05` pour la
  source du rapport de clôture du redressement), ne reproduit
  que du contenu validé ou publié, et applique la mention IA et la conservation
  du cabinet (`rapports/parametres.ts`, `rapports/purge.ts`). **Les CHECK de
  `rapports_mission` se réécrivent en entier** (une contrainte ne s'étend pas) :
  `0508`, `0551` (modèle `cloture_redressement`, niveau `red`, colonne
  `red_cloture_id`, fonction `controler_source_rapport()`) puis `0552` (modèle
  `etat_financier`, niveau `dossier`) ; toute redéfinition suivante porte un
  numéro SUPÉRIEUR à `0552` et reprend l'UNION en vigueur, à relire dans
  `0552_rapports_etat_financier.sql` à chaque nouvelle redéfinition : modèles
  `etat_avancement`, `notation`, `plan_strategique`, `dossier_bancaire`,
  `note_comite`, `cloture_redressement`, `etat_financier` ; niveaux `base`,
  `jours`, `finance`, `notation`, `plan`, `dd`, `red`, `dossier` ; sinon elle
  supprime ceux des autres lots. Un modèle de plus ajoute aussi son niveau à
  `rapports/niveaux.ts` et son libellé à `apps/web/src/lib/rapports.ts`. Un rendu PDF
  (rapport ou facture) passe par `rapports/pdf.ts` ; une route qui l'appelle a
  un plafond de débit par utilisateur (modèle : `routes/factures-pdf.ts`, 429).
- **Écriture rejouable** (file hors ligne, nouvelle tentative réseau) :
  `Idempotency-Key` enregistrée dans la transaction de l'écriture, empreinte du
  contenu, rejeu sans effet et 409 si la clé est réutilisée à tort (modèle
  `temps/idempotence.ts`, `0122`) ; un rejeu ne doit jamais écraser une écriture
  plus récente.
- **Historique immuable** : une table historique reçoit un déclencheur à
  SQLSTATE `MP…` (lettre du domaine, numéro libre : CODING_STANDARDS §2 ; plus aucune lettre simple
  libre : second préfixe `MQ` + lettre de domaine + 2 chiffres, par exemple `MQD`, `MQQ`, `MQF`, `MQL`,
  `MQI01` et `MQI50` (cache et revue contradictoire), `MQU01`–`MQU05` et `MQU07` (avancement ; `MQU06` et
  `MQU08`–`MQU10` restent libres), `MQG01`–`MQG03` (ingestion de documents, lot 6 ; `MQG04` et suivants libres) ;
  `Z` est épuisée, partagée par plages entre redressement `MPZ01`–`MPZ20` et due diligence `MPZ21`–`MPZ32`) et un
  `REVOKE` (modèles `0043`, `0060`, `0146`) ; on corrige par nouvel
  enregistrement (avoir, contre-passation, révision, nouvelle version), jamais
  par `UPDATE` ; chaque action sensible appelle `journaliser` dans la même
  transaction (`apps/api/src/audit.ts`).
- **Migrations** : une migration **commitée** ne se modifie pas, on ajoute un
  fichier dans la bonne plage (CODING_STANDARDS §1) ; une migration encore
  **non commitée** peut être corrigée sur place (bases qui l'ont appliquée à
  recréer). Au 2026-10-23, les 232 fichiers de la branche d'intégration sont commités
  (180 déjà dans `origin/main` après les PR n° 12 à 14, 52 posés par les lots du 2026-10-20 et
  du 2026-10-21, dont `0364`–`0367`, `0466`–`0467`, `0470`–`0472`, `0560`–`0563`, pour le lot 4c
  `0278`, `0279`, `0306`, `0307`, `0308`, pour le lot 8b `0290` et `0432`, pour le lot 6
  `0521`–`0524` et pour le lot 11 `0525`–`0526` ; les lots 10, 12, 13a et 13b n'en posent aucune) :
  tous sont à tenir pour immuables, dont `0270` (rejeu réel OpenRouter), les six des
  lacunes de la vague 2 (`0271`–`0274`, `0303`, `0304`) et les 43 des vagues 2 et 3.
  **Numérotation** : la plage de chaque domaine est dans CODING_STANDARDS §1 ; la QUEUE
  `0549` et au-delà est attribuée CENTRALEMENT par le superviseur (jamais « prendre le
  numéro suivant » soi-même) : `0549` canaux (alerte KPI), `0550` brief (limiteur
  persistant), `0551` redressement (rapports de clôture), `0552` dossier (rapport d'état
  financier), `0560`–`0563` consommées par les services candidats (`0564`–`0579` libres), `0553`–`0559`
  non attribués.
  Une redéfinition de `tentatives_auth_regles` ou des CHECK de `rapports_mission` porte
  un numéro supérieur à la dernière (`0550`, `0552`) : voir les deux contrôles dédiés.
  Une fonction SQL déjà définie se redéfinit par `CREATE OR REPLACE` dans une
  nouvelle migration numérotée APRÈS celles qui créent les tables qu'elle cite
  (modèle : `0268`, `fichier_orphelin`) ; toute nouvelle colonne qui référence
  `fichiers` s'ajoute à cette fonction, sinon la purge à 24 h efface le fichier
  (`rg -n "REFERENCES fichiers" apps/api/migrations` : chaque colonne doit figurer
  dans `fichier_orphelin` ; l'inventaire AUTOMATIQUE de
  `fichiers-orphelins-references.test.ts` couvre toute colonne `REFERENCES fichiers`
  et échoue sinon ; dernière définition : `0548`, fichiers audio).
  Une migration qui référence la table d'un autre domaine prend un numéro plus
  grand que celle qui la crée (`0206`, pas `0151`, pour une table liée à
  `mission_methodes` de `0202`) : `migrate.ts` applique les fichiers par ordre
  de nom. `migrate.ts` ne vérifie pas de somme de contrôle : c'est la
  relecture qui garantit la règle (recherche n° 13). Les migrations V2 corrigées
  pendant la session du 2026-10-06 sont commitées depuis `6d62428` : elles sont
  désormais immuables. Prochains numéros libres (2026-10-22) : STD `0211`, DOS `0226`,
  PRV `0244`, QUA `0291`, AGT aucun (plage `0260`–`0279` épuisée : `0278` et `0279` consommés), AUT `0309`–`0319`, AO-A `0368`–`0379`, NOT `0405`–`0419`,
  PLA `0427`–`0428` puis `0433`–`0439`, CAP `0468`–`0469` puis `0473`–`0479`, redressement
  `0493`–`0499`, due diligence `0510` puis `0512`–`0519`, ingestion de documents `0527`–`0539`
  (plage `0520`–`0539`, `0521`–`0526` consommées), services candidats `0564`–`0579`.
- **Dates métier** : une date bornée par un `CHECK` SQL utilise `dateIsoBorneeSchema`
  (`packages/shared/src/schemas/commun.ts`, 2000 à 2100) ; le SQLSTATE 23514 qui
  échappe au schéma se traduit en 400, jamais en 500 (couches d'erreurs des domaines,
  par ex. `salle-mission/erreurs.ts`, `plans/erreurs.ts`) ; les dates de `schemas/temps.ts` sont bornées de même.
- **Entrées** : schéma Zod `.strict()` partagé, requêtes paramétrées ; `paramsId`
  (`apps/api/src/http/outils.ts`) est `.strict()` et ne porte que `:id` : une route dont le chemin a un autre
  paramètre déclare son propre schéma strict (modèle `paramsConstat`, `routes/qualite-froide.ts`) au lieu de
  réutiliser `paramsId`, et un `paramsId` non strict est un écart ; une
  interpolation dans un gabarit SQL n'est admise que pour une constante, un
  fragment construit (`clauseSet`, `filtreVisibilite`), un choix entre
  constantes selon un enum validé, ou `FOR UPDATE`.
- **Fichiers reçus** : type par le contenu (`stockage/detection.ts`), garde de
  taille annoncée avant l'authentification (`gardeTailleMultipart`,
  `routes/fichiers.ts`), une seule partie multipart, place prise dans le sémaphore de réception
  (`avecPlaceAnalyse`, 503 `FICHIERS_OCCUPE`) ; un format complexe
  (classeur, archive) passe par un lecteur borné avant toute bibliothèque
  (modèle `temps/import-excel.ts`).
- **Ingestion de documents : fichier et PDF** (DOS-03, DD-02, DD-10, STD-13, lot 6, ADR-009 ;
  `apps/api/src/ingestion/`, `routes/ingestion*.ts`, `0521`–`0526`) : réception par `avecPlaceAnalyse`
  (`ingestion/documents.ts`, recherche n° 18), type décidé par le contenu, document analysé puis EFFACÉ
  (jamais de clé étrangère vers `fichiers` : `fichier_orphelin` reste inchangée). TOUT PDF passe par le
  pré-contrôle `pdf-controle.ts` (worker dédié, `controlerBombePdf`) AVANT le worker d'extraction
  (`pdf.ts`, `pdf-worker.mjs`) ; `unpdf` ne s'importe que dans `pdf-worker.mjs` et, pour extraire les images d'un
  scan, dans le sous-processus OCR `ocr-processus.mjs` (lot 11), et aucun autre parseur de PDF
  n'est ajouté (recherche n° 23). Un PDF sans texte natif est lu par l'OCR LOCAL (adaptateur `OcrLocal`,
  `ocr-local.ts`, voir « Ingestion de documents : OCR local ») ou, hors production, par l'adaptateur simulé
  `ocr.ts` ; sans OCR branché il échoue `OCR_INDISPONIBLE`, et `PDF_SANS_TEXTE` veut dire que l'OCR a tourné et rien
  lu. Un état lu par OCR n'est jamais accepté automatiquement. Le texte des pages est un contenu client NON FIABLE (variable non fiable de
  l'orchestrateur) et est purgé à la décision + 90 jours (`purger_textes_ingestion`, job
  `ingestion_maintenance`, `0524`). Toute table `ingestion_*` porte `isolation` ET `portail_interdit`
  (recherche n° 24), aucune route n'entre dans `LISTE_BLANCHE_PORTAIL`, et les paramètres de routes et
  charges de jobs sont `.strict()` (recherche n° 12 pour les schémas de `packages/shared`, `schemas/ingestion.ts`).
- **Ingestion de documents : chiffres, FIN-02 et validation** (lot 6) : l'IA propose, l'expert dispose. Tout
  montant lu par l'IA est ANCRÉ sur la ligne de la page (libellé normalisé complet ; plusieurs candidats :
  rejet `libelle_ambigu`, `packages/engines/src/ingestion/ancrage.ts`). Un état n'est accepté
  automatiquement que si tous les contrôles passent à tolérance nulle ET qu'aucune ligne n'est rejetée ou
  non lue ET que le texte est natif ET qu'aucun état accepté par un humain n'est remplacé
  (`forcerRevueEtat`, `engines/ingestion/etat-ia.ts` ; `dossier/etats.ts`, option `forcerRevue`). Le résultat de
  l'IA n'atteint jamais un état, un verdict ni une méthode sans validation humaine d'un brouillon
  (`ingestion_extractions`) ; valideur ni auteur du téléversement, ni demandeur de la lecture, ni dernier
  modificateur, sauf associé (API ET déclencheur `MQG02`, `0522`, même test de refus). FIN-02 :
  `contientDonneeFinanciere` (`engines/ingestion/proposition.ts`) sur TOUTE proposition d'amorçage, lignes ET
  codes, à la lecture et à la correction humaine (400) ; les noms connus du cabinet sont masqués avant
  l'envoi à l'IA pour l'amorçage (`structuration-standard.ts`, `copilote/noms-propres.ts`). Tests d'un PDF piégé
  (bombe de décompression, flux géant) sur le modèle de `apps/api/test/ingestion-pdf.test.ts` ; les autres
  suites sont `ingestion-securite`, `ingestion-etats`, `ingestion-extractions`, `ingestion-maintenance`,
  `ingestion-dd*` et `ingestion-standard*`.
- **Ingestion de documents : OCR local** (lot 11, ADR-009 décision 16 et « Décision OCR » ; `tesseract.js` 7.0.0,
  WebAssembly, hors ligne ; `ingestion/ocr-local.ts`, `ocr-processus.mjs`, `ocr-garde-reseau.cjs`, `ocr-veille.mjs`,
  `fabrique.ts`, `0525`–`0526`, `packages/engines/src/ingestion/ocr-confusions.ts`) : « jamais de service externe »,
  et plus de contrôle qui dit « aucun OCR réel » (le simulé `OcrSimule` n'existe qu'en développement et en test,
  jamais en production). À relire à chaque diff qui touche ces fichiers :
  - **Sous-processus** : un par document (`fork` dans `ocr-local.ts`, seul `fork` de l'API : recherches n° 26 et 27),
    environnement VIDE (`environnementEnfant`, aucun secret de l'API ni `NODE_OPTIONS` hérité),
    `--max-old-space-size=256`, `--no-addons`, `--require` du garde réseau, `--permission` avec `--allow-worker`
    et `--allow-fs-read` limité au code, aux données et aux `node_modules` (Node >= 22.13 : `permissionNodeDisponible`,
    `versionNodeAvecPermission`), RSS surveillé par `ocr-veille.mjs`. **`cwd` = dossier de ses scripts**
    (`path.dirname(SCRIPT)`), JAMAIS le dossier courant de l'API : faille trouvée en vérification, un `worker_thread`
    sous `--permission` lit le dossier courant hors `--allow-fs-read`, où peut se trouver un `.env` ; tout
    `fork`/`spawn` sans `cwd` explicite est un écart. **Refus en production** : tout `NODE_ENV` autre que
    `development` ou `test` (staging compris, `productionOcrParDefaut`) sans modèle de permissions rend l'OCR
    indisponible (`diagnosticOcrLocal` rend `permissions`, `creerOcr` rend `null`, `OcrLocal.reconnaitre` refuse avant
    tout sous-processus, le scan échoue `OCR_INDISPONIBLE`) ; hors production, toléré avec UN seul avertissement
    sans contenu. Tout assouplissement de ces arguments est un écart ; `engines.node` reste `>=22.13`.
  - **Aucun réseau** : le garde `--require ocr-garde-reseau.cjs` bloque et compte net, tls, dns, dgram, http(s),
    http2, `fetch`, `WebSocket`, `child_process`, `process.binding`, `dlopen`. Il remplace `worker_threads.Worker` par
    une enveloppe qui IGNORE l'`execArgv` de l'appelant et impose l'héritage des options du fil parent (garde,
    permissions, `--no-addons`) : TOUTE création de worker passe par elle (un `new Worker(…, { execArgv: [] })` perdait
    garde et permissions) ; chargé sans `--require`, il refuse toute création de worker. Aucun accès réseau (ni
    `fetch`, ni `dns`, ni `http`, ni `net`) ajouté dans `apps/api/src/ingestion/` : seules les sondes de test de
    `ocr-processus.mjs` en parlent (recherche n° 25). `langPath` est un chemin LOCAL obligatoire (`cacheMethod:
    "none"`, `gzip: false`) : sans lui `tesseract.js` irait sur un CDN. Défense en profondeur seulement : un pare-feu
    sortant reste à poser sur le serveur (SECURITY.md).
  - **Données de langue vendorées** (`apps/api/ocr-data/`, `tessdata_fast` 4.1.0 `fra` et `eng`) : l'empreinte
    `SHA256SUMS` est vérifiée au premier usage (fausse : moteur indisponible, sans bruit). Toute mise à jour passe par
    `apps/api/ocr-data/README.md` (commit officiel, SHA-1 de blob, `SHA256SUMS`) ET `node scripts/ocr-verifier-donnees.cjs`
    (recherche n° 28). `VERSION_MOTEUR_OCR` (`ocr-local.ts`) vaut la version EXACTE de `tesseract.js` dans
    `apps/api/package.json` (sinon l'OCR se désactive) ; changer le moteur relit `tesseract.js/src/worker-script` et
    `src/worker/node` (chargement des langues, `fetch`, création du worker).
  - **Purge** : `corrections_ocr` (`ingestion_documents`, `0525`) recopie du texte lu : elle suit la rétention du texte
    des pages (décision + 90 jours, `0526`). Toute NOUVELLE colonne de texte d'ingestion s'ajoute à
    `purger_textes_ingestion` ET au déclencheur `controler_ingestion_document` (branche de datation de la purge, qui
    compare la ligne sans `texte_purge_le` ni `corrections_ocr`) : sinon elle survit à la purge, ou la purge est
    refusée `MQG01`. Test de référence : `ingestion-purge-ocr.test.ts`.
  - **Revue humaine** : un état issu d'OCR (méthode `ocr` ou `ocr_simule`) reste TOUJOURS en revue (`etat-financier.ts`,
    `METHODES_OCR` ; `forcerRevue`), le web le marque « lu par OCR : à vérifier » avec la confiance de la page.
    Les corrections (`ocr-confusions.ts`) sont PROPOSÉES, jamais appliquées : la ligne reste hors de l'état ;
    plafonnées à 100 et validées par `correctionOcrSchema`.
  - **Dépendances** (règle d'âge : toute version installée ou mise à jour a au moins 2 semaines,
    `--config.minimumReleaseAge=20160`). Exception décidée par l'utilisateur le 2026-10-22 pour une RCE critique :
    `next` **15.5.28** et `fastify` **5.12.6**, versions EXACTES (8 et 9 jours ce jour-là) ; toute autre version plus
    récente que 2 semaines est un écart. `pnpm audit --prod` rend « No known vulnerabilities found » (recherche n° 15).
  - **Tests** : `ocr-moteur`, `ocr-garde`, `ocr-outils`, `ingestion-ocr-reel`, `-isolation`, `-integration`,
    `-corrections` et `ingestion-purge-ocr` (`apps/api/test/`). Les tests du moteur réel sont sautés AVEC message si le
    moteur manque ; `OCR_LOCAL_EXIGE=1` (posé dans le job `api` de la CI) les rend obligatoires.
- **Preuve chaînée** (`ajouterPreuve`, `apps/api/src/canaux/preuves.ts`) : l'horodatage est rejoué (3 essais,
  `ESSAIS_HORODATAGE`, INSERT sous point de sauvegarde) sur le SEUL refus `MPH10` dont le message dit
  « horodatage » ; les refus de rang ou d'empreinte ne sont jamais rejoués. Un test sensible à la charge
  s'écrit sans `retry` qui masque l'écart : modèle, le test de non-régression de `journal de preuves`
  (`pg_sleep` avant le premier INSERT, `apps/api/test/signatures-routes.test.ts`).
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
- Node 22.13 au minimum (`engines.node` de `package.json` : `>=22.13`, CI en `node-version: 22`) : `unpdf` 1.8.1
  l'exige, le modèle de permissions (`--permission`) du sous-processus OCR n'existe qu'à partir de 22.13 (refusé en
  production sans lui) et `worker.getHeapStatistics()` de la surveillance du worker PDF (`ingestion/pdf.ts`) date
  de Node 22.16 (garde défensive si la méthode manque). Toute valeur de `PLAFONDS_INGESTION` et `PLAFONDS_OCR`
  (`packages/shared/src/schemas/ingestion.ts`) est provisoire. `OCR_LOCAL` (`auto` | `local` | `simule` | `off`)
  se lit dans `config.ts` comme toute variable. Toute lecture de `process.env` dans
  l'ingestion est un écart, sauf la LECTURE DE `NODE_ENV` de `ocr-local.ts` (`productionOcrParDefaut`, défaut d'une option
  injectable) et la liste des NOMS de variables que `ocr-processus.mjs` renvoie dans son rapport (`env_cles`, preuve que
  l'environnement est vide ; aucune valeur) (recherche n° 3 : ces deux lignes, aucune autre).

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
- **Une page serveur (Next) ne passe jamais une FONCTION à un composant client**
  (fichier marqué `"use client"`) : propriétés sérialisables seulement, sinon la
  page devient illisible (« Functions cannot be passed directly to Client
  Components ») sans qu'aucun test de `lib/` ne le voie ; modèle de correction :
  `versionDans` de `components/methodes/BoutonAction.tsx`. Revue manuelle, aidée
  par la recherche n° 19. Une fonction passée par son nom (`prop={maFonction}`) ou
  par un tableau de colonnes échappe à la recherche.
- **Toute liste web qui boucle sur une API déclare le plafond de la route**
  (`limiteMax` de `chargerToutesLesPages`, `lib/pagination.ts`) : une `limite`
  au-delà du plafond de la route donne un 400 et une liste vide en silence (menu
  « Confier à » du rétro-planning, 2026-10-10). Le défaut sûr est 200 ; une route
  plafonnée à 100 (la plupart des listes : `schemas/facturation.ts`, `clients.ts`,
  `appels-offres.ts`) passe `limiteMax: 100`, une liste large (missions,
  opportunités : 500) passe `LIMITE_PAGE_MAX` (toutes les pages de liste de missions le font depuis le lot 8b).
  Recherche n° 20.
- **Tout rafraîchissement après une écriture passe par le hook `useRafraichir`**
  (`apps/web/src/components/formulaires/useRafraichir.ts`, lot 10 : `rafraichir()` dans la transition du
  composant, `enAttente`, une relance à 1,5 s dédoublonnée, abandon à 8 s), jamais par `router.refresh()`
  direct : sans lui l'écran reste périmé après l'écriture (A-04 de la recette). Seule exception :
  `app/connexion/FormulaireConnexion.tsx` (lot 12 : plus aucun autre appel direct ; `ActualisationAuto`, qui relance
  toutes les 3 s, passe par `useTransition` et `rafraichirEnTransition`, exporté par `useRafraichir.ts`, et saute un
  tick tant que la transition précédente n'est pas finie). Un composant qui reçoit un rappel d'un composant d'envoi
  (`onCree`, `onTermine`) appelle `rafraichir()` du hook, pas `router.refresh()`. Recherche n° 22.
- **`DebloqueurRendu` reste monté au layout racine** (`apps/web/src/app/layout.tsx`, à côté de `<HorsLigne />` ; composant
  `components/shell/DebloqueurRendu.tsx`, noyau pur `debloqueur.ts`, lot 13a) : contournement d'un défaut du React 19.2
  canary embarqué par Next 15.5.28 (réveil perdu quand un morceau Flight est en `resolved_model` sous une frontière
  `Suspense` déjà affichée : écran périmé après `router.refresh()` ou lien `<Link>` sans effet, A-04, R-01, R-02). Ne pas
  le retirer sans avoir revérifié A-04 en navigateur, à REVOIR à chaque montée de Next ou de React (recherche n° 29).
  Il ne lit que les noms des ressources de la page (Resource Timing, même origine) : aucun réseau, aucune donnée, aucun
  en-tête ; toute lecture, requête ou stockage ajouté au composant est un écart. Ne pas « forcer » l'affichage par une
  minuterie, un rechargement complet ou un `router.refresh()` répété : `useRafraichir` ou `useFormulaire`. Un écran
  périmé se diagnostique par `root.suspendedLanes` (note du lot 13a).
- **Une page serveur qui lit (GET) une route pouvant répondre un 403 à code MÉTIER déclare ce code** dans
  `codes403Metier` de `appelerApiServeur` / `chargerServeur` (`apps/web/src/lib/api-serveur.ts`, lot 10) :
  sans cela le 403 redirige à tort vers `/acces-refuse` au lieu d'afficher le message de l'API (modèle :
  `CODES_403_AGREGATS`, `lib/observatoire.ts`, page `/observatoire`). `TFA_A_CONFIGURER`,
  `PORTAIL_ROUTE_INTERDITE` et `INTERDIT` gardent toujours leur redirection : ils ne figurent JAMAIS dans la
  liste. Les 403 à code métier des écritures (POST, PUT, PATCH) n'y entrent pas.
- **Un code technique n'est jamais affiché tel quel** : identifiant de référentiel, clé de règle, code de
  critère ou d'erreur passent par une table de libellés puis le repli lisible de
  `apps/web/src/lib/codes-lisibles.ts` (`libelleDeCode`, `remplacerCodesTechniques`) ; les devises XOF et XAF
  s'écrivent « FCFA » dans un texte affiché (`libelleDeviseAffichage`,
  `apps/api/src/plans/reprevision-explication.ts` ; `libelleDevise`, `lib/format.ts`, côté web : à utiliser pour TOUT
  libellé de devise, y compris en-têtes et consignes du plan et du redressement), les codes stockés ne changent pas. Un
  code de ligne d'état financier généré (`L1_13`) s'affiche par `libellePosteEtat` (« Poste sans code source (page 1,
  ligne 13) »), la cible d'un contrôle par `libelleCibleControle`, une période de KPI par `libellePeriode` (lot 13b).

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
- Un appel IA qui peut être mis en cache ou rattaché à une mission : cas du cache (désactivé par défaut,
  clé distincte par cabinet, prompt exclu, contenu client, sortie signalée par la garde-chiffres jamais mise en
  cache, gardes jamais contournées, vidage à la désactivation y compris concurrente : `ia-cache.test.ts`, `ia-cache-unitaires.test.ts`) et du plafond de mission
  (refus, re-contrôle à l'exécution, alerte une fois par seuil : `ia-plafond-mission.test.ts`).
- Un rapport destiné au client : test « brouillon invisible du portail, même par identifiant direct », test du
  validé figé (`MQU01`) et de la projection portail sans clé interne (`avancement-hebdo.test.ts`,
  `packages/shared/src/schemas/automatisation.test.ts`).
- Un agent « sur demande seulement » : test de refus sans l'origine « consultant », de la revue déjà active et
  du plafond atteint sans revue vide (`agents-contradicteur.test.ts`).
- Une ingestion de document : un PDF PIÉGÉ (bombe de décompression refusée par le pré-contrôle SANS lancer le
  worker d'extraction, flux corrompus, mots `stream` en masse : modèle `apps/api/test/ingestion-pdf.test.ts`),
  `PDF_SANS_TEXTE` (l'OCR a tourné et rien lu) et `OCR_INDISPONIBLE` (scan sans OCR branché), un scan réel lu par
  `OcrLocal` (`ocr-moteur.test.ts`, `ingestion-ocr-reel.test.ts`), le garde réseau et les workers (`ocr-garde.test.ts`),
  l'isolation entre cabinets de l'OCR (`ingestion-ocr-isolation.test.ts`), la purge des corrections
  (`ingestion-purge-ocr.test.ts`), le refus de validation à l'auteur du téléversement, au demandeur et au dernier
  modificateur (`MQG02`), FIN-02 sur une proposition d'amorçage, le rejet `libelle_ambigu`, le texte purgé
  (404 `TEXTE_PURGE`) ; suites `apps/api/test/ingestion-*.test.ts` (`-securite`, `-etats`, `-extractions`,
  `-maintenance`, `-dd*`, `-standard*`) et moteurs `packages/engines/src/ingestion/*.test.ts`.
- Un test sensible à la charge (horloge, déclencheur, délai) ne se règle pas par un `retry` : on corrige la cause
  ou on écrit un test de non-régression qui injecte le retard (modèle : `pg_sleep` dans le test `journal de
  preuves` de `signatures-routes.test.ts`). Ne pas lancer plus de 3 ou 4 suites API en parallèle sur le même
  PostgreSQL (erreur 53200, `max_locks_per_transaction`, dans le global-setup).

## Recherches mécaniques

À lancer depuis la racine (ripgrep 15). « Attendu » = résultat du 2026-10-23 dans la copie de travail
`reste-lot-9g` (branche d'intégration finale, HEAD `fe24b89` = fusion du lot 13b : `main` = `origin/main` au merge
commit `3d5a252`, plus les lots 1, 2, 3, 4a, 4b, 4c, 5a, 5b, 7, 8a, 8b, 8c, 10, 6, 12, 11, 13a et 13b du chantier du 2026-10-20,
TOUS fusionnés dans la branche d'intégration, pas encore dans `main`).
Les recherches n° 1 à 28 ont été relancées ce jour avec la commande exacte ci-dessous, la n° 15 (réseau) aussi, ainsi que
`node scripts/ocr-verifier-donnees.cjs` ; les n° 29 et 30 sont neuves (lots 13a et 13b). Les n° 11 et 12 ont été relancées par
script ponctuel hors dépôt (réécrit pour ce relevé), dont la méthode a d'abord été vérifiée sur l'état d'AVANT les lots 13
(`9c798e2`, extrait par `git archive`, code identique à `bdf8c72`) : elle y retrouve exactement le relevé du 2026-10-22 (n° 11 :
1 727 / 1 680 / 835 / 247 ; n° 12 : 904 `z.object`, 893 stricts, 11 non stricts voulus aux lignes 733 à 798). Les recherches par `rg`
ont aussi été lancées sur `9c798e2` et leurs listes triées comparées ligne à ligne à celles de la tête : là où le nombre est
inchangé, les listes sont identiques, sauf les numéros de ligne cités dans le tableau. Les écarts sont attribués à un lot par
comparaison de fichiers (`git diff --stat 9c798e2 HEAD` : 63 fichiers, tous des lots 13a et 13b ; aucune migration, aucune route,
aucun `package.json` ni lockfile), non par supposition. Les commentaires de la liste de commandes ci-dessous citent les lots jusqu'au
12 : les lots 13a et 13b n'y changent que les numéros de ligne signalés (n° 7, 8, 18, 19) et la recherche large du n° 22.

**Relevé du 2026-10-24, branche orch/2026-10-24-tenant-demo.** Copie de travail `tenant-demo-lot-8` (branche
`orch/2026-10-24-tenant-demo-lot-8`, HEAD `231b25e`), décomptes de fichiers et n° 8 et 11 recomptés au lot 9 sur `cfabfe1` ; base `a2d7be6` = PR n° 18 super admin fusionnée dans `main`). Il REMPLACE le
relevé super admin du 2026-10-23 pour les lignes qui changent. Le chantier ajoute un semis de démonstration, sans migration ni route :
`apps/api/src/db/seed-tenant-demo.ts`, `apps/api/src/db/tenant-demo/**` (312 fichiers `.ts`, 7 sous-dossiers dont `phases/`), 11 fichiers de
test `seed-tenant-demo*` dans `apps/api/test/` (tests et outils), `outils-base-jetable.ts` et `outils-assertions-missions.ts`, et une ligne de
`apps/api/package.json` (script `db:seed-tenant-demo`) ; la connexion web est refaite (`apps/web/src/app/connexion/**` et
`apps/web/src/lib/demo-connexion-comptes*`) ; `git diff --name-status a2d7be6 cfabfe1` (avant le lot 9) : 327 fichiers ajoutés, 12 modifiés
(dont `apps/api/package.json`, la connexion web et la documentation), aucun dans `apps/api/migrations` ni `packages/`. Les recherches n° 1 à 30 ont été relancées avec les commandes EXACTES, depuis la racine de la copie ; le n° 10
par le `node -e` de la commande, les n° 11 et 12 par script ponctuel hors dépôt (réécrit pour ce relevé), qui retrouve sur
`git archive a2d7be6` 1 732 / 1 681 / 835 / 247 (n° 11) et 904 `z.object`, 893 stricts, 11 non stricts aux lignes 733 à 798 (n° 12),
c'est-à-dire le relevé précédent. Les recherches par `rg` ont aussi été lancées sur `a2d7be6` : les listes triées sans numéros de ligne
ne diffèrent que par les lignes citées ci-dessous. `node scripts/ocr-verifier-donnees.cjs` (n° 28) : 2 fichiers conformes, code de sortie 0.
`pnpm audit --prod` (n° 15) n'a PAS été relancé (réseau requis) : le seul `package.json` touché ajoute un script, aucune dépendance, et
`pnpm-lock.yaml` est inchangé ; valeur du relevé précédent conservée. Écarts attribués par comparaison de fichiers avec `a2d7be6` :

| N° | Attendu (tête du 2026-10-24, Tenant démo) | Explication (écart avec le relevé précédent) |
| --- | --- | --- |
| 1 | 5 lignes | 4 avant : +1, `db/tenant-demo/index.ts:53` (`new pg.Client` avec `DATABASE_OWNER_URL` : le semis écrit avec le rôle PROPRIÉTAIRE, comme `seed-defaut.ts:227`). Script de ligne de commande (`package.json` : `db:seed-tenant-demo`), jamais chargé par l'API. Tout autre `pg.Client` dans `apps/api/src` est un écart |
| 3 | 16 lignes | 14 avant : +2, toutes dans `db/seed-tenant-demo.ts` : `:54` (`configDemo(process.env, argv)`) et `:60` (`demoPubliqueConfirmee(process.env, argv)`), même gabarit que `seed-demo.ts` et `seed-defaut.ts` ; `process.argv` est lu aux lignes `:50` et `:51` (hors recherche). Aucune lecture dans `db/tenant-demo/`. Les 14 autres lignes sont identiques |
| 8 | 24 lignes (commande ci-dessous, données de démonstration exclues) | 24 avant ; 77 lignes de plus dans `db/tenant-demo`, arrondis de génération de données (avec l'ancienne glob `!**/seed*`, 99 lignes), toutes dans `db/tenant-demo/` (arrondis, `Math.floor` et `Math.max` du générateur de données : horloge et aléa déterministes de `horloge.ts`, calendriers de missions, séries de KPI, historiques IA et qualité, questionnaires, états et plans avancés, trésorerie du redressement, notes de due diligence, `missions/devises.ts:27` et `redressement-dd/redressement-outils.ts:48-49` : conversions de montants XOF vers EUR et USD à taux fixes du semis). Aucun n'est appelé par l'API en service : ce sont des données de démonstration, exclues par `!**/tenant-demo/**` comme les seeds. Les 24 lignes antérieures sont identiques |
| 9 | 7 lignes | 5 avant : +2, `db/tenant-demo/contexte.ts:155` (`journal: entrees.journal ?? ((ligne) => console.log(ligne))`) et `db/tenant-demo/index.ts:50` (`options.journal ?? console.log`), le journal par défaut du semis, remplaçable par les tests ; hors `seed*` par le nom de fichier. `seed-tenant-demo.ts` (`console.log` et `console.error`) est exclu par la glob. Les 5 autres lignes sont inchangées |
| 11 | 1 897 gabarits, 1 846 hors `db/seed*`, 835 interpolations, 247 expressions | 1 732 / 1 681 / 835 / 247 avant : +165 / +165 / 0 / 0, tous dans `db/tenant-demo/` (165 gabarits constants, sans interpolation ; au plus 9 par fichier pour les premiers lots : `ia-qualite-standard/qualite-froide-historique.ts` 9, `missions/antidatage.ts` 8, `appels-offres-canaux/ao-fiches-reponse.ts` 7, `redressement-dd/dd-outils.ts` 7) ; AUCUNE interpolation (gabarits constants à paramètres `$n`), aucune expression distincte nouvelle. `seed-tenant-demo.ts` : 0 gabarit. Au sens large (« seed » = `db/seed*` ou `db/tenant-demo/**`) le deuxième nombre reste 1 681 |
| 2, 4 à 7, 10, 12 à 14, 16 à 30 | inchangés (1, 0, 0, 0, 19, « 1002 14 », 904 / 893 / 11, 240 migrations, 0, 42, 2, 7, 77, 24, 1, 1, 3, 3 tables et 3 politiques, 7, 8, 4, 2 puis « 2 fichier(s) conforme(s) », 2, 9) | — (n° 6 : 0, le semis n'écrit aucun `SUM(` ni `AVG(` ; n° 7 : liste triée identique, aucun `LIMIT` littéral > 1 ajouté ; n° 10 : mêmes 14 lignes, aucune route ajoutée ; n° 12 : `packages/shared` intact, aucun `z.object` dans `db/tenant-demo` ; n° 13 : 240 fichiers, aucune migration ajoutée, modifiée ni supprimée depuis `a2d7be6` (`git log --diff-filter=MD` rend les mêmes 3 fichiers que le 2026-10-23 : `0570`, `0573`, `0580`) ; n° 15 non relancé ; n° 22 : `FormulaireConnexion.tsx:55`) |

**Relevé tête finale du 2026-10-23 (super admin, lots 1 à 6).** Copie de travail `super-admin-lot-7` (branche
`orch/2026-10-23-super-admin-lot-7`, HEAD `4514c8f` = fusion du lot 5 ; base `main` = `378c48d`). Il REMPLACE le relevé
« super admin » du lot 4 ci-dessous pour les lignes qui changent. Commandes EXACTES relancées depuis la racine de la copie :
n° 1 : 4 lignes ; n° 2 : 1 ; n° 3 : 14 ; n° 4, 5, 6 : 0 ; n° 7 : 19 ; n° 8 : 24 ; n° 9 : 5 ; n° 10 : « 1002 14 » ; n° 16 : **42 lignes**
(41 avant : +1, `0583` accorde `demo_lister_comptes` redéfinie ; `demo_tfa_bloquante`, interne, n'est PAS accordée) ; n° 22 : 1 ligne
(`FormulaireConnexion.tsx:55`) et 10 lignes à la recherche large. n° 13 : 240 fichiers (239 + `0583`) ; `git diff --name-status main --
apps/api/migrations` ne rend que 8 lignes « A » (`0570`–`0573`, `0580`–`0583`). ATTENTION : `git log --diff-filter=MD ...` rend
3 fichiers (`0570`, `0573`, `0580`) sur cette branche, à cause du commit de documentation `e6b294b` (lot 4), qui n'a changé que des
lignes de COMMENTAIRE de ces migrations avant leur fusion dans `main` ; elles ne sont pas encore immuables (jamais dans `main`),
et la comparaison à `main` fait foi. N° 11 (script ponctuel) NON relancé : les lots 5 et 6 touchent `routes/connexion-demo-public.ts`
et deux fichiers de seed, sans nouveau gabarit connu ; valeur du lot 4 conservée, à confirmer au prochain relevé complet.
Les lots 5 et 6 ne posent aucune route (1002 / 14 inchangé) ; le lot 6 ne touche aucune recherche web.

**Relevé tête finale du 2026-10-23 (super admin, lot 4).** Copie de travail `super-admin-lot-4` (branche `orch/2026-10-23-super-admin-lot-4`,
HEAD `b131f37` = fusion du lot 2b, lots 1, 2a, 2b et 3 du chantier « super admin, tenants et connexion de démonstration »
fusionnés ; base `9fdf052`). Les recherches n° 1 à 30 ont été relancées avec les commandes EXACTES ci-dessous, depuis la
racine de la copie ; les n° 10, 11 et 12 par script ponctuel hors dépôt (n° 10 : le `node -e` de la commande, à l'identique ;
n° 11 : script réécrit, qui retrouve 1 727 / 1 680 / 835 / 247 sur l'état d'avant le chantier, `git archive 9fdf052`) ; les listes
triées des n° 7 et 8 (sans numéros de ligne) sont identiques à celles de `9fdf052`. `node scripts/ocr-verifier-donnees.cjs` (n° 28) aussi (2 fichiers conformes, code de sortie 0) ; `pnpm audit --prod` (n° 15)
n'a PAS été relancé (réseau requis ; aucun `package.json` ni lockfile ne change dans le chantier) : valeur du relevé précédent conservée. Il REMPLACE le relevé du
`reste-lot-9g` ci-dessous pour les lignes qui changent (le reste est inchangé, le chantier ne touchant ni l'ingestion, ni le
worker, ni `DebloqueurRendu`) :

| N° | Attendu (tête du 2026-10-23, super admin) | Explication (écart avec le relevé de `reste-lot-9g`) |
| --- | --- | --- |
| 1 | 4 lignes | 2 avant : +2, deux scripts hors application qui se connectent avec le rôle PROPRIÉTAIRE par un `pg.Client` : `db/creer-super-admin.ts:146` (création du premier vrai super admin) et `db/seed-defaut.ts:227` (marquage `est_demo`). Hors `pool.ts` et `migrate.ts`, mais ce sont des scripts de ligne de commande (`package.json` : `db:creer-super-admin`, `db:seed-defaut`), jamais chargés par l'API. Tout autre `pg.Client` dans `apps/api/src` est un écart |
| 2 | 1 ligne | inchangé (`pool.connect`) |
| 3 | 14 lignes | 7 avant : +7, toutes dans des scripts : `db/seed-demo.ts` (`:244` signature de `configDemo`, qui passe de `:220` à `:244`, `:967` et `:974`, lectures de `process.env` et `process.argv` pour le mode démonstration publique), `db/seed-demo-portail.ts:643` et `:650`, `db/seed-defaut.ts:278` et `:284`, `db/creer-super-admin.ts:220`. `config.ts` : la ligne de `loadConfig` passe de `:191` à `:200` (variable `DEMO_PUBLIQUE`, lue par le schéma, pas par `process.env` direct). Aucune lecture dans `src/plateforme/` ni dans `routes/` |
| 4 à 6, 14, 17, 18, 20, 21, 23 à 30 | inchangés (0, 0, 0, 0, 2, 7, 24, 1, 3, 3 tables et 3 politiques, 7, 8, 4, 2 puis « 2 fichier(s) conforme(s) », 2, 9) | — (aucune requête agrégée, aucun `innerHTML`, aucun `NEXT_PUBLIC_`, aucun texte d'interface en anglais ajouté ; n° 17, 18 et 20 : mêmes nombres, mêmes appels) |
| 7 | 19 lignes | inchangé (liste triée identique, sans numéros de ligne) ; le chantier n'ajoute aucun `LIMIT` littéral > 1 (les listes de la plateforme n'ont ni `LIMIT` ni curseur : dette déclarée, CODING_STANDARDS §10) |
| 8 | 24 lignes | inchangé (liste triée identique) |
| 9 | 5 lignes | 3 avant : +2, `db/creer-super-admin.ts:221` (`console.log`) et `:222` (`console.error`), la sortie du script, qui affiche le mot de passe généré UNE seule fois (jamais un mot de passe fourni) ; hors `seed*` et `migrate.ts` par le nom de fichier. Les trois autres lignes sont inchangées (`mailer.ts:91`, `ocr-local.ts:147` et `:307`) |
| 10 | « 1002 14 » puis 14 lignes | 990 / 9 avant : +12 routes (9 sous `/api/plateforme`, 3 sous `/api/auth/demo*`) dont 5 SANS `exiger`, toutes publiques par construction : `plateforme.ts` `POST /connexion` et `POST /deconnexion` (la session de plateforme est vérifiée par `exigerPlateforme`, pas par `exiger`, sur les 7 autres), `connexion-demo-public.ts` `GET /demo`, `POST /demo/connexion`, `POST /demo/connexion-plateforme`. Les 9 lignes antérieures sont inchangées (`auth.ts` x3, `canaux-webhook.ts`, `connexion-demo.ts` x2, `portail-gestion.ts` `/invitations/accepter`, `sante.ts`, `utilisateurs.ts` `/invitations/accepter`). Liste complète des 14 : voir la commande |
| 11 | 1 732 gabarits, 1 681 hors seed, 835 interpolations, 247 expressions | 1 727 / 1 680 / 835 / 247 avant : +5 / +1 / 0 / 0. Les +5 : `db/seed-defaut.ts` +3, `db/seed-demo.ts` +1 (seeds, exclus du deuxième nombre) et `db/creer-super-admin.ts` +1 (insertion du super admin, aucune interpolation). Les fonctions `plateforme_*` et `demo_*` sont appelées par des chaînes entre guillemets (`SELECT * FROM plateforme_…($1, …)`), hors recherche. Aucune expression distincte nouvelle |
| 12 | 904 `z.object`, dont 893 `.strict()` et 11 non stricts VOLONTAIRES (inchangé) ; +10 `z.object` strictes HORS du périmètre de la commande | `packages/shared/src/schemas` inchangé (somme `rg -U -c` : 904). Les schémas du chantier vivent dans `apps/api` : `plateforme/schemas.ts` (8 `z.object`, 8 `.strict()`) et `routes/connexion-demo-public.ts` (2, 2 `.strict()`), donc hors du périmètre de la recherche mais TOUS stricts (comptés par `rg -U -o 'z\s*\.object\('`). Écart de périmètre signalé, pas un défaut |
| 13 | 239 migrations, 0 modifiée ni supprimée dans l'historique (240 au lot 7, voir le relevé ci-dessus) | 232 avant : +7 (`0570`–`0573`, `0580`–`0582`) ; `git log --diff-filter=MD --name-only --format= -- apps/api/migrations \| sort -u` ne rend rien |
| 16 | 41 lignes (42 au lot 7, voir le relevé ci-dessus) | 35 avant : +6, une par migration `0570`, `0572`, `0573`, `0580`, `0581`, `0582` (`0570` reconduit les `GRANT` de `trouver_connexion` et `resoudre_session` ; `0582` reconduit ceux des six `plateforme_*` de `0573`, qui comptent donc deux fois). Liste relue en SECURITY.md §4 : toutes `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `EXECUTE` accordé à `missionpilot_app` |
| 19 | 77 lignes dans 61 fichiers | inchangé (aucune des nouvelles pages ne passe de fonction à un composant) |
| 22 | 1 ligne (`app/connexion/FormulaireConnexion.tsx:55`) | `:60` avant : le lot 3 (écran « un clic ») réécrit ce fichier ; même appel direct admis. La recherche large `rg -n "\.refresh\(\)" apps/web/src` donne toujours 10 lignes |

**Relevé du 2026-10-23 de la tête finale (branche d'intégration, copie `reste-lot-9g`, HEAD `fe24b89`, tous les lots
fusionnés, lots 13a et 13b compris).** Il REMPLACE le relevé du 2026-10-22 (copie `reste-lot-9f`, HEAD `bdf8c72`, lots 11 et 12
compris), dont le détail des écarts attribués aux lots 11 et 12 est conservé plus bas. Les comptes de toutes les recherches sont
IDENTIQUES au relevé précédent ; seuls changent cinq numéros de ligne cités et deux lignes de commentaire de la recherche large
du n° 22 ; les n° 29 et 30 sont neuves :

| N° | Attendu | Explication (écart avec le relevé du 2026-10-22) |
| --- | --- | --- |
| 1, 2, 4 à 6, 9, 14, 17, 21, 24 | inchangés (2, 1, 0, 0, 0, 3, 0, 2, 1, 3 tables et 3 politiques) | — (listes triées identiques à celles de `9c798e2` ; le lot 13a ne touche que `apps/web`, le lot 13b ajoute `jobs/reveil.ts` sans client PostgreSQL, sans agrégat SQL, sans `console.*`) |
| 3 | 7 lignes | inchangé (`config.ts:191`, `seed.ts` x2, `seed-demo.ts:220`, `web/lib/api-serveur.ts:24`, `ocr-local.ts:280`, `ocr-processus.mjs:76`). Les lots 13a et 13b : 0 (`DebloqueurRendu` ne lit pas `process.env`) |
| 7 | 19 lignes | inchangé. `LIMIT $n` de `ingestion/documents.ts` : `:224` (`:223` avant le lot 13b, qui y ajoute l'import de `signalerJobCree`) ; `ingestion/fichier-temporaire.ts:75` inchangé |
| 8 | 24 lignes | inchangé en nombre. Un numéro bouge : `jobs/worker.ts` `:157` (`:138` avant le lot 13b, qui ajoute le réveil et le rattrapage au worker ; même `Math.round` d'un délai en secondes, pas un montant). Les 23 autres lignes sont identiques |
| 10 | « 990 9 » puis 9 lignes | inchangé : les lots 13a et 13b ne posent aucune route (R-03 modifie `due-diligence/synthese.ts`, une lecture) ; mêmes 9 lignes sans `exiger` |
| 11 | 1 727 gabarits, 1 680 hors seed, 835 interpolations, 247 expressions | inchangé : +0 / +0 / +0 / +0 (script lancé sur `9c798e2` puis sur la tête). Le lot 13b réécrit la requête de `derniereNote` (`due-diligence/synthese.ts`, jointure `dd_note_validations`) : même gabarit, aucune interpolation |
| 12 | 904 `z.object`, dont 893 `.strict()` et 11 non stricts VOLONTAIRES (`contenuAvancementSchema` et ses sous-objets) | inchangé : les lots 13a et 13b n'ajoutent aucun schéma ; les lignes 733 à 798 de `automatisation.ts` n'ont pas bougé. Somme `rg -U -c` : 904 ; `z.object` d'`ingestion/` et de `routes/ingestion*.ts` : 12, inchangés |
| 13 | 232 migrations, 0 modifiée ni supprimée dans l'historique | inchangé : 52 lignes « A » contre `main` et aucune autre ; les lots 13a et 13b n'en posent aucune (R-03 lit `dd_note_validations`, créée par `0507`) |
| 15 | RELANCÉE : « No known vulnerabilities found » (0 vulnérabilité en production) | relancée le 2026-10-23 (réseau) : même résultat ; aucun `package.json` ni lockfile ne change dans les lots 13a et 13b (`next` 15.5.28 et `fastify` 5.12.6 inchangés) |
| 16 | 35 lignes | inchangé (aucune migration) |
| 18 | 7 lignes | inchangé en nombre ; `ingestion/documents.ts` passe de `:484` à `:489` (lot 13b : import de `signalerJobCree` et deux commentaires, +5 lignes avant l'appel). Les six autres lignes sont identiques |
| 19 | 77 lignes dans 61 fichiers | inchangé en nombre et en destinataires. Trois numéros bougent (lot 13a, qui remplace des blocs de ces pages) : `dossiers/[id]/finances/[etatId]/page.tsx` 137 -> 138 et `missions/[id]/plan/[planId]/bancabilite/page.tsx` 137 -> 141 et 153 -> 157 ; les autres numéros cités n'ont pas bougé |
| 20 | 24 lignes | inchangé (liste triée identique, aucun appel ajouté ni déplacé) |
| 22 | 1 ligne (`app/connexion/FormulaireConnexion.tsx:60`) | inchangé. La recherche large `rg -n "\.refresh\(\)" apps/web/src` donne 10 lignes, soit 2 de plus que le relevé précédent, les deux lignes ajoutées sont des commentaires du lot 13a : `components/shell/DebloqueurRendu.tsx:8` et `components/shell/debloqueur.ts:6` (qui nomment `router.refresh()` pour décrire le défaut) ; les 8 autres lignes sont celles du relevé précédent, mêmes numéros |
| 23 à 28 | inchangés (3, 3 tables et 3 politiques, 7, 8, 4, 2 puis « 2 fichier(s) conforme(s) ») | — (listes triées identiques à celles de `9c798e2` ; `fra.traineddata` 1 130 365 octets et `eng.traineddata` 4 113 088 octets conformes à `SHA256SUMS`, code de sortie 0) |
| 29 (neuve) | 2 lignes | lot 13a : `apps/web/src/app/layout.tsx:15` (import de `DebloqueurRendu`) et `:43` (`<DebloqueurRendu />`) ; 0 avant le lot 13a. La recherche large dans `apps/web/src` donne en plus la définition (`components/shell/DebloqueurRendu.tsx:13`) et un commentaire de `useRafraichir.ts:106` |
| 30 (neuve) | 9 lignes | lot 13b (0 avant) : 3 appels, tous après le COMMIT (`ingestion/documents.ts:539` dans `creerDocument`, `routes/ingestion-dd.ts:202`, `routes/ingestion-standard.ts:185`) ; les définitions `jobs/reveil.ts:15` et `:26` ; l'abonnement `jobs/worker.ts:235` ; 3 commentaires (`jobs/worker.ts:20`, `jobs/reveil.ts:3`, `ingestion/documents.ts:335`). Aucun appel dans `mettreEnFileExtraction` ni `mettreEnFileStructuration` |

**Détail du relevé du 2026-10-22 (copie `reste-lot-9f`, HEAD `bdf8c72`, lots 11 et 12 compris), conservé pour l'attribution des
écarts aux lots 11 et 12.** Dans ce tableau, les numéros de ligne de `ingestion/documents.ts` (`:223` du n° 7, `:484` du n° 18) et
ceux du n° 19 sont ceux du 2026-10-22 ; les valeurs en vigueur sont celles du tableau ci-dessus. Il REMPLAÇAIT le relevé du lot 9e
(copie `reste-lot-9e`, HEAD `38e22ae`, lots 6 et 10 compris) :

| N° | Attendu | Explication |
| --- | --- | --- |
| 1, 2, 4 à 6, 14, 17, 21, 24 | inchangés (2, 1, 0, 0, 0, 0, 2, 1, 3 tables et 3 politiques) | — (aucun client PostgreSQL, agrégat SQL, texte d'interface en anglais ni `INSERT INTO agents_evaluations` ajouté par les lots 11 et 12 ; listes triées identiques à celles de `38e22ae`) |
| 3 | 7 lignes | 5 avant : +2, toutes du lot 11, dans `ingestion/` : `ocr-local.ts:280` (`productionOcrParDefaut` lit `process.env.NODE_ENV`, défaut d'une option injectable) et `ocr-processus.mjs:76` (`Object.keys(process.env)`, NOMS des variables du sous-processus, preuve de l'environnement vide ; aucune valeur). `config.ts` : la ligne de `loadConfig` passe de `:183` à `:191` (variable `OCR_LOCAL`, lot 11). Le lot 12 : 0 |
| 7 | 19 lignes | inchangé (listes triées identiques à `38e22ae`). Les lots 11 et 12 n'ajoutent AUCUN `LIMIT` littéral > 1 (`LIMIT $n` du lot 6 : `ingestion/documents.ts:223` liste paginée par curseur, décalée de `:219` par le lot 11, et `ingestion/fichier-temporaire.ts:75` lot de purge) |
| 8 | 24 lignes | 14 avant : +10, toutes du lot 11, JUSTIFIÉES (aucune n'est un montant) : `ingestion/ocr-local.ts:684` (seuil de RSS en octets, x 1,1) et `ingestion/ocr-processus.mjs` x 9 (`:163` pixels par mètre d'un dpi, `:181` et `:183` octets par ligne d'une image 1 bit, `:206`, `:207`, `:213`, `:218` et `:223` ré-échantillonnage d'un scan, `:619` confiance de la page en pour mille). La ligne `ingestion/pdf.ts` de la confiance passe de `:297` à `:361` (lot 11, même `Math.round`). Les 13 autres lignes sont inchangées. Le lot 12 : 0 |
| 9 | 3 lignes | 1 avant (`mailer.ts`) : +2, du lot 11, `ingestion/ocr-local.ts:147` (commentaire qui cite `console.warn`) et `:307` (`options.avertir ?? console.warn` : UN avertissement par processus quand le modèle de permissions manque hors production, sans contenu) |
| 10 | « 990 9 » puis 9 lignes | inchangé : ni le lot 11 ni le lot 12 ne pose de route (méthode vérifiée sur `38e22ae`, mêmes 9 lignes sans `exiger`) |
| 11 | 1 727 gabarits, 1 680 hors seed, 835 interpolations, 247 expressions | 1 726 / 1 679 / 835 / 247 avant : +1 / +1 / 0 / 0, tout dans le lot 11 : `dossier/etats.ts` +1 gabarit (`ingestionDe`, lecture de `id, usage, methode` du document d'un état, aucune interpolation) ; la liste des 247 expressions est identique à celle de `38e22ae`. La lecture des corrections (`ingestion/documents.ts`, `lireCorrectionsOcr`) est une chaîne entre guillemets, hors recherche. Le lot 12 : 0 |
| 12 | 904 `z.object`, dont 893 `.strict()` et 11 non stricts VOLONTAIRES (`contenuAvancementSchema` et ses sous-objets) | 903 avant : +1, lot 11 (`schemas/ingestion.ts`, 13 -> 14, `.strict()` : `correctionOcrSchema`) ; les onze non stricts sont les mêmes (`automatisation.ts`, lignes 733 à 798 inchangées). Hors périmètre de la recherche : les `z.object` d'`apps/api/src/ingestion/` et de `routes/ingestion*.ts` sont identiques avant et après (12 comptés par `rg -U -o 'z\s*\.object\('`, le relevé précédent en citait 9 : décompte non reproduit à l'identique ; le lot 11 n'en ajoute aucun) |
| 13 | 232 migrations, 0 modifiée ni supprimée dans l'historique | 230 avant : +2, lot 11 (`0525_ingestion_ocr_local`, `0526_ingestion_purge_corrections_ocr`) ; 52 lignes « A » contre `main` (50 + 2) et aucune autre ; le lot 12 n'en pose aucune |
| 15 | RELANCÉE : « No known vulnerabilities found » (0 vulnérabilité en production) | Écart du relevé précédent (3 vulnérabilités : `next` 15.5.27 critique et haute, `fastify` 5.12.5 basse) CORRIGÉ par le lot 12 : `next` 15.5.28 (`apps/web/package.json`) et `fastify` 5.12.6 (`apps/api/package.json`), versions exactes, hors règle d'âge de 2 semaines par décision de l'utilisateur du 2026-10-22 (8 et 9 jours). Le lot 11 ajoute `tesseract.js` 7.0.0 (13 paquets au lockfile, aucun binaire natif) sans avis connu |
| 16 | 35 lignes | 34 avant : +1, lot 11, `0526_ingestion_purge_corrections_ocr.sql:74` (`purger_textes_ingestion` REDÉFINIE à l'identique de `0524` plus `corrections_ocr = NULL`, qui reconduit `GRANT EXECUTE` ; relue : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO missionpilot_app`) ; la ligne de `0524` reste, la fonction compte donc deux fois, comme `planifier_conservation_ia`. `0525` : 0 |
| 18 | 7 lignes | inchangé en nombre ; `ingestion/documents.ts` passe de `:448` à `:484` (lot 11) ; les six autres lignes sont inchangées |
| 19 | 77 lignes dans 61 fichiers | inchangé en nombre et en destinataires. Un numéro bouge (lot 11) : `dossiers/[id]/finances/[etatId]/page.tsx` 123 -> 137 ; les autres numéros cités (lots 6, 8b et 10) n'ont pas bougé |
| 22 | 1 ligne (`app/connexion/FormulaireConnexion.tsx:60`) | 13 avant : -12, lot 12 (9 composants passent par `useRafraichir` ; `ActualisationAuto` par `useTransition` + `rafraichirEnTransition`). CIBLE ATTEINTE. Hors de la commande (lignes de commentaire ou variable `routeur`), `rg -n "\.refresh\(\)" apps/web/src` donne 8 lignes, soit 7 de plus, toutes admises : `useRafraichir.ts:19`, `:56` et `:99` (commentaires), `:29` (`routeur.refresh()` dans la transition : le hook lui-même), `useRafraichir.test.ts:13` (intitulé de test), `useFermetureDifferee.ts:8` et `useAttenteRafraichissement.ts:6` (commentaires) |
| 23 | 3 lignes | 1 avant (`ingestion/pdf-worker.mjs:13`) : +2, lot 11 : `ingestion/ocr-processus.mjs:545` (`import("unpdf")` dans le sous-processus OCR, après le pré-contrôle, pour extraire les images d'un scan : même bibliothèque, même version, admis) et `apps/api/test/ocr-outils.test.ts:3` (test, `extractImages` d'`unpdf`). Aucun autre parseur de PDF |
| 25 (neuve) | 7 lignes | 0 avant. Toutes dans `ingestion/ocr-processus.mjs` (`:319` à `:322`, `:330`, `:337`, `:338`) : sondes RÉSERVÉES AUX TESTS qui prouvent que le garde bloque (jamais activées par l'application). Aucune dans `ocr-local.ts`, `ocr.ts`, `pdf*.ts` ni les autres fichiers d'`ingestion/` |
| 26 (neuve) | 8 lignes | 1 avant (`rapports/pdf.ts:1`, import de type). +7, lot 11 : `ocr-local.ts:1` et `:619` (le SEUL `fork` de l'API), `ocr-garde-reseau.cjs:176` et `:252` (remplacement des fonctions de `child_process` par des refus), `ocr-processus.mjs:4` (commentaire), `:323` et `:331` (sonde de test) |
| 27 (neuve) | 4 lignes | 0 avant. Lot 11, `ocr-local.ts` : `:485` (`--max-old-space-size`, `--no-addons`, `--require` du garde), `:498` (`--permission`, `--allow-worker`), `:624` (`cwd: path.dirname(SCRIPT)`) et `:625` (`env: environnementEnfant()`) |
| 28 (neuve) | 2 lignes, puis « 2 fichier(s) conforme(s) » | Lot 11 : `apps/api/package.json:30` (`"tesseract.js": "7.0.0"`) et `ocr-local.ts:51` (`VERSION_MOTEUR_OCR = "7.0.0"`), les deux versions identiques ; `node scripts/ocr-verifier-donnees.cjs` : `fra.traineddata` (1 130 365 octets) et `eng.traineddata` (4 113 088 octets) conformes à `SHA256SUMS`, code de sortie 0 |

```bash
# 1. Pas de client PostgreSQL hors pool.ts et migrate.ts. Attendu : 2 lignes (4 sur la tête super admin du 2026-10-23 : plus
#    les scripts propriétaire `db/creer-super-admin.ts` et `db/seed-defaut.ts`, voir le relevé en tête de section ; 5 sur la tête
#    Tenant démo : plus `db/tenant-demo/index.ts:53`, relevé du 2026-10-24, branche orch/2026-10-24-tenant-demo)
rg -n "new (pg\.)?(Pool|Client)\(" apps/api/src

# 2. Pas d'appel direct au pool hors db/pool.ts. Attendu : 1 ligne (pool.connect)
rg -n "\bpool\.(query|connect)" apps/api/src

# 3. Lectures de process.env hors tests. Attendu (2026-10-23, lot 11 compris) : 7 lignes (14 sur la tête super admin : +7, scripts de
#    seed et de création, voir le relevé en tête de section ; 16 sur la tête Tenant démo : +2, `db/seed-tenant-demo.ts:54` et `:60`,
#    relevé du 2026-10-24, branche orch/2026-10-24-tenant-demo)
#    (config.ts, seed.ts x2, seed-demo.ts, web/lib/api-serveur.ts, plus 2 du lot 11 dans `ingestion/` :
#    `ocr-local.ts:280`, lecture de `NODE_ENV` de `productionOcrParDefaut`, et `ocr-processus.mjs:76`, les NOMS des
#    variables du sous-processus OCR, preuve de l'environnement vide ; toute autre lecture dans l'ingestion est un écart)
rg -n "process\.env" apps/api/src apps/web/src --glob '!*.test.*'

# 4. dangerouslySetInnerHTML / innerHTML dans le web. Attendu : 0
rg -n "dangerouslySetInnerHTML|innerHTML" apps/web/src

# 5. Variables exposées au navigateur. Attendu : 0
rg -n "NEXT_PUBLIC_" apps

# 6. Agrégats SQL (les calculs vont dans packages/engines). Attendu : 0
rg -n "SUM\(|AVG\(" apps/api/src --glob '!db/seed*'

# 7. LIMIT littéral > 1 (toute liste est paginée par curseur, LIMIT $n).
#    Attendu (2026-10-23, tête finale, lots 11 et 12 compris) : 19 lignes (inchangé par les lots 6, 10, 11 et 12 : le lot 6
#    n'ajoute que des `LIMIT $n` (`ingestion/documents.ts:224` liste paginée par curseur, `:223` avant le lot 13b, `:219` avant le lot 11, `ingestion/fichier-temporaire.ts:75` lot de
#    purge), invisibles ici et sans plafond de table ; 19 avec les lots 8b et 8c, 22 avant le lot 8b, inchangé par le lot 4c ;
#    19 au 2026-10-21 ; 1 sur `main` avant la vague 4, 12 après les lots 3a et 3c) :
#    - 1 seed : le LIMIT 2 de db/seed-planification.ts ;
#    - 7 de `redressement/`, chacun DOUBLÉ en base par un plafond de volume (actions.ts 1000 et 200,
#      creanciers.ts 200, 100 et 300, tresorerie.ts 1000, déclencheurs `MPZ10`) sauf seuils.ts (400 lus,
#      6 secteurs × 50 versions = 300 au plus en base) ;
#    - 4 de `canaux/` (maintenance.ts 200, synthese-sources.ts 200, saisies-kpi.ts 200 et 24), lectures
#      BORNÉES relues en entier, chacune doublée d'un plafond de table ;
#    - 4 neuves : `plans/ateliers.ts` (87 options, plafond 50 ; 137 et 489 participants, plafond 100,
#      `MQL08`), `plans/ateliers-contributions.ts:215` (150). Les trois lignes SANS plafond de table
#      d'avant 8b ont quitté la recherche : `plans/ateliers.ts` lit désormais les membres du cabinet et les
#      dirigeants du client en `LIMIT $n` (plafonds déclarés `CANDIDATS_CABINET_LUS_MAX` 500 et
#      `CANDIDATS_DIRIGEANTS_MAX` 200, `tronque: true`) et `qualite/froide-revue.ts` pagine `mes-revues` par
#      curseur keyset (`LIMIT $2`, `:177`) : invisibles ici, plafond de table toujours absent pour les
#      candidats (dette déclarée, CODING_STANDARDS §10) ;
#    - 3 neuves du lot 5b, toutes dans `capitalisation/efficacite.ts` : `:289` (50 instantanés d'une
#      recommandation), `:366` (200 KPI actifs d'une mission), `:375` (200 initiatives du plan) : lectures
#      bornées par le code (menu et historique, troncature silencieuse au-delà), SANS plafond de table
#      trouvé (relu : 0466, 0467, 0160, 0180, 0420), donc dette à relire.
#      L'historique d'adhésion de `capitalisation/observatoire.ts` passe son plafond en paramètre
#      (`OBSERVATOIRE_HISTORIQUE_MAX` = 200, `LIMIT $1`) : invisible à cette recherche, sans plafond de
#      table non plus (même dette que MAX_LISTE). Le lot 7 n'en ajoute aucune : `LIMIT $n` doublé par
#      `MQV02` (500 guichets par cabinet). Le lot 4c n'en ajoute aucune non plus (relu dans le diff : seulement des
#      `LIMIT 1` et des `LIMIT $n` : `agents/contradicteur.ts:313` revues d'un brouillon,
#      `automatisation/avancement-job.ts:172` lot de 25 missions par curseur, `avancement-lecture.ts:124` livrables,
#      `avancement-service.ts:178` rapports d'une mission, `portail/avancement.ts:57` liste du portail par curseur) :
#      invisibles à cette recherche ; aucun n'est doublé d'un plafond de table (au plus un rapport par mission et
#      par semaine, `UNIQUE (mission_id, semaine)`) : le plafond est celui du paramètre de page ou de la constante.
#    À relire si un plafond change sans l'autre (CODING_STANDARDS §10). Ne voit pas un plafond passé
#    en paramètre : MAX_LISTE (500) de routes/portail-gestion.ts est une dette connue.
rg -n "\bLIMIT [0-9]+" apps/api/src | grep -v "LIMIT 1\b"

# 8. Arrondis dans l'API (hors moteur). Attendu (2026-10-23, tête finale, lots 6, 10, 11 et 12 compris) : 24 lignes (la commande exclut
#    `**/tenant-demo/**`, données de démonstration : 77 lignes de plus dans `db/tenant-demo`, arrondis de génération de données ; relevé du 2026-10-24, branche orch/2026-10-24-tenant-demo)
#    (12 inchangées depuis le 2026-10-14, plus 2 du lot 6 : `ingestion/pdf.ts:361` (`:297` avant le lot 11), `Math.round`
#    de la confiance de l'OCR en pour mille, qui n'est pas un montant, et `ingestion/erreurs.ts:29`, `Math.floor` de la
#    taille en Mo dans le message de dépassement, plus 10 du lot 11, aucune n'étant un montant :
#    `ingestion/ocr-local.ts:684` (seuil de RSS en octets) et 9 de `ingestion/ocr-processus.mjs` (`:163` pixels par mètre,
#    `:181` et `:183` octets par ligne d'une image 1 bit, `:206`, `:207`, `:213`, `:218`, `:223` ré-échantillonnage d'un scan,
#    `:619` confiance de la page en pour mille)), toutes justifiées : auth/totp.ts (pas de temps), db/seed-demo.ts x2 (seed),
#    jobs/worker.ts (délai en secondes, `:157` depuis le lot 13b, `:138` avant), stockage/fichiers.ts, routes/fichiers.ts,
#    routes/salle-mission.ts, routes/transcriptions.ts et salle-mission/depots.ts (taille en Mo dans un
#    message), canaux/signatures.ts (nombre de jours d'une durée), routes/canaux.ts (horodatage en
#    secondes du simulateur), routes/missions.ts (inverse de la parité EUR/FCFA, arrondi à
#    numeric(20,10), dette) ; toute autre ligne est un calcul de montant à déplacer
rg -n "Math\.(round|floor|ceil|trunc)|toFixed\(" apps/api/src --glob '!**/tenant-demo/**'

# 9. console.* hors seed et migrate. Attendu (2026-10-23, lot 11 compris) : 3 lignes (5 sur la tête super admin : plus
#    `db/creer-super-admin.ts:221-222`, sortie du script ; 7 sur la tête Tenant démo : plus `db/tenant-demo/contexte.ts:155` et
#    `db/tenant-demo/index.ts:50`, journal par défaut du semis, relevé du 2026-10-24, branche orch/2026-10-24-tenant-demo) (mailer.ts, transport
#    « journal » de développement, plus 2 du lot 11 dans `ingestion/ocr-local.ts` : `:147`, un commentaire, et `:307`,
#    l'unique `console.warn` « sans modèle de permissions », hors production, sans contenu)
rg -n "console\.(log|info|debug|warn|error)" apps/api/src --glob '!**/seed*' --glob '!**/migrate.ts'

# 10. Route sans exiger (par gestionnaire ; exigerPortail compte). Attendu (2026-10-23, tête finale, lots 6, 10, 11 et 12 compris) : "990 9" ; sur la tête super admin du même jour : "1002 14"
#     (+12 routes dont 5 publiques sans `exiger` : voir le relevé en tête de section).
#     Les lots 11 et 12 ne posent aucune route (990 / 9 relevés aussi sur `38e22ae`).
#     990 routes = 972 avant les lots 6 et 10 + 18 du lot 6 (comparaison fichier à fichier avec `48eb2fa` et `9aba318`) :
#     `ingestion.ts` +4 (DOS-03 et lecture des ingestions du dossier), `ingestion-dd.ts` +7 (DD-02, DD-10), `ingestion-standard.ts` +7
#     (STD-13), tous trois fichiers neufs, toutes sous `exiger` ; le lot 10 ne pose aucune route.
#     972 routes (lots 8b et 8c compris) : inchangé par 8b et 8c, qui ne posent aucune route (nombre de routes par fichier
#     de `routes/` identique à l'état d'avant, `6e17248`).
#     972 routes (lot 4c compris) = 957 avant 4c + 15 du lot 4c (comparaison fichier à fichier avec le premier parent du merge
#     `40c0541`) : `automatisation-avancement.ts` +9 (fichier neuf : 2 sur `/missions/:id/avancement`, `GET`/`PATCH
#     /avancement/:id`, `POST …/regenerer`, `…/valider`, `GET`/`PUT /avancement/parametres`, `POST
#     …/suggerer-commentaire`), `agents.ts` +4 (23 → 27 : `/agents/revues-contradictoires` `POST` et `GET`, `…/:id`,
#     `…/preparation`), `portail-avancement.ts` +2 (fichier neuf, `exigerPortail`) ; toutes sous `exiger`.
#     957 routes = 921 au 2026-10-21 + 36 : lot 7 +8 (tous dans `routes/services-candidats.ts` : 3 de
#     services, `GET`, `POST /activer`, `PUT /:code/prix`, et 5 de `/guichets-financement`) ; lot 5b +28 (`appels-offres-veille` 12,
#     `capitalisation-efficacite` 8, `observatoire` 8) ; toutes sous `exiger`.
#     Les 921 du 2026-10-21 = 813 sur `main` + 108, toutes sous `exiger` (répartition relevée par comparaison
#     fichier à fichier avec `main`) : lot 2 +32 (`redressement-checklists` 10, `-causes` 4,
#     `-financement` 6, `-cloture` 6, `-suivi` 4, `-tableau` 2) ; lot 3 +17 (`due-diligence-portail` 8,
#     `due-diligence-modeles` 6, `due-diligence-portail-investisseur` 3) ; lot 4a +24
#     (`qualite-froide` 19, `standard` +5) ; lot 4b +6 (`dossier-groupes` 3, `preuves` +2, `rapports` +1) ;
#     lot 5a +29 (`plans-ateliers` 12, `plans-reprevisions` 7, `plans-montecarlo` 5, `portail-ateliers` 3,
#     `notation-augmentee` +2) ; lot 1 : 0 (les routes `copilote` et `brief` existent déjà).
#     Puis 9 lignes : auth.ts connexion, connexion/2fa, deconnexion ; canaux-webhook.ts
#     `POST /canaux/whatsapp/webhook` (publique, signée HMAC, n'existe qu'avec un fournisseur configuré) ;
#     connexion-demo.ts comptes-demo, connexion-demo ; sante.ts ; utilisateurs.ts et portail-gestion.ts
#     invitations/accepter
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
#     un enum validé ou un FOR UPDATE. Pas de commande rg fiable (les gabarits s'étendent sur plusieurs
#     lignes) : relevé par script ponctuel (pour chaque « .query( » suivi d'un gabarit, extraire les ${…}
#     en suivant l'imbrication ; fichiers *.test.ts exclus). Relevé du 2026-10-22 par script ponctuel hors
#     dépôt (appels `.query(` ou `.query<T>(` dont le premier argument est un gabarit à accent grave ;
#     ${…} extraits en suivant l'imbrication, y compris les gabarits imbriqués ; seed = `db/seed*`) :
#     1 727 gabarits dans apps/api/src (1 680 hors db/seed*), 835 interpolations hors seed, 247 expressions
#     (1 897 / 1 846 / 835 / 247 sur la tête Tenant démo : +165 gabarits constants dans `db/tenant-demo/`, sans interpolation, script
#     retrouvant 1 732 / 1 681 / 835 / 247 sur `git archive a2d7be6` ; relevé du 2026-10-24, branche orch/2026-10-24-tenant-demo)
#     distinctes (tête finale, lots 6, 10, 11 et 12 compris). Relancé le 2026-10-23 (lots 13a et 13b compris) : IDENTIQUE, +0 / +0 / +0 / +0,
#     le script retrouvant 1 727 / 1 680 / 835 / 247 sur l'état d'avant les lots 13 (`git archive 9c798e2`) puis sur la tête. Le script, réécrit pour ce relevé, a d'abord été lancé sur l'état
#     d'avant les lots 12 et 11 (`git archive 38e22ae`) et y retrouve exactement le relevé précédent (1 726 / 1 679 / 835 / 247),
#     puis sur l'arbre courant : +1 / +1 / 0 / 0, tout dans le lot 11 (`dossier/etats.ts`, `ingestionDe` : 9 -> 10 gabarits, 4
#     interpolations dans les deux cas ; la liste des 247 expressions est identique ; le lot 12 : 0). Relevé précédent (lots 6 et 10
#     compris) : 1 726 / 1 679 / 835 / 247, lancé sur l'état d'avant les lots 6 et 10
#     (`git archive 48eb2fa`), où il retrouvait 1 699 / 1 652 / 813 / 240, puis sur l'état
#     du lot 10 seul (`9aba318` : 1 699 / 1 652 / 813 / 240 aussi). Écarts du lot 6 : +27 / +27 / +22 / +7,
#     tous dans `apps/api/src/ingestion/` (gabarits : `documents.ts` +10, `extractions.ts` +6, `job-extraction.ts` +3,
#     `job-structuration.ts` +3, `fichier-temporaire.ts` +2, `ia-lignes.ts`, `standard-application.ts` et
#     `structuration-standard.ts` +1 chacun) ; les sept expressions distinctes neuves, relues par leur nom, sont
#     `COLONNES_DOCUMENT` et `DEPUIS_DOCUMENT` (colonnes et jointure constantes), `DELAI_DOCUMENT_MORT_MINUTES` (constante),
#     `n + 1`, `n + 2`, `n + 3` (index de paramètres `$n`) et `p.sql` (fragment de `clausePortee`, construit sur la liste
#     fermée `COLONNES_PORTEE`, valeurs en paramètres) ; aucune valeur issue d'une requête HTTP. Le lot 10 : 0 / 0 / 0 / 0.
#     Relevé précédent (lots 8b et 8c compris) : 1 699 / 1 652 / 813 / 240, lancé d'abord sur l'état d'avant 8b
#     et 8c (`git archive 6e17248`) où il retrouvait le relevé précédent (1 697 / 1 650 / 811 / 240).
#     Écarts des lots 8b et 8c : +2 / +2 / +2 / 0, tous du lot 8b (le lot 8c ne touche pas
#     l'API) : `brief/derives.ts` +1 gabarit (`voyantsRedressementRouges`, interpolations `COLONNES_DOSSIER` et
#     `VISIBLE`, déjà parmi les 240) et `plans/montecarlo.ts` +1 gabarit (décompte de `plan_rejeux_montecarlo`, aucune
#     interpolation) ; aucune expression distincte nouvelle. Avant 8b : 1 672 / 1 625 / 796 / 238 avant le lot 4c, le même
#     script y retrouvant l'état d'avant 4c.
#     Écarts du lot 4c : +25 / +25 / +15 / +2, répartis ainsi (gabarits) : `automatisation/avancement-service.ts` +9,
#     `agents/contradicteur.ts` +4, `automatisation/avancement-job.ts` +4, `portail/avancement.ts` +2, `ia/cache.ts` +2,
#     `agents/plafonds.ts` +1, `routes/ia-parametres.ts` +1, `automatisation/avancement-lecture.ts` +1,
#     `ia/prompts/gabarits/revue-contradictoire.ts` +1 ; les deux expressions distinctes neuves sont
#     `COLONNES_MISSION_AVANCEMENT` et `DEPUIS_RAPPORT` (constantes de colonnes et de jointure, relues par leur nom).
#     Le même script rendait à l'identique les relevés antérieurs : `main` 1 426 / 1 381 / 664 / 207
#     et branche au 2026-10-21 1 613 / 1 566 / 773 / 235 (méthode approchée du 2026-10-21 retrouvée, donc
#     comparables). Écarts d'avant 4c : lot 7 +15 / +15 / +6 / 0 (services, prix, guichets, rapprochement : aucune
#     expression distincte nouvelle) ; lot 5b +44 / +44 / +17 / +3 (`COLONNES_RESULTAT` constante de colonnes de
#     `appels-offres/veille.ts`, `filtre` gabarit constant à paramètres `$n` du même fichier, `v.sql` fragment de
#     visibilité de `capitalisation/efficacite.ts`). Ces nombres NE SONT PAS comparables au relevé du
#     2026-10-06 (577 gabarits, 299 interpolations, 105 expressions), obtenu avec un autre script ; seule la
#     comparaison avec `main` par le même script vaut. Les 31 expressions distinctes nouvelles depuis `main` (28 au
#     2026-10-21, 3 du lot 5b) ont été relues par leur nom :
#     constantes de colonnes, de jointures ou de plafonds, `sens` typé `"ASC" | "DESC"`, liste de
#     tables constante de `copilote/noms-propres.ts` ; aucune valeur issue d'une requête HTTP, mais les
#     corps des constantes n'ont pas tous été rouverts.

# 12. Schémas Zod non stricts. Relancé le 2026-10-23 (lots 13a et 13b : 0 schéma de plus, mêmes onze lignes 733 à 798, script retrouvant
#     904 / 893 / 11 sur `9c798e2` puis sur la tête). Attendu (2026-10-23, tête finale, lots 11 et 12 compris) : 11 non stricts sur 904 z.object (893 stricts), TOUS dans
#     `automatisation.ts` et voulus : `contenuAvancementSchema` (racine, `mission`, `avancement`, `jalons`, `kpis`
#     et ses éléments, `livrables` et ses éléments, éléments de `faits_saillants`) et les deux sous-schémas de jalons
#     (lignes 733, 737, 746, 751, 752, 756, 763, 771, 782, 788, 798 au 2026-10-22) : sortie du moteur relue par
#     LISTE BLANCHE (clés inconnues écartées, jamais une entrée de requête) ; la projection portail
#     (`contenuAvancementPortailSchema`) est, elle, entièrement stricte. Tout autre non strict est un écart.
#     904 = 903 + 1 du lot 11 (`schemas/ingestion.ts`, 13 -> 14 appels, `.strict()` : `correctionOcrSchema`) ; le lot 12 n'en
#     ajoute aucun ; les lignes des onze non stricts (733 à 798) n'ont pas bougé. Le script de contrôle, écrit hors dépôt, retrouve
#     903 / 892 / 11 aux mêmes lignes sur `38e22ae` (`git archive`), puis 904 / 893 / 11 sur la tête.
#     903 = 890 avant le lot 6 + 13 du lot 6 (`schemas/ingestion.ts`, tous `.strict()`, y compris `numeroPageParamsSchema` et
#     `ingestionDdQuerySchema`) ; le lot 10 n'en ajoute aucun ; les lignes des onze non stricts n'ont pas bougé. Hors du périmètre
#     de cette recherche (`packages/shared`), les `z.object` d'`apps/api/src/ingestion/` et de `routes/ingestion*.ts`
#     (paramètres de routes, charges de jobs, `etat-financier.ts`, `ocr.ts` ; 12 à `rg -U -o 'z\s*\.object\('` sur ces
#     chemins, identiques avant et après le lot 11, qui n'en ajoute aucun ; le relevé précédent en citait 9) sont aussi `.strict()`.
#     890 = 889 avant 8b + 1 du lot 8b (`mesRevuesQuerySchema`, `schemas/qualite.ts`, strict) ; les lignes des onze non
#     stricts n'ont pas bougé. 889 = 867 avant 4c + 22 du lot 4c (`automatisation` +19 dont les 11 non stricts ci-dessus ; `agents` +2 ; `portail` +1), soit 878 stricts. Avant 4c : 0 non strict sur 867
#     z.object (723 sur `main` : +144, tous `.strict()` :
#     lot 7 +6 (`services-candidats`), lot 5b +17 (`appels-offres-veille` 7, `capitalisation-efficacite` 5,
#     `observatoire` 5), puis les +121 du 2026-10-21 (844) :
#     lot 5a +32 (`plans-ateliers` 17, `plans-montecarlo` 8, `plans-reprevisions` 6, `notation-augmentee`
#     +1), lot 2 +52 (`redressement-*` et `redressement` +1), lot 4a +14 (`qualite` +10, `standard` +4),
#     lot 3 +11 (`due-diligence-portail` 7, `due-diligence` +4), lot 4b +6 (`dossier` +2, `preuves` +2,
#     `rapports` +2), lot 1 +6 (`copilote`)) de
#     packages/shared/src/schemas (hors *.test.ts ; chaque z.object a .strict()
#     dans sa chaîne d'appels, y compris `z.object(...).partial().strict()`).
#     `rg -o "z\s*\.object\("` sans -U ne voit que les appels écrits sur une seule ligne : ne PAS
#     s'y fier. Script ponctuel, pas rg : apparier les parenthèses en sautant chaînes, gabarits ET
#     commentaires (une apostrophe dans un commentaire français fausse un
#     appariement naïf), puis, après la parenthèse fermante, parcourir les appels
#     chaînés `.methode(...)` jusqu'à trouver `strict`. Compte de contrôle :
#     rg -U -c "z\s*\.object\(" packages/shared/src/schemas --glob '!*.test.ts'
#     (somme 904 le 2026-10-22 avec le lot 11, 903 avec les lots 6 et 10, 890 avant les lots 6 et 10 et avec le lot 8b, 889 avant 8b, 867 avant 4c, 844 le 2026-10-21 ;
#     723 sur `main`). Le script de contrôle strict, écrit hors dépôt comme décrit (réécrit pour ce relevé), retrouve 890 et
#     11 non stricts, aux mêmes lignes, sur l'état d'avant les lots 6 et 10 (`git archive 48eb2fa`) et sur le lot 10 seul
#     (`9aba318`), puis 903 avec 11 non stricts aujourd'hui (il avait aussi retrouvé 889 et 11 sur l'état d'avant 8b,
#     `git archive 6e17248`, et 867 et 0 non strict avant 4c). L'attribution du +2 de `rapports` au lot 4b est
#     approximative (le lot 2 touche aussi les rapports).

# 13. Migration existante modifiée ou supprimée dans l'historique git. Attendu : 0 ligne (tête super admin du 2026-10-23 : 239 fichiers,
#     0 ligne ; les 7 de plus sont `0570`–`0573` et `0580`–`0582` ; lot 7 : 240 fichiers avec `0583`, et 3 lignes (`0570`, `0573`, `0580`) car
#     le commit de documentation `e6b294b` a retouché des commentaires avant la fusion dans `main` : comparer à `main`, qui ne rend que des « A »)
git log --diff-filter=MD --name-only --format= -- apps/api/migrations | sort -u
# Dans une branche : git diff --name-status main -- apps/api/migrations
# ne doit montrer que des lignes « A » (ajouts). Le 2026-10-23 (tête finale, lots 11, 12, 13a et 13b compris ; les lots 13 n'en posent aucune) : 52 lignes « A »,
# aucune autre (`main` local = `origin/main` = `3d5a252`, base commune de la branche ; aucun fetch réseau fait). Dossier :
# 232 fichiers (`ls apps/api/migrations | wc -l` : 232 ; `git ls-files apps/api/migrations | wc -l` : 232, tous
# commités sur la branche d'intégration ; `git status --short apps/api/migrations` : aucune ligne ; la commande
# `git log --diff-filter=MD …` ne renvoie rien).
# 232 = 230 avant le lot 11 + 2 du lot 11 (`0525_ingestion_ocr_local`, `0526_ingestion_purge_corrections_ocr` ; le lot 12
# n'en pose aucune, `git diff --name-status 38e22ae HEAD -- apps/api/migrations` ne montre que ces deux lignes « A »).
# 230 = 226 avant les lots 6 et 10 + 4 du lot 6 (`0521_ingestion_documents`, `0522_ingestion_extractions`,
# `0523_ingestion_etats_pdf`, `0524_ingestion_purge_textes` ; le lot 10 n'en pose aucune,
# `git diff --name-status 48eb2fa HEAD -- apps/api/migrations` ne montre que ces quatre lignes « A »).
# 226 = 224 avant 8b + 2 du lot 8b (`0290_qualite_froide_reaffectation`, `0432_plan_montecarlo_rejeux` ; le lot 8c n'en pose
# aucune, `git diff --name-status 6e17248 HEAD -- apps/api/migrations` ne montre que ces deux lignes « A ») ;
# 224 = 219 avant 4c + 5 du lot 4c (0278, 0279, 0306, 0307, 0308) ; 219 = 206 du 2026-10-21 + 4 du lot 7 (0560, 0561, 0562, 0563) + 9 du lot 5b (0364 à 0367 veille AO, 0466
# et 0467 efficacité, 0470 à 0472 observatoire). Les 206 = 180 de `main` (155 + 0480–0486 + 0500–0508 +
# 0540–0548) + 26 des lots : lot 1 (0275, 0276,
# 0277, 0305, 0550), lot 2 (0487 à 0492, 0551), lot 3 (0509, 0511, 0549), lot 4a (0210, 0287, 0288,
# 0289), lot 4b (0225, 0552), lot 5a (0425, 0426, 0429, 0430, 0431) ; le lot 8a n'en pose aucune.
# `origin/main` compte 180 migrations (PR n° 12 à 14 fusionnées, égal à `main` local au 2026-10-21).
# Les 52 sont à tenir pour immuables dès qu'elles sont commitées.

# 14. Textes d'interface en anglais (échantillon). Attendu : 0
rg -n ">\s*(Submit|Cancel|Save|Delete|Loading|Error|Login|Sign in|Logout|Search)\s*<" apps/web/src

# 15. Dépendances vulnérables (réseau requis). RELANCÉ le 2026-10-23 (copie `reste-lot-9g`, tête finale, lots 13a et 13b compris : aucun
#     `package.json` ni lockfile modifié, même résultat que le 2026-10-22, copie `reste-lot-9f`) : « No known
#     vulnerabilities found » (0 vulnérabilité en production). Le relevé précédent (copie `reste-lot-9e`) en comptait 3
#     (`next` 15.5.27 : critique `GHSA-2464-fhr4-w9xw`, exécution de code à distance non authentifiée de l'optimisation
#     d'images avec des SVG, et haute `GHSA-p3m5-59mp-jv5r`, déni de service des Server Actions ; `fastify` 5.12.5 : basse
#     `GHSA-389g-gv7q-r4x8`, contournement de la validation d'en-têtes), corrigées par le lot 12 : `next` **15.5.28**
#     (`apps/web/package.json`) et `fastify` **5.12.6** (`apps/api/package.json`), versions EXACTES. Règle d'âge de 2
#     semaines (`--config.minimumReleaseAge=20160`) : exception DÉCIDÉE PAR L'UTILISATEUR le 2026-10-22 pour ces deux versions
#     seulement (8 et 9 jours ce jour-là, aucune version corrigée plus ancienne n'existe) ; toute autre dépendance ajoutée ou
#     montée reste soumise à la règle. Le lot 11 ajoute `tesseract.js` 7.0.0 (13 paquets au lockfile, tous de plus de deux
#     semaines, aucun binaire natif, script `postinstall` d'`opencollective-postinstall` bloqué par pnpm 10). L'audit complet
#     relevait 15 constats, tous via vitest, développement, SECURITY.md §14, non relancé. Aucun accès réseau n'est ajouté par
#     les lots 6, 11 et 12 dans `ingestion/` : voir la recherche n° 25 (seules des sondes de test de `ocr-processus.mjs`
#     nomment `fetch` et `node:net`/`http(s)`/`dns`).
pnpm audit --prod

# 16. Fonctions SECURITY DEFINER accordées au rôle applicatif : relire chaque
#     migration qui en ajoute (search_path, REVOKE FROM PUBLIC) et comparer à
#     SECURITY.md §4. Attendu : 42 lignes sur la tête du lot 7 du 2026-10-23 (41 + 1 : `0583`, `demo_lister_comptes` redéfinie) ; 41 lignes sur la tête super admin du lot 4 (35 + 6 : `0570`, `0572`, `0573`, `0580`, `0581`, `0582`) ; 35 lignes au 2026-10-22, lots 4c, 6, 8b, 8c, 10, 11 et 12 compris (34 avant le lot 11 : +1 de `0526`, `purger_textes_ingestion` (`:74`), REDÉFINIE à l'identique de `0524` plus `corrections_ocr = NULL` (`GRANT EXECUTE` reconduit, relue : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`) : la ligne de `0524` reste, la fonction compte donc deux fois ; `0525` et le lot 12 : 0 ; 32 avant le lot 6 : +2 de `0524`,
#     `purger_textes_ingestion` (`:84`) et `planifier_ingestion_maintenance` (`:123`), relues : `SECURITY DEFINER`, `SET search_path =
#     public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO missionpilot_app`, première bornée au cabinet du contexte
#     par `app_cabinet_id()` ; le lot 10 n'en pose aucune ; inchangé par 8b et 8c : `0290` et `0432` n'en portent aucune ; 30 avant 4c ; 28 au 2026-10-21 ; 27 sur `main` : 23 avant la vague 4, plus
#     quatre du lot 3c, `resoudre_compte_canal`, `planifier_synthese_hebdo`,
#     `planifier_canaux_maintenance`, `anonymiser_transcriptions`). Les deux lignes du lot 4c (relues : `SET search_path =
#     public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO missionpilot_app`) sont `0278`
#     (`planifier_conservation_ia`, REDÉFINIE à l'identique de `0104` plus le critère « entrée de cache échue » : la
#     ligne de `0104` reste, elle compte donc deux fois dans la recherche) et `0308` (`planifier_avancement_hebdo`,
#     `SECURITY DEFINER`, ne renvoie qu'un nombre, clé et heure contrôlées). Les deux lignes du lot 5b sont `0470` (`obs_adhesion_active`, fonction D'APPELANT sous RLS, `STABLE`,
#     `search_path` figé, REVOKE PUBLIC : pas `SECURITY DEFINER`) et `0472` (`obs_agregats`, `SECURITY DEFINER`,
#     `search_path = public, pg_temp`, REVOKE PUBLIC : seul accès inter-cabinets, voir le contrôle de
#     l'observatoire) ; les migrations du lot 7 n'en comptent aucune. La ligne du 2026-10-21 est celle de `0275`
#     (`rejeu_evaluation_demarrer`, `_inscrire_appel`, `_terminer`, avec `SET search_path = public,
#     pg_temp`) ; aucune autre migration des lots n'en ajoute (redressement, due diligence, ateliers,
#     groupes, revue à froide, limiteur : 0). Les fonctions `rejeu_controler_job`,
#     `rejeu_demande_verrouillee`, `rejeu_controler_fin` et les `garder_*` sont internes ou de
#     déclencheur (non accordées). Rappel : trois des vagues 2 et 3 (`planifier_detection_automatisation`
#     `0302`, `octets_stockage_utilises` `0331`, `anonymiser_cv_ao` `0386`) et trois des lacunes de la
#     vague 2 (`planifier_brief_quotidien` `0304`, `anonymiser_copilote_actions` `0274`,
#     `planifier_purge_copilote` `0274`) ont toutes search_path figé et REVOKE ALL FROM PUBLIC. Les
#     fonctions `est_*` de `0243` et `0267` sont d'appelant, sous la RLS du cabinet
rg -n "GRANT EXECUTE" apps/api/migrations

# 17. Écritures rejouables : tout en-tête Idempotency-Key passe par
#     temps/idempotence.ts. Attendu : 2 lignes (import et usage dans feuilles-temps.ts)
rg -n "ENTETE_IDEMPOTENCE|idempotency-key" apps/api/src --glob '!**/idempotence.ts'

# 18. Réception de fichiers : toute route multipart passe par avecPlaceAnalyse.
#     Attendu (2026-10-23, tête finale, lots 6 et 11 compris) : 7 lignes (6 inchangées depuis le 2026-10-14, plus 1 du lot 6) : `POST /fichiers`
#     (routes/fichiers.ts, 2 appels), classeur d'états financiers du dossier client (routes/dossier-client.ts), dépôt de la salle
#     de mission par le cabinet (routes/salle-mission.ts:316) et par le portail (:444), dépôt audio
#     (routes/transcriptions.ts), et l'ingestion de documents (`ingestion/documents.ts:489`, `:484` avant le lot 13b, `:448` avant le lot 11, `creerDocument`, commun aux trois routes de
#     téléversement d'ingestion : DOS-03, DD, amorçage STD-13). L'import Excel des temps (routes/import-temps.ts) n'y passe pas :
#     `lireClasseurTemps` a son propre sémaphore (temps/import-excel.ts)
rg -n "avecPlaceAnalyse\(" apps/api/src

# 19. Page serveur qui passe une fonction à un composant : lister les propriétés
#     `={(…) =>` des pages et layouts qui ne sont PAS marqués "use client", puis
#     vérifier à la main que le composant destinataire n'est pas client (ni
#     importé d'un fichier "use client"). Attendu (2026-10-23, tête finale, lots 6, 10, 11 et 12 compris) : 77 lignes dans 61
#     fichiers (inchangé par les lots 6, 10, 11 et 12, hors quatre numéros de ligne décalés : lot 10 `connaissances/efficacite/page.tsx`
#     86 -> 87 et `qualite/revue-froide/[id]/page.tsx` 199 -> 202, lot 6 `dossiers/[id]/finances/page.tsx` 73 -> 77, lot 11
#     `dossiers/[id]/finances/[etatId]/page.tsx` 123 -> 137 puis 138 (lot 13a), lot 13a `missions/[id]/plan/[planId]/bancabilite/page.tsx`
#     137 -> 141 et 153 -> 157 ; les cinq numéros
#     décalés de 1 ou 2 par le lot 8b : `facturation/page.tsx:152`,
#     `missions/page.tsx:205`, `pipeline/page.tsx:139` et `:232`, `temps/debours/page.tsx:92` ; 76 dans 60 avant 4c, 75 dans 59 au 2026-10-21, 73 dans 58 sur `main`), toutes admises : 71 `cleLigne` (67 sur `main`, plus 2 au
#     2026-10-21 : `missions/[id]/notation/analyse/page.tsx` et `qualite/revue-froide/[id]/page.tsx:202`, plus 1 du
#     lot 5b : `connaissances/efficacite/page.tsx:87`, plus 1 du lot 4c : `missions/[id]/avancement/page.tsx:133`,
#     page serveur sans "use client" qui passe `cleLigne={(l) => l.id}` à `<Tableau`) vers
#     `components/ui/Tableau.tsx` (composant serveur ; une occurrence par `<Tableau`), 3 `href` vers
#     `components/facturation/SegmentsStatut.tsx` (serveur), `hrefCible` vers
#     `ExplicationNote` (composant local du fichier), et 2 faux positifs (`.map` et
#     `.filter` passés à `options` et `visibles`, ce ne sont pas des fonctions
#     passées). Tout autre destinataire est à justifier ; sa propriété doit alors
#     être sérialisable.
rg -n "=\{\(.*\) =>" apps/web/src/app --glob '**/page.tsx' --glob '**/layout.tsx'

# 20. Boucles de pagination côté web : chaque appel de `chargerToutesLesPages`
#     déclare le plafond de la route. Attendu (2026-10-23, tête finale, lots 6, 10, 11 et 12 compris) : 24 lignes (inchangé par les lots 6, 10, 11 et 12 : listes triées
#     identiques, aucun appel ajouté ni déplacé), soit
#     23 appels plus la définition de `lib/pagination.ts` (23 lignes avant 8b : le lot 8b ajoute `chargerMesRevues`,
#     `lib/qualite-froide-serveur.ts:98`, `limiteMax: LIMITE_MES_REVUES` = 100) ; les boucles des écrans de la vague 4
#     (`due-diligence*.ts`, `canaux-serveur.ts`) déclarent le plafond de leur route ; les appels sur
#     `/api/missions` ou `/api/opportunites` (plafond 500) passent `limiteMax: LIMITE_PAGE_MAX` depuis le lot 8b
#     (dix pages : charge, facturation, mes-taches/nouvelle, qualite, qualite/acceptation, qualite/satisfaction,
#     temps/debours, pipeline, missions, `clients/[id]/portail` ; `due-diligence-serveur.ts:191` le faisait déjà) : les 23
#     appels déclarent un `limiteMax`, tout appel sans `limiteMax` est un écart (contrôle par script : appariement
#     des parenthèses de chaque appel, relancé le 2026-10-22 : 24 trouvés avec `limiteMax`, les 23 appels et la définition). Le lot 8c ne déplace aucun appel. Aucune page des lots du
#     2026-10-20 n'appelle `chargerToutesLesPages` ; seule `lib/qualite-froide-serveur.ts` (lot 8b) s'y ajoute.
rg -n "chargerToutesLesPages(<[^>]*>)?\(" apps/web/src --glob '!*.test.*'

# 21. Provenance des évaluations de non-régression : un seul `INSERT INTO
#     agents_evaluations` dans le code TypeScript de l'API, l'évaluation locale (`agents/evaluations.ts`,
#     toujours « local »). L'évaluation de rejeu réel (`openrouter`) est insérée depuis `0275` par la
#     fonction SQL `rejeu_evaluation_terminer` (SECURITY DEFINER), sous garde d'une demande née d'un
#     job (migration `0270`) ; `agents/evaluations-openrouter.ts` n'a plus d'INSERT. Attendu
#     (2026-10-22) : 1 ligne (2 sur `main`) ; toute autre ligne qui écrit `fournisseur = 'openrouter'`
#     est un écart. Les tests sèment une évaluation réelle par `apps/api/test/evaluation-reelle.ts`.
rg -n "INSERT INTO agents_evaluations\b" apps/api/src

# 22. Rafraîchissement web après écriture : plus aucun `router.refresh()` direct hors du hook `useRafraichir`
#     (`components/formulaires/useRafraichir.ts`, qui appelle `routeur.refresh()` par une autre variable) et de
#     `FormulaireConnexion`. La commande écarte les lignes de commentaire (première marque non blanche `*` ou `/`).
#     Attendu (2026-10-23, tête finale, lot 12 compris) : 1 ligne (`app/connexion/FormulaireConnexion.tsx:60` ; `:55` sur la tête super admin du 2026-10-23), CIBLE
#     ATTEINTE. 13 lignes dans 10 fichiers avant le lot 12 (12 appels directs du lot 6, développé avant le hook, dans 9
#     composants : `BoutonRelance`, `ActualisationAuto` (`setInterval`), `ImportEtatDocument`, `ImportEtatDocumentListe`,
#     `DocumentsTeleversement`, `DocumentsListe`, `DocumentsLecture`, `AmorcageDocuments`, `AmorcageProposition`) ; 98
#     lignes dans 70 fichiers avant le lot 10, qui en migre 69. Le lot 12 les passe par `useRafraichir` ;
#     `ActualisationAuto` (rafraîchissement toutes les 3 s) utilise `useTransition` et `rafraichirEnTransition`, exporté
#     par `useRafraichir.ts`, et saute un tick tant que la transition précédente n'est pas finie. La recherche large
#     `rg -n "\.refresh\(\)" apps/web/src` donne 8 lignes : la ligne ci-dessus plus 7 admises (`useRafraichir.ts:19`,
#     `:56` et `:99`, commentaires ; `:29`, `routeur.refresh()` du hook lui-même ; `useRafraichir.test.ts:13`, intitulé de
#     test ; `useFermetureDifferee.ts:8` et `useAttenteRafraichissement.ts:6`, commentaires). Relevé du 2026-10-23 : inchangé pour la
#     commande (1 ligne) ; la recherche large donne 10 lignes, soit 2 commentaires du lot 13a de plus
#     (`components/shell/DebloqueurRendu.tsx:8` et `debloqueur.ts:6`, qui décrivent le défaut de `router.refresh()`).
rg -n "^\s*([^*\s/].*)?\brouter\.refresh\(" apps/web/src --glob '!*.test.*'

# 23. Lecture de PDF : un seul import d'une bibliothèque de PDF (`unpdf`, dans le worker d'extraction après le pré-contrôle
#     de `pdf-controle.ts`), aucun autre parseur. Attendu (2026-10-23, lot 11 compris) : 3 lignes : `apps/api/src/ingestion/pdf-worker.mjs:13` (0 avant le lot 6),
#     `apps/api/src/ingestion/ocr-processus.mjs:545` (lot 11 : `import("unpdf")` du sous-processus OCR, qui extrait les images d'un
#     scan APRÈS le pré-contrôle, même bibliothèque et même version) et `apps/api/test/ocr-outils.test.ts:3` (test du lot 11). Toute
#     autre ligne est un parseur de PDF hors du circuit contrôlé (ADR-009)
rg -n "(from|import\(|require\()\s*[\"'](unpdf|pdfjs-dist|pdf-parse|pdf-lib|pdf2json)" apps packages --glob '!**/node_modules/**'

# 24. Toute table d'ingestion porte sa politique `portail_interdit` (garde : `isolation.test.ts`). Attendu : les deux
#     commandes rendent les mêmes comptes par fichier, `0521_ingestion_documents.sql:2` (`ingestion_documents`,
#     `ingestion_pages`) et `0522_ingestion_extractions.sql:1` (`ingestion_extractions`), soit 3 tables et 3 politiques ;
#     une table `ingestion_*` de plus sans sa politique rend le second compte inférieur au premier
rg -c "CREATE TABLE ingestion_" apps/api/migrations
rg -c "CREATE POLICY portail_interdit ON ingestion_" apps/api/migrations

# 25. Aucun accès réseau dans l'ingestion (lot 11 : l'OCR tourne sur le serveur, jamais de service externe). Attendu : 7 lignes, toutes
#     dans `ingestion/ocr-processus.mjs` (`:319` à `:322`, `:330`, `:337`, `:338`) : sondes RÉSERVÉES AUX TESTS qui prouvent que le
#     garde réseau bloque (jamais activées par l'application) ; 0 avant le lot 11. Le garde `ocr-garde-reseau.cjs` est exclu
#     (il nomme ces modules pour les refuser). Toute autre ligne, notamment dans `ocr-local.ts`, `ocr.ts` ou `pdf*.ts`, est un
#     écart : un accès réseau (`fetch`, `dns`, `http`, `net`) ajouté à l'ingestion
rg -n "\bfetch\(|node:(https?|net|dns|tls|dgram|http2)|from \"(https?|net|dns|tls|dgram)\"|undici|axios|XMLHttpRequest" apps/api/src/ingestion --glob '!ocr-garde-reseau.cjs'

# 26. Lancement de processus : le seul `fork` de l'API est celui de l'OCR local. Attendu : 8 lignes (1 avant le lot 11 :
#     `rapports/pdf.ts:1`, import de type) : `ingestion/ocr-local.ts:1` (import) et `:619` (le `fork`), `ocr-garde-reseau.cjs:176`
#     et `:252` (le garde remplace les fonctions de `child_process` par des refus), `ocr-processus.mjs:4` (commentaire), `:323` et
#     `:331` (sonde de test). Tout `fork`, `spawn` ou `exec` hors de ces lignes est un écart
rg -n "child_process|\b(fork|spawn|spawnSync|execFile|execFileSync|execSync)\(" apps/api/src --glob '!*.test.*'

# 27. Paramètres du sous-processus OCR. Attendu : 4 lignes de `ingestion/ocr-local.ts` : `:485` (`--max-old-space-size`, `--no-addons`,
#     `--require` du garde), `:498` (`--permission`, `--allow-worker`), `:624` (`cwd: path.dirname(SCRIPT)`, JAMAIS le dossier
#     courant de l'API) et `:625` (`env: environnementEnfant()`, environnement vide) ; 0 avant le lot 11. Une ligne qui manque
#     ou un `cwd` absent est un écart
rg -n "^\s*(cwd:|env: environnementEnfant\(\)|const args = |args\.push\(\"--permission\")" apps/api/src/ingestion/ocr-local.ts

# 28. Moteur et données de langue vendorées. Attendu : 2 lignes (`apps/api/package.json:30` `"tesseract.js": "7.0.0"` et
#     `ocr-local.ts:51` `VERSION_MOTEUR_OCR = "7.0.0"`, identiques : sinon l'OCR se désactive), puis « 2 fichier(s) conforme(s) »
#     (`fra.traineddata` 1 130 365 o, `eng.traineddata` 4 113 088 o, conformes à `SHA256SUMS`, code de sortie 0). Une mise à jour
#     passe par `apps/api/ocr-data/README.md` ET ce script
rg -n "VERSION_MOTEUR_OCR =|\"tesseract\.js\":" apps/api/src/ingestion/ocr-local.ts apps/api/package.json
node scripts/ocr-verifier-donnees.cjs

# 29. DebloqueurRendu monté au layout racine (lot 13a, A-04, R-01, R-02). Attendu : 2 lignes, `app/layout.tsx:15` (import) et `:43`
#     (`<DebloqueurRendu />`). Une ligne ou aucune : le composant a été retiré (ou n'est plus monté) et les écrans périmés après
#     écriture et les liens sans effet reviennent. À revoir à chaque montée de Next ou de React
rg -n "DebloqueurRendu" apps/web/src/app/layout.tsx

# 30. Signal de réveil du worker après COMMIT (lot 13b, R-08). Attendu : 9 lignes (3 appels après COMMIT : `ingestion/documents.ts:539`,
#     `routes/ingestion-dd.ts:202`, `routes/ingestion-standard.ts:185` ; définitions `jobs/reveil.ts:15` et `:26` ; abonnement
#     `jobs/worker.ts:235` ; 3 commentaires). Tout appel dans `mettreEnFileExtraction` ou `mettreEnFileStructuration` (INSERT dans la
#     transaction de l'appelant : le worker lirait avant la validation) ou tout écouteur hors `jobs/worker.ts` est un écart
rg -n "signalerJobCree\(|ecouterJobCree\(" apps/api/src --glob '!*.test.*'
```
