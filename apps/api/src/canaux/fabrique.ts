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
  | "DEMO_PUBLIQUE"
  | "WHATSAPP_FOURNISSEUR"
  | "SMS_FOURNISSEUR"
  | "TRANSCRIPTION_FOURNISSEUR"
  | "SIGNATURE_FOURNISSEUR"
>;

/** Options de `creerCanaux`. */
export interface OptionsCanaux {
  horloge?: () => Date;
  /**
   * RÉSERVÉ aux seeds de DÉMONSTRATION PUBLIQUE CONFIRMÉE (DEMO_PUBLIQUE=oui ET `--confirmer-demo`,
   * `demoPubliqueConfirmee` de db/seed-demo.ts, vérifiée par le seed avant tout) : admet les
   * fournisseurs simulés hors développement local, pour la SEULE application que le seed monte en
   * processus (sans port, appels par `inject`), et seulement si la configuration porte aussi
   * DEMO_PUBLIQUE=oui (recoupement : l'option seule ne suffit pas). Les ports restent les simulateurs en mémoire : aucun
   * envoi réel. Paramètre de code uniquement : jamais lu depuis l'environnement ni la configuration ;
   * `loadConfig`, `canauxParDefaut`, `dependancesCanauxParDefaut` et le serveur ne le passent jamais.
   */
  seedDemonstrationPublique?: boolean;
}

/** Ports créés par un seed de démonstration publique confirmée (voir `simulateurCanauxAdmis`). */
const desSeedsPublics = new WeakSet<Canaux>();

/**
 * Fabrique des ports selon la configuration. RÈGLE FERME : aucun adaptateur réel n'existe ; un
 * fournisseur différent de « aucun » hors développement local (configuration construite sans
 * `loadConfig`) est refusé ICI aussi, comme `connexionRapideDemoActive` à l'enregistrement des
 * routes de démonstration. « aucun » rend null : le canal n'existe pas. Seule exception :
 * `seedDemonstrationPublique` (option explicite des seeds de démonstration publique).
 */
export function creerCanaux(config: ConfigCanaux, options: OptionsCanaux = {}): Canaux {
  const actifs = [
    config.WHATSAPP_FOURNISSEUR,
    config.SMS_FOURNISSEUR,
    config.TRANSCRIPTION_FOURNISSEUR,
    config.SIGNATURE_FOURNISSEUR,
  ].some((v) => v !== "aucun");
  // Recoupement : l'option de code ET DEMO_PUBLIQUE=oui dans la configuration du seed.
  const seedPublic = options.seedDemonstrationPublique === true && config.DEMO_PUBLIQUE === "oui";
  if (actifs && !seedPublic && !contexteCanauxSimulesAdmis(config)) {
    throw new Error(
      "Un fournisseur de canal simulé est réservé au développement local : aucun fournisseur réel " +
        "n'est disponible.",
    );
  }
  const horloge = options.horloge ? { horloge: options.horloge } : {};
  const canaux: Canaux = {
    whatsapp: config.WHATSAPP_FOURNISSEUR === "simule" ? new CanalWhatsAppSimule(horloge) : null,
    sms: config.SMS_FOURNISSEUR === "simule" ? new PasserelleSmsSimulee(horloge) : null,
    transcripteur: config.TRANSCRIPTION_FOURNISSEUR === "simule" ? new TranscripteurSimule() : null,
    signature:
      config.SIGNATURE_FOURNISSEUR === "local" ? new FournisseurSignatureLocal(horloge) : null,
  };
  if (seedPublic) desSeedsPublics.add(canaux);
  return canaux;
}

/**
 * Routes du simulateur (`/api/canaux/simulateur/*`) admises : développement local
 * (`contexteCanauxSimulesAdmis`) ou ports créés par un seed de démonstration publique
 * (`seedDemonstrationPublique`), injectés dans SA propre application en processus. L'application du
 * serveur crée ses ports par `canauxParDefaut`, jamais avec cette option.
 */
export function simulateurCanauxAdmis(
  config: Pick<Config, "NODE_ENV" | "DATABASE_URL" | "DATABASE_OWNER_URL">,
  canaux: Canaux,
): boolean {
  return contexteCanauxSimulesAdmis(config) || desSeedsPublics.has(canaux);
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
