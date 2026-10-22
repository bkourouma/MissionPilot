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
| Exécution d'un agent IA (AGT-04) | Un agent n'exécute qu'un prompt doté d'un jeu d'essai et d'une évaluation réussie ; en production, seule une évaluation sur un vrai modèle (`openrouter`) compte (ADR-005) ; elle naît du rejeu réel construit le 2026-10-10 (section « Rejeu réel OpenRouter »). **Décision laissée au commanditaire** : exiger un jeu d'essai pour CHAQUE activation de prompt (aujourd'hui, un prompt sans jeu d'essai peut s'activer mais ne sert aucun agent) est une décision produit, non imposée. |

## Précisions issues de l'audit des vagues 2 et 3 (2026-10-08)

Posées PAR DÉFAUT par l'implémentation pour fermer des écarts relevés à l'audit ; chaque ligne dit ce qui est posé et ce qui reste à faire valider par le commanditaire. Le moteur d'automatisation est décrit par l'ADR-006. Les quatre dernières lignes (unités d'un arbre KPI, retour d'expérience à la clôture, rubrique « Connaissances », jours de budget) viennent de la recette navigateur du 2026-10-10.

| Sujet | Règle posée par défaut | Reste à valider |
| --- | --- | --- |
| Plafond d'automatisations (AUT-02) | **50 automatisations actives par cabinet** (verrou à l'activation, 409), **30 simulations par utilisateur sur 10 minutes** (429). | Les deux valeurs de départ. |
| Salle de mission (CLI-01) | **20 dépôts** non rejetés et non retirés **par pièce**, **500 Mo par demande**, **30 dépôts du portail par utilisateur sur 10 minutes** (déni de service du quota de stockage ; doublé en base, `MPL07-08`, `0332`). | Les trois valeurs. |
| Appels d'offres (AO-03, AO-04) | **20 dossiers et 50 extractions par fiche** d'appel d'offres ; **100 gabarits de CV** par cabinet (409 au-delà). | Les valeurs. |
| Plans et capitalisation | **30 propositions de portefeuille sur 10 minutes** (PLA-14) ; **60 recherches par minute** (CAP-07) ; **10 dossiers de revue KPI sur 10 minutes** (KPI-17) ; **50 déclarations de niveau par couple** collaborateur et compétence (CAP-06, `MPJ07`). | Les valeurs. |
| Indice de confiance d'une notation (NOT-11) | **Plancher** du réglage du cabinet : seuil de confiance **au moins 0,3** et **au moins 2 répondants** (schéma partagé et `CHECK` en base, `0404`) ; un associé qui est aussi expert métier ne peut pas les abaisser. Défauts : seuil 0,5, cible de 3 répondants. | Seuil, cible et plancher, à calibrer au pilote. |
| Estimation depuis les temps réels (CAP-02) | **Effectif d'au moins 3** observations pour publier une estimation, **statistiques détaillées dès 5** ; lecture réservée aux détenteurs de `budget.lire_jours` (jours = donnée de gestion). | Les seuils 3 et 5. |
| Matrice de compétences (CAP-06) | `competence.lire` **réservée à l'associé, au directeur de mission et aux ressources** (donnée d'évaluation individuelle) ; chacun voit sa propre vue. Conséquence : le gestionnaire (ni `connaissance.lire` ni `competence.lire`) n'a ni la matrice ni la base de connaissances ; depuis la recette du 2026-10-10, **la rubrique « Connaissances » s'ouvre aussi avec `temps.saisir`**, il y retrouve son onglet « Mes compétences » (`/capitalisation/competences/moi`). | **À valider** : le gestionnaire doit-il lire la matrice ou la base de connaissances ? |
| Dossier de revue de performance (KPI-17) | Le dossier d'une revue non tenue est **figé en « brouillon »** ; il est **confidentiel** (valeurs de KPI du client) et ne se diffuse pas tel quel. | Mention et diffusion à confirmer. |
| Actions correctives (KPI-18) | **Commentaire obligatoire** pour une date d'effet de plus de **31 jours dans le passé** et pour une décision de revue marquée « **exécutée** » (la date d'effet fixe les fenêtres avant/après de l'efficacité). | Le délai de 31 jours. |
| Séparation des tâches, offre technique (AO-06) | **Valideur ≠ créateur de l'offre ≠ auteur d'une version ≠ demandeur de la génération IA, sauf associé** (doublé en base, `MPW05`, `0385`). Remplace le choix « tout détenteur de `ao.gerer` valide » de la section Banques et offres. | Aucune ; à confirmer. |
| Séparation des tâches, clôture (AUT-08) | **Celui qui a accordé une dérogation en vigueur ne clôt pas la mission, sauf associé** (`MPX03`, `0323`) ; dérogation accordée ou retirée par un directeur de mission ou un associé (`MPX02`). | Aucune ; à confirmer. |
| Séparation des tâches, salle de mission (CLI-01) | **L'acceptation d'un dépôt est refusée à celui qui l'a déposé, sauf associé** (`MPL09`, `0332`). | Aucune ; à confirmer. |
| Modification d'une automatisation active (AUT-05) | **Modifier la définition d'une automatisation active la désactive** : elle s'exécute sous l'identité et les droits de son responsable (celui qui l'a activée) ; la réactivation rend son auteur responsable. Nom et description se modifient sans effet (ADR-006). | Confort d'usage : réactivation à chaque correction de définition. |
| Conservation des CV de la banque AO (AO-04) | **Aucune durée de conservation posée.** Les versions de CV sont en ajout seul ; **anonymisation à la demande** (départ d'une personne, droit à l'effacement : fonction `anonymiser_cv_ao`, `0386`, `MPW06`), sans retour en arrière. | **OUVERT (décision de l'utilisateur, 2026-10-10) : ne rien fixer tant que le conseil juridique n'a pas tranché** (anonymisation AUTOMATIQUE après N années du CV d'un expert parti ? valeur de N). Valeurs provisoires. |
| Retour d'expérience (CAP-01) | **Exception au quatre-yeux** : le chef de mission peut valider la version IA du retour d'expérience qu'il a lui-même demandée (« l'IA propose, l'expert dispose » : il est l'expert) ; la validation reste réservée au chef, au directeur de la mission ou à un associé (`MPJ08`, `0465`). Conforme au PRD. | Aucune. |
| Dossier bancaire (PLA-17) | **Sa génération exige `plan.valider`** (et `plan.lire`, `mission.lire`) : seul qui peut valider une version du modèle financier émet le dossier qui s'appuie sur elle. **L'annexe « Sources » du plan est exclue** (registre des preuves interne : verbatims, assertions du cabinet). | Aucune ; à confirmer. |
| Unités d'un arbre KPI (KPI-13) | **Une relation « somme » n'additionne que des KPI de même unité** (comparaison sans casse ni espaces superflus) ; un **produit** admet des unités différentes (volume × panier moyen). Une écriture qui créerait une NOUVELLE somme d'unités différentes est refusée (409 `KPI_ARBRE_UNITES`) ; un arbre ancien reste modifiable et la lecture le signale (`avertissements_unites`). Un coefficient ne convertit pas une unité. | Aucune ; à confirmer. |
| Retour d'expérience à la clôture (CAP-01) | **Le retour s'ouvre AUTOMATIQUEMENT, en brouillon du gabarit, dans la transaction de la clôture** ; son échec ne bloque jamais la clôture (journalisé). Pour les missions déjà closes, l'écran propose de l'ouvrir (`GET /capitalisation/retours/a-ouvrir`). Sa rédaction et sa validation restent celles du CAP-01 (chef, directeur, associé). | Aucune ; à confirmer. |
| Rubrique « Connaissances » du menu (CAP) | **`temps.saisir` suffit à l'ouvrir** (onglet « Compétences » : ses propres niveaux, « Mes compétences ») ; chaque onglet suit la permission de sa page (`connaissance.lire`, `competence.lire`, `standard.gerer`). Le gestionnaire, qui saisit des temps, la retrouve donc (voir la ligne « Matrice de compétences ») ; il ne lit toujours pas la matrice ni la base de connaissances. | Aucune ; à confirmer. |
| Jours de budget dans les retours d'expérience (CAP-01, FIN-02) | **Posé par défaut : la section « Écarts » (jours budgétés et réels) d'un retour est lisible de tout détenteur de `budget.lire_jours`**, donc d'un consultant membre de l'équipe ; FIN-02 ne vise que les coûts, taux, marges et montants. | **À confirmer par le commanditaire** : un consultant doit-il voir les jours de budget de sa mission dans un retour ? |

## Rejeu réel OpenRouter des évaluations d'agents (AGT-04, 2026-10-10)

Posées PAR DÉFAUT par l'implémentation (ADR-005, migration `0270`, `agents/evaluations-openrouter.ts`) ; aucune de ces valeurs n'a été fixée par le commanditaire, toutes sont **à valider**. Aucun appel réel n'a encore eu lieu (aucune clé OpenRouter en développement) : ces valeurs sont à confirmer au premier rejeu réel.

| Sujet | Règle posée par défaut | Reste à valider |
| --- | --- | --- |
| Plafond par évaluation | **2 USD** (`PLAFOND_EVALUATION_MICRO_USD`), en plus du plafond mensuel du cabinet : au-delà, l'évaluation s'arrête, est INCOMPLÈTE et n'active jamais un prompt ; une estimation prudente déjà au-dessus du plafond est refusée à la demande (409 `PLAFOND_EVALUATION_ESTIME`). | La valeur. |
| Rejeux par cabinet | **5 demandes sur 24 heures glissantes** (429 `TROP_DE_REJEUX`, les demandes « ignorées » sans appel ne comptent pas) et **UN SEUL rejeu en file ou en cours par cabinet** (409 `EVALUATION_EN_COURS`) ; jamais de rejeu d'une combinaison (prompt, jeu d'essai courant, modèle) déjà réussie (409 `EVALUATION_DEJA_REUSSIE`). | Les deux valeurs. |
| Durée maximale d'un rejeu | **8 minutes** (`DUREE_MAX_EVALUATION_MS`), contrôlée avant chaque appel : au-delà, évaluation INCOMPLÈTE (cause `DUREE_MAX_ATTEINTE`). Doit rester sous le délai de blocage des jobs du worker (15 minutes). | La valeur ; une file dédiée aux jobs longs (la file `jobs` est FIFO globale entre cabinets). |
| Péremption d'une demande | Une demande **en file depuis plus de 1 heure** (worker arrêté) ou **en cours depuis plus de 30 minutes** est réputée interrompue (échouée, cause `INTERROMPUE`) à la demande suivante du cabinet. | Les deux délais. |
| Modèle servi | Si le fournisseur répond avec un modèle **différent** du modèle demandé (variante après « : » ignorée, casse ignorée), l'évaluation est **échouée** (`MODELE_SERVI_DIFFERENT`) : elle ne vaut pas pour le modèle demandé. | Le comportement face à un identifiant daté renvoyé par OpenRouter (non vérifié). |
| Séparation des tâches | **Demander un rejeu : `agent.gerer`** (expert métier, associé) ; **activer un prompt ou choisir un modèle : `ia.configurer`** (associé seul). | Aucune ; à confirmer. |
| Coût visible | Coût, estimation, plafond et jetons d'un rejeu : **`finance.lire` seulement** (FIN-02), absents sinon. | Aucune. |
| Contenu d'un jeu d'essai | **Aucun contenu client réel** (textes fictifs ou anonymisés) : le masque d'un rejeu n'a aucun terme sensible. Règle documentée, non contrôlée par le code. | Un contrôle technique éventuel. |

## Chantier lacunes de la vague 2 (2026-10-11)

Posées PAR DÉFAUT par l'implémentation pour combler trois lacunes de la vague 2 : l'événement `mission.cloture_demandee` (AUT-01, AUT-08, ADR-006, migration `0303`), le brief quotidien par rôle (AUT-07, migration `0304`) et le copilote conversationnel (AGT-08, ADR-005, migrations `0271` à `0274`). Aucune de ces valeurs n'a été fixée par le commanditaire, toutes sont **à valider**, sauf les règles du brief et de la relance du copilote tranchées ensuite par l'utilisateur (section « Décisions de l'utilisateur pendant le chantier », points 5 et 6) ; le lot 1 du 2026-10-20 a mis à jour le périmètre, le débit et les outils (lignes ci-dessous). Le copilote n'a jamais été exercé avec un vrai modèle (aucune clé OpenRouter en développement) : la qualité du routage et le format JSON réel restent à constater (SECURITY.md §15).

| Sujet | Règle posée par défaut | Reste à valider |
| --- | --- | --- |
| Événement « clôture demandée » (AUT-01, AUT-08) | **Publié par la base** quand `missions.statut` passe à « à clôturer » (déclencheur non bloquant ; contenu `{ mission_id }` seulement ; jamais depuis le portail). Clé idempotente **par passage** (mission et horodatage) ; **anti-répétition de 10 minutes par mission** (`c_delai_repetition`) : un aller-retour « en cours » ↔ « à clôturer » plus rapide ne republie pas. L'automatisation standard « rappel de check-list de clôture » se déclenche de bout en bout. Le mode d'exécution « droits de la personne à l'origine » est refusé pour TOUT événement du catalogue (aucun n'a de source « module »). | Le délai de 10 minutes. |
| Brief quotidien, périmètre (AUT-07) | **Calcul déterministe, sans IA** : **30 types d'éléments** en trois familles, « À décider » (**16**), « Ça dérive » (8) et « Prêt à envoyer » (6), pour 29 sources (le KPI au rouge et le KPI à l'orange partagent une source) ; chaque source derrière SA permission ET la visibilité de mission ; aucun montant sans `finance.lire` (FIN-02) ; séparation des tâches appliquée à chaque source ; contenu client jamais recopié, liens internes seulement ; 10 éléments par famille, 50 lignes lues par source. Un total « au moins N » (`tronque`) quand une source filtre en code ou lit un volume borné. (Le périmètre initial du 2026-10-11 comptait 27 types, 13 « À décider » : étendu par le lot 1 du 2026-10-20 ; constante vérifiée dans `packages/shared/src/schemas/brief.ts`, 30 types.) | **Le périmètre des 30 types** ; la limite de 10 éléments par famille. |
| Brief quotidien, sources écartées ou reprises | **Reprises** (lot 1, 2026-10-20) : offres techniques d'appel d'offres dont la dernière version n'est pas validée, plans à valider, révisions de budget non figées (voir « Décisions de l'utilisateur pendant le chantier »). **Toujours écartée** : rapports « validés non diffusés » (`rapports_mission` est en ajout seul, son statut `valide` est posé à la génération et aucune table d'envoi, de partage ou de signature ne le référence : pas de trace de diffusion pour les distinguer) ; à rouvrir quand une trace de diffusion au client existera. Un livrable signé n'est « à transmettre » que 7 jours, une facture émise non envoyée que 30 jours. | Les deux fenêtres (7 et 30 jours). |
| Brief quotidien, gravité | Attente d'une décision ou d'un envoi : « moyenne » à **3 jours**, « haute » à **7 jours** ; échéance dépassée (jalon, tâche, feuille, questionnaire) : **3 / 14 jours** de retard ; facture échue : **15 / 45 jours** ; atterrissage au-delà de **5 %** du budget en jours « moyen », au-delà de **15 %** « haut » ; KPI au rouge « haut », à l'orange deux périodes de suite « moyen ». | Tous les seuils. |
| Brief quotidien, envoi | Tâche `brief_quotidien` **chaque jour ouvré à 7 h UTC** (lundi à vendredi, **sans jours fériés**), par lots de **500** utilisateurs internes ; **notification interne** « Votre brief du jour : N éléments (X à décider, Y qui dérivent) », **jamais d'e-mail**, rien si le brief est vide. | L'heure ; la prise en compte des fériés du cabinet ; un envoi par e-mail. |
| Brief quotidien, débit | **60 requêtes par utilisateur et par 10 minutes** sur `GET /api/brief` (429), compteur **PARTAGÉ en base** depuis le lot 1 du 2026-10-20 (limiteur persistant, espace `brief_requetes`, migration `0550`, clé = identifiant de l'utilisateur en HMAC, capacité 100 000 clés ; `apps/api/src/brief/debit.ts`, `REQUETES_BRIEF_PAR_FENETRE = 60`). Coût : une transaction courte par appel du brief. (Le compteur en mémoire du 2026-10-11, propre à chaque processus, est abandonné.) | La valeur (60) et la capacité de 100 000 clés. |
| Brief et copilote, permissions | `brief.lire` : **tous les rôles du cabinet, l'expert externe compris** (ses sources se limitent à ses permissions) ; `copilote.utiliser` : **tous sauf l'expert externe**. | Les deux attributions. |
| Copilote, principe (AGT-08) | **L'IA route, le code répond** : le modèle ne reçoit AUCUNE donnée du cabinet ni d'un client, seulement le message masqué et le catalogue des outils permis, et renvoie un choix strict `{ outil, parametres }` ; la réponse vient de gabarits déterministes. **Repli sans IA** (« mode sans IA ») quand l'IA est désactivée, sans clé, au plafond mensuel, en erreur ou refusée ; l'IA exige `ia.utiliser`. Limite (état du 2026-10-20) : les noms CONNUS du cabinet (raisons sociales des clients, noms des utilisateurs, des contacts clients, intitulés de missions), écrits en entier, sont masqués avant envoi (jetons restitués localement) en plus des formats ; partent en clair un nom absent des fiches, un fragment seul, une faute de frappe, le texte libre autour et le nom d'un autre cabinet. | Le masquage des noms propres (valeurs ci-dessous : 2 000 noms lus par table, 200 termes retenus, 3 caractères minimum, 200 mots du message) ; une vérification avec un vrai modèle (toujours jamais faite). |
| Copilote, outils | À l'origine **six outils de lecture** (mes tâches, feuilles de temps à soumettre, résumé d'une mission, KPI au rouge de mes missions, factures échues, recherche unifiée CAP-07) et une action modifiante (créer une tâche). Le lot 1 (2026-10-20) ajoute **deux lectures**, `missions_en_retard` (missions dont l'utilisateur est directeur, chef ou membre ; jalon non atteint dépassé, ou date de fin dépassée pour une mission signée ou en cours ; `mission.lire`) et `retard_feuilles_temps` (`temps.saisir` ET (`temps.valider` OU `indicateurs.cabinet` OU `mission.lire_toutes`) ; 4 dernières semaines écoulées, noms et nombres de semaines seulement), et **deux actions modifiantes**, `ajouter_commentaire` (600 caractères au plus) et `planifier_relance` (voir « Décisions de l'utilisateur pendant le chantier »). « Factures échues » suit la permission de la balance âgée ; les montants exigent `finance.lire`. | Le catalogue. |
| Copilote, action confirmée | Une action modifiante n'est **jamais exécutée directement** : proposition stockée, confirmation par le **même utilisateur**, **une seule fois**, dans les **5 minutes**, permissions revérifiées. Niveau d'autonomie effectif **N2** exigé pour proposer et confirmer (409 `COPILOTE_ACTION_NON_AUTORISEE`), lecture dès N1 ; le registre standard relève donc le plafond du copilote de **N1 à N2** (version 2, `0273`). | **Le niveau N2** ; les 5 minutes. |
| Copilote, plafonds | **30 messages par utilisateur et par 10 minutes** (429, compté sur le journal), message de **1 000 caractères** au plus, **5 appels de l'outil « KPI au rouge » par 10 minutes** (20 missions évaluées au plus par appel). | Les trois valeurs. |
| Copilote, conservation | Propositions d'actions : **anonymisées 30 jours** après leur fin (paramètres et résumé), purge par le job `copilote_purge` à **02:30 UTC** ; aucune conversation n'est conservée, le journal ne contient jamais le texte d'un message. | **La durée de 30 jours** (avis du conseil juridique) ; l'heure. |
| Personnes du portail et tâches | **Un compte du portail client n'est jamais assignable ni mentionnable** (`authDe` : rôles `client_*` exclus), par le copilote comme par un collaborateur : cela durcit aussi `POST` et `PATCH /taches-collaboration` (400). Création de tâche par un service commun (`collaboration/taches.ts`). | Aucune ; à confirmer. |

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

## Canaux, signatures et transcriptions simulés (lot 3c de la vague 4)

**Règle ferme : aucun envoi réel, aucune clé, fournisseurs simulés** (WhatsApp, SMS, transcription, signature) ; l'API refuse de démarrer avec un autre fournisseur hors développement local. Toutes les valeurs suivantes sont **provisoires — à valider** (valeurs juridiques, tarifs et politiques des fournisseurs : points O-01 à O-27 de SPEC-3c, OUVERTS pour l'utilisateur).

| Sujet | Valeur posée |
| --- | --- |
| Signature simulée | Sans valeur juridique, affichée comme telle ; elle n'a aucun effet sur le budget ni sur le statut de la mission ; reconfirmation d'identité et 2FA active exigées pour signer |
| Consentement WhatsApp / SMS | Accordé par l'utilisateur lui-même ; consentement « recueilli par le cabinet » réservé à un associé ou directeur, avec preuve de 10 à 500 caractères ; STOP (et ses variantes) retire toujours |
| Numéros | Unicité sur les seuls numéros vérifiés ; 3 codes par heure et 10 par jour et par utilisateur ; 5 essais par code |
| Webhook WhatsApp | Route publique signée (HMAC, fenêtre de 300 s, anti-rejeu), n'existe qu'avec un fournisseur configuré ; 30 signatures invalides par 5 minutes en base, 100 au total et 50 par adresse en mémoire |
| Messages entrants | Ignorés si l'expéditeur est désactivé, son accès portail ou son client inactif, ou son numéro non vérifié (sauf STOP) ; jamais transmis à un modèle de langage |
| Transcriptions | Un audio ne se transcrit que par son auteur ; texte validé par un humain avant tout usage ; 50 versions et 30 corrections par 10 minutes au plus ; anonymisation planifiée |
| `canaux.lire` du chef de mission | Ouvre les contacts, consentements et synthèses de tous les clients du cabinet : **à confirmer** (restreindre aux missions visibles ou non) |
| Numéro vérifié (mise à jour du lot 3, 2026-10-20) | Le numéro est unique par cabinet et par canal **seulement s'il est vérifié** (index partiel `canaux_destinataires_numero_verifie_uniq`, `0541`) : plusieurs comptes peuvent saisir le même numéro non vérifié, aucun ne reçoit de message entrant tant qu'il n'est pas vérifié ; le conflit se tranche à la vérification du code (O-22). **À valider** |
| Alertes de KPI sortantes (O-26, lot 3, 2026-10-20) | **Livrées** (voir « Décisions de l'utilisateur pendant le chantier », point 1) : mise en file d'un message `alerte_kpi` après l'enregistrement d'une alerte et pour le rappel de mesure, vers les seuls responsables INTERNES autorisés (numéro vérifié, consentement accordé) ; variables = nom du cabinet et lien `/portail/` seulement, aucune valeur chiffrée, aucun libellé de KPI ; un échec ne fait jamais échouer le suivi (`SAVEPOINT`) ; une alerte `MESURE_EN_RETARD` ne part pas seule (le rappel du même passage la couvre). Le lien `/portail/` est **à valider** |
| Média entrant | Lu en flux, jamais en entier en mémoire (`lireFluxPlafonne`, `canaux/media-flux.ts`) : taille déclarée contrôlée avant lecture, plafond de 15 Mo compté en octets, type MIME hors liste blanche refusé sans lecture. Reste pour un futur adaptateur réel : hôte de confiance (SSRF) et délai sur le flux |
| PDF de signature | Servi en `inline` (type `application/pdf` fixé, `nosniff`, `no-store`, CSP sans `sandbox`) avec repli `attachment` + `sandbox` si le type stocké n'est pas PDF ; risque résiduel : faille de la visionneuse PDF du navigateur. **À valider** |
| Désactivation d'un utilisateur | Retire ses consentements (source `desactivation_utilisateur`), qu'il soit du portail ou du cabinet ; le destinataire n'est ni supprimé ni modifié |

Le lot 3c-bis (2026-10-20) est livré : alertes de KPI sortantes, seed de démonstration des canaux simulés (aux seuls numéros de test du simulateur, aucun envoi réel), média en flux, PDF de signature en `inline`. Le détail technique est dans SPEC-3c.

## Due diligence stratégique (lot 3b de la vague 4)

Toutes les valeurs sont **provisoires — à valider** par un expert avant le pilote ; elles ne reposent sur aucune source normative.

| Sujet | Valeur posée |
| --- | --- |
| Plafonds d'une liste d'exclusion | 100 règles ; 10 mots-clés de 60 caractères et 5 mots chacun par règle ; 60 mots par activité filtrée |
| Plafonds des journaux | 200 liens par hypothèse, 200 décisions par filtrage, 50 filtrages par dossier |
| Verdict et note | Un verdict validé ne tient que pour la version courante de l'hypothèse ; une hypothèse portant un verdict validé ne se modifie plus (409) ; une note validée est périmée dès qu'une version plus récente existe |
| Filtrage environnemental et social | Seul le dernier filtrage reçoit des décisions ; l'auteur d'un filtrage ne peut pas écarter une exclusion (hors associé) ; une exclusion non levée d'un filtrage antérieur reste bloquante |
| Listes d'exclusion d'un investisseur | Référentiel du cabinet, lisible de tout détenteur de `dd.lire` (choix assumé, à confirmer) |
| Connecteurs de données ouvertes (DD-02) | Simulés seulement ; aucune source réelle branchée |
| Portail investisseur (lot 3b-bis, 2026-10-20) | **N'est plus repoussé** : livré (option du cabinet désactivée par défaut, invitation d'un compte `client_investisseur`, publication d'un instantané de la version validée de la note, consultation en lecture seule). Valeurs et règles : voir la section « Portail investisseur et modèles sectoriels (DD-07) » plus bas et « Décisions de l'utilisateur pendant le chantier » |

## Redressement (RED-01, 02, 05–07, 10–12, 14) — lot 3a de la vague 4 (2026-10-11)

Aucune des valeurs ci-dessous n'a été fixée par le commanditaire ni par un expert : **toutes sont
provisoires — à valider**. Ce sont des constantes nommées, exportées de `packages/engines/src/redressement` ou
de `packages/shared/src/schemas/redressement.ts`, jamais des nombres cachés. Quand aucune source n'existe, la
justification dit « convention, sans source » : rien n'est présenté comme un fait. À notre connaissance, aucun
barème de l'ONUDI ni des textes de l'OHADA ne fixe de seuil chiffré pour ces ratios : le PRD s'inspire de
l'ONUDI pour la **démarche** (pré-diagnostic, diagnostic, plan, suivi), pas pour des nombres. Spécification :
`docs/workflows/specs/SPEC-3a-redressement.md` §13 ; ADR-011.

**Point OUVERT : les seuils d'alerte par secteur et la grille d'urgence n'ont aucune source normative.** Tant
qu'un expert n'a pas publié de version sectorielle, les secteurs retombent sur le jeu « général » ci-dessous ; le
score reste « indicatif » et l'écran le dit. À faire valider par les experts du cabinet (ateliers de calibration
avec des cabinets pilotes) avant tout usage au pilote. **FIN-02 à confirmer** : les montants et marges **du
client** relèvent de `redressement.lire` et non de `finance.lire` (le module ne manipule aucune donnée du
cabinet) ; les réserver à `finance.lire` rendrait le module inutilisable par le chef de mission et le
consultant, auquel cas on créerait plutôt une permission `redressement.montants`.

- **Seuils d'alerte par défaut** (`SEUILS_ALERTE_DEFAUT`, secteur « général ») : une version par secteur,
  rédigée puis publiée par un expert métier ou un associé (auteur exclu sauf associé) ; un score conserve ses
  entrées et un instantané des seuils. Inégalités strictes ; le moteur compte en points de base pour les ratios et
  les tendances (10 000 = 1,0 ou 100 %), en jours pour le BFR, en nombre d'incidents pour les autres critères.
  Niveaux du score : modéré à 25, élevé à 50, critique à 75 (convention) ; part minimale évaluée : 50 % du poids
  (même principe que NOT-03 : un score exige la moitié du poids évalué) ; somme des poids : 100 (convention).

  | Critère | Sens | Orange | Rouge | Poids | Justification (provisoire — à valider) |
  | --- | --- | --- | --- | --- | --- |
  | Liquidité générale | bas pire | < 1,2 | < 1,0 | 15 | Rouge : définition (l'actif circulant ne couvre pas les dettes à court terme). Orange : marge de sécurité conventionnelle, sans source. |
  | Liquidité immédiate | bas pire | < 0,2 | < 0,1 | 10 | Convention d'analyse financière (couverture des dettes à court terme par les seules disponibilités), sans source ni norme chiffrée connue. |
  | Autonomie financière | bas pire | < 25 % | < 10 % | 10 | Convention (capitaux propres sur total du passif) ; le tiers est souvent cité en analyse bancaire (non vérifié, sans source). Distinct de la règle OHADA sur les capitaux propres et le capital (AUSCGIE, art. 664, **à vérifier par un juriste**), qui n'est **pas** reprise ici. |
  | Endettement | haut pire | > 1,0 | > 2,0 | 10 | Orange : reprend `SEUILS_BANCABILITE_DEFAUT.endettementMaxPb` (lui-même « indicatif, à calibrer avec les banques »). Rouge : le double, convention. |
  | Couverture des charges financières | bas pire | < 3,0 | < 1,5 | 10 | Convention de couverture des intérêts (3 et 1,5 fois), sans norme officielle connue. |
  | Marge nette | bas pire | < 2 % | < 0 % | 10 | Rouge : une perte (définition). Orange : convention, sans source. |
  | BFR en jours | haut pire | > 60 j | > 90 j | 5 | Rouge : reprend `SEUILS_BANCABILITE_DEFAUT.bfrJoursMax`. Orange : convention. **Le BFR dépend fortement du secteur** : c'est la raison d'être des seuils sectoriels fixés par les experts. |
  | Croissance du chiffre d'affaires | bas pire | < 0 % | < −10 % | 10 | Orange : l'activité recule. Rouge : reprend le seuil de la question A1 de l'urgence (cohérence interne), convention. |
  | Variation de la marge brute | bas pire | < 0 pt | < −5 pts | 5 | Convention (perte de 5 points de marge brute), sans source. |
  | Rejets bancaires sur 12 mois | haut pire | > 0 | > 2 | 5 | Un rejet est un signal ; au-delà de deux : convention. |
  | Retards fournisseurs de plus de 90 jours | haut pire | > 0 | > 4 | 5 | Un fournisseur payé avec plus de 90 jours de retard est un signal ; au-delà de quatre : convention. |
  | Arriérés fiscaux et sociaux | haut pire | > 0 | > 0 | 5 | Tout arriéré d'impôts ou de cotisations est rouge : convention, cohérente avec la question T1 de l'urgence. |

- **Grille d'urgence** (RED-01) : 15 questions en 5 domaines ; question critique = poids 2 ; le voyant d'un
  domaine passe à l'orange à partir de 25 % et au rouge à partir de 50 % du total pondéré possible ; un domaine
  n'est évalué que si 50 % au moins de son poids est répondu. Formulations inspirées de signaux d'alerte
  classiques (retards de paiement, rejets bancaires, arriérés fiscaux et sociaux, baisse d'activité) : **aucune
  source**, à valider par les experts ; seuils de 25 % et 50 % : conventions.
- **Horizon de trésorerie** : 13 semaines, fenêtre glissante par nouvelle version : fixé par le PRD (RED-11),
  pratique courante de la trésorerie de crise ; **non provisoire**. Seuil de tension par défaut : 0 (solde
  projeté négatif), réglable par version (convention).
- **Base de jours** (BFR, point mort) : 360, alignée sur le modèle financier (`JOURS_PAR_AN_BFR`) et
  `bancabilite.ts` : cohérence interne, pas une norme.
- **Fenêtres du plan** : quick wins jusqu'à 6 mois, restructuration au-delà de 6 mois et jusqu'à 24 mois (PRD,
  RED-05 : 3 à 6 mois, 6 à 24 mois) ; la borne basse de 3 mois n'est pas contrôlée (avertissement seulement
  au-delà de 6 mois).
- **Secteurs** : `general`, `industrie`, `commerce`, `services`, `btp`, `agriculture` (liste fermée de départ ;
  le PRD, RED-03, cite industrie, services, commerce) : à ajuster par les experts.
- **Postes de ratio et correspondance indicative** : 14 postes ; dix correspondances SYSCOHADA indicatives
  reprises de `REFERENCES_SYSCOHADA` (« à confirmer par un expert-comptable ») ; quatre postes sans référence. La
  correspondance est faite à la main par le cabinet (version tracée, avertissement « indicative », un poste
  manquant n'est jamais compté comme zéro).
- **Catégories** : 4 + 7 catégories de flux de trésorerie, 6 catégories de créanciers (convention de
  présentation, à ajuster).
- **Leviers** (RED-14) : six leviers aux formules arithmétiques usuelles (BFR, prix, charges fixes, cession),
  hypothèses affichées, impact stocké avec ses paramètres (un instantané) ; bornes de saisie (jours de 1 à 180,
  réduction de 1 à 10 000 pb, hausse de prix jusqu'à 5 000 pb, perte de volume jusqu'à 9 999 pb, mise en œuvre de
  0 à 12 mois) : des garde-fous, pas des valeurs recommandées ; formules à valider par les experts.
- **Plafonds de volume** (garde-fous contre le déni de service, **aucune source**, à calibrer avec un cabinet
  pilote) : 100 versions de correspondance, 200 urgences, 500 scores, 50 versions de seuils par secteur, 200
  versions de trésorerie, 600 lignes par version, 1 000 réalisés (11 enregistrements au plus par semaine), 200
  créanciers, 100 versions de créance et 300 événements de négociation par créancier, 60 échéances par accord, 300
  actions, 200 événements par action, 100 versions de plan. **Débits** : 30 évaluations d'urgence, 30 scores et 60
  versions de trésorerie par utilisateur et par 10 minutes (même ordre de grandeur que `copilote` et `kpi`).
- **Montant maximal** (`MONTANT_RED_MAX`) : 10^13 unités mineures : garde l'exactitude des sommes, pas une
  borne métier.
- **Conservation des données** : **aucune durée posée** (données du client en ajout seul) ; à valider avec le
  conseil juridique, comme les autres lots.
- **Publication des seuils et validation du plan** : publication par un expert métier ou un associé, auteur
  exclu sauf associé ; validation d'une version de plan par un associé ou un directeur de mission, créateur exclu
  sauf associé ; transposition de `MPN04`, `MPW05`, `MPM08` et du R3 du PRD complémentaire §10 : à confirmer. Le
  socle ne produit aucun livrable : pas de suivi qualité R3 du plan tant qu'aucun rapport ni export n'existe
  (RED-08).
- **Hors lot, repoussé (état du 2026-10-11, mis à jour le 2026-10-21)** : RED-03, RED-04, RED-08, RED-09 et
  RED-15 interne sont **livrés** par le lot 3a-bis (section « Redressement, lot 3a-bis » plus bas). Reste
  repoussé : RED-13 (repères OHADA : **OUVERT, contenu à valider par un juriste**, aucun conseil juridique
  automatisé) et RED-15 partagé au conseil d'administration et aux banques (partage externe non ouvert).

## Décisions de l'utilisateur pendant le chantier (2026-10-20 à 2026-10-21)

Quatorze points **VALIDÉS** par l'utilisateur dans la conversation pendant le chantier des lots de la vague 4
(lots 1 à 7 : les points 1 à 9 datent des lots 1 à 5a, les points 10 à 14, **validés le 2026-10-21**, des lots 5b et 7). Ce ne sont **pas** des valeurs provisoires : elles ne figurent plus dans les colonnes « à
valider » et ne se modifient que sur décision de l'utilisateur. Quand une note de lot présentait l'une de ces
règles comme provisoire, la décision de l'utilisateur prime.

| N° | Sujet | Décision VALIDÉE |
| --- | --- | --- |
| 1 | Alertes de KPI par WhatsApp (lot 3c-bis) | Envoyées vers des responsables **INTERNES** seulement, en **option du compte** `alerte_kpi`, **DÉSACTIVÉE par défaut** (`canaux_comptes.alerte_kpi`, migration `0549`). Aucune valeur chiffrée ni libellé de KPI dans le message. |
| 2 | Note de due diligence périmée (lot 3b-bis) | Une publication dont la note a une version plus récente **reste visible de l'investisseur** ; elle est marquée **« périmée » côté cabinet**. |
| 3 | Partage investisseur (lot 3b-bis) | La **publication** est réservée à l'associé et au directeur de mission (`dd.portail.gerer`) ; la **configuration de l'option du cabinet** à l'associé seul (`dd.portail.configurer`). Lecture côté investisseur : `portail.dd.lire` (`client_investisseur` seul). |
| 4 | Pièces libres d'une publication investisseur | **10 au plus** par publication. |
| 5 | Relance du copilote (`planifier_relance`) | **Sans e-mail au client**, et **une relance copilote par facture et par jour** (revérifiée à la confirmation, sous verrou par facture : seconde confirmation en 409 `RELANCE_DEJA_ENREGISTREE`). |
| 6 | Brief quotidien | L'**auteur est toujours exclu** de ce qu'il a créé ou rédigé (séparation des tâches ; **aucun associé exempté**, plus strict que les routes) ; une **révision de budget non figée** est « à valider » ; un **jalon dépassé** fait de la mission une mission en retard (outil `missions_en_retard` du copilote). |
| 7 | Revue à froid (QUA-05) | **Tout intervenant de la mission est exclu** comme relecteur ; **aucun jour consommé n'est imputé à la revue** ; **l'associé réaffecte** la revue. |
| 8 | Groupes et filiales (DOS-05) | Seuil de contrôle **> 50 %** (vue intégrale) ; conversion **EUR / XAF / XOF au taux fixe 655,957** (1 EUR = 655,957 XOF = 655,957 XAF, XOF = XAF à 1:1) ; **USD exclu** (consolidation signalée partielle) ; le rapport d'état financier du groupe est réservé à `dossier.lire`. |
| 9 | Redressement (RED-05, RED-08) | La **validation du plan ET du bilan de clôture** est réservée au **directeur de la mission** ; une mission **sans directeur ne valide ni l'un ni l'autre** (409 `DIRECTEUR_REQUIS`), règle doublée en base par `0492` (SQLSTATE `MPZ07`, message distinct). La séparation des tâches (créateur différent du valideur, sauf associé) est conservée. |
| 10 | Observatoire (CAP-04, lot 5b) : règle « des autres » — **validée le 2026-10-21** | Les seuils d'anonymat sont calculés **HORS du cabinet appelant** : une case (secteur × taille) n'est publiée que si elle compte au moins **5 entreprises ET 3 cabinets AUTRES que l'appelant** (`obs_agregats`, `0472`, colonnes `effectif_entreprises_autres` et `effectif_cabinets_autres` ; le moteur re-vérifie : `OBSERVATOIRE_ENTREPRISES_MIN` 5, `OBSERVATOIRE_CABINETS_MIN` 3). Les statistiques publiées incluent les données de l'appelant. Limites assumées : la collusion de trois cabinets contributeurs n'est pas couverte (à encadrer par les conditions d'adhésion) et une case à exactement 3 contributeurs est masquée pour chacun d'eux. |
| 11 | Efficacité des recommandations (CAP-03, lot 5b) — **validée le 2026-10-21** | **Seuil de 5 observations** avant d'afficher un score par contexte (`EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT` 5 ; le seuil d'un cabinet ne peut que le relever, plancher `EFFICACITE_SEUIL_OBSERVATIONS_MIN` 5) et **effet mesuré à 30 jours** après la mise en œuvre (`EFFICACITE_DELAI_EFFET_JOURS` 30). Les autres paramètres du score restent provisoires (section « Capitalisation… lot 5b »). |
| 12 | Diagnostic flash : prix (lot 7) — **validée le 2026-10-21** | **AUCUN prix par défaut** : le prix est « à fixer par le cabinet » (`prix.a_fixer`) et le type de mission ne peut pas être activé tant que le cabinet n'a pas saisi de prix (409 `PRIX_A_FIXER`, `SERVICES_PRIX_REQUIS` de `packages/shared/src/schemas/services-candidats.ts`). Seul le seed de démonstration pose un prix, marqué `DÉMONSTRATION`. |
| 13 | Business plan bancable : prix (lot 7) — **validée le 2026-10-21** | **« Sur devis »** : le type de mission s'active **sans prix** (montant nul admis, `SERVICES_PRIX_REQUIS` faux). Ce mode est **marqué « à valider »** : la décision n'a pas fixé de tarif, seulement l'absence d'obligation. |
| 14 | Gestion des services candidats et des guichets (lot 7) — **validée le 2026-10-21** | L'**associé ET le directeur de mission** gèrent les services candidats (activation des types de mission, prix fixe) et les guichets de financement (`services_candidats.gerer`) ; la lecture (`services_candidats.lire`) suit `catalogue.lire`, l'expert externe n'a aucun accès. |

L'**accès à l'observatoire réservé aux cabinets contributeurs** (cabinet adhérent avec au moins une contribution éligible : mois civil clos, versée depuis la dernière adhésion ; sinon 403 `OBSERVATOIRE_CONTRIBUTION_REQUISE`, `MQK27`) n'est pas un point nouveau de cette liste : la note du lot 5b le cite comme « décision n° 1 », c'est-à-dire la décision du commanditaire déjà consignée dans « Validations complémentaires » (PRD complémentaire : seuls les cabinets contributeurs consultent les benchmarks). Il est donc **validé** à ce titre, et non par une décision de l'utilisateur du 2026-10-21 ; sa mise en œuvre précise (définition d'une contribution éligible) reste **provisoire, à valider**.

## Socle IA : rejeu, brief et copilote (lot 1, 2026-10-20)

Précise et met à jour les sections « Rejeu réel OpenRouter » (2026-10-10) et « Chantier lacunes de la vague 2 »
(2026-10-11). Migrations `0275`, `0276`, `0277`, `0305`, `0550`. Les valeurs ci-dessous sont **provisoires, à valider**
(sauf celles du tableau « Décisions de l'utilisateur » ci-dessus).

| Sujet | Règle posée | Reste à valider |
| --- | --- | --- |
| Rejeu OpenRouter, provenance | La demande, ses appels et l'évaluation `openrouter` ne s'écrivent plus que par des fonctions `SECURITY DEFINER` sous garde du job de rejeu (`0275`, SQLSTATE `MPG12` à `MPG15`) ; une évaluation locale n'insère plus que 12 colonnes. Dette assumée : un rôle PostgreSQL distinct pour le worker n'existe pas (nouvel ADR à écrire). | Le rôle distinct du worker. |
| Rejeu, bornes de cohérence | **2 appels au plus par cas** ; par appel : jetons d'entrée ≤ 2 000 000, jetons de sortie ≤ 1 000 000, coût ≤ 100 USD, durée ≤ 1 heure ; horodatages du job : 1 minute avant le début au plus tôt, 1 jour après maintenant au plus tard. | Toutes ces bornes. |
| Équité de la file `jobs` | La **réservation** est équitable par cabinet depuis `0305` (cabinet ayant le moins de jobs en cours, puis tourniquet, puis plus ancien). Le worker traite toujours **un job à la fois** : un rejeu de 8 à 13 minutes bloque la boucle. Remplace la mention « FIFO globale » de la section Rejeu. | Une file dédiée aux jobs longs ou un second worker. |
| Activation d'un prompt | Exige une évaluation sur le **modèle routé** du cabinet (`ia_modeles_taches`, sinon modèle recommandé) ; `modele_recommande()` en SQL duplique `MODELES_RECOMMANDES` (un test les compare : changer un modèle recommandé exige une migration). | Le comportement au retour au modèle recommandé (non gardé à l'activation). |
| Brief, périmètre et sources | Voir les lignes mises à jour de la section « Chantier lacunes de la vague 2 » : 30 types (16 / 8 / 6), 29 sources, offres techniques, plans et révisions de budget reprises, rapports « validés non diffusés » toujours écartés. Plans : `plan.valider` ET responsable de la mission visible et non clôturée, contenu `modifie`, `brouillon_ia` ou modèle financier non validé, hors modèle dont l'utilisateur est l'auteur. Révision de budget : `budget.reviser`, directeur de la mission ou associé, mission signée, en cours ou à clôturer, palier FIN-15 recalculé pour un non-associé, jamais de montant (FIN-02). | Le périmètre des 30 types. |
| Brief, date rejouée | « Date rejouée du brief » est interprétée comme persistée **dans l'URL** (`?date=`), avec sélecteur et mention « Brief du … (rejeu) ». L'autre lecture (persistance serveur de la date) n'est **pas faite**. | Laquelle des deux lectures est voulue. |
| Copilote, masquage des noms | 2 000 noms lus par table, 200 termes retenus, 3 caractères au minimum, 200 mots du message ; au-delà, le surplus part en clair. | Les quatre bornes. |
| Copilote, valeurs | Commentaire de 600 caractères au plus (anonymisé à 30 jours, jamais au journal d'échange) ; retard de feuilles de temps : 4 semaines, 200 collaborateurs lus ; conversation web conservée dans le `sessionStorage` de l'onglet seulement (20 questions, 30 minutes d'inactivité, bouton « Effacer la conversation », jamais envoyée au serveur) ; sous N1, une demande d'action reçoit 200 `statut: refuse` au lieu de 409. | Toutes ces valeurs. |
| Routage du copilote | Aucun appel direct au fournisseur depuis `copilote/` : point d'entrée `admettreSansDemande` / `appelerSansDemande` de `ia/orchestrateur.ts` (plafond mensuel réservé sous verrou, une tentative, journal sans contenu). | Aucune. |

## Redressement, lot 3a-bis (RED-03, 04, 06 suite, 08, 09, 15 interne ; 2026-10-20)

Complète la section « Redressement … lot 3a » : mêmes principes (constantes nommées dans
`packages/engines/src/redressement` et `packages/shared`, rien de caché, justification « convention, sans source »).
Migrations `0487` à `0492` et `0551`. Tout est **provisoire, à valider** par un expert, sauf le point 9 du tableau
« Décisions de l'utilisateur » (validation par le directeur de la mission).

- **Check-lists (RED-03)** : `CHECKLISTS_DEPART` (industrie 10 points, services 9, commerce 9, marquées « à valider
  par un expert ») ; conformité = (2 × oui + partiel) / (2 × applicables), un point non renseigné reste au
  dénominateur ; plafonds : 100 modèles par cabinet, 30 versions par modèle, 40 points par modèle, 30 check-lists
  par dossier, 2 000 réponses par check-list, 40 réponses par lot ; débits par utilisateur et par 10 minutes : 10
  modèles, 20 versions, 30 activations, 60 lots de réponses. Publication par un expert métier différent de l'auteur
  (sauf associé).
- **Causes racines (RED-04)** : brouillon IA, puis modifié, puis validé, historique en ajout seul ; 12 causes au plus
  (libellé 120 caractères, description 1 000, contexte libre 2 000) ; 30 cartographies par dossier, 200 rangs par
  cartographie, contenu de 65 000 octets ; débits : génération 10 et modification 60 par 10 minutes ; au moins 2
  causes exploitables (`MIN_CAUSES_EXPLOITABLES`), sinon repli déterministe ; correspondance critère d'alerte vers
  domaine (`DOMAINE_CRITERE_ALERTE`) conventionnelle ; génération refusée sans donnée de diagnostic (409
  `RED_CAUSES_SANS_DIAGNOSTIC`). Validation par un consultant différent du demandeur et de l'auteur (sauf associé),
  nombres non vérifiés acquittés. Une cartographie non validée n'entre jamais dans le rapport de clôture.
- **Covenants et plan de financement (RED-06 suite)** : 7 ratios admis, 12 covenants par version, seuil borné à
  10^8 points de base, prêteur 120 caractères, 100 versions par dossier ; plan de financement de 1 à 8 périodes
  (année ou semestre), 200 lignes, 100 versions ; 20 versions par 10 minutes. Un covenant en défaut s'affiche
  « Seuil non atteint (constat arithmétique) », jamais comme une qualification juridique.
- **Bilan de clôture et rapport (RED-08)** : 6 contrôles bloquants (exercice de fin, score d'alerte de fin,
  urgence de fin, trésorerie, au moins une action non abandonnée, causes validées) et 5 informatifs
  (`CONTROLES_CLOTURE`) ; « ouverture » = exercice accepté le plus ancien des 3 lus, première évaluation d'urgence
  et de score, première version de trésorerie sans réalisé ; 30 versions de bilan par dossier, 100 000 octets, 10
  par 10 minutes. La re-notation lit la première et la dernière version **publiées** de la notation de la mission
  (sans deux versions publiées : « non comparable ») ; le module ne déclenche aucune nouvelle notation. Le bilan
  s'établit avant la clôture du dossier ; la clôture du dossier **ne requiert pas** de bilan validé (choix
  réversible, non bloquant). Rapport de clôture (modèle `cloture_redressement`, niveau `red`, lecture
  `redressement.lire`). Qualité : le suivi qualité du rapport est ouvert en R2 au minimum ; le passage automatique
  en R3 exigerait un type de livrable dédié (dette) ; contournement : `POST /api/qualite/suivis/:id/classe`.
- **Suivi post-mission (RED-09)** : jalons +6 et +12 mois par défaut ; `SEUIL_DEGRADATION_INFORMATION_PB` 500,
  `SEUIL_DEGRADATION_ATTENTION_PB` 1 500, `RETARD_ATTENTION_JOURS` 30, `JALON_PROCHE_JOURS` 15 ; 12 jalons par plan,
  10 relevés et 8 événements par jalon, mois 1 à 60 ; débits : 60 plans, 30 relevés, 30 événements par 10
  minutes. Alertes **calculées à la lecture** : aucun job, aucun envoi, aucun accès du portail (les relances par
  job sont un lot ultérieur). Le suivi n'écrit que sur un dossier **clos** (`MPZ19`), même mission clôturée.
- **Tableau de bord et voyant (RED-15 interne)** : `SEMAINES_TENSION_CRITIQUE` 4, `COVENANTS_DEFAUT_CRITIQUE` 2,
  `ACTIONS_RETARD_CRITIQUE` 5, `MOTIFS_PRINCIPAUX_MAX` 3 ; urgence rouge = critique, orange = vigilance ; alerte
  critique = critique, élevée ou modérée = vigilance ; portefeuille : 10 par page (25 au plus). Le voyant est
  indicatif. **Le « voyant rouge » (`calculerEtatVoyant`) est branché au brief depuis le lot 8b** (voir « Dettes
  transverses, lot 8b ») ; `etatVoyantDossier` et l'automatisation restent non branchés (lot ultérieur). Le **partage externe** du tableau de bord (conseil
  d'administration, banques) n'est **pas ouvert** : aucune route du portail, aucune option de cabinet.
- **Correspondance secteur client vers secteur du redressement** : table prudente `CORRESPONDANCE_SECTEURS_CLIENT`
  (`apps/web/src/lib/redressement-secteur.ts`) : transport, logistique et microfinance rangés en « services » ;
  sans correspondance sûre, « général ».
- **Mineurs de recette** : libellé « Besoin de financement prévu » (le besoin est une projection, réalisé constaté
  sinon prévu) ; variation de marge en points ; note de négociation vide refusée (400) ; secteur du dossier
  prérempli depuis le client ; version de seuils remplacée affichée « Remplacée ».
- **Codes d'erreur** : `MPZ12` à `MPZ20` pris ; la lettre `Z` est épuisée pour le redressement (`MPZ01` à `MPZ20`),
  `0492` réutilise `MPZ07` ; code de rapport `MPR05` (source de rapport de clôture incohérente).
- **Limites inchangées** : RED-13 (repères OHADA) **OUVERT** ; seuils sectoriels et grille d'urgence sans source
  normative.

## Due diligence : portail investisseur et modèles sectoriels (DD-07), lot 3b-bis (2026-10-20)

Migrations `0509` (portail investisseur) et `0511` (modèles sectoriels). Valeurs **provisoires, à valider**, sauf les
points 2, 3 et 4 du tableau « Décisions de l'utilisateur ».

- **Permissions** : `dd.portail.configurer` (associé seul), `dd.portail.gerer` (associé, directeur de mission),
  `portail.dd.lire` (`client_investisseur` seul).
- **Portail investisseur** : option du cabinet désactivée par défaut ; au plus 10 pièces par publication (décidé),
  50 publications par note, 500 événements d'invitation par dossier, 1 000 changements d'option ; **une seule
  publication active par note** ; seule la dernière version soumise **et validée** est publiable ; pièces figées à
  la publication (retirer puis republier pour les changer) ; retraits possibles après la clôture de la mission,
  invitation et publication refusées après clôture ; ce que l'investisseur voit : un instantané en lecture seule,
  sans identifiant de dossier, note, mission ou rapport, sans nom de membre du cabinet, sans coût.
- **DD-07, modèles d'analyse par secteur** : **véhicule seulement**, vides par défaut, rédigés par le cabinet
  (aucun contenu sectoriel livré, à rédiger par un expert) ; 200 modèles par cabinet, 50 points par modèle, 300
  caractères par point, 40 000 octets de points par version ; un modèle par secteur (pas par filière) et par
  analyse. Reste ouvert : la filière.
- **Note au comité, noms de fichiers** : `Note au comité - <titre ≤ 60 caractères> - v<version> - exécutive|détaillée
  <date>.<ext>`.
- **Codes d'erreur** : second préfixe `MQD` (`MQD01` à `MQD08` portail investisseur, `MQD11` modèles sectoriels),
  la lettre `Z` étant épuisée (les codes `MPZ21` à `MPZ32` restent ceux de la due diligence du lot 3b).

## Référentiel de méthodes (STD-11) et revue à froid (QUA-05), lot 4a (2026-10-20)

Migrations `0210` (facteurs de contexte modifiables, SQLSTATE `MQS01`, `MQS02`) et `0287` à `0289` (revue à froid,
SQLSTATE `MQQ01` à `MQQ12` ; `0290` et `MQQ13` ajoutés par le lot 8b). Valeurs **provisoires, à valider**, sauf le point 7 du tableau « Décisions de
l'utilisateur » (relecteur).

- **Permissions** : `qualite.froide.gerer` (associé seul : tirage, affectation, clôture, plan d'amélioration) ;
  `qualite.froide.relire` (associé, directeur de mission, expert métier). Les responsables d'actions suivent leurs
  actions avec `mission.lire`.
- **Grille de revue à froid v1** : 8 critères pondérés 3, 3, 3, 2, 2, 2, 2, 2 ; notes de 1 à 5. La grille « complète »
  est codée en dur dans le déclencheur de base : une grille v2 exige une migration.
- **Seuils de conclusion** (`SEUILS_REVUE_FROIDE`, vérifié : conforme 75, réserves 50) : conforme à partir de 75,
  réserves à partir de 50, sinon non conforme ; un constat **critique** donne non conforme ; un constat **majeur**
  donne au mieux « réserves » ; une couverture inférieure à 0,5 n'est jamais « conforme ».
- **Plafonds** : échantillon de 100 missions, population de 5 000, 100 constats par revue, 500 actions par campagne.
- **Tirage** : empreinte 53 bits (cyrb53) sur `graine:id` ; tourniquet entre strates (type de mission ou directeur) ;
  missions déjà tirées exclues par défaut ; critères, graine, population et échantillon figés après le tirage.
- **Relecteur indépendant** (décidé, point 7) : ni directeur, chef, membre d'équipe, affecté du planning, créateur,
  clôtureur ou signataire de la mission, ni auteur, ouvreur, valideur, signataire ou attestateur d'un suivi qualité
  de la mission. Deux implémentations alignées (moteur `evaluerIndependanceRelecteur` et déclencheur de `0287`).
- **STD-11, contrôle de cohérence** : `REGLES_CONTRADICTOIRES` (deux règles actives de même priorité, de condition
  identique et d'effets contraires) est une **erreur bloquante** ; `CONFLIT_MEME_PRIORITE` (conditions différentes)
  reste un avertissement. STD-13 et STD-14 restent à faire.

## Dossier client : groupes, filiales et rapport d'état financier, lot 4b (2026-10-20, relu le 2026-10-21)

Migrations `0225` (participations, SQLSTATE `MQF01` à `MQF04`) et `0552`. Les règles marquées « décidé » sont celles du
point 8 du tableau « Décisions de l'utilisateur » ; le reste est **provisoire, à valider**.

- **Pas une consolidation comptable légale** : aucune élimination d'opérations intragroupe.
- **Parts de détention en points de base** (0 à 10 000 ; 0 = fin de détention, motif obligatoire) ; historique
  conservé en ajout seul. Refus : cycle (y compris futur), auto-détention (400), total des parts > 100 %, fin de
  détention sans détention antérieure, **profondeur de plus de 8 liens** (`PROFONDEUR_GROUPE_MAX = 8`, vérifié ;
  `DETENTION_TROP_PROFONDE`, `MQF04`). Un refus de détention répond **409**, qu'il vienne du moteur ou du
  déclencheur.
- **Périmètre** : la racine de la vue (société de tête par défaut ou client demandé) et ses filiales ; part cumulée
  = somme, sur tous les chemins depuis la racine, du produit des parts (calcul exact, un arrondi final en points de
  base).
- **Vue intégrale** : somme à 100 % de la racine et des entités dont la part cumulée est **> 50 %** (décidé). **Vue
  proportionnelle** : somme de montant × part cumulée, un seul arrondi à la fin. Marge nette = résultat / produits
  sur les sommes de chaque vue, jamais moyenne de marges. Fiabilité : moyenne des indices de fiabilité des entités
  incluses pondérée par la part cumulée.
- **Devises (décidé)** : devise de consolidation = celle de la racine ; EUR, XAF, XOF convertis au taux fixe 655,957
  (`PARITE_EUR_FCFA`, vérifié ; XOF = XAF à 1:1), un arrondi demi s'éloignant de zéro par montant avant toute somme ;
  USD exclu (« devise sans taux de conversion validé »), consolidation partielle ; entités converties listées
  (`consolidation.conversions`).
- **Données** : états financiers acceptés de l'exercice ; une entité sans état accepté, d'un autre exercice, de
  devise non convertible ou non visible de l'utilisateur est exclue (consolidation « partielle ») ; un dossier non
  visible apparaît comme nœud anonyme (niveau et part). FIN-02 : la réponse ne porte que des données du client.
- **Rapport d'état financier** : modèle `etat_financier`, niveau `dossier` (lecture `dossier.lire`, décidé) ;
  commentaire IA du rapport **non branché**. Routes de groupe réservées à `dossier.lire` / `dossier.ecrire`, jamais
  ouvertes au portail.
- **Aussi livrés** : PRV-06 web (citations de livrable) ; `IMPORT_INVALIDE` converti en erreur applicative, liste
  des erreurs tronquée à 200 lignes (le message donne le total).

## Plans stratégiques et notation augmentés (NOT-12, PLA-15, PLA-16, PLA-18), lot 5a (2026-10-20)

Migrations `0425`, `0426`, `0429`, `0430`, `0431` (NOT-12 : aucune migration). Valeurs **provisoires, à valider**.

- **NOT-12, combinaisons minimales** : nombre minimal de pratiques améliorées, puis nombre minimal de paliers ;
  bornes `PRATIQUES_MAX_COMBINAISON` 8 et `NOEUDS_MAX_COMBINAISONS` 200 000 (vérifiées) ; 5 combinaisons par
  défaut (10 au plus) ; si une borne coupe la recherche : `tronquee`, jamais « impossible ». Commentaire IA en
  brouillon, validé par l'humain.
- **PLA-16, Monte-Carlo** : lois uniforme, triangulaire et normale tronquée (Irwin–Hall, déterministe) ; 100 à 2 000
  tirages (1 000 par défaut) ; probabilité de tension = part des tirages dont la trésorerie nette de clôture est
  négative au moins une année ; lois de départ proposées : croissance ±5 points, marge ±2 points, charges fixes
  −5 % / +10 %, délai clients 0 / +30 jours ; 30 simulations par utilisateur et par 10 minutes, 100 par plan ; le
  rejeu est limité depuis le lot 8b (5 par plan et par 10 minutes). La graine est tirée par l'API, jamais par le
  moteur.
- **PLA-15, ateliers en ligne** : vote par 10 points par défaut (1 à 100) ; Borda ; matrice valeur / effort de 1 à 5,
  seuil 3,00 ; ouverture exigeant 2 options et 1 participant ; 100 ateliers par plan, 50 options, 100 participants,
  20 versions de contribution par participant et méthode. Le dirigeant client ne voit que les ateliers ouverts où
  il est invité et sa propre contribution ; agrégats visibles du cabinet après clôture seulement, et seulement par méthode ayant au moins 3 contributeurs (lot 8b).
- **PLA-18, plan vivant** : répartition trimestrielle 25 / 25 / 25 / 25 par défaut ; méthodes `reste_du_plan` et
  `tendance` (facteur borné de 0,5 à 1,5) ; seuil « significatif » 10 % ; trésorerie re-prévue = projection
  simplifiée ; 40 re-prévisions par exercice, 50 versions de réalisé par trimestre, 1 000 par plan.

## Capitalisation (CAP-03, CAP-04) et veille des appels d'offres (AO-01), lot 5b (2026-10-20)

Migrations `0364` à `0367` (veille), `0466`, `0467` (efficacité) et `0470` à `0472` (observatoire). Valeurs **provisoires,
à valider**, sauf les points 10 et 11 du tableau « Décisions de l'utilisateur » (validés le 2026-10-21). Constantes
vérifiées dans le code.

- **CAP-03, efficacité des recommandations** : score = part de l'écart attendu (base vers cible) comblée à la date
  d'effet, **borné de 0 à 100** ; valeur de base = dernière mesure effective à la mise en œuvre ou avant, valeur d'effet
  = dernière mesure effective au moins 30 jours après. Écart attendu nul (ou contraire au sens du KPI) ou mesure
  manquante = **non évaluable** (score nul, raison explicite). Délai 30 jours et seuil 5 : voir le point 11 (décidés).
  Sous le seuil, le score d'un contexte n'est pas affiché et son effectif n'est pas servi.
- **CAP-04, observatoire** : **un seul indicateur**, `notation_score_global` (score ajusté de la dernière notation
  publiée de chaque client ; client sans taille écarté) ; **gel mensuel UTC** (seuls les versements d'un mois civil
  clos comptent, dernier versement de chaque cabinet ; une ré-adhésion n'est prise en compte qu'avec un nouveau
  versement) ; consultation par l'**associé et le directeur de mission** (`observatoire.lire`), **adhésion, retrait
  et versement par l'associé seul** (`observatoire.adherer`). Seuils 5 entreprises et 3 cabinets calculés hors du
  cabinet appelant : voir le point 10 (décidé). Arrondis : effectif à la tranche de 5, quartiles et répartition
  seulement à partir de 10 entreprises.
- **AO-01, veille** : complète la section « Appels d'offres : veille… » (saisie et import CSV manuels). Trois sources
  **simulées** (`sim_marches_publics`, `sim_bailleurs`, `sim_presse`), activables par cabinet et **désactivées par
  défaut**, aucun appel réseau ; collecte **déclenchée à la main**, sans job ; plafonds de **5 000 résultats** par
  cabinet (`MQA03`) et **500 occurrences** par résultat (`MQA04`) ; import de **1 Mo** et **200 avis**. Une source réelle
  exigera un ADR (SSRF, délai, clé).
- **Codes d'erreur** : `MQK01` à `MQK05` (efficacité), `MQK20` à `MQK27` (observatoire), `MQA01` à `MQA05` (veille).
- **Reste à faire** : NOT-14 (percentile) ; un second indicateur de l'observatoire.

## Services candidats : diagnostic flash et business plan bancable, lot 7 (2026-10-20)

Migrations `0560` à `0563`, SQLSTATE `MQV01` et `MQV02`. Décision n° 6 du PRD complémentaire : diagnostic flash, puis
business plan bancable. Principe : du **contenu de standard** (méthodes publiées par migration), du code seulement là
où une brique manquait. **Tout le contenu métier est provisoire, à valider par un expert** (`a_valider = true`),
sauf les points 12 à 14 du tableau « Décisions de l'utilisateur » (validés le 2026-10-21).

- **Activation** : `POST /services-candidats/activer` prend `{ service }`, **un service à la fois** (400 sans corps
  valide) ; elle sème aussi les grades manquants du catalogue. Prix : voir les points 12 et 13 ; montants des prix et
  bornes de guichets en **entiers en unité de la devise** (pas de centimes, y compris EUR et USD), différent de la
  convention « unités mineures » de `apps/web/src/lib/saisie.ts`.
- **Guichets de financement** : liste du cabinet, **vide par défaut**, plafond de **500 par cabinet** (`MQV02`,
  `PLAFOND_GUICHETS_ATTEINT`), pas de suppression (on désactive) ; `GET /guichets-financement` et le rapprochement
  renvoient `tronque` quand la liste est limitée. Rapprochement : moteur pur, **aucune conversion de devise** (devises
  différentes = critère « inconnu »), statuts compatible, partiel ou exclu, score de 0 à 100.
- **Méthodes du standard 0560 et 0561** : briques, temps types, classes de risque, niveaux d'autonomie, règles de
  modulation, rubriques et cas types du diagnostic flash (10 briques) et du business plan bancable (14 briques), ainsi
  que les types de mission et découpages de `apps/api/src/catalogue/services-candidats.ts` : **provisoires, à valider
  par un expert**.
- **Rapports** : le rapport court du flash réutilise le modèle EXISTANT « état d'avancement », le dossier bancaire le
  modèle `dossier_bancaire` ; `rapports_mission` n'est pas modifiée.
- **Briques sans moteur** : « bancabilité PLA-17 », « plan de financement » et « veille des guichets » n'ont pas de
  moteur référencé (aucun code correspondant dans `MOTEURS_STANDARD`) ; dette à reprendre par une nouvelle version de
  méthode quand les codes existeront.
- **Codes d'erreur** : `MQV01` (identité d'un guichet figée, `GUICHET_FIGE`), `MQV02` (plafond de guichets).

## Intégration continue (lot 8a, 2026-10-20)

Décisions d'outillage, à confirmer après la première exécution réelle : la CI GitHub (`.github/workflows/ci.yml`)
se déclenche sur les **pull requests vers `main`** et à la demande (`workflow_dispatch`), pas à chaque push ; le job
`api` est réparti en **4 partitions** (`--shard=i/4`, chacune sur son PostgreSQL jetable, ce qui respecte la règle
« jamais deux suites API sur la même base ») ; `retry: 1` des tests n'est actif que si `CI` est défini. **Jamais
exécutée sur GitHub à la livraison** ; déclarer les jobs `qualite` et `api` comme contrôles requis de `main` une
fois la première exécution verte (réglage hors dépôt, à faire par l'utilisateur).

## Rapport d'avancement hebdomadaire (AUT-10), cache IA, plafond par mission et contradicteur (AGT-06), lot 4c (2026-10-21)

Migrations `0278` et `0279` (AGT), `0306` à `0308` (AUT), SQLSTATE `MQI01`, `MQI50`, `MQU01` à `MQU05` et `MQU07`.
Les valeurs du premier tableau sont **provisoires, à valider** ; les droits, les choix et la décision du superviseur
ci-dessous sont **tranchés**. Source : `docs/workflows/notes-lots/lot-4c.md`, relue contre le code ; les valeurs
indiquées sont celles du code (aucun écart de valeur avec la note, un ajout relevé dans le code : les suggestions IA du
job).

### Valeurs provisoires (à valider)

| Sujet                             | Valeur du code                                                                                                                                                                                                                                                                                                                                  | Référence                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Cache des réponses IA             | **Désactivé par défaut** (`ia_parametres_cabinet.cache_actif`), durée de vie **24 h** (`DUREE_CACHE_IA_MS`, plafond imposé aussi en base par CHECK). Réglable par `ia.configurer` **sans reconfirmation d'identité** ; le désactiver vide les entrées du cabinet.                                                                                | `ia/cache.ts`, `routes/ia-parametres.ts`, migration `0278`                    |
| Job `avancement_hebdo`            | Planifié **du lundi au vendredi à 06:30 UTC** (`HEURE_AVANCEMENT_HEBDO_UTC`) ; une tâche par cabinet et par semaine, clé `avancement_hebdo:<lundi>` (elle s'exécute le premier jour ouvré où le cabinet est éligible), suites `avancement_hebdo:<lundi>:lot:<n>`. Missions concernées : **signées ou en cours**. Rien le week-end.                  | `automatisation/avancement-job.ts`, `jobs/planificateur.ts`, migration `0308` |
| Lots du job                       | **25 missions par lot** (`MISSIONS_PAR_LOT_AVANCEMENT`, curseur d'identifiant), **40 lots au plus par semaine** (`LOTS_MAX_AVANCEMENT`) ; au-delà, un incident est consigné et la génération manuelle reste possible. Une mission qui a déjà un rapport pour la semaine (brouillon, modifié ou validé) est **écartée avant tout calcul**.             | `automatisation/avancement-service.ts`, `avancement-job.ts`                   |
| Échec d'une mission               | Isolé par un point de sauvegarde, consigné **sans contenu** (code, contrainte, table, identifiants) ; la mission n'est pas retentée avant la semaine suivante.                                                                                                                                                                                  | `avancement-job.ts`                                                           |
| Paramètre cabinet `actif`         | **Activé par défaut** (`avancement_parametres.actif`, `DEFAULT true`) : la fonction ne crée que des **brouillons internes**, rien n'est visible du client avant validation. `envoi_email` est refusé par l'API (400) et par la base (`CHECK (envoi_email = false)`).                                                                           | migration `0306`                                                              |
| Suggestions IA du job             | Pour les brouillons créés par un lot, au plus **10 suggestions de commentaire** par exécution (`SUGGESTIONS_IA_PAR_LOT`) ; pour les autres, bouton manuel.                                                                                                                                                                                      | `avancement-job.ts`                                                           |
| Alertes de plafond IA de mission  | À **80 %** (`SEUIL_ALERTE_MISSION_PCT`) et **100 %** du plafond, **une fois par seuil et par valeur de plafond**, **aux associés**, sans montant, dans l'application seulement (type `ia_plafond_mission_alerte`).                                                                                                                              | `agents/plafonds.ts`, migration `0278`                                        |
| Brique `revue_contradictoire`     | Classe de risque **R1** ; niveaux proposés **N0 à N3** (l'agent est plafonné à N3 par le standard) ; niveau proposé par défaut **N2**. La brique **doit être déclarée** (`POST /api/agents/briques`), sinon 409 `BRIQUE_NON_DECLAREE`.                                                                                                          | `agents/autonomie/contradicteur-agent.ts` (web), `agents/erreurs.ts`          |
| Routage des modèles par tâche     | Table documentaire `ROUTAGE_TACHES` : rédaction et analyse = qualité, extraction (et vectorisation) = coût, classification = latence.                                                                                                                                                                                                           | `ia/modeles.ts`                                                               |

### Droits (tranchés)

- **Modifier, régénérer, valider, générer** un rapport d'avancement : droit `avancement.valider` **ET** être associé,
  directeur ou chef de **la** mission (mission visible, 404 sinon). Un rapport validé est figé (409 `RAPPORT_VALIDE`,
  doublé en base par `MQU01`). Seul un brouillon se modifie ; verrou optimiste par `version`.
- **Lire** : `avancement.lire` (associé, directeur de mission, chef de mission) + visibilité de la mission.
- **Paramètre du cabinet** (`GET/PUT /api/avancement/parametres`) : `automatisation.gerer`, droit existant.
- **Portail** : `portail.avancement.lire`, pour `client_dirigeant` et `client_contributeur` seulement (jamais
  l'investisseur ni un rôle interne). Un rapport n'est visible du client qu'**après validation**, pour **son** client
  et une mission partagée ; tout autre cas répond le même 404.
- **Plafond IA par mission** : `PUT /api/agents/missions/:id/plafond`, droit `ia.configurer`. Le montant consommé
  n'est visible qu'avec `finance.lire` (FIN-02).
- **Contre-analyse** : `ia.utiliser` + droits du registre (`mission.lire`, `preuve.lire`) + visibilité de la mission ;
  préparation du prompt : `agent.gerer`. Fermée au portail.

### Choix (tranchés)

- **Commentaire IA de l'avancement** : un **brouillon IA** (`statut_commentaire = brouillon_ia`), suggéré à la demande
  (`POST /api/avancement/:id/suggerer-commentaire`) ou par le job, **relu par le chef de mission** (réécrit ou
  effacé). Un brouillon IA non relu **bloque la validation** (409 `COMMENTAIRE_IA_A_RELIRE`). Il n'est **jamais
  visible du client**. Sans IA (désactivée, droit, clé, plafond, erreur, sortie rejetée), le commentaire reste vide et
  le job n'échoue pas. Les chiffres viennent du moteur (`composerAvancementHebdo`), jamais du modèle.
- **Routage par tâche** : `ROUTAGE_TACHES` est **documentaire** (exposé en lecture) ; il n'a **aucun effet** sur le
  modèle appliqué, qui reste celui de `modeleDe`.
- **Cache** : jamais pour le copilote, les entretiens, les transcriptions ni une variable portant un contenu de
  client ; il ne remplace que l'appel au fournisseur, **après** toutes les gardes (droit, IA active, coupe-circuit,
  réservation) ; la réponse servie repasse par la validation et la garde-chiffres et reste un brouillon IA. Issue
  « cache » à coût nul dans `ia_consommations`. **Marque** : champ calculé `servie_par_cache` de la vue de génération
  (aucune migration, le CHECK de `ia_generations.fournisseur` étant partagé).
- **Plafond par mission** : s'applique à tout appel IA rattaché à une mission (préparation puis exécution, donc aussi
  le job `ia_generation`) ; hors champ : copilote (sans mission) et évaluations. Dépassement borné par le coût
  estimé du dernier appel admis. Plafond atteint = refus (jamais de revue vide en mode dégradé).
- **Contradicteur** : revue **sur demande seulement** (route dédiée ; une automatisation ne peut pas la déclencher,
  409 `AGENT_SUR_DEMANDE_SEULEMENT`), **brouillon IA non bloquant**, une seule revue active par brouillon (409
  `REVUE_DEJA_ACTIVE`), brouillon relu jamais modifié, aucun chiffre de son cru. Bouton « Demander une
  contre-analyse » du panneau de contenu IA.
- **Livrables du rapport** : documents de type `livrable`, hors brouillon IA non validé ; un livrable **non partagé**
  n'est qu'un **nombre** côté cabinet et n'apparaît pas côté client.
- **Projection portail** : `projeterContenuAvancementPortail` (liste blanche) sans `non_partages` ; `livrables.total`
  = livrables partagés. Aucune donnée financière (FIN-02), ni budget en jours, ni temps par personne. Aucun e-mail :
  le chef de mission (à défaut le directeur) reçoit une notification interne `avancement_brouillon`.

### Décision du superviseur (provisoire)

- **Pas de PDF ni de DOCX du rapport d'avancement hebdomadaire pour l'instant : consultation web seule** (cabinet et
  portail). Décision du superviseur, **provisoire** : le rendu toucherait `rapports/*.ts`, hors du lot. C'est une
  exception à la ligne « Rapports : HTML rendu en PDF par Chromium headless ; DOCX via `docx` » des décisions
  techniques ci-dessus, qui reste vraie pour les autres rapports (`rapports_mission` n'est pas modifiée).

### Points à signaler

- **Plafond par mission** : aucun écran du web ne le règle (aucune référence à `agents/missions` dans `apps/web/src`) ;
  il se règle par l'API seulement. À confirmer.
- **Interface non vérifiée dans un navigateur** (note du lot).

## Dettes transverses : voyant rouge du brief, revue à froid, rejeu Monte-Carlo, seuil des ateliers, lot 8b (2026-10-21)

Migrations `0290` (SQLSTATE `MQQ13`) et `0432`. Le lot 8c (découpage de 34 fichiers web en modules de moins de 400
lignes, mêmes exports) ne change aucun comportement et n'appelle aucune décision. Source :
`docs/workflows/notes-lots/lot-8b.md`, relue contre le code. Les valeurs ci-dessous sont **provisoires, à valider**.

### Valeurs provisoires (à valider)

| Sujet                                | Valeur du code                                                                                                                                                                                                                                                       | Référence                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Seuil d'agrégats d'un atelier        | **3 contributeurs, PAR MÉTHODE** (`SEUIL_PARTICIPANTS_AGREGATS`), comptés parmi les participants AYANT contribué, valeur figée à la clôture. Une méthode sous le seuil est masquée (`masque_seuil`) ; la synthèse IA ne cite que les méthodes publiées (409 sinon).    | `plans/ateliers-resultats.ts`                              |
| Rejeu de Monte-Carlo                 | **5 rejeux par plan et par 10 minutes, tous utilisateurs confondus** (429 `TROP_DE_REJEUX`, table `plan_rejeux_montecarlo`). Un seul utilisateur peut donc épuiser le plafond ; la variante « par plan et par utilisateur » reste ouverte. Décision du superviseur. | `plans/montecarlo.ts`, migration `0432`                    |
| Évaluations du voyant dans le brief  | **20 dossiers évalués au plus par requête** (`PLAFOND_EVALUATIONS_VOYANT`), 50 lus au plus (`PLAFOND_DOSSIERS_VOYANT`) ; au-delà, la famille est marquée tronquée.                                                                                                   | `brief/derives.ts`                                         |
| Dossiers de redressement clos        | **Exclus du brief** par prudence (dossier clos ou mission clôturée) ; à confirmer.                                                                                                                                                                                   | `brief/derives.ts`                                         |
| Candidats d'un atelier               | Plafonds déclarés 500 lus et 200 retenus (cabinet), 200 dirigeants du client (`CANDIDATS_*_MAX`) ; au-delà, `tronque: true`, sans pagination (le filtrage par droits suit le SQL).                                                                                  | `plans/ateliers.ts`                                        |
| Pages de `mes-revues`                | **50 par défaut, 100 au plus**, pagination par curseur (keyset).                                                                                                                                                                                                       | `routes/qualite-froide.ts`, `schemas/qualite.ts`           |
| Pages de liste du web                | Dix pages de liste (dont missions, pipeline, facturation, charge) lisent jusqu'à 500 par page (`LIMITE_PAGE_MAX`) au lieu de 200.                                                                                                                                    | `apps/web/src/lib/pagination.ts`                           |

### Choix (tranchés)

- **Voyant rouge dans le brief** : un type `voyant_rouge` (famille « Ça dérive »), derrière `redressement.lire` et la
  visibilité de la mission ; seul le **rouge** produit un élément (gravité haute), avec les seuls motifs critiques
  (5 au plus, 200 caractères), **sans aucun montant ni devise** même avec `finance.lire` (FIN-02). Un dossier
  défaillant est isolé : ignoré, source marquée interrompue, les autres dossiers servis (jamais un 500).
- **Réaffectation d'un relecteur** : interdite quand la revue est `en_revue` (409 `REAFFECTATION_EN_REVUE`, doublé
  en base par `MQQ13`).
- **Dates de saisie de temps** : toutes bornées de 2000 à 2100 (400 du schéma, jamais 500 de la base).
- **Lien « Proposer un diagnostic flash »** : sur la fiche d'un client **actif**, pour qui a `catalogue.lire`
  (`cheminDiagnosticFlash`) ; la page cible est celle des services candidats (lot 7).

### Points à signaler

- `RapportEtatFinancier.tsx` lit une seule page (500) de `/api/missions?client_id=…` sans suivre le curseur
  (dossier, hors périmètre du lot).
- L'automatisation correspondant au voyant rouge n'est pas branchée.
