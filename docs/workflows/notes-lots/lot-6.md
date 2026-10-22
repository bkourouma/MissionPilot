# Notes du lot 6 — ingestion de documents et OCR (2026-10-21)

Branche `orch/2026-10-20-reste-lot-6`. `HANDOFF.md`, `SECURITY.md`, `DECISIONS.md` et `CODING_STANDARDS.md` ne
sont pas modifiés par ce lot ; les mises à jour listées en fin de document sont à reporter par le superviseur.
Décision d'architecture : [ADR-009](../../architecture/adr/ADR-009-ingestion-documents.md) (Acceptée, décision
technique du superviseur).

## Livré

1. **Socle d'ingestion** (`apps/api/src/ingestion/**`, migrations `0521` à `0523`) : réception d'un PDF ou XLSX
   (type décidé par le contenu), job `ingestion_extraction` (texte des pages, `ingestion_pages`), job
   `ingestion_structuration` (selon l'usage), brouillons `ingestion_extractions`. Le fichier est analysé puis
   effacé (jamais conservé) ; aucune clé étrangère vers `fichiers`, `fichier_orphelin` inchangée.
   - PDF : `unpdf` 1.8.1 (une seule dépendance ajoutée, aucune dépendance transitive), dans un `worker_thread` à
     mémoire plafonnée.
   - OCR : port `Ocr` avec UN adaptateur simulé (hors production). Aucun OCR réel (voir questions).
   - Moteurs purs : `packages/engines/src/ingestion/**` (couverture du dossier ≈ 99 %).
2. **DOS-03** : `POST /api/dossiers/:id/etats-financiers/document` (PDF, liasse en XLSX), extraction avec
   `reference.page` (PDF) ou `reference.cellule`/`ligne` (Excel), contrôles par `controlerEtatFinancier`
   (existant), acceptation automatique seulement si tous les contrôles passent à tolérance nulle ET aucune ligne
   rejetée/non lue ET texte natif ET aucun état accepté par un humain remplacé, sinon `en_revue`. Nouvelle origine
   `pdf` (migration 0523). `ingererEtat` reçoit l'option `forcerRevue` (comportement inchangé sans elle).
3. **DD-02 et DD-10** : `POST /api/dd/dossiers/:id/documents?type=rapport|salle`, lecture IA (résumé + éléments
   avec page et extrait vérifié dans la page), brouillon validé par `dd.valider` (autre que le dernier modificateur,
   sauf associé), acquittement des éléments non retrouvés. La validation ne pousse rien ailleurs.
   `due-diligence/donnees-ouvertes.ts` reste simulé, sans route ni réseau.
4. **STD-13** : `POST /api/methodes/versions/:id/amorcage/documents` ; proposition (étapes, briques, éléments,
   rubriques à 5 niveaux) validée par `standard.gerer` ; la validation applique au BROUILLON de méthode par les
   fonctions de l'éditeur STD-11 (briques R3, N1, inactives par défaut). Rien n'est publié.
5. **Web** : carte d'import et liste sur `/dossiers/[id]/finances`, détail `/dossiers/[id]/finances/documents/[docId]` ;
   onglet « Documents » du dossier DD (`.../due-diligence/[dossierId]/documents` et `[docId]`) ; amorçage
   `/methodes/versions/[id]/amorcage` et `[docId]`. Aucun test dans un navigateur.

## Migrations

| Numéro | Objet | Remarque |
| ------ | ----- | -------- |
| `0521_ingestion_documents.sql` | `ingestion_documents`, `ingestion_pages` | SQLSTATE `MQG01`, `MQG03` |
| `0522_ingestion_extractions.sql` | `ingestion_extractions` | SQLSTATE `MQG02` |
| `0523_ingestion_etats_pdf.sql` | `origine` accepte `pdf` | CHECK de `dossier_etats_financiers` seulement |
| `0524_ingestion_purge_textes.sql` | `purger_textes_ingestion` (SECURITY DEFINER), `planifier_ingestion_maintenance` | purge du texte des pages, job quotidien |

Plage `0521`–`0524` utilisée ; préfixe `MQG` (01 à 03) à déclarer. Aucune redéfinition de `rapports_mission`, de
`fichier_orphelin` ni d'une fonction commune.

## Plafonds provisoires (`PLAFONDS_INGESTION`, `packages/shared/src/schemas/ingestion.ts`)

PDF 10 Mo ; XLSX 2 Mo ; 60 pages ; 25 000 caractères par page, 400 000 par document ; extraction 30 s ; 5 documents
en traitement (documents de plus de 30 minutes non comptés) et 40 créations par 24 h glissantes par cabinet ;
40 000 caractères transmis au modèle.

## Revue de sécurité (Opus, 2026-10-21) — corrigé

C1 (PDF piégé → mémoire du processus : extraction en `worker_thread` borné) ; I1 (documents bloqués comptés dans le
quota) ; I3 (montant IA ancré sur la ligne de la page, colonne N) ; I4 / FIN-02 (texte des pages d'un document
d'amorçage réservé à l'auteur ou `finance.lire`) ; M2 (caractères de format), M3 (résumé vérifié), M4 (OCR), M5/M6
(commentaires). Non corrigé : M1 (objet de stockage non effacé si l'effacement échoue : `effacerObjetsMarques`
existe, non branchée), M7 (téléversement DD en trois transactions), M5 (la relance agit avec les droits de
l'auteur).

## Seconde passe (vérificateur et décisions de l'utilisateur, 2026-10-22)

- **Mémoire hors tas du worker PDF** (un PDF de 3 Mo à flux de 1,5 Go avait porté le RSS à 3,4 Go) : pré-contrôle
  `pdf-controle.ts` AVANT tout worker (indépendant du dictionnaire : tout `stream` dont les octets forment un en-tête
  zlib valide est décompressé de façon bornée, 32 Mo par flux, 128 Mo cumulés, Flate sur Flate jusqu'à 3 couches,
  plafond de travail de 512 Mo comptant aussi les échecs, 16 384 mots `stream` au plus ; cinq contournements
  testés : espace après `stream`, `/Filter` lointain, texte avant la fin de ligne, `endstream` dans les données,
  Flate sur Flate) et surveillance toutes les 150 ms de la mémoire externe du worker et du RSS du processus,
  worker terminé et `PLAFOND_TEXTE`. **Seuils de production abaissés à 256 Mo (mémoire externe) / +512 Mo (RSS)**
  après mesure : PDF légitimes de 21 à 88 Mo externes et +28 à +147 Mo de RSS ; cascade non Flate de 1,5 Go
  (ASCIIHex puis Flate) coupée en 2,6 à 3,0 s avec un pic de +321 à +363 Mo (avant : 3,4 à 5,1 s, +589 à +628 Mo ;
  surveillance du RSS seule, cas Node < 22.16 : 4,5 s, +529 Mo). Les mesures « ~1 s, +70 Mo » citées plus tôt
  venaient de seuils abaissés pour les tests : à ne pas retenir. Risque résiduel : les cascades dont la première
  couche n'est pas Flate (ASCIIHex, ASCII85, LZW, RunLength) et les PDF chiffrés ne sont bornés que par la
  surveillance (défense réactive, jusqu'à 2 workers simultanés) ; un flux Flate légitime de plus de 32 Mo, ou un
  scan Flate brut de plus de 5 pages A4 en RGB (cumul 128 Mo), serait refusé.
- **Pré-contrôle hors boucle (3e vérification)** : `controlerBombePdf` s'exécutait de façon synchrone sur la boucle
  d'événements et ne comptait que les octets de SORTIE de zlib : une chaîne de blocs deflate « stockés » vides à
  marqueurs espacés bloquait l'API 73 à 80 s (PDF de 9,46 Mo) ou 7,5 s et était ACCEPTÉE (9,30 Mo). Corrigé : le
  balayage tourne dans un `worker_thread` dédié (`pdf-controle-worker.mjs`, tas de 64 Mo, délai de 5 s puis
  `terminate()`, verdict `PLAFOND_TEXTE` si le délai ou la mémoire est dépassé) ; chaque appel à zlib compte pour
  le plus grand de ses octets de sortie et d'entrée (budget de travail 512 Mo) et un budget cumulé d'ENTRÉE de 64 Mo
  s'ajoute ; CINFO n'est plus contraint (pdf.js l'accepte) et les cascades Flate sont suivies jusqu'à épuisement
  des budgets (garde-fou de 64 couches, au lieu de 3). Mesures (Node 24) : K 73,4 s -> 164-221 ms (refusé), K2 7,5 s
  acceptée -> 145-182 ms (refusée), C (5 000 flux invalides) 247-575 ms, PDF légitimes de 9 à 12,5 Mo acceptés
  (balayage 17 à 235 ms, verdict de bout en bout 68 à 112 ms), retard maximal de boucle <= 15 ms ; surcoût du
  worker de contrôle 43 à 100 ms (≈ 55 ms). Délai total d'extraction au pire : 35 s (5 s + 30 s). Résiduel :
  `stockage/detection.ts` (`inflerBorne`) garde `CINFO <= 7` (refus sans danger) et ne compte pas l'entrée sur les
  flux d'objets : à examiner séparément ; le worker de contrôle n'a pas de surveillance mémoire (borné par
  l'algorithme, ≈ 100 Mo au pire).
- **Faux positifs / faux refus connus du pré-contrôle** : plus de 4 096 flux Flate = refus `PLAFOND_TEXTE` ; un PDF
  abîmé dont ≈ 7 flux Flate sont tronqués (relecture jusqu'à la fin du fichier à chaque échec) dépasse le budget
  d'entrée de 64 Mo et est refusé ; un flux Flate légitime de plus de 32 Mo ou un scan Flate brut de plus de 5
  pages A4 RGB (cumul 128 Mo) l'est aussi. L'utilisateur peut re-soumettre un PDF régénéré.
- **Node 22 minimum** : `worker.getHeapStatistics()` n'existe qu'à partir de Node 22.16 et `unpdf@1.8.1` exige
  Node >= 22. `engines.node` du package.json racine passe à `>=22` et la CI (`.github/workflows/ci.yml`, deux
  jobs) à `node-version: 22`. Garde défensive dans `pdf.ts` (méthode absente ou en échec : seule la surveillance
  du RSS joue, testé). **À corriger par le lot documentation : `docs/workflows/RUNBOOK.md:10` (Node 20).**
- **Ancrage strict** : libellé normalisé complet exigé (préfixe admis seulement s'il est unique, d'au moins 12
  caractères et couvrant 80 % du libellé source) ; plusieurs lignes candidates → rejet `libelle_ambigu` et revue.
  Deux lignes de même libellé sur une page sont toujours rejetées (peut produire des revues sur de vrais états).
- **FIN-02 / amorçage** : `contientDonneeFinanciere` (nombre de 3 chiffres ou plus, monnaie) rejette la ligne à la
  lecture (`donnee_financiere`) et refuse la correction (400) ; le détail ne peut plus exposer de taux ni d'honoraires.
- **Masquage des noms (décision a)** : noms de clients, utilisateurs, contacts et missions connus du cabinet masqués
  avant envoi au modèle pour `standard_historique` seulement ; toute ligne qui recopie un nom masqué est écartée.
  Limites : noms complets seulement ; un nom ajouté par correction humaine n'est pas filtré ; `dd_rapport` et
  `dd_salle` ne sont PAS masqués (non demandé).
- **Conservation (décision b)** : texte des pages purgé à décision + 90 jours par le job `ingestion_maintenance`
  (03 h 45 UTC, par cabinet) ; la purge reprend aussi les effacements d'objets échoués (`effacerObjetsMarques`).
  `texte_purge_le` est exposé ; une page purgée répond 404 `TEXTE_PURGE`, une relance 409.
- **OCR (décision c)** : OCR local installé sur le serveur voulu par l'utilisateur : lot dédié après fusion ; ici
  seuls le port `Ocr` et l'adaptateur simulé existent.
- **Séparation des tâches** : le valideur n'est ni l'auteur du téléversement, ni le demandeur de la lecture, ni le
  dernier modificateur, sauf associé (API et déclencheur MQG02 ; colonnes `derniere_demande_par`, `demande_par`).
- `numeroPageParamsSchema` est `.strict()` ; le message « Fichier trop volumineux » est factorisé
  (`fichierTropVolumineux`, `ingestion/erreurs.ts`).
- **Seconde vérification (2026-10-22)** : masquage des noms sur TOUT le texte transmis (40 tranches de 200 mots
  distincts, 200 termes au plus ; `BORNES_NOMS_INGESTION`, le copilote garde 1 tranche) ; contrôle FIN-02 aussi sur
  les codes bruts (lecture IA et correction humaine : tout code de 3 chiffres ou plus est donc refusé, à assouplir
  si le métier veut des codes numérotés) ; détecteur étendu à franc(s), CHF, £ et aux mots de nombre (cent, mille,
  million, milliard ; heuristique, « cent pour cent » est un faux positif assumé, la barrière réelle reste la
  validation humaine) ; regex d'ancrage corrigée (`p{L}p{N}`) ; planification de la maintenance bornée à 30 jours
  après le marquage d'un fichier (`fichiers_suppressions` n'enregistre pas l'effacement) ; `.strict()` sur les
  paramètres de routes et la charge de `etat-financier.ts`.
- **Recherche n° 8 (2 lignes mineures, non corrigées)** : `pdf.ts:239` `Math.round` de la confiance OCR ;
  `erreurs.ts:29` `Math.floor` de la taille en Mo dans le message de dépassement.
- Dette restante : M5 (la structuration d'une relance agit avec les droits et le quota IA de l'auteur du document),
  M7 (téléversement DD en trois transactions), détail d'une extraction `lecture_document` de DD non masqué.

## À reporter dans les documents interdits au lot

- `SECURITY.md` : dette « fichier PDF non fiable parsé dans le processus de l'API (fil à mémoire plafonnée, pas de
  processus ni conteneur séparé) » ; texte des pages conservé en base (durée à décider) ; SQLSTATE `MQG01-03` ;
  plage `0521`–`0524` ; prochain numéro libre de la plage `0525`.
- `DECISIONS.md` : plafonds ci-dessus ; règle d'ancrage des montants lus par l'IA ; valeurs prudentes des briques
  proposées (R3, N1, inactive) ; FIN-02 sur le texte des documents d'amorçage.
- `HANDOFF.md` : D (ADR-009) livré ; DOS-03 (PDF), DD-02, DD-10, STD-13 livrés en mode simulé / sans OCR réel.
- `acc.config.json` / CI : aucun changement.

## Fichiers communs touchés (additif)

`apps/api/src/{app.ts,jobs/registre.ts,jobs/planificateur.ts,dossier/etats.ts}`, `apps/api/src/copilote/noms-propres.ts` (bornes paramétrables, copilote inchangé), `package.json` racine (`engines.node` >= 22), `.github/workflows/ci.yml` (Node 22), `apps/api/test/{jobs-registre,dd-acces}.test.ts`
(inventaires), `packages/{engines,shared}/src/index.ts`, `apps/web/src/lib/{dossier,due-diligence}.ts` (+ tests),
`apps/web/src/app/(app)/methodes/versions/[id]/page.tsx` (un lien), `apps/web/src/app/(app)/dossiers/[id]/finances/page.tsx` (carte d'import et liste), `apps/api/package.json` et `pnpm-lock.yaml`
(`unpdf` 1.8.1).
