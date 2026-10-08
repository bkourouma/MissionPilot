import type { Readable } from "node:stream";
import type { StockageFichiers } from "./stockage.js";

/**
 * Point d'extension S3 (ou compatible), NON IMPLÉMENTÉ : la configuration
 * refuse STORAGE_DRIVER=s3 au démarrage (config.ts). Une implémentation
 * reprendra les mêmes règles que le disque : clé générée par le serveur,
 * préfixe par cabinet, bucket privé (jamais d'URL publique ni signée longue),
 * chiffrement côté serveur, lecture uniquement via GET /api/fichiers/:id.
 */
export class StockageS3 implements StockageFichiers {
  ecrire(_cabinetId: string, _contenu: Buffer): Promise<string> {
    return Promise.reject(new Error("Stockage S3 non implémenté."));
  }

  lire(_cabinetId: string, _cle: string): Promise<Readable> {
    return Promise.reject(new Error("Stockage S3 non implémenté."));
  }

  supprimer(_cabinetId: string, _cle: string): Promise<void> {
    return Promise.reject(new Error("Stockage S3 non implémenté."));
  }
}
