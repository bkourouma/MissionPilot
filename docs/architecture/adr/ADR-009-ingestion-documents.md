# ADR-009 : Ingestion de documents et OCR (DOS-03, DD-02, DD-10, STD-13)

## Statut

Acceptée (décision technique du superviseur). Mode LOCAL : aucun service externe de lecture documentaire ni d'OCR.
OCR réel LOCAL livré au lot 11 (décision 16 : tesseract.js en sous-processus isolé, hors ligne).

## Date

2026-10-21

## Contexte

Le PRD complémentaire demande l'ingestion des états financiers du client « PDF, Excel, liasse SYSCOHADA : extraction
IA avec référence de page, contrôles d'équilibre par moteur (actif = passif, résultat cohérent) ; acceptation
automatique si tous les contrôles passent, sinon revue » (DOS-03, §5), l'import de rapports PDF dans la due diligence
(DD-02), la lecture IA de la salle de données (DD-10) et l'amorçage du standard « à partir de propositions et de
rapports historiques » (STD-13, §4.6). L'ADR-009 était citée par plusieurs spécifications (SPEC-3b §8.12, AO-03) mais
n'avait jamais été écrite : ces exigences étaient repoussées.

Constats sur le code (vérifiés le 2026-10-21) :

- Les contrôles d'équilibre d'un état existent déjà : `controlerEtatFinancier`
  (`packages/engines/src/dossier/etat-financier.ts`), l'ingestion `ingererEtat` et la revue
  (`apps/api/src/dossier/etats.ts`), les imports CSV et Excel (`import-etats.ts`, `temps/import-excel.ts`). La
  référence d'une valeur sait déjà citer une `page` (`referenceValeurSchema`). Manquent : la lecture d'un PDF, l'OCR,
  l'extraction structurée et son raccordement.
- Les fichiers sont déjà filtrés par le contenu (`stockage/detection.ts` : PDF sans JavaScript, lanceur, fichier
  embarqué ni XFA ; XLSX sans macro ni objet embarqué). Aucune bibliothèque de lecture de PDF n'est présente.
- L'import Excel analyse le fichier « sans jamais le conserver » (`dossier_etats_financiers.fichier_*`) ; la purge des
  fichiers orphelins (`fichier_orphelin`) efface tout fichier qu'aucune table ne cite après 24 h.
- L'orchestrateur IA (`ia/orchestrateur.ts`, ADR-003) est le seul chemin vers le fournisseur : prompts versionnés,
  contenu client neutralisé (AGT-07), masquage, plafonds, garde-chiffres, trace. La file de tâches est la table
  `jobs` (ADR-002). Le modèle des canaux simulés (ADR-008, ADR-013 : port + fournisseur simulé + job + brouillon à
  relire) est le précédent à suivre.
- Contraintes transverses : isolation entre cabinets (RLS), chiffres calculés par un moteur testé jamais par le
  modèle de langage, validation humaine des contenus IA, contenus clients non fiables, données du portail fermées par
  défaut, FIN-02 (coût IA invisible sans `finance.lire`), interface en français.

## Décision

1. **Chaîne d'ingestion locale, en deux jobs de la file `jobs`.** `POST` d'un document (PDF ou XLSX) : le fichier est
   contrôlé par le contenu (`detecterType`), enregistré (`enregistrerFichier`, quota du cabinet) et une ligne
   `ingestion_documents` naît dans la MÊME transaction, avec le job `ingestion_extraction` ; la route répond 202.
   `ingestion_extraction` lit le texte de chaque page et l'inscrit (`ingestion_pages`, ajout seul), puis met en file
   `ingestion_structuration` qui structure selon l'usage (états financiers, lecture d'un document, proposition de
   standard) et conclut. Les deux jobs sont repris après une panne passagère ; une erreur définitive donne le statut
   `echec` avec un code d'erreur sans contenu.
2. **Texte des PDF à couche texte : `unpdf` 1.8.1** (version exacte, MIT, SANS aucune dépendance : paquet de
   distribution « serverless » de pdf.js de Mozilla, sans binaire, sans réseau, sans `@napi-rs/canvas` — pair
   optionnel jamais installé, jamais nécessaire à l'extraction de texte). pdf.js est maintenu activement et lit les
   PDF courants (polices intégrées, flux compressés). Une seule dépendance ajoutée à `apps/api`. Le pdf.js
   embarqué n'a aucun chemin d'évaluation de code, aucune police ni ressource distante n'est chargée, aucun rendu
   n'est fait. **L'extraction tourne dans un `worker_thread`** (`pdf-worker.mjs`) à mémoire plafonnée
   (`resourceLimits`) et terminé à l'échéance : un PDF piégé (flux compressé qui se décompresse en centaines de Mo)
   ne peut pas faire tomber le processus de l'API ; le worker lit page par page et abandonne dès qu'un plafond est
   franchi (revue de sécurité du 2026-10-21, constat C1).
3. **Excel par la bibliothèque déjà présente** : `exceljs` via le lecteur borné `temps/import-excel.ts`
   (`lireClasseurTemps` : taille, archive, macros, liens externes, cellules, formules jamais évaluées). Première
   feuille visible seulement ; chaque ligne devient une ligne de texte ; la « page » est la feuille et la référence
   d'une valeur est sa ligne et sa cellule (`reference.cellule`), comme l'import Excel existant. Un classeur au
   gabarit à colonnes fixes (`section`, `code`, `libelle`, `montant`) continue de passer par
   `POST /api/dossiers/:id/etats-financiers/excel`, inchangé.
4. **OCR local derrière un port** `Ocr` (`apps/api/src/ingestion/ocr.ts`) : `reconnaitre({pdf, pages})` rend
   `{numero, texte, confiance_pm}` par page ; il déclare `fournisseur` et `mode` (`"simule"` ou `"local"`). Deux
   adaptateurs : **`OcrLocal`** (décision 16, moteur réel tesseract.js hors ligne, `mode: "local"`) et `OcrSimule`,
   disponible hors production (développement, test), qui ne lit qu'un conteneur de test (marqueur `%MPOCRSIM1:`
   suivi d'une charge JSON en base64 dans le PDF) et refuse tout autre document (`OCR_NON_SIMULE`). Choix par
   `creerOcr` (`ingestion/fabrique.ts`) : le moteur local dès qu'il est disponible (moteur, données et empreintes
   vérifiés, Node suffisant), sinon le simulé en développement et en test, sinon aucun ; en test, le simulé reste le
   défaut et le local se demande (`OCR_LOCAL=local`). Sans moteur hors développement, une page sans couche texte
   échoue sans OCR et aucun état n'est créé. Une page reconnue par OCR porte une confiance ; un état financier issu
   d'une page reconnue par OCR n'est JAMAIS accepté automatiquement. *(Avant le lot 11 : aucun moteur réel, voir
   « Décision OCR (lot 11) » plus bas pour l'évaluation qui a levé l'objection « tesseract.js télécharge ses données
   depuis un CDN » : avec un chemin de données local, il ne télécharge rien, ce que prouve un garde réseau testé.)*
5. **Plafonds** (valeurs provisoires, `PLAFONDS_INGESTION` dans `packages/shared`) : fichier 10 Mo (PDF), 2 Mo (XLSX,
   plafond du lecteur existant) ; 60 pages (PDF) ; 25 000 caractères par page et 400 000 par document (le texte
   excédentaire est refusé, jamais tronqué en silence : `PLAFOND_PAGES`, `PLAFOND_TEXTE`) ; durée d'extraction 30 s
   (`DELAI_DEPASSE`, pas de reprise) ; deux extractions simultanées par processus ; 5 documents en traitement et 40
   créations par jour et par cabinet ; texte transmis au modèle : 40 000 caractères au plus, les pages utiles d'abord
   (le reste est signalé « tronqué »).
6. **Sécurité de l'ingestion.** Le type est décidé par le contenu (jamais l'extension ni l'en-tête) ; un PDF actif est
   déjà refusé par `detection.ts` ; le contenu n'est jamais exécuté ni rendu (texte seulement) ; le document est
   analysé puis son objet de stockage est EFFACÉ (`fichiers_suppressions`, motif `retire`), comme l'import Excel :
   aucune clé étrangère vers `fichiers`, donc `fichier_orphelin` n'est pas modifiée. Le texte extrait est un contenu
   CLIENT NON FIABLE (AGT-07) : il n'entre dans un prompt que par une variable déclarée non fiable (masquée,
   neutralisée, encadrée par l'orchestrateur), jamais dans les consignes ; les signaux d'injection sont relevés ; la
   sortie du modèle ne déclenche aucune action. Isolation : toutes les tables ont RLS (`isolation`) et
   `portail_interdit` ; les routes exigent la permission de leur domaine AVANT tout accès aux données, puis la
   visibilité du dossier client, de la mission ou du brouillon de méthode (404 sinon, y compris pour un autre
   cabinet) ; aucune route n'est dans `LISTE_BLANCHE_PORTAIL` (403 pour un compte du portail). Le journal d'audit ne
   contient ni texte ni extrait ni montant.
7. **Extraction structurée par l'IA, brouillon avec référence de page.** L'appel passe par `genererContenu`
   (tâche `extraction`, prompts `ingestion_*` posés par `ingestion/prompts.ts`, la même méthode que
   `appels-offres.ts`). Le modèle propose des LIGNES DE TEXTE « page | … » ; le code les relit, les borne et les
   rattache. Sans IA (désactivée, sans clé, plafond atteint, sortie inexploitable) : pour un état financier, des
   règles déterministes sur le texte (moteur pur, mises en revue) ; pour une lecture ou une proposition, le document
   reste `ia_indisponible`, relançable, et rien n'est inventé.
8. **Les chiffres ne viennent jamais du modèle (DOS-03).** Un montant n'est retenu que s'il se retrouve, lu
   exactement, sur une ligne de la page citée qui porte le libellé du poste, comme premier montant de la ligne
   (colonne de l'exercice N ; ancrage de ligne, vérification de source par le moteur) ; sinon la ligne est rejetée et
   l'état part en revue. Les additions, l'équilibre actif = passif et la cohérence du résultat sont ceux de
   `controlerEtatFinancier`. **Acceptation automatique** (existante, `ingererEtat`) seulement si tous les contrôles
   passent à tolérance nulle ET qu'aucune ligne n'est restée non lue ou rejetée ET que le texte vient d'une couche
   texte (pas d'OCR) ET qu'aucun état accepté par un humain n'est remplacé ; sinon `en_revue` avec les écarts. Chaque
   ligne porte `reference.page` (PDF) ou `reference.cellule` (Excel). L'origine d'un état lu dans un PDF est `pdf`
   (migration 0523).
9. **DD-02 et DD-10.** Un rapport (usage `dd_rapport`) ou un document de la salle de données (`dd_salle`) est lu par
   l'IA en un résumé et des éléments (fait, risque, chiffre, engagement, autre), chacun avec sa page et un EXTRAIT
   recopié ; le moteur vérifie que l'extrait et chaque nombre cité se retrouvent dans la page. Le résultat est un
   brouillon (`brouillon_ia`, `modifie`, `valide`, `rejete`) : rien n'alimente les verdicts, le registre des preuves ni
   un rapport sans validation par un détenteur de `dd.valider` autre que le dernier modificateur (sauf associé), et un
   brouillon contenant des éléments non vérifiés exige un acquittement explicite. L'adaptateur de données ouvertes
   (`due-diligence/donnees-ouvertes.ts`) reste SIMULÉ, sans route ni appel réseau.
10. **STD-13.** À partir de propositions et de rapports historiques téléversés vers un BROUILLON de méthode du cabinet
    (usage `standard_historique`), l'IA propose étapes, briques, éléments (gabarits, livrables…) et rubriques. Le
    résultat est un brouillon que les experts (`standard.gerer`) corrigent puis valident ; la validation APPLIQUE les
    éléments retenus au brouillon de méthode par les fonctions de l'éditeur (STD-11, bornes et journal inclus) avec des
    valeurs prudentes par défaut (classe de risque R3, autonomie N1, brique inactive par défaut). Rien n'est publié :
    la publication de la méthode reste l'acte séparé de l'éditeur.
11. **Coût IA** : inscrit par l'orchestrateur (`ia_consommations`) et soumis aux plafonds existants ; l'ingestion
    elle-même (extraction de texte) ne coûte rien. FIN-02 : aucune réponse de l'ingestion ne porte de coût.
12. **Décisions de l'utilisateur du 2026-10-22.** (a) *Masquage* : avant l'envoi au modèle d'un document
    `standard_historique`, les noms de personnes et de clients connus du cabinet sont masqués
    (`copilote/noms-propres.ts`) et toute ligne de proposition qui recopie un nom masqué est écartée ; le masquage
    ne couvre que les noms complets connus du cabinet. (b) *Conservation* : le texte extrait des pages est conservé
    jusqu'à la décision sur l'extraction (validée ou rejetée) ou sur l'état financier, plus 90 jours, puis purgé par
    le job `ingestion_maintenance` (fonction `purger_textes_ingestion`, migration 0524) ; l'état financier, ses
    lignes et les brouillons (validés ou non) restent ; un brouillon ouvert ou un état en revue n'est jamais purgé ;
    une lecture ne se relance plus sur un document purgé. (c) *OCR* : l'utilisateur veut un OCR LOCAL installé sur le
    serveur ; il fera l'objet d'un lot dédié après fusion : le port `Ocr` et l'adaptateur simulé restent seuls ici
    (livré au lot 11 : décision 16).
13. **Séparation des tâches.** Le valideur d'un brouillon n'est ni l'auteur du téléversement, ni le demandeur de la
    lecture (téléversement ou relance), ni le dernier modificateur, sauf associé (API et déclencheur `MQG02`).
14. **Propositions de standard sans donnée financière (FIN-02).** Toute proposition contenant un nombre de trois
    chiffres ou plus ou une mention de monnaie est rejetée à la lecture et refusée à la correction ; le texte des
    pages d'un document d'amorçage n'est lisible que de son auteur ou d'un détenteur de `finance.lire`.
15. **Surveillance de la mémoire du worker PDF.** Un pré-contrôle borne la décompression des flux Flate (32 Mo par
    flux, 128 Mo par document) avant tout worker ; pendant l'extraction, la mémoire externe du worker et le RSS du
    processus sont surveillés (150 ms, seuils 256 Mo et +512 Mo mesurés) et le worker est terminé au franchissement d'un
    seuil. Le pré-contrôle ne dépend pas du dictionnaire du PDF, s'exécute dans un worker dédié (délai de 5 s, l'API n'est jamais bloquée), compte les octets lus par zlib en plus des octets produits (budget d'entrée de 64 Mo), ignore CINFO et suit les cascades Flate jusqu'à épuisement des budgets. L'ingestion exige Node 22 au minimum (`unpdf`,
    `worker.getHeapStatistics()` ; garde défensive si la méthode manque).
16. **OCR local (lot 11 ; décision de l'utilisateur du 2026-10-22 : « OCR local installé sur le serveur, jamais
    de service externe »).** Adaptateur `OcrLocal` (`ingestion/ocr-local.ts`) : **`tesseract.js` 7.0.0** (version
    exacte, Apache-2.0, Tesseract 5 compilé en WebAssembly, SANS binaire natif) et données de langue `fra` + `eng`
    « tessdata_fast » 4.1.0 VENDORÉES (`apps/api/ocr-data/`, 5,2 Mo, `SHA256SUMS` vérifié au premier usage et par
    `scripts/ocr-verifier-donnees.cjs`). Aucune donnée ne quitte le serveur, aucun appel réseau, fonctionnement hors
    ligne. Détail et mesures : section « Décision OCR (lot 11) » ci-dessous et `lot-11.md`.
    - **Isolation** : un sous-processus Node PAR DOCUMENT (`child_process.fork` de `ocr-processus.mjs`), jamais
      réutilisé ; environnement vide ; `--max-old-space-size=256`, `--no-addons` ; modèle de permissions de Node
      (`--permission`, lecture seule du code et des données, aucune écriture ni sous-processus), EXIGÉ en production
      (Node >= 22.13 requis ; sans lui, l'OCR est indisponible : `OCR_INDISPONIBLE`), toléré avec un avertissement
      unique en développement et en test ; dossier courant du sous-processus = dossier du script ; garde « aucun réseau » préchargé dans TOUS les fils (`ocr-garde-reseau.cjs`, `--require`) :
      toute tentative (TCP, TLS, DNS, UDP, HTTP, fetch, WebSocket, sous-processus) est refusée et comptée, une seule
      fait échouer le document ; veille dans le sous-processus (`ocr-veille.mjs` : RSS <= 768 Mo, échéance,
      parent vivant) et dans le parent (RSS par /proc sous Linux, délai global `PLAFONDS_OCR.dureeMs`, délai de
      60 s par étape) ; SIGKILL et constat de la mort avant de rendre la main ; aucun orphelin.
    - **Bornes** : pages (`PLAFONDS_OCR.pagesMax`, avant tout travail), 6 images par page (les plus grandes, vignettes
      de moins de 100 px ignorées), pixels par image (`maxImageSize` de pdf.js retire l'image AVANT décodage, ce qui
      est détecté et refusé `IMAGE_TROP_GRANDE` ; secours sur les en-têtes JPEG puis sur les pixels décodés),
      caractères par page et par document (`PLAFOND_TEXTE`), une reconnaissance à la fois par processus d'API
      (file de 8, au-delà `OCR_ECHEC`).
    - **Réglages mesurés** : `fra+eng`, segmentation automatique (PSM 3), `preserve_interword_spaces` (le libellé et
      le montant restent sur la même ligne, séparés par des espaces), agrandissement des scans de moins de 200 dpi
      vers 300 dpi, pages sans encre non soumises au moteur, lignes de confiance inférieure à 50 % écartées.
    - **Choix de l'adaptateur** (`creerOcr`, variable `OCR_LOCAL` : `auto`, `local`, `simule`, `off`) : moteur local
      dès qu'il est disponible, en production comme en développement ; simulé seulement en développement et test
      (défaut en test) ; rien sinon. Une indisponibilité (Node, moteur, données, empreintes, permissions en production) est un repli
      silencieux.
    - **Codes** : `PLAFOND_PAGES`, `IMAGE_TROP_GRANDE`, `PDF_ILLISIBLE`, `DELAI_DEPASSE`, `PLAFOND_TEXTE`,
      `OCR_ECHEC`, `OCR_INDISPONIBLE` ; aucun message de bibliothèque ne sort.

### Décision OCR (lot 11)

Remplace le constat du lot 6 « aucun moteur OCR réel n'est branché » (décision 4). Évaluation complète, commandes de
reproduction et chiffres : `docs/workflows/notes-lots/lot-11.md`.

- **Pourquoi `tesseract.js`** : seule option évaluée à la fois sans binaire natif (Tesseract 5 en WebAssembly),
  sous licence Apache-2.0, maintenue (7.0.0 du 2025-12-15), identique sous Windows et Linux, mesurable et testable
  dans le dépôt. L'objection du lot 6 (téléchargement depuis un CDN) ne vaut que sans `langPath` : avec un chemin
  local, `cacheMethod: "none"` et `gzip: false`, rien n'est téléchargé ni écrit ; le cœur WebAssembly est lu dans
  `node_modules` (en Node, `corePath` est ignoré). Le binaire système `tesseract` (prérequis serveur, surface native,
  absent des postes de développement) et PaddleOCR (addon natif) sont écartés ; `ocrad.js` (abandonné, GPL) et
  `scribe.js-ocr` (AGPL) aussi.
- **Supply chain** : une dépendance (`tesseract.js` 7.0.0, version exacte), 12 transitives, toutes de plus de deux
  semaines ; un `postinstall` publicitaire (`opencollective-postinstall`) non exécuté (pnpm 10 n'exécute que
  `onlyBuiltDependencies`) ; `tesseract.js-core` pèse 45 Mo décompressés (six variantes WebAssembly).
- **Données** : `tessdata_fast` 4.1.0 (`fra` + `eng`, 5,2 Mo) vendorées avec `SHA256SUMS`. `tessdata_best` (19,4 Mo)
  écarté : ses modèles flottants font avorter le cœur WebAssembly de `tesseract.js-core` 7.0.0
  (`missing function: DotProductSSE`, transformé proprement en `OCR_ECHEC`), et « fast » atteint déjà 100 % des
  montants sur les scans nets.
- **Mesures** (Node 24, Windows 11 ; scans de test de `apps/api/test/fixtures/ocr/`) : montants exacts 12/12 (scan
  net 200 dpi), 12/12 (scan dégradé 150 dpi, rotation 0,6°, bruit), 9/9 (état anglais), 11/12 (police à chiffres
  elzéviriens, encre pâle : « 1700 000 » lu sans l'espace des milliers) ; page blanche : texte vide. Durée : ~1 à
  1,5 s de démarrage par document, puis ~2 s par page (30 pages : 58 à 71 s, sous le budget de 240 s). RSS du
  sous-processus : 130 à 256 Mo, stable sur 30 pages ; processus de l'API : moins de +15 Mo, y compris sur les PDF
  hostiles. Image géante (40 000 x 40 000 ou 12 000 x 12 000 annoncés) : refusée en < 1 s, RSS du sous-processus
  143 Mo (jamais décodée).
- **Modèle de permissions** : exigé en production, Node >= 22.13 requis (OCR refusé sinon ; vérifié sous Node 24.12 : aucune
  écriture, aucun sous-processus, lecture hors périmètre refusée `ERR_ACCESS_DENIED`). `--allow-worker` est
  nécessaire (tesseract.js travaille dans un `worker_thread`). Il ne couvre pas le réseau avant Node 25 : le garde
  préchargé le fait. **Non vérifié sous Node 22** (pas de Node 22 sur le poste) : la CI (Node 22) exécute les tests du
  moteur et prouvera la compatibilité ; en cas d'échec, l'OCR échoue fermé (`OCR_ECHEC`), il ne se dégrade pas.
- **Risques résiduels** : moteur WebAssembly et pdf.js exécutés sur un fichier non fiable dans un sous-processus
  Node SANS conteneur ni seccomp (dette de sécurité) ; la mémoire hors tas (pdf.js, WebAssembly jusqu'à 2 Go) n'est
  bornée que par la veille du RSS (768 Mo, mesure toutes les 100 ms : coupure réactive, pas une limite du système) ;
  pas de pare-feu sortant applicatif : le garde réseau est une défense en profondeur DANS le processus, il bloque les API
  publiques de sortie mais ni les poignées natives déjà construites ni une faille native ou WebAssembly (contournement
  résiduel signalé par le vérificateur, voir lot-11.md ; précondition : code déjà exécuté dans le sous-processus), et le
  modèle de permissions de Node ne couvre pas les sockets : la barrière réelle est un PARE-FEU SORTANT du serveur, obligatoire,
  qui interdit toute sortie au processus de l'API et à ses sous-processus ; qualité inconnue sur de vraies liasses SYSCOHADA ; scans en JPEG 2000 (JPX), CCITT ou JBIG2 non
  testés ; scan négatif (texte clair sur fond sombre) vu comme une page sans encre.

## Conséquences positives

- Un PDF à couche texte devient un état financier contrôlé, sourcé page par page, sans service externe ni binaire.
- Le modèle ne fait que proposer : montants vérifiés dans la source, calculs et décisions par le moteur et les humains.
- Les mêmes étapes (extraction, structuration, brouillon, validation) servent quatre usages ; l'OCR réel (lot 11)
  est venu par un adaptateur derrière le port, sans changer la structuration ni les contrôles.
- Un PDF scanné est lu sur le serveur, hors ligne, sans binaire natif ni service tiers (décision 16).
- Aucune modification de `fichier_orphelin`, de `rapports_mission` ni des fonctions communes.

## Conséquences négatives

- **OCR local (décision 16)** : qualité mesurée sur des scans de TEST seulement (états simples, une colonne de
  montants) ; sur de vraies liasses SYSCOHADA (colonnes brut / amortissements / net N et N-1, tampons, écriture
  manuscrite), la qualité reste à mesurer en recette. Une page OCR prend quelques secondes (sous-processus et
  moteur WebAssembly redémarrés pour chaque document, une reconnaissance à la fois par processus d'API). Le moteur
  WebAssembly et pdf.js traitent un fichier non fiable dans un sous-processus Node sans conteneur ni seccomp (dette
  de sécurité) ; `tesseract.js-core` ajoute 45 Mo à `node_modules`, les données de langue 5,2 Mo au dépôt.
- Les règles déterministes lisent une mise en page simple (section, code, libellé, montant) ; une liasse complexe
  (colonnes brut, amortissements, net N et N-1) part en revue : l'extraction fine dépend de l'IA et d'un vrai
  fournisseur, jamais vérifié ici (aucune clé).
- Le texte des pages est conservé en base jusqu'à la décision + 90 jours (décision 12) ; les montants ne sont pas
  masqués dans cette copie pendant ce délai.
- Une dépendance de plus (`unpdf`, pdf.js embarqué ~1,8 Mo) et un parseur de PDF non fiable dans le processus de
  l'API : le contrôle par le contenu, les plafonds de taille, de pages, de texte et de durée en limitent l'exposition,
  mais ne remplacent pas un antivirus ; le traitement est isolé dans un fil d'exécution à mémoire plafonnée, pas dans un
  processus ou un conteneur séparé (dette de sécurité à inscrire).
- Un traitement de 30 s au plus occupe le worker ; la file est partagée entre cabinets (dette connue de la file `jobs`).

## Alternatives écartées

- **Un service en ligne d'OCR ou de lecture de documents** — enverrait des données clients à un tiers non déclaré ;
  exclu par la règle « aucun appel externe » du lot.
- **Binaire système `tesseract` (ou `poppler`) en sous-processus** (lot 11) — même moteur, plus rapide, mais
  prérequis serveur (`tesseract-ocr`, `-fra`, `-eng`), surface native (Leptonica et bibliothèques d'images),
  absent des postes Windows de développement, non mesurable ni testable dans le dépôt. Un adaptateur de ce type
  pourrait réutiliser le sous-processus, le garde et les bornes de `OcrLocal` derrière le même port.
- **PaddleOCR via `onnxruntime-node`, `ocrad.js`, `scribe.js-ocr`** (lot 11) — addon natif volumineux chargé
  dans le processus ; projet abandonné et GPL ; AGPL-3.0 : écartés.
- **Données `tessdata_best`** (lot 11) — 19,4 Mo au lieu de 5,2 Mo, et leurs modèles flottants font avorter le cœur
  WebAssembly de `tesseract.js-core` 7.0.0 ; « fast » retrouve déjà tous les montants des scans nets.
- **Réutiliser un sous-processus OCR entre documents** — plus rapide (démarrage du moteur évité), mais garderait
  en mémoire des données d'un document (ou d'un cabinet) pour le suivant : un sous-processus par document.
- **`pdfjs-dist` directement** — même moteur, mais configuration Node plus lourde et dépendance optionnelle native
  (`@napi-rs/canvas`) ; `unpdf` l'empaquette sans dépendance.
- **`pdf-parse`, `pdf2json`** — non maintenus.
- **Conserver le fichier original** (clé étrangère vers `fichiers`) — exigerait de redéfinir `fichier_orphelin` et de
  décider d'une durée de conservation des originaux ; reporté, les pages extraites suffisent aux références.
- **Accepter automatiquement une extraction IA validée par le seul modèle** — contraire à « les chiffres ne viennent
  jamais du modèle » ; la source et le moteur décident.
- **Extraction synchrone dans la requête** — bloquerait la requête et l'IA ; la file `jobs` existe pour cela.

## Liens

- Spécification : PRD complémentaire §4.6 (STD-13) et §5 (DOS-03) ; SPEC-3b §8.12 (DD-02, DD-10).
- OCR local (lot 11) : `apps/api/src/ingestion/ocr-local.ts`, `ocr-processus.mjs`, `ocr-veille.mjs`,
  `ocr-garde-reseau.cjs`, `apps/api/ocr-data/` (données, `SHA256SUMS`, `README.md`),
  `scripts/ocr-verifier-donnees.cjs`, `apps/api/test/ocr-moteur.test.ts`, `apps/api/test/ocr-evaluation.ts` ;
  notes : `docs/workflows/notes-lots/lot-11.md`.
- Code : `apps/api/src/ingestion/**`, `apps/api/migrations/0521_ingestion_documents.sql`,
  `0522_ingestion_extractions.sql`, `0523_ingestion_etats_pdf.sql`, `0524_ingestion_purge_textes.sql`, `0525_ingestion_ocr_local.sql`, `0526_ingestion_purge_corrections_ocr.sql`, `packages/engines/src/ingestion/**`,
  `packages/shared/src/schemas/ingestion.ts`, `apps/api/src/dossier/etats.ts` (ajout `forcerRevue`).
- ADR liés : ADR-002 (file de tâches), ADR-003 (IA), ADR-004 (référentiel de méthodes), ADR-012 (due diligence),
  ADR-013 (modèle port + brouillon à relire).
- Notes du lot : `docs/workflows/notes-lots/lot-6.md`.

---

## Mise en œuvre (référence pour les agents)

**SQLSTATE** : `MQG01` (document : identité, transition), `MQG02` (extraction : machine à états, séparation des
tâches), `MQG03` (version cible d'un amorçage). Migrations `0521` à `0526` (0524 : purge du texte des pages et planification du job de maintenance ; 0525 : méthode `ocr` et `corrections_ocr` ; 0526 : purge des corrections avec le texte des pages, décision + 90 jours). Le garde réseau de l'OCR impose aux workers l'héritage des options du sous-processus (garde, permissions) et ignore l'`execArgv` de l'appelant.

**Jobs** : `ingestion_extraction` (charge `{document_id}`), `ingestion_structuration` (charge `{document_id}`), `ingestion_maintenance` (quotidien par cabinet, clé `ingestion_maintenance:AAAA-MM-JJ`), clés
`ingestion:<id>` et `ingestion-structuration:<id>[:n]` ; trois tentatives.

**Statuts du document** : `en_file` → `extraction` → `structuration` → `termine` | `echec`. Résultat :
`etat_cree`, `brouillon_cree`, `ia_indisponible`, `rien_trouve`. Une relance de lecture (usages DD et standard)
repasse `termine` → `structuration`.

**Permissions** (aucune nouvelle) : DOS-03 `dossier.lire` / `dossier.ecrire` (+ `ia.utiliser` pour l'IA, sinon
règles) ; DD `dd.lire`, `dd.ecrire`, `dd.valider` (+ `ia.utiliser`) ; STD-13 `standard.gerer` (+ `ia.utiliser`).

**Lignes de sortie du modèle** (séparateur « | », tout le reste est ignoré) :

- état : `page | section | code | parent | role | libellé | montant` (section parmi actif, passif, charges,
  produits, resultat ; parent et role facultatifs ; montant recopié du document) ;
- lecture : `page | type | extrait recopié | énoncé` (type : fait, risque, chiffre, engagement, autre) et une ligne
  `RESUME | page | texte` ;
- standard : `etape | code | libellé`, `brique | étape | code | libellé | objet`, `element | type | code |
  libellé | description`, `rubrique | code | libellé | niveau 1 | … | niveau 5`, chacune suivie de `| page`.
