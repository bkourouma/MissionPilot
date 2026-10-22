import { estLocal, loadConfig, type Config } from "../config.js";
import type { DependancesIa } from "../ia/orchestrateur.js";
import { dependancesIaParDefaut } from "../ia/job.js";
import { OcrSimule, type Ocr } from "./ocr.js";
import { OcrLocal, ocrLocalDisponible } from "./ocr-local.js";

/*
 * Dépendances des jobs d'ingestion (sur le modèle de canaux/fabrique.ts) : configuration, orchestrateur IA
 * et port OCR (ADR-009, décisions 4 et 16).
 *
 * Choix de l'OCR (`creerOcr`, variable `OCR_LOCAL` de config.ts) :
 * - le moteur LOCAL (`OcrLocal`, tesseract.js en sous-processus, hors ligne) est retenu dès qu'il est
 *   DISPONIBLE (moteur et données présents, empreintes justes, Node suffisant : vérification légère,
 *   mise en cache, jamais de réseau), en production comme en développement ;
 * - le SIMULÉ n'existe qu'en développement et en test (`estLocal`), jamais en production : repli quand
 *   le moteur local est absent ou désactivé, ou demandé (`OCR_LOCAL=simule`) ;
 * - en TEST (`NODE_ENV=test`), le simulé reste le défaut : les tests existants s'appuient sur son
 *   conteneur `%MPOCRSIM1:` ; le moteur local s'y demande explicitement (`OCR_LOCAL=local`) ou
 *   s'instancie directement (`new OcrLocal(...)`) ;
 * - `OCR_LOCAL=off` désactive le moteur local ; hors développement sans moteur, le port vaut null (une
 *   page sans couche texte échoue alors, sans OCR).
 * Aucune exception ni journalisation ici : un moteur absent est un repli silencieux.
 */

export interface DependancesIngestion {
  config: Config;
  ia: DependancesIa;
  ocr: Ocr | null;
}

export type ConfigOcr = Pick<Config, "NODE_ENV"> & Partial<Pick<Config, "OCR_LOCAL">>;

/** Options de `creerOcr` RÉSERVÉES AUX TESTS : disponibilité du moteur local imposée. */
export interface OptionsCreerOcr {
  disponible?: () => boolean;
}

/** OCR de la configuration (voir l'en-tête) : local s'il est disponible, sinon simulé hors production. */
export function creerOcr(config: ConfigOcr, options: OptionsCreerOcr = {}): Ocr | null {
  const simuleAdmis = config.NODE_ENV !== "production" && estLocal(config.NODE_ENV);
  const choix = config.OCR_LOCAL ?? "auto";
  const veutLocal = choix === "local" || (choix === "auto" && config.NODE_ENV !== "test");
  if (veutLocal) {
    let disponible = false;
    try {
      disponible = (options.disponible ?? ocrLocalDisponible)();
    } catch {
      disponible = false;
    }
    if (disponible) return new OcrLocal();
  }
  return simuleAdmis ? new OcrSimule() : null;
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
