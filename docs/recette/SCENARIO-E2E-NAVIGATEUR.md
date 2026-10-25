# Scénario E2E navigateur — exécution autonome par Claude in Chrome

Recette de bout en bout de MissionPilot, conçue pour être jouée **seule** par un agent « Claude in Chrome »
(extension navigateur), sans intervention humaine, jusqu'à la première anomalie bloquante.

- Rédigé le 2026-10-24 (branche `ci/deploiement-vps`, base `main` au merge #16) **par lecture du code, du RUNBOOK
  et des recettes précédentes** (`SCENARIO-E2E-MISSION-ORGANISATION.md`, `2026-10-23-recette-finale.md`). Il n'a **pas
  encore été rejoué**. Un libellé qui diffère légèrement de l'écran est une anomalie **mineure** (ou une erreur du
  scénario) tant que l'action reste possible : la relever, ne pas s'arrêter.
- L'agent **relève, ne corrige pas**. Les anomalies non bloquantes sont consignées et le scénario continue ; la
  première anomalie bloquante arrête tout et produit un **prompt de correction** à coller dans Claude Code.
- Le scénario détaillé de la chaîne « mission d'audit organisationnel » (E01 à E64, avec les calculs complets,
  la clôture mensuelle et la clôture de mission) reste dans `SCENARIO-E2E-MISSION-ORGANISATION.md` ; celui-ci
  en reprend l'épine dorsale (phases C à F) et y ajoute le portail, les modules V2/V3 et les contrôles transverses.

## 0. Prompt de lancement (à coller dans Claude in Chrome)

```text
Tu es le testeur de recette de MissionPilot (interface en français). Exécute dans ce navigateur, de bout en bout et
sans me demander de validation, le scénario fourni : docs/recette/SCENARIO-E2E-NAVIGATEUR.md (je te le colle ci-dessous
en entier). Respecte strictement ses sections 1 (règles), 3 (classement des anomalies) et 4 (protocole d'arrêt).
Joue les étapes dans l'ordre. Anomalie non bloquante : note-la et continue. Anomalie bloquante : arrête-toi,
collecte les preuves en lecture seule, puis donne-moi le rapport partiel et un prompt de correction autonome
(format de la section 4.3) que je collerai dans Claude Code. N'écris jamais dans le code, la base ni les fichiers.
```

## 1. Règles pour l'agent exécutant

1. **Périmètre.** Seule l'application locale est testée : `http://localhost:3100` (web) et `http://localhost:4100`
   (API). Utiliser `localhost`, jamais `127.0.0.1` ni `[::1]` (sinon 403 `ORIGINE_REFUSEE` à chaque enregistrement).
   **Si l'adresse contient `allianceconsultants.net` ou n'importe quel autre hôte distant : s'arrêter aussitôt et le dire**
   (c'est la production, jamais de recette dessus).
2. **Lecture seule hors application.** Ne modifier ni code, ni fichier, ni base, ni configuration. Aucune commande
   hors navigateur. Le seul usage de `javascript_tool` autorisé : lecture (mesures de page, `fetch` en **GET**).
   Interdit : `POST/PUT/PATCH/DELETE` par script (sauf cas négatif marqué « console » dans une étape), contournement
   d'un bouton, lecture de cookies ou de stockage, saisie de secret réel.
3. **Vrais gestes.** Cliquer et saisir comme un utilisateur (`computer`, `form_input` pour les listes). Si un clic ne
   produit rien : attendre 2 s, réessayer **une fois**, puis le noter. Garder **l'onglet MissionPilot actif et au premier
   plan** : un onglet en arrière-plan est bridé (rendu à ~5 images/s) et fausse les constats de rafraîchissement.
4. **Actions irréversibles** (signature, émission d'une facture, validation d'un jalon, clôture) : ne jamais les rejouer
   par réflexe. En cas de doute (page figée, réponse perdue), **relire l'état à l'écran avant** toute nouvelle tentative.
5. **Données fictives.** Tout est fictif (cabinet « Lagune Conseil & Associés (démo) »). Aucun e-mail réel ne part
   (pas de SMTP). Préfixer les données créées par `E2E ` pour les reconnaître.
6. **Économie.** Préférer `read_page`, `find`, `get_page_text` aux captures. Prendre une capture seulement comme
   **preuve** d'une anomalie ou à la fin d'une phase. Regrouper les appels indépendants.
7. **Connexion.** Page `/connexion`, bloc « Comptes de démonstration (environnement local) » : un clic sur le nom
   ouvre la session, **sans mot de passe**. Changer de compte = « Se déconnecter » (menu), puis un autre nom. Une
   seule session à la fois dans le navigateur. Les comptes « 2FA » (`associe.2fa`, `dirigeant.client.2fa`) sont
   refusés par la connexion rapide : ne pas les utiliser (hors périmètre).

## 2. Prérequis (à préparer par l'utilisateur, avant de lancer l'agent)

Voir `docs/workflows/RUNBOOK.md` (« Cabinet de démonstration pour la recette humaine »). Résumé PowerShell :

```powershell
pnpm db:up
# base DÉDIÉE et NEUVE (ne jamais viser une base qui n'est pas la vôtre)
docker exec missionpilot-postgres psql -U missionpilot_owner -d postgres -c "CREATE DATABASE missionpilot_e2e"
$env:DATABASE_OWNER_URL = "postgres://missionpilot_owner:dev_only_owner_password@127.0.0.1:55440/missionpilot_e2e"
$env:DATABASE_URL       = "postgres://missionpilot_app:dev_only_app_password@127.0.0.1:55440/missionpilot_e2e"
pnpm db:migrate
pnpm --filter @missionpilot/api db:seed-demo     # cabinet, portail, 2FA, canaux, redressement, services candidats
$env:CONNEXION_RAPIDE_DEMO = "oui"
pnpm dev                                          # API 4100 + web 3100, même fenêtre d'environnement
```

- Lancer le seed **le jour même** de la recette : ses dates sont relatives et le calendrier ci-dessous en dépend.
- Pour les PDF du produit (rapports) : Chrome installé. Sans lui, le PDF répond 503 (à noter, non bloquant).
- Fichiers à téléverser (déjà dans le dépôt, chemins absolus pour `file_upload`) :
  `D:\APP\MissionPilot\docs\recette\fixtures\e2e-rapport-provisoire.pdf`,
  `D:\APP\MissionPilot\docs\recette\fixtures\e2e-rapport-provisoire-v2.pdf`,
  `D:\APP\MissionPilot\docs\recette\fixtures\e2e-faux-fichier.pdf` (du texte nommé `.pdf`, doit être refusé).

### 2.1 Calendrier (exécution le samedi 2026-10-24)

| Repère | Valeur | Règle si exécuté un autre jour |
| --- | --- | --- |
| L0 (lundi de la semaine en cours) | lundi 2026-10-19 | — |
| **D0** (début de mission) | **lundi 2026-09-14** | L0 − 5 semaines ; S1 et S2 dans le même mois civil, sans jour férié |
| S1 (semaine saisie en X) | 14 → 18 septembre 2026 | semaine de D0 |
| Signature de la lettre | **vendredi 2026-09-11** | D0 − 3 jours |
| Fin de mission | **vendredi 2026-10-30** | D0 + 46 jours |
| Aujourd'hui (encaissements) | 2026-10-24 | jour d'exécution |

### 2.2 Comptes (domaine `@lagune-conseil.test`, un clic sur le nom à la connexion)

| Nom | Identifiant | Rôle | Sert à |
| --- | --- | --- | --- |
| Awa Koné | `associe` | Associé | client, taux de vente, validation de proposition, finances, balayages |
| Yao Kouassi | `directeur.mission` | Directeur de mission | signature, approbation de factures, plan de redressement |
| Mariam Traoré | `chef.mission` | Chef de mission | opportunité, proposition, mission, découpage, affectations, validation des temps |
| Koffi N'Guessan | `consultant` | Consultant senior | temps, débours, cas négatifs de droits |
| Adjoua Kacou | `consultant.junior` | Consultant junior | temps |
| Serge Bamba | `gestionnaire` | Gestionnaire administratif et financier | échéancier, factures, encaissements |
| Jean-Baptiste Kouadio | `dirigeant.client` | Dirigeant client (portail) | portail |
| Nadège Yapi | `contributeur.client` | Contributeur client (portail) | portail, questionnaires |
| Moussa Coulibaly | `investisseur.client` | Investisseur (portail) | portail restreint |

### 2.3 Jeu de données de la chaîne principale (phases C à G)

| Élément | Valeur |
| --- | --- |
| Client | `E2E Atlantic Plastiques (fictif)`, SARL, RCCM `CI-ABJ-2019-B-98765`, compte contribuable `9876543A`, secteur `Industrie plastique`, pays Côte d'Ivoire, taille PME, adresse `Zone industrielle de Yopougon, Abidjan` |
| Contact principal | `Marc Tanoh`, `Directeur général`, `marc.tanoh@atlantic-plastiques.test` |
| Opportunité | `E2E Audit organisationnel Atlantic Plastiques`, type « Audit organisationnel », XOF, `7000000`, probabilité `60`, étape « Qualification » puis « Proposition » |
| Proposition v1 | 37,5 j (Directeur 5,5 ; Consultant senior 17 ; Consultant junior 15) ; 3 phases, 4 lots, 9 tâches, 2 jalons ; honoraires **6 675 000** puis **6 760 000** XOF avec le taux senior `180000` |
| Budget signé V1 (vu par l'associé) | honoraires 6 760 000 ; coûts internes **3 490 000** ; marge **3 270 000** (48,4 %) |
| Échéancier | « Acompte à la signature » **2 028 000** ; « Solde à la fin de la mission » **4 732 000** |
| Facture d'acompte | HT 2 028 000 ; TVA 18 % **365 040** ; TTC = net à payer **2 393 040** |
| Temps S1 validés | Koffi : Réunion de lancement lun 1 j ; Revue documentaire mar 1 j, mer 1 j (**3 j**). Adjoua : Collecte de la documentation lun 1 j, mar 1 j ; Revue documentaire mer 1 j, jeu 1 j, ven 1 j (**5 j**). Total **8 j** |
| Débours | Koffi, date 2026-09-22, « Transport », `Déplacement chez le client à Yopougon`, `150000`, refacturable |
| Encaissement | `2393040`, « Virement », référence `VIR-E2E-0001`, date du jour |

## 3. Classement des anomalies

Chaque constat reçoit une **gravité**. Seule la gravité **B** arrête le scénario.

| Gravité | Nom | Critère | Suite |
| --- | --- | --- | --- |
| **B** | Bloquante | **B1** impossible de poursuivre (écran, bouton ou action indispensable cassé, état incohérent qui fausse la suite) ; **B2** donnée perdue, doublon, montant ou calcul différent d'un point de contrôle chiffré de ce document ; **B3** faille de droits ou de confidentialité (coûts, marges ou taux visibles d'un rôle non autorisé ; le portail voit un contenu interne ; l'interface cabinet atteignable depuis un compte client ; contenu d'un autre cabinet) ; **B4** plantage (page blanche, écran d'erreur global, `500`, boucle de redirection) sur un parcours principal ; **B5** action irréversible exécutée à tort ou non exécutée alors que confirmée | **Arrêt** (section 4) |
| **M** | Majeure non bloquante | fonction dégradée avec contournement, message d'erreur technique visible (code brut en majuscules, `undefined`, `NaN`, `[object Object]`), `4xx` inattendu récupérable, liste non rafraîchie mais donnée bien enregistrée après rechargement | consigner, continuer |
| **m** | Mineure | libellé ou accent différent, message peu clair, avertissement console, lenteur > 5 s, défaut d'alignement ou de responsive sans perte de fonction | consigner, continuer |
| **c** | Cosmétique / suggestion | finition, ergonomie, amélioration | consigner, continuer |

**Avant de déclarer une anomalie bloquante :**

1. **Rejouer une fois** : recharger la page et refaire le geste (sauf action irréversible : relire d'abord l'état).
2. **Écarter une erreur de scénario** : donnée de départ manquante (étape antérieure ratée, date hors calendrier),
   mauvais compte, libellé voisin. Si le scénario est en cause : consigner « É-scénario » en **m** et adapter.
3. **Écarter les écarts connus** (ne pas les rapporter en B) :
   - bandeau « Enregistrement impossible — service momentanément indisponible » ou liste non rafraîchie après un
     enregistrement (anomalies A-03/A-04, contournement `DebloqueurRendu`) : si, **après rechargement**, la donnée est
     bien présente → **M** (noter l'heure `hh:mm:ss`, l'écran, l'action, les requêtes `POST/PATCH` et `?_rsc=` en
     échec) ; si elle est **absente** → **B2** ;
   - PDF des rapports en `503` sans Chrome installé → **m** ;
   - Copilote et générations IA : aucune clé IA n'est configurée, le message « IA non configurée / indisponible »
     est **attendu** (un message lisible n'est pas une anomalie ; un plantage en est une).

## 4. Protocole de l'agent

### 4.1 Pour chaque étape

1. Exécuter l'action. 2. Comparer à « Résultat attendu » (les messages entre « » sont ceux du code, à comparer
mot pour mot). 3. Appliquer le **contrôle de santé de page** (4.4) sur l'écran atteint. 4. Consigner dans le journal :
`ID — R` (réussi), `ID — O` (observation, anomalie M/m/c, numéro `AN-nn`) ou `ID — É` (échec, B).

### 4.2 Arrêt sur anomalie bloquante

1. **Stop** : ne plus rien cliquer qui modifie des données. 2. **Preuves en lecture seule** : URL exacte, texte de la
page (`get_page_text`), `read_console_messages` (erreurs), `read_network_requests` (méthode, URL, statut, corps de la
réponse d'erreur **sans cookie ni en-tête d'authentification**), heure, compte, une capture. 3. **Rapport partiel**
(4.5). 4. **Prompt de correction autonome** (4.3), un seul, qui regroupe les symptômes liés. 5. Indiquer le **point de
reprise** et l'état à conserver (la base n'est pas réinitialisée). 6. **Terminer.**

### 4.3 Format du prompt de correction (à produire tel quel, dans un bloc `text`)

Le prompt doit se suffire à lui-même : Claude Code ne voit pas la conversation du navigateur.

```text
Corrige l'anomalie bloquante AN-BL-01 relevée par la recette navigateur (docs/recette/SCENARIO-E2E-NAVIGATEUR.md, étape <ID>).

CONTEXTE
- Branche/commit testé : <inconnu si non visible> ; base de recette : missionpilot_e2e ; web localhost:3100, API localhost:4100.
- Compte : <nom, rôle> ; date/heure : <AAAA-MM-JJ hh:mm:ss>.
- Gravité : B<1..5> — <phrase : pourquoi c'est bloquant>.

REPRODUCTION
1. <geste précis avec URL et libellés exacts>
2. ...

ATTENDU : <citation du scénario>
OBTENU  : <ce qui s'affiche, texte exact>

PREUVES
- URL : <...>
- Réseau : <MÉTHODE /api/... → statut ; extrait du corps d'erreur (code métier, message)>
- Console : <erreurs, 1 à 3 lignes>
- Rechargement : <la donnée est-elle présente / absente ?>

PISTES (hypothèses à vérifier, non établies) : <écran apps/web/src/app/(app)/... ; route API /api/... ; migration ou RLS si droits>

CONSIGNES
- Lis docs/workflows/HANDOFF.md et AGENTS.md avant de modifier ; respecte les règles du projet (chiffres jamais du LLM,
  isolation par cabinet/RLS, données financières internes, validations réservées).
- Reproduis d'abord par un test (Vitest : API sur vrai PostgreSQL, ou web) qui échoue, puis corrige à la racine, sans
  affaiblir une garde de sécurité ni un test existant.
- Lance typecheck, lint, format et les tests ciblés ; mets à jour docs/workflows/HANDOFF.md.
- Livre sur une branche fix/e2e-<ID>, sans fusionner ; indique l'étape du scénario à rejouer.
```

### 4.4 Contrôle de santé de page (CSP)

À appliquer sur chaque écran atteint (rapide, en lecture seule) :

- **H1** un titre de page (`h1`) est affiché ; pas d'écran d'erreur (« Une erreur est survenue », « n'a pas pu être chargé »
  hors état attendu), pas de texte brut `undefined`, `NaN`, `null`, `[object`, ni de code technique en majuscules
  (`ACCES_REFUSE`, `DATE_LIMITE_DEPASSEE`…) montré à l'utilisateur → sinon **M** ;
- **H2** aucune requête `5xx` (→ **B4** sur un parcours principal, **M** sinon) et aucun `4xx` inattendu (**M**) ;
- **H3** aucune erreur console (**m**) ;
- **H4** pas de débordement horizontal à 1280 px : `document.documentElement.scrollWidth <= window.innerWidth`
  (**m**) ;
- **H5** montants avec séparateur de milliers et la devise ; dates au format français (`JJ/MM/AAAA`), jamais ISO brute (**m**).

### 4.5 Rapport final ou partiel (à restituer dans la conversation)

1. **Verdict** : `TERMINÉ`, ou `ARRÊTÉ à <ID>` (B<n>).
2. **Journal** : tableau `ID | compte | résultat (R/O/É) | remarque courte`, étapes non jouées en « — ».
3. **Anomalies non bloquantes** : tableau `AN-nn | gravité M/m/c | étape | URL | constat (attendu → obtenu) | preuve`.
4. **Anomalie bloquante** (si arrêt) : description, preuves, puis le **prompt de correction** (4.3).
5. **Reprise** : « Reprendre à `<ID>` », état conservé, étapes à ne pas rejouer.
6. **Limites** : ce qui n'a pas pu être vérifié (et pourquoi).

## 5. Étapes

Légende de la colonne **Si KO** : **B** = bloquante par défaut, **M/m** = gravité par défaut d'un écart,
**(B si …)** = devient bloquante sous la condition indiquée. `<ID>` = identifiant de la mission dans l'URL
`/missions/<ID>`.

### Phase PF — Pré-vol (aucune donnée écrite)

| ID | Compte | Action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| PF1 | — | Ouvrir `http://localhost:4100/api/sante` | JSON de santé, statut 200 | B |
| PF2 | — | Ouvrir `http://localhost:3100/connexion` | Page de connexion ; bloc « Comptes de démonstration (environnement local) » avec deux groupes « Espace cabinet » et « Espace client (portail) » | B (sans bloc : variable `CONNEXION_RAPIDE_DEMO` absente → le dire) |
| PF3 | — | Vérifier l'adresse | `localhost` et pas un hôte distant (règle 1.1) | B |
| PF4 | — | Lire la liste des comptes | Les neuf comptes de 2.2 sont présents | B |

### Phase A — Accès et menus par rôle

| ID | Compte | Action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| A01 | Awa Koné | Clic sur son nom | Tableau de bord ; menu complet : Tableau de bord, Mon planning, Feuille de temps, Missions, Mes tâches, Mon brief, Copilote, Pipeline, Appels d'offres, Clients, Collaborateurs, Catalogue, Services candidats, Questionnaires, Notation, Méthodes, Redressement… (Paramètres, Finance, Indicateurs en bas) | B |
| A02 | Awa | « Se déconnecter » | Retour à `/connexion` ; revenir en arrière dans l'historique ne rouvre pas la session | B3 si la session reste ouverte |
| A03 | Koffi N'Guessan | Connexion, lire le menu | **Pas** de Facturation, Finance, Indicateurs, Paramètres, Pipeline, Plan de charge, Collaborateurs | B3 |
| A04 | Koffi | Ouvrir `/finance/rentabilite` puis `/parametres/utilisateurs` | « Accès refusé » (page `acces-refuse` lisible), pas d'écran blanc | B3 si le contenu s'affiche |
| A05 | Jean-Baptiste Kouadio | Connexion (groupe « Espace client ») | Arrivée dans `/portail`, « Bonjour Jean-Baptiste Kouadio » | B |
| A06 | Jean-Baptiste | Ouvrir `/clients`, `/missions`, `/finance`, `/parametres` | Refus ou redirection vers le portail ; **aucune** donnée du cabinet affichée | B3 |
| A07 | (même session) | Dans la console : `fetch('/api/clients').then(r=>r.status)` puis `fetch('/api/finance/rentabilite?du=2026-01-01&au=2026-12-31&niveau=mission').then(r=>r.status)` (GET seulement) | `401` ou `403` | B3 |

### Phase C — Commercial : du client à la mission signée

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| C01 | Awa | Clients › « Nouveau client » ; saisir le client de 2.3 ; « Créer le client » | Fiche `/clients/<id>` avec l'identité saisie ; client actif dans la liste | B |
| C02 | Awa | Fiche › « Ajouter un contact » ; Marc Tanoh, cocher « Contact principal » ; « Ajouter le contact » | « Contact ajouté. » ; contact marqué principal (vérifier à l'œil sur la fiche) | M |
| C03 | Mariam Traoré | Pipeline › « Nouvelle opportunité » ; valeurs de 2.3 ; devise « XOF (FCFA UEMOA) » ; responsable Mariam ; « Créer l'opportunité » | Fiche `/pipeline/<id>` : « Ouverte », « Étape : Qualification », 7 000 000 FCFA, 60 % ; « Aucune proposition pour cette opportunité. » | B |
| C04 | Mariam | « Faire avancer l'opportunité » → étape « Proposition » ; « Générer une proposition » : type « Audit organisationnel », intitulé vide, « Générer le brouillon » ; ouvrir « Version 1 » | « Étape mise à jour. » ; version 1, statut « Brouillon », XOF | B |
| C05 | Mariam | Proposition : lire « Chiffrage », « Équipe proposée », « Découpage et jours par grade » | 37,5 j ; honoraires **6 675 000 FCFA** ; jours par grade 5,5 / 17 / 15 **sans taux ni montants** ; message « Les taux journaliers par grade sont réservés aux associés et aux gestionnaires. » ; 3 phases, 4 lots, 9 tâches | B3 si taux visibles ; B2 si chiffres faux |
| C06 | Awa | Même proposition ; carte « Taux journaliers de vente » : Consultant senior `180000` ; « Enregistrer les taux » | « Taux enregistrés. » ; honoraires **6 760 000 FCFA** | B2 |
| C07 | Mariam, puis Awa | Mariam « Soumettre à la validation » (elle n'a **pas** « Valider la proposition ») ; Awa « Valider la proposition », « Oui, confirmer » | Statuts « À valider » puis « Validée » ; le badge passe à « Validée » **sans recharger** (sinon **M**) | B3 si Mariam peut valider |
| C08 | Mariam | « Marquer comme envoyée » ; « Acceptée par le client », « Oui, confirmer » | « Acceptée » ; opportunité « Gagnée » ; carte « Créer la mission » sur la page de la proposition | B |
| C09 | Mariam | « Créer la mission » : directeur « Yao Kouassi », chef « Vous-même », début `2026-09-14`, fin `2026-10-30` ; « Créer la mission » | `/missions/<ID>` : client Atlantic…, directeur Yao Kouassi, chef Mariam Traoré, dates 14/09/2026 → 30/10/2026, XOF, « Forfait », statut « Proposition », origine « Proposition acceptée » | B |
| C10 | Mariam | Mission › Découpage ; ouvrir T1, T2, T3 › « Modifier » : durée `1`, `5`, `10` jours ouvrés (début souhaité vide) ; « Enregistrer » | « N jour(s) ouvré(s) » sur chaque tâche ; synthèse 37,5 j ; carte « Jalons » : « Réunion de lancement » et « Restitution au comité de direction » | M |
| C11 | Mariam | Fiche mission : vérifier l'absence du bouton « Signer la lettre de mission » | Absent (réservé au directeur désigné et aux associés) | B3 |
| C12 | Yao Kouassi | Fiche › « Cycle de vie » › « Signer la lettre de mission » ; date `2026-09-11` ; « Continuer vers la confirmation » ; « Oui, signer et figer le budget » | « Lettre de mission signée » ; statut « Signée » ; plus de bouton de signature ; **un seul** clic de confirmation | B2/B5 |
| C13 | Awa | Mission › Budget | « V1 — Budget initial (signé) », « Figée — référence » : 37,5 j ; honoraires **6 760 000** ; coûts internes **3 490 000** ; marge **3 270 000** (48,4 %) | B2 |
| C14 | Yao | Mission › Budget | Honoraires visibles ; **ni coûts internes ni marge** | B3 |
| C15 | Mariam | Console (GET) : `const id=location.pathname.split('/')[2]; fetch('/api/missions/'+id+'/budget').then(r=>r.text()).then(t=>/couts_internes|marge|taux_marge|prix_journalier/.test(t))` | `false` (champs **absents** de la réponse, pas seulement masqués) | B3 |

### Phase X — Exécution : affectations, temps, débours

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| X01 | Mariam | Mission › Affectations › « Nouvelle affectation » ×4, type « Nominative (une personne) » : Koffi / « Réunion de lancement » 1 j ; Koffi / « Revue documentaire » 2 j ; Adjoua / « Collecte de la documentation… » 2 j ; Adjoua / « Revue documentaire » 3 j. Du/Au repris de la tâche (sinon `2026-09-14` → `2026-09-18`) | « Affectation créée. » ×4 sans avertissement ; « Affectations par tâche » les liste ; Koffi et Adjoua dans la carte « Équipe » | B |
| X02 | Mariam | Affectation Adjoua / « Revue documentaire » de **13 j** (au-delà du budget junior) | Refus lisible du type « Le budget signé prévoit 15 j pour le grade « junior » ; … Créer une révision du budget. » (409), rien créé | B2 si créée ; M si message technique brut |
| X03 | Mariam | Fiche mission › « Démarrer la mission » | « Statut mis à jour. » ; statut « En cours » | B |
| X04 | Koffi | Feuille de temps, URL `/temps?semaine=2026-09-14` ; « Commencer ma feuille » ; saisir `1` : Réunion de lancement lundi ; Revue documentaire mardi et mercredi ; vérifier « Semaine : » = 3 ; « Soumettre la feuille » | Brouillon enregistré automatiquement ; badge « Soumise, en attente de validation » ; saisie verrouillée | B |
| X05 | Adjoua | Même semaine : Collecte… lundi et mardi ; Revue documentaire mercredi, jeudi, vendredi ; total 5 ; « Soumettre la feuille » | « Soumise, en attente de validation » | B |
| X06 | Koffi | Ouvrir `/temps/validation` | « Accès refusé » (pas de droit de validation) | B3 |
| X07 | Mariam | Feuille de temps › À valider ; ouvrir chaque feuille ; dans la carte de la mission, « Valider » | « Partie validée. » ×2 ; feuilles « Validée » | B |
| X08 | Mariam | Mission › Suivi | « Réalisé (validé) » **8 j** ; budget 37,5 j ; avancement physique 0 % ; aucune erreur de calcul (`NaN`) | B2 |
| X09 | Koffi | Mission › Débours › « Déclarer un débours » : valeurs de 2.3 ; « Enregistrer » puis « Soumettre » | « Débours enregistré en brouillon. » puis « Débours soumis à validation. » ; statut « Soumis » ; **pas** de bouton « Valider » pour lui | B3 si Koffi peut valider |
| X10 | Mariam | Débours › « Valider » | « Débours validé. » ; statut « Validé » | B |

### Phase F — Facturation et encaissement

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| F01 | Serge Bamba | Mission › Facturation › « Générer l'échéancier » | « Échéancier généré. » ; budget signé 6 760 000 ; total 6 760 000 ; reste à planifier 0 ; « Acompte à la signature » **2 028 000** et « Solde à la fin de la mission » **4 732 000**, « Prévue » | B2 |
| F02 | Serge | « Marquer à facturer » sur l'acompte ; « Préparer une facture » : cocher l'acompte ; « Créer le brouillon de facture » ; ouvrir | « Facture (sans numéro) », « Brouillon », numéro « Attribué à l'émission » ; HT 2 028 000 ; TVA 365 040 ; TTC **2 393 040** | B2 |
| F03 | Serge | « Soumettre à approbation » ; constater l'absence de « Approuver » | « Facture soumise à approbation. » ; « Votre rôle ne permet pas d'approuver une facture. » | B3 si Serge peut approuver |
| F04 | Yao | Fiche facture › « Approuver » ; constater l'absence de « Émettre la facture » | « Facture approuvée. » ; statut « Approuvée » ; pas d'émission pour Yao | B3 si Yao peut émettre |
| F05 | Serge | « Émettre la facture », « Oui, émettre » ; « Ouvrir le document » ; « Marquer comme envoyée » | Statut « Émise », numéro `FA-2026-NNNNN`, émission = date du jour, échéance +30 j ; document avec mentions du cabinet et du client ; « Envoyée » (aucun envoi réel) | B (si `MENTIONS_INCOMPLETES` : B1) |
| F06 | Serge | Facturation › Encaissements › « Saisir un encaissement » : client Atlantic…, date du jour, montant reçu `2393040`, « Virement », `VIR-E2E-0001`, imputation sur la facture — **avant**, tester le refus : (a) date de demain ; (b) montant imputé `3000000` ; (c) montant sans imputation | (a) « Un encaissement ne se date pas dans le futur. » ; (b) « … (trop-perçu refusé). » ; (c) « Une partie de l'encaissement n'est imputée sur aucune facture… » ; rien n'est enregistré. Puis l'encaissement valide : « Encaissement enregistré et imputé. » ; facture : encaissé 2 393 040, reste à payer 0, badge « Soldée » | B2 si un refus est accepté ; B2 si le solde est faux |
| F07 | Awa | Finance › Rentabilité (par « Mission », du `2026-09-01` à aujourd'hui) ; Indicateurs | Ligne de la mission avec honoraires 6 760 000 ; coûts internes et marge **cohérents** (les jours validés valent 8 j : relever les valeurs, pas de `NaN` ni d'écran vide) | M (B2 si honoraires ≠ 6 760 000) |

### Phase G — Documents et rapports

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| G01 | Mariam | Mission › Documents ; lire | « Lettre de mission » en version 1 déjà présente, créée à la signature | M |
| G02 | Mariam | « Déposer un document » : type « Livrable », nom `E2E Rapport provisoire d'audit`, fichier `e2e-rapport-provisoire.pdf` (`file_upload`) ; « Déposer » | Livrable déposé en version 1 | B |
| G03 | Mariam | « Nouvelle version » avec `e2e-rapport-provisoire-v2.pdf` ; puis avec **le même** fichier | Version 2 créée, version 1 conservée ; même fichier : « Fichier identique à la version courante : choisissez un autre fichier. » (pas de version 3) | B2 si version 3 |
| G04 | Mariam | « Déposer un document » avec `e2e-faux-fichier.pdf` | Refus lisible (le contenu n'est pas un PDF) ; rien n'est déposé | B3 si accepté |
| G05 | Mariam | Mission › Rapports : format « Word (.docx) », « Générer l'état d'avancement » | Alerte « Rapport généré … au statut « Brouillon » » ; fichier listé (ne pas télécharger) | M (PDF sans Chrome : m) |

### Phase P — Portail client (Cacao Savane Export (fictif))

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| P01 | Jean-Baptiste Kouadio | `/portail` | « Bonjour Jean-Baptiste Kouadio » ; contenu partagé, « Votre interlocuteur » = Yao Kouassi ; **aucun** contenu interne (coûts, notes internes) | B3 |
| P02 | Jean-Baptiste | Missions › « Accompagnement à la mise en œuvre du plan Cacao Savane » | Jalons : « Cadrage validé… » validé ; « Diagnostic stratégique restitué » **à valider** ; un jalon à venir | B |
| P03 | Jean-Baptiste | Valider le jalon « Diagnostic stratégique restitué » (confirmer une seule fois) | Jalon « validé », date et auteur affichés ; action non rejouable | B5 |
| P04 | Jean-Baptiste | Factures | Deux factures émises, dont `FA-…-00002` partiellement encaissée **en retard** | M |
| P05 | Jean-Baptiste | KPI | « Chiffre d'affaires mensuel » (cible 450 M FCFA), « Délai moyen de recouvrement des créances » (cible 45 j), « Satisfaction des planteurs partenaires » (cible 85 %) | M |
| P06 | Jean-Baptiste | Synthèse, Signatures, Salle, Avancement (ouvrir chaque entrée du menu portail) | Chaque page se charge (CSP) ou affiche un état vide explicite ; aucune donnée d'une autre mission/client | B3 si fuite |
| P07 | Nadège Yapi | Portail › Factures | Pas de factures (droits du rôle), message lisible et non une erreur brute | B3 si factures visibles |
| P08 | Nadège | Questionnaires › « Questionnaire préliminaire des dirigeants » | Brouillon de réponse commencé, répondant « Directrice administrative et financière » ; enregistrer une réponse de plus (brouillon) | M |
| P09 | Nadège | Questionnaires › « Notation de la compétitivité… » (mode collectif) ; tenter de soumettre | Refus lisible : la date limite est dépassée (le code `DATE_LIMITE_DEPASSEE` ne doit pas être montré brut) ; rien n'est soumis | B2 si la soumission passe ; M si message brut |
| P10 | Moussa Coulibaly | `/portail` | Espace restreint de l'investisseur ; **pas** de factures ni de questionnaires du client | B3 |

### Phase Q — Modules V2 et V3 côté cabinet (balayage ; compte Awa sauf mention)

Pour chaque ligne : ouvrir l'URL, appliquer le **CSP** (4.4), vérifier l'élément attendu. Un écran vide explicite est
un résultat valable (R). `Si KO` par défaut : **M** ; **B4** si l'écran plante.

| ID | URL | Élément attendu |
| --- | --- | --- |
| Q01 | `/brief` | « Mon brief » ; chiffres sans `NaN` |
| Q02 | `/copilote` | Page du copilote ; message « IA non configurée/indisponible » **lisible** sans plantage |
| Q03 | `/pipeline`, `/previsions` | Liste/kanban du pipeline ; « Prévisions » (carnet signé, pipeline pondéré) |
| Q04 | `/appels-offres`, `/appels-offres/veille`, `/appels-offres/banques` | Listes ou états vides ; veille simulée sans erreur |
| Q05 | `/questionnaires`, `/questionnaires/generation-ia` | Modèles `preliminaire_dirigeants` et `notation_generique` validés ; génération IA : message lisible |
| Q06 | `/notation`, `/notation/banque`, `/notation/calibrations` | Pages de notation chargées |
| Q07 | Mission « Accompagnement … Cacao Savane » › Notation, KPI, Plan | `/missions/<id>/notation`, `/kpi`, `/plan` : KPI du seed visibles, plan sans erreur |
| Q08 | `/methodes`, `/methodes/missions`, `/methodes/dictionnaire` | Éditeur de méthodes ; liste des méthodes du standard |
| Q09 | `/qualite`, `/qualite/satisfaction`, `/qualite/revue-froide` | Pages de qualité ; mission clôturée du seed dans la revue à froid |
| Q10 | `/connaissances`, `/connaissances/competences`, `/connaissances/estimation` | Pages chargées |
| Q11 | `/charge`, `/indicateurs`, `/finance`, `/finance/encours` | Plan de charge sans surcharge inattendue ; indicateurs ; encours |
| Q12 | `/agents`, `/agents/executions`, `/notifications`, `/mes-taches` | Chargées ; notifications du seed visibles |
| Q13 | `/observatoire` | Page chargée (non semé : état vide ou adhésion proposée) |

### Phase R — Redressement (client « Transports Akwaba (fictif) »)

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| R01 | Awa | `/redressement` | Deux dossiers : « Redressement Transports Akwaba (fictif) » **actif** et « Redressement express Transports Akwaba (fictif) » **clos** | B |
| R02 | Awa | Ouvrir le dossier actif ; parcourir Tableau de bord, Diagnostic, Ratios, Trésorerie, Créanciers, Leviers, Plan, Suivi, Clôture | Chaque page se charge (CSP) ; trésorerie à 13 semaines ; plan **validé par le directeur** ; bilan de clôture en **brouillon** ; aucun montant `NaN` | B4 si plantage ; B2 si total incohérent |
| R03 | Mariam | Page « Plan » : chercher « Valider » | Pas de validation possible pour elle ; un directeur seul valide | B3 |
| R04 | Yao | Page « Clôture » du dossier actif (ne pas valider) | Bouton de validation réservé au directeur visible/lisible ; message lisible | M |
| R05 | Awa | Dossier clos : tenter une modification | Modification refusée ou boutons absents | B2 si modifiable |

### Phase S — Signatures, canaux, services candidats, due diligence

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| S01 | Awa | Mission « Cacao Savane » › Signatures › « Lettre de mission - signature electronique (DÉMONSTRATION) » | Demande envoyée ; Fanta Doumbia (cabinet) et Salimata Bakayoko (client) ; **personne n'a signé** | M |
| S02 | Awa | Tenter de signer | Refus lisible : la double authentification doit être active (le code `TFA_INACTIVE` ne doit pas apparaître brut) ; rien n'est signé | B3 si signature acceptée sans 2FA ; M si message brut |
| S03 | Awa | `/parametres/canaux` | Compte WhatsApp simulé **actif**, saisie de KPI activée, alerte KPI désactivée par défaut | M |
| S04 | Awa | `/parametres/canaux/destinataires`, `/journal`, `/saisies`, `/simulateur` | Deux destinataires (Salimata Bakayoko `+2250000000012` joignable ; Nadège Yapi `+2250000000000` non joignable) ; journal avec **un échec** vers le numéro non joignable ; simulateur lisible | M |
| S05 | Awa | `/services-candidats` | « Services candidats » ; diagnostic flash au prix **1 000 000 XOF** marqué `DÉMONSTRATION` ; missions « Diagnostic flash (DÉMONSTRATION) » et « Business plan bancable (DÉMONSTRATION) » | M |
| S06 | Awa | `/services-candidats/guichets` | « Guichet fictif A » et « Guichet fictif B », marqués `DÉMONSTRATION, à valider` | M |
| S07 | Awa | Fiche du client actif « Cacao Savane Export (fictif) » | Bouton « Proposer un diagnostic flash » menant à `/services-candidats` | m |
| S08 | Awa | `/parametres/due-diligence`, `/modeles`, `/exclusions`, `/signaux`, `/portail` | Pages chargées ; modèles sectoriels (vides par conception) | M |
| S09 | Awa | Mission › Due diligence (`/missions/<id>/due-diligence`) | Liste ou état vide explicite ; « Nouveau » accessible | M |

### Phase T — Paramètres, audit, sécurité du compte

| ID | Compte | Écran / action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| T01 | Awa | `/parametres`, `/utilisateurs`, `/facturation`, `/temps`, `/cloture`, `/cloture-mission`, `/notation`, `/portail`, `/ia`, `/securite` | Chaque page se charge (CSP) ; Facturation : RCCM, compte contribuable, adresse renseignés, préfixe FA, TVA 18 % | M |
| T02 | Awa | `/parametres/journal` | Journal d'audit : y trouver les actions de cette recette (création du client E2E, signature de la lettre, émission de la facture, encaissement) avec auteur et heure | B2 si une action sensible n'est pas journalisée |
| T03 | Awa | `/compte/securite` | Page de sécurité du compte (double authentification proposée, non activée) | m |

### Phase Z — Transversal

| ID | Compte | Action | Résultat attendu | Si KO |
| --- | --- | --- | --- | --- |
| Z01 | Mariam | `resize_window` mobile (375×812), recharger ; ouvrir `/`, `/missions`, la mission E2E, `/temps` | Barre basse + bouton « Menu » (liste complète, « Sécurité du compte », déconnexion) ; pas de défilement horizontal ; boutons utilisables | m (B1 si une action indispensable est inaccessible) |
| Z02 | Jean-Baptiste | Même contrôle sur `/portail` en mobile | Portail utilisable à 375 px | m |
| Z03 | — | `resize_window` desktop ; `read_console_messages` (erreurs) sur la session | Aucune erreur récurrente non expliquée | m |
| Z04 | Awa | Rejouer en un clic : Missions › la mission E2E › chaque onglet (Découpage, Planning, Affectations, Budget, Suivi, Débours, Facturation, Documents, Rapports) | Chaque onglet se charge, données cohérentes avec les étapes précédentes (budget V1, 8 j réalisés, facture soldée) | B2 si incohérent |

### Extension facultative — clôture du cycle

À demander explicitement : jouer **E52 à E64** de `SCENARIO-E2E-MISSION-ORGANISATION.md` (clôture mensuelle de
septembre, mission « À clôturer », bilan, clôture, cas N11 et N12) sur la mission E2E, avec les mêmes règles de
gravité et d'arrêt.

## 6. Reprise après correction

L'utilisateur colle le prompt de correction dans Claude Code, puis relance l'agent navigateur avec :
« Reprends le scénario à l'étape `<ID>` (l'étape bloquante est corrigée). » L'agent :

1. vérifie l'état à l'écran (la base n'est pas réinitialisée : les étapes déjà réussies ne se rejouent pas) ;
2. **rejoue l'étape bloquante**, puis continue dans l'ordre ;
3. reprend le journal et la numérotation `AN-nn` là où ils se sont arrêtés.

États d'entrée par phase : **X** exige C12 réussie (mission signée) ; **F** exige X10 ; **G** exige C09 ; **P, Q, R, S, T**
n'exigent que le seed ; **Z04** exige C à F. Si la correction a modifié des migrations, relancer
`pnpm db:migrate` puis redémarrer l'API ; si elle a changé le schéma de manière incompatible avec les données
déjà saisies, repartir d'une base neuve (la phase PF et le seed se rejouent en quelques minutes).
