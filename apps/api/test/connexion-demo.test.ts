import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import type { Config } from "../src/config.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { emailAbidjan, NOM_CABINET_ABIDJAN } from "../src/db/seed-demo.js";
import {
  COMPTE_ANCRE_DEMO,
  DOMAINE_DEMO,
  MAX_COMPTES_DEMO,
  NOM_CABINET_DEMO,
} from "../src/routes/connexion-demo.js";
import { configTest, MOT_DE_PASSE_TEST, proprietaire } from "./helpers.js";

/*
 * Connexion rapide de démonstration (routes/connexion-demo.ts) : session SANS
 * mot de passe, à tester comme une porte dérobée potentielle. Le cabinet de
 * démonstration est recréé ici sous la forme du seed (`db/seed-demo.ts`) : même
 * nom, compte fondateur `associe@lagune-conseil.test` créé par `creer_cabinet`.
 */

const ANCRE = COMPTE_ANCRE_DEMO;
const CONSULTANT = `consultant${DOMAINE_DEMO}`;
const DESACTIVE = `desactive${DOMAINE_DEMO}`;
const AVEC_2FA = `tfa${DOMAINE_DEMO}`;
const PORTAIL = `client.portail${DOMAINE_DEMO}`; // rôle client SANS rattachement : jamais listé
// Comptes du portail de démonstration (db/seed-demo-portail.ts), avec rattachement actif.
const DIRIGEANT = `dirigeant.client${DOMAINE_DEMO}`;
const CONTRIBUTEUR = `contributeur.client${DOMAINE_DEMO}`;
const INVESTISSEUR = `investisseur.client${DOMAINE_DEMO}`;
const SUSPENDU = `suspendu.client${DOMAINE_DEMO}`; // rattachement désactivé
const CLIENT_ARCHIVE = `archive.client${DOMAINE_DEMO}`; // client archivé
const PORTAIL_AUTRE_DOMAINE = `hors.client-${Date.now()}@exemple.test`;
const PORTAIL_INTRUS = `intrus.client${DOMAINE_DEMO}`; // autre cabinet, même domaine
const PORTAIL_JUMEAU = `jumeau.client${DOMAINE_DEMO}`; // cabinet homonyme sans compte fondateur
const AUTRE_DOMAINE = `hors.domaine-${Date.now()}@exemple.test`;
const INTRUS = `intrus${DOMAINE_DEMO}`; // autre cabinet, même domaine
const JUMEAU = `jumeau${DOMAINE_DEMO}`; // cabinet homonyme sans le compte fondateur

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

let active: Instance;
let inactive: Instance;
let cabinetDemo: string;
let consultantId: string;
let dirigeantId: string;
let hash: string;

const corpsInconnu = { erreur: { code: "COMPTE_DEMO_INCONNU" } };

const lister = (i: Instance = active) =>
  i.app.inject({ method: "GET", url: "/api/auth/comptes-demo" });
const connexionDemo = (
  email: unknown,
  i: Instance = active,
  entetes: Record<string, string> = {},
) =>
  i.app.inject({
    method: "POST",
    url: "/api/auth/connexion-demo",
    headers: entetes,
    payload: { email } as object,
  });

async function creerCabinet(nom: string, email: string, nomAssocie: string): Promise<string> {
  return active.db.withoutTenant(async (db) => {
    const r = await db.query("SELECT creer_cabinet($1, 'CI', $2, $3, $4) AS id", [
      nom,
      email,
      nomAssocie,
      hash,
    ]);
    return r.rows[0].id as string;
  });
}

async function creerClient(cabinetId: string, nom: string, actif = true): Promise<string> {
  return proprietaire(async (c) => {
    const r = await c.query(
      "INSERT INTO clients (cabinet_id, raison_sociale, actif) VALUES ($1, $2, $3) RETURNING id",
      [cabinetId, nom, actif],
    );
    return r.rows[0].id as string;
  });
}

async function rattacher(
  cabinetId: string,
  utilisateurId: string,
  clientId: string,
  statut: "actif" | "desactive" = "actif",
) {
  await proprietaire((c) =>
    c.query(
      `INSERT INTO utilisateurs_portail (utilisateur_id, cabinet_id, client_id, statut)
       VALUES ($1, $2, $3, $4)`,
      [utilisateurId, cabinetId, clientId, statut],
    ),
  );
}

async function ajouter(cabinetId: string, email: string, nom: string, roles: string[]) {
  return proprietaire(async (c) => {
    const r = await c.query(
      `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cabinetId, email, nom, roles, hash],
    );
    return r.rows[0].id as string;
  });
}

beforeAll(async () => {
  active = await instance({ CONNEXION_RAPIDE_DEMO: "oui" });
  inactive = await instance({ CONNEXION_RAPIDE_DEMO: "non" });
  hash = await hashPassword(MOT_DE_PASSE_TEST);
  cabinetDemo = await creerCabinet(NOM_CABINET_DEMO, ANCRE, "Awa Koné");
  consultantId = await ajouter(cabinetDemo, CONSULTANT, "Koffi N'Guessan", ["consultant"]);
  const desactive = await ajouter(cabinetDemo, DESACTIVE, "Ancien Compte", ["consultant"]);
  await proprietaire((c) =>
    c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [desactive]),
  );
  const tfa = await ajouter(cabinetDemo, AVEC_2FA, "Mariam Traoré", ["chef_mission"]);
  await proprietaire((c) =>
    c.query(
      `INSERT INTO utilisateurs_2fa (utilisateur_id, cabinet_id, secret_chiffre, cle_version, active_le)
       VALUES ($1, $2, $3, 1, now())`,
      [tfa, cabinetDemo, randomBytes(48)],
    ),
  );
  await ajouter(cabinetDemo, PORTAIL, "Client Portail", ["client_dirigeant"]);
  await ajouter(cabinetDemo, AUTRE_DOMAINE, "Hors Domaine", ["consultant"]);
  const voisin = await creerCabinet("Cabinet voisin", INTRUS, "Intrus Voisin");
  const jumeau = await creerCabinet(NOM_CABINET_DEMO, JUMEAU, "Jumeau Homonyme");

  // Portail : un client actif de la démo, trois comptes rattachés, et les cas à exclure.
  const client = await creerClient(cabinetDemo, "Cacao Savane Export (fictif)");
  dirigeantId = await ajouter(cabinetDemo, DIRIGEANT, "Jean-Baptiste Kouadio", [
    "client_dirigeant",
  ]);
  await rattacher(cabinetDemo, dirigeantId, client);
  const contributeur = await ajouter(cabinetDemo, CONTRIBUTEUR, "Nadège Yapi", [
    "client_contributeur",
  ]);
  await rattacher(cabinetDemo, contributeur, client);
  const investisseur = await ajouter(cabinetDemo, INVESTISSEUR, "Moussa Coulibaly", [
    "client_investisseur",
  ]);
  await rattacher(cabinetDemo, investisseur, client);
  const suspendu = await ajouter(cabinetDemo, SUSPENDU, "Compte Suspendu", ["client_dirigeant"]);
  await rattacher(cabinetDemo, suspendu, client, "desactive");
  const archive = await ajouter(cabinetDemo, CLIENT_ARCHIVE, "Client Archivé", [
    "client_dirigeant",
  ]);
  await rattacher(cabinetDemo, archive, await creerClient(cabinetDemo, "Client archivé", false));
  const horsDomaine = await ajouter(cabinetDemo, PORTAIL_AUTRE_DOMAINE, "Client Hors Domaine", [
    "client_dirigeant",
  ]);
  await rattacher(cabinetDemo, horsDomaine, client);
  for (const [cabinetId, email] of [
    [voisin, PORTAIL_INTRUS],
    [jumeau, PORTAIL_JUMEAU],
  ] as const) {
    const u = await ajouter(cabinetId, email, "Client Voisin", ["client_dirigeant"]);
    await rattacher(cabinetId, u, await creerClient(cabinetId, "Client voisin"));
  }
});

afterAll(async () => {
  for (const i of [active, inactive]) {
    await i.app.close();
    await i.db.close();
  }
});

describe("connexion rapide de démonstration : désactivée", () => {
  // Valeur par défaut « non » : test/config.test.ts.
  it("sans « oui », les routes n'existent pas (404 comme une adresse inconnue)", async () => {
    const inconnue = await inactive.app.inject({ method: "GET", url: "/api/auth/inexistante" });
    const liste = await lister(inactive);
    const connexion = await connexionDemo(CONSULTANT, inactive);
    expect(liste.statusCode).toBe(404);
    expect(connexion.statusCode).toBe(404);
    expect(liste.json().error).toBe(inconnue.json().error);
    expect(connexion.cookies).toHaveLength(0);
  });
});

describe("connexion rapide de démonstration : liste", () => {
  it("alignée sur le seed de démonstration (nom du cabinet, domaine, compte fondateur)", () => {
    expect(NOM_CABINET_DEMO).toBe(NOM_CABINET_ABIDJAN);
    expect(ANCRE).toBe(emailAbidjan("associe"));
    expect(emailAbidjan("x").endsWith(DOMAINE_DEMO)).toBe(true);
  });

  it("publique, sans session : comptes actifs du cabinet de démo (cabinet puis portail), triés par rôle", async () => {
    const r = await lister();
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.json()).toEqual({
      elements: [
        { email: ANCRE, nom: "Awa Koné", roles: ["associe"] },
        { email: AVEC_2FA, nom: "Mariam Traoré", roles: ["chef_mission"] },
        { email: CONSULTANT, nom: "Koffi N'Guessan", roles: ["consultant"] },
        { email: DIRIGEANT, nom: "Jean-Baptiste Kouadio", roles: ["client_dirigeant"] },
        { email: CONTRIBUTEUR, nom: "Nadège Yapi", roles: ["client_contributeur"] },
        { email: INVESTISSEUR, nom: "Moussa Coulibaly", roles: ["client_investisseur"] },
      ],
    });
  });

  it("aucun champ sensible : ni identifiant, ni haché, ni cabinet", async () => {
    const r = await lister();
    for (const e of r.json().elements)
      expect(Object.keys(e).sort()).toEqual(["email", "nom", "roles"]);
    expect(r.body).not.toMatch(/hash|mot_de_passe|scrypt|\$/);
    expect(r.body).not.toContain(consultantId);
    expect(r.body).not.toContain(cabinetDemo);
  });

  it("exclut désactivé, autre domaine, autre cabinet du même domaine, cabinet homonyme", async () => {
    const body = (await lister()).body;
    for (const email of [DESACTIVE, AUTRE_DOMAINE, INTRUS, JUMEAU]) {
      expect(body).not.toContain(email);
    }
  });

  it("exclut un compte portail sans rattachement actif, d'un client archivé, hors domaine ou hors du cabinet de démo", async () => {
    const body = (await lister()).body;
    for (const email of [
      PORTAIL,
      SUSPENDU,
      CLIENT_ARCHIVE,
      PORTAIL_AUTRE_DOMAINE,
      PORTAIL_INTRUS,
      PORTAIL_JUMEAU,
    ]) {
      expect(body).not.toContain(email);
    }
  });
});

describe("connexion rapide de démonstration : ouverture de session", () => {
  it("compte de démo sans 2FA : session ouverte comme la connexion normale", async () => {
    const r = await connexionDemo(CONSULTANT);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, etape: "connecte" });
    expect(r.headers["cache-control"]).toBe("no-store");
    const c = r.cookies[0]!;
    expect(c.name).toBe("mp_session");
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.path).toBe("/");

    const moi = await active.app.inject({
      method: "GET",
      url: "/api/auth/moi",
      headers: { cookie: `${c.name}=${c.value}` },
    });
    expect(moi.statusCode).toBe(200);
    expect(moi.json()).toMatchObject({
      utilisateur: { id: consultantId, email: CONSULTANT, roles: ["consultant"] },
      cabinet_id: cabinetDemo,
      tfa_active: false,
      portail: false,
    });

    // Jeton jamais stocké en clair ; audit « connexion » marqué demo.
    const enClair = await proprietaire(
      async (q) =>
        (await q.query("SELECT 1 FROM sessions WHERE jeton_hash = $1", [c.value])).rowCount,
    );
    expect(enClair).toBe(0);
    const audit = await proprietaire(
      async (q) =>
        (
          await q.query(
            `SELECT details FROM journal_audit
             WHERE cabinet_id = $1 AND utilisateur_id = $2 AND action = 'connexion'
             ORDER BY id DESC LIMIT 1`,
            [cabinetDemo, consultantId],
          )
        ).rows[0]?.details,
    );
    expect(audit).toEqual({ demo: true });
  });

  it("compte du portail : session ouverte, /moi renvoie portail, routes du portail seulement", async () => {
    const r = await connexionDemo(DIRIGEANT);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, etape: "connecte" });
    expect(r.headers["cache-control"]).toBe("no-store");
    const c = r.cookies[0]!;
    expect(c.httpOnly).toBe(true);
    const cookie = { cookie: `${c.name}=${c.value}` };

    const moi = await active.app.inject({ method: "GET", url: "/api/auth/moi", headers: cookie });
    expect(moi.statusCode).toBe(200);
    expect(moi.json()).toMatchObject({
      utilisateur: { id: dirigeantId, email: DIRIGEANT, roles: ["client_dirigeant"] },
      cabinet_id: cabinetDemo,
      tfa_active: false,
      tfa_a_configurer: false,
      portail: true,
    });
    const portail = await active.app.inject({
      method: "GET",
      url: "/api/portail/moi",
      headers: cookie,
    });
    expect(portail.statusCode).toBe(200);
    expect(portail.json().entreprise.raison_sociale).toBe("Cacao Savane Export (fictif)");
    // Liste blanche du portail : une route interne reste fermée.
    const interne = await active.app.inject({
      method: "GET",
      url: "/api/missions",
      headers: cookie,
    });
    expect(interne.statusCode).toBe(403);
    expect(interne.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");

    const audit = await proprietaire(
      async (q) =>
        (
          await q.query(
            `SELECT details FROM journal_audit
             WHERE cabinet_id = $1 AND utilisateur_id = $2 AND action = 'connexion'
             ORDER BY id DESC LIMIT 1`,
            [cabinetDemo, dirigeantId],
          )
        ).rows[0]?.details,
    );
    expect(audit).toEqual({ demo: true });
  });

  it("les trois rôles client ouvrent une session de portail", async () => {
    for (const email of [CONTRIBUTEUR, INVESTISSEUR]) {
      const r = await connexionDemo(email);
      expect(r.statusCode).toBe(200);
      const c = r.cookies[0]!;
      const moi = await active.app.inject({
        method: "GET",
        url: "/api/auth/moi",
        headers: { cookie: `${c.name}=${c.value}` },
      });
      expect(moi.json().portail).toBe(true);
    }
  });

  it("e-mail insensible à la casse ; succès répétés non bloqués (le limiteur est libéré)", async () => {
    for (let i = 0; i < 12; i++) {
      expect((await connexionDemo("Consultant@Lagune-Conseil.TEST")).statusCode).toBe(200);
    }
  });

  it("e-mail hors liste : même 401 uniforme, aucun cookie", async () => {
    const reponses = await Promise.all(
      [
        `absent${DOMAINE_DEMO}`,
        AUTRE_DOMAINE,
        INTRUS,
        JUMEAU,
        DESACTIVE,
        PORTAIL,
        SUSPENDU,
        CLIENT_ARCHIVE,
        PORTAIL_AUTRE_DOMAINE,
        PORTAIL_INTRUS,
        PORTAIL_JUMEAU,
      ].map((e) => connexionDemo(e)),
    );
    for (const r of reponses) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject(corpsInconnu);
      expect(r.body).toBe(reponses[0]!.body);
      expect(r.cookies).toHaveLength(0);
    }
  });

  it("2FA active : refus clair, jamais de session (la 2FA n'est pas contournée)", async () => {
    const r = await connexionDemo(AVEC_2FA);
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("CONNEXION_RAPIDE_2FA");
    expect(r.json().erreur.message).toMatch(/double authentification/);
    expect(r.cookies).toHaveLength(0);
  });

  it("2FA obligatoire par la politique du cabinet : refus tant qu'elle s'applique", async () => {
    await proprietaire((c) =>
      c.query("UPDATE cabinets SET tfa_obligatoire = '{associe}' WHERE id = $1", [cabinetDemo]),
    );
    try {
      const refus = await connexionDemo(ANCRE);
      expect(refus.statusCode).toBe(403);
      expect(refus.json().erreur.code).toBe("CONNEXION_RAPIDE_2FA");
      expect(refus.cookies).toHaveLength(0);
      expect((await connexionDemo(CONSULTANT)).statusCode).toBe(200);
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE cabinets SET tfa_obligatoire = '{}' WHERE id = $1", [cabinetDemo]),
      );
    }
    expect((await connexionDemo(ANCRE)).statusCode).toBe(200);
  });

  it("compte du portail : 2FA obligatoire du portail ou 2FA active refusent la connexion rapide", async () => {
    await proprietaire((c) =>
      c.query(
        `INSERT INTO portail_parametres (cabinet_id, tfa_obligatoire) VALUES ($1, true)
         ON CONFLICT (cabinet_id) DO UPDATE SET tfa_obligatoire = true`,
        [cabinetDemo],
      ),
    );
    try {
      const refus = await connexionDemo(INVESTISSEUR);
      expect(refus.statusCode).toBe(403);
      expect(refus.json().erreur.code).toBe("CONNEXION_RAPIDE_2FA");
      expect(refus.cookies).toHaveLength(0);
      // La politique du portail ne touche pas les comptes du cabinet.
      expect((await connexionDemo(CONSULTANT)).statusCode).toBe(200);
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE portail_parametres SET tfa_obligatoire = false WHERE cabinet_id = $1", [
          cabinetDemo,
        ]),
      );
    }
    await proprietaire((c) =>
      c.query(
        `INSERT INTO utilisateurs_2fa (utilisateur_id, cabinet_id, secret_chiffre, cle_version, active_le)
         VALUES ($1, $2, $3, 1, now())`,
        [dirigeantId, cabinetDemo, randomBytes(48)],
      ),
    );
    try {
      const refus = await connexionDemo(DIRIGEANT);
      expect(refus.statusCode).toBe(403);
      expect(refus.json().erreur.code).toBe("CONNEXION_RAPIDE_2FA");
      expect(refus.cookies).toHaveLength(0);
    } finally {
      await proprietaire((c) =>
        c.query("DELETE FROM utilisateurs_2fa WHERE utilisateur_id = $1", [dirigeantId]),
      );
    }
    expect((await connexionDemo(DIRIGEANT)).statusCode).toBe(200);
  });

  it("2FA obligatoire par le plancher plateforme (TOTP_REQUIS=oui) : refus", async () => {
    const plancher = await instance({ CONNEXION_RAPIDE_DEMO: "oui", TOTP_REQUIS: "oui" });
    try {
      const r = await connexionDemo(ANCRE, plancher);
      expect(r.statusCode).toBe(403);
      expect(r.json().erreur.code).toBe("CONNEXION_RAPIDE_2FA");
    } finally {
      await plancher.app.close();
      await plancher.db.close();
    }
  });

  it("corps invalide ou champ en trop : 400", async () => {
    expect((await connexionDemo("pas-un-email")).statusCode).toBe(400);
    const r = await active.app.inject({
      method: "POST",
      url: "/api/auth/connexion-demo",
      payload: { email: CONSULTANT, mot_de_passe: "x" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.cookies).toHaveLength(0);
  });

  it("garde d'origine : un autre site est refusé, l'origine du web passe", async () => {
    const refus = await connexionDemo(CONSULTANT, active, { origin: "https://malveillant.test" });
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("ORIGINE_REFUSEE");
    expect(refus.cookies).toHaveLength(0);
    const ok = await connexionDemo(CONSULTANT, active, { origin: active.config.WEB_ORIGIN });
    expect(ok.statusCode).toBe(200);
  });
});

describe("connexion rapide de démonstration : limiteur", () => {
  it("e-mail hors liste : 10 essais puis 429, compteur partagé avec la connexion par mot de passe", async () => {
    const email = `enumeration-${Date.now()}${DOMAINE_DEMO}`;
    for (let i = 0; i < 10; i++) expect((await connexionDemo(email)).statusCode).toBe(401);
    expect((await connexionDemo(email)).statusCode).toBe(429);
    const motDePasse = await active.app.inject({
      method: "POST",
      url: "/api/auth/connexion",
      payload: { email, mot_de_passe: MOT_DE_PASSE_TEST },
    });
    expect(motDePasse.statusCode).toBe(429);
  });

  it("compte sous 2FA : chaque refus compte (aucun moyen d'insister sans limite)", async () => {
    // Le compte a déjà consommé une tentative plus haut ; on complète jusqu'au plafond.
    let derniere = 0;
    for (let i = 0; i < 10; i++) derniere = (await connexionDemo(AVEC_2FA)).statusCode;
    expect(derniere).toBe(429);
  });

  it("requêtes simultanées : le plafond tient", async () => {
    const email = `simultane-${Date.now()}${DOMAINE_DEMO}`;
    const reponses = await Promise.all(Array.from({ length: 20 }, () => connexionDemo(email)));
    expect(reponses.filter((r) => r.statusCode === 429)).toHaveLength(10);
  });
});

describe("connexion rapide de démonstration : borne de la liste", () => {
  it(`au plus ${MAX_COMPTES_DEMO} comptes`, async () => {
    await proprietaire((c) =>
      c.query(
        `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
         SELECT $1, 'masse-' || g || $2, 'Compte ' || g, ARRAY['consultant'], $3
         FROM generate_series(1, 60) AS g`,
        [cabinetDemo, DOMAINE_DEMO, hash],
      ),
    );
    const r = await lister();
    expect(r.statusCode).toBe(200);
    expect(r.json().elements).toHaveLength(MAX_COMPTES_DEMO);
  });
});
