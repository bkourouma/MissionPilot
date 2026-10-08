import type { Readable } from "node:stream";

/*
 * Stockage des fichiers téléversés (SOC-05, FIN-05).
 *
 * Règles (constat « IDOR n° 1 » des audits) :
 * - la CLÉ est générée par le serveur (128 bits aléatoires, hexadécimal),
 *   jamais dérivée d'un nom ni reçue du client ;
 * - les objets sont rangés par cabinet (`<cabinet>/<préfixe>/<clé>`) : une clé
 *   d'un autre cabinet ne désigne rien dans le dossier du cabinet courant ;
 * - aucun objet n'est servi en statique : la route GET /api/fichiers/:id
 *   revérifie cabinet et visibilité à chaque téléchargement ;
 * - pas d'antivirus dans ce périmètre (voir SECURITY.md) : la liste blanche
 *   de types détectés par signature, le refus des archives et exécutables, et
 *   les en-têtes de téléchargement en tiennent lieu en V1.
 */
export interface StockageFichiers {
  /** Écrit un nouvel objet sous une clé générée ; renvoie la clé. */
  ecrire(cabinetId: string, contenu: Buffer): Promise<string>;
  /** Flux de lecture ; lève FichierAbsent si l'objet n'existe pas. */
  lire(cabinetId: string, cle: string): Promise<Readable>;
  /** Efface l'objet (sans erreur s'il est déjà absent). */
  supprimer(cabinetId: string, cle: string): Promise<void>;
}

export class FichierAbsent extends Error {
  constructor() {
    super("Objet de stockage absent.");
  }
}

export const CLE_STOCKAGE = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Garde commune : identifiant de cabinet et clé bien formés, sinon erreur (jamais un chemin libre). */
export function verifierCle(cabinetId: string, cle: string): void {
  if (!UUID.test(cabinetId)) throw new Error("Identifiant de cabinet invalide.");
  if (!CLE_STOCKAGE.test(cle)) throw new Error("Clé de stockage invalide.");
}
