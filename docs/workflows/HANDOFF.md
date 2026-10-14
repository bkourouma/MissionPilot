# Passation de session — MissionPilot

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (AGENTS.md, CLAUDE.md). Une section par branche, la plus
récente en haut ; réécrire sa section plutôt qu'empiler ; la supprimer une fois
la branche fusionnée. Dates absolues. Pas de secret ni de contenu de `.env`.
Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`).

---

## Lot 3c (canaux simulés) — branche `feat/vague-4-canaux` — 2026-10-14

**Terminé et commité par domaine, PR ouverte (fusion par le chef).** Vérifié sur la pointe : typecheck, eslint, Prettier verts ; shared 228, engines 1327, web 1591 ; **suite API complète 165 fichiers, 1890 tests verts** (un premier passage avait donné 4 échecs de `kpi-alertes` par délai dépassé pendant que d'autres suites tournaient : le fichier passe seul) ; build web de production réussi ; audit de sécurité (0 critique, 2 importants et 8 mineurs ; les 2 importants et les mineurs M1 à M6 corrigés : expéditeur inactif ou numéro non vérifié ignoré, garde mémoire du webhook, audio réservé à son auteur, PDF de signature refusé hors statuts envoyée/partielle/signée, variantes de STOP, unicité des numéros vérifiés, plafonds). **Recette navigateur courte** (base `missionpilot_rec3c`, port 3110) : onglets « Signatures » et « Transcriptions » de la mission, bandeaux « Signature simulée : sans valeur juridique » et « Simulé : aucun envoi réel », 7 pages en 200 ; refus ressources et expert externe 403, gestionnaire 403 sur les transcriptions, portail 403, anonyme 401 ; webhook en 404 sans fournisseur configuré (voulu). **NON vérifié** : parcours complet dans le navigateur (demande de signature, consentement, simulateur WhatsApp), webhook avec un fournisseur simulé (couvert par les tests API seulement), mise en page mobile ; tout ce qui concerne un vrai fournisseur (SPEC-3c §17, O-01 à O-27). Non faits : branchement `kpi/suivi.ts` (O-26), seeds de démonstration, taille du média entrant en flux (avant tout adaptateur réel), SPEC-3c lignes 430 et 1109 à aligner sur l'unicité des numéros vérifiés. Piège : migrations 0540–0548 corrigées sur place (0541) : recréer les bases qui les avaient appliquées ; `fichier_orphelin` et `rapports_mission` redéfinies par 0548 et par 0508 du lot 3b : la dernière appliquée doit reprendre l'UNION des valeurs ; compteurs mécaniques de `review-checklist.md` à recompter à l'intégration.
## Lot 3b (due diligence) — branche `feat/vague-4-due-diligence` — 2026-10-14

**Terminé et commité par domaine, PR ouverte (fusion par le chef).** Vérifié sur la pointe : typecheck, eslint, Prettier verts ; shared 226, engines 1261, web 1602 ; suite API complète 169 fichiers, 1993 tests dont 1 échec isolé (`kpi-alertes`, test sensible à la charge machine, qui passe seul : même flottement vu sur le lot 3c) ; build web de production réussi ; deux audits de sécurité (le second : 0 critique, 4 importants et 7 mineurs, tous corrigés, test `dd-corrections-2.test.ts`). Recette navigateur courte (base `missionpilot_rec3b`, Chrome intégré, port 3110) : onglet « Due diligence », formulaire de nouveau dossier, pages en 200, refus gestionnaire, ressources, expert externe et portail 403, anonyme 401. **NON vérifié** : parcours complet de saisie dans le navigateur (hypothèses, verdicts, filtrage, note), mise en page mobile ; DD-02 (connecteurs) simulé, DD-10 (ADR-009 absente) et DD-07 repoussés. Piège : les migrations 0500–0508 ont été corrigées sur place (0503, 0505) : recréer les bases qui les avaient appliquées ; `rapports_mission` et `fichier_orphelin` sont redéfinies par 0508 et par 0548 du lot 3c : la dernière appliquée doit reprendre l'UNION des valeurs.
## Vague 4 (chantier n° 3) — ÉTAT DES TROIS WORKTREES au 2026-10-11 11:15 UTC (quota atteint, reprise le 12 octobre après 19:00 UTC)

**Fait et FUSIONNÉ dans `main`** : PR n° 9 (`f548d54`, brief, copilote, `mission.cloture_demandee`), PR n° 10
(`b3f6b85`, HANDOFF), PR n° 11 (`e72985e`, ADR-008, 010, 011, 012, 013 et SPEC-3a/3b/3c dans
`docs/workflows/specs/`). Bases de développement `missionpilot`, `missionpilot_demo`, `missionpilot_recette` : 155
migrations. `main` local = `e72985e`.

**Découpage** : un worktree et une branche par lot, tous partis de `01be2a8` (contenu dans `main`), AUCUN COMMIT,
RIEN POUSSÉ, aucune PR : `.claude/worktrees/redressement` (`feat/vague-4-redressement`, lot 3a), `.claude/worktrees/dd`
(`feat/vague-4-due-diligence`, lot 3b), `.claude/worktrees/canaux` (`feat/vague-4-canaux`, lot 3c). Dépendances déjà
installées dans chacun. Bases de test API : `missionpilot_red`, `missionpilot_dd`, `missionpilot_canaux` (le
global-setup ajoute `_test` et recrée le schéma : jamais deux suites sur la même base). Les agents de correction
utilisaient `missionpilot_red2` et `missionpilot_dd2`. Arbitrages : SQLSTATE `Z` partagée (3a `MPZ01-20`, 3b
`MPZ21-32`), `H` pour 3c (`MPH01-12`) ; migrations 0480–0499 (3a), 0500–0519 (3b), 0540–0559 (3c) ; audio : on
n'étend PAS `TYPES_FICHIER` (l'audio passe par `TYPES_AUDIO` de `transcriptions.ts`).

**Lot 3a (`redressement`) — TERMINÉ le 2026-10-14, commité par domaine sur `feat/vague-4-redressement`, PR ouverte (fusion par le chef).** Vérifié sur la pointe commitée : typecheck des 4 paquets, eslint, Prettier verts ; tests shared 239, engines 1326, web 1590 ; **suite API complète 166 fichiers, 1961 tests verts** (base `missionpilot_red`) ; build web de production réussi ; audit de sécurité (0 critique, 2 importants et 6 mineurs corrigés, nouveau test `redressement-durcissement.test.ts`). **Recette navigateur courte** (Chrome intégré, `next start` sur le port 3110, API sur `missionpilot_recette` migrée à 0486, connexion rapide) : liste `/redressement`, ouverture d'un dossier depuis l'onglet de la mission, synthèse avec bandeau « Analyses indicatives », sous-onglet Trésorerie vide, 8 écrans en HTTP 200 ; refus : gestionnaire, ressources, expert externe et portail 403, anonyme 401, consultant non membre 404. **NON vérifié** : saisie complète dans le navigateur (ratios, urgence, créancier, prévision de trésorerie, validation du plan par un autre utilisateur : couverts par les tests API seulement), mise en page mobile, captures stables. Piège : le port 3100 peut être pris par un autre projet (`gamr-psim-web`) : web de recette sur 3110 avec `WEB_ORIGIN=http://localhost:3110` pour l'API ; en mode développement le volet navigateur reste sur « Chargement de la page… » (utiliser `next build` puis `next start`) ; `docker compose up` échoue si le conteneur existe déjà : utiliser `docker start missionpilot-postgres`. Dette notée : validation du plan par tout détenteur de `redressement.valider` voyant la mission (à décider : limiter au directeur de la mission).

**Lot 3b (`dd`, ~60 fichiers non commités)** : code complet (moteurs `engines/src/due-diligence`, 20 tables `dd_*`
migrations 0500–0508, 53 routes, web, niveau de rapport `dd` / modèle `note_comite`). Vérifié AVANT corrections :
eslint, Prettier, typecheck verts ; shared 225, engines 1261, web 1596. Audit fait (0 critique, 3 importants : verdict
ou note validés qui deviennent faux, déblocage par un seul rédacteur, lectures non bornées en octets ; 8 mineurs).
Corrections API TERMINÉES (11:21 UTC, base `missionpilot_dd2` : dd-* 203 tests, 190 tests des suites voisines,
typecheck/eslint/Prettier propres ; migrations 0503 et 0505 corrigées sur place ; web : niveau de rapport `dd` intégré,
1596 verts) mais PAS encore rejouées sur la suite API complète (une suite complète lancée AVANT et PENDANT les corrections a donné
167 fichiers et 1956 tests verts à 11:30 UTC : elle ne vaut pas validation de la pointe finale). DEMANDES POUR `packages/` NON FAITES (à traiter par le
Pilote, worktree `dd`) : (1) resserrer `regleExclusionSchema` (`packages/shared/src/schemas/due-diligence.ts` : par ex.
10 mots-clés de 60 caractères et 100 règles) ; (2) ajouter à `filtrage_es` de `noteBaseSchema` : `liste: { nom, version } |
null`, `filtrages_anterieurs` et `exclusions_anterieures_non_levees` (compteurs), puis renseigner `base-note.ts` et le
paragraphe du rapport ; (3) web : la route R38 (versions d'une liste d'exclusion) est paginée (`{ elements,
curseur_suivant }`, 10 par page, 20 au plus : boucler avec `limiteMax: 20`) et R39 gagne
`exclusions_anterieures_non_levees` : aligner l'écran. **À faire** : comme 3a (suite API
complète sur `missionpilot_dd`, recette, commits, PR). Rappel : `capitalisation/recherche.ts` doit libeller
`note_comite` « Note au comité » (confié à l'agent). Fonctionnalité repoussée : DD-02 (connecteurs, simulé seulement,
OUVERT), DD-10 (ADR-009 absente), DD-07.

**Lot 3c (`canaux`, ~78 fichiers non commités)** : moteurs, schémas, 12 permissions et web livrés (engines 1320,
shared 228, web 1591 verts au rapport des agents). L'agent API a rendu son rapport (11:15 UTC) : migrations
`0540`–`0548`, ports et simulateurs, config, jobs, webhook, routes (723 routes, dont 2 non prévues :
`POST /missions/:id/transcriptions/audio` et `GET /signatures/:id/document`) livrés ; vérifié par l'agent seulement :
typecheck, eslint, Prettier, 188 tests sur 18 fichiers (base `missionpilot_canaux_test`). PAS de suite API complète,
aucun audit, aucune recette. Écarts à traiter à l'intégration : `fichier_orphelin` redéfinie par `0548` (union à
refaire avec 3b si lui aussi la redéfinit) ; `fichiers_type_mime_check` étendue à l'audio ; `GET /canaux/destinataires`
rend `id: null` sans numéro (le type partagé `DestinataireCanalApi` dit `string` : aligner le web) ; `destinataire_id`
de l'aperçu de synthèse = identifiant de l'utilisateur dirigeant (le web le suppose = ligne `canaux_destinataires` :
aligner) ; tableau de variables du RUNBOOK, seeds de démonstration et branchement `kpi/suivi.ts` (O-26) non faits ;
source `desactivation_utilisateur` jamais écrite. **À faire** : suite API complète, audit en lecture seule, recette,
puis tout le cycle de 3a ;
brancher l'onglet de mission « Canaux » (`...ongletsMissionCanaux(utilisateur.roles, base)` dans
`missions/[id]/layout.tsx`) et le lien de la fiche client vers `/clients/[id]/synthese`. RÈGLE FERME : aucun envoi réel,
aucune clé, fournisseurs simulés, refus au démarrage hors développement ; tous les points « non vérifié contre le vrai
service » et les valeurs juridiques ou de coût (SPEC-3c §17, O-01 à O-27) restent OUVERTS pour l'utilisateur.

**Ordre de fusion conseillé** : 3a, puis 3b, puis 3c, une PR chacune (le chef fusionne en merge commit après contrôle
GitHub). Conflits textuels attendus entre lots sur `packages/shared/src/roles.ts` (+ test), `apps/api/src/app.ts`,
`apps/web/src/lib/navigation.ts` (+ test), `missions/[id]/layout.tsx`, les index de `engines` et `shared`, ce HANDOFF,
SECURITY / CODING_STANDARDS / DECISIONS / review-checklist (compteurs : routes 714 → 730 → +3c, `GRANT EXECUTE`,
`z.object`, migrations) ; `rapports_mission` et `fichier_orphelin` sont redéfinies par 3b et 3c : la dernière
appliquée reprend l'UNION des valeurs. Après la fusion de chaque lot : rebaser/fusionner `main` dans le lot suivant,
recompter les recherches mécaniques, rejouer `pnpm db:migrate` sur les bases de DÉVELOPPEMENT seulement.

**Pièges** : un agent coupé par la limite de session laisse des fichiers partiels (ne rien commiter sans relire et
relancer les vérifications) ; ne jamais lancer deux suites API sur la même base ; Prettier ignore `docs/` et `*.md`
(pas de vérification de mise en forme des docs) ; une suite complète prend ~25 min ; les agents précédents n'ont ouvert
aucun écran dans un navigateur (recette navigateur à faire sur chaque lot avec les serveurs de recette, base
`missionpilot_recette` migrée à 155 : y rejouer `pnpm db:migrate` après avoir amené les migrations 0480+ dans la branche
testée).

**Points OUVERTS qui attendent l'utilisateur** : clé OpenRouter (vérification réelle du rejeu et du routage du copilote) ;
conservation des CV de la banque d'appels d'offres (conseil juridique) ; RED-13 repères OHADA (juriste) ; seuils d'alerte
par secteur et grille d'urgence du redressement (aucune source normative : expert) ; FIN-02 sur le redressement (marges
du client) ; fournisseur de signature électronique, valeur probante, WhatsApp (tarifs, politique Meta, hébergement,
ARTCI), transcription (fournisseur, langues), conservation et consentements ; valeurs provisoires listées dans
`DECISIONS.md` ; mise en page mobile des écrans jamais vérifiée dans Chrome.

---

## Branche `feat/vague-4-redressement` — lot 3a (service #5 Redressement, socle) — 2026-10-11

**Worktree** `D:\APP\MissionPilot\.claude\worktrees\redressement`, parti de `01be2a8` (spécifications de la
vague 4, PR n° 11 fusionnée dans `main`). **Rien n'est commité** : 8 fichiers modifiés (`app.ts`, onglet de
`missions/[id]/layout.tsx`, `navigation.ts` et son test, `engines/src/index.ts`, `shared/src/index.ts`,
`roles.ts` et son test) et les fichiers neufs du lot.

**État :**

- **Code livré** (spécification `docs/workflows/specs/SPEC-3a-redressement.md`, ADR-011 passée « Acceptée ») :
  migrations `0480`–`0486` (15 tables, aucune fonction `SECURITY DEFINER`, SQLSTATE `MPZ01`–`MPZ11`), moteur
  `packages/engines/src/redressement` (ratios, urgence, alerte précoce, trésorerie à 13 semaines, point mort,
  créanciers, plan, leviers), schémas `schemas/redressement.ts` (40 `z.object`, tous `.strict()`), quatre
  permissions `redressement.*`, API `apps/api/src/redressement/` et 37 routes, interface `/redressement` (dossiers,
  seuils) et onglet « Redressement » de la mission, 12 fichiers de tests API `test/redressement-*.test.ts`.
- **Documentation mise à jour** : `SECURITY.md` (§8 nonies, §6, §15, §16), `CODING_STANDARDS.md` (§1, §2, §3, §10),
  `DECISIONS.md` (section « Redressement », toutes valeurs « provisoire — à valider »), `review-checklist.md`
  (contrôle « Redressement » et attendus relevés : 714 routes dont 8 sans `exiger`, 614 `z.object`, 23 `GRANT
  EXECUTE`, 162 migrations dont 7 neuves).
- **Vérifications locales en cours** (typecheck, lint, tests des 4 paquets ; tests API sur la base
  `missionpilot_red`), **audit en cours** (`/audit` : `code-reviewer`, `security-auditor`), **recette navigateur à
  faire** (parcours : ouvrir un dossier, correspondance de postes, ratios, urgence, score, trésorerie, créancier et
  accord, plan et validation par un autre utilisateur, refus du portail et du gestionnaire). À la date de cette
  section, aucun résultat n'est consigné : ne rien annoncer comme vérifié avant de l'avoir relancé.

**Repoussé (liste et raisons : SPEC-3a §2.2)** : RED-03 (check-lists métier), RED-04 (causes racines par IA, exclue
du socle), RED-08 (re-notation, rapport de clôture), RED-09 (suivi post-mission), **RED-13 (repères OHADA : OUVERT,
à valider par un juriste)**, RED-15 (tableau de bord partagé au conseil d'administration et aux banques) ; vue
mensuelle, covenants et plan de financement de la trésorerie ; partage de documents et alertes de jalons du plan ;
seed de démonstration ; brief quotidien et événements d'automatisation (« voyant rouge ») ; suivi qualité R3 du plan.

**Points OUVERTS :**

- **Seuils d'alerte par secteur et grille d'urgence : aucune source normative.** Tout est « provisoire — à valider »
  (`DECISIONS.md`) ; à faire valider par un expert avant tout usage au pilote. Le score reste « indicatif ».
- **FIN-02 des montants du client** : relèvent de `redressement.lire`, pas de `finance.lire` ; à confirmer (sinon
  permission `redressement.montants`, lot ultérieur).
- **Règle des lettres SQLSTATE** : `Z` partagée entre redressement (`MPZ01-20` réservés) et due diligence
  (`MPZ21-32`), `H` réservée aux canaux, plus aucune lettre libre ensuite ; règle posée pour les lots suivants : second
  préfixe de deux lettres (`MQ…`) ; collisions `MPH11` et `MPH07` des ADR-010 et ADR-013 à lever dans le lot canaux.
- Durée de conservation des données du client (conseil juridique) ; vocabulaire « alerte » à relire par un juriste ;
  validation de la correspondance de postes par un second membre ; réouverture motivée d'un dossier `clos` ;
  calibrage des plafonds et des débits avec un cabinet pilote (SPEC-3a §14).

**Pièges :**

- **Trois worktrees en parallèle** : `.claude/worktrees/redressement` (`feat/vague-4-redressement`),
  `.claude/worktrees/dd` (`feat/vague-4-due-diligence`) et `.claude/worktrees/canaux` (`feat/vague-4-canaux`). Une base
  de test par lot : `missionpilot_red`, `missionpilot_dd`, `missionpilot_canaux` (suffixe `_test` ajouté, schéma recréé
  à chaque exécution : jamais deux suites sur la même base). Un worktree n'a pas ses dépendances : `pnpm install`
  avant tout commit (RUNBOOK, « Worktrees »).
- **Plages disjointes** : migrations `0480`–`0499` (ce lot, prochain libre `0487`), `0500`–`0519` (due diligence),
  `0540`–`0559` (canaux). Une migration commitée ne se modifie jamais ; les sept de ce lot restent corrigeables sur
  place jusqu'au commit.
- **Conflits attendus à la fusion entre lots** (fusionner à la suite, jamais à l'aveugle) : `packages/shared/src/roles.ts`
  et `roles.test.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/navigation.ts` et son test, `packages/shared/src/index.ts`,
  `packages/engines/src/index.ts` ; côté base, le `CHECK` de `rapports_mission` et `controler_source_rapport`
  (la due diligence y ajoute `note_comite` et `MPR04`) et `fichier_orphelin` (les canaux la redéfinissent en `0548` :
  la dernière migration appliquée doit reprendre l'union des colonnes ; ce lot n'y touche pas). Ordre de fusion et
  recomptage des recherches mécaniques (n° 10, 12, 13, 16) à refaire après chaque fusion.
- **Nombres à ne pas recopier** : les 714 routes, 614 `z.object` et 162 migrations de la checklist valent pour cette
  branche seule ; après la fusion des trois lots, tout est à relever de nouveau.
- Les `LIMIT` littéraux de `redressement/` (7) répètent des plafonds posés aussi en base : en changer un sans l'autre
  fausse la liste (checklist, recherche n° 7).

**Reste à faire :** finir les vérifications locales, l'audit (corriger les constats par des migrations `0487`+ si la
base est en cause) et la recette navigateur ; commiter, ouvrir la PR (fusion par le chef) ; puis **lot 3b due
diligence** (`feat/vague-4-due-diligence`, ADR-012, SPEC-3b, plage `0500`–`0519`, `MPZ21`–`MPZ32`), **lot 3c canaux
simulés** (`feat/vague-4-canaux`, ADR-008, ADR-010, ADR-013, SPEC-3c, plage `0540`–`0559`, `MPH01`–`MPH12`) et **lot
3a-bis** (suite du redressement, à spécifier à partir de ce qui est repoussé ci-dessus ; le rapport RED-08 est
aussi ce qui branchera le suivi qualité R3 du plan).

---

## Situation de `main` — 2026-10-11 (après la fusion de la PR n° 9, chantier n° 2 terminé)

**État :** `main` porte les vagues 0 à 3 (PR #7, merge commit `b32c089`, recette navigateur
réelle), le rejeu réel des évaluations OpenRouter (PR #8, `79155dd`) et les lacunes de la vague 2
(PR #9, merge commit `f548d54`, fusionnée par le chef d'orchestre) : **événement
`mission.cloture_demandee`** (0303), **brief quotidien par rôle** (AUT-07, 0304), **copilote
conversationnel** (AGT-08, 0271 à 0274). Audits de sécurité (0 critique, 3 importants corrigés +
mineurs) et recette navigateur courte faits. Le chantier n° 3 (vague 4) part de `main` sur sa
propre branche et ajoute sa section au-dessus de celle-ci.

**VÉRIFICATIONS RÉELLES OUVERTES (rien n'a été vérifié avec un vrai modèle ni dans un
navigateur) :**

- **OpenRouter réel : OUVERT.** Aucune clé OpenRouter n'existe dans l'environnement de
  développement et seul l'utilisateur peut en fournir une (décision du chef, 2026-10-11) :
  NE PAS en chercher, NE RIEN dépenser. Non vérifiés : le rejeu d'évaluation (PR #8), le routage
  du copilote par un vrai modèle (qualité, format JSON réellement rendu, coûts et jetons réels),
  la comparaison du modèle servi. Pour le faire : une clé de test dans les paramètres IA d'un
  cabinet de recette, un jeu d'essai de quelques cas, lancer un rejeu depuis `/agents/evaluations`
  (plafonné à 2 USD), puis poser quelques questions à `/copilote`.
- **Écran jamais ouvert dans un navigateur** : `/agents/evaluations` (rejeu). `/brief`, la carte
  « Brief du jour » et `/copilote` ont eu une recette navigateur courte le 2026-10-11 (Chrome réel,
  base `missionpilot_recette`, API relancée avec la connexion rapide) : aucun bloquant ; affichage,
  brief vide et rempli, liens, FIN-02, confirmation à usage unique, annulation, proposition
  expirée, autre utilisateur (404), refus sous N1 puis reprise à N2, portail fermé : observés.
  **Non vérifié** : la mise en page mobile (le redimensionnement n'a pas pris effet dans Chrome) et
  les captures (instables). Corrigé après recette : suggestion « factures échues » alignée sur
  l'outil du serveur ; dates du brief en JJ/MM/AAAA. **Constats mineurs repoussés** : « mes
  missions en retard » et « qui est en retard sur les feuilles » (équipe) ne sont pas compris ;
  « Refusée » affiché deux fois après un refus N1 et plus de bouton pour reprendre la proposition ;
  « Crée une tâche : » proposé sous N1 ; message refusé qui reste dans le champ ; conversation non
  conservée au rechargement ; fiche `/agents` du copilote sans la création de tâche ; formulations
  (« Aucun KPI au rouge sur 1 de vos missions ») ; « cherche » refusé au rôle ressources
  (permission `connaissance.lire`, à confirmer).
- Les trois bases de développement (`missionpilot`, `missionpilot_demo`, `missionpilot_recette`)
  ont les 155 migrations (0271 à 0274, 0303 et 0304 appliquées le 2026-10-11). Des données de
  démonstration ont été ajoutées par la recette dans la base de recette (3 tâches du chef de
  mission, 2 écritures de restriction du copilote).

**Livré :**

- **Événement `mission.cloture_demandee`** : déclencheur SQL non bloquant au passage de
  `missions.statut` à `a_cloturer` (clé par passage, anti-répétition de 10 minutes) ; l'automatisation
  standard « rappel de check-list de clôture » se déclenche de bout en bout. Conséquence : le mode
  d'exécution `declencheur` est refusé pour tout événement du catalogue.
- **Brief quotidien** : calcul déterministe sans IA (moteur pur), 27 types d'éléments en trois
  familles (À décider, Ça dérive, Prêt à envoyer), chaque source derrière sa permission et la
  visibilité de mission, FIN-02, séparation des tâches ; `GET /api/brief` ; job `brief_quotidien`
  (7 h UTC, jours ouvrés, lots de 500 avec suite, notification interne, jamais d'e-mail) ; page
  `/brief` et carte du tableau de bord.
- **Copilote** : l'IA route, le code répond (le modèle ne reçoit aucune donnée) ; 6 outils de
  lecture et 1 action (`creer_tache`) jamais exécutée sans confirmation à usage unique (5 min,
  niveau d'autonomie ≥ N2, plafond du standard relevé de N1 à N2 par `0273`) ; purge à 30 jours ;
  page `/copilote` ; permissions `brief.lire` et `copilote.utiliser`.
- Durcissement collatéral : les comptes du portail client ne sont plus jamais assignables ni
  mentionnables (`authDe`), y compris par `POST` et `PATCH /taches-collaboration`.

**Décisions de l'utilisateur (2026-10-10 et 2026-10-11, relayées par le chef d'orchestre)** :
conservation des CV de la banque d'appels d'offres **ouverte** (avis du conseil juridique) ; valeurs
par défaut de `DECISIONS.md` provisoires ; fusions décidées par le chef ; ordre des chantiers :
(1) rejeu OpenRouter (fait, PR #8), (2) lacunes de la vague 2 (fait, PR #9), (3) vague 4. Compte
rendu court au chef à la fin de chaque chantier. Aucune CI GitHub : vérification locale (eslint,
tsc, Prettier, tests des 4 paquets).

**Reste à faire (par priorité) :**

1. **Chantier n° 3 (vague 4)** : voir le point 3 ; branche depuis `main`, mêmes vérifications
   (eslint, tsc, Prettier, tests des 4 paquets sur la pointe, audit en lecture seule, recette
   navigateur courte), fusion par le chef.
2. **Lacunes restantes de la vague 2** : AUT-10 (rapport d'avancement hebdomadaire au client,
   généré et validé par le chef de mission), AUT-11 (staffing, V4 au PRD) ; le copilote n'a qu'une
   action et six outils de lecture : à étendre (le registre `ACTIONS` est prévu pour ça) ; sources du
   brief écartées (offres techniques, plans, révisions de budget, rapports « validés non diffusés »
   faute de trace de diffusion).
3. **Vague 4** (chantier n° 3) : services #2 et #5 augmentés, voix et WhatsApp, signature
   électronique (PRD complémentaire §18) ; PLA-15, 16, 18, NOT-12 (simulateur), CAP-03, CAP-04,
   AO-01 (veille multi-sources) hors de ce qui est livré.
4. **Dettes de la vague 1** : QUA-05 ; DOS-05 ; STD-11 complet, STD-13, STD-14 ; extraction IA
   depuis un PDF (DOS-03) ; PRV-06 web ; AGT-06 cache, agent contradicteur ; `IMPORT_INVALIDE` du
   dossier à convertir en `AppError` ; rapport d'état financier.
5. **Dettes du rejeu et du copilote** (`SECURITY.md` §15) : file `jobs` FIFO partagée entre
   cabinets ; garde de provenance contournable par du SQL arbitraire du même rôle (fonction
   SECURITY DEFINER réservée au job) ; liaison du modèle routé à l'activation ; routage du copilote
   qui appelle le fournisseur sans passer par `orchestrateur.ts` (écart assumé, à valider) ; noms
   propres tapés dans un message du copilote partis en clair vers le modèle (masquage par formats
   seulement) ; plafond de débit du brief tenu en mémoire (n instances = n fois 60) ; la `date`
   rejouée du brief n'est pas persistée.
6. **Autres dettes** (`CODING_STANDARDS.md` §10, `SECURITY.md` §15) : accusé de réception de la
   salle traité hors file ; `executions.executant_id` à comparer au responsable courant dans le job
   d'agent d'une automatisation réactivée par un autre ; `semaineQuerySchema` non borné ; dix pages
   web qui lisent `/api/missions` ou `/api/opportunites` demandent des pages de 200 ; génération
   « gabarit » d'un retour d'expérience qui remplace le texte rédigé ; pied de page « relu et validé
   par un consultant » sur un dossier de revue KPI en brouillon ; montants du PDF du dossier bancaire
   sans séparateur de milliers visible à l'extraction texte (le moteur insère U+202F : à vérifier à
   l'œil) ; 503 signalé par le réseau sur l'export de CV alors que le fichier est valide ; ADR-009
   (ingestion, OCR) citée mais absente ; fichiers web de plus de 400 lignes, fonctions de plus de 60
   lignes.
7. **Valeurs provisoires** (`DECISIONS.md`, laissées en l'état) : plafonds de la vague 2 et 3
   (50 automatisations actives, 30 simulations par 10 minutes, 20 dépôts par pièce, 500 Mo par
   demande, 30 dépôts du portail par 10 minutes, 20 dossiers et 50 extractions par fiche d'appel
   d'offres, 100 gabarits de CV, 30 propositions de portefeuille par 10 minutes, 60 recherches par
   minute, 10 dossiers de revue par 10 minutes, 50 déclarations de niveau par couple) ; plancher de
   confiance NOT-11 (0,3, 2 répondants) ; rejeu OpenRouter (2 USD par évaluation, 5 rejeux par 24 h,
   8 min, péremptions 1 h et 30 min) ; brief (seuils de gravité, 60 requêtes par 10 minutes, lots de
   500, anti-répétition de 10 minutes de l'événement de clôture) ; copilote (30 messages par
   10 minutes, 1000 caractères, 5 minutes, N2, 30 jours, 5 « KPI au rouge » par 10 minutes, purge à
   02:30 UTC) ; les jours de budget sont visibles d'un consultant dans la section « Écarts » d'un
   retour (FIN-02 ne vise que les montants : à confirmer).

**Pièges :**

- **Serveurs de recette** : lancer l'API et le web comme processus DÉTACHÉS (PowerShell
  `Start-Process`) sous un nom d'exécutable distinct (copie de `node.exe` renommée) : une commande qui
  tue `node.exe` les arrêtait en pleine recette. L'API met ~40 s à répondre ; le premier chargement
  d'une page en mode dev prend 10 à 60 s. Trois origines (`localhost`, `127.0.0.1`, `[::1]`) ont des
  cookies séparés et sont acceptées par la garde d'origine : jusqu'à trois testeurs en parallèle. Le
  groupe d'onglets de l'extension Chrome est partagé entre les testeurs : chacun crée son onglet et
  vérifie l'origine avant d'agir. Le navigateur intégré de l'application Claude a cessé de répondre
  pendant la recette (volet masqué) : Chrome (extension) a été utilisé.
- **Next dev** : un bloc dupliqué dans un fichier par deux éditions concurrentes cassait la
  compilation d'une page ; le typecheck global le détecte : le relancer après tout lot d'agents
  parallèles avant de commiter.
- **Page serveur** : ne jamais passer une FONCTION à un composant client (propriétés sérialisables
  seulement ; cas de `/methodes/[id]`, corrigé par `versionDans`).
- **Tests API** : une base par agent (`DATABASE_URL` / `DATABASE_OWNER_URL` vers `missionpilot_<id>`,
  suffixe `_test` ajouté) ; le global-setup supprime et recrée le schéma de la base de test à
  chaque exécution ; jamais deux suites API en parallèle sur la même base ; la suite complète dure
  20 à 47 minutes (la lancer détachée). PostgreSQL du projet : conteneur `missionpilot-postgres`
  (port 55440), à relancer par `pnpm db:up` après un redémarrage de Docker. Les bases
  `missionpilot_*_test` créées par les agents s'accumulent : à purger.
- **Migrations** : plages dans `CODING_STANDARDS.md` §1 (prochains libres : AGT `0275`, AUT `0305`) ;
  un fichier qui référence une table d'un autre domaine a un numéro PLUS GRAND ; migrations commitées
  = immuables (0271 à 0274, 0303 et 0304 le sont depuis la PR n° 9) ; toute
  nouvelle colonne qui référence `fichiers` est couverte par l'inventaire automatique de
  `fichiers-orphelins-references.test.ts`.
- **Jobs** : toute constante `TYPE_JOB_*` exportée doit figurer dans `REGISTRE_JOBS`
  (`jobs-registre.test.ts`).
- **Dates métier** bornées par un CHECK SQL : `dateIsoBorneeSchema` (2000 à 2100).
- **Recherches mécaniques** de `.claude/rules/review-checklist.md` : à relancer avant chaque
  livraison (677 routes dont 8 sans `exiger`, 574 `z.object` tous stricts, 23 `GRANT EXECUTE`).
- **Évaluations locales** d'agents : elles prouvent le câblage d'un prompt, pas la qualité d'un
  modèle (ADR-005) ; hors développement et test, elles n'activent rien.
- **Agents** : `dev-complex-high` (implémentation, Sonnet 5.5 effort high), `code-reviewer`,
  `security-auditor`, `ui-tester` (lecture, recette) ; limite de 10 agents en parallèle ; un agent
  teste sur sa propre base ; aucun agent ne commite.
- Base de développement `missionpilot` : contient des données de recette ; le cabinet de
  démonstration Abidjan se crée par `db:seed-demo` (RUNBOOK). Base de recette
  `missionpilot_recette` (cabinet Lagune, comptes de démonstration, connexion rapide sans mot de
  passe avec `CONNEXION_RAPIDE_DEMO=oui`) : données préfixées RECETTE-A à RECETTE-R3 laissées par la
  recette ; la mission « Kora » y est clôturée.
- Configuration hors développement : `TFA_MASTER_KEY`, SMTP, `STORAGE_DIR` obligatoires ;
  `WEB_ORIGIN` = adresse exacte du web (sinon 403 `ORIGINE_REFUSEE`) ; `CHROMIUM_PATH` pour les PDF.

Valeurs métier de la V1 et de la V2 à faire valider (posées par défaut) : TVA 18 %, retenue à la
source désactivée, seuils d'approbation 5 M / 25 M / 10 M XOF (validés par l'utilisateur le
2026-10-06), IS 25 %, actualisation 12 %, codes SYSCOHADA indicatifs, libellés des classes A à E
(`apps/web/src/lib/notation.ts`), modèles IA recommandés et tarifs (`ia/modeles.ts`), taux USD de
départ (`ia/couts.ts`), plafond IA 50 USD, suivi KPI quotidien à 7 h UTC, conservation du texte IA
365 jours et des rapports 3 ans (**avis du conseil juridique requis**), mention de la contribution
IA activée par défaut. Seuils de la vague 1 à calibrer au pilote : poids de fiabilité A–D, plafond 2
et seuils 0,75 / 0,5 de solidité ; promotion d'autonomie 50 exécutions / 95 % / 90 jours ;
modification majeure au-delà de 25 % ; incident majeur → N2.
