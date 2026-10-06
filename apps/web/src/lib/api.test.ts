import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appelerApi,
  champsRefuses,
  ErreurApi,
  erreurDepuisReponse,
  MESSAGE_RESEAU,
  messageErreur,
} from "./api";

describe("erreurDepuisReponse", () => {
  it("lit l'enveloppe d'erreur de l'API", () => {
    const e = erreurDepuisReponse(401, {
      erreur: { code: "IDENTIFIANTS_INVALIDES", message: "E-mail ou mot de passe incorrect." },
    });
    expect(e).toBeInstanceOf(ErreurApi);
    expect(e).toMatchObject({
      code: "IDENTIFIANTS_INVALIDES",
      message: "E-mail ou mot de passe incorrect.",
      statut: 401,
    });
  });

  it("conserve les détails de validation", () => {
    const details = { fieldErrors: { email: ["Invalid"] } };
    const e = erreurDepuisReponse(400, {
      erreur: { code: "REQUETE_INVALIDE", message: "Données invalides.", details },
    });
    expect(e.details).toEqual(details);
  });

  it("fournit un message français quand le corps n'est pas l'enveloppe attendue", () => {
    expect(erreurDepuisReponse(401, undefined).code).toBe("NON_AUTHENTIFIE");
    expect(erreurDepuisReponse(403, "texte").code).toBe("ACCES_REFUSE");
    expect(erreurDepuisReponse(404, {}).code).toBe("INTROUVABLE");
    const e = erreurDepuisReponse(502, "<html>Bad gateway</html>");
    expect(e.code).toBe("SERVICE_INDISPONIBLE");
    expect(e.statut).toBe(502);
    expect(erreurDepuisReponse(418, undefined).code).toBe("ERREUR_INATTENDUE");
  });

  it("remplace un message vide", () => {
    expect(erreurDepuisReponse(500, { erreur: { code: "X", message: "" } }).message).not.toBe("");
  });
});

describe("appelerApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envoie le JSON, transmet le cookie et renvoie le corps", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await appelerApi<{ ok: boolean }>("/api/auth/connexion", {
      methode: "POST",
      corps: { email: "a@b.ci" },
      baseUrl: "http://api.test",
      cookie: "mp_session=abc",
    });
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/auth/connexion");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"email":"a@b.ci"}');
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>).Cookie).toBe("mp_session=abc");
  });

  it("lève une ErreurApi sur une réponse en échec", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              erreur: { code: "TROP_DE_TENTATIVES", message: "Trop de tentatives." },
            }),
            { status: 429 },
          ),
      ),
    );
    await expect(appelerApi("/api/x")).rejects.toMatchObject({
      code: "TROP_DE_TENTATIVES",
      statut: 429,
    });
  });

  it("traduit une coupure réseau en ErreurApi de statut 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(appelerApi("/api/x")).rejects.toMatchObject({
      code: "RESEAU_INDISPONIBLE",
      statut: 0,
      message: MESSAGE_RESEAU,
    });
  });
});

describe("champsRefuses et messageErreur", () => {
  it("liste les champs refusés par la validation de l'API", () => {
    const e = erreurDepuisReponse(400, {
      erreur: {
        code: "REQUETE_INVALIDE",
        message: "Données invalides.",
        details: { fieldErrors: { rccm: ["String must contain"] }, formErrors: [] },
      },
    });
    expect(champsRefuses(e)).toEqual(["rccm"]);
    expect(champsRefuses(new Error("x"))).toEqual([]);
  });

  it("ne montre jamais le message brut d'une validation (souvent en anglais)", () => {
    const e = erreurDepuisReponse(400, {
      erreur: { code: "REQUETE_INVALIDE", message: "Données invalides.", details: {} },
    });
    expect(messageErreur(e)).toMatch(/^Certaines valeurs ont été refusées/);
  });

  it("explique un refus de droit et garde les messages métier de l'API", () => {
    expect(messageErreur(new ErreurApi("INTERDIT", "x", 403))).toMatch(/Votre rôle/);
    expect(messageErreur(new ErreurApi("TFA_A_CONFIGURER", "x", 403))).toMatch(
      /Sécurité du compte/,
    );
    expect(messageErreur(new ErreurApi("CONFLIT", "Un client porte déjà ce RCCM.", 409))).toBe(
      "Un client porte déjà ce RCCM.",
    );
  });
});
