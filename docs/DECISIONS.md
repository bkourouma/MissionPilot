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
