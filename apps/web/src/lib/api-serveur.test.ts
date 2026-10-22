import { beforeEach, describe, expect, it, vi } from "vitest";

const appelerApi = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((chemin: string) => {
    throw new Error(`REDIRECT:${chemin}`);
  }),
);

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => "/observatoire" }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  appelerApi,
}));

import { ErreurApi } from "./api";
import { appelerApiServeur, chargerServeur } from "./api-serveur";

const contribution = () =>
  new ErreurApi("OBSERVATOIRE_CONTRIBUTION_REQUISE", "Versez d'abord vos données…", 403);

describe("appelerApiServeur / chargerServeur : 403", () => {
  beforeEach(() => {
    appelerApi.mockReset();
    redirect.mockClear();
  });

  it("redirige tout 403 vers /acces-refuse par défaut", async () => {
    appelerApi.mockRejectedValue(contribution());
    await expect(chargerServeur("/x")).rejects.toThrow("REDIRECT:/acces-refuse");
  });

  it("un 403 métier explicitement toléré devient un résultat, avec le message de l'API", async () => {
    appelerApi.mockRejectedValue(contribution());
    const r = await chargerServeur("/x", ["OBSERVATOIRE_CONTRIBUTION_REQUISE"]);
    expect(r).toEqual({
      ok: false,
      message: "Versez d'abord vos données…",
      statut: 403,
      code: "OBSERVATOIRE_CONTRIBUTION_REQUISE",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un code non listé (INTERDIT) redirige même si d'autres codes sont tolérés", async () => {
    appelerApi.mockRejectedValue(new ErreurApi("INTERDIT", "Non.", 403));
    await expect(chargerServeur("/x", ["OBSERVATOIRE_CONTRIBUTION_REQUISE"])).rejects.toThrow(
      "REDIRECT:/acces-refuse",
    );
  });

  it("TFA_A_CONFIGURER et PORTAIL_ROUTE_INTERDITE redirigent toujours, même listés", async () => {
    appelerApi.mockRejectedValue(new ErreurApi("TFA_A_CONFIGURER", "2FA", 403));
    await expect(appelerApiServeur("/x", { codes403Metier: ["TFA_A_CONFIGURER"] })).rejects.toThrow(
      "REDIRECT:/compte/securite",
    );
    appelerApi.mockRejectedValue(new ErreurApi("PORTAIL_ROUTE_INTERDITE", "Portail", 403));
    await expect(
      appelerApiServeur("/x", { codes403Metier: ["PORTAIL_ROUTE_INTERDITE"] }),
    ).rejects.toThrow(/^REDIRECT:/);
    expect(redirect).not.toHaveBeenCalledWith("/acces-refuse");
  });

  it("401 redirige vers la connexion et les autres erreurs deviennent { ok: false } avec code", async () => {
    appelerApi.mockRejectedValue(new ErreurApi("NON_AUTHENTIFIE", "Session", 401));
    await expect(chargerServeur("/x")).rejects.toThrow(/^REDIRECT:\/connexion/);
    appelerApi.mockRejectedValue(new ErreurApi("INTROUVABLE", "Absent.", 404));
    expect(await chargerServeur("/x")).toMatchObject({
      ok: false,
      statut: 404,
      code: "INTROUVABLE",
    });
  });
});
