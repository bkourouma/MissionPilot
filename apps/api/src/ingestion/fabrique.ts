import { estLocal, loadConfig, type Config } from "../config.js";
import type { DependancesIa } from "../ia/orchestrateur.js";
import { dependancesIaParDefaut } from "../ia/job.js";
import { OcrSimule, type Ocr } from "./ocr.js";

/*
 * Dépendances des jobs d'ingestion (sur le modèle de canaux/fabrique.ts) : configuration, orchestrateur IA
 * et port OCR. L'OCR SIMULÉ n'existe que hors production (développement, test) ; en production le port
 * vaut null (aucun OCR réel n'est branché, ADR-009 décision 4) : une page sans couche texte donne alors
 * l'erreur PDF_SANS_TEXTE.
 */

export interface DependancesIngestion {
  config: Config;
  ia: DependancesIa;
  ocr: Ocr | null;
}

/** OCR de la configuration : simulé hors production, sinon aucun. */
export function creerOcr(config: Pick<Config, "NODE_ENV">): Ocr | null {
  return config.NODE_ENV !== "production" && estLocal(config.NODE_ENV) ? new OcrSimule() : null;
}

let duProcessus: DependancesIngestion | null = null;

/** Dépendances des jobs du registre : configuration de l'environnement, une fois par processus. */
export function dependancesIngestionParDefaut(): DependancesIngestion {
  if (!duProcessus) {
    const config = loadConfig();
    duProcessus = { config, ia: dependancesIaParDefaut(), ocr: creerOcr(config) };
  }
  return duProcessus;
}
