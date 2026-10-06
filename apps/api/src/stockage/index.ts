import { dossierStockage, type Config } from "../config.js";
import { StockageDisque } from "./disque.js";
import { StockageS3 } from "./s3.js";
import type { StockageFichiers } from "./stockage.js";

export { FichierAbsent, type StockageFichiers } from "./stockage.js";

const instances = new Map<string, StockageFichiers>();

/** Stockage désigné par la configuration (une instance par pilote et par dossier). */
export function stockageDe(
  config: Pick<Config, "NODE_ENV" | "STORAGE_DIR" | "STORAGE_DRIVER">,
): StockageFichiers {
  const dossier = dossierStockage(config);
  const cle = `${config.STORAGE_DRIVER}:${dossier}`;
  let s = instances.get(cle);
  if (!s) {
    s = config.STORAGE_DRIVER === "s3" ? new StockageS3() : new StockageDisque(dossier);
    instances.set(cle, s);
  }
  return s;
}
