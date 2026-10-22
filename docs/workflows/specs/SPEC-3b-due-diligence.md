# SPEC 3b — Service #2 « Due diligence » (DD-01 à DD-15)

**Statut** : spécification à valider, non codée (état de livraison au 2026-10-22 : voir l'encadré ci-dessous).
**Branche** : `feat/vague-4-redressement`
(sous-chantier 3b de la vague 4). **Date** : 2026-10-11. **Décision d'architecture** :
[ADR-012](../../architecture/adr/ADR-012-service-due-diligence.md) (à lire d'abord, une page).
**Sources** : PRD « Service 2 » (DD-01 à DD-08), PRD complémentaire §11.2 (DD-09 à DD-15), §6
(preuves), §18 (vagues). Tout ce qui est dit de l'existant a été relevé sur le code le 2026-10-11
(fichier cité entre parenthèses) ; tout ce qui est posé par cette spécification sans décision du
commanditaire est marqué **provisoire** et repris au §14 pour DECISIONS.md.

> **État au 2026-10-22 (lot 6, [ADR-009](../../architecture/adr/ADR-009-ingestion-documents.md) Acceptée).**
> **DD-02 (import de rapports PDF) et DD-10 (lecture IA de la salle de données) sont livrés** par le lot 6, en
> **mode texte natif** ; l'OCR local est à venir (lot 11, en cours) : un PDF scanné répond `PDF_SANS_TEXTE` d'ici là.
> Le volet « connecteurs de données ouvertes » de DD-02 n'est PAS livré : il reste l'adaptateur simulé du §8.12, sans
> route ni réseau. Détail au §1 (lignes DD-02 et DD-10), au §8.13 et au §16 ; le texte de fond de la spécification
> (périmètre, critères) est conservé tel quel. Elle date du 2026-10-11, avant l'ADR-009 : les mentions
> « ADR-009 absent » ci-dessous sont le besoin d'origine.

Règles non négociables du lot (AGENTS.md) : chiffres uniquement par `packages/engines`
(couverture ≥ 90 %), **aucune IA** dans ce lot, RLS par cabinet (`isolation` + `portail_interdit`),
clés étrangères composites `(cabinet_id, id)`, historiques en ajout seul avec SQLSTATE `MPZ…`,
FIN-02, permissions dans `packages/shared/src/roles.ts`, schémas Zod `.strict()`, validation d'un
verdict ou d'une note par une autre personne que l'auteur (sauf associé), doublée en base.

---

## 1. Périmètre : ce qui est livré, rattaché, repoussé

| ID | Décision | Contenu ou raison |
| --- | --- | --- |
| DD-01 | **Livré** | Cadrage versionné : secteur (et filière), pays, cible éventuelle, type d'opération, devise, date d'opération prévue, question d'investissement, périmètre (§4.2, R02–R06). |
| DD-02 | **Import de rapports PDF livré le 2026-10-22 (lot 6, texte natif) ; connecteurs de données ouvertes : repoussé, OUVERT** | **Livré (ADR-009 Acceptée, §8.13)** : `POST /api/dd/dossiers/:id/documents?type=rapport` (usage `dd_rapport`), lecture IA (résumé et éléments, chacun avec sa page et un extrait vérifié dans la page), brouillon validé par `dd.valider` (autre que le dernier modificateur, le demandeur de la lecture et l'auteur du téléversement, sauf associé : `MQG02`), acquittement des éléments non retrouvés ; la validation ne pousse rien ailleurs ; onglet « Documents » du dossier. Mode **texte natif** seulement (OCR local à venir, lot 11). **Texte d'origine, connecteurs de données ouvertes (Banque mondiale, FMI, ONUDI), toujours non livrés** : exigent un choix de fournisseur et une clé ; aucun appel réseau dans ce lot. Livré seulement : l'interface `FournisseurDonneesOuvertes` et un adaptateur **simulé** (`apps/api/src/due-diligence/donnees-ouvertes.ts`), jamais branché à une route ni à une configuration, testé unitairement, dont les valeurs sont fictives et marquées `simule: true` (§8.12). À marquer **OUVERT** dans DECISIONS.md. |
| DD-03 | **Livré, sans IA** | PESTEL, cinq forces, SWOT : saisie par l'expert ; chaque affirmation est une **assertion du registre des preuves** (§2.1), donc sourcée ou signalée « fragile » (R07–R09). Le pré-remplissage IA est le lot suivant. |
| DD-04 | **Livré** | Chaîne de valeur : étapes ordonnées, acteurs, part de coût et de marge (points de base), contraintes ; un clic sur une étape affiche ses risques ; synthèse par le moteur (R10–R12 ; écran §10). |
| DD-05 | **Rattaché** (trivial) | Quatrième analyse « opérationnelle » (processus, approvisionnement, goulots), mêmes points sourcés que DD-03 ; aucun calcul propre. |
| DD-06 | **Livré** | Checklist de risques par famille (pays, change, opérationnel, réglementaire) avec niveau et justification **sourcée** (R13–R15). |
| DD-07 | **Véhicule livré le 2026-10-20 (lot 3), aucun contenu sectoriel** | Modèles d'analyse par secteur (migration `0511`) : vides par défaut, rédigés par le cabinet ; le contenu reste à rédiger par des experts ; aucun contenu du cahier SANKORIA n'est repris (DECISIONS.md, 2026-10-06). Le véhicule existe : la bibliothèque de signaux (DD-11) filtrée par secteur. |
| DD-08 | **Livré** | Ajustements des experts tracés (table `dd_ajustements`, créés par l'API à chaque écart à une proposition du moteur ou de la bibliothèque) et repris dans la note ; deux variantes de la note (R42, R46–R53). |
| DD-09 | **Livré** | Arbre d'hypothèses (profondeur 4) → assertions liées (soutient/contredit) → preuves ; verdict confirmée / infirmée / non concluante, indiqué par un moteur, décidé par un humain, validé par un tiers (R16–R23). |
| DD-10 | **Livré le 2026-10-22 (lot 6, texte natif)** | Lecture IA d'un document de la salle de données : `POST /api/dd/dossiers/:id/documents?type=salle` (usage `dd_salle`), mêmes garanties que DD-02 (page et extrait vérifié, brouillon, validation par un tiers, acquittement des éléments non retrouvés, rien de poussé ailleurs ; §8.13). Un document à la fois. Mode **texte natif** seulement ; OCR local à venir (lot 11). Besoin d'origine : dépendait de l'ingestion/OCR (ADR-009, alors absent) et d'une clé OpenRouter. |
| DD-11 | **Livré** | Bibliothèque de signaux d'alerte par secteur et pays, maintenue par les experts (versions en ajout seul) ; signaux applicables à un dossier calculés par le moteur ; constats (R24–R29). Aucun contenu d'amorçage : la bibliothèque démarre vide. |
| DD-12 | **Livré** | Moteur de dimensionnement descendant et ascendant, fourchette, sensibilité, recoupement, ajustements d'expert ; paramètres sourcés (R30–R34). |
| DD-13 | **Livré** | Note au comité : versions, soumission (base figée par les moteurs), validation par un tiers, rendu PDF/Word en variante exécutive ou détaillée par `rapports/` (R46–R53, §9). |
| DD-14 | **Livré** | Filtrage environnemental et social : liste d'exclusion paramétrable (par investisseur ou générale) et huit thèmes de revue, cadres publics cités en **référence seulement** (R35–R41). |
| DD-15 | **Livré** | Plan des 100 jours relié aux services #3 (initiative d'un plan) et #4 (KPI) par clés composites (R43–R45). |
| Portail investisseur | **Livré le 2026-10-20 (lot 3)** | Voir §16 : option du cabinet (désactivée par défaut), invitation d'un compte portail `client_investisseur` sur un dossier, publication d'un instantané de la version VALIDÉE de la note et de pièces choisies (rapports de la note), consultation en lecture seule (migration `0509`). Les routes du socle initial du lot restent fermées au portail ; seules trois routes dédiées sont dans `LISTE_BLANCHE_PORTAIL`. |

---

## 2. Principes et réutilisations

### 2.1 « Chaque verdict est sourcé » : le registre des preuves est réutilisé tel quel

- Une **affirmation** (point d'analyse, justification d'un risque) = une ligne de `assertions` +
  `assertion_versions` (`0241`) créée par le service existant `creerAssertion`
  (`apps/api/src/preuves/ecriture.ts`), classe de risque `R2` par défaut (**provisoire**, `R3`
  possible), statut `retenue`, `livrable = 'Note au comité — due diligence'` (texte **sans** les
  mots « notation » ni « plan », pour que les annexes de sources des rapports de notation et de
  plan, `rapports/sources.ts` `assertionCitee`, ne citent jamais une assertion de due diligence).
- Les **sources** sont des preuves (`preuves`, `preuve_versions`, `0240`) reliées par les routes
  existantes (`POST /assertions/:id/liens`, `preuve.ecrire`) ; le verbatim nominatif reste masqué
  selon `vuePreuve` (`preuves/vues.ts`). Le module `dd` n'ajoute **aucune** table de preuves.
- La **solidité** d'une assertion est celle de `indiceSolidite` (`packages/engines/src/preuves`,
  seuils 0,75 / 0,5, à calibrer au pilote) ; le module DD appelle `evaluerAssertions` /
  `vueSolidite` (`apps/api/src/preuves/evaluation.ts`) et n'en recalcule rien. Le contrôle PRV-03
  (`detecterAssertionsSansPreuve`) sert au contrôle de la note.
- Rattachements (valeurs existantes de `assertion_versions.rattachement_type`) :
  `dimension` pour un point d'analyse (code `dd.<analyse>.<categorie>`), `risque` pour un risque
  (code = identifiant de l'élément), `hypothese` pour une assertion créée depuis une hypothèse
  (code = identifiant de l'élément, ≤ 120 caractères). Les dimensions `dd.*` sont créées dans
  `preuve_dimensions` par l'API (`INSERT … ON CONFLICT (cabinet_id, mission_id, code) DO UPDATE SET
  actif = true`, module `due-diligence/dimensions-registre.ts`) : 18 pour les analyses + 4
  (`dd.risque.pays`, `.change`, `.operationnel`, `.reglementaire`), soit 22 sur un plafond de 100
  (`DIMENSIONS_MISSION_MAX`) ; la carte de triangulation (PRV-05) les couvre gratuitement.
- **Dossier client (lot DOS)** : réutilisé seulement par les preuves. Un fichier qui est la source
  d'un fait du dossier client peut déjà être lié à une version de preuve (`0243`,
  `dossier_faits.source_document_id`) ; DD n'ajoute aucun lien vers `dossier_faits`. Le « dossier »
  de ce lot (`dd_dossiers`) est celui d'une **opération d'investissement étudiée**, pas le dossier
  client (c'est l'investisseur qui est le client de la mission).
- **Rapports** : réutilisés (§9). **Qualité** : un rapport de note ouvre son suivi qualité par
  `brancherRapport` (type `rapport`, classe minimale R2, `rapports/enregistrement.ts`) ; les
  chiffres du rapport sont placés dans des blocs `indicateurs` (source « moteur » du suivi,
  `qualite/branchements.ts` `chiffresDuRapport`).

### 2.2 Ajout seul, par versions

Aucune table du lot ne se modifie : une correction est une **nouvelle version** (motif obligatoire
dès la version 2), un lien retiré est un **événement**, un retrait d'élément est une version
`retire = true`. L'état courant se dérive (version la plus grande, dernier événement) comme dans
`preuves/donnees.ts`. Chaque route d'écriture : mission verrouillée et non clôturée
(`exigerMissionEcrivable`, `preuves/acces.ts`, 409 `MISSION_CLOTUREE`), journalisation dans la
même transaction (`journaliser`, sans énoncé ni verbatim dans `details`).

### 2.3 Aucune IA, aucune configuration, aucun job

Aucun appel à `ia/orchestrateur.ts`, aucune variable d'environnement, aucun job, aucune fonction
`SECURITY DEFINER` (§13, recherches). Le lot IA suivant ajoutera un statut `brouillon_ia` par
migration.

---

## 3. Conventions réservées par ce lot

### 3.1 Migrations : plage `0500`–`0519` (réservée, ne chevauche rien)

Dernier numéro employé au 2026-10-11 : `0465` (`ls apps/api/migrations`). `0466`–`0479` reste à la
capitalisation, `0340`–`0359` n'est pas affecté. Ce lot **réserve `0500`–`0519`**. Plages des autres sous-chantiers de la vague 4, relevées dans
leurs spécifications le 2026-10-11 : 3a (redressement) `0480`–`0499` (SPEC-3a, H3) ; 3c (canaux simulés)
`0540`–`0559` (SPEC-3c) ; `0520`–`0539` reste libre. Aucun chevauchement.
Un durcissement d'audit du lot prend le numéro libre suivant (`0510` puis `0512`… : `0509` et `0511` sont consommées, voir le tableau). Une migration qui
cite une table d'un autre fichier a un numéro plus grand (`migrate.ts` applique par ordre de nom).

| Fichier | Contenu |
| --- | --- |
| `0500_dd_dossiers_cadrage.sql` | `refuser_modification_dd`, `est_associe_dd`, `dd_dossiers`, `dd_cadrage_versions` |
| `0501_dd_signaux.sql` | `dd_signaux`, `dd_signal_versions` |
| `0502_dd_elements.sql` | `dd_elements`, `dd_element_versions`, `dd_signal_constats` |
| `0503_dd_hypotheses.sql` | `dd_hypothese_liens`, `dd_verdicts`, `dd_verdict_validations` |
| `0504_dd_dimensionnements.sql` | `dd_dimensionnements`, `dd_dimensionnement_versions` |
| `0505_dd_filtrage_es.sql` | `dd_exclusion_listes`, `dd_exclusion_liste_versions`, `dd_filtrages`, `dd_filtrage_decisions` |
| `0506_dd_ajustements.sql` | `dd_ajustements` |
| `0507_dd_notes.sql` | `dd_notes`, `dd_note_versions`, `dd_note_validations` |
| `0508_dd_rapport_note_comite.sql` | extension de `rapports_mission` (§9.1, `MPR04`) |
| `0509_dd_portail_investisseur.sql` | portail investisseur : 5 tables `dd_portail_*`, `MQD01`–`MQD08` (livrée le 2026-10-20) |
| `0510` | libre |
| `0511_dd_modeles_secteur.sql` | modèles d'analyse par secteur (DD-07), 2 tables, `MQD11` (livrée le 2026-10-20) |
| `0512`–`0519` | libres (durcissements d'audit) |

### 3.2 SQLSTATE : lettre `Z` partagée, numéros `MPZ21`–`MPZ32`, plus `MPR04`

Relevé du code (`grep` des `MP[A-Z]nn` dans migrations, API, paquets, SECURITY.md, 2026-10-11) :
lettres employées `A B C D E F G I J K L M N O P Q R S T U V W X Y` ; **`H` et `Z` sont les deux
seules libres dans le code**, et les deux autres sous-chantiers de la vague 4 les ont déjà
revendiquées en parallèle : le lot canaux (SPEC-3c, ADR-008, ADR-010, ADR-013) prend `H`
(`MPH01`–`MPH12`), le redressement (SPEC-3a, ADR-011) prend `Z` (`MPZ01`–`MPZ11`). **Il n'y a donc
plus de lettre libre pour la due diligence.** Décision de cette spécification, la moins
intrusive et sans collision de code : **DD partage la lettre `Z` avec 3a sur des numéros
disjoints, `MPZ21` à `MPZ32`** (3a garde `MPZ01`–`MPZ20`, dont elle n'emploie que `01`–`11`). Un
code reste associé à UNE règle (CODING_STANDARDS §2 : pas de code à plusieurs sens) ; seule la
règle « une lettre par domaine » est assouplie, comme l'est déjà « un domaine, plusieurs plages de
numéros » (`MPK10-16`, `MPK20-27`). **À confirmer par le Pilote avant toute migration** (§16, point 1) ; la
solution de repli est une seconde famille de préfixe (`MQD01`–`MQD12`) : le remplacement est
mécanique tant qu'aucune migration n'est écrite (la lettre n'apparaît que dans `0500`–`0508`,
`due-diligence/erreurs.ts` et les tests `dd-*`).

**Mise à jour du 2026-10-20 (lot 3).** La lettre `Z` est épuisée (le redressement a pris `MPZ12`–`MPZ20`, voir SPEC-3a) : les codes du lot POSTÉRIEURS à `MPZ32` prennent le second préfixe `MQD` (CODING_STANDARDS §2). Employés : `MQD01`–`MQD08` (portail investisseur, `0509`) et `MQD11` (modèles sectoriels, `0511`) ; libres : `MQD09`, `MQD10`, `MQD12`–`MQD20`. (Les commentaires de `0509` réservent `MQD01`–`MQD10` au portail et `MQD11`–`MQD20` aux modèles ; l'état réel des codes employés est celui ci-dessus.) Les codes `MPZ21`–`MPZ32` sont inchangés.

| Code | Règle | HTTP / code d'erreur API |
| --- | --- | --- |
| `MPZ21` | Table du lot en ajout seul (UPDATE, DELETE refusés, même au propriétaire) | 409 `HISTORIQUE_AJOUT_SEUL` |
| `MPZ22` | Rattachement incohérent : mission, client, dossier, type d'élément, parent, assertion d'une autre mission, délien d'un lien absent, catégorie hors liste | 400 `RATTACHEMENT_INCOHERENT` |
| `MPZ23` | Versions qui se suivent sans trou (cadrage, élément, signal, dimensionnement, liste, note) | 409 `CONFLIT` (« rechargez la page ») |
| `MPZ24` | Verdict confirmé ou infirmé sans assertion citée, ou assertion citée non liée à l'hypothèse (sens ou mission) | 409 `VERDICT_SANS_SOURCE` |
| `MPZ25` | Séparation des tâches : validation d'un verdict | 403 `SEPARATION_DES_TACHES` |
| `MPZ26` | Séparation des tâches : validation d'une note | 403 `SEPARATION_DES_TACHES` |
| `MPZ27` | Validation d'une version périmée (verdict : ce n'est plus le dernier ou l'hypothèse a changé ; note : ce n'est plus la dernière soumise) | 409 `VERDICT_PERIME` / `NOTE_PERIMEE` |
| `MPZ28` | Séparation des tâches : décision sur une exclusion (décideur = auteur du filtrage) ; règle inconnue du filtrage | 403 `SEPARATION_DES_TACHES` / 400 |
| `MPZ29` | Version « soumise » d'une note incohérente : base figée absente, bloquants non vides, recommandation favorable avec exclusion non levée, conditions absentes | 409 `NOTE_BLOQUEE` |
| `MPZ30` | Action du plan des 100 jours : responsable hors équipe, initiative ou KPI d'un autre client | 400 `LIEN_INCOHERENT` |
| `MPZ31` | Paramètre de dimensionnement sans source valide (preuve d'une autre mission, ou avis d'expert sans motif) | 400 `PARAMETRE_SANS_SOURCE` |
| `MPZ32` | Un verdict est déjà en attente de validation pour cette hypothèse | 409 `VERDICT_EN_ATTENTE` |
| `MPR04` (lettre `R`, rapports) | Seule une version **validée** de la note se rend en rapport (§9.1) | 409 `NOTE_NON_VALIDEE` |

Les erreurs 23505 attendues (unicité d'une version, d'une décision) se traduisent en 409 par la
table d'unicités du module (`due-diligence/erreurs.ts`, modèle `capitalisation/erreurs.ts`).

### 3.3 Plafonds (provisoires, constantes `PLAFONDS_DD` de `packages/shared`)

409 `PLAFOND_ATTEINT` au-delà, vérifié sous le verrou de la mission (modèle `exigerPlafond`,
`preuves/ecriture.ts`) ; seuls les plafonds de version sont doublés par `CHECK`.

| Objet | Plafond |
| --- | --- |
| Dossiers par mission | 10 |
| Points d'analyse par dossier / étapes de chaîne / risques / hypothèses (profondeur 4) / actions du plan | 300 / 30 / 200 / 100 / 200 |
| Versions par élément, par cadrage, par signal, par dimensionnement, par liste, par note | 200 (`CHECK version BETWEEN 1 AND 200`) |
| Dimensionnements par dossier / filtrages par dossier / notes par dossier | 20 / 50 / 10 |
| Verdicts par hypothèse / constats de signaux par dossier / ajustements par dossier | 50 / 2 000 / 1 000 |
| Signaux par cabinet / listes d'exclusion par cabinet / règles par liste | 2 000 / 50 / 200 |
| `base_figee` d'une note (octets de jsonb) | 1 000 000 (`CHECK`, 409 `NOTE_TROP_VOLUMINEUSE`) |
| Assertions par mission | 2 000 (déjà `ASSERTIONS_MISSION_MAX`, partagé avec le registre) |

### 3.4 Vocabulaire fermé (français, `snake_case`, source de vérité dans `packages/shared`)

Les mêmes valeurs sont déclarées dans `packages/engines` (qui n'importe pas `shared`) ; un test
d'égalité (`apps/api/test/dd-vocabulaire.test.ts`, qui peut importer les deux) échoue sinon.

| Vocabulaire | Valeurs |
| --- | --- |
| Type d'opération | `acquisition`, `entree_marche`, `partenariat` |
| Analyse → catégories | `pestel` → `politique`, `economique`, `social`, `technologique`, `environnemental`, `juridique` ; `cinq_forces` → `rivalite`, `nouveaux_entrants`, `substituts`, `pouvoir_clients`, `pouvoir_fournisseurs` ; `swot` → `forces`, `faiblesses`, `opportunites`, `menaces` ; `operationnelle` → `processus`, `approvisionnement`, `goulots` |
| Famille de risque | `pays`, `change`, `operationnel`, `reglementaire` (rapprochées des familles `change`, `operationnel`, `conformite` de la taxonomie `risque`, `0204`, sans en dépendre) |
| Niveau de risque | `faible` < `modere` < `eleve` < `critique` |
| Verdict | `confirmee`, `infirmee`, `non_concluante` |
| Sens d'un lien hypothèse → assertion | `soutient`, `contredit` |
| Méthode de dimensionnement | `descendant`, `ascendant` |
| Recommandation de la note | `favorable`, `favorable_sous_conditions`, `reservee`, `defavorable` |
| Variante de la note | `executive`, `detaillee` |
| Statut d'une action | `a_faire`, `en_cours`, `terminee`, `bloquee` |
| Constat d'un signal | `constate`, `ecarte`, `a_verifier` |
| Décision sur une exclusion | `confirmee`, `ecartee` |
| Niveau E&S | `non_concerne` < `faible` < `modere` < `eleve` < `critique` |
| Thèmes E&S (8, libellés courts propres à MissionPilot, **provisoires**, à valider par un expert E&S ; cadre public cité en référence seulement : « Normes de performance de la SFI, n° 1 à 8 ») | `evaluation_gestion`, `main_oeuvre`, `ressources_pollution`, `sante_securite_communautes`, `terres_reinstallation`, `biodiversite`, `peuples_autochtones`, `patrimoine_culturel` |

Aucun texte d'un cadre ou d'une norme n'est reproduit : la liste d'exclusion de l'investisseur et les
libellés sont saisis ou rédigés par MissionPilot ; le champ `reference_cadre` est un nom de document
public (texte libre ≤ 300 caractères), jamais un extrait.

---

## 4. Modèle de données

### 4.1 Règles communes à toutes les tables `dd_*`

- Colonnes de tête : `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `cabinet_id uuid NOT NULL
  REFERENCES cabinets (id) ON DELETE CASCADE`, `UNIQUE (cabinet_id, id)` ; les tables d'identité
  (`dd_dossiers`, `dd_elements`, `dd_notes`, `dd_dimensionnements`) et tous les journaux portent
  `numero bigint GENERATED ALWAYS AS IDENTITY` (ordre des enregistrements et des événements ; utilisé par
  les index et par les lectures de l'état courant).
- **Clés étrangères composites** `(cabinet_id, x_id) REFERENCES …(cabinet_id, id)` vers toute table
  du cabinet (missions, clients, utilisateurs, assertions, preuves, plan_elements, kpi_definitions,
  dd_*). Les auteurs (`cree_par`, `auteur_id`, `proposee_par`, `valide_par`…) passent par
  `refuser_utilisateur_portail('<colonne>')` (`0113`) : un compte du portail n'écrit jamais.
- **RLS** sur chaque table : `ENABLE ROW LEVEL SECURITY` ; politique `isolation`
  (`USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id())`) ; politique
  `portail_interdit AS RESTRICTIVE FOR ALL USING (app_portail_client_id() IS NULL)` (modèle `0240`).
  Aucune politique `portail%` permissive. Les inventaires de `apps/api/test/isolation.test.ts`
  couvrent les 20 tables sans modification.
- **Ajout seul, même pour le propriétaire** : `REVOKE UPDATE, DELETE ON <table> FROM missionpilot_app`
  et déclencheur `BEFORE UPDATE OR DELETE … EXECUTE FUNCTION refuser_modification_dd()` (`MPZ21`),
  sur les 20 tables (aucune table mutable dans ce lot).
- Aucune colonne `REFERENCES fichiers` : `fichier_orphelin` (`0384`) est inchangée ; les sources
  passent par le registre des preuves.
- Texte libre : `CHECK (length(btrim(x)) BETWEEN 1 AND n AND x !~ '[[:cntrl:]]')` pour les titres
  et libellés (modèle `0180`) ; les champs longs `length(x) <= n`.
- Dates métier : `CHECK (d BETWEEN '2000-01-01' AND '2100-12-31')` et `dateIsoBorneeSchema` côté
  API (CODING_STANDARDS §6).
- Fonctions d'appelant (pas `SECURITY DEFINER`), `SET search_path = public, pg_temp` :
  `est_associe_dd(p_utilisateur uuid) RETURNS boolean` (`actif` et `'associe' = ANY (roles)`) ;
  `dd_categorie_valide(p_analyse text, p_categorie text) RETURNS boolean` (`IMMUTABLE`, liste du
  §3.4) ; réutilisées : `est_membre_actif_mission` (`0243`), `refuser_utilisateur_portail` (`0113`).

### 4.2 `0500` — dossiers et cadrage (DD-01)

```
dd_dossiers                       -- identité d'une opération étudiée ; jamais modifiée
  mission_id uuid NOT NULL, client_id uuid NOT NULL, cree_par uuid NOT NULL, cree_le timestamptz DEFAULT now()
  FK (cabinet_id, mission_id) → missions ; (cabinet_id, client_id) → clients ; (cabinet_id, cree_par) → utilisateurs
  INDEX (cabinet_id, mission_id, numero DESC)
  Déclencheur BEFORE INSERT : le client est celui de la mission (MPZ22), modèle `controler_preuve` (0240).

dd_cadrage_versions               -- contenu du cadrage, ajout seul
  dossier_id uuid NOT NULL, version int NOT NULL CHECK (version BETWEEN 1 AND 200)
  titre text NOT NULL (1..200, sans contrôle)
  secteur_code text NOT NULL CHECK (std_code_valide(secteur_code))     -- taxonomie « secteur » (CITI, 0204)
  filiere_code text NULL CHECK (filiere_code IS NULL OR std_code_valide(filiere_code))  -- taxonomie « filiere »
  pays_code text NOT NULL CHECK (std_code_valide(pays_code))           -- taxonomie « pays » (minuscules : « ci »)
  cible_nom text NULL (1..200) ; type_operation text NOT NULL IN ('acquisition','entree_marche','partenariat')
  devise text NOT NULL IN ('XOF','XAF','EUR','USD')
  date_operation date NULL (bornes 2000–2100) ; question_investissement text NULL ≤ 2000 ; perimetre text NULL ≤ 4000
  motif text NULL (1..500) ; cree_par uuid NOT NULL ; cree_le
  CHECK ((version = 1) = (motif IS NULL))
  CHECK (type_operation <> 'acquisition' OR cible_nom IS NOT NULL)      -- provisoire
  UNIQUE (dossier_id, version), UNIQUE (cabinet_id, dossier_id, version) ; FK composites
  Déclencheur BEFORE INSERT : numérotation sans trou (MPZ23) ; `cree_par` non portail.
```

Les codes de secteur, filière et pays sont **validés par l'API** contre `taxonomie_entrees` (lignes
du standard et du cabinet, lisibles sous RLS) : le code existe pour sa taxonomie, la filière a pour
`parent_code` le secteur choisi (400 `TAXONOMIE_INCONNUE`). Pas de clé étrangère (les lignes
standard ont `cabinet_id` NULL).

### 4.3 `0501` — bibliothèque de signaux (DD-11)

```
dd_signaux                        -- identité d'un signal, propre au cabinet
  code text NOT NULL CHECK (std_code_valide(code)), cree_par uuid NOT NULL, cree_le
  UNIQUE (cabinet_id, code)

dd_signal_versions                -- contenu, ajout seul ; la version courante est la plus grande
  signal_id uuid NOT NULL, version int (1..200)
  libelle text NOT NULL (1..200) ; description text NULL ≤ 2000
  famille text NOT NULL IN ('pays','change','operationnel','reglementaire')
  secteur_code text NULL, pays_code text NULL            -- NULL = tous ; une filière, un secteur, un pays ou une zone
  gravite_indicative text NOT NULL IN ('faible','modere','eleve','critique')
  question text NULL ≤ 1000 ; reference_publique text NULL ≤ 500   -- nom d'un document public, jamais un extrait
  actif boolean NOT NULL DEFAULT true ; motif text NULL ; cree_par ; cree_le
  CHECK ((version = 1) = (motif IS NULL)) ; UNIQUE (signal_id, version), UNIQUE (cabinet_id, signal_id, version)
  Déclencheur : numérotation (MPZ23) ; `cree_par` non portail.
```

La bibliothèque est **propre au cabinet** (pas de lignes « standard » dans ce lot) et **vide au
départ** : aucun signal n'est inventé ; un amorçage par des experts est un travail de contenu
(§16).

### 4.4 `0502` — éléments typés, versions, constats (DD-03 à DD-06, DD-09, DD-15)

```
dd_elements                       -- identité d'un élément ; jamais modifiée
  dossier_id uuid NOT NULL
  type text NOT NULL IN ('point_analyse','etape_chaine','risque','hypothese','action_100j')
  analyse text NULL IN ('pestel','cinq_forces','swot','operationnelle')      -- points seulement
  parent_id uuid NULL                                                       -- hypothèses seulement
  assertion_id uuid NULL                                                    -- points et risques seulement
  cree_par uuid NOT NULL, cree_le
  UNIQUE (cabinet_id, id, type), UNIQUE (cabinet_id, dossier_id, id)
  FK (cabinet_id, dossier_id) → dd_dossiers ; (cabinet_id, dossier_id, parent_id) → dd_elements (cabinet_id, dossier_id, id)
  FK (cabinet_id, assertion_id) → assertions (cabinet_id, id)
  CHECK ((type = 'point_analyse') = (analyse IS NOT NULL))
  CHECK (type = 'hypothese' OR parent_id IS NULL)
  CHECK ((type IN ('point_analyse','risque')) = (assertion_id IS NOT NULL))
  UNIQUE INDEX (assertion_id) WHERE assertion_id IS NOT NULL            -- une assertion, un élément
  INDEX (cabinet_id, dossier_id, type, numero)
  Déclencheur BEFORE INSERT (MPZ22) : l'assertion appartient à la mission du dossier ; le parent est une
  hypothèse du même dossier et sa profondeur + 1 ≤ 4 (remontée de 4 parents au plus).

dd_element_versions               -- contenu, ajout seul
  element_id uuid NOT NULL, type text NOT NULL (recopie du type de l'identité), version int (1..200)
  libelle text NULL ≤ 200 ; description text NULL ≤ 4000
  categorie text NULL ≤ 60            -- catégorie de l'analyse (point) ou famille (risque)
  niveau text NULL IN ('faible','modere','eleve','critique')
  ordre int NULL BETWEEN 1 AND 200
  part_cout_bp int NULL BETWEEN 0 AND 10000 ; part_marge_bp int NULL BETWEEN 0 AND 10000
  acteurs text[] NOT NULL DEFAULT '{}' CHECK (cardinality(acteurs) <= 12)
  contraintes text NULL ≤ 2000 ; critere text NULL ≤ 2000
  etape_id uuid NULL ; signal_id uuid NULL                                   -- risques
  responsable_id uuid NULL ; plan_element_id uuid NULL ; kpi_id uuid NULL    -- actions du plan
  jour_debut int NULL BETWEEN 0 AND 100 ; jour_fin int NULL BETWEEN 0 AND 100
  statut_action text NULL IN ('a_faire','en_cours','terminee','bloquee')
  retire boolean NOT NULL DEFAULT false ; motif text NULL (1..500) ; auteur_id uuid NOT NULL ; cree_le
  FK (cabinet_id, element_id, type) → dd_elements (cabinet_id, id, type)
  FK (cabinet_id, etape_id) → dd_elements ; (cabinet_id, signal_id) → dd_signaux
  FK (cabinet_id, responsable_id) → utilisateurs ; (cabinet_id, plan_element_id) → plan_elements
  FK (cabinet_id, kpi_id) → kpi_definitions ; (cabinet_id, auteur_id) → utilisateurs
  CHECK ((version = 1) = (motif IS NULL)) ; UNIQUE (element_id, version), UNIQUE (cabinet_id, element_id, version)
  INDEX (cabinet_id, element_id, version DESC)
```

**Colonnes renseignées (R), facultatives (f) ou interdites (—) par type** (une seule contrainte
`CHECK (CASE type … END)` ; « — » signifie `IS NULL` ou, pour `acteurs`, `= '{}'`) :

| Colonne | point_analyse | etape_chaine | risque | hypothese | action_100j |
| --- | --- | --- | --- | --- | --- |
| `libelle` | f (titre court) | R | R | R | R |
| `description` | f | f | f | f | f |
| `categorie` | R (valide pour l'analyse) | — | R (famille) | — | — |
| `niveau` | f (importance) | — | R | — | — |
| `ordre` | f | R | — | f | — |
| `part_cout_bp`, `part_marge_bp` | — | f | — | — | — |
| `acteurs`, `contraintes` | — | f | — | — | — |
| `critere` | — | — | — | f | — |
| `etape_id`, `signal_id` | — | — | f | — | — |
| `responsable_id`, `plan_element_id`, `kpi_id` | — | — | — | — | f |
| `jour_debut`, `jour_fin` | — | — | — | — | R (`jour_debut <= jour_fin`) |
| `statut_action` | — | — | — | — | R |

Une version porte l'état **complet** de l'élément (l'API recopie les colonnes inchangées) ; `retire` à vrai
retire l'élément des lectures courantes, une version suivante peut le rétablir.

Le texte d'une affirmation (point, justification d'un risque) **n'est pas ici** : il vit dans
`assertion_versions.enonce` (§2.1) ; corriger l'énoncé = nouvelle version d'assertion
(`corrigerAssertion`) et, si une colonne du tableau change, nouvelle version d'élément.

Déclencheur `BEFORE INSERT` sur `dd_element_versions` : numérotation sans trou (`MPZ23`) ; catégorie
valide (`dd_categorie_valide` pour un point, famille de la liste pour un risque, `MPZ22`) ;
`etape_id` désigne une `etape_chaine` du même dossier (`MPZ22`) ; pour une action : `responsable_id`
passe `est_membre_actif_mission` de la mission du dossier, `plan_element_id` désigne une
**initiative** (`plan_elements.type = 'initiative'`) dont le plan appartient à une mission du **même
client** que le dossier, `kpi_id` désigne un KPI du même client (`MPZ30`) ; `auteur_id` et
`responsable_id` non portail.

```
dd_signal_constats                -- journal : constat d'un signal sur un dossier (ajout seul)
  dossier_id uuid NOT NULL, signal_id uuid NOT NULL, signal_version int NOT NULL
  etat text NOT NULL IN ('constate','ecarte','a_verifier') ; commentaire text NULL ≤ 1000
  risque_element_id uuid NULL ; cree_par uuid NOT NULL ; cree_le
  CHECK (etat <> 'ecarte' OR commentaire IS NOT NULL)
  FK (cabinet_id, dossier_id) → dd_dossiers ; (cabinet_id, signal_id, signal_version) → dd_signal_versions
  FK (cabinet_id, risque_element_id) → dd_elements
  Déclencheur (MPZ22) : le risque est un élément `risque` du même dossier. L'état courant d'un couple
  (dossier, signal) est son dernier constat (numero le plus grand).
```

### 4.5 `0503` — hypothèses, liens, verdicts (DD-09)

```
dd_hypothese_liens                -- journal des liens hypothèse → assertion (modèle assertion_preuve_liens, 0242)
  dossier_id uuid NOT NULL, hypothese_id uuid NOT NULL, assertion_id uuid NOT NULL
  action text NOT NULL IN ('lier','delier') ; sens text NULL IN ('soutient','contredit')
  CHECK ((action = 'lier') = (sens IS NOT NULL)) ; cree_par ; cree_le
  FK (cabinet_id, dossier_id, hypothese_id) → dd_elements (cabinet_id, dossier_id, id)
  FK (cabinet_id, assertion_id) → assertions ; INDEX (cabinet_id, hypothese_id, assertion_id, numero DESC)
  Déclencheur (MPZ22) : l'élément est de type `hypothese` ; l'assertion appartient à la mission du dossier ;
  on ne délie que ce qui est lié (dernier événement du couple = 'lier').

dd_verdicts                       -- une proposition de verdict, ajout seul
  dossier_id, hypothese_id uuid NOT NULL ; hypothese_version int NOT NULL (version de l'hypothèse lue)
  verdict text NOT NULL IN ('confirmee','infirmee','non_concluante')
  indication_moteur text NOT NULL IN (idem)           -- calculée par l'API depuis le moteur, jamais reçue
  motif text NOT NULL (1..2000)
  assertions_citees jsonb NOT NULL                     -- photographie : tableau ≤ 50 de
                                                       -- { assertion_id, version, sens, indice_num, indice_den, lecture }
  proposee_par uuid NOT NULL ; proposee_le timestamptz DEFAULT now()
  CHECK (jsonb_typeof(assertions_citees) = 'array' AND jsonb_array_length(assertions_citees) <= 50)
  CHECK (verdict = 'non_concluante' OR jsonb_array_length(assertions_citees) >= 1)
  CHECK (verdict = indication_moteur OR length(motif) >= 20)
  FK (cabinet_id, dossier_id, hypothese_id) → dd_elements ; FK auteur → utilisateurs
  Déclencheur BEFORE INSERT :
    - MPZ32 : aucun autre verdict de cette hypothèse sans décision (`dd_verdict_validations`) ;
    - MPZ24 : pour chaque assertion citée, le dernier événement de lien du couple (hypothèse, assertion)
      est « lier » avec le MÊME sens que la photographie, l'assertion est de la mission du dossier ;
      `confirmee` exige au moins une citation `soutient`, `infirmee` au moins une `contredit` ;
    - MPZ22 : l'hypothèse n'est pas retirée (dernière version `retire = false`).

dd_verdict_validations            -- décision d'un tiers sur un verdict, ajout seul
  verdict_id uuid NOT NULL UNIQUE ; decision text NOT NULL IN ('valide','rejete')
  motif text NULL (1..1000) ; CHECK (decision = 'valide' OR motif IS NOT NULL)
  valide_par uuid NOT NULL ; valide_le timestamptz DEFAULT now()
  FK (cabinet_id, verdict_id) → dd_verdicts ; FK valideur → utilisateurs
  Déclencheur BEFORE INSERT :
    - MPZ27 : le verdict est le DERNIER de son hypothèse (aucun `numero` supérieur) et
      `hypothese_version` = version courante de l'hypothèse ;
    - MPZ25 (séparation des tâches, sauf `est_associe_dd(valide_par)`) : le valideur n'est ni le
      proposant, ni le créateur de l'hypothèse (`dd_elements.cree_par`), ni l'auteur d'une version de
      l'hypothèse, ni le créateur d'une assertion citée (identité `assertions.cree_par` ou version
      courante `assertion_versions.cree_par`) — modèle `MPV07` (0243) et `MPW05` (0385).
```

**État dérivé d'une hypothèse** (code de l'API, `due-diligence/hypotheses.ts`, jamais stocké) :
`verdict en vigueur` = dernier verdict ayant une validation `valide` ; `en attente` = dernier verdict
sans validation ; `ouverte` = ni l'un ni l'autre ; un verdict `rejete` laisse l'état antérieur.

### 4.6 `0504` — dimensionnement de marché (DD-12)

```
dd_dimensionnements               -- identité
  dossier_id uuid NOT NULL, methode text NOT NULL IN ('descendant','ascendant'), cree_par ; cree_le

dd_dimensionnement_versions       -- ajout seul
  dimensionnement_id uuid NOT NULL, version int (1..200), libelle text NOT NULL (1..200)
  parametres jsonb NOT NULL     -- tableau de 4 : { code, unite, bas, base, haut, source }, source =
                                -- { "type":"preuve","preuve_id":uuid } | { "type":"avis_expert","motif":text≥10 }
  ajustements jsonb NOT NULL DEFAULT '[]'   -- tableau ≤ 10 de { libelle, facteur_bp, motif }
  resultat jsonb NOT NULL       -- sortie du moteur au moment de l'écriture (stable si la formule change)
  moteur_version smallint NOT NULL DEFAULT 1
  motif text NULL ; auteur_id uuid NOT NULL ; cree_le
  CHECK (jsonb_typeof(parametres) = 'array' AND jsonb_array_length(parametres) <= 12)
  CHECK (jsonb_typeof(ajustements) = 'array' AND jsonb_array_length(ajustements) <= 10)
  CHECK (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 50000)
  Déclencheur BEFORE INSERT : numérotation (MPZ23) ; MPZ31 : chaque paramètre cite une preuve de la
  MISSION du dossier ou un avis d'expert motivé (≥ 10 caractères) ; une source absente est refusée
  à l'enregistrement (le calcul à blanc, R34, l'admet et le signale).
```

### 4.7 `0505` — filtrage environnemental et social (DD-14)

```
dd_exclusion_listes               -- identité d'une liste d'exclusion
  nom text NOT NULL (1..200), client_id uuid NULL (investisseur concerné ; NULL = générale)
  cree_par ; cree_le ; UNIQUE (cabinet_id, nom) ; FK (cabinet_id, client_id) → clients

dd_exclusion_liste_versions       -- ajout seul
  liste_id uuid NOT NULL, version int (1..200)
  regles jsonb NOT NULL         -- tableau 1..200 de { code, libelle, mots_cles[≤20], secteur_codes[≤20],
                                -- pays_codes[≤20] } ; au moins un critère par règle ; codes uniques dans la liste
  reference_cadre text NULL ≤ 300     -- nom d'un cadre public dont la liste s'inspire (aucun extrait)
  motif ; cree_par ; cree_le ; UNIQUE (liste_id, version), UNIQUE (cabinet_id, liste_id, version)
  Déclencheur : numérotation (MPZ23) ; structure des règles (MPZ22).

dd_filtrages                      -- une revue E&S d'un dossier, ajout seul (la dernière fait foi)
  dossier_id uuid NOT NULL, liste_version_id uuid NOT NULL
  declarations jsonb NOT NULL   -- { activites: texte[≤30], secteur_codes: [≤20], pays_codes: [≤20] }
  themes jsonb NOT NULL         -- tableau ≤ 8 de { code, niveau, justification, assertion_id|null }
  resultat jsonb NOT NULL       -- sortie de `filtrerExclusions` : { touches, non_touchees } (figée) ; la synthèse E&S
                                -- est RECALCULÉE à chaque lecture avec les décisions (§8.6)
  auteur_id uuid NOT NULL ; cree_le ; FK (cabinet_id, dossier_id) → dd_dossiers ;
  (cabinet_id, liste_version_id) → dd_exclusion_liste_versions

dd_filtrage_decisions             -- journal des décisions sur une exclusion touchée, ajout seul
  filtrage_id uuid NOT NULL, regle_code text NOT NULL, decision text NOT NULL IN ('confirmee','ecartee')
  motif text NOT NULL (10..1000) ; decideur_id uuid NOT NULL ; cree_le
  Déclencheur BEFORE INSERT : MPZ28 — la règle figure dans `resultat->'touches'` du filtrage ; le décideur
  n'est pas l'auteur du filtrage (sauf `est_associe_dd`).
```

### 4.8 `0506` — ajustements des experts (DD-08)

```
dd_ajustements                    -- trace des écarts de l'expert à une proposition d'un moteur ou de la bibliothèque
  dossier_id uuid NOT NULL
  cible_type text NOT NULL IN ('verdict','risque','dimensionnement')
  cible_id uuid NOT NULL          -- dd_verdicts.id | dd_elements.id (risque) | dd_dimensionnements.id
  champ text NOT NULL (1..120) ; valeur_avant text NOT NULL ≤ 500 ; valeur_apres text NOT NULL ≤ 500
  motif text NOT NULL (10..1000) ; auteur_id uuid NOT NULL ; cree_le
  Déclencheur (MPZ22) : la cible existe, du type annoncé, dans le dossier.
```

Écrite par l'API seulement (aucune route `POST`), dans la transaction de l'écriture qui la
provoque : verdict ≠ indication du moteur (`champ = 'verdict'`, avant = indication, après =
verdict) ; niveau d'un risque ≠ gravité indicative du signal d'origine (`champ = 'niveau'`) ;
ajustement multiplicatif d'un dimensionnement (`champ = 'resultat'`, valeurs formatées par le
moteur, une ligne par ajustement).

### 4.9 `0507` — notes au comité (DD-13)

```
dd_notes                          -- identité
  dossier_id uuid NOT NULL, titre text NOT NULL (1..200), cree_par ; cree_le

dd_note_versions                  -- ajout seul
  note_id uuid NOT NULL, version int (1..200)
  etat text NOT NULL IN ('brouillon','soumise')
  recommandation text NOT NULL IN ('favorable','favorable_sous_conditions','reservee','defavorable')
  synthese text NOT NULL (1..4000) ; conditions text[] NOT NULL DEFAULT '{}' (≤ 20 éléments de ≤ 300)
  base_figee jsonb NULL ; soumise_le timestamptz NULL ; motif text NULL ; cree_par uuid NOT NULL ; cree_le
  CHECK ((version = 1) = (motif IS NULL))
  CHECK ((etat = 'soumise') = (base_figee IS NOT NULL AND soumise_le IS NOT NULL))
  CHECK (base_figee IS NULL OR octet_length(base_figee::text) <= 1000000)
  Déclencheur BEFORE INSERT : numérotation (MPZ23) ; pour `soumise` (MPZ29) : `base_figee->'bloquants'` est
  un tableau vide, `base_figee->>'exclusions_bloquantes'` = 0 si la recommandation est `favorable` ou
  `favorable_sous_conditions`, au moins une condition si `favorable_sous_conditions`. Garde de COHÉRENCE
  (la base est calculée par l'API ; du SQL arbitraire du même rôle la contournerait, limite connue,
  comme la garde de provenance de `0270`).

dd_note_validations               -- décision d'un tiers sur une version soumise, ajout seul
  note_version_id uuid NOT NULL UNIQUE ; decision IN ('valide','rejete') ; motif (obligatoire si rejete)
  valide_par uuid NOT NULL ; valide_le
  Déclencheur BEFORE INSERT : la version est `soumise` et la DERNIÈRE soumise de sa note (MPZ27) ;
  MPZ26 (sauf `est_associe_dd`) : le valideur n'est ni le créateur de la note, ni l'auteur
  (`cree_par`) d'aucune version de la note (brouillons et soumissions comprises).
```

`base_figee` : objet validé par `noteBaseSchema` (`.strict()`, §6) ; contenu et construction au §9.2.
**Jamais** d'extrait de preuve nominatif ni de nom de personne : seuls figurent les libellés de
source et les extraits déjà masqués par `vuePreuve(…, false)`.

### 4.10 `0508` — rapports (extension de `rapports_mission`)

Détaillée au §9.1 (colonnes `dd_note_id`, `variante`, contraintes réécrites, `MPR04`).

---

## 5. Moteurs : `packages/engines/src/due-diligence/`

Fonctions **pures**, déterministes, sans E/S ni horloge (la date du jour est un paramètre), en
arithmétique entière ; erreurs typées `ErreurDueDiligence` que l'API traduit en 400
(`due-diligence/erreurs.ts`). Fichiers (kebab-case) : `erreurs.ts`, `vocabulaire.ts`,
`chaine-valeur.ts`, `risques.ts`, `hypotheses.ts`, `dimensionnement.ts`, `signaux.ts`,
`exclusions.ts`, `plan-100-jours.ts`, `note.ts`, `index.ts`, plus un fichier `*.test.ts` par fichier
source. `packages/engines/src/index.ts` gagne une ligne (`export * from "./due-diligence/index";`,
commentaire « Vague 4, service #2 »). Les noms exportés ci-dessous ont été comparés à ceux des
autres moteurs (aucune collision relevée) ; les types génériques portent le suffixe `Dd`.
`LectureSolidite` s'importe de `../preuves/solidite`, `diviserArrondi` de
`../finance/calcul-exact` (non exporté par le paquet, comme dans `plan-strategique/bancabilite.ts`),
`ajouterJours`, `ecartJours` et `DateISO` de `../planning/dates`.

Couverture : le seuil du paquet (90 % lignes, fonctions, branches, instructions,
`packages/engines/vitest.config.ts`) s'applique ; viser 100 % des branches du module (chaque
validation d'entrée a son test). Toute constante de seuil est **exportée** et notée provisoire.

### 5.1 Erreurs et vocabulaire

```ts
export type CodeErreurDueDiligence =
  | "ENTREE_INVALIDE" | "PARAMETRE_INVALIDE" | "PARAMETRE_MANQUANT" | "BORNES_INCOHERENTES"
  | "DEPASSEMENT" | "ARBRE_INVALIDE" | "DATE_INVALIDE";
export class ErreurDueDiligence extends Error {
  readonly code: CodeErreurDueDiligence;
  constructor(code: CodeErreurDueDiligence, message: string);
}

// vocabulaire.ts : valeurs du §3.4, déclarées `as const`
export const ANALYSES_DD, CATEGORIES_ANALYSE_DD, FAMILLES_RISQUE_DD, NIVEAUX_RISQUE_DD, NIVEAUX_ES,
  VERDICTS_DD, TYPES_OPERATION_DD, METHODES_DIMENSIONNEMENT, RECOMMANDATIONS_NOTE, VARIANTES_NOTE,
  STATUTS_ACTION_100J, THEMES_ES;
export type AnalyseDd, FamilleRisqueDd, NiveauRisqueDd, NiveauEs, VerdictDd, MethodeDimensionnement,
  RecommandationNote, VarianteNote, StatutAction100j;
export function estCategorieAnalyseDd(analyse: AnalyseDd, categorie: string): boolean;
export function rangNiveauRisqueDd(n: NiveauRisqueDd): 1 | 2 | 3 | 4;       // faible = 1 … critique = 4
export function rangNiveauEs(n: NiveauEs): 0 | 1 | 2 | 3 | 4;               // non_concerne = 0 … critique = 4
/** Points de base en pourcentage français, entiers seulement, même séparateur que `formaterMontant` : 4000 → « 40 % », 2550 → « 25,5 % ». */
export function formaterPointsDeBase(bp: number): string;   // entier 0..100 000 sinon ENTREE_INVALIDE
```

### 5.2 Dimensionnement de marché (DD-12) — `dimensionnement.ts`

Entrées entières uniquement : `nombre` (effectif ou quantité), `pourcentage_bp` (points de base,
0 à 10 000, soit 0 à 100 %), `montant` (unités mineures de la devise du dossier). Calcul en
`bigint` avec **un seul arrondi** (à l'entier le plus proche, demi s'éloignant de zéro,
`diviserArrondi`), sur la fraction exacte ; tout résultat doit tenir dans `Number.MAX_SAFE_INTEGER`
(sinon `DEPASSEMENT`). Aucun flottant n'entre dans une formule.

```ts
export const UNITES_PARAMETRE = ["nombre", "pourcentage_bp", "montant"] as const;
export type UniteParametre = (typeof UNITES_PARAMETRE)[number];

/** Paramètres exigés par méthode, dans l'ordre d'affichage. */
export const PARAMETRES_DESCENDANT: readonly { code: string; unite: UniteParametre }[]; // marche_total (montant),
  // part_segment (pourcentage_bp), part_adressable (pourcentage_bp), part_capturable (pourcentage_bp)
export const PARAMETRES_ASCENDANT: readonly { code: string; unite: UniteParametre }[];  // clients_cibles (nombre),
  // taux_conquete (pourcentage_bp), volume_par_client (nombre), prix_unitaire (montant)
export const SEUIL_RECOUPEMENT_BP = 3_000;            // 30 % d'écart relatif, PROVISOIRE
export const FACTEUR_AJUSTEMENT_MAX_BP = 20_000;      // un ajustement vaut de 0,01 % à 200 %, PROVISOIRE
export const AJUSTEMENTS_MAX = 10;

export type SourceParametre = { readonly type: "preuve"; readonly preuveId: string }
  | { readonly type: "avis_expert" };
export interface ParametreDimensionnement {
  readonly code: string;
  readonly bas: number; readonly base: number; readonly haut: number;   // entiers ≥ 0, bas ≤ base ≤ haut
  readonly source: SourceParametre | null;                              // null : accepté ici, signalé en sortie
}
export interface AjustementDimensionnement { readonly libelle: string; readonly facteurBp: number } // 1..20 000
export interface EntreeDimensionnement {
  readonly methode: MethodeDimensionnement;
  readonly parametres: readonly ParametreDimensionnement[];   // exactement les 4 codes de la méthode
  readonly ajustements?: readonly AjustementDimensionnement[];
}
export interface FourchetteDd { readonly bas: number; readonly base: number; readonly haut: number }
export type CodeEtageDd = "marche_total" | "marche_adressable" | "marche_capturable" | "marche_atteignable";
export interface EtageDd { readonly code: CodeEtageDd; readonly valeurs: FourchetteDd }
export interface SensibiliteParametre {
  readonly code: string;
  readonly resultatBas: number; readonly resultatHaut: number;   // résultat final, ce paramètre seul à bas / à haut
  readonly amplitude: number;                                     // resultatHaut − resultatBas
  readonly partAmplitudeBp: number;                               // amplitude × 10 000 / amplitude max, arrondi ; 0 si max = 0
}
export interface CouvertureSources { readonly total: number; readonly preuve: number;
  readonly avisExpert: number; readonly absente: readonly string[] }   // codes sans source
export interface ResultatDimensionnement {
  readonly methode: MethodeDimensionnement;
  readonly etages: readonly EtageDd[];            // avant ajustement ; descendant : total, adressable, capturable ; ascendant : atteignable
  readonly avantAjustement: FourchetteDd;         // dernier étage
  readonly resultat: FourchetteDd;                // dernier étage après ajustements (== avantAjustement sans ajustement)
  readonly ajuste: boolean;
  readonly ajustementsAppliques: readonly { libelle: string; facteurBp: number; base: number }[]; // `base` cumulée après chaque ajustement (un seul arrondi sur la fraction exacte)
  readonly sensibilite: readonly SensibiliteParametre[];   // tri : amplitude décroissante, puis code croissant
  readonly couverture: CouvertureSources;
}
export function dimensionnerMarche(entree: EntreeDimensionnement): ResultatDimensionnement;

export interface RecoupementDd {
  readonly ecartBp: number;                       // |d − a| × 10 000 / max(d, a) sur les `base`, arrondi ; 0 si les deux sont nuls
  readonly plusEleve: "descendant" | "ascendant" | "egal";
  readonly alerte: boolean;                       // ecartBp > seuilBp (strict)
  readonly chevauchement: boolean;                // les fourchettes [bas, haut] se recoupent
}
export function recouperDimensionnements(descendant: FourchetteDd, ascendant: FourchetteDd,
  seuilBp?: number): RecoupementDd;
```

Formules (`MT`, `PS`, `PA`, `PC` = `marche_total`, `part_segment`, `part_adressable`,
`part_capturable` ; `C`, `T`, `V`, `P` = `clients_cibles`, `taux_conquete`, `volume_par_client`,
`prix_unitaire` ; `F` = produit des facteurs d'ajustement en bp ; `k` leur nombre) :

- descendant : `marche_total = MT` ; `marche_adressable = MT·PS·PA / 10⁸` ;
  `marche_capturable = MT·PS·PA·PC / 10¹²` ;
- ascendant : `marche_atteignable = C·T·V·P / 10⁴` ;
- ajustement : le dernier étage × `F / 10^(4k)`, **un seul arrondi** sur la fraction exacte ;
- fourchette : `bas` = tous les paramètres à `bas`, `haut` = tous à `haut` (valable car chaque
  paramètre entre de façon multiplicative et positive) ;
- sensibilité : pour chaque paramètre, résultat final avec ce seul paramètre à `bas` puis à `haut`,
  les autres à `base`.

Erreurs : code de méthode inconnu, doublon, code hors liste → `PARAMETRE_INVALIDE` ; code attendu
absent → `PARAMETRE_MANQUANT` ; valeur non entière, négative, non sûre, ou pourcentage > 10 000 →
`PARAMETRE_INVALIDE` ; `bas > base` ou `base > haut` → `BORNES_INCOHERENTES` ; facteur hors
1..20 000 ou plus de 10 ajustements → `PARAMETRE_INVALIDE` ; résultat > `MAX_SAFE_INTEGER` →
`DEPASSEMENT`.

**Cas de test numériques (calculés à la main)** — `dimensionnement.test.ts` :

| # | Entrée | Attendu |
| --- | --- | --- |
| D1 | descendant ; `marche_total` 80 Md / 100 Md / 120 Md (`80_000_000_000` / `100_000_000_000` / `120_000_000_000`) ; `part_segment` 3 000 / 4 000 / 5 000 ; `part_adressable` 4 000 / 5 000 / 6 000 ; `part_capturable` 800 / 1 000 / 1 200 | `etages` : `marche_total` {80 Md, 100 Md, 120 Md} ; `marche_adressable` {`9_600_000_000`, `20_000_000_000`, `36_000_000_000`} ; `marche_capturable` {`768_000_000`, `2_000_000_000`, `4_320_000_000`} ; `resultat` = `avantAjustement` = marché capturable ; `ajuste` faux |
| D1 sensibilité | idem, sur le marché capturable | ordre `part_segment` (amplitude `1_000_000_000`, résultats `1_500_000_000` → `2_500_000_000`, part 10 000), `marche_total` (`800_000_000`, `1_600_000_000` → `2_400_000_000`, 8 000), `part_adressable` (`800_000_000`, `1_600_000_000` → `2_400_000_000`, 8 000), `part_capturable` (`800_000_000`, 8 000) ; égalités départagées par code croissant |
| D2 | D1 + ajustements `{Informel, 9 000}` et `{Change, 9 500}` | `avantAjustement` inchangé ; `resultat` {`656_640_000`, `1_710_000_000`, `3_693_600_000`} (facteur exact 0,855) ; `ajuste` vrai ; `ajustementsAppliques` `base` : `1_800_000_000` puis `1_710_000_000` |
| A1 | ascendant ; `clients_cibles` 1 500 / 2 000 / 2 500 ; `taux_conquete` 1 500 / 2 000 / 2 500 ; `volume_par_client` 10 / 12 / 14 ; `prix_unitaire` 200 000 / 250 000 / 300 000 | `etages` : un seul, `marche_atteignable` {`450_000_000`, `1_200_000_000`, `2_625_000_000`} |
| A1 sensibilité | idem | `clients_cibles` (amplitude `600_000_000`, `900_000_000` → `1_500_000_000`, part 10 000), `taux_conquete` (`600_000_000`, 10 000), `prix_unitaire` (`480_000_000`, `960_000_000` → `1_440_000_000`, 8 000), `volume_par_client` (`400_000_000`, `1_000_000_000` → `1_400_000_000`, part 6 667) |
| R1 | ascendant, bas = base = haut : `clients_cibles` 3, `taux_conquete` 5 000, `volume_par_client` 1, `prix_unitaire` 1 | résultat 2 (1,5 arrondi vers 2, demi s'éloignant de zéro) |
| R2 | idem avec `taux_conquete` 4 999 puis 5 001 | 0 (0,4999) puis 1 (0,5001) |
| R3 | tous les paramètres à 0 | résultat 0, amplitudes 0, `partAmplitudeBp` 0 |
| C1 | D1 avec sources `[preuve p1, preuve p2, avis_expert, null]` | `couverture` {total 4, preuve 2, avisExpert 1, absente [`part_capturable`]} |
| E1 | `marche_total` `9_007_199_254_740_991`, parts 10 000 ×3, ajustement 20 000 | `ErreurDueDiligence("DEPASSEMENT")` (1,8·10¹⁶) |
| E2 | `bas` > `base` ; paramètre manquant ; code inconnu ; doublon ; pourcentage 10 001 ; valeur 1,5 ; facteur 0 ; 11 ajustements | `BORNES_INCOHERENTES`, `PARAMETRE_MANQUANT`, `PARAMETRE_INVALIDE` (×5) |
| X1 | `recouperDimensionnements` : descendant {`768_000_000`, `2_000_000_000`, `4_320_000_000`} contre ascendant {`450_000_000`, `1_200_000_000`, `2_625_000_000`} | `ecartBp` 4 000 (8·10⁸ × 10 000 / 2·10⁹), `plusEleve` « descendant », `alerte` vrai, `chevauchement` vrai |
| X2 | {10, 20, 30} contre {40, 50, 60} | `ecartBp` 6 000, « ascendant », `alerte` vrai, `chevauchement` faux |
| X3 | bases 1 et 3 ; bases égales ; bases nulles ; `seuilBp` 4 000 avec un écart de 4 000 | 6 667 (2 × 10 000 / 3 arrondi) ; 0 et « egal » ; 0 et « egal », alerte faux ; alerte faux (comparaison stricte) |

### 5.3 Chaîne de valeur (DD-04) — `chaine-valeur.ts`

```ts
export const TOLERANCE_SOMME_PARTS_BP = 100;          // écart admis à 10 000 : 1 point, PROVISOIRE
export interface EtapeChaineEntree { readonly id: string; readonly ordre: number;
  readonly partCoutBp: number | null; readonly partMargeBp: number | null }
export interface EtapeChaineSynthese { readonly id: string; readonly ordre: number;
  readonly partCoutBp: number | null; readonly partMargeBp: number | null;
  readonly rangMarge: number | null }                  // 1 = plus forte part de marge ; null si non renseignée
export type CoherenceParts = "vide" | "incomplete" | "coherente" | "incoherente";
export interface SyntheseChaine {
  readonly etapes: readonly EtapeChaineSynthese[];     // tri : ordre, puis id
  readonly totalCoutBp: number; readonly totalMargeBp: number;     // sommes des parts renseignées
  readonly coherenceCout: CoherenceParts; readonly coherenceMarge: CoherenceParts;
  readonly etapeMargeMax: string | null;               // id du rang 1
}
export function syntheseChaineDeValeur(etapes: readonly EtapeChaineEntree[]): SyntheseChaine;
```

Règles : « vide » = aucune étape ; « incomplete » = au moins une part non renseignée ;
« coherente » = toutes renseignées et `|total − 10 000| ≤ TOLERANCE_SOMME_PARTS_BP` ;
sinon « incoherente ». Rang de marge : parts décroissantes, égalités par `ordre` puis `id` (rangs
distincts 1…n). Erreurs : `id` en double, `ordre` non entier < 1, part hors 0..10 000 → `ENTREE_INVALIDE`.

Tests (`chaine-valeur.test.ts`) : quatre étapes (ordre 1 à 4, ids `a` à `d`), coûts `[3000, 2500, 3000,
1500]` (total 10 000, « coherente »), marges `[500, 2500, 5000, 2000]` → rangs `a` 4, `b` 2, `c` 1,
`d` 3 ; `etapeMargeMax` = `c` ; coûts `[3000, 2500, 3000, 1450]` (9 950 → « coherente ») ;
`[3000, 2500, 3000, 1300]` (9 800 → « incoherente ») ; une part `null` → « incomplete » et total des
seules parts renseignées ; liste vide → « vide » et `etapeMargeMax` null ; égalité de marges
départagée par `ordre` ; entrées invalides → `ENTREE_INVALIDE`.

### 5.4 Risques (DD-06) — `risques.ts`

```ts
export interface RisqueEntree { readonly id: string; readonly famille: FamilleRisqueDd;
  readonly niveau: NiveauRisqueDd; readonly etapeId: string | null;
  readonly lecture: LectureSolidite | null }            // lecture de l'assertion de justification ; null : non évaluée
export interface FamilleRisqueSynthese { readonly famille: FamilleRisqueDd; readonly total: number;
  readonly parNiveau: Readonly<Record<NiveauRisqueDd, number>>; readonly niveauMax: NiveauRisqueDd | null }
export interface SyntheseRisquesDd {
  readonly total: number;
  readonly familles: readonly FamilleRisqueSynthese[];   // ordre canonique : pays, change, operationnel, reglementaire
  readonly aDocumenter: readonly string[];               // ids : niveau eleve ou critique ET lecture fragile ou null ;
                                                         // tri : niveau décroissant, puis id
  readonly parEtape: readonly { etapeId: string; total: number; niveauMax: NiveauRisqueDd }[]; // tri par etapeId
}
export function syntheseRisquesDd(risques: readonly RisqueEntree[]): SyntheseRisquesDd;
```

Test (`risques.test.ts`) : `r1` pays critique étape `e1` « fragile » ; `r2` pays modéré `e1` « solide » ;
`r3` change élevé sans étape « etayee » ; `r4` opérationnel faible `e2` `null` ; `r5` opérationnel
élevé `e2` `null`. Attendu : `total` 5 ; pays {total 2, critique 1, modéré 1, max critique} ; change
{1, élevé 1, max élevé} ; opérationnel {2, faible 1, élevé 1, max élevé} ; réglementaire {0, max
`null`} ; `aDocumenter` `[r1, r5]` (`r3` exclu : « etayee ») ; `parEtape` `[e1 {2, critique}, e2 {2,
élevé}]`. Liste vide : total 0, quatre familles à 0. Famille ou niveau inconnu → `ENTREE_INVALIDE`.

### 5.5 Hypothèses et verdicts (DD-09) — `hypotheses.ts`

```ts
export const MIN_ASSERTIONS_SOUTIEN_PAR_DEFAUT = 2;     // PROVISOIRE
export const HYPOTHESES_PROFONDEUR_MAX = 4;
export interface AssertionDeHypothese { readonly id: string; readonly sens: "soutient" | "contredit";
  readonly lecture: LectureSolidite }                    // « solide » ≥ 0,75, « etayee » ≥ 0,5, « fragile » (moteur des preuves)
export interface ParametresVerdict { readonly minAssertionsSoutien: number }   // entier 1..20
export type RaisonVerdict = "AUCUNE_ASSERTION" | "CONTRE_SOLIDE_SANS_SOUTIEN_SOLIDE" | "CONFLIT_SOLIDE"
  | "CONTRE_ETAYE_OU_SOLIDE" | "SOUTIEN_SUFFISANT_SANS_CONTRE" | "SOUTIEN_INSUFFISANT";
export interface IndicationVerdict {
  readonly indication: VerdictDd; readonly raison: RaisonVerdict; readonly conflit: boolean;
  readonly soutien: Readonly<Record<LectureSolidite, number>>;   // décomptes par lecture
  readonly contre: Readonly<Record<LectureSolidite, number>>;
}
export function indicationVerdict(assertions: readonly AssertionDeHypothese[],
  parametres?: ParametresVerdict): IndicationVerdict;
```

Règle, évaluée dans cet ordre (S, E, F = soutiens solides, étayés, fragiles ; Cs, Ce, Cf = contre
solides, étayés, fragiles) :

1. aucune assertion → `non_concluante`, `AUCUNE_ASSERTION` ;
2. `Cs ≥ 1` et `S = 0` → `infirmee`, `CONTRE_SOLIDE_SANS_SOUTIEN_SOLIDE` ;
3. `S ≥ 1` et `Cs ≥ 1` → `non_concluante`, `CONFLIT_SOLIDE`, `conflit` vrai ;
4. `Ce ≥ 1` (ici `Cs = 0`) → `non_concluante`, `CONTRE_ETAYE_OU_SOLIDE` ;
5. `S ≥ 1` et `S + E ≥ minAssertionsSoutien` → `confirmee`, `SOUTIEN_SUFFISANT_SANS_CONTRE` ;
6. sinon `non_concluante`, `SOUTIEN_INSUFFISANT`.

Les assertions « fragiles » ne comptent pour aucun verdict (elles figurent dans les décomptes). Une
assertion à contradiction non résolue ne peut pas être « solide » (le moteur des preuves divise son
indice par deux) : la prudence vient de lui, pas d'une règle ajoutée ici. Erreurs : `id` en double,
sens ou lecture inconnus, `minAssertionsSoutien` hors 1..20 → `ENTREE_INVALIDE` /
`PARAMETRE_INVALIDE`.

```ts
export interface NoeudHypothese { readonly id: string; readonly parentId: string | null;
  readonly retiree: boolean; readonly verdict: VerdictDd | null; readonly enAttente: boolean }
export type CodeIncoherenceArbre = "PARENT_CONFIRME_ENFANT_INFIRME" | "PARENT_INFIRME_TOUS_ENFANTS_CONFIRMES";
export interface ControleArbre {
  readonly total: number;                 // noeuds actifs (un descendant d'un noeud retiré est retiré)
  readonly racines: number; readonly profondeurMax: number;
  readonly parEtat: Readonly<Record<"confirmee" | "infirmee" | "non_concluante" | "ouverte" | "en_attente", number>>;
  readonly incoherences: readonly { noeud: string; code: CodeIncoherenceArbre }[];   // tri par id
}
export function controlerArbreHypotheses(noeuds: readonly NoeudHypothese[]): ControleArbre;
```

Un noeud a pour état son verdict en vigueur ; sans verdict : « en_attente » si `enAttente`, sinon
« ouverte ». Incohérences : parent « confirmee » avec au moins un enfant actif « infirmee » ; parent
« infirmee » dont tous les enfants actifs (au moins un) sont « confirmee ». Erreurs (`ARBRE_INVALIDE`) :
parent inconnu, cycle, profondeur > 4, `id` en double.

Tests (`hypotheses.test.ts`) : `indicationVerdict`, chaque ligne avec son résultat et sa raison —
(1) `[]` → non concluante, `AUCUNE_ASSERTION` ; (2) deux soutiens solides → confirmée ; (3) un soutien
solide seul → non concluante, `SOUTIEN_INSUFFISANT` ; (4) un solide + un étayé → confirmée ;
(5) un contre solide, aucun soutien solide, deux soutiens étayés → infirmée ; (6) un soutien solide +
un contre solide → non concluante, `conflit` vrai ; (7) deux soutiens solides + un contre étayé →
non concluante, `CONTRE_ETAYE_OU_SOLIDE` ; (8) trois soutiens fragiles → non concluante,
`SOUTIEN_INSUFFISANT` ; (9) deux soutiens solides + un contre fragile → confirmée (`contre.fragile` 1) ;
(10) trois étayés sans solide → non concluante ; (11) deux contre solides, aucun soutien → infirmée ;
(12) `minAssertionsSoutien` 1 et un seul soutien solide → confirmée ; erreurs. `controlerArbreHypotheses`
: racine `R` (confirmee) avec enfants `A` (confirmee) et `B` (infirmee) ; racine `C` (sans verdict,
`enAttente` vrai) ; racine `D` retirée → `total` 4, `racines` 2, `profondeurMax` 2, `parEtat` {confirmee
2, infirmee 1, non_concluante 0, ouverte 0, en_attente 1}, incohérences `[{R, PARENT_CONFIRME_ENFANT_INFIRME}]` ;
variante « parent infirmé, tous enfants confirmés » ; arbre vide ; cycle, parent inconnu, profondeur 5.

### 5.6 Signaux applicables (DD-11) — `signaux.ts`

```ts
export interface SignalBibliotheque { readonly id: string; readonly secteurCode: string | null;
  readonly paysCode: string | null; readonly famille: FamilleRisqueDd;
  readonly gravite: NiveauRisqueDd; readonly actif: boolean }
export interface ContexteSignaux { readonly secteurCodes: readonly string[];   // filière puis secteur (parents compris)
  readonly paysCodes: readonly string[] }                                       // pays puis zone
export interface SignalApplicable { readonly id: string; readonly specificite: 0 | 1 | 2;
  readonly famille: FamilleRisqueDd; readonly gravite: NiveauRisqueDd }
export function signauxApplicables(contexte: ContexteSignaux,
  signaux: readonly SignalBibliotheque[]): readonly SignalApplicable[];
```

Applicable si `actif` et (`secteurCode` nul ou dans `secteurCodes`) et (`paysCode` nul ou dans
`paysCodes`) ; `specificite` = nombre de critères non nuls ; tri : spécificité décroissante,
gravité décroissante, `id`. L'API construit `secteurCodes` et `paysCodes` depuis `taxonomie_entrees`
(`parent_code`). Test (`signaux.test.ts`) : contexte `secteurCodes ["cacao","citi_a"]`, `paysCodes
["ci","uemoa"]` ; `s1` (nul, nul, modéré), `s2` (`citi_a`, nul, élevée), `s3` (`cacao`, `ci`,
critique), `s4` (`citi_c`, nul), `s5` (nul, `uemoa`, faible), `s6` (`citi_a`, actif faux) → `[s3 (2),
s2 (1), s5 (1), s1 (0)]` ; contexte vide → seuls les signaux sans critère.

### 5.7 Exclusions et revue E&S (DD-14) — `exclusions.ts`

```ts
export function normaliserTexteDd(texte: string): string;   // NFD sans accents, minuscules, tout non alphanumérique → espace, espaces réduits
export interface RegleExclusion { readonly code: string; readonly motsCles: readonly string[];
  readonly secteurCodes: readonly string[]; readonly paysCodes: readonly string[] }   // au moins un critère
export interface DeclarationsFiltrage { readonly activites: readonly string[];
  readonly secteurCodes: readonly string[]; readonly paysCodes: readonly string[] }
export type CritereTouche = "mot_cle" | "secteur" | "pays";
export interface ToucheExclusion { readonly regle: string; readonly criteres: readonly CritereTouche[];  // ordre canonique
  readonly motsTrouves: readonly string[] }                                                              // mots-clés d'origine
export interface ResultatFiltrage { readonly touches: readonly ToucheExclusion[]; readonly nonTouchees: number }
export function filtrerExclusions(declarations: DeclarationsFiltrage,
  regles: readonly RegleExclusion[]): ResultatFiltrage;
export interface DecisionExclusion { readonly regle: string; readonly decision: "confirmee" | "ecartee";
  readonly numero: number }
export function touchesBloquantes(touches: readonly ToucheExclusion[],
  decisions: readonly DecisionExclusion[]): number;

export interface ThemeEsEntree { readonly code: string; readonly niveau: NiveauEs;
  readonly lecture: LectureSolidite | null }
export interface SyntheseEs {
  readonly niveauGlobal: NiveauEs; readonly parNiveau: Readonly<Record<NiveauEs, number>>;
  readonly manquants: readonly string[]; readonly complet: boolean;
  readonly aDocumenter: readonly string[];      // niveau eleve ou critique ET lecture fragile ou null ; tri niveau décroissant, puis code
  readonly touchesBloquantes: number; readonly bloquant: boolean;
}
export function syntheseSocioEnvironnementale(themes: readonly ThemeEsEntree[],
  touchesBloquantes: number, themesAttendus: readonly string[]): SyntheseEs;
```

Appariement d'un mot-clé : texte et mot-clé normalisés puis découpés en mots ; le mot-clé correspond si
ses mots se retrouvent **consécutifs** dans l'activité, chaque mot de l'activité **commençant par**
le mot du mot-clé (« casinos » correspond à « casino » ; faux positifs possibles, tranchés par
l'expert, jamais l'inverse). Un secteur ou un pays correspond par égalité de code avec les listes
déclarées. Une règle sans critère, un mot-clé vide après normalisation, un code de règle en double →
`ENTREE_INVALIDE`. `touchesBloquantes` : une règle touchée compte tant que sa **dernière** décision
(plus grand `numero`) n'est pas « ecartee » (absence de décision ou « confirmee » : elle bloque).
`niveauGlobal` = niveau le plus élevé (aucun thème : « non_concerne » avec `complet` faux).

Tests (`exclusions.test.ts`) : (a) règle `R1` mots-clés `["casino", "jeux d'argent"]`, activité « Exploitation d'un
CASINO en zone franche » → `[{R1, ["mot_cle"], ["casino"]}]` ; (b) activité « Organisation de jeux
d’argent en ligne » (apostrophe typographique) → touche, `motsTrouves ["jeux d'argent"]` ; (c) « Tabacologie
clinique » avec le mot-clé « tabac » → touche (préfixe, faux positif assumé) ; « Fabrication d'étiquettes »
→ aucune touche ; (d) règle `R2` secteur `citi_b` avec secteurs déclarés `["cacao","citi_a"]` → rien, avec
`["citi_b"]` → `["secteur"]` ; (e) règle à trois critères touchée par deux → `criteres` dans l'ordre
`mot_cle`, `secteur`, `pays` ; `nonTouchees` = règles − règles touchées ; (f) `touchesBloquantes` :
touches `R1, R2, R3`, décisions `R1 ecartee n°1`, `R2 confirmee n°2` puis `R2 ecartee n°3` → 1 (`R3`) ;
`R2 ecartee n°1` puis `confirmee n°2` → `R2` bloque ; (g) `syntheseSocioEnvironnementale` : thèmes `t1` faible
« etayee », `t2` élevé « fragile », `t3` critique `null`, `t4` non concerné `null`, attendus `t1…t5` →
`niveauGlobal` critique, `parNiveau` {non_concerne 1, faible 1, modere 0, eleve 1, critique 1}, `manquants
[t5]`, `complet` faux, `aDocumenter [t3, t2]`, `bloquant` faux ; avec `touchesBloquantes` 1 → `bloquant`
vrai ; (h) entrées invalides.

### 5.8 Plan des 100 jours (DD-15) — `plan-100-jours.ts`

```ts
export const DUREE_PLAN_JOURS = 100;
export type PhasePlanDd = "jours_0_30" | "jours_31_60" | "jours_61_100";     // selon `jourDebut`, PROVISOIRE
export interface ActionCentJours { readonly id: string; readonly jourDebut: number; readonly jourFin: number;
  readonly statut: StatutAction100j; readonly responsableId: string | null;
  readonly reliePlan: boolean; readonly relieKpi: boolean }
export interface EntreePlanCentJours { readonly dateOperation: DateISO | null; readonly aujourdhui: DateISO;
  readonly actions: readonly ActionCentJours[] }
export interface ActionPlanSynthese { readonly id: string; readonly phase: PhasePlanDd;
  readonly dateDebut: DateISO | null; readonly dateFin: DateISO | null; readonly enRetard: boolean }
export interface SynthesePlanCentJours {
  readonly actions: readonly ActionPlanSynthese[];                    // tri : jourDebut, puis id
  readonly parPhase: Readonly<Record<PhasePlanDd, { total: number; terminees: number }>>;
  readonly total: number; readonly terminees: number;
  readonly tauxRealisationBp: number | null;                          // terminées × 10 000 / total, arrondi ; null si total 0
  readonly enRetard: readonly string[];
  readonly jourCourant: number | null;                                // aujourdhui − dateOperation, en jours (peut être < 0 ou > 100) ; null sans date
  readonly sansResponsable: readonly string[]; readonly sansIndicateur: readonly string[]; readonly sansPlan: readonly string[];
}
export function planCentJours(entree: EntreePlanCentJours): SynthesePlanCentJours;
```

Phase : `jourDebut` 0 à 30, 31 à 60, 61 à 100. Date = `ajouterJours(dateOperation, jour)`. En retard : statut
différent de « terminee », `dateOperation` renseignée et `dateFin < aujourdhui` (strict). Erreurs :
jour hors 0..100 ou non entier, `jourDebut > jourFin`, statut inconnu, `id` en double →
`PARAMETRE_INVALIDE` / `ENTREE_INVALIDE` ; date invalide → `DATE_INVALIDE`.

Test (`plan-100-jours.test.ts`) : `dateOperation` `2026-03-01`, `aujourdhui` `2026-04-15`,
actions `A` 0–10 terminée (responsable `u1`, KPI vrai), `B` 5–30 en cours (`u1`, plan vrai), `C` 31–45 à faire
(`u1`), `D` 50–60 à faire (sans responsable), `E` 61–100 à faire (`u1`). Attendu : dates `A` 2026-03-01 →
2026-03-11, `B` 2026-03-06 → 2026-03-31, `C` 2026-04-01 → 2026-04-15, `D` 2026-04-20 → 2026-04-30, `E`
2026-05-01 → 2026-06-09 ; `jourCourant` 45 ; `enRetard` `[B]` (`C` finit le jour même : pas en retard) ;
`parPhase` {0_30 : 2 dont 1 terminée, 31_60 : 2 dont 0, 61_100 : 1 dont 0} ; `total` 5, `terminees` 1,
`tauxRealisationBp` 2 000 ; `sansResponsable [D]`, `sansIndicateur [B, C, D, E]`, `sansPlan [A, C, D, E]`.
Bornes de phase : début 30 → `jours_0_30`, 31 et 60 → `jours_31_60`, 61 → `jours_61_100`. Sans
`dateOperation` : dates nulles, aucun retard, `jourCourant` nul. Plan vide : `tauxRealisationBp` nul. Entrées invalides.

### 5.9 Contrôle de la note au comité (DD-13) — `note.ts`

```ts
export type SectionNote = "recommandation" | "synthese" | "cadrage" | "verdicts" | "analyses"
  | "chaine_valeur" | "risques" | "signaux" | "marche" | "sensibilite" | "filtrage_es"
  | "plan_100_jours" | "ajustements" | "sources";
export function sectionsDeLaNote(variante: VarianteNote): readonly SectionNote[];
  // executive : recommandation, synthese, verdicts, risques, marche, filtrage_es, plan_100_jours, ajustements
  // detaillee : recommandation, synthese, cadrage, verdicts, analyses, chaine_valeur, risques, signaux,
  //             marche, sensibilite, filtrage_es, plan_100_jours, ajustements, sources

export interface HypotheseNote { readonly id: string; readonly parentId: string | null;
  readonly retiree: boolean; readonly verdict: VerdictDd | null }   // verdict en vigueur (validé)
export interface EntreeControleNote {
  readonly recommandation: RecommandationNote; readonly nbConditions: number;
  readonly hypotheses: readonly HypotheseNote[];
  readonly anomaliesSources: number;            // assertions R2/R3 du dossier sans preuve « pour » ni avis signé (PRV-03)
  readonly exclusionsBloquantes: number;        // `touchesBloquantes`
  readonly risquesCritiquesFragiles: number;    // longueur de `aDocumenter` des risques
  readonly marche: { readonly present: boolean; readonly recoupementAlerte: boolean };
  readonly incoherencesArbre: number;
}
export type CodeBloquantNote = "SANS_HYPOTHESE" | "HYPOTHESE_SANS_VERDICT_VALIDE" | "SOURCES_MANQUANTES"
  | "EXCLUSION_NON_LEVEE_FAVORABLE" | "HYPOTHESE_INFIRMEE_FAVORABLE" | "CONDITIONS_MANQUANTES";
export type CodeAvertissementNote = "RISQUES_CRITIQUES_FRAGILES" | "AUCUN_DIMENSIONNEMENT"
  | "RECOUPEMENT_MARCHE_DIVERGENT" | "ARBRE_INCOHERENT";
export interface ControleNote { readonly bloquants: readonly CodeBloquantNote[];       // ordre de la déclaration ci-dessus
  readonly avertissements: readonly CodeAvertissementNote[]; readonly soumissible: boolean }
export function controlerNoteComite(entree: EntreeControleNote): ControleNote;
```

Règles : `SANS_HYPOTHESE` : aucune hypothèse non retirée ; `HYPOTHESE_SANS_VERDICT_VALIDE` : une hypothèse
non retirée sans verdict en vigueur ; `SOURCES_MANQUANTES` : `anomaliesSources > 0` ;
`EXCLUSION_NON_LEVEE_FAVORABLE` : `exclusionsBloquantes > 0` avec `favorable` ou
`favorable_sous_conditions` ; `HYPOTHESE_INFIRMEE_FAVORABLE` : recommandation `favorable` et une
racine non retirée « infirmee » ; `CONDITIONS_MANQUANTES` : `favorable_sous_conditions` sans condition.
Avertissements : `RISQUES_CRITIQUES_FRAGILES` (> 0), `AUCUN_DIMENSIONNEMENT` (`marche.present` faux),
`RECOUPEMENT_MARCHE_DIVERGENT` (marché présent et alerte), `ARBRE_INCOHERENT` (> 0).
`soumissible` = aucun bloquant. Compteurs négatifs ou non entiers, recommandation inconnue →
`ENTREE_INVALIDE`.

Tests (`note.test.ts`) : (1) tout conforme (`favorable`, une hypothèse `confirmee`, marché présent) →
aucun bloquant ni avertissement, `soumissible` vrai ; (2) aucune hypothèse → `[SANS_HYPOTHESE]` seul ;
(3) deux hypothèses sans verdict → `HYPOTHESE_SANS_VERDICT_VALIDE` une seule fois ; une hypothèse retirée
sans verdict est ignorée ; (4) `favorable` avec une racine `infirmee` → `HYPOTHESE_INFIRMEE_FAVORABLE` ;
`favorable_sous_conditions` avec une condition → aucun bloquant ; (5) `favorable_sous_conditions` sans
condition → `CONDITIONS_MANQUANTES` ; (6) `defavorable` avec deux exclusions → aucun bloquant ;
(7) `favorable` avec une exclusion → `EXCLUSION_NON_LEVEE_FAVORABLE` ; (8) 3 anomalies de sources →
`SOURCES_MANQUANTES` ; (9) avertissements : 2 risques critiques fragiles, marché absent, alerte de
recoupement (marché présent), 1 incohérence → les quatre codes dans l'ordre ; plusieurs bloquants à la
fois dans l'ordre déclaré ; `sectionsDeLaNote` : les deux listes ci-dessus, l'exécutive incluse dans la
détaillée ; entrées invalides.

---

## 6. Schémas partagés : `packages/shared/src/schemas/due-diligence.ts`

Un fichier de schémas (et `due-diligence.test.ts`), une ligne d'export dans
`packages/shared/src/index.ts` (« Vague 4, service #2 »). Tous les objets sont `.strict()` ; le même
schéma sert l'API et le web (CODING_STANDARDS §8). Textes : `texte(n)` de `schemas/commun.ts`
(rognés, 1 à n caractères) ; dates d'API : `dateIsoBorneeSchema` ; devises : `deviseSchema` ; codes
de taxonomie : `codeReferentielSchema` (`fondations.ts`) ; identifiants : `z.string().uuid()`.
Les champs facultatifs « nullables » valent `.nullable().default(null)`. Le fichier exporte :

- les **constantes** : `PLAFONDS_DD` (§3.3), les vocabulaires du §3.4 (`ANALYSES_DD`,
  `CATEGORIES_ANALYSE_DD`, …) avec leurs **libellés français** (`ANALYSE_DD_LIBELLES`,
  `CATEGORIE_ANALYSE_DD_LIBELLES`, `NIVEAU_RISQUE_DD_LIBELLES`, `VERDICT_DD_LIBELLES`, `THEME_ES_LIBELLES`,
  `RECOMMANDATION_NOTE_LIBELLES`, `VARIANTE_NOTE_LIBELLES`, `METHODE_DIMENSIONNEMENT_LIBELLES`,
  `PARAMETRE_DIMENSIONNEMENT_LIBELLES` : « Marché total », « Part du segment visé », …), jamais un
  identifiant affiché à l'écran ;
- les schémas de requête ci-dessous. « Affirmation » = sous-schéma `affirmationDdSchema` :
  `enonce` `texte(2000)`, `classe_risque` `R2 | R3` (R0 et R1 sont refusés : ils échapperaient au
  contrôle PRV-03), `avis_expert` booléen (défaut faux), `avis_expert_motif` `texte(1000)` nullable,
  `signer_avis` booléen (défaut faux), avec le même contrôle croisé que `assertionCreationSchema`
  (avis d'expert ⇒ motif ; signer ⇒ avis d'expert). Si ce contrôle est privé à `schemas/preuves.ts`,
  l'exporter (modification autorisée dans ce territoire).

| Schéma | Champs |
| --- | --- |
| `cadrageSchema` (= création d'un dossier) | `titre` texte(200), `secteur_code`, `filiere_code` nullable, `pays_code`, `cible_nom` texte(200) nullable, `type_operation`, `devise`, `date_operation` nullable, `question_investissement` texte(2000) nullable, `perimetre` texte(4000) nullable ; refus si `acquisition` sans `cible_nom` |
| `cadrageVersionSchema` | cadrage + `version_courante` int 1..200 + `motif` texte(500) |
| `pointCreationSchema` | `analyse`, `categorie` (valide pour l'analyse : `superRefine`), `libelle` texte(200) nullable, `niveau` nullable, + affirmation |
| `pointVersionSchema` | `version_courante`, `motif` texte(500), `categorie`, `libelle`, `niveau`, `retire` (tous facultatifs), + champs d'affirmation facultatifs ; au moins un champ à modifier (`MESSAGE_CORPS_VIDE`) |
| `etapeCreationSchema` | `libelle` texte(200), `description` texte(4000) nullable, `ordre` int 1..200, `part_cout_bp` et `part_marge_bp` int 0..10 000 nullables, `acteurs` tableau ≤ 12 de texte(120), `contraintes` texte(2000) nullable |
| `etapeVersionSchema` | champs de l'étape facultatifs + `version_courante` + `motif` + `retire` |
| `risqueCreationSchema` | `famille`, `niveau`, `libelle` texte(200), `etape_id` nullable, `signal_id` nullable, `motif_ecart` texte(1000) facultatif (exigé par l'API si `niveau` ≠ gravité du signal), + affirmation (la justification) |
| `risqueVersionSchema` | champs facultatifs + `version_courante` + `motif` + `retire` + `motif_ecart` |
| `hypotheseCreationSchema` | `libelle` texte(200), `description` texte(4000) nullable, `critere` texte(2000) nullable, `parent_id` nullable |
| `hypotheseVersionSchema` | `libelle`, `description`, `critere`, `retire` facultatifs + `version_courante` + `motif` |
| `hypotheseLienSchema` | `assertion_id`, `action` `lier | delier`, `sens` `soutient | contredit` nullable ; `sens` exigé si et seulement si `lier` |
| `hypotheseAssertionSchema` | `sens` + affirmation (crée l'assertion rattachée à l'hypothèse puis le lien) |
| `verdictProposeSchema` | `hypothese_version` int, `verdict`, `motif` texte(2000), `assertions_citees` tableau ≤ 50 d'identifiants distincts ; au moins un identifiant sauf `non_concluante` |
| `verdictValidationSchema` | `decision` `valide | rejete`, `motif` texte(1000) facultatif (exigé si `rejete`) |
| `signalContenuSchema` | `libelle` texte(200), `description` texte(2000) nullable, `famille`, `secteur_code` nullable, `pays_code` nullable, `gravite_indicative`, `question` texte(1000) nullable, `reference_publique` texte(500) nullable, `actif` booléen (défaut vrai) |
| `signalCreationSchema` | `code` + contenu ; `signalVersionSchema` : contenu + `version_courante` + `motif` |
| `signauxQuerySchema` | `famille`, `secteur_code`, `pays_code`, `actif` (booléen coercé), `q` texte(100), `limite` 1..100 (défaut 30), `curseur` |
| `signalConstatSchema` | `etat`, `commentaire` texte(1000) nullable (exigé si `ecarte`), `risque_id` nullable |
| `parametreDimensionnementSchema` | `code` (un des 8 codes des méthodes), `bas`, `base`, `haut` entiers 0..`MAX_SAFE_INTEGER` (pourcentages ≤ 10 000, `bas ≤ base ≤ haut` : `superRefine` par unité), `source` : `{ type: "preuve", preuve_id }` ou `{ type: "avis_expert", motif: texte(500), ≥ 10 }` |
| `dimensionnementCalculSchema` | `methode`, `parametres` (exactement les 4 codes de la méthode ; `source` facultative : calcul à blanc), `ajustements` tableau ≤ 10 de `{ libelle texte(120), facteur_bp int 1..20 000, motif texte(1000), ≥ 10 }` |
| `dimensionnementCreationSchema` | `methode`, `libelle` texte(200), `parametres` (source **obligatoire**), `ajustements` ; `dimensionnementVersionSchema` : idem sans `methode` + `version_courante` + `motif` |
| `regleExclusionSchema` | `code`, `libelle` texte(200), `mots_cles` ≤ 20 de texte(80), `secteur_codes` ≤ 20, `pays_codes` ≤ 20 ; au moins un critère |
| `listeExclusionCreationSchema` | `nom` texte(200), `client_id` nullable, `reference_cadre` texte(300) nullable, `regles` 1..200 (codes distincts) ; `listeExclusionVersionSchema` : `regles`, `reference_cadre`, `version_courante`, `motif` |
| `filtrageCreationSchema` | `liste_id`, `declarations` `{ activites ≤ 30 de texte(300), secteur_codes ≤ 20, pays_codes ≤ 20 }`, `themes` ≤ 8 de `{ code (THEMES_ES), niveau (NIVEAUX_ES), justification texte(1000) nullable (exigée dès « modere »), assertion_id nullable }`, codes de thème distincts |
| `filtrageDecisionSchema` | `regle_code`, `decision`, `motif` texte(1000), ≥ 10 |
| `noteContenuSchema` | `recommandation`, `synthese` texte(**4000**), `conditions` tableau ≤ 20 de texte(**300**) (plafonds du modèle de rapport, `PLAFONDS_MODELE`) |
| `noteCreationSchema` | `titre` texte(200) + contenu ; `noteVersionSchema` : contenu + `version_courante` + `motif` |
| `noteSoumissionSchema` | `version` int (la version « brouillon » à soumettre) |
| `noteValidationSchema` | `version`, `decision`, `motif` (exigé si `rejete`) |
| `planActionCreationSchema` | `libelle` texte(200), `description` texte(4000) nullable, `jour_debut`, `jour_fin` int 0..100 (`≤`), `statut_action` (défaut `a_faire`), `responsable_id`, `plan_element_id`, `kpi_id` nullables ; `planActionVersionSchema` : facultatifs + `version_courante` + `motif` + `retire` |
| `analysesQuerySchema` / `risquesQuerySchema` | `analyse` facultatif / `famille`, `etape_id`, `niveau` facultatifs |
| `rapportNoteQuerySchema` | `format` `pdf | docx`, `variante` `executive | detaillee`, `version` int facultatif (défaut : dernière version validée) |
| `noteBaseSchema` | contenu de `base_figee`, §9.2 (`.strict()`, validé à l'écriture ET à la lecture) |

Aucun schéma de requête ne porte : une indication de verdict, une solidité, un montant calculé, un
résultat de moteur ou un identifiant d'auteur (ils sortent du serveur). Un test
(`due-diligence.test.ts`) vérifie la rigueur (`.strict()` : une clé inconnue est refusée) et chaque
contrôle croisé ci-dessus.

---

## 7. Permissions et matrice par rôle (`packages/shared/src/roles.ts`)

Quatre permissions ajoutées à `PERMISSIONS` (bloc « Vague 4, service #2 », avec la règle « visibilité
de la mission TOUJOURS exigée en plus pour ce qui s'y rattache ») :

| Permission | Sens |
| --- | --- |
| `dd.lire` | lire dossiers, analyses, chaîne, risques, hypothèses et verdicts, marché, filtrages, plan, notes ; bibliothèque de signaux et listes d'exclusion ; générer et lister le rapport d'une note validée |
| `dd.ecrire` | saisir cadrage, points, étapes, risques, hypothèses, liens, propositions de verdict, constats, dimensionnements, filtrages, actions du plan, brouillons et soumission de la note |
| `dd.valider` | valider ou rejeter un verdict ; valider ou rejeter une note ; décider d'une exclusion touchée |
| `dd.referentiel.gerer` | créer et corriger les signaux de la bibliothèque et les listes d'exclusion (cabinet entier, sans mission) |

| Rôle | `dd.lire` | `dd.ecrire` | `dd.valider` | `dd.referentiel.gerer` |
| --- | :-: | :-: | :-: | :-: |
| Associé (`TOUS`) | oui | oui | oui | oui |
| Directeur de mission | oui | oui | oui | oui |
| Chef de mission | oui | oui | oui | non |
| Consultant | oui | oui | non | non |
| Expert métier | oui | non | oui | oui |
| Ressources, Gestionnaire, Expert externe | non | non | non | non |
| Dirigeant, contributeur, investisseur (portail) | non | non | non | non |

Attributions **provisoires** (§14). Raisons : ni ressources, ni gestionnaire, ni expert externe
(données du client et jugement d'expert, comme `plan.lire`) ; l'expert métier valide et maintient
les référentiels sans écrire le dossier (second regard, comme `qualite.relire`) ; le consultant
écrit mais ne valide pas. `dd.valider` n'exige pas d'être responsable de la mission (l'expert métier ne l'est pas) :
la garde est la **séparation des tâches** (ci-dessous). Tests de `roles.test.ts` : la matrice ci-dessus ; tout
détenteur de `dd.ecrire` détient `preuve.ecrire` (les routes qui créent des assertions n'exigent donc
pas un cumul que personne n'aurait) ; tout détenteur de `dd.ecrire` détient aussi `standard.lire` (le formulaire
de cadrage lit les taxonomies) ; tout détenteur de `dd.valider` ou `dd.referentiel.gerer` détient `dd.lire` ;
aucun rôle du portail n'en détient.

**Séparation des tâches** (API et base disent la même règle, même test de refus ; associé dispensé,
`est_associe_dd`) : verdict (`MPZ25`, §4.5), note (`MPZ26`, §4.9), décision sur une exclusion (`MPZ28`,
§4.7). Un associé reste lié par la règle « le verdict vient de l'indication ou est motivé » (aucune
dispense du motif).

**FIN-02** : le module ne lit ni ne sert aucun coût journalier, taux, marge, honoraire ou coût IA ;
les montants du dimensionnement sont des données de **marché** de l'opération étudiée (devise du
dossier), servies à `dd.lire`. Test négatif obligatoire (§12) : aucune réponse du module, ni
`base_figee`, ni rapport ne contient une clé de coût, taux, marge ou honoraire de la mission.

---

## 8. Routes (API, `apps/api/src/routes/due-diligence*.ts`)

### 8.0 Règles communes

- Montage sous `/api` par un agrégateur `routesDueDiligence` (`routes/due-diligence.ts`, qui
  enregistre `due-diligence-hypotheses.ts`, `-marche.ts`, `-notes.ts`, `-referentiel.ts`) ajouté à
  `app.ts` ; R52 et R53 vivent dans `routes/rapports.ts` (§9). Chaque gestionnaire appelle
  `exiger(request, permission)` **avant** tout accès aux données, valide l'entrée par un schéma du §6,
  ouvre `app.db.withTenant`, résout la ressource jusqu'à sa **mission**, puis délègue à
  `apps/api/src/due-diligence/*` dans la transaction reçue.
- Lecture : `exigerMissionLisible` (`preuves/acces.ts`) ; écriture : `exigerMissionEcrivable` (mission
  visible, **verrouillée** `FOR UPDATE`, non clôturée : 409 `MISSION_CLOTUREE`). Ressource d'un autre
  cabinet, d'une mission invisible ou inexistante : **404** identique. Les routes qui touchent le
  registre des preuves (R02, R08, R14, R20, ainsi que R09, R15 quand elles corrigent une assertion)
  exigent **aussi** `preuve.ecrire`.
- Toute route `…/versions` exige `version_courante` égale à la version lue (409 `VERSION_PERIMEE`
  sinon : pas d'écrasement silencieux) ; le verrou de la mission sérialise les écritures.
- Erreurs : `AppError` seulement, enveloppe unique d'`app.ts`, jamais 500 pour une règle métier
  (`traduireErreurDueDiligence` : `MPZ21`–`MPZ32`, 23505, 23503, 23514, `ErreurDueDiligence` du moteur
  → 400, jamais le message technique). Codes communs : 400 `REQUETE_INVALIDE`, 401 `NON_AUTHENTIFIE`,
  403 `INTERDIT`, 404 `INTROUVABLE`, 409 `MISSION_CLOTUREE`, `PLAFOND_ATTEINT`, `VERSION_PERIMEE`,
  `CONFLIT`. Seuls les codes propres à une route sont donnés ci-dessous.
- Réponses en `snake_case` ; **jamais** de clé de stockage, d'identifiant de session ni de verbatim
  nominatif (un extrait de preuve ne sort que par les routes du registre, avec leur masquage).
- Journalisation (`journaliser`, même transaction) : actions `dd_dossier_cree`, `dd_cadrage_modifie`,
  `dd_point_cree`, `dd_point_modifie`, `dd_etape_creee`, `dd_etape_modifiee`, `dd_risque_cree`,
  `dd_risque_modifie`, `dd_hypothese_creee`, `dd_hypothese_modifiee`, `dd_lien_modifie`,
  `dd_verdict_propose`, `dd_verdict_valide`, `dd_verdict_rejete`, `dd_signal_cree`, `dd_signal_modifie`,
  `dd_constat_signal`, `dd_dimensionnement_cree`, `dd_dimensionnement_modifie`, `dd_liste_creee`,
  `dd_liste_modifiee`, `dd_filtrage_cree`, `dd_exclusion_decidee`, `dd_action_creee`, `dd_action_modifiee`,
  `dd_note_creee`, `dd_note_modifiee`, `dd_note_soumise`, `dd_note_validee`, `dd_note_rejetee` ; `details` :
  identifiants, numéros de version, valeurs d'énumération, **jamais** un énoncé, un motif ni un
  extrait.
- Pagination : curseur opaque (`encoderCurseur`/`paginer`, `http/outils.ts`), `limite` 1..100 (défaut
  30), `LIMIT $n` paramétré, **seulement** pour R24, R35 et R53 ; les autres listes sont bornées par
  les plafonds du §3.3 (lecture `LIMIT cap + 1` paramétré, 409 à la création au-delà : aucune
  troncature silencieuse). Le web boucle avec `limiteMax: 100` pour R24 et R35.
- Débit : aucun plafond de débit nouveau (R34 ne touche pas la base et son entrée est bornée) ;
  la génération de rapport garde le plafond existant (10 par utilisateur sur 10 minutes, 429
  `TROP_DE_RAPPORTS`).
- État courant d'un élément : `DISTINCT ON (element_id) … ORDER BY element_id, version DESC` (index
  `(cabinet_id, element_id, version DESC)`) ; aucun `SUM`, `AVG`, `Math.*` dans `due-diligence/`.

### 8.1 Dossiers et cadrage (DD-01)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R01 | `GET /missions/:id/dd/dossiers` | `dd.lire` | — | 200 `{ elements: [{ id, numero, titre, secteur_code, pays_code, cible_nom, type_operation, devise, date_operation, version_cadrage, cree_par, cree_le }] }` | — |
| R02 | `POST /missions/:id/dd/dossiers` | `dd.ecrire` + `preuve.ecrire` | `cadrageSchema` | 201 `{ id, version: 1 }` ; crée les 22 dimensions `dd.*` du registre | 400 `TAXONOMIE_INCONNUE` (code absent de la taxonomie ou filière hors secteur) ; 409 `PLAFOND_ATTEINT` (10) |
| R03 | `GET /dd/dossiers/:id` | `dd.lire` | — | 200 dossier + cadrage courant + libellés `secteur_libelle`, `filiere_libelle`, `pays_libelle` (taxonomie) + `mission { id, intitule, statut }` | — |
| R04 | `GET /dd/dossiers/:id/synthese` | `dd.lire` | — | 200 synthèse calculée par les moteurs : compteurs par type, `sources` (assertions solides / étayées / fragiles par `evaluerAssertions`, `anomalies_prv03` par `detecterAssertionsSansPreuve`), arbre (`controlerArbreHypotheses`), `risques` (`syntheseRisquesDd`), `marche` (dernier résultat de chaque dimensionnement + `recouperDimensionnements`), `filtrage_es` (`syntheseSocioEnvironnementale`), `plan_100j` (`planCentJours`), `signaux` (applicables, constatés, à vérifier), `note` (dernière version, état), `ajustements` (nombre), `controle_note` (`controlerNoteComite` à blanc) | — |
| R05 | `POST /dd/dossiers/:id/cadrage` | `dd.ecrire` | `cadrageVersionSchema` | 201 `{ version }` | 400 `TAXONOMIE_INCONNUE` |
| R06 | `GET /dd/dossiers/:id/cadrage/versions` | `dd.lire` | — | 200 `{ elements: [versions] }` (≤ 200) | — |

### 8.2 Analyses, chaîne de valeur, risques (DD-03 à DD-06)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R07 | `GET /dd/dossiers/:id/analyses` | `dd.lire` | `analysesQuerySchema` | 200 `{ analyses: [{ analyse, categories: [{ categorie, points: [{ id, assertion_id, version, libelle, enonce, niveau, avis_expert, solidite (SoliditeVue), nb_pour, nb_contre, a_arbitrer }] }] }], couverture: { points, solides, etayes, fragiles } }` ; points retirés exclus | — |
| R08 | `POST /dd/dossiers/:id/points` | `dd.ecrire` + `preuve.ecrire` | `pointCreationSchema` | 201 `{ id, assertion_id, version: 1 }` ; crée l'assertion (`creerAssertion`, rattachement `dimension` = `dd.<analyse>.<categorie>`, `livrable` §2.1, statut `retenue`), l'élément et sa version 1 | 403 `INTERDIT` (signer un avis d'expert sans habilitation) ; 409 `PLAFOND_ATTEINT` |
| R09 | `POST /dd/points/:id/versions` | `dd.ecrire` (+ `preuve.ecrire` si l'affirmation change) | `pointVersionSchema` | 201 `{ version, assertion_version }` ; l'énoncé corrigé = `corrigerAssertion` ; `retire` vrai = assertion `abandonnee`, rétablir = `retenue` | 409 `CLASSE_RISQUE_ABAISSEE` (comme le registre) |
| R10 | `GET /dd/dossiers/:id/chaine` | `dd.lire` | — | 200 `{ etapes: [{ id, version, libelle, description, ordre, part_cout_bp, part_marge_bp, part_cout_affichee, part_marge_affichee, acteurs, contraintes, rang_marge, risques: [{ id, libelle, famille, niveau, lecture }] }], synthese }` (`syntheseChaineDeValeur` ; parts affichées par `formaterPointsDeBase`) | — |
| R11 | `POST /dd/dossiers/:id/chaine/etapes` | `dd.ecrire` | `etapeCreationSchema` | 201 `{ id, version: 1 }` | 409 `PLAFOND_ATTEINT` (30) |
| R12 | `POST /dd/etapes/:id/versions` | `dd.ecrire` | `etapeVersionSchema` | 201 `{ version }` | — |
| R13 | `GET /dd/dossiers/:id/risques` | `dd.lire` | `risquesQuerySchema` | 200 `{ risques: [{ id, assertion_id, version, libelle, famille, niveau, etape_id, signal_id, enonce, solidite, a_arbitrer }], synthese: SyntheseRisquesDd }` | — |
| R14 | `POST /dd/dossiers/:id/risques` | `dd.ecrire` + `preuve.ecrire` | `risqueCreationSchema` | 201 `{ id, assertion_id, version: 1 }` ; l'identifiant de l'élément est tiré côté serveur AVANT l'assertion (rattachement `risque`, code = cet identifiant) | 400 `MOTIF_ECART_REQUIS` (niveau ≠ gravité du signal, sans `motif_ecart` ; crée alors un ajustement) ; 400 `LIEN_INCOHERENT` (étape ou signal inconnu) ; 409 `PLAFOND_ATTEINT` (200) |
| R15 | `POST /dd/risques/:id/versions` | `dd.ecrire` (+ `preuve.ecrire`) | `risqueVersionSchema` | 201 `{ version }` | 400 `MOTIF_ECART_REQUIS` |

### 8.3 Hypothèses et verdicts (DD-09)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R16 | `GET /dd/dossiers/:id/hypotheses` | `dd.lire` | — | 200 `{ noeuds: [{ id, parent_id, version, libelle, description, critere, liens: [{ assertion_id, sens, enonce, solidite, analyse_point: { analyse, categorie } \| null }], indication: IndicationVerdict, verdict_en_vigueur, verdict_en_attente, etat }], arbre: ControleArbre }` | — |
| R17 | `POST /dd/dossiers/:id/hypotheses` | `dd.ecrire` | `hypotheseCreationSchema` | 201 `{ id, version: 1 }` | 400 `ARBRE_TROP_PROFOND` (profondeur > 4, contrôlée avant l'insertion ; doublée par `MPZ22`) ; 409 `PLAFOND_ATTEINT` (100) |
| R18 | `POST /dd/hypotheses/:id/versions` | `dd.ecrire` | `hypotheseVersionSchema` | 201 `{ version }` | 409 `VERDICT_EN_ATTENTE` (retirer une hypothèse dont un verdict attend une décision) |
| R19 | `POST /dd/hypotheses/:id/liens` | `dd.ecrire` | `hypotheseLienSchema` | 201 `{ ok: true }` | 409 `ASSERTION_ABANDONNEE` ; 400 `RATTACHEMENT_INCOHERENT` (assertion d'une autre mission, délien d'un lien absent) |
| R20 | `POST /dd/hypotheses/:id/assertions` | `dd.ecrire` + `preuve.ecrire` | `hypotheseAssertionSchema` | 201 `{ assertion_id, version: 1 }` ; assertion rattachée `hypothese` (code = identifiant de l'élément) puis lien | 409 `PLAFOND_ATTEINT` |
| R21 | `POST /dd/hypotheses/:id/verdicts` | `dd.ecrire` | `verdictProposeSchema` | 201 `{ id, indication_moteur, ecart_indication }` ; l'API recalcule `indicationVerdict` sur TOUTES les assertions liées, fige la photographie des citées (solidité par `evaluerAssertions`) et crée l'ajustement si `verdict` ≠ indication | 409 `VERDICT_EN_ATTENTE` (`MPZ32`) ; 409 `VERDICT_SANS_SOURCE` (`MPZ24` : citation absente, non liée, mauvais sens) ; 409 `VERSION_PERIMEE` (`hypothese_version`) ; 400 `MOTIF_DETAILLE_REQUIS` (écart ≥ 20 caractères) ; 409 `PLAFOND_ATTEINT` (50) |
| R22 | `GET /dd/hypotheses/:id/verdicts` | `dd.lire` | — | 200 `{ elements: [{ id, numero, verdict, indication_moteur, motif, assertions_citees, proposee_par, proposee_le, decision: { decision, motif, valide_par, valide_le } \| null }] }` | — |
| R23 | `POST /dd/verdicts/:id/validation` | `dd.valider` | `verdictValidationSchema` | 201 `{ ok: true }` | 403 `SEPARATION_DES_TACHES` (`MPZ25`, API d'abord puis base) ; 409 `VERDICT_PERIME` (`MPZ27`) ; 409 `VERDICT_DEJA_DECIDE` (unicité de `verdict_id`) |

### 8.4 Bibliothèque de signaux (DD-11)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R24 | `GET /dd/signaux` | `dd.lire` | `signauxQuerySchema` | 200 page `{ elements: [{ id, code, version, libelle, description, famille, secteur_code, pays_code, gravite_indicative, question, reference_publique, actif }], curseur_suivant }` | — |
| R25 | `POST /dd/signaux` | `dd.referentiel.gerer` | `signalCreationSchema` | 201 `{ id, version: 1 }` | 409 `SIGNAL_EXISTANT` (code unique par cabinet) ; 409 `PLAFOND_ATTEINT` (2 000) ; 400 `TAXONOMIE_INCONNUE` |
| R26 | `POST /dd/signaux/:id/versions` | `dd.referentiel.gerer` | `signalVersionSchema` | 201 `{ version }` | — |
| R27 | `GET /dd/signaux/:id/versions` | `dd.lire` | — | 200 `{ elements }` (≤ 200) | — |
| R28 | `GET /dd/dossiers/:id/signaux` | `dd.lire` | — | 200 `{ elements: [{ signal_id, version, libelle, famille, gravite_indicative, question, reference_publique, specificite, etat_constat \| null, risque_id \| null }] }` : signaux actifs retenus par `signauxApplicables` (secteur : filière puis secteur ; pays : pays puis zone, lus dans `taxonomie_entrees`) | — |
| R29 | `POST /dd/dossiers/:id/signaux/:signalId/constats` | `dd.ecrire` | `signalConstatSchema` | 201 `{ ok: true }` | 404 (signal absent ou non applicable) ; 400 `LIEN_INCOHERENT` (risque d'un autre dossier) ; 409 `PLAFOND_ATTEINT` (2 000) |

### 8.5 Dimensionnement de marché (DD-12)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R30 | `GET /dd/dossiers/:id/dimensionnements` | `dd.lire` | — | 200 `{ elements: [{ id, methode, version, libelle, parametres, ajustements, resultat (figé), couverture }], recoupement: RecoupementDd \| null }` ; `recoupement` seulement si une méthode de chaque sorte existe | — |
| R31 | `POST /dd/dossiers/:id/dimensionnements` | `dd.ecrire` | `dimensionnementCreationSchema` | 201 `{ id, version: 1, resultat }` ; vérifie que chaque `preuve_id` appartient à la mission, exécute `dimensionnerMarche`, stocke le résultat figé, écrit un ajustement par ajustement appliqué (§4.8) | 400 `PARAMETRE_SANS_SOURCE` (`MPZ31`) ; 400 `DIMENSIONNEMENT_INVALIDE` (`PARAMETRE_*`, `BORNES_INCOHERENTES`) ; 400 `DEPASSEMENT` ; 409 `PLAFOND_ATTEINT` (20) |
| R32 | `POST /dd/dimensionnements/:id/versions` | `dd.ecrire` | `dimensionnementVersionSchema` | 201 `{ version, resultat }` | mêmes erreurs |
| R33 | `GET /dd/dimensionnements/:id/versions` | `dd.lire` | — | 200 `{ elements }` (≤ 200) | — |
| R34 | `POST /dd/dimensionnements/calculer` | `dd.lire` | `dimensionnementCalculSchema` | 200 résultat du moteur (`etages`, `resultat`, `ajustements_appliques`, `sensibilite`, `couverture`) **sans écriture** (aperçu de saisie ; sources facultatives, signalées dans `couverture.absente`) | 400 `DIMENSIONNEMENT_INVALIDE`, `DEPASSEMENT` |

### 8.6 Filtrage environnemental et social (DD-14)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R35 | `GET /dd/listes-exclusion` | `dd.lire` | `limite`, `curseur`, `client_id` facultatif | 200 page de listes (version courante, nombre de règles, client) | — |
| R36 | `POST /dd/listes-exclusion` | `dd.referentiel.gerer` | `listeExclusionCreationSchema` | 201 `{ id, version: 1 }` | 409 `LISTE_EXISTANTE` (nom) ; 409 `PLAFOND_ATTEINT` (50) ; 400 `LIEN_INCOHERENT` (client inconnu) |
| R37 | `POST /dd/listes-exclusion/:id/versions` | `dd.referentiel.gerer` | `listeExclusionVersionSchema` | 201 `{ version }` | — |
| R38 | `GET /dd/listes-exclusion/:id/versions` | `dd.lire` | — | 200 `{ elements }` (règles comprises) | — |
| R39 | `GET /dd/dossiers/:id/filtrages` | `dd.lire` | — | 200 `{ elements: [{ id, numero, liste_version, declarations, themes, touches: [{ regle, libelle, criteres, mots_trouves, decision \| null, decideur, decide_le }], non_touchees, auteur_id, cree_le }], synthese: SyntheseEs \| null }` ; la synthèse est recalculée à chaque lecture depuis le DERNIER filtrage et ses décisions | — |
| R40 | `POST /dd/dossiers/:id/filtrages` | `dd.ecrire` | `filtrageCreationSchema` | 201 `{ id, touches, non_touchees }` ; version courante de la liste, `filtrerExclusions` | 409 `PLAFOND_ATTEINT` (50) ; 400 `LIEN_INCOHERENT` (liste ou assertion d'un thème d'une autre mission) |
| R41 | `POST /dd/filtrages/:id/decisions` | `dd.valider` | `filtrageDecisionSchema` | 201 `{ ok: true }` | 403 `SEPARATION_DES_TACHES` (`MPZ28`) ; 400 `RATTACHEMENT_INCOHERENT` (règle absente des touches) |

### 8.7 Ajustements et plan des 100 jours (DD-08, DD-15)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R42 | `GET /dd/dossiers/:id/ajustements` | `dd.lire` | — | 200 `{ elements: [{ id, numero, cible_type, cible_id, champ, valeur_avant, valeur_apres, motif, auteur_id, cree_le }] }` (≤ 1 000, du plus récent) | — |
| R43 | `GET /dd/dossiers/:id/plan-100j` | `dd.lire` | — | 200 `{ date_operation, actions: [{ id, version, libelle, description, jour_debut, jour_fin, date_debut, date_fin, phase, statut_action, en_retard, responsable { id, nom } \| null, plan_element \| null, kpi \| null }], synthese: SynthesePlanCentJours }` ; un lien vers un plan ou un KPI n'est **résolu** (libellé) que si l'appelant a `plan.lire` / `kpi.lire` ET voit la mission cible, sinon `{ id: null, masque: true }` (aucune fuite de titre) | — |
| R44 | `POST /dd/dossiers/:id/plan-100j/actions` | `dd.ecrire` | `planActionCreationSchema` | 201 `{ id, version: 1 }` | 400 `LIEN_INCOHERENT` (`MPZ30`) ; 409 `PLAFOND_ATTEINT` (200) |
| R45 | `POST /dd/actions/:id/versions` | `dd.ecrire` | `planActionVersionSchema` | 201 `{ version }` | 400 `LIEN_INCOHERENT` |

### 8.8 Note au comité (DD-13)

| # | Méthode et chemin | Permission | Corps / requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R46 | `GET /dd/dossiers/:id/notes` | `dd.lire` | — | 200 `{ elements: [{ id, titre, derniere_version, etat, validee_version, cree_le }] }` (≤ 10) ; `etat` ∈ `brouillon`, `soumise` (en attente), `validee`, `rejetee` | — |
| R47 | `POST /dd/dossiers/:id/notes` | `dd.ecrire` | `noteCreationSchema` | 201 `{ id, version: 1 }` (brouillon) | 409 `PLAFOND_ATTEINT` (10) |
| R48 | `GET /dd/notes/:id` | `dd.lire` | `?version=n` facultatif | 200 note, liste des versions (métadonnées), contenu de la version demandée (défaut : dernière), validations, `controle` : `controlerNoteComite` à blanc pour un brouillon, **figé** pour une version soumise ; `base_figee` seulement avec `?version=n` d'une version soumise | — |
| R49 | `POST /dd/notes/:id/versions` | `dd.ecrire` | `noteVersionSchema` | 201 `{ version }` (nouveau brouillon) | — |
| R50 | `POST /dd/notes/:id/soumission` | `dd.ecrire` | `noteSoumissionSchema` | 201 `{ version }` ; l'API charge l'état du dossier, exécute les moteurs, construit `base_figee` (§9.2), refuse s'il y a un bloquant, insère une version `soumise` (copie du brouillon + base) | 409 `NOTE_BLOQUEE` (`details.manquants` = codes bloquants, `MPZ29`) ; 409 `NOTE_TROP_VOLUMINEUSE` ; 409 `VERSION_PERIMEE` (le brouillon n'est plus le dernier) |
| R51 | `POST /dd/notes/:id/validation` | `dd.valider` | `noteValidationSchema` | 201 `{ ok: true }` | 403 `SEPARATION_DES_TACHES` (`MPZ26`) ; 409 `NOTE_PERIMEE` (`MPZ27` : plus la dernière soumise) ; 409 `NOTE_DEJA_DECIDEE` |

### 8.9 Rapport de la note (§9)

| # | Méthode et chemin | Permission | Requête | Réponse | Erreurs propres |
| --- | --- | --- | --- | --- | --- |
| R52 | `POST /dd/notes/:id/rapports?format=&variante=[&version=]` | `mission.lire` + `dd.lire` | `rapportNoteQuerySchema` | 201 `{ rapport, fichier }` (même enveloppe que les autres rapports) | 409 `NOTE_NON_VALIDEE` (aucune version validée, ou `MPR04`) ; 409 `MISSION_CLOTUREE` ; 429 `TROP_DE_RAPPORTS` |
| R53 | `GET /dd/notes/:id/rapports` | `mission.lire` + `dd.lire` | `limite`, `curseur` | 200 page des rapports de cette note (niveaux lisibles seulement) | — |

### 8.10 Total et recherche mécanique n° 10

53 routes (R01 à R53), **toutes** derrière `exiger` : la recherche n° 10 de la check-list passe de
« 677 8 » à « 730 8 » (les 8 sans `exiger` sont inchangées). Aucune route n'est ajoutée à
`LISTE_BLANCHE_PORTAIL` ; `test/portail-acces.test.ts` (inventaire) reste vert sans modification.

### 8.11 Services d'API (`apps/api/src/due-diligence/`, territoire T2)

`acces.ts` (dossier et éléments accessibles, `exigerAussi`, séparation des tâches côté API),
`erreurs.ts`, `dossiers.ts`, `dimensions-registre.ts` (`assurerDimensionsDd`), `elements.ts`
(lecture de l'état courant et écritures de versions), `analyses.ts`, `chaine.ts`, `risques.ts`,
`hypotheses.ts`, `verdicts.ts`, `signaux.ts`, `dimensionnement.ts`, `filtrage.ts`, `ajustements.ts`,
`plan-100-jours.ts`, `notes.ts`, `base-note.ts` (§9.2), `synthese.ts`, `donnees-ouvertes.ts`. Aucune
fonction ne commence sa propre transaction. Les lectures de solidité passent par
`preuves/evaluation.ts` ; les écritures d'assertions par `preuves/ecriture.ts`
(`creerAssertion`, `corrigerAssertion`) ; aucun `INSERT` direct dans `assertions`,
`assertion_versions` ni `assertion_preuve_liens`.

### 8.12 DD-02 : interface et adaptateur simulé (OUVERT)

*État au 2026-10-22 : ce paragraphe ne concerne que les connecteurs de données ouvertes, qui restent simulés (aucune
route, aucun réseau, inchangé par le lot 6). L'import de rapports PDF de DD-02 est livré à part (§8.13).*

`apps/api/src/due-diligence/donnees-ouvertes.ts` exporte `interface FournisseurDonneesOuvertes {
readonly identifiant: string; rechercherIndicateur(paysCode: string, indicateur: string):
Promise<readonly PointDonnee[]>; }` avec `PointDonnee { annee, valeur: number (entier, unités
précisées), unite, source: string, simule: boolean }`, et `fournisseurSimule` : valeurs **fictives**,
`simule: true`, `source` « Données simulées : aucun connecteur réel ». **Aucun import** dans les
routes, aucune variable de configuration, aucun appel réseau (`fetch`, `http`, `undici` interdits :
recherche mécanique §13). Un test unitaire fixe le contrat (`simule` toujours vrai, aucune valeur
n'est présentable comme une preuve : le type n'est assignable ni à `preuveCreationSchema` ni à un
paramètre de dimensionnement). La mise en œuvre réelle est un lot ultérieur (§16).

### 8.13 DD-02 (rapports PDF) et DD-10 (salle de données) : ingestion de documents (livré le 2026-10-22, lot 6)

*Ajout d'état de livraison ; le périmètre de fond est celui du §1. Décision : ADR-009 (Acceptée). Sécurité :
`docs/governance/SECURITY.md` §8 undecies. Notes du lot : `docs/workflows/notes-lots/lot-6.md`.*

- **Routes** (`apps/api/src/routes/ingestion-dd.ts`, 7 routes) : `POST /dd/dossiers/:id/documents?type=rapport|salle`
  (`dd.ecrire`, téléversement PDF, 202), `POST /dd/documents/:docId/lecture` (relance ; `ia.utiliser` en plus),
  `PATCH /dd/extractions/:id` (`dd.ecrire`, correction du brouillon), trois `GET` (liste, document, pages ; `dd.lire`),
  `POST /dd/extractions/:id/decision` (`dd.valider`). Structuration : `apps/api/src/ingestion/structuration-dd.ts`
  (usages `dd_rapport` et `dd_salle`) ; nature de la lecture : `apps/api/src/ingestion/nature-lecture.ts`.
- **Lecture IA** : résumé et éléments ; chaque élément porte sa page et un extrait vérifié dans le texte de cette
  page, sinon il est signalé « non retrouvé » et doit être acquitté. Les chiffres ne viennent pas du modèle.
  Brouillon IA, modifié, validé : statut et historique conservés.
- **Validation** : `dd.valider`, par une personne autre que le dernier modificateur, le demandeur de la lecture et
  l'auteur du téléversement, sauf associé (`MQG02`, doublée en base). Elle ne crée ni assertion, ni preuve, ni
  donnée de dimensionnement : un expert reprend ensuite ce qu'il juge utile par les routes existantes.
- **Écran** : onglet « Documents » du dossier, pages
  `apps/web/src/app/(app)/missions/[id]/due-diligence/[dossierId]/documents` et `.../documents/[docId]`.
- **Limites assumées** : mode texte natif seulement, un PDF scanné répond `PDF_SANS_TEXTE` tant que l'OCR local
  (lot 11) n'est pas livré ; plafonds `PLAFONDS_INGESTION` (PDF 10 Mo, 60 pages, 5 documents en traitement par
  cabinet) ; les noms du cabinet ne sont PAS masqués avant l'envoi pour `dd_rapport` et `dd_salle` (seul
  `standard_historique` l'est) ; téléversement DD en trois transactions (dette M7 du lot 6) ; texte des pages conservé
  puis purgé (SECURITY.md §8 undecies). Aucun test dans un navigateur.

---

## 9. Note au comité : base figée et rapport

### 9.1 Extension du moteur de rapports (`0508`, `apps/api/src/rapports/`)

Migration `0508_dd_rapport_note_comite.sql` (modèle `0424`, numéro plus grand que `0507` qui crée
`dd_notes`) :

```sql
ALTER TABLE rapports_mission
  ADD COLUMN dd_note_id uuid,
  ADD COLUMN variante text CHECK (variante IS NULL OR variante IN ('executive', 'detaillee')),
  ADD CONSTRAINT rapports_mission_dd_note_fk
    FOREIGN KEY (cabinet_id, dd_note_id) REFERENCES dd_notes (cabinet_id, id),
  DROP CONSTRAINT rapports_mission_modele_check,
  ADD CONSTRAINT rapports_mission_modele_check
    CHECK (modele IN (/* valeurs en vigueur */, 'note_comite')),
  DROP CONSTRAINT rapports_mission_niveau_check,
  ADD CONSTRAINT rapports_mission_niveau_check
    CHECK (niveau IN (/* valeurs en vigueur */, 'dd')),
  DROP CONSTRAINT rapports_mission_source_check,
  ADD CONSTRAINT rapports_mission_source_check CHECK ( /* branches en vigueur, chacune complétée par
    AND dd_note_id IS NULL AND variante IS NULL */
    OR (modele = 'note_comite' AND dd_note_id IS NOT NULL AND version_source IS NOT NULL
        AND variante IS NOT NULL AND notation_id IS NULL AND plan_id IS NULL AND niveau = 'dd'));
CREATE INDEX rapports_mission_dd_note_idx ON rapports_mission (cabinet_id, dd_note_id, genere_le)
  WHERE dd_note_id IS NOT NULL;
-- CREATE OR REPLACE FUNCTION controler_source_rapport() : reprend le corps en vigueur et ajoute
--   (a) dd_note_id → note du dossier d'une dd_dossiers de la MÊME mission que le rapport (MPR01) ;
--   (b) modele = 'note_comite' → il existe dd_note_validations decision = 'valide' pour la version
--       `version_source` de cette note (MPR04).
```

« Valeurs en vigueur » : relire les contraintes réelles dans l'**état le plus récent** des migrations
au moment de l'écriture (au 2026-10-11, `0424` : modèles `etat_avancement`, `notation`,
`plan_strategique`, `dossier_bancaire` ; niveaux `base`, `jours`, `finance`, `notation`, `plan`) et y
ajouter, **sans en retirer aucune** (voir §17 : un autre lot qui ajoutera un modèle de rapport devra reprendre la réunion). Aucune colonne
vers `fichiers` : `fichier_orphelin` est inchangée.

Code touché (modifications minimales de fichiers partagés, §11) : `rapports/enregistrement.ts`
(`MODELES_RAPPORT`, `NOMS_FICHIER.note_comite = "Note au comite"`, `LIBELLES_SUIVI.note_comite = "Note au
comité"`, `COLONNES_RAPPORT` + `r.dd_note_id, r.variante`, `SourceRapport { noteId?, variante? }`,
`insererRapport`, détails du journal, `MPR04` → 409) ; `rapports/niveaux.ts` (`NIVEAUX_SERVICE` + `"dd"`,
`PERMISSIONS_NIVEAU.dd = ["dd.lire"]`) ; `rapports/liste.ts` (`FiltreRapports` + `{ noteId }`,
colonne `r.dd_note_id`, champs `dd_note_id` et `variante` dans la sortie) ; `routes/rapports.ts` (R52,
R53, commentaire d'en-tête) ; nouveau `rapports/note-comite.ts` (`rapportNoteComite(db, auth, noteId,
version, variante, date)` : lit `base_figee` de la version validée et produit le `Rapport` du modèle de
contenu, sans calcul). Le rapport est enregistré avec `statut: "valide"` (la note l'est), `niveau:
"dd"`, `confidentiel: true`, `emetteur` = cabinet (`lireEnteteMission`). Il suit la conservation et la
purge des rapports (`rapports/purge.ts`), le débit de génération et le suivi qualité
(`brancherRapport` : classe R2 minimale ; passer la note en R3 est un point ouvert, §16).

### 9.2 `base_figee` : construction (`due-diligence/base-note.ts`) et contenu

Construite **par le serveur** à la soumission (R50), depuis les moteurs, dans la transaction de la
route, mission verrouillée ; jamais reçue du client. Objet `noteBaseSchema` (`.strict()`, validé avant
l'insertion et à la lecture par le rendu) :

| Clé | Contenu |
| --- | --- |
| `version_base` | 1 |
| `genere_le` | date AAAA-MM-JJ |
| `cadrage` | titre, `secteur_code`/`secteur_libelle`, `filiere_*`, `pays_code`/`pays_libelle`, `cible_nom`, `type_operation`, `devise`, `date_operation`, `question_investissement`, `perimetre` (libellés de taxonomie résolus et figés) |
| `hypotheses` | `[{ id, parent_id, libelle, critere, verdict, indication_moteur, nb_citees, solidite_min }]` (verdicts **validés** seulement ; `solidite_min` = la plus faible lecture des assertions citées) |
| `risques` | `[{ id, famille, niveau, libelle, etape, lecture }]` |
| `marche` | `{ present, dimensionnements: [{ methode, libelle, resultat, avant_ajustement, couverture }], recoupement }` (montants en unités mineures de la devise) |
| `filtrage_es` | `{ realise, niveau_global, bloquant, touches: [{ regle, libelle, decision }], themes: [{ code, niveau, justification }] }` |
| `plan_100j` | `{ present, total, terminees, par_phase, actions: [{ libelle, jour_debut, jour_fin, statut, date_debut, date_fin }] }` |
| `ajustements` | `[{ cible_type, champ, avant, apres, motif, cree_le }]` |
| `sources` | `{ assertions: { solides, etayees, fragiles }, anomalies }` |
| `detail` | `{ analyses: [{ analyse, categorie, enonce, niveau, lecture, renvois: [n] }], chaine: […], signaux: [{ libelle, famille, gravite, etat }], sensibilite: […], sources: [{ n, type, source, date, fiabilite, extrait \| null, masque }] }` — le détail du rendu « détaillée », figé avec le reste |
| `bloquants`, `avertissements` | listes de codes du moteur `controlerNoteComite` |
| `exclusions_bloquantes` | entier (`touchesBloquantes`) |

Les extraits de preuve et sources du `detail.sources` sont ceux de `vuePreuve(…, false)` : un
verbatim nominatif sans accord y est **masqué pour tous** (comme l'annexe de `rapports/sources.ts`) ;
aucun nom de collaborateur n'y figure. Toute valeur numérique vient d'un moteur ; l'API ne fait que
copier et formater (`montantAffiche`, `formaterPointsDeBase`, `jours`).

### 9.3 Contenu du rapport (`rapports/note-comite.ts`)

Sections tirées de `sectionsDeLaNote(variante)` (§5.9), dans cet ordre, depuis **la même** base :

| Section | Exécutive | Détaillée |
| --- | --- | --- |
| Recommandation | libellé de la recommandation, conditions (liste) | idem |
| Synthèse | texte de l'expert | idem |
| Cadrage | — | secteur, pays, cible, type d'opération, question, périmètre |
| Verdicts | tableau hypothèse → verdict → solidité minimale | idem + indication du moteur, critère, nombre de sources citées |
| Analyses | — | un tableau par analyse (catégorie, affirmation, importance, solidité, renvois) |
| Chaîne de valeur | — | tableau des étapes (parts de coût et de marge, rang) |
| Risques | risques de niveau élevé ou critique | tous, par famille |
| Signaux | — | signaux constatés, écartés, à vérifier |
| Marché | blocs `indicateurs` : fourchette (bas, base, haut) et recoupement | idem + paramètres et sources |
| Sensibilité | — | tableau des paramètres par amplitude |
| Filtrage E&S | niveau global, exclusions, thèmes à documenter | tous les thèmes et leur justification |
| Plan des 100 jours | synthèse par phase et taux de réalisation | tableau des actions avec dates |
| Ajustements | nombre et motifs | liste complète |
| Sources | — | annexe numérotée (type, source, date, fiabilité, extrait masqué selon `vuePreuve`) |

Les **chiffres** (fourchettes, taux, comptes) sont placés dans des blocs `indicateurs`, de sorte que
le suivi qualité les liste comme chiffres « moteur » (`qualite/branchements.ts`). Les montants sont
formatés par `formaterMontant` dans la devise du dossier, les points de base par
`formaterPointsDeBase`, les dates `JJ/MM/AAAA`. Les plafonds du modèle (`PLAFONDS_MODELE`, cellules de
300 caractères, 300 lignes) sont tenus par `cellule`, `borner` et `section` (`rapports/outils.ts`) ;
tout texte saisi est nettoyé par `normaliserRapport` (jamais interprété comme HTML ni balisage
Office). Aucune annexe « Sources du registre » live n'est ajoutée : `detail.sources` fait foi.

---

## 10. Écrans web (français, `apps/web`, territoire T3)

Principes : interface 100 % française ; libellés issus des tables `*_LIBELLES` de `packages/shared`
(jamais un code, un identifiant ou un UUID affiché ni saisi à la main : listes de choix, libellés de
taxonomie, sources choisies par leur libellé) ; un refus de l'API s'affiche avec son message
(`messageErreur`), le code sert au test ; états vide, chargement (`loading.tsx` du dossier) et erreur
(`EtatErreur`) sur chaque page ; **aucun calcul métier dans le web** (les parts, taux, montants et
comptes viennent de l'API, formatés par `lib/format.ts` ; les barres d'amplitude utilisent
`<meter>` avec la valeur en points de base, sans division) ; les droits (`aPermission`) ne servent
qu'au confort d'affichage, l'API reste juge ; aucun `dangerouslySetInnerHTML`, aucun `localStorage` ;
une page serveur ne passe **jamais une fonction** à un composant client (propriétés sérialisables
seulement, recherche n° 19) ; toute boucle de pagination déclare le plafond de la route
(`limiteMax: 100` pour R24 et R35, recherche n° 20) ; mise en page utilisable sur téléphone (cartes
empilées, tableaux défilants), focus visible, états portés par un texte en plus de la couleur.

### 10.1 Arborescence

```
apps/web/src/app/(app)/missions/[id]/due-diligence/
  layout.tsx  loading.tsx  page.tsx            liste des dossiers de la mission, bouton « Nouveau dossier »
  nouveau/page.tsx                             formulaire de cadrage (création)
  [dossierId]/layout.tsx                       en-tête (titre, secteur, pays, cible) + onglets
  [dossierId]/page.tsx                         Synthèse (R04)
  [dossierId]/cadrage/page.tsx                 cadrage courant, correction motivée, historique (R03, R05, R06)
  [dossierId]/analyses/page.tsx                PESTEL, cinq forces, SWOT, opérationnelle (R07–R09)
  [dossierId]/chaine/page.tsx                  carte de la chaîne de valeur (R10–R12)
  [dossierId]/risques/page.tsx                 checklist de risques et signaux applicables (R13–R15, R28, R29)
  [dossierId]/hypotheses/page.tsx              arbre d'hypothèses (R16, R17, R18)
  [dossierId]/hypotheses/[hypotheseId]/page.tsx   preuves liées, verdicts, validation (R19–R23)
  [dossierId]/marche/page.tsx                  dimensionnement (R30–R34)
  [dossierId]/environnement-social/page.tsx    filtrage E&S (R39–R41)
  [dossierId]/plan-100-jours/page.tsx          plan des 100 jours (R43–R45)
  [dossierId]/note/page.tsx  note/[noteId]/page.tsx   notes au comité, versions, soumission, validation, rapports (R46–R53)
  [dossierId]/ajustements/page.tsx             ajustements tracés (R42)
apps/web/src/app/(app)/parametres/due-diligence/
  layout.tsx (onglets Signaux | Listes d'exclusion) ; signaux/page.tsx ; exclusions/page.tsx   (R24–R27, R35–R38)
```

Onglet « Due diligence » ajouté à `missions/[id]/layout.tsx` si `aPermission(roles, "dd.lire")`
(après « Plan stratégique »). Entrée « Due diligence » de `lib/navigation.ts`, section Paramètres,
`permission: "dd.referentiel.gerer"` (les lecteurs atteignent la bibliothèque depuis l'onglet
« Risques » d'un dossier). Rapports : `lib/rapports.ts` (`NIVEAUX_SERVICE` + `dd`, `PERMISSIONS_NIVEAU`,
libellé du badge « Due diligence »), `components/rapports/BadgeNiveau.tsx`, et
`components/rapports/livrables.ts` + `GenerationLivrable.tsx` (type de livrable `note_comite`, choix du
format PDF ou Word ET de la variante « Synthèse exécutive » ou « Version détaillée », message
de `NOTE_NON_VALIDEE`) avec leurs tests.

### 10.2 Composants (`apps/web/src/components/due-diligence/`, `due-diligence.css`) et logique (`apps/web/src/lib/due-diligence.ts`, `due-diligence-serveur.ts`)

| Écran | Comportement attendu |
| --- | --- |
| Liste, cadrage | Cartes de dossiers (titre, secteur, pays, opération). `FormulaireCadrage` : listes de choix alimentées par `GET /api/standard/taxonomies?taxonomie=secteur|filiere|pays` (`standard.lire`, détenue par tous les rôles ayant `dd.ecrire` : test ; une requête par taxonomie, `chargerToutesLesPages` avec `limiteMax: 100`, plafond de cette route) ; la filière dépend du secteur ; « cible » obligatoire pour une acquisition ; date d'opération facultative (nécessaire aux dates du plan). Une correction exige un motif. |
| Synthèse | Cartes : hypothèses (nombre par état), risques (par niveau, « à documenter »), marché (fourchette, alerte de recoupement), E&S (niveau global, exclusions bloquantes), plan (taux de réalisation, retards), note (état). Bloc **« Avant de soumettre la note »** : chaque bloquant et avertissement du moteur en une phrase française avec lien vers l'écran à corriger. |
| Analyses | Sélecteur d'analyse (onglets) ; une grille de catégories (6, 5, 4 ou 3) ; chaque point : énoncé, importance, `BadgeSolidite` (réutilise `components/preuves/BadgeSolidite.tsx`), nombre de sources, bouton « Ajouter une source » qui ouvre le formulaire de preuve du registre (`FormulairePreuve`, route `/missions/[id]/preuves/nouvelle` avec l'assertion à lier). Un point fragile est signalé en texte (« Aucune source » / « Source unique »), pas seulement en couleur. |
| Chaîne de valeur | **Carte interactive** (`CarteChaine`, composant client) : étapes en séquence (horizontal sur grand écran, vertical sur téléphone), chaque étape est un bouton (`aria-pressed`) montrant libellé, acteurs, part de coût et part de marge (valeurs `*_affichee`) et un badge « n risques » ; un clic (ou Entrée) sélectionne l'étape et affiche **ses risques** (niveau, famille, solidité) dans un panneau voisin, avec lien vers le risque ; l'étape de plus forte marge est signalée (`etapeMargeMax`) ; un message dit si les parts de coût sont « incomplètes » ou « incohérentes » (écart à 100 %). Données passées au composant client : objets simples sérialisables. |
| Risques | Tableau par famille (pays, change, opérationnel, réglementaire) et niveau, filtres famille, niveau, étape ; formulaire de risque (niveau, étape, justification = affirmation sourcée, signal d'origine) ; si le niveau diffère de la gravité du signal, le champ « motif de l'écart » devient obligatoire. Panneau **« Signaux d'alerte applicables »** (R28) : question à poser, référence publique, boutons « Constaté », « Écarté » (commentaire obligatoire), « À vérifier », et « Créer le risque » (prérempli). |
| Hypothèses | `ArbreHypotheses` : liste imbriquée (indentation, `role="tree"`), chaque nœud avec `BadgeVerdict` (confirmée / infirmée / non concluante / en attente / ouverte), indication du moteur, solidité minimale des sources ; ajout d'une sous-hypothèse (profondeur 4 max) ; incohérences de l'arbre en alerte. Page d'une hypothèse : critère, assertions liées (soutient / contredit) avec solidité et analyse d'origine, « Lier une assertion existante » (liste des assertions de la mission), « Nouvelle assertion », **formulaire de proposition de verdict** (verdict, motif, assertions citées cochées ; si le verdict diffère de l'indication, message « Ce verdict s'écarte de l'indication du moteur : motif détaillé exigé, écart tracé » ) et historique des verdicts avec leur décision. Le bouton « Valider » / « Rejeter » n'apparaît qu'avec `dd.valider` ET si l'utilisateur n'est pas le proposant ; si l'API refuse (séparation des tâches), le message précis s'affiche. |
| Marché | Deux cartes (descendant, ascendant) ; `FormulaireParametres` (composant client) : une ligne par paramètre (libellé français, bas / base / haut, source choisie dans la liste des preuves de la mission **par libellé**, ou « Avis d'expert » avec motif) ; aperçu à chaque modification par `POST /api/dd/dimensionnements/calculer` (anti-rebond) : étages, fourchette, `TornadoSensibilite` (`<meter>` par paramètre), couverture des sources (paramètres sans source en alerte), ajustements d'expert (libellé, facteur, motif obligatoire). Bloc **recoupement** descendant/ascendant (écart, alerte, chevauchement). Montants affichés dans la devise du dossier. |
| E&S | Choix de la liste d'exclusion (générale ou de l'investisseur) ; saisie des activités ; huit thèmes (niveau, justification) ; résultat : règles touchées avec les mots trouvés ; **décisions** « Exclusion confirmée » / « Faux positif écarté » (motif ≥ 10 caractères, `dd.valider`, pas l'auteur) ; synthèse : niveau global, thèmes à documenter, état « bloquant ». Texte d'aide : « Référence : normes de performance de la SFI (cadre public) ; les libellés sont ceux de MissionPilot. » |
| Plan 100 jours | `FrisePlan100j` : trois bandes (jours 0–30, 31–60, 61–100) avec les actions (dates si la date d'opération est connue), statut, responsable (liste des membres de l'équipe), lien vers une initiative du plan et un KPI (liste de choix, libellés résolus par l'API, « lien non visible » sinon) ; actions en retard en texte et en couleur ; taux de réalisation ; alerte « sans responsable / sans indicateur ». |
| Note | Liste des notes ; éditeur de version (recommandation, synthèse, conditions) ; panneau **Contrôle** (bloquants, avertissements) ; boutons « Soumettre pour validation » (désactivé et expliqué s'il y a un bloquant) ; pour `dd.valider` hors auteur : « Valider » / « Rejeter » ; génération du rapport (format et variante), liste des rapports déjà générés avec téléchargement par le lien authentifié existant (`lib/fichiers.ts`). Un état « validée » affiche la version et le valideur. |
| Ajustements | Tableau (cible, champ, avant, après, motif, date) ; filtres par type de cible. |
| Paramètres | Signaux : tableau filtrable (famille, secteur, pays, actif), formulaire (famille, secteur ou filière, pays ou zone, gravité, question, référence publique), correction motivée, historique ; listes d'exclusion : règles (code, libellé, mots-clés, secteurs, pays), client investisseur facultatif, référence du cadre. Lecture seule sans `dd.referentiel.gerer`. |

Tests web (`apps/web/src/lib/due-diligence.test.ts` et `navigation.test.ts`, logique pure) :
libellés complets pour chaque valeur de chaque vocabulaire (aucun code brut) ; `sousPagesDd` ;
`droitsDd(roles)` pour chaque rôle de la matrice du §7 ; construction des chemins d'API (analyse,
filtres) ; messages d'erreur par code (`NOTE_BLOQUEE`, `SEPARATION_DES_TACHES`, `VERDICT_EN_ATTENTE`,
`PARAMETRE_SANS_SOURCE`…) ; regroupement des étapes et des risques pour la carte ; état dérivé d'un nœud
d'hypothèse (`etatVerdict`) ; plafond `limiteMax` des listes ; entrée de navigation et onglet de
mission selon les permissions ; `livrables.test.ts` étendu (`note_comite`, variante).

---

## 11. Découpage en trois territoires de fichiers disjoints

Aucun fichier n'appartient à deux territoires de ce lot. Les fichiers **partagés avec les sous-chantiers
3a et 3c** (§17) sont des ajouts d'une ligne ou d'un bloc isolé.

### T1 — moteurs, schémas partagés, permissions (agent « moteurs »)

- `packages/engines/src/due-diligence/**` (§5) et `packages/engines/src/index.ts` (+1 ligne).
- `packages/shared/src/schemas/due-diligence.ts` et `due-diligence.test.ts` (§6) ;
  `packages/shared/src/schemas/preuves.ts` seulement pour exporter le contrôle croisé de
  l'affirmation si nécessaire ; `packages/shared/src/index.ts` (+1 ligne).
- `packages/shared/src/roles.ts` et `roles.test.ts` (§7).
- **Livrable 0 (premier, court)** : le squelette complet des exports (schémas Zod complets, constantes,
  types, signatures des moteurs dont le corps lève `ErreurDueDiligence("ENTREE_INVALIDE", "non
  implémenté")`) et les permissions, pour que T2 et T3 compilent contre le contrat dès le début.
- Sortie : `pnpm --filter @missionpilot/engines test` (avec couverture), `pnpm --filter
  @missionpilot/shared test`, typecheck et lint des deux paquets.

### T2 — migrations, API, tests d'API (agent « API »)

- `apps/api/migrations/0500`–`0508` (§4, §9.1) ; `0509` et `0511` consommées le 2026-10-20 (lot 3), `0510` et `0512`–`0519` libres.
- `apps/api/src/due-diligence/**` (§8.11), `apps/api/src/routes/due-diligence*.ts` (§8),
  `apps/api/src/app.ts` (+1 enregistrement).
- Rapports : `apps/api/src/rapports/note-comite.ts` (nouveau) et petites modifications de
  `enregistrement.ts`, `niveaux.ts`, `liste.ts`, `apps/api/src/routes/rapports.ts` (§9.1).
- Tests : `apps/api/test/dd-*.test.ts` et `dd-outils.ts` (§12), mise à jour des tests existants des
  rapports qui énumèrent modèles ou niveaux.
- Base de test **propre à l'agent** (`missionpilot_<id>`, RUNBOOK) ; jamais deux suites API sur la même
  base. Sortie : typecheck, lint, Prettier, tests ciblés puis la suite des rapports, des preuves et
  d'isolation.

### T3 — web (agent « web »)

- `apps/web/src/app/(app)/missions/[id]/due-diligence/**`, `apps/web/src/app/(app)/parametres/due-diligence/**`,
  `apps/web/src/components/due-diligence/**`, `apps/web/src/lib/due-diligence.ts`,
  `due-diligence-serveur.ts` et leurs tests.
- Petites modifications : `apps/web/src/app/(app)/missions/[id]/layout.tsx` (onglet),
  `apps/web/src/lib/navigation.ts` et `navigation.test.ts`, `apps/web/src/lib/rapports.ts`,
  `components/rapports/{BadgeNiveau.tsx,GenerationLivrable.tsx,livrables.ts,livrables.test.ts}`.
- Sortie : typecheck, lint, Prettier, tests du paquet web.

### Ordre, parallélisme et règles des agents

1. T1 livre le **livrable 0** ; T2 commence **dès le départ** par les migrations et leurs tests SQL
   (aucune dépendance), T3 par `lib/due-diligence.ts` contre les schémas et types du livrable 0.
2. T1 termine les moteurs ; T2 branche l'API sur les moteurs et écrit les tests de route ; T3 les écrans.
3. Intégration par le Pilote : typecheck global (après tout lot d'agents parallèles : un bloc
   dupliqué par deux éditions concurrentes casse le typage), lint, Prettier, tests des quatre
   paquets, recherches mécaniques (§13), recette navigateur courte (Chrome, base de recette),
   audits `code-reviewer` et `security-auditor`, mise à jour des documents (§15), commit.
4. Prompt de chaque agent : liste exacte des fichiers attribués ; **interdiction** de toute commande
   git qui modifie l'arbre ou l'index (`stash`, `checkout`, `switch`, `reset`, `restore`, `add`,
   `commit`, `clean`) ; s'arrêter et signaler un travail qui semble « revenu en arrière » ; aucune
   modification des fichiers d'un autre territoire ni de `.claude/hooks/`, `.claude/settings.json`,
   `acc.config.json` ; aucun commit pendant qu'un agent écrit ; un rapport d'agent n'est pas une
   preuve (le Pilote relit le diff et relance les commandes).

---

## 12. Tests attendus

Chaque comportement a son test ; chaque faille corrigée en audit ajoute un test de non-régression.

### T1 (moteurs, shared)

Les tests numériques du §5 (cas D1, D2, A1, R1 à R3, C1, E1, E2, X1 à X3, chaîne, risques, verdicts,
arbre, signaux, exclusions, E&S, plan, note) ; `formaterPointsDeBase` (4 000 → « 40 % », 2 550 →
« 25,5 % », 3 333 → « 33,33 % », 5 → « 0,05 % », 10 000 → « 100 % », 0 → « 0 % ») ; couverture du
module ≥ 90 % (viser 100 % des branches) ; schémas : rigueur `.strict()`, chaque contrôle croisé,
bornes (pourcentage 10 001 refusé, jour 101 refusé, 21 conditions refusées…) ; `roles.test.ts`
(§7).

### T2 (API, vrai PostgreSQL)

| Fichier | Couverture |
| --- | --- |
| `dd-base.test.ts` | pour les 20 tables : `UPDATE`/`DELETE` refusés au propriétaire (`MPZ21`) et au rôle applicatif (droit absent) ; RLS (autre cabinet invisible, contexte du portail : rien de visible ni d'insérable) ; **un test SQL direct par code** `MPZ22` à `MPZ32` et `MPR04` ; contraintes `CHECK` (matrice des colonnes par type, bornes, `base_figee` ≤ 1 Mo) |
| `dd-acces.test.ts` | pour un échantillon de chaque famille de routes : 401, 403 par rôle de la matrice §7, nominal, **autre cabinet 404**, mission invisible 404, mission clôturée 409 aux écritures, **portail 403** pour chacune des 53 routes (boucle sur l'inventaire des routes `/dd`) |
| `dd-dossiers.test.ts` | R01 à R06 : codes de taxonomie, filière hors secteur, acquisition sans cible, plafond de 10, versions, `version_courante` périmée, dimensions `dd.*` créées une fois (idempotent) |
| `dd-analyses.test.ts` | R07 à R09 : un point est une assertion visible par les routes du registre ; lier une preuve change la solidité (valeur du moteur) ; retrait = `abandonnee` ; signature d'un avis d'expert réservée (403) ; l'assertion d'un point n'apparaît pas dans l'annexe d'un rapport de notation ni de plan |
| `dd-chaine-risques.test.ts` | R10 à R15 : synthèse (cas du §5.3), risque rattaché à une étape, signal d'origine et écart de niveau (`motif_ecart` obligatoire, ajustement créé), `aDocumenter` |
| `dd-hypotheses-verdicts.test.ts` | R16 à R23 : profondeur 4, journal des liens, proposition (indication du moteur, photographie, cas `MPZ24`), un seul verdict en attente (`MPZ32`), **séparation des tâches** : proposant, auteur de l'hypothèse, auteur d'une assertion citée refusés (API **et** SQL direct), associé admis, expert métier tiers admis ; verdict périmé (`MPZ27`) ; rejet ; ajustement si verdict ≠ indication |
| `dd-signaux.test.ts` | R24 à R29 : permissions (consultant 403, expert métier 201), unicité du code, filtres, **signaux applicables via la chaîne de taxonomie** (filière → secteur, pays → zone), constats |
| `dd-dimensionnement.test.ts` | R30 à R34 : l'API rend **exactement** les nombres du §5.2 (D1, A1) ; `MPZ31` (preuve d'une autre mission, avis sans motif) ; recoupement (cas X1) ; `calculer` n'écrit rien (comptage de lignes) ; `DEPASSEMENT` en 400 ; aucune clé FIN-02 |
| `dd-filtrage-es.test.ts` | R35 à R41 : listes, exécution, décisions et `MPZ28` (API et SQL), synthèse recalculée, thèmes |
| `dd-plan-100j.test.ts` | R43 à R45 : dates et retards du cas du §5.8, lien vers initiative et KPI d'un autre client refusé (`MPZ30`), responsable hors équipe refusé, **libellé masqué** sans `plan.lire`/`kpi.lire` ou mission invisible |
| `dd-notes.test.ts` | R46 à R51 : bloquants (`NOTE_BLOQUEE`, `details.manquants`), soumission figée, `MPZ29` en SQL, validation : auteur de la note, auteur d'un brouillon, soumetteur refusés (API et SQL `MPZ26`), associé admis, `NOTE_PERIMEE`, rejet |
| `dd-rapport.test.ts` | R52, R53 (format Word, le PDF exige Chromium) : refus avant validation (`MPR04` en SQL), les deux variantes viennent de la **même** base (mêmes verdicts), verbatim nominatif masqué, aucune clé FIN-02, niveau `dd` illisible sans `dd.lire` (`GET /fichiers/:id` 403), suivi qualité ouvert, débit 429 |
| `dd-donnees-ouvertes.test.ts` | contrat de l'adaptateur simulé (`simule` vrai, aucun `fetch` appelé) |
| `dd-vocabulaire.test.ts` | égalité des vocabulaires `shared` et `engines` |

Les tests existants qui énumèrent les modèles ou niveaux de rapport (`rapports*.test.ts`) et les
inventaires d'`isolation.test.ts` et `portail-acces.test.ts` sont relancés (aucune exception ajoutée).

### T3 (web)

Voir la fin du §10.2.

---

## 13. Points d'audit (pour `/audit`, `code-reviewer`, `security-auditor`)

1. **Cloisonnement** : 20 tables à `isolation` + `portail_interdit` ; FK composites partout ;
   aucune route dans `LISTE_BLANCHE_PORTAIL` ; une assertion, une preuve, un KPI, une initiative
   d'une autre mission ou d'un autre client ne se cite ni ne se lie (déclencheurs `MPZ22`, `MPZ30`,
   `MPZ31`, `MPZ24`) ; 404, jamais 403, pour une ressource invisible.
2. **Sourcing** : un verdict confirmé ou infirmé sans citation refusé en base ; la photographie est
   cohérente avec le journal de liens ; l'indication du moteur n'est jamais reçue du client ; aucune
   écriture directe dans les tables du registre (seuls `creerAssertion` / `corrigerAssertion`).
3. **Séparation des tâches** (verdict, note, décision d'exclusion) : règle identique côté API et base,
   test de refus identique ; l'associé ne contourne que la séparation, jamais le motif ou le blocage.
4. **Moteurs** : aucune formule hors `packages/engines` (recherches §13.1) ; arithmétique
   `bigint`, un seul arrondi, `DEPASSEMENT` ; seuils exportés et notés provisoires ; `partAmplitudeBp`
   et `formaterPointsDeBase` évitent toute arithmétique côté API et web.
5. **Aucune IA** : aucun import de `ia/`, aucune requête réseau, aucune variable de configuration ;
   l'adaptateur simulé n'est branché nulle part.
6. **`base_figee`** : construite par le serveur, validée par `noteBaseSchema` à l'écriture et à la
   lecture, bornée à 1 Mo ; aucun verbatim nominatif, aucun nom de personne, aucune donnée FIN-02 ;
   la garde `MPZ29` est une garde de cohérence (limite connue : du SQL arbitraire du même rôle la
   contourne ; à ajouter à SECURITY.md §15).
7. **Rapport** : `MPR04`, niveau `dd` relu à chaque lecture de fichier, débit, suivi qualité,
   neutralisation du texte saisi (`normaliserRapport`), conservation des rapports.
8. **FIN-02** : le module ne sert ni coût, ni taux, ni marge, ni honoraire ; test négatif sur chaque
   réponse financière (marché) et sur le rapport.
9. **Liens du plan des 100 jours** : un libellé de plan ou de KPI d'une autre mission ne fuit pas
   (`masque`) ; le responsable est un membre actif de l'équipe, jamais un compte du portail.
10. **Concurrence et intégrité** : verrou de la mission, `version_courante`, unicités traduites en 409,
    plafonds sous verrou, numérotation sans trou en base.
11. **Mission clôturée** : toute écriture refusée (409) ; la lecture reste ouverte.
12. **Fichiers partagés avec 3a et 3c** : `roles.ts`, `app.ts`, `navigation.ts`, index de `shared` et
    d'`engines` ; contraintes de `rapports_mission` réécrites **sans retirer** une valeur existante
    (`MODELES_RAPPORT`, `PERMISSIONS_NIVEAU`) ; partage de la lettre `Z` (numéros 21 à 32 seulement).
13. **Web** : aucune fonction passée à un composant client, plafonds `limiteMax`, libellés français,
    pas de `dangerouslySetInnerHTML`, états vide, chargement et erreur, accessibilité de la carte de
    chaîne (clavier, `aria-pressed`).

### 13.1 Recherches mécaniques à ajouter à `.claude/rules/review-checklist.md` (attendus à mesurer à la livraison)

```bash
# DD1. Ni IA ni réseau dans le module. Attendu : 0
rg -n "orchestrateur|openrouter|ia/|fetch\(|undici|node:https?" apps/api/src/due-diligence
# DD2. Aucune arithmétique ni agrégat dans l'API du module ni dans le rapport. Attendu : 0
rg -n "Math\.|toFixed\(|SUM\(|AVG\(" apps/api/src/due-diligence apps/api/src/rapports/note-comite.ts
# DD3. Aucune écriture directe dans le registre des preuves. Attendu : 0
rg -n "INSERT INTO (assertions|assertion_versions|assertion_preuve_liens|preuves|preuve_versions)\b" apps/api/src/due-diligence
# DD4. Chaque table dd_* a ses deux politiques et son déclencheur d'ajout seul. Attendu : somme des comptes
#      par fichier = 20 pour chacune des trois commandes
rg -c "CREATE POLICY isolation ON dd_" apps/api/migrations/05*.sql
rg -c "CREATE POLICY portail_interdit ON dd_" apps/api/migrations/05*.sql
rg -c "EXECUTE FUNCTION refuser_modification_dd" apps/api/migrations/05*.sql
# DD5. Aucune fonction SECURITY DEFINER dans le lot. Attendu : 0 (la recherche n° 16 reste à 23)
rg -n "SECURITY DEFINER" apps/api/migrations/05*.sql
# DD6. Codes SQLSTATE : exactement MPZ21 à MPZ32 dans 05*.sql ; aucun numéro de 3a (MPZ01 à MPZ20) dans le lot ;
#      aucun numéro du lot (MPZ21 à MPZ32) hors de ses migrations, de `due-diligence/` et des tests `dd-*`.
#      Attendu : 12 ; 0 ; 0
rg -oN "MPZ[0-9]{2}" apps/api/migrations/05*.sql | sort -u | wc -l
rg -n "MPZ(0[1-9]|1[0-9]|20)" apps/api/migrations/05*.sql apps/api/src/due-diligence apps/api/test/dd-*
rg -n "MPZ(2[1-9]|3[0-2])" apps/api packages --glob '!migrations/05*' --glob '!src/due-diligence/**' --glob '!test/dd-*'
# DD7. Routes : « 730 8 » à la recherche n° 10 ; variables d'environnement inchangées (n° 3 : 5 lignes).
# DD8. Aucune donnée FIN-02 dans le module. Attendu : 0
rg -n "finance\.lire|cout_jour|taux_horaire|marge" apps/api/src/due-diligence
```

---

## 14. Valeurs provisoires pour `DECISIONS.md`

À consigner dans une nouvelle section « Due diligence (service #2, DD-01 à DD-15) » de
`docs/DECISIONS.md` par le Pilote, **telles que ci-dessous : posées par défaut par cette
spécification, aucune n'a été fixée par le commanditaire, toutes sont à valider** (un chiffre n'est
jamais présenté comme un fait). Toute valeur est une constante exportée de `packages/engines` ou de
`packages/shared`, jamais un nombre caché.

| Sujet | Valeur posée par défaut | Reste à valider |
| --- | --- | --- |
| Indication de verdict (DD-09) | « confirmée » : au moins une assertion de soutien « solide » **et** au moins **2** soutiens solides ou étayés, aucun contre « solide » ni « étayé » ; « infirmée » : un contre « solide » sans soutien « solide » ; sinon « non concluante » ; les assertions « fragiles » ne comptent pas | Le seuil de 2 ; les règles ; leur calibrage sur de vraies missions |
| Lecture de solidité | celle du registre des preuves (0,75 / 0,5, poids A à D), inchangée | Déjà « à calibrer au pilote » |
| Recoupement descendant / ascendant (DD-12) | alerte au-delà de **30 %** d'écart relatif (3 000 pb) | La valeur |
| Ajustement d'expert d'un dimensionnement | facteur de 0,01 % à 200 % (1 à 20 000 pb), 10 ajustements au plus, motif ≥ 10 caractères | Les bornes |
| Cohérence de la chaîne de valeur (DD-04) | somme des parts de coût (ou de marge) à 100 % ± **1 point** | La tolérance |
| Plan des 100 jours (DD-15) | phases selon le jour de début : 0–30, 31–60, 61–100 ; en retard = non terminée et date de fin strictement avant aujourd'hui | Les bornes de phase |
| Plafonds (§3.3) | 10 dossiers par mission ; 300 points, 30 étapes, 200 risques, 100 hypothèses (profondeur 4), 200 actions ; 20 dimensionnements, 50 filtrages, 10 notes par dossier ; 2 000 signaux, 50 listes d'exclusion, 200 règles par liste ; `base_figee` 1 Mo | Toutes les valeurs |
| Classe de risque des affirmations | R2 par défaut, R3 au choix (R0 et R1 refusées) | Faut-il R3 pour les affirmations qui fondent un verdict ? |
| Habilitations | `dd.lire`, `dd.ecrire`, `dd.valider`, `dd.referentiel.gerer` selon la matrice du §7 (le chef de mission valide les travaux de son équipe ; l'expert métier valide sans écrire ; le directeur de mission maintient les référentiels) | L'attribution à chaque rôle |
| Séparation des tâches | verdict : ni proposant, ni auteur de l'hypothèse, ni auteur d'une assertion citée ; note : ni créateur, ni auteur d'aucune version ; exclusion : pas l'auteur du filtrage ; associé dispensé | À confirmer |
| Cadrage | une acquisition exige une cible nommée ; secteur et pays pris dans les taxonomies du référentiel (CITI, pays, zones) | La règle de la cible |
| Recommandation de la note | quatre valeurs : favorable, favorable sous conditions, réservée, défavorable ; contrôles bloquants listés au §5.9 | Le vocabulaire ; les bloquants |
| Thèmes E&S | huit thèmes à libellés courts de MissionPilot, cadre public cité en référence seulement ; aucune liste d'exclusion fournie (chaque cabinet saisit celle de son investisseur) | Les libellés par un expert E&S |
| Bibliothèque de signaux | vide au départ, propre au cabinet, maintenue par `dd.referentiel.gerer` ; aucun amorçage fourni | Un amorçage par des experts ; une bibliothèque « standard » |
| Conservation | aucune purge du contenu de due diligence (ajout seul) ; les rapports suivent la conservation du cabinet (3 ans par défaut) | **Avis du conseil juridique** (confidentialité d'une opération d'investissement) |
| Mention IA du pied de page | celle du cabinet, inchangée (aucune IA ne contribue à ce lot) | — |
| DD-02 | import de rapports PDF **livré le 2026-10-22** (lot 6, ADR-009, texte natif) ; connecteurs de données ouvertes : adaptateur simulé seulement, **OUVERT**, aucun appel réel | Choix des sources et du fournisseur (données ouvertes) ; OCR local (lot 11) |
| DD-10 | **livré le 2026-10-22** (lot 6, ADR-009, texte natif) | OCR local (lot 11) |
| DD-07 | véhicule livré le 2026-10-20 (lot 3), aucun contenu sectoriel | Contenu sectoriel à rédiger par des experts |

---

## 15. Documentation à mettre à jour par le Pilote (non faite par cette spécification)

- `docs/governance/CODING_STANDARDS.md` : §1 (plage `0500`–`0519` et table des migrations `0500`–`0508`,
  « prochain numéro libre `0509` » ; modules `due-diligence/` de l'API et des moteurs), §2 (lettre `Z`,
  `MPZ21`–`MPZ32`, `MPR04`), §10 (dette : `base_figee` jsonb borné, bibliothèque vide).
- `docs/governance/SECURITY.md` : nouvelle section « 8 octies. Due diligence (DD-01 à DD-15) » (modèle des
  sections 8 ter à 8 septies : actifs, acteurs, cloisonnement, séparation des tâches, `base_figee`,
  rapport, limites), liste des SQLSTATE du §6, §15 (garde `MPZ29` de cohérence seulement).
- `.claude/rules/review-checklist.md` : contrôles du §13 et recherches DD1 à DD8 ; mise à jour des
  attendus des recherches n° 10, 12 et 13 (migrations : 164 fichiers après `0508`).
- `docs/DECISIONS.md` : section du §14. `docs/workflows/HANDOFF.md` : état du lot, pièges
  (lettre `Z`, contraintes de `rapports_mission`), prochaines étapes (§16).
- `docs/architecture/adr/ADR-012-service-due-diligence.md` : passer à « Acceptée » après accord.

---

## 16. Repoussé, points ouverts et questions à trancher

**Repoussé (avec la raison)**

- **DD-02** connecteurs de données ouvertes : dépend d'un fournisseur et d'une clé ; **OUVERT**, adaptateur
  simulé seulement. **L'import de rapports PDF de DD-02 n'est plus repoussé** : livré le 2026-10-22 (lot 6,
  ADR-009 Acceptée, texte natif, §8.13) ; l'OCR local est à venir (lot 11).
- **DD-10** lecture IA de la salle de données : **N'EST PLUS REPOUSSÉ**, livré le 2026-10-22 (lot 6, ADR-009,
  texte natif, §8.13) ; l'OCR local est à venir (lot 11). Besoin d'origine : ingestion/OCR (ADR-009) et clé
  OpenRouter.
- **DD-07** modèles d'analyse par secteur : véhicule livré le 2026-10-20 (lot 3, `0511`, modèles vides par défaut, rédigés par le cabinet) ; AUCUN contenu sectoriel livré, à rédiger par des experts.
- **Accès d'un investisseur-client à une note validée par le portail** : N'EST PLUS REPOUSSÉ, livré le 2026-10-20 (lot 3, `0509`). Livré : option du cabinet (désactivée par défaut, `dd.portail.configurer`, associé seul), invitation d'un compte portail `client_investisseur` sur un dossier, publication (`dd.portail.gerer`, associé et directeur de mission) d'un instantané de la version VALIDÉE de la note et de pièces choisies (rapports de la note, 10 au plus), consultation en lecture seule (`portail.dd.lire`, trois routes dans `LISTE_BLANCHE_PORTAIL`), cinq tables `dd_portail_*` en ajout seul ; une note devenue périmée (version plus récente) reste visible de l'investisseur, marquée « périmée » côté cabinet. Ce qui suit est le besoin initial, conservé pour mémoire : il exigeait une permission
  `portail.dd.lire`, une table de partage explicite (modèle `portail_partages`), une route nommée dans
  `LISTE_BLANCHE_PORTAIL` (motif exact), un `avecPortail` et une politique `portail` en `SELECT` filtrée sur le
  client, un écran, et des tests (`portail-acces`, `isolation`, `portail-contexte`) ; le rôle
  `client_investisseur` n'a aujourd'hui que `portail.acceder` et aucun écran (PRD complémentaire §13). La note
  lui parvient hors plateforme (fichier rendu). **Invariant tenu par le socle initial du lot** : aucune table ni route
  n'est lisible du portail (levé pour les seules tables et routes `dd_portail_*` du lot 3).
- Rédaction assistée par IA des analyses, hypothèses et de la note (lot suivant : `brouillon_ia`,
  orchestrateur, garde-chiffres) ; amorçage d'une bibliothèque de signaux « standard » ; classe de risque
  R3 propre à la note (nouveau type de livrable qualité) ; calibrage du moteur de verdict.

**Points ouverts à trancher par le Pilote ou le commanditaire**

1. **Lettre SQLSTATE : collision à arbitrer AVANT toute migration.** `H` et `Z` sont les deux seules lettres
   libres dans le code ; le lot canaux (SPEC-3c) prend `H`, le redressement (SPEC-3a, ADR-011) prend `Z`
   (`MPZ01`–`MPZ11`) ; la due diligence n'a donc plus de lettre. Décision proposée ici : **partager `Z` avec des
   numéros disjoints, `MPZ21`–`MPZ32`** (3a se limite à `MPZ01`–`MPZ20`). À confirmer par le Pilote et à
   consigner dans CODING_STANDARDS §2 ; repli : une seconde famille de préfixe (`MQD01`–`MQD12`, « MQ »
   n'étant pas une classe SQLSTATE de PostgreSQL). Plus aucune lettre ne restera pour les lots suivants : la
   règle de nommage doit être étendue de toute façon.
   **Tranché (état au 2026-10-21)** : le partage de `Z` a été retenu et tenu (redressement `MPZ01`–`MPZ20`, due
   diligence `MPZ21`–`MPZ32`, dernier partage, qui ne se reproduit pas) ; la règle de nommage a été étendue
   (CODING_STANDARDS §2 : second préfixe `MQ` + lettre de domaine) et le repli `MQD` a servi au lot 3 :
   `MQD01`–`MQD08` (portail investisseur, `0509`) et `MQD11` (modèles sectoriels, `0511`) employés, `MQD09`–`MQD10`
   et `MQD12`–`MQD20` libres.
2. **Plage de migrations** : `0500`–`0519` réservée ici, sans chevauchement avec 3a (`0480`–`0499`) ni 3c
   (`0540`–`0559`) ; `0520`–`0539` libre.
3. **Rapports** : classe de risque du rapport de note (R2 par défaut, R3 souhaitable ?).
4. **`dd.valider` au chef de mission** et `dd.referentiel.gerer` au directeur de mission (§7).
5. **Une opération par dossier** : plusieurs dossiers par mission sont permis (10) ; une mission = une
   opération est-elle préférable (simplifie l'écran) ?
6. **Conservation** du contenu de due diligence (conseil juridique).
7. **Vocabulaire de la recommandation** et **bloquants** de la note (§5.9).
8. **Libellés des huit thèmes E&S** et contenu d'une liste d'exclusion type.

---

## 17. Intégration avec les autres sous-chantiers de la vague 4 et fichiers partagés

*État au 2026-10-21 : le tableau ci-dessous est le relevé d'origine (2026-10-11), conservé. Les trois lots ont été
livrés sans collision de migrations ni de SQLSTATE : `MPZ01`–`MPZ20` pour le redressement, `MPZ21`–`MPZ32` pour la
due diligence (la ligne « disjoints seulement si 3a reste sous `MPZ20` » est vérifiée), `MPH01`–`MPH12` pour les
canaux ; la due diligence a ensuite pris `MQD01`–`MQD08` et `MQD11` (second préfixe, lot 3) et ses migrations vont
jusqu'à `0509` et `0511` dans la plage `0500`–`0519`. Le rapport de clôture du redressement (RED-08, modèle
`cloture_redressement`) a depuis réécrit les contraintes de `rapports_mission` après `0508` : la règle de reprise de
la réunion des valeurs ci-dessous s'est appliquée.*

Relevé du 2026-10-11 dans `docs/workflows/specs/SPEC-3a-redressement.md`, `ADR-011`, `SPEC-3c-canaux-simules.md`
et `ADR-008`, `ADR-010`, `ADR-013` (écrits en parallèle de celle-ci) :

| Sujet | 3a (redressement) | 3c (canaux simulés) | 3b (cette spécification) | Verdict |
| --- | --- | --- | --- | --- |
| Migrations | `0480`–`0499` | `0540`–`0559` | `0500`–`0519` | disjointes |
| SQLSTATE | `MPZ01`–`MPZ11` | `MPH01`–`MPH12` (ADR-010 cite `MPH11`, ADR-013 `MPH07` : collisions internes à 3c, hors de ce document) | `MPZ21`–`MPZ32`, `MPR04` | **disjoints seulement si 3a reste sous `MPZ20`** (§16, point 1) |
| Permissions | `redressement.*` | à lire dans SPEC-3c §10.1 | `dd.*` | aucun nom commun |
| Modèle de rapport | **aucun** (« le socle ne produit aucun livrable », SPEC-3a §2.2) | aucun | `note_comite` | pas de couplage actuel sur `rapports_mission` |
| Tables | `red_*` | tables de canaux | `dd_*` | aucun nom commun |

**Fichiers touchés par plusieurs lots** (ajouts localisés : une ligne, une entrée de tableau, un bloc ; le
conflit éventuel est textuel, et SPEC-3c §« Fichiers partagés » le dit déjà) : `packages/shared/src/roles.ts`
(bloc de permissions, `PERMISSIONS_PAR_ROLE`), `packages/shared/src/index.ts`,
`packages/engines/src/index.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/navigation.ts`,
`apps/web/src/app/(app)/missions/[id]/layout.tsx`, les documents du §15. Propres à ce lot (rapports) :
`apps/api/src/rapports/{enregistrement,niveaux,liste}.ts`, `apps/api/src/routes/rapports.ts`,
`apps/web/src/lib/rapports.ts`, `components/rapports/{BadgeNiveau,GenerationLivrable,livrables}`.
**Ordre de fusion** : sans dépendance de fond entre les trois lots ; fusionner l'un après l'autre,
chaque agent d'intégration rebasant les ajouts localisés ci-dessus (un test de vocabulaire ou
d'inventaire en échec signale un oubli).

**Contraintes de `rapports_mission` — règle pour tout lot qui ajoute un modèle de rapport.** DD (`0508`)
réécrit `rapports_mission_modele_check`, `rapports_mission_niveau_check`, `rapports_mission_source_check` et
`controler_source_rapport()` comme l'ont fait `0131` et `0424`. Si un autre lot en fait autant (par exemple
le rapport de clôture du redressement, RED-08, repoussé par 3a), **la migration appliquée en dernier (numéro
le plus grand) reprend la réunion des valeurs en vigueur**, relues dans l'état le plus récent du dossier
`apps/api/migrations` (pas dans ce document), sans en retirer aucune. Valeurs de DD à reprendre : modèle
`note_comite`, niveau `dd`, colonnes `dd_note_id` et `variante`, branche
`(modele = 'note_comite' AND dd_note_id IS NOT NULL AND version_source IS NOT NULL AND variante IS NOT NULL AND
notation_id IS NULL AND plan_id IS NULL AND niveau = 'dd')` (et `dd_note_id IS NULL AND variante IS NULL` sur les
branches des autres modèles), contrôle `MPR01` sur `dd_note_id` et `MPR04` (§9.1). Le test
`dd-rapport.test.ts` insère un rapport de chaque modèle existant pour garantir qu'aucune valeur n'a été perdue.

**Cohérence avec la règle ferme du lot canaux (décision de l'utilisateur)** : DD-02 (connecteurs de données ouvertes) suit le même schéma
« port + fournisseur simulé, aucun appel réel, point non vérifié marqué OUVERT » (SPEC-3c §1.1) ; l'adaptateur
simulé de §8.12 ne produit que des valeurs fictives marquées `simule: true`.
