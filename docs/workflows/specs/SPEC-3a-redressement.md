# SPEC-3a — Service #5 Redressement : socle

Spécification technique du sous-chantier 3a de la vague 4 (PRD principal, « Service 5 »,
RED-01 à RED-09 ; PRD complémentaire §11.5, RED-10 à RED-15). **Documentation seulement** :
aucun code n'est écrit par ce document. Décision d'architecture :
[ADR-011](../../architecture/adr/ADR-011-service-redressement.md).

| Élément          | Valeur                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Statut           | Proposée, à relire par le Pilote avant d'attribuer les trois territoires (§11)                 |
| Date             | 2026-10-11                                                                                     |
| Branche          | `feat/vague-4-redressement` (le brief disait `feat/vague-4` : voir §1)                         |
| Base de relevé   | arbre propre au démarrage, 155 migrations toutes commitées, 677 routes, 23 `GRANT EXECUTE`      |
| Agents attendus  | 3 (moteurs + schémas + permissions ; migrations + API + tests API ; web + tests web)           |

Table des matières : 1 Hypothèses vérifiées · 2 Périmètre · 3 Principes · 4 Réutilisation ·
5 Modèle de données · 6 Moteur · 7 Schémas partagés · 8 Permissions · 9 API · 10 Web ·
11 Territoires et ordre · 12 Points sensibles d'audit · 13 Valeurs provisoires ·
14 Points ouverts et risques.

---

## 1. Hypothèses du brief vérifiées sur le code

Chaque ligne a été vérifiée dans l'arbre (commandes `ls`, `git`, `rg`, lecture des fichiers cités).

| Réf. | Hypothèse du brief                                                  | Constat                                                                                                                                                                                                                                                                                                                                                                       | Conséquence                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | Branche `feat/vague-4`                                              | `git branch --show-current` donne `feat/vague-4-redressement`.                                                                                                                                                                                                                                                                                                                | Utiliser ce nom.                                                                                                                                                              |
| H2   | « ratios éventuels dans `packages/engines` » (dossier client)       | **Faux.** `engines/src/dossier/etat-financier.ts` ne fait que des contrôles d'équilibre. Les ratios bancaires du dépôt (`plan-strategique/bancabilite.ts`) portent sur un modèle **prévisionnel** (`ExerciceBancabilite`), pas sur les états du client. Et une ligne d'état (`dossier_etats_lignes`) n'a **ni nature ni classement courant/non courant** : son `code` est celui du plan comptable du client. | Il faut une **correspondance de postes** versionnée (§5.6, §6.3). Les conventions de `bancabilite.ts` (points de base, `diviserArrondi`, BFR sur 360 jours) sont reprises.        |
| H3   | « vérifie CODING_STANDARDS §1 pour la plage de migrations »         | Le §1 ne cite plus de plage libre au-delà de `0199` (« plages libres : `0151–0159`, `0161–0169`, `0170–0179`, `0185–0199` », périmées) ; dernières plages réservées : `0460–0479` (CAP). `0340–0359` est « sans affectation ». `ls apps/api/migrations` s'arrête à `0465`. Le sous-chantier due diligence (ADR-012) reconnaît `0480–0499` au redressement et se réserve `0500–0519`. | **`0480–0499`** réservée au lot RED (§5.2).                                                                                                                                   |
| H4   | (implicite) migrations « non commitées » corrigeables               | CODING_STANDARDS §1 et la checklist disent que six migrations (`0271–0274`, `0303`, `0304`) ne sont pas commitées. `git log` montre la fusion de la PR n° 9 : `git ls-files apps/api/migrations \| wc -l` = 155 = `ls`. **Toutes sont immuables.**                                                                                                                              | Documentation à rafraîchir par le Pilote (§11.5). Les migrations `0480+` sont neuves.                                                                                         |
| H5   | « lettre SQLSTATE libre »                                           | Lettres employées : `A B C D E F G I J K L M N O P Q R S T U V W X Y` (relevé dans `apps/api/migrations`, `apps/api/src`, `packages`). **Seules `H` et `Z` manquent.** Or l'ADR-012 (due diligence) prend `H` pour `MPH01–MPH12`, et les ADR-010 et ADR-013 citent déjà `MPH11` et `MPH07` (collisions entre eux, hors de ce document). | Ce lot prend **`Z`** : `MPZ01–MPZ11`. **Arbitrage demandé au Pilote** : il ne reste plus de lettre libre après `H` et `Z` ; les lots suivants devront réutiliser une lettre avec des plages de numéros disjointes ou adopter deux lettres. La lettre n'apparaît que dans `0480–0486`, `redressement/erreurs.ts` et les tests : un remplacement global est possible. |
| H6   | « questionnaires » à réutiliser                                     | Le module `questionnaires` s'envoie à des répondants du **portail** (SOC-10, `0141`) ; le redressement n'a aucun accès du portail.                                                                                                                                                                                                                                              | Grille d'urgence **propre au moteur** (§6.4) ; pas de réutilisation des tables.                                                                                               |
| H7   | « tâches de collaboration (`collaboration/taches.ts`) »             | `taches_collaboration.entite_type` est fermé (`mission`, `mission_tache`, `facture`, `debours`, `opportunite`, `proposition`, `0075`) et les statuts sont `a_faire / en_cours / fait`. Un dossier de redressement n'est pas un type d'entité.                                                                                                                                  | Le kanban a sa table ; **l'option** « créer une tâche dans Mes tâches » appelle `creerTacheAssignee` avec `entite_type = 'mission'` (lien au niveau de la mission) ; pas de synchronisation de statut (§9.7). |
| H8   | « FIN-02 : coûts, marges et montants financiers internes »          | Le module ne manipule **aucun coût, taux, marge ou honoraire du cabinet**. Ses montants et ses « marges » sont ceux **du client** (états, trésorerie, dettes), comme le dossier client (règle 5 de `dossier/acces.ts`) et le plan stratégique (`plan.lire`, sans `finance.lire`).                                                                                            | FIN-02 **traduit en invariant testé** (§9.8) : aucune donnée du cabinet n'entre dans une réponse ; `finance.lire` n'est pas exigé. Écart à confirmer par le commanditaire (§14).  |
| H9   | « Decimal/entiers comme les autres moteurs »                        | Aucune bibliothèque `Decimal` : les moteurs utilisent des entiers, des `BigInt` pour les sommes, des fractions exactes (`finance/calcul-exact.ts`, `kpi/fraction.ts`) et des points de base.                                                                                                                                                                                  | Entiers et `BigInt` seulement ; `diviserArrondi` (demi s'éloignant de zéro) ; aucun `Number` en virgule flottante dans un résultat.                                           |
| H10  | PRD : RED-01 à 09 en V3, RED-10 à 15 en V4                          | Le 3a mêle des exigences des deux versions.                                                                                                                                                                                                                                                                                                                                  | Aucun problème de code ; l'ordre de livraison suit le brief.                                                                                                                  |
| H11  | « portail n'y accède pas »                                          | Exact par défaut : `LISTE_BLANCHE_PORTAIL` est fermée ; il suffit de ne rien y ajouter et de poser `portail_interdit` sur chaque table.                                                                                                                                                                                                                                       | Test d'inventaire existant (`isolation.test.ts`, `portail-acces.test.ts`) : rien à modifier.                                                                                  |
| H12  | « jobs »                                                            | Aucun job nécessaire : tout est synchrone et à la demande. `REGISTRE_JOBS` inchangé (`jobs-registre.test.ts` reste vert).                                                                                                                                                                                                                                                       | Pas de `TYPE_JOB_*` dans ce lot.                                                                                                                                              |

---

## 2. Périmètre

### 2.1 Livré par le 3a

| Bloc | Exigence                      | Contenu livré                                                                                                                                  |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | (PRD « Service 5 », socle)    | Dossier de redressement lié à une mission et à un client : intitulé, secteur, devise, statut                                                    |
| 2    | RED-02                        | Ratios clés depuis les états financiers **acceptés** du dossier client, par correspondance de postes : liquidité générale, réduite, immédiate, autonomie financière, solvabilité générale, endettement, marge brute, marge nette, couverture des charges financières, BFR en jours |
| 3    | RED-01                        | Questionnaire d'urgence (15 questions, 5 domaines) et voyants vert / orange / rouge par domaine                                                  |
| 4    | RED-10                        | Score d'alerte précoce déterministe, seuils versionnés par secteur fixés par les experts, score conservé avec entrées et seuils                 |
| 5    | RED-06 (partie), RED-11       | Trésorerie à 13 semaines : prévision (versions), réalisé hebdomadaire, soldes, écarts, semaines de tension, besoin de financement ; point mort  |
| 6    | RED-12                        | Registre des créanciers, créances, négociations, accords et échéanciers, paiements ; historique en ajout seul                                   |
| 7    | RED-05, RED-07 (partie)       | Plan à deux volets (quick wins, restructuration), kanban d'actions, versions de plan validées                                                   |
| 8    | RED-14                        | Bibliothèque de six leviers avec impact chiffré type calculé par le moteur                                                                       |

### 2.2 Repoussé, avec la raison

| Exigence ou partie                                                    | Raison du report                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED-03 check-lists métier activables (industrie, services, commerce)  | Contenu métier à rédiger et à valider par les experts ; demande un éditeur de check-lists. Le socle fournit les domaines (§6.4) sur lesquels elles se brancheront.                                            |
| RED-04 cartographie IA des causes racines                             | Exige un appel de modèle : **exclu du socle** (ADR-011), à traiter avec ADR-003/005 (orchestrateur, garde-chiffres, validation d'un consultant).                                                              |
| RED-08 re-notation finale et rapport de clôture chiffré               | Dépend de la notation (#1) et du moteur de rapports ; le rapport de clôture n'a pas de contenu sans plan exécuté.                                                                                             |
| RED-09 suivi post-mission (accès limité, relances à 6 et 12 mois)     | Demande un accès du portail et des jobs de relance : hors périmètre « portail n'y accède pas ».                                                                                                               |
| RED-13 repères OHADA (conciliation, règlement préventif)              | **Contenu à valider par un juriste** (PRD) ; aucun conseil juridique automatisé. Le socle ne qualifie jamais la situation (§3, principe 9).                                                                  |
| RED-15 tableau de bord partagé au conseil d'administration et aux banques | Ouvre le portail ou un partage externe : surface de sécurité à part (investisseur, PRD complémentaire §13).                                                                                                  |
| *(ajouts de cette spécification)* RED-06 : vue mensuelle, covenants bancaires, plan de financement | Le brief ne les listait pas. La bancabilité du **modèle prévisionnel** (PLA-17) couvre déjà ratios et plan de financement ; les covenants demandent un paramétrage bancaire non spécifié. |
| *(ajout)* RED-07 : partage de documents, comptes rendus de points d'étape, alertes de jalons | Le kanban est livré ; le partage de documents passerait par la salle de mission ; les alertes de jalons demandent un événement d'automatisation (ADR-006) : lot suivant.                       |
| *(ajout)* seed de démonstration, brief quotidien, événements d'automatisation (« voyant rouge ») | Non nécessaires au socle ; à prévoir au sous-chantier suivant.                                                                                                                                         |
| *(ajout)* synthèse `qualite/branchements.ts` (suivi qualité R3 du plan)  | Le PRD classe le plan de redressement R3 (relecture d'un second expert, signature du directeur). Le socle ne produit **aucun livrable** (ni PDF, ni rapport) : la validation d'une version de plan est un contrôle interne à quatre yeux (§9.7). Le branchement qualité viendra avec le rapport (RED-08). Risque en §14. |

---

## 3. Principes de conception (contraintes traduites)

1. **Les chiffres sortent de `packages/engines`.** Ratios, voyants, scores, soldes, écarts,
   point mort, échéanciers, situation des créanciers, avancement du plan et impact des leviers :
   fonctions pures (§6), couverture ≥ 90 % imposée. Aucun `SUM`, `AVG`, arrondi ni calcul de
   montant dans une route, en SQL (hors `count(*)` structurels des déclencheurs de plafond) ou
   dans le web (le web **formate** des entiers déjà calculés : points de base vers pourcentage,
   par `lib/format.ts`). La recherche mécanique n° 6 (`SUM(|AVG(` dans `apps/api/src`) doit
   rester à 0 ; la n° 8 (`Math.round`…) ne gagne aucune ligne.
2. **Aucune IA.** Aucun import de `apps/api/src/ia/`, aucune table `ia_*`, aucun appel
   de fournisseur, aucun job. Vérifié par un test (§9.9, `redressement-sans-ia.test.ts`).
3. **Cabinet = frontière.** Chaque table : `cabinet_id`, RLS, politique `isolation`
   (`USING` et `WITH CHECK`), politique RESTRICTIVE `portail_interdit`, clés étrangères
   **composites** `(cabinet_id, id)`.
4. **Le portail n'y accède pas.** Aucune route dans `LISTE_BLANCHE_PORTAIL` ; `portail_interdit`
   sur les quinze tables ; test : `portail-acces.test.ts` (inventaire des routes) et
   `isolation.test.ts` (inventaire des politiques) doivent rester verts **sans modification**.
5. **Ajout seul là où la décision doit se rejouer** : déclencheurs à SQLSTATE `MPZ…` et `REVOKE`
   (§5). On corrige par un nouvel enregistrement. Chaque action sensible appelle `journaliser`
   dans la même transaction, avec des **identifiants et des comptes seulement** (jamais un nom
   de créancier, un montant, une condition de négociation ou un texte libre).
6. **FIN-02 traduit** (H8) : aucune donnée du cabinet ; les données du client relèvent de
   `redressement.lire`. Test « sans `finance.lire` » obligatoire (§9.8).
7. **Séparation des tâches** (modèle `finance/encaissements.ts`, `MPW05`, `MPN04`) : validation
   d'une version de plan ≠ créateur de la version (sauf associé) ; publication de seuils ≠
   auteur (sauf associé), réservée à un expert métier ou à un associé ; doublées en base
   (`MPZ07`).
8. **Schémas Zod `.strict()`** partagés (`packages/shared`), dates par `dateIsoBorneeSchema`,
   routes sous `exiger`, plafonds de volume et de débit déclarés (§9.5). `Idempotency-Key` :
   **aucune** écriture de ce lot n'est rejouée par une file hors ligne ; un double envoi crée
   au pire une version de plus (numérotée), jamais une écriture silencieusement écrasée ; les
   chaînes de remplacement (réalisés) et les unicités structurelles (créancier) l'empêchent
   ailleurs. À réexaminer si un jour la saisie du réalisé passe en hors ligne.
9. **Aucune qualification juridique** : ni « cessation des paiements », ni « procédure
   d'alerte », ni « état de crise ». Les textes d'écran sont fixés (§10.6). Le mot « alerte » est
   réservé au score « d'alerte précoce » ; il porte la mention « indicatif ».
10. **Pas de valeur inventée présentée comme un fait** : toute valeur par défaut est exportée
    comme constante nommée, « provisoire » dans DECISIONS.md avec sa justification (§13).

---

## 4. Réutilisation de l'existant

Module de référence pour les conventions, lu de bout en bout : le **pilotage augmenté des KPI** (migrations
`0440`–`0445`, `apps/api/src/kpi/` et `routes/kpi-pilotage.ts`, `packages/engines/src/kpi/`,
`packages/shared/src/schemas/kpi-pilotage.ts`, `apps/web/src/app/(app)/missions/[id]/kpi/`,
`components/kpi/`, `lib/kpi-pilotage.ts`, `apps/api/test/kpi-pilotage.test.ts`), complété par le dossier client (`0220`–`0224`)
pour la lecture des états et par `0380` / `0271` / `0145` pour les déclencheurs d'ajout seul, de version et de publication.

| Besoin                                       | Existant réutilisé                                                                                                                                                                                                                | Ce qui est nouveau                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| États financiers du client                   | Tables `dossier_etats_financiers`, `dossier_etats_lignes`, `dossier_etats_decisions` (`0222`) : lecture seule des états **courants et acceptés** ; `totaux` (`actif`, `passif`, `resultat`) déjà calculés par `controlerEtatFinancier` | Correspondance de postes (`red_correspondances`) et ratios                                           |
| Fiabilité des données                        | `calculerFiabilite(db, clientId)` (`apps/api/src/dossier/fiabilite.ts`) : drapeau `analysesIndicatives` et classe, repris dans les réponses                                                                                         | —                                                                                                   |
| Visibilité de la mission, écriture           | `exigerMissionVisible`, `exigerMissionModifiable`, `peutModifierMission`, `estAssocie`, `filtreVisibilite` (`missions/acces.ts`)                                                                                                    | `redressement/acces.ts`                                                                             |
| Arithmétique exacte                          | `diviserArrondi`, `versRationnel`, `ratio` (`engines/src/finance/calcul-exact.ts`) ; dates `analyserDateISO`, `dateISODepuisJourUTC`, `jourSemaineDepuisJourUTC` (`commun/dates.ts`), `ajouterMois`, `joursEntre` (`finance/dates.ts`) | Moteur `redressement/`                                                                              |
| Convention de ratio bancaire                 | `plan-strategique/bancabilite.ts` : points de base (10 000 = 1), BFR = stocks + créances − fournisseurs, jours sur 360, `SEUILS_BANCABILITE_DEFAUT` (endettement 1,0, BFR 90 j)                                                      | Ratios sur états **réels** ; test d'alignement avec `analyserBancabilite` (§6.3)                    |
| Références SYSCOHADA indicatives             | `REFERENCES_SYSCOHADA` (`plan-strategique/modele.ts`) : `XB`, `XE`, `XI`, `AZ`, `BB`, `BI`, `BT`, `CA`, `CP`, `DD`, `DJ`, `DT`… « à confirmer par un expert-comptable »                                                             | Proposition de correspondance indicative construite **depuis cette constante**                      |
| Tâches assignées                             | `creerTacheAssignee` (`collaboration/taches.ts`) : une action peut créer une tâche « Mes tâches » liée à la **mission** ; `notifier` pour l'assigné                                                                                | Colonne `tache_collaboration_id` ; pas de synchronisation                                           |
| Journal d'audit                              | `journaliser` (`audit.ts`)                                                                                                                                                                                                          | Actions et entités `red_*` (§9.6)                                                                   |
| Pagination, erreurs, plafond de débit        | `paginer`, `encoderCurseur` (`http/outils.ts`), `AppError`, plafond compté sur `journal_audit` sous verrou consultatif (modèle `copilote/limites.ts`, `routes/factures-pdf.ts`)                                                       | `redressement/limites.ts`                                                                           |
| Fabrique de numérotation, ajout seul         | Modèles `0442_kpi_actions.sql` (numéro par mission, transitions, événements en ajout seul), `0380_banque_cv.sql` (`controler_version_banque_ao`), `0271_copilote_actions.sql` (`GRANT UPDATE` par colonnes), `0145`/`0146` (publication par un expert ≠ auteur) | Fonctions `red_*` (§5.4)                                                                            |
| Interface                                    | `Tableau`, `Carte`, `Onglets`, `EtatVide`, `EtatErreur`, `BadgeStatut`, `Alerte`, `chargerServeur`, `chargerToutesLesPages`, `exigerPermission`, `lib/format.ts`, graphiques SVG de `components/kpi/GraphiqueSerieKpi.tsx` comme modèle | Écrans §10                                                                                          |
| **Non réutilisé** (et pourquoi)              | `questionnaires` (portail, H6) ; `notation` (grille longue pondérée) ; `kpi_mesures` (une valeur par date) ; `plans` (contrat de V2) ; `qualite/branchements.ts` (aucun livrable, §2.2) ; `taches_collaboration` comme kanban (H7)      | Alternatives écartées de l'ADR-011                                                                  |

---

## 5. Modèle de données (agent 2)

### 5.1 Conventions communes

- Français sans accents, `snake_case`, préfixe `red_` ; montants `bigint` en unités mineures ;
  identifiants `uuid`.
- **Chaque table** porte `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
  `cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE`,
  `UNIQUE (cabinet_id, id)` et ces lignes (modèle `0442`), sans exception :

  ```sql
  ALTER TABLE red_x ENABLE ROW LEVEL SECURITY;
  CREATE POLICY isolation ON red_x
    USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
  CREATE POLICY portail_interdit ON red_x AS RESTRICTIVE FOR ALL
    USING (app_portail_client_id() IS NULL);
  REVOKE DELETE ON red_x FROM missionpilot_app;               -- toutes les tables
  REVOKE UPDATE, DELETE ON red_x FROM missionpilot_app;       -- tables « ajout seul »
  ```

- Toute référence à une autre table du cabinet est une **clé étrangère composite**
  `FOREIGN KEY (cabinet_id, x_id) REFERENCES t (cabinet_id, id)`. Les tables filles d'un
  dossier portent aussi `dossier_id` et référencent leur parent par
  `(cabinet_id, dossier_id, parent_id)` → `parent (cabinet_id, dossier_id, id)` (le parent
  déclare `UNIQUE (cabinet_id, dossier_id, id)`, modèle `mission_taches`, `0075`) : un
  enfant ne peut pas viser un parent d'un autre dossier. `dossier_id` référence lui-même
  `red_dossiers (cabinet_id, id)`.
- Dates métier : `CHECK (x BETWEEN '2000-01-01' AND '2100-12-31')` (modèle `0042`, `0442`).
  Une « date de semaine » est un **lundi** : `CHECK (EXTRACT(isodow FROM x) = 1)`.
- Bornes de montant : `MONTANT_RED_MAX = 10 000 000 000 000` (10^13) pour les flux, dettes et
  soldes de ce lot ; 10^15 (comme `dossier_etats_lignes`) pour les montants d'un état
  financier lu. Motif : 600 lignes × 10^13 = 6 × 10^15 < 2^53 : les sommes de trésorerie
  restent exactes en `number` côté API ; le moteur somme en `BigInt` et refuse tout dépassement
  (`SOMME_HORS_LIMITES`).
- Colonnes `jsonb` : `CHECK (jsonb_typeof(c) = 'object')` **et** `octet_length(c::text) <= N`
  (N donné par table). Le contenu est produit par le code à partir de sorties du moteur et
  d'entrées validées par Zod `.strict()` ; la base ne le recalcule pas.
- Utilisateurs désignés (`cree_par`, `saisi_par`, `responsable_id`…) : clé composite vers
  `utilisateurs (cabinet_id, id)` ; un compte du portail n'est **jamais** désigné
  (`refuser_utilisateur_portail('responsable_id')`, `0113`, 23503 → 400).

### 5.2 Migrations et plage

Plage **réservée `0480–0499`** (lot RED, vague 4), à déclarer dans l'en-tête de `0480` et dans
CODING_STANDARDS §1. `migrate.ts` applique par ordre de nom : une migration ne référence que des
tables de numéro inférieur.

| Fichier                                 | Contenu                                                                                   | Dépend de                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| `0480_redressement_dossiers.sql`        | Fonctions communes `red_*` (§5.4), `red_dossiers`                                         | `missions`, `clients`, `utilisateurs`   |
| `0481_redressement_correspondances.sql` | `red_correspondances` (RED-02)                                                            | `0480`                                  |
| `0482_redressement_urgences.sql`        | `red_urgences` (RED-01)                                                                   | `0480`                                  |
| `0483_redressement_alerte.sql`          | `red_seuils_versions`, `red_scores` (RED-10)                                              | `0480`                                  |
| `0484_redressement_creanciers.sql`      | `red_creanciers`, `red_creances`, `red_negociation_evenements`, `red_echeances` (RED-12)  | `0480`                                  |
| `0485_redressement_tresorerie.sql`      | `red_tresorerie_versions`, `red_tresorerie_lignes`, `red_tresorerie_realises` (RED-11)    | `0480`, `0484` (créanciers, échéances)  |
| `0486_redressement_plan.sql`            | `red_actions`, `red_action_evenements`, `red_plan_versions` (RED-05, RED-07)              | `0480`, `taches_collaboration` (`0075`) |

`0487–0499` : durcissements d'audit (un numéro par correctif, jamais de modification d'une
migration commitée). **Prochain numéro libre après ce lot : `0487`.** Total : 7 fichiers,
**15 tables**, 162 fichiers dans le dossier. Aucune fonction `SECURITY DEFINER` (donc
`rg "GRANT EXECUTE" apps/api/migrations` reste à 23 lignes) : tous les déclencheurs sont
d'invocateur et lisent sous la RLS du cabinet (modèle `plan_valideur_dispense`, `0180`).

### 5.3 SQLSTATE du lot (lettre `Z`, H5)

Un numéro = un sens (CODING_STANDARDS §2 : ne pas aggraver les « codes à plusieurs sens »).

| Code    | Sens                                                                                                                                                                                  | Traduction API (`traduireErreurRedressement`) |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `MPZ01` | Historique en ajout seul : `UPDATE` ou `DELETE` refusé (hors transitions prévues)                                                                                                     | 409 `RED_HISTORIQUE_IMMUABLE`                 |
| `MPZ02` | Rattachement incohérent : mission et client du dossier ; score vers des seuils non publiés, d'un autre secteur ou non identiques ; ligne de trésorerie vers une échéance d'un autre créancier | 400 `RED_RATTACHEMENT_INCOHERENT`             |
| `MPZ03` | Mission clôturée ou dossier clos : plus d'écriture dans le dossier                                                                                                                                     | 409 `RED_MISSION_CLOTUREE`                    |
| `MPZ04` | Champ figé (identité d'un dossier, d'un créancier, d'une action ; contenu d'une version publiée ou validée)                                                                            | 409 `RED_CHAMP_FIGE`                          |
| `MPZ05` | Versions non consécutives, ou publication / validation d'une version qui n'est pas la dernière                                                                                          | 409 `RED_VERSION_NON_CONSECUTIVE`             |
| `MPZ06` | Transition de statut invalide (dossier, action, version de seuils, version de plan)                                                                                                    | 409 `RED_TRANSITION_INVALIDE`                 |
| `MPZ07` | Séparation des tâches : plan validé par son créateur (hors associé) ou par un rôle non habilité ; seuils publiés par leur auteur (hors associé) ou par un rôle non habilité             | 403 `SEPARATION_DES_TACHES`                   |
| `MPZ08` | Réalisé de trésorerie : remplacement incohérent (la ligne remplacée n'est pas la ligne courante de la semaine)                                                                         | 409 `RED_REALISE_INCOHERENT`                  |
| `MPZ09` | Négociation incohérente : accord déjà en vigueur ; paiement ou rupture sur un accord d'un autre créancier ou déjà rompu ; échéance d'un autre accord                                    | 409 `RED_NEGOCIATION_INCOHERENTE`             |
| `MPZ10` | Plafond de volume atteint (valeurs en §9.5)                                                                                                                                            | 409 `RED_PLAFOND_ATTEINT`                     |
| `MPZ11` | Plus de 10 corrections d'un même réalisé de semaine                                                                                                                                    | 409 `RED_TROP_DE_CORRECTIONS`                 |

`23514` (CHECK) → 400 `REQUETE_INVALIDE` ; `23505` sur les unicités nommées (numéro d'action,
version, nom de créancier) → 409 `CONFLIT` (réessayer) ou `RED_CREANCIER_EN_DOUBLE` ;
`23503` (compte du portail désigné, référence inconnue) → 400.

### 5.4 Fonctions communes (dans `0480`)

Toutes d'invocateur (`LANGUAGE plpgsql`, sans `SECURITY DEFINER`).

| Fonction                                    | Rôle                                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refuser_modification_redressement()`       | `RAISE EXCEPTION … USING ERRCODE = 'MPZ01'` ; branchée `BEFORE UPDATE OR DELETE` sur les tables « ajout seul »                                                                                            |
| `red_controler_mission_ouverte()`           | `BEFORE INSERT` (et `UPDATE` des tables modifiables sauf `red_dossiers`) : lit `NEW.dossier_id` par `to_jsonb(NEW) ->> 'dossier_id'`, refuse (`MPZ03`) si la mission du dossier est `cloturee` **ou** si le dossier est `clos` |
| `red_controler_plafond()`                   | `BEFORE INSERT`, `TG_ARGV` = (colonne parente, maximum, libellé) : `count(*)` des lignes de la table pour ce parent, `MPZ10` si ≥ maximum (modèle `controler_kpi_noeud`)                                  |
| `red_controler_version()`                   | `BEFORE INSERT`, `TG_ARGV[0]` = colonne parente : `NEW.version` doit valoir `max(version) + 1` du parent, sinon `MPZ05` (modèle `controler_version_banque_ao`, `0380`)                                    |
| `red_valideur_dispense(p_utilisateur uuid)` | `LANGUAGE sql STABLE SET search_path = public, pg_temp` : vrai si l'utilisateur est **actif** et `'associe' = ANY (roles)` (modèle `plan_valideur_dispense`)                                              |

Concurrence : **toute écriture sur un dossier prend d'abord** le verrou consultatif
`pg_advisory_xact_lock(hashtextextended('redressement:' || dossier_id, 0))`
(`verrouillerDossierRedressement`, modèle `dossier/acces.ts`) ; les seuils d'un secteur prennent
`'redressement_seuils:' || cabinet_id || ':' || secteur`. Les déclencheurs (numérotation, plafonds)
sont le filet si le code l'oubliait ; une collision d'unicité est traduite en 409 `CONFLIT`.

### 5.5 `0480` — `red_dossiers`

| Colonne                                            | Type / contrainte                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission_id`                                       | `uuid NOT NULL`, FK `(cabinet_id, mission_id) → missions`                                                                                                             |
| `client_id`                                        | `uuid NOT NULL`, FK `(cabinet_id, client_id) → clients`                                                                                                               |
| `intitule`                                         | `text NOT NULL CHECK (length(btrim(intitule)) BETWEEN 1 AND 200)`                                                                                                     |
| `secteur`                                          | `text NOT NULL DEFAULT 'general' CHECK (secteur IN ('general','industrie','commerce','services','btp','agriculture'))`                                                |
| `devise`                                           | `text NOT NULL CHECK (devise IN ('XOF','XAF','EUR','USD'))` (copie de la devise de la mission à la création, figée)                                                  |
| `statut`                                           | `text NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert','diagnostic','plan_valide','mise_en_oeuvre','clos'))`                                                      |
| `motif_cloture`, `clos_le`, `clos_par`             | `text ≤ 1000`, `timestamptz`, `uuid` ; `CHECK ((statut = 'clos') = (clos_le IS NOT NULL AND clos_par IS NOT NULL AND motif_cloture IS NOT NULL))`                     |
| `cree_par`, `cree_le`, `modifie_par`, `modifie_le` | utilisateurs (FK composites), horodatages                                                                                                                             |

`UNIQUE (cabinet_id, mission_id)` (**un dossier par mission**). Index
`(cabinet_id, cree_le DESC, id DESC)` (liste paginée) et `(cabinet_id, client_id)`.
`REVOKE DELETE`. Pas d'« ajout seul » : le dossier est vivant, borné par le déclencheur
`red_dossiers_controle BEFORE INSERT OR UPDATE` :

- `INSERT` : `missions.client_id = NEW.client_id` sinon `MPZ02` ; mission non clôturée sinon
  `MPZ03` ; `NEW.statut = 'ouvert'` sinon `MPZ06`.
- `UPDATE` : `mission_id`, `client_id`, `devise`, `cree_par`, `cree_le` figés (`MPZ04`) ; mission
  non clôturée sinon `MPZ03` (aucune exception : le dossier d'une mission clôturée est en lecture
  seule) ; transitions de `statut` : `ouvert → diagnostic`, `diagnostic → plan_valide`,
  `plan_valide → mise_en_oeuvre`, et `tout statut sauf clos → clos` ; `clos` est terminal ; tout
  autre changement `MPZ06` ; `plan_valide` et `mise_en_oeuvre` exigent
  `EXISTS (red_plan_versions WHERE dossier_id = NEW.id AND statut = 'valide')` sinon `MPZ06`.
  `intitule` et `secteur` restent modifiables (le secteur ne rétroagit pas : un score garde
  son instantané de seuils).

### 5.6 `0481` — `red_correspondances` (ajout seul)

Correspondance « poste de ratio ← codes des lignes d'état du client », une version par
enregistrement (la dernière est la courante).

| Colonne               | Type / contrainte                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dossier_id`          | `uuid NOT NULL`, FK `(cabinet_id, dossier_id) → red_dossiers (cabinet_id, id)`                                                                                                          |
| `version`             | `int NOT NULL CHECK (version >= 1)`, `UNIQUE (cabinet_id, dossier_id, version)`                                                                                                         |
| `postes`              | `jsonb NOT NULL`, objet, `octet_length <= 20000` : `{ "<poste>": { "codes": ["BB"], "sans_objet": false } }` (forme validée par `redCorrespondanceCreationSchema` et le moteur)          |
| `motif`               | `text` ≤ 500                                                                                                                                                                           |
| `cree_par`, `cree_le` | utilisateur, horodatage                                                                                                                                                                |

Déclencheurs `BEFORE INSERT` : `red_controler_mission_ouverte`, `red_controler_version('dossier_id')`,
`red_controler_plafond('dossier_id', 100, …)` ; `BEFORE UPDATE OR DELETE` :
`refuser_modification_redressement`. `REVOKE UPDATE, DELETE`.

### 5.7 `0482` — `red_urgences` (ajout seul)

| Colonne                | Type / contrainte                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `dossier_id`           | FK composite vers `red_dossiers`                                                                                |
| `grille_version`       | `int NOT NULL CHECK (grille_version >= 1)` (version de la grille du moteur au moment de la saisie)              |
| `reponses`             | `jsonb NOT NULL`, objet, ≤ 4000 octets : `{ "T1": "oui", "T2": "non", … }`                                      |
| `resultat`             | `jsonb NOT NULL`, objet, ≤ 8000 octets : sortie de `evaluerUrgence` (domaines, pourcentages, voyants)           |
| `voyant`               | `text NOT NULL CHECK (voyant IN ('vert','orange','rouge','non_evalue'))` (copie du voyant global, pour filtrer) |
| `duree_secondes`       | `int CHECK (duree_secondes BETWEEN 0 AND 86400)` (facultative, mesure du « moins de 15 minutes »)               |
| `commentaire`          | `text` ≤ 2000                                                                                                   |
| `saisi_par`, `cree_le` | utilisateur, horodatage                                                                                         |

Index `(cabinet_id, dossier_id, cree_le DESC, id DESC)`. Déclencheurs : mission ouverte,
plafond **200** par dossier, ajout seul. `REVOKE UPDATE, DELETE`.

### 5.8 `0483` — `red_seuils_versions` et `red_scores`

**`red_seuils_versions`** : seuils d'alerte d'un secteur, par cabinet, versionnés.

| Colonne                     | Type / contrainte                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `secteur`                   | `text NOT NULL`, même liste que `red_dossiers.secteur`                                                                     |
| `version`                   | `int NOT NULL CHECK (version >= 1)`, `UNIQUE (cabinet_id, secteur, version)`                                               |
| `seuils`                    | `jsonb NOT NULL`, objet, ≤ 8000 octets : forme de `SeuilsAlerte` (§6.5), **revalidée par `validerSeuilsAlerte` côté API** |
| `statut`                    | `text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','publiee'))`                                              |
| `motif`                     | `text` ≤ 500                                                                                                               |
| `cree_par`, `cree_le`       | auteur de la version                                                                                                       |
| `publiee_par`, `publiee_le` | `uuid`, `timestamptz` ; `CHECK ((statut = 'publiee') = (publiee_par IS NOT NULL AND publiee_le IS NOT NULL))`              |

Déclencheur `red_seuils_controle BEFORE INSERT OR UPDATE OR DELETE` :
`INSERT` : `statut = 'brouillon'` (`MPZ06`) ; `version = max + 1` **par (cabinet, secteur)** (`MPZ05`) ;
au plus 50 versions par secteur (`MPZ10`). `UPDATE` : seule la transition `brouillon → publiee`
est admise (`MPZ06`) ; `secteur`, `version`, `seuils`, `motif`, `cree_par`, `cree_le` identiques
(`MPZ04`) ; la version publiée doit être **la dernière** du secteur (`MPZ05`) ;
`publiee_par` est un utilisateur **actif** au rôle `expert_metier` ou `associe`, et
`publiee_par <> cree_par` sauf `red_valideur_dispense(publiee_par)` (`MPZ07`). `DELETE` : `MPZ01`.
Droits : `REVOKE UPDATE, DELETE` puis
`GRANT UPDATE (statut, publiee_par, publiee_le) ON red_seuils_versions TO missionpilot_app`
(modèle `0271`, `copilote_actions`). La version « en vigueur » d'un secteur est la plus haute
version `publiee` ; sans version publiée, le moteur applique `SEUILS_ALERTE_DEFAUT`.
Index `(cabinet_id, secteur, version DESC)`.

**`red_scores`** : un enregistrement par calcul, conservé avec ses entrées (ajout seul).

| Colonne                  | Type / contrainte                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dossier_id`             | FK composite vers `red_dossiers`                                                                                                                               |
| `secteur`                | `text NOT NULL`, même `CHECK` de liste que `red_dossiers.secteur` (secteur du dossier **au moment du calcul**)                                                                                                   |
| `seuils_version_id`      | `uuid NULL`, FK `(cabinet_id, seuils_version_id) → red_seuils_versions` ; NULL si seuils du moteur                                                             |
| `seuils_source`          | `text NOT NULL CHECK (seuils_source IN ('cabinet','defaut_moteur'))` ; `CHECK ((seuils_source = 'cabinet') = (seuils_version_id IS NOT NULL))`                  |
| `seuils`                 | `jsonb NOT NULL`, objet, ≤ 8000 octets : **instantané complet** des seuils appliqués (reproductible même si les défauts du moteur changent)                    |
| `version_moteur`         | `int NOT NULL CHECK (version_moteur >= 1)` (`VERSION_MOTEUR_ALERTE`)                                                                                            |
| `date_reference`         | `date NOT NULL` (bornée)                                                                                                                                       |
| `entrees`                | `jsonb NOT NULL`, objet, ≤ 20000 octets : `{ exercice_reference, etat_id, correspondance_version, ratios, tendances, incidents, analyses_indicatives, devise }` |
| `resultat`               | `jsonb NOT NULL`, objet, ≤ 12000 octets : sortie complète de `calculerScoreAlerte`                                                                             |
| `score`                  | `smallint CHECK (score BETWEEN 0 AND 100)` ; NULL seulement si `niveau = 'insuffisant'`                                                                        |
| `niveau`                 | `text NOT NULL CHECK (niveau IN ('insuffisant','faible','modere','eleve','critique'))` ; `CHECK ((niveau = 'insuffisant') = (score IS NULL))`                  |
| `calcule_par`, `cree_le` | utilisateur, horodatage                                                                                                                                        |

Déclencheur `BEFORE INSERT` : si `seuils_version_id` n'est pas nul, la version doit être `publiee`,
du même `secteur`, et `seuils` doit être **égal** (`jsonb =`) à ceux de la version, sinon `MPZ02` ;
mission ouverte ; plafond **500** par dossier ; ajout seul. Index
`(cabinet_id, dossier_id, cree_le DESC, id DESC)`. `REVOKE UPDATE, DELETE`.

### 5.9 `0484` — créanciers et négociations (RED-12)

**`red_creanciers`** (registre ; identité figée, quelques champs vivants).
Colonnes : `dossier_id` (FK composite) ; `nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 200)` ;
`categorie text NOT NULL CHECK (categorie IN ('fournisseur','banque','fiscal','social','bailleur','autre'))` ;
`garanti boolean NOT NULL DEFAULT false` ; `reference text` ≤ 120 ; `actif boolean NOT NULL DEFAULT true` ;
`cree_par`, `cree_le`, `modifie_par`, `modifie_le`.
`UNIQUE (cabinet_id, dossier_id, id)` ; index unique `red_creanciers_nom_uniq` sur
`(cabinet_id, dossier_id, lower(nom), categorie)` (→ `RED_CREANCIER_EN_DOUBLE`). Déclencheur
`BEFORE INSERT OR UPDATE` : mission ouverte ; plafond **200** ; à l'`UPDATE`, `dossier_id`,
`categorie`, `cree_par`, `cree_le` figés (`MPZ04`) ; `modifie_le := now()`. `REVOKE DELETE` seulement
(nom, garantie, référence, actif sont modifiables et journalisés).

**`red_creances`** (ajout seul) : une version de la créance courante par enregistrement.
`dossier_id`, `creancier_id` (FK composite `(cabinet_id, dossier_id, creancier_id)`) ;
`version int NOT NULL CHECK (version >= 1)`, `UNIQUE (cabinet_id, creancier_id, version)` ;
`principal bigint NOT NULL CHECK (principal BETWEEN 0 AND 10^13)` ; `interets bigint NOT NULL DEFAULT 0
CHECK (interets BETWEEN 0 AND 10^13)` ; `date_arrete date NOT NULL` (bornée) ;
`echeance_initiale date` (bornée, facultative) ; `nature text` ≤ 200 ; `commentaire text` ≤ 1000 ;
`saisi_par`, `cree_le`. Déclencheurs : `red_controler_version('creancier_id')`, mission ouverte,
plafond **100** versions par créancier, ajout seul.

**`red_negociation_evenements`** (ajout seul) : fil de la négociation d'un créancier.

| Colonne                      | Type / contrainte                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dossier_id`, `creancier_id` | FK composite `(cabinet_id, dossier_id, creancier_id) → red_creanciers`                                                                         |
| `type`                       | `text NOT NULL CHECK (type IN ('ouverture','proposition','contre_proposition','accord','rupture','paiement','note'))`                          |
| `date_evenement`             | `date NOT NULL` (bornée)                                                                                                                       |
| `montant`                    | `bigint CHECK (montant BETWEEN 0 AND 10^13)` : montant proposé, convenu (accord) ou payé (paiement)                                            |
| `conditions`                 | `text` ≤ 2000 (garanties, intérêts, clause de déchéance, motif de rupture) : **jamais journalisé**                                             |
| `accord_id`                  | `uuid`, FK `(cabinet_id, dossier_id, accord_id) → red_negociation_evenements (cabinet_id, dossier_id, id)` (auto-référence)                    |
| `echeance_rang`              | `smallint CHECK (echeance_rang BETWEEN 1 AND 60)` (paiement rattaché à une échéance)                                                           |
| `auteur_id`, `cree_le`       | utilisateur, horodatage                                                                                                                        |

`UNIQUE (cabinet_id, dossier_id, id)`. `CHECK` par type :

```sql
CHECK (CASE type
  WHEN 'accord'   THEN montant > 0 AND accord_id IS NULL AND echeance_rang IS NULL
  WHEN 'paiement' THEN montant > 0 AND accord_id IS NOT NULL
  WHEN 'rupture'  THEN accord_id IS NOT NULL AND montant IS NULL AND echeance_rang IS NULL
  ELSE accord_id IS NULL AND echeance_rang IS NULL END)
```

Déclencheur `BEFORE INSERT` (`MPZ09`) : un `accord` n'est admis que si le créancier n'a **aucun accord
en vigueur** (un accord est en vigueur tant qu'aucune `rupture` ne le référence) ; un `paiement` ou une
`rupture` doit viser un `accord` du **même créancier**, non rompu ; `echeance_rang` doit exister dans
`red_echeances` de cet accord ; mission ouverte ; plafond **300** par créancier ; ajout seul.

**`red_echeances`** (ajout seul) : échéancier convenu d'un accord, écrit dans la transaction de
l'accord. `dossier_id`, `creancier_id`, `accord_id` (FK composites) ; `rang smallint CHECK (rang BETWEEN 1 AND 60)` ;
`date_echeance date NOT NULL` (bornée) ; `montant bigint NOT NULL CHECK (montant BETWEEN 1 AND 10^13)` ;
`UNIQUE (accord_id, rang)` ; `UNIQUE (cabinet_id, dossier_id, id)`. Déclencheur `BEFORE INSERT`
(`MPZ09`) : l'événement `accord_id` est de type `accord`, du même créancier, **créé dans la même
transaction** (`cree_le = now()`, comme `controler_dossier_etat_ligne`, `0222`) ; plafond **60** par
accord ; ajout seul. **La cohérence « somme des échéances = montant convenu » n'est pas vérifiée en
SQL** (pas de calcul en base) : elle l'est par `validerEcheancierAccord` (§6.7) avant l'écriture.

### 5.10 `0485` — trésorerie à 13 semaines (RED-11)

**`red_tresorerie_versions`** (ajout seul) : une prévision, fenêtre de 13 semaines.
`dossier_id` ; `version int` (consécutive, `red_controler_version('dossier_id')`) ;
`date_debut date NOT NULL CHECK (EXTRACT(isodow FROM date_debut) = 1 AND date_debut BETWEEN '2000-01-01' AND '2100-12-31')`
(lundi de la semaine 1) ; `solde_initial bigint NOT NULL CHECK (solde_initial BETWEEN -10^13 AND 10^13)` (peut être
négatif : découvert) ; `seuil_tension bigint NOT NULL DEFAULT 0 CHECK (seuil_tension BETWEEN 0 AND 10^13)` ;
`motif text` ≤ 500 ; `cree_par`, `cree_le`. `UNIQUE (cabinet_id, dossier_id, version)`,
`UNIQUE (cabinet_id, dossier_id, id)`. Plafond **200** versions par dossier. Une **nouvelle version
par fenêtre glissante** : la date de début peut avancer d'une version à l'autre.

**`red_tresorerie_lignes`** (ajout seul) : flux prévus.
`dossier_id`, `version_id` (FK `(cabinet_id, dossier_id, version_id) → red_tresorerie_versions`) ;
`rang smallint CHECK (rang BETWEEN 1 AND 600)`, `UNIQUE (version_id, rang)` ;
`semaine smallint NOT NULL CHECK (semaine BETWEEN 1 AND 13)` ;
`sens text NOT NULL CHECK (sens IN ('encaissement','decaissement'))` ;
`categorie text NOT NULL` avec
`CHECK (CASE sens WHEN 'encaissement' THEN categorie IN ('clients','autres_encaissements','financement','cessions') ELSE categorie IN ('fournisseurs','salaires','fiscal_social','loyers_charges','service_dette','investissements','autres_decaissements') END)` ;
`libelle text` ≤ 200 ; `montant bigint NOT NULL CHECK (montant BETWEEN 1 AND 10^13)` ;
`creancier_id uuid`, `echeance_id uuid` (FK composites `(cabinet_id, dossier_id, …)` vers
`red_creanciers` et `red_echeances`) ; `CHECK (echeance_id IS NULL OR creancier_id IS NOT NULL)`.
Déclencheur `BEFORE INSERT` : la version doit avoir été créée dans la **même transaction**
(`cree_le = now()`), sinon `MPZ01` ; plafond **600** par version (`MPZ10`) ; si `echeance_id` n'est
pas nul, l'échéance doit appartenir à `creancier_id` (`MPZ02`) ; ajout seul.

**`red_tresorerie_realises`** (ajout seul) : réalisé d'une semaine ; une correction est une nouvelle
ligne qui **remplace** la précédente (modèle `dossier_etats_financiers`, `kpi_mesures`).
`dossier_id` ; `semaine_debut date NOT NULL CHECK (EXTRACT(isodow FROM semaine_debut) = 1 AND semaine_debut BETWEEN '2000-01-01' AND '2100-12-31')` ;
`flux jsonb NOT NULL`, objet, ≤ 4000 octets :
`{ "encaissement": { "clients": 1200000 }, "decaissement": { "salaires": 800000 } }` (catégories
des listes ci-dessus, entiers ≥ 0, validés par `redRealiseCreationSchema`) ;
`solde_constate bigint CHECK (solde_constate BETWEEN -10^13 AND 10^13)` (solde bancaire de fin de
semaine, facultatif : il **ancre** le solde retenu et révèle l'écart de rapprochement) ;
`remplace_id uuid`, FK composite `(cabinet_id, dossier_id, remplace_id)` auto-référencée,
`UNIQUE (remplace_id)` ; `commentaire text` ≤ 1000 ; `saisi_par`, `cree_le`.
Déclencheur `BEFORE INSERT` : la ligne **courante** d'une semaine est celle qu'aucune autre ne remplace ;
`NEW.remplace_id` doit valoir la courante de la même `semaine_debut` (ou NULL s'il n'y en a pas), sinon
`MPZ08` ; au plus **11** lignes (une initiale et 10 corrections) par `(dossier_id, semaine_debut)`
(`MPZ11`) ; plafond **1000** lignes par dossier (`MPZ10`) ; mission ouverte ; ajout seul.
La **contiguïté** des semaines réalisées est une règle d'API (§9.7) et du moteur, pas de la base.

### 5.11 `0486` — plan et kanban (RED-05, RED-07)

**`red_actions`** (vivante, bornée ; modèle `kpi_actions`, `0442`).

| Colonne                                            | Type / contrainte                                                                                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dossier_id`                                       | FK composite                                                                                                                                                                                                                            |
| `numero`                                           | `int NOT NULL`, attribué par le déclencheur (`max + 1` du dossier), `UNIQUE (cabinet_id, dossier_id, numero)`                                                                                                                           |
| `titre`, `description`                             | `text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200)`, `text` ≤ 2000                                                                                                                                                           |
| `volet`                                            | `text NOT NULL CHECK (volet IN ('quick_win','restructuration'))`                                                                                                                                                                        |
| `domaine`                                          | `text NOT NULL CHECK (domaine IN ('tresorerie','activite','exploitation','social','financement'))` (les cinq domaines de l'urgence)                                                                                                     |
| `echeance`                                         | `date NOT NULL` (bornée)                                                                                                                                                                                                                |
| `statut`                                           | `text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire','en_cours','bloquee','terminee','abandonnee'))`                                                                                                                            |
| `rang`                                             | `int NOT NULL DEFAULT 0 CHECK (rang BETWEEN 0 AND 100000)` (ordre dans la colonne du kanban)                                                                                                                                            |
| `responsable_id`                                   | `uuid NOT NULL` (FK composite ; `refuser_utilisateur_portail('responsable_id')`)                                                                                                                                                        |
| `levier_code`, `levier_parametres`, `impact`       | `text` (`~ '^[a-z0-9_]{1,40}$'`), `jsonb` ≤ 2000 octets, `jsonb` ≤ 4000 octets : `CHECK ((levier_code IS NULL) = (levier_parametres IS NULL) AND (levier_code IS NULL) = (impact IS NULL))` ; `impact` = sortie du moteur (§6.9) avec la base utilisée |
| `motif`, `termine_le`                              | `text` ≤ 1000 ; `date` (bornée) ; `CHECK ((statut = 'terminee') = (termine_le IS NOT NULL))`, `CHECK (statut NOT IN ('bloquee','abandonnee') OR motif IS NOT NULL)`                                                                       |
| `tache_collaboration_id`                           | `uuid`, FK composite `(cabinet_id, tache_collaboration_id) → taches_collaboration`                                                                                                                                                      |
| `cree_par`, `cree_le`, `modifie_par`, `modifie_le` | utilisateurs, horodatages                                                                                                                                                                                                               |

`UNIQUE (cabinet_id, dossier_id, id)`. Index `(cabinet_id, dossier_id, statut, rang, echeance, id)`.
Déclencheur `red_actions_controle BEFORE INSERT OR UPDATE` : mission ouverte ; `INSERT` : statut
`a_faire` (`MPZ06`), numéro, plafond **300** par dossier ; `UPDATE` : `dossier_id`, `numero`,
`cree_par`, `cree_le` figés (`MPZ04`) ; un état `terminee` ou `abandonnee` ne change plus
(`MPZ06`) ; transitions admises : `a_faire → en_cours | bloquee | terminee | abandonnee`,
`en_cours → bloquee | terminee | abandonnee`, `bloquee → en_cours | abandonnee`.

**`red_action_evenements`** (ajout seul, modèle `kpi_action_evenements`) : `dossier_id`, `action_id`
(FK composite) ; `type CHECK IN ('creation','statut','modification','commentaire')` ; `statut_avant text` ;
`statut_apres text NOT NULL` ; `commentaire text` ≤ 1000 ; `auteur_id`, `cree_le`. Plafond **200** par
action ; mission ouverte ; ajout seul.

**`red_plan_versions`** : un instantané du plan soumis à validation.

| Colonne                                       | Type / contrainte                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dossier_id`, `version`                       | FK composite ; `int` consécutive (`red_controler_version('dossier_id')`), `UNIQUE (cabinet_id, dossier_id, version)`                                              |
| `date_reference`                              | `date NOT NULL` (bornée) : origine des fenêtres 6 et 24 mois                                                                                                     |
| `contenu`                                     | `jsonb NOT NULL`, objet, ≤ 120000 octets : sortie de `serialiserPlanCanonique` (§6.8), **construite par le code depuis les lignes `red_actions`**, jamais reçue |
| `empreinte`                                   | `text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$')` : SHA-256 de la forme canonique, calculée par l'API                                                         |
| `statut`                                      | `text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','valide'))`                                                                                     |
| `cree_par`, `cree_le`                         | auteur de la version                                                                                                                                             |
| `valide_par`, `valide_le`, `motif_validation` | `uuid`, `timestamptz`, `text` ≤ 2000 ; `CHECK ((statut = 'valide') = (valide_par IS NOT NULL AND valide_le IS NOT NULL))`                                        |

Déclencheur `BEFORE INSERT OR UPDATE OR DELETE` : `INSERT` : `statut = 'brouillon'`, version consécutive,
plafond **100**, mission ouverte ; `UPDATE` : seule `brouillon → valide` (`MPZ06`) ; `contenu`, `empreinte`,
`date_reference`, `version`, `cree_par`, `cree_le` identiques (`MPZ04`) ; **dernière version seulement**
(`MPZ05`) ; `valide_par` actif, au rôle `associe` ou `directeur_mission`, et `valide_par <> cree_par` sauf
`red_valideur_dispense(valide_par)` (`MPZ07`) ; `DELETE` : `MPZ01`. Droits : `REVOKE UPDATE, DELETE`
puis `GRANT UPDATE (statut, valide_par, valide_le, motif_validation) ON red_plan_versions TO missionpilot_app`.
Index `(cabinet_id, dossier_id, version DESC)`.

### 5.12 Tests de base (agent 2, `apps/api/test/redressement-base.test.ts`)

Avec le **rôle applicatif réel** (pas le propriétaire), un test par ligne :

1. un cabinet B ne voit ni n'insère dans aucune des quinze tables (RLS) ; une FK composite vers une ligne d'un autre cabinet échoue ;
2. dans une transaction du portail (`app.portail_client_id` posé), `SELECT` et `INSERT` sur chaque table échouent (`portail_interdit`) ;
3. `UPDATE` et `DELETE` refusés (`MPZ01` ou privilège) sur chaque table « ajout seul » ; `DELETE` refusé partout ;
4. dossier : mission et client incohérents (`MPZ02`), mission clôturée (`MPZ03`), transitions (`MPZ06`), `plan_valide` sans version validée (`MPZ06`), champs figés (`MPZ04`), deuxième dossier pour la même mission (23505) ;
5. versions non consécutives (`MPZ05`) pour correspondances, trésorerie, plan, seuils (par secteur) ;
6. seuils : publication par l'auteur refusée (`MPZ07`), acceptée pour un associé auteur ; publication par un `consultant` refusée ; publication d'une version qui n'est pas la dernière refusée (`MPZ05`) ; contenu modifié à la publication refusé (`MPZ04`) ;
7. score : seuils non publiés, d'un autre secteur ou différents de la version refusés (`MPZ02`) ; `niveau = 'insuffisant'` avec un score refusé (CHECK) ;
8. plan : validation par le créateur refusée (`MPZ07`) sauf associé ; par un `chef_mission` refusée (`MPZ07`) ; version obsolète refusée (`MPZ05`) ;
9. négociation : deuxième accord en vigueur refusé, paiement sur un accord d'un autre créancier refusé, paiement après rupture refusé (`MPZ09`) ; échéance insérée hors de la transaction de l'accord refusée ;
10. réalisé : remplacement d'une ligne non courante (`MPZ08`), 12e ligne d'une semaine (`MPZ11`), date non lundi (CHECK) ;
11. lignes de trésorerie : insertion hors de la transaction de la version refusée ; catégorie incompatible avec le sens (CHECK) ; échéance d'un autre créancier (`MPZ02`) ;
12. action : numérotation, transition `terminee → en_cours` refusée, responsable du portail refusé (23503), statut `bloquee` sans motif (CHECK) ;
13. plafonds : un test par plafond (`MPZ10`), avec les valeurs de §9.5 passées en paramètre du déclencheur ;
14. mission clôturée **ou** dossier `clos` : insertion dans chaque table fille refusée (`MPZ03`).

`isolation.test.ts` et `portail-acces.test.ts` ne sont **pas modifiés** : leurs inventaires
dynamiques couvrent les nouvelles tables et routes. Le test `fichiers-orphelins-references.test.ts`
n'est pas concerné (aucune colonne `REFERENCES fichiers`).

---

## 6. Moteur `packages/engines/src/redressement/` (agent 1)

### 6.1 Conventions

- Fichiers : `erreurs.ts`, `commun.ts`, `ratios.ts`, `urgence.ts`, `alerte.ts`, `tresorerie.ts`,
  `point-mort.ts`, `creanciers.ts`, `plan.ts`, `leviers.ts`, `index.ts`, et un `*.test.ts` par
  fichier. Imports relatifs **sans extension** (comme les autres moteurs). Ajouter
  `export * from "./redressement/index";` à `packages/engines/src/index.ts` (une ligne).
- **Fonctions pures** : pas d'horloge (la date de référence est un paramètre), pas d'E/S, pas
  d'aléa. Mêmes entrées, même sortie ; tableaux rendus dans un ordre stable (celui des listes
  constantes).
- **Nombres** : entiers (`Number.isSafeInteger`). Les sommes et produits passent par `BigInt` ;
  tout résultat hors `Number.MAX_SAFE_INTEGER` lève `SOMME_HORS_LIMITES`. Les ratios sont des
  **points de base** entiers (10 000 = 1, comme `bancabilite.ts`) ; le BFR est en jours entiers sur
  360. Division : `diviserArrondi` de `../finance/calcul-exact` (demi s'éloignant de zéro, symétrique :
  −0,5 → −1). Aucun `Math.round`, aucun `toFixed`, aucune virgule flottante dans un résultat.
- **Dates** : `DateISO` de `../commun/dates` ; validation par `analyserDateISO` ; lundi par
  `jourSemaineDepuisJourUTC(jourUTC) === 1` ; mois par `ajouterMois` de `../finance/dates`. Une date
  invalide lève `ErreurRedressement("DATE_INVALIDE")` (le moteur ne fait pas remonter la
  `RangeError` du planning ni l'`ErreurFinance`).
- **Noms exportés** : tous préfixés ou suffixés « Redressement / Red » quand un homonyme existe
  (`StatutRatio` existe déjà dans `plan-strategique` : le lot utilise `StatutRatioRedressement`).
  Vérification faite : aucun des noms ci-dessous n'existe dans `engines/src`.
- **Constantes de version** : `VERSION_MOTEUR_REDRESSEMENT = 1` (commun), `VERSION_GRILLE_URGENCE = 1`,
  `VERSION_MOTEUR_ALERTE = 1`, `VERSION_CATALOGUE_LEVIERS = 1`. Un changement de règle de calcul
  incrémente la constante concernée (elle est stockée avec les scores et les urgences).
- Couverture ≥ 90 % (lignes, fonctions, branches, instructions : `vitest.config.ts`). Les valeurs des
  tests ci-dessous sont **calculées à la main** ; l'agent 1 les reprend telles quelles et ne les « ajuste »
  pas pour faire passer le code.

### 6.2 `erreurs.ts`

```ts
export type CodeErreurRedressement =
  | "MONTANT_INVALIDE" | "SOMME_HORS_LIMITES" | "ENTREE_INVALIDE" | "DATE_INVALIDE"
  | "POSTE_INCONNU" | "CORRESPONDANCE_INVALIDE" | "ETAT_INVALIDE"
  | "QUESTION_INCONNUE" | "REPONSE_INVALIDE" | "SEUILS_INVALIDES"
  | "SEMAINE_INVALIDE" | "TRESORERIE_INVALIDE" | "REALISE_NON_CONTIGU"
  | "ECHEANCIER_INVALIDE" | "ACCORD_SUPERIEUR_CREANCE" | "PAIEMENT_EXCESSIF" | "ACCORD_ROMPU" | "PLAN_INVALIDE"
  | "LEVIER_INCONNU" | "PARAMETRES_LEVIER_INVALIDES" | "BASE_INCOMPLETE";

export class ErreurRedressement extends Error {
  readonly code: CodeErreurRedressement;
  /** Postes ou champs absents (BASE_INCOMPLETE, CORRESPONDANCE_INVALIDE) : rendus en `details.manquants`. */
  readonly manquants: readonly string[];
  constructor(code: CodeErreurRedressement, message: string, manquants: readonly string[] = []);
}
```

Un **écart de données** (ratio non calculable, score insuffisant, semaine de tension) n'est
**jamais** une erreur : c'est un constat rendu par le moteur. Une entrée mal formée l'est.

### 6.3 `ratios.ts` — RED-02

```ts
import type { Devise } from "../finance/monnaie";

export const POSTES_RATIO_REDRESSEMENT = [
  "stocks", "creances_clients", "autres_creances", "tresorerie_actif",
  "capital", "capitaux_propres", "dettes_financieres", "dettes_fournisseurs", "dettes_court_terme",
  "chiffre_affaires", "cout_ventes", "resultat_exploitation", "charges_financieres", "resultat_net",
] as const;
export type PosteRatioRedressement = (typeof POSTES_RATIO_REDRESSEMENT)[number];

export interface AffectationPoste {
  readonly codes: readonly string[];     // codes de lignes de l'état du client ; vide si sansObjet
  readonly sansObjet: boolean;           // le poste n'existe pas chez ce client : vaut 0, jamais « manquant »
}
export type CorrespondancePostes = Readonly<Partial<Record<PosteRatioRedressement, AffectationPoste>>>;

export interface EtatPourRatios {
  readonly exercice: number;                                  // entier 1990..2100
  readonly devise: Devise;
  readonly lignes: readonly { readonly code: string; readonly montant: number }[];  // |montant| ≤ 10^15
  readonly totalActif: number | null;                         // `totaux.actif` de l'état contrôlé
  readonly totalPassif: number | null;                        // `totaux.passif`
  readonly resultatNet: number | null;                        // `totaux.resultat` (net déclaré, sinon produits − charges)
}

export function validerCorrespondance(c: CorrespondancePostes): void;

/** Proposition indicative, bâtie sur REFERENCES_SYSCOHADA (plan-strategique/modele.ts), « à confirmer par un expert-comptable ». */
export const CORRESPONDANCE_SYSCOHADA_INDICATIVE: CorrespondancePostes;

export interface PostesAgreges {
  readonly valeurs: Readonly<Partial<Record<PosteRatioRedressement, number>>>;
  readonly manquants: readonly PosteRatioRedressement[];      // dans l'ordre de POSTES_RATIO_REDRESSEMENT
}
export function agregerPostes(etat: EtatPourRatios, correspondance: CorrespondancePostes): PostesAgreges;

export const CLES_RATIO_REDRESSEMENT = [
  "liquidite_generale", "liquidite_reduite", "liquidite_immediate",
  "autonomie_financiere", "solvabilite_generale", "endettement",
  "marge_brute", "marge_nette", "couverture_charges_financieres", "bfr_jours",
] as const;
export type CleRatioRedressement = (typeof CLES_RATIO_REDRESSEMENT)[number];

export type StatutRatioRedressement = "calcule" | "sans_objet" | "non_calculable" | "non_significatif";
export type RaisonRatioRedressement =
  | "postes_manquants" | "totaux_absents" | "denominateur_non_positif" | "sans_dette" | "sans_charges_financieres";

export interface RatioRedressement {
  readonly valeur: number | null;                 // pb (BFR : jours) ; null sauf statut « calcule »
  readonly statut: StatutRatioRedressement;
  readonly raison: RaisonRatioRedressement | null;
  readonly manquants: readonly PosteRatioRedressement[];   // non vide seulement si raison = postes_manquants
}
export interface RatiosExercice {
  readonly exercice: number;
  readonly devise: Devise;
  readonly postes: Readonly<Partial<Record<PosteRatioRedressement, number>>>;
  readonly ratios: Readonly<Record<CleRatioRedressement, RatioRedressement>>;
}
export function calculerRatiosRedressement(etat: EtatPourRatios, correspondance: CorrespondancePostes): RatiosExercice;

export type RaisonTendance = "devises_differentes" | "exercice_precedent_absent";
export interface TendancesRedressement {
  readonly croissanceCaPb: number | null;          // (CA − CA précédent) / CA précédent, pb
  readonly variationMargeBrutePb: number | null;   // marge brute − marge brute précédente, pb (différence des valeurs rendues)
  readonly raison: RaisonTendance | null;
}
export function calculerTendancesRedressement(
  courant: RatiosExercice, precedent: RatiosExercice | null,
): TendancesRedressement;
```

**Règles.**

- `validerCorrespondance` lève `POSTE_INCONNU` (clé hors liste) ou `CORRESPONDANCE_INVALIDE` (code
  hors `^[A-Za-z0-9_.-]{1,40}$`, doublon dans un poste, plus de 50 codes, `sansObjet` avec des
  codes, ni codes ni `sansObjet`). Un même code peut figurer dans plusieurs postes.
- `agregerPostes` : un poste `sansObjet` vaut 0 ; un poste à codes vaut la **somme signée** des
  montants des lignes de ces codes (comme importés) ; un code **absent de l'état** rend le poste
  « manquant » (jamais 0) ; un poste absent de la correspondance est « manquant », sauf
  `resultat_net` qui retombe sur `etat.resultatNet` s'il n'est pas nul. Un code en double dans
  `etat.lignes`, un exercice hors 1990–2100 ou un montant non entier lèvent `ETAT_INVALIDE` /
  `MONTANT_INVALIDE`.
- Postes requis par ratio (un poste manquant rend le ratio `non_calculable`, raison
  `postes_manquants`, avec la liste) :

  | Ratio                            | Formule (points de base sauf BFR)                                                  | Requis                                                                    |
  | -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | `liquidite_generale`             | (stocks + créances clients + autres créances + trésorerie actif) / dettes court terme | `stocks`, `creances_clients`, `autres_creances`, `tresorerie_actif`, `dettes_court_terme` |
  | `liquidite_reduite`              | (créances clients + autres créances + trésorerie actif) / dettes court terme        | `creances_clients`, `autres_creances`, `tresorerie_actif`, `dettes_court_terme` |
  | `liquidite_immediate`            | trésorerie actif / dettes court terme                                               | `tresorerie_actif`, `dettes_court_terme`                                  |
  | `autonomie_financiere`           | capitaux propres / total passif                                                     | `capitaux_propres`, `totalPassif`                                         |
  | `solvabilite_generale`           | total actif / (total passif − capitaux propres)                                     | `capitaux_propres`, `totalActif`, `totalPassif`                           |
  | `endettement`                    | dettes financières / capitaux propres                                               | `dettes_financieres`, `capitaux_propres`                                  |
  | `marge_brute`                    | (CA − coût des ventes) / CA                                                         | `chiffre_affaires`, `cout_ventes`                                         |
  | `marge_nette`                    | résultat net / CA                                                                   | `chiffre_affaires`, `resultat_net`                                        |
  | `couverture_charges_financieres` | résultat d'exploitation / charges financières                                       | `resultat_exploitation`, `charges_financieres`                            |
  | `bfr_jours`                      | (stocks + créances clients − dettes fournisseurs) × 360 / CA, jours entiers          | `stocks`, `creances_clients`, `dettes_fournisseurs`, `chiffre_affaires`   |

  Total absent (`totalActif` ou `totalPassif` nul) : `non_calculable`, raison `totaux_absents`.
- **Cas limites** (division par zéro, signes) : les trois liquidités avec `dettes_court_terme = 0` →
  `sans_objet` (raison `sans_dette`), avec `dettes_court_terme < 0` → `non_calculable`
  (`denominateur_non_positif`) ; `autonomie_financiere` avec `totalPassif ≤ 0` → `non_calculable` ;
  `solvabilite_generale` avec `totalPassif − capitaux_propres ≤ 0` → `sans_objet` (`sans_dette`) ;
  `endettement` avec `capitaux_propres ≤ 0` → **`non_significatif`** (`denominateur_non_positif` : le
  ratio n'a pas de sens, et c'est lui-même un signal d'alerte), avec `dettes_financieres = 0` → 0 ;
  `marge_brute`, `marge_nette`, `bfr_jours` avec `chiffre_affaires ≤ 0` → `non_calculable` ;
  `couverture_charges_financieres` avec `charges_financieres = 0` → `sans_objet`
  (`sans_charges_financieres`), `< 0` → `non_calculable`. Un ratio n'est **jamais** remplacé par zéro.
- `calculerTendancesRedressement` : `precedent` nul ou d'exercice ≠ `courant.exercice − 1` →
  tout à `null`, raison `exercice_precedent_absent` ; devises différentes → tout à `null`, raison
  `devises_differentes` (pas de conversion implicite) ; `croissanceCaPb` nul si un CA est manquant
  ou si le CA précédent est ≤ 0 ; `variationMargeBrutePb` nul si l'une des deux marges brutes n'est pas
  `calcule`.
- **Devises** : les ratios ne dépendent pas de la devise ; l'exercice porte la sienne pour que les
  consommateurs (tendances, leviers) refusent de mélanger.

**Cas de test attendus** (`ratios.test.ts`).

*Cas A — XOF, tous postes renseignés* : stocks 120 000 000 ; créances clients 240 000 000 ; autres
créances 30 000 000 ; trésorerie actif 60 000 000 ; capital 100 000 000 ; capitaux propres 150 000 000 ;
dettes financières 200 000 000 ; dettes fournisseurs 180 000 000 ; dettes court terme 330 000 000 ;
CA 1 200 000 000 ; coût des ventes 780 000 000 ; résultat d'exploitation 48 000 000 ; charges financières
24 000 000 ; résultat net 18 000 000 ; `totalActif` = `totalPassif` = 800 000 000.

| Ratio                            | Calcul                         | Attendu                |
| -------------------------------- | ------------------------------ | ---------------------- |
| `liquidite_generale`             | 450 / 330 = 1,363636…          | **13636**              |
| `liquidite_reduite`              | 330 / 330                      | **10000**              |
| `liquidite_immediate`            | 60 / 330 = 0,181818…           | **1818**               |
| `autonomie_financiere`           | 150 / 800                      | **1875**               |
| `solvabilite_generale`           | 800 / 650 = 1,230769…          | **12308**              |
| `endettement`                    | 200 / 150 = 1,333333…          | **13333**              |
| `marge_brute`                    | 420 / 1200                     | **3500**               |
| `marge_nette`                    | 18 / 1200                      | **150**                |
| `couverture_charges_financieres` | 48 / 24                        | **20000**              |
| `bfr_jours`                      | (120 + 240 − 180) × 360 / 1200 | **54**                 |

*Autres cas.* (B) `dettes_court_terme` en `sansObjet` : trois liquidités `sans_objet` ; `charges_financieres`
`sansObjet` : couverture `sans_objet` ; `dettes_financieres` `sansObjet` : endettement = 0 `calcule`.
(C) correspondance sans `stocks` : `liquidite_generale` et `bfr_jours` `non_calculable`, `manquants = ["stocks"]`,
les huit autres inchangés. (D) CA = 0 : `marge_brute`, `marge_nette`, `bfr_jours` `non_calculable`.
(E) capitaux propres −10 000 000 : `endettement` `non_significatif`, `autonomie_financiere` −125,
`solvabilite_generale` 800 / 810 = **9877** (9876,54 arrondi). (F) arrondi : résultat net 1, CA 20 000 →
`marge_nette` **1** (0,5 → 1) ; résultat net −1 → **−1**. (G) code de la correspondance absent des lignes :
poste manquant, pas zéro. (H) `resultat_net` non mappé → repris de `etat.resultatNet` ; les deux nuls → manquant.
(I) totaux nuls : `autonomie_financiere` et `solvabilite_generale` `non_calculable` (`totaux_absents`).
(J) `validerCorrespondance` : un cas par erreur listée. (K) deux lignes de même code dans l'état : `ETAT_INVALIDE`.
(L) exercice 1989 : `ETAT_INVALIDE`. (M) somme > 2^53 : `SOMME_HORS_LIMITES`.
(N) **alignement avec `analyserBancabilite`** : mêmes capitaux propres, dettes financières, BFR (180 000 000) et
CA que le cas A → `endettement` 13333 et `bfr_jours` 54 identiques à `ratios.endettement.valeur` et
`ratios.bfr_jours.valeur` de l'autre moteur.
(O) `CORRESPONDANCE_SYSCOHADA_INDICATIVE` : exactement dix postes (`stocks` BB, `creances_clients` BI,
`tresorerie_actif` BT, `capital` CA, `capitaux_propres` CP, `dettes_financieres` DD, `dettes_fournisseurs` DJ,
`chiffre_affaires` XB, `resultat_exploitation` XE, `resultat_net` XI), construits depuis `REFERENCES_SYSCOHADA` ;
pas de proposition pour `autres_creances`, `dettes_court_terme`, `cout_ventes`, `charges_financieres`.
(P) tendances : exercice N (CA 1 200 000 000, marge brute 3500) et N−1 (CA 1 000 000 000, coût des ventes
620 000 000, soit marge brute 3800) → `croissanceCaPb` **2000**, `variationMargeBrutePb` **−300** ; N−2 au lieu de
N−1 → `exercice_precedent_absent` ; devise EUR au précédent → `devises_differentes` ; CA précédent 0 →
`croissanceCaPb` nul, raison nulle.

### 6.4 `urgence.ts` — RED-01

```ts
export const VERSION_GRILLE_URGENCE = 1;
export const DOMAINES_URGENCE = ["tresorerie", "activite", "exploitation", "social", "financement"] as const;
export type DomaineUrgence = (typeof DOMAINES_URGENCE)[number];
export const REPONSES_URGENCE = ["non", "partiellement", "oui", "inconnu"] as const;
export type ReponseUrgence = (typeof REPONSES_URGENCE)[number];
export type VoyantUrgence = "vert" | "orange" | "rouge" | "non_evalue";

export interface QuestionUrgence {
  readonly code: string;            // T1…T3, A1…A3, E1…E3, S1…S3, F1…F3
  readonly domaine: DomaineUrgence;
  readonly libelle: string;         // français, formulée comme un signal d'alerte (« oui » = plus grave)
  readonly critique: boolean;       // poids `poidsCritique` au lieu de 1
}
export const GRILLE_URGENCE: readonly QuestionUrgence[];   // 15 questions, §6.4.1

export interface ParametresUrgence {
  readonly seuilOrangePct: number;          // 25
  readonly seuilRougePct: number;           // 50
  readonly poidsCritique: number;           // 2
  readonly partMinimaleReponduePct: number; // 50
}
export const PARAMETRES_URGENCE_DEFAUT: ParametresUrgence;

export interface ResultatDomaineUrgence {
  readonly domaine: DomaineUrgence;
  readonly voyant: VoyantUrgence;
  readonly pourcentage: number | null;       // entier 0..100 ; null si non évalué
  readonly pointsPonderes: number;           // Σ poids × points (non 0, partiellement 1, oui 2)
  readonly pointsMaximum: number;            // 2 × poidsRepondu
  readonly poidsRepondu: number;
  readonly poidsTotal: number;
  readonly inconnues: readonly string[];     // réponse « inconnu »
  readonly absentes: readonly string[];      // question non renseignée
}
export interface ResultatUrgence {
  readonly version: number;                  // VERSION_GRILLE_URGENCE
  readonly domaines: readonly ResultatDomaineUrgence[];   // ordre de DOMAINES_URGENCE
  readonly voyant: VoyantUrgence;            // pire voyant des domaines évalués ; non_evalue si aucun
  readonly domainesRouges: readonly DomaineUrgence[];
  readonly domainesOranges: readonly DomaineUrgence[];
  readonly domainesNonEvalues: readonly DomaineUrgence[];
  readonly complet: boolean;                 // aucun domaine non évalué
  readonly questionsRepondues: number;       // hors « inconnu »
  readonly questionsTotal: number;           // 15
}
export function validerParametresUrgence(p: ParametresUrgence): void;
export function evaluerUrgence(
  reponses: Readonly<Record<string, ReponseUrgence>>,
  parametres: ParametresUrgence = PARAMETRES_URGENCE_DEFAUT,
): ResultatUrgence;
```

**Règles.** Pour chaque domaine : `poidsTotal` = somme des poids de ses questions ; `poidsRepondu` =
somme des poids des questions répondues autrement que par « inconnu » ; domaine **évalué** si
`poidsRepondu × 100 ≥ partMinimaleReponduePct × poidsTotal` (même principe que NOT-03 : la moitié du
poids) ; `pourcentage = diviserArrondi(100 × pointsPonderes, pointsMaximum)` ; voyant **sur valeurs
exactes** (pas sur le pourcentage arrondi) : `rouge` si `pointsPonderes × 100 ≥ seuilRougePct ×
pointsMaximum`, `orange` si `≥ seuilOrangePct × pointsMaximum`, sinon `vert`. Une réponse « inconnu »
ou absente n'est jamais comptée comme « non ». `reponses` d'un code inconnu → `QUESTION_INCONNUE` ;
valeur hors liste → `REPONSE_INVALIDE`. `validerParametresUrgence` : entiers, 0 ≤ orange ≤ rouge ≤ 100,
`poidsCritique` de 1 à 10, `partMinimaleReponduePct` de 1 à 100 (`ENTREE_INVALIDE`).

#### 6.4.1 Grille de départ (formulations **provisoires**, à valider par les experts : §13)

| Code | Domaine        | Critique | Libellé                                                                                                                                   |
| ---- | -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | `tresorerie`   | oui      | Des impôts ou des cotisations sociales sont-ils en retard de paiement ?                                                                   |
| T2   | `tresorerie`   | non      | Des chèques, prélèvements ou virements ont-ils été rejetés par la banque ces 12 derniers mois ?                                           |
| T3   | `tresorerie`   | non      | Des fournisseurs réclament-ils des paiements en retard, ou ont-ils durci leurs conditions (paiement comptant, livraison bloquée) ?        |
| A1   | `activite`     | oui      | Le chiffre d'affaires a-t-il baissé de plus de 10 % par rapport à l'an dernier ?                                                          |
| A2   | `activite`     | non      | Un client qui représente plus de 30 % du chiffre d'affaires a-t-il été perdu ou est-il menacé ?                                           |
| A3   | `activite`     | non      | Les marges se sont-elles nettement dégradées (prix de vente en baisse ou coûts d'achat en hausse) ?                                       |
| E1   | `exploitation` | oui      | L'activité est-elle ralentie ou arrêtée (rupture d'approvisionnement, panne majeure, arrêt de production) ?                               |
| E2   | `exploitation` | non      | Les stocks ou les créances clients ont-ils fortement augmenté sans hausse des ventes ?                                                    |
| E3   | `exploitation` | non      | Le suivi de gestion (comptabilité, tableau de bord, prix de revient) a-t-il plus de trois mois de retard ?                                |
| S1   | `social`       | oui      | Des salaires sont-ils payés en retard ou partiellement ?                                                                                  |
| S2   | `social`       | non      | Des départs de cadres ou de salariés clés, ou des tensions sociales, ont-ils eu lieu ces six derniers mois ?                              |
| S3   | `social`       | non      | L'entreprise dépend-elle d'une seule personne (le dirigeant ou un autre) pour ses décisions et ses relations clés ?                       |
| F1   | `financement`  | oui      | Un créancier a-t-il engagé une action (mise en demeure, saisie, poursuite), ou la banque a-t-elle réduit ou retiré ses lignes de crédit ? |
| F2   | `financement`  | non      | Les capitaux propres ont-ils fondu au point d'être, ou de risquer d'être, inférieurs à la moitié du capital ?                             |
| F3   | `financement`  | non      | Les associés ou dirigeants sont-ils en désaccord sur l'avenir de l'entreprise, ou les comptes ne sont-ils plus approuvés à temps ?        |

Poids : 2 pour une question critique, 1 sinon ; `poidsTotal` = 4 par domaine.

**Cas de test attendus** (`urgence.test.ts`).
(U1) tout « non » : cinq domaines `vert`, pourcentage 0, voyant global `vert`, `complet` vrai.
(U2) T1 « oui » (2 × 2 = 4), T2 « partiellement » (1), T3 « non » : 5 / 8 → **62,5 % → 63**, `rouge` ; global
`rouge`, `domainesRouges = ["tresorerie"]`.
(U3) T1 « non », T2 « oui », T3 « non » : 2 / 8 = **25 %**, `orange` (borne atteinte : ≥).
(U4) T1 « partiellement », T2 et T3 « non » : 2 / 8 = 25 %, `orange`.
(U5) T1 « non », T2 « partiellement », T3 « non » : 1 / 8 = **12,5 % → 13**, `vert`.
(U6) T1 « inconnu », T2 « oui », T3 « non » : `poidsRepondu` 2 sur 4 (= 50 %, borne atteinte donc évalué),
`pointsPonderes` 2, `pointsMaximum` 4 → **50 %**, `rouge` (borne ≥) ; `inconnues = ["T1"]`.
(U7) T1 et T2 « inconnu », T3 « oui » : `poidsRepondu` 1 sur 4 (25 % < 50 %) → `non_evalue`,
`pourcentage` nul ; `complet` faux.
(U8) aucune réponse : voyant global `non_evalue`, `absentes` = 15 codes, `questionsRepondues` 0.
(U9) `QUESTION_INCONNUE` (« Z9 »), `REPONSE_INVALIDE` (« peut-être »), paramètres invalides (orange 60 / rouge 50).
(U10) `GRILLE_URGENCE` : 15 questions, 3 par domaine, une critique par domaine, codes uniques (garde contre
une modification accidentelle) ; `VERSION_GRILLE_URGENCE` = 1.

### 6.5 `alerte.ts` — RED-10

```ts
export const VERSION_MOTEUR_ALERTE = 1;
export const CRITERES_ALERTE = [
  "liquidite_generale", "liquidite_immediate", "autonomie_financiere", "endettement",
  "couverture_charges_financieres", "marge_nette", "bfr_jours",
  "croissance_ca", "variation_marge_brute",
  "rejets_bancaires_12m", "retards_fournisseurs_90j", "arrieres_fiscaux_sociaux",
] as const;
export type CritereAlerte = (typeof CRITERES_ALERTE)[number];
export type SensCritereAlerte = "bas_pire" | "haut_pire";
/** Intrinsèque au critère : les experts fixent les seuils, pas le sens. */
export const SENS_CRITERE_ALERTE: Readonly<Record<CritereAlerte, SensCritereAlerte>>;

export interface SeuilCritereAlerte {
  readonly orange: number;   // entier (pb, jours, nombre d'incidents, 0/1)
  readonly rouge: number;
  readonly poids: number;    // entier 0..100
}
export interface NiveauxAlerte { readonly modere: number; readonly eleve: number; readonly critique: number }
export interface SeuilsAlerte {
  readonly criteres: Readonly<Record<CritereAlerte, SeuilCritereAlerte>>;
  readonly niveaux: NiveauxAlerte;
  readonly partMinimaleEvalueePct: number;   // part du poids total qui doit être évaluée (défaut 50)
}
export const SEUILS_ALERTE_DEFAUT: SeuilsAlerte;     // valeurs de §13.1, « provisoires »
export function validerSeuilsAlerte(s: SeuilsAlerte): void;

export interface IncidentsPaiement {
  readonly rejetsBancaires12m: number | null;        // entier 0..999 ; null = non renseigné
  readonly retardsFournisseurs90j: number | null;    // entier 0..999
  readonly arrieresFiscauxSociaux: boolean | null;
}
export interface EntreesAlerte {
  readonly ratios: RatiosExercice | null;            // dernier exercice accepté
  readonly tendances: TendancesRedressement | null;
  readonly incidents: IncidentsPaiement;
}

export type StatutCritereAlerte = "vert" | "orange" | "rouge" | "non_evalue";
export type MotifCritereAlerte = "signal_critique" | "sans_objet" | "non_calculable" | "non_renseigne";
export interface ResultatCritereAlerte {
  readonly critere: CritereAlerte;
  readonly valeur: number | null;
  readonly statut: StatutCritereAlerte;
  readonly points: 0 | 1 | 2 | null;                 // vert 0, orange 1, rouge 2, non évalué null
  readonly poids: number;
  readonly motif: MotifCritereAlerte | null;
}
export type NiveauAlerte = "insuffisant" | "faible" | "modere" | "eleve" | "critique";
export interface ScoreAlerte {
  readonly version: number;                          // VERSION_MOTEUR_ALERTE
  readonly score: number | null;                     // entier 0..100 ; null si niveau « insuffisant »
  readonly niveau: NiveauAlerte;
  readonly criteres: readonly ResultatCritereAlerte[];   // ordre de CRITERES_ALERTE
  readonly pointsPonderes: number;                   // Σ poids × points
  readonly poidsEvalue: number;
  readonly poidsTotal: number;                       // 100
  readonly criteresRouges: readonly CritereAlerte[];
  readonly criteresOranges: readonly CritereAlerte[];
}
export function calculerScoreAlerte(
  entrees: EntreesAlerte, seuils: SeuilsAlerte = SEUILS_ALERTE_DEFAUT,
): ScoreAlerte;
/** `score < modere` → faible ; `< eleve` → modere ; `< critique` → eleve ; sinon critique. */
export function niveauDepuisScore(score: number, niveaux: NiveauxAlerte): Exclude<NiveauAlerte, "insuffisant">;
```

**Règles.**

- Source des valeurs : `liquidite_generale`, `liquidite_immediate`, `autonomie_financiere`,
  `endettement`, `couverture_charges_financieres`, `marge_nette`, `bfr_jours` ← `ratios.ratios[clé].valeur` ;
  `croissance_ca` ← `tendances.croissanceCaPb` ; `variation_marge_brute` ← `tendances.variationMargeBrutePb` ;
  `rejets_bancaires_12m`, `retards_fournisseurs_90j` ← `incidents` ; `arrieres_fiscaux_sociaux` ← 1 si vrai, 0
  si faux.
- Statut d'un critère : `bas_pire` : `rouge` si `valeur < rouge`, `orange` si `valeur < orange`, sinon
  `vert` ; `haut_pire` : `rouge` si `valeur > rouge`, `orange` si `valeur > orange`, sinon `vert`
  (inégalités **strictes** : une valeur égale au seuil reste du côté « sain »).
- Statut d'un ratio non « calculé » : `sans_objet` → `vert` (motif `sans_objet`, valeur nulle) ;
  `non_significatif` → **`rouge`** (motif `signal_critique`) ; `non_calculable` → `non_evalue`
  (motif `non_calculable`). Une tendance nulle → `non_evalue` (`non_calculable`) ; un incident nul →
  `non_evalue` (`non_renseigne`) ; `ratios` nul → les sept critères de ratio sont `non_evalue`.
- `poidsEvalue` = somme des poids des critères non `non_evalue`. Si `poidsEvalue × 100 <
  partMinimaleEvalueePct × poidsTotal` : `score` nul, niveau **`insuffisant`**. Sinon
  `score = diviserArrondi(100 × pointsPonderes, 2 × poidsEvalue)` et niveau : `< modere` → `faible`,
  `< eleve` → `modere`, `< critique` → `eleve`, sinon `critique`.
- `validerSeuilsAlerte` (`SEUILS_INVALIDES`) : les douze critères et eux seuls ; `orange` et `rouge`
  entiers dans [−1 000 000, 1 000 000] ; `bas_pire` : `rouge ≤ orange` ; `haut_pire` : `rouge ≥ orange` ;
  `poids` entiers de 0 à 100, **somme = 100** ; `niveaux` entiers avec `1 ≤ modere < eleve < critique ≤ 100` ;
  `partMinimaleEvalueePct` entier de 10 à 100. `calculerScoreAlerte` valide ses seuils avant tout calcul.
- Le moteur ne qualifie rien : pas de mot « cessation », « faillite » ni « défaillance » dans ses sorties.

**Cas de test attendus** (`alerte.test.ts`), seuils par défaut de §13.1.
(S1) entrées du cas A de §6.3 + tendances (2000 ; −300) + incidents (0 ; 0 ; faux) : `liquidite_generale` 13636
`vert` ; `liquidite_immediate` 1818 `orange` ; `autonomie_financiere` 1875 `orange` ; `endettement` 13333
`orange` ; `couverture_charges_financieres` 20000 `orange` ; `marge_nette` 150 `orange` ; `bfr_jours` 54 `vert` ;
`croissance_ca` 2000 `vert` ; `variation_marge_brute` −300 `orange` ; trois incidents `vert`. Points pondérés :
5 × 10 + 5 = 55 ; `poidsEvalue` 100 ; **score = 100 × 55 / 200 = 27,5 → 28**, niveau `modere`.
(S2) mêmes ratios, `tendances` nul, incidents nuls : cinq critères `non_evalue` hors ratios (10 + 5 + 5 + 5 + 5 = 30 de
poids) → `poidsEvalue` 70, points 50, **score = 5000 / 140 = 35,71 → 36**, `modere`.
(S3) `ratios` nul, `tendances` nul, incidents tous renseignés : `poidsEvalue` 15 < 50 → `score` nul,
niveau `insuffisant`.
(S4) capitaux propres −10 000 000 (cas E de §6.3) avec les mêmes autres entrées que S1 : `endettement`
`non_significatif` → `rouge` (`signal_critique`) ; `autonomie_financiere` −125 → `rouge` ; points
20 + 20 + 10 + 10 + 10 + 5 = 75 → **37,5 → 38**, `modere`.
(S5) S1 avec rejets bancaires 3 (`> 2` : `rouge`), retards fournisseurs 1 (`> 0` : `orange`), arriérés vrai
(`1 > 0` : `rouge`) : points 55 + 10 + 5 + 10 = 80 → **40**, `modere`.
(S6) `endettement` exactement 10000 → `vert` ; 10001 → `orange` ; 20000 → `orange` ; 20001 → `rouge`
(inégalités strictes) ; `marge_nette` 0 → `orange` (0 < 200, pas `< 0`) ; −1 → `rouge`.
(S7) `sans_objet` (couverture sans charges financières) → `vert`, motif `sans_objet`.
(S8) niveaux aux bornes : score 24 → `faible`, 25 → `modere`, 49 → `modere`, 50 → `eleve`, 75 → `critique`
(par seuils sur mesure rendant ces scores atteignables, ou test direct de la fonction de niveau exportée
`niveauDepuisScore(score, niveaux)`).
(S9) `validerSeuilsAlerte(SEUILS_ALERTE_DEFAUT)` passe (somme des poids 100) ; un cas par règle violée
(critère manquant, critère en trop, `bas_pire` avec `rouge > orange`, somme 99, niveaux non croissants,
valeur non entière).
(S10) déterminisme : deux appels avec les mêmes entrées rendent des objets égaux profondément.
(S11) garde de non-régression : un test compare `SEUILS_ALERTE_DEFAUT` au tableau de §13.1 (poids, orange, rouge).

### 6.6 `tresorerie.ts` et `point-mort.ts` — RED-06, RED-11

```ts
export const SEMAINES_TRESORERIE = 13;
export const CATEGORIES_ENCAISSEMENT_RED = ["clients", "autres_encaissements", "financement", "cessions"] as const;
export const CATEGORIES_DECAISSEMENT_RED = [
  "fournisseurs", "salaires", "fiscal_social", "loyers_charges", "service_dette", "investissements", "autres_decaissements",
] as const;
export type CategorieEncaissementRed = (typeof CATEGORIES_ENCAISSEMENT_RED)[number];
export type CategorieDecaissementRed = (typeof CATEGORIES_DECAISSEMENT_RED)[number];
export type SensFluxTresorerie = "encaissement" | "decaissement";

export interface LigneTresorerie {
  readonly semaine: number;                // 1..13
  readonly sens: SensFluxTresorerie;
  readonly categorie: string;              // doit appartenir à la liste du sens
  readonly montant: number;                // entier 1..10^13
}
export interface FluxRealise {
  readonly encaissement?: Readonly<Partial<Record<CategorieEncaissementRed, number>>>;
  readonly decaissement?: Readonly<Partial<Record<CategorieDecaissementRed, number>>>;
}
export interface RealiseSemaine {
  readonly semaine: number;                // 1..13 (index dans la fenêtre de la version)
  readonly flux: FluxRealise;
  readonly soldeConstate: number | null;   // solde bancaire de fin de semaine, ancre du solde retenu
}
export interface EntreeTresorerie {
  readonly dateDebut: DateISO;             // lundi de la semaine 1
  readonly soldeInitial: number;           // peut être négatif
  readonly seuilTension: number;           // entier ≥ 0
  readonly lignes: readonly LigneTresorerie[];       // au plus 600
  readonly realises: readonly RealiseSemaine[];      // doivent former le préfixe 1..k
}
export interface EcartCategorie {
  readonly sens: SensFluxTresorerie;
  readonly categorie: string;
  readonly prevu: number;
  readonly realise: number | null;
  readonly ecart: number | null;           // réalisé − prévu
}
export interface SemaineTresorerie {
  readonly semaine: number; readonly debut: DateISO; readonly fin: DateISO;      // lundi, dimanche
  readonly encaissementsPrevus: number; readonly decaissementsPrevus: number; readonly fluxNetPrevu: number;
  readonly soldeOuverturePrevu: number; readonly soldeCloturePrevu: number;      // prévision pure, réalisés ignorés
  readonly realise: null | {
    readonly encaissements: number; readonly decaissements: number; readonly fluxNet: number;
    readonly soldeConstate: number | null;
  };
  readonly ecartEncaissements: number | null;      // réalisé − prévu
  readonly ecartDecaissements: number | null;      // réalisé − prévu (positif = dépense en plus)
  readonly ecartFluxNet: number | null;            // réalisé − prévu (négatif = défavorable)
  readonly ecartRapprochement: number | null;      // solde constaté − (ouverture retenue + flux net réalisé)
  readonly soldeOuvertureRetenu: number;
  readonly soldeClotureRetenu: number;             // constaté, sinon ouverture retenue + flux (réalisés puis prévus)
  readonly tension: boolean;                       // soldeClotureRetenu < seuilTension
  readonly parCategorie: readonly EcartCategorie[];
}
export interface ResultatTresorerie {
  readonly semaines: readonly SemaineTresorerie[];                       // 13
  readonly soldeMinimum: { readonly semaine: number; readonly montant: number };   // première semaine du minimum
  readonly semainesTension: readonly number[];
  readonly premiereSemaineTension: number | null;
  readonly besoinFinancement: number;              // max(0, seuilTension − soldeMinimum.montant)
  readonly derniereSemaineRealisee: number | null;
  readonly ecartCumuleFluxNet: number;             // Σ des écarts nets des semaines réalisées
  readonly totaux: { readonly encaissementsPrevus: number; readonly decaissementsPrevus: number; readonly fluxNetPrevu: number };
}
export function totaliserFluxRealise(flux: FluxRealise): { encaissements: number; decaissements: number };
export function projeterTresorerie(entree: EntreeTresorerie): ResultatTresorerie;

export interface EcheanceRestante {
  readonly echeanceId: string; readonly creancierId: string;
  readonly categorieCreancier: CategorieCreancierRed;
  readonly date: DateISO; readonly montant: number;      // montant restant dû sur l'échéance (> 0)
}
export interface LigneProposee extends LigneTresorerie { readonly echeanceId: string; readonly creancierId: string }
export interface PropositionEcheances {
  readonly lignes: readonly LigneProposee[];
  readonly anterieures: number;    // échéances datées avant `dateDebut` (arriérés : à placer à la main)
  readonly ulterieures: number;    // échéances au-delà de la semaine 13
}
export function echeancesVersLignes(echeances: readonly EcheanceRestante[], dateDebut: DateISO): PropositionEcheances;
```

```ts
// point-mort.ts
export interface EntreePointMort {
  readonly chiffreAffaires: number;      // entier ≥ 0, sur la période
  readonly chargesVariables: number;     // entier ≥ 0
  readonly chargesFixes: number;         // entier ≥ 0
  readonly periodeJours?: number;        // 1..366, défaut 360 (base du modèle financier)
}
export type StatutPointMort = "beneficiaire" | "equilibre" | "deficitaire" | "non_calculable" | "impossible";
export interface ResultatPointMort {
  readonly statut: StatutPointMort;
  readonly periodeJours: number;
  readonly margeCoutVariable: number;                // CA − charges variables (peut être négative)
  readonly tauxMargeCoutVariablePb: number | null;   // marge / CA, pb ; null si CA ≤ 0
  readonly resultatExploitation: number;             // marge − charges fixes
  readonly seuilRentabilite: number | null;          // charges fixes × CA / marge, arrondi PAR EXCÈS ; null si non_calculable / impossible
  readonly margeSecurite: number | null;             // CA − seuil (négatif si déficitaire)
  readonly margeSecuritePb: number | null;           // marge de sécurité / CA, pb
  readonly pointMortJours: number | null;            // charges fixes × période / marge, jours entiers (demi s'éloignant de zéro)
}
export function calculerPointMort(e: EntreePointMort): ResultatPointMort;
```

**Règles — trésorerie.**

- `dateDebut` doit être un **lundi** valide (`DATE_INVALIDE`) ; `semaine` hors 1..13 (`SEMAINE_INVALIDE`) ;
  `categorie` hors de la liste de son sens, montant non entier ou hors 1..10^13 (`TRESORERIE_INVALIDE`) ;
  `seuilTension < 0` ; plus de 600 lignes. Les semaines `debut` = `dateDebut + 7 × (semaine − 1)`, `fin` = `debut + 6`.
- **Réalisé** : `realises` doit être exactement les semaines `1..k` (aucun trou, aucun doublon) sinon
  `REALISE_NON_CONTIGU` ; `k` peut valoir 0. `soldeOuvertureRetenu(1) = soldeInitial` ; pour toute
  semaine `s > 1`, `soldeOuvertureRetenu(s) = soldeClotureRetenu(s − 1)`. `soldeClotureRetenu(s)` =
  `soldeConstate` s'il existe, sinon ouverture retenue + flux net **réalisé** (semaines `≤ k`) ou **prévu**
  (semaines `> k`) : la prévision **glisse** sur le dernier solde retenu.
- Écarts : toujours **réalisé − prévu** ; `null` pour une semaine non réalisée. `ecartRapprochement` n'existe que
  si `soldeConstate` est renseigné. `parCategorie` liste toute catégorie qui a un prévu ou un réalisé non nuls
  (ordre : encaissements puis décaissements, dans l'ordre des listes) ; `realise` est nul pour une semaine non
  réalisée.
- `tension` = `soldeClotureRetenu < seuilTension` (un solde **égal** au seuil n'est pas en tension) ;
  `soldeMinimum` : minimum des `soldeClotureRetenu`, **première** semaine en cas d'égalité ;
  `besoinFinancement = max(0, seuilTension − soldeMinimum.montant)`.
- **Aucune qualification** : « tension » est un constat de solde projeté, jamais une situation juridique.
- Sommes en `BigInt`, dépassement → `SOMME_HORS_LIMITES`.
- `echeancesVersLignes` : catégorie de la ligne selon le créancier (`banque` → `service_dette`,
  `fournisseur` → `fournisseurs`, `fiscal` et `social` → `fiscal_social`, `bailleur` → `loyers_charges`,
  `autre` → `autres_decaissements`), sens `decaissement`, semaine = `floor(joursEntre(dateDebut, date) / 7) + 1` ;
  date `< dateDebut` → `anterieures` ; semaine `> 13` → `ulterieures` ; ordre de sortie : semaine, puis
  `echeanceId`.

**Règles — point mort.** `periodeJours` hors 1..366 ou montants négatifs / non entiers : `ENTREE_INVALIDE`.
`chiffreAffaires = 0` → `non_calculable` (taux, seuil, marges de sécurité et jours nuls ; marge et résultat
calculés). `margeCoutVariable ≤ 0` avec CA > 0 → `impossible` (aucun volume ne couvre les charges fixes :
seuil nul). Sinon `seuilRentabilite = ceil(chargesFixes × CA / marge)` (exact, `BigInt`),
`margeSecurite = CA − seuil`, `pointMortJours = diviserArrondi(chargesFixes × périodeJours, marge)` (identité :
seuil / CA × période = charges fixes × période / marge), `statut` : `beneficiaire` si le résultat est > 0,
`equilibre` si = 0, `deficitaire` si < 0.

**Cas de test attendus** (`tresorerie.test.ts`, `point-mort.test.ts`). XOF, `dateDebut` 2026-10-12 (lundi) ;
`soldeInitial` 50 000 000 ; `seuilTension` 10 000 000 ; lignes : S1 encaissement `clients` 30 000 000,
décaissements `fournisseurs` 40 000 000 et `salaires` 25 000 000 ; S2 `clients` 20 000 000, `fournisseurs`
30 000 000 ; S3 `clients` 15 000 000, `fournisseurs` 35 000 000 ; semaines 4 à 13 sans ligne.

- (T1) **prévision seule** : flux nets −35 M, −10 M, −20 M ; soldes de clôture 15 M, 5 M, −15 M puis −15 M
  jusqu'à la semaine 13 ; `semainesTension = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]` (la semaine 1, à 15 M, n'est
  pas en tension) ; `premiereSemaineTension` 2 ; `soldeMinimum` {3, −15 000 000} ; `besoinFinancement`
  **25 000 000** ; `derniereSemaineRealisee` nul ; totaux : encaissements 65 M, décaissements 130 M, net −65 M.
- (T2) **réalisé S1 sans solde constaté** (encaissements `clients` 28 M ; décaissements `fournisseurs` 41 M et
  `salaires` 25 M, soit 66 M) : flux net réalisé −38 M ; `soldeClotureRetenu(1)` = 12 M ; écarts : encaissements
  −2 M, décaissements +1 M, net **−3 M** ; par catégorie `fournisseurs` prévu 40 M, réalisé 41 M, écart +1 M ;
  S2 repart de 12 M → 2 M ; S3 → −18 M ; `soldeMinimum` {3, −18 000 000} ; `besoinFinancement` **28 000 000** ;
  `semainesTension = [2 … 13]` ; `ecartCumuleFluxNet` −3 M ; `derniereSemaineRealisee` 1.
- (T3) **même réalisé avec `soldeConstate` 11 000 000** : `ecartRapprochement` = 11 − (50 − 38) = **−1 000 000** ;
  `soldeClotureRetenu(1)` = 11 M ; S2 → 1 M ; S3 → −19 M ; `besoinFinancement` **29 000 000**.
- (T4) **sans tension** : `soldeInitial` 100 000 000, mêmes lignes : minimum 35 M à la semaine 3, aucune
  semaine de tension, `premiereSemaineTension` nul, `besoinFinancement` 0 ; **solde égal au seuil** (seuil 35 M) :
  pas de tension.
- (T5) `soldeInitial` −5 000 000 (découvert) accepté ; semaines 1 et 3 réalisées sans la 2 → `REALISE_NON_CONTIGU` ;
  deux réalisés pour la semaine 1 → `REALISE_NON_CONTIGU` ; `dateDebut` 2026-10-13 (mardi) → `DATE_INVALIDE` ;
  semaine 14 → `SEMAINE_INVALIDE` ; catégorie « salaires » en encaissement → `TRESORERIE_INVALIDE` ; montant 0 ou
  décimal → `TRESORERIE_INVALIDE` ; 601 lignes → `TRESORERIE_INVALIDE`.
- (T6) `totaliserFluxRealise({ encaissement: { clients: 28 000 000 }, decaissement: { fournisseurs: 41 000 000,
  salaires: 25 000 000 } })` → {28 000 000 ; 66 000 000} ; flux vide → {0 ; 0} ; catégorie inconnue →
  `TRESORERIE_INVALIDE`.
- (T7) `echeancesVersLignes` avec `dateDebut` 2026-10-12 : échéance du 2026-10-14 → semaine 1 ; 2026-10-19 → semaine 2 ;
  2026-11-30 (49 jours après) → semaine 8 ; 2027-01-10 (90 jours) → semaine 13 ; 2027-01-11 (91 jours) →
  `ulterieures` ; 2026-10-05 → `anterieures` ; créancier `banque` → catégorie `service_dette` ; sortie triée.
- (T8) **point mort** : CA 1 200 000 000, charges variables 780 000 000, charges fixes 300 000 000 → marge
  420 000 000, taux **3500**, résultat 120 000 000, statut `beneficiaire`, seuil **857 142 858** (857 142 857,14
  arrondi par excès), marge de sécurité **342 857 142**, **2857** pb (2857,14), `pointMortJours`
  **257** (300 M × 360 / 420 M = 257,14). Charges fixes 500 000 000 : résultat −80 000 000, `deficitaire`, seuil
  **1 428 571 429**, marge de sécurité **−228 571 429**, **−1905** pb, `pointMortJours` **429** (428,57).
  Charges fixes 420 000 000 : `equilibre`, seuil 1 200 000 000, marge de sécurité 0, 0 pb, 360 jours.
  CA = charges variables = 1 000 : `impossible`. CA = 0 : `non_calculable`. `periodeJours` 366 : jours
  recalculés ; 0 ou 367 : `ENTREE_INVALIDE`. Montant négatif : `ENTREE_INVALIDE`.

### 6.7 `creanciers.ts` — RED-12

```ts
export const CATEGORIES_CREANCIER_RED = ["fournisseur", "banque", "fiscal", "social", "bailleur", "autre"] as const;
export type CategorieCreancierRed = (typeof CATEGORIES_CREANCIER_RED)[number];

export interface TermesAccordReguliers {
  readonly montantConvenu: number;        // entier 1..10^13
  readonly nombreEcheances: number;       // 1..60
  readonly datePremiere: DateISO;
  readonly periodiciteMois: number;       // 1..12
}
export interface EcheanceAccord { readonly rang: number; readonly date: DateISO; readonly montant: number }

/** n échéances égales ; le reste d'arrondi va à la DERNIÈRE (comme finance/echeancier.ts) ; date k = ajouterMois(datePremiere, (k − 1) × périodicité) depuis la date d'origine. */
export function construireEcheancierAccord(t: TermesAccordReguliers): readonly EcheanceAccord[];
/** Échéancier explicite : somme = montant convenu, dates strictement croissantes, ≤ 60 lignes ; attribue les rangs 1..n. */
export function validerEcheancierAccord(
  montantConvenu: number, lignes: readonly { readonly date: DateISO; readonly montant: number }[],
): readonly EcheanceAccord[];
/** Un accord ne dépasse pas l'encours (principal + intérêts) de la créance courante : ACCORD_SUPERIEUR_CREANCE ; montant ≤ 0 : ECHEANCIER_INVALIDE. */
export function verifierAccordContreCreance(montantConvenu: number, encours: number): void;

export interface AccordSuivi {
  readonly montantConvenu: number;
  readonly echeances: readonly EcheanceAccord[];
  readonly paiements: readonly { readonly date: DateISO; readonly montant: number }[];
  readonly rompu: boolean;
}
export function exigerPaiementAdmissible(accord: AccordSuivi, montant: number): void;  // ACCORD_ROMPU si rompu ; PAIEMENT_EXCESSIF si total payé + montant > convenu

export interface EntreeSituationCreancier {
  readonly principal: number; readonly interets: number;
  readonly echeanceInitiale: DateISO | null;
  readonly accord: AccordSuivi | null;
  readonly dateReference: DateISO;
}
export type StatutAccord = "respecte" | "en_retard" | "solde" | "rompu";
export interface SituationCreancier {
  readonly encoursInitial: number;                 // principal + intérêts
  readonly accord: null | {
    readonly statut: StatutAccord;
    readonly montantConvenu: number;
    readonly remise: number;                       // max(0, encours − convenu)
    readonly totalPaye: number;
    readonly resteAPayer: number;                  // max(0, convenu − payé)
    readonly echeancesEchues: number;              // échéances datées STRICTEMENT avant la date de référence
    readonly montantEchu: number;
    readonly retard: number;                       // max(0, montantEchu − totalPaye)
    readonly prochaineNonSoldee: null | { readonly rang: number; readonly date: DateISO; readonly montantRestant: number };
    readonly echeancesRestantes: readonly { readonly rang: number; readonly date: DateISO; readonly montantRestant: number }[];   // imputation FIFO, > 0, ordre des rangs
  };
  readonly encoursRestant: number;                 // sans accord : encoursInitial ; accord en vigueur : resteAPayer ; rompu : max(0, encoursInitial − totalPaye)
  readonly echu: number;                           // sans accord : encoursInitial si échéance initiale < référence, sinon 0 ; accord en vigueur : retard ; rompu : encoursRestant
}
export function situationCreancier(e: EntreeSituationCreancier): SituationCreancier;

export interface LignePassif {
  readonly creancierId: string; readonly categorie: CategorieCreancierRed; readonly garanti: boolean;
  readonly encours: number; readonly echu: number;
}
export interface SynthesePassif {
  readonly nombre: number;
  readonly totalEncours: number; readonly totalEchu: number;
  readonly partGarantiePb: number | null;          // encours garantis / total, pb ; null si total nul
  readonly concentrationTop3Pb: number | null;     // trois plus gros encours / total, pb
  readonly parCategorie: readonly { readonly categorie: CategorieCreancierRed; readonly nombre: number;
    readonly encours: number; readonly echu: number; readonly partPb: number | null }[];   // catégories non vides, ordre de CATEGORIES_CREANCIER_RED
}
export function synthesePassif(lignes: readonly LignePassif[]): SynthesePassif;
```

`echeancesRestantes` est vide pour un accord soldé ou rompu. Les paiements sont imputés **dans l'ordre des échéances** (premier entré, premier soldé) : c'est ce qui
définit `prochaineNonSoldee` (première échéance dont le cumul des montants dépasse le total payé, avec
`montantRestant` = cumul − payé borné au montant de l'échéance). Les parts en points de base sont
arrondies une à une : leur somme peut valoir 10 001 ou 9 999.

**Cas de test attendus** (`creanciers.test.ts`).
(C1) `construireEcheancierAccord({ montantConvenu: 10 000 001, nombreEcheances: 3, datePremiere: "2026-11-30",
periodiciteMois: 1 })` → montants **3 333 333 ; 3 333 333 ; 3 333 335** ; dates **2026-11-30, 2026-12-30,
2027-01-30** ; rangs 1 à 3.
(C2) `datePremiere` 2026-01-31, 3 échéances mensuelles → 2026-01-31, **2026-02-28**, 2026-03-31 (calcul depuis la date
d'origine). Un seul versement : une échéance du montant total. 61 échéances, périodicité 0 ou 13, montant 0 :
`ECHEANCIER_INVALIDE`.
(C3) `validerEcheancierAccord(10 000 000, [{2026-12-01, 4 000 000}, {2027-01-01, 6 000 000}])` → rangs 1 et 2 ;
somme 9 999 999 → `ECHEANCIER_INVALIDE` ; deux dates égales ou décroissantes → `ECHEANCIER_INVALIDE` ; montant 0 ;
date inexistante (2026-02-30) → `DATE_INVALIDE`.
(C4) `verifierAccordContreCreance(100 000 000, 100 000 000)` passe ; `100 000 001` →
`ACCORD_SUPERIEUR_CREANCE` ; 0 → `ECHEANCIER_INVALIDE`.
(C5) **Situation** — principal 90 000 000, intérêts 10 000 000 (encours 100 000 000) ; accord convenu 80 000 000
en 4 échéances de 20 000 000 les 2026-11-15, 2026-12-15, 2027-01-15, 2027-02-15 ; un paiement de 20 000 000 le
2026-11-16 ; référence **2026-12-20** → `remise` 20 000 000 ; `totalPaye` 20 000 000 ; `resteAPayer` 60 000 000 ;
`echeancesEchues` 2 ; `montantEchu` 40 000 000 ; `retard` 20 000 000 ; statut `en_retard` ; `prochaineNonSoldee`
{rang 2, 2026-12-15, 20 000 000} ; `echeancesRestantes` = rangs 2, 3 et 4, 20 000 000 chacune ; `encoursRestant`
60 000 000 ; `echu` 20 000 000.
(C6) même accord, référence **2026-11-20** : `echeancesEchues` 1, `montantEchu` 20 000 000, `retard` 0, statut
`respecte`, `echu` 0 ; référence **2026-11-15** : aucune échéance échue (stricte) ; quatre paiements de 20 000 000 :
`resteAPayer` 0, statut `solde`, `prochaineNonSoldee` nul, `echu` 0.
(C7) **rompu** (un paiement de 20 000 000 puis rupture) : statut `rompu`, `encoursRestant` **80 000 000**, `echu`
**80 000 000**.
(C8) **sans accord** : principal 90 M, intérêts 10 M, échéance initiale 2026-09-30, référence 2026-11-01 →
`accord` nul, `encoursRestant` 100 000 000, `echu` 100 000 000 ; échéance initiale nulle → `echu` 0.
(C9) `exigerPaiementAdmissible` : total payé 70 M + 10 M ≤ 80 M passe ; + 10 000 001 → `PAIEMENT_EXCESSIF` ; accord
rompu → `ACCORD_ROMPU`.
(C10) `synthesePassif` : banque garantie 100 M, fournisseur A 60 M (échu 30 M), fournisseur B 40 M, fiscal 20 M,
social 10 M → `nombre` 5, `totalEncours` 230 000 000, `totalEchu` 30 000 000, `partGarantiePb` **4348**,
`concentrationTop3Pb` **8696** ((100 + 60 + 40) / 230 = 8695,65), catégories : `fournisseur` 100 M **4348**,
`banque` 100 M **4348**, `fiscal` 20 M **870**, `social` 10 M **435** ; liste vide : totaux 0, parts nulles.

### 6.8 `plan.ts` — RED-05, RED-07

```ts
export const VOLETS_PLAN_RED = ["quick_win", "restructuration"] as const;
export type VoletPlanRed = (typeof VOLETS_PLAN_RED)[number];
export const STATUTS_ACTION_RED = ["a_faire", "en_cours", "bloquee", "terminee", "abandonnee"] as const;
export type StatutActionRed = (typeof STATUTS_ACTION_RED)[number];
/** PRD : quick wins à 3–6 mois, restructuration à 6–24 mois. Bornes en mois depuis la date de référence. */
export const FENETRE_QUICK_WIN_MOIS = { max: 6 } as const;
export const FENETRE_RESTRUCTURATION_MOIS = { min: 6, max: 24 } as const;

export interface ActionPlan {
  readonly numero: number;
  readonly titre: string;
  readonly volet: VoletPlanRed;
  readonly domaine: DomaineUrgence;
  readonly echeance: DateISO;
  readonly statut: StatutActionRed;
  readonly rang: number;
  readonly responsableId: string;
  readonly levierCode: string | null;
  readonly impactTresorerieUnique: number | null;
  readonly impactResultatAnnuel: number | null;
}
export function transitionActionAdmise(de: StatutActionRed, vers: StatutActionRed): boolean;

export interface Kanban {
  readonly colonnes: Readonly<Record<"a_faire" | "en_cours" | "bloquee" | "terminee", readonly ActionPlan[]>>;
  readonly abandonnees: readonly ActionPlan[];
}
export function organiserKanban(actions: readonly ActionPlan[]): Kanban;   // tri : rang, échéance, numéro

export type CodeAnomaliePlan = "AUCUNE_ACTION" | "AUCUN_QUICK_WIN" | "QUICK_WIN_HORS_FENETRE" | "RESTRUCTURATION_HORS_FENETRE";
export interface AnomaliePlan { readonly code: CodeAnomaliePlan; readonly numero: number | null; readonly bloquante: boolean }
export interface AvancementVolet {
  readonly total: number; readonly terminees: number; readonly abandonnees: number; readonly enRetard: number;
  readonly avancementPb: number | null;       // terminées / (total − abandonnées), pb ; null si dénominateur nul
}
export interface EvaluationPlan {
  readonly parVolet: Readonly<Record<VoletPlanRed, AvancementVolet>>;
  readonly enRetard: readonly number[];       // numéros ; statut a_faire / en_cours / bloquee et échéance < date de référence
  readonly anomalies: readonly AnomaliePlan[];
  readonly bloquantsValidation: readonly CodeAnomaliePlan[];
  readonly impactTresorerieUnique: number;    // Σ des actions non abandonnées (null = 0)
  readonly impactResultatAnnuel: number;
}
export function evaluerPlanRedressement(actions: readonly ActionPlan[], dateReference: DateISO): EvaluationPlan;

export interface ActionCanonique {   // ce qui fait le PLAN : ni statut ni rang (le kanban bouge librement)
  readonly numero: number; readonly titre: string; readonly volet: VoletPlanRed; readonly domaine: DomaineUrgence;
  readonly echeance: DateISO; readonly responsableId: string; readonly levierCode: string | null;
  readonly impactTresorerieUnique: number | null; readonly impactResultatAnnuel: number | null;
}
export interface ContenuPlan { readonly version: 1; readonly actions: readonly ActionCanonique[] }
export function construireContenuPlan(actions: readonly ActionPlan[]): ContenuPlan;        // actions abandonnées exclues, triées par numéro
export function serialiserContenuPlan(c: ContenuPlan): string;                              // JSON à clés dans un ordre fixe : l'API en prend le SHA-256
export interface EcartPlan { readonly ajoutees: readonly number[]; readonly retirees: readonly number[]; readonly modifiees: readonly number[] }
export function comparerContenusPlan(courant: ContenuPlan, valide: ContenuPlan): EcartPlan;
```

**Règles.** `transitionActionAdmise` : `a_faire → en_cours | bloquee | terminee | abandonnee` ;
`en_cours → bloquee | terminee | abandonnee` ; `bloquee → en_cours | abandonnee` ; tout le reste
`false` (y compris le maintien du même statut et toute sortie de `terminee` / `abandonnee`).
`evaluerPlanRedressement` ignore les actions abandonnées pour les anomalies et les impacts. Anomalies :
`AUCUNE_ACTION` (aucune action non abandonnée) et `AUCUN_QUICK_WIN` (aucun quick win non abandonné) sont
**bloquantes** ; `QUICK_WIN_HORS_FENETRE` (échéance **strictement après** `ajouterMois(dateReference, 6)`) et
`RESTRUCTURATION_HORS_FENETRE` (échéance ≤ `ajouterMois(dateReference, 6)` ou > `ajouterMois(dateReference, 24)`)
sont des avertissements portant le numéro de l'action. `construireContenuPlan` exclut les actions
abandonnées : un abandon retire l'action du plan.

**Cas de test attendus** (`plan.test.ts`).
(P1) matrice de `transitionActionAdmise` : les 25 couples (5 × 5) ; vrais : `a_faire` → 4, `en_cours` → 3,
`bloquee` → 2, soit **9 vrais et 16 faux**.
(P2) `dateReference` 2026-11-01 (fenêtres jusqu'au 2027-05-01 et 2028-11-01) ; A1 quick win terminée 2027-01-15 ;
A2 quick win en cours 2026-10-15 ; A3 restructuration à faire 2027-12-01 ; A4 restructuration abandonnée 2026-12-01 ;
A5 quick win à faire 2027-06-01 → `quick_win` : total 3, terminées 1, abandonnées 0, en retard 1, avancement
**3333** ; `restructuration` : total 2, terminées 0, abandonnées 1, en retard 0, avancement **0** ; `enRetard` = [2] ;
`anomalies` = [`QUICK_WIN_HORS_FENETRE` n° 5, non bloquante] ; `bloquantsValidation` vide.
(P3) liste vide → `AUCUNE_ACTION` et `AUCUN_QUICK_WIN` bloquantes ; uniquement des restructurations →
`AUCUN_QUICK_WIN` ; avancement `null` quand tout est abandonné.
(P4) restructuration au 2027-05-01 (pile la borne basse) → `RESTRUCTURATION_HORS_FENETRE` ; au 2028-11-01
(borne haute) → aucune anomalie ; au 2028-11-02 → anomalie ; quick win au 2027-05-01 → aucune anomalie.
(P5) impacts : trois actions non abandonnées avec impacts de trésorerie 33 333 333, 18 000 000 et nul, et de
résultat 0, 30 000 000, 50 400 000 → `impactTresorerieUnique` 51 333 333, `impactResultatAnnuel` 80 400 000 ;
une action abandonnée n'ajoute rien.
(P6) `organiserKanban` : tri par rang, puis échéance, puis numéro ; colonnes vides présentes ; abandonnées à part.
(P7) `construireContenuPlan` + `serialiserContenuPlan` : l'ordre d'entrée ne change pas la chaîne ; changer le
**statut** ou le **rang** d'une action ne la change pas ; changer l'**échéance**, le titre ou le responsable la
change ; une action abandonnée disparaît.
(P8) `comparerContenusPlan` : une action ajoutée (n° 6), une retirée (n° 3), une modifiée (n° 2) → `ajoutees` [6],
`retirees` [3], `modifiees` [2] ; contenus identiques → trois listes vides.

### 6.9 `leviers.ts` — RED-14

```ts
export const VERSION_CATALOGUE_LEVIERS = 1;
export const CODES_LEVIER = [
  "reduction_delai_clients", "reduction_stocks", "allongement_delai_fournisseurs",
  "reduction_charges_fixes", "hausse_prix", "cession_actif",
] as const;
export type CodeLevier = (typeof CODES_LEVIER)[number];
export type FamilleLevier = "bfr" | "couts_fixes" | "prix" | "cessions";

export interface ParametreLevier {
  readonly cle: string; readonly libelle: string;
  readonly unite: "jours" | "pb" | "mois" | "montant"; readonly min: number; readonly max: number;
}
export interface DefinitionLevier {
  readonly code: CodeLevier; readonly famille: FamilleLevier; readonly libelle: string; readonly description: string;
  readonly postesBase: readonly PosteRatioRedressement[];     // postes de l'état accepté dont le calcul a besoin
  readonly parametres: readonly ParametreLevier[];
  readonly hypotheses: readonly string[];                     // phrases françaises affichées avec le résultat
}
export const CATALOGUE_LEVIERS: readonly DefinitionLevier[];

export interface ParametresParLevier {
  reduction_delai_clients: { joursGagnes: number };
  reduction_stocks: { reductionPb: number };
  allongement_delai_fournisseurs: { joursGagnes: number };
  reduction_charges_fixes: { chargesFixesAnnuelles: number; reductionPb: number; moisMiseEnOeuvre: number };
  hausse_prix: { hausseParPb: number; perteVolumePb: number };
  cession_actif: { prixCession: number; valeurComptableNette: number; fraisEtImpots: number };
}
export interface BaseLevier {
  readonly devise: Devise;
  readonly postes: Readonly<Partial<Record<PosteRatioRedressement, number>>>;    // postes agrégés du dernier état accepté
}
export interface ImpactLevier {
  readonly code: CodeLevier;
  readonly devise: Devise;
  readonly tresorerieUnique: number;        // liquidités dégagées une fois (BFR, cession)
  readonly resultatAnnuel: number;          // gain annuel récurrent (charges fixes, prix)
  readonly tresorerieAnnee1: number;        // effet de trésorerie sur la première année
  readonly plusOuMoinsValue: number | null; // cession seulement
  readonly base: Readonly<Partial<Record<PosteRatioRedressement, number>>>;      // postes effectivement utilisés
  readonly hypotheses: readonly string[];
  readonly versionCatalogue: number;
}
export function calculerImpactLevier<C extends CodeLevier>(
  code: C, parametres: ParametresParLevier[C], base: BaseLevier,
): ImpactLevier;
```

**Formules** (exactes, **un seul arrondi** demi s'éloignant de zéro, en `BigInt`).

| Levier                           | Base requise                | Paramètres (bornes)                                                                 | `tresorerieUnique`            | `resultatAnnuel`                                                  | `tresorerieAnnee1`                          |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| `reduction_delai_clients`        | `chiffre_affaires`          | `joursGagnes` 1..180                                                                | CA × jours / 360              | 0                                                                 | = `tresorerieUnique`                        |
| `reduction_stocks`               | `stocks`                    | `reductionPb` 1..10000                                                              | stocks × pb / 10000           | 0                                                                 | = `tresorerieUnique`                        |
| `allongement_delai_fournisseurs` | `cout_ventes`               | `joursGagnes` 1..180                                                                | coût des ventes × jours / 360 | 0                                                                 | = `tresorerieUnique`                        |
| `reduction_charges_fixes`        | aucune                      | `chargesFixesAnnuelles` 0..10^13 ; `reductionPb` 1..10000 ; `moisMiseEnOeuvre` 0..12 | 0                             | charges fixes × pb / 10000                                        | résultat annuel × (12 − mois) / 12          |
| `hausse_prix`                    | `chiffre_affaires`, `cout_ventes` | `hausseParPb` 1..5000 ; `perteVolumePb` 0..9999                                | 0                             | (1 − v) × (CA × (1 + p) − CV) − (CA − CV), v et p en fraction     | = `resultatAnnuel`                          |
| `cession_actif`                  | aucune                      | `prixCession`, `valeurComptableNette`, `fraisEtImpots` 0..10^13, `fraisEtImpots` ≤ `prixCession` | prix − frais et impôts | 0                                                                 | = `tresorerieUnique` ; `plusOuMoinsValue` = prix − VNC |

Hypothèses (phrases du catalogue, affichées avec le résultat) : l'achat annuel est assimilé au coût des
ventes (allongement fournisseurs) ; le coût des ventes varie avec le volume (prix) ; les charges fixes
indiquées sont celles du client, saisies par le consultant ; aucun effet de second tour (les leviers ne se
cumulent pas mécaniquement). **Un levier ne dit pas quoi faire** : il chiffre un ordre de grandeur.
Erreurs : code inconnu (`LEVIER_INCONNU`) ; paramètre hors bornes, non entier ou absent
(`PARAMETRES_LEVIER_INVALIDES`) ; poste de base absent (`BASE_INCOMPLETE`, `manquants` = les postes) ; devise
de base absente.

**Cas de test attendus** (`leviers.test.ts`), base A (CA 1 200 000 000 ; stocks 120 000 000 ; coût des ventes
780 000 000, XOF).
(L1) `reduction_delai_clients` 10 jours → 1,2 G × 10 / 360 = 33 333 333,33 → **33 333 333**.
(L2) `reduction_stocks` 1500 pb → **18 000 000**.
(L3) `allongement_delai_fournisseurs` 15 jours → 780 M × 15 / 360 = **32 500 000**.
(L4) `reduction_charges_fixes` charges fixes 300 000 000, 1000 pb, mise en œuvre au mois 3 → `resultatAnnuel`
**30 000 000**, `tresorerieAnnee1` 30 M × 9 / 12 = **22 500 000**, `tresorerieUnique` 0.
(L5) `hausse_prix` +500 pb, perte de volume 200 pb : ((10 000 − 200) × (CA × 10 500 − CV × 10 000) / 10^8) −
(CA − CV) = 470 400 000 − 420 000 000 = **50 400 000**.
(L6) `cession_actif` prix 80 000 000, VNC 50 000 000, frais et impôts 4 000 000 → `tresorerieUnique`
**76 000 000**, `plusOuMoinsValue` **30 000 000**.
(L7) bornes : 0 ou 181 jours, 10 001 pb, mois 13, frais > prix → `PARAMETRES_LEVIER_INVALIDES` ;
`reduction_delai_clients` sans `chiffre_affaires` → `BASE_INCOMPLETE` avec `manquants = ["chiffre_affaires"]` ;
code inconnu → `LEVIER_INCONNU`.
(L8) arrondi : 1 jour sur un CA de 540 → 540 / 360 = 1,5 → **2** ; un gain négatif de hausse de prix (perte de
volume forte) est rendu **négatif**, pas tronqué à 0.
(L9) catalogue : six entrées, codes uniques, chaque `postesBase` ⊂ `POSTES_RATIO_REDRESSEMENT`, chaque paramètre
`min ≤ max` ; `ImpactLevier.versionCatalogue` = 1 ; la devise du résultat est celle de la base.

### 6.10 `index.ts`

Ré-exporte tout ce qui précède (constantes, types, fonctions) et `VERSION_MOTEUR_REDRESSEMENT`. Le
parité enums moteur ↔ schémas partagés est testée côté API (§9.9, `redressement-parite.test.ts`).

---

## 7. Schémas partagés `packages/shared/src/schemas/redressement.ts` (agent 1)

Un fichier (et son `redressement.test.ts`), réexporté par `packages/shared/src/index.ts` (une ligne,
après `copilote`). **Tous les `z.object` sont `.strict()`** (recherche mécanique n° 12 : 0 écart) ; les
dates passent par `dateIsoBorneeSchema` ; le même schéma sert l'API et le web. `packages/shared` ne
peut pas importer `packages/engines` : les listes d'énumérations sont **dupliquées** (comme
`SECTIONS_ETAT_FINANCIER_DOSSIER`) et un test d'API en vérifie la parité (§9.9).

### 7.1 Constantes (préfixe `RED_`, libellés français, plafonds)

| Constante                                           | Contenu                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `RED_SECTEURS`, `RED_SECTEUR_LIBELLES`              | `general` « Général », `industrie` « Industrie », `commerce` « Commerce », `services` « Services », `btp` « BTP », `agriculture` « Agriculture et agro-industrie » |
| `RED_STATUTS_DOSSIER`, `…_LIBELLES`                 | `ouvert` « Ouvert », `diagnostic` « Diagnostic », `plan_valide` « Plan validé », `mise_en_oeuvre` « Mise en œuvre », `clos` « Clos »        |
| `RED_POSTES`, `RED_POSTE_LIBELLES`                  | les 14 postes de §6.3 (« Stocks », « Créances clients », « Autres créances », « Trésorerie (actif) », « Capital », « Capitaux propres », « Dettes financières », « Dettes fournisseurs », « Dettes à court terme », « Chiffre d'affaires », « Coût des ventes », « Résultat d'exploitation », « Charges financières », « Résultat net ») |
| `RED_CLES_RATIO`, `RED_RATIO_LIBELLES`              | les 10 ratios (« Liquidité générale », « Liquidité réduite », « Liquidité immédiate », « Autonomie financière », « Solvabilité générale », « Endettement », « Marge brute », « Marge nette », « Couverture des charges financières », « BFR en jours de chiffre d'affaires ») + `RED_RATIO_UNITES` (`pb` ou `jours`) |
| `RED_STATUTS_RATIO`, `RED_RAISONS_RATIO` + libellés | « Calculé », « Sans objet », « Non calculable », « Non significatif » ; raisons : « Postes à renseigner », « Totaux du bilan absents », « Dénominateur nul ou négatif », « Aucune dette », « Aucune charge financière » |
| `RED_DOMAINES`, `RED_DOMAINE_LIBELLES`              | `tresorerie` « Trésorerie et paiements », `activite` « Activité commerciale », `exploitation` « Exploitation », `social` « Social et ressources humaines », `financement` « Financement et gouvernance » |
| `RED_REPONSES_URGENCE`, `…_LIBELLES`                | `non` « Non », `partiellement` « Partiellement », `oui` « Oui », `inconnu` « Je ne sais pas »                                              |
| `RED_VOYANTS`, `RED_VOYANT_LIBELLES`                | `vert` « Maîtrisé », `orange` « Vigilance », `rouge` « Critique », `non_evalue` « Non évalué »                                             |
| `RED_CRITERES_ALERTE`, `…_LIBELLES`, `…_UNITES`, `…_SENS` | les 12 critères de §6.5 avec unité (`pb`, `jours`, `nombre`, `oui_non`) et sens (`bas_pire` / `haut_pire`)                            |
| `RED_NIVEAUX_ALERTE`, `…_LIBELLES`                  | `insuffisant` « Données insuffisantes », `faible` « Faible », `modere` « Modéré », `eleve` « Élevé », `critique` « Critique »              |
| `RED_CATEGORIES_ENCAISSEMENT`, `RED_CATEGORIES_DECAISSEMENT`, `…_LIBELLES` | « Clients », « Autres encaissements », « Financement », « Cessions » ; « Fournisseurs », « Salaires », « Impôts, taxes et charges sociales », « Loyers et charges », « Service de la dette », « Investissements », « Autres décaissements » |
| `RED_CATEGORIES_CREANCIER`, `…_LIBELLES`            | « Fournisseur », « Banque », « Administration fiscale », « Organisme social », « Bailleur », « Autre »                                      |
| `RED_TYPES_EVENEMENT_NEGOCIATION`, `…_LIBELLES`     | « Ouverture », « Proposition de l'entreprise », « Contre-proposition du créancier », « Accord », « Rupture de l'accord », « Paiement », « Note » |
| `RED_VOLETS`, `RED_VOLET_LIBELLES`                  | `quick_win` « Quick wins (3 à 6 mois) », `restructuration` « Restructuration et mise à niveau (6 à 24 mois) »                              |
| `RED_STATUTS_ACTION`, `…_LIBELLES`, `RED_COLONNES_KANBAN` | « À faire », « En cours », « Bloquée », « Terminée », « Abandonnée » ; colonnes : les quatre premiers                                |
| `RED_CODES_LEVIER`, `RED_FAMILLES_LEVIER`, `…_LIBELLES` | les 6 leviers (« Réduire le délai de paiement des clients », « Réduire les stocks », « Allonger le délai de paiement des fournisseurs », « Réduire les charges fixes », « Augmenter les prix », « Céder un actif ») ; familles « BFR », « Coûts fixes », « Prix », « Cessions » |
| `RED_MONTANT_MAX`                                   | 10 000 000 000 000                                                                                                                         |
| Plafonds `RED_*_MAX`                                | voir §9.5 (valeurs et noms) : `RED_CORRESPONDANCES_MAX`, `RED_URGENCES_MAX`, `RED_SCORES_MAX`, `RED_SEUILS_PAR_SECTEUR_MAX`, `RED_VERSIONS_TRESORERIE_MAX`, `RED_LIGNES_TRESORERIE_MAX`, `RED_REALISES_MAX`, `RED_CORRECTIONS_SEMAINE_MAX`, `RED_CREANCIERS_MAX`, `RED_CREANCES_MAX`, `RED_EVENEMENTS_NEGOCIATION_MAX`, `RED_ECHEANCES_MAX`, `RED_ACTIONS_MAX`, `RED_EVENEMENTS_ACTION_MAX`, `RED_VERSIONS_PLAN_MAX` |

### 7.2 Schémas d'entrée (un par route d'écriture ou de calcul)

Les champs sont en `snake_case`. `montant` = `z.number().int().min(0).max(RED_MONTANT_MAX)` ;
`montantPositif` = `min(1)` ; `solde` = entier entre `−RED_MONTANT_MAX` et `RED_MONTANT_MAX` ;
`lundi` = `dateIsoBorneeSchema.refine(date → jour de semaine UTC = 1, « Un lundi est attendu. »)`.

| Schéma                              | Corps                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redDossierCreationSchema`          | `{ intitule: texte(200), secteur: enum RED_SECTEURS (défaut "general") }`                                                                                                                                                                  |
| `redDossierModificationSchema`      | `{ intitule?, secteur? }`, au moins un champ (`auMoinsUnChamp`)                                                                                                                                                                            |
| `redDossierStatutSchema`            | `{ statut: "mise_en_oeuvre" \| "clos", motif?: texteOptionnel(1000) }` ; `clos` exige un motif d'au moins 10 caractères                                                                                                                    |
| `redListeDossiersQuerySchema`       | `{ limite: 1..100 (défaut 30), curseur?: string ≤ 500, statut?, secteur?, client_id?: uuid, q?: string ≤ 100 }`                                                                                                                            |
| `redCorrespondanceCreationSchema`   | `{ postes: record(clé ∈ RED_POSTES → { codes: string[] ≤ 50 de ^[A-Za-z0-9_.-]{1,40}$, sans_objet: boolean }), motif?: texteOptionnel(500) }`, au moins un poste, `sans_objet` ⇒ `codes` vide, sinon `codes` non vide                       |
| `redUrgenceCreationSchema`          | `{ reponses: record(^[TAESF][1-3]$ → enum RED_REPONSES_URGENCE) de 1 à 15 entrées, duree_secondes?: 0..86400, commentaire?: texteOptionnel(2000) }`                                                                                         |
| `redSeuilsSchema`                   | `{ criteres: objet des 12 clés RED_CRITERES_ALERTE → { orange: int, rouge: int, poids: int }, niveaux: { modere, eleve, critique: int }, part_minimale_evaluee_pct: int }` (forme seulement ; les règles sont dans `validerSeuilsAlerte`)    |
| `redSeuilsCreationSchema`           | `{ secteur: enum RED_SECTEURS, seuils: redSeuilsSchema, motif?: texteOptionnel(500) }`                                                                                                                                                     |
| `redSeuilsQuerySchema`              | `{ secteur?: enum RED_SECTEURS }`                                                                                                                                                                                                          |
| `redScoreCreationSchema`            | `{ incidents: { rejets_bancaires_12m?: int 0..999 \| null, retards_fournisseurs_90j?: int 0..999 \| null, arrieres_fiscaux_sociaux?: boolean \| null } }` (défaut `{}` : rien de renseigné)                                                  |
| `redHistoriqueQuerySchema`          | `{ limite: 1..50 (défaut 20), curseur?: string ≤ 500 }`                                                                                                                                                                                    |
| `redTresorerieVersionCreationSchema` | `{ date_debut: lundi, solde_initial: solde, seuil_tension: montant (défaut 0), lignes: 0..600 de { semaine: 1..13, sens, categorie (∈ liste du sens), libelle?: texteOptionnel(200), montant: montantPositif, creancier_id?: uuid, echeance_id?: uuid } (`echeance_id` ⇒ `creancier_id`), motif?: texteOptionnel(500) }` |
| `redRealiseCreationSchema`          | `{ semaine_debut: lundi, flux: { encaissement?: record(catégorie → montant), decaissement?: record(catégorie → montant) }, solde_constate?: solde \| null, commentaire?: texteOptionnel(1000) }`                                           |
| `redPointMortSchema`                | `{ chiffre_affaires: montant, charges_variables: montant, charges_fixes: montant, periode_jours?: 1..366 }`                                                                                                                                |
| `redCreancierCreationSchema`        | `{ nom: texte(200), categorie, garanti?: boolean (défaut false), reference?: texteOptionnel(120), principal: montant, interets?: montant (défaut 0), date_arrete: dateIsoBorneeSchema, echeance_initiale?: dateIsoBorneeSchema, nature?: texteOptionnel(200) }` |
| `redCreancierModificationSchema`    | `{ nom?, garanti?, reference?: texteOptionnel(120), actif? }`, au moins un champ                                                                                                                                                           |
| `redCreanceCreationSchema`          | `{ principal: montant, interets?: montant, date_arrete, echeance_initiale?, nature?, commentaire?: texteOptionnel(1000) }`                                                                                                                 |
| `redEvenementNegociationSchema`     | `z.discriminatedUnion("type", …)` : `ouverture` / `proposition` / `contre_proposition` / `note` : `{ type, date_evenement, montant?: montant, conditions?: texteOptionnel(2000) }` ; `accord` : `{ type, date_evenement, montant: montantPositif, conditions?, echeancier: { mode: "regulier", nombre_echeances: 1..60, date_premiere, periodicite_mois: 1..12 } \| { mode: "explicite", lignes: 1..60 de { date, montant: montantPositif } } }` ; `paiement` : `{ type, date_evenement, montant: montantPositif, accord_id: uuid, echeance_rang?: 1..60 }` ; `rupture` : `{ type, date_evenement, accord_id: uuid, conditions? }` |
| `redActionCreationSchema`           | `{ titre: texte(200), description?: texteOptionnel(2000), volet, domaine, echeance: dateIsoBorneeSchema, responsable_id: uuid, levier?: { code: enum RED_CODES_LEVIER, parametres: record(string → entier) }, creer_tache?: boolean (défaut false) }`  |
| `redActionModificationSchema`       | mêmes champs, tous facultatifs, `levier` peut valoir `null` (retire le levier) ; sans `creer_tache` ; au moins un champ                                                                                                                    |
| `redActionDeplacementSchema`        | `{ statut: enum RED_STATUTS_ACTION, rang?: 0..100000, motif?: texteOptionnel(1000), termine_le?: dateIsoBorneeSchema }`                                                                                                                    |
| `redCommentaireSchema`              | `{ commentaire: texte(1000) }`                                                                                                                                                                                                             |
| `redPlanVersionCreationSchema`      | `{ date_reference?: dateIsoBorneeSchema }` (défaut : aujourd'hui, UTC)                                                                                                                                                                     |
| `redPlanValidationSchema`           | `{ motif?: texteOptionnel(2000) }`                                                                                                                                                                                                         |
| `redLevierSimulationSchema`         | `{ code: enum RED_CODES_LEVIER, parametres: record(string → entier) }` (les bornes par levier sont celles du moteur : `PARAMETRES_LEVIER_INVALIDES`)                                                                                       |

### 7.3 Types de réponse partagés (interfaces TypeScript, sans Zod)

Convention : une sortie de moteur est rendue par un **miroir snake_case** de l'interface du moteur (mêmes
champs, mêmes types, sans `readonly`) ; l'API le fabrique dans `redressement/vues.ts` par un transformateur
explicite (jamais par un parcours générique des clés de données comme les codes de questions « T1 » ou les noms
de postes). Types à exporter :

`RedPersonne { id, nom }` ; `RedDossierResume`, `RedDossierVue` (champs en §9.3, route 5) ;
`RedCorrespondanceVue { version, postes, motif, cree_par: RedPersonne, cree_le }` ;
`RedRatiosVue` (route 10) avec `RedRatiosExerciceVue` ↔ `RatiosExercice`, `RedTendancesVue` ↔ `TendancesRedressement` ;
`RedUrgenceVue` avec `RedResultatUrgenceVue` ↔ `ResultatUrgence` ; `RedSeuils` (forme JSON des seuils) ;
`RedSeuilsVersionVue`, `RedSeuilsEtatVue` (route 13) ; `RedScoreVue` avec `RedScoreAlerteVue` ↔ `ScoreAlerte` ;
`RedTresorerieVue` avec `RedProjectionVue` ↔ `ResultatTresorerie` et `RedPropositionEcheancesVue` ↔
`PropositionEcheances` ; `RedPointMortVue` ↔ `ResultatPointMort` ; `RedCreancierResume`, `RedCreancierVue`,
`RedSituationCreancierVue` ↔ `SituationCreancier`, `RedSynthesePassifVue` ↔ `SynthesePassif` ;
`RedActionVue`, `RedPlanVue` avec `RedEvaluationPlanVue` ↔ `EvaluationPlan` et `RedEcartPlanVue` ↔ `EcartPlan` ;
`RedImpactLevierVue` ↔ `ImpactLevier` ; `RedReferentielVue` (route 1).

### 7.4 Tests (`redressement.test.ts`)

Chaque schéma : un cas valide, un cas par champ obligatoire manquant, un champ inconnu rejeté (`.strict()`), les
bornes (0, max, max + 1), date hors 2000–2100 rejetée, **date non lundi** rejetée, `echeance_id` sans `creancier_id`
rejeté, catégorie hors du sens rejetée, discriminant inconnu rejeté, `clos` sans motif rejeté. Les listes de
libellés : chaque valeur d'énumération a un libellé (aucun trou), libellés sans identifiant technique.

---

## 8. Permissions (agent 1, `packages/shared/src/roles.ts` et `roles.test.ts`)

Quatre permissions, dans un bloc commenté « V3, vague 4 (PRD complémentaire §11.5) : redressement.
Visibilité de la mission TOUJOURS exigée en plus ; ni ressources, ni gestionnaire, ni expert externe (données du
client) » :

| Permission               | Portée                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `redressement.lire`      | lire un dossier de redressement : ratios, urgence, scores, trésorerie, créanciers, plan, leviers, seuils             |
| `redressement.ecrire`    | ouvrir un dossier, renseigner correspondance, urgence, scores, trésorerie, créanciers, négociations, actions, versions de plan |
| `redressement.valider`   | valider une version de plan ; clore un dossier                                                                        |
| `redressement.parametrer` | rédiger et publier les seuils d'alerte par secteur (les experts du cabinet)                                          |

**Matrice** (`oui` = détient la permission ; l'associé reçoit les quatre par `TOUS`, il suffit de ne pas les
ajouter à `RESERVEES_A_UN_ROLE`) :

| Rôle                | `lire` | `ecrire` | `valider` | `parametrer` | Justification                                                                                                         |
| ------------------- | :----: | :------: | :-------: | :----------: | --------------------------------------------------------------------------------------------------------------------- |
| `associe`           |  oui   |   oui    |    oui    |     oui      | toutes les permissions du cabinet                                                                                     |
| `directeur_mission` |  oui   |   oui    |    oui    |     non      | signe le plan (R3, PRD complémentaire §10) ; ne fixe pas les seuils du cabinet                                        |
| `chef_mission`      |  oui   |   oui    |    non    |     non      | mène le dossier ; ne valide pas son propre plan                                                                       |
| `consultant`        |  oui   |   oui    |    non    |     non      | saisit                                                                                                                |
| `ressources`        |  non   |   non    |    non    |     non      | données du client, comme le plan et le dossier                                                                        |
| `gestionnaire`      |  non   |   non    |    non    |     non      | `finance.lire` **ne donne pas** accès : les données sont celles du client, pas du cabinet (H8)                        |
| `expert_metier`     |  oui   |   non    |    non    |     oui      | relit, fixe les seuils (comme `standard.gerer`) ; n'écrit pas dans le dossier                                          |
| `expert_externe`    |  non   |   non    |    non    |     non      | —                                                                                                                     |
| `client_*` (portail) |  non   |   non    |    non    |     non      | aucun rôle du portail ; `PERMISSIONS_PORTAIL_CLIENT` inchangée                                                         |

Tests ajoutés (nouveau `describe` « V3, vague 4 : redressement ») : (1) les quatre permissions sont dans
`PERMISSIONS` ; (2) matrice ci-dessus, rôle par rôle, y compris `ROLES_CLIENT` ; (3) `valider` = associé et
directeur seulement ; `parametrer` = associé et expert métier seulement ; (4) quiconque détient `redressement.lire`
ou `redressement.ecrire` détient aussi `dossier.lire` (les ratios lisent les états du dossier) ; (5) aucun rôle du
portail ne détient l'une des quatre ; (6) `finance.lire` n'implique aucune des quatre ; (7) le test existant
« chaque rôle a une liste de droits connus » reste vert.

---

## 9. API (agent 2)

### 9.1 Règles d'accès (`apps/api/src/redressement/acces.ts`, règle écrite en tête comme `kpi/acces.ts`)

1. **Lire** (`redressement.lire`) : le dossier est visible si la **mission** l'est (`exigerMissionVisible`,
   `missions/acces.ts` : `mission.lire_toutes`, ou directeur, chef, membre d'équipe). Dossier inconnu, d'un autre
   cabinet ou d'une mission invisible : **404** (`Dossier de redressement`). Les données du dossier client sont lues
   avec les droits de l'appelant, qui détient toujours `dossier.lire` (§8).
2. **Écrire** (`redressement.ecrire`) : `exigerDossierRedressementEcriture` = dossier visible, **et** (`peutModifierMission`
   **ou** membre de `mission_equipe`) sinon 403, **et** dossier non `clos` (409 `RED_DOSSIER_CLOS`) **et** mission
   non clôturée (409 `RED_MISSION_CLOTUREE`) ; prend le verrou consultatif du dossier (§5.4) en tout premier.
   Lire toutes les missions ne suffit pas à écrire.
3. **Ouvrir un dossier** : `redressement.ecrire` et `exigerMissionModifiable` (directeur, chef, ou
   `mission.modifier_toutes`) ; un simple membre d'équipe n'ouvre pas.
4. **Valider** (`redressement.valider`) : dossier visible ; le contrôle de séparation des tâches est en §9.7.
5. **Seuils** (`redressement.parametrer`) : pas de mission ; lecture ouverte à `redressement.lire`.
6. Une **personne du portail** n'est jamais désignée (responsable d'action, assignée d'une tâche) : 400 ; les routes
   sont fermées au portail (403 `PORTAIL_ROUTE_INTERDITE`, §9.8).

### 9.2 Fichiers (territoire de l'agent 2)

- `apps/api/migrations/0480…0486` (§5).
- `apps/api/src/redressement/` : `acces.ts`, `erreurs.ts` (`traduireErreurRedressement` : `MPZ01–11`, 23514, 23505,
  23503, `ErreurRedressement` → `AppError`), `limites.ts` (`verifierDebit`), `vues.ts` (transformateurs camelCase → snake_case des sorties de moteur, et `seuilsDepuisJson` / `seuilsVersJson` pour les seuils stockés en snake_case), `referentiel.ts`,
  `dossiers.ts`, `etats.ts` (états acceptés du dossier client, lecture seule), `correspondances.ts`, `ratios.ts`,
  `urgence.ts`, `seuils.ts`, `alerte.ts`, `tresorerie.ts`, `realises.ts`, `creanciers.ts`, `negociations.ts`,
  `actions.ts`, `plan.ts`, `leviers.ts`. Une fonction ne commence pas sa propre transaction : elle reçoit `Db`.
- `apps/api/src/routes/redressement.ts` (dossiers, ratios, urgence : routes 1 à 12),
  `redressement-alerte.ts` (13 à 17), `redressement-tresorerie.ts` (18 à 22), `redressement-creanciers.ts`
  (23 à 28), `redressement-plan.ts` (29 à 37) ; `routes/redressement.ts` exporte `routesRedressement` qui
  enregistre les quatre autres (modèle `routes/kpi.ts` → `routesKpiPilotage`) ; **une ligne** dans
  `apps/api/src/app.ts` : `await app.register((await import("./routes/redressement.js")).routesRedressement, { prefix: "/api" });`
  après celle de `kpi.js`.
- Tests : §9.9. Base de test de l'agent : `missionpilot_red` (RUNBOOK, « agents »).

### 9.3 Routes

Toutes sous `/api`, session obligatoire (`exiger`), 401 sans session, 403 sans droit. Entrées validées par les
schémas de §7. **L** = `redressement.lire` et mission visible ; **E** = `redressement.ecrire` et
`exigerDossierRedressementEcriture` ; **E+** = `redressement.ecrire` et `exigerMissionModifiable` (ouverture
d'un dossier) ; **V** = `redressement.valider` ; **P** = `redressement.parametrer`.
Les codes d'erreur propres sont en §9.4 (en plus de 400 `REQUETE_INVALIDE`, 401, 403, 404). Les listes paginées par
curseur rendent `{ elements, suivant }` (`encoderCurseur`, tri `cree_le DESC, id DESC`).

| N°  | Méthode et chemin                                                  | Droit | Entrée                              | Réponse                                                                                       | Erreurs notables                                                              |
| --- | ------------------------------------------------------------------ | :---: | ----------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `GET /redressement/referentiel`                                    | L     | —                                   | `RedReferentielVue` (listes, libellés, grille d'urgence, catalogue de leviers, seuils par défaut du moteur, plafonds, correspondance indicative) : **aucune lecture en base** ; `cache-control: private` | —                                                                             |
| 2   | `GET /redressement/dossiers`                                       | L     | `redListeDossiersQuerySchema`       | page de `RedDossierResume` (missions visibles seulement)                                       | —                                                                             |
| 3   | `POST /missions/:id/redressement`                                  | E+    | `redDossierCreationSchema`          | 201 `RedDossierVue` (devise de la mission)                                                     | 404 mission, 403, 409 `RED_EXISTE`, `RED_MISSION_CLOTUREE`                    |
| 4   | `GET /missions/:id/redressement`                                   | L     | —                                   | `RedDossierVue`                                                                                | 404 `RED_ABSENT` (mission visible, pas de dossier), 404 mission               |
| 5   | `GET /redressement/dossiers/:id`                                   | L     | —                                   | `RedDossierVue`                                                                                | 404                                                                           |
| 6   | `PATCH /redressement/dossiers/:id`                                 | E     | `redDossierModificationSchema`      | `RedDossierVue`                                                                                | 409 `RED_DOSSIER_CLOS`                                                        |
| 7   | `POST /redressement/dossiers/:id/statut`                           | E, et V pour `clos` | `redDossierStatutSchema` | `RedDossierVue`                                                                              | 409 `RED_TRANSITION_INVALIDE` (mise en œuvre sans plan validé)                |
| 8   | `GET /redressement/dossiers/:id/correspondances`                   | L     | —                                   | `{ courante: RedCorrespondanceVue \| null, historique: [{ version, cree_par, cree_le, motif }] (≤ 100), indicative }` | —                                                                             |
| 9   | `POST /redressement/dossiers/:id/correspondances`                  | E     | `redCorrespondanceCreationSchema`   | 201 `RedCorrespondanceVue`                                                                     | 400 `RED_CORRESPONDANCE_INVALIDE`, `RED_POSTE_INCONNU`, 409 `RED_PLAFOND_ATTEINT` |
| 10  | `GET /redressement/dossiers/:id/ratios`                            | L     | —                                   | `RedRatiosVue` : `{ correspondance_version, exercices: RedRatiosExerciceVue[] (au plus 3, le plus récent d'abord ; chacun avec etat_id, date_cloture, accepte_sous_reserve), tendances, etats_non_utilises: [{ etat_id, exercice, statut }], analyses_indicatives, fiabilite: { classe, points } }` | —                                                                             |
| 11  | `GET /redressement/dossiers/:id/urgences`                          | L     | `redHistoriqueQuerySchema`          | page de `RedUrgenceVue`                                                                        | —                                                                             |
| 12  | `POST /redressement/dossiers/:id/urgences`                         | E     | `redUrgenceCreationSchema`          | 201 `RedUrgenceVue`                                                                            | 400 `RED_QUESTION_INCONNUE`, `RED_REPONSE_INVALIDE`, 429 `RED_TROP_D_EVALUATIONS` |
| 13  | `GET /redressement/seuils`                                         | L     | `redSeuilsQuerySchema`              | `RedSeuilsEtatVue` : `{ secteurs: [{ secteur, en_vigueur: RedSeuilsVersionVue \| null, brouillon: RedSeuilsVersionVue \| null, historique (≤ 50) }], defaut_moteur: RedSeuils }` ; `peut_publier` (confort d'affichage, l'API reste juge) | —                                                                             |
| 14  | `POST /redressement/seuils`                                        | P     | `redSeuilsCreationSchema`           | 201 `RedSeuilsVersionVue` (brouillon, numéro attribué)                                         | 400 `RED_SEUILS_INVALIDES`, 409 `RED_PLAFOND_ATTEINT`                         |
| 15  | `POST /redressement/seuils/:id/publication`                        | P     | `{}` (strict)                       | `RedSeuilsVersionVue` (publiée)                                                                | 403 `SEPARATION_DES_TACHES`, 409 `RED_SEUILS_NON_BROUILLON`, `RED_VERSION_NON_CONSECUTIVE` |
| 16  | `GET /redressement/dossiers/:id/scores`                            | L     | `redHistoriqueQuerySchema`          | page de `RedScoreVue`                                                                          | —                                                                             |
| 17  | `POST /redressement/dossiers/:id/scores`                           | E     | `redScoreCreationSchema`            | 201 `RedScoreVue`                                                                              | 429 `RED_TROP_DE_SCORES`, 409 `RED_PLAFOND_ATTEINT`                           |
| 18  | `GET /redressement/dossiers/:id/tresorerie`                        | L     | —                                   | `RedTresorerieVue` : `{ version: { id, version, date_debut, solde_initial, seuil_tension, motif, cree_par, cree_le, lignes[] } \| null, realises: [{ id, semaine_debut, semaine, flux, solde_constate, commentaire, saisi_par, cree_le, corrections }] (lignes courantes de la fenêtre), realises_hors_fenetre: number, projection: RedProjectionVue \| null, historique: [{ id, version, date_debut, cree_par, cree_le, motif }] (≤ 200) }` | —                                                                             |
| 19  | `POST /redressement/dossiers/:id/tresorerie/versions`              | E     | `redTresorerieVersionCreationSchema` | 201 `RedTresorerieVue`                                                                         | 400 `RED_TRESORERIE_INVALIDE`, `RED_DATE_INVALIDE`, `RED_SEMAINE_INVALIDE`, `RED_RATTACHEMENT_INCOHERENT`, 429 `RED_TROP_DE_VERSIONS_TRESORERIE` |
| 20  | `POST /redressement/dossiers/:id/tresorerie/realises`              | E     | `redRealiseCreationSchema`          | 201 `RedTresorerieVue` (la ligne remplace la courante de la même semaine)                      | 409 `RED_TRESORERIE_ABSENTE`, `RED_SEMAINE_PRECEDENTE_MANQUANTE`, `RED_TROP_DE_CORRECTIONS`, 400 `RED_TRESORERIE_INVALIDE` (semaine hors de la fenêtre) |
| 21  | `GET /redressement/dossiers/:id/tresorerie/echeances-accords`      | L     | —                                   | `RedPropositionEcheancesVue` (échéances restantes des accords en vigueur, en lignes proposées ; **n'écrit rien**) | 409 `RED_TRESORERIE_ABSENTE`                                                  |
| 22  | `POST /redressement/dossiers/:id/point-mort`                       | L     | `redPointMortSchema`                | 200 `RedPointMortVue` ; **calcul pur, aucune écriture, aucun journal**                         | 400 `RED_ENTREE_INVALIDE`                                                     |
| 23  | `GET /redressement/dossiers/:id/creanciers?actifs=`                | L     | `actifs` : `true` (défaut), `false`, `tous` | `{ elements: RedCreancierResume[] (≤ 200), synthese: RedSynthesePassifVue, date_reference }`  | —                                                                             |
| 24  | `POST /redressement/dossiers/:id/creanciers`                       | E     | `redCreancierCreationSchema`        | 201 `RedCreancierVue` (créancier et créance n° 1 dans la même transaction)                     | 409 `RED_CREANCIER_EN_DOUBLE`, `RED_PLAFOND_ATTEINT`                          |
| 25  | `GET /redressement/creanciers/:id`                                 | L     | —                                   | `RedCreancierVue` : résumé + `creances` (≤ 100), `evenements` (≤ 300), `accord_en_vigueur: { id, date_evenement, montant_convenu, conditions, echeances, paiements } \| null` | 404                                                                           |
| 26  | `PATCH /redressement/creanciers/:id`                               | E     | `redCreancierModificationSchema`    | `RedCreancierVue`                                                                              | 409 `RED_CREANCIER_EN_DOUBLE`                                                 |
| 27  | `POST /redressement/creanciers/:id/creances`                       | E     | `redCreanceCreationSchema`          | 201 `RedCreancierVue`                                                                          | 409 `RED_PLAFOND_ATTEINT`                                                     |
| 28  | `POST /redressement/creanciers/:id/evenements`                     | E     | `redEvenementNegociationSchema`     | 201 `RedCreancierVue`                                                                          | 409 `RED_ACCORD_EN_VIGUEUR`, `RED_PAIEMENT_EXCESSIF`, `RED_ACCORD_ROMPU`, `RED_NEGOCIATION_INCOHERENTE`, 400 `RED_ECHEANCIER_INVALIDE`, `RED_ACCORD_SUPERIEUR_CREANCE`, 409 `RED_PLAFOND_ATTEINT` |
| 29  | `GET /redressement/dossiers/:id/plan`                              | L     | —                                   | `RedPlanVue` : `{ kanban: { colonnes: { a_faire, en_cours, bloquee, terminee: RedActionVue[] }, abandonnees: RedActionVue[] }, evaluation: RedEvaluationPlanVue, date_reference, versions (≤ 100, sans contenu, chacune avec peut_valider : confort d'affichage, même fonction que la validation), version_validee: id \| null, ecart_avec_version_validee: RedEcartPlanVue \| null }` | —                                                                             |
| 30  | `POST /redressement/dossiers/:id/actions`                          | E (+ `tache.assigner` si `creer_tache`) | `redActionCreationSchema` | 201 `RedActionVue`                                                                           | 400 `RED_LEVIER_INCONNU`, `RED_PARAMETRES_LEVIER_INVALIDES`, 409 `RED_BASE_INCOMPLETE`, `RED_DEVISE_ETAT_DIFFERENTE`, `RED_PLAFOND_ATTEINT`, 400 responsable invalide |
| 31  | `PATCH /redressement/actions/:id`                                  | E     | `redActionModificationSchema`       | `RedActionVue`                                                                                 | 409 `RED_TRANSITION_INVALIDE` (action terminée ou abandonnée)                 |
| 32  | `POST /redressement/actions/:id/deplacement`                       | E     | `redActionDeplacementSchema`        | `RedActionVue` (déplacement dans le kanban : statut et rang)                                   | 409 `RED_TRANSITION_INVALIDE`, 400 (motif ou date manquants)                  |
| 33  | `POST /redressement/actions/:id/commentaires`                      | E     | `redCommentaireSchema`              | 201 `RedActionVue`                                                                             | 409 `RED_PLAFOND_ATTEINT`                                                     |
| 34  | `GET /redressement/actions/:id`                                    | L     | —                                   | `RedActionVue` + `evenements` (≤ 200)                                                          | 404                                                                           |
| 35  | `POST /redressement/dossiers/:id/plan/versions`                    | E     | `redPlanVersionCreationSchema`      | 201 version de plan (brouillon, `contenu` construit par le moteur)                             | 409 `RED_PLAFOND_ATTEINT`                                                     |
| 36  | `POST /redressement/plan/versions/:id/validation`                  | V     | `redPlanValidationSchema`           | version validée ; le dossier passe à `plan_valide` s'il ne l'est pas déjà                      | 403 `SEPARATION_DES_TACHES`, 409 `RED_VERSION_NON_CONSECUTIVE`, `RED_PLAN_MODIFIE`, `RED_PLAN_INCOMPLET`, `RED_TRANSITION_INVALIDE` |
| 37  | `POST /redressement/dossiers/:id/leviers/simulation`               | L     | `redLevierSimulationSchema`         | 200 `RedImpactLevierVue` ; **aucune écriture, aucun journal**                                  | 400 `RED_LEVIER_INCONNU`, `RED_PARAMETRES_LEVIER_INVALIDES`, 409 `RED_BASE_INCOMPLETE`, `RED_DEVISE_ETAT_DIFFERENTE` |

**37 routes.** Recherche mécanique n° 10 attendue après le lot : `714 8` (677 + 37, toujours 8 sans `exiger`).
**Ce que voit le portail : rien** (aucune route dans `LISTE_BLANCHE_PORTAIL`, 403 `PORTAIL_ROUTE_INTERDITE`).

`RedDossierVue` (route 5) : `RedDossierResume` (`id`, `mission { id, intitule }`, `client { id, raison_sociale }`,
`intitule`, `secteur`, `devise`, `statut`, `ouvert_le`, `dernier_voyant_urgence`, `dernier_niveau_alerte`,
`dernier_score`) plus `modifie_le`, `clos_le`, `motif_cloture`, `urgence` (dernier : `id`, `voyant`, `cree_le`,
voyants par domaine) , `alerte` (dernier : `id`, `score`, `niveau`, `cree_le`, `seuils_source`, `seuils_version`),
`tresorerie` (version, `date_debut`, `semaines_tension`, `premiere_semaine_tension`, `solde_minimum`,
`besoin_financement`, `derniere_semaine_realisee`) ou `null`, `creanciers { nombre, encours_total, echu_total }`,
`plan { actions_par_statut, en_retard, version_courante, modifie_depuis_validation }`, `correspondance_version`,
`etats_acceptes`, `analyses_indicatives`, `droits { ecrire, valider }` (confort d'affichage).

`RedActionVue` : `id`, `numero`, `titre`, `description`, `volet`, `domaine`, `echeance`, `statut`, `rang`, `motif`,
`termine_le`, `responsable: RedPersonne`, `levier: { code, parametres, impact: RedImpactLevierVue } \| null`,
`tache_collaboration_id`, `en_retard: boolean`, `cree_par`, `cree_le`, `modifie_le`.

### 9.4 Codes d'erreur de domaine

Règle générale : une `ErreurRedressement` du moteur devient `AppError(400, "RED_" + code, message, { manquants })`,
**sauf** `PAIEMENT_EXCESSIF`, `ACCORD_ROMPU`, `BASE_INCOMPLETE` et `REALISE_NON_CONTIGU` (409). Les `MPZ…` et
contraintes sont traduits par `traduireErreurRedressement` selon le tableau de §5.3. Codes propres à l'API :
`RED_ABSENT` (404), `RED_EXISTE`, `RED_MISSION_CLOTUREE`, `RED_DOSSIER_CLOS`, `RED_TRESORERIE_ABSENTE`,
`RED_SEMAINE_PRECEDENTE_MANQUANTE`, `RED_ACCORD_EN_VIGUEUR`, `RED_CREANCIER_EN_DOUBLE`, `RED_SEUILS_NON_BROUILLON`,
`RED_PLAN_MODIFIE`, `RED_PLAN_INCOMPLET` (avec `details.manquants` = codes d'anomalie bloquante),
`RED_DEVISE_ETAT_DIFFERENTE`, `RED_TROP_D_EVALUATIONS`, `RED_TROP_DE_SCORES`, `RED_TROP_DE_VERSIONS_TRESORERIE`
(429). `SEPARATION_DES_TACHES` (403) est le code déjà employé ailleurs. Messages en français, sans montant ni nom.

### 9.5 Plafonds de volume et de débit (déclarés ; **provisoires**, §13)

| Objet                                   | Plafond                                         | Où appliqué                                                                    | Réponse                         |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| Dossiers                                | 1 par mission (pas de constante : unicité)       | unicité `(cabinet_id, mission_id)`                                             | 409 `RED_EXISTE`                |
| Versions de correspondance (`RED_CORRESPONDANCES_MAX`) | 100 par dossier                  | déclencheur (`MPZ10`)                                                          | 409 `RED_PLAFOND_ATTEINT`       |
| Évaluations d'urgence (`RED_URGENCES_MAX`) | 200 par dossier                              | déclencheur                                                                    | idem                            |
| Scores d'alerte (`RED_SCORES_MAX`)       | 500 par dossier                                 | déclencheur                                                                    | idem                            |
| Versions de seuils (`RED_SEUILS_PAR_SECTEUR_MAX`) | 50 par secteur et par cabinet         | déclencheur                                                                    | idem                            |
| Versions de trésorerie (`RED_VERSIONS_TRESORERIE_MAX`) | 200 par dossier                  | déclencheur                                                                    | idem                            |
| Lignes d'une version de trésorerie (`RED_LIGNES_TRESORERIE_MAX`) | 600                | schéma Zod **et** déclencheur                                                  | 400 puis 409                    |
| Réalisés de trésorerie (`RED_REALISES_MAX`, `RED_CORRECTIONS_SEMAINE_MAX` = 10) | 1 000 lignes par dossier ; 11 par semaine | déclencheur (`MPZ10`, `MPZ11`)                                                 | 409                             |
| Créanciers (`RED_CREANCIERS_MAX`)       | 200 par dossier                                 | déclencheur                                                                    | 409                             |
| Versions de créance (`RED_CREANCES_MAX`) | 100 par créancier                              | déclencheur                                                                    | 409                             |
| Événements de négociation (`RED_EVENEMENTS_NEGOCIATION_MAX`) | 300 par créancier          | déclencheur                                                                    | 409                             |
| Échéances d'un accord (`RED_ECHEANCES_MAX`) | 60                                           | schéma Zod et déclencheur                                                      | 400 puis 409                    |
| Actions (`RED_ACTIONS_MAX`, `RED_EVENEMENTS_ACTION_MAX`) | 300 par dossier ; 200 événements par action | déclencheur                                                                    | 409                             |
| Versions de plan (`RED_VERSIONS_PLAN_MAX`) | 100 par dossier                              | déclencheur                                                                    | 409                             |
| `limite` des listes                     | dossiers 100 ; urgences et scores 50            | schémas                                                                        | 400 au-delà (déclaré au web : `limiteMax`) |
| **Débit** : évaluations d'urgence       | 30 par utilisateur et par 10 minutes            | `verifierDebit` : comptage de `journal_audit` (entité `red_urgence`, action `urgence`) sous verrou consultatif `redressement_debit:<utilisateur>:urgence` | 429 `RED_TROP_D_EVALUATIONS`    |
| **Débit** : scores                      | 30 par utilisateur et par 10 minutes            | idem (entité `red_score`, action `score`)                                                    | 429 `RED_TROP_DE_SCORES`        |
| **Débit** : versions de trésorerie      | 60 par utilisateur et par 10 minutes            | idem (entité `red_tresorerie`, action `tresorerie_version`)                                       | 429 `RED_TROP_DE_VERSIONS_TRESORERIE` |
| Calculs purs (routes 1, 22, 37)         | aucun plafond de débit : O(1), sans E/S ni écriture, corps ≤ 2 Ko | —                                                                    | — (déclaré ici faute de compteur partagé : un compteur en mémoire est refusé, SECURITY.md §15) |
| Corps de requête                        | `bodyLimit` global inchangé (1 Mio) ; une version de trésorerie de 600 lignes pèse < 100 Ko | Fastify                                                    | 413                             |

### 9.6 Journal d'audit (`journaliser`, même transaction)

Détails = **identifiants, comptes et codes**, jamais un montant, un nom de créancier, une condition de
négociation, un titre d'action, un commentaire ni un motif.

| Entité                  | Actions (détails)                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `red_dossier`           | `creation` (`mission_id`, `client_id`, `secteur`), `modification` (noms des champs), `statut` (`de`, `vers`)        |
| `red_correspondance`    | `creation` (`dossier_id`, `version`, nombre de postes)                                                              |
| `red_urgence`           | `urgence` (`dossier_id`, `voyant`, `grille_version`)                                                                 |
| `red_seuils`            | `creation` (`secteur`, `version`), `publication` (`secteur`, `version`)                                             |
| `red_score`             | `score` (`dossier_id`, `niveau`, `score`, `seuils_source`, `seuils_version`)                                         |
| `red_tresorerie`        | `tresorerie_version` (`dossier_id`, `version`, nombre de lignes), `realise` (`dossier_id`, `semaine_debut`, `correction`) |
| `red_creancier`         | `creation` (`dossier_id`, `categorie`), `modification` (noms des champs), `creance` (`version`), `evenement` (`type`) |
| `red_action`            | `creation`, `modification` (noms des champs), `statut` (`de`, `vers`), `commentaire`                                 |
| `red_plan_version`      | `creation` (`dossier_id`, `version`), `validation` (`dossier_id`, `version`)                                         |

### 9.7 Règles de service

1. **Ratios (route 10).** États retenus : pour chaque exercice, l'état **courant** (ni remplacé, ni rejeté) dont la
   décision est « accepté » (`statutEtat = accepte`, même logique que `dossier/etats.ts`) ; les trois exercices les
   plus récents. Un état en revue, rejeté ou remplacé n'entre jamais dans un calcul : il est listé dans
   `etats_non_utilises`. `accepte_sous_reserve` = décision sans acceptation automatique, ou contrôles en échec, ou
   tolérance non nulle (l'écran l'indique). `EtatPourRatios` se construit depuis `dossier_etats_lignes` (montants
   `bigint` lus en `number` par la même conversion que `detailEtat`) et `dossier_etats_financiers.totaux`.
   `analyses_indicatives` et `fiabilite` viennent de `calculerFiabilite` (`dossier/fiabilite.ts`).
2. **Score (route 17).** Dans la transaction, sous verrou : correspondance courante, ratios des trois derniers
   exercices acceptés, tendances (dernier et précédent), incidents du corps (absent = `null`), seuils : version
   `publiee` la plus haute du **secteur du dossier**, à défaut `SEUILS_ALERTE_DEFAUT` (`seuils_source =
   'defaut_moteur'`). Le score est calculé par le moteur, jamais par la route ; la ligne conserve entrées,
   instantané des seuils, version du moteur. Le premier score ou la première urgence fait passer le dossier de
   `ouvert` à `diagnostic`.
3. **Publication de seuils (route 15).** Sous le verrou du secteur : la version est un brouillon et la dernière du
   secteur ; le publieur détient `redressement.parametrer`, le rôle `expert_metier` ou `associe`, et n'est pas
   l'auteur sauf associé (`MPZ07`). Les scores existants ne changent jamais.
4. **Trésorerie (routes 19 et 20).** Une version est insérée avec ses lignes dans une seule transaction ; avant
   d'écrire, l'API appelle `projeterTresorerie` (validation et projection) avec les réalisés courants rapportés à la
   nouvelle fenêtre. Un réalisé : `semaine_debut` doit tomber dans la fenêtre de la version courante, sinon 400 ;
   si la semaine précédente est dans la fenêtre, elle doit avoir un réalisé courant (409
   `RED_SEMAINE_PRECEDENTE_MANQUANTE`) ; la nouvelle ligne remplace la courante de la semaine (`remplace_id`).
   `creancier_id` et `echeance_id` d'une ligne doivent appartenir au dossier (sinon 400, doublé par les clés
   composites). Le moteur somme et compare ; l'API ne fait aucune addition de montants.
5. **Négociation (route 28).** `accord` : verrou du dossier, créance courante lue, `verifierAccordContreCreance`,
   échéancier construit (`construireEcheancierAccord`) ou validé (`validerEcheancierAccord`) par le moteur, puis
   événement **et** échéances insérés dans la même transaction ; `paiement` : `exigerPaiementAdmissible` avec les
   paiements existants ; `rupture` : l'accord doit être en vigueur. La situation du créancier (`situationCreancier`)
   est **recalculée à chaque lecture** et jamais stockée ; la date de référence est le jour UTC courant. La route 21 construit les `EcheanceRestante` de `echeancesVersLignes` depuis `situationCreancier(…).accord.echeancesRestantes` des seuls accords en vigueur (ni soldés ni rompus) de créanciers actifs, avec la catégorie du créancier.
6. **Plan (routes 29 à 36).** L'avancement et l'écart avec la version validée sont calculés à la lecture par
   `evaluerPlanRedressement` et `comparerContenusPlan`. Un déplacement de kanban ne modifie pas le plan
   (`statut` et `rang` ne sont pas dans `ActionCanonique`). **Validation d'une version** : sous le verrou du
   dossier, la version est un brouillon, la dernière ; le contenu est **reconstruit** depuis les actions actuelles
   et son empreinte (SHA-256 de `serialiserContenuPlan`, calculée avec `node:crypto` dans l'API) doit être celle de
   la version, sinon 409 `RED_PLAN_MODIFIE` (« recréez une version ») ; `bloquantsValidation` vide, sinon 409
   `RED_PLAN_INCOMPLET` ; **séparation des tâches** : valideur ≠ créateur de la version sauf associé, contrôlé
   par l'API **et** par `MPZ07` ; le valideur détient `redressement.valider`. Effet : statut `valide` et, si le
   dossier est `ouvert` ou `diagnostic`, passage à `plan_valide` (en passant par `diagnostic` si besoin) dans la
   même transaction.
7. **Action et levier (route 30).** `responsable_id` : utilisateur interne actif du cabinet, qui voit la mission
   et détient `redressement.lire` (`exigerAssignable` de `collaboration/taches.ts` avec l'entité `mission`, plus
   un contrôle de permission) ; 400 sinon, comme pour un compte du portail. `levier` : la base est le **dernier état
   accepté** (postes agrégés par la correspondance courante) ; l'API refuse si sa devise ≠ celle du dossier
   (`RED_DEVISE_ETAT_DIFFERENTE`) ; `calculerImpactLevier` produit l'impact, **stocké avec les paramètres et la
   base** (un instantané : relire l'action ne recalcule pas). `creer_tache: true` appelle `creerTacheAssignee`
   (`entite_type = 'mission'`, titre = titre de l'action, échéance) et exige `tache.assigner` ; sinon, si le
   responsable n'est pas l'appelant, une notification interne `redressement_action_assignee` est créée
   (`notifier`, **sans montant**, lien `/missions/{id}/redressement/plan`) ; les courriels partent **après** la
   transaction (`envoyerEmails`). Aucune synchronisation des statuts avec la tâche (limite connue, §14).
8. **Statut du dossier (route 7).** `mise_en_oeuvre` : statut `plan_valide`. `clos` : `redressement.valider`, motif
   d'au moins 10 caractères ; un dossier clos ne reçoit plus d'écriture.
9. **Aucune IA, aucun job.** Pas d'import de `../ia/`, de `../agents/`, de `../jobs/` dans `redressement/` ni dans
   `routes/redressement*.ts` (test §9.9).

### 9.8 Données du client, FIN-02 et portail

- **Classification** (H8) : montants, soldes, dettes, marges **du client** : relèvent de `redressement.lire` et de
  la visibilité de la mission, **pas** de `finance.lire`. Le module **n'expose ni ne joint** : honoraires, budget,
  coûts, taux ou marge **du cabinet** (aucune jointure vers `missions` au-delà de l'identité, de la devise et du
  statut ; aucune vers `budgets`, `factures`, `collaborateur_couts`, `grilles`). Si un lot ultérieur y ajoute une
  donnée du cabinet (honoraires de succès, coût de la mission), elle exigera `finance.lire` et sera **absente**, non
  masquée, sans la permission (FIN-02, modèle `appels-offres/go-no-go.ts`).
- **Test (`redressement-fin02.test.ts`)** : un chef de mission **sans** `finance.lire` lit ratios, trésorerie et
  créanciers (200) ; la réponse sérialisée ne contient **aucune clé** parmi `cout`, `couts`, `taux`, `marge_mission`,
  `honoraires`, `budget`, `facturation`, `tarif`, `rentabilite` (parcours récursif) ; un gestionnaire (qui a
  `finance.lire`) reçoit **403** sur les 37 routes (il n'a aucune permission `redressement.*`).
- **Portail** : les quinze tables en `portail_interdit` ; aucune route dans `LISTE_BLANCHE_PORTAIL` ; un
  `client_dirigeant` reçoit 403 `PORTAIL_ROUTE_INTERDITE` sur chacune des 37 routes (test qui itère la liste).
  Aucune projection « portail » n'existe : le client ne voit jamais son propre dossier de redressement dans ce lot.

### 9.9 Tests API (agent 2)

Un fichier par thème, base `missionpilot_red`, rôle applicatif réel, **jamais deux suites API en parallèle** :

| Fichier                                | Contenu                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redressement-base.test.ts`            | §5.12                                                                                                                                                                                                                                                         |
| `redressement-dossiers.test.ts`        | routes 2 à 7 : 401, 403 par rôle (matrice de §8), nominal, mission invisible 404, autre cabinet 404, mission clôturée 409, doublon 409, devise copiée, pagination par curseur, transitions de statut                                                              |
| `redressement-ratios.test.ts`          | routes 8 à 10 : états semés par `POST /api/dossiers/:id/etats-financiers` ; **les valeurs du cas A de §6.3 rendues par l'API** ; état en revue ou remplacé non utilisé ; trois exercices au plus ; sans correspondance : postes manquants ; `analyses_indicatives` |
| `redressement-urgence-alerte.test.ts`  | routes 11 à 17 : urgence (U2, U3 par l'API), question inconnue 400, débit 429 ; seuils : brouillon, publication par l'auteur 403, par un `consultant` 403, par un autre expert 200, par l'associé auteur 200, version obsolète 409 ; score avec seuils par défaut puis publiés, instantané égal, `insuffisant` conservé, secteur changé sans effet sur l'ancien score |
| `redressement-tresorerie.test.ts`      | routes 18 à 22 : cas T1, T2, T3 de §6.6 **par l'API** ; contiguïté 409 ; 12e correction 409 ; fenêtre glissante (nouvelle version à `date_debut` + 7) ; import des échéances d'accords ; point mort T8                                                          |
| `redressement-creanciers.test.ts`      | routes 23 à 28 : doublon 409 ; versions de créance ; accord régulier (C1) et explicite invalide 400 ; deuxième accord 409 ; paiement, paiement excessif 409, rupture, paiement après rupture 409 ; situation C5 ; synthèse C10 ; **le journal ne contient aucun nom, montant ni condition** |
| `redressement-plan.test.ts`            | routes 29 à 37 : création d'action avec levier (L1 par l'API), tâche liée (403 sans `tache.assigner`), notification sans montant, responsable du portail ou invisible 400, déplacements et transitions, action terminée figée, version de plan : séparation des tâches (créateur 403, directeur autre 200, associé créateur 200, chef 403), `RED_PLAN_MODIFIE`, `RED_PLAN_INCOMPLET`, déplacement de kanban sans effet sur la validité, passage du dossier à `plan_valide` |
| `redressement-fin02.test.ts`           | §9.8                                                                                                                                                                                                                                                          |
| `redressement-portail.test.ts`         | §9.8 : 37 routes, 403 `PORTAIL_ROUTE_INTERDITE`                                                                                                                                                                                                               |
| `redressement-sans-ia.test.ts`         | lit les sources de `apps/api/src/redressement/` et de `apps/api/src/routes/redressement*.ts` : aucune importation de `ia/`, `agents/`, `jobs/`, `fournisseur` ; aucune occurrence de `SUM(`, `AVG(`, `Math.round`, `toFixed(`                                  |
| `redressement-parite.test.ts`          | parité **moteur ↔ shared** (postes, ratios, domaines, réponses, critères, catégories, volets, statuts, leviers) et **shared ↔ base** (listes des `CHECK` de `red_dossiers.secteur`, `categorie`, `volet`, `statut`… lues dans `pg_constraint`)                                |
| `redressement-erreurs.test.ts`          | `traduireErreurRedressement` : les 11 `MPZ…`, 23514, 23505, 23503, chaque code du moteur, aucune fuite de montant dans les messages                                                                                                                         |
| `redressement-outils.ts`               | assistants (modèle `kpi-outils.ts`) : cabinet, utilisateurs par rôle, mission, état financier accepté (cas A), dossier de redressement                                                                                                                         |

`isolation.test.ts`, `portail-acces.test.ts`, `portail-contexte.test.ts`, `jobs-registre.test.ts`,
`config.test.ts` restent **inchangés et verts**. Vérifications finales de l'agent : `pnpm db:migrate` (base
`missionpilot_red`), les fichiers ci-dessus **et** `isolation.test.ts`, `portail-acces.test.ts`,
`portail-contexte.test.ts`, `jobs-registre.test.ts`, `pnpm --filter @missionpilot/api typecheck`, `pnpm lint`,
`pnpm format`, recherches mécaniques n° 1, 2, 6, 8, 10, 13, 16 de `.claude/rules/review-checklist.md` (écarts
attendus : n° 10 → `714 8` ; n° 13 → seules des lignes `A` ; n° 16 inchangé à 23).

---

## 10. Interface web (agent 3)

Interface **100 % française**, modèles : `app/(app)/missions/[id]/kpi/**`, `components/kpi/**`, `lib/kpi-pilotage.ts`.
Le web appelle l'API **uniquement** par `/api/*` (relais Next) ; il importe `@missionpilot/shared` et **jamais**
`@missionpilot/engines`. Il **formate** des entiers déjà calculés (points de base → pourcentage par
`formaterPourcentage(valeur / 10000, 2)`, montants par `formaterMontantMineur`, jours par `formaterNombre`,
dates par `formaterDate` de `lib/format.ts`) et **ne recalcule rien** : ni ratio, ni solde, ni écart, ni imputation
d'un paiement, ni transition « autorisée » (la liste proposée est un confort ; l'API juge).

### 10.1 Routes Next et fichiers

| Route                                              | Fichier(s)                                                                                          | Permission de page          | Contenu                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `/redressement`                                    | `app/(app)/redressement/page.tsx`, `loading.tsx`                                                    | `redressement.lire`         | Portefeuille des dossiers                                |
| `/redressement/seuils`                             | `app/(app)/redressement/seuils/page.tsx`, `loading.tsx`                                             | `redressement.lire`         | Seuils d'alerte par secteur (édition : `parametrer`)     |
| `/missions/[id]/redressement`                      | `app/(app)/missions/[id]/redressement/layout.tsx`, `loading.tsx`, `page.tsx`                         | `redressement.lire`         | Synthèse du dossier, ouverture si absent                 |
| `…/redressement/ratios`                            | `ratios/page.tsx`                                                                                   | idem                        | Ratios, correspondance de postes                         |
| `…/redressement/urgence`                           | `urgence/page.tsx`                                                                                  | idem                        | Questionnaire d'urgence, historique                      |
| `…/redressement/alerte`                            | `alerte/page.tsx`                                                                                   | idem                        | Score d'alerte précoce, historique                       |
| `…/redressement/tresorerie`                        | `tresorerie/page.tsx`                                                                               | idem                        | 13 semaines, réalisé, point mort                         |
| `…/redressement/creanciers`                        | `creanciers/page.tsx`                                                                               | idem                        | Registre des créanciers                                  |
| `…/redressement/creanciers/[creancierId]`          | `creanciers/[creancierId]/page.tsx`                                                                 | idem                        | Créance, négociation, accords                            |
| `…/redressement/plan`                              | `plan/page.tsx`                                                                                     | idem                        | Kanban, versions du plan                                 |
| `…/redressement/leviers`                           | `leviers/page.tsx`                                                                                  | idem                        | Bibliothèque et simulateur                               |

- `components/redressement/` : `Voyant.tsx` (enveloppe de `BadgeStatut` : vert → `succes`, orange →
  `attention`, rouge → `danger`, non évalué → `neutre`, **toujours avec le texte**), `CarteSynthese.tsx`,
  `FormulaireOuvertureDossier.tsx`, `FormulaireDossier.tsx`, `TableauRatios.tsx`, `EditeurCorrespondance.tsx`,
  `QuestionnaireUrgence.tsx`, `HistoriqueUrgences.tsx`, `ScoreAlerte.tsx`, `FormulaireIncidents.tsx`,
  `EditeurSeuils.tsx`, `VersionsSeuils.tsx`, `GrilleTresorerie.tsx`, `FormulaireVersionTresorerie.tsx`,
  `SaisieRealise.tsx`, `GraphiqueSoldes.tsx`, `PointMort.tsx`, `ListeCreanciers.tsx`, `FormulaireCreancier.tsx`,
  `FilNegociation.tsx`, `FormulaireEvenement.tsx`, `EcheancierAccord.tsx`, `KanbanActions.tsx`,
  `FormulaireAction.tsx`, `VersionsPlan.tsx`, `BibliothequeLeviers.tsx`, `SimulateurLevier.tsx`,
  `redressement.css`, `useEffacementSucces.ts` (réutiliser celui de `components/kpi/` par import, ne pas le copier si
  l'import est propre).
- `lib/` : `redressement.ts` (+ `redressement.test.ts`), `redressement-graphiques.ts` (+ test),
  `redressement-serveur.ts` (chargements serveur, `next/headers`, non testé : modèle `kpi-pilotage-serveur.ts`).
- **Une page serveur ne passe jamais une fonction à un composant client** (CODING_STANDARDS §3) : propriétés
  sérialisables seulement (identifiants, objets de l'API, drapeaux). Les gestionnaires d'événements vivent dans les
  composants `"use client"`.
- **Listes** : `GET /api/redressement/dossiers` plafonne `limite` à 100 : tout appel de `chargerToutesLesPages` passe
  `{ limiteMax: 100 }` ; urgences et scores : `{ limiteMax: 50 }` (recherche mécanique n° 20 : aucun appel sans
  plafond déclaré sur ces routes).
- **Navigation** (`lib/navigation.ts`) : une entrée `redressement` (« Redressement », court « Redressement »,
  `href: "/redressement"`, permission `redressement.lire`, icône `attention`, description « Entreprises en difficulté :
  alerte précoce, trésorerie à 13 semaines, créanciers et plan de redressement. », sous-pages « Dossiers »
  `/redressement` et « Seuils d'alerte » `/redressement/seuils`), placée après `dossiers-clients`. **Onglet
  « Redressement »** dans `missions/[id]/layout.tsx` (`aPermission(roles, "redressement.lire")`), après « KPI ».
  `lib/navigation.test.ts` mis à jour (entrée présente, visible pour associé, directeur, chef, consultant, expert
  métier ; absente pour ressources, gestionnaire, expert externe).
- Responsive : largeur 360 px sans défilement horizontal de page ; tableaux dans un conteneur défilant (`Tableau`) ;
  la grille des 13 semaines devient **une liste de cartes par semaine** sous 640 px (CSS, `redressement.css`) ; le
  kanban passe en colonnes empilées sous 768 px.

### 10.2 Droits d'affichage (`lib/redressement.ts`, `droitsRedressement`)

`droitsRedressement(roles, utilisateurId, mission, dossier?) → { lire, ouvrir, ecrire, valider, parametrer, assignerTache }`
reflète §9.1 (confort ; l'API reste seule juge) : `ouvrir` = `redressement.ecrire` et (modifier toutes les missions ou
directeur ou chef) et mission non clôturée ; `ecrire` = `redressement.ecrire` et (mêmes conditions **ou** membre de
l'équipe) et mission non clôturée et dossier non clos ; `valider` = `redressement.valider` ; `parametrer` =
`redressement.parametrer` ; `assignerTache` = `tache.assigner`.

### 10.3 Écrans

**Portefeuille `/redressement`.** `EnteteDePage` « Redressement » ; filtres (statut, secteur, recherche) en
paramètres d'URL ; `Tableau` : dossier (lien vers la synthèse), client, secteur, statut (`BadgeStatut`), dernier
voyant d'urgence (`Voyant`), dernier niveau d'alerte (texte + badge, « Indicatif »), date d'ouverture. *Vide* :
« Aucun dossier de redressement. Ouvrez-en un depuis l'onglet « Redressement » d'une mission. » *Erreur* :
`EtatErreur` « La liste des dossiers n'a pas pu être chargée. » *Chargement* : `SqueletteListe`.

**Synthèse `/missions/[id]/redressement`.** Sans dossier (404 `RED_ABSENT`) : `EtatVide` « Aucun dossier de
redressement pour cette mission. » ; si `ouvrir` : formulaire (intitulé prérempli « Redressement — {client} »,
secteur) et bouton « Ouvrir le dossier de redressement » ; sinon « Le directeur ou le chef de mission ouvre le
dossier. » Avec dossier : en-tête (intitulé, statut, secteur, devise), bandeau « Analyses indicatives » si
`analyses_indicatives` (« Les comptes du client ne sont pas certifiés ou leur fiabilité est faible : les analyses sont
indicatives. » + lien vers `/dossiers/{client_id}/finances`), cartes : **Urgence** (cinq `Voyant` par domaine avec libellé,
date), **Alerte précoce** (score sur 100, niveau, « Indicatif », source des seuils), **Trésorerie** (« Première semaine
de tension : semaine {n} » ou « Aucune semaine de tension sur 13 semaines » ou « Aucune prévision »), **Créanciers**
(nombre, encours, échu), **Plan** (actions par statut, en retard, version validée ou non, « Le plan a changé depuis la
version validée »). Boutons : « Passer en mise en œuvre » (statut `plan_valide`, `ecrire`), « Clore le dossier »
(`valider`, motif obligatoire).

**Ratios.** Tableau ratios (lignes) × exercices (colonnes, du plus récent au plus ancien) : valeur formatée ou texte
de statut (« Sans objet », « Non calculable : postes à renseigner (Stocks, …) », « Non significatif : capitaux propres
négatifs ou nuls »), libellé et formule courte de chaque ratio ; tendances (« Croissance du chiffre d'affaires »,
« Évolution de la marge brute ») ; liste « États non utilisés » (en revue, rejeté, remplacé) avec leur statut ;
mention « Accepté sous réserve » ; bandeau d'indicativité. **Correspondance de postes** : une ligne par poste
(libellé, codes saisis séparés par des virgules, case « Sans objet »), bouton « Proposer la correspondance SYSCOHADA
indicative » (remplit le formulaire sans enregistrer, avec l'avertissement « Références indicatives, à confirmer par
un expert-comptable ; les postes sans référence sont à renseigner à la main »), liste des codes et libellés du dernier
état accepté (`GET /api/dossiers/:id/etats-financiers/:sousId`, `dossier.lire`) pour aider la saisie, bouton
« Enregistrer la correspondance » (`ecrire`), historique des versions. *Vide* : « Aucun état financier accepté pour ce
client. Importez un état dans le dossier client et faites-le accepter. » + lien.

**Urgence.** Texte d'introduction : « Questionnaire d'urgence : 15 questions, environ 15 minutes, à remplir avec le
dirigeant. Répondre « Oui » signale un point plus grave. » ; une fiche (`fieldset` et `legend`) par domaine, chaque
question avec quatre boutons radio (Non, Partiellement, Oui, Je ne sais pas) ; compteur « 12 questions sur 15
renseignées » (annoncé poliment) ; la durée passée sur la page est envoyée (`duree_secondes`) ; bouton « Évaluer »
(`ecrire`) ; résultat : un `Voyant` par domaine avec pourcentage ; « Domaine non évalué : trop peu de réponses » ;
bouton « Reprendre les réponses de la dernière évaluation ». Historique en tableau (date, voyant global, voyants par
domaine, auteur). *Vide* : « Aucune évaluation d'urgence pour ce dossier. »

**Alerte précoce.** Carte « Score d'alerte précoce » : score sur 100 ou « Données insuffisantes », niveau, date,
source des seuils (« Seuils du cabinet, secteur {secteur}, version {n} » ou « Seuils par défaut du moteur
(provisoires) »), mention fixe (§10.6) ; tableau des 12 critères (valeur formatée, `Voyant`, poids, motif :
« Signal critique », « Sans objet », « Non calculable », « Non renseigné ») ; formulaire « Incidents de paiement »
(rejets bancaires sur 12 mois, fournisseurs payés avec plus de 90 jours de retard, arriérés d'impôts ou de cotisations :
oui, non, inconnu) et bouton « Calculer le score » (`ecrire`) ; historique paginé (« Charger plus ») dont chaque ligne se
déplie sur les entrées et l'instantané des seuils.

**Seuils `/redressement/seuils`.** Sélecteur de secteur ; version en vigueur (tableau critère, sens de lecture,
seuil orange, seuil rouge, poids) ou « Aucune version publiée : les valeurs par défaut du moteur s'appliquent
(provisoires) » ; pour `parametrer` : éditeur (copie de la version en vigueur ou des valeurs par défaut, champs
numériques avec contrôle côté client de la somme des poids = 100), « Enregistrer un brouillon » ; liste des versions
avec « Publier » visible si `peut_publier`, sinon texte « La publication revient à un expert métier ou à un associé
autre que l'auteur de la version. ». Lecture seule sinon.

**Trésorerie.** Cartes de synthèse : « Solde minimum prévu : semaine {n} », « Première semaine de tension », « Besoin
de financement ». Bloc fenêtre (date de début, solde initial, seuil de tension). **Grille** : lignes par catégorie,
colonnes S1 à S13 (dates de début et de fin dans l'en-tête), cellules de prévision éditables dans le formulaire
« Nouvelle version de la prévision » (`ecrire`, bouton « Importer les échéances des accords » qui ajoute les lignes
proposées par la route 21 au brouillon, sans enregistrer) ; ligne « Réalisé » par semaine (formulaire de saisie par
catégorie, solde bancaire constaté facultatif, commentaire) ; ligne « Écart » et « Solde retenu » ; semaine de
tension marquée par l'icône d'attention **et** le texte « Tension ». **Graphique des soldes** (SVG, solde prévu et
solde retenu, droite du seuil de tension) avec **tableau équivalent** pour l'accessibilité. **Point mort** : trois
champs préremplis depuis les postes du dernier état accepté (chiffre d'affaires, coût des ventes comme charges
variables, charges fixes à saisir) et résultat (statut, seuil de rentabilité, marge de sécurité, point mort en jours).
Texte fixe : « Une semaine de tension est une semaine où le solde projeté passe sous le seuil que vous avez fixé. Ce
n'est pas une qualification juridique de la situation de l'entreprise. » *Vide* : « Aucune prévision de trésorerie.
Créez la première version : date de début (un lundi), solde bancaire initial, puis encaissements et décaissements
attendus semaine par semaine. »

**Créanciers.** Cartes (total dû, dont échu, part garantie, concentration des trois plus gros) ; `Tableau` (nom,
catégorie, garanti, encours restant, échu, accord et son statut « Respecté », « En retard », « Soldé », « Rompu »,
prochaine échéance) ; filtre actifs ; formulaire « Ajouter un créancier » ; bandeau de confidentialité « Les
conditions négociées sont confidentielles : elles ne sont pas reprises dans le journal d'audit. » *Vide* : « Aucun
créancier enregistré. » **Fiche** : créance courante et historique des versions, formulaire « Mettre à jour la
créance », **fil de négociation** chronologique (type, date, montant, conditions, auteur), formulaire d'événement selon
le type ; pour un **accord** : choix « échéancier régulier » (nombre, date de la première échéance, périodicité en mois)
ou « échéancier explicite » (lignes date et montant, 60 au plus) ; tableau de l'échéancier avec, pour chaque échéance,
« Soldée » (rang absent de `echeances_restantes`) ou le montant restant (valeur de `echeances_restantes`) ; paiement
rattaché à une échéance ; « Rompre l'accord » avec confirmation.

**Plan.** Résumé : avancement par volet (barre **et** texte « 33 % ») , actions en retard, impact total attendu
(trésorerie dégagée une fois, gain annuel), anomalies (avertissements en `Alerte` attention, bloquants en danger).
**Kanban** : colonnes « À faire », « En cours », « Bloquée », « Terminée » et section repliable « Abandonnées » ;
carte : titre, volet (badge), domaine, échéance (badge « En retard » si `en_retard`), responsable, impact du levier ;
actions de carte **sans glisser-déposer** (repoussé, accessibilité et téléphone) : liste « Déplacer vers… » (statuts
suggérés), boutons « Monter » et « Descendre » (rang), « Modifier », « Commenter » ; **motif** demandé pour
« Bloquée » et « Abandonnée », **date de fin** pour « Terminée ». Formulaire d'action : titre, description, volet,
domaine, échéance, responsable (directeur, chef et équipe de la mission), levier facultatif (liste du catalogue,
paramètres avec unité et bornes, bouton « Simuler »), case « Créer aussi une tâche dans Mes tâches » (si
`assignerTache`). **Versions du plan** : tableau (version, statut, date de référence, auteur, validation) ; boutons
« Créer une version à valider » (`ecrire`) et « Valider cette version » (`valider`, désactivé avec la raison si
`peut_valider` est faux : « La validation revient à un autre membre que l'auteur de la version, ou à un associé. ») ;
ligne « Écart avec la version validée : {a} ajoutée(s), {r} retirée(s), {m} modifiée(s) ». *Vide* : « Aucune action
pour l'instant. Ajoutez des quick wins (3 à 6 mois) puis, si besoin, des actions de restructuration (6 à 24 mois). »

**Leviers.** Cartes par famille (BFR, Coûts fixes, Prix, Cessions) : libellé, description, hypothèses ; simulateur
(levier, paramètres, « Simuler ») qui affiche « Trésorerie dégagée (une fois) », « Gain de résultat annuel », « Effet
de trésorerie la première année », « Plus ou moins-value » (cession), les hypothèses et la devise ; texte fixe :
« Ordre de grandeur calculé par le moteur à partir du dernier état accepté. Ce n'est pas une recommandation : les
effets ne se cumulent pas mécaniquement. » ; lien « Créer une action avec ce levier » vers le plan
(`?levier={code}`). *Erreur* `RED_BASE_INCOMPLETE` : « Il manque des postes dans la correspondance : {liste}. » avec
lien vers l'onglet « Ratios ».

### 10.4 États communs

Chaque page : *chargement* (`loading.tsx`, `SqueletteListe`), *erreur* (`EtatErreur` avec le **message précis de
l'API** et `hrefReessayer`, la navigation reste utilisable), *vide* (texte ci-dessus, avec la prochaine action),
*partiel* (`tronque` ou `suivant` : « Charger plus »), *interdit* (`exigerPermission` redirige vers
`/acces-refuse`), *lecture seule* (formulaires absents, jamais désactivés sans raison affichée), *succès* (message
annoncé en zone `aria-live="polite"`, effacé par `useEffacementSucces`). Un refus d'écriture (409, 403, 429) affiche le
message de l'API tel quel.

### 10.5 `lib/redressement.ts` et tests

Contenu (fonctions pures, testées dans `redressement.test.ts`) : constructeurs `cheminDossiers…`, `cheminDossier(id)`,
`cheminRatios(id)`, … (un par route de §9.3) et `hrefRedressement(missionId, section?)` ; `droitsRedressement` (§10.2) ;
`tonaliteVoyant`, `libelleVoyant` ; `formaterValeurRatio(cle, valeur)` (liquidités, solvabilité, couverture et
endettement : valeur / 10 000 sur deux décimales, « 1,36 » ; autonomie et marges : pourcentage à deux décimales,
« 18,75 % » ; BFR : « 54 jours ») ; `libelleStatutRatio`, `libelleRaisonRatio` (« Postes à renseigner : Stocks, … ») ;
`motifCritere` ; `formaterSemaine(debut, fin)` ; `TRANSITIONS_SUGGEREES` (miroir d'**affichage** de la matrice d'actions) ;
`corpsRealiseDepuisFormulaire`, `corpsVersionDepuisFormulaire`, `corpsCorrespondanceDepuisFormulaire` (formulaire → corps
d'API, **sans calcul métier** : conversion de texte en entier, regroupement par catégorie) avec leurs erreurs de saisie
en français ; `sommeDesPoids` **de contrôle de saisie** pour l'éditeur de seuils (somme = 100 avant envoi : confort,
l'API revalide) ; `parserCodes("BB, bi")` ; `avertissementTronque`. `redressement-graphiques.ts` : coordonnées SVG des
courbes à partir des soldes **fournis par l'API** (échelle linéaire, bornes, marge) et lignes du tableau équivalent.
Cas de test : chaque constructeur de chemin ; chaque énumération a un libellé ; `formaterValeurRatio` sur 13636, 1875,
−125, 54, `null` (« — ») ; `droitsRedressement` pour les huit rôles, mission clôturée, dossier clos, membre d'équipe,
directeur de la mission ; `corpsRealiseDepuisFormulaire` (montants avec espaces « 1 200 000 », vides ignorés,
décimale refusée) ; `parserCodes` (casse, doublons, vides, plus de 50) ; graphique : une série constante, une série
avec un minimum négatif, une série vide.

### 10.6 Textes fixes (à reprendre à l'identique)

- Mention du score : « Indicatif. Ce score est une aide à la décision du consultant ; il ne constitue ni une procédure
  d'alerte au sens du droit OHADA ni un avis juridique. »
- Seuils par défaut : « Seuils par défaut du moteur (provisoires) : à remplacer par ceux de vos experts. »
- Voyants : « Maîtrisé », « Vigilance », « Critique », « Non évalué » (texte toujours affiché avec l'icône).
- Trésorerie : texte de §10.3. Aucun écran n'emploie « cessation des paiements », « faillite », « défaillance » ni
  « état de crise » ; un test de `lib/redressement.test.ts` parcourt les libellés exportés et échoue sur ces mots.
- Créanciers : bandeau de confidentialité de §10.3.

---

## 11. Découpage en trois territoires et ordre des dépendances

### 11.1 Territoires (fichiers **disjoints**, aucun fichier attribué à deux agents)

| Agent | Territoire                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** moteurs, schémas, permissions | `packages/engines/src/redressement/**` (nouveau : §6.1) ; `packages/engines/src/index.ts` (**une ligne**) ; `packages/shared/src/schemas/redressement.ts` et `redressement.test.ts` ; `packages/shared/src/index.ts` (**une ligne**) ; `packages/shared/src/roles.ts` et `roles.test.ts`                                                                                                           |
| **2** migrations, API, tests API    | `apps/api/migrations/0480…0486_*.sql` ; `apps/api/src/redressement/**` ; `apps/api/src/routes/redressement*.ts` ; `apps/api/src/app.ts` (**une ligne**) ; `apps/api/test/redressement-*.test.ts` et `redressement-outils.ts`                                                                                                                                                          |
| **3** web, tests web                | `apps/web/src/app/(app)/redressement/**` ; `apps/web/src/app/(app)/missions/[id]/redressement/**` ; `apps/web/src/app/(app)/missions/[id]/layout.tsx` (**un onglet**) ; `apps/web/src/components/redressement/**` ; `apps/web/src/lib/redressement*.ts` (+ tests) ; `apps/web/src/lib/navigation.ts` et `navigation.test.ts`                                                              |
| **Pilote** (aucun agent) | Toute la documentation : `docs/**` (dont `CODING_STANDARDS.md`, `SECURITY.md`, `DECISIONS.md`, `HANDOFF.md`), `.claude/**` (checklist), `acc.config.json`, ADR. Les agents **ne** modifient **pas** `.claude/hooks/`, `.claude/settings.json` ni `acc.config.json`.                                                                                                              |

Tout prompt de réalisation reprend : **ne lancer aucune commande git qui modifie l'arbre ou l'index** (`stash`,
`checkout`, `switch`, `reset`, `restore`, `add`, `commit`, `clean`) ; **ne pas créer d'autre agent** ; si un fichier
attribué « semble avoir changé sans vous ou être revenu en arrière », **s'arrêter et le signaler** au lieu de le
refaire ; ne pas lire ni écrire de fichier `.env`.

### 11.2 Ordre des dépendances

```text
Pilote : relit la spécification, tranche §14.1 (lettre) et §14.2 (FIN-02), attribue les territoires
   │
   ├── Agent 1  jalon A (en premier, livré avant le reste) : roles.ts + schemas/redressement.ts (constantes, schémas, types §7.3)
   │            jalon B : moteurs §6.2 à §6.9, index, tests de couverture
   │
   ├── Agent 2  (démarre en parallèle) migrations 0480–0486 + tests de base  → n'importe aucun paquet
   │            puis redressement/ + routes : exige les jalons A et B  → tests API
   │
   └── Agent 3  (démarre en parallèle) lib/, composants, pages : exige le jalon A seulement (importe `shared`, jamais `engines`)
                les pages s'appuient sur les formes de réponse figées en §7.3 et §9.3 ; recette sur l'API de l'agent 2 en fin
Intégration (Pilote) : typecheck, lint, format, tests des 4 paquets → /audit (code-reviewer, security-auditor) → recette navigateur
```

**Contrats figés** (une divergence nécessaire est **signalée au Pilote**, jamais décidée seul) : noms et signatures
du moteur (§6), schémas et types de réponse (§7), permissions (§8), routes, formes et codes d'erreur (§9.3, §9.4),
plafonds (§9.5), libellés fixes (§10.6). Les valeurs de test de §6 sont reprises telles quelles.

### 11.3 Critères de fin et vérifications

| Agent | Commandes                                                                                                                                                                                                                                                                                                                   | Critères observables                                                                                                                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `pnpm --filter @missionpilot/engines typecheck` ; `pnpm --filter @missionpilot/engines test` (couverture ≥ 90 %, seuils de `vitest.config.ts`) ; `pnpm --filter @missionpilot/shared typecheck` et `test` ; `pnpm lint` ; `pnpm format`                                                                                  | toutes les valeurs de §6 passent ; 0 `z.object` non strict (recherche n° 12) ; aucun nom exporté en collision (`pnpm typecheck` des quatre paquets)                                                                                                  |
| 2     | `pnpm db:migrate` sur `missionpilot_red` ; `pnpm --filter @missionpilot/api exec vitest run test/redressement-*.test.ts test/isolation.test.ts test/portail-acces.test.ts test/portail-contexte.test.ts test/jobs-registre.test.ts` ; `pnpm --filter @missionpilot/api typecheck` ; `pnpm lint` ; `pnpm format` ; recherches n° 1, 2, 6, 8, 10, 13, 16 | 15 tables à RLS et `portail_interdit` ; 37 routes ; n° 10 → `714 8` ; n° 6 → 0 ; n° 13 → seulement des `A` ; n° 16 → 23                                                                                                                              |
| 3     | `pnpm --filter @missionpilot/web typecheck` ; `pnpm --filter @missionpilot/web test` ; `pnpm lint` ; `pnpm format` ; recherches n° 4, 5, 14, 19, 20                                                                                                                                                                       | aucun `dangerouslySetInnerHTML`, aucune variable `NEXT_PUBLIC_*`, aucun texte en anglais, aucune fonction passée à un composant client, tout `chargerToutesLesPages` avec `limiteMax` ; la recette navigateur reste au Pilote                       |

### 11.4 Documentation à mettre à jour par le Pilote (hors territoires)

- **`CODING_STANDARDS.md` §1** : plage `0480–0499` (RED), prochain libre `0487` ; correction des « six migrations non
  commitées » (H4) : 162 fichiers après ce lot ; module `redressement/` dans la liste des couches (§3) ; §2 : lettre
  `Z` (`MPZ01–MPZ11`), liste de `SECURITY.md` §6.
- **`SECURITY.md`** : §6 (tableau SQLSTATE : `MPZ01–11`), nouvelle section « 8 octies. Redressement (RED-01, 02, 05,
  06, 07, 10, 11, 12, 14) » (tables, droits, séparation des tâches, classification FIN-02, portail fermé), §5
  (séparation des tâches : plan et seuils), §2 (permissions de la vague 4), §4 bis (portail : aucune route), compteur
  de routes 714, §15 (risques de §12 et §14).
- **`DECISIONS.md`** : section « Redressement (RED-01, 02, 05–07, 10–12, 14) » reprenant §13 avec la mention
  « **provisoire — à valider** » pour chaque valeur.
- **`.claude/rules/review-checklist.md`** : recherche n° 10 (714), n° 12 (nombre de `z.object`), n° 13 (162
  migrations, tous commités à la fin du lot), un contrôle « Redressement » (tables, SoD, FIN-02 du client, aucune IA).
- **`HANDOFF.md`** : état, pièges (lettre `Z`, plage `0480–0499`, base `missionpilot_red`), reste à faire (§2.2).

---

## 12. Points sensibles pour l'audit de sécurité

1. **Isolation et portail** : 15 tables nouvelles. Vérifier `isolation` (`USING` et `WITH CHECK`), `portail_interdit`
   RESTRICTIVE, FK composites `(cabinet_id, dossier_id, id)` : un enfant ne vise jamais un parent d'un autre dossier ;
   inventaires dynamiques verts sans exception ; **aucune** route dans `LISTE_BLANCHE_PORTAIL`.
2. **Dossier d'autrui = 404** : chaque route résout l'identifiant (dossier, créancier, action, version) **puis** la
   visibilité de la mission, et répond le même 404 ; contrôler en particulier les routes à identifiant de **sous-objet**
   (`/creanciers/:id`, `/actions/:id`, `/plan/versions/:id`, `/seuils/:id`) : jamais de lecture avant la vérification.
3. **Séparation des tâches** : validation du plan (créateur ≠ valideur sauf associé, rôle associé ou directeur),
   publication de seuils (auteur ≠ publieur sauf associé, rôle expert ou associé) : API **et** `MPZ07`, avec le même test
   de refus ; l'associé n'est dispensé que par `red_valideur_dispense` (actif, rôle porté par la ligne `utilisateurs`).
4. **Intégrité de ce qui est validé** : l'empreinte du plan est recalculée **à la validation** depuis les actions
   actuelles (`RED_PLAN_MODIFIE`) ; `contenu` n'est jamais reçu d'un client ; un score ne référence que des seuils
   **publiés**, du **même secteur**, **identiques** à son instantané (`MPZ02`).
5. **Fuite de données du client dans les traces** : le journal d'audit ne porte jamais montant, nom de créancier,
   condition de négociation, titre d'action, commentaire ni motif ; les notifications et les tâches créées ne portent
   **aucun montant** ; les messages d'erreur (400 d'un schéma, 409) ne recopient pas les valeurs saisies ; les
   `details` d'une erreur se limitent à la liste blanche `CHAMPS_DETAILS_PUBLICS` (`manquants`).
6. **FIN-02** : aucune donnée du cabinet dans une réponse (§9.8) ; vérifier l'absence de jointure vers budgets,
   factures, taux, coûts ; un test récursif sur les clés ; le gestionnaire (`finance.lire`) n'a **aucun** accès.
7. **Pas de calcul hors moteur** : recherche n° 6 (0), n° 8 (aucune ligne de plus) ; `redressement-sans-ia.test.ts`
   interdit `SUM(`, `AVG(`, `Math.round`, `toFixed(` ; sommes en `BigInt`, `SOMME_HORS_LIMITES` traduit en 400 (jamais
   500) ; montants plafonnés par CHECK **et** schéma Zod.
8. **Aucune IA** : aucun import de `ia/`, `agents/`, aucune table `ia_*`, aucun appel réseau ; vérifié par test.
9. **Injection et entrées** : tous les schémas `.strict()` ; requêtes paramétrées ; aucune interpolation SQL hors
   constantes ; `jsonb` construits par le code ; clés de `reponses`, `postes`, `flux` restreintes par regex et
   énumération ; tailles `jsonb` bornées en base et à l'entrée ; `dateIsoBorneeSchema` partout (un 23514 de date
   ne doit jamais donner un 500).
10. **Déni de service** : plafonds de volume par déclencheur (`MPZ10`) **et** débits (urgences, scores, versions de
    trésorerie) comptés sur `journal_audit` sous verrou consultatif ; calculs O(1) ou O(600) bornés ; listes bornées ;
    pas de boucle non bornée (échéanciers ≤ 60, lignes ≤ 600, 3 états × ≤ 1 000 lignes).
11. **Concurrence** : verrou consultatif de dossier pris **avant** toute lecture dont dépend une règle ; numérotation
    (`max + 1`) et plafonds protégés par ce verrou et, en filet, par les unicités ; deux validations simultanées d'un
    plan ; deux accords simultanés ; deux réalisés de la même semaine (chaîne `remplace_id` unique).
12. **Mission clôturée et dossier clos** : `MPZ03` sur **toute** table fille ; une écriture ne contourne pas la
    clôture en visant directement un créancier ou une action.
13. **Comptes du portail** : jamais responsable d'action ni assigné d'une tâche (`refuser_utilisateur_portail`,
    `exigerAssignable`) ; le responsable doit voir la mission **et** détenir `redressement.lire`.
14. **Qualification juridique** : aucune sortie du moteur ni de l'interface n'emploie « cessation des paiements »,
    « faillite », « défaillance » ; test sur les libellés ; la mention « indicatif » du score est fixe.
15. **Réutilisation du dossier client** : lecture seule des états ; seuls les états **acceptés** et **courants**
    entrent ; `accepte_sous_reserve` et `analyses_indicatives` transmis ; aucune écriture dans `dossier_*`.
16. **Hors-périmètre rappelé** : aucun fichier reçu (aucun `multipart`), aucune dépendance nouvelle, aucune variable
    d'environnement, aucun secret, aucune fonction `SECURITY DEFINER` (donc `GRANT EXECUTE` inchangé à 23).
17. **Limite connue à documenter au §15 de SECURITY.md** : du SQL arbitraire du rôle applicatif peut insérer un score
    dont l'`entrees` ne correspond pas au calcul (comme la garde de provenance des évaluations, §15) : le déclencheur
    ne vérifie que les seuils, pas le résultat (pas de calcul en base). Idem pour un impact de levier stocké.

---

## 13. Valeurs par défaut « provisoires » (à porter dans `DECISIONS.md`)

**Règle** : aucune de ces valeurs n'a été fixée par le commanditaire ni par un expert ; **toutes** sont des constantes
nommées, exportées, citées avec leur justification, et marquées « **provisoire — à valider** ». Quand aucune source
n'existe, la justification dit « convention, sans source » : **rien n'est présenté comme un fait**. À notre
connaissance, aucun barème de l'ONUDI ni des textes de l'OHADA ne fixe de seuil chiffré pour ces ratios : le PRD s'inspire
de l'ONUDI pour la **démarche** (pré-diagnostic, diagnostic, plan, suivi), pas pour des nombres.

### 13.1 `SEUILS_ALERTE_DEFAUT` (secteur « général » ; les autres secteurs retombent dessus tant qu'un expert n'a pas publié)

Unités : points de base pour les ratios et tendances, jours pour le BFR, nombre d'incidents. Inégalités strictes
(§6.5).

| Critère                          | Sens        | Orange  | Rouge   | Poids | Justification et source                                                                                                                                                                                                                                  |
| -------------------------------- | ----------- | ------- | ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `liquidite_generale`             | bas pire    | 12 000  | 10 000  | 15    | Rouge `< 1,0` : définition (l'actif circulant ne couvre pas les dettes à court terme : fonds de roulement négatif). Orange `< 1,2` : marge de sécurité conventionnelle, sans source.                                                                      |
| `liquidite_immediate`            | bas pire    | 2 000   | 1 000   | 10    | Convention d'analyse financière (couverture des dettes à court terme par les seules disponibilités), sans source ni norme chiffrée connue.                                                                                                                |
| `autonomie_financiere`           | bas pire    | 2 500   | 1 000   | 10    | Convention : capitaux propres / total du passif ; le tiers est souvent cité en analyse bancaire (non vérifié, sans source). Distinct de la règle OHADA sur les capitaux propres et le capital (AUSCGIE, art. 664, **à vérifier par un juriste**), qui n'est **pas** reprise ici (poste `capital` réservé à un critère ultérieur). |
| `endettement`                    | haut pire   | 10 000  | 20 000  | 10    | Orange : reprend `SEUILS_BANCABILITE_DEFAUT.endettementMaxPb` (10 000), lui-même « indicatif, à calibrer avec les banques » (`plan-strategique/bancabilite.ts`). Rouge : le double, convention.                                                           |
| `couverture_charges_financieres` | bas pire    | 30 000  | 15 000  | 10    | Convention de couverture des intérêts (3 et 1,5 fois), sans norme officielle connue.                                                                                                                                                                     |
| `marge_nette`                    | bas pire    | 200     | 0       | 10    | Rouge `< 0` : une perte (définition). Orange `< 2 %` : convention, sans source.                                                                                                                                                                          |
| `bfr_jours`                      | haut pire   | 60      | 90      | 5     | Rouge : reprend `SEUILS_BANCABILITE_DEFAUT.bfrJoursMax` (90 jours). Orange : convention. **Le BFR dépend fortement du secteur** : c'est la raison d'être des seuils sectoriels fixés par les experts.                                                    |
| `croissance_ca`                  | bas pire    | 0       | −1 000  | 10    | Orange : le chiffre d'affaires recule ; rouge `< −10 %` : reprend le seuil de la question A1 de l'urgence (cohérence interne), convention.                                                                                                                |
| `variation_marge_brute`          | bas pire    | 0       | −500    | 5     | Convention (perte de 5 points de marge brute), sans source.                                                                                                                                                                                              |
| `rejets_bancaires_12m`           | haut pire   | 0       | 2       | 5     | Un rejet est un signal ; au-delà de deux : convention.                                                                                                                                                                                                   |
| `retards_fournisseurs_90j`       | haut pire   | 0       | 4       | 5     | Un fournisseur payé avec plus de 90 jours de retard est un signal ; au-delà de quatre : convention.                                                                                                                                                      |
| `arrieres_fiscaux_sociaux`       | haut pire   | 0       | 0       | 5     | Tout arriéré d'impôts ou de cotisations est rouge : convention, cohérente avec la question T1.                                                                                                                                                            |

Niveaux : `modere` à 25, `eleve` à 50, `critique` à 75 (convention). `partMinimaleEvalueePct` : 50 (même principe que
NOT-03 : un score exige la moitié du poids évalué, DECISIONS.md). Somme des poids : 100 (convention).

### 13.2 Autres valeurs

| Valeur                                                                  | Valeur posée                                                                                                   | Justification                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Grille d'urgence : questions, poids, seuils                             | 15 questions de §6.4.1 ; critique = poids 2 ; orange ≥ 25 %, rouge ≥ 50 % ; domaine évalué si ≥ 50 % du poids répondu | Formulations inspirées de signaux d'alerte classiques (retards de paiement, rejets bancaires, arriérés fiscaux et sociaux, baisse d'activité) ; **aucune source** : à valider par les experts. Seuils 25 % et 50 % : conventions. |
| Horizon de trésorerie                                                   | 13 semaines (fenêtre glissante par nouvelle version)                                                           | Fixé par le PRD (RED-11), pratique courante de la trésorerie de crise ; **non provisoire**.                                         |
| Seuil de tension par défaut                                             | 0 (solde projeté négatif), réglable par version                                                                 | Convention ; chaque dossier fixe son seuil.                                                                                          |
| Base de jours (BFR, point mort)                                         | 360                                                                                                            | Aligné sur le modèle financier (`JOURS_PAR_AN_BFR`) et `bancabilite.ts` ; cohérence interne, pas une norme.                          |
| Fenêtres du plan                                                        | quick wins ≤ 6 mois ; restructuration > 6 mois et ≤ 24 mois                                                    | PRD (RED-05 : 3–6 mois, 6–24 mois) ; la borne basse de 3 mois n'est **pas** contrôlée (avertissement seulement au-delà de 6 mois). |
| Secteurs                                                                | `general`, `industrie`, `commerce`, `services`, `btp`, `agriculture`                                           | Liste fermée de départ (PRD RED-03 cite industrie, services, commerce) ; à ajuster par les experts.                                   |
| Postes de ratio et correspondance indicative                            | 14 postes ; dix correspondances SYSCOHADA indicatives                                                          | Codes repris de `REFERENCES_SYSCOHADA` (« à confirmer par un expert-comptable ») ; quatre postes sans référence.                     |
| Catégories de flux et de créanciers                                     | 4 + 7 flux ; 6 créanciers                                                                                       | Convention de présentation de la trésorerie ; à ajuster.                                                                             |
| Bornes des leviers                                                      | jours 1 à 180 ; réduction 1 à 10 000 pb ; hausse de prix ≤ 5 000 pb ; perte de volume ≤ 9 999 pb ; mise en œuvre 0 à 12 mois | Garde-fous de saisie, pas des valeurs recommandées.                                                                                  |
| Six leviers et leurs formules                                           | §6.9                                                                                                            | Formules arithmétiques usuelles (BFR, prix, charges fixes, cession) ; hypothèses affichées ; à valider par les experts.               |
| Plafonds de volume                                                      | §9.5 (100, 200, 500, 50, 200, 600, 1 000, 11 par semaine, 200, 100, 300, 60, 300, 200, 100)                    | Garde-fous contre le déni de service ; **aucune source** ; à calibrer avec un cabinet pilote.                                        |
| Débits                                                                  | 30 urgences, 30 scores, 60 versions de trésorerie par utilisateur et par 10 minutes                              | Même ordre de grandeur que les autres lots (`copilote`, `kpi`) ; à calibrer.                                                          |
| `MONTANT_RED_MAX`                                                       | 10^13 unités mineures                                                                                           | Garde l'exactitude des sommes (§5.1) ; pas une borne métier.                                                                         |
| Conservation des données                                                | **aucune durée posée**                                                                                         | Données du client en ajout seul ; à valider avec le conseil juridique, comme les autres lots (DECISIONS.md).                         |
| Seuil de publication et rôles                                           | publication par un expert métier ou un associé, auteur exclu sauf associé ; validation du plan par associé ou directeur | Transposition de MPN04 / MPW05 / MPM08 et du R3 du PRD complémentaire §10 ; à confirmer.                                              |

---

## 14. Points ouverts et risques

| N°   | Sujet                                                                                                                                                                                                                                                                                                    | Proposition / décision attendue                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14.1 | **Lettre SQLSTATE.** Seules `H` et `Z` sont libres ; l'ADR-012 prend `H`, les ADR-010 et ADR-013 citent `MPH11` et `MPH07` : collisions **entre eux**. Ce lot prend `Z`.                                                                                                                                    | **Pilote** : arbitrer l'attribution de `H`, et décider la règle des lots suivants (plages de numéros disjointes dans une lettre, ou codes à deux lettres). Substitution `Z`→`H` possible globalement. |
| 14.2 | **FIN-02** : les montants et marges **du client** ne sont pas FIN-02 (H8). Si le commanditaire veut les réserver à `finance.lire`, le module deviendrait inutilisable pour le chef de mission et le consultant.                                                                                            | Confirmer ; sinon créer une permission `redressement.montants` (lot ultérieur) plutôt que d'exiger `finance.lire`.                                                |
| 14.3 | **R3 et qualité** : le PRD classe le plan de redressement R3 (relecture d'un second expert, signature du directeur). Le socle ne produit aucun livrable : il n'y a **pas** de suivi qualité (QUA). La validation d'une version de plan est un quatre-yeux interne.                                          | Brancher `qualite/branchements.ts` quand un rapport ou un export existera (RED-08) ; d'ici là, aucun export ni PDF du plan.                                       |
| 14.4 | **Correspondance de postes** : faite à la main, sans second regard ; une erreur fausse les ratios et le score. Mitigations : version tracée, avertissement « indicative », postes manquants jamais comptés comme zéro.                                                                                      | Option ultérieure : validation de la correspondance par un second membre ; extraction assistée (DOS-03 IA) hors socle.                                          |
| 14.5 | **Seuils par défaut sans source** (§13.1) : tant qu'aucun expert ne publie, le score est indicatif ; l'écran le dit.                                                                                                                                                                                         | Ateliers de calibration avec des cabinets pilotes ; publication de versions sectorielles.                                                                        |
| 14.6 | **Kanban sans glisser-déposer** et **sans synchronisation** avec `taches_collaboration` (statuts distincts) ; **trésorerie** sans vue mensuelle, sans covenants, sans plan de financement, sans assistant de fenêtre glissante (décalage d'une semaine).                                                   | Sous-chantier suivant ; la synchronisation demanderait un type d'entité ou un événement d'automatisation (ADR-006).                                              |
| 14.7 | **Documentation périmée** : CODING_STANDARDS, la checklist et SECURITY.md citent six migrations non commitées (H4).                                                                                                                                                                                          | Le Pilote rafraîchit (§11.4).                                                                                                                                    |
| 14.8 | **Base de test** `missionpilot_red` : à coordonner avec les autres agents de la vague 4 (RUNBOOK) pour ne pas partager une base.                                                                                                                                                                             | Le Pilote attribue un identifiant de base par agent.                                                                                                             |
| 14.9 | **Jeu de démonstration** absent : la recette navigateur doit semer par l'API (`redressement-outils.ts` sert de modèle).                                                                                                                                                                                      | Seed de démonstration au sous-chantier 3b.                                                                                                                       |
| 14.10 | **Vocabulaire** : le mot « alerte » est aussi celui d'une procédure légale (commissaire aux comptes, associés) ; le score est « d'alerte précoce », « indicatif ».                                                                                                                                          | Textes fixes de §10.6 ; relecture par un juriste avant toute diffusion hors du cabinet.                                                                          |
| 14.11 | **Performance** : la lecture de la synthèse recalcule la projection (13 semaines) et la situation de chaque créancier (≤ 200) ; négligeable, mais à mesurer au volume plafond.                                                                                                                              | Un test de volume (200 créanciers, 600 lignes) dans `redressement-tresorerie.test.ts` / `redressement-creanciers.test.ts`, seuil large.                           |
| 14.12 | **Dossier clos** : une mission clôturée rend son dossier en lecture seule (`MPZ03`) ; un dossier `clos` est terminal : il n'existe pas de « réouverture » du dossier.                                                                                                      | Confirmer ; une réouverture motivée par un associé pourrait être ajoutée.                                                                                        |
