# Notes du lot 5a (plans stratégiques et notation augmentés : NOT-12, PLA-15, PLA-16, PLA-18) — mises à jour de documentation à reporter

Fichier de transit : le chef de lot n'a pas le droit de modifier SECURITY.md, DECISIONS.md, CODING_STANDARDS.md, review-checklist.md ni HANDOFF.md.
Le superviseur reporte les blocs ci-dessous puis supprime ce fichier.

## 1. CODING_STANDARDS.md

- §1 (plages de migrations) :
  - `0425–0426` plans stratégiques, ateliers en ligne (PLA-15) : ateliers, options, participants (`0425`), contributions versionnées et lignes (`0426`) ; politiques `portail` incluses dans chaque fichier.
  - `0429` simulation de Monte-Carlo (PLA-16) : `plan_simulations_montecarlo`, ajout seul.
  - `0430–0431` plan vivant (PLA-18) : réalisés trimestriels versionnés (`0430`), re-prévisions versionnées (`0431`).
  - NOT-12 : aucune migration (liaison IA par `ia_demandes.entite_type/entite_id`). Libres ensuite : NOT `0405–0419`, PLA `0427–0428`, `0432–0439`.
- §2 (SQLSTATE) : préfixe `MQL` pour les plans (`MQL01–08` ateliers, `0425`–`0426` ; `MQL10–14` Monte-Carlo, `0429` ; `MQL15–24` plan vivant, `0430`–`0431`) ; `MQL09` réservé, non employé. `MQN` déclaré pour la notation, aucun code employé.
- Moteurs : `plan-strategique/{prng,monte-carlo,atelier,reprevision}.ts`, `notation/combinaisons.ts` ; nouveaux codes `ErreurPlan` : `MONTE_CARLO_INVALIDE`, `ATELIER_INVALIDE`, `REPREVISION_INVALIDE`.

## 2. SECURITY.md

- **Portail (§4 bis)** : trois routes ajoutées à `LISTE_BLANCHE_PORTAIL` : `GET /api/portail/ateliers`, `GET /api/portail/ateliers/:id`, `PUT /api/portail/ateliers/:id/contribution/:methode`. Permission `portail.ateliers.participer` (client_dirigeant seul, `roles.ts`). Le dirigeant ne voit que les ateliers OUVERTS où il est invité et SA contribution ; jamais agrégat, contribution d'autrui, synthèse IA, nom du cabinet, identifiant de plan ou de mission. Même 404 pour inexistant, d'autrui, non invité ou non ouvert.
- **RLS** : `plan_ateliers`, `plan_atelier_options`, `plan_atelier_participants` : `portail` en SELECT + `portail_sans_insert/update/delete` ; `plan_atelier_contributions` et `plan_atelier_contribution_lignes` : `portail` FOR ALL (SON client, SON utilisateur, atelier ouvert où il est invité). `plan_simulations_montecarlo`, `plan_realises`, `plan_reprevisions` : `portail_interdit`. Piège : la politique de `plan_atelier_participants` ne référence aucune autre table (récursion RLS).
- **Contenu IA** : trois nouveaux brouillons rattachés à `ia_demandes` (`notation_explication`, `plan_atelier`, `plan_reprevision`), prompts `notation_explication_commentaire`, `plan_atelier_synthese`, `plan_reprevision_explication` ; chiffres citables construits côté serveur depuis les moteurs ; libellés et commentaires saisis = données non fiables ; jamais servis au portail ; validation par `/ia/generations/:id/valider`.
- **Monte-Carlo** : graine tirée par l'API (`crypto.randomInt`) si absente, jamais dans le moteur ; 30 simulations par utilisateur et par 10 minutes (compte en base + déclencheur `MQL14`), 100 par plan (`MQL12`), 2000 tirages au plus ; le rejeu (POST sans écriture, `plan.lire`) coûte ~0,3 s et n'est pas limité en débit : à limiter si abus.
- **Anonymat des ateliers** : les contributions individuelles ne sont jamais servies ; agrégats visibles du cabinet après clôture seulement (avant : taux de participation).

## 3. DECISIONS.md (valeurs provisoires et règles)

- NOT-12 : combinaisons minimales = nombre minimal de pratiques améliorées, puis nombre minimal de paliers ; bornes `PRATIQUES_MAX_COMBINAISON` 8, `NOEUDS_MAX_COMBINAISONS` 200 000, 5 combinaisons par défaut (10 au plus). Si une borne coupe la recherche : `tronquee`, jamais « impossible ».
- PLA-16 : lois uniforme, triangulaire, normale tronquée (Irwin–Hall, déterministe) ; 100 à 2000 tirages (1000 par défaut) ; probabilité de tension = part des tirages avec trésorerie nette de clôture < 0 au moins une année ; lois de départ proposées (valeurs provisoires) : croissance ±5 points, marge ±2 points, charges fixes −5 %/+10 %, délai clients 0/+30 jours.
- PLA-15 : vote par 10 points par défaut (1 à 100) ; Borda ; matrice valeur/effort 1 à 5, seuil 3,00 ; ouverture exigeant 2 options et 1 participant ; 100 ateliers par plan, 50 options, 100 participants, 20 versions de contribution par participant et méthode.
- PLA-18 : répartition trimestrielle 25/25/25/25 par défaut ; méthodes `reste_du_plan` et `tendance` (facteur borné 0,5 à 1,5) ; seuil « significatif » 10 % ; trésorerie re-prévue = projection simplifiée ; 40 re-prévisions par exercice, 50 versions de réalisé par trimestre, 1000 par plan.

## 4. HANDOFF.md

- Lot 5a livré dans la copie `reste-lot-5a` (non commité) : NOT-12 (combinaisons minimales + commentaire IA), PLA-15, PLA-16, PLA-18 ; ces exigences sortent du « reste à faire » du lot C (vague 3 non livrée).
- Non vérifié : rendu navigateur des nouvelles pages (onglets Ateliers, Simulation, Plan vivant ; pages portail `/portail/ateliers`), fournisseur IA réel.
- Fichier web touché hors liste stricte : `apps/web/src/lib/portail.ts` et `portail.test.ts` (entrée « Ateliers » de la navigation du portail).
