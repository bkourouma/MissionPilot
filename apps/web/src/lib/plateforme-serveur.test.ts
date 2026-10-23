import { beforeEach, describe, expect, it, vi } from "vitest";

const appelerApi = vi.hoisted(() => vi.fn());
const cookiesLus = vi.hoisted(() => ({ valeurs: {} as Record<string, string> }));
const redirect = vi.hoisted(() =>
  vi.fn((chemin: string) => {
    throw new Error(`REDIRECT:${chemin}`);
  }),
);

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) =>
      nom in cookiesLus.valeurs ? { value: cookiesLus.valeurs[nom] } : undefined,
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  appelerApi,
}));

import { ErreurApi } from "./api";
import {
  chargerCabinets,
  chargerUtilisateurs,
  exigerSessionPlateforme,
  sessionPlateformeFacultative,
} from "./plateforme-serveur";

const moi = { superAdmin: { id: "sa-1", email: "root@mp.ci", nom: "Root", estDemo: false } };

beforeEach(() => {
  appelerApi.mockReset();
  redirect.mockClear();
  cookiesLus.valeurs = {};
});

describe("sessionPlateformeFacultative", () => {
  it("sans cookie mp_plateforme : null, aucun appel d'API", async () => {
    cookiesLus.valeurs = { mp_session: "jeton-cabinet" };
    expect(await sessionPlateformeFacultative()).toBeNull();
    expect(appelerApi).not.toHaveBeenCalled();
  });

  it("transmet seulement le cookie mp_plateforme (jamais mp_session)", async () => {
    cookiesLus.valeurs = { mp_session: "jeton-cabinet", mp_plateforme: "jeton-plateforme" };
    appelerApi.mockResolvedValueOnce(moi);
    const session = await sessionPlateformeFacultative();
    expect(session).toMatchObject({ email: "root@mp.ci", estDemo: false });
    const [chemin, options] = appelerApi.mock.calls[0]!;
    expect(chemin).toBe("/api/plateforme/moi");
    expect(options.cookie).toBe("mp_plateforme=jeton-plateforme");
    expect(options.cookie).not.toContain("mp_session");
    expect(options.redirigerSi401).toBe(false);
  });

  it("/moi en 4xx : null", async () => {
    cookiesLus.valeurs = { mp_plateforme: "x" };
    appelerApi.mockRejectedValueOnce(new ErreurApi("NON_AUTHENTIFIE", "Expirée.", 401));
    expect(await sessionPlateformeFacultative()).toBeNull();
  });

  it("5xx ou réseau : l'erreur est relancée (pas de faux « déconnecté »)", async () => {
    cookiesLus.valeurs = { mp_plateforme: "x" };
    appelerApi.mockRejectedValueOnce(new ErreurApi("SERVICE_INDISPONIBLE", "Indisponible.", 503));
    await expect(sessionPlateformeFacultative()).rejects.toMatchObject({ statut: 503 });
    appelerApi.mockRejectedValueOnce(new ErreurApi("RESEAU_INDISPONIBLE", "Réseau.", 0));
    await expect(sessionPlateformeFacultative()).rejects.toMatchObject({ statut: 0 });
  });
});

describe("exigerSessionPlateforme", () => {
  it("sans session : redirection vers la connexion de la console", async () => {
    await expect(exigerSessionPlateforme()).rejects.toThrow("REDIRECT:/plateforme/connexion");
  });

  it("avec session : la renvoie", async () => {
    cookiesLus.valeurs = { mp_plateforme: "x" };
    appelerApi.mockResolvedValueOnce(moi);
    expect(await exigerSessionPlateforme()).toMatchObject({ id: "sa-1" });
  });
});

describe("chargerCabinets / chargerUtilisateurs", () => {
  beforeEach(() => {
    cookiesLus.valeurs = { mp_plateforme: "jeton-plateforme" };
  });

  it("401 : redirection vers la connexion de la console", async () => {
    appelerApi.mockRejectedValueOnce(new ErreurApi("NON_AUTHENTIFIE", "Expirée.", 401));
    await expect(chargerCabinets()).rejects.toThrow("REDIRECT:/plateforme/connexion");
  });

  it("autre erreur d'API : résultat en échec affichable (pas d'exception)", async () => {
    appelerApi.mockRejectedValueOnce(new ErreurApi("INTROUVABLE", "Introuvable.", 404));
    const r = await chargerUtilisateurs("c1");
    expect(r).toMatchObject({ ok: false, statut: 404 });
  });

  it("réponse mal formée : échec avec message de réponse inattendue", async () => {
    appelerApi.mockResolvedValueOnce({ pas: "elements" });
    const r = await chargerCabinets();
    expect(r).toMatchObject({ ok: false, statut: 200 });
  });

  it("succès : données lues, chemin encodé, cookie plateforme seul", async () => {
    appelerApi.mockResolvedValueOnce({ elements: [] });
    const r = await chargerUtilisateurs("a/b");
    expect(r).toEqual({ ok: true, donnees: [] });
    const [chemin, options] = appelerApi.mock.calls[0]!;
    expect(chemin).toBe("/api/plateforme/cabinets/a%2Fb/utilisateurs");
    expect(options.cookie).toBe("mp_plateforme=jeton-plateforme");
  });

  it("une erreur non API est relancée", async () => {
    appelerApi.mockRejectedValueOnce(new TypeError("boom"));
    await expect(chargerCabinets()).rejects.toThrow("boom");
  });
});
