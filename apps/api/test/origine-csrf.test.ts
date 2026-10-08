import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, origineDe, origineRefusee, originesAcceptees } from "../src/app.js";
import { api } from "./api.js";
import {
  configTest,
  connecter,
  creerCabinet,
  demarrer,
  MOT_DE_PASSE_TEST,
  type Contexte,
} from "./helpers.js";

/*
 * Garde d'origine globale (CSRF, `app.ts`) : une requête POST, PUT, PATCH ou DELETE dont
 * l'en-tête Origin n'est pas EXACTEMENT l'origine du web (WEB_ORIGIN) répond 403
 * ORIGINE_REFUSEE avant la session et la route ; sans Origin, elle suit son cours.
 */

let ctx: Contexte;
let web: string;

beforeAll(async () => {
  ctx = await demarrer();
  web = origineDe(ctx.config.WEB_ORIGIN);
});
afterAll(() => ctx.fermer());

const REFUS = { code: "ORIGINE_REFUSEE", message: "Requête refusée : origine non autorisée." };

/** Origines qu'un navigateur peut envoyer depuis un autre site ou une autre adresse. */
function originesRefusees(origineWeb: string): string[] {
  return [
    "https://malveillant.example",
    "null",
    `${origineWeb}.malveillant.example`, // suffixe
    `${origineWeb}0`, // préfixe (http://localhost:31000)
    origineWeb.replace(/:\d+$/, ""), // même hôte, port par défaut
    origineWeb.startsWith("https:") // autre schéma
      ? origineWeb.replace(/^https:/, "http:")
      : origineWeb.replace(/^http:/, "https:"),
    origineWeb.toUpperCase(),
    `${origineWeb}/`,
    origineWeb.replace("localhost", "localhost.malveillant.example"), // hôte voisin
  ].filter((o) => o !== origineWeb);
}

/** Requête anonyme ou avec session, et un en-tête Origin facultatif. */
function requete(
  method: "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  options: { origine?: string; cookie?: string; payload?: object; entetes?: object } = {},
) {
  return ctx.app.inject({
    method,
    url,
    headers: {
      ...(options.origine === undefined ? {} : { origin: options.origine }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.entetes,
    },
    ...(options.payload ? { payload: options.payload } : {}),
  });
}

describe("garde d'origine : fonctions pures", () => {
  it("origine de WEB_ORIGIN : schéma, hôte et port, sans chemin ni barre finale", () => {
    expect(origineDe("http://localhost:3100/")).toBe("http://localhost:3100");
    expect(origineDe("https://app.exemple.ci:443/chemin?x=1")).toBe("https://app.exemple.ci");
    expect(origineDe("HTTP://LocalHost:3100")).toBe("http://localhost:3100");
    // Valeur sans schéma : origine opaque « null », qui ne laisse rien passer (voir plus bas).
    expect(origineDe("localhost:3100")).toBe("null");
    expect(origineDe("pas une url")).toBe("pas une url");
  });

  it("méthodes modifiantes seulement ; Origin absent accepté ; null et listes refusés", () => {
    const w = "http://localhost:3100";
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(origineRefusee(m, w, w), m).toBe(false);
      expect(origineRefusee(m, undefined, w), m).toBe(false);
      expect(origineRefusee(m, "https://malveillant.example", w), m).toBe(true);
    }
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(origineRefusee(m, "https://malveillant.example", w), m).toBe(false);
    }
    expect(origineRefusee("POST", "null", w)).toBe(true);
    // WEB_ORIGIN illisible (origine « null ») : « null » reste refusé, rien ne passe.
    expect(origineRefusee("POST", "null", "null")).toBe(true);
    expect(origineRefusee("POST", "", w)).toBe(true);
    expect(origineRefusee("POST", [w, w], w)).toBe(true);
    for (const o of originesRefusees(w)) expect(origineRefusee("POST", o, w), o).toBe(true);
  });

  it("alias de boucle locale acceptés en développement et en test seulement", () => {
    const w = "http://localhost:3100";
    for (const env of ["development", "test", undefined]) {
      const ok = originesAcceptees(w, env);
      for (const o of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) {
        expect(origineRefusee("POST", o, ok), `${env} ${o}`).toBe(false);
      }
      // Autre port, autre schéma, autre hôte : toujours refusés.
      for (const o of [
        "http://127.0.0.1:3101",
        "https://localhost:3100",
        "http://evil.example:3100",
      ]) {
        expect(origineRefusee("POST", o, ok), `${env} ${o}`).toBe(true);
      }
    }
    // Production : aucun alias, seule la valeur exacte de WEB_ORIGIN.
    const prod = originesAcceptees(w, "production");
    expect(origineRefusee("POST", "http://127.0.0.1:3100", prod)).toBe(true);
    expect(origineRefusee("POST", w, prod)).toBe(false);
    // WEB_ORIGIN public : jamais d'alias, même en développement.
    const publique = originesAcceptees("https://app.exemple.ci", "development");
    expect(publique.size).toBe(1);
  });
});

describe("garde d'origine globale (CSRF)", () => {
  it("routes publiques : connexion et acceptation d'invitation forgées refusées, sans session posée", async () => {
    const { email } = await creerCabinet(ctx, "Cabinet Origine");
    const identifiants = { email, mot_de_passe: MOT_DE_PASSE_TEST };
    const forgee = await requete("POST", "/api/auth/connexion", {
      origine: "https://malveillant.example",
      payload: identifiants,
    });
    expect(forgee.statusCode).toBe(403);
    expect(forgee.json()).toEqual({ erreur: REFUS });
    expect(forgee.cookies).toHaveLength(0);
    // Depuis le web (relais Next : Origin du navigateur transmis) ou hors navigateur : connecté.
    for (const origine of [web, undefined]) {
      const r = await requete("POST", "/api/auth/connexion", { origine, payload: identifiants });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.cookies.length).toBeGreaterThan(0);
    }
    const invitation = { jeton: "a".repeat(43), nom: "Invité", mot_de_passe: MOT_DE_PASSE_TEST };
    const refusee = await requete("POST", "/api/invitations/accepter", {
      origine: "null",
      payload: invitation,
    });
    expect(refusee.statusCode).toBe(403);
    expect(refusee.json().erreur.code).toBe("ORIGINE_REFUSEE");
    // Depuis le web : la route répond elle-même (jeton inconnu), plus la garde.
    const duWeb = await requete("POST", "/api/invitations/accepter", {
      origine: web,
      payload: invitation,
    });
    expect(duWeb.json().erreur?.code).not.toBe("ORIGINE_REFUSEE");
  });

  it("lectures, sonde et pré-requêtes CORS ne sont pas concernées", async () => {
    const autre = "https://malveillant.example";
    expect((await requete("GET", "/api/sante", { origine: autre })).statusCode).toBe(200);
    expect((await requete("HEAD", "/api/sante", { origine: autre })).statusCode).toBe(200);
    const preRequete = await requete("OPTIONS", "/api/auth/connexion", {
      origine: autre,
      entetes: { "access-control-request-method": "POST" },
    });
    expect(preRequete.statusCode).toBe(204);
    // Le navigateur refusera la réponse : seule l'origine du web est autorisée par CORS.
    expect(preRequete.headers["access-control-allow-origin"]).toBe(ctx.config.WEB_ORIGIN);
  });

  it("toute méthode modifiante, même sur une route inconnue, avant la session", async () => {
    for (const methode of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const r = await requete(methode, "/api/route-inexistante", { origine: "null" });
      expect(r.statusCode, methode).toBe(403);
      expect(r.json()).toEqual({ erreur: REFUS });
      expect((await requete(methode, "/api/route-inexistante", { origine: web })).statusCode).toBe(
        404,
      );
    }
  });

  it("une session valide ne suffit pas : déconnexion forgée refusée, session intacte", async () => {
    const { email } = await creerCabinet(ctx, "Cabinet Origine Session");
    const cookie = await connecter(ctx, email);
    const forgee = await requete("POST", "/api/auth/deconnexion", {
      origine: `${web}.malveillant.example`,
      cookie,
    });
    expect(forgee.statusCode).toBe(403);
    expect(forgee.json()).toEqual({ erreur: REFUS });
    expect((await api(ctx, cookie).get("/api/auth/moi")).statusCode).toBe(200);
    // Lecture d'un autre site : non bloquée ici (SameSite=Lax et CORS s'en chargent).
    expect(
      (await requete("GET", "/api/auth/moi", { origine: "https://malveillant.example", cookie }))
        .statusCode,
    ).toBe(200);
    // Depuis le web : la déconnexion aboutit et la session est révoquée.
    expect(
      (await requete("POST", "/api/auth/deconnexion", { origine: web, cookie })).statusCode,
    ).toBe(200);
    expect((await api(ctx, cookie).get("/api/auth/moi")).statusCode).toBe(401);
  });

  it("comparaison exacte : ni suffixe, ni préfixe, ni casse, ni autre schéma, port ou nom d'hôte", async () => {
    for (const origine of originesRefusees(web)) {
      const r = await requete("POST", "/api/auth/deconnexion", { origine });
      expect(r.statusCode, origine).toBe(403);
      expect(r.json().erreur.code).toBe("ORIGINE_REFUSEE");
    }
    expect((await requete("POST", "/api/auth/deconnexion", { origine: web })).statusCode).toBe(200);
    expect((await requete("POST", "/api/auth/deconnexion")).statusCode).toBe(200);
  });

  it("WEB_ORIGIN avec chemin ou barre finale : comparé par son origine", async () => {
    const app = await buildApp({ ...configTest(), WEB_ORIGIN: `${web}/espace/` }, ctx.db);
    try {
      const deconnexion = (origine: string) =>
        app.inject({ method: "POST", url: "/api/auth/deconnexion", headers: { origin: origine } });
      expect((await deconnexion(web)).statusCode).toBe(200);
      expect((await deconnexion(`${web}/espace/`)).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
