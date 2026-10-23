Reporté dans la documentation le 2026-10-22 (lot 9b).

# Notes du lot 7 : services candidats (diagnostic flash, business plan bancable)

Mises à jour EXACTES à reporter par le superviseur dans les documents interdits au lot
(`SECURITY.md`, `DECISIONS.md`, `CODING_STANDARDS.md`, `review-checklist.md`, `HANDOFF.md`).
Branche `orch/2026-10-20-reste-lot-7`, aucun commit. Décision n° 6 du PRD complémentaire (§21) :
diagnostic flash, puis business plan bancable (PRD complémentaire §11.6).

Principe : du CONTENU de standard (méthodes publiées par migration), du code seulement là où une
brique manquait (prix fixe paramétrable, liste de guichets, moteur de rapprochement).
TOUT le contenu métier est PROVISOIRE et marqué « à valider par un expert » (notes de version,
descriptions, note de contexte `methode`, `a_valider = true` sur les types de mission et guichets).

## Migrations (0560 à 0563 ; prochains libres de l'attribution : 0564 à 0579)

- `0560_services_candidats_diagnostic_flash.sql` : service `diagnostic_flash` + méthode du standard
  `diagnostic_flash` v1 PUBLIÉE (10 briques, 4 règles de modulation, 3 cas types, 1 rubrique).
- `0561_services_candidats_business_plan.sql` : service `business_plan_bancable` + méthode du
  standard `business_plan_bancable` v1 PUBLIÉE (14 briques, 6 règles, 4 cas types, 2 rubriques).
- `0562_services_candidats_parametres.sql` : `services_candidats_parametres` (prix fixe par cabinet
  et par service, mention libre `commentaire`, RLS `isolation` + `portail_interdit`).
- `0563_guichets_financement.sql` : `guichets_financement` (liste du cabinet, vide par défaut, RLS
  `isolation` + `portail_interdit`, pas de DELETE : on désactive), SQLSTATE `MQV01` et `MQV02`.
- CODING_STANDARDS §1 : prochains libres de ce lot 0564 à 0579.

## SQLSTATE

| SQLSTATE | Code d'API     | HTTP | Sens                                                        |
| -------- | -------------- | ---- | ----------------------------------------------------------- |
| MQV01    | `GUICHET_FIGE` | 409  | identité d'un guichet (id, cabinet, auteur, création) figée |
| MQV02    | `PLAFOND_GUICHETS_ATTEINT` | 409  | plus de 500 guichets par cabinet (verrou consultatif par cabinet) |

MQV01 non atteignable par HTTP (schémas stricts, pas de DELETE) : doublé pour le propriétaire de base. MQV02 : verrou consultatif `pg_advisory_xact_lock` par cabinet puis comptage ; le CHECK 23514 est traduit en 400 `REQUETE_INVALIDE`.

## Permissions (`roles.ts`)

- `services_candidats.lire` : mêmes rôles que `catalogue.lire` (lecture des services, des guichets,
  rapprochement). `expert_externe` : aucun accès.
- `services_candidats.gerer` : associé ET directeur de mission (activation des types de mission, prix fixe, guichets).
- Le rapprochement depuis un `client_id` exige en plus `dossier.lire` et un client visible (404 sinon).

## Routes (toutes sous `/api`, toutes avec `exiger`, aucune dans `LISTE_BLANCHE_PORTAIL`)

`GET /services-candidats`, `POST /services-candidats/activer`, `PUT /services-candidats/:code/prix`,
`GET|POST /guichets-financement`, `GET|PATCH /guichets-financement/:id`,
`POST /guichets-financement/rapprochement`. 8 routes. La mission se crée par les routes EXISTANTES
(`POST /missions` avec le type du service, puis `PUT /missions/:id/methode`) : aucune route de création.

## Moteur

`packages/engines/src/services-candidats/guichets.ts` : `rapprocherGuichets` (pur, déterministe,
aucune conversion de devise : devises différentes => critère « inconnu », jamais de taux inventé).
Statuts compatible / partiel / exclu, score 0..100, tri total. Couverture du fichier 100 % lignes,
98,6 % branches.

## Recherches mécaniques (review-checklist) à rejouer

8 routes ajoutées (`exiger` sur chacune) ; 2 tables neuves à RLS avec `portail_interdit` ;
`z.object` neufs en `.strict()` ; 4 migrations neuves ; pas de `SELECT *`.

## DECISIONS.md : valeurs provisoires à faire valider

- AUCUN prix par défaut (décision de l'utilisateur) : le prix du diagnostic flash est « à fixer par le cabinet »
  (`prix.a_fixer`) et son type de mission ne s'active pas tant qu'il n'est pas saisi (409 `PRIX_A_FIXER`,
  `SERVICES_PRIX_REQUIS` dans `packages/shared/src/schemas/services-candidats.ts`). Business plan : « sur devis »
  (montant null admis). Le seed de démonstration fixe un prix marqué `DÉMONSTRATION` (colonne `commentaire`).
- `POST /services-candidats/activer` prend `{ service }` (un service à la fois) ; 400 sans corps valide.
- Plafond de 500 guichets par cabinet (MQV02) ; `GET /guichets-financement` et le rapprochement renvoient
  `tronque` (liste limitée par `limite` ; le rapprochement lit jusqu'à 500 guichets).
- Briques, temps types, classes de risque, niveaux d'autonomie, règles de modulation, rubriques et
  cas types des deux méthodes (migrations 0560 et 0561) ; types de mission et découpages
  (`apps/api/src/catalogue/services-candidats.ts`).
- Montants des prix et bornes de guichets : entiers en unité de la devise (pas de centimes, y compris
  EUR et USD), différent de la convention « unités mineures » de `apps/web/src/lib/saisie.ts`.
- Rapport court du flash : modèle de rapport EXISTANT « état d'avancement » ; dossier bancaire :
  modèle EXISTANT `dossier_bancaire`. `rapports_mission` n'est PAS modifiée.
- Briques « bancabilité PLA-17 » et « plan de financement » sans moteur référencé : aucun code
  `plan.bancabilite` dans `MOTEURS_STANDARD` (`packages/shared/src/schemas/standard.ts`).

## HANDOFF.md

- Lot 7 livré : deux méthodes du standard (cohérence verte), prix fixe, guichets, rapprochement, pages
  web `/services-candidats` et `/services-candidats/guichets`, seed `seed-demo-services-candidats.ts`
  (une ligne dans `seed-demo.ts`).
- NON vérifié : aucun écran ouvert dans un navigateur ; rendu des deux pages à contrôler en recette.
- Piège : l'activation des types de mission (`POST /services-candidats/activer`) sème aussi les grades
  manquants du catalogue ; `semerCatalogueConseil` n'est pas modifié (le test `catalogue.test.ts`
  compte 4 types).
- Dette (décision du superviseur) : `moteur` reste NULL pour les briques `bancabilite_pla17`,
  `plan_financement` et `veille_guichets` (0561), faute de code dans `MOTEURS_STANDARD`
  (`packages/shared/src/schemas/standard.ts`) ; à reprendre par une nouvelle version de méthode si des
  codes `plan.bancabilite` / `services.guichets` sont ajoutés.
- Bouton « mission flash » : la page `/services-candidats` lit `?service=diagnostic_flash|business_plan_bancable`
  et `?client=<uuid>` (`lirePreremplissageService`, valeurs invalides ignorées) et préremplit le
  formulaire de création (client, intitulé). Lien à poser par un lot ultérieur : depuis la fiche client
  et les alertes KPI / redressement,
  `/services-candidats?service=diagnostic_flash&client=<id du client>`. Non posé dans ce lot
  (fichiers kpi/ et redressement/ d'un autre lot).
