# PRD — MissionPilot, logiciel de gestion des cabinets d'expertise augmenté par l'IA

Oct 6, 2026 · @DevAccrocs

## Résumé et contexte

MissionPilot est le logiciel de gestion des cabinets de conseil, d'audit et d'expertise d'Afrique francophone. Il gère chaque mission de la proposition à la clôture (découpage, affectations, jours budgétés et réalisés, budget, facturation) et outille les consultants de cinq services de conseil augmentés par l'IA.

**Problème.** Un cabinet vit de la rentabilité de ses missions. Sans suivi des jours budgétés et réalisés, un dépassement ne se voit qu'à la facturation, quand il est trop tard pour agir. Côté production, diagnostics et plans stratégiques restent longs à produire, et rien ne relie le plan remis au client à son exécution.

**Vision.** Le système de gestion du cabinet d'expertise africain : vendre, produire, piloter et facturer ses missions sur une seule plateforme, avec l'IA comme collaborateur.

**Deux piliers.**

- **Gestion du cabinet**, utilisée chaque jour par tous les collaborateurs : types de missions, découpage, planification, affectations, temps, budget, facturation, rentabilité.
- **Conseil augmenté par l'IA**, utilisé dans les missions : notation, due diligence, planification stratégique, pilotage KPI, redressement. L'IA produit environ 60 % du travail, les consultants les 40 % restants.

**Principe produit.** L'IA propose, l'expert dispose. Aucun contenu IA n'atteint le client sans validation d'un consultant, et tous les chiffres (jours, montants, marges, scores, états financiers) sortent d'un moteur de calcul, jamais du modèle de langage.

**Base et cadre.** Produit propre ACC, qui peut en être le premier cabinet utilisateur. Les services de conseil reprennent le cahier fonctionnel « Plateforme SANKORIA — Prototype des 5 services IA-Consulting » (version du 01/10/2025).

## Objectifs et indicateurs de succès

À 12 mois du lancement, MissionPilot doit prouver deux choses : les cabinets l'utilisent chaque semaine pour piloter leurs missions, et l'IA fait réellement l'essentiel du travail de conseil. Les cibles sont des propositions à valider au cadrage.

| Objectif | Indicateur | Cible proposée |
| --- | --- | --- |
| Usage hebdomadaire du cabinet | Feuilles de temps soumises dans les délais | ≥ 90 % |
| Détecter les dérives tôt | Dépassements de budget signalés avant la mi-parcours de la mission | ≥ 80 % des dépassements |
| Améliorer la précision budgétaire | Écart moyen entre jours budgétés et réalisés à la clôture | ≤ 10 % |
| Facturer plus vite | Délai entre jalon atteint et facture émise | ≤ 3 jours ouvrés |
| Raccourcir les missions de conseil | Délai entre fin de collecte et rapport de notation | ≤ 5 jours ouvrés |
| Raccourcir les missions de conseil | Durée d'élaboration d'un plan stratégique avec modèle financier | ≤ 4 semaines |
| Tenir la promesse 60/40 | Contenus IA validés par l'expert sans réécriture majeure | ≥ 60 % |
| Traction | Cabinets clients actifs | 15 |
| Traction | Utilisateurs payants dans ces cabinets | 300 |
| Satisfaction | NPS des associés de cabinets | ≥ 40 |
| Maîtriser le coût IA | Coût API IA d'une mission rapporté à son prix | ≤ 5 % |

## Utilisateurs cibles et personas

Le cabinet est le client payant : ses collaborateurs utilisent MissionPilot chaque jour. Ses propres clients y accèdent par un portail, et les investisseurs y commandent des due diligences.

**Côté cabinet**

| Rôle | Qui | Besoin clé | Modules principaux |
| --- | --- | --- | --- |
| Associé | Associé gérant, DG du cabinet | Voir rentabilité, carnet de commandes et charge du cabinet ; valider propositions et budgets | Tableaux de bord cabinet, propositions |
| Directeur de mission | Associé ou manager senior responsable | Signer la lettre de mission, garantir qualité et marge, valider factures et révisions de budget | Fiche mission, budget, facturation, revue des livrables IA |
| Chef de mission | Manager | Découper la mission, affecter l'équipe, valider les temps, suivre reste à faire et atterrissage | Planification, affectations, temps, budget |
| Consultant | Junior, senior, expert | Savoir quoi faire cette semaine, saisir ses temps en une minute, produire ses livrables avec l'IA | Mon planning, feuille de temps, services IA |
| Responsable des ressources | Associé ou responsable du staffing | Arbitrer les affectations entre missions, éviter surcharge et sous-occupation | Plan de charge, compétences, congés |
| Gestionnaire administratif et financier | DAF ou comptable du cabinet | Facturer, suivre débours et encaissements, exporter vers la comptabilité | Facturation, encaissements, exports |
| Expert métier | Spécialiste sectoriel du cabinet | Enrichir référentiels, grilles, modèles de missions et benchmarks | Catalogue, base de connaissances |
| Expert externe | Sous-traitant, consultant associé | Saisir temps et livrables sur ses seules missions | Feuille de temps, livrables |

**Côté clients et partenaires**

| Rôle | Qui | Besoin clé | Modules principaux |
| --- | --- | --- | --- |
| Dirigeant client | DG d'une PME ou ETI accompagnée | Suivre l'avancement, valider les jalons, consulter rapports et tableaux de bord | Portail client, services #1, #3, #4, #5 |
| Contributeur client | DAF, chefs de service du client | Répondre aux questionnaires, saisir les KPI de son entreprise | Questionnaires, service #4 |
| Investisseur | Fonds, banque, bailleur | Commander une due diligence, lire une notation | Services #2 et #1 (lecture) |
| Administrateur ACC | Équipe produit ACC | Gérer cabinets abonnés, offres, facturation et coûts IA | Console admin |

## Périmètre

Le MVP livre la gestion de mission : c'est elle que le cabinet utilise chaque jour et paie chaque mois. Les services de conseil IA s'y branchent ensuite comme types de missions, en s'appuyant sur l'historique de temps et de budgets accumulé.

| Version | Contenu | Pourquoi à ce moment |
| --- | --- | --- |
| V1 (MVP) | Socle ; gestion du cabinet : catalogue et missions, découpage, affectations, plan de charge, feuilles de temps, budget en jours et en FCFA, facturation simple, indicateurs du cabinet | Valeur immédiate pour tout cabinet, sans dépendre de l'IA ni de données externes |
| V2 | Services #1 Notation, #3 Planification et #4 Pilotage KPI (saisie manuelle) ; portail client ; facturation avancée et encaissements Mobile Money ; estimations et affectations suggérées par l'IA | Les services IA s'appuient sur les missions et l'historique de la V1 |
| V3 | Services #5 Redressement et #2 Due diligence ; #4 avancé (connecteurs, IA prédictive) ; connecteurs comptables ; marque blanche ; multi-pays | Réutilisent les briques V2 et dépendent de données externes coûteuses à intégrer |

**Hors périmètre** (MissionPilot s'y connecte, sans les remplacer) :

- Comptabilité générale, paie et RH : MissionPilot produit factures et écritures exportables ; les coûts journaliers sont saisis, pas calculés depuis la paie.
- Gestion de projet complète type MS Project : découpage, Gantt simple et dépendances suffisent.
- CRM commercial complet : MissionPilot suit opportunités et propositions, sans automatisation marketing.
- Visioconférence native : les entretiens passent par des liens Meet, Zoom ou Teams.
- Conseil juridique et fiscal, valorisation d'entreprise.

## Structure d'une mission

Une mission se découpe en phases, lots et tâches ; la tâche est l'unité où se rejoignent budget, affectation et temps réalisé.

&#91;embedded content: structure d'une mission · 10 objets\]

Le budget est porté par la tâche et agrégé vers le haut. Un temps est toujours saisi sur une tâche affectée ou sur une activité interne : chaque jour reste traçable jusqu'à la mission et au client.

## Cycle de vie d'une mission

Une mission passe de l'opportunité à la clôture en sept étapes ; le budget signé ne change jamais en silence.

&#91;embedded content: cycle de vie d'une mission · 2 décisions, 1 boucle de révision\]

Le budget initial est figé à la signature ; chaque révision crée une nouvelle version validée par le directeur de mission. La clôture produit le bilan de rentabilité et verse un retour d'expérience dans la base de connaissances.

## Exigences fonctionnelles — socle et gestion du cabinet

Chaque exigence porte un identifiant stable (repris dans le backlog et les tests), une priorité MoSCoW et sa version cible. Le socle sert les deux piliers ; les quatre familles suivantes (MIS, PLN, TPS, FIN) forment la gestion du cabinet.

### Socle commun

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| SOC-01 | Multi-cabinet : chaque cabinet est une organisation isolée ; ses clients, missions et collaborateurs lui appartiennent | Indispensable | V1 |
| SOC-02 | Rôles et droits fins (associé, directeur et chef de mission, consultant, ressources, gestionnaire, expert externe, client), invitation par e-mail, double authentification | Indispensable | V1 |
| SOC-03 | Fiches clients : identité légale (RCCM, compte contribuable), secteur, pays, taille, contacts ; profil réutilisé par tous les services | Indispensable | V1 |
| SOC-04 | Calendrier : jours fériés par pays, semaine de travail et durée d'une journée paramétrables | Indispensable | V1 |
| SOC-05 | Gestion documentaire de mission : propositions, lettres de mission, livrables, versions | Indispensable | V1 |
| SOC-06 | Traçabilité : statut des contenus IA (brouillon IA, modifié, validé), auteur, historique des versions, journal d'audit | Indispensable | V1 |
| SOC-07 | Moteur de rapports et documents : PDF et web à la charte du cabinet, export DOCX et PPTX | Indispensable | V1 |
| SOC-08 | Collaboration : commentaires contextuels, tâches assignées, notifications in-app et e-mail | Indispensable | V1 |
| SOC-09 | Portail client : accès restreint aux missions, jalons, livrables et factures de son entreprise | Important | V2 |
| SOC-10 | Moteur de questionnaires : échelles de Likert, choix, texte, numérique, logique conditionnelle, modes individuel et collectif, sauvegarde automatique | Indispensable | V2 |
| SOC-11 | Génération IA de questionnaires adaptés au secteur, au pays, à la taille et à la maturité, relus par un consultant avant envoi | Indispensable | V2 |
| SOC-12 | Base de connaissances : référentiels, benchmarks, études de cas, retours d'expérience des missions clôturées ; recherche sémantique avec sources citées | Indispensable | V2 |
| SOC-13 | Notes terrain : texte, checklist d'audit et photos saisis par le consultant, rattachés à une dimension évaluée | Indispensable | V2 |
| SOC-14 | Entretiens : planification, guide de questions généré par l'IA, compte rendu et synthèse IA | Important | V2 |
| SOC-15 | Transcription automatique des entretiens enregistrés | Souhaitable | V3 |
| SOC-16 | Abonnement MissionPilot : offres, licences par utilisateur, paiement Mobile Money et carte | Important | V2 |
| SOC-17 | Marque blanche cabinet : logo, couleurs, nom de domaine | Souhaitable | V3 |

### Catalogue des types de missions et fiche mission (MIS)

Chaque mission naît d'un type du catalogue, qui pré-remplit son découpage, ses jours types et ses outils IA. Les cinq services de conseil sont des types livrés en standard ; chaque cabinet ajoute les siens.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| MIS-01 | Catalogue paramétrable des types de missions (ex. plan stratégique, audit organisationnel, assistance comptable, formation) : domaine, mode de facturation, durée et équipe types | Indispensable | V1 |
| MIS-02 | Modèle par type : phases, lots, tâches, livrables et jours types par grade ; créer une mission depuis un type pré-remplit son découpage et son budget | Indispensable | V1 |
| MIS-03 | Les cinq services de conseil IA livrés comme types standard, avec leurs outils IA rattachés aux phases | Indispensable | V2 |
| MIS-04 | Pipeline commercial : opportunités, probabilité, montant estimé, motif de perte | Important | V1 |
| MIS-05 | Proposition technique et financière générée depuis le type (équipe, jours par grade, prix), validée par un associé | Indispensable | V1 |
| MIS-06 | Estimation IA des jours à partir des missions similaires clôturées, avec fourchette et missions de référence citées | Important | V2 |
| MIS-07 | Lettre de mission générée depuis un modèle ; budget initial figé à la signature | Indispensable | V1 |
| MIS-08 | Signature électronique de la lettre de mission | Souhaitable | V3 |
| MIS-09 | Fiche mission : client, type, directeur et chef de mission, dates, devise, mode de facturation, statut, documents | Indispensable | V1 |
| MIS-10 | Modes de facturation : forfait, régie au temps passé, forfait avec part variable, abonnement | Indispensable | V1 |
| MIS-11 | Missions récurrentes (ex. assistance mensuelle) : génération automatique des périodes, budgets et factures | Important | V2 |
| MIS-12 | Axes analytiques (activité, secteur, bureau) ; duplication d'une mission et enregistrement en modèle | Important | V1 |

### Découpage, planification et affectations (PLN)

Le chef de mission découpe la mission, budgète chaque tâche en jours et affecte l'équipe. Le plan de charge montre à tout moment qui est disponible, surchargé ou sous-occupé dans le cabinet.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| PLN-01 | Découpage hiérarchique : phases, lots ou livrables, tâches (3 niveaux), jalons ; réorganisation par glisser-déposer | Indispensable | V1 |
| PLN-02 | Budget en jours par tâche, par grade ou par personne ; agrégation automatique aux niveaux supérieurs | Indispensable | V1 |
| PLN-03 | Planning Gantt de la mission : dates, jalons, dépendances simples, recalage automatique | Indispensable | V1 |
| PLN-04 | Affectation nominative (personne, tâche, jours alloués, période) ou à un profil à pourvoir (grade, compétence) | Indispensable | V1 |
| PLN-05 | Référentiel des collaborateurs : grade, compétences, secteurs, langues, capacité, taux de vente et coût journalier | Indispensable | V1 |
| PLN-06 | Plan de charge du cabinet : collaborateurs × semaines, jours affectés face à la capacité (congés, jours fériés, temps partiel), surcharges signalées | Indispensable | V1 |
| PLN-07 | Congés et absences avec circuit de validation, déduits de la capacité | Indispensable | V1 |
| PLN-08 | Experts externes et sous-traitants affectables, avec leur coût d'achat | Important | V1 |
| PLN-09 | Re-planification : décaler une phase recale les affectations et prévient les personnes concernées | Important | V1 |
| PLN-10 | Vue « Mon planning » du consultant : missions, tâches et jours alloués de la semaine | Indispensable | V1 |
| PLN-11 | Suggestions IA d'affectation selon compétences, disponibilités et missions similaires, validées par le chef de mission | Important | V2 |
| PLN-12 | Simulation de staffing : impact d'une nouvelle mission sur le plan de charge avant signature | Souhaitable | V2 |

### Volumes journaliers budgétés et réalisés (TPS)

L'unité est le jour-homme, saisi par pas de 0,5 jour ou en heures converties (durée d'une journée paramétrable). Chaque semaine, le consultant déclare son réalisé et son reste à faire ; MissionPilot en déduit l'atterrissage de chaque tâche, phase et mission.

```latex
\text{Atterrissage} = \text{Réalisé} + \text{Reste à faire} \qquad \text{Écart} = \text{Atterrissage} - \text{Budget}
```

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| TPS-01 | Feuille de temps hebdomadaire par tâche affectée, en jours ou en heures, pré-remplie depuis les affectations | Indispensable | V1 |
| TPS-02 | Activités internes non facturables : formation, prospection, administration, congés | Indispensable | V1 |
| TPS-03 | Circuit de validation : soumission par le consultant, validation ou rejet motivé par le chef de mission, verrouillage | Indispensable | V1 |
| TPS-04 | Saisie sur téléphone, rappel automatique en fin de semaine, relance des feuilles incomplètes | Indispensable | V1 |
| TPS-05 | Reste à faire déclaré par tâche chaque semaine ; atterrissage et écart calculés automatiquement | Indispensable | V1 |
| TPS-06 | Tableau budgété / réalisé / reste à faire / atterrissage par tâche, phase, mission, personne et grade, avec seuils de couleur | Indispensable | V1 |
| TPS-07 | Alertes au chef et au directeur de mission : consommation au-delà d'un seuil (ex. 80 %) ou atterrissage supérieur au budget | Indispensable | V1 |
| TPS-08 | Avancement physique (livrables, jalons) comparé au consommé : indicateur de performance de la mission | Important | V1 |
| TPS-09 | Clôture mensuelle des temps : période verrouillée, corrections tracées et validées | Indispensable | V1 |
| TPS-10 | Import Excel des temps pour la reprise de l'historique | Important | V1 |
| TPS-11 | Contrôles IA : temps sur tâche non affectée, journée au-delà de la capacité, saisies tardives ; synthèse hebdomadaire au chef de mission | Important | V2 |
| TPS-12 | Chronomètre et saisie depuis l'agenda (Google, Outlook) | Souhaitable | V3 |

**Exemple fictif** — écran de suivi d'une mission « Audit organisationnel » à la fin de la semaine 6 (jours-homme) :

| Phase | Budget | Réalisé | Reste à faire | Atterrissage | Écart |
| --- | --- | --- | --- | --- | --- |
| Diagnostic | 12 | 13,5 | 0 | 13,5 | +1,5 |
| Analyse des processus | 8 | 7 | 1 | 8 | 0 |
| Recommandations | 15 | 6 | 10 | 16 | +1 |
| Plan de transformation | 10 | 0 | 10 | 10 | 0 |
| Validation et restitution | 5 | 0 | 5 | 5 | 0 |
| **Total mission** | **50** | **26,5** | **26** | **52,5** | **+2,5 (+5 %)** |

Le dépassement de 2,5 jours est visible dès la semaine 6, à mi-parcours : le chef de mission peut réallouer ou demander une révision du budget avant qu'il ne soit consommé.

### Budget, facturation et rentabilité (FIN)

Le budget de mission est double : en jours (production) et en FCFA (honoraires, coûts, débours). Le moteur budgétaire recalcule marge et atterrissage financier à chaque temps validé.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| FIN-01 | Budget de mission : honoraires (jours × taux de vente par grade, ou forfait), coûts internes (jours × coût journalier), débours et sous-traitance prévus | Indispensable | V1 |
| FIN-02 | Grilles de taux : taux de vente par grade et taux négociés par client ; coût journalier chargé par collaborateur, visible des seuls associés et gestionnaires | Indispensable | V1 |
| FIN-03 | Versions de budget : initial (signé), révisé (validé par le directeur de mission, avenant client), atterrissage ; historique et motifs | Indispensable | V1 |
| FIN-04 | Devises FCFA (XOF, XAF), EUR, USD ; taux de change figé à la signature | Important | V1 |
| FIN-05 | Débours et notes de frais : saisie avec justificatif photo, refacturables ou non, validation | Indispensable | V1 |
| FIN-06 | Échéancier de facturation : acomptes, jalons, pourcentage d'avancement, régie sur temps validés | Indispensable | V1 |
| FIN-07 | Factures : numérotation continue, TVA et retenues paramétrables, mentions légales du cabinet ; PDF envoyé par e-mail | Indispensable | V1 |
| FIN-08 | Conformité à la facture normalisée électronique de la DGI ivoirienne, si elle s'applique aux cabinets clients | Important | V2 |
| FIN-09 | Suivi des encaissements (virement, chèque, espèces, Mobile Money), relances automatiques, balance âgée clients | Indispensable | V1 |
| FIN-10 | Paiement en ligne des factures par Mobile Money et carte | Important | V2 |
| FIN-11 | Encours de production : valeur des temps réalisés non facturés, et facturé d'avance | Indispensable | V1 |
| FIN-12 | Rentabilité par mission, client, type et associé : honoraires, coûts, débours, marge en FCFA et en %, budget, réalisé et atterrissage | Indispensable | V1 |
| FIN-13 | Export comptable des factures et encaissements (écritures SYSCOHADA, format paramétrable) | Important | V1 |
| FIN-14 | Connecteurs directs aux logiciels comptables du marché | Souhaitable | V3 |
| FIN-15 | Seuils d'approbation : factures, remises et révisions de budget validées selon leur montant | Important | V1 |
| FIN-16 | IA : alerte de dérive de marge et commentaire de rentabilité à la clôture | Important | V2 |

## Exigences fonctionnelles — services de conseil IA

Les cinq services de conseil sont des types de missions standard du catalogue (MIS-03) : chaque mission de conseil se découpe, se staffe et se suit comme les autres, et ses phases embarquent les outils IA décrits ci-dessous. Ils arrivent en V2 (#1, #3, #4) et en V3 (#2, #5).

&#91;embedded content: les cinq services et leurs enchaînements\]

Une entreprise entre par la notation, un investisseur par la due diligence. Le pilotage déclenche le redressement quand un indicateur vire au rouge, et la notation de sortie mesure le chemin parcouru.

### Service 1 — Notation de la compétitivité et de l'excellence opérationnelle

Une « notation financière » de la maturité stratégique et opérationnelle, alimentée par trois sources croisées : questionnaires, entretiens, observations terrain.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| NOT-01 | Grille paramétrable : 6 piliers d'excellence opérationnelle (stratégie déployée, processus, pilotage, amélioration continue, organisation, engagement) et facteurs de compétitivité (qualité, coûts, innovation, positionnement), pondérés par secteur | Indispensable | V2 |
| NOT-02 | Questionnaire préliminaire des dirigeants : style de management, culture, appétence au changement | Indispensable | V2 |
| NOT-03 | Scoring déterministe : note par dimension et note globale calculées depuis la grille | Indispensable | V2 |
| NOT-04 | Ajustement du score par les notes terrain et les entretiens, motivé et tracé par le consultant | Indispensable | V2 |
| NOT-05 | Détection IA des réponses incohérentes ou préoccupantes (ex. aucune vision formalisée) et des écarts entre répondants | Important | V2 |
| NOT-06 | Comparaison aux moyennes du secteur et du pays | Important | V3 |
| NOT-07 | Rapport de notation : radar de maturité, barres par pilier, forces et faiblesses, plan d'action recommandé ; revue expert obligatoire avant publication | Indispensable | V2 |
| NOT-08 | Notation de sortie avec comparaison avant/après, partageable avec banques et investisseurs | Important | V3 |

### Service 2 — Due diligence stratégique et chaîne de valeur

Une étude d'un secteur ou d'une cible avant investissement en Afrique francophone : marché, chaîne de valeur locale, risques, recommandation.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| DD-01 | Cadrage : secteur, pays, cible éventuelle, type d'opération (acquisition, entrée de marché, partenariat) | Indispensable | V3 |
| DD-02 | Connecteurs de données ouvertes (Banque mondiale, FMI, ONUDI) et import de rapports PDF avec extraction IA des chiffres, source citée | Indispensable | V3 |
| DD-03 | Analyses PESTEL, 5 forces de Porter et SWOT pré-remplies par l'IA, chaque affirmation sourcée | Indispensable | V3 |
| DD-04 | Carte interactive de la chaîne de valeur : étapes, acteurs, part de coût ou de marge, contraintes ; un clic sur une étape affiche ses risques | Indispensable | V3 |
| DD-05 | Due diligence opérationnelle de la cible : processus, approvisionnement, goulots d'étranglement | Important | V3 |
| DD-06 | Checklist de risques (pays, change, opérationnel, réglementaire) avec niveau et justification | Indispensable | V3 |
| DD-07 | Modèles d'analyse par secteur (agro-industrie, numérique, industrie, services) | Important | V3 |
| DD-08 | Ajustements des experts tracés et repris dans le rapport ; rapport en synthèse exécutive ou en version détaillée | Indispensable | V3 |

### Service 3 — Planification stratégique, plan opérationnel et modélisation financière

Le service phare du conseil : l'IA joue le PMO virtuel et l'analyste financier, le consultant valide les choix. Livrable : un schéma directeur chiffré, prêt à exécuter.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| PLA-01 | Parcours guidé en 8 étapes (diagnostic, SWOT, vision et mission, objectifs, axes, initiatives, finances, validation), avec retour libre à toute étape | Indispensable | V2 |
| PLA-02 | SWOT pré-rempli par l'IA depuis la notation (#1) ou un questionnaire de direction ciblé, complété par la veille | Indispensable | V2 |
| PLA-03 | Objectifs SMART répartis sur les 4 perspectives du tableau de bord prospectif (finances, clients, processus, apprentissage) ; option OKR | Indispensable | V2 |
| PLA-04 | Suggestions IA d'initiatives par axe : objectif, ressources, durée, indicateurs, justification sourcée ; accepter, modifier ou ajouter | Indispensable | V2 |
| PLA-05 | Roadmap interactive par trimestre ou semestre : porteurs, dépendances simples, recalage automatique | Indispensable | V2 |
| PLA-06 | Modèle financier sur 3 à 5 ans : hypothèses pré-remplies depuis l'historique, compte de résultat, tableau de trésorerie et bilan au format SYSCOHADA révisé | Indispensable | V2 |
| PLA-07 | Scénarios base, optimiste et pessimiste ; ROI par initiative, point mort, VAN, amortissements | Indispensable | V2 |
| PLA-08 | Contrôles de vraisemblance des hypothèses (ex. marge improbable) et commentaire IA des résultats | Important | V2 |
| PLA-09 | Recalcul instantané à chaque changement d'hypothèse et historique des versions du plan | Indispensable | V2 |
| PLA-10 | Création automatique, dans le module #4, de chaque KPI rattaché à un objectif | Indispensable | V2 |
| PLA-11 | Export du plan stratégique intégré : vision, objectifs, roadmap, synthèse financière (PDF, DOCX, PPTX) | Indispensable | V2 |

### Service 4 — Tableaux de bord et pilotage des KPI

Le cockpit qui garde le lien entre le plan et son exécution : l'IA y joue le contrôleur de gestion virtuel. En V2, saisie manuelle ; les connecteurs viennent en V3.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| KPI-01 | Bibliothèque de KPI par secteur et fonction (définition, formule, source, fréquence), personnalisable ; création de KPI propres | Indispensable | V2 |
| KPI-02 | Saisie manuelle périodique avec rappels, import Excel/CSV, contrôle IA des valeurs aberrantes | Indispensable | V2 |
| KPI-03 | Tableau de bord exécutif sur 4 perspectives, statut vert/orange/rouge, détail par période et par unité | Indispensable | V2 |
| KPI-04 | Alertes par seuil configurables (haut, bas, % de variation), notification in-app et e-mail | Indispensable | V2 |
| KPI-05 | Rapport de performance périodique commenté par l'IA, avec commentaires et plans d'action des managers | Important | V2 |
| KPI-06 | Alertes par SMS et WhatsApp | Important | V2 |
| KPI-07 | Connecteurs ERP, CRM, logiciels comptables et Google Analytics (API) | Important | V3 |
| KPI-08 | IA prédictive : tendance, anomalies, corrélations entre indicateurs, seuils auto-apprenants | Important | V3 |
| KPI-09 | Simulations « et si » branchées sur le modèle financier | Souhaitable | V3 |
| KPI-10 | Bouton « mission flash » : un KPI au rouge propose un diagnostic express avec un consultant | Important | V2 |
| KPI-11 | Indicateurs externes (taux de change, matières premières, indices) via API | Souhaitable | V3 |
| KPI-12 | Assistant conversationnel sur les KPI, texte puis voix | Souhaitable | V3 |

### Service 5 — Redressement, restructuration et mise à niveau

Inspiré des programmes de mise à niveau de l'ONUDI : un pré-diagnostic rapide, un diagnostic stratégique global, un plan de redressement, puis une mise en œuvre suivie de près.

| ID | Exigence | Priorité | Version |
| --- | --- | --- | --- |
| RED-01 | Module « Alerte entreprise en difficulté » : questionnaire d'urgence en moins de 15 minutes, voyants vert/orange/rouge par domaine | Indispensable | V3 |
| RED-02 | Import des états financiers (Excel ou logiciel comptable) et calcul des ratios clés : liquidité, solvabilité, marge brute | Indispensable | V3 |
| RED-03 | Diagnostic 360° par check-lists métier activables et personnalisables (industrie, services, commerce) | Indispensable | V3 |
| RED-04 | Cartographie IA des causes racines (ex. marges en chute + concurrents low-cost = problème de prix) | Important | V3 |
| RED-05 | Plan en deux volets : quick wins à 3–6 mois, restructuration et mise à niveau à 6–24 mois, avec échéancier | Indispensable | V3 |
| RED-06 | Trésorerie prévisionnelle hebdomadaire et mensuelle, point mort, covenants bancaires, plan de financement | Indispensable | V3 |
| RED-07 | Kanban des actions, partage de documents, comptes rendus des points d'étape, alertes de jalons | Indispensable | V3 |
| RED-08 | Évaluation finale par re-notation (#1) et rapport de clôture chiffré | Indispensable | V3 |
| RED-09 | Suivi post-mission : accès limité et relances automatiques à 6 et 12 mois | Important | V3 |

## Indicateurs de pilotage du cabinet

Ces indicateurs alimentent le tableau de bord de l'associé dès la V1. Le moteur budgétaire les calcule à partir des temps validés, des budgets et des factures ; les mêmes composants de tableau de bord serviront ensuite au service #4 pour les clients du cabinet.

| Indicateur | Définition | Niveau de lecture | Fréquence |
| --- | --- | --- | --- |
| Taux d'occupation | Jours affectés / jours disponibles | Collaborateur, grade, cabinet | Hebdomadaire |
| Taux de facturabilité | Jours facturables réalisés / jours disponibles | Collaborateur, grade, cabinet | Mensuelle |
| Consommation budgétaire | Jours réalisés / jours budgétés | Tâche, phase, mission | Hebdomadaire |
| Écart à terminaison | Atterrissage − budget, en jours et en FCFA | Mission, portefeuille d'un directeur | Hebdomadaire |
| Marge de mission | (Honoraires − coûts internes − débours non refacturés − sous-traitance) / honoraires | Mission, client, type, associé | Mensuelle |
| Taux de réalisation | Honoraires facturés / valeur des temps au taux standard | Mission, associé | À la clôture |
| Encours de production | Valeur des temps réalisés non encore facturés | Mission, cabinet | Mensuelle |
| Délai moyen d'encaissement | Jours entre émission et encaissement des factures | Client, cabinet | Mensuelle |
| Carnet de commandes | Honoraires signés restant à produire | Cabinet, associé | Mensuelle |
| Respect des jalons | Jalons tenus / jalons prévus | Mission | Mensuelle |
| Discipline de saisie | Feuilles de temps soumises dans les délais / feuilles attendues | Collaborateur, équipe | Hebdomadaire |

## Parcours utilisateurs clés

Quatre parcours servent de scénarios de recette : les trois premiers valident la V1, le dernier la V2.

**A. Une mission de bout en bout (V1)**

1. Le chef de mission crée une proposition depuis un type du catalogue : découpage et jours par grade arrivent pré-remplis.
2. L'associé ajuste prix et équipe, puis valide ; la proposition part au client.
3. Mission gagnée : la lettre de mission est générée et le budget initial figé à la signature.
4. Le chef de mission affine le découpage, affecte l'équipe et vérifie le plan de charge.
5. Chaque semaine, les temps validés mettent à jour réalisé, reste à faire et atterrissage.
6. Les factures partent selon l'échéancier ; à la clôture, le bilan de rentabilité est archivé.

**B. Le consultant saisit sa semaine (V1)**

1. Le vendredi, un rappel arrive sur son téléphone ; la feuille est pré-remplie avec ses affectations.
2. Il ajuste ses jours par tâche, déclare son reste à faire et ses débours avec la photo du justificatif.
3. Il soumet ; le chef de mission valide ou rejette avec un motif.
4. Le lundi, ses tâches de la semaine l'attendent dans « Mon planning ».

**C. L'associé détecte une dérive et arbitre (V1)**

1. Alerte : l'atterrissage d'une mission dépasse son budget de 5 %.
2. Il ouvre la mission : l'écart vient de la phase Diagnostic.
3. Il choisit de réallouer des jours entre phases, ou de demander une révision de budget au client.
4. La révision validée crée une nouvelle version de budget ; l'historique garde l'initial.
5. En fin de mois, il consulte occupation, marge et encours du cabinet.

**D. Une mission de conseil augmentée par l'IA (V2)**

1. Une mission de type « Plan stratégique » démarre : sa phase Diagnostic ouvre la notation (#1).
2. Les questionnaires générés par l'IA partent au client ; le consultant mène les entretiens.
3. Le SWOT arrive pré-rempli ; vision et objectifs sont validés en atelier.
4. L'IA propose les initiatives et pré-remplit le modèle financier ; l'expert valide.
5. Le plan s'exporte et ses KPI apparaissent dans le tableau de bord du client (#4) ; les temps de chaque phase alimentent le budget de la mission.

## Exigences non fonctionnelles

MissionPilot manipule les chiffres les plus sensibles d'un cabinet et de ses clients : honoraires, coûts, marges, états financiers. Confidentialité et fiabilité des calculs passent avant les fonctionnalités. Valeurs cibles proposées pour la V1.

| Domaine | Exigence | Cible V1 |
| --- | --- | --- |
| Isolation des données | Sécurité au niveau des lignes (RLS) PostgreSQL par cabinet, testée en CI | 0 fuite entre cabinets |
| Confidentialité interne | Coûts journaliers, grilles de taux et marges visibles des seuls associés et gestionnaires | Droits testés pour chaque rôle |
| Sécurité | TLS 1.2+ en transit, chiffrement au repos des données financières, double authentification, journal d'audit | 100 % des accès journalisés |
| Confidentialité IA | Fournisseur IA engagé contractuellement à ne pas entraîner ses modèles sur les données clients ; données identifiantes masquées quand c'est possible | Clause signée avant pilote |
| Fiabilité des chiffres | Jours, montants, marges, scores, états financiers et KPI calculés par du code testé ; le LLM ne fait que commenter | Couverture de tests ≥ 90 % sur les moteurs |
| Intégrité des temps | Périodes clôturées verrouillées ; toute correction tracée et validée | 100 % des corrections journalisées |
| Conformité | Loi ivoirienne n° 2013-450 sur les données personnelles (ARTCI) ; RGPD pour les clients européens ; règles de facturation du pays | Registre des traitements à jour |
| Performance | Pages en moins de 2 s sur 4G ; plan de charge de 100 personnes sur 26 semaines en moins de 3 s ; rapport PDF en moins de 60 s | p95 mesuré en production |
| Faible connectivité | Formulaires légers, sauvegarde automatique, reprise après coupure | Utilisable en 3G |
| Mobile | Interface responsive installable (PWA) ; feuille de temps, validations et tableaux de bord sur téléphone | Feuille de temps soumise en moins d'une minute |
| Disponibilité | Sauvegarde quotidienne chiffrée hors site ; RPO 24 h, RTO 4 h | 99,5 % mensuel |
| Localisation | Français en V1, anglais en V2 ; FCFA (XOF, XAF), EUR, USD ; SYSCOHADA ; jours fériés par pays | 100 % des écrans en français |
| Accessibilité | Contrastes, navigation clavier, libellés explicites | WCAG 2.1 AA |
| Capacité | Montée en charge sans refonte | 100 cabinets, 5 000 utilisateurs |

## Architecture et stack technique

Recommandation : reprendre la stack d'EcoleDigitale (monorepo pnpm, Fastify, Next.js 15, PostgreSQL avec RLS) pour réutiliser l'outillage, la CI et le savoir-faire multi-organisation d'ACC.

&#91;embedded content: architecture cible · 4 couches, 6 services externes\]

Le front ne parle qu'à une API ; l'orchestrateur IA est le seul composant qui appelle Claude. Le moteur Budget et temps recalcule réalisé, atterrissage, encours et marges à chaque temps validé, sous tests de non-régression.

**Décisions techniques**

- Claude pour la rédaction et l'analyse ; un modèle plus léger pour l'extraction et la classification.
- Recherche sémantique sur pgvector : pas de base vectorielle séparée en V1.
- Prompts versionnés en base ; chaque sortie IA garde sa version de prompt et ses sources.
- Générations IA et rapports en file BullMQ, avec progression affichée à l'utilisateur.
- Rapports en HTML rendu en PDF par Chromium headless ; DOCX et PPTX via les bibliothèques docx et pptxgenjs.

## Modèle économique et tarification

MissionPilot se vend d'abord comme un abonnement par utilisateur du cabinet : un revenu récurrent qui grandit avec les effectifs. Le module de conseil IA s'ajoute par consultant, et la mise en service est facturée une fois.

| Offre | Contenu | Cible | Prix indicatif (FCFA HT) |
| --- | --- | --- | --- |
| Essentiel | Gestion de mission complète : catalogue, découpage, affectations, temps, budget, facturation, indicateurs | Cabinets de 5 à 100 collaborateurs | 20 000 / utilisateur / mois |
| Expert externe | Accès limité aux temps et livrables de ses missions | Sous-traitants des cabinets | 5 000 / utilisateur / mois |
| Module Conseil IA | Services #1 à #5, génération IA, base de connaissances (à partir de la V2) | Consultants des cabinets | + 100 000 / consultant / mois |
| Portail client | Accès des clients du cabinet à leurs missions, livrables et tableaux de bord | Clients des cabinets | Inclus |
| Mise en service | Paramétrage du catalogue, reprise des données, formation des équipes | Chaque nouveau cabinet | À partir de 1 500 000, une fois |
| Missions ACC | Missions de conseil réalisées par ACC avec la plateforme | PME et ETI sans cabinet | Sur devis |

Exemple : un cabinet de 20 collaborateurs, dont 8 consultants équipés du module IA, paierait 20 × 20 000 + 8 × 100 000 = 1 200 000 FCFA HT par mois. Ces prix sont des hypothèses à tester auprès de 5 à 10 cabinets pendant le cadrage ; paiement par Mobile Money (Orange Money, MTN MoMo, Wave), carte ou virement.

## Feuille de route et jalons

Si le cadrage démarre en octobre 2026, la gestion de mission (V1) sort fin mars 2027 et part en pilote dans 2 à 3 cabinets, pendant que le conseil IA (V2) est développé ; le lancement commercial vise juillet 2027. Ces dates sont une proposition, à recaler selon l'équipe mobilisée.

&#91;embedded content: feuille de route · d'octobre 2026 à mars 2028\]

Deux jalons go/no-go : le lancement commercial attend que le pilote atteigne ses cibles (saisie des temps ≥ 90 %, NPS ≥ 40) ; le développement des services IA attend que les droits sur le concept SANKORIA soient clarifiés.

## Risques, hypothèses et questions ouvertes

Le risque principal n'est pas technique : c'est l'adoption de la saisie des temps par les consultants, sans laquelle budgets et marges restent vides. Vient ensuite la crédibilité des sorties IA.

| Risque | Impact | Parade |
| --- | --- | --- |
| Consultants qui ne saisissent pas leurs temps | Atterrissages et marges faux, valeur du produit perdue | Saisie en moins d'une minute sur téléphone, pré-remplissage depuis les affectations, relances, « Mon planning » utile au consultant |
| MVP trop lourd | Lancement retardé | Gestion de mission seule en V1, IA en V2 ; facturation simple d'abord |
| Cabinets très divers (conseil, audit, expertise comptable) | Modèle de mission trop rigide | Catalogue paramétrable, champs personnalisés, pilotes de profils différents |
| Conformité de la facturation (facture normalisée, TVA, retenues) | Factures contestées, cabinets exposés | Valider les obligations avec un expert-comptable au cadrage ; export vers un logiciel agréé si nécessaire |
| Coûts et marges visibles par erreur | Conflits internes | Droits fins par rôle, tests de droits automatisés |
| Sorties IA génériques ou fausses | Crédibilité perdue | Validation expert obligatoire, chiffres par moteur, sources citées |
| Base de connaissances pauvre au lancement | Analyses peu adaptées au contexte africain | Corpus initial au cadrage, enrichi par les retours d'expérience des missions clôturées |
| Coût de l'API IA | Marge érodée | Cache, modèle léger pour les tâches simples, quota par offre, coût suivi par mission |
| Référentiels sous licence (EFQM, Shingo) | Usage non autorisé | Grille propre fondée sur des principes publics, ou achat de licence |
| Droits sur le concept SANKORIA | Litige à la commercialisation | Clarifier avant le développement des services IA |

**Hypothèses à vérifier pendant le pilote**

- Un cabinet paie chaque mois pour piloter ses missions si la saisie des temps reste légère.
- Un associé fait confiance à un diagnostic produit en majorité par l'IA s'il est validé et signé par un expert.
- Les cabinets préfèrent un outil pensé pour leur marché (FCFA, SYSCOHADA, Mobile Money) aux logiciels internationaux.

**Questions ouvertes**

- [x] Nom commercial : MissionPilot, qui remplace CapStrat.
- [ ] Cibles prioritaires en V1 : cabinets de conseil, d'audit, d'expertise comptable, ou tous ?
- [ ] Granularité de saisie des temps : demi-journée ou heure ?
- [ ] ACC est-il le premier cabinet pilote, sur ses propres missions ?
- [ ] La facture normalisée électronique de la DGI s'applique-t-elle aux cabinets clients, et sous quelle forme ?
- [ ] Quel lien avec SANKORIA et M. Gbalé, auteur du cahier des 5 services marqué « Confidentiel » ? Quels droits de réutilisation ?
- [ ] Qui apporte les 40 % d'expertise des missions de conseil : consultants des cabinets clients, ACC, ou les deux ?
- [ ] Marché de lancement : Côte d'Ivoire seule ou toute la zone UEMOA ?
- [ ] Hébergement : VPS ACC ou cloud avec une région en Afrique ?
