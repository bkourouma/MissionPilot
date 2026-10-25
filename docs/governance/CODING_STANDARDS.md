# Conventions de code — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les conventions **observées dans le code** (état de `main`
après la fusion de la PR n° 14, `3d5a252`, complétée aux 2026-10-21 et 2026-10-22 par les lots 1 à 5b, 6, 7, 4c, 8a, 8b, 8c et 10 de la branche
d'intégration ; vagues 1 à 3, rejeu réel OpenRouter, lacunes de la vague 2 — événement `mission.cloture_demandee`,
brief quotidien, copilote — et vague 4 : redressement, due diligence, canaux simulés ; lots 5b et 7 : observatoire, veille, services candidats ; lot 4c : rapport d'avancement hebdomadaire, cache et plafond de mission de l'IA, contradicteur ; lot 6 : ingestion de documents, ADR-009 ; lot 10 : corrections de la recette navigateur ; lots 13a et 13b : écrans périmés, réveil des jobs, libellés, le 2026-10-23), avec un fichier de
référence pour chacune, pas un idéal. Les
contrôles mécaniques sont dans `.claude/rules/review-checklist.md`.

## 1. Organisation du dépôt

Monorepo pnpm (ADR-001), TypeScript strict (`tsconfig.base.json`), modules ESM.

| Dossier             | Rôle                                                                 | Peut importer                         |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `packages/engines`  | moteurs de calcul purs, sans E/S : planning, finance, questionnaires, notation, KPI, plan stratégique et modèle financier, et pour les vagues 2 et 3 automatisation, clôture, prévisions, appels d'offres, banque de CV, offre financière, capitalisation, brief quotidien (`brief`) et copilote (`copilote`), puis, vague 4, redressement (`redressement` : ratios, urgence, alerte précoce, trésorerie à 13 semaines, créanciers, plan, leviers, puis check-lists, causes racines, covenants, plan de financement, bilan de clôture, suivi, voyant et tableau de bord), due diligence (`due-diligence`) et canaux (`canaux`) ; ajouts du 2026-10-21 : groupes et filiales (`dossier/groupe`, `dossier/synthese-etats`), revue à froide (`qualite/echantillonnage`), ateliers, simulation de Monte-Carlo et re-prévision du plan (`plan-strategique/{prng,monte-carlo,atelier,reprevision}`), combinaisons minimales de la notation (`notation/combinaisons`) | rien d'applicatif |
| `packages/shared`   | rôles, permissions, schémas Zod, types partagés                      | rien d'applicatif                     |
| `apps/api`          | API Fastify : `src/routes`, logique par domaine, `migrations`, `test`| `engines`, `shared`                   |
| `apps/web`          | interface Next.js (français), `src/app`, `src/lib`, `src/components` | `shared` (pas `engines`, vérifié : aucun import, seulement des commentaires) |

- Configuration de l'API : un seul point, `apps/api/src/config.ts`
  (`loadConfig`). `.env.example` à la racine documente les variables.
- **Exécution : Node 22.13 minimum** (lots 6 et 11). `engines.node` du `package.json` racine vaut `>=22.13` et les
  deux jobs de `.github/workflows/ci.yml` tournent en `node-version: 22`. Raisons : `unpdf@1.8.1` (extraction des
  PDF, ADR-009) exige Node >= 22 ; le modèle de permissions de Node (`--permission`), qui confine le
  sous-processus de l'OCR local (lot 11), n'existe qu'à partir de Node 22.13 (en production, sans lui, l'OCR est
  indisponible et un scan échoue `OCR_INDISPONIBLE` ; hors production, toléré avec un avertissement) ; et
  `worker.getHeapStatistics()`, qui borne la mémoire externe du worker d'extraction, n'existe qu'à partir de
  Node 22.16 (`apps/api/src/ingestion/pdf.ts` garde une voie défensive : méthode absente, seule la surveillance
  du RSS joue). Une dépendance qui exige une version plus haute passe par une mise à jour de ces endroits,
  jamais par un contournement local.
- Migrations SQL numérotées par plage de domaine dans `apps/api/migrations` :

  | Plage         | Domaine                                                            |
  | ------------- | ------------------------------------------------------------------ |
  | `0001–0008`   | socle, référentiels, durcissement                                  |
  | `0010–0015`   | pipeline, missions, découpage, budget, documents                   |
  | `0020–0021`   | planification                                                      |
  | `0030`, `0076`, `0122` | temps (`0076` : code de la tâche figée, `0122` : idempotence des saisies) |
  | `0040–0044`   | facturation                                                        |
  | `0050–0052`   | double authentification                                            |
  | `0060–0064`   | finance (encaissements, relances, bilans, plan comptable)          |
  | `0070–0075`   | fichiers, documents, justificatifs, commentaires, tâches           |
  | `0100–0104`   | IA (paramètres, prompts, générations, durcissement, conservation)  |
  | `0110–0115`   | portail client (rôles, partages, invitations, RLS, KPI)            |
  | `0120–0121`   | limiteur de tentatives persistant, pagination par curseur          |
  | `0130–0132`   | rapports générés (`0131` notation et plan, `0132` conservation)   |
  | `0140–0143`, `0148–0150` | questionnaires (`0148` : reprise des relances, `0149` : génération IA, `0150` : date limite) |
  | `0145–0147`   | notation (`0144` n'est pas utilisé)                                |
  | `0160`        | KPI                                                                |
  | `0180–0184`   | plans stratégiques, modèle financier, diagnostic, KPI d'objectif, dépendances |
  | `0200–0206`   | référentiel de méthodes (lot STD) : dictionnaire, facteurs, services et notes de contexte (`0200`), méthodes, versions et contenu (`0201`), mission figée, dérogations (`0202`), comité méthode (`0203`), amorçage du standard : dictionnaire (`0204`) et méthodes Notation et Plan stratégique (`0205`) ; notation calculée depuis la méthode de la mission (`0206`, intégration de la vague 1 : `notation_versions_methode`) ; durcissements d'audit : garde de publication d'une variante (`0207`, `MPM07-08`), standard visible seulement publié (`0208`), validations exigées pour approuver une dérogation (`0209`) |
  | `0210`        | référentiel de méthodes, STD-11 complet : `GRANT UPDATE (libelle, description, valeurs, min, max)` sur `facteurs_contexte` au rôle applicatif et déclencheur `controler_modification_facteur` (`MQS01-02`) |
  | `0220–0224`   | dossier client (lot DOS) : faits et décisions (`0220`), facteurs de contexte (`0221`), états financiers, lignes et décisions (`0222`), instantanés de fiabilité et exports (`0223`), acceptation automatique à tolérance nulle seulement (`0224`) |
  | `0225`        | dossier client, groupes et filiales (DOS-05) : `dossier_participations`, ajout seul, parts en points de base (`MQF01-04`) |
  | `0240–0243`   | registre des preuves (lot PRV) : preuves, versions et dimensions (`0240`), assertions et versions (`0241`), liens et arbitrages (`0242`), durcissement d'audit (`0243`, `MPV06-07`) |
  | `0260–0274`   | agents IA (lot AGT) : registre (`0260`), briques et exécutions (`0261`), autonomie (`0262`), contributions et plafonds (`0263`), jeux d'essai et évaluations de non-régression (`0264`), fournisseur d'évaluation et exécution sous non-régression (`0265`), validation d'une sortie conforme (`0266`), gardes de rôle (`0267`) ; `0268` : `fichier_orphelin` étendu aux références de fichiers des preuves et du dossier client (fonction transversale, numérotée après `0267` parce qu'elle cite des tables créées par `0220`–`0221` et `0240`) ; `0270` : rejeu réel des évaluations sur OpenRouter (AGT-04) : demandes de rejeu (`agents_evaluations_demandes`), statut, jetons et demande d'origine des évaluations, appels d'évaluation dans `ia_consommations`, garde de provenance (`MPG09`) ; `0271–0274` : copilote conversationnel (AGT-08, lacune de la vague 2) : propositions d'actions confirmées par l'utilisateur, `copilote_actions` (`0271`, `MPG10-11`), origine « copilote » dans `ia_consommations` (`0272`), registre d'agents version 2 : plafond du copilote relevé à N2 (`0273`), anonymisation à 30 jours et planification de la purge (`0274`, `anonymiser_copilote_actions` et `planifier_purge_copilote`, `SECURITY DEFINER`) ; `0269` n'est pas utilisé |
  | `0275–0277`   | agents IA, socle IA (lot 1) : rejeu OpenRouter, fonctions `SECURITY DEFINER` `rejeu_evaluation_demarrer`, `_inscrire_appel`, `_terminer`, garde de la table `jobs` et droits par colonne retirés au rôle applicatif (`0275`, `MPG12-15`), modèle recommandé et modèle routé du cabinet (`0276`), registre standard : agent `copilote` version 3 (`0277`) |
  | `0278–0279`   | agents IA, cache et contradicteur (AGT-06, lot 4c) : `ia_parametres_cabinet.cache_actif` (faux par défaut), `ia_cache_reponses` (réponse masquée chiffrée AES-GCM, clé HMAC-SHA-256, durée de 24 h au plus par CHECK, RLS `isolation` et `portail_interdit`), issue « cache » à coût nul dans `ia_consommations`, `ia_alertes_plafond_mission`, REDÉFINITION de `planifier_conservation_ia` (`0278`, `MQI01`) ; revue contradictoire : index unique partiel `ia_demandes_revue_active_idx` et déclencheur `controler_ia_revue_contradictoire` (`0279`, `MQI50`), aucune table |
  | `0280–0286`   | qualité (lot QUA) : suivis et gardes (`0280`), définitions de terminé et vérifications (`0281`), revue guidée (`0282`), validations et signatures (`0283`), acceptation de mission (`0284`), satisfaction (`0285`), durcissement d'audit (`0286`, `MPY08-11`) |
  | `0287–0290`   | qualité, revue à froide (QUA-05) : campagnes, tirage et déclencheur `qualite_froide_violations()` (`0287`), revues, grille et constats (`0288`), actions du plan d'amélioration (`0289`), interdiction de réaffecter un relecteur dont la revue est commencée : déclencheur `qualite_froide_echantillon_controle_reaffectation` (`0290`, lot 8b, `MQQ13`) ; `MQQ01-13` |
  | `0300–0304`   | moteur d'automatisation (lot AUT-CORE, vague 2, ADR-006) : automatisations, versions immuables de leur définition et coupe-circuits (`0300`, AUT-02, AUT-06), événements publiés, exécutions, actions gardées, résultats, annulations et brouillons tracés (`0301`, AUT-01, AUT-05), événements publiés par la base et planification quotidienne de la détection (`0302`, `SECURITY DEFINER`), événement `mission.cloture_demandee` publié au passage à `a_cloturer` (`0303`, lacune de la vague 2, sans nouveau SQLSTATE), planification quotidienne du brief par rôle (`0304`, AUT-07, `planifier_brief_quotidien` en `SECURITY DEFINER`, aucune table) ; `MPU01-05` |
  | `0305`        | file de tâches : `reserver_job_a` équitable par cabinet (plpgsql) et trois index sur `jobs` ; aucun nouveau SQLSTATE |
  | `0306–0308`   | rapport d'avancement hebdomadaire au client (AUT-10, lot 4c, plage `0306–0319`) : `avancement_parametres` (`envoi_email` avec `CHECK (envoi_email = false)`, jamais lu par un code d'envoi) (`0306`), `avancement_rapports` (UNIQUE mission et semaine, RLS `isolation`, politiques RESTRICTIVES du portail, déclencheur `controler_avancement_rapport`, `MQU01-05` et `MQU07`) (`0307`), `planifier_avancement_hebdo` en `SECURITY DEFINER` (`0308`) ; ne touche ni `rapports_mission` ni `controler_source_rapport()` |
  | `0320–0323`   | check-list de clôture (AUT-08, vague 2) : modèle du cabinet (`0320`), vérifications en ajout seul (`0321`, `MPX01`), dérogations motivées (`0322`, `MPX02`), séparation des tâches entre dérogation et clôture (`0323`, `MPX03`) |
  | `0330–0332`   | salle de mission (CLI-01, vague 2) : demandes documentaires, pièces, dépôts et historique du statut (`0330`, `MPL01-05`), `fichier_orphelin` étendu à `salle_depots.fichier_id` et `octets_stockage_utilises` en `SECURITY DEFINER` (`0331`), durcissement d'audit : mission clôturée, plafonds et débit des dépôts, acceptation par le déposant (`0332`, `MPL06-09`) |
  | `0360–0363`   | appels d'offres (lot AO-A, vague 3, plage réservée `0360–0379`) : fiches, événements, évaluations et décisions go/no-go (`0360`, AO-01, AO-02), dossiers, extractions, matrice de conformité et son suivi (`0361`, AO-03), rétro-planning (`0362`, AO-08), acquittement des nombres non vérifiés d'une extraction (`0363`, `MPA07`) ; `MPA01-07` |
  | `0364–0367`   | veille multi-sources des appels d'offres (AO-01, lot 5b, même plage `0360–0379`) : activation des sources par cabinet (`0364`, aucune ligne = source désactivée ; adaptateurs SIMULÉS), résultats dédoublonnés et leur statut (`0365`, plafond de 5 000 par cabinet), occurrences en ajout seul (`0366`, plafond de 500 par résultat), décisions en ajout seul (`0367`) ; 4 tables, `portail_interdit` ; `MQA01-05` |
  | `0380–0386`   | banques et offres d'appels d'offres (lot AO-B, vague 3, plage réservée `0380–0399`) : banque de CV, versions datées et gabarits par bailleur (`0380`, AO-04), références, versions et pièces justificatives (`0381`, AO-05), offres techniques, versions et validations (`0382`, AO-06), offres financières et versions calculées (`0383`, AO-07), `fichier_orphelin` étendu aux pièces (`0384`, reprend aussi `salle_depots` de `0331`), séparation des tâches à la validation d'une offre technique (`0385`, `MPW05`), anonymisation d'un CV (`0386`, `anonymiser_cv_ao`, `MPW06`) ; `MPW01-06` |
  | `0400–0404`   | notation augmentée (lot NOT, vague 2, plage réservée `0400–0419`) : banque d'items versionnée et sélections du questionnaire adaptatif (`0400`, NOT-09, `MPN08-09`), paramètres et indices de confiance, garde de publication (`0401`, NOT-11, `MPN10`), calibration entre évaluateurs (`0402`, NOT-13, `MPN11`), initiatives types, impacts observés et plans d'action de notation (`0403`, NOT-17, `MPN12` ; bibliothèque `notation_initiatives_types` à rapprocher de celle du lot PLA, PLA-13), plancher du seuil (0,3) et de la cible de répondants (2) de confiance (`0404`, contraintes `CHECK`) |
  | `0420–0424`   | plans stratégiques augmentés (lot PLA, plage réservée `0420–0439`) : cascade en graphe (`0420`, PLA-12), bibliothèque d'initiatives types (`0421`, PLA-13, `MPS07`) et son amorçage standard (`0422`), priorisation du portefeuille et arbitrage tracé (`0423`, PLA-14, `MPS08`), modèle de rapport « dossier bancaire » (`0424`, PLA-17, `MPR03`) |
  | `0425–0426`, `0429–0432` | plans stratégiques augmentés, suite (lot PLA) : ateliers en ligne, options et participants (`0425`, PLA-15), contributions versionnées et lignes (`0426`), simulation de Monte-Carlo en ajout seul (`0429`, PLA-16), réalisés trimestriels versionnés (`0430`, PLA-18) re-prévisions versionnées (`0431`) et trace de débit du rejeu de la simulation, `plan_rejeux_montecarlo` (`0432`, lot 8b : 5 rejeux par plan et par 10 minutes, verrou consultatif par plan, purge à une heure, RLS `isolation` et `portail_interdit`, aucun nouveau SQLSTATE : l'API répond 429 `TROP_DE_REJEUX`) ; politiques `portail` dans chaque fichier ; `MQL01-08` et `MQL10-24` ; `0427–0428` et `0433–0439` libres |
  | `0440–0445`   | pilotage augmenté des KPI (lot KPI, vague 2, plage réservée `0440–0459`) : arbres d'indicateurs et nœuds (`0440`, KPI-13), revues de performance et décisions (`0441`, KPI-17), actions correctives et leurs événements (`0442`, KPI-18), compte rendu figé à la tenue de la revue (`0443`, `MPK22`), action rattachée à une revue tenue seulement (`0444`, `MPK26-27`), plafonds d'un arbre appliqués à la réactivation et au total (`0445`, `MPK12-13`) ; `MPK10-16` et `MPK20-27` |
  | `0460–0465`   | capitalisation (lot CAP, vague 3, plage réservée `0460–0479`) : retours d'expérience versionnés et recherche plein texte (`0460`, CAP-01), base d'estimation par brique (`0461`, CAP-02), analyse des dérogations (`0462`, CAP-05), matrice de compétences (`0463`, CAP-06), index de la recherche unifiée (`0464`, CAP-07), durcissements d'audit : déclarations de niveau bornées, validation du retour réservée à un responsable (`0465`, `MPJ06-08`) ; `MPJ01-08` |
  | `0466–0467`   | capitalisation, efficacité des recommandations (CAP-03, lot 5b) : recommandations (`0466`) et instantanés d'efficacité en ajout seul, calculés par le moteur (`0467`) ; 3 tables ; `MQK01-05` |
  | `0470–0472`   | capitalisation, observatoire inter-cabinets (CAP-04, lot 5b) : adhésions en ajout seul (`0470`, `MQK20-21`), contributions sans identifiant de client (`0471`, `MQK22-23`), fonction `obs_agregats` en `SECURITY DEFINER`, seul chemin inter-cabinets (`0472`, `MQK24-27`) ; `obs_adhesion_active` n'est PAS `SECURITY DEFINER` ; `MQK20-27` |
  | `0480–0486`   | redressement (service #5, lot 3a, vague 4, plage réservée `0480–0499`) : fonctions communes `red_*` et dossier (`0480`, `red_dossiers`), correspondance de postes (`0481`, RED-02), évaluations d'urgence (`0482`, RED-01), seuils d'alerte versionnés par secteur et scores (`0483`, RED-10), créanciers, créances, négociations et échéances d'accord (`0484`, RED-12), trésorerie à 13 semaines : versions, lignes et réalisés (`0485`, RED-11), actions du plan, événements et versions de plan (`0486`, RED-05, RED-07) ; 15 tables, aucune fonction `SECURITY DEFINER` ; `MPZ01-11` |
  | `0487–0492`   | redressement, lot 3a-bis (même plage `0480–0499`) : check-lists métier (`0487`, RED-03, `MPZ12`), causes racines et historique en ajout seul (`0488`, RED-04, `MPZ13-14`), covenants et plan de financement (`0489`, RED-06, `MPZ15-16`), bilan de clôture (`0490`, RED-08, `MPZ17-18`), suivi post-mission (`0491`, RED-09, `MPZ19-20`), validation du plan et du bilan réservée au directeur de la mission, redéfinit `red_controler_plan_version()` et `red_controler_cloture()` (`0492`, `MPZ07` au message distinct, aucun nouveau code) ; 15 tables de plus (30 au total), aucune fonction `SECURITY DEFINER` ; `MPZ12-20` |
  | `0500–0509`, `0511` | due diligence (service #2, lot 3b, vague 4, plage réservée `0500–0519`, ADR-012) : socle et cadrage versionné (`0500`, DD-01, `MPZ21`), bibliothèque de signaux (`0501`, DD-11), éléments typés et constats (`0502`), hypothèses, verdicts et validations (`0503`, DD-09), dimensionnement de marché (`0504`, DD-12), filtrage environnemental et social (`0505`, DD-14), ajustements des experts (`0506`, DD-08), note au comité versionnée et validée (`0507`, DD-13), modèle de rapport `note_comite` qui redéfinit les CHECK de `rapports_mission` (`0508`, `MPR04`), portail investisseur : option du cabinet, invitations, publications et retraits (`0509`, `MQD01-08`), modèles d'analyse par secteur, vides par défaut (`0511`, DD-07, `MQD11`) ; `0510` et `0512–0519` libres ; `MPZ21-32` et `MQD` |
  | `0521–0524`   | ingestion de documents (lot 6, ADR-009, plage `0520–0539` attribuée par le superviseur) : `ingestion_documents` (texte des pages, document analysé puis effacé du stockage, aucune clé étrangère vers `fichiers`) et `ingestion_pages` (`0521`, `MQG01`, `MQG03`), brouillons `ingestion_extractions` (`0522`, `MQG02`), origine « pdf » de `dossier_etats_financiers` (`0523`, CHECK seulement), `purger_textes_ingestion` et `planifier_ingestion_maintenance` en `SECURITY DEFINER` (`0524`) ; 3 tables, RLS `isolation` et `portail_interdit` ; ne redéfinit ni `rapports_mission`, ni `fichier_orphelin`, ni `tentatives_auth_regles` ; `MQG01-03` |
  | `0525–0526`   | ingestion de documents, OCR local (lot 11, ADR-009, même plage `0520–0539`) : méthode de lecture `ocr` admise (CHECK de `ingestion_documents` et `ingestion_pages` retrouvés par leur définition puis remplacés) et colonne `ingestion_documents.corrections_ocr` (tableau JSON borné à 100 entrées et 40 000 octets, sans clé étrangère) (`0525`) ; purge de `corrections_ocr` avec le texte des pages (décision + 90 jours) : REDÉFINIT `purger_textes_ingestion` (identique à `0524` plus `corrections_ocr = NULL`, `SECURITY DEFINER`) et le déclencheur `controler_ingestion_document` (identique à `0521` sauf la branche de datation de la purge) (`0526`) ; aucune table, aucun nouveau code `MQG` |
  | `0540–0548`   | canaux externes simulés (lot 3c, vague 4, plage réservée `0540–0559`, ADR-008, ADR-010, ADR-013) : comptes de canal (`0540`, `MPH04`), destinataires et consentements (`0541`), journal d'envois sans contenu et événements reçus (`0542`), propositions de saisie de KPI (`0543`), espaces `webhook_canal` et `webhook_invalide` du limiteur et planifications (`0544`, redéfinit `tentatives_auth_regles`), transcriptions (`0545`, `MPH06-07`), demandes de signature (`0546`, `MPH08-09`, `MPH11`), preuves chaînées (`0547`, `MPH10`), fichiers audio et `fichier_orphelin` étendue (`0548`) ; `MPH01-12` |
  | `0549`        | canaux : option `canaux_comptes.alerte_kpi`, désactivée par défaut (alertes de KPI par WhatsApp vers des responsables internes) ; aucun nouveau code |
  | `0550`        | brief : espace `brief_requetes` du limiteur persistant (60 requêtes par 10 minutes et par utilisateur) ; REDÉFINIT `tentatives_auth_regles` avec ses 6 espaces ; hors plage AUT par construction (voir ci-dessous) |
  | `0551`        | redressement : modèle de rapport `cloture_redressement`, niveau `red`, colonne `red_cloture_id` ; REDÉFINIT les CHECK de `rapports_mission` et `controler_source_rapport()` (`MPR05`) |
  | `0552`        | dossier client : modèle de rapport `etat_financier`, niveau `dossier` ; REDÉFINIT les CHECK de `rapports_mission` |
  | `0560–0563`   | services candidats (lot 7, plage attribuée par le superviseur) : service et méthode du standard `diagnostic_flash` v1 publiée (`0560`), service et méthode `business_plan_bancable` v1 publiée (`0561`), prix fixe par cabinet et par service (`0562`), guichets de financement du cabinet, sans suppression (`0563`, `MQV01-02`) ; 2 tables, `portail_interdit` ; contenu des méthodes PROVISOIRE, `a_valider = true` |
  | `0570–0573`   | plateforme, super admin (chantier du 2026-10-23, plage `0570–0579` attribuée par le superviseur) : colonnes `cabinets.actif` et `cabinets.est_demo` réservées au propriétaire par déclencheur, et REDÉFINITION de `trouver_connexion` et `resoudre_session` (un cabinet désactivé coupe la connexion et les sessions) (`0570`) ; tables `super_admins`, `plateforme_sessions` (jeton haché, 8 h) et `journal_plateforme` en ajout seul (`0571`) ; fonctions de connexion et de session (`0572`) et d'opération (`0573`) ; 3 tables, `portail_interdit`, aucun droit direct du rôle applicatif ; 11 fonctions `SECURITY DEFINER` `plateforme_*` accordées (5 en `0572`, 6 en `0573`) ; `MQP01-06` |
  | `0580–0583`   | démonstration (même chantier, plage `0580–0589`) : fonctions `demo_*` de la connexion « un clic » (`0580` : liste et recherche des comptes `est_demo`, session de plateforme du super admin de démo), `demo_super_admin_est_demo` (`0581`), bac à sable du super admin de démo (`0582` : REDÉFINIT les six fonctions `plateforme_*` d'opération de `0573` ; cabinets `est_demo` seuls visibles, adresses `.test`, plafonds de 30 cabinets et de 40 comptes par cabinet), liste sans comptes 2FA (`0583` : fonction interne `demo_tfa_bloquante`, non accordée, et REDÉFINITION de `demo_lister_comptes`, même signature et mêmes droits) ; aucune table, aucun nouveau SQLSTATE ; 5 fonctions `demo_*` accordées |

  Plages libres : `0151–0159`, `0161–0169`, `0170–0179`, `0185–0199`. Plages
  réservées par lot (PRD complémentaire) : `0200–0219` référentiel de méthodes
  (STD), `0220–0239` dossier client (DOS), `0240–0259` registre des preuves
  (PRV), `0260–0279` agents IA (AGT), `0280–0299` qualité (QUA), `0360–0379`
  appels d'offres (AO-A), `0380–0399` banques et offres d'appels d'offres
  (AO-B), `0400–0419` notation augmentée (NOT), `0420–0439` plans stratégiques
  augmentés (PLA), `0460–0479` capitalisation (CAP), `0480–0499` redressement
  (RED, vague 4 ; `0487–0499` : lot 3a-bis et durcissements d'audit, un numéro par
  correctif), `0500–0519` due diligence (DD, SPEC-3b) et `0540–0559` canaux simulés
  (SPEC-3c), déclarées dans l'en-tête des migrations de leur lot ; `0520–0539`
  ingestion de documents (lot 6), plage attribuée par le superviseur et NON déclarée dans l'en-tête des
  migrations `0521–0526` (consommées ; `0520` et `0527–0539` libres). Pour l'automatisation (`0300–0319`), la clôture (`0320–0329`), la
  salle de mission (`0330–0339`) et les KPI augmentés (`0440–0459`), aucune
  migration ne déclare de plage : ces bornes sont la convention de ce document
  (à confirmer ; `0340–0359` reste sans affectation). Un durcissement issu d'audit
  prend le numéro suivant de son domaine.

  **Queue `≥ 0549` : numéros attribués CENTRALEMENT par le superviseur**, jamais
  « le numéro suivant » pris par un lot. Le migrateur applique les fichiers par
  ordre alphabétique de nom : une redéfinition d'un objet partagé n'a d'effet que si
  son numéro est supérieur à celui de toutes les définitions existantes, d'où des
  numéros hors plage de domaine. Attribués : `0549` canaux (alerte de KPI), `0550`
  brief (limiteur persistant), `0551` redressement (rapport de clôture), `0552`
  dossier (rapport d'état financier) ; l'ingestion de documents (lots 6 et 11) `0521–0526` se trouve dans la plage
  `0520–0539`, donc hors de cette queue (aucune redéfinition d'objet partagé : `0526` ne redéfinit que des objets
  de l'ingestion, `purger_textes_ingestion` et `controler_ingestion_document` ; prochain libre `0527`) ;
  services candidats (lot 7) `0560–0563` (prochains libres de cette attribution : `0564–0569`) ;
  plateforme et démonstration (chantier du 2026-10-23) `0570–0573` et `0580–0583`, consommées
  (prochains libres : `0574–0579` pour la plateforme, `0584–0589` pour la démonstration). Trois objets
  partagés y sont redéfinis : `trouver_connexion` et `resoudre_session` (`0570`, colonne `cabinets.actif`),
  les six fonctions d'opération `plateforme_*` (`0582` redéfinit celles de `0573`) et `demo_lister_comptes` (`0583` redéfinit celle de `0580`) ; toute nouvelle
  redéfinition porte un numéro supérieur et reprend la définition en vigueur ; `0553–0559` non
  attribués (à demander au superviseur).
  Deux objets partagés sont REDÉFINIS en entier à chaque évolution :
  - `tentatives_auth_regles` (limiteur persistant) : la définition en vigueur est
    celle de `0550`, avec ses 6 espaces (`connexion`, `reauth`, `facteur`,
    `webhook_canal`, `webhook_invalide`, `brief_requetes`). Toute nouvelle
    redéfinition porte un numéro SUPÉRIEUR à `0550` et reprend les 6 espaces
    (`0306` est consommé par `avancement_parametres` et ne doit pas servir à la redéfinir : `0544` puis `0550` l'écraseraient).
  - CHECK de `rapports_mission` (`modele_check`, `niveau_check`, `source_check`) et
    `controler_source_rapport()` : redéfinis par `0508`, `0551` puis `0552`. Toute
    nouvelle redéfinition porte un numéro supérieur à `0552` et reprend l'UNION en
    vigueur (relire `0552_rapports_etat_financier.sql`) : modèles `etat_avancement`,
    `notation`, `plan_strategique`, `dossier_bancaire`, `note_comite`,
    `cloture_redressement`, `etat_financier` ; niveaux `base`, `jours`, `finance`,
    `notation`, `plan`, `dd`, `red`, `dossier`. Oublier une valeur la supprime.

  Prochain numéro libre au 2026-10-22 : plans (V1) `0185`, automatisation `0309`
  à `0319` (`0303` à `0308` consommées), clôture `0324`, salle de mission
  `0333`, AO-A `0368` (`0368–0379` libres), AO-B `0387`, notation augmentée `0405` (`0405–0419` libres),
  plans augmentés `0427` (`0427–0428` puis `0433–0439` libres), KPI augmentés
  `0446`, capitalisation `0468` (`0468–0469` puis `0473–0479` libres), redressement `0493` (`0493–0499`), due diligence
  `0510` puis `0512` (`0512–0519` libres), STD `0211`, DOS `0226`, PRV `0244`,
  QUA `0291`, AGT aucun (plage `0260–0279` épuisée par `0278` et `0279` ; `0269` reste inutilisé comme `0144`), services
  candidats `0564` (`0564–0569` libres), plateforme `0574` (`0574–0579` libres), démonstration `0584` (`0584–0589` libres), ingestion de documents `0527` (`0527–0539` libres ; `0525–0526` consommées par le lot 11). Une
  migration **commitée** n'est jamais modifiée : on ajoute un
  fichier (voir §10 : l'outil ne le vérifie pas). Une migration encore **non
  commitée** peut être corrigée sur place, à condition de recréer les bases qui
  l'ont appliquée (les bases de test le sont à chaque exécution). Au 2026-10-22,
  `origin/main` (`3d5a252`) compte 180 fichiers (`git ls-tree origin/main apps/api/migrations/ | wc -l`) et
  la branche d'intégration (lots 9e, 11 et 12) en compte 232, tous commités (`ls apps/api/migrations | wc -l` et
  `git ls-files apps/api/migrations | wc -l`) : les 52 de plus
  (`0210`, `0225`, `0275`–`0279`, `0287`–`0290`, `0305`–`0308`, `0364`–`0367`,
  `0425`, `0426`, `0429`–`0432`, `0466`, `0467`, `0470`–`0472`,
  `0487`–`0492`, `0509`, `0511`, `0521`–`0526`, `0549`–`0552`, `0560`–`0563`) sont des ajouts,
  aucune modification ni suppression par rapport à `origin/main`
  (`git diff --name-status origin/main -- apps/api/migrations` ne rend que 52 lignes `A`) : toutes sont
  immuables dès la fusion de la branche dans `main`. Au 2026-10-23, la branche du chantier super admin (copie `super-admin-lot-4`) compte 239 fichiers (`ls apps/api/migrations | wc -l`) ; la tête du lot 7 en compte 240 (avec `0583`) : les 8 de plus que les 232 ci-dessus sont `0570`–`0573` et `0580`–`0583`, des ajouts (`git log --diff-filter=MD --name-only --format= -- apps/api/migrations` ne rend rien).
- Les imports relatifs de l'API portent l'extension `.js` (ex.
  `import … from "../audit.js"`).
- Le web appelle l'API uniquement par `/api/*` relayé par Next
  (`apps/web/next.config.mjs`).
- **Seed « Tenant démo » (2026-10-24), territoire `apps/api/src/db/tenant-demo/`** (point d'entrée
  `apps/api/src/db/seed-tenant-demo.ts`, mode d'emploi : RUNBOOK « Tenant démo »). Aucune migration (la plage démonstration
  `0584–0589` reste libre) ; le seed n'importe que `apps/api` et les paquets du dépôt, car il tourne dans l'image de production.
  - **Contrat de phase** : une phase est `{ nom, executer(ctx) }` (`PhaseTenantDemo`, `phases/index.ts`, registre ORDONNÉ) ; le
    socle (`socle.ts`) remplit `ContexteTenantDemo` (`contexte.ts` : sessions par clé de compte, identifiants de collaborateurs,
    clients, grades, types de mission, horloge fictive, hasard à graine) ; une phase ne lit les travaux des phases précédentes
    que par les routes ou par une requête sur le nom exact de la ligne, jamais par un champ ajouté au contexte. Le nom de la phase
    est son marqueur d'idempotence (journal d'audit, action `semis_tenant_demo`) et l'option `--phase=`.
  - **Une phase = un fichier mince + un dossier** : `phases/<nom>.ts` n'appelle que des modules de `tenant-demo/<domaine>/` ; un
    fichier reste sous 400 lignes ; les jeux de données vont dans des fichiers `donnees-*.ts` (aucune logique) à côté du module
    qui les consomme.
  - **Routes d'abord** : tout ce qu'une vraie route sait faire passe par `ctx.session("<clé>")` avec le rôle qui a la permission
    (traçabilité, audit, moteurs de `packages/engines`) ; le SQL du rôle propriétaire (`ctx.proprietaire`) est réservé à ce que les
    routes interdisent (dates passées, tables sans route). Les chiffres sortent des moteurs, jamais écrits à la main.
  - **Aucune interpolation d'un nom de table ou de colonne** dans une requête du seed : requêtes littérales uniquement, avec
    paramètres `$n` ; `antidater` (`contexte.ts`) est à LISTE FERMÉE (`TableAntidatable` : `cabinets`, `utilisateurs`,
    `collaborateurs`, `clients`, `contacts_client`, une requête littérale par table) ; un autre antidatage s'écrit en requête
    littérale dans le module de la phase.
  - **Levée de déclencheurs** : seulement par `transactionAntidatage` (`missions/declencheurs.ts`, 7 déclencheurs nommés, ordre fixe,
    `lock_timeout`) ou, pour une colonne de date d'une table en ajout seul, `appliquerSql` (`redressement-dd/commun.ts`) ; jamais
    pour contourner une règle métier (SECURITY.md §15).
  - **Déterminisme** : dates par l'horloge fictive (`ctx.jour`, `ctx.dateAvant`, `ctx.aujourdhui`) et hasard par
    `ctx.alea.deriver("<phase>")` ; jamais `Math.random()` ni `Date.now()` pour une donnée métier. Les écritures par routes portent
    pourtant l'horloge réelle (limite déclarée, SECURITY.md §15).
  - **Reprise** : une étape longue se marque (`semis_tenant_demo_etape`) ou se reprend par clé naturelle ; sinon elle échoue avec un
    message clair. Aucune clé IA (le semis refuse `OPENROUTER_API_KEY`), aucun envoi réel, adresses en `@tenant-demo.test`.
  - **Tests** : un fichier `apps/api/test/seed-tenant-demo-<domaine>.test.ts` par domaine (tables non vides plus deux ou trois
    invariants métier) ; `seed-tenant-demo.test.ts` est celui du socle ; une base `_test` par suite.

## 2. Nommage

- **Base de données** : français sans accents, `snake_case`, pour tables et
  colonnes (`journal_audit`, `mot_de_passe_hash`, `cree_le`, `sequences_facturation`).
  Pluriel pour les tables d'entités. Montants en colonnes `bigint` ; identifiants
  `uuid` ; `cabinet_id` sur toute table métier.
- **Code** : identifiants métier en français (`exigerMissionVisible`,
  `journaliser`, `creerLimiteur`), types et fonctions en `camelCase`, constantes
  en `MAJUSCULES` (`DUREE_SESSION_MS`). Fichiers en `kebab-case`
  (`double-authentification.ts`, `confirmer-identite.ts`).
- **JSON de l'API** : clés en `snake_case` français (`mot_de_passe`,
  `tfa_active`, `curseur_suivant`), identique aux colonnes.
- **Permissions** : `domaine.action` (`finance.lire`, `facture.emettre`,
  `portail.kpi.saisir`), `packages/shared/src/roles.ts`.
- **Codes SQLSTATE métier** : `MP` + lettre de domaine + numéro. Lettres
  employées : `F` figé (propositions, budget, absences), `T` temps, `B`
  facturation, `E` encaissements et bilans, `D` documents, `C` commentaires,
  `I` IA, `P` portail, `Q` questionnaires, `N` notation (`MPN01-07`, dont
  `MPN06-07` du calcul par la méthode, `0206`, puis `MPN08-12` de la notation
  augmentée, `0400`–`0403`), `K` KPI (`MPK01-07`, puis `MPK10-16` et
  `MPK20-27` du pilotage augmenté, `0440`–`0445`), `S` plans stratégiques
  (`MPS01-06`, puis `MPS07-08` de la bibliothèque et du portefeuille, `0421` et
  `0423`), `R` rapports (`MPR01-02`, `0131`, puis `MPR03` du dossier bancaire,
  `0424`, `MPR04` de la note au comité, `0508`, et `MPR05` du rapport de clôture
  du redressement, `0551`), `Y` qualité (`MPY01-11`, `0280`–`0286`), `V` preuves
  (`MPV01-07`, `0240`–`0243`), `O` dossier client (`MPO01-04`,
  `0220`–`0224`), `G` agents IA (`MPG01-15`, `0260`–`0267`, `0270`, `0271`, `0274` et
  `0275` ; `MPG09` : demande de rejeu réel incohérente ; `MPG10-11` : proposition
  d'action du copilote terminée, transition interdite ou identité modifiée ;
  `MPG12` : écriture réservée au job de rejeu, `MPG13` : job invalide ou
  contexte absent, `MPG14` : demande dans un état incompatible, `MPG15` :
  paramètre invalide, tous de `0275` ; reste `MPG16-20`), `M`
  référentiel de méthodes (`MPM01-08`, `0201`–`0209`), `U` automatisation
  (`MPU01-05`, `0300`–`0301` ; `0303`, `0304` et `0305` n'ajoutent aucun code), `X` check-list de clôture (`MPX01-03`,
  `0321`–`0323`), `L` salle de mission (`MPL01-09`, `0330` et `0332`), `A`
  appels d'offres (`MPA01-07`, `0360`–`0363`), `W` banques et offres d'appels
  d'offres (`MPW01-06`, `0380`–`0386`), `J` capitalisation (`MPJ01-08`,
  `0460`–`0465`), `H` canaux simulés (`MPH01-12`, `0540`–`0548` ; `0549` n'ajoute
  aucun code), `Z` redressement (`MPZ01-20`, `0480`–`0492` : `MPZ01-11` pour
  `0480`–`0486`, `MPZ12-20` pour `0487`–`0491`, `0492` réutilisant `MPZ07` avec un
  message distinct) et due diligence (`MPZ21-32`, `0500`–`0507` et `0509`). `MPT01` ne
  désigne plus que les feuilles de temps : l'identité figée des tâches assignées
  est `MPC02` (`0076`). Un nouveau code prend un numéro libre de sa lettre
  (liste : `SECURITY.md` §6).
  **Plus aucune lettre simple libre** (relevé du 2026-10-21 : `grep -ohE
  "MP[A-Z][0-9]{2}" apps/api/migrations/*.sql | cut -c3 | sort -u` rend les 26
  lettres, de `A` à `Z`). La lettre `Z` est épuisée pour le redressement
  (`MPZ01-20`) : les codes `MPZ21-32` de la due diligence en sont le dernier
  partage, une exception qui ne se reproduit pas. **Règle en vigueur pour tous les
  lots suivants** : un second préfixe de deux lettres `MQ` + lettre de domaine +
  deux chiffres, déclaré dans ce document et dans l'en-tête de la première
  migration du lot, et jamais un numéro déjà employé par un autre lot d'une même
  lettre. Préfixes `MQ` déclarés (relevé du 2026-10-22, lot 6 compris ; `grep -ohE "MQ[A-Z][0-9]{2}" apps/api/migrations/*.sql | cut -c1-3 | sort -u` rend `MQA`, `MQD`, `MQF`, `MQG`, `MQI`, `MQK`, `MQL`, `MQQ`, `MQS`, `MQU`, `MQV` ; `MQP` (plateforme, `0570` à `0582`) s'y ajoute depuis le chantier du 2026-10-23 ; `MQC` et `MQN` sont déclarés sans code employé) :

  | Préfixe | Domaine                              | Codes employés                                                                                         | Migrations      |
  | ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------- |
  | `MQD`   | due diligence, suite                 | `MQD01-08` portail investisseur, `MQD11` modèles sectoriels ; libres : `MQD09-10`, `MQD12-20`          | `0509`, `0511`  |
  | `MQC`   | canaux                               | déclaré, aucun code employé                                                                            | aucune          |
  | `MQS`   | référentiel de méthodes              | `MQS01-02` facteur figé, retrait de valeur interdit ; libres : `MQS03+`                                | `0210`          |
  | `MQQ`   | qualité, revue à froide              | `MQQ01-13` (`MQQ13` : relecteur non remplaçable une fois la revue commencée) ; libres : `MQQ14+`   | `0287`–`0290`   |
  | `MQF`   | dossier client, groupes et filiales  | `MQF01-04` cycle, total des parts, fin sans détention antérieure, profondeur de 8 liens ; libres : `MQF05+` | `0225`          |
  | `MQL`   | plans stratégiques augmentés         | `MQL01-08` ateliers, `MQL10-14` Monte-Carlo, `MQL15-24` plan vivant ; `MQL09` réservé non employé ; libres : `MQL25+` | `0425`–`0431`   |
  | `MQN`   | notation                             | déclaré, aucun code employé                                                                            | aucune          |
  | `MQK`   | capitalisation (lot 5b)              | `MQK01-05` efficacité des recommandations (CAP-03), `MQK20-27` observatoire (CAP-04 : historique, transition, versement, immutabilité, `MQK24` hors cabinet ou portail, `MQK25` non adhérent, `MQK26` indicateur inconnu, `MQK27` adhérent sans contribution éligible) ; plages réservées `MQK01-19` (efficacité) et `MQK20-39` (observatoire) ; libres : `MQK06-19`, `MQK28-39` | `0466`–`0467`, `0470`–`0472` |
  | `MQA`   | appels d'offres, veille (lot 5b)     | `MQA01-05` historique en ajout seul, transition de statut refusée, plafond de 5 000 résultats par cabinet, plafond de 500 occurrences par résultat, décision incohérente ; libres : `MQA06+` | `0364`–`0367`  |
  | `MQV`   | services candidats (lot 7)           | `MQV01` identité d'un guichet figée, `MQV02` plafond de 500 guichets par cabinet ; libres : `MQV03+`  | `0563`          |
  | `MQI`   | IA : cache et contradicteur (lot 4c) | `MQI01` écriture du cache refusée quand il est désactivé pour le cabinet, `MQI50` revue contradictoire incohérente (brouillon relu introuvable, revue relue, mission différente) ; libres : `MQI02-49`, `MQI51+` ; l'unicité de la revue active est portée par l'index unique partiel (SQLSTATE 23505), non par un code | `0278`, `0279` |
  | `MQU`   | rapport d'avancement (AUT-10, lot 4c) | `MQU01` rapport validé figé, `MQU02` validateur non autorisé, `MQU03` naissance hors brouillon ou identité modifiée, `MQU04` client différent de celui de la mission, `MQU05` mission non active, `MQU07` suppression interdite ; `MQU06` non employé ; `MQU08-10` réservés au chantier ; libres : `MQU11+` | `0306`, `0307` |
  | `MQG`   | ingestion de documents (lot 6)       | `MQG01` transition de statut ou identité d'un document (pas de suppression, naissance « en_file », identité figée, document terminé non modifiable), `MQG02` extraction : machine à états, séparation des tâches (le valideur n'est ni l'auteur du téléversement, ni le demandeur de la lecture, ni le dernier modificateur, sauf associé) et identité, `MQG03` version cible d'un amorçage (brouillon du cabinet) ; libres : `MQG04+` | `0521`, `0522` |
  | `MQP`   | plateforme, super admin (2026-10-23) | `MQP01` session de plateforme invalide ou expirée, ou super admin inactif (API : 401), `MQP02` cabinet introuvable (404 ; pour un super admin de démo, aussi tout cabinet qui n'est pas de démonstration), `MQP03` utilisateur introuvable dans ce cabinet ou compte du portail client (404), `MQP04` paramètre invalide (rôle hors des 8 rôles du cabinet, liste de rôles vide, trop longue ou avec doublon, nom, e-mail, pays ou haché invalide, modification sans champ ; en démonstration, adresse hors `.test` ou plafond atteint, avec un indice stable) (400), `MQP05` l'opération laisserait le cabinet sans associé actif (409), `MQP06` `journal_plateforme` en ajout seul (UPDATE, DELETE et TRUNCATE refusés, même au propriétaire) ; libres : `MQP07+` | `0570`–`0573`, `0582` |

  Les ADR-010 et ADR-013 citaient `MPH11` et `MPH07` avant le lot canaux : ils sont
  tranchés, `MPH11` (empreinte du document signé, `0546`) et `MPH07` (validation
  d'une transcription, `0545`) sont employés ; `MPH01-12` le sont tous. Un code de
  rapport (`MPR…`) reste dans la lettre `R`.
  **Codes à plusieurs sens** (relevé du 2026-10-08, à ne pas aggraver) : un code
  désigne une FAMILLE de refus, et c'est l'API qui choisit le message ; un
  nouveau cas prend un NUMÉRO NEUF plutôt que de rejoindre une famille.
  `MPW01` : ajout seul d'une banque ou d'une offre (`0380`, `0386`) mais aussi
  pièce de référence qui ne se modifie que par son retrait motivé (`0381`) ;
  `MPW03` : rattachement incohérent d'une référence (mission et client, `0381`)
  mais aussi validation d'une autre version que la dernière (`0382`, `0385`) ;
  `MPL05` : modèle, demande ou pièce figés (identité, demande envoyée, close,
  `0330`, `0332`) ; `MPS02` : incohérence de plan, de version ou d'initiative
  (`0180`–`0184`, `0420`, `0423`) ; `MPK24` : décision hors d'une revue tenue ou
  dans une revue clôturée (`0441`) ; `MPN04` : publication ou validation par un
  expert métier, étendue de la notation (`0146`) aux grilles (`0145`) et aux
  items de la banque (`0400`). `MPK10`, `MPK11` et `MPK16` couvrent plusieurs
  tables de `0440`–`0445`. `MPZ07` : séparation des tâches à la validation d'une
  version de plan (`0486`) mais aussi, avec un message distinct, validation du plan
  ou du bilan de clôture par un autre que le directeur de la mission, ou d'une
  mission sans directeur (`0492`).
- **Codes d'erreur** : `MAJUSCULES_SOULIGNEES` (`NON_AUTHENTIFIE`, `INTERDIT`,
  `INTROUVABLE`, `REQUETE_INVALIDE`, `CONFLIT`, `ERREUR_INTERNE`, et codes de
  domaine comme `PORTAIL_ROUTE_INTERDITE`, `ORIGINE_REFUSEE`).

## 3. Couches et responsabilités

- **Routes** (`apps/api/src/routes/*.ts`) : plugin Fastify par ressource,
  enregistré sous `/api` via les regroupements `routes/*-routes.ts` /
  `referentiels.ts` (`app.ts`). Une route appelle `exiger(request, permission)`
  (ou `exigerPortail` côté portail), valide l'entrée par un schéma de
  `packages/shared`, ouvre `withTenant`, et délègue.
- **Logique par domaine** (`missions/`, `facturation/`, `finance/`,
  `planification/`, `temps/`, `auth/`, `notifications/`, `jobs/`, `stockage/`,
  `collaboration/`, `catalogue/`, et en V2 `ia/`, `portail/`,
  `questionnaires/`, `notation/`, `kpi/`, `plans/`, `rapports/`, puis, vagues 1 à 3,
  `agents/`, `dossier/`, `preuves/`, `qualite/`, `standard/`, `automatisation/`,
  `cloture/`, `salle-mission/`, `previsions/`, `appels-offres/`, `banque-ao/`,
  `capitalisation/`, puis, lacunes de la vague 2, `brief/` et `copilote/`, puis, vague 4,
  `redressement/`, `due-diligence/` et `canaux/`, puis, lot 6, `ingestion/`) : accès aux données et règles,
  dans la transaction reçue (`Db`). Une fonction ne commence pas sa propre transaction.
  - `ingestion/` (lot 6, ADR-009 ; `apps/api/src/ingestion/`) : réception d'un PDF ou d'un XLSX (type décidé
    par le contenu), jobs `ingestion_extraction` et `ingestion_structuration`, brouillons à valider
    (`ingestion_extractions`). Le fichier est analysé puis effacé, jamais conservé. Découpage : `pdf.ts` et
    `pdf-controle.ts` (pré-contrôle des flux compressés, dans un `worker_thread` dédié), `tableur.ts`,
    `ocr.ts` (port `Ocr` et adaptateur simulé `OcrSimule`, réservé au développement et aux tests),
    `ocr-local.ts` (adaptateur `OcrLocal`, OCR réel `tesseract.js` 7.0.0 hors ligne : un sous-processus par
    document, `ocr-processus.mjs`, enveloppé par `ocr-garde-reseau.cjs`, qui reste en CommonJS parce que
    `node --require` est le seul moyen de le rejouer dans les `worker_threads`, et par `ocr-veille.mjs`,
    veille de la mémoire), `fabrique.ts` (fabrique `creerOcr`, variable `OCR_LOCAL` = `auto` | `local` |
    `simule` | `off`), `apps/api/ocr-data/` (données de langue `tessdata_fast` 4.1.0 `fra` et `eng` vendorées,
    binaires déclarés dans `.gitattributes`, empreintes `SHA256SUMS` vérifiées par
    `node scripts/ocr-verifier-donnees.cjs` et au premier usage) et, côté moteurs purs,
    `packages/engines/src/ingestion/ocr-confusions.ts` (corrections proposées O/0, l/I/1, séparateurs :
    elles ne servent qu'à PROPOSER, l'état reste en revue). Un test du moteur OCR réel est conditionnel : sauté
    AVEC un message si le moteur manque, et `OCR_LOCAL_EXIGE=1` (posé dans le bloc `env` du job `api` de
    `.github/workflows/ci.yml`) le rend obligatoire. Une paire de fichiers par usage (`etat-financier.ts`, `structuration-dd.ts`,
    `structuration-standard.ts`…), `maintenance.ts` (purge du texte des pages), `erreurs.ts` (message
    factorisé `fichierTropVolumineux`). Les calculs et les règles de lecture sont des moteurs purs dans
    `packages/engines/src/ingestion` (ancrage strict des montants sur la page, contrôle FIN-02, vérification
    de la source), couverts à plus de 90 % comme tout `packages/engines` (seuil imposé par
    `vitest.config.ts`). Les plafonds (taille, pages, caractères, délai, quotas) sont dans
    `PLAFONDS_INGESTION` (`packages/shared/src/schemas/ingestion.ts`), jamais en littéraux dans les routes ;
    les paramètres de routes et les charges sont `.strict()` (`numeroPageParamsSchema`). Un document n'est
    jamais publié ni appliqué sans validation humaine par un autre que l'auteur (MQG02).
  - `redressement/` (service #5, lot 3a) : `acces.ts` (règle d'accès écrite en tête : mission visible
    d'abord, même 404 pour un sous-objet d'autrui), `dossiers.ts`, `correspondances.ts`, `ratios.ts`,
    `etats.ts` (états acceptés et courants du dossier client, lecture seule), `urgence.ts`, `alerte.ts`,
    `seuils.ts`, `tresorerie.ts`, `realises.ts`, `creanciers.ts`, `negociations.ts`, `actions.ts`,
    `plan.ts`, `leviers.ts`, `limites.ts` (débits comptés sur `journal_audit`), `erreurs.ts`
    (`traduireErreurRedressement` : `MPZ01-20`), `journal.ts` (identifiants et comptes seulement),
    `referentiel.ts` (constantes provisoires servies telles quelles), `vues.ts`, `pagination.ts`,
    `dates.ts` (le jour UTC est passé en paramètre au moteur, jamais d'horloge dedans) ; moteur pur `packages/engines/src/redressement`. Hors `causes-ia.ts` (lot 3a-bis, RED-04, SEUL fichier du module autorisé à importer `ia/` et jamais le fournisseur : il passe par `ia/orchestrateur.ts`, test `redressement-sans-ia.test.ts`), aucune IA, aucun job, aucun `SUM`/`AVG` : le moteur
    somme et compare, l'API verrouille le dossier (verrou consultatif) avant toute lecture dont dépend une
    règle. Les `LIMIT` littéraux de ce module répètent des plafonds de volume appliqués aussi en base
    (checklist, recherche n° 7 ; dette, §10).
  - `brief/` (AUT-07) : une source par type d'élément (`decisions.ts`, `validations.ts`, `derives.ts`,
    `envois.ts`), chacune derrière SA permission et la visibilité des missions, qui ne lit que des faits et
    les remet au moteur `packages/engines/src/brief` ; `calcul.ts` les assemble, `quotidien.ts` est la
    tâche quotidienne, `debit.ts` le plafond de débit de `GET /api/brief`. Aucune table, aucun appel IA.
  - `copilote/` (AGT-08) : `service.ts` (traitement d'un message), `routage-ia.ts` (appel du modèle qui
    ROUTE : le modèle ne voit aucune donnée), `lecture.ts` (outils de lecture), `actions.ts` (propose,
    confirme, annule : registre `ACTIONS`, une entrée par action modifiante), `catalogue.ts` (droit de
    chaque outil), `limites.ts` (débit, niveau d'autonomie), `purge.ts`, `erreurs.ts` ; moteur pur
    `packages/engines/src/copilote` (catalogue fermé, routage déterministe, gabarits de réponse). Un
    outil de plus : une entrée au catalogue du moteur, au droit de `catalogue.ts`, à `lecture.ts` ou à
    `ACTIONS`, et aux tests ; une action modifiante n'est jamais exécutée sans proposition confirmée.
    Le routage n'appelle plus le fournisseur : il passe par le point d'entrée `admettreSansDemande` /
    `appelerSansDemande` de `ia/orchestrateur.ts` (admission, plafond sous verrou, une tentative,
    règlement, coût `copilote = true`) ; aucun import de `fournisseurDepuisConfig` dans `copilote/`
    (test d'inventaire de `copilote-masquage-noms.test.ts`). Les actions réutilisent le service de la route
    correspondante, extrait sans changement de comportement : `collaboration/commentaires.ts` (depuis
    `routes/commentaires.ts`) et `finance/relance-manuelle.ts` (depuis `routes/relances.ts`).
  - **Plafond de débit** : par défaut compté sur `journal_audit` dans la transaction qui l'inscrit, sous
    verrou consultatif (modèles `routes/factures-pdf.ts`, `copilote/limites.ts`). Variante : le limiteur
    PERSISTANT de `auth/limiteur.ts` (`creerLimiteur`, règles fixées en base par `tentatives_auth_regles`),
    utilisé pour `GET /api/brief` (espace `brief_requetes`, `brief/debit.ts`, `0550`) ; le compteur
    en mémoire du brief a disparu (SECURITY.md §5 septies, §15).
- **Calculs : uniquement dans `packages/engines`.** Jours, montants, TVA,
  remises, marges, ratios, conversions, échéanciers, scores de notation, KPI,
  modèle financier ne se calculent ni dans les routes, ni en SQL (aucun
  `SUM`/`AVG`), ni dans le web. Les montants sont des entiers d'unités mineures
  (FCFA : 1 unité ; EUR/USD : centimes) ; `Montant` du moteur, `montantSchema`
  (`schemas/commun.ts`). Les pourcentages sont validés à quatre décimales.
- **Base** : aucune requête hors `withTenant` / `withoutTenant`
  (`db/pool.ts`) ; les règles qui doivent tenir même si le code est contourné
  (immuabilité, numérotation, périodes closes, séparation des tâches de la
  notation et des plans, cloisonnement du portail) sont des déclencheurs ou des
  politiques SQL.
- **Réveil du worker de jobs** (lot 13b, R-08, `apps/api/src/jobs/reveil.ts` : `signalerJobCree`,
  `ecouterJobCree`). Tout nouveau chemin qui crée un job d'ingestion appelle `signalerJobCree()` APRÈS son
  COMMIT, jamais dans la transaction (le worker lirait avant la validation) ; appelants actuels :
  `creerDocument` (`ingestion/documents.ts`) et les routes de relance `routes/ingestion-dd.ts` et
  `routes/ingestion-standard.ts`. `WorkerJobs` (`jobs/worker.ts`) s'abonne dans `demarrer` et se désabonne dans
  `arreter()` : réveil à 400 ms (`delaiReveilMs`), nouveau cycle 1 s après un cycle utile
  (`delaiEnchainementMs`), un seul rattrapage à 2 s (`delaiRattrapageMs`) quand un cycle déclenché par signal
  revient vide, puis retour à l'intervalle normal (30 s) ; deux cycles ne tournent jamais en parallèle. Le
  signal est local au processus.
- **Web** : `app/` pages et layouts, `lib/` logique pure testée, `components/`
  composants ; la garde d'une page est `exigerPermission` (`lib/session.ts`).
- **Rafraîchir les données après une écriture : `useRafraichir`** (lot 10, A-04,
  `apps/web/src/components/formulaires/useRafraichir.ts`). Un composant n'appelle pas `router.refresh()`
  directement : il prend `rafraichir` et `enAttente` du hook, qui lance le rafraîchissement dans la
  transition du composant, garde `enAttente` jusqu'à l'arrivée des données (ou au changement d'une `cle`
  passée au hook), relance une fois à 1,5 s (`DELAI_RELANCE_MS`, dédoublonnée au niveau du module : une
  requête `_rsc` de relance par page, même avec plusieurs instances) et abandonne l'attente à 8 s
  (`DELAI_SECOURS_MS`). `useFormulaire`, `useAttenteRafraichissement` et `useFermetureDifferee` l'utilisent
  déjà, ainsi que les composants du lot 6 (migrés par le lot 12). Seule exception voulue :
  `app/connexion/FormulaireConnexion.tsx`. `ingestion/ActualisationAuto.tsx` (rafraîchissement toutes les 3 s
  tant qu'un document est en cours de lecture) n'utilise volontairement pas le hook complet : sa relance à
  1,5 s et son suivi d'attente créeraient des requêtes RSC parasites à chaque tick. Il combine
  `useTransition()` et `rafraichirEnTransition` (exporté par `useRafraichir.ts`) et saute un tick tant que la
  transition du précédent n'est pas terminée (`doitSauterTick`, testée) : aucun empilement. Le projet n'a pas
  de jsdom : seul le noyau pur du hook est testé (`useRafraichir.test.ts`). Relevé du 2026-10-22 (lot 12,
  `rg -n "\.refresh\(\)" apps/web/src`) : plus aucun appel direct hors `FormulaireConnexion.tsx` (l. 60) ;
  les autres occurrences sont `useRafraichir.ts` (l. 19, 29, 56, 99, le seul appel réel étant l. 29) et son test
  (l. 13), et des commentaires de `useAttenteRafraichissement.ts` (l. 6) et `useFermetureDifferee.ts` (l. 8).
  La relance à 1,5 s et le secours à 8 s sont des filets : la cause des écrans périmés est traitée par
  `DebloqueurRendu` (règle suivante).
- **`DebloqueurRendu` : ne pas le retirer sans avoir vérifié A-04** (lot 13a, R-01, R-02 ;
  `apps/web/src/components/shell/DebloqueurRendu.tsx`, noyau pur testable `debloqueur.ts`, test
  `debloqueur.test.ts`, 13 tests). Monté dans `apps/web/src/app/layout.tsx` à côté de `<HorsLigne />`, il
  contourne un défaut du React 19.2 canary embarqué par Next 15.5.28 : sous une frontière Suspense
  (`loading.tsx`), le réveil est perdu quand un morceau Flight passe à `resolved_model` pendant le rendu ; la
  transition reste « suspendue » et l'ancien écran (ou un lien sans effet) demeure jusqu'à la prochaine mise à
  jour d'état. Après une réponse RSC ou un morceau de page, il programme quelques mises à jour d'état minuscules
  qui débloquent la transition. Cause démontrée par le lot 13a (`docs/workflows/notes-lots/lot-13a.md`). À
  revoir à chaque montée de Next ou de React. Après une écriture : utiliser `useRafraichir` ou
  `useFormulaire` ; ne pas ajouter de minuterie, de rechargement complet ni de `router.refresh()` répété pour
  « forcer » l'affichage. Un écran périmé se diagnostique par `root.suspendedLanes` (voir la note du lot 13a).
- **Libellés affichés : helpers du lot 13b.** Tout libellé de devise passe par `libelleDevise`
  (`lib/format.ts`) : « FCFA » pour XOF et XAF, en-têtes et consignes du plan et du redressement compris ; les
  codes stockés ne changent pas. Un poste d'état financier passe par `libellePosteEtat` et la cible d'un
  contrôle par `libelleCibleControle` (`lib/codes-lisibles.ts`) : un code de ligne généré type `L1_13` devient
  « Poste sans code source (page 1, ligne 13) », une cible « page 1, ligne 17 », et les codes du document
  (`TA1`) restent tels quels. `messageAucunePage` (`lib/ingestion-detail.ts`) ; `libellePeriode`
  (`lib/kpi-libelles.ts`) pour les périodes de KPI du rapport d'avancement ; `messageAuteurVerdict`
  (`lib/due-diligence.ts`) : un associé est dispensé de la séparation des tâches, le message « une autre
  personne doit le valider » n'est affiché qu'à l'auteur non associé.
- **403 métier d'une page serveur : `codes403Metier`** (lot 10, A-01, `lib/api-serveur.ts`).
  `appelerApiServeur` et `chargerServeur` redirigent tout 403 vers `/acces-refuse`, sauf si son code figure
  dans la liste opt-in `codes403Metier` de l'appel : l'erreur remonte alors à la page (`ErreurApi`, ou
  `{ ok: false, message, statut, code }` pour `chargerServeur`). `TFA_A_CONFIGURER`
  et `PORTAIL_ROUTE_INTERDITE` redirigent toujours ; `INTERDIT` et tout code non listé gardent leur
  redirection. Une page qui lit une route GET
  pouvant répondre un 403 MÉTIER (état du cabinet, pas un défaut de droits) DOIT déclarer ce code ; seul cas
  aujourd'hui : l'observatoire (`OBSERVATOIRE_CONTRIBUTION_REQUISE` et `OBSERVATOIRE_RESERVE_ADHERENTS`,
  `lib/observatoire.ts`). Les autres 403 à code métier sont des réponses d'écriture.
- **Le web reflète le droit de l'API, l'API reste la source de vérité.** Quand le web décide d'afficher ou
  d'activer une action selon une règle de l'API, il la reproduit dans `lib/` avec ses tests (modèle :
  `validationCauses`, `lib/redressement-droits.ts`, qui reproduit `validerCauses` : droit d'écriture, version
  au brouillon, refus de quiconque figure dans l'historique de la version, sauf l'associé) ; l'API refuse de
  toute façon.
- **Une page serveur ne passe jamais une FONCTION à un composant client** (fichier
  marqué `"use client"`) : seules des propriétés sérialisables traversent la
  frontière (texte, nombre, booléen, tableau ou objet simple). Une fonction fait
  échouer le rendu de la page (« Functions cannot be passed directly to Client
  Components »), qui devient illisible sans qu'aucun test de `lib/` ne le voie.
  Pour une action qui dépend de la réponse de l'API, passer un nom de champ ou un
  drapeau et laisser le composant client construire la fonction. Piège rencontré
  avec `/methodes/[id]` : `BoutonAction` recevait `destination` (une fonction) ;
  la propriété sérialisable `versionDans` (`"id"` ou `"version_id"`) la remplace
  (`components/methodes/BoutonAction.tsx`). À relire : les propriétés
  `={(…) =>` d'un composant importé de `components/` dans un fichier de `app/`
  qui n'est pas lui-même client.

## 4. Erreurs

- Erreur métier : `AppError(statut, code, message)` et ses fabriques
  (`nonAuthentifie`, `interdit`, `introuvable`, `requeteInvalide`, `conflit`) dans
  `apps/api/src/errors.ts`. Messages en français, sans donnée sensible.
- Enveloppe unique `{ "erreur": { "code", "message" } }` (plus `details` pour
  une erreur Zod, 400, ou pour une `AppError` qui en porte : champs en LISTE
  BLANCHE `CHAMPS_DETAILS_PUBLICS` d'`errors.ts` — `violations`, `erreurs`,
  `manquants` —, tableaux tronqués à 200) produite par `setErrorHandler`
  d'`app.ts` ; un plugin ne rend pas sa propre réponse d'erreur, il traduit puis
  relance (modèle `routes/qualite.ts`) ; une erreur
  inattendue répond 500 `ERREUR_INTERNE` et ne journalise que message, code,
  contrainte et table.
- Les violations PostgreSQL attendues (unicité 23505, référence 23503, SQLSTATE
  `MP…`) se traduisent par `traduireErreursPg` (`db/outils.ts`) ou par la couche
  métier du domaine (`finance/erreurs.ts`, `kpi/erreurs.ts`, `plans/erreurs.ts`,
  `questionnaires/erreurs.ts`, `agents/erreurs.ts` (`traduireErreurAgents`,
  aussi pour `MPG04` des routes `ia-prompts.ts` et `ia-parametres.ts` ; `MPG09`
  → 409 `EVALUATION_INCOHERENTE`), `copilote/erreurs.ts` (`traduireErreurCopilote` :
  `MPG10` et `MPG11` → 409), table
  `ERREURS_SQL` de `routes/portail.ts`).
- Ressource d'un autre cabinet, invisible ou non partagée : 404, jamais 403.

## 5. Configuration

- Point d'entrée unique : `loadConfig` (`apps/api/src/config.ts`), schéma Zod,
  messages d'erreur sans valeur de secret.
- Valeurs par défaut : seulement celles du dictionnaire `DEV`, identiques à
  `.env.example`, refusées hors développement et test et avec une base non
  locale. Jamais de valeur par défaut pour un secret en dehors de `DEV`.
- Côté web, seule `API_URL` est lue (sans secret) ; pas de `NEXT_PUBLIC_*`.

## 6. Textes affichés et internationalisation

Interface 100 % française en V1 (PRD, « Localisation »), anglais en V2. Il
n'existe pas encore de mécanisme de traduction : les libellés sont écrits en
français dans le code (`apps/web/src`), les rôles ont leurs libellés dans
`ROLE_LIBELLES` (`packages/shared/src/roles.ts`). Toute date affichée passe par
`formaterDate` (`apps/web/src/lib/format.ts`, « 12 janv. 2027 », jamais d'ISO brut : lot 10, A-11) ; un
formateur numérique `JJ/MM/AAAA` n'existe pas (dette, §10). Montants formatés par le moteur (`formaterMontant`).
Dans un TEXTE affiché, les devises XOF et XAF s'écrivent « FCFA » (`libelleDeviseAffichage`,
`apps/api/src/plans/reprevision-explication.ts`, lot 10, A-08) ; les codes stockés ne changent pas.
Un code technique affiché passe par la table de libellés de `apps/web/src/lib/codes-lisibles.ts` (lot 10,
A-05) ; pour un code inconnu, le repli remplace les soulignés par des espaces (« kpi_pertes » devient
« Kpi pertes »), sans accents. Dates d'API : `AAAA-MM-JJ`
(`dateIsoSchema`), bornées pour la facturation à 2000–2100
(`dateFacturationSchema`, doublé par des contraintes en base, `0040`) ; toutes
les dates de `schemas/temps.ts` (semaine, jour de saisie, période de suivi)
utilisent `dateIsoBorneeSchema`. Toute date
métier bornée par un `CHECK` SQL (échéances, observations, dates de plan ou de
salle de mission) utilise `dateIsoBorneeSchema` (`schemas/commun.ts` : date
valide comprise entre 2000 et 2100), sinon une date valide mais hors bornes
donne un 500 (SQLSTATE 23514) au lieu d'un 400 ; le 23514 qui échappe au schéma
se traduit en 400 par la couche d'erreurs du domaine. Modèles :
`schemas/salle-mission.ts`, `schemas/plans-augmentes.ts`.
Un identifiant technique (valeur d'énumération, UUID) ne s'affiche ni ne se
saisit à la main : l'écran montre un libellé français (par ex.
`libelleNiveauDiplome`, `lib/banque-ao.ts`, qui s'appuie sur
`LIBELLES_NIVEAU_DIPLOME` de `packages/shared`) et propose une liste de choix
plutôt qu'un champ d'identifiant. Un refus de l'API s'affiche avec son message
précis (le code d'erreur sert au test, pas à l'utilisateur).
Mise en page de droite à gauche : sans objet.

## 7. Tests

- **Vitest partout** (`pnpm test` = `pnpm -r test`). API : tests sur **vrai
  PostgreSQL** dans `apps/api/test/*.test.ts` (231 fichiers au 2026-10-21 sur la branche d'intégration, dont 27 de redressement : `ls apps/api/test/*.test.ts | wc -l`), base dédiée
  `<nom>_test` créée à la volée et réinitialisée à chaque exécution
  (`test/global-setup.ts`, `test/urls.ts`) ; `fileParallelism: false` dans
  `apps/api/vitest.config.ts` : jamais deux suites API en parallèle sur la même
  base.
- **Plusieurs agents** : chacun sa base (`DATABASE_URL` /
  `DATABASE_OWNER_URL` vers `missionpilot_<id>`, suffixe `_test` ajouté),
  jamais deux suites API simultanées sur la même base (voir RUNBOOK). Plusieurs
  suites sur le même serveur PostgreSQL : pas plus de 3 ou 4 à la fois, sinon le global-setup échoue
  (erreur 53200, `max_locks_per_transaction`).
- **Tests sensibles à la charge (lot 10)** : on corrige la cause, on ne masque pas l'échec. Pas de `retry`
  par `describe` ni par test (le seul `retry` du dépôt est celui de la CI, `apps/api/vitest.config.ts`,
  actif si `CI` est défini) ; attente bornée plutôt qu'un délai fixe ; dates dérivées de la base. Modèles :
  `redressement-cloture.test.ts` (le test pose `NODE_ENV = production` sans `CHROMIUM_PATH`, restauré en
  `finally`, pour obtenir un refus 503 immédiat au lieu de lancer un vrai Chrome), `signatures-routes.test.ts`
  (`ajouterPreuve`, `canaux/preuves.ts`, rejoue l'INSERT avec une horloge relue, 3 essais au plus, quand le
  déclencheur `MPH10` refuse l'horodatage ; les autres refus `MPH10` ne sont pas rejoués ; non-régression
  par un `pg_sleep` injecté avant l'INSERT) et `kpi-alertes.test.ts` (attente bornée à 30 s du courriel de
  rappel envoyé par le worker après la transaction du job).
- **Création d'un modèle sectoriel de due diligence** : le schéma de création est strict et n'accepte pas
  `actif` (seule la nouvelle version l'accepte) ; le modèle naît actif (`DEFAULT true`, `0511`). Le web
  n'envoie pas `actif` à la création (`apps/api/test/dd-modeles.test.ts`).
- Helpers : `test/helpers.ts` (`demarrer`, `creerCabinet`, `proprietaire`) et
  `test/*-outils.ts` par domaine. Un changement de comportement s'accompagne
  d'un test ; une faille corrigée, d'un test de non-régression.
- Les garanties de base se testent avec le rôle applicatif réel
  (`isolation.test.ts`), pas avec le propriétaire. Le portail a ses tests
  d'inventaire : routes (`portail-acces.test.ts`), politiques
  (`isolation.test.ts`), sortie `horsContextePortail`
  (`portail-contexte.test.ts`).
- **Moteurs** : `packages/engines` exige une couverture ≥ 90 % (lignes,
  fonctions, branches, instructions), `vitest.config.ts` ; `pnpm test` y lance
  `--coverage` (relevé du 2026-10-06 : 100 % des lignes, 99,81 % des branches).
- Web : tests de la logique pure de `src/lib`, du `middleware` et du service
  worker (`src/lib/hors-ligne/sw.test.ts`) ; `apps/web/vitest.config.mts`.
- Commandes ciblées : `pnpm --filter @missionpilot/api exec vitest run
  test/factures.test.ts` ; `pnpm --filter @missionpilot/engines test`.

## 8. Taille et forme du code

- Une fonction nouvellement écrite vise moins de 50 lignes ; au-delà, se
  demander si un découpage est possible. Ce n'est pas une réécriture
  rétroactive du code existant.
- Un changement de comportement est accompagné d'au moins un test qui
  l'exerce.
- Pas de nouvelle erreur de typage ou de lint dans un fichier qui en était
  exempt. Prettier : 100 colonnes, guillemets doubles, virgule finale
  (`.prettierrc.json`) ; ESLint `typescript-eslint` recommandé, variables
  inutilisées interdites hors préfixe `_`.
- **Validation** : chaque corps, paramètre ou requête passe par un schéma Zod de
  `packages/shared/src/schemas`, objets `.strict()` (889 `z.object(` au 2026-10-22 sur la branche d'intégration, lot 4c compris, comptés en tolérant le retour à la ligne
  entre `z` et `.object` et hors tests, dont 878 stricts et 11 volontairement non stricts, ceux de `contenuAvancementSchema` ; `rg` sans `-U` n'en voit que
  ceux écrits sur une seule ligne ; le script de `.claude/rules/review-checklist.md` n° 12 fait foi) ;
  le même schéma sert l'API et le web. Les paramètres de chemin `:id` passent par
  `paramsId` (`apps/api/src/http/outils.ts`, `z.object({ id: uuid }).strict()` :
  561 appels dans 88 fichiers de `routes/` au 2026-10-22, `rg -c "paramsId\.parse"
  apps/api/src/routes`). Une route dont le chemin porte un AUTRE paramètre
  (`:code`, `:canal`, `:promptId`…) n'emploie PAS `paramsId`, qui refuserait la clé
  en plus : elle déclare son propre schéma strict.
- **Listes** : pagination par curseur opaque (`encoderCurseur`,
  `decoderCurseur`, `paginer` dans `apps/api/src/http/outils.ts`), lecture
  `LIMIT n+1`, limite bornée (`limite` 1 à 100, défaut 30, `schemas/facturation.ts`).
  `GET /missions` et `GET /opportunites` trient par `cree_le DESC, id DESC`
  avec comparaison de ligne et index dédiés (`0121`). Pas de `LIMIT` silencieux
  (un écart connu : voir §10).
- **Plafond de `limite` propre à chaque route.** Il vaut 100 pour la plupart des
  listes (`schemas/facturation.ts`, `clients.ts`, `appels-offres.ts`,
  `banque-ao.ts`…), 200 pour d'autres (`schemas/cloture.ts`), 500 pour les listes
  larges `GET /missions` et `GET /opportunites` (`LISTE_LARGE_LIMITE_MAX`,
  `schemas/missions.ts`) ; au-delà, l'API répond 400. Côté web,
  `chargerToutesLesPages` (`lib/pagination.ts`) ne dépasse jamais le plafond qu'on
  lui déclare : `limiteMax` (défaut `LIMITE_PAGE_SURE` = 200 ; `LIMITE_PAGE_MAX` =
  500 pour les listes larges) ramène la `limite` demandée à ce plafond. Une page
  qui boucle sur une route déclare donc le plafond de CETTE route (une route à
  100 : `{ limiteMax: 100 }`, comme `LIMITE_LISTE_AO` de
  `lib/appels-offres-serveur.ts`) ; sinon la requête est refusée (400) et la
  liste reste vide sans message. C'était la cause du menu « Confier à » vide du
  rétro-planning (limite de 500 demandée à une route plafonnée à 200).
- **Écritures** : verrou `FOR UPDATE` quand une règle dépend de l'état lu
  (ou verrou consultatif `pg_advisory_xact_lock` pour sérialiser un traitement
  de cabinet : plafond IA, import des temps), journalisation dans la même
  transaction.

## 9. Branches et commits

- Une branche `type/sujet` par changement, partant de `main`.
- Commits conventionnels (`feat(module): …`, `fix(module): …`,
  `docs: …`, `chore: …`), dans la langue du projet.
- Jamais de poussée directe ni forcée sur une branche protégée
  (main, master), jamais `--no-verify`.

## 10. Dette connue

Relevée dans le code le 2026-10-08 et complétée le 2026-10-21 (consolidation du lot 9a : les dettes soldées par
les lots 1 à 5a ont été retirées après vérification dans le code) et 2026-10-22 (lots 9b et 9c : lots 5b, 7 et 4c ; lots 8b et 8c ; lot 9e : lots 6 et 10) ; ne pas y ajouter sans citer le fichier.
La dette de sécurité est détaillée dans `docs/governance/SECURITY.md` §15.
Résolu depuis le relevé précédent : `LIMIT 500` des missions et opportunités
(pagination par curseur, `0121`), justificatif de débours en texte libre
(téléversement), limiteurs de tentatives en mémoire (persistants, `0120`) ;
en vague 0, collision de `MPT01` (`0076`), incohérence de `notation.publier`
(`roles.ts`), commentaire de `portail/contexte.ts`.

- **Listes de gestion du portail** plafonnées à 500 sans curseur
  (`routes/portail-gestion.ts`, `MAX_LISTE` : utilisateurs et invitations d'un
  client) : la troncature est désormais **signalée** (`tronque: true`) mais la
  liste n'est pas paginée.
- **`candidatsAtelier`** (`plans/ateliers.ts`, lot 8b) : les lectures sont désormais plafonnées par des
  constantes déclarées et exportées (`CANDIDATS_CABINET_LUS_MAX` 500 utilisateurs examinés,
  `CANDIDATS_CABINET_MAX` 200 et `CANDIDATS_DIRIGEANTS_MAX` 200 candidats rendus) et la troncature est
  signalée (`tronque: true`). Reste : la liste n'est pas paginée, le filtrage par droits se faisant après le
  SQL. `qualite/froide-revue.ts` (`mesRevues`) n'a plus de `LIMIT` littéral : pagination par curseur keyset
  (`mesRevuesQuerySchema`, `limite` 1 à 100, défaut 50).
- **Efficacité des recommandations (lot 5b, 2026-10-22)** : trois lectures à `LIMIT` littéral sans plafond de
  table (`capitalisation/efficacite.ts`, historique des instantanés `LIMIT 50`, KPI d'une mission `LIMIT 200`,
  initiatives du plan `LIMIT 200`, recherche n° 7 de la checklist) ; l'historique d'adhésion de l'observatoire
  (`capitalisation/observatoire.ts`, `OBSERVATOIRE_HISTORIQUE_MAX` = 200) est passé en paramètre. À doubler d'un
  plafond ou à paginer.
- **Date d'atteinte d'un jalon** non horodatée en V1, approchée par la dernière
  modification (`finance/indicateurs.ts`).
- **Inversion de la parité EUR/FCFA** : `Number((1 / PARITE_EUR_FCFA).toFixed(10))`
  dans `routes/missions.ts` (`pariteFixe`), seul calcul de taux hors moteur ; à
  déplacer dans `packages/engines`.
- **Conservation IA non exposée** : `ia_parametres_cabinet.conservation_jours`
  (`0104`, 365 jours par défaut) n'est ni lisible ni modifiable par l'API IA
  (`routes/ia-parametres.ts`) ; durées par défaut des textes IA et des rapports
  à valider avec le conseil juridique (DECISIONS.md).
- **Rédaction assistée** du plan et des rapports de notation non faite en tant que telle : appellent
  l'orchestrateur les routes `/api/ia/*`, la génération de questionnaires (`0149`), les trois brouillons
  rattachés à `ia_demandes` du lot 5a (`notation_explication`, `plan_atelier`, `plan_reprevision`), les
  causes racines du redressement (`redressement/causes-ia.ts`) et, par le point d'entrée
  `admettreSansDemande` / `appelerSansDemande`, le routage du copilote, qui ne produit aucun contenu
  (ADR-005). Aucun autre module n'importe un fournisseur.
- **Plan partagé jamais servi au portail** (tables du plan en
  `portail_interdit`).
- **Migrations sans somme de contrôle** : l'immuabilité d'une migration
  commitée repose sur la relecture (`db/migrate.ts`).
- **Pas de mécanisme de traduction** (§6) : l'anglais prévu en V2 impose
  d'extraire les libellés.
- **Volume** : deux tests de performance sont sensibles à la charge de la
  machine (seuil de 3 s) : `plan-de-charge-perf.test.ts` et
  `finance-indicateurs-perf.test.ts`.
- **Dossier client (lot DOS)** : extraction des états financiers depuis un PDF, soldée par le lot 6
  (DOS-03, origine `pdf`, `0523` ; OCR local livré par le lot 11, voir « Ingestion de documents » ci-dessous) ; le lecteur Excel partagé (`lireClasseurTemps`,
  `temps/import-excel.ts`) ne rend pas le nom de la feuille lue ni des messages
  propres aux états financiers (« lignes de temps ») ; listes du dossier bornées
  par plafond (5 000 faits, 2 000 valeurs de facteurs, 60 états) plutôt que
  paginées (`dossier/faits.ts`, `facteurs.ts`, `etats.ts`).
- **Vague 1, intégration** (relevé du 2026-10-08) : la citation d'une
  assertion dans l'annexe des sources (PRV-06, `rapports/sources.ts`) repose sur
  le texte libre `livrable` ; une définition de terminé « notation » copiée avant
  le 2026-10-08 garde l'item `notation_publiee` (`qualite/definitions.ts`).
- **Listes bornées sans curseur (vagues 2 et 3)** (relevé du 2026-10-08) : lectures
  plafonnées au lieu d'être paginées. Lot KPI : `MAX_LIGNES_PILOTAGE` (500, lecture
  `LIMIT 501` par `limiteLecturePilotage()`, `kpi/pilotage-donnees.ts`) pour les
  décisions, actions et événements d'une revue ou d'une action, arbres d'une mission (`kpi/revues.ts`,
  `kpi/actions.ts`, `kpi/arbres.ts`), `MESURES_EXPORTEES_MAX` (2 000,
  `kpi/tableau.ts`) ; le drapeau `tronque` est rendu. Idem pour les alertes
  d'appels d'offres (`ALERTES_FICHES_MAX`, 500, `appels-offres/retroplanning.ts`)
  et les modèles de la salle de mission (`SALLE_MODELES_MAX`, 500,
  `salle-mission/modeles.ts`). **Sans signal de troncature** : `listerGabarits`
  (`banque-ao/cv.ts`, `GABARITS_LISTE_MAX` = 200, standard compris) et la matrice
  de compétences (`capitalisation/competences.ts`, `matrice` : tous les
  collaborateurs actifs par toutes les compétences actives, sans plafond ; seules
  les déclarations sont bornées, 50 par couple, `MPJ07`). `estimationParBrique`
  (`capitalisation/estimation.ts`, `OBSERVATIONS_MAX` 20 000, `BRIQUES_MAX` 1 000)
  et l'analyse des dérogations (`capitalisation/derogations.ts`,
  `DEROGATIONS_MAX` 20 000) chargent jusqu'à 20 000 lignes en mémoire (`tronque`
  rendu).
- **Schémas de dates non bornés** : `semaineQuerySchema` et les autres dates de `schemas/temps.ts` sont bornés
  (`dateIsoBorneeSchema`, 400 du schéma et non 500 de la base, lot 8b). Les schémas de dates de
  `appels-offres`, `banque-ao`, `kpi` et `kpi-pilotage` emploient encore `dateIsoSchema` : à vérifier au cas
  par cas s'ils visent une colonne à `CHECK` de bornes.
- **Fonctions de plus de 60 lignes** (§8 vise moins de 50 ; relevé du 2026-10-08
  par l'API du compilateur TypeScript, fonctions imbriquées et rappels compris,
  tests exclus) : 652 au total, dont 106 plugins ou rappels de `routes/`, 432 dans
  `apps/web` (composants et pages), 23 dans `packages/engines` et 81 dans la
  logique de l'API. Les plus longues de l'API hors routes : `ia/orchestrateur.ts`
  `executerDemande` (271) et `preparer` (142), `temps/import.ts`
  `importerTableau` (209), `temps/suivi.ts` `assembler` (179), `app.ts`
  `buildApp` (166), `finance/bilan.ts` `enregistrerBilanCloture` (132),
  `previsions/donnees.ts` `chargerDonneesPrevision` (132), `ia/fournisseur.ts`
  (129 et 113), `facturation/factures.ts` `creerBrouillon` (114). Vagues 2 et 3 :
  `automatisation/simulation.ts` `simulerSurLePasse` (110),
  `automatisation/execution.ts` `executerUneAction` (100),
  `kpi/dossier-revue.ts` `sectionsSituation` (95), `salle-mission/donnees.ts`
  `vueDemande` (90), `salle-mission/decisions.ts` `verserAuDossier` (88),
  `kpi/revues.ts` `genererOrdreDuJour` (84), `cloture/evaluation.ts`
  `evaluerCloture` (78). Moteurs : `plan-strategique/modele.ts`
  `calculerDepuisNormalisees` (236), `previsions/preremplissage.ts` (141),
  `kpi/qualite-donnees.ts` (128). Pas de réécriture rétroactive : à découper au
  prochain passage.
- **Fichiers de plus de 400 lignes** (hors tests, `wc -l` sur les `.ts` et `.tsx`) : le lot 8c a découpé 34
  fichiers web (29 modules de `lib/` et 5 composants : `plan-modele.ts` 1 308 lignes ramené à 32,
  `redressement-saisie.ts`, `notation-augmentee.ts`, `kpi.ts`, `kpi-pilotage.ts`, `banque-ao.ts`, `canaux.ts`,
  `ArbreDecoupage.tsx`…) sans changer de comportement : chaque fichier d'origine reste le point d'entrée et
  ré-exporte ses sous-modules, et aucun des fichiers résultants n'atteint 400 lignes (le plus gros,
  `components/portail/questionnaires/SaisieQuestionnaire.tsx`, en fait 394). Relevé du 2026-10-22 : **41
  fichiers de `apps/web/src` restent au-dessus de 400 lignes** (65 en comptant les `*.test.*`, que ce relevé
  exclut comme le précédent), tous non touchés par le lot 8c, chemins relatifs à `apps/web/src` :
  `lib/due-diligence-saisie.ts` (1 654), `lib/due-diligence.ts` (1 550), `lib/methodes.ts` (961),
  `lib/dossier.ts` (810), `lib/navigation.ts` (643), `components/due-diligence/EspaceRisques.tsx` (559),
  `components/questionnaires/EditeurQuestion.tsx` (548), `lib/signatures.ts` (541), `lib/plan-montecarlo.ts`
  (539), `app/(app)/missions/[id]/facturation/EcheancierMission.tsx` (528), `components/ia/PanneauContenuIa.tsx`
  (525), `lib/portail-questionnaires-saisie.ts` (522), `components/connaissances/FormulairesConnaissances.tsx`
  (518), `lib/plan-strategique.ts` (517), `components/agents/EvaluationOpenRouter.tsx` (515),
  `components/plan/FormulaireHypotheses.tsx` (505), `lib/planification.ts` (504), `lib/dossier-groupes.ts`
  (503), `app/(app)/temps/GrilleTemps.tsx` (499), `lib/notation-grilles.ts` (498), `lib/factures.ts` (488),
  `components/banque-ao/FormulairesOffres.tsx` (486), `app/(app)/missions/[id]/kpi/[kpiId]/page.tsx` (485),
  `lib/decoupage.ts` (484), `app/(app)/parametres/import-temps/ImportTemps.tsx` (482),
  `app/(app)/missions/[id]/questionnaires/PreparationEnvoi.tsx` (480), `lib/evaluations-openrouter.ts` (475),
  `app/(app)/missions/[id]/affectations/Affectations.tsx` (471), `lib/temps.ts` (460), `lib/ia-contenu.ts`
  (457), `lib/encaissements.ts` (452), `app/(app)/compte/securite/SecuriteCompte.tsx` (448),
  `components/redressement/KanbanActions.tsx` (432), `components/canaux/ActionsDestinataireCanal.tsx` (432),
  `app/(app)/missions/[id]/kpi/page.tsx` (420), `app/(app)/missions/[id]/notation/analyse/page.tsx` (419),
  `components/plan/FormulaireElement.tsx` (413), `components/questionnaires/EditeurCondition.tsx` (409),
  `components/plan/SaisiesListes.tsx` (408), `lib/qrcode.ts` (404), `lib/salle-mission.ts` (403). Le reste du relevé du 2026-10-08, non recompté : 53 fichiers dans l'API et 13 dans les paquets,
  dont `notation/notations.ts` (685) et `kpi/revues.ts` (588) côté API.
- **Lacunes de la vague 2 (2026-10-11)** : `mission.cloture_demandee`, qui n'avait aucun
  émetteur, est publié par la base au passage à `a_cloturer` (`0303`, ADR-006) ; le brief
  quotidien et le copilote sont construits mais le copilote n'a jamais parlé à un vrai
  modèle, (SECURITY.md §15) ; le compteur de débit du brief, qui était en mémoire, est désormais
  persistant (espace `brief_requetes` du limiteur, `0550`).
- **Pages web à 200 au lieu de 500** : soldée par le lot 8b. Les dix pages de liste (`charge`, `facturation`,
  `mes-taches/nouvelle`, `qualite`, `qualite/acceptation`, `qualite/satisfaction`, `temps/debours`,
  `pipeline`, `missions`, `clients/[id]/portail`) passent `{ limiteMax: LIMITE_PAGE_MAX }` (500) et
  `cheminMissionsClient` demande `limite=500`. Au 2026-10-22, aucun appel de `chargerToutesLesPages`
  (`rg -n "chargerToutesLesPages" apps/web/src --glob '!*.test.*'`) n'omet `limiteMax`, y compris
  `lib/due-diligence-serveur.ts` (ligne 194, 500). Reste :
  `components/dossier/RapportEtatFinancier.tsx` lit UNE seule page de `/api/missions?client_id=…`
  (`limite=500`) sans suivre le curseur, donc au plus 500 missions par client.
- **Recette du 2026-10-10, points non tranchés** : la génération du « gabarit »
  d'un retour d'expérience inscrit une nouvelle version qui remplace le texte
  courant (l'ancien reste dans la version précédente, sans avertissement à
  l'écran : `capitalisation/ia.ts`) ; le pied de page « relu et validé par un
  consultant » s'ajoute au dossier de revue KPI en brouillon
  (`routes/kpi-pilotage.ts`, `rapports/parametres.ts`). Détail et suite :
  `docs/governance/SECURITY.md` §15 et §16.
- **Redressement, lot 3a (2026-10-11)** : listes lues par plafond plutôt que paginées, avec un
  `LIMIT` littéral égal au plafond de volume que la base applique déjà (actions 300 par dossier
  et événements d'une action 200, créanciers 200 par dossier, créances 100 et événements de négociation 300
  par créancier, réalisés de trésorerie 1 000 par dossier) ou, pour les seuils, au-dessus de lui (400 lus,
  6 secteurs × 50 versions = 300 au plus en base) : `apps/api/src/redressement/`, recherche n° 7 de la
  checklist ; kanban sans glisser-déposer et sans synchronisation avec
  `taches_collaboration` ; correspondance de postes faite à la main sans second regard ; valeurs
  provisoires (`DECISIONS.md`, section « Redressement »). Soldés par le lot 3a-bis (2026-10-21) : vue
  mensuelle de la trésorerie et covenants (`0489`), seed de démonstration (`db/seed-demo-redressement.ts`).
  Détail : SPEC-3a §14 et SECURITY.md §15.
- **Redressement, lot 3a-bis (2026-10-21)** : le tri du portefeuille par attention n'existe pas dans l'API
  (`comparerAttention` est dans le moteur, mais le web n'importe pas les moteurs, §1) ; le préremplissage du
  secteur d'un dossier fait 2 appels côté navigateur (`app/(app)/redressement/page.tsx` pourrait passer
  `secteurClient` au formulaire) ; aucun script npm `db:seed-demo-redressement` (le sous-semis tourne par
  `db:seed-demo` sur base neuve, ou `npx tsx src/db/seed-demo-redressement.ts`) ; le rapport de clôture n'ouvre
  qu'un suivi qualité R2 au minimum (R3 automatique : type de livrable dédié dans `CLASSE_MINIMALE_PAR_TYPE`) ;
  `rapports/liste.ts` n'expose pas `red_cloture_id` (voir `GET /redressement/clotures/:id/rapports`) ; le
  voyant de pilotage (`etatVoyantDossier`) est branché au brief (source `voyantsRedressementRouges`, `brief/derives.ts`, lot 8b : seul le rouge produit un élément) mais pas à l'automatisation (aucun événement d'automatisation) ;
  partage externe du tableau de bord non ouvert ; alertes de suivi calculées à la lecture, sans relance par job.
- **Socle IA (lot 1, 2026-10-21)** : le worker de la file `jobs` traite UN job à la fois (`traiterUn`,
  `jobs/worker.ts`) : un rejeu de 8 à 13 minutes bloque la boucle, l'équité de `reserver_job_a` (`0305`) joue
  à la réservation et non à l'exécution ; `ia/couts.ts` écrit encore `evaluation_demande_id` dans l'INSERT de
  `ia_consommations` (champ inutilisé, un REVOKE par colonne pourrait remplacer le déclencheur de `0275`) ;
  rôle PostgreSQL distinct pour le worker non fait (SECURITY.md §15).
- **Due diligence et canaux (lot 3, 2026-10-21)** : DD-07 livré comme véhicule seulement (modèles par secteur,
  vides ; un modèle par secteur et par analyse, pas par filière) ; `TABLES_DD` (`test/dd-outils.ts`,
  `dd-base.test.ts`) n'est pas étendue aux deux tables de modèles (`dd_modeles_secteur`,
  `dd_modele_secteur_versions`, éprouvées par `dd-modeles.test.ts`) ; le futur adaptateur de canal réel devra
  ajouter un délai (timeout) de lecture au flux média.
- **Référentiel de méthodes et revue à froide (lot 4a, 2026-10-21)** : la grille « complète » de huit critères
  est codée en dur dans le déclencheur `qualite_froide_violations()` de `0287` (une grille v2 exige une
  migration) ; l'indépendance du relecteur a deux implémentations alignées à la main (moteur
  `evaluerIndependanceRelecteur` et ce déclencheur) ; l'habilitation du relecteur (`MQQ07`) reprend les rôles de
  `qualite.froide.relire` ; STD-14 reste à faire (STD-13, l'amorçage du standard depuis des documents, est livré par le lot 6).
- **Dossier client, groupes (lot 4b, 2026-10-21)** : consolidation simple, sans élimination des opérations
  intragroupe ; USD exclu (aucun taux validé) donc consolidation marquée partielle ; le commentaire IA du rapport
  d'état financier n'est pas branché.
- **Plans augmentés (lot 5a, 2026-10-21)** : le rejeu de la simulation de Monte-Carlo (POST sans résultat écrit,
  `plan.lire`) coûte environ 0,3 s ; depuis le lot 8b il est limité à 5 par plan et par 10 minutes, tous
  utilisateurs confondus (429 `TROP_DE_REJEUX`, table `plan_rejeux_montecarlo`, `0432` ; valeur provisoire, à
  valider) ; les recherches de combinaisons de la
  notation sont bornées (`PRATIQUES_MAX_COMBINAISON`, `NOEUDS_MAX_COMBINAISONS`) et renvoient `tronquee`,
  jamais « impossible ».
- **Intégration continue (lot 8a, 2026-10-21)** : `.github/workflows/ci.yml` n'a jamais été exécutée sur
  GitHub à la livraison du lot ; les jobs `qualite` et `api` (4 partitions) ne sont pas encore des contrôles requis
  de la protection de `main` ; `apps/api/vitest.config.ts` active `retry: 1` seulement si `CI` est défini. Tests
  instables sous charge, hors CI : `brief-job`, `copilote`, `factures`, `plan-de-charge`,
  `redressement-urgence-alerte`, `salle-mission-durcissement`. Soldés par le lot 10 : `kpi-alertes` (attente
  bornée, timeout 90 s), `signatures-routes` (rejeu de l'horodatage de `ajouterPreuve`, `retry: 2` retiré) et
  `redressement-cloture` (refus 503 immédiat sans Chrome) ; voir §7. Un test de plus qui échoue sous charge se
  corrige à sa cause, pas par un `retry`.

- **Capitalisation et veille (lot 5b, 2026-10-22)** : un seul indicateur d'observatoire (`notation_score_global`) ;
  NOT-14 (percentile) reste à faire ; classement du secteur par mots-clés (faux positifs possibles, sans enjeu de
  sécurité) ; collecte de la veille déclenchée à la main (pas de job) et adaptateurs de veille SIMULÉS seulement
  (un adaptateur réel exige un ADR : SSRF, délai, clé) ; seuils et valeurs de CAP-03, CAP-04 et AO-01 provisoires
  jusqu'à validation (DECISIONS.md, section « Capitalisation (CAP-03, CAP-04) et veille »). Risques résiduels de
  l'observatoire (collusion, effet de bord « exactement 3 contributeurs », retrait immédiat) :
  SECURITY.md §5 sexies et §15.
- **Services candidats (lot 7, 2026-10-22)** : le champ `moteur` reste NULL pour les briques
  `bancabilite_pla17`, `plan_financement` et `veille_guichets` de `0561`, faute de code correspondant dans
  `MOTEURS_STANDARD` (`packages/shared/src/schemas/standard.ts`) : à reprendre par une nouvelle version de
  méthode si des codes `plan.bancabilite` / `services.guichets` sont ajoutés ; tout le contenu des méthodes `0560`
  et `0561`, les plafonds et le prix « sur devis » du business plan sont provisoires (`a_valider = true`) ;
  les montants des prix et les bornes de guichets sont des entiers en unité de la devise, différents de la
  convention en unités mineures de `apps/web/src/lib/saisie.ts` ; le lien « mission flash » depuis la fiche
  client et les alertes KPI ou de redressement n'est pas posé (la page `/services-candidats` lit déjà
  `?service=` et `?client=`) ; les pages `/services-candidats`, `/services-candidats/guichets` et `/observatoire`
  n'ont pas été ouvertes dans un navigateur à la livraison.
- **Rapport d'avancement, cache et plafond de mission de l'IA, contradicteur (lot 4c, 2026-10-22)** : pas de
  rendu PDF ni Word du rapport hebdomadaire (consultation web seule, décision du superviseur, provisoire ;
  DECISIONS.md) ; les écrans du rapport (cabinet et portail), du réglage du cache et de la contre-analyse n'ont pas
  été ouverts dans un navigateur à la livraison ; aucun écran ne règle le plafond IA d'une mission
  (`PUT /api/agents/missions/:id/plafond`, droit `ia.configurer`, API seule) ; le commentaire IA de l'avancement
  passe par `appelerSansDemande` : hors plafond de mission et hors cache ; valeurs de départ (cache de 24 h
  désactivé par défaut, job `avancement_hebdo` à 06:30 UTC par lots de 25 missions et 40 lots au plus par
  semaine, alertes de plafond à 80 % et 100 %) à valider ; `contenuAvancementSchema`
  (`packages/shared/src/schemas/automatisation.ts`) est volontairement NON strict (clés inconnues écartées,
  liste blanche du contenu servi au portail), seule exception aux schémas `.strict()` (recherche n° 12 de la
  checklist) ; les lectures `LIMIT $n` ou `LIMIT 1` du lot ne sont pas doublées d'un plafond de table
  (seul `UNIQUE (mission_id, semaine)` borne les rapports). Détail de sécurité : SECURITY.md §5 octies, §7 bis
  et §15.
- **Ingestion de documents (lot 6, 2026-10-22)** : dettes de code. (1) Effacement de l'objet de stockage : s'il
  échoue, l'objet reste marqué et n'est repris que par le job quotidien `ingestion_maintenance`
  (`effacerObjetsMarques`, `ingestion/fichier-temporaire.ts`), dont la planification est bornée à 30 jours après
  le marquage (`fichiers_suppressions` n'enregistre pas l'effacement). (2) Une relance de structuration agit avec
  les droits et le quota IA de l'auteur du document, pas ceux de la personne qui relance (M5). (3) Le
  téléversement d'un document de due diligence se fait en trois transactions (M7) ; le détail d'une extraction
  `lecture_document` de DD n'est pas masqué. (4) `stockage/detection.ts` (`inflerBorne`) garde `CINFO <= 7` et ne
  compte pas l'entrée des flux d'objets, à la différence de `ingestion/pdf-controle.ts` : à examiner
  séparément ; le worker de contrôle n'a pas de surveillance mémoire (borné par l'algorithme). (5) Recherche
  n° 8 de la checklist, deux lignes mineures non corrigées : `Math.round` de la confiance OCR
  (`ingestion/pdf.ts`) et `Math.floor` de la taille en Mo dans le message de dépassement
  (`ingestion/erreurs.ts`). (6) Aucun test dans un navigateur des écrans d'ingestion (états financiers, onglet
  « Documents » de la due diligence, amorçage du standard). (7) OCR local (lot 11) : (a) `extrairePagesPdf` tourne dans la transaction du
  job (ligne du document verrouillée, une connexion du pool retenue pendant l'OCR) : au pire 30 s + 240 s + 10 s,
  sous le délai de blocage des jobs (15 min) ; dette acceptée, non restructurée ; (b) le moteur tourne dans un
  sous-processus Node (modèle de permissions, garde réseau, veille du RSS) mais sans conteneur ni seccomp, et la
  mémoire hors tas n'est bornée que par la veille du RSS (réactive) : détail dans SECURITY.md ; (c) les images
  JPX, CCITT et JBIG2 ne sont pas testées, et la qualité sur de vraies liasses SYSCOHADA scannées n'est pas
  mesurée ; (d) un PDF mêlant pages natives et pages scannées est lu par sa seule couche texte (les pages sans
  texte ne sont pas passées à l'OCR) ; (e) l'effet de `--permission` sous Node 22 n'est éprouvé que par la CI
  (`OCR_LOCAL_EXIGE=1`) ; (f) la vérification de secours sur les dimensions décodées (`ocr-processus.mjs`) n'a
  jamais été déclenchée par les PDF hostiles de test. (8) Plafonds provisoires (`PLAFONDS_INGESTION`,
  `PLAFONDS_OCR`) et pré-contrôle des PDF avec faux refus connus (plus de 4 096 flux Flate,
  flux Flate légitime de plus de 32 Mo, scan brut de plus de 5 pages A4 en RGB) : voir SECURITY.md §15 et
  DECISIONS.md.
- **Corrections de la recette (lot 10, 2026-10-22)** : A-10 (règles CSS de la section « Échantillon »,
  `froide.css`) justifié par la lecture du CSS, non revérifié dans un navigateur, de même que le correctif
  A-04 (`useRafraichir` : mécanisme alors non prouvé ; cause démontrée et soldée par le lot 13a, voir plus bas) ; A-11 : l'écart avec le brief demeure, `format.ts` n'a pas de formateur numérique `JJ/MM/AAAA`
  (`formaterDate` rend « 15 oct. 2026 ») ; A-05 : une règle de méthode sans `libelle` garde un repli sans
  accents (par exemple « Recfin t3 a »), et le journal de modulation partagé change d'affichage dans le
  simulateur et la page des missions de méthode. Soldés par le lot 10 : tests API sensibles à la charge (voir
  la dette « Intégration continue »), commentaire de `qualite/froide-revue.ts` (« MQQ01 à MQQ13 »), appels
  directs à `router.refresh()` hors lot 6 et `FormulaireConnexion` (ceux du lot 6 l'ont été par le lot 12),
  Node 20 (§1, Node 22.13 minimum depuis le lot 11).
- **Recette finale (lots 13a et 13b, 2026-10-23)** : soldées, A-04 par contournement (cause démontrée : perte du
  réveil de React 19.2 canary sous une frontière Suspense, `DebloqueurRendu`), R-01 (écran périmé après
  écriture) et R-02 (lien sans effet), mesures dans `docs/workflows/notes-lots/lot-13a.md`. Dettes nouvelles :
  (1) le contournement `DebloqueurRendu` est à revoir à chaque montée de Next ou de React (inutile mais
  inoffensif si le défaut est corrigé) ; sa preuve de bout en bout est une mesure en navigateur, pas un test, et
  téléphone réel, Firefox et Safari ne sont pas mesurés ; (2) le signal de réveil des jobs est local au
  processus : un worker dans un autre processus, ou un job créé hors des appelants de `signalerJobCree`, garde
  l'intervalle de 30 s ; (3) R-05 : les largeurs minimales des 7 colonnes de la revue à froide totalisent
  43,75 rem pour 732 px utiles (marge de 32 px) ; seule la garde CSS `qualite-froide-css.test.ts` existe, le
  rendu à 768, 1036 et 1280 px reste à confirmer en navigateur ; (4) A-09 : si la grille se complète sans
  changement de synthèse et sans clic sur « Terminer », le bandeau de synthèse reste jusqu'au prochain clic.
- **Listes de la plateforme non paginées (super admin, 2026-10-23)** : `GET /api/plateforme/cabinets` et
  `GET /api/plateforme/cabinets/:id/utilisateurs` (`plateforme_lister_cabinets`, `plateforme_lister_utilisateurs`)
  rendent toute la liste sans curseur, choix DÉCLARÉ : une plateforme compte peu de cabinets et un cabinet peu de
  comptes. À paginer par curseur si le nombre de cabinets dépasse quelques centaines (le super admin de démo est,
  lui, plafonné à 30 cabinets et 40 comptes par cabinet par `0582`). Les listes de la connexion de
  démonstration sont bornées en SQL (50 cabinets, 50 comptes par cabinet, 20 super admins, `0580`).
