# ADR-011 : Service #5 Redressement, socle (sous-chantier 3a)

## Statut

Proposée. À passer en « Acceptée » par le Pilote une fois la spécification
[`SPEC-3a-redressement.md`](../../workflows/specs/SPEC-3a-redressement.md) relue et les
trois territoires attribués. Les numéros ADR-007 à ADR-010 sont annoncés par le PRD
complémentaire (observatoire, WhatsApp, ingestion documentaire, signature) et rédigés
ailleurs ou en cours de rédaction par d'autres sous-chantiers : ADR-011 ne les réutilise pas.

## Date

2026-10-11

## Contexte

Le service #5 « Redressement, restructuration et mise à niveau » est le dernier service
de conseil du PRD sans code. Le PRD principal (RED-01 à RED-09, V3) et le PRD
complémentaire (§11.5, RED-10 à RED-15, V4) demandent un pré-diagnostic, des ratios, un
plan en deux volets, une trésorerie à 13 semaines, un registre des créanciers et une
bibliothèque de leviers. Le sous-chantier 3a en livre le **socle** (RED-01, 02, 05, 06,
07, 10, 11, 12, 14) ; les check-lists métier, les causes racines par IA, la re-notation,
le suivi post-mission, les repères OHADA et le partage au conseil d'administration sont
repoussés (liste et raisons dans la spécification).

Faits du dépôt qui pèsent sur la décision :

- Les états financiers du client existent déjà (dossier client, `0222`) : lignes
  `(code, section, montant, parent, rôle)` contrôlées par le moteur
  `controlerEtatFinancier`, acceptation tracée, un état courant par exercice. Mais une
  ligne **n'a pas de nature** (stock, créance, dette à court terme) : le code est celui du
  plan comptable du client. Aucun ratio n'est calculé sur ces états. Les seuls ratios
  bancaires du dépôt (`plan-strategique/bancabilite.ts`) portent sur un modèle
  **prévisionnel**.
- Le module de questionnaires s'envoie à des répondants du portail client (SOC-10) ; le
  redressement est un travail du cabinet avec le dirigeant, sans accès du portail.
- Règles du dépôt : aucun chiffre ne vient d'un modèle de langage, tout calcul sort de
  `packages/engines` ; isolation par cabinet (RLS) ; le portail n'accède à rien par
  défaut ; historiques en ajout seul ; séparation des tâches ; FIN-02.
- Les données manipulées (trésorerie, dettes, négociations) sont parmi les plus
  sensibles du client, et un score ou un voyant « rouge » peut être pris pour une
  qualification juridique (cessation des paiements, procédure d'alerte OHADA).

## Décision

1. **Un module `redressement`** (préfixe `red_`), **un dossier de redressement par
   mission** (unique), lié à la mission et au client de celle-ci, avec secteur, devise et
   statut. Quinze tables, en sept migrations `0480`–`0486` dans la plage réservée
   **`0480`–`0499`** ; SQLSTATE **lettre `Z`**, `MPZ01` à `MPZ11` (la lettre `H`, seule autre lettre libre, est
   revendiquée par l'ADR-012, due diligence : voir la spécification, §1 point H5). Toutes les tables ont
   RLS (`isolation`) et `portail_interdit`, clés étrangères composites `(cabinet_id, id)`.
2. **Aucun modèle de langage dans le socle** : aucun import de `apps/api/src/ia/`, aucune
   table `ia_*`, aucun job. Tout le calcul est déterministe, dans
   `packages/engines/src/redressement` (entiers, `BigInt` pour les sommes, points de base
   pour les ratios, base de 360 jours comme le modèle financier).
3. **Réutilisation du dossier client** : les ratios sont calculés **à la lecture** depuis
   les états **acceptés** du dossier, par une **correspondance de postes** versionnée
   (postes de ratio ← codes de lignes du client), sans copier l'état. Un poste non
   renseigné rend le ratio « non calculable » ; il n'est jamais compté pour zéro. Le
   drapeau `analyses_indicatives` de l'indice de fiabilité du dossier est repris dans
   chaque résultat.
4. **Historisation en ajout seul** : correspondances, évaluations d'urgence, scores
   d'alerte, versions de seuils, versions de prévision de trésorerie, réalisés
   (chaîne de remplacement), créances, événements de négociation, échéances, événements
   d'action et versions de plan. Seuls restent modifiables, de façon bornée et
   journalisée : le dossier (intitulé, secteur, statut), le créancier (nom, garantie,
   référence, actif) et l'action du kanban (statut, rang, contenu tant qu'elle n'est pas
   terminée).
5. **Score d'alerte précoce (RED-10)** : fonction pure de ratios, tendances et incidents
   de paiement, avec des **seuils versionnés par secteur** fixés par les experts du
   cabinet (rédigés puis publiés par un expert métier autre que l'auteur, sauf associé).
   Chaque score est conservé avec ses **entrées**, un **instantané des seuils** utilisés,
   leur version et la version du moteur : il se rejoue à l'identique. Sans version
   publiée, le moteur applique ses valeurs par défaut, déclarées **provisoires**
   (DECISIONS.md) et signalées dans le score (`seuils_source = defaut_moteur`).
6. **Questionnaire d'urgence (RED-01)** : grille fermée du moteur (15 questions, 5
   domaines, versionnée), renseignée par le consultant ; voyants vert, orange, rouge par
   domaine par seuil sur un pourcentage pondéré. Pas de réutilisation du module
   `questionnaires` (portail).
7. **Bibliothèque de leviers (RED-14)** : catalogue **fermé dans le moteur** (six
   leviers : délai clients, stocks, délai fournisseurs, charges fixes, prix, cession) dont
   l'impact type est calculé par une fonction pure ; l'impact retenu est conservé avec
   ses paramètres dans l'action du plan. Pas de table de leviers.
8. **Aucune qualification juridique.** Une semaine de tension n'est pas une « cessation
   des paiements » ; un score n'est pas une « procédure d'alerte » ; les textes d'écran
   le disent. Le contenu OHADA (RED-13) est repoussé : il exige un juriste.
9. **Permissions** `redressement.lire`, `redressement.ecrire`, `redressement.valider`,
   `redressement.parametrer` ; validation d'une version de plan par son auteur interdite
   (sauf associé), doublée en base (`MPZ07`). Aucune route dans `LISTE_BLANCHE_PORTAIL`.
10. **FIN-02** : le module ne porte aucun coût, taux, marge ni honoraire **du cabinet**.
    Les montants et marges qu'il montre sont ceux **du client** (comme le plan
    stratégique et le dossier client) : ils relèvent de `redressement.lire`, pas de
    `finance.lire`. Cette classification est écrite dans la spécification et testée.

## Conséquences positives

- Le dossier client n'est ni dupliqué ni contourné : une seule vérité pour les états,
  avec leur acceptation et leur fiabilité.
- Tout nombre affiché se rejoue : mêmes entrées, mêmes seuils, même version du moteur,
  même résultat.
- Trois agents peuvent travailler sans conflit : moteurs et schémas, API et migrations,
  interface.
- Aucun composant d'exploitation de plus (ni job, ni IA, ni service externe).

## Conséquences négatives

- La correspondance de postes est un travail manuel du consultant à la première
  utilisation (la proposition SYSCOHADA indicative du moteur n'en couvre qu'une partie :
  `dettes_court_terme`, `autres_creances`, `cout_ventes`, `charges_financieres` n'ont pas
  de code de référence dans le dépôt). Une erreur de correspondance fausse les ratios ; la
  version de correspondance est tracée dans chaque score et chaque ratio, mais aucun
  second regard n'est imposé.
- Les seuils par défaut sont des conventions d'analyse financière **non sourcées** par une
  norme chiffrée (voir DECISIONS.md) ; tant qu'aucun expert n'a publié ses seuils, le
  score est indicatif.
- Quinze tables et onze codes SQLSTATE de plus à maintenir ; la plage `0480`–`0499` est
  consommée aux deux tiers par le socle.
- La vue mensuelle de trésorerie, les covenants, le plan de financement et le partage de
  documents de RED-06 et RED-07 sont repoussés avec le reste.
- Aucune durée de conservation n'est posée sur les données du client (à valider avec le
  conseil juridique, comme pour les autres lots).

## Alternatives écartées

- **Modèle statistique de défaillance (Altman et dérivés)** — non calibré sur la zone
  UEMOA/CEMAC, il exige des données de marché ou de structure que le dossier n'a pas, et
  n'est pas explicable ligne par ligne ; le PRD demande des seuils **fixés par les
  experts**.
- **Ratios stockés** — doubleraient le dossier client et pourraient diverger d'un état
  remplacé ; seul le score (entrées comprises) est un instantané, parce que c'est une
  décision datée.
- **Réutiliser le module de questionnaires et le moteur de notation pour l'urgence** —
  le premier s'adresse au portail et le second à une grille pondérée longue ; l'urgence
  est une grille courte, saisie par le consultant, sans accès du client.
- **Table de leviers avec formules libres en base** — une formule éditable est du code
  exécuté ou un paramétrage sans contrôle ; le catalogue fermé du moteur reste testable
  (comme `REGISTRE_ACTIONS_AUTOMATISATION`, ADR-006). Écart assumé avec la bibliothèque
  d'initiatives du plan (PLA-13, en base) : celle-ci ne calcule rien.
- **Tâches de collaboration comme kanban** — types d'entité fermés (la mission, pas un
  dossier de redressement), statuts à trois états, pas de volet ni d'impact ; le kanban a
  sa table et crée, au besoin, une tâche « Mes tâches » liée à la mission.
- **Trésorerie hebdomadaire dans les mesures de KPI** — une mesure est un nombre par
  date ; il faut ici des flux par catégorie, des versions de prévision, un réalisé corrigé
  et des semaines de tension.
- **Intégrer le redressement au plan stratégique** — le plan est un contrat de V2 avec
  sa validation et son modèle financier prévisionnel ; le redressement vit dans l'urgence
  et sur le réel.
- **Qualifier la situation (cessation des paiements, alerte)** — conseil juridique
  automatisé, exclu par le PRD (RED-13) et par l'ADR-003.

## Liens

- Spécification : [`docs/workflows/specs/SPEC-3a-redressement.md`](../../workflows/specs/SPEC-3a-redressement.md).
- PRD, « Service 5 » (RED-01 à RED-09) ; PRD complémentaire §11.5 (RED-10 à RED-15), §5
  (dossier client), §10 (classes de risque : le plan de redressement est R3).
- ADR-001 (monorepo), ADR-003 (IA hors socle), ADR-006 (registre fermé, séparation des
  tâches), `docs/governance/CODING_STANDARDS.md` §1 (plages) et §2 (SQLSTATE),
  `docs/governance/SECURITY.md` §4 bis (portail), §6 (FIN-02, ajout seul).
- Code réutilisé : `apps/api/migrations/0222_dossier_etats_financiers.sql`,
  `apps/api/src/dossier/` (`etats.ts`, `fiabilite.ts`), `packages/engines/src/dossier/`,
  `packages/engines/src/finance/calcul-exact.ts`, `packages/engines/src/plan-strategique/bancabilite.ts`
  (même convention : points de base, jours sur 360), `apps/api/src/collaboration/taches.ts`.
