import { z } from "zod";

// Valeurs de développement identiques à .env.example ; refusées hors développement et test.
const DEV = {
  DATABASE_OWNER_URL:
    "postgres://missionpilot_owner:dev_only_owner_password@127.0.0.1:55440/missionpilot",
  DATABASE_URL: "postgres://missionpilot_app:dev_only_app_password@127.0.0.1:55440/missionpilot",
  SESSION_SECRET: "dev-only-change-me-dev-only-change-me",
};

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().int().default(4100),
  WEB_ORIGIN: z.string().default("http://localhost:3100"),
  DATABASE_OWNER_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  OPENROUTER_API_KEY: z.string().optional(),
  /** Worker de la file de tâches (ADR-002) : actif par défaut, sauf en test. */
  JOBS_WORKER: z.enum(["actif", "inactif"]).optional(),
});

export type Config = z.infer<typeof schema>;

const ENVIRONNEMENTS_LOCAUX = ["development", "test"];

/** Le worker de jobs tourne sauf s'il est désactivé, et jamais par défaut en test. */
export function workerActif(config: Pick<Config, "NODE_ENV" | "JOBS_WORKER">): boolean {
  return (config.JOBS_WORKER ?? (config.NODE_ENV === "test" ? "inactif" : "actif")) === "actif";
}

/** Vrai en développement et en test : les seuls cas où les valeurs par défaut sont admises. */
export function estLocal(nodeEnv: string | undefined): boolean {
  return nodeEnv === undefined || ENVIRONNEMENTS_LOCAUX.includes(nodeEnv);
}

/** Le cookie de session est « secure » partout sauf en développement et en test. */
export function cookieSecurise(config: Pick<Config, "NODE_ENV">): boolean {
  return !estLocal(config.NODE_ENV);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fournies = stripEmpty(env);
  const withDefaults = estLocal(env.NODE_ENV) ? { ...DEV, ...fournies } : fournies;
  const config = schema.parse(withDefaults);
  if (!estLocal(config.NODE_ENV)) {
    const dev: Record<string, string> = DEV;
    for (const [cle, valeur] of Object.entries(dev)) {
      if ((config as Record<string, unknown>)[cle] === valeur) {
        throw new Error(`${cle} utilise une valeur de développement hors développement.`);
      }
    }
  }
  return config;
}

function stripEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
}
