import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LISTE_BLANCHE_PORTAIL } from "../src/portail/garde.js";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { inviterClient } from "./portail-outils.js";
import { preparerFacturation } from "./facturation-outils.js";
import {
  COOKIE_CABINET,
  COOKIE_PLATEFORME,
  UUID_INCONNU,
  cles,
  connexionPlateforme,
  creerCabinetParPlateforme,
  creerSuperAdmin,
  sessionCabinet,
  superAdminConnecte,
  valeurCookie,
} from "./plateforme-outils.js";

/*
 * Super admin de plateforme : sécurité et accès. Le super admin ne lit aucune donnée
 * métier ; aucun compte de cabinet ni du portail n'atteint /api/plateforme/*.
 */

let ctx: Contexte;
beforeAll(async () => {
  ctx = await demarrer();
}, 120_000);
afterAll(() => ctx.fermer());

const PREFIXE = "/api/plateforme";
type Methode = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const ATTENDUES = [
  "GET /api/plateforme/cabinets",
  "GET /api/plateforme/cabinets/:id/utilisateurs",
  "GET /api/plateforme/moi",
  "PATCH /api/plateforme/cabinets/:id",
  "PATCH /api/plateforme/cabinets/:id/utilisateurs/:uid",
  "POST /api/plateforme/cabinets",
  "POST /api/plateforme/cabinets/:id/utilisateurs",
  "POST /api/plateforme/connexion",
  "POST /api/plateforme/deconnexion",
];
/** Routes publiques de la plateforme (sans session exigée). */
const PUBLIQUES = ["POST /api/plateforme/connexion", "POST /api/plateforme/deconnexion"];

const routesDe = (filtre: (motif: string) => boolean) =>
  ctx.app.routesInventoriees.filter(
    (r) => r.methode !== "HEAD" && r.methode !== "OPTIONS" && filtre(r.motif),
  );
const routesPlateforme = () => routesDe((m) => m.startsWith(`${PREFIXE}/`));

/** URL concrète d'un motif : tout paramètre devient un UUID inconnu. */
const urlDe = (motif: string) => motif.replace(/:[A-Za-z_]+/g, UUID_INCONNU).replace(/\*$/, "x");

function appeler(methode: string, motif: string, entetes: Record<string, string> = {}) {
  const m = methode as Methode;
  return ctx.app.inject({
    method: m,
    url: urlDe(motif),
    headers: entetes,
    ...(m === "GET" ? {} : { payload: {} }),
  });
}

describe("inventaire des routes plateforme", () => {
  it("exactement les 9 routes du contrat, et aucune dans la liste blanche du portail", () => {
    const trouvees = routesPlateforme()
      .map((r) => `${r.methode} ${r.motif}`)
      .sort();
    expect(trouvees).toEqual([...ATTENDUES].sort());
    expect(LISTE_BLANCHE_PORTAIL.filter((r) => r.motif.startsWith(PREFIXE))).toEqual([]);
  });
});

describe("comptes de cabinet : aucun accès aux routes plateforme", () => {
  it("un associé de cabinet (cookie mp_session) reçoit 401 partout, hors connexion/déconnexion ; sa session survit", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const cookie = await sessionCabinet(ctx, c.associeEmail, c.motDePasse);
    const gardees = routesPlateforme().filter(
      (r) => !PUBLIQUES.includes(`${r.methode} ${r.motif}`),
    );
    expect(gardees).toHaveLength(7);
    for (const { methode, motif } of gardees) {
      const r = await appeler(methode, motif, { cookie });
      expect(r.statusCode, `${methode} ${motif}`).toBe(401);
      expect(r.json().erreur.code).toBe("NON_AUTHENTIFIE");
    }
    // Connexion plateforme : une session de cabinet n'y change rien (corps vide = 400).
    expect((await appeler("POST", `${PREFIXE}/connexion`, { cookie })).statusCode).toBe(400);
    // La déconnexion plateforme ne touche pas la session de cabinet.
    expect((await appeler("POST", `${PREFIXE}/deconnexion`, { cookie })).statusCode).toBe(200);
    expect((await api(ctx, cookie).get("/api/auth/moi")).statusCode).toBe(200);
  });

  it("sans aucun cookie : 401 partout, hors connexion/déconnexion", async () => {
    for (const { methode, motif } of routesPlateforme()) {
      if (PUBLIQUES.includes(`${methode} ${motif}`)) continue;
      const r = await appeler(methode, motif);
      expect(r.statusCode, `${methode} ${motif}`).toBe(401);
    }
  });

  it("un compte du portail client reçoit 403 PORTAIL_ROUTE_INTERDITE sur toutes les routes plateforme", async () => {
    const a = await preparerFacturation(ctx, "Portail et plateforme");
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    for (const { methode, motif } of routesPlateforme()) {
      const r = await appeler(methode, motif, { cookie: client.cookie });
      expect(r.statusCode, `${methode} ${motif}`).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  }, 120_000);
});

describe("super admin : aucun accès aux routes de cabinet, jetons non interchangeables", () => {
  it("le cookie mp_plateforme est refusé (401) par les routes de cabinet représentatives", async () => {
    const { cookie } = await superAdminConnecte(ctx);
    for (const url of [
      "/api/auth/moi",
      "/api/missions",
      "/api/utilisateurs",
      "/api/clients",
      "/api/cabinet",
      "/api/audit",
      "/api/collaborateurs",
      "/api/factures",
    ]) {
      const r = await api(ctx, cookie).get(url);
      expect(r.statusCode, url).toBe(401);
    }
  });

  it("un jeton de session de cabinet posé sous le nom mp_plateforme est refusé, et inversement", async () => {
    const { p, cookie: cookiePlateforme } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const cookieCabinet = await sessionCabinet(ctx, c.associeEmail, c.motDePasse);
    expect(cookieCabinet.startsWith(`${COOKIE_CABINET}=`)).toBe(true);
    expect(cookiePlateforme.startsWith(`${COOKIE_PLATEFORME}=`)).toBe(true);

    const jetonCabinet = valeurCookie(cookieCabinet);
    const jetonPlateforme = valeurCookie(cookiePlateforme);
    // Jeton de cabinet sous le nom plateforme.
    const sousNomPlateforme = `${COOKIE_PLATEFORME}=${jetonCabinet}`;
    for (const { methode, motif } of routesPlateforme()) {
      if (PUBLIQUES.includes(`${methode} ${motif}`)) continue;
      const r = await appeler(methode, motif, { cookie: sousNomPlateforme });
      expect(r.statusCode, `${methode} ${motif}`).toBe(401);
    }
    // Jeton plateforme sous le nom de cabinet.
    const sousNomCabinet = `${COOKIE_CABINET}=${jetonPlateforme}`;
    for (const url of ["/api/auth/moi", "/api/missions", "/api/utilisateurs", "/api/cabinet"]) {
      expect((await api(ctx, sousNomCabinet).get(url)).statusCode, url).toBe(401);
    }
    // Les deux sessions d'origine restent valides.
    expect((await p.get(`${PREFIXE}/moi`)).statusCode).toBe(200);
    expect((await api(ctx, cookieCabinet).get("/api/auth/moi")).statusCode).toBe(200);
    // Les deux cookies ensemble : chaque route lit le sien seulement.
    const les2 = `${cookieCabinet}; ${cookiePlateforme}`;
    expect((await api(ctx, les2).get(`${PREFIXE}/moi`)).statusCode).toBe(200);
    expect((await api(ctx, les2).get("/api/auth/moi")).statusCode).toBe(200);
  });
});

/*
 * Routes publiques (hors /api/plateforme) : elles ne dépendent d'aucune session, donc
 * le cookie plateforme n'y change rien. Chaque exception est justifiée ici ; leur
 * réponse peut être 400 (corps vide), 401, 404 ou 429, jamais un succès métier.
 */
const PUBLIQUES_HORS_PLATEFORME = new Map<string, string>([
  ["GET /api/sante", "sonde de santé : seul succès autorisé, aucune donnée"],
  ["POST /api/auth/connexion", "connexion de cabinet par identifiants"],
  ["POST /api/auth/connexion/2fa", "seconde étape de connexion (jeton de défi)"],
  ["POST /api/auth/deconnexion", "déconnexion tolérante : sans session de cabinet, rien à fermer"],
  ["GET /api/auth/comptes-demo", "connexion rapide de démonstration (absente hors démo)"],
  ["POST /api/auth/connexion-demo", "connexion rapide de démonstration (absente hors démo)"],
  ["POST /api/invitations/accepter", "le jeton d'invitation fait foi"],
  ["POST /api/portail/invitations/accepter", "le jeton d'invitation fait foi"],
  ["POST /api/canaux/whatsapp/webhook", "webhook public signé (absent sans fournisseur)"],
]);

describe("le super admin ne lit aucune donnée métier", () => {
  it("toutes les routes hors plateforme : 401 ou 404 avec le cookie plateforme seul (hors routes publiques listées)", async () => {
    const { cookie } = await superAdminConnecte(ctx);
    const routes = routesDe((m) => !m.startsWith(`${PREFIXE}/`));
    expect(routes.length).toBeGreaterThan(200);
    const ecarts: string[] = [];
    for (const { methode, motif } of routes) {
      const cle = `${methode} ${motif}`;
      const r = await appeler(methode, motif, { cookie });
      if (r.statusCode >= 500) ecarts.push(`${cle} -> ${r.statusCode}`);
      else if (PUBLIQUES_HORS_PLATEFORME.has(cle)) {
        // Jamais de succès, sauf la sonde de santé et la déconnexion de cabinet (200 idempotent).
        const succesAdmis = cle === "GET /api/sante" || cle === "POST /api/auth/deconnexion";
        if (r.statusCode < 400 && !succesAdmis) ecarts.push(`${cle} -> ${r.statusCode}`);
      } else if (r.statusCode !== 401 && r.statusCode !== 404) {
        ecarts.push(`${cle} -> ${r.statusCode}`);
      }
    }
    expect(ecarts).toEqual([]);
  }, 300_000);

  it("aucune réponse plateforme ne contient de champ hors liste attendue", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const base = `${PREFIXE}/cabinets/${c.cabinetId}`;
    const cabinet = ["actif", "creeLe", "estDemo", "id", "nom", "pays"];
    const utilisateur = ["actif", "creeLe", "email", "id", "nom", "roles"];
    const cree = await p.post(`${base}/utilisateurs`, {
      nom: "Cons",
      email: `cons-${Date.now()}@exemple.test`,
      roles: ["consultant"],
    });
    const cas: [string, { json(): unknown }, string[]][] = [
      ["GET /moi", await p.get(`${PREFIXE}/moi`), ["estDemo", "superAdmin", "id", "email", "nom"]],
      [
        "GET /cabinets",
        await p.get(`${PREFIXE}/cabinets`),
        [...cabinet, "elements", "nbUtilisateurs", "nbUtilisateursActifs"],
      ],
      ["PATCH /cabinets/:id", await p.patch(base, { nom: "Nom modifié" }), [...cabinet, "cabinet"]],
      ["GET utilisateurs", await p.get(`${base}/utilisateurs`), [...utilisateur, "elements"]],
      ["POST utilisateurs", cree, [...utilisateur, "utilisateur", "motDePasseGenere"]],
      [
        "PATCH utilisateur",
        await p.patch(
          `${base}/utilisateurs/${(cree.json() as { utilisateur: { id: string } }).utilisateur.id}`,
          {
            actif: false,
          },
        ),
        [...utilisateur, "utilisateur"],
      ],
    ];
    const nouveau = await p.post(`${PREFIXE}/cabinets`, {
      nom: `Cabinet cles ${Date.now()}`,
      associe: { nom: "A", email: `cles-${Date.now()}@exemple.test` },
    });
    cas.push([
      "POST /cabinets",
      nouveau,
      [...cabinet, ...utilisateur, "cabinet", "associe", "motDePasseGenere"],
    ]);
    const connexion = await connexionPlateforme(ctx, (await creerSuperAdmin()).email, "faux");
    expect(cles(connexion.json())).toEqual(expect.arrayContaining(["erreur"]));
    for (const [quoi, r, autorisees] of cas) {
      const inattendues = [...new Set(cles(r.json()))].filter((k) => !autorisees.includes(k));
      expect(inattendues, quoi).toEqual([]);
    }
  });
});

describe("cycle de vie de la session plateforme", () => {
  it("un super admin désactivé perd sa session existante et ne peut plus se reconnecter", async () => {
    const { admin, p } = await superAdminConnecte(ctx);
    expect((await p.get(`${PREFIXE}/moi`)).statusCode).toBe(200);
    await proprietaire((c) =>
      c.query("UPDATE super_admins SET actif = false WHERE id = $1", [admin.id]),
    );
    expect((await p.get(`${PREFIXE}/moi`)).statusCode).toBe(401);
    expect((await p.get(`${PREFIXE}/cabinets`)).statusCode).toBe(401);
    const r = await connexionPlateforme(ctx, admin.email, admin.motDePasse);
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur.code).toBe("IDENTIFIANTS_INVALIDES");
  });

  it("une session expirée est refusée (401)", async () => {
    const { admin, p } = await superAdminConnecte(ctx);
    expect((await p.get(`${PREFIXE}/moi`)).statusCode).toBe(200);
    await proprietaire((c) =>
      c.query(
        "UPDATE plateforme_sessions SET expire_le = now() - interval '1 minute' WHERE super_admin_id = $1",
        [admin.id],
      ),
    );
    expect((await p.get(`${PREFIXE}/moi`)).statusCode).toBe(401);
    expect((await p.get(`${PREFIXE}/cabinets`)).statusCode).toBe(401);
  });
});

describe("garde d'origine et isolation SQL", () => {
  it("POST /api/plateforme/connexion avec un Origin étranger : 403 ORIGINE_REFUSEE", async () => {
    const admin = await creerSuperAdmin();
    const r = await ctx.app.inject({
      method: "POST",
      url: `${PREFIXE}/connexion`,
      headers: { origin: "https://malveillant.example" },
      payload: { email: admin.email, motDePasse: admin.motDePasse },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("ORIGINE_REFUSEE");
    expect(r.cookies.find((x) => x.name === COOKIE_PLATEFORME)).toBeUndefined();
  });

  it("le rôle applicatif ne lit aucune table plateforme (permission denied)", async () => {
    for (const table of ["super_admins", "plateforme_sessions", "journal_plateforme"]) {
      await expect(
        ctx.db.withoutTenant((db) => db.query(`SELECT * FROM ${table}`)),
        table,
      ).rejects.toThrow(/permission denied|permission/i);
    }
    await expect(
      ctx.db.withoutTenant((db) => db.query("UPDATE super_admins SET actif = true")),
    ).rejects.toThrow(/permission/i);
  });
});
