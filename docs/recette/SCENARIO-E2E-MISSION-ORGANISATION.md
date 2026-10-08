# Scénario de recette de bout en bout — mission d'audit organisationnel

Recette **manuelle**, dans le navigateur, d'une mission du service « Audit organisationnel » du catalogue conseil, de la création du client à la clôture de la mission.

- Rédigé le 2026-10-07 par lecture du code (dernier commit `f9068aa`, branche `feat/socle-monorepo`). **Aucune étape n'a encore été rejouée** : le HANDOFF note qu'aucune recette navigateur n'a été faite. Un écart entre ce document et l'écran est donc une anomalie à relever **ou** une erreur du scénario : l'indiquer par la case **O** de la colonne « R / É / O » et dans le relevé des anomalies.
- Là où une règle n'a pas pu être établie avec certitude dans le code, la cellule dit « à relever et comparer à la règle X » : relever la valeur affichée, ne pas la déclarer fausse.

## 1. Objet et périmètre

**Objet.** Vérifier qu'un cabinet peut conduire seul, avec les droits de chaque rôle, tout le cycle : client, opportunité, proposition validée par un associé, mission, signature (budget initial figé), découpage, affectations, temps validés, débours, budget révisé, échéancier, factures, encaissements, relance, rapports, clôture et bilan. Vérifier aussi que les chiffres affichés sont ceux de l'annexe A (calculés à la main).

**Hors périmètre.**

- Aucun e-mail réel : l'API reste sans `SMTP_HOST`, les messages sortent dans le terminal de l'API (transport « journal »). Aucune relance, invitation ou facture n'est réellement expédiée.
- Aucun déploiement, aucune production, aucun appel à OpenRouter (IA désactivée par défaut : aucune étape ne l'utilise).
- Relances et rappels **automatiques** (tâches planifiées de nuit), import Excel des temps, saisie hors ligne (PWA), double authentification, avoirs, régie, abonnement, devises EUR/USD.
- Isolation entre cabinets : seulement si un second cabinet existe (voir N19) ; sinon couverte par `apps/api/test/isolation.test.ts`.
- Section V (V2 : portail, questionnaire, notation, KPI, plan) : **optionnelle**, à faire avant la clôture de la mission (une mission clôturée refuse ces écritures).

## 2. Prérequis et mise en route

### 2.1 Environnement

Voir `docs/workflows/RUNBOOK.md`. Résumé :

1. Une base PostgreSQL **dédiée à la recette**, migrée, où le seed de démonstration n'a pas encore tourné (le RUNBOOK cite `missionpilot_demo`). Ne pas écraser une base qui n'est pas à vous. Une base neuve donne des numéros de facture prévisibles.
2. `pnpm install`, `pnpm db:up`, `pnpm db:migrate`, puis `pnpm --filter @missionpilot/api db:seed-demo` (crée « Lagune Conseil & Associés (démo) », ses 9 comptes internes, ses 3 comptes portail, ses missions de démonstration, les modèles de questionnaire `preliminaire_dirigeants` et `notation_generique` validés, et renseigne les mentions légales de facturation). Le seed refuse de tourner deux fois.
3. Démarrer avec la connexion rapide, sans mot de passe :
   - bash : `CONNEXION_RAPIDE_DEMO=oui pnpm dev`
   - PowerShell : `$env:CONNEXION_RAPIDE_DEMO = "oui"; pnpm dev`
4. Ouvrir `http://localhost:3100` (en développement, `localhost` et `127.0.0.1` au même port sont équivalents ; un autre port ou un autre nom de machine donne un 403 `ORIGINE_REFUSEE` à chaque enregistrement). Sonde de l'API : `http://localhost:4100/api/sante`.
5. Rapports PDF : Chrome ou Chromium installé (sous Windows, Chrome installé est repris ; sinon `CHROMIUM_PATH`). Sans navigateur, le PDF répond 503 : le noter, Word et PowerPoint n'en ont pas besoin.
6. Garder le **terminal de l'API visible** : l'invitation du portail (section V) y est écrite.
7. Préparer deux petits fichiers PDF valides et différents (moins de 15 Mo chacun), par exemple `rapport-provisoire.pdf` (E49) et `rapport-provisoire-v2.pdf` (E50).

Mot de passe commun des comptes de démonstration : constante `MOT_DE_PASSE_DEMO_ABIDJAN` de `apps/api/src/db/seed-demo.ts` (à ne pas recopier). Avec `CONNEXION_RAPIDE_DEMO=oui`, un clic sur le nom du compte, page `/connexion`, bloc « Comptes de démonstration (environnement local) », ouvre la session. Déconnexion : « Se déconnecter » (menu).

### 2.2 Comptes utilisés (domaine `@lagune-conseil.test`)

| Nom | E-mail (avant le domaine) | Rôle | Utilisé pour |
| --- | --- | --- | --- |
| Awa Koné | `associe` | Associé | client, taux de vente, validation de proposition, finance, export, journal |
| Yao Kouassi | `directeur.mission` | Directeur de mission | signature, révision de budget, approbation des factures, clôture |
| Mariam Traoré | `chef.mission` | Chef de mission | opportunité, proposition, mission, découpage, affectations, validation des temps et des débours |
| Koffi N'Guessan | `consultant` | Consultant (grade senior) | temps, débours, reste à faire |
| Adjoua Kacou | `consultant.junior` | Consultant (grade junior) | temps, débours |
| Serge Bamba | `gestionnaire` | Gestionnaire administratif et financier | échéancier, factures, encaissements, clôture mensuelle |
| Aminata Ouattara | `expert.metier` | Expert métier | publication de la notation (V) |
| Fatou Diallo | `ressources` | Responsable des ressources | cas négatifs |
| Ibrahim Sanogo | `expert.externe` | Expert externe | cas négatifs |
| Marc Tanoh (créé en V01) | `dg.atlantic` | Dirigeant client (portail) | section V ; mot de passe choisi à l'activation, jamais réutilisé ailleurs |

**Conduite.** Les cookies sont par navigateur : ouvrir un **profil de navigateur par rôle** (ou se déconnecter et se reconnecter). Plusieurs onglets du même profil partagent la même session.

## 3. Jeu de données

Toutes les valeurs sont fictives ; montants en FCFA (XOF, sans décimale). Les dates sont **relatives** (aucun jour férié du calendrier du cabinet ne doit tomber dans les semaines S1 à S2 : vérifier Paramètres › Cabinet, sinon décaler tout le scénario d'une semaine).

### 3.1 Calendrier

| Repère | Règle | Exemple (exécution le mercredi 07/10/2026) |
| --- | --- | --- |
| L0 | lundi de la semaine en cours | lundi 05/10/2026 |
| **D0** | lundi, 4 semaines avant L0 ; S1 et S2 doivent être dans le **même mois civil** (sinon reculer D0 de semaines entières) | lundi 07/09/2026 |
| S1 / S2 | semaines de D0 et de D0+7 | 07–11/09 et 14–18/09/2026 |
| Signature | D0 − 3 jours | vendredi 04/09/2026 |
| Fin de mission | D0 + 46 jours (vendredi) | vendredi 23/10/2026 |
| M | mois civil contenant S1 et S2 | septembre 2026 |

Dans toute la suite, « D0+n » désigne la date D0 augmentée de n jours.

**Données de démonstration déjà présentes** (la base de recette est celle du seed `db:seed-demo`) : la mission « Plan stratégique Kora Agro-Industries » porte des feuilles de temps de Koffi et d'Adjoua **validées de L0−10 à L0−7 semaines** et une feuille de Koffi **soumise pour la semaine L0−1** ; elle laisse libres les semaines L0−6 à L0−2, où se situent S1 (D0 = L0−4) et S2 (D0+7 = L0−3), ainsi que D0+14. Ses affectations (Koffi 20 j, Adjoua 16 j, jusqu'à ~L0+2 semaines) s'ajoutent à celles du scénario dans le plan de charge (E18). Si le seed a été lancé avant le 2026-10-07, il occupait ces semaines : recréer la base de recette avec le seed à jour.

### 3.2 Client, opportunité, proposition

| Élément | Valeur |
| --- | --- |
| Client | `Atlantic Plastiques Industrie (fictif)`, SARL, RCCM `CI-ABJ-2019-B-98765`, compte contribuable `9876543A`, secteur `Industrie plastique`, pays Côte d'Ivoire, taille PME, adresse `Zone industrielle de Yopougon, Abidjan` |
| Contact | `Marc Tanoh`, fonction `Directeur général`, `marc.tanoh@atlantic-plastiques.test`, contact principal |
| Opportunité | `Audit organisationnel Atlantic Plastiques`, type « Audit organisationnel », XOF, 7 000 000, probabilité 60 %, étape « Qualification » puis « Proposition » |
| Jours vendus (catalogue) | Directeur 5,5 j, Consultant senior 17 j, Consultant junior 15 j : **37,5 j** (9 tâches) |
| Taux de vente | Directeur 400 000 ; **Consultant senior 180 000** (au lieu du standard 175 000, saisi par l'associé) ; Consultant junior 100 000 |
| Honoraires | 6 675 000 au taux standard, **6 760 000** après saisie des taux (annexe A1) |

### 3.3 Découpage créé par la proposition

3 phases : « Cadrage », « Analyse de l'existant », « Recommandations » ; 4 lots : « Lancement », « Structure et processus », « Ressources humaines », « Rapport d'audit » ; **9 tâches** ; **2 jalons** (« Réunion de lancement », « Restitution au comité de direction ») ; 2 tâches livrables (T7, T9).

| Tâche | Libellé | Budget en jours (Dir / Sen / Jun) | Début souhaité | Durée (j ouvrés) | Fenêtre (exemple) |
| --- | --- | --- | --- | --- | --- |
| T1 | Réunion de lancement | 0,5 / 1 / 0 | vide (D0) | 1 | 07/09 |
| T2 | Collecte de la documentation (organigramme, procédures, fiches de poste) | 0 / 0 / 2 | vide | 5 | 07–11/09 |
| T3 | Revue documentaire | 0 / 2 / 3 | vide | 10 | 07–18/09 |
| T4 | Entretiens individuels et focus groups | 1 / 4 / 4 | D0+7 | 10 | 14–25/09 |
| T5 | Cartographie des processus clés | 0 / 3 / 3 | D0+14 | 10 | 21/09–02/10 |
| T6 | Analyse des effectifs, des postes et des compétences | 0 / 2 / 2 | D0+28 | 5 | 05–09/10 |
| T7 | Rapport provisoire et recommandations | 2 / 3 / 1 | D0+35 | 5 | 12–16/10 |
| T8 | Restitution au comité de direction | 1 / 1 / 0 | D0+42 | 1 | 19/10 |
| T9 | Rapport définitif | 1 / 1 / 0 | D0+42 | 5 | 19–23/10 |

### 3.4 Affectations (nominatives ; Du / Au proposés par la fenêtre de la tâche)

| Personne | Tâche | Jours alloués |
| --- | --- | --- |
| Koffi N'Guessan | T1 / T3 / T4 | 1 / 2 / 4 (total 7 ≤ 17) |
| Adjoua Kacou | T2 / T3 / T4 | 2 / 3 / 4 (total 9 ≤ 15) |

### 3.5 Temps (demi-journée ; une case = 1 j ; cases non citées = vides)

| Semaine | Personne | Saisie (tâche : jours par jour de la semaine) | Total |
| --- | --- | --- | --- |
| S1 | Koffi | Réunion de lancement : lun 1 ; Revue documentaire : mar 1, mer 1 | 3 j |
| S1 | Adjoua | Collecte de la documentation… : lun 1, mar 1 ; Revue documentaire : mer 1, jeu 1, ven 1 | 5 j |
| S2 | Koffi | Entretiens individuels et focus groups : lun, mar, mer, jeu 1 chacun | 4 j |
| S2 | Adjoua | 1re soumission (erreur) : Entretiens… lun à ven 1 chacun = 5 j ; **après rejet** : lun à jeu = 4 j | 4 j final |

Total validé : Koffi 7 j (T1 1, T3 2, T4 4), Adjoua 9 j (T2 2, T3 3, T4 4) = **16 j**. Réalisé par tâche : T1 1 ; T2 2 ; T3 5 ; T4 8.

### 3.6 Débours, facturation, encaissements

| Élément | Valeur |
| --- | --- |
| Débours 1 (Koffi) | date D0+8, « Transport », `Déplacement chez le client à Yopougon`, 150 000, **refacturable** |
| Débours 2 (Adjoua) | date D0+9, « Fournitures », `Impression des supports d'entretien`, 40 000, non refacturable |
| Échéancier (forfait, 30/70) | « Acompte à la signature » 2 028 000 (date prévue = signature) ; « Solde à la fin de la mission » 4 732 000 (date prévue = fin de mission) |
| Facture d'acompte | HT 2 028 000, TVA 18 % 365 040, TTC = net 2 393 040 |
| Facture de solde | solde 4 732 000 (18 %) + débours 150 000 (0 %) : HT 4 882 000, TVA 851 760, TTC = net 5 733 760 |
| Encaissements (tous datés du jour : un encaissement ne précède pas l'émission et ne se date pas dans le futur) | acompte 2 393 040 en virement `VIR-E2E-0001` ; solde : 3 000 000 en Mobile Money (Wave) `WAVE-E2E-0002`, puis 2 733 760 en virement `VIR-E2E-0003` |

## 4. Étapes

**Ordre d'exécution** : E01 à E51 (avec les cas négatifs N.. de la section 5 aux moments indiqués), puis, si souhaité, V01 à V11 (section 6), puis E52 à E64 (section 7). Colonne « R / É / O » : cocher **R**éussi, **É**choué ou **O**bservation (à détailler dans la grille de la section 8). `<ID>` = identifiant de la mission dans l'URL `/missions/<ID>`. Les messages entre « » sont ceux du code.

### 4.1 Commercial

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E01 | Awa | `/connexion`, puis Paramètres › Facturation, Catalogue › Types de mission, Catalogue › Grades | Clic sur « Awa Koné » (groupe « Espace cabinet »). Ouvrir les trois écrans sans rien modifier. | Tableau de bord, menu complet (Pipeline, Clients, Collaborateurs, Catalogue, Questionnaires, Notation, Plan de charge, Facturation, Finance, Indicateurs, Paramètres). Facturation : RCCM, compte contribuable et adresse renseignés (sinon l'émission échouera : « MENTIONS_INCOMPLETES »), préfixe FA, 5 chiffres, délai 30 j, TVA 18 %, retenue à la source désactivée. Catalogue : « Audit organisationnel » (Forfait) ; grades « Directeur », « Consultant senior », « Consultant junior ». | ☐ ☐ ☐ |
| E02 | Awa | Clients › « Nouveau client » | Valeurs du 3.2 (Raison sociale, Forme juridique, Numéro RCCM, Compte contribuable, Secteur d'activité, Pays, Taille, Adresse) ; « Créer le client ». | Redirection vers la fiche `/clients/<id>` ; identité exactement saisie ; client actif dans la liste. | ☐ ☐ ☐ |
| E03 | Awa | Fiche client › « Ajouter un contact » | Nom `Marc Tanoh`, Fonction `Directeur général`, Adresse e-mail `marc.tanoh@atlantic-plastiques.test`, cocher « Contact principal » ; « Ajouter le contact ». | « Contact ajouté. » ; contact listé comme principal. | ☐ ☐ ☐ |
| E04 | Mariam | Pipeline › « Nouvelle opportunité » | Intitulé, Client, « Type de mission envisagé », Devise « XOF (FCFA UEMOA) », Montant estimé `7000000`, Probabilité `60`, Étape « Qualification », Responsable « Mariam Traoré » ; « Créer l'opportunité ». | Fiche `/pipeline/<id>` : badges « Ouverte » et « Étape : Qualification », 7 000 000 FCFA, 60 % ; « Aucune proposition pour cette opportunité. » | ☐ ☐ ☐ |
| E05 | Mariam | Fiche opportunité : « Faire avancer l'opportunité », puis « Générer une proposition » | Étape « Proposition » + « Changer d'étape ». « Générer une proposition » : Type de mission « Audit organisationnel », intitulé vide ; « Générer le brouillon ». Ouvrir « Version 1 ». | « Étape mise à jour. » ; version 1 au statut « Brouillon », XOF ; titre « Audit organisationnel Atlantic Plastiques — version 1 ». | ☐ ☐ ☐ |
| E06 | Mariam | Proposition v1 : cartes « Chiffrage », « Équipe proposée », « Découpage et jours par grade » | Lire, sans modifier. | Jours vendus 37,5 j ; Honoraires **6 675 000 FCFA** « calculés par le moteur (jours × taux) » ; tableau « Jours par grade » : Directeur 5,5, Consultant senior 17, Consultant junior 15, **sans colonnes de taux ni de montant** et message « Les taux journaliers par grade sont réservés aux associés et aux gestionnaires. » ; aucune carte « Taux journaliers de vente » ; équipe 1 × Directeur, 1 × Consultant senior, 1 × Consultant junior ; arbre 3 phases, 4 lots, 9 tâches. | ☐ ☐ ☐ |
| E07 | Awa | Même proposition : carte « Taux journaliers de vente » (Confidentiel) | Consultant senior : `180000` ; autres taux inchangés ; « Enregistrer les taux ». | « Taux enregistrés. » ; Honoraires **6 760 000 FCFA** ; Directeur 2 200 000, Consultant senior 3 060 000, Consultant junior 1 500 000. | ☐ ☐ ☐ |
| E08 | Mariam, puis Awa | « Étapes de la proposition » | Mariam : « Soumettre à la validation » (vérifier qu'elle n'a **pas** « Valider la proposition », N02). Awa : « Valider la proposition », puis « Oui, confirmer ». | Statuts « À valider » puis « Validée » ; « Validée le » renseigné ; texte « Cette version n'est plus modifiable : créez une nouvelle version pour l'ajuster. » | ☐ ☐ ☐ |
| E09 | Mariam | « Étapes de la proposition » | « Marquer comme envoyée » ; « Acceptée par le client », puis « Oui, confirmer ». | « Envoyée au client » puis « Acceptée » ; sur la fiche opportunité badge « Gagnée » ; carte « Créer la mission » visible **sur la page de la proposition** (pas sur la fiche opportunité). | ☐ ☐ ☐ |
| E10 | Mariam | Carte « Créer la mission » | Intitulé conservé ; Directeur de mission « Yao Kouassi » ; Chef de mission : laisser « Vous-même » ; Date de début = D0 ; Date de fin = D0+46 ; « Créer la mission ». | Redirection `/missions/<ID>` ; fiche : client Atlantic…, type Audit organisationnel, directeur Yao Kouassi, chef Mariam Traoré (vous), dates D0 à D0+46, XOF, mode « Forfait », statut « Proposition », origine « Proposition acceptée ». | ☐ ☐ ☐ |

### 4.2 Cadrage, signature, affectations

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E11 | Mariam | Mission › Découpage | Lire. | Synthèse 37,5 j ; phases, lots, tâches et libellés du 3.3 ; carte « Jalons » : « Réunion de lancement » et « Restitution au comité de direction », « Date à fixer », « À venir ». | ☐ ☐ ☐ |
| E12 | Mariam | Découpage › chaque tâche › « Modifier » | Renseigner « Début souhaité » et « Durée (jours ouvrés) » selon le 3.3 ; « Enregistrer ». | Chaque tâche affiche « N jour(s) ouvré(s) » et « début souhaité le … » ou « au plus tôt ». | ☐ ☐ ☐ |
| E13 | Mariam | Mission › Planning | Lire le tableau « Tâches par ordre chronologique » et la carte « Jalons ». | Débuts, fins et durées conformes à la colonne « Fenêtre » du 3.3 (à relever si un jour férié décale une date). | ☐ ☐ ☐ |
| E14 | Yao (N06 : Mariam) | Fiche › « Cycle de vie » › « Signer la lettre de mission » | Date de signature = D0−3 ; « Continuer vers la confirmation » ; « Oui, signer et figer le budget ». Avant : constater que Mariam n'a **pas** ce bouton. | « Lettre de mission signée » (budget initial figé, version 1) ; statut « Signée » ; « Lettre de mission signée le … » ; plus de bouton de signature. | ☐ ☐ ☐ |
| E15 | Awa, Yao, Koffi | Mission › Budget (un compte après l'autre) | Lire la version « V1 — Budget initial (signé) ». Puis N05. | Awa : « Figée — référence », 37,5 j, Honoraires 6 760 000, Coûts internes 3 490 000, Marge 3 270 000 (48,4 %) « Confidentiel », 6 lignes. Yao : honoraires sans prix par grade, **ni coûts ni marge**, 3 lignes. Koffi : jours seulement, **une fois affecté à la mission** (E16) ; avant, l'onglet Budget répond 404, l'accès dépendant de l'équipe (à contrôler après E16). | ☐ ☐ ☐ |
| E16 | Mariam | Mission › Affectations › « Nouvelle affectation » | Six affectations du 3.4 : Tâche, Type « Nominative (une personne) », Personne, Jours alloués ; Du/Au repris de la tâche ; « Affecter ». | « Affectation créée. » ×6, sans avertissement ; « Affectations par tâche » liste les six ; Koffi et Adjoua apparaissent dans la carte « Équipe » de la fiche. | ☐ ☐ ☐ |
| E17 | Mariam | Affectations › « Nouvelle affectation » | (a) Adjoua, T5, 6 j, Du D0+14 Au D0+18 : créée avec avertissement. (b) Adjoua, T6, 1 j (fenêtre de la tâche) : refusée (N07). | (a) « Affectation créée. » + « Affectation enregistrée, budget de la tâche dépassé » (6 j pour 3 j budgétés au grade junior). (b) refus « Le budget signé prévoit 15 j pour le grade « junior » ; 16 j seraient alloués. Créer une révision du budget. » (code BUDGET_FIGE_DEPASSE, 409). | ☐ ☐ ☐ |
| E18 | Mariam | Plan de charge (`/charge`), à partir de la semaine de D0, durée la plus longue | Lire. | Jours affectés par semaine (capacité 5 j), **mission Kora de démonstration incluse** (≈ +1,67 j Koffi, ≈ +1,34 j Adjoua par semaine) : Koffi 3,66 / 4,67 / 3,67 ; Adjoua 4,84 / 4,83 / **9,33 (surcharge)** sur les semaines D0, D0+7, D0+14 ; semaine D0+21 : Koffi 1,66, Adjoua 1,34 (Kora seule). Sans Kora : Koffi 2 / 3 / 2 et Adjoua 3,5 / 3,5 / 8. Adjoua cité dans « Surcharges de la période ». Libellé exact des états : à relever. | ☐ ☐ ☐ |
| E19 | Mariam, puis Koffi | Affectations ; puis Mon planning | Supprimer l'affectation Adjoua/T5 (« Supprimer », « Oui, supprimer »). Koffi : Mon planning, semaine de D0. | Plus de surcharge dans le plan de charge. Koffi : « Réunion de lancement » 1 j et « Revue documentaire » 1 j. | ☐ ☐ ☐ |
| E20 | Mariam | Fiche › « Cycle de vie » | « Démarrer la mission ». | « Statut mis à jour. » ; statut « En cours ». | ☐ ☐ ☐ |

### 4.3 Facturation initiale (acompte)

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E21 | Serge | Mission › Facturation | « Générer l'échéancier ». | « Échéancier généré. » ; « Budget signé (honoraires) » 6 760 000 ; « Total de l'échéancier » 6 760 000 ; « Reste à planifier » 0 ; deux échéances « Acompte à la signature » 2 028 000 (Acompte) et « Solde à la fin de la mission » 4 732 000 (Jalon), statut « Prévue ». | ☐ ☐ ☐ |
| E22 | Serge | Même écran | « Marquer à facturer » sur l'acompte ; carte « Préparer une facture » : cocher « Acompte à la signature — 2 028 000 FCFA » ; « Créer le brouillon de facture ». Ouvrir la facture. | Facture « Facture (sans numéro) », statut « Brouillon », numéro « Attribué à l'émission » ; ligne 2 028 000 ; HT 2 028 000, TVA 365 040, TTC 2 393 040, retenue 0. | ☐ ☐ ☐ |
| E23 | Serge, puis Yao | Fiche facture › « Actions » | Serge : « Soumettre à approbation », puis constater qu'il ne peut pas approuver (N03). Yao : « Approuver », puis constater qu'il ne peut pas émettre (N04). | « Facture soumise à approbation. » puis « Facture approuvée. » ; statut « Approuvée ». Serge voit « Votre rôle ne permet pas d'approuver une facture. » | ☐ ☐ ☐ |
| E24 | Serge | Fiche facture | « Émettre la facture », « Oui, émettre » ; « Ouvrir le document » ; « Marquer comme envoyée », « Oui, marquer envoyée ». | Statut « Émise », numéro `FA-AAAA-NNNNN` (AAAA = année du jour ; base de démonstration neuve en 2026 : `FA-2026-00003`, à relever), émission = date du jour, échéance de paiement +30 j ; document imprimable avec mentions du cabinet et du client ; badge « Envoyée » (aucun envoi réel). Échéance « Facturée ». | ☐ ☐ ☐ |
| E25 | Serge | Facturation › Encaissements › « Saisir un encaissement » | Client Atlantic…, Date = jour, Montant reçu `2393040`, Moyen « Virement », Référence `VIR-E2E-0001`, imputation « Tout le reste » sur la facture ; « Enregistrer l'encaissement ». Puis N08. | « Encaissement enregistré et imputé. » ; facture : Net à payer 2 393 040, Encaissé 2 393 040, Reste à payer 0, badge « Soldée ». | ☐ ☐ ☐ |

### 4.4 Temps (S1 et S2)

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E26 | Koffi | Feuille de temps › Ma feuille, URL `/temps?semaine=<D0 en AAAA-MM-JJ>` | « Commencer ma feuille » (ou « Commencer ma feuille pré-remplie » si elle est proposée : la semaine ne doit alors contenir que des brouillons) ; écraser **toutes** les cases pour obtenir exactement la ligne S1 de Koffi (3.5, valeurs saisies `1`) ; vérifier que « Semaine : » vaut 3 ; « Soumettre la feuille ». | Brouillon enregistré automatiquement ; badge « Soumise, en attente de validation » ; plus de saisie possible. Mariam reçoit la notification « Feuille de temps à valider : Koffi N'Guessan ». | ☐ ☐ ☐ |
| E27 | Adjoua | Idem, même semaine | Feuille S1 d'Adjoua (3.5), total 5 j ; soumettre. | « Soumise, en attente de validation ». | ☐ ☐ ☐ |
| E28 | Mariam (N01 : Koffi) | Feuille de temps › À valider (`/temps/validation`) | Ouvrir chaque feuille (lien sur le nom du collaborateur) ; dans la carte « Audit organisationnel Atlantic Plastiques » (la partie de la feuille propre à la mission), « Valider ». | Deux feuilles de la semaine D0 listées ; « Partie validée. » ; feuilles « Validée » ; Koffi et Adjoua notifiés (« Feuille de temps validée »). | ☐ ☐ ☐ |
| E29 | Koffi | `/temps?semaine=<D0+7>` | Feuille S2 de Koffi (3.5), total 4 j ; soumettre. | « Soumise, en attente de validation ». | ☐ ☐ ☐ |
| E30 | Adjoua | Idem | Feuille S2 **avec l'erreur** : Entretiens… lundi à vendredi 1 j (5 j) ; soumettre. | « Soumise, en attente de validation ». | ☐ ☐ ☐ |
| E31 | Mariam | À valider | Valider la feuille de Koffi. Sur celle d'Adjoua : « Rejeter… », Motif du rejet `Vendredi : 1 j saisi en trop sur « Entretiens individuels et focus groups » (budget junior : 4 j). Corriger à 4 j.`, « Rejeter ». | « Partie rejetée : le collaborateur est prévenu et peut corriger sa feuille. » ; feuille d'Adjoua « Rejetée ». | ☐ ☐ ☐ |
| E32 | Adjoua, puis Mariam | `/temps?semaine=<D0+7>` ; À valider | Adjoua : alerte « Feuille rejetée : à corriger puis resoumettre » avec le motif ; vider le vendredi (total 4 j) ; « Resoumettre la feuille ». Mariam : liste « Resoumise (2e envoi) » ; « Valider ». | Feuille d'Adjoua « Validée » (cycle 2) ; total 4 j. | ☐ ☐ ☐ |
| E33 | Koffi | `/temps?semaine=<D0+7>`, carte « Reste à faire » | Pour « Entretiens individuels et focus groups » saisir `3` ; « Déclarer le reste à faire ». | « Reste à faire déclaré : l'atterrissage des missions est mis à jour. » ; les autres tâches indiquent « jamais déclaré (estimé : budget moins réalisé) ». | ☐ ☐ ☐ |
| E34 | Mariam | Mission › Suivi | Lire « Synthèse de la mission », « Par phase, lot et tâche ». | Budget 37,5 j ; Réalisé (validé) 16 j ; Reste à faire 23,5 j ; Atterrissage 39,5 j ; Écart +2 j (+5,3 %, état « Dépassement » : atterrissage > 105 %) ; Consommation 42,7 %. Par tâche, réalisé T1 1, T2 2, T3 5, T4 8. Au moins l'alerte « Atterrissage supérieur au budget de 2 j » ; d'autres alertes de consommation à relever. « Avancement physique » : 0 % (aucun jalon atteint). | ☐ ☐ ☐ |

### 4.5 Débours et encours

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E35 | Koffi, puis Adjoua | Mission › Débours › « Déclarer un débours » | Koffi : Date de la dépense D0+8, Catégorie « Transport », Description, Montant `150000`, cocher « Refacturable au client », « Enregistrer », puis « Soumettre ». Adjoua : D0+9, « Fournitures », Description, `40000`, non refacturable, « Enregistrer », « Soumettre ». | « Débours enregistré en brouillon. » puis « Débours soumis à validation. » ; statut « Soumis ». | ☐ ☐ ☐ |
| E36 | Mariam (N10 : Koffi) | Mission › Débours | « Valider » sur chacun. | « Débours validé. » ×2 ; statut « Validé ». Koffi n'a pas de bouton « Valider ». | ☐ ☐ ☐ |
| E37 | Serge (puis Mariam) | Mission › Facturation, carte « Encours de production au … » ; Finance › Encours de production | Lire. | Jours validés 16 j ; Valeur produite **2 160 000** ; Encours (non facturé) **132 000** ; Facturé d'avance 0. Mariam : « Jours validés » seulement, sans valorisation. | ☐ ☐ ☐ |

### 4.6 Budget révisé

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E38 | Mariam | Découpage › tâche « Entretiens individuels et focus groups » › « Budget en jours » | Consultant senior `4` → `6` ; autres grades inchangés ; « Enregistrer le budget ». | Tâche à 11 j ; synthèse du découpage 39,5 j ; le budget V1 ne change pas (E15). | ☐ ☐ ☐ |
| E39 | Mariam | Mission › Budget › « Demander une révision » | Motif `Entretiens plus nombreux que prévu : 2 j senior supplémentaires (avenant à valider avec le client).` ; laisser cochée « Recalculer depuis le découpage actuel » ; « Créer la révision ». | « Révision créée : elle attend la validation du directeur de mission. » ; carte « V2 — Révision » « En cours de révision ». Mariam lit « Vous êtes l'auteur de cette révision : elle doit être validée par un associé. » (N09). | ☐ ☐ ☐ |
| E40 | Yao | Mission › Budget | « Valider V2 — Révision », « Oui, valider et figer ». Puis « Comparer deux versions » V1 / V2. | « Révision validée et figée. » ; V2 « Figée — référence », V1 « Figée — historique ». Écart de jours vendus +2, d'honoraires +360 000 (Yao). Awa : V2 Honoraires 7 120 000, Coûts internes 3 670 000, Marge 3 450 000 (48,5 %), écart de marge +180 000. | ☐ ☐ ☐ |
| E41 | Serge, puis Mariam | Mission › Facturation ; Mission › Suivi | Lire. | « Budget signé (honoraires) » 7 120 000 ; « Total de l'échéancier » 6 760 000 ; « Reste à planifier » **360 000**. Suivi : Budget 39,5 j ; Atterrissage 39,5 j ; Écart 0 ; Consommation 40,5 %. | ☐ ☐ ☐ |

### 4.7 Facture de solde, encaissement partiel, relance

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E42 | Serge | Mission › Facturation | « Marquer à facturer » sur le solde ; « Préparer une facture » : cocher « Solde à la fin de la mission — 4 732 000 FCFA » **et** « Débours — Déplacement chez le client à Yopougon — 150 000 FCFA » (le débours de 40 000 n'est pas proposé) ; « Créer le brouillon de facture ». | Deux lignes : solde 4 732 000 (TVA 18 %) et « Débours — Déplacement chez le client à Yopougon » 150 000 (TVA 0 %) ; HT 4 882 000 ; TVA 851 760 ; TTC = Net à payer 5 733 760. | ☐ ☐ ☐ |
| E43 | Serge, Yao, Serge | Fiche facture | Serge « Soumettre à approbation » ; Yao « Approuver » ; Serge « Émettre la facture », « Oui, émettre ». | Bandeau « En attente d'approbation… par le directeur de la mission ou un associé » ; statut « Émise », numéro suivant (`FA-2026-00004` en base neuve, à relever) ; échéance « Facturée » ; le débours est rattaché. | ☐ ☐ ☐ |
| E44 | Serge | Facturation › Encaissements | Montant `3000000`, Moyen « Mobile Money », Opérateur « Wave », Référence `WAVE-E2E-0002`, imputation sur la facture de solde, montant imputé `3000000` ; « Enregistrer l'encaissement ». | Facture : Encaissé 3 000 000, **Reste à payer 2 733 760**, badge « Partiellement payée » ; Facturation › Créances : la facture figure dans « Factures restant dues ». | ☐ ☐ ☐ |
| E45 | Serge | Fiche facture de solde, carte « Paiement et relances » | « Relancer le client » : laisser décochée « Envoyer l'e-mail de relance au contact du client », message `Relance de recette (aucun e-mail)` ; « Relancer », « Oui, relancer ». | « Relance enregistrée dans l'historique. » ; tableau « Historique des relances » : Niveau « Rappel amiable », Déclenchement « Manuelle », e-mail « Préparé, non envoyé » (le client a un contact avec e-mail). | ☐ ☐ ☐ |

### 4.8 Pilotage financier et droits

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E46 | Awa | Finance › Rentabilité | Regrouper par « Mission », Du = D0, Au = date du jour ; « Afficher ». Puis regrouper par « Client ». | Ligne de la mission : Honoraires **6 760 000** ; Coûts internes **1 080 000** ; Débours non refacturés **40 000** ; Sous-traitance 0 ; Marge **5 640 000** ; Marge en % **83,4 %** ; Marge budgétée 3 450 000 ; jours budget / réalisé / atterrissage 39,5 / 16 / 39,5. Mêmes montants au niveau client (pour cette mission). | ☐ ☐ ☐ |
| E47 | Awa | Indicateurs | Niveau « Mission » (puis « Client »), mêmes dates ; « Afficher ». | Pour la mission : Consommation budgétaire 40,5 % ; Marge de mission 83,4 % ; Taux de réalisation **318,1 %** (6 760 000 / 2 125 000, annexe A5) ; Écart à terminaison 0 j ; Encours de production 0, facturé d'avance 4 600 000. Délai moyen d'encaissement : à relever (0 jour attendu, encaissement le jour de l'émission). Carnet de commandes : à relever et comparer à « honoraires signés moins honoraires produits (4 960 000) » ou « moins facturés (360 000) » selon la base affichée. | ☐ ☐ ☐ |
| E48 | Koffi, Mariam, Yao, Serge | Menu et URL directes ; console du navigateur | **Koffi** : pas de Facturation, Finance, Indicateurs, Paramètres, Pipeline, Plan de charge, Collaborateurs ; ouvrir `/finance/rentabilite` ; console (voir 5.2, `id` défini comme en N05) : `fetch('/api/missions/'+id+'/budget').then(r=>r.text())` puis `fetch('/api/finance/rentabilite?du=2026-01-01&au=2026-12-31&niveau=mission').then(r=>r.status)`. **Mariam** : Mission › Budget, Facturation. **Yao** : Mission › Budget. | Koffi : « Accès refusé » (403) ; Mission › Budget lisible mais en jours seulement ; JSON du budget sans `couts_internes`, `marge`, `taux_marge`, `prix_journalier`, `montant`, ni ligne de nature `cout_interne` (champs **absents**, pas masqués) ; `/api/finance/rentabilite` : 403. Mariam et Yao : honoraires totaux visibles, jamais coûts ni marge ; Mariam voit les factures sans coût. Serge : taux et marges visibles (finance). | ☐ ☐ ☐ |

### 4.9 Documents et rapports

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E49 | Mariam | Mission › Documents | Lire, puis « Déposer un document » : Type « Livrable », Nom du document `Rapport provisoire d'audit`, Fichier = `rapport-provisoire.pdf`, « Déposer ». | La « Lettre de mission » (version 1, sans fichier : « Aucun fichier rattaché. ») figure déjà, créée à la signature ; le livrable est déposé en version 1. | ☐ ☐ ☐ |
| E50 | Mariam | Documents › « Nouvelle version » sur « Rapport provisoire d'audit » | Choisir `rapport-provisoire-v2.pdf` ; « Déposer la version ». Puis retenter une nouvelle version avec le **même** fichier que la version courante. | Version 2 créée, version 1 conservée (« Versions ») ; avec le même fichier : « Fichier identique à la version courante : choisissez un autre fichier. » (aucune version 3). | ☐ ☐ ☐ |
| E51 | Mariam, Awa, Koffi | Mission › Rapports | Mariam : format « Word (.docx) » puis « Générer l'état d'avancement », puis « PowerPoint (.pptx) », puis « PDF ». Awa : un Word. Koffi : lire la liste. | Alerte « Rapport généré … au statut « Brouillon » ». Niveau : Mariam « Avancement et jours » ; Awa « Confidentiel : avec finances ». Contenu (ouvrir les fichiers) : mission, client, statut « En cours », jalons ; jours = suivi (39,5 / 16 / 23,5 / 39,5) ; section financière **seulement** dans celui d'Awa. Koffi ne voit **pas** le rapport d'Awa dans « Rapports générés ». PDF sans Chrome : 503, à noter. | ☐ ☐ ☐ |

## 5. Cas négatifs et droits

### 5.1 Tableau

À exécuter au moment indiqué ; chaque ligne est à cocher comme une étape.

| ID | Après | Compte | Action | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| N01 | E28 | Koffi | Ouvrir `/temps/validation` ; ouvrir sa propre feuille validée | « Accès refusé » (pas de droit de validation) ; aucune action sur sa feuille. | ☐ ☐ ☐ |
| N02 | E08 | Mariam | Proposition « À valider » | Pas de bouton « Valider la proposition » ni « Renvoyer en brouillon ». | ☐ ☐ ☐ |
| N03 | E23 (avant l'approbation) | Serge (auteur de la facture) | Fiche facture « À approuver » | Pas de bouton « Approuver » ; bandeau « Votre rôle ne permet pas d'approuver une facture. » L'associé, lui, est exempté de la règle « l'auteur n'approuve pas ». | ☐ ☐ ☐ |
| N04 | E23 (après l'approbation, avant l'émission) | Yao | Fiche facture « Approuvée » | Aucun bouton « Émettre la facture » (création, soumission et émission : gestionnaire ; approbation : directeur ou associé). | ☐ ☐ ☐ |
| N05 | E15 | Mariam | Console, mission ouverte : `const id=location.pathname.split('/')[2]; const b=await (await fetch('/api/missions/'+id+'/budget')).json(); const v1=b.versions.find(v=>v.numero===1); const r=await fetch('/api/missions/'+id+'/budget/versions/'+v1.id+'/lignes',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({lignes:[]})}); [r.status,(await r.json()).code]` | `[409, "BUDGET_FIGE"]` : le budget signé ne se modifie pas, seule une révision est possible. | ☐ ☐ ☐ |
| N06 | E14 | Mariam | Fiche mission, statut « Proposition » | Pas de bouton « Signer la lettre de mission » (réservé au directeur désigné et aux associés). Après signature, plus de signature possible. | ☐ ☐ ☐ |
| N07 | E17 | Mariam | Affectation au-delà du budget figé | Voir E17(b). | ☐ ☐ ☐ |
| N08 | E25 (avant l'enregistrement réel) | Serge | Encaissement de test sur la facture d'acompte (reste à payer 2 393 040) : (a) date de demain ; (b) montant reçu et imputé `3000000` ; (c) montant `2393040` sans aucune imputation | (a) refus « Un encaissement ne se date pas dans le futur. » (ou date refusée par le champ) ; (b) refus « L'imputation dépasse le reste à payer de la facture … (trop-perçu refusé). » ; (c) refus « Une partie de l'encaissement n'est imputée sur aucune facture… » sauf case « Accepter la part non imputée comme avance du client » (ne pas la cocher). Rien n'est enregistré. | ☐ ☐ ☐ |
| N09 | E39 | Mariam | Révision en cours | Pas de bouton « Valider V2 — Révision » ; message d'auteur (E39). | ☐ ☐ ☐ |
| N10 | E35 | Koffi, Adjoua | Leur propre débours | Pas de bouton « Valider » ni « Rejeter ». | ☐ ☐ ☐ |
| N11 | E52 | Serge | Clôturer le mois en cours (octobre) ; clôturer M avec une feuille non validée | Octobre : pas de bouton « Clôturer » (« Mois en cours ou à venir ») ; par la console, `POST /api/temps/periodes/<AAAA-MM>/cloturer` répond 409 « Un mois ne se clôture qu'une fois terminé. ». Mois M avec feuille en attente : 409 « N feuille(s) de temps de ce mois ne sont pas validées… ». | ☐ ☐ ☐ |
| N12 | E55 (statut « En cours »), puis E56 (statut « À clôturer ») | Yao, Mariam | Clôture de mission trop tôt, ou sans droit | Statut « En cours » : aucun « Clôturer la mission » ; console (`id` défini comme en N05) `fetch('/api/missions/'+id+'/cloturer',{method:'POST'}).then(r=>r.status)` : 409 « La mission doit être « à clôturer ». ». Statut « À clôturer », Mariam : pas de bouton ; même appel : 403. | ☐ ☐ ☐ |
| N13 | tout moment | Fatou, Ibrahim, Serge | URL directes | Fatou : `/finance/rentabilite` « Accès refusé ». Ibrahim (expert externe) : `/missions` « Accès refusé » (aucun droit de lecture des missions). Serge : `/temps/validation` « Accès refusé ». | ☐ ☐ ☐ |
| N14 | V02 | Marc (portail) | `/missions`, `/facturation`, `/parametres` ; console `fetch('/api/missions').then(r=>r.status)` | Redirection vers `/portail` pour les écrans internes ; l'API répond 403 (ou 404) : liste blanche stricte du portail. | ☐ ☐ ☐ |
| N15 | V02 | Awa | Ouvrir `/portail` | Redirection hors du portail (un compte du cabinet n'y a pas accès). | ☐ ☐ ☐ |
| N16 | E58 | Mariam | Console : `fetch('/api/missions/'+id+'/rapports?format=docx',{method:'POST'}).then(r=>r.status)` | 409 « La mission est clôturée. » | ☐ ☐ ☐ |
| N17 | E24 | Serge | Console sur la fiche d'une facture émise (`/facturation/<id>`) : `fetch('/api/factures/'+location.pathname.split('/')[2],{method:'PATCH',headers:{'content-type':'application/json'},body:'{"objet":"x"}'}).then(r=>r.status)` | 409 : une facture émise ne se modifie plus (correction par avoir). Aucun bouton « Objet, remise, retenue et délai » sur l'écran. | ☐ ☐ ☐ |
| N18 | E43 | Serge | Facturation › Factures : relever les numéros des deux factures | Numérotation continue, sans trou ni doublon. | ☐ ☐ ☐ |
| N19 | tout moment | Associé du « Cabinet Démo » (seulement si `db:seed` a aussi tourné) | `/clients`, `/missions`, `/missions/<ID>` | Aucune donnée d'Atlantic Plastiques ; l'URL directe répond « introuvable » (isolation SOC-01). | ☐ ☐ ☐ |
| N20 | V09 | Awa, Mariam | Ouvrir la version « En revue » de la notation | Alerte « Publication » : seul un expert métier publie ; aucun bouton « Publier ». | ☐ ☐ ☐ |

### 5.2 Remarque sur la console

Le web relaie `/api/*` : les `fetch` de la console, lancés depuis une page de `http://localhost:3100`, portent le cookie et l'en-tête `Origin` attendus. Ouvrir les outils du navigateur, onglet Console (ou Réseau pour lire les réponses de l'écran).

## 6. Section V — V2, optionnelle (avant la clôture)

Mêmes colonnes. Durée estimée : 45 à 60 minutes (la notation est la plus longue).

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| V01 | Mariam | Clients › Atlantic… › onglet « Portail client » | « Inviter une personne » : Adresse e-mail `dg.atlantic@lagune-conseil.test`, rôle « Dirigeant client » ; « Envoyer l'invitation ». | « Invitation envoyée à … » ; invitation « en attente ». Dans le **terminal de l'API** : le message avec `…/portail/invitation#jeton=…` : copier ce lien. | ☐ ☐ ☐ |
| V02 | Marc | Lien copié ; N14, N15 | Page « Activer votre espace client » : Nom complet `Marc Tanoh`, choisir un mot de passe de test, le confirmer ; « Créer mon accès ». | Ouverture de `/portail` ; menu « Accueil », « Missions », « Questionnaires », « Factures », « Sécurité » ; message « Rien n'a encore été partagé avec vous. » | ☐ ☐ ☐ |
| V03 | Mariam | Fiche client › Portail client, carte « Ce que voit votre client » | Cocher « Partager la mission », « Jalons » et « Factures émises » pour la mission ; « Enregistrer les partages ». | Mission listée comme « Partagée ». Marc : `/portail/missions` (« Vos missions ») liste la mission, statut « En cours ». | ☐ ☐ ☐ |
| V04 | Mariam, puis Marc | Mission › Découpage › « Jalons » ; portail › mission | Mariam : « Marquer atteint » sur « Réunion de lancement ». Marc : mission › « Valider ce jalon », commentaire `Conforme au compte rendu`, « Confirmer la validation ». | Jalon « Atteint » côté cabinet ; côté client « Jalon validé » (définitif, daté, à son nom). Suivi › Avancement physique : désormais supérieur à 0 % (à relever). | ☐ ☐ ☐ |
| V05 | Marc | `/portail/factures` | Ouvrir les deux factures. | Deux lignes ; acompte « Réglée », solde « Partiellement réglée » ; détail : Total hors taxes, TTC, « Net à payer », « Déjà réglé », « Reste à payer » (2 733 760) ; « Afficher la facture ». Aucun coût ni marge. | ☐ ☐ ☐ |
| V06 | Mariam | Mission › Questionnaires › « Préparer un envoi » | Questionnaire « Questionnaire préliminaire des dirigeants » (dernière version validée) ; Mode « Par fonction » ; cocher Marc Tanoh, Fonction `Directeur général` ; Date limite indicative = jour + 14 ; relances automatiques cochées ; « Créer l'envoi en brouillon » ; sur la page de suivi « Envoyer aux 1 répondant » (libellé du bouton) puis « Oui, envoyer ». | Envoi marqué envoyé ; « Réponses soumises » : aucune sur 1 ; notification et e-mail au répondant (visible dans le terminal de l'API). Le questionnaire apparaît dans « Vos questionnaires » du portail. La date limite est une simple indication. | ☐ ☐ ☐ |
| V07 | Marc | `/portail/questionnaires` | Ouvrir le questionnaire ; répondre à toutes les questions obligatoires (la barre indique « x / y questions obligatoires renseignées ») ; « Enregistrer le brouillon » ; « Envoyer mes réponses… », « Oui, envoyer ». | Réponses transmises, plus modifiables. Mariam : envoi « Toutes les réponses sont soumises » ; réponses lisibles. | ☐ ☐ ☐ |
| V08 | Mariam, Marc | Mission › Questionnaires ; portail | Seconde préparation : modèle « Notation de la compétitivité et de l'excellence opérationnelle », Mode « Collectif (réponse partagée) », répondant Marc ; envoyer. Marc répond à **toutes** les questions des dimensions « Stratégie déployée », « Processus », « Pilotage de la performance », « Amélioration continue », « Organisation » et « Engagement des équipes » (au moins la moitié du poids de chaque dimension notable et du total) ; envoie la réponse. | « Envoyer la réponse… » ; après envoi, réponse verrouillée. | ☐ ☐ ☐ |
| V09 | Mariam, Aminata (N20 : Awa) | Mission › Fiche › « Équipe » › « Ajouter un membre » (Aminata, « Ajouter ») ; Mission › Notation | Mariam : « Lancer le calcul » (questionnaire noté = l'envoi collectif ; grille générique ; pondérations « Industrie » ; réponses manquantes « Ignorer… ») ; « Soumettre en revue », « Oui, soumettre ». Aminata : onglet Notation › « Publier », « Oui, publier ». | Version 1 : Brouillon (score et classe A à E : à relever et comparer à l'échelle A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, E < 35) → « En revue (expert) » → « Publiée » (figée). Ni Mariam ni Awa ne peuvent publier (seul un `expert_metier`) ; Aminata n'est ni l'auteur du calcul ni celle de la soumission. | ☐ ☐ ☐ |
| V10 | Mariam | Mission › KPI › « Nouveau KPI » | Libellé `Délai moyen de traitement d'une commande`, Unité `jours`, Perspective « Processus internes », Sens de lecture « Plus bas = mieux », Nature « Stock : dernière valeur de la période », Fréquence de mesure « Mensuelle », Début du suivi = D0, Cible initiale `5`, « Vert à partir de (%) » `95`, « Orange à partir de (%) » `80` ; « Créer le KPI ». Puis « Enregistrer la mesure » : Date = jour, Valeur `7`. | KPI créé ; « Mesure enregistrée : le statut et les alertes du KPI ont été réévalués. » ; taux d'atteinte 60 % (1 − (7 − 5) / 5) et statut **rouge** (< 80 %) : à relever et comparer à la règle KPI-03 de DECISIONS.md. | ☐ ☐ ☐ |
| V11 | Mariam | Mission › Plan stratégique | Titre `Plan d'amélioration organisationnelle Atlantic 2027-2029`, Horizon 3, devise XOF ; « Créer le plan ». | « Plan créé : ouverture de sa page… » ; page du plan ouverte au statut initial (brouillon) : à relever. Pas de calcul financier attendu dans ce scénario. | ☐ ☐ ☐ |

## 7. Clôture de la période et de la mission

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E52 | Serge | Paramètres › Clôture des temps (`/parametres/cloture`), année du jour | Mois M (septembre en exemple) : « Clôturer », « Oui, clôturer ». Si 409 « FEUILLES_EN_COURS » : ce sont des feuilles de **démonstration** (feuille de Koffi pour la mission Kora, soumise) : Mariam les valide (À valider), puis recommencer. (N11 ici.) | « septembre 2026 clôturé. » ; statut « Clôturée » ; feuilles de Koffi et d'Adjoua de M au statut « Verrouillée (période clôturée) ». Octobre sans bouton « Clôturer ». | ☐ ☐ ☐ |
| E53 | Koffi | `/temps?semaine=<D0+7>` ; `/temps?semaine=<D0+14>` | Ouvrir sa feuille S2 ; ouvrir la semaine D0+14 (mois M, aucune feuille) et cliquer « Commencer ma feuille ». | S2 : badge « Verrouillée (période clôturée) » et message « Pour modifier des temps validés, faites une demande de correction. ». Semaine D0+14 : alerte « Jours clôturés » (« … : période clôturée, saisie verrouillée. ») ; les cases des jours de M ne sont plus modifiables (« — »). | ☐ ☐ ☐ |
| E54 | Koffi, puis Serge | Feuille de temps › Corrections | Koffi : « Demander une correction de mes temps » : Jour à corriger = D0+4 (vendredi S1), Tâche ou activité « Administration interne (activité interne) », Nouvelle valeur `0,5`, Motif `Réunion interne d'équipe non saisie.` ; « Demander la correction ». Serge : « Demandes de correction du cabinet » › « Valider ». | « Demande de correction envoyée : un gestionnaire la validera. » ; puis « Correction validée : le réalisé est mis à jour. » ; Koffi ne peut pas décider de sa propre demande. Aucun effet sur les chiffres de la mission (activité interne). | ☐ ☐ ☐ |
| E55 | Mariam | Pré-clôture (aucun écran dédié) | Constater : feuilles validées (Suivi › « Réalisé » 16 j, aucun message de temps en attente), débours validés, factures émises, encaissement du solde **en cours** (2 733 760 restants), KPI et notation à jour. | L'application **n'impose aucune** de ces conditions pour clôturer (voir D1) : noter l'état. | ☐ ☐ ☐ |
| E56 | Mariam | Fiche › « Cycle de vie » | « Passer « à clôturer » ». | Statut « À clôturer » ; apparaît « Rouvrir (retour en cours) » (ne pas l'utiliser). Mariam n'a pas « Clôturer la mission » (N12). | ☐ ☐ ☐ |
| E57 | Yao | Fiche › « Cycle de vie » | « Clôturer la mission », « Oui, clôturer ». | « Mission clôturée. » ; statut « Clôturée » ; « Clôturée le <date et heure> » ; onglet **« Bilan »** apparu ; carte « Cycle de vie » réduite à « Dupliquer » et « Enregistrer comme modèle ». | ☐ ☐ ☐ |

### 7.1 Vérifications après clôture

| ID | Compte | Écran | Actions et valeurs | Résultat attendu | R / É / O |
| --- | --- | --- | --- | --- | --- |
| E58 | Mariam, Koffi | Chaque onglet de la mission | Découpage, Affectations, Budget, Débours, Documents, Rapports ; Koffi : Feuille de temps › Corrections, correction du jour D0+8 sur « Entretiens individuels et focus groups » (valeur `0,5`) ; N16. | **Lecture seule** : aucun « Modifier », « Ajouter », « Budget en jours », « Nouvelle affectation » ; Budget : pas de « Demander une révision » (« La mission est clôturée. ») ; Débours : « Mission clôturée : plus de nouveau débours. » ; Documents : « Mission clôturée : les documents restent consultables, plus aucun dépôt n'est possible. » ; Rapports : alerte « Mission clôturée », bouton désactivé, rapports déjà générés encore téléchargeables, N16 = 409 ; correction : refus « La mission de la tâche « Entretiens individuels et focus groups » est clôturée. » (409). Les données restent **consultables** (suivi, factures, temps). | ☐ ☐ ☐ |
| E59 | Yao, Awa | Mission › Bilan | Lire ; Yao rédige le « Retour d'expérience » (« Enregistrer »). | « Bilan figé à la clôture du … ». Jours : Budget 39,5 j ; Réalisé 16 j ; Écart budget / réalisé −23,5 j ; Atterrissage 39,5 j ; Consommation 40,5 %. Awa seulement : Honoraires facturés 6 760 000 ; Coûts internes 1 080 000 ; Sous-traitance 0 ; Débours non refacturés 40 000 ; Marge réalisée 5 640 000 (83,4 %) ; Taux de réalisation 318,1 % ; Honoraires budgétés 7 120 000 ; Marge budgétée 3 450 000 ; Écart en coûts de production −2 590 000 ; Écart de marge 2 190 000 (annexe A6 ; bloc « Version d'atterrissage » : à relever). Yao : alerte « Montants et marge non affichés ». « Retour d'expérience enregistré. » | ☐ ☐ ☐ |
| E60 | Serge | Facturation › Encaissements | Montant `2733760`, Moyen « Virement », Référence `VIR-E2E-0003`, imputation « Tout le reste » sur la facture de solde ; « Enregistrer l'encaissement ». | La finance reste active après clôture : « Encaissement enregistré et imputé. » ; facture « Soldée », Reste à payer 0 ; Créances : plus de facture due pour le client. | ☐ ☐ ☐ |
| E61 | Serge | Finance › Export comptable | Du = Au = date du jour ; « Télécharger le fichier CSV ». Ouvrir `ecritures-<date>-<date>.csv`. | « Export téléchargé… (débit = crédit) ». Pièces : facture 1 (411 débit 2 393 040 ; 706 crédit 2 028 000 ; 4431 crédit 365 040) ; facture 2 (411 débit 5 733 760 ; 706 crédit 4 732 000 ; 707 crédit 150 000 ; 4431 crédit 851 760) ; encaissements 2 393 040, 3 000 000 (Mobile Money), 2 733 760 : débit trésorerie, crédit 411 (annexe A7). | ☐ ☐ ☐ |
| E62 | Awa | Paramètres › Journal d'audit | Filtre « Auteur » = chaque compte ; période du jour. | Entrées de : signature, révision (création, validation), clôture de la mission, émission des factures, export comptable, clôture du mois. Entités et actions récentes peuvent apparaître sous leur code brut (« mission », « cloture ») : à relever, pas bloquant. | ☐ ☐ ☐ |
| E63 | Yao | Mission › Bilan, puis Facturation | Relire après E60. | Le bilan n'a **pas changé** (figé) alors que la facture est soldée ; la fiche mission reste consultable. | ☐ ☐ ☐ |
| E64 | Marc (si section V faite) | `/portail/missions`, `/portail/factures` | Relire. | Mission « Terminée » ; les deux factures « Réglée ». | ☐ ☐ ☐ |

## 8. Check-list finale

- ☐ Les chiffres clés concordent avec l'annexe A : honoraires 6 760 000 (budget V1), V2 à 7 120 000, factures 6 910 000 HT et 8 126 800 TTC, marge réalisée 5 640 000.
- ☐ Aucun compte sans droit financier (Koffi, Adjoua, Mariam, Yao) n'a vu de coût, de marge ou de taux par grade (E06, E15, E37, E48, E51, E59).
- ☐ Séparation des tâches respectée : proposition (Awa seule valide), temps (le chef valide), facture (gestionnaire crée et émet, directeur approuve), révision (directeur valide), débours, notation.
- ☐ Le budget initial n'a jamais bougé après signature (N05) ; la révision a créé une version V2 validée.
- ☐ Numérotation des factures continue (N18).
- ☐ Un mois clôturé verrouille les temps ; corrections tracées (E52 à E54, N11).
- ☐ Mission clôturée : lecture seule, rapports refusés (409), données consultables, bilan figé, finance encore active (E57 à E60).
- ☐ Les droits du portail sont stricts (N14, N15, E64).
- ☐ Journal d'audit alimenté (E62).
- ☐ Toutes les anomalies sont consignées ci-dessous avec capture.

### Relevé des anomalies (une ligne par anomalie)

| Id | Étape | Gravité (bloquante, majeure, mineure, cosmétique) | Description (attendu / constaté) | Capture (fichier) |
| --- | --- | --- | --- | --- |
| A01 | | | | |
| A02 | | | | |
| A03 | | | | |
| A04 | | | | |
| A05 | | | | |

## Annexe A — Calculs attendus

Règles du code : montants en unités mineures (XOF : 1 unité = 1 FCFA, entiers) ; honoraires = jours × taux ; TVA calculée **une fois par taux** sur la somme des HT de ce taux, arrondie au plus proche (demi vers l'extérieur) ; ratios en fraction arrondie à 4 décimales (0,4837 = 48,4 % à l'écran, une décimale) ; répartition 30/70 sans perte (le reste d'arrondi va au dernier jalon).

**A1. Proposition.** Standard : 5,5 × 400 000 + 17 × 175 000 + 15 × 100 000 = 2 200 000 + 2 975 000 + 1 500 000 = **6 675 000**. Après taux saisis : 2 200 000 + 17 × 180 000 (3 060 000) + 1 500 000 = **6 760 000**.

**A2. Budget.** Coût interne = jours × coût journalier moyen du grade (collaborateurs internes actifs : Directeur 220 000, senior 90 000, junior 50 000 ; l'expert externe est exclu).

| Version | Jours | Honoraires | Coûts internes | Marge | Taux de marge |
| --- | --- | --- | --- | --- | --- |
| V1 (signée) | 37,5 | 6 760 000 | 5,5×220 000 + 17×90 000 + 15×50 000 = 1 210 000 + 1 530 000 + 750 000 = 3 490 000 | 3 270 000 | 3 270 000 / 6 760 000 = 0,4837 |
| V2 (révisée, senior 19 j) | 39,5 | 7 120 000 | 1 210 000 + 1 710 000 + 750 000 = 3 670 000 | 3 450 000 | 3 450 000 / 7 120 000 = 0,4846 |
| Écart V2 − V1 | +2 | +360 000 | +180 000 | +180 000 | |

Les prix des honoraires de V2 reprennent ceux de V1 (révision « depuis le découpage » avec prix de référence). Si les coûts de la base ont été modifiés avant la recette, relever et comparer à « jours × coût moyen du grade ».

**A3. Échéancier et factures.** 30 % de 6 760 000 = 2 028 000 ; 70 % = 4 732 000 (somme = budget signé V1 ; reste à planifier 0, puis 7 120 000 − 6 760 000 = 360 000 après V2).

| Facture | Lignes | HT | TVA | TTC = net à payer |
| --- | --- | --- | --- | --- |
| Acompte | 2 028 000 à 18 % | 2 028 000 | 2 028 000 × 18 % = 365 040 | 2 393 040 |
| Solde | 4 732 000 à 18 % ; débours 150 000 à 0 % | 4 882 000 | 4 732 000 × 18 % = 851 760 | 5 733 760 |
| Total | | 6 910 000 | 1 216 800 | 8 126 800 |

Approbation : HT acompte 2 028 000 ≤ 5 000 000 (palier chef de mission) ; HT solde 4 882 000 ≤ 5 000 000, mais cumul avec l'acompte émis 6 910 000 > 5 000 000 (palier directeur) : le directeur de la mission peut approuver dans les deux cas (même libellé à l'écran).
Encaissements : 2 393 040 + 3 000 000 + 2 733 760 = 8 126 800 ; reste après E44 : 5 733 760 − 3 000 000 = 2 733 760.

**A4. Temps et suivi.** Réalisé 16 j. Reste à faire : tâche déclarée (T4 : 3) ; tâches sans déclaration = max(0, budget − réalisé) : T1 1,5 − 1 = 0,5 ; T2 0 ; T3 0 ; T5 6 + T6 4 + T7 6 + T8 2 + T9 2 = 20 ; total 0,5 + 0 + 0 + 3 + 20 = **23,5**. Atterrissage = 16 + 23,5 = 39,5. Avant révision : budget 37,5, écart +2 (2 / 37,5 = 0,0533, soit 5,3 %), consommation 16 / 37,5 = 0,4267 ; atterrissage 39,5 > 37,5 × 105 % = 39,375 : « Dépassement ». Après révision (budget 39,5) : écart 0, consommation 16 / 39,5 = 0,4051.

**A5. Finance de la mission.**

| Grandeur | Calcul | Valeur |
| --- | --- | --- |
| Valeur produite (prix du budget signé) | 7 × 180 000 + 9 × 100 000 | 2 160 000 |
| Valeur au taux standard | 7 × 175 000 + 9 × 100 000 | 2 125 000 |
| Coûts internes réels | 7 × 90 000 + 9 × 50 000 | 1 080 000 |
| Encours à E37 | valeur produite − honoraires facturés (acompte seul) = 2 160 000 − 2 028 000 | 132 000 |
| Honoraires facturés (lignes d'échéance émises, hors débours) | 2 028 000 + 4 732 000 | 6 760 000 |
| Débours non refacturés | débours 2 | 40 000 |
| Marge réalisée | 6 760 000 − 1 080 000 − 40 000 − 0 | 5 640 000 (5 640 000 / 6 760 000 = 0,8343) |
| Taux de réalisation | 6 760 000 / 2 125 000 | 3,1812 (318,1 %) |
| Facturé d'avance (final) | 6 760 000 − 2 160 000 | 4 600 000 |
| Marge budgétée (V2) | 7 120 000 − 3 670 000 | 3 450 000 |

Ces chiffres sont volontairement atypiques (mission facturée à 100 % avec 16 j réalisés sur 39,5) : seul compte le contrôle du calcul.

**A6. Bilan à la clôture.** Jours : budget 39,5 ; réalisé 16 ; écart budget / réalisé = 16 − 39,5 = −23,5 (−0,5949) ; atterrissage 39,5 ; consommation 0,4051. Finance : voir A5 ; écart en coûts de production = (1 080 000 + 0) − (3 670 000 + 0) = −2 590 000 ; écart de marge = 5 640 000 − 3 450 000 = 2 190 000.

**A7. Export comptable (SYSCOHADA).** Facture : débit 411 du net à payer ; crédit 706 du HT des prestations, 707 du HT des débours refacturés, 4431 de la TVA. Encaissement : débit trésorerie (521 virement, 552 Mobile Money), crédit 411. Chaque pièce est équilibrée (débit = crédit). Les comptes sont des valeurs de départ du cabinet.

## Annexe B — Glossaire des statuts

| Objet | Statuts affichés |
| --- | --- |
| Opportunité | Ouverte, Gagnée, Perdue ; étapes Prospection, Qualification, Proposition, Négociation |
| Proposition | Brouillon, À valider, Validée, Envoyée au client, Acceptée, Refusée |
| Mission | Opportunité, Proposition, Signée, En cours, À clôturer, Clôturée (retour « À clôturer » → « En cours » permis) |
| Budget | Figée — référence, Figée — historique, En cours de révision ; types « Budget initial (signé) », « Révision », « Atterrissage » |
| Jalon | À venir, Atteint ; côté portail : validé par le client |
| Échéance | Prévue, À facturer, Facturée |
| Facture | Brouillon, À approuver, Approuvée, Émise (badge Envoyée), Annulée par avoir |
| Paiement | Non payée, Partiellement payée, Soldée, En retard, Annulée (portail : À régler, Partiellement réglée, Réglée, Échéance dépassée) |
| Feuille de temps | Brouillon, Soumise (en attente de validation), Validée, Rejetée, Verrouillée (période clôturée) ; par partie : En attente, Validée, Rejetée |
| Débours | Brouillon, Soumis, Validé, Rejeté |
| Rapport | Brouillon ; niveaux « Avancement », « Avancement et jours », « Confidentiel : avec finances » |
| Version de questionnaire ou de notation | Brouillon, Validée ; notation : Brouillon, En revue (expert), Publiée |
| Contenu produit par IA (SOC-06) | Brouillon IA, Modifié, Validé (non utilisé ici) |

## Annexe C — Correspondance étapes et exigences du PRD

| Exigence | Étapes |
| --- | --- |
| SOC-01 isolation, SOC-02 rôles et droits | E01, E48, N01 à N04, N13, N19 |
| SOC-03 fiches clients | E02, E03 |
| SOC-04 calendrier, jours fériés | 3.1, E13 |
| SOC-05 documents | E49, E50 |
| SOC-06 traçabilité, journal d'audit | E62 |
| SOC-07 rapports PDF, Word, PowerPoint | E51, N16 |
| SOC-08 notifications | E26, E28, E31 |
| SOC-09 portail, SOC-10 questionnaires (V2) | V01 à V08 |
| MIS-01, MIS-02 catalogue et modèle | E01, E05, E11 |
| MIS-04 pipeline, MIS-05 proposition validée par un associé | E04 à E09, N02 |
| MIS-07 budget figé à la signature, MIS-09 fiche mission | E10, E14, E15, N05 |
| MIS-10 forfait | E21 |
| PLN-01 à PLN-04 découpage, budget en jours, planning, affectations | E11 à E19 |
| PLN-06 plan de charge, PLN-10 mon planning | E18, E19 |
| TPS-01 à TPS-03 temps et validation | E26 à E32, N01 |
| TPS-05 à TPS-08 reste à faire, suivi, alertes, avancement | E33, E34 |
| TPS-09 clôture mensuelle, corrections | E52 à E54, N11 |
| FIN-01 à FIN-03 budget, taux, versions | E06, E07, E15, E38 à E41 |
| FIN-05 débours | E35, E36, N10 |
| FIN-06, FIN-07, FIN-15 échéancier, factures, seuils | E21 à E24, E42, E43, N03, N04, N17, N18 |
| FIN-09 encaissements, relances, créances | E25, E44, E45, E60, N08 |
| FIN-11, FIN-12 encours, rentabilité | E37, E46, E47 |
| FIN-13 export comptable | E61 |
| NOT-07, KPI-03, PLA-01 (V2) | V09, V10, V11 |
| Clôture, bilan | E55 à E59, E63 |

## Annexe D — Limites connues du scénario

À signaler dans le compte rendu de recette : ces points ne sont **pas** des anomalies du testeur.

**Ce qui n'a pas pu être vérifié dans le code (donc « à relever »).** Libellés exacts du plan de charge et des états de charge ; nombre d'alertes de suivi ; valeurs « Délai moyen d'encaissement » et « Carnet de commandes » ; bloc « Version d'atterrissage » du bilan ; statut initial du plan ; score et classe de la notation (dépend de vos réponses) ; présence du lien d'invitation dans le terminal de l'API (transport « journal » en développement) ; format exact des dates à l'écran.

**Fonctions que le cycle de vie suppose et que l'application n'a pas (ou pas encore).**

- **D1. Clôture sans pré-condition métier.** La clôture n'exige que : statut « À clôturer », droit `mission.cloturer` (associé, directeur de mission), mission non déjà clôturée. Elle n'exige ni temps validés, ni débours décidés, ni factures émises ou soldées. Le bilan est figé à ce moment.
- **D2. La clôture de la mission ne verrouille pas les périodes de temps** : le verrouillage est la clôture **mensuelle** du cabinet (Paramètres › Clôture des temps), faite séparément en E52.
- **D3. Après clôture** : facturation et encaissement restent possibles (le jeu de démonstration le fait aussi) ; seules les écritures de la mission (découpage, affectations, budget, débours, documents, rapports, temps, KPI, questionnaires, notation, plan) sont refusées.
- **D4. Pas de bilan provisoire** avant la clôture ; pas d'avoir dans ce scénario (E24 n'essaie pas d'annuler).
- **D5. La lettre de mission** n'est pas générée depuis un modèle : à la signature, une entrée « Lettre de mission » (version 1) est créée sans fichier (PRD MIS-07 attend une génération) ; signature électronique : V3.
- **D6. Facture** : document HTML imprimable seulement (pas de PDF de facture) ; aucun envoi d'e-mail réel (« Marquer comme envoyée » n'est qu'un marquage).
- **D7. Portail** : la saisie des KPI par le client n'a pas d'écran (HANDOFF) ; le plan stratégique n'est pas partagé au portail.
- **D8. Notation** : rapports PDF/Word de notation non livrés ; **plan** : comparaison de versions sans écarts calculés, PLA-05 et PLA-10 non faits.
- **D9. Journal d'audit** : les libellés d'entités et d'actions ne sont pas tous francisés (E62).
- **D10. Relances automatiques, facture normalisée DGI (FIN-08), paiement en ligne (FIN-10)** : hors périmètre ou à venir.
- **D11. Isolation entre cabinets** : testable seulement avec un second cabinet (N19).
