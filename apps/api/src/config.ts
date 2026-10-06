import { z } from "zod";

// Valeurs de développement identiques à .env.example ; refusées hors développement et test.
const DEV = {
  DATABASE_OWNER_URL:
    "postgres://missionpilot_owner:dev_only_owner_password@127.0.0.1:55440/missionpilot",
  DATABASE_URL: "postgres://missionpilot_app:dev_only_app_password@127.0.0.1:55440/missionpilot",
  SESSION_SECRET: "dev-only-change-me-dev-only-change-me",
  TFA_MASTER_KEY: "dev-only-tfa-master-key-change-me-0000",
};

/** Hôtes admis pour une base de développement (valeurs par défaut autorisées). */
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Adresse e-mail ASCII sans nom affiché ni caractère d'en-tête (SMTP sans SMTPUTF8). */
export const ADRESSE_ASCII = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().int().default(4100),
  WEB_ORIGIN: z.string().default("http://localhost:3100"),
  DATABASE_OWNER_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  /**
   * Secret maître du chiffrement applicatif (secrets TOTP, codes de secours,
   * e-mails en file), distinct de SESSION_SECRET. Rotation : l'ancienne valeur
   * passe dans TFA_MASTER_KEY_PRECEDENTE le temps que les chiffrés soient repris.
   */
  TFA_MASTER_KEY: z.string().min(32),
  TFA_MASTER_KEY_PRECEDENTE: z.string().min(32).optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /** Worker de la file de tâches (ADR-002) : actif par défaut, sauf en test. */
  JOBS_WORKER: z.enum(["actif", "inactif"]).optional(),
  /** Transport SMTP (SOC-08). Sans SMTP_HOST : journal local en développement et test. */
  SMTP_HOST: z.string().min(1).max(253).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /** Secrets : jamais journalisés ni renvoyés. */
  SMTP_USER: z.string().max(254).optional(),
  SMTP_PASS: z.string().max(500).optional(),
  /** « implicite » (port 465), « starttls » (587) ; « aucun » refusé hors développement et test. */
  SMTP_TLS: z.enum(["implicite", "starttls", "aucun"]).optional(),
  MAIL_FROM: z.string().max(254).regex(ADRESSE_ASCII).optional(),
  /** « oui » : 2FA obligatoire pour les rôles sensibles de tous les cabinets (plancher plateforme). */
  TOTP_REQUIS: z.enum(["oui", "non"]).default("non"),
});

export type Config = z.infer<typeof schema>;

const ENVIRONNEMENTS_LOCAUX = ["development", "test"];

/** Le worker de jobs tourne sauf s'il est désactivé, et jamais par défaut en test. */
export function workerActif(config: Pick<Config, "NODE_ENV" | "JOBS_WORKER">): boolean {
  return (config.JOBS_WORKER ?? (config.NODE_ENV === "test" ? "inactif" : "actif")) === "actif";
}

/**
 * Vrai pour un NODE_ENV de développement ou de test (ou absent). Ne suffit
 * PAS à admettre les valeurs de développement : loadConfig exige en plus une
 * base locale (voir `baseLocale`), sinon il refuse de démarrer.
 */
export function estLocal(nodeEnv: string | undefined): boolean {
  return nodeEnv === undefined || ENVIRONNEMENTS_LOCAUX.includes(nodeEnv);
}

/** Vrai si l'hôte de l'URL PostgreSQL est la machine locale (localhost, 127.0.0.1, ::1). */
export function baseLocale(url: string | undefined): boolean {
  if (url === undefined) return true; // valeur de développement : 127.0.0.1
  try {
    return HOTES_LOCAUX.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Le cookie de session est « secure » partout sauf en développement et en test. */
export function cookieSecurise(config: Pick<Config, "NODE_ENV">): boolean {
  return !estLocal(config.NODE_ENV);
}

/**
 * Charge et valide la configuration (point d'entrée unique).
 *
 * Valeurs de développement (constat M4) : admises seulement si NODE_ENV est
 * absent, « development » ou « test » ET que DATABASE_URL et
 * DATABASE_OWNER_URL désignent une base locale. Un serveur dont NODE_ENV a
 * été oublié mais qui pointe vers une base distante refuse de démarrer, au
 * lieu de tourner avec des secrets publics et des cookies non sécurisés.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fournies = stripEmpty(env);
  const local = estLocal(fournies.NODE_ENV);
  if (local && !(baseLocale(fournies.DATABASE_URL) && baseLocale(fournies.DATABASE_OWNER_URL))) {
    throw new Error(
      `NODE_ENV ${fournies.NODE_ENV ? `« ${fournies.NODE_ENV} »` : "absent"} avec une base distante : ` +
        "les valeurs de développement ne sont admises qu'avec une base locale. " +
        "Définir NODE_ENV=production (et tous les secrets) pour un serveur.",
    );
  }
  const withDefaults = local ? { ...DEV, ...fournies } : fournies;
  const config = schema.parse(withDefaults);
  if (!estLocal(config.NODE_ENV)) {
    const dev: Record<string, string> = DEV;
    for (const [cle, valeur] of Object.entries(dev)) {
      if ((config as Record<string, unknown>)[cle] === valeur) {
        throw new Error(`${cle} utilise une valeur de développement hors développement.`);
      }
    }
  }
  verifierSecrets(config);
  verifierConfigEmail(config);
  return config;
}

/** Les secrets maîtres sont distincts : une fuite de l'un n'ouvre pas les autres usages. */
function verifierSecrets(config: Config): void {
  if (config.TFA_MASTER_KEY === config.SESSION_SECRET) {
    throw new Error("TFA_MASTER_KEY doit différer de SESSION_SECRET.");
  }
  if (config.TFA_MASTER_KEY_PRECEDENTE === config.TFA_MASTER_KEY) {
    throw new Error("TFA_MASTER_KEY_PRECEDENTE doit différer de TFA_MASTER_KEY.");
  }
}

/**
 * Hors développement et test, l'API refuse de démarrer sans transport SMTP
 * chiffré : une invitation ou une alerte ne doit jamais se perdre en silence.
 * Les messages d'erreur ne citent jamais la valeur d'un secret.
 */
export function verifierConfigEmail(config: Config): void {
  if ((config.SMTP_USER === undefined) !== (config.SMTP_PASS === undefined)) {
    throw new Error("SMTP_USER et SMTP_PASS vont ensemble.");
  }
  if (config.SMTP_HOST && !config.MAIL_FROM) {
    throw new Error("MAIL_FROM est obligatoire quand SMTP_HOST est défini.");
  }
  if (estLocal(config.NODE_ENV)) return;
  if (!config.SMTP_HOST) {
    throw new Error(
      "SMTP_HOST est obligatoire hors développement : les e-mails ne partiraient pas.",
    );
  }
  if (config.SMTP_TLS === "aucun") {
    throw new Error("SMTP_TLS=aucun est refusé hors développement : TLS obligatoire.");
  }
}

function stripEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
}
