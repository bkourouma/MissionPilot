Reporté dans la documentation le 2026-10-21 (lot 9a).

# Notes du lot 4b — dossier client, preuves, finance (2026-10-20)

Branche `orch/2026-10-20-reste-lot-4b`. Fichier de notes du lot : `HANDOFF.md`, `SECURITY.md`,
`DECISIONS.md` et `CODING_STANDARDS.md` ne sont pas modifiés par ce lot ; les mises à jour listées
en fin de document sont à reporter par le superviseur.

## Livré

1. **DOS-05, groupes et filiales.**
   - Table `dossier_participations` (migration `0225`, ajout seul, RLS `isolation` + `portail_interdit`,
     SQLSTATE `MQF01` cycle, `MQF02` total des parts > 100 %, `MQF03` fin de détention sans détention
     antérieure). Une participation est un enregistrement `(détenteur, filiale, points de base 0..10 000,
     date d'effet, motif)` ; 0 point = fin de détention (motif obligatoire) ; l'historique est conservé.
   - Moteur pur `packages/engines/src/dossier/groupe.ts` : participations en vigueur à une date, refus
     des cycles (y compris futurs), de l'auto-détention et des totaux > 100 %, parts directes et cumulées
     exactes (BigInt, tous chemins), consolidation simple.
   - Routes : `GET /api/dossiers/:id/groupe`, `GET|POST /api/dossiers/:id/participations`
     (`dossier.lire` / `dossier.ecrire`, dossier visible exigé ; jamais ouvertes au portail).
   - Écran `/dossiers/[id]/groupe` (onglet « Groupe »).
2. **PRV-06 web.** `GET /api/missions/:id/livrables/:livrable/sources` et
   `.../sources/:preuveId` (`preuve.lire`, mission visible ; ouverture d'une citation refusée en 404 si
   la preuve n'est pas citée par ce livrable de cette mission) ; composant partagé
   `components/preuves/CitationsLivrable.tsx` monté sur les pages du plan et de la notation ; page
   d'ouverture `/missions/[id]/preuves/citations/[livrable]/[preuveId]`. La numérotation [n] est celle
   de l'annexe « Sources » des exports PDF et Word, désormais produite par la même fonction
   (`preuves/citations.ts`). Les annexes PDF/Word existaient déjà pour la notation et le plan (rapport
   dossier bancaire exclu volontairement : destinataire externe) ; la note au comité numérote déjà ses
   sources ; rien de nouveau créé.
3. **`IMPORT_INVALIDE`** converti en `AppError` (`routes/dossier-client.ts`) : même statut 400, même
   corps (`erreur.code`, `erreur.message`, `erreur.details.erreurs`). Seule différence : `erreurs` est
   tronqué à 200 lignes par la liste blanche de `errors.ts` (`DETAILS_MAX_ELEMENTS`) ; le message donne
   toujours le total.
4. **Rapport d'état financier.** Modèle `etat_financier`, niveau `dossier` (lecture `dossier.lire`),
   `POST /api/dossiers/:id/rapports/etat-financier?format=pdf|docx&mission_id&exercices` (corps
   facultatif `{commentaire}`), moteur pur `synthese-etats.ts`. Carte « Rapport d'état financier » sur
   `/dossiers/[id]/finances`.

## Règles de consolidation simple (DOS-05)

Pas une consolidation comptable légale : aucune élimination d'opérations intragroupe.

**Devises (décision de l'utilisateur, 2026-10-21).** La devise de consolidation est celle de la
racine. Une entité en XOF, XAF ou EUR est CONVERTIE au taux fixe de la parité légale : 1 EUR =
655,957 XOF = 655,957 XAF, XOF = XAF à 1:1. Conversion exacte en entiers (BigInt, unités mineures),
UN arrondi demi s'éloignant de zéro par montant, avant toute somme ou pondération
(`convertirMontantGroupe`, `packages/engines/src/dossier/groupe.ts`). L'USD, sans taux validé, reste
exclu (motif « devise sans taux de conversion validé ») et la consolidation est marquée partielle. Les
entités converties sont listées dans `consolidation.conversions` et affichées dans l'écran Groupe.

- Périmètre : la racine de la vue (société de tête par défaut, ou le client demandé) et ses filiales.
  Part cumulée d'une filiale = somme, sur tous les chemins depuis la racine, du produit des parts
  (calcul exact, arrondi une seule fois en points de base). Profondeur maximale : 8.
- Données : états financiers ACCEPTÉS (courants) de l'exercice ; montants issus des totaux du moteur de
  contrôle. Entité sans état accepté, d'un autre exercice, de devise différente ou NON VISIBLE de
  l'utilisateur : exclue, consolidation signalée « partielle ». Un dossier non visible apparaît comme
  noeud anonyme (niveau et part), sans identifiant ni nom ni montant.
- Vue **intégrale** : somme à 100 % de la racine et des entités dont la part cumulée est > 50 %.
- Vue **proportionnelle** : somme de montant × part cumulée pour toutes les entités incluses
  (un seul arrondi à la fin).
- Marge nette : résultat / produits calculés sur les sommes de chaque vue, jamais moyenne de marges.
- Fiabilité des données : moyenne pondérée par la part cumulée des points (0 à 1 000) de l'indice de
  fiabilité des entités incluses.
- FIN-02 : la réponse ne porte que des données du client ; identique avec ou sans `finance.lire`.

## Migrations

| Numéro | Objet | Remarque |
| ------ | ----- | -------- |
| `0225_dossier_participations.sql` | DOS-05 | plage DOS, SQLSTATE `MQF01-03` |
| `0552_rapports_etat_financier.sql` | modèle `etat_financier`, niveau `dossier` | **REDÉFINIT les CHECK de `rapports_mission`** |

`0552` : numéro attribué centralement (hors plage DOS/PRV : une réécriture numérotée avant `0508`
serait écrasée par elle). Elle reprend l'UNION exacte des valeurs : modèles `etat_avancement`,
`notation`, `plan_strategique`, `dossier_bancaire`, `note_comite` (0508), `cloture_redressement`
(0551, lot 2), `etat_financier` ; niveaux `base`, `jours`, `finance`, `notation`, `plan`, `dd`, `red`
(0551), `dossier`. Elle est écrite pour fonctionner AVEC ou SANS la colonne `red_cloture_id` (bloc
`DO` qui teste sa présence), de sorte que l'enchaînement est correct avant et après la fusion du lot 2.
`controler_source_rapport()` n'est pas redéfinie. **À relire à la fusion avec le lot 2**, et à
rejouer sur une base portant 0551 : tests `rapports-etat-financier`, `rapports-api`, `isolation`.

## À reporter dans les documents interdits au lot

- `SECURITY.md` / `CODING_STANDARDS.md` : SQLSTATE `MQF01-03` (dossier, migration 0225) ; nouveau
  préfixe `MQ…` déclaré ; plage `0552` pour le rapport d'état financier ; prochain numéro DOS libre
  `0226`, PRV `0244`.
- `DECISIONS.md` : règles de consolidation ci-dessus ; les parts de détention sont en points de base.
- `HANDOFF.md` : lot 4b livré ; dette « rapport d'état financier », DOS-05, PRV-06 web et
  `IMPORT_INVALIDE` soldées ; commentaire IA du rapport non branché (voir ci-dessous).

## Fichiers communs touchés (additif)

`apps/api/src/rapports/{niveaux,enregistrement,sources}.ts`, `apps/api/src/routes/rapports.ts` (route
et champ `audit` facultatif de `enregistrerRapport`), `apps/api/src/capitalisation/recherche.ts`
(une ligne de libellé), pages web du plan et de la notation (un import + une ligne chacune),
`apps/web/src/lib/rapports.ts`, `packages/engines/src/dossier/{index,erreurs}.ts`.

## Corrections de relecture (2026-10-21)

- **Profondeur de détention** bornée à l'écriture : `controlerNouvelleDetention` refuse
  `DETENTION_TROP_PROFONDE` si le plus long chemin amont + lien + aval dépasse 8 liens
  (`PROFONDEUR_GROUPE_MAX`) ; le déclencheur de `0225` (non commitée, corrigée sur place) double la
  règle (`MQF04`). Tests moteur et API (9 liens chaînés, le dernier refusé, plus SQL direct).
- **Statuts HTTP alignés** : un refus de détention (cycle, > 100 %, profondeur, fin sans détention
  antérieure) répond **409** qu'il vienne du moteur ou du déclencheur ; l'auto-détention reste 400
  (entrée invalide). Fichier : `apps/api/src/dossier/erreurs.ts`.
- **Conversion de devise** : `convertirMontantGroupe` réutilise `PARITE_EUR_FCFA`, `figerTauxChange`,
  `convertir` et `multiplierParRationnel` de `finance/monnaie.ts` (même arrondi, plus de seconde
  constante).
- **`IMPORT_INVALIDE`** : test de la troncature (250 erreurs : total dans le message, 200 lignes citées).
- **Audit du rapport d'état financier** : le test affirme l'ensemble exact des clés et des valeurs
  textuelles, sans regex sur des montants.
