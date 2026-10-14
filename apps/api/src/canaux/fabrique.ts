import { contexteCanauxSimulesAdmis, loadConfig, type Config } from "../config.js";
import { FournisseurSignatureLocal } from "./signature-locale.js";
import { PasserelleSmsSimulee } from "./sms-simule.js";
import { TranscripteurSimule } from "./transcripteur-simule.js";
import type { Canaux } from "./ports.js";
import { CanalWhatsAppSimule } from "./whatsapp-simule.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Canaux externes SIMULÉS (lot 3c) ; chaque port vaut null si son fournisseur est « aucun ». */
    canaux: Canaux;
  }
}

export type ConfigCanaux = Pick<
  Config,
  | "NODE_ENV"
  | "DATABASE_URL"
  | "DATABASE_OWNER_URL"
  | "WHATSAPP_FOURNISSEUR"
  | "SMS_FOURNISSEUR"
  | "TRANSCRIPTION_FOURNISSEUR"
  | "SIGNATURE_FOURNISSEUR"
>;

/**
 * Fabrique des ports selon la configuration. RÈGLE FERME : aucun adaptateur réel n'existe ; un
 * fournisseur différent de « aucun » hors développement local (configuration construite sans
 * `loadConfig`) est refusé ICI aussi, comme `connexionRapideDemoActive` à l'enregistrement des
 * routes de démonstration. « aucun » rend null : le canal n'existe pas.
 */
export function creerCanaux(config: ConfigCanaux, options: { horloge?: () => Date } = {}): Canaux {
  const actifs = [
    config.WHATSAPP_FOURNISSEUR,
    config.SMS_FOURNISSEUR,
    config.TRANSCRIPTION_FOURNISSEUR,
    config.SIGNATURE_FOURNISSEUR,
  ].some((v) => v !== "aucun");
  if (actifs && !contexteCanauxSimulesAdmis(config)) {
    throw new Error(
      "Un fournisseur de canal simulé est réservé au développement local : aucun fournisseur réel " +
        "n'est disponible.",
    );
  }
  const horloge = options.horloge ? { horloge: options.horloge } : {};
  return {
    whatsapp: config.WHATSAPP_FOURNISSEUR === "simule" ? new CanalWhatsAppSimule(horloge) : null,
    sms: config.SMS_FOURNISSEUR === "simule" ? new PasserelleSmsSimulee(horloge) : null,
    transcripteur: config.TRANSCRIPTION_FOURNISSEUR === "simule" ? new TranscripteurSimule() : null,
    signature:
      config.SIGNATURE_FOURNISSEUR === "local" ? new FournisseurSignatureLocal(horloge) : null,
  };
}

const parDefaut = new WeakMap<object, Canaux>();

/** Dépendances des handlers de jobs des canaux : configuration et ports du processus. */
export interface DependancesCanaux {
  config: Config;
  canaux: Canaux;
}

let duProcessus: DependancesCanaux | null = null;

/**
 * Canaux de la configuration (une seule boîte simulée par configuration), partagés par `buildApp`
 * (`app.canaux`) et, via `dependancesCanauxParDefaut`, par les handlers de jobs du registre (sur le
 * modèle de `dependancesIaParDefaut` et de `trousseauDepuisConfig`). La première configuration vue
 * devient celle du processus : le serveur construit l'application AVANT le premier job.
 */
export function canauxParDefaut(config: Config): Canaux {
  let canaux = parDefaut.get(config);
  if (!canaux) {
    canaux = creerCanaux(config);
    parDefaut.set(config, canaux);
    duProcessus ??= { config, canaux };
  }
  return canaux;
}

/** Dépendances des jobs du registre : la configuration du processus (celle de l'environnement sinon). */
export function dependancesCanauxParDefaut(): DependancesCanaux {
  if (!duProcessus) {
    const config = loadConfig();
    duProcessus = { config, canaux: canauxParDefaut(config) };
  }
  return duProcessus;
}

/** Au moins un canal est actif (route du webhook, simulateur…). */
export function canalActif(canaux: Canaux): boolean {
  return canaux.whatsapp !== null || canaux.sms !== null;
}
