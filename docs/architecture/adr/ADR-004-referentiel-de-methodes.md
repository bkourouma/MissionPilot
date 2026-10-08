# ADR-004 : Référentiel de méthodes, héritage et modulation

## Statut

Accepté

## Date

2026-10-08

## Contexte

Le PRD complémentaire du 2026-10-08 (§3, §4, §17, §18) fait du **référentiel
de méthodes** la clé de voûte de la V3 : toutes les missions, de tous les
métiers retenus (conseil en management et gouvernance, risques et contrôle
interne, DECISIONS.md), parlent la même grammaire (service, méthode, étape,
brique, livrable, rubrique, item, KPI type, initiative type, risque type,
gabarit, automatisation — STD-01). Ce qui varie d'une mission à l'autre doit
être de la **donnée de paramétrage**, jamais du code ni un document recopié.

Les subtilités du terrain (secteur et filière, pays, taille, propriété,
fiabilité des comptes, part de l'informel, saisonnalité, langues, financeur…)
deviennent des **facteurs de contexte** typés portés par le dossier client et
la mission (STD-04), lus par des **règles de modulation** déclaratives,
déterministes, testées sur des cas types, simulables avant activation et
journalisées (STD-05). L'IA peut proposer une règle à partir des dérogations
observées ; seul le comité méthode l'active.

Contraintes transverses : isolation entre cabinets (RLS, ADR-001) ; les
chiffres sortent d'un moteur testé (`packages/engines`, couverture ≥ 90 %) et
jamais du modèle de langage ; une évolution du standard ne modifie jamais en
silence une mission en cours (STD-08) ; toute exception est motivée, approuvée
selon la classe de risque et tracée (STD-07, QUA-01).

## Décision

- **Données en tables PostgreSQL versionnées, jamais du code.** Méthodes,
  étapes, briques, facteurs, règles de modulation, rubriques et gabarits sont
  des lignes (plage de migrations `0200–0219`, lot STD). Une version publiée
  est **immuable** (déclencheur à SQLSTATE `MP…` et `REVOKE`, comme les
  historiques existants) ; on corrige par une nouvelle version avec notes de
  version.
- **Héritage à quatre niveaux** : standard MissionPilot (propriété d'ACC,
  `cabinet_id` nul, lecture seule pour les cabinets) → variante cabinet
  (expert métier, permission `standard.gerer` ; différences visibles) →
  variante de contexte (règles de modulation) → mission (dérogation, permission
  `methode.deroger`). La résolution d'une méthode effective suit cet ordre ;
  le niveau le plus bas l'emporte, sauf garde de classe de risque qui ne peut
  être qu'élevée.
- **Mission figée sur une version** : une mission référence une version de
  méthode (et la version de chaque jeu de règles) au moment de sa création ;
  la migration vers une version plus récente est assistée, facultative et
  tracée (STD-08).
- **Règles évaluées par le moteur pur** `packages/engines/src/modulation`
  (`appliquerModulation`, `simulerModulation`, `executerCasTypes`,
  `validerReglesModulation`, `validerContexteModulation`) : conditions
  combinables (tous, au moins un, non ; égal, différent, <, <=, >, >=, dans,
  contient ; état d'une brique), effets typés (activer ou retirer une brique ou
  un item, pondération, seuil, benchmark, gabarit, formulation, recommandation
  candidate, relèvement de la classe de risque), priorités entières, conflits
  résolus par la priorité (à priorité égale : non résolus, état de référence
  conservé, signalés d'avance par la validation), cycles refusés. Mêmes
  entrées ⇒ même sortie, ordre stable ; aucun appel IA.
- **Forme JSON unique** : une règle se stocke en `jsonb` sous la forme du schéma
  partagé `regleModulationSchema` (`packages/shared/src/schemas/fondations.ts`,
  strict, imbrication bornée avant l'analyse récursive), identique aux types du
  moteur ; aucune conversion entre la base, l'API et le moteur.
- **Activation** : un jeu de règles ne s'active que si `validerReglesModulation`
  ne relève aucune erreur et si ses cas types passent ; la simulation sur les
  contextes réels du cabinet est présentée avant activation. Le journal
  d'application (règle, feuilles vérifiées, valeurs lues, effets retenus et
  écartés) est conservé avec la mission.
- **Dérogations** : motif obligatoire, approbation selon la classe de risque de
  la brique (gardes du moteur `qualite`), traçabilité et tableau de bord
  (STD-07) ; leur analyse alimente les propositions de règles (CAP-05).
- **Permissions** : `standard.lire` (rôles de conseil), `standard.gerer`
  (associé, expert métier), `methode.deroger` (associé, directeur et chef de
  mission). Aucune route du référentiel n'est ouverte au portail client.

## Conséquences positives

- Une subtilité de terrain devient une règle lisible, testée et rejouable au
  lieu d'une consigne cachée dans un prompt.
- Les résultats d'une mission sont reproductibles : version figée, règles
  déterministes, journal d'application.
- Les lots DOS, PRV, AGT et QUA s'appuient sur un même vocabulaire (classes de
  risque, facteurs, briques) sans dépendance de code entre eux.

## Conséquences négatives

- Effort initial de constitution du standard (risque « Effort initial » du
  PRD §20) ; l'amorçage par l'IA (STD-13) reste à construire.
- Le moteur de règles reste volontairement simple (pas de calcul dans les
  conditions, pas d'effet qui modifie un facteur) : un besoin plus riche
  exigera un nouvel ADR plutôt qu'un langage de script.
- La résolution des conflits à priorité égale ne choisit pas : le comité
  méthode doit trancher les avertissements de validation.
- La comparaison des chaînes se fait par unités UTF-16, sans locale : l'ordre
  des journaux n'est pas l'ordre alphabétique français.

## Alternatives écartées

- **Méthodes en code ou en fichiers versionnés dans le dépôt** — chaque
  variante cabinet exigerait un déploiement ; contraire à « données de
  paramétrage, jamais du code ».
- **Personnalisation par prompt IA** — invisible, non reproductible, non
  testable (angle mort relevé dans SANKORIA, PRD §2).
- **Moteur de règles générique tiers (JSON Logic, Drools…)** — dépendance et
  expressivité excessives pour des règles qui doivent rester lisibles par un
  expert métier ; le moteur pur maison tient en quelques centaines de lignes
  couvertes à 100 %.

## Liens

- PRD complémentaire, §3, §4 (STD-01 à STD-14), §17, §18 ; `docs/DECISIONS.md`.
- `packages/engines/src/modulation/`, `packages/engines/src/qualite/`.
- `packages/shared/src/schemas/fondations.ts`, `packages/shared/src/roles.ts`.
- `apps/api/src/routes/standard.ts` (rempli par le lot STD).
- ADR-001 (stack), ADR-005 (exécuteur d'agents).
