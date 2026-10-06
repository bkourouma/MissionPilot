import { z } from "zod";

// Valeurs de développement identiques à .env.example ; refusées en production.
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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const withDefaults = production ? env : { ...DEV, ...stripEmpty(env) };
  return schema.parse(withDefaults);
}

function stripEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
}
