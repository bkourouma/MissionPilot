import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import type { Config } from "../src/config.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { LISTE_BLANCHE_PORTAIL } from "../src/portail/garde.js";
import { configTest, creerCabinet, demarrer, MOT_DE_PASSE_TEST, proprietaire } from "./helpers.js";
import type { Contexte } from "./helpers.js";
import { COOKIE_PLATEFORME, creerSuperAdmin, UUID_INCONNU } from "./plateforme-outils.js";

/*
 * Connexion de démonstration « un clic » (routes/connexion-demo-public.ts) : session SANS
 * mot de passe, testée comme une porte dérobée potentielle. Cabinets, comptes, clients et
 * super admins sont créés par SQL propriétaire (`est_demo` n'est posé que par ce SQL) et
 * remis à faux / désactivés en afterAll pour ne pas polluer les autres fichiers.
 */

const suf = randomBytes(4).toString("hex");
let compteur = 0;
const adresse = (prefixe: string) => `${prefixe}-${suf}-${++compteur}@demo-routes.test`;

interface Instance {
  app: FastifyInstance;
  db: Database;
  config: Config;
}
async function instance(surcharge: Partial<Config>): Promise<Instance> {
  const config = { ...configTest(), ...surcharge };
  const db = createDatabase(config);
  return { app: await buildApp(config, db), db, config };
}
const fermer = async (i: Instance) => {
  await i.app.close();
  await i.db.close();
};

let ctx: Contexte;
let actif: Instance; // CONNEXION_RAPIDE_DEMO=oui (local)
let hash: string;
const cabinetsDemo: string[] = [];
const adminsDemo: string[] = [];

interface Compte {
  id: string;
  email: string;
  nom: string;
}

const sql = <T = Record<string, unknown>>(texte: string, params: unknown[] = []) =>
  proprietaire(async (c) => (await c.query(texte, params)).rows as T[]);

async function cabinet(nom: string, opts: { demo?: boolean; actif?: boolean } = {}) {
  const demo = opts.demo ?? true;
  const [r] = await sql<{ id: string }>(
    "INSERT INTO cabinets (nom, est_demo, actif) VALUES ($1, $2, $3) RETURNING id",
    [nom, demo, opts.actif ?? true],
  );
  if (demo) cabinetsDemo.push(r!.id);
  return r!.id;
}

async function compte(
  cabinetId: string,
  prefixe: string,
  nom: string,
  roles: string[],
): Promise<Compte> {
  const email = adresse(prefixe);
  const [r] = await sql<{ id: string }>(
    `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [cabinetId, email, nom, roles, hash],
  );
  return { id: r!.id, email, nom };
}

/** Compte du portail avec rattachement actif à un client actif ; renvoie aussi le client. */
async function comptePortail(cabinetId: string, prefixe: string, nom: string, role: string) {
  const c = await compte(cabinetId, prefixe, nom, [role]);
  const [client] = await sql<{ id: string }>(
    "INSERT INTO clients (cabinet_id, raison_sociale) VALUES ($1, $2) RETURNING id",
    [cabinetId, `Client ${suf} ${++compteur}`],
  );
  await sql(
    `INSERT INTO utilisateurs_portail (utilisateur_id, cabinet_id, client_id, statut)
     VALUES ($1, $2, $3, 'actif')`,
    [c.id, cabinetId, client!.id],
  );
  return { ...c, clientId: client!.id };
}

async function adminDemo(prefixe: string, opts: { demo?: boolean; actif?: boolean } = {}) {
  const demo = opts.demo ?? true;
  const email = adresse(prefixe);
  const [r] = await sql<{ id: string }>(
    `INSERT INTO super_admins (email, nom, mot_de_passe_hash, actif, est_demo)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [email, `Admin ${prefixe}`, hash, opts.actif ?? true, demo],
  );
  adminsDemo.push(r!.id);
  return { id: r!.id, email, nom: `Admin ${prefixe}` };
}

const lister = (i: Instance = actif) => i.app.inject({ method: "GET", url: "/api/auth/demo" });
const connexion = (
  cabinetId: unknown,
  email: unknown,
  entetes: Record<string, string> = {},
  i: Instance = actif,
) =>
  i.app.inject({
    method: "POST",
    url: "/api/auth/demo/connexion",
    headers: entetes,
    payload: { cabinetId, email } as object,
  });
const connexionPlateforme = (
  email: unknown,
  entetes: Record<string, string> = {},
  i: Instance = actif,
) =>
  i.app.inject({
    method: "POST",
    url: "/api/auth/demo/connexion-plateforme",
    headers: entetes,
    payload: { email } as object,
  });

const corpsInconnu = { erreur: { code: "COMPTE_DEMO_INCONNU" } };

// Jeu de données.
let alpha: string; // cabinet démo « Alpha »
let zeta: string; // cabinet démo « Zeta » (nom plus grand, créé en premier)
let reel: string; // cabinet réel (non démo)
let eteint: string; // cabinet démo désactivé
let a: Record<"associe" | "consultant" | "chef" | "dirigeant" | "investisseur", Compte>;
let zetaConsultant: Compte;
let zetaAssocie: Compte;
let reelCompte: Compte;
let eteintCompte: Compte;
let tfa: Compte;
let tfaObligatoire: Compte;
let cabinetTfaObligatoire: string;
let dirigeant: Compte & { clientId: string };
let adminA: { id: string; email: string; nom: string };

beforeAll(async () => {
  ctx = await demarrer();
  actif = await instance({ CONNEXION_RAPIDE_DEMO: "oui" });
  hash = await hashPassword(MOT_DE_PASSE_TEST);

  zeta = await cabinet(`Zeta Conseil ${suf}`);
  zetaConsultant = await compte(zeta, "z-consultant", "Zoé Consultante", ["consultant"]);
  zetaAssocie = await compte(zeta, "z-associe", "Zacharie Associé", ["associe"]);

  alpha = await cabinet(`Alpha Conseil ${suf}`);
  const consultant = await compte(alpha, "consultant", "Bruno Consultant", ["consultant"]);
  const chef = await compte(alpha, "chef", "Chantal Cheffe", ["chef_mission"]);
  const associe = await compte(alpha, "associe", "Awa Associée", ["associe"]);
  dirigeant = await comptePortail(alpha, "dirigeant", "Didier Dirigeant", "client_dirigeant");
  const investisseur = await comptePortail(
    alpha,
    "invest",
    "Inès Investisseuse",
    "client_investisseur",
  );
  a = { associe, consultant, chef, dirigeant, investisseur };
  // Comptes exclus : désactivé, mélange de familles, portail sans rattachement.
  const [off] = await sql<{ id: string }>(
    `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash, actif)
     VALUES ($1, $2, 'Compte Désactivé', '{consultant}', $3, false) RETURNING id`,
    [alpha, adresse("desactive"), hash],
  );
  expect(off).toBeDefined();
  await compte(alpha, "sans-rattachement", "Portail Orphelin", ["client_dirigeant"]);

  tfa = await compte(alpha, "tfa", "Théo Deuxfa", ["consultant"]);
  await sql(
    `INSERT INTO utilisateurs_2fa (utilisateur_id, cabinet_id, secret_chiffre, cle_version, active_le)
     VALUES ($1, $2, $3, 1, now())`,
    [tfa.id, alpha, randomBytes(48)],
  );

  cabinetTfaObligatoire = await cabinet(`Obligatoire ${suf}`);
  tfaObligatoire = await compte(cabinetTfaObligatoire, "oblig", "Olga Obligée", ["associe"]);
  await sql("UPDATE cabinets SET tfa_obligatoire = '{associe}' WHERE id = $1", [
    cabinetTfaObligatoire,
  ]);

  eteint = await cabinet(`Éteint ${suf}`, { actif: false });
  eteintCompte = await compte(eteint, "eteint", "Compte Éteint", ["consultant"]);

  reel = await cabinet(`Réel ${suf}`, { demo: false });
  reelCompte = await compte(reel, "reel", "Compte Réel", ["consultant"]);

  adminA = await adminDemo("aaa-demo");
  await adminDemo("aaa-desactive", { actif: false });
  await creerSuperAdmin(); // super admin réel (est_demo faux par défaut)
});

afterAll(async () => {
  await sql("UPDATE cabinets SET est_demo = false WHERE id = ANY ($1)", [cabinetsDemo]);
  await sql("UPDATE super_admins SET est_demo = false, actif = false WHERE id = ANY ($1)", [
    adminsDemo,
  ]);
  await fermer(actif);
  await ctx.fermer();
});

describe("démo : liste GET /api/auth/demo", () => {
  it("forme exacte, tri, filtre des exclus", async () => {
    const r = await lister();
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const corps = r.json();
    expect(Object.keys(corps).sort()).toEqual(["actif", "cabinets", "superAdmin"]);
    expect(corps.actif).toBe(true);
    expect(corps.superAdmin).toEqual({ email: adminA.email, nom: adminA.nom });

    const miens = (corps.cabinets as { id: string }[]).filter((c) => cabinetsDemo.includes(c.id));
    // Alpha avant Zeta (tri par nom), cabinets désactivé et réel absents.
    expect(miens.map((c) => c.id)).toEqual([alpha, cabinetTfaObligatoire, zeta]);
    expect(corps.cabinets.map((c: { id: string }) => c.id)).not.toContain(eteint);
    expect(corps.cabinets.map((c: { id: string }) => c.id)).not.toContain(reel);

    const parId = new Map(miens.map((c) => [c.id, c]));
    expect(parId.get(alpha)).toEqual({
      id: alpha,
      nom: `Alpha Conseil ${suf}`,
      comptes: [
        { email: a.associe.email, nom: a.associe.nom, roles: ["associe"], portail: false },
        { email: a.chef.email, nom: a.chef.nom, roles: ["chef_mission"], portail: false },
        { email: a.consultant.email, nom: a.consultant.nom, roles: ["consultant"], portail: false },
        { email: tfa.email, nom: tfa.nom, roles: ["consultant"], portail: false },
        { email: dirigeant.email, nom: dirigeant.nom, roles: ["client_dirigeant"], portail: true },
        {
          email: a.investisseur.email,
          nom: a.investisseur.nom,
          roles: ["client_investisseur"],
          portail: true,
        },
      ],
    });
    expect(parId.get(zeta)!).toMatchObject({
      comptes: [{ email: zetaAssocie.email }, { email: zetaConsultant.email }],
    });
    expect(r.body).not.toContain(eteintCompte.email);
    expect(r.body).not.toContain(reelCompte.email);
    expect(r.body).not.toContain("sans-rattachement");
    expect(r.body).not.toContain("desactive");
  });

  it("super admin : réel et démo désactivé absents (un seul, démo actif)", async () => {
    const r = await lister();
    expect(r.body).not.toContain("aaa-desactive");
    expect(r.json().superAdmin.email).toBe(adminA.email);
  });

  it("aucune fuite : seule la clé id des cabinets, ni haché, ni identifiant d'utilisateur ou de client", async () => {
    const r = await lister();
    const corps = r.json();
    const cles = new Set<string>();
    const parcourir = (v: unknown, chemin: string) => {
      if (Array.isArray(v)) v.forEach((x) => parcourir(x, chemin));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          cles.add(`${chemin}.${k}`);
          parcourir(x, `${chemin}.${k}`);
        }
    };
    parcourir(corps, "$");
    expect([...cles].filter((c) => /\.id$/.test(c))).toEqual(["$.cabinets.id"]);
    for (const c of corps.cabinets)
      for (const x of c.comptes)
        expect(Object.keys(x).sort()).toEqual(["email", "nom", "portail", "roles"]);
    expect(r.body).not.toMatch(/hash|mot_de_passe|scrypt|\$argon|jeton/i);
    for (const id of [a.associe.id, a.consultant.id, dirigeant.id, dirigeant.clientId, adminA.id])
      expect(r.body).not.toContain(id);
  });

  it("404 sans DEMO_PUBLIQUE ni connexion rapide locale", async () => {
    const ferme = await instance({ DEMO_PUBLIQUE: "non", CONNEXION_RAPIDE_DEMO: "non" });
    try {
      const inconnue = await ferme.app.inject({ method: "GET", url: "/api/auth/inexistante" });
      const liste = await lister(ferme);
      expect(liste.statusCode).toBe(404);
      expect(liste.json().error).toBe(inconnue.json().error);
      expect((await connexion(alpha, a.associe.email, {}, ferme)).statusCode).toBe(404);
      expect((await connexionPlateforme(adminA.email, {}, ferme)).statusCode).toBe(404);
    } finally {
      await fermer(ferme);
    }
  });

  it("actif avec DEMO_PUBLIQUE=oui, sans connexion rapide", async () => {
    const publique = await instance({ DEMO_PUBLIQUE: "oui", CONNEXION_RAPIDE_DEMO: "non" });
    try {
      const r = await lister(publique);
      expect(r.statusCode).toBe(200);
      expect(r.json().actif).toBe(true);
    } finally {
      await fermer(publique);
    }
  });

  it("actif avec DEMO_PUBLIQUE=oui en configuration NODE_ENV=production (buildApp l'accepte)", async () => {
    const prod = await instance({
      NODE_ENV: "production",
      MAIL_FROM: "demo@exemple.test",
      SMTP_HOST: "smtp.exemple.test", // exigé hors développement ; aucune connexion à la construction
      DEMO_PUBLIQUE: "oui",
      CONNEXION_RAPIDE_DEMO: "non",
    });
    try {
      const r = await lister(prod);
      expect(r.statusCode).toBe(200);
      expect(r.json().actif).toBe(true);
    } finally {
      await fermer(prod);
    }
  });
});

describe("démo : connexion cabinet", () => {
  const moi = (cookie: string) =>
    actif.app.inject({ method: "GET", url: "/api/auth/moi", headers: { cookie } });

  it("rôle de cabinet : réponse identique à la connexion normale, /moi renvoie le bon compte", async () => {
    const r = await connexion(alpha, a.chef.email.toUpperCase());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, etape: "connecte" });
    expect(r.headers["cache-control"]).toBe("no-store");
    const c = r.cookies[0]!;
    expect(c.name).toBe("mp_session");
    expect(c.httpOnly).toBe(true);
    const m = await moi(`${c.name}=${c.value}`);
    expect(m.statusCode).toBe(200);
    expect(m.json()).toMatchObject({
      utilisateur: { id: a.chef.id, email: a.chef.email, roles: ["chef_mission"] },
      cabinet_id: alpha,
      portail: false,
    });
    const [audit] = await sql<{ details: unknown }>(
      `SELECT details FROM journal_audit WHERE cabinet_id = $1 AND utilisateur_id = $2
       AND action = 'connexion' ORDER BY id DESC LIMIT 1`,
      [alpha, a.chef.id],
    );
    expect(audit!.details).toEqual({ demo: true });
  });

  it("compte du portail avec rattachement actif : session portail fonctionnelle", async () => {
    const r = await connexion(alpha, dirigeant.email);
    expect(r.statusCode).toBe(200);
    const c = r.cookies[0]!;
    const cookie = `${c.name}=${c.value}`;
    const m = await moi(cookie);
    expect(m.json()).toMatchObject({
      utilisateur: { id: dirigeant.id, roles: ["client_dirigeant"] },
      cabinet_id: alpha,
      portail: true,
    });
    const interne = await actif.app.inject({
      method: "GET",
      url: "/api/missions",
      headers: { cookie },
    });
    expect(interne.statusCode).toBe(403);
  });

  it("cabinet réel, super admin réel, cabinet désactivé, cabinetId inconnu ou inadéquat : 401 uniforme sans cookie", async () => {
    const cas: [unknown, string][] = [
      [reel, reelCompte.email],
      [eteint, eteintCompte.email],
      [UUID_INCONNU, a.chef.email],
      [zeta, a.chef.email], // compte d'un autre cabinet démo
      [alpha, reelCompte.email],
      [alpha, adresse("absent")],
      [alpha, a.chef.email.replace("chef", "chef-x")],
    ];
    const reponses = [];
    for (const [cabinetId, email] of cas) reponses.push(await connexion(cabinetId, email));
    for (const r of reponses) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject(corpsInconnu);
      expect(r.body).toBe(reponses[0]!.body);
      expect(r.cookies).toHaveLength(0);
    }
  });

  it("2FA active : 403 CONNEXION_RAPIDE_2FA, sans cookie", async () => {
    const r = await connexion(alpha, tfa.email);
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("CONNEXION_RAPIDE_2FA");
    expect(r.cookies).toHaveLength(0);
  });

  it("2FA obligatoire pour le rôle du cabinet : 403 CONNEXION_RAPIDE_2FA, sans cookie", async () => {
    const r = await connexion(cabinetTfaObligatoire, tfaObligatoire.email);
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("CONNEXION_RAPIDE_2FA");
    expect(r.cookies).toHaveLength(0);
  });

  it("corps invalide, champ en trop ou manquant : 400, sans cookie", async () => {
    const mauvais: object[] = [
      { cabinetId: "pas-un-uuid", email: a.chef.email },
      { cabinetId: alpha, email: "pas-un-email" },
      { cabinetId: alpha, email: a.chef.email, motDePasse: "x" },
      { email: a.chef.email },
      { cabinetId: alpha },
    ];
    for (const payload of mauvais) {
      const r = await actif.app.inject({
        method: "POST",
        url: "/api/auth/demo/connexion",
        payload,
      });
      expect(r.statusCode).toBe(400);
      expect(r.cookies).toHaveLength(0);
    }
  });

  it("garde d'origine : un autre site est refusé, l'origine du web passe", async () => {
    const refus = await connexion(alpha, a.consultant.email, {
      origin: "https://malveillant.test",
    });
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("ORIGINE_REFUSEE");
    expect(refus.cookies).toHaveLength(0);
    const refusPlateforme = await connexionPlateforme(adminA.email, {
      origin: "https://malveillant.test",
    });
    expect(refusPlateforme.statusCode).toBe(403);
    const ok = await connexion(alpha, a.consultant.email, { origin: actif.config.WEB_ORIGIN });
    expect(ok.statusCode).toBe(200);
  });

  it("limiteur : 10 essais puis 429 ; succès répétés non bloqués", async () => {
    const email = adresse("enumeration");
    for (let i = 0; i < 10; i++) expect((await connexion(alpha, email)).statusCode).toBe(401);
    expect((await connexion(alpha, email)).statusCode).toBe(429);
    for (let i = 0; i < 12; i++)
      expect((await connexion(alpha, a.investisseur.email)).statusCode).toBe(200);
  });

  it("limiteur : chaque refus 2FA compte", async () => {
    let derniere = 0;
    for (let i = 0; i < 11; i++) derniere = (await connexion(alpha, tfa.email)).statusCode;
    expect(derniere).toBe(429);
  });
});

describe("démo : connexion plateforme", () => {
  it("super admin démo : cookie mp_plateforme, /api/plateforme/moi, journal demo:true", async () => {
    const r = await connexionPlateforme(adminA.email.toUpperCase());
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.json()).toEqual({
      ok: true,
      superAdmin: { id: adminA.id, email: adminA.email, nom: adminA.nom },
    });
    const c = r.cookies.find((x) => x.name === COOKIE_PLATEFORME)!;
    expect(c.httpOnly).toBe(true);
    const m = await actif.app.inject({
      method: "GET",
      url: "/api/plateforme/moi",
      headers: { cookie: `${c.name}=${c.value}` },
    });
    expect(m.statusCode).toBe(200);
    expect(m.json().superAdmin).toMatchObject({
      id: adminA.id,
      email: adminA.email,
      estDemo: true,
    });
    const lignes = await sql<{ details: unknown }>(
      `SELECT details FROM journal_plateforme WHERE super_admin_id = $1 AND action = 'connexion'`,
      [adminA.id],
    );
    expect(lignes.some((l) => (l.details as { demo?: boolean }).demo === true)).toBe(true);
  });

  it("super admin réel, démo désactivé, e-mail inconnu : 401 uniforme sans cookie", async () => {
    const reelAdmin = await creerSuperAdmin();
    const desactive = await adminDemo("zzz-off", { actif: false });
    const reponses = [];
    for (const email of [reelAdmin.email, desactive.email, adresse("inconnu")])
      reponses.push(await connexionPlateforme(email));
    for (const r of reponses) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject(corpsInconnu);
      expect(r.body).toBe(reponses[0]!.body);
      expect(r.cookies).toHaveLength(0);
    }
  });

  it("un compte de cabinet n'ouvre pas de session plateforme", async () => {
    expect((await connexionPlateforme(a.associe.email)).statusCode).toBe(401);
  });

  it("corps invalide ou champ en trop : 400", async () => {
    for (const payload of [{ email: "nope" }, {}, { email: adminA.email, cabinetId: alpha }]) {
      const r = await actif.app.inject({
        method: "POST",
        url: "/api/auth/demo/connexion-plateforme",
        payload,
      });
      expect(r.statusCode).toBe(400);
      expect(r.cookies).toHaveLength(0);
    }
  });

  it("limiteur : 10 essais puis 429", async () => {
    const email = adresse("enum-plateforme");
    for (let i = 0; i < 10; i++) expect((await connexionPlateforme(email)).statusCode).toBe(401);
    expect((await connexionPlateforme(email)).statusCode).toBe(429);
  });
});

describe("démo : portail", () => {
  it("aucune entrée /api/auth/demo dans la liste blanche du portail", () => {
    expect(JSON.stringify(LISTE_BLANCHE_PORTAIL)).not.toContain("/demo");
    expect(LISTE_BLANCHE_PORTAIL.some((r) => r.motif.includes("/api/auth/demo"))).toBe(false);
  });
});

// Le cabinet réel créé par le helper ne sert qu'à vérifier qu'il n'est jamais listé.
describe("démo : cabinet réel du helper", () => {
  it("n'est ni listé ni connectable", async () => {
    const reelHelper = await creerCabinet(ctx, "Cabinet réel helper");
    expect((await lister()).body).not.toContain(reelHelper.cabinetId);
    const r = await connexion(reelHelper.cabinetId, reelHelper.email);
    expect(r.statusCode).toBe(401);
  });
});
