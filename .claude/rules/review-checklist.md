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
ont été relevés le 2026-10-22 en lançant les commandes ci-dessous dans la copie de travail
`reste-lot-9e` (branche d'intégration `orch/2026-10-20-reste-lot-9e`, HEAD `38e22ae` = fusion du lot 6) : `main`, identique à
`origin/main` (merge commit `3d5a252`, PR n° 14, vague 4 fusionnée), plus les lots 1 (socle IA),
2 (redressement 3a-bis), 3 (due diligence 3b-bis, canaux 3c-bis), 4a (méthodes et revue à froide),
4b (dossier, preuves, finance), 4c (rapport d'avancement hebdomadaire, cache et plafonds IA,
contradicteur), 5a (plans et notation augmentés), 5b (capitalisation, observatoire,
veille des appels d'offres), 7 (services candidats), 8a (CI), 8b (dettes transverses : voyant
rouge du brief, revue à froide paginée, ateliers, rejeux Monte-Carlo, `paramsId` strict, pages de 500)
8c (découpage de 34 fichiers web), 6 (ingestion de documents : ADR-009, DOS-03, DD-02, DD-10, STD-13)
et 10 (corrections de la recette navigateur : hook `useRafraichir`, `codes403Metier`, horodatage des
preuves rejoué) du chantier du 2026-10-20, non encore fusionnés dans `main`. Les valeurs de `main` restent entre parenthèses quand
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
  `planifier_ingestion_maintenance` de `0524`) : `SECURITY DEFINER`,
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
  recréer). Au 2026-10-22, les 230 fichiers de la branche d'intégration sont commités
  (180 déjà dans `origin/main` après les PR n° 12 à 14, 50 posés par les lots du 2026-10-20 et
  du 2026-10-21, dont `0364`–`0367`, `0466`–`0467`, `0470`–`0472`, `0560`–`0563`, pour le lot 4c
  `0278`, `0279`, `0306`, `0307`, `0308`, pour le lot 8b `0290` et `0432`, et pour le lot 6
  `0521`–`0524` ; le lot 10 n'en pose aucune) :
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
  `0493`–`0499`, due diligence `0510` puis `0512`–`0519`, ingestion de documents `0525`–`0539`
  (plage `0520`–`0539`, `0521`–`0524` consommées), services candidats `0564`–`0579`.
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
  `apps/api/src/ingestion/`, `routes/ingestion*.ts`, `0521`–`0524`) : réception par `avecPlaceAnalyse`
  (`ingestion/documents.ts`, recherche n° 18), type décidé par le contenu, document analysé puis EFFACÉ
  (jamais de clé étrangère vers `fichiers` : `fichier_orphelin` reste inchangée). TOUT PDF passe par le
  pré-contrôle `pdf-controle.ts` (worker dédié, `controlerBombePdf`) AVANT le worker d'extraction
  (`pdf.ts`, `pdf-worker.mjs`) ; `unpdf` ne s'importe que dans `pdf-worker.mjs` et aucun autre parseur de PDF
  n'est ajouté (recherche n° 23). Un PDF sans texte natif répond `PDF_SANS_TEXTE` : seul l'adaptateur
  simulé `ocr.ts` existe (OCR local à venir, lot 11), et un état lu par OCR n'est jamais accepté
  automatiquement. Le texte des pages est un contenu client NON FIABLE (variable non fiable de
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
- Node 22 au minimum (`engines.node` de `package.json`, CI en `node-version: 22`) : `unpdf` 1.8.1 l'exige et
  `worker.getHeapStatistics()` de la surveillance du worker PDF (`ingestion/pdf.ts`) date de Node 22.16
  (garde défensive si la méthode manque). Toute valeur de `PLAFONDS_INGESTION`
  (`packages/shared/src/schemas/ingestion.ts`) est provisoire ; toute lecture de `process.env` dans
  l'ingestion est un écart (recherche n° 3 : aucune aujourd'hui).

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
  `app/connexion/FormulaireConnexion.tsx`. Un composant qui reçoit un rappel d'un composant d'envoi
  (`onCree`, `onTermine`) appelle `rafraichir()` du hook, pas `router.refresh()`. Recherche n° 22.
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
  `apps/api/src/plans/reprevision-explication.ts` ; `lib/format.ts` côté web), les codes stockés ne changent pas.

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
  `PDF_SANS_TEXTE` sans OCR, le refus de validation à l'auteur du téléversement, au demandeur et au dernier
  modificateur (`MQG02`), FIN-02 sur une proposition d'amorçage, le rejet `libelle_ambigu`, le texte purgé
  (404 `TEXTE_PURGE`) ; suites `apps/api/test/ingestion-*.test.ts` (`-securite`, `-etats`, `-extractions`,
  `-maintenance`, `-dd*`, `-standard*`) et moteurs `packages/engines/src/ingestion/*.test.ts`.
- Un test sensible à la charge (horloge, déclencheur, délai) ne se règle pas par un `retry` : on corrige la cause
  ou on écrit un test de non-régression qui injecte le retard (modèle : `pg_sleep` dans le test `journal de
  preuves` de `signatures-routes.test.ts`). Ne pas lancer plus de 3 ou 4 suites API en parallèle sur le même
  PostgreSQL (erreur 53200, `max_locks_per_transaction`, dans le global-setup).

## Recherches mécaniques

À lancer depuis la racine (ripgrep 15). « Attendu » = résultat du 2026-10-22 dans la copie de travail
`reste-lot-9e` (branche d'intégration `orch/2026-10-20-reste-lot-9e`, HEAD `38e22ae` : `main` = `origin/main` au merge
commit `3d5a252`, plus les lots 1, 2, 3, 4a, 4b, 4c, 5a, 5b, 7, 8a, 8b, 8c, 10 et 6 du chantier du 2026-10-20, non fusionnés).
Les recherches n° 1 à 21 ont été relancées ce jour avec la commande exacte ci-dessous (la n° 15, réseau, aussi) ; les n° 11
et 12 par script ponctuel hors dépôt (réécrit pour ce relevé), dont la méthode a d'abord été vérifiée sur l'état
d'AVANT les lots 6 et 10 (`48eb2fa`, premier parent du merge `9aba318` du lot 10, extrait par `git archive`) : elle y retrouve exactement
les chiffres du relevé précédent (n° 11 : 1 699 / 1 652 / 813 / 240 ; n° 12 : 890 `z.object`, 11 non stricts voulus, aux mêmes
lignes ; n° 10 : 972 routes, 9 sans `exiger`). Les mêmes recherches ont été lancées sur l'état intermédiaire `9aba318`
(lot 10 seul) pour attribuer chaque écart à son lot. Les n° 22 à 24 sont nouvelles (lots 10 et 6). Les valeurs d'avant les
lots 6 et 10 (relevé précédent, « lots 8b et 8c compris », copie `reste-lot-9d`) sont données pour expliquer chaque écart.
Les listes complètes des résultats des n° 1 à 9, 14, 16 à 21 ont de plus été comparées, ligne à ligne (triées), entre les trois états :
là où le nombre est inchangé, les listes sont identiques, sauf les numéros de ligne cités dans le tableau.

**Relevé du 2026-10-22 de la branche d'intégration, lots 6 et 10 compris.** Il REMPLACE le relevé précédent du même
jour (« lots 8b et 8c compris », copie `reste-lot-9d`). Les n° 1 à 7, 9, 14, 17, 20 et 21 donnent le même résultat ;
changent les n° 8, 10, 11, 12, 13, 15, 16, 18 et 19 ; les n° 22 à 24 sont neuves :

| N° | Attendu | Explication |
| --- | --- | --- |
| 1 à 6, 9, 14, 17, 21 | inchangés (2, 1, 5, 0, 0, 0, 1, 0, 2, 1) | — (le lot 6 n'ajoute ni client PostgreSQL, ni `process.env` (le n° 3 compte les mêmes 5 lignes), ni agrégat SQL, ni `console`, ni en-tête d'idempotence, ni `INSERT INTO agents_evaluations`, ni texte d'interface en anglais ; le lot 10 n'ajoute que du code web et `canaux/preuves.ts`) |
| 7 | 19 lignes | inchangé (listes triées identiques aux trois états). Le lot 6 n'ajoute AUCUN `LIMIT` littéral > 1 : ses lectures bornées sont en `LIMIT $n` (`ingestion/documents.ts:219` liste paginée par curseur, `ingestion/fichier-temporaire.ts:75` lot de purge), invisibles à cette recherche, et aucune n'est doublée d'un plafond de table (les quotas d'ingestion, 5 documents en traitement et 40 créations par 24 h et par cabinet, sont comptés par le code). Le lot 10 n'en ajoute pas |
| 8 | 14 lignes | 12 avant le lot 6 : +2, toutes du lot 6, mineures et JUSTIFIÉES : `ingestion/pdf.ts:297` (`Math.round` de la confiance de l'OCR, en pour mille : ce n'est pas un montant) et `ingestion/erreurs.ts:29` (`Math.floor` de la taille en Mo dans un message). La note du lot 6 cite `pdf.ts:239` : numéro périmé, la ligne est `:297` |
| 10 | « 990 9 » puis 9 lignes | 972 avant : +18, tout dans le lot 6 (comparaison fichier à fichier avec `9aba318` et `48eb2fa`) : `ingestion.ts` +4 (fichier neuf : `POST /dossiers/:id/etats-financiers/document` DOS-03, `GET …/ingestions`, `…/ingestions/:docId`, `…/pages/:numero`), `ingestion-dd.ts` +7 (fichier neuf : `POST` et `GET /dd/dossiers/:id/documents`, `GET /dd/documents/:docId`, `…/pages/:numero`, `POST …/lecture`, `PATCH /dd/extractions/:id`, `POST …/decision`), `ingestion-standard.ts` +7 (fichier neuf : `POST` et `GET /methodes/versions/:id/amorcage/documents`, `GET /amorcage/documents/:docId`, `…/pages/:numero`, `POST …/proposition`, `PATCH /amorcage/extractions/:id`, `POST …/decision`) ; les 18 sont sous `exiger`, les 9 sans `exiger` sont les mêmes qu'avant. Le lot 10 ne pose aucune route |
| 11 | 1 726 gabarits, 1 679 hors seed, 835 interpolations, 247 expressions | 1 699 / 1 652 / 813 / 240 avant le lot 6 : +27 / +27 / +22 / +7, tout dans le lot 6 (`ingestion/` : `documents.ts` +10 gabarits et 16 interpolations, `extractions.ts` +6 et 5, `job-extraction.ts` +3, `job-structuration.ts` +3, `fichier-temporaire.ts` +2, `ia-lignes.ts`, `standard-application.ts` (1 interpolation) et `structuration-standard.ts` +1 chacun). Le lot 10 : 0 / 0 / 0 / 0. Les sept expressions distinctes neuves sont relues par leur nom : `COLONNES_DOCUMENT`, `DEPUIS_DOCUMENT` (constantes de colonnes et de jointure), `DELAI_DOCUMENT_MORT_MINUTES` (constante numérique), `n + 1`, `n + 2`, `n + 3` (index de paramètres `$n`) et `p.sql` (fragment de `clausePortee`, construit sur la liste fermée `COLONNES_PORTEE`, valeurs en paramètres) |
| 12 | 903 `z.object`, dont 892 `.strict()` et 11 non stricts VOLONTAIRES (`contenuAvancementSchema` et ses sous-objets) | 890 avant le lot 6 + 13 (`schemas/ingestion.ts`, tous `.strict()`, lot 6) ; les onze non stricts sont les mêmes (`automatisation.ts`, lignes 733 à 798 inchangées). Le lot 10 : 0. Hors périmètre de la recherche : les 9 `z.object` de `apps/api/src/ingestion/` et de `routes/ingestion*.ts` (paramètres de routes, charges de jobs, `etat-financier.ts`, `ocr.ts`) sont aussi `.strict()` |
| 13 | 230 migrations, 0 modifiée ni supprimée dans l'historique | 226 avant le lot 6 + 4 (`0521`–`0524`, lot 6) ; 50 lignes « A » contre `main` (46 + 4) ; le lot 10 n'en pose aucune |
| 15 | RELANCÉE : 3 vulnérabilités en production (`next` 15.5.27 : 1 critique et 1 haute ; `fastify` 5.12.5 : 1 basse) | Écart NOUVEAU, étranger aux lots 6 et 10 : leur seul changement de `pnpm-lock.yaml` est l'ajout d'`unpdf` 1.8.1 (aucune dépendance). Avis publiés le jour même (`GHSA-2464-fhr4-w9xw`, `GHSA-p3m5-59mp-jv5r`, `GHSA-389g-gv7q-r4x8`) ; correctifs `next` >= 15.5.28 et `fastify` >= 5.12.6. Dernier relevé connu avant : « No known vulnerabilities found ». Aucun accès réseau n'est ajouté par le lot 6 (pas de `fetch`, `node:http(s)` ni `undici` dans `ingestion/` : mêmes 10 lignes avant et après dans `apps/api/src`, `packages/engines/src` et `packages/shared/src`, toutes hors ingestion) |
| 16 | 34 lignes | 32 avant le lot 6 : +2, `0524_ingestion_purge_textes.sql` (`purger_textes_ingestion`, `:84`, et `planifier_ingestion_maintenance`, `:123`) ; relues : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO missionpilot_app`, bornée au cabinet du contexte (`app_cabinet_id()`) pour la première. Le lot 10 : 0 |
| 18 | 7 lignes | 6 avant le lot 6 : +1, `ingestion/documents.ts:448` (`creerDocument`, utilisé par les trois routes de téléversement d'ingestion) ; les six autres lignes sont inchangées, `routes/salle-mission.ts:316` et `:444` comprises |
| 19 | 77 lignes dans 61 fichiers | inchangé en nombre et en destinataires (71 `cleLigne`, 3 `href`, 1 `hrefCible`, 2 faux positifs). Trois numéros de ligne bougent : lot 10 `connaissances/efficacite/page.tsx` 86 -> 87 et `qualite/revue-froide/[id]/page.tsx` 199 -> 202 ; lot 6 `dossiers/[id]/finances/page.tsx` 73 -> 77 (carte d'import et liste). Les cinq numéros décalés par le lot 8b (`facturation/page.tsx:152`, `missions/page.tsx:205`, `pipeline/page.tsx:139` et `:232`, `temps/debours/page.tsx:92`) n'ont pas bougé. Les pages d'ingestion (`documents/[docId]`, amorçage) n'ajoutent aucune ligne |
| 20 | 24 lignes | inchangé (listes triées identiques aux trois états : 23 appels plus la définition, tous avec `limiteMax`, `qualite-froide-serveur.ts:98` et `due-diligence-serveur.ts:191` aux mêmes lignes) ; ni le lot 6 ni le lot 10 n'ajoute ni ne déplace un appel de `chargerToutesLesPages` |
| 22 (neuve) | 1 ligne (`FormulaireConnexion`) | RELEVÉ : 13 lignes dans 10 fichiers, ÉCART OUVERT. Avant le lot 10 : 98 lignes dans 70 fichiers ; le lot 10 en migre 69 vers `useRafraichir` (il en reste 1 : `app/connexion/FormulaireConnexion.tsx:60`, voulu). Le lot 6, développé avant le hook, réintroduit 12 appels directs dans 9 fichiers à migrer : `components/ingestion/BoutonRelance.tsx:33` et `ActualisationAuto.tsx:15` (`setInterval`), `components/dossier/ImportEtatDocument.tsx:67` et `ImportEtatDocumentListe.tsx:39`, `components/due-diligence/DocumentsTeleversement.tsx:39`, `DocumentsListe.tsx:31` et `DocumentsLecture.tsx:86` et `:96`, `components/methodes/AmorcageDocuments.tsx:35` et `:58`, `AmorcageProposition.tsx:93` et `:103`. Cible après migration : 1 |
| 23 (neuve) | 1 ligne (`ingestion/pdf-worker.mjs:13`) | `unpdf` ne s'importe qu'à un endroit ; ni `pdfjs-dist`, ni `pdf-parse`, ni `pdf-lib`, ni `pdf2json` n'est importé (0 avant le lot 6) |
| 24 (neuve) | 3 tables, 3 politiques | `ingestion_documents` et `ingestion_pages` (`0521`), `ingestion_extractions` (`0522`), chacune avec sa politique `portail_interdit` (0 / 0 avant le lot 6) |

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
#    Attendu (2026-10-22, lots 6 et 10 compris) : 19 lignes (inchangé par les lots 6 et 10 : le lot 6 n'ajoute que des
#    `LIMIT $n` (`ingestion/documents.ts:219` liste paginée par curseur, `ingestion/fichier-temporaire.ts:75` lot de
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

# 8. Arrondis dans l'API (hors moteur). Attendu (2026-10-22, lots 6 et 10 compris) : 14 lignes (12 inchangées depuis le
#    2026-10-14, plus 2 du lot 6 : `ingestion/pdf.ts:297`, `Math.round` de la confiance de l'OCR en pour mille, qui n'est
#    pas un montant, et `ingestion/erreurs.ts:29`, `Math.floor` de la taille en Mo dans le message de dépassement),
#    toutes justifiées : auth/totp.ts (pas de temps), db/seed-demo.ts x2 (seed),
#    jobs/worker.ts (délai en secondes), stockage/fichiers.ts, routes/fichiers.ts,
#    routes/salle-mission.ts, routes/transcriptions.ts et salle-mission/depots.ts (taille en Mo dans un
#    message), canaux/signatures.ts (nombre de jours d'une durée), routes/canaux.ts (horodatage en
#    secondes du simulateur), routes/missions.ts (inverse de la parité EUR/FCFA, arrondi à
#    numeric(20,10), dette) ; toute autre ligne est un calcul de montant à déplacer
rg -n "Math\.(round|floor|ceil|trunc)|toFixed\(" apps/api/src

# 9. console.* hors seed et migrate. Attendu : 1 ligne (mailer.ts, transport
#    « journal » de développement)
rg -n "console\.(log|info|debug|warn|error)" apps/api/src --glob '!**/seed*' --glob '!**/migrate.ts'

# 10. Route sans exiger (par gestionnaire ; exigerPortail compte). Attendu (2026-10-22, lots 6 et 10 compris) : "990 9".
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
#     1 726 gabarits dans apps/api/src (1 679 hors db/seed*), 835 interpolations hors seed, 247 expressions
#     distinctes (lots 6 et 10 compris). Le script, réécrit pour ce relevé, a d'abord été lancé sur l'état d'avant les lots 6 et 10
#     (`git archive 48eb2fa`) et y retrouve exactement le relevé précédent (1 699 / 1 652 / 813 / 240), puis sur l'état
#     du lot 10 seul (`9aba318` : 1 699 / 1 652 / 813 / 240 aussi) et sur l'arbre courant. Écarts du lot 6 : +27 / +27 / +22 / +7,
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

# 12. Schémas Zod non stricts. Attendu (2026-10-22, lots 6 et 10 compris) : 11 non stricts sur 903 z.object (892 stricts), TOUS dans
#     `automatisation.ts` et voulus : `contenuAvancementSchema` (racine, `mission`, `avancement`, `jalons`, `kpis`
#     et ses éléments, `livrables` et ses éléments, éléments de `faits_saillants`) et les deux sous-schémas de jalons
#     (lignes 733, 737, 746, 751, 752, 756, 763, 771, 782, 788, 798 au 2026-10-22) : sortie du moteur relue par
#     LISTE BLANCHE (clés inconnues écartées, jamais une entrée de requête) ; la projection portail
#     (`contenuAvancementPortailSchema`) est, elle, entièrement stricte. Tout autre non strict est un écart.
#     903 = 890 avant le lot 6 + 13 du lot 6 (`schemas/ingestion.ts`, tous `.strict()`, y compris `numeroPageParamsSchema` et
#     `ingestionDdQuerySchema`) ; le lot 10 n'en ajoute aucun ; les lignes des onze non stricts n'ont pas bougé. Hors du périmètre
#     de cette recherche (`packages/shared`), les 9 `z.object` d'`apps/api/src/ingestion/` et de `routes/ingestion*.ts`
#     (paramètres de routes, charges de jobs, `etat-financier.ts`, `ocr.ts`) sont aussi `.strict()`.
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
#     (somme 903 le 2026-10-22, 890 avant les lots 6 et 10 et avec le lot 8b, 889 avant 8b, 867 avant 4c, 844 le 2026-10-21 ;
#     723 sur `main`). Le script de contrôle strict, écrit hors dépôt comme décrit (réécrit pour ce relevé), retrouve 890 et
#     11 non stricts, aux mêmes lignes, sur l'état d'avant les lots 6 et 10 (`git archive 48eb2fa`) et sur le lot 10 seul
#     (`9aba318`), puis 903 avec 11 non stricts aujourd'hui (il avait aussi retrouvé 889 et 11 sur l'état d'avant 8b,
#     `git archive 6e17248`, et 867 et 0 non strict avant 4c). L'attribution du +2 de `rapports` au lot 4b est
#     approximative (le lot 2 touche aussi les rapports).

# 13. Migration existante modifiée ou supprimée dans l'historique git. Attendu : 0 ligne
git log --diff-filter=MD --name-only --format= -- apps/api/migrations | sort -u
# Dans une branche : git diff --name-status main -- apps/api/migrations
# ne doit montrer que des lignes « A » (ajouts). Le 2026-10-22 : 50 lignes « A », aucune autre
# (`main` local = `origin/main` = `3d5a252`, base commune de la branche ; aucun fetch réseau fait). Dossier : 230 fichiers
# (`ls apps/api/migrations | wc -l` : 230 ; `git ls-files apps/api/migrations | wc -l` : 230, tous
# commités sur la branche d'intégration ; `git status --short apps/api/migrations` : aucune ligne ; la commande
# `git log --diff-filter=MD …` ne renvoie rien).
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
# Les 50 sont à tenir pour immuables dès qu'elles sont commitées.

# 14. Textes d'interface en anglais (échantillon). Attendu : 0
rg -n ">\s*(Submit|Cancel|Save|Delete|Loading|Error|Login|Sign in|Logout|Search)\s*<" apps/web/src

# 15. Dépendances vulnérables (réseau requis). RELANCÉ le 2026-10-22 (copie `reste-lot-9e`) : 3 vulnérabilités
#     en production, ÉCART à traiter hors des lots 6 et 10 (seul changement de `pnpm-lock.yaml` des deux lots : `unpdf`
#     1.8.1, sans dépendance) : `next` 15.5.27, critique (`GHSA-2464-fhr4-w9xw`, exécution de code à distance non
#     authentifiée de l'optimisation d'images avec des SVG) et haute (`GHSA-p3m5-59mp-jv5r`, déni de service des Server
#     Actions), corrigées en >= 15.5.28 ; `fastify` 5.12.5, basse (`GHSA-389g-gv7q-r4x8`, contournement de la validation
#     d'en-têtes), corrigée en >= 5.12.6. Avis publiés le jour même. Attendu cible : « No known vulnerabilities found »
#     (dernier relevé avant : zéro en production ; l'audit complet relevait 15 constats, tous via vitest, développement,
#     SECURITY.md §14, non relancé). Aucun accès réseau n'est ajouté par le lot 6 : la recherche de `fetch`,
#     `node:http(s)`, `net`, `dns`, `undici`, `axios` et `WebSocket` dans `apps/api/src`, `packages/engines/src` et
#     `packages/shared/src` (hors tests) donne les mêmes 10 lignes avant et après, aucune dans `ingestion/`.
pnpm audit --prod

# 16. Fonctions SECURITY DEFINER accordées au rôle applicatif : relire chaque
#     migration qui en ajoute (search_path, REVOKE FROM PUBLIC) et comparer à
#     SECURITY.md §4. Attendu : 34 lignes au 2026-10-22, lots 4c, 6, 8b, 8c et 10 compris (32 avant le lot 6 : +2 de `0524`,
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
#     Attendu (2026-10-22, lot 6 compris) : 7 lignes (6 inchangées depuis le 2026-10-14, plus 1 du lot 6) : `POST /fichiers`
#     (routes/fichiers.ts, 2 appels), classeur d'états financiers du dossier client (routes/dossier-client.ts), dépôt de la salle
#     de mission par le cabinet (routes/salle-mission.ts:316) et par le portail (:444), dépôt audio
#     (routes/transcriptions.ts), et l'ingestion de documents (`ingestion/documents.ts:448`, `creerDocument`, commun aux trois routes de
#     téléversement d'ingestion : DOS-03, DD, amorçage STD-13). L'import Excel des temps (routes/import-temps.ts) n'y passe pas :
#     `lireClasseurTemps` a son propre sémaphore (temps/import-excel.ts)
rg -n "avecPlaceAnalyse\(" apps/api/src

# 19. Page serveur qui passe une fonction à un composant : lister les propriétés
#     `={(…) =>` des pages et layouts qui ne sont PAS marqués "use client", puis
#     vérifier à la main que le composant destinataire n'est pas client (ni
#     importé d'un fichier "use client"). Attendu (2026-10-22, lots 6 et 10 compris) : 77 lignes dans 61
#     fichiers (inchangé par les lots 6 et 10, hors trois numéros de ligne décalés : lot 10 `connaissances/efficacite/page.tsx`
#     86 -> 87 et `qualite/revue-froide/[id]/page.tsx` 199 -> 202, lot 6 `dossiers/[id]/finances/page.tsx` 73 -> 77 ; les cinq numéros
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
#     déclare le plafond de la route. Attendu (2026-10-22, lots 6 et 10 compris) : 24 lignes (inchangé par les lots 6 et 10 : listes triées
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
#     Attendu CIBLE : 1 ligne (`app/connexion/FormulaireConnexion.tsx:60`). Relevé du 2026-10-22 : 13 lignes dans 10
#     fichiers, ÉCART OUVERT du lot 6 (98 lignes dans 70 fichiers avant le lot 10, qui en migre 69 ; 1 ligne sur l'état
#     du lot 10 seul) : `components/ingestion/BoutonRelance.tsx:33` et `ActualisationAuto.tsx:15` (`setInterval`),
#     `components/dossier/ImportEtatDocument.tsx:67` et `ImportEtatDocumentListe.tsx:39`,
#     `components/due-diligence/DocumentsTeleversement.tsx:39`, `DocumentsListe.tsx:31`, `DocumentsLecture.tsx:86` et
#     `:96`, `components/methodes/AmorcageDocuments.tsx:35` et `:58`, `AmorcageProposition.tsx:93` et `:103`.
rg -n "^\s*([^*\s/].*)?\brouter\.refresh\(" apps/web/src --glob '!*.test.*'

# 23. Lecture de PDF : un seul import d'une bibliothèque de PDF (`unpdf`, dans le worker d'extraction après le pré-contrôle
#     de `pdf-controle.ts`), aucun autre parseur. Attendu : 1 ligne (`apps/api/src/ingestion/pdf-worker.mjs:13`) ;
#     0 avant le lot 6. Une seconde ligne est un parseur de PDF hors du circuit contrôlé (ADR-009)
rg -n "(from|import\(|require\()\s*[\"'](unpdf|pdfjs-dist|pdf-parse|pdf-lib|pdf2json)" apps packages --glob '!**/node_modules/**'

# 24. Toute table d'ingestion porte sa politique `portail_interdit` (garde : `isolation.test.ts`). Attendu : les deux
#     commandes rendent les mêmes comptes par fichier, `0521_ingestion_documents.sql:2` (`ingestion_documents`,
#     `ingestion_pages`) et `0522_ingestion_extractions.sql:1` (`ingestion_extractions`), soit 3 tables et 3 politiques ;
#     une table `ingestion_*` de plus sans sa politique rend le second compte inférieur au premier
rg -c "CREATE TABLE ingestion_" apps/api/migrations
rg -c "CREATE POLICY portail_interdit ON ingestion_" apps/api/migrations
```
