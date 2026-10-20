/*
 * Lecture PLAFONNÉE d'un média entrant en flux (SPEC-3c §13, SECURITY « Canaux »). Un adaptateur réel
 * ne doit jamais lire en mémoire un fichier de taille choisie par un tiers : l'appelant lit le flux
 * du port avec `lireFluxPlafonne`, qui
 *   1. refuse AVANT toute lecture si la taille déclarée dépasse le plafond ;
 *   2. compte les octets au fil de la lecture et FERME le flux (`return()` de l'itérateur, qui
 *      annule le téléchargement sous-jacent) dès que le plafond serait dépassé ;
 *   3. ne retient jamais plus de `octetsMax` octets (le bloc qui dépasse est jeté, non copié) ;
 *   4. ne rend un Buffer que si tout tient.
 * Un dépassement n'est pas une exception : c'est le résultat `trop_gros`. Une erreur du flux est
 * propagée telle quelle (après fermeture du flux).
 */

/** Flux d'octets d'un média : tout `AsyncIterable<Uint8Array>` (un `ReadableStream` Node en est un). */
export type FluxOctets = AsyncIterable<Uint8Array>;

export interface MediaFlux {
  flux: FluxOctets;
  typeMime: string;
  /** Taille annoncée par le fournisseur (en-tête) : indicative, jamais crue sur parole. */
  tailleDeclaree?: number;
}

export type ResultatLecture = { statut: "ok"; contenu: Buffer } | { statut: "trop_gros" };

/** Ferme un flux sans le lire (ou ce qu'il en reste). Ne lève jamais. */
export async function fermerFlux(flux: FluxOctets): Promise<void> {
  try {
    const iterateur = flux[Symbol.asyncIterator]();
    await iterateur.return?.();
  } catch {
    // fermeture au mieux : l'issue du flux n'a plus d'importance
  }
}

export async function lireFluxPlafonne(
  flux: FluxOctets,
  octetsMax: number,
  tailleDeclaree?: number,
): Promise<ResultatLecture> {
  if (
    tailleDeclaree !== undefined &&
    Number.isFinite(tailleDeclaree) &&
    tailleDeclaree > octetsMax
  ) {
    await fermerFlux(flux); // rien n'est lu
    return { statut: "trop_gros" };
  }
  const blocs: Uint8Array[] = [];
  let total = 0;
  const iterateur = flux[Symbol.asyncIterator]();
  try {
    for (;;) {
      const suivant = await iterateur.next();
      if (suivant.done) break;
      const bloc = suivant.value;
      if (total + bloc.byteLength > octetsMax) {
        await iterateur.return?.().catch(() => undefined);
        return { statut: "trop_gros" };
      }
      blocs.push(bloc);
      total += bloc.byteLength;
    }
  } catch (error) {
    await iterateur.return?.().catch(() => undefined);
    throw error;
  }
  return { statut: "ok", contenu: Buffer.concat(blocs, total) };
}
