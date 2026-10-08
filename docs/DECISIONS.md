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
