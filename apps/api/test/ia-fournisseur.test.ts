import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  creerFournisseurOpenRouter,
  ErreurLlm,
  verifierUrlFournisseur,
  type EntreeJournalLlm,
  type RequeteLlm,
} from "../src/ia/fournisseur.js";
import { loadConfig } from "../src/config.js";
import { CLE_PLATEFORME_FACTICE, serveurFactice, type ServeurFactice } from "./ia-outils.js";

/*
 * Fournisseur OpenRouter contre un serveur HTTP FACTICE local : aucun appel
 * réseau externe, aucune vraie clé. Vérifie en-têtes, corps, reprises,
 * délai, plafond de taille, et l'absence de la clé et du contenu dans toute
 * erreur et tout journal.
 */

let serveur: ServeurFactice;
beforeAll(async () => {
  serveur = await serveurFactice();
});
afterAll(() => serveur.fermer());

const SECRET_PROMPT = "Données confidentielles du client Zeta";

function requete(extra: Partial<RequeteLlm> = {}): RequeteLlm {
  return {
    tache: "redaction",
    modele: "anthropic/claude-sonnet-4.5",
    messages: [
      { role: "system", content: "Consigne." },
      { role: "user", content: SECRET_PROMPT },
    ],
    maxTokens: 100,
    cleApi: CLE_PLATEFORME_FACTICE,
    ...extra,
  };
}

function fournisseur(journal: EntreeJournalLlm[], extra: { timeoutMs?: number } = {}) {
  const attentes: number[] = [];
  const f = creerFournisseurOpenRouter({
    baseUrl: `${serveur.url}/`,
    timeoutMs: extra.timeoutMs ?? 2000,
    referer: "http://localhost:3100",
    titre: "MissionPilot",
    journal: (e) => journal.push(e),
    attendre: async (ms) => {
      attentes.push(ms);
    },
    tailleMaxOctets: 10_000,
  });
  return { f, attentes };
}

/** Ni la clé, ni le prompt n'apparaissent dans ces sorties. */
function sansSecret(...sorties: unknown[]) {
  for (const s of sorties) {
    const texte =
      typeof s === "string" ? s : JSON.stringify(s, Object.getOwnPropertyNames(s ?? {}));
    expect(texte).not.toContain(CLE_PLATEFORME_FACTICE);
    expect(texte).not.toContain(SECRET_PROMPT);
  }
}

describe("fournisseur OpenRouter (ADR-003)", () => {
  it("POST {base}/chat/completions : authentification, attribution, corps, absence de rétention", async () => {
    serveur.requetes.length = 0;
    serveur.repondre(() => ({
      contenu: "Résumé.",
      usage: { prompt_tokens: 42, completion_tokens: 7 },
    }));
    const journal: EntreeJournalLlm[] = [];
    const r = await fournisseur(journal).f.completer(requete({ formatJson: true }));
    expect(r).toMatchObject({
      texte: "Résumé.",
      tokensEntree: 42,
      tokensSortie: 7,
      tokensEstimes: false,
    });
    const recue = serveur.requetes[0]!;
    expect(recue.methode).toBe("POST");
    expect(recue.chemin).toBe("/api/v1/chat/completions");
    expect(recue.entetes.authorization).toBe(`Bearer ${CLE_PLATEFORME_FACTICE}`);
    expect(recue.entetes["http-referer"]).toBe("http://localhost:3100");
    expect(recue.entetes["x-title"]).toBe("MissionPilot");
    expect(recue.corps).toMatchObject({
      model: "anthropic/claude-sonnet-4.5",
      max_tokens: 100,
      stream: false,
      response_format: { type: "json_object" },
      provider: { data_collection: "deny" },
    });
    expect(journal).toEqual([
      expect.objectContaining({ code: "OK", tokens_entree: 42, tokens_sortie: 7, tentatives: 1 }),
    ]);
    sansSecret(journal);
  });

  it("sans `usage`, les jetons sont estimés (prudemment)", async () => {
    serveur.repondre(() => ({ contenu: "abcdef", usage: null }));
    const r = await fournisseur([]).f.completer(requete());
    expect(r.tokensEstimes).toBe(true);
    expect(r.tokensSortie).toBe(2);
    expect(r.tokensEntree).toBeGreaterThan(0);
  });

  it("429 puis succès : reprise après l'attente demandée (Retry-After plafonné)", async () => {
    serveur.repondre((_r, n) =>
      n % 2 === 1
        ? { statut: 429, entetes: { "retry-after": "120" }, brut: "{}" }
        : { contenu: "OK" },
    );
    serveur.requetes.length = 0;
    const journal: EntreeJournalLlm[] = [];
    const { f, attentes } = fournisseur(journal);
    const r = await f.completer(requete());
    expect(r.texte).toBe("OK");
    expect(serveur.requetes).toHaveLength(2);
    expect(attentes).toEqual([10_000]);
    expect(journal[0]).toMatchObject({ code: "OK", tentatives: 2 });
  });

  it("5xx persistant : trois tentatives avec attente exponentielle, puis erreur réessayable", async () => {
    serveur.requetes.length = 0;
    serveur.repondre(() => ({ statut: 503, brut: `{"error":"${CLE_PLATEFORME_FACTICE}"}` }));
    const journal: EntreeJournalLlm[] = [];
    const { f, attentes } = fournisseur(journal);
    const erreur = await f.completer(requete()).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurLlm);
    expect(erreur).toMatchObject({
      code: "FOURNISSEUR_INDISPONIBLE",
      reessayable: true,
      statutHttp: 503,
    });
    expect(serveur.requetes).toHaveLength(3);
    expect(attentes).toEqual([500, 1000]);
    expect(journal).toEqual([
      expect.objectContaining({
        code: "FOURNISSEUR_INDISPONIBLE",
        statut_http: 503,
        tentatives: 3,
      }),
    ]);
    sansSecret(erreur, (erreur as Error).message, journal);
  });

  it("401 : clé refusée, sans reprise ; 400 : requête refusée ; 402 : crédit insuffisant", async () => {
    for (const [statut, code] of [
      [401, "CLE_REFUSEE"],
      [400, "REQUETE_REFUSEE"],
      [402, "CREDIT_FOURNISSEUR_INSUFFISANT"],
    ] as const) {
      serveur.requetes.length = 0;
      serveur.repondre(() => ({
        statut,
        brut: `{"error":{"message":"bad key ${CLE_PLATEFORME_FACTICE}"}}`,
      }));
      const erreur = await fournisseur([])
        .f.completer(requete())
        .catch((e: unknown) => e);
      expect(erreur).toMatchObject({ code, reessayable: false });
      expect(serveur.requetes).toHaveLength(1);
      sansSecret(erreur, (erreur as Error).message);
    }
  });

  it("délai dépassé : erreur DELAI_DEPASSE sans nouvelle tentative", async () => {
    serveur.requetes.length = 0;
    serveur.repondre(() => ({ silence: true }));
    const journal: EntreeJournalLlm[] = [];
    const erreur = await fournisseur(journal, { timeoutMs: 200 })
      .f.completer(requete())
      .catch((e: unknown) => e);
    expect(erreur).toMatchObject({ code: "DELAI_DEPASSE" });
    expect(serveur.requetes).toHaveLength(1);
    expect(journal[0]).toMatchObject({ code: "DELAI_DEPASSE" });
    sansSecret(erreur, journal);
  });

  it("réponse trop volumineuse ou illisible : refusée", async () => {
    serveur.repondre(() => ({ contenu: "x".repeat(20_000) }));
    await expect(fournisseur([]).f.completer(requete())).rejects.toMatchObject({
      code: "REPONSE_TROP_GRANDE",
    });
    serveur.repondre(() => ({ brut: "pas du json" }));
    await expect(fournisseur([]).f.completer(requete())).rejects.toMatchObject({
      code: "REPONSE_INVALIDE",
    });
    serveur.repondre(() => ({ brut: JSON.stringify({ choices: [] }) }));
    await expect(fournisseur([]).f.completer(requete())).rejects.toMatchObject({
      code: "REPONSE_INVALIDE",
    });
  });

  it("panne réseau (port fermé) : erreur réessayable sans message natif ni clé", async () => {
    const f = creerFournisseurOpenRouter({
      baseUrl: "http://127.0.0.1:9/api/v1",
      timeoutMs: 1000,
      tentativesMax: 2,
      attendre: async () => undefined,
    });
    const erreur = await f.completer(requete()).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ code: "FOURNISSEUR_INDISPONIBLE", reessayable: true });
    sansSecret(erreur, (erreur as Error).message);
  });

  it("URL du fournisseur : HTTPS obligatoire hors local ; configuration validée au chargement", () => {
    expect(() =>
      verifierUrlFournisseur({
        NODE_ENV: "production",
        OPENROUTER_BASE_URL: "http://127.0.0.1:1/x",
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      verifierUrlFournisseur({ NODE_ENV: "test", OPENROUTER_BASE_URL: "http://127.0.0.1:1/x" }),
    ).not.toThrow();
    const base = { ...process.env, NODE_ENV: "test" };
    expect(loadConfig(base).OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(loadConfig(base).IA_TIMEOUT_MS).toBe(60_000);
    expect(() => loadConfig({ ...base, OPENROUTER_BASE_URL: "http://evil.test/v1" })).toThrow();
    expect(() => loadConfig({ ...base, IA_TIMEOUT_MS: "10" })).toThrow();
  });

  it("constat 2 : plafond de plateforme : 50 USD par défaut, entier de 0 à 100 000 USD", () => {
    const base: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test" };
    delete base.IA_PLAFOND_PLATEFORME_MICRO_USD;
    expect(loadConfig(base).IA_PLAFOND_PLATEFORME_MICRO_USD).toBe(50_000_000);
    expect(
      loadConfig({ ...base, IA_PLAFOND_PLATEFORME_MICRO_USD: "2000000" })
        .IA_PLAFOND_PLATEFORME_MICRO_USD,
    ).toBe(2_000_000);
    for (const invalide of ["-1", "1.5", "abc", "100000000001"]) {
      expect(
        () => loadConfig({ ...base, IA_PLAFOND_PLATEFORME_MICRO_USD: invalide }),
        invalide,
      ).toThrow();
    }
  });
});
