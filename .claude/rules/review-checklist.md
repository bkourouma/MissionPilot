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
ont été relevés le 2026-10-21 en lançant les commandes ci-dessous dans la copie de travail
`reste-lot-9a` (branche d'intégration `orch/2026-10-20-reste-lot-9a`) : `main`, identique à
`origin/main` (merge commit `3d5a252`, PR n° 14, vague 4 fusionnée), plus les lots 1 (socle IA),
2 (redressement 3a-bis), 3 (due diligence 3b-bis, canaux 3c-bis), 4a (méthodes et revue à froide),
4b (dossier, preuves, finance), 5a (plans et notation augmentés) et 8a (CI) du chantier du
2026-10-20, non encore fusionnés dans `main`. Les valeurs de `main` restent entre parenthèses quand
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
  SECURITY.md §4 bis** ; le 2026-10-21 la liste compte, en plus de `main`, trois
  routes de l'investisseur (`GET`/`HEAD /api/portail/due-diligence/publications`,
  `…/publications/:id`, `…/publications/:id/pieces/:pieceId/fichier`, lot 3) et
  trois routes d'ateliers (`GET /api/portail/ateliers`, `…/ateliers/:id`,
  `PUT …/ateliers/:id/contribution/:methode`, lot 5a) ; le redressement, la
  revue à froide et les groupes n'en ont aucune (403 testé).
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
  publication d'une proposition au standard (`standard/propositions.ts`). Le
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
  (`schemas/brief.ts`), une source et leurs tests (30 types en trois familles, 29 sources au
  2026-10-21).
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
  agrégats au cabinet APRÈS clôture seulement ; permission `portail.ateliers.participer` (`client_dirigeant` seul) ;
  même 404 pour inexistant, d'autrui, non invité ou non ouvert. La graine de Monte-Carlo est tirée par l'API
  (`crypto.randomInt`), jamais par le moteur.
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
  codée en dur dans le déclencheur de `0287` : une grille v2 exige une migration.
- **Canaux simulés : alertes KPI sortantes** (lot 3 ; `canaux/alertes-kpi.ts`, `kpi/suivi.ts`, `0549`) : option du
  compte `alerte_kpi` DÉSACTIVÉE par défaut, mise en file seulement vers des responsables INTERNES à numéro
  vérifié et consentement accordé, aucune valeur chiffrée ni libellé de KPI, bloc sous `SAVEPOINT` (ne fait jamais
  échouer le suivi) ; un média reçu se lit en flux plafonné (`canaux/media-flux.ts`, `lireFluxPlafonne`), jamais
  en entier ; un PDF de signature servi `inline` garde type fixé, `nosniff`, `no-store` et une CSP sans
  `sandbox` (risque résiduel documenté : SECURITY.md).
- **Fonction de purge ou d'anonymisation** (`purger_textes_ia`,
  `planifier_conservation_ia`, `planifier_purge_rapports`, `anonymiser_copilote_actions`) : `SECURITY DEFINER`,
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
  libre : second préfixe `MQ` + lettre de domaine + 2 chiffres, par exemple `MQD`, `MQQ`, `MQF`, `MQL` ;
  `Z` est épuisée, partagée par plages entre redressement `MPZ01`–`MPZ20` et due diligence `MPZ21`–`MPZ32`) et un
  `REVOKE` (modèles `0043`, `0060`, `0146`) ; on corrige par nouvel
  enregistrement (avoir, contre-passation, révision, nouvelle version), jamais
  par `UPDATE` ; chaque action sensible appelle `journaliser` dans la même
  transaction (`apps/api/src/audit.ts`).
- **Migrations** : une migration **commitée** ne se modifie pas, on ajoute un
  fichier dans la bonne plage (CODING_STANDARDS §1) ; une migration encore
  **non commitée** peut être corrigée sur place (bases qui l'ont appliquée à
  recréer). Au 2026-10-21, les 206 fichiers de la branche d'intégration sont commités
  (180 déjà dans `origin/main` après les PR n° 12 à 14, 26 posés par les lots du 2026-10-20) :
  tous sont à tenir pour immuables, dont `0270` (rejeu réel OpenRouter), les six des
  lacunes de la vague 2 (`0271`–`0274`, `0303`, `0304`) et les 43 des vagues 2 et 3.
  **Numérotation** : la plage de chaque domaine est dans CODING_STANDARDS §1 ; la QUEUE
  `0549` et au-delà est attribuée CENTRALEMENT par le superviseur (jamais « prendre le
  numéro suivant » soi-même) : `0549` canaux (alerte KPI), `0550` brief (limiteur
  persistant), `0551` redressement (rapports de clôture), `0552` dossier (rapport d'état
  financier), `0560`–`0563` réservés aux services candidats, `0553`–`0559` non attribués.
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
  désormais immuables. Prochains numéros libres (2026-10-21) : STD `0211`, DOS `0226`,
  PRV `0244`, QUA `0290`, AGT `0278`, AUT `0306`–`0312`, NOT `0405`–`0419`, PLA `0427`–`0428`
  puis `0432`–`0439`, redressement `0493`–`0499`, due diligence `0510` puis `0512`–`0519`.
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
  opportunités : 500) peut passer `LIMITE_PAGE_MAX`. Recherche n° 20.

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

À lancer depuis la racine (ripgrep 15). « Attendu » = résultat du 2026-10-21 dans la copie de travail
`reste-lot-9a` (branche d'intégration `orch/2026-10-20-reste-lot-9a` : `main` = `origin/main` au merge
commit `3d5a252`, plus les lots 1, 2, 3, 4a, 4b, 5a et 8a du chantier du 2026-10-20, non fusionnés). Les
recherches n° 1 à 10, 12 à 14 et 16 à 21 ont été relancées ce jour avec la commande exacte ci-dessous ; le
n° 11 est un relevé par script reconstitué (méthode approchée, voir le n° 11) ; le n° 15 (réseau) n'a PAS
été relancé. Les valeurs de `main` sont données entre parenthèses : elles servent à expliquer chaque écart
ligne par ligne (comparatif fait en extrayant `main` par `git archive` vers un dossier temporaire, sans
toucher à l'arbre).

**Relevé du 2026-10-21 de la branche d'intégration.** Il REMPLACE le relevé du 2026-10-14. Les n° 1 à 6, 8, 9, 14,
17, 18 et 20 donnent le même résultat qu'avant ; changent les n° 7, 10, 12, 13, 16, 19 et 21 :

| N° | Attendu | Explication |
| --- | --- | --- |
| 1 à 6, 8, 9, 14, 17, 18, 20 | inchangés (2, 1, 5, 0, 0, 0, 12, 1, 0, 2, 6, 23) | — |
| 7 | 19 lignes | 12 inchangées de `main` (1 seed, `canaux/` 4, `redressement/` 7) + 7 neuves : lot 5a, `plans/ateliers.ts` 5 (lignes 85, 135 et 462 plafonnées en base à 50 options et 100 participants par `MQL08` ; lignes 473 et 491, membres du cabinet et dirigeants du client, SANS plafond de table) et `plans/ateliers-contributions.ts:215` (150 = 3 méthodes × 50 options) ; lot 4a, `qualite/froide-revue.ts:133` (200 revues d'un relecteur, SANS plafond de table). Les trois lignes sans plafond de table sont une dette à relire (CODING_STANDARDS §10) |
| 10 | « 921 9 » puis 9 lignes | 921 routes (813 sur `main`, +108, toutes sous `exiger`, détail au n° 10) ; la neuvième sans `exiger` est toujours `POST /canaux/whatsapp/webhook` |
| 12 | 844 `z.object`, tous `.strict()` | 723 sur `main` + 121 (détail au n° 12) |
| 13 | 206 migrations, 0 modifiée ni supprimée dans l'historique | 180 sur `main` + 26 posées par les lots (détail au n° 13) |
| 16 | 28 lignes | 27 sur `main` + 1 : `0275` (une instruction `GRANT EXECUTE`, trois fonctions) ; `0305` conserve les GRANT de `0030` |
| 19 | 75 lignes dans 59 fichiers | 73 dans 58 sur `main` + 2 `cleLigne` vers `components/ui/Tableau.tsx` (composant serveur) : `missions/[id]/notation/analyse/page.tsx` (lot 5a) et `qualite/revue-froide/[id]/page.tsx` (lot 4a) |
| 21 | 1 ligne | `agents/evaluations.ts:247` seul (2 sur `main`) : l'INSERT de l'évaluation `openrouter` est passé dans la fonction SQL `rejeu_evaluation_terminer` (`0275`, lot 1) |

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
#    Attendu (2026-10-21) : 19 lignes (1 sur `main` avant la vague 4, 12 après les lots 3a et 3c) :
#    - 1 seed : le LIMIT 2 de db/seed-planification.ts ;
#    - 7 de `redressement/`, chacun DOUBLÉ en base par un plafond de volume (actions.ts 1000 et 200,
#      creanciers.ts 200, 100 et 300, tresorerie.ts 1000, déclencheurs `MPZ10`) sauf seuils.ts (400 lus,
#      6 secteurs × 50 versions = 300 au plus en base) ;
#    - 4 de `canaux/` (maintenance.ts 200, synthese-sources.ts 200, saisies-kpi.ts 200 et 24), lectures
#      BORNÉES relues en entier, chacune doublée d'un plafond de table ;
#    - 7 neuves : `plans/ateliers.ts` (85 options, plafond 50 ; 135 et 462 participants, plafond 100,
#      `MQL08`), `plans/ateliers-contributions.ts:215` (150), puis les TROIS lignes sans plafond de
#      table, dette à relire : `plans/ateliers.ts:473` (500 membres du cabinet), `:491` (200
#      dirigeants du client), `qualite/froide-revue.ts:133` (200 revues d'un relecteur).
#    À relire si un plafond change sans l'autre (CODING_STANDARDS §10). Ne voit pas un plafond passé
#    en paramètre : MAX_LISTE (500) de routes/portail-gestion.ts est une dette connue.
rg -n "\bLIMIT [0-9]+" apps/api/src | grep -v "LIMIT 1\b"

# 8. Arrondis dans l'API (hors moteur). Attendu : 12 lignes (inchangé depuis le 2026-10-14),
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

# 10. Route sans exiger (par gestionnaire ; exigerPortail compte). Attendu (2026-10-21) : "921 9".
#     921 routes = 813 sur `main` + 108, toutes sous `exiger` (répartition relevée par comparaison
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
#     en suivant l'imbrication ; fichiers *.test.ts exclus). Relevé du 2026-10-21 par un script
#     RECONSTITUÉ, de méthode approchée : 1 613 gabarits dans apps/api/src (1 566 hors db/seed*), 773
#     interpolations hors seed, 235 expressions distinctes (`main`, même script : 1 426 / 1 381 / 664 /
#     207). Ces nombres NE SONT PAS comparables au relevé du 2026-10-06 (577 gabarits, 299
#     interpolations, 105 expressions), obtenu avec un autre script ; seule la comparaison avec `main` par
#     le même script vaut. Les 28 expressions distinctes nouvelles ont été relues par leur nom :
#     constantes de colonnes, de jointures ou de plafonds, `sens` typé `"ASC" | "DESC"`, liste de
#     tables constante de `copilote/noms-propres.ts` ; aucune valeur issue d'une requête HTTP, mais les
#     corps des constantes n'ont pas tous été rouverts.

# 12. Schémas Zod non stricts. Attendu : 0 sur 844 z.object (723 sur `main` : +121, tous `.strict()` :
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
#     (somme 844 le 2026-10-21 ; 723 sur `main`). L'attribution du +2 de `rapports` au lot 4b est
#     approximative (le lot 2 touche aussi les rapports).

# 13. Migration existante modifiée ou supprimée dans l'historique git. Attendu : 0 ligne
git log --diff-filter=MD --name-only --format= -- apps/api/migrations | sort -u
# Dans une branche : git diff --name-status main -- apps/api/migrations
# ne doit montrer que des lignes « A » (ajouts). Le 2026-10-21 : 26 lignes « A », aucune autre
# (`main` est à `3d5a252`, base commune de la branche). Dossier : 206 fichiers
# (`ls apps/api/migrations | wc -l` : 206 ; `git ls-files apps/api/migrations | wc -l` : 206, tous
# commités sur la branche d'intégration ; `git status --short apps/api/migrations` : aucune ligne).
# 206 = 180 de `main` (155 + 0480–0486 + 0500–0508 + 0540–0548) + 26 des lots : lot 1 (0275, 0276,
# 0277, 0305, 0550), lot 2 (0487 à 0492, 0551), lot 3 (0509, 0511, 0549), lot 4a (0210, 0287, 0288,
# 0289), lot 4b (0225, 0552), lot 5a (0425, 0426, 0429, 0430, 0431) ; le lot 8a n'en pose aucune.
# `origin/main` compte 180 migrations (PR n° 12 à 14 fusionnées, égal à `main` local au 2026-10-21).
# Les 26 sont à tenir pour immuables dès qu'elles sont commitées.

# 14. Textes d'interface en anglais (échantillon). Attendu : 0
rg -n ">\s*(Submit|Cancel|Save|Delete|Loading|Error|Login|Sign in|Logout|Search)\s*<" apps/web/src

# 15. Dépendances vulnérables (réseau requis). NON relancé le 2026-10-21. Dernier relevé connu :
#     « No known vulnerabilities found » en production ; l'audit complet (pnpm audit)
#     relevait 15 constats, tous via vitest (développement, SECURITY.md §14)
pnpm audit --prod

# 16. Fonctions SECURITY DEFINER accordées au rôle applicatif : relire chaque
#     migration qui en ajoute (search_path, REVOKE FROM PUBLIC) et comparer à
#     SECURITY.md §4. Attendu : 28 lignes au 2026-10-21 (27 sur `main` : 23 avant la vague 4, plus
#     quatre du lot 3c, `resoudre_compte_canal`, `planifier_synthese_hebdo`,
#     `planifier_canaux_maintenance`, `anonymiser_transcriptions`). La ligne neuve est celle de `0275`
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
#     Attendu : 6 lignes (inchangé depuis le 2026-10-14) : `POST /fichiers` (routes/fichiers.ts, 2
#     appels), classeur d'états financiers du dossier client (routes/dossier-client.ts), dépôt de la salle
#     de mission par le cabinet (routes/salle-mission.ts:316) et par le portail (:444), dépôt audio
#     (routes/transcriptions.ts). L'import Excel des temps (routes/import-temps.ts) n'y passe pas :
#     `lireClasseurTemps` a son propre sémaphore (temps/import-excel.ts)
rg -n "avecPlaceAnalyse\(" apps/api/src

# 19. Page serveur qui passe une fonction à un composant : lister les propriétés
#     `={(…) =>` des pages et layouts qui ne sont PAS marqués "use client", puis
#     vérifier à la main que le composant destinataire n'est pas client (ni
#     importé d'un fichier "use client"). Attendu (2026-10-21) : 75 lignes dans 59
#     fichiers (73 dans 58 sur `main`), toutes admises : 69 `cleLigne` (67 sur `main`, plus 2 :
#     `missions/[id]/notation/analyse/page.tsx` et `qualite/revue-froide/[id]/page.tsx`) vers
#     `components/ui/Tableau.tsx` (composant serveur ; une occurrence par `<Tableau`), 3 `href` vers
#     `components/facturation/SegmentsStatut.tsx` (serveur), `hrefCible` vers
#     `ExplicationNote` (composant local du fichier), et 2 faux positifs (`.map` et
#     `.filter` passés à `options` et `visibles`, ce ne sont pas des fonctions
#     passées). Tout autre destinataire est à justifier ; sa propriété doit alors
#     être sérialisable.
rg -n "=\{\(.*\) =>" apps/web/src/app --glob '**/page.tsx' --glob '**/layout.tsx'

# 20. Boucles de pagination côté web : chaque appel de `chargerToutesLesPages`
#     déclare le plafond de la route. Attendu (2026-10-21, inchangé depuis `main`) : 23 lignes, soit
#     22 appels plus la définition de `lib/pagination.ts` ; les boucles des écrans de la vague 4
#     (`due-diligence*.ts`, `canaux-serveur.ts`) déclarent le plafond de leur route ; les appels sur
#     `/api/missions` ou `/api/opportunites` (plafond 500, défaut 200 admis : dette, CODING_STANDARDS §10)
#     sont sans `limiteMax`, `clients/[id]/portail` et `pipeline` comprises. Un appel d'une autre route
#     sans `limiteMax` est un écart. Aucune page des lots du 2026-10-20 n'appelle `chargerToutesLesPages`.
rg -n "chargerToutesLesPages(<[^>]*>)?\(" apps/web/src --glob '!*.test.*'

# 21. Provenance des évaluations de non-régression : un seul `INSERT INTO
#     agents_evaluations` dans le code TypeScript de l'API, l'évaluation locale (`agents/evaluations.ts`,
#     toujours « local »). L'évaluation de rejeu réel (`openrouter`) est insérée depuis `0275` par la
#     fonction SQL `rejeu_evaluation_terminer` (SECURITY DEFINER), sous garde d'une demande née d'un
#     job (migration `0270`) ; `agents/evaluations-openrouter.ts` n'a plus d'INSERT. Attendu
#     (2026-10-21) : 1 ligne (2 sur `main`) ; toute autre ligne qui écrit `fournisseur = 'openrouter'`
#     est un écart. Les tests sèment une évaluation réelle par `apps/api/test/evaluation-reelle.ts`.
rg -n "INSERT INTO agents_evaluations\b" apps/api/src
```
