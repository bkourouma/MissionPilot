Reporté dans la documentation le 2026-10-21 (lot 9a).

# Notes du lot 3 (DD 3b-bis, canaux 3c-bis, mineurs de recette) — mises à jour de documentation à reporter

Fichier de transit : le chef de lot n'a pas le droit de modifier SECURITY.md, DECISIONS.md, CODING_STANDARDS.md,
review-checklist.md, HANDOFF.md, RUNBOOK.md ni les SPEC. Le superviseur reporte les blocs ci-dessous puis supprime ce fichier.

## 1. SPEC-3c-canaux-simules.md

- **Ligne 430** (`canaux_destinataires`) : remplacer « Uniques : `(cabinet_id, utilisateur_id, canal)` et `(cabinet_id, canal, numero_empreinte)` (un numéro n'est pas
  partagé entre deux personnes : l'expéditeur d'un message est univoque) » par « Uniques : `(cabinet_id, utilisateur_id, canal)` et, **seulement pour les numéros vérifiés**,
  `(cabinet_id, canal, numero_empreinte) WHERE verifie_le IS NOT NULL` (index `canaux_destinataires_numero_verifie_uniq`, migration 0541, audit M5 : enregistrer un numéro déjà
  vérifié par un autre ne révèle rien ; le conflit se tranche à la vérification du code ; un numéro non vérifié ne reçoit aucun message entrant) ; un index non unique
  `canaux_destinataires_empreinte_idx` sert la recherche de l'expéditeur ».
- **Ligne 1109** (O-22) : « valeur retenue » = « un numéro **vérifié** = une personne par cabinet et par canal (unicité partielle sur `verifie_le IS NOT NULL`) ; plusieurs
  comptes peuvent saisir le même numéro non vérifié, aucun ne reçoit de message entrant tant qu'il n'est pas vérifié ».
- **§17 O-26** : branchement fait pour les alertes sortantes (`apps/api/src/kpi/suivi.ts` + `apps/api/src/canaux/alertes-kpi.ts`) : après l'enregistrement d'une alerte et pour le rappel
  de mesure, mise en file d'un message `alerte_kpi` (catégorie `alerte`, objet `kpi_alerte`, clés `kpi_alerte:<alerte>:<destinataire>` et `kpi_rappel:<rappel>:<destinataire>`) vers les seuls
  responsables INTERNES autorisés, avec numéro vérifié et consentement accordé ; variables = nom du cabinet et lien `/portail/` ; aucune valeur chiffrée, aucun libellé de KPI ; bloc dans un
  `SAVEPOINT` (ne fait jamais échouer le suivi) ; option du compte `alerte_kpi` DÉSACTIVÉE par défaut (migration `0549_canaux_alerte_kpi.sql`). Une alerte `MESURE_EN_RETARD` ne part pas
  seule (le rappel du même passage la couvre). Côté « saisie reçue par canal » : la valeur confirmée puis reprise par le cabinet est une `kpi_mesures` d'origine `cabinet`, comptée par le
  suivi comme toute autre (test `canaux-kpi-suivi.test.ts`) ; la provenance reste traçable par le commentaire de la mesure (« Reçu par WhatsApp… ») et la jointure `canaux_saisies_kpi.mesure_id` (statut `reprise`, origine texte/vocal) ; aucune fonction dédiée (supprimée faute d'appelant).
- **§6.1** : ajouter la colonne `canaux_comptes.alerte_kpi boolean NOT NULL DEFAULT false`.
- **§6.2** : la source `desactivation_utilisateur` est écrite à la désactivation d'un utilisateur du portail (`routes/portail-gestion.ts`) ET d'un utilisateur du cabinet (`routes/utilisateurs.ts`,
  PATCH, passage `actif` true → false, même transaction) par `retirerConsentementsUtilisateur` ; le destinataire n'est jamais supprimé ni modifié.
- **Ports (§ports, §8, §13)** : `telechargerMedia(compte, refMedia): Promise<MediaFlux>` avec `MediaFlux = { flux: AsyncIterable<Uint8Array>; typeMime: string; tailleDeclaree?: number }` ;
  `MediaRecu` supprimé ; « 15 Mo au plus » appliqué en flux par `lireFluxPlafonne` (`canaux/media-flux.ts`) : taille déclarée contrôlée avant lecture, compteur d'octets, flux fermé au
  dépassement, jamais de lecture complète ; type MIME hors liste blanche : flux fermé sans lecture.
- **§10.2 n° 25 et 37, §12.3** : `GET /signatures/:id/document` et `GET /portail/signatures/:id/document` servent le PDF en `inline` (type `application/pdf` fixé, `nosniff`,
  `private, no-store`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'; frame-ancestors 'none'` SANS `sandbox`), avec repli `attachment` + `sandbox` si le type stocké n'est pas PDF.

## 2. SPEC-3b-due-diligence.md et ADR-012

- **§1 ligne « Portail investisseur » et §16 « Accès d'un investisseur-client »** : n'est plus repoussé. Livré : option du cabinet (désactivée par défaut), invitation d'un compte portail
  `client_investisseur` sur un dossier, publication d'un instantané de la version VALIDÉE de la note + pièces choisies (rapports de la note), consultation en lecture seule.
  ADR-012 point 7 : idem.
- **§1 ligne DD-07** : véhicule livré (modèles d'analyse par secteur, vides par défaut, rédigés par le cabinet) ; aucun contenu sectoriel livré.
- **§3.2** : la lettre `Z` n'est plus la seule solution ; les codes du lot après `MPZ32` prennent le préfixe `MQD` (`MQD01`–`MQD08` portail investisseur, `MQD11` modèles sectoriels ;
  `MQD09`, `MQD10`, `MQD12`–`MQD20` libres).
- **§3.1** : `0509` (portail investisseur) et `0511` (modèles sectoriels) consommées ; `0510` et `0512`–`0519` libres.

## 3. SECURITY.md

- **§4 bis (portail)** : trois routes ajoutées à `LISTE_BLANCHE_PORTAIL` (GET/HEAD) : `/api/portail/due-diligence/publications`, `/api/portail/due-diligence/publications/:id`,
  `/api/portail/due-diligence/publications/:id/pieces/:pieceId/fichier`. Nouvelle sortie `horsContextePortail` (téléchargement d'une pièce, après contrôle dans `avecPortail`, lecture interne
  qui revérifie tout explicitement) : cinq fichiers désormais (inventaire dans `portail-contexte.test.ts`).
- **§8 octies** : remplacer « L'investisseur-client ne voit rien (repoussé) » par : un compte portail `client_investisseur` invité sur un dossier (et seulement si l'option du cabinet est active)
  lit en lecture seule l'instantané d'une version de note validée et publiée, et télécharge les pièces choisies. Les tables `dd_notes`, `dd_note_versions` (`base_figee`), `dd_dossiers`,
  `rapports_mission` restent `portail_interdit`. Cinq tables `dd_portail_*` en ajout seul : politiques RESTRICTIVES `portail` (SELECT) + `portail_sans_insert/update/delete`. Aucun identifiant
  de dossier, note, mission ou rapport, aucun nom de membre du cabinet, aucun coût n'est servi au portail. Piège : une politique contenant `NOT EXISTS (retraits)` laisse passer si la table des retraits
  est invisible du portail : les retraits portent le `client_id` de leur publication (MQD06) et sont lisibles pour ce client. `dd_portail_options` n'est PAS `portail_interdit` (la politique des
  publications la lit) : sa lecture est réduite aux comptes invités au moins une fois. Limite connue : du SQL arbitraire du rôle applicatif contourne les gardes de cohérence (comme MPZ29).
- **Canaux** : (a) le réserve « taille contrôlée seulement APRÈS le téléchargement en mémoire » (ligne ~2459) est levée côté appelant ; reste pour le futur adaptateur réel : corps non
  bufferisé, hôte de confiance (SSRF), délai (timeout) sur le flux ; (b) alertes de KPI sortantes : sans valeur chiffrée, désactivées par défaut, mise en file seulement ; (c) PDF de signature
  servi `inline` sans `sandbox` : risque résiduel = faille de la visionneuse PDF du navigateur ou contournement du filtre de contenu actif (`stockage/detection.ts`) ; la route générique
  `GET /fichiers/:id` garde `sandbox`.

## 4. CODING_STANDARDS.md

- §1 : prochains numéros libres : due diligence `0510` puis `0512`, canaux `0550`.
- §2 : déclarer le préfixe à deux lettres `MQ…` (`MQD` due diligence ; `MQC` canaux, aucun code encore employé) ; plus aucune lettre simple libre.

## 5. DECISIONS.md — valeurs provisoires du lot

- Permissions : `dd.portail.configurer` (associé seul), `dd.portail.gerer` (associé, directeur de mission), `portail.dd.lire` (`client_investisseur` seul).
- Portail investisseur : au plus 10 pièces par publication, 50 publications par note, 500 événements d'invitation par dossier, 1 000 changements d'option ; une seule publication active par note ;
  seule la dernière version soumise et validée est publiable ; pièces figées à la publication (retirer puis republier pour les changer) ; retraits possibles après la clôture de la mission,
  invitation et publication refusées après clôture ; une publication dont la note a une version plus récente reste visible de l'investisseur (marquée « périmée » côté cabinet).
- DD-07 : 200 modèles par cabinet, 50 points par modèle, 300 caractères par point, 40 000 octets de points par version ; un modèle par secteur (pas par filière) et par analyse.
- Canaux : option `alerte_kpi` désactivée par défaut ; lien de l'alerte `/portail/` (voir questions).
- Noms de fichiers de la note au comité : `Note au comité - <titre ≤ 60> - v<version> - exécutive|détaillée <date>.<ext>`.

## 6. review-checklist.md / compteurs

- Recherche n° 10 (routes) : +11 gestionnaires de portail investisseur (8 cabinet `routes/due-diligence-portail.ts`, 3 portail `routes/due-diligence-portail-investisseur.ts`) et +6 de modèles sectoriels
  (`routes/due-diligence-modeles.ts`) ; l'inventaire de `dd-acces.test.ts` est passé à 67 routes `/dd/` (53 + 14) et 70 gestionnaires `due-diligence*.ts`.
- Migrations : 180 + 3 = 183 (0509, 0511, 0549). Tables `dd_*` : +7 (5 portail, 2 modèles) ; `TABLES_DD` de `dd-outils.ts` / `dd-base.test.ts` n'ont PAS été étendues aux deux tables des modèles
  (éprouvées dans `dd-modeles.test.ts`).

## 7. RUNBOOK.md (seed de démonstration)

« `db:seed-demo` ajoute, en fin de course, les données des CANAUX SIMULÉS (`apps/api/src/db/seed-demo-canaux.ts`) : compte WhatsApp simulé actif (saisie de KPI activée, alerte KPI par défaut) ;
deux destinataires aux seuls numéros de test du simulateur, Salimata Bakayoko (+2250000000012, joignable, consentement du portail) et Nadège Yapi (+2250000000000, NON joignable, consentement
recueilli par le cabinet avec référence) ; un journal d'envois (relance en échec NUMERO_NON_JOIGNABLE, invitation à signer acceptée) ; une demande de signature « Lettre de mission - signature
electronique (DÉMONSTRATION) » envoyée (signataires Fanta Doumbia pour le cabinet, Salimata Bakayoko pour le client, 2FA active, personne n'a signé) ; une transcription DÉMONSTRATION à relire.
Aucun envoi réel, aucune clé, aucun appel réseau. Sur une base déjà peuplée : `pnpm --filter @missionpilot/api exec tsx src/db/seed-demo-canaux.ts` (idempotent). »

## 8. HANDOFF.md

- Retirer de « E » : 3b-bis (portail investisseur livré ; DD-07 : véhicule seulement, contenu à rédiger par un expert), 3c-bis (O-26, seeds, média en flux, SPEC lignes 430/1109).
- Retirer de « B » : mineurs 3b (`role="tree"`, noms de fichiers, code `dd.pestel.*`) et 3c (`attachment`).
- Les écarts `DestinataireCanalApi.id` nullable et `destinataire_id` de l'aperçu étaient déjà alignés dans le code (vérifié, test API ajouté).
- Non vérifié : rendu navigateur de toutes les pages ajoutées ; PDF `inline` dans Chrome ; PDF de la note en portail (seul le Word est testé) ; navigation clavier réelle de l'arbre ; fournisseurs réels.
- Reste : routage des alertes KPI vers des internes sans numéro (voir questions), timeout de lecture du flux média pour le futur adaptateur réel, filière pour les modèles DD-07.
