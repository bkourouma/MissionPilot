# Notes du lot 11 — OCR local (2026-10-22)

Branche `orch/2026-10-20-reste-lot-11`. Décision de l'utilisateur (2026-10-22) : « OCR local installé sur le
serveur, jamais de service externe ». Décision d'architecture : [ADR-009](../../architecture/adr/ADR-009-ingestion-documents.md),
décision 16 et section « Décision OCR (lot 11) ». Les sections ci-dessous « Évaluation » et « Décision » sont
celles de l'expert du lot ; le chef de lot complète le reste (intégration dans la chaîne, isolation entre
cabinets, recette).

## Évaluation

### Options comparées

| Critère | (a) `tesseract.js` 7.0.0 (retenu) | (b) binaire `tesseract` 5.x en sous-processus | (c) PaddleOCR / `onnxruntime-node`, `ocrad.js`, `scribe.js` |
| ------- | --------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Licence | Apache-2.0 (moteur Tesseract Apache-2.0, données Apache-2.0) | Apache-2.0 | Paddle : Apache-2.0 (modèles), onnxruntime MIT ; `ocrad.js` GPL ; `scribe.js-ocr` AGPL-3.0 (incompatible) |
| Maintenance | active (6.0.0 janv. 2025, 7.0.0 déc. 2025) | active (5.5.x), paquets Debian/Ubuntu | onnxruntime actif ; `ocrad.js` abandonné (2014) |
| Supply chain | 1 dépendance directe, 12 transitives (13 paquets), **aucun binaire natif** (WebAssembly), un script `postinstall` (`opencollective-postinstall`, bandeau publicitaire) **bloqué** par pnpm 10 (`onlyBuiltDependencies` du dépôt ne le liste pas) | aucune dépendance npm ; binaire C++ + Leptonica + libpng/jpeg/tiff/webp/openjp2 installés par le système | addon natif (`.node`) de ~100 Mo+, téléchargement de modèles, `--allow-addons` requis |
| Isolation | sous-processus Node, environnement vide, `--permission`, garde réseau, veille RSS : **mesurable et testé ici** | sous-processus natif : environnement vide et délais possibles, pas de garde réseau Node ; `prlimit`/seccomp à monter côté serveur | addon dans le processus Node (pas de frontière mémoire) |
| Hors ligne | oui avec `langPath` local, `cacheMethod: "none"`, `gzip: false` ; sans `langPath` il irait sur jsDelivr : le garde le refuse (testé) | oui | oui une fois les modèles livrés |
| Qualité sur états financiers | mesurée ci-dessous : 100 % des montants sur scan net, dégradé et anglais | même moteur (LSTM), un peu plus rapide (SIMD natif, OpenMP) ; non mesurable ici | Paddle meilleur sur mises en page complexes ; non mesuré |
| Portabilité | identique Windows / Linux (WebAssembly), Node >= 22 | absent de cette machine Windows ; prérequis serveur `tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng` | binaires par plateforme |
| Taille | `tesseract.js` 1,4 Mo + `tesseract.js-core` 45 Mo décompressés (6 variantes WebAssembly, une seule chargée) + 5,2 Mo de données vendorées | ~30 Mo de paquets système | > 200 Mo |

Conclusion : (a) est la seule option à la fois sans binaire natif, entièrement mesurable et testable dans le
dépôt, identique en développement (Windows) et en production (Linux), et isolable par les mécanismes de Node. (b)
reste une alternative de performance derrière le même port (un adaptateur `OcrBinaire` pourrait réutiliser le
sous-processus, le garde et les bornes) mais impose un prérequis système et une surface native ; non retenue. (c)
écarté (addon natif, taille, licences).

### Âge et intégrité des paquets (règle des 2 semaines)

Installé par `pnpm --filter @missionpilot/api add tesseract.js@7.0.0 --save-exact --config.minimumReleaseAge=20160`
(14 jours) : `tesseract.js` 7.0.0 (2025-12-15), `tesseract.js-core` 7.0.0 (2025-12-15), `bmp-js` 0.1.0 (2018),
`idb-keyval` 6.3.0 (2026-07-08), `is-url` 1.2.4 (2018), `node-fetch` 2.7.0 (2023), `whatwg-url` 5.0.0, `tr46` 0.0.3,
`webidl-conversions` 3.0.1 (anciens), `opencollective-postinstall` 2.0.3 (2020), `regenerator-runtime` 0.13.11,
`wasm-feature-detect` 1.9.0 (2026-08-11), `zlibjs` 0.3.1 (2017) : tous de plus de deux semaines. Le lockfile n'ajoute
que ces 13 paquets (92 lignes ; des champs `libc:` que pnpm avait ajoutés à des paquets existants ont été retirés pour
garder un diff limité à la dépendance). `node-fetch`, `idb-keyval`, `is-url` ne servent qu'aux chemins réseau ou
navigateur de tesseract.js, jamais empruntés ici (le garde le prouve).

Données de langue : `tessdata_fast` étiquette `4.1.0` (commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`),
`fra.traineddata` (1 130 365 o, SHA-256 `ced03756…3445ca`) et `eng.traineddata` (4 113 088 o, SHA-256
`7d4322bd…7170b2`) ; SHA-1 de blob identiques à l'arbre GitHub du commit. `tessdata_best` (même étiquette, commit
`e2aad9b983032bb1beff9133104a67cdbb87ca4d`) téléchargé pour comparaison seulement, non vendoré (19,4 Mo).

### Mesures (2026-10-22, Node 24.12, Windows 11, poste partagé avec d'autres agents)

Commande : `cd apps/api && npx tsx test/ocr-evaluation.ts [--matrice] [--repetitions n] [--donnees <dossier>]
[--langues fra] [--texte]` (aucune base, aucun réseau). Durée = document d'UNE page de bout en bout (sous-processus,
pdf.js, moteur et page), meilleure de n répétitions ; RSS = pic du sous-processus ; « montants » et « lignes » :
`test/ocr-evaluation-mesures.ts` (montant écrit exactement comme sur le document, sur la ligne du poste ; ligne =
libellé exact, espaces, montant exact).

Première passe (données fast, une répétition) : {fra, fra+eng} x PSM {3, 4, 6} x échelle {1, auto}, binarisation,
sans `preserve_interword_spaces`. Constats :

- **PSM 6** perd la ligne « BZ Total actif » du scan dégradé et, avec l'agrandissement, lit « 900,000 » pour
  « 500,000 » (état anglais) : écarté. **PSM 3 et 4** : 12/12, 12/12, 9/9, 11/12 avec agrandissement ; PSM 4
  mêlerait deux colonnes de texte (rapports) : **PSM 3 retenu**.
- **Agrandissement automatique** (scan < 200 dpi vers 300 dpi) : police difficile 11/12 au lieu de 9/12, état anglais
  9/9 au lieu de 8/9, dégradé 12/12 lignes au lieu de 11/12 ; mais sur une page blanche à grain, Tesseract « lisait »
  60 caractères de bruit (confiance 17-20 %) et y passait jusqu'à 11 s. D'où deux réglages : **page sans encre non
  soumise au moteur** (moins de 0,005 % de pixels plus sombres que le fond de 80 niveaux : la page blanche n'en a
  aucun, les états 1,7 à 2,8 %) et **lignes de confiance < 50 % écartées** (bruit 10-30 %, lignes lisibles 85-97 %).
- **Binarisation Otsu** : aucun gain, une ligne perdue sur la police difficile : écartée.
- **Sans `preserve_interword_spaces`** : mêmes montants, mais les colonnes ne sont plus séparées que par un espace :
  réglage conservé (la chaîne aval lit « libellé [espaces] montant »).

Seconde passe (fast, deux répétitions ; durées bruitées par d'autres processus du poste) :

| Réglage | net (200 dpi) | dégradé (150 dpi) | anglais (150 dpi) | police difficile | page blanche | durée 1 page | RSS pic |
| ------- | ------------- | ----------------- | ----------------- | ---------------- | ------------ | ------------ | ------- |
| `fra` PSM 3 auto | 12/12 m, 12/12 l | 12/12, 12/12 | 9/9, 9/9 | 11/12, 11/12 | 0 car. | 1,0-3,0 s | 132-214 Mo |
| **`fra+eng` PSM 3 auto (retenu)** | 12/12, 11/12 | 12/12, 12/12 | 9/9, 9/9 | 11/12, 11/12 | 0 car. | 1,4-4,5 s | 145-232 Mo |
| `fra+eng` PSM 4 auto | 12/12, 11/12 | 12/12, 12/12 | 9/9, 9/9 | 11/12, 11/12 | 0 car. | 1,2-4,3 s | 143-233 Mo |
| `fra+eng` PSM 6 auto | 12/12, 11/12 | 11/12, 11/12 | 8/9, 8/9 | 11/12, 11/12 | 0 car. | 1,2-4,1 s | 146-216 Mo |
| `fra+eng` PSM 3 échelle 1 | 12/12, 11/12 | 12/12, 11/12 | 8/9, 8/9 | 9/12, 9/12 | 0 car. | 1,4-2,8 s | 149-217 Mo |
| `fra+eng` PSM 3 auto + Otsu | 12/12, 12/12 | 12/12, 12/12 | 9/9, 9/9 | 10/12, 9/12 | 0 car. | 1,5-4,2 s | 150-218 Mo |

(m = montants exacts, l = lignes exactes.) Confiance de page : 918 à 951 ‰ sur les états, 0 sur la page blanche. La
seule ligne inexacte du scan net avec `fra+eng` est un accent (« financiéres ») ; le seul montant manqué de la police
difficile est « 1700 000 » (espace des milliers perdu), que la tolérance aux confusions de l'intégration peut signaler.

Documents de 30 pages (`fra` / `fra+eng`, PSM 3 auto) : scans à 150 dpi agrandis 58 s / 66 s, scans à 200 dpi
70 s / 71 s ; RSS du sous-processus 236-256 Mo, stable d'une page à l'autre. Surcoût de `eng` : 3 à 14 % :
**`fra+eng` retenu** (documents anglais de la due diligence), le français d'abord.

**tessdata_best** (fra 3,97 Mo + eng 15,4 Mo, modèles flottants) : le cœur `tesseract.js-core` 7.0.0 avorte au
chargement (`Aborted(missing function: _ZN9tesseract13DotProductSSEEPKfS1_i)` : build WebAssembly sans le produit
scalaire flottant) ; l'adaptateur rend `OCR_ECHEC` proprement. Non viable avec ce moteur ; « fast » (modèles entiers)
retenu, d'autant qu'il atteint 100 % des montants sur les scans nets et que sa taille (5,2 Mo) tient sous ~10 Mo.

PDF hostiles (`fabriquerPdfScanHostile`, plafonds par défaut) :

| Cas | Issue | Durée | RSS pic du sous-processus | RSS de l'API |
| --- | ----- | ----- | ------------------------- | ------------ |
| `image_geante` (40 000 x 40 000, 1 bit) | `IMAGE_TROP_GRANDE` (retirée par `maxImageSize` avant décodage, détectée) | 0,8 s | 143 Mo | +12 Mo |
| `image_geante_rgb` (12 000 x 12 000 RGB) | `IMAGE_TROP_GRANDE` | 0,8 s | 143 Mo | +0 Mo |
| `dimensions_mensongeres` (100 x 100 annoncés, JPEG 1240 x 1754) | texte vide (pdf.js ramène l'image à 100 x 100 : vignette) ; plafond de 1 Mpx : `IMAGE_TROP_GRANDE` par l'en-tête JPEG | 0,9 s | 154 Mo | +1 Mo |
| `beaucoup_d_images` (200 images 8 x 8) | texte vide, confiance 0 | 0,9 s | 141 Mo | +1 Mo |
| `flux_tronque` (JPEG coupé) | texte vide (pdf.js ne décode pas l'image) | 0,7 s | 135 Mo | +0 Mo |

La vérification de secours sur les dimensions DÉCODÉES (`ocr-processus.mjs`) n'a pas pu être déclenchée par ces
fichiers (pdf.js ramène une image JPEG menteuse aux dimensions déclarées) : elle reste une défense non éprouvée.

### Modèle de permissions de Node

`node --permission --allow-worker --allow-fs-read=<script> --allow-fs-read=<données> --allow-fs-read=<node_modules…>`
fonctionne avec tesseract.js et unpdf sous Node 24.12 (la résolution pnpm lit le lien `apps/api/node_modules/` ET le
magasin `node_modules/.pnpm/`, d'où l'ouverture en lecture des dossiers `node_modules` parcourus, plus
`apps/api/package.json`). Vérifié par test : `fs.write` et `child` refusés, lecture du `package.json` racine refusée
(`ERR_ACCESS_DENIED`). Node 22 : `--permission` existe à partir de 22.13 (`--experimental-permission` avant, non
utilisé) ; NON vérifié sur ce poste (pas de Node 22) : la CI Node 22 l'éprouvera. Le modèle ne filtre pas le réseau
avant Node 25 (`--allow-net`) : c'est le rôle du garde. `--allow-worker` affiche un avertissement de sécurité (ignoré :
stderr du sous-processus non lu).

`--import` ne s'applique pas aux `worker_threads` (vérifié sous Node 24.12 : seul `--require` y est rejoué) : le
garde réseau est donc un module CommonJS chargé par `--require`. Sous Windows, `env: {}` donne quand même à l'enfant
les 11 variables système que libuv recopie d'office (`PATH`, `SYSTEMROOT`, `TEMP`, `USERNAME`…), aucune n'étant un
secret de l'API ; sous Linux l'environnement est vide.

## Décision

1. **Moteur** : `tesseract.js` 7.0.0 (une seule dépendance ajoutée à `apps/api`, version exacte), données
   `tessdata_fast` 4.1.0 `fra` + `eng` vendorées dans `apps/api/ocr-data/` avec `SHA256SUMS`, `LICENSE`, `README.md`
   et `.gitattributes` (binaires). Vérification : `node scripts/ocr-verifier-donnees.cjs` (Node pur, sans réseau) et
   au premier usage par l'adaptateur (mise en cache ; empreinte fausse = moteur indisponible, sans bruit).
2. **Adaptateur** `OcrLocal` (`apps/api/src/ingestion/ocr-local.ts`, `fournisseur: "tesseract.js"`,
   `mode: "local"`) : un sous-processus par document (`ocr-processus.mjs`), garde réseau (`ocr-garde-reseau.cjs`,
   `--require`), veille (`ocr-veille.mjs`), modèle de permissions quand il existe, environnement vide,
   `--max-old-space-size=256`, `--no-addons`, RSS <= 768 Mo, 60 s par étape, `PLAFONDS_OCR.dureeMs` au total, une
   reconnaissance à la fois par processus d'API (file de 8 ; au-delà `OCR_ECHEC`, inatteignable par la file `jobs`
   qui traite un job à la fois par processus).
3. **Réglages** : `fra+eng`, PSM 3, `preserve_interword_spaces`, agrandissement des scans < 200 dpi vers 300 dpi
   (réduction au-delà de 450 dpi), pages sans encre non soumises, lignes < 50 % écartées, 6 images par page, côté
   minimal 100 px. Confiance de page = moyenne des confiances des lignes retenues pondérée par leur longueur, x 10.
4. **`PLAFONDS_OCR` inchangés** (30 pages, 240 s, 20 Mpx, 6 images) : 30 pages tiennent en 58-71 s ici, marge de
   3,4 à 4 pour un serveur plus lent.
5. **Fabrique** (`creerOcr`, `OCR_LOCAL` = `auto` | `local` | `simule` | `off`, ajouté à `config.ts`, additif) :
   local s'il est disponible, en production comme en développement ; en test (`NODE_ENV=test`), simulé par défaut
   (les tests existants et le conteneur `%MPOCRSIM1:` restent valables), local si `OCR_LOCAL=local` ou par
   `new OcrLocal()` ; simulé seulement en développement et test ; null sinon.
6. **Tests** : `apps/api/test/ocr-moteur.test.ts` (21 tests, ~25 s de moteur, sans base) ; les tests du moteur réel
   sont sautés AVEC message si le moteur manque, et `OCR_LOCAL_EXIGE=1` (à poser en CI) les rend obligatoires.

### Mettre à jour le moteur ou les données

- Moteur : changer la version exacte dans `apps/api/package.json` (âge >= 2 semaines,
  `--config.minimumReleaseAge=20160`), mettre à jour `VERSION_MOTEUR_OCR` (`ocr-local.ts`, sinon l'OCR se
  désactive), relire `tesseract.js/src/worker-script` (chargement des langues, `fetch`) et `src/worker/node`
  (création du worker), relancer `test/ocr-moteur` et `test/ocr-evaluation.ts`.
- Données : `apps/api/ocr-data/README.md` (commit officiel, SHA-1 de blob, `SHA256SUMS`, script de vérification).

## À reporter dans les documents interdits au lot (chef de lot ou superviseur)

- `SECURITY.md` (§ 8, ingestion) : dette « moteur OCR WebAssembly et pdf.js exécutés sur un fichier non fiable dans
  un sous-processus Node sans conteneur ni seccomp » ; mémoire hors tas bornée seulement par la veille du RSS
  (768 Mo, réactive) ; garde réseau applicatif = défense en profondeur, un pare-feu sortant reste à poser sur le
  serveur ; modèle de permissions actif seulement à partir de Node 22.13 ; empreintes `SHA256SUMS` des données de
  langue vérifiées au premier usage ; environnement du sous-processus vide.
- `RUNBOOK.md` : aucun prérequis système (pas de binaire `tesseract`) ; `OCR_LOCAL` (`auto` par défaut, `off` pour
  couper) ; `node scripts/ocr-verifier-donnees.cjs` ; `tesseract.js-core` ajoute ~45 Mo à `node_modules`, les
  données 5,2 Mo au dépôt ; Node >= 22.13 recommandé (modèle de permissions).
- `DECISIONS.md` : réglages OCR et seuils (PSM 3, `fra+eng`, 200/300/450 dpi, confiance de ligne 50 %, page sans
  encre 0,005 %), `LIMITES_OCR_LOCAL` (256 Mo de tas, 768 Mo de RSS, 60 s par étape), file de 8.
- `.env.example` : documenter `OCR_LOCAL` (hors du périmètre attribué, non modifié).
- CI : poser `OCR_LOCAL_EXIGE=1` sur le job des tests API (Node 22) pour rendre les tests du moteur obligatoires.
- `apps/api/test/ingestion-pdf.test.ts` (fichier de l'exécutant d'intégration) : le test « aucun OCR en production,
  l'OCR simulé hors production » (l. 504-507) suppose l'ancien `creerOcr` ; avec le moteur disponible, production et
  développement donnent désormais `OcrLocal`. À réécrire avec l'option `{ disponible: () => false }` (ou `true`) de
  `creerOcr`, comme dans `ocr-moteur.test.ts`.

## Intégration, corrections proposées et tests (chef de lot)

- **Chaîne** (`pdf.ts`, `job-extraction.ts`) : méthode `ocr` (adaptateur `mode: "local"`) ou `ocr_simule`, pour le document
  et chaque page, avec la confiance 0 à 1000. Un scan sans OCR branché échoue `OCR_INDISPONIBLE` (libellé explicite,
  affiché au détail du document) ; `PDF_SANS_TEXTE` = l'OCR a tourné et rien lu. Pré-contrôle de bombe de flux AVANT
  l'OCR. Texte natif : délai de 30 s sous le sémaphore des extractions ; OCR : phase séparée HORS sémaphore, délai de
  secours `PLAFONDS_OCR.dureeMs` + 10 s (`DELAI_DEPASSE`) ; plus de 30 pages scannées : `PLAFOND_PAGES` sans appel au
  moteur ; exception inattendue de l'adaptateur : `OCR_ECHEC`. Limite : un PDF mêlant pages natives et pages scannées
  est lu par sa seule couche texte (pas d'OCR des pages vides).
- **Transaction ouverte pendant l'OCR** : `extrairePagesPdf` tourne dans la transaction du job (ligne du document
  verrouillée, une connexion du pool retenue) : au pire 30 s + 240 s + 10 s, sous le délai de blocage des jobs (15 min).
  Dette acceptée, non restructurée.
- **Corrections proposées** (`packages/engines/src/ingestion/ocr-confusions.ts`, migration `0525`,
  colonne `ingestion_documents.corrections_ocr`) : confusions O/0, l/I/1, séparateurs ; sert UNIQUEMENT à proposer
  (la ligne reste hors de l'état, qui part en revue), plafonnées à 100, validées par `correctionOcrSchema`. Faux positifs
  possibles (libellé terminé par un mot numérique) ; un nombre de 3 caractères ou moins avec lettre n'est jamais proposé.
- **Marquage** : `reference` d'une ligne lue par OCR = `{ fichier, page, ocr: true, confiance_pm }`
  (`referenceValeurSchema` étendu, additif). Détail d'état : `ingestion { document_id, methode, corrections_ocr }`.
  Web : alerte « lu par reconnaissance de caractères », marqueur « lu par OCR : à vérifier (confiance de la page : n %) »
  sous chaque montant, carte « Corrections proposées », confiance par page pour `ocr`.
- **Tests** : moteur (`ocr-moteur.test.ts`, 21), chaîne réelle (`ingestion-ocr-reel.test.ts`, 6), isolation entre cabinets,
  plafonds, indisponibilité, hostiles, aucun socket dans le processus de test, journal sans contenu
  (`ingestion-ocr-isolation.test.ts`, 14), intégration avec adaptateur factice (17), corrections (14 + 33 engines).
  Tous les tests du moteur réel sont conditionnels AVEC message ; `OCR_LOCAL_EXIGE=1` les rend obligatoires.

### Hypothèses métier appliquées

- Une page est « lue par OCR » d'après sa méthode, page par page ; tout état d'un document `ocr`/`ocr_simule` est traité
  comme lu par OCR côté web (option la plus prudente).
- Aucune correction proposée en cas de doute (plusieurs lettres confondables dans un mot, lettre isolée ambiguë).
- Jeu de test : état inventé qui s'équilibre (total 16 550 000), police système, texte sans donnée réelle.
- Textes web : « Un PDF scanné est lu par OCR sur le serveur… 30 pages au plus » (`PLAFONDS_OCR.pagesMax`).

### Fichiers communs touchés (additif)

`apps/api/src/config.ts` (variable `OCR_LOCAL`), `apps/api/src/dossier/etats.ts` (champ `ingestion` du détail d'état),
`packages/shared/src/schemas/dossier.ts` (`referenceValeurSchema` : `ocr`, `confiance_pm`), `packages/shared`
`schemas/ingestion.ts`, `pnpm-lock.yaml`, `apps/api/package.json` (`tesseract.js` 7.0.0).

### Reste à reporter / décider

- `HANDOFF.md` : OCR local livré (lot 11) ; prochain numéro de migration libre de la plage : `0526`.
- `.env.example` : `OCR_LOCAL`. CI : `OCR_LOCAL_EXIGE=1` sur le job API (Node 22) ; l'effet de `--permission` sous Node 22
  n'est vérifié que par cette CI.
- Qualité sur de vraies liasses SYSCOHADA scannées, JPX/CCITT/JBIG2 : non mesurée.

## Correctifs de vérification : permissions Node

- **Node 22.0 à 22.12 sans aucune restriction** (constat moyen) : le modèle de permissions n'existe sous `--permission`
  qu'à partir de Node 22.13. `engines.node` du `package.json` racine passe à `>=22.13`. `permissionNodeDisponible()`
  exige désormais la version (`versionNodeAvecPermission`) ET le drapeau. En **production** (tout `NODE_ENV` autre
  que `development`/`test`, staging compris : option la plus prudente), sans modèle de permissions, l'adaptateur est
  indisponible : `diagnosticOcrLocal` rend `permissions`, `creerOcr` rend `null` et un scan échoue
  `OCR_INDISPONIBLE` (libellé existant ; un libellé « Node 22.13 minimum requis » demanderait de toucher
  `packages/shared`, non fait). `OcrLocal.reconnaitre` refuse aussi, avant la file et tout sous-processus
  (`permission: "non"` compris). Hors production : toléré, avec UN `console.warn` par processus, sans contenu.
  `production` est une option injectable (défaut : `NODE_ENV` lu à chaque appel, comme `loadConfig`) ; `fabrique.ts`
  n'a pas changé (hors périmètre), il s'appuie sur ce défaut.
- **Faille trouvée en écrivant le test « droits de lecture insuffisants »** : sous Node 24.12 (Windows), un
  `worker_thread` créé sous `--permission` LIT le dossier courant du processus et ses sous-dossiers hors
  `--allow-fs-read` (le fil principal, lui, est refusé ; pas le parent, pas d'écriture). Le sous-processus héritait
  du dossier courant de l'API (`apps/api`, ou la racine de l'application en production, où peut se trouver un
  `.env`) : le worker de tesseract.js pouvait y lire. Correctif : `fork(..., { cwd: dossier du script })`, dossier
  déjà lisible. Le test « droits de lecture insuffisants » échouait avant le correctif (les données sous
  `apps/api/ocr-data/` étaient lues malgré leur retrait de `--allow-fs-read`). Comportement non mesuré sous Linux ni
  sous Node 22 : le correctif s'applique partout.
- **`--allow-fs-read` d'un dossier** : chaque dossier est passé sous sa forme exacte ET avec séparateur final
  (`lecturesDossier`), jamais avec joker. Mesuré sous Node 24.12 : les deux formes (et `dossier/*`) ouvrent le dossier
  et ses sous-dossiers, jamais le parent ni un voisin de préfixe commun (`node_modules2`) ; `node_modules*` ouvrirait
  les voisins (non utilisé). Node résout le chemin et ajoute lui-même `<séparateur>*` pour un dossier. **La CI Node 22
  en est le juge** : si une version ne couvrait pas un dossier, l'OCR échoue FERMÉ (`OCR_ECHEC`), jamais ouvert ;
  prouvé par le test `sansLectureDonnees` (données hors périmètre : `OCR_ECHEC`, lecture refusée, aucune tentative
  réseau, sous-processus mort) et par la lecture refusée du `package.json` racine.
- **CI** : `OCR_LOCAL_EXIGE: "1"` posé dans le bloc `env` du job `api`. Le test des permissions n'est plus sauté en
  silence : sauté AVEC message si `--permission` manque, et le test « modèle de permissions de Node exigé en CI »
  échoue explicitement avec `OCR_LOCAL_EXIGE=1`.
- **Tests ajoutés** (`ocr-moteur.test.ts`) : version porteuse de `--permission` ; production sans permissions
  (indisponible, aucun sous-processus, port null) ; production déduite de `NODE_ENV` (staging compris) ; développement
  sans permissions (disponible, un seul avertissement, journal en panne sans effet) ; production avec permissions
  (disponible, sonde en panne = absente) ; arguments `--allow-fs-read` ; droits de lecture insuffisants.
- **À reporter : RUNBOOK/ADR/CI — Node >= 22.13 requis en production (OCR refusé sinon).** ADR-009 (décision 16 et
  « Décision OCR ») mis à jour ; RUNBOOK (« Node >= 22.13 recommandé » devient « requis en production ») et
  SECURITY (dossier courant des workers sous `--permission`) restent à reporter par le chef de lot.

## Correctifs de vérification : garde réseau, purge, limites (chef de lot)

- **Garde réseau et workers** (`ocr-garde-reseau.cjs`, tests `ocr-garde.test.ts`, 8) : un `new Worker(…, { execArgv: [] })`
  (avec ou sans `eval`) perdait le `--require` du garde, mais aussi `--permission` (lecture de fichiers hors périmètre,
  `process.binding`). Le garde remplace désormais `worker_threads.Worker` (`require`, `node:`, `getBuiltinModule`,
  `import`) par un enveloppant qui IGNORE l'`execArgv` de l'appelant et impose l'héritage des options du fil parent
  (garde, permissions, `--no-addons`) ; chargé sans `--require`, il refuse toute création de worker. Le compteur de
  tentatives agrège les workers. Vecteurs bloqués ET comptés dans 10 fils (principal, workers `execArgv: []`, `eval`,
  `--expose-internals`, imbriqué…) : net, tls, fetch, WebSocket, dns (lookup, Resolver), dgram (y compris `Socket.send`),
  http(s), `http.Agent`, `ClientRequest`, http2, cluster, child_process, `import()` ESM, `process.binding`, `dlopen`,
  `v8.setFlagsFromString`, inspecteur. Limite : défense dans le processus, sans effet sur une faille native ou WASM ;
  le pare-feu sortant du serveur reste nécessaire.
- **Purge des corrections** (migration `0526_ingestion_purge_corrections_ocr.sql`) : `corrections_ocr` suit la rétention du
  texte des pages (décision + 90 jours). La fonction `purger_textes_ingestion` est redéfinie à l'identique de 0524
  (SECURITY DEFINER, `search_path` figé, droits) plus `corrections_ocr = NULL` ; le déclencheur `controler_ingestion_document`
  est redéfini à l'identique de 0521 sauf la branche de datation de la purge (exclut `corrections_ocr` de la comparaison et
  exige qu'elle soit NULL ; annuler seules les corrections reste refusé `MQG01`). Test `ingestion-purge-ocr.test.ts`
  (10 : 89 j rien, 91 j purgé, brouillon ouvert et état en revue jamais, isolation, droits). **Plage de migrations :
  `0525`-`0526` utilisées, prochain numéro libre `0527`.**
- **Limites mesurées par le vérificateur (à connaître)** : 30 pages x 3 images = 124 s (sous les 240 s) ; une page à 60 images
  décodées donne `OCR_ECHEC` (code stable) ; un scan A4 à 600 dpi (≈ 35 Mpx) est refusé `IMAGE_TROP_GRANDE` (plafond de 20 Mpx
  par image : refaire le scan à 300-400 dpi). Un scan négatif est vu comme une page sans encre.
