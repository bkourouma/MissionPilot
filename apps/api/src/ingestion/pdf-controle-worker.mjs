// Worker du PRÉ-CONTRÔLE des bombes de décompression d'un PDF (ADR-009, décisions 2 et 15 ; voir
// pdf-controle.ts pour le contrat, les plafonds et leur justification). JavaScript natif, volontairement,
// comme pdf-worker.mjs : il doit se charger tel quel sous tsx comme sous vitest, sans chargeur TypeScript.
//
// Le balayage tourne ICI, jamais sur le fil principal de l'API : même une entrée hostile imprévue ne peut
// plus bloquer la boucle d'événements (troisième vérification 2026-10-22, une chaîne de blocs deflate
// « stockés » vides la bloquait 73 s). Le fil principal crée ce worker, attend son verdict et le TERMINE au
// délai (`DELAI_CONTROLE_PDF_MS`).
//
// Contrat : `workerData = { contenu: Uint8Array, plafonds: PLAFONDS_CONTROLE_PDF }` ;
// message de sortie `{ ok: true, dureeMs }` ou `{ ok: false, code: "PLAFOND_TEXTE", dureeMs }`.
//
// Principe : tout « stream » isolé dont les données possibles (premier octet non blanc après le mot, début
// de la ligne suivante, premier octet non blanc de cette ligne) commencent par un en-tête zlib valide est
// décompressé sous plafond strict (`inflateRawSync` + `maxOutputLength`), sans lire le dictionnaire ; une
// décompression non terminée au premier « endstream » est reprise jusqu'à la fin du fichier ; un résultat
// qui commence lui-même par un en-tête zlib est décompressé à son tour (cascade Flate sur Flate) tant que les
// budgets le permettent. Un flux CORROMPU est ignoré (pdf.js tranchera), mais son coût est compté.
//
// Coût compté par appel à zlib, réussite comme échec, seconde passe et couches internes comprises :
// - travail : MAX(octets de sortie, octets d'ENTRÉE) ; l'entrée est celle que zlib a réellement consommée
//   quand il le dit (`engine.bytesWritten`, égale à l'entrée fournie s'il l'a lue entièrement), sinon (échec)
//   toute l'entrée fournie ; la sortie d'un échec est la sortie maximale qu'il a pu produire ;
// - entrée cumulée : octets d'entrée ainsi comptés, plafonnés à part (`entreeOctets`) : une suite de blocs
//   « stockés » vides ne produit rien mais fait relire des Mo à chaque début candidat.
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";
import { constants as zlibConstantes, inflateRawSync } from "node:zlib";

const STREAM = Buffer.from("stream", "latin1");
const ENDSTREAM = Buffer.from("endstream", "latin1");
const LF = 0x0a;
const CR = 0x0d;
/** Rapport maximal de décompression de deflate (~1032:1) : sortie maximale d'un appel en échec. */
const RAPPORT_DEFLATE_MAX = 1033;
const ACCEPTE = { ok: true };
const REFUS = { ok: false, code: "PLAFOND_TEXTE" };

/** Blancs PDF (ISO 32000-1 §7.2.2) : NUL, HT, LF, FF, CR, SP. */
const estBlanc = (o) =>
  o === 0x20 || o === 0x0a || o === 0x0d || o === 0x09 || o === 0x0c || o === 0x00;

/**
 * En-tête zlib (RFC 1950) accepté par pdf.js (`FlateStream`) : méthode 8 (deflate), FCHECK juste, sans
 * dictionnaire préréglé (FDICT = 0). La taille de fenêtre (CINFO, 4 bits de poids fort) n'est PAS
 * vérifiée : pdf.js l'ignore et `inflateRaw` aussi, un CINFO > 7 reste donc une bombe à contrôler.
 */
function enteteZlib(octets, i) {
  const cmf = octets[i];
  const flg = octets[i + 1];
  if (cmf === undefined || flg === undefined) return false;
  return (cmf & 0x0f) === 8 && (cmf * 256 + flg) % 31 === 0 && (flg & 0x20) === 0;
}

/**
 * Prochaine occurrence d'un motif à partir de positions CROISSANTES, mémorisée : un appel dont la position
 * tombe avant la dernière occurrence trouvée la réutilise (rien entre les deux), d'où un parcours linéaire.
 */
function rechercheMemorisee(contenu, motif) {
  let trouve = -2; // -2 : rien en mémoire ; -1 : aucune occurrence après la dernière position demandée
  let depuisMemo = 0;
  return (depuis) => {
    if (trouve !== -2 && depuis >= depuisMemo && (trouve === -1 || depuis <= trouve)) return trouve;
    depuisMemo = depuis;
    trouve = contenu.indexOf(motif, depuis);
    return trouve;
  };
}

/**
 * Décompresse `donnees` (en-tête zlib déjà validé) sous `plafond` octets ; un flux TRONQUÉ est lu jusqu'où
 * il va (`Z_SYNC_FLUSH`), comme les lecteurs tolérants. Résultats :
 * - `{ genre: "ok", clair, complet, entree }` : `complet` si zlib a atteint la fin de son flux avant la fin
 *   des octets fournis ; `entree` = octets d'entrée consommés ;
 * - `{ genre: "trop" }` : plafond de sortie franchi ;
 * - `{ genre: "corrompu", sortieMax, entree }` : erreur zlib ; `sortieMax` = sortie maximale produite avant
 *   l'erreur, `entree` = toute l'entrée fournie (la part lue n'est pas connue).
 */
function infler(donnees, plafond) {
  const corps = donnees.subarray(2);
  const fournis = donnees.length;
  try {
    const r = inflateRawSync(corps, {
      finishFlush: zlibConstantes.Z_SYNC_FLUSH,
      maxOutputLength: plafond,
      info: true,
    });
    if (Buffer.isBuffer(r)) return { genre: "ok", clair: r, complet: false, entree: fournis };
    const lus = r.engine?.bytesWritten;
    const mesure = typeof lus === "number" && lus >= 0 && lus <= corps.length;
    return {
      genre: "ok",
      clair: r.buffer,
      // Octets consommés < octets fournis : zlib a rencontré la fin de son flux (le reste est ignoré).
      complet: mesure && lus < corps.length,
      entree: mesure ? lus + 2 : fournis,
    };
  } catch (erreur) {
    if (erreur?.code === "ERR_BUFFER_TOO_LARGE") return { genre: "trop" };
    return {
      genre: "corrompu",
      sortieMax: Math.min(plafond, corps.length * RAPPORT_DEFLATE_MAX),
      entree: fournis,
    };
  }
}

/**
 * Pré-contrôle : `REFUS` (PLAFOND_TEXTE) pour un PDF dont un flux Flate dépasse la borne par flux, dont le
 * cumul décompressé dépasse la borne du document, dont un flux a des octets bruts trop volumineux, qui
 * exige un nombre anormal de décompressions, un travail ou une entrée de décompression anormaux, une
 * cascade anormalement profonde ou un nombre anormal de mots « stream » ; `ACCEPTE` sinon. Ne lève jamais
 * pour une entrée donnée (une exception inattendue est traitée par l'appelant comme une panne).
 */
export function controler(contenu, P) {
  let reste = P.totalOctets;
  let travail = P.travailOctets;
  let entree = P.entreeOctets;
  let tentatives = 0;
  const controles = new Set();
  const prochainLf = rechercheMemorisee(contenu, LF);
  const prochainCr = rechercheMemorisee(contenu, CR);
  const prochainEndstream = rechercheMemorisee(contenu, ENDSTREAM);

  // Fin de la dernière suite de blancs parcourue : une position déjà couverte n'est pas relue.
  let blancsDe = -1;
  let blancsA = -1;
  const sauterBlancs = (i) => {
    if (i >= blancsDe && i <= blancsA) return blancsA;
    let j = i;
    while (j < contenu.length && estBlanc(contenu[j])) j += 1;
    blancsDe = i;
    blancsA = j;
    return j;
  };
  /** Début de la ligne qui suit `i` (pdf.js saute tout jusqu'à la fin de ligne après « stream »). */
  const ligneSuivante = (i) => {
    const lf = prochainLf(i);
    const cr = prochainCr(i);
    const fin = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
    if (fin < 0) return contenu.length;
    return contenu[fin] === CR && contenu[fin + 1] === LF ? fin + 2 : fin + 1;
  };

  /**
   * Décompresse une couche sous les bornes et COMPTE son coût (voir l'en-tête), réussite comme échec.
   * `null` : refus du document ; sinon le résultat (le cumul décompressé est décompté par `controlerFlux`).
   */
  const couche = (donnees) => {
    if (travail <= 0 || entree <= 0) return null;
    tentatives += 1;
    if (tentatives > P.nombreFlux) return null;
    const r = infler(donnees, Math.min(P.fluxOctets, reste + 1));
    if (r.genre === "trop") return null;
    const sortie = r.genre === "ok" ? r.clair.length : r.sortieMax;
    travail -= Math.max(sortie, r.entree);
    entree -= r.entree;
    if (travail < 0 || entree < 0) return null;
    return r;
  };

  /** Contrôle d'un flux dont les données (en-tête zlib valide) commencent à `debut`. Faux : refus. */
  const controlerFlux = (debut, fin) => {
    // 1. Jusqu'au premier « endstream » (un flux tronqué y est lu jusqu'où il va, sans erreur).
    let r = couche(contenu.subarray(debut, Math.max(debut, fin)));
    if (r === null) return false;
    if (r.genre !== "ok") return true; // corrompu avant « endstream » : pdf.js échouera au même endroit
    // 2. Flux zlib non terminé à « endstream » : reprise jusqu'à la fin du fichier (`/Length` peut couvrir
    //    des octets « endstream » placés dans les données compressées). Coût compté comme la passe 1.
    if (!r.complet && fin < contenu.length) {
      const etendu = couche(contenu.subarray(debut));
      if (etendu === null) return false;
      if (etendu.genre === "ok" && etendu.clair.length > r.clair.length) r = etendu;
    }
    // 3. Couches Flate imbriquées (cascade Flate sur Flate) : tant que le résultat commence par un en-tête
    //    zlib valide, sous les mêmes bornes et budgets ; la profondeur ne sert que de garde-fou de terminaison.
    let clair = r.clair;
    reste -= clair.length;
    if (reste < 0) return false;
    for (let niveau = 1; enteteZlib(clair, 0); niveau += 1) {
      if (niveau >= P.imbricationFlateMax) return false;
      const interne = couche(clair);
      if (interne === null) return false;
      if (interne.genre !== "ok") break; // couche interne corrompue : pdf.js échouera de même
      clair = interne.clair;
      reste -= clair.length;
      if (reste < 0) return false;
    }
    return true;
  };

  /** Contrôle d'un début candidat (une seule fois par position) ; faux : refus. */
  const essayer = (debut, fin) => {
    if (!enteteZlib(contenu, debut) || controles.has(debut)) return true;
    controles.add(debut);
    return controlerFlux(debut, Math.max(debut, fin));
  };

  let mots = 0;
  let derniereLigne = -1;
  for (let position = 0; ;) {
    const mot = contenu.indexOf(STREAM, position);
    if (mot < 0) break;
    const apres = mot + STREAM.length;
    // Le corps n'est pas sauté : chaque position n'est lue qu'une fois par les recherches mémorisées, et
    // un « stream » isolé DANS des données (après un faux « endstream ») reste examiné.
    position = apres;
    // « stream » doit être un mot isolé (précédé de « >> » ou d'un blanc), pas un fragment ; cela écarte
    // aussi le « stream » de « endstream ».
    const avant = mot > 0 ? contenu[mot - 1] : 0x20;
    if (avant !== 0x3e && avant > 0x20) continue;
    mots += 1;
    if (mots > P.motsStream) return REFUS;

    const finRegion = prochainEndstream(apres);
    if (finRegion >= 0 && finRegion - apres > P.fluxBrutOctets) return REFUS;
    const fin = finRegion < 0 ? contenu.length : finRegion;

    // Débuts possibles des données, sans supposer de fin de ligne ni lire le dictionnaire : premier octet
    // non blanc, début de la ligne suivante (pdf.js) et son premier octet non blanc. Plusieurs « stream »
    // sur une même ligne partagent la ligne suivante : elle n'est examinée qu'une fois.
    if (!essayer(sauterBlancs(apres), fin)) return REFUS;
    const ligne = ligneSuivante(apres);
    if (ligne !== derniereLigne) {
      derniereLigne = ligne;
      if (!essayer(ligne, fin) || !essayer(sauterBlancs(ligne), fin)) return REFUS;
    }
  }
  return ACCEPTE;
}

// Exécuté seulement comme worker du pré-contrôle (rôle explicite : jamais au simple import du module).
if (parentPort && workerData?.role === "controle-pdf") {
  const { contenu, plafonds } = workerData;
  const debut = performance.now();
  const verdict = controler(
    Buffer.from(contenu.buffer, contenu.byteOffset, contenu.byteLength),
    plafonds,
  );
  parentPort.postMessage({ ...verdict, dureeMs: performance.now() - debut });
}
