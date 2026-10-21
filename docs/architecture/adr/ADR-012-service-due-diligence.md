# ADR-012 : Service #2 « Due diligence » (hypothèses, verdicts sourcés, moteurs de dimensionnement)

## Statut

Acceptée par l'utilisateur le 2026-10-14 (rédigée avec la spécification
`docs/workflows/specs/SPEC-3b-due-diligence.md`, sous-chantier 3b de la vague 4).

Mise à jour du 2026-10-21 : le point 7 (portail investisseur) et le point 9
(préfixe de codes) ont été dépassés par le lot 3 (portail investisseur, migrations
`0509` et `0511`). L'historique du texte d'origine est conservé ; chaque point
concerné porte sa correction.

## Date

2026-10-11

## Contexte

Le PRD (« Service 2 », DD-01 à DD-08) et le PRD complémentaire (§11.2, DD-09 à
DD-15) demandent un service de due diligence stratégique : une étude d'un
secteur ou d'une cible avant investissement en Afrique francophone. Le PRD
complémentaire en fait « une démarche par hypothèses, où chaque verdict est
sourcé ». Le service #2 est le premier service construit après les fondations
(vague 1 : méthodes, dossier client, registre des preuves, agents, qualité) et
les vagues 2 et 3 ; il appartient à la vague 4 (PRD complémentaire §18) et
passe après le module d'appels d'offres (DECISIONS.md, orientations du
2026-10-08).

Faits qui pèsent sur la décision :

- Le **registre des preuves** existe (migrations `0240`–`0243`, lot PRV) :
  preuves versionnées et sourcées, assertions versionnées rattachables à une
  « dimension », une « hypothèse » ou un « risque »
  (`assertion_versions.rattachement_type`), liens pour/contre en journal,
  arbitrages, indice de solidité calculé par `packages/engines/src/preuves`,
  contrôle PRV-03 des assertions R2/R3 sans preuve. Le mot « hypothèse » y est
  déjà prévu, sans module qui l'emploie.
- Le moteur de **rapports** (`apps/api/src/rapports`, `rapports_mission`, ajout
  seul) sait rendre un modèle de contenu en PDF et Word, avec niveau de
  confidentialité, annexe « Sources » (PRV-06) et suivi qualité (QUA). Chaque
  nouveau modèle réécrit les contraintes de `rapports_mission` (`0131`, `0424`).
- Aucun chiffre ne vient d'un modèle de langage ; la validation d'un contenu
  engageant se fait par une autre personne que l'auteur (séparation des tâches
  doublée en base).
- Le **portail client est fermé par défaut** (`LISTE_BLANCHE_PORTAIL`) ;
  l'investisseur-client (`client_investisseur`) n'avait, à la rédaction, que
  `portail.acceder` et aucun écran (état modifié par le lot 3 : voir le point 7).
- La **chaîne d'ingestion et d'OCR** (ADR-009) n'est pas écrite ; la lecture
  IA d'une salle de données (DD-10) et l'import de rapports PDF (DD-02) en
  dépendent. Aucune clé OpenRouter n'existe en développement (HANDOFF).
- Plages de migrations : le dernier numéro employé est `0465` et la plage
  `0466`–`0479` reste à la capitalisation. Les autres sous-chantiers de la
  vague 4 ont réservé `0480`–`0499` (redressement, ADR-011) et `0540`–`0559`
  (canaux simulés) ; ce lot réserve `0500`–`0519`, sans chevauchement.
- Lettre SQLSTATE : dans le code, seules `H` et `Z` ne servent pas (relevé des
  `MP[A-Z]nn`, CODING_STANDARDS §2). Les autres sous-chantiers de la vague 4 les
  ont prises en parallèle : les canaux simulés `H` (ADR-008, 010, 013), le
  redressement `Z` (`MPZ01`–`MPZ11`, ADR-011). Il ne reste aucune lettre libre.

Contraintes transverses (AGENTS.md) : isolation entre cabinets par RLS,
chiffres par les moteurs seuls, l'IA propose et l'expert dispose, données
financières internes réservées (FIN-02), interface en français, devises XOF,
XAF, EUR, USD.

## Décision

1. **Une affirmation sourcée est une assertion du registre des preuves.** Le
   module `dd` ne recopie ni preuves, ni solidité, ni contradictions : chaque
   point d'une analyse (PESTEL, cinq forces, SWOT, analyse opérationnelle),
   chaque risque et chaque hypothèse s'appuie sur des assertions existantes
   (`assertions`, `assertion_versions`, `assertion_preuve_liens`). L'indice de
   solidité reste celui de `packages/engines/src/preuves`. Les catégories d'une
   analyse sont des « dimensions » du registre (`dd.pestel.politique`…), ce qui
   donne gratuitement la carte de triangulation (PRV-05). Une affirmation sans
   source reste visible comme « fragile » ; le contrôle PRV-03 la signale.
2. **Un verdict est une décision humaine, indiquée par un moteur, figée avec
   ses sources.** Le moteur `indicationVerdict` propose confirmée, infirmée ou
   non concluante à partir des lectures de solidité des assertions liées à
   l'hypothèse (liées « soutient » ou « contredit », en journal). Le verdict
   proposé par un membre de l'équipe est enregistré avec la photographie des
   assertions citées (identifiant, version, sens, indice, lecture) ; un verdict
   confirmé ou infirmé sans assertion citée est refusé en base. Un verdict ne
   prend effet qu'une fois validé par une autre personne (valideur différent du
   proposant, de l'auteur de l'hypothèse et des auteurs des assertions citées,
   sauf associé ; doublé en base). Un verdict qui s'écarte de l'indication du
   moteur exige un motif détaillé et crée un **ajustement tracé** (DD-08).
3. **Aucune IA dans ce lot.** Les analyses, les risques, les hypothèses, les
   paramètres de marché et la note sont saisis par les experts ; le modèle de
   données et les routes ne portent aucun champ de contenu IA. Le lot suivant
   (rédaction assistée) ajoutera par migration le statut `brouillon_ia` et
   passera par `ia/orchestrateur.ts`, sans changer le modèle de sourcing.
4. **Tables en ajout seul, structure plutôt que contenu.** Vingt tables
   `dd_*`, toutes sans `UPDATE` ni `DELETE` (déclencheur `MPZ21`) : un tableau
   d'éléments typés (`dd_elements` : point d'analyse, étape de chaîne de
   valeur, risque, hypothèse, action du plan des 100 jours) et leurs versions
   (`dd_element_versions`, colonnes typées pour tout ce qui porte une clé
   étrangère ou un nombre), plus des journaux et des versions propres à chaque
   fonction. Modèle repris du plan stratégique (`0180`) et du registre des
   preuves (`0240`).
5. **Moteurs purs dans `packages/engines/src/due-diligence`** : dimensionnement
   de marché descendant et ascendant avec fourchette, sensibilité et
   recoupement (DD-12, arithmétique entière en `bigint`, pourcentages en points
   de base), synthèse de la chaîne de valeur (DD-04), synthèse des risques
   (DD-06), indication de verdict et contrôle de l'arbre d'hypothèses (DD-09),
   signaux applicables (DD-11), filtrage d'exclusion et synthèse
   environnementale et sociale (DD-14), plan des 100 jours (DD-15), contrôle de
   la note au comité (DD-13). Tout seuil est une constante exportée, notée
   provisoire (DECISIONS.md).
6. **Note au comité en deux variantes depuis une même base figée.** À la
   soumission, l'API calcule par les moteurs une `base_figee` (jsonb borné,
   sans verbatim nominatif) et l'inscrit dans une version « soumise » de la
   note ; la validation (autre personne, doublée en base) la rend livrable. Les
   variantes « exécutive » et « détaillée » sont deux rendus de cette même base
   par le moteur de rapports existant (`rapports/note-comite.ts`, modèle
   `note_comite`, niveau `dd`, lecture par `dd.lire`) ; seule une version
   validée se rend (MPR04). Les contrôles bloquants (hypothèse sans verdict
   validé, assertion R2/R3 sans preuve, exclusion non levée avec une
   recommandation favorable…) empêchent la soumission.
7. **Portail fermé.** Les vingt tables portent `portail_interdit` et aucune
   route ne figure dans `LISTE_BLANCHE_PORTAIL`. L'accès d'un investisseur
   client à une note validée était **repoussé à l'origine** (il exigerait une
   permission `portail.*`, une table de partage, une route nommée à la liste
   blanche et un écran ; voir la spécification, « Repoussé »). **Livré ensuite
   par le lot 3 (2026-10-20)** : migration `0509` (option du cabinet désactivée par
   défaut, invitations, publications et retraits, codes `MQD01`–`MQD08`),
   routes `due-diligence-portail-investisseur` (lecture seule,
   `/api/portail/due-diligence/publications…`, nommées à la liste blanche),
   permissions `dd.portail.configurer`, `dd.portail.gerer` et `portail.dd.lire`.
   Les vingt tables d'origine restent fermées au portail : l'investisseur ne lit
   qu'un instantané publié par le cabinet (voir DECISIONS.md, « Due diligence :
   portail investisseur et modèles sectoriels »).
8. **Habilitations.** Quatre permissions nouvelles dans
   `packages/shared/src/roles.ts` : `dd.lire`, `dd.ecrire`, `dd.valider`,
   `dd.referentiel.gerer` (bibliothèque de signaux et listes d'exclusion). Toute
   personne qui détient `dd.ecrire` détient `preuve.ecrire` (test).
9. **Codes et plages.** SQLSTATE `MPZ21`–`MPZ32` (migrations `0500`–`0508`) : la
   lettre `Z` est **partagée avec le redressement sur des numéros disjoints**
   (il garde `MPZ01`–`MPZ20`), solution qui n'assouplit que la règle « une
   lettre par domaine » et que le Pilote confirme (repli : un second préfixe,
   `MQD01`–`MQD12`) ; plus `MPR04` (source d'une note rendue en rapport) ;
   plage de migrations `0500`–`0519` réservée au lot, durcissements d'audit
   compris. **État au 2026-10-21** (CODING_STANDARDS §2) : la lettre `Z` est
   épuisée (redressement `MPZ01`–`MPZ20`, due diligence `MPZ21`–`MPZ32`, dernier
   partage, qui ne se reproduit pas) ; le repli sur un second préfixe `MQD` a été
   **utilisé** par le lot 3 : `MQD01`–`MQD08` (portail investisseur, `0509`) et
   `MQD11` (modèles sectoriels, `0511`) sont employés, `MQD09`–`MQD10` et
   `MQD12`–`MQD20` restent libres.
10. **Repoussés** : DD-02 (connecteurs de données ouvertes et import de rapports
    PDF : seule l'interface d'un fournisseur et un adaptateur simulé, sans
    appel réseau, jamais branchés à une route ; **OUVERT**), DD-10 (lecture IA
    de la salle de données : attend ADR-009), DD-07 (modèles sectoriels : le
    contenu est à rédiger par des experts) ; DD-05 est rattaché comme quatrième
    analyse (« opérationnelle »), sans calcul.

## Conséquences positives

- « Chaque verdict est sourcé » est une propriété vérifiable en base, pas une
  convention : sources citées, solidité figée, validation par un tiers.
- Aucune duplication du registre des preuves ; la triangulation, les
  contradictions arbitrées et l'annexe « Sources » du rapport fonctionnent
  immédiatement pour la due diligence.
- Les moteurs sont purs et testables sans base ; trois agents travaillent en
  parallèle sur des territoires de fichiers disjoints.
- Le lot suivant (IA) n'a qu'à ajouter un statut et un appel à
  l'orchestrateur : le sourcing, la validation et l'historique existent déjà.
- Aucune nouvelle fonction `SECURITY DEFINER`, aucun job, aucune variable de
  configuration.

## Conséquences négatives

- Vingt tables et douze codes SQLSTATE de plus à relire à chaque audit ; les
  déclencheurs d'intégrité (rattachements, séparation des tâches) sont
  nombreux.
- Ce lot réécrit les contraintes de `rapports_mission` (comme `0131` et `0424`) :
  tout lot qui ajoutera ensuite un modèle de rapport (par exemple le rapport de
  clôture du redressement) devra reprendre la réunion des valeurs
  (spécification, « Intégration »). La règle de lettre partagée est une entorse
  à la convention de nommage des SQLSTATE, à consigner dans CODING_STANDARDS §2.
- Tout se corrige par une nouvelle version : l'historique grossit (plafonds par
  dossier) et aucune purge n'est prévue ; la durée de conservation du contenu
  d'une due diligence reste à décider avec le conseil juridique.
- La `base_figee` d'une note peut atteindre 1 Mo de jsonb ; au-delà la
  soumission est refusée.
- Le moteur de verdict n'est qu'une indication à seuils provisoires ; sa
  valeur ne se juge qu'avec de vraies missions.
- *(Levée par le lot 3, 2026-10-20.)* À l'origine, l'investisseur-client ne voyait
  rien dans le portail et la note lui parvenait hors plateforme (fichier rendu) ;
  il consulte désormais un instantané publié par le cabinet (point 7), au prix
  d'une surface de portail élargie (trois permissions, trois routes de lecture à la liste blanche, huit
  codes `MQD`).

## Alternatives écartées

- **Tables séparées pour chaque type de contenu** (une paire par analyse,
  chaîne, risque, hypothèse, action) — six tables de plus, autant de
  déclencheurs de numérotation ; la table d'éléments typée suit le précédent du
  plan stratégique et reste lisible avec des contraintes par type.
- **Copier l'énoncé et les sources dans le module** — duplique le registre des
  preuves et casse « une seule vérité » de la solidité.
- **Verdict calculé par le moteur et appliqué automatiquement** — contraire à
  « l'IA propose, l'expert dispose » étendu aux moteurs d'indication : un
  jugement d'investissement reste une décision humaine validée.
- **Brouillons modifiables avec une table d'ajustements écrite à la main** —
  l'ajout seul avec versions et motif donne la trace de DD-08 sans fonction
  « modifier » ; les ajustements automatiques ne couvrent que les écarts à une
  proposition du moteur ou de la bibliothèque.
- **Connecteurs réels (Banque mondiale, FMI, ONUDI) dans ce lot** — dépendent
  de l'ingestion, de la gestion des sources et d'un choix de fournisseur, sans
  clé ni environnement de recette ; un adaptateur simulé fixe le contrat sans
  produire de donnée qui passerait pour réelle.
- **Partage de la note au portail dès ce lot** — élargit la surface du
  portail (permission, table de partage, route, écran, tests d'isolation) pour
  un rôle sans écran aujourd'hui ; mieux vaut le traiter avec le portail
  investisseur (PRD complémentaire §13). *(Fait par le lot 3, 2026-10-20.)*
- **Plage `0480`–`0499` pour le lot** — c'est la suite naturelle de `0479`, mais le
  redressement (ADR-011) l'a réservée ; deux lots dans la même plage se
  marcheraient dessus.
- **Lettre `H` (« hypothèses »)** — plus parlante, mais les canaux simulés (ADR-010,
  ADR-013) y placent déjà `MPH11` et `MPH07`.
- **Un second préfixe (`MQD…`)** — retenu seulement en repli : il crée une famille
  de codes entière pour douze codes, alors que le partage de `Z` par numéros
  disjoints ne demande qu'une ligne de convention.

## Liens

- Spécification : `docs/workflows/specs/SPEC-3b-due-diligence.md`.
- PRD : « Service 2 » (DD-01 à DD-08) ; PRD complémentaire §11.2 (DD-09 à
  DD-15), §6 (preuves), §18 (vagues).
- ADR : ADR-004 (service `due_diligence` déjà déclaré dans `services_conseil`,
  `0204`), ADR-005 (agents, pour le lot IA à venir), ADR-009 (ingestion, absente),
  ADR-011 (sous-chantier 3a, redressement).
- Code de référence : `apps/api/migrations/0240`–`0243` (preuves),
  `0180` (plan, séparation des tâches), `0424` (modèle de rapport),
  `apps/api/src/preuves/`, `apps/api/src/rapports/`,
  `packages/engines/src/preuves/`.
- DECISIONS.md : valeurs provisoires du lot (voir la spécification).
