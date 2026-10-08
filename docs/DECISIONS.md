# Décisions métier et techniques — MissionPilot

Ce fichier consigne les règles validées par le commanditaire et les décisions
techniques prises pour livrer MissionPilot. Il reprend l'ancien document
« CapStrat V1 » : CapStrat est l'ancien nom du produit, remplacé par
MissionPilot (voir le PRD). Le PRD fait foi pour le périmètre et les rôles ;
ce fichier précise des règles de calcul et des choix techniques.

## Cadrage validé (2026-10-06, session de pilotage)

| Sujet | Décision |
| --- | --- |
| Ordre de livraison | **V1 puis V2 enchaînées.** V1 = gestion de mission du PRD (socle, catalogue, planification, temps, budget, facturation, indicateurs). V2 = services #1 Notation, #3 Planification stratégique, #4 Pilotage KPI, portail client, questionnaires. Les règles du tableau suivant s'appliquent à la V2. |
| Granularité de saisie des temps | **Paramétrable par cabinet** : demi-journée (pas de 0,5 j) ou heure. L'unité de stockage et de calcul est le jour-homme ; la durée d'une journée (heures) est un paramètre du cabinet (SOC-04). |
| Marché de lancement | **Zone UEMOA.** Jours fériés, TVA, retenues et mentions légales de facture paramétrés **par pays** dès la V1 ; devise de base XOF. XAF (CEMAC) reste disponible en devise (FIN-04), sans paramétrage fiscal CEMAC en V1. Pays par défaut : Côte d'Ivoire. |
| Cabinets prioritaires | **Conseil.** Catalogue standard de départ : plan stratégique, audit organisationnel, formation, assistance. Le catalogue reste paramétrable par cabinet (MIS-01). |

## Décisions V2 (2026-10-06, session de pilotage)

| Sujet | Décision |
| --- | --- |
| Grille de notation (NOT-01) | **Grille propre générique** fondée sur des principes publics (ni EFQM ni Shingo, sous licence), pondérations par secteur modifiables par le cabinet. Elle sert de base que les experts du cabinet affinent. Aucun contenu du cahier SANKORIA. |
| IA | **Feu vert** : OpenRouter est branché en V2 (ADR-003), modèle choisi par tâche, repli sur gabarits déterministes sans clé. Le risque lié aux droits SANKORIA est accepté par le commanditaire ; la clause « pas d'entraînement sur les données » reste à vérifier par modèle avant le pilote. |
| Ordre de construction | Moteur de questionnaires (SOC-10), notation #1, planification stratégique + modèle financier #3, pilotage KPI #4, portail client (SOC-09) en appui dès les questionnaires. |
| Facture normalisée DGI (FIN-08) | **Hors périmètre** tant qu'un expert-comptable n'a pas confirmé qu'elle s'applique aux cabinets clients. |

## Validations complémentaires (2026-10-06, session de pilotage)

| Sujet | Décision |
| --- | --- |
| Notation, réponses manquantes (NOT-03) | **Ignorées avec renormalisation** sur les réponses données. Une dimension n'est notable que si la moitié de son poids est répondue ; le score global exige que les dimensions notables pèsent au moins la moitié du total (seuils réglables ; stratégie « pénaliser » disponible mais non retenue par défaut). |
| Seuils d'approbation des factures (FIN-15) | **5 M / 25 M / 10 M XOF** gardés comme valeurs de départ, modifiables par le cabinet. |
| Fiscalité de départ (Côte d'Ivoire) | **TVA 18 %**, retenue à la source désactivée par défaut, **impôt sur les sociétés 25 %** dans le modèle financier. Paramétrables par cabinet et par pays ; à faire confirmer par un expert-comptable avant tout usage réel. |
| Tri des listes de missions et d'opportunités | **Plus récentes d'abord** (pagination par curseur stable). |
| Publication d'une notation (NOT-07), séparation des tâches | **Appliquée** : seul un `expert_metier` publie une version ou la renvoie en brouillon, même face à un associé qui n'a pas ce rôle ; le publieur n'est ni l'auteur du calcul, ni d'un ajustement, ni de la soumission en revue. Les deux règles de publication sont doublées en base (SQLSTATE `MPN04`, migration `0146`) ; le renvoi est contrôlé par l'API (`apps/api/src/notation/notations.ts`). |

Valeurs posées par les moteurs, restant à confirmer par des experts : taux
d'actualisation du modèle financier 12 % et codes de postes SYSCOHADA
indicatifs ; KPI : taux d'atteinte linéaire (« plus bas = mieux » :
1 − (valeur − cible)/|cible|), cible nulle = binaire, flux = somme, stock =
dernière valeur, alerte après 3 dégradations consécutives ; notation :
force ≥ 65, faiblesse < 50, rôles pondérés 1 par défaut.

## Arbitrages de la passation (2026-10-07, relayés par le chef d'orchestre)

| Sujet | Décision | À revoir |
| --- | --- | --- |
| Changement de la clé IA ou de l'IBAN | Reste protégé par le **mot de passe seul**, sans exiger la 2FA, par cohérence avec l'existant. | **À revoir avant le pilote** (exiger la 2FA pour ces deux actions). |
| Date limite d'un questionnaire | **Appliquée** (2026-10-08, vague 0) : une réponse ne se soumet plus après la date limite de son envoi (jour UTC inclus ; 409 `DATE_LIMITE_DEPASSEE`, doublé en base par `MPQ07`, `0150`). Le cabinet prolonge en repoussant la date ou en la retirant. | Aucune. |
| Conservation des textes IA (`ia_generations`) et des rapports | **Valeurs par défaut posées** (2026-10-08, vague 0) : texte des générations IA anonymisé après **365 jours** (de 30 à 3 650 par cabinet, `0104`, job `ia_conservation` ; la trace de la décision humaine reste) ; fichier des rapports purgé après **3 ans** (1 095 jours, de 90 à 3 650 par cabinet, `0132`, job `purge_rapports` ; la ligne de trace reste). | **Durées à valider avec le conseil juridique avant le pilote.** La durée IA n'est pas encore réglable par l'API IA. |
| Publication d'une notation | **Inchangée, incohérence corrigée** (vague 0) : seul un utilisateur au rôle `expert_metier` publie (NOT-07), l'associé aussi est exclu ; `notation.publier` n'est plus dans l'ensemble des permissions de l'associé (`roles.ts`, `RESERVEES_A_UN_ROLE`). | Aucune. |
| Style des encadrés à bordure latérale (5 feuilles CSS) | Laissés en l'état, sans harmonisation. | — |

## Orientations au-delà de la V2 (2026-10-08)

Tranchées par le commanditaire sur le [PRD complémentaire](<PRD complémentaire — MissionPilot, le cabinet d'expertise augmenté.md>) (le reste de ce PRD reste à valider).

| Sujet | Décision |
| --- | --- |
| Observatoire inter-cabinets (CAP-04) | **Adhésion volontaire** ; seuls les cabinets contributeurs consultent les benchmarks. |
| Mention de la contribution IA sur les livrables (QUA-06) | **Au choix du cabinet**, avec une mention par défaut dans le pied de page. |
| Métiers couverts par le référentiel de méthodes | **Conseil en management et gouvernance, risques et contrôle interne.** Audit légal et expertise comptable hors périmètre. |
| Priorité après les fondations (vagues 1 et 2) | **Module d'appels d'offres** (AO) avant les services #2 Due diligence et #5 Redressement. |
| Chiffre extrait d'un document client | **Précision de la règle DOS** (PRD complémentaire, §5) : un chiffre **extrait** d'un document client par l'IA est une **donnée sourcée** (document, page), pas un chiffre **produit** par l'IA ; il ne sert aux calculs qu'après contrôles déterministes réussis ou confirmation humaine. Les moteurs restent seuls à calculer. |

Décisions 4, 6, 7 et 8 de la section 21 du même PRD, tranchées le 2026-10-08 par le commanditaire (recommandations du PRD retenues) :

| Sujet | Décision |
| --- | --- |
| Autonomie N4 vers les clients | **Limitée à la classe R0** (relances et accusés de réception), avec un **coupe-circuit par cabinet**. |
| Services candidats après les fondations | **Diagnostic flash**, puis **business plan bancable**. |
| Attestation de notation vérifiable | ACC est **garant de la méthode, jamais de la note**, qui reste signée par le cabinet. |
| WhatsApp Business | **Canal officiel**, avec données minimales dans les messages et SMS en repli. |

## Précisions issues de l'audit de la vague 1 (2026-10-08)

Posées par l'implémentation pour fermer des écarts relevés à l'audit ; à confirmer par le commanditaire.

| Sujet | Règle posée |
| --- | --- |
| Signature d'un avis d'expert (PRV-03) | **Réservée à un `expert_metier` ou à un associé**, et à l'auteur de la version ; abaisser la classe de risque d'une assertion leur est réservé aussi (doublé en base, `MPV04`, `MPV06`). |
| Origine d'une note de satisfaction (QUA-08) | Tracée : `saisie_par_equipe` (le cabinet saisit pour le compte du client, valeur par défaut) ou `client` (saisie directe par le client). Le calcul du NPS ne change pas. |
| Export du dossier remis au client (DOS-07) | **Sans les motifs des décisions** (acceptation d'un état en écart, rejet d'un fait) : ils restent internes au cabinet. |
| Exécution d'un agent IA (AGT-04) | Un agent n'exécute qu'un prompt doté d'un jeu d'essai et d'une évaluation réussie ; en production, seule une évaluation sur un vrai modèle (`openrouter`) compte (ADR-005). **Décision laissée au commanditaire** : exiger un jeu d'essai pour CHAQUE activation de prompt (aujourd'hui, un prompt sans jeu d'essai peut s'activer mais ne sert aucun agent) est une décision produit, non imposée. |

## Précisions issues de l'audit des vagues 2 et 3 (2026-10-08)

Posées PAR DÉFAUT par l'implémentation pour fermer des écarts relevés à l'audit ; chaque ligne dit ce qui est posé et ce qui reste à faire valider par le commanditaire. Le moteur d'automatisation est décrit par l'ADR-006.

| Sujet | Règle posée par défaut | Reste à valider |
| --- | --- | --- |
| Plafond d'automatisations (AUT-02) | **50 automatisations actives par cabinet** (verrou à l'activation, 409), **30 simulations par utilisateur sur 10 minutes** (429). | Les deux valeurs de départ. |
| Salle de mission (CLI-01) | **20 dépôts** non rejetés et non retirés **par pièce**, **500 Mo par demande**, **30 dépôts du portail par utilisateur sur 10 minutes** (déni de service du quota de stockage ; doublé en base, `MPL07-08`, `0332`). | Les trois valeurs. |
| Appels d'offres (AO-03, AO-04) | **20 dossiers et 50 extractions par fiche** d'appel d'offres ; **100 gabarits de CV** par cabinet (409 au-delà). | Les valeurs. |
| Plans et capitalisation | **30 propositions de portefeuille sur 10 minutes** (PLA-14) ; **60 recherches par minute** (CAP-07) ; **10 dossiers de revue KPI sur 10 minutes** (KPI-17) ; **50 déclarations de niveau par couple** collaborateur et compétence (CAP-06, `MPJ07`). | Les valeurs. |
| Indice de confiance d'une notation (NOT-11) | **Plancher** du réglage du cabinet : seuil de confiance **au moins 0,3** et **au moins 2 répondants** (schéma partagé et `CHECK` en base, `0404`) ; un associé qui est aussi expert métier ne peut pas les abaisser. Défauts : seuil 0,5, cible de 3 répondants. | Seuil, cible et plancher, à calibrer au pilote. |
| Estimation depuis les temps réels (CAP-02) | **Effectif d'au moins 3** observations pour publier une estimation, **statistiques détaillées dès 5** ; lecture réservée aux détenteurs de `budget.lire_jours` (jours = donnée de gestion). | Les seuils 3 et 5. |
| Matrice de compétences (CAP-06) | `competence.lire` **réservée à l'associé, au directeur de mission et aux ressources** (donnée d'évaluation individuelle) ; chacun voit sa propre vue. Conséquence : **le gestionnaire perd la rubrique « Connaissances » du menu** (il n'a ni `connaissance.lire` ni `competence.lire`), donc aussi « Mes compétences » : l'API `/capitalisation/competences/moi` lui reste ouverte (`temps.saisir`) mais aucun écran du menu n'y mène. | **À valider** : le gestionnaire doit-il lire la matrice ou la base de connaissances ? |
| Dossier de revue de performance (KPI-17) | Le dossier d'une revue non tenue est **figé en « brouillon »** ; il est **confidentiel** (valeurs de KPI du client) et ne se diffuse pas tel quel. | Mention et diffusion à confirmer. |
| Actions correctives (KPI-18) | **Commentaire obligatoire** pour une date d'effet de plus de **31 jours dans le passé** et pour une décision de revue marquée « **exécutée** » (la date d'effet fixe les fenêtres avant/après de l'efficacité). | Le délai de 31 jours. |
| Séparation des tâches, offre technique (AO-06) | **Valideur ≠ créateur de l'offre ≠ auteur d'une version ≠ demandeur de la génération IA, sauf associé** (doublé en base, `MPW05`, `0385`). Remplace le choix « tout détenteur de `ao.gerer` valide » de la section Banques et offres. | Aucune ; à confirmer. |
| Séparation des tâches, clôture (AUT-08) | **Celui qui a accordé une dérogation en vigueur ne clôt pas la mission, sauf associé** (`MPX03`, `0323`) ; dérogation accordée ou retirée par un directeur de mission ou un associé (`MPX02`). | Aucune ; à confirmer. |
| Séparation des tâches, salle de mission (CLI-01) | **L'acceptation d'un dépôt est refusée à celui qui l'a déposé, sauf associé** (`MPL09`, `0332`). | Aucune ; à confirmer. |
| Modification d'une automatisation active (AUT-05) | **Modifier la définition d'une automatisation active la désactive** : elle s'exécute sous l'identité et les droits de son responsable (celui qui l'a activée) ; la réactivation rend son auteur responsable. Nom et description se modifient sans effet (ADR-006). | Confort d'usage : réactivation à chaque correction de définition. |
| Conservation des CV de la banque AO (AO-04) | **Aucune durée de conservation posée.** Les versions de CV sont en ajout seul ; **anonymisation à la demande** (départ d'une personne, droit à l'effacement : fonction `anonymiser_cv_ao`, `0386`, `MPW06`), sans retour en arrière. | **À valider : anonymisation AUTOMATIQUE après N années du CV d'un expert parti ? (avis du conseil juridique requis)** ; valeur de N. |
| Retour d'expérience (CAP-01) | **Exception au quatre-yeux** : le chef de mission peut valider la version IA du retour d'expérience qu'il a lui-même demandée (« l'IA propose, l'expert dispose » : il est l'expert) ; la validation reste réservée au chef, au directeur de la mission ou à un associé (`MPJ08`, `0465`). Conforme au PRD. | Aucune. |
| Dossier bancaire (PLA-17) | **Sa génération exige `plan.valider`** (et `plan.lire`, `mission.lire`) : seul qui peut valider une version du modèle financier émet le dossier qui s'appuie sur elle. **L'annexe « Sources » du plan est exclue** (registre des preuves interne : verbatims, assertions du cabinet). | Aucune ; à confirmer. |

## Règles métier validées (2026-10-06) — applicables à la V2

| Sujet | Décision |
| --- | --- |
| Échelle de notation (NOT-03) | Score global 0–100, 5 classes : A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, E < 35 |
| Publication du rapport de notation (NOT-07) | Un utilisateur au rôle `expert` doit obligatoirement valider ; le consultant ne peut pas publier seul |
| Statut KPI (KPI-03) | Atteinte de la cible : vert ≥ 95 %, orange 80–95 %, rouge < 80 % ; sens de lecture (plus haut / plus bas = mieux) défini par KPI |
| Horizon du modèle financier (PLA-06) | 5 ans par défaut, modifiable de 3 à 5 ans à la création du plan |
| IA | Fournisseur **OpenRouter**. L'utilisateur choisit le modèle par tâche ; le système recommande un modèle par défaut. Sans clé API : repli sur gabarits déterministes, signalés comme tels et soumis à la même validation humaine (voir ADR-003) |
| Relances questionnaires | Automatiques par e-mail à J+3 puis J+7 ; relance manuelle possible par le consultant |

## Correspondance des rôles

Les rôles de l'ancien document sont rattachés aux rôles du PRD (SOC-02) :

| Ancien rôle | Rôle MissionPilot |
| --- | --- |
| `dirigeant` | Dirigeant client (portail client, V2) |
| `contributeur` | Contributeur client (portail client, V2) |
| `expert` | Expert métier du cabinet |
| `consultant` | Consultant (et chef de mission pour l'envoi) |
| `admin` | Associé ou directeur de mission, selon l'action |

## Règles posées pour avancer (à confirmer) — V2

- Seuls le dirigeant client et le contributeur client répondent aux
  questionnaires ; le consultant et le chef de mission rédigent, valident et
  envoient.
- Questionnaire collectif : une réponse partagée, verrouillée à la première soumission.
- Questionnaire par fonction : un libellé de fonction obligatoire par répondant.

## Questions du PRD restant ouvertes

Traitées par l'option la plus sûre, à confirmer : ACC premier cabinet pilote
(aucune donnée ACC codée en dur) ; facture normalisée DGI (FIN-08, V2, hors
V1) ; hébergement (aucune dépendance à un fournisseur ; conteneurs Docker) ;
droits SANKORIA (jalon go/no-go avant tout développement de services IA :
les services V2 sont construits sur des grilles propres et des gabarits
génériques, sans contenu du cahier SANKORIA).

## Décisions techniques

- **Stack** : monorepo pnpm, Fastify, Next.js, PostgreSQL avec sécurité au
  niveau des lignes (ADR-001).
- **File de tâches** : table `jobs` PostgreSQL (`FOR UPDATE SKIP LOCKED`) au
  lieu de BullMQ/Redis (ADR-002). Moins de composants à exploiter ; même
  garantie d'exécution unique.
- **IA** : OpenRouter, modèle choisi par tâche (ADR-003). Aucun appel IA en V1.
- **Recherche sémantique** : pgvector si une clé OpenRouter permet de calculer
  des embeddings ; recherche plein texte PostgreSQL (français) dans tous les
  cas, utilisée seule en repli.
- **Chiffres** : tous les calculs (jours, montants, marges, scores, états
  financiers, KPI) vivent dans `packages/engines`, couverture ≥ 90 % imposée
  en CI.
- **Rapports** : HTML rendu en PDF par Chromium headless ; DOCX via `docx`,
  PPTX via `pptxgenjs`.

## Prévisions et pré-remplissage des temps (AUT-12, AUT-09)

Hypothèses de calcul **à valider par le métier** (moteurs `packages/engines/src/previsions`) :

- **Carnet signé** : échéances de facturation non facturées des missions signées, au mois de leur
  date prévue ; une échéance antérieure au premier mois est comptée dans le premier mois et
  signalée « en retard » ; une mission sans taux de change figé (hors devise du cabinet) est
  écartée et comptée. Pas de reste à produire hors échéancier.
- **Pipeline pondéré** : montant estimé × probabilité de l'opportunité (colonne `probabilite`,
  éditée par l'utilisateur) ; à défaut, probabilité par défaut de l'étape (prospection 10 %,
  qualification 25 %, proposition 50 %, négociation 75 %, jamais utilisée aujourd'hui car la
  colonne est toujours renseignée : pas de table de probabilités par étape). Réparti en parts égales
  sur 3 mois à partir du mois qui suit la clôture prévue ; sans date de clôture : 3 mois après le
  premier mois. Une opportunité dans une autre devise que celle du cabinet est écartée (pas de taux
  figé).
- **Charge** : jours des affectations de missions non clôturées (nominatives des collaborateurs
  internes actifs, et profils à pourvoir), au prorata des jours ouvrés comme le plan de charge ;
  charge du pipeline = jours de la dernière proposition × probabilité. Les affectations de missions
  non signées comptent (comme le plan de charge) : une opportunité déjà staffée est comptée deux fois
  tant que sa mission n'existe pas. **Capacité** : jours ouvrés du calendrier du cabinet moins les
  absences validées, selon le temps de travail.
- **Pré-remplissage des temps** : affectations (jours planifiés) et activité du consultant sur la
  plateforme (ses commentaires, ses tâches terminées, ses documents déposés dans la semaine, en
  UTC). **Aucune source d'agenda n'existe dans le dépôt** : la réponse le déclare
  (`sources.agenda = false`). Une activité sur une tâche affectée mais non planifiée un jour
  donné propose une demi-journée de confiance « faible » (décochée par défaut). Le consultant
  confirme dans l'écran puis enregistre par le circuit habituel.

## Pilotage augmenté des KPI (KPI-13, KPI-15, KPI-17, KPI-18)

Valeurs de départ posées pour avancer, **à valider avec des cabinets pilotes** (ce sont des
constantes exportées de `packages/engines/src/kpi`, jamais des nombres cachés) :

- **Arbres d'indicateurs** : relations « somme pondérée » (coefficient signé, négatif pour un coût)
  et « produit » (coefficients à 1). Un nœud interne prend la valeur calculée de ses enfants ; sa
  valeur observée ne sert qu'à mesurer le résidu (la part que l'arbre n'explique pas). Contribution
  d'un levier à un produit : substitution en chaîne dans l'ordre des rangs (exacte, mais dépendante
  de cet ordre, donc explicite et figé par l'utilisateur). Au plus 50 nœuds actifs et 6 niveaux.
  Valeur d'un KPI à une date d'arrêté : celle de sa dernière période close mesurée. Si la variation
  d'un nœud intermédiaire est nulle, la contribution nette de ses leviers à la racine est 0.
- **Qualité des données** : fraîcheur (un tiers de moins par période échue sans mesure, 3 périodes
  de retard = 0), complétude (12 dernières périodes échues), cohérence (valeurs aberrantes à plus de
  5 écarts absolus médians de la médiane, à partir de 6 mesures, et corrections), poids 4 / 3 / 3 ;
  niveaux « bon » ≥ 80, « moyen » ≥ 50, « faible » en dessous. Une composante sans objet est écartée
  du score (jamais comptée comme 0). Le score informe, il ne modifie ni statut ni score composite.
- **Efficacité d'une action** : moyenne du KPI sur 3 périodes closes avant la date d'effet contre 3
  après (la période qui contient la date d'effet est exclue), au moins 2 de chaque côté, tolérance
  de 2 % de la moyenne avant comme la tendance. Variation corrélée, pas causale : l'écran le dit.
- **Revue de performance** : ordre du jour par priorités entières (KPI rouge 100 + 10 par alerte,
  action en retard 90 + jours de retard au plus 30, décision ouverte 85 ou 95 si échue, action sans
  effet 80, dégradation 70, orange 60, qualité faible 50, non mesuré 40) ; 5 minutes par point, 10
  pour un KPI rouge ; 40 points au plus. Le dossier est figé à la tenue ; décisions, actions et
  compte rendu restent vivants jusqu'à la clôture. Dossier et présentation sont rendus à chaque
  demande, non conservés (pas de suivi qualité QUA tant qu'ils ne sont pas enregistrés comme
  rapports : `rapports_mission` n'a pas de modèle « revue de performance »).
- **Droits** : aucune permission nouvelle (`kpi.lire`, `kpi.gerer`, `kpi.saisir`) ; le portail n'y
  accède pas.

## Appels d'offres : veille, go/no-go, exigences, rétro-planning (AO-01 à AO-03, AO-08)

Valeurs de départ posées pour avancer, **à calibrer avec des cabinets pilotes** (constantes
exportées de `packages/engines/src/appels-offres`) :

- **Veille (AO-01)** : saisie et import CSV manuels seulement, sans connecteur ni appel réseau ;
  une référence d'avis n'est importée qu'une fois par cabinet (sans casse). Rapprochement avec le
  profil du cabinet, de 0 à 100 : secteur 30, compétences 30 (3 compétences des collaborateurs
  actifs retrouvées dans le titre, l'objet ou les mots-clés = note pleine), références du secteur
  25 (3 = note pleine), même pays 10, même bailleur 5. Références = missions signées (secteur de la
  mission ou du client, pays du client) et appels d'offres gagnés (secteur, pays, bailleur).
- **Go/no-go (AO-02)** : poids adéquation 30, références 25, charge 15, marge estimée 20,
  concurrence connue 10 ; « go » à partir de 65, « à examiner » à partir de 50 ; éliminatoires :
  marge nulle ou négative, références exigées non atteintes. Marge cible par défaut 20 %. Concurrence :
  100 − 10 par concurrent ordinaire − 25 par concurrent fort. Sans marge renseignée (donnée FIN-02),
  le critère n'est pas évalué et son poids sort du calcul. La décision revient à un **associé**
  (`ao.decider`), motivée (10 caractères au moins), sur la dernière évaluation ; un no-go peut
  arrêter une réponse engagée.
- **Exigences (AO-03)** : extraction par l'IA en brouillon (dossier lu jusqu'à 40 000 caractères,
  100 exigences au plus) ou découpage déterministe (phrases portant « doit », « obligatoire »,
  « fournir », « au moins »…, 200 au plus) ; dépôt possible seulement si la matrice n'est pas vide
  et que toute exigence obligatoire est conforme ou « sans objet » motivé. Un PDF n'est pas lu : il
  faut en coller le texte (chaîne d'ingestion et OCR à venir, ADR-009).
- **Rétro-planning (AO-08)** : huit étapes standard à J-21, J-18, J-14, J-10, J-8, J-5, J-3 et J-1
  de la date limite, compressées proportionnellement si le temps manque ; alertes à J-7, J-3, J-1
  et après la date limite, et pour toute étape non faite en retard ou du jour. Les alertes sont
  calculées à la lecture (route `GET /api/appels-offres/alertes`, fonction
  `alertesAppelsOffresCabinet` pour le brief quotidien), sans job ni notification automatique.

## Banques et offres d'appels d'offres (AO-04 à AO-07, lot AO-B)

Règles posées pour avancer, **à confirmer par le commanditaire et des cabinets pilotes** :

- **Années d'expérience (AO-04)** : mois DISTINCTS couverts par au moins une expérience (deux
  postes simultanés ne comptent pas double), jusqu'au mois de référence (en général celui du
  dépôt), puis années COMPLÈTES (59 mois = 4 ans) ; une expérience en cours court jusqu'à ce mois.
  Années par secteur : mêmes règles sur les seules expériences du secteur. Diplômes ordonnés
  bac < bac+2 < bac+3 < bac+4 < bac+5 < doctorat ; langues notions < courant < bilingue <
  maternelle ; libellés comparés sans casse ni accents (moteur `packages/engines/src/banque-cv`).
- **Gabarits de CV par bailleur** : quatre gabarits standard de départ (générique, Banque
  mondiale, Banque africaine de développement, Union européenne limité aux 15 dernières années),
  en données (`0380`) ; leurs sections et intitulés sont **indicatifs**, à aligner sur les
  formulaires types de chaque bailleur. Un cabinet ajoute ses propres gabarits ; celui du cabinet
  masque le standard de même code.
- **Références (AO-05)** : le montant est celui du marché, en unités mineures de sa devise ; une
  recherche par montant se fait dans UNE devise, sans change implicite.
- **Offre technique (AO-06)** : le modèle ne rédige que la compréhension des termes de référence
  et la méthodologie ; le planning reprend les étapes et les temps types saisis dans la méthode
  (sans calcul), l'organisation l'équipe tirée de la banque de CV. Validation d'une version
  par un détenteur de `ao.gerer` qui n'en est ni le créateur, ni l'auteur, ni le demandeur de la
  génération IA, sauf associé (quatre yeux posé à l'audit des vagues 2 et 3, `MPW05`, voir la
  section « Précisions issues de l'audit des vagues 2 et 3 »).
- **Offre financière (AO-07)** : chaque ligne arrondie une fois (demi s'éloignant de zéro), taxes
  calculées sur le total hors taxes ou sur les seuls honoraires, jours en centièmes exacts ; TVA
  proposée par défaut à 18 % dans l'écran (modifiable, vide = hors taxes). Réservée aux
  détenteurs de `finance.lire`, écriture avec `taux.gerer` (associé, gestionnaire) : un directeur
  ou un chef de mission ne voit pas les taux (FIN-02).
