import { afterEach, describe, expect, it, vi } from "vitest";
import { envoyerSaisie } from "./envoi";
import type { SaisieEnAttente } from "./file-temps";

afterEach(() => vi.unstubAllGlobals());

const saisie = (surcharge: Partial<SaisieEnAttente> = {}): SaisieEnAttente =>
  ({
    cle: "0a1b2c3d-0000-4000-8000-123456789abc",
    utilisateurId: "u1",
    feuilleId: "f 1",
    semaine: "2026-11-02",
    charge: { lignes: [] },
    ...surcharge,
  }) as SaisieEnAttente;

describe("envoi d'une saisie en attente", () => {
  it("PUT complet des lignes avec la clé de l'entrée en en-tête Idempotency-Key", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await envoyerSaisie(saisie());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/feuilles-temps/f%201/lignes");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "0a1b2c3d-0000-4000-8000-123456789abc",
    );
    expect(JSON.parse(init.body as string)).toEqual({ lignes: [] });
  });

  it("une saisie à corriger (sans charge) n'est jamais envoyée", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      envoyerSaisie(saisie({ charge: null } as Partial<SaisieEnAttente>)),
    ).rejects.toThrow(/rien à envoyer/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
