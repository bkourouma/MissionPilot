Reporté dans la documentation le 2026-10-22 (lot 9d).

# Notes du lot 8b : dettes et mineurs des domaines déjà fusionnés

Branche `orch/2026-10-20-reste-lot-8b`, aucun commit. Mises à jour à reporter par le superviseur dans les
documents interdits au lot (`SECURITY.md`, `DECISIONS.md`, `CODING_STANDARDS.md`, `HANDOFF.md`).

## Livré

1. **Voyant rouge dans le brief** : nouveau type `voyant_rouge` (famille « Ça dérive », 9 types ; 31 types
   au total, 30 sources). Source `voyantsRedressementRouges` (`apps/api/src/brief/derives.ts`) : derrière
   `redressement.lire`, dossiers visibles (même `VISIBLE` que les autres sources), non clos, mission non
   clôturée, 50 dossiers au plus (famille marquée tronquée au-delà), `rassemblerDonneesVoyant` puis
   `calculerEtatVoyant` ; seul le rouge produit un élément, gravité haute, motifs critiques seulement
   (borne 5, 200 caractères), aucun montant ni devise même avec `finance.lire` (FIN-02). Lien
   `/missions/<id>/redressement`. L'événement d'automatisation correspondant n'est pas dans ce lot.
2. **Qualité (revue à froide)** : `mesRevues` paginé par curseur keyset (curseur propre, tri à directions
   mixtes ; `mesRevuesQuerySchema` strict, `limite` 1..100, défaut 50 ; réponse `{ elements,
   curseur_suivant }`). Réaffectation d'un relecteur interdite en `en_revue` : 409
   `REAFFECTATION_EN_REVUE` côté API et déclencheur `qualite_froide_echantillon_controle_reaffectation`
   (migration `0290_qualite_froide_reaffectation.sql`, SQLSTATE `MQQ13`, série MQQ01 à MQQ13 ; prochain
   numéro QUA libre : 0291).
3. **Plans et notation** : `candidatsAtelier` avec plafonds déclarés exportés (`CANDIDATS_CABINET_LUS_MAX`
   500, `CANDIDATS_CABINET_MAX` 200, `CANDIDATS_DIRIGEANTS_MAX` 200) et `tronque: true` (pas de
   pagination : le filtrage par droits se fait après le SQL) ; plafond de rejeu Monte-Carlo : 5 rejeux par
   plan et par 10 minutes, 429 `TROP_DE_REJEUX`, table `plan_rejeux_montecarlo` (migration
   `0432_plan_montecarlo_rejeux.sql`, RLS `isolation` + `portail_interdit`, verrou consultatif par plan,
   purge à une heure) ; `variablesNonFiables: ["texte"]` (`VARIABLES_NON_FIABLES_EXPLICATION`) dans
   `explication-commentaire.ts` ; assertion de durée retirée de `plans-montecarlo.test.ts` ; seuil de
   `SEUIL_PARTICIPANTS_AGREGATS = 3` participants AYANT CONTRIBUÉ (figé à la clôture) : sous le seuil,
   `resultats: null`, `masque_seuil: true`, `seuil_participants: 3`, message web, synthèse IA refusée
   (409 `ATELIER_AGREGATS_MASQUES`).
4. **Redressement** : timeout 90_000 sur le test de débit de `redressement-checklists.test.ts`.
5. **Divers** : toutes les dates de `packages/shared/src/schemas/temps.ts` passent à `dateIsoBorneeSchema`
   (2000 à 2100 : 400 du schéma, jamais 500 de la base) ; `paramsId` est `.strict()` (528 appels dans
   84 fichiers de routes analysés : aucun chemin n'a d'autre paramètre que `:id`) ; dix pages de liste
   passent à `limiteMax: LIMITE_PAGE_MAX` (500) : charge, facturation, mes-taches/nouvelle, qualite,
   qualite/acceptation, qualite/satisfaction, temps/debours, pipeline, missions, clients/[id]/portail, et
   `cheminMissionsClient` (`limite=500`).
6. **Lien « Proposer un diagnostic flash »** sur la fiche client (`cheminDiagnosticFlash` dans
   `apps/web/src/lib/clients.ts`), visible avec `catalogue.lire` et client actif ; la page cible
   `/services-candidats` arrive avec le lot 7.
7. **Mineurs des notes lot-1 à lot-5a** : relecture faite, les mineurs de ces domaines sont déjà traités
   (lot 2, lot 3) ou hors périmètre ; rien d'autre de trivial à reprendre.

## Documentation à reporter

- `SECURITY.md` : rejeu Monte-Carlo limité (5 par plan par 10 minutes) ; `mes-revues` paginé et strict ;
  réaffectation du relecteur verrouillée en base (MQQ13) ; `paramsId` strict ; seuil de 3 participants
  avant tout agrégat d'atelier.
- `CODING_STANDARDS.md` §1 : migrations 0290 (QUA) et 0432 (PLA) consommées ; MQQ13 ; §10 : dette
  `candidatsAtelier` levée par plafond déclaré et `tronque`.
- `DECISIONS.md` (valeurs provisoires) : 5 rejeux par plan par 10 minutes ; seuil de 3 participants ;
  plafonds de candidats d'atelier ; pages de `mes-revues` 50 (max 100).
- `HANDOFF.md` : retirer de « B » `semaineQuerySchema` borné, pages de 200 (sauf les deux fichiers
  ci-dessous) ; retirer de « E » le « voyant rouge » dans le brief (reste l'automatisation).

## Questions et reste

- `apps/web/src/components/dossier/RapportEtatFinancier.tsx` lit UNE seule page de
  `/api/missions?client_id=…` sans suivre le curseur ; `apps/web/src/lib/due-diligence-serveur.ts:191`
  garde la limite de 200 : fichiers hors périmètre (dossier, due diligence).
- Plafond de rejeux par plan seul (le plus strict) ou par plan et par utilisateur ?
- Dossiers de redressement clos dans le brief : exclus par prudence (`voyantsRedressementRouges`).
- Fichiers web touchés hors de la liste stricte mais inséparables : `components/plan-ateliers/
  InvitationAtelier.tsx`, `lib/plan-ateliers.ts`, `missions/[id]/plan/[planId]/ateliers/[atelierId]/page.tsx`.

## Correctifs du vérificateur (2026-10-21)

- Voyant du brief (`apps/api/src/brief/derives.ts`) : `ErreurRedressement` attrapée dossier par dossier (dossier ignoré, source marquée `interrompue`, famille tronquée) ; `PLAFOND_EVALUATIONS_VOYANT = 20` dossiers évalués par requête (50 lus au plus). Tests : dossier défaillant (200, autres dossiers servis), plafond de 20 puis 21.
- Ateliers : seuil de 3 appliqué PAR MÉTHODE (`appliquerSeuil` dans `ateliers-resultats.ts`) : une méthode sous 3 contributeurs devient `{ resultat: null, masque_seuil: true, seuil_participants: 3 }` ; la vue renvoie `methodes_masquees` ; `resultats` vaut null seulement si toutes sont masquées ; la synthèse IA ne cite que les méthodes publiées (409 si aucune). Le compteur global `ayant_contribue` n'est plus servi. Valeurs figées en base inchangées.
- Tests ajoutés : `candidatsAtelier` avec `tronque: true` (semis de 505 utilisateurs), purge à une heure de `plan_rejeux_montecarlo`.
- Plafond de rejeux : par plan, tous utilisateurs confondus (décision du superviseur, provisoire).
