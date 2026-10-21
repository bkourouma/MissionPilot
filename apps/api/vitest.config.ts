import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Une seule base de test partagée : les fichiers s'exécutent l'un après l'autre.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: "test" },
    // En CI seulement : un rejeu des tests connus instables sous charge (kpi-alertes, jobs,
    // canaux-kpi-suivi, auth-limiteur). Sans effet en local.
    retry: process.env.CI ? 1 : 0,
  },
});
