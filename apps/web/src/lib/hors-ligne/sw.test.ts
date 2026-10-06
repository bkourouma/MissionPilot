/**
 * Service worker (`public/sw.js`) exécuté dans un contexte isolé avec `self`, `caches`,
 * `fetch` et `indexedDB` simulés : la politique de cache est vérifiée sur le vrai fichier.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { IdbSimule } from "./test/idb-simule";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../../public/sw.js", import.meta.url)),
  "utf8",
);
const ORIGINE = "https://missionpilot.test";

type Gestionnaire = (e: unknown) => void;

class CachesSimules {
  readonly magasins = new Map<string, Map<string, Response>>();
  async open(nom: string) {
    let m = this.magasins.get(nom);
    if (!m) this.magasins.set(nom, (m = new Map()));
    const cle = (r: Request | string) => (typeof r === "string" ? new URL(r, ORIGINE).href : r.url);
    return {
      match: async (r: Request | string) => m.get(cle(r))?.clone(),
      put: async (r: Request | string, rep: Response) => void m.set(cle(r), rep),
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (r: Request) => m.delete(r.url),
    };
  }
  async keys() {
    return [...this.magasins.keys()];
  }
  async delete(nom: string) {
    return this.magasins.delete(nom);
  }
  urls() {
    return [...this.magasins.values()].flatMap((m) => [...m.keys()]);
  }
}

function charger(reseau: (r: Request) => Promise<Response>) {
  const gestionnaires = new Map<string, Gestionnaire>();
  const messages: unknown[] = [];
  const caches = new CachesSimules();
  const idb = new IdbSimule();
  const self = {
    location: { origin: ORIGINE },
    addEventListener: (type: string, f: Gestionnaire) => gestionnaires.set(type, f),
    skipWaiting: async () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ postMessage: (m: unknown) => messages.push(m) }],
    },
  };
  const appels: string[] = [];
  const fetch = async (r: Request | string, init?: RequestInit) => {
    const req = typeof r === "string" ? new Request(new URL(r, ORIGINE), init) : r;
    appels.push(`${req.method} ${new URL(req.url).pathname}${new URL(req.url).search}`);
    return reseau(req);
  };
  const contexte = vm.createContext({
    self,
    caches,
    fetch,
    indexedDB: idb.fabrique,
    URL,
    Request,
    Response,
    Headers,
    Promise,
  });
  vm.runInContext(SOURCE, contexte);

  async function demander(url: string, init: RequestInit & { mode?: string } = {}) {
    const { mode, ...reste } = init;
    const requete = new Request(new URL(url, ORIGINE), reste);
    if (mode === "navigate") Object.defineProperty(requete, "mode", { value: "navigate" });
    let reponse: Promise<Response> | undefined;
    const attentes: Promise<unknown>[] = [];
    gestionnaires.get("fetch")?.({
      request: requete,
      respondWith: (p: Promise<Response>) => (reponse = Promise.resolve(p)),
      waitUntil: (p: Promise<unknown>) => attentes.push(p),
    });
    const r = reponse ? await reponse : undefined;
    await Promise.all(attentes);
    return r;
  }
  async function evenement(type: string) {
    const attentes: Promise<unknown>[] = [];
    gestionnaires.get(type)?.({ waitUntil: (p: Promise<unknown>) => attentes.push(p) });
    await Promise.all(attentes);
  }
  return { demander, evenement, caches, appels, messages, idb, contexte };
}

const immuable = (corps = "js") =>
  new Response(corps, {
    status: 200,
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });

/** `Response` construite en Node : `type` vaut "default" ; le navigateur donne "basic". */
function basique(r: Response) {
  Object.defineProperty(r, "type", { value: "basic" });
  return r;
}

describe("service worker : politique de cache", () => {
  it("ne met jamais en cache une réponse d'API, même publique", async () => {
    const sw = charger(async () => basique(immuable('{"donnees":1}')));
    const r = await sw.demander("/api/feuilles-temps/semaine");
    expect(r).toBeUndefined(); // non interceptée : le navigateur la traite seul
    await sw.demander("/api/missions", { method: "POST", body: "{}" });
    expect(sw.caches.urls()).toEqual([]);
  });

  it("ne met jamais en cache une page ni une donnée de composant serveur (RSC)", async () => {
    const sw = charger(async () => basique(immuable("<html>données du cabinet</html>")));
    await sw.demander("/temps", { mode: "navigate" });
    await sw.demander("/temps?_rsc=abc");
    await sw.demander("/missions", { headers: { RSC: "1" } });
    await sw.demander("/_next/static/chunks/a.js?_rsc=1");
    expect(sw.caches.urls()).toEqual([]);
  });

  it("garde les fichiers statiques immuables du build (cache d'abord)", async () => {
    const sw = charger(async () => basique(immuable()));
    await sw.demander("/_next/static/chunks/app.js");
    const r = await sw.demander("/_next/static/chunks/app.js");
    expect(await r?.text()).toBe("js");
    expect(sw.appels.filter((a) => a.includes("app.js"))).toHaveLength(1);
    expect(sw.caches.urls()).toEqual([`${ORIGINE}/_next/static/chunks/app.js`]);
  });

  it("ne garde pas un statique sans `immutable`, `no-store` ou en erreur (développement)", async () => {
    const reponses = [
      new Response("x", { headers: { "Cache-Control": "no-store, must-revalidate" } }),
      new Response("x", { headers: { "Cache-Control": "public, max-age=60" } }),
      new Response("x", { status: 404, headers: { "Cache-Control": "immutable" } }),
    ];
    const sw = charger(async () => basique(reponses.shift() ?? new Response("")));
    await sw.demander("/_next/static/a.js");
    await sw.demander("/_next/static/b.js");
    await sw.demander("/_next/static/c.js");
    expect(sw.caches.urls()).toEqual([]);
  });

  it("ignore les autres origines et les requêtes non GET", async () => {
    const sw = charger(async () => basique(immuable()));
    expect(await sw.demander("https://ailleurs.test/_next/static/x.js")).toBeUndefined();
    expect(await sw.demander("/_next/static/x.js", { method: "POST", body: "x" })).toBeUndefined();
  });

  it("navigation hors ligne : page « hors ligne » en français, non mise en cache", async () => {
    const sw = charger(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await sw.demander('/temps?semaine="><script>', { mode: "navigate" });
    expect(r?.status).toBe(503);
    expect(r?.headers.get("Cache-Control")).toBe("no-store");
    const html = (await r?.text()) ?? "";
    expect(html).toContain('lang="fr"');
    expect(html).toContain("Vous êtes hors connexion");
    expect(html).not.toContain("<script>");
    expect(sw.caches.urls()).toEqual([]);
  });

  it("manifeste et icônes : réseau d'abord, cache en repli", async () => {
    let enLigne = true;
    const sw = charger(async () => {
      if (!enLigne) throw new TypeError("Failed to fetch");
      return basique(new Response("icone", { headers: { "Cache-Control": "public, max-age=0" } }));
    });
    await sw.demander("/icones/icone.svg");
    enLigne = false;
    const r = await sw.demander("/icones/icone.svg");
    expect(await r?.text()).toBe("icone");
  });
});

describe("service worker : versions et déconnexion", () => {
  it("à l'activation, supprime les caches « mp- » d'une autre version et garde les autres", async () => {
    const sw = charger(async () => basique(immuable()));
    await sw.caches.open("mp-statique-ancienne");
    await sw.caches.open("autre-application");
    await sw.evenement("install");
    await sw.demander("/_next/static/a.js");
    await sw.evenement("activate");
    const noms = await sw.caches.keys();
    expect(noms).not.toContain("mp-statique-ancienne");
    expect(noms).toContain("autre-application");
    expect(noms.some((n) => n.startsWith("mp-statique-"))).toBe(true);
  });

  it("le pré-cache ignore une redirection (ressource protégée)", async () => {
    const sw = charger(async (r) => {
      if (r.redirect === "error") throw new TypeError("redirection refusée");
      return basique(new Response("x"));
    });
    await sw.evenement("install");
    expect(sw.caches.urls()).toEqual([]);
  });

  it("déconnexion réussie : supprime la base hors ligne et prévient les onglets", async () => {
    const sw = charger(async () => new Response(null, { status: 204 }));
    await new Promise<void>((ok) => {
      const r = sw.idb.open("missionpilot-hors-ligne", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("saisies-temps", { keyPath: "cle" });
      r.onsuccess = () => {
        r.result.close();
        ok();
      };
    });
    expect(sw.idb.bases.has("missionpilot-hors-ligne")).toBe(true);
    const r = await sw.demander("/api/auth/deconnexion", { method: "POST" });
    expect(r?.status).toBe(204);
    expect(sw.idb.bases.has("missionpilot-hors-ligne")).toBe(false);
    expect(sw.messages).toEqual([{ type: "mp-purger-hors-ligne" }]);
  });

  it("déconnexion refusée : la file est gardée", async () => {
    const sw = charger(async () => new Response(null, { status: 500 }));
    await sw.demander("/api/auth/deconnexion", { method: "POST" });
    expect(sw.messages).toEqual([]);
  });
});
