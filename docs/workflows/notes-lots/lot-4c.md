# Notes du lot 4c « Rapport d'avancement hebdomadaire (AUT-10), IA : cache, routage, plafonds (AGT-06), agent contradicteur » (2026-10-21)

Mises à jour à reporter par le superviseur dans les documents interdits au lot (SECURITY.md,
DECISIONS.md, CODING_STANDARDS.md, review-checklist.md, HANDOFF.md). Branche
`orch/2026-10-20-reste-lot-4c`. Rien n'est commité.

## Migrations posées

| N°   | Objet                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0278 | `ia_parametres_cabinet.cache_actif` (faux par défaut), table `ia_cache_reponses` (AES-GCM, AAD cabinet + clé, clé HMAC-SHA-256, durée <= 24 h par CHECK, RLS `isolation` + `portail_interdit`), issue « cache » à coût nul dans `ia_consommations`, table `ia_alertes_plafond_mission`, `planifier_conservation_ia` redéfinie (cabinets ayant une entrée de cache échue) |
| 0279 | Revue contradictoire : index unique partiel `ia_demandes_revue_active_idx` (une revue active par brouillon), déclencheur `controler_ia_revue_contradictoire` (MQI50). Aucune table nouvelle                                       |
| 0306 | `avancement_parametres` (actif, `envoi_email` avec `CHECK (envoi_email = false)`, jamais lu par un code d'envoi)                                                                                                                 |
| 0307 | `avancement_rapports` (UNIQUE mission + semaine), RLS `isolation`, politiques RESTRICTIVES du portail (`portail` : rapports VALIDÉS de CE client sur mission partagée ; `portail_sans_insert/update/delete`), déclencheur `controler_avancement_rapport` |
| 0308 | `planifier_avancement_hebdo(text, timestamptz, date)` SECURITY DEFINER                                                                                                                                                           |

`rapports_mission` et `controler_source_rapport()` ne sont PAS touchés (lots 0551/0552). Prochains libres : AGT `0278`/`0279` consommés ;
AUT `0309` à `0319` ; SQLSTATE nouveaux : `MQI01` (cache désactivé pour le cabinet), `MQI50` (revue contradictoire incohérente),
`MQU01` (rapport validé figé), `MQU02` (validateur non autorisé), `MQU03` (naissance hors brouillon ou identité modifiée),
`MQU04` (client différent de celui de la mission), `MQU05` (mission non active), `MQU07` (suppression interdite).

## SECURITY.md

- §4 (SECURITY DEFINER) : ajouter `planifier_avancement_hebdo` (accordée à `missionpilot_app`, search_path figé, REVOKE PUBLIC, ne renvoie qu'un nombre) ;
  `planifier_conservation_ia` redéfinie à l'identique de 0104 plus le critère « entrée de cache échue ».
- Cache IA (AGT-06) : désactivé par défaut par cabinet ; clé = HMAC-SHA-256 de {prompt code + version + contenu, modèle, entrées masquées
  canonisées} ; contenu chiffré AES-GCM (AAD = cabinet + clé) ; durée de vie 24 h bornée par CHECK ; purge par le job de conservation ;
  jamais pour copilote, entretiens, transcriptions, variables portant un contenu de client, donnée identifiante restée en clair (entrée ou réponse),
  réponse signalée par la garde-chiffres. Le cache ne remplace que l'appel au fournisseur, APRÈS toutes les gardes (droit `ia.utiliser`, IA active,
  coupe-circuit, réservation) ; la réponse servie repasse par la validation Zod, la garde-chiffres et le démasquage et devient un brouillon IA.
  Désactiver le cache vide les entrées (verrou `FOR SHARE` sur les paramètres : aucune entrée ne survit à un vidage concurrent). Limite : un nom propre
  absent du masquage part déjà au fournisseur ; le cache le garde au plus 24 h, chiffré, dans le seul cabinet.
- Plafond par mission : appliqué à TOUT appel rattaché à une mission (`preparer` sous verrou de mission puis réservation, et re-contrôle à l'exécution
  dans `executerDemande`, donc aussi le job `ia_generation`). Ordre des verrous : mission puis cabinet. Dépassement borné par le coût estimé du dernier
  appel admis. Hors champ : `admettreSansDemande` / `appelerSansDemande` (copilote, sans mission) et les évaluations. Alertes 80 % et 100 % : une fois
  par seuil, réarmées au changement de plafond, associés seulement, sans montant (type `ia_plafond_mission_alerte`).
- Contradicteur : revue sur demande seulement (route dédiée, jamais par automatisation : 409 `AGENT_SUR_DEMANDE_SEULEMENT`), exécution d'agent adossée à une
  `ia_demande`, brouillon IA non bloquant, brouillon relu jamais modifié, contenu relu traité comme donnée non fiable, aucun chiffre de son cru
  (`nombres_non_verifies`), plafond de mission atteint = refus (jamais de revue vide en mode dégradé), droits : `ia.utiliser` + droits du registre
  (`mission.lire`, `preuve.lire`) + visibilité de la mission (404 sinon), fermée au portail.
- AUT-10 : seul un rapport VALIDÉ est visible du client (RLS `portail` + route 404 uniforme ; brouillon, autre mission, autre client, autre cabinet) ;
  validé = immuable (MQU01) ; contenu servi filtré par `contenuAvancementSchema` (clés inconnues écartées) : aucune donnée financière (FIN-02),
  ni budget en jours, ni temps par personne ; aucun e-mail (notification interne `avancement_brouillon`, `email: false`) ; `envoi_email` refusé
  par l'API (400) et la base (23514).

## DECISIONS.md (valeurs provisoires et choix, à valider)

- Job `avancement_hebdo` : planifié lundi-vendredi à 06:30 UTC, clé `avancement_hebdo:<lundi>` (premier jour ouvré de la semaine), suites `...:lot:<n>` ;
  lots de 25 missions (curseur d'identifiant), 40 lots au plus par semaine ; un échec isolé est consigné sans contenu ; mission ayant déjà un rapport
  (brouillon modifié ou validé) écartée avant tout calcul ; paramètre cabinet `actif` par défaut activé (ne crée que des brouillons internes).
- Qui modifie/régénère/valide/génère : droit `avancement.valider` ET associé, directeur ou chef de la mission ; lecture `avancement.lire` + visibilité ;
  paramètre cabinet : `automatisation.gerer` existant. Portail : `portail.avancement.lire` (`client_dirigeant`, `client_contributeur`).
- Commentaire IA de l avancement : BRANCHÉ en brouillon IA (apps/api/src/automatisation/avancement-ia.ts) via appelerSansDemande, liste blanche de chiffres fournie par le moteur, repli silencieux sans IA, jamais visible du client ; route POST /api/avancement/:id/suggerer-commentaire et bouton dans EditeurRapport ; un brouillon IA non relu bloque la validation (409 COMMENTAIRE_IA_A_RELIRE).
- Cache IA : désactivé par défaut, 24 h, réglable sans reconfirmation d'identité.
- Routage par tâche : table documentaire `ROUTAGE_TACHES` (`ia/modeles.ts`) exposée en lecture (rédaction/analyse : qualité ; extraction/vectorisation : coût ;
  classification : latence) ; le modèle appliqué reste celui de `modeleDe`.
- Livrables du rapport : documents de type livrable hors brouillon IA non validé ; un livrable non partagé n'est qu'un nombre côté cabinet (jamais côté client).
- Rendu PDF/DOCX du rapport hebdomadaire : non fait (modifierait `rapports/*.ts`) ; consultation web seule.
- Contradicteur : la brique `revue_contradictoire` doit être déclarée avec un niveau d'autonomie (sinon 409 `BRIQUE_NON_DECLAREE`) ; préparation du prompt par `POST /api/agents/revues-contradictoires/preparation` (droit `agent.gerer`) puis évaluation (non-régression) ; câblées dans apps/web/src/app/(app)/agents/autonomie/PreparationContradicteur.tsx (brique déclarée en classe R1, N0 à N3, N2 par défaut).
- Portail AUT-10 : projection explicite `projeterContenuAvancementPortail` sans `non_partages` (livrables.total = partagés) ; marque du cache : champ calculé `servie_par_cache` de la vue de génération (aucune migration : le CHECK de ia_generations.fournisseur est partagé).

## CODING_STANDARDS.md

- §1 plages : AGT `0278`/`0279` consommés ; AUT `0306` à `0308` consommés, libres `0309` à `0319` ; SQLSTATE `MQI01`, `MQI50`, `MQU01`-`MQU05`, `MQU07`.

## review-checklist.md

- Recherche n° 16 (`GRANT EXECUTE`) : +2 fonctions (`planifier_avancement_hebdo`, `planifier_conservation_ia` redéfinie).
- Compte des migrations : +5 (0278, 0279, 0306, 0307, 0308).
- Routes ajoutées : cabinet `GET/POST /missions/:id/avancement`, `GET/PATCH /avancement/:id`, `POST /avancement/:id/regenerer`, `POST /avancement/:id/valider`,
  `GET/PUT /avancement/parametres` ; portail `GET /portail/avancement`, `GET /portail/avancement/:id` (liste blanche) ; agents `POST/GET /agents/revues-contradictoires`,
  `GET /agents/revues-contradictoires/:id`, `POST /agents/revues-contradictoires/preparation`.
- Fichiers hors liste touchés (ajouts minimaux) : `jobs/registre.ts`, `jobs/planificateur.ts`, `app.ts`, `portail/garde.ts`, `test/jobs-registre.test.ts` (inventaire des types de job),
  `apps/web/src/lib/portail.ts` et `portail.test.ts` (navigation du portail), `components/ia/PanneauContenuIa.tsx`, `ia.css`, `index.ts` (bouton de contre-analyse).

## HANDOFF.md

- Lot 4c livré, non commité : AUT-10 (moteur `packages/engines/src/avancement`, job, API, portail, web), AGT-06 (cache, plafond par mission généralisé, routage), contradicteur (API + bouton).
- Reste : rendu PDF/DOCX du rapport hebdomadaire (décision : hors lot) ; UI non vérifiée dans un navigateur.
