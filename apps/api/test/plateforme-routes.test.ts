import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import {
  creerCabinet,
  demarrer,
  MOT_DE_PASSE_TEST,
  proprietaire,
  type Contexte,
} from "./helpers.js";
import {
  COOKIE_PLATEFORME,
  ROLES_CABINET,
  UUID_INCONNU,
  connecterPlateforme,
  connexionCabinet,
  connexionPlateforme,
  creerCabinetParPlateforme,
  creerSuperAdmin,
  emailUnique,
  journalDe,
  sessionCabinet,
  superAdminConnecte,
  unique,
  valeurCookie,
} from "./plateforme-outils.js";

/*
 * Super admin de plateforme (contrat du lot 1) : parcours fonctionnel des routes
 * /api/plateforme/* sur vrai PostgreSQL. Sécurité et accès : plateforme-acces.test.ts.
 */

let ctx: Contexte;
beforeAll(async () => {
  ctx = await demarrer();
}, 120_000);
afterAll(() => ctx.fermer());

const BASE = "/api/plateforme";
const MDP_FOURNI = "Mot-de-passe-fourni-1";

describe("session plateforme : connexion, /moi, déconnexion", () => {
  it("connexion 200, cookie httpOnly non secure en local, no-store ; /moi ; déconnexion invalide la session", async () => {
    const admin = await creerSuperAdmin();
    const r = await connexionPlateforme(ctx, admin.email, admin.motDePasse);
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toMatch(/no-store/);
    expect(r.json()).toEqual({
      ok: true,
      superAdmin: { id: admin.id, email: admin.email, nom: admin.nom },
    });
    const c = r.cookies.find((x) => x.name === COOKIE_PLATEFORME);
    expect(c?.httpOnly).toBe(true);
    expect(c?.secure).toBeFalsy();
    expect(c?.path).toBe("/");
    expect(c?.value.length).toBeGreaterThan(20);

    const p = api(ctx, `${c!.name}=${c!.value}`);
    const moi = await p.get(`${BASE}/moi`);
    expect(moi.statusCode).toBe(200);
    expect(moi.json()).toEqual({
      superAdmin: { id: admin.id, email: admin.email, nom: admin.nom, estDemo: false },
    });

    const sortie = await p.post(`${BASE}/deconnexion`);
    expect(sortie.statusCode).toBe(200);
    expect(sortie.json()).toEqual({ ok: true });
    const apres = await p.get(`${BASE}/moi`);
    expect(apres.statusCode).toBe(401);
    expect(apres.json().erreur.code).toBe("NON_AUTHENTIFIE");
  });

  it("déconnexion sans session : 200 (idempotente)", async () => {
    const r = await api(ctx).post(`${BASE}/deconnexion`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });
});

describe("connexion : refus uniformes, validation, limiteur", () => {
  it("401 IDENTIFIANTS_INVALIDES au message identique : e-mail inconnu, mauvais mot de passe, admin inactif", async () => {
    const actif = await creerSuperAdmin();
    const inactif = await creerSuperAdmin({ actif: false });
    const reponses = [
      await connexionPlateforme(ctx, emailUnique("inconnu"), "Un-mot-de-passe-quelconque"),
      await connexionPlateforme(ctx, actif.email, "Mauvais-mot-de-passe-1"),
      await connexionPlateforme(ctx, inactif.email, inactif.motDePasse),
    ];
    for (const r of reponses) {
      expect(r.statusCode).toBe(401);
      expect(r.json().erreur.code).toBe("IDENTIFIANTS_INVALIDES");
      expect(r.cookies.find((x) => x.name === COOKIE_PLATEFORME)).toBeUndefined();
    }
    const messages = new Set(reponses.map((r) => r.json().erreur.message as string));
    expect(messages.size).toBe(1);
  });

  it("400 : corps invalide, champ manquant, clé inconnue (strict)", async () => {
    const admin = await creerSuperAdmin();
    const a = api(ctx);
    const corps: unknown[] = [
      {},
      { email: admin.email },
      { motDePasse: admin.motDePasse },
      { email: "pas-un-email", motDePasse: admin.motDePasse },
      { email: admin.email, motDePasse: admin.motDePasse, extra: true },
      { email: admin.email, motDePasse: 12345 },
    ];
    for (const c of corps) {
      const r = await a.post(`${BASE}/connexion`, c);
      expect(r.statusCode, JSON.stringify(c)).toBe(400);
    }
  });

  it("429 TROP_DE_TENTATIVES après 10 échecs, même avec le bon mot de passe ; le cabinet homonyme n'est pas bloqué", async () => {
    // Même adresse côté cabinet : espace `connexion` partagé, clé préfixée `plateforme:`.
    const cabinet = await creerCabinet(ctx, unique("Cabinet homonyme"));
    const admin = await creerSuperAdmin({ email: cabinet.email });
    for (let i = 0; i < 10; i++) {
      const r = await connexionPlateforme(ctx, admin.email, "Mauvais-mot-de-passe-1");
      expect(r.statusCode, `essai ${i + 1}`).toBe(401);
    }
    const bloque = await connexionPlateforme(ctx, admin.email, "Mauvais-mot-de-passe-1");
    expect(bloque.statusCode).toBe(429);
    expect(bloque.json().erreur.code).toBe("TROP_DE_TENTATIVES");
    const bon = await connexionPlateforme(ctx, admin.email, admin.motDePasse);
    expect(bon.statusCode).toBe(429);
    const ok = await connexionCabinet(ctx, cabinet.email, MOT_DE_PASSE_TEST);
    expect(ok.statusCode).toBe(200);
  });

  it("un succès libère le compteur de l'admin", async () => {
    const admin = await creerSuperAdmin();
    for (let i = 0; i < 5; i++) await connexionPlateforme(ctx, admin.email, "Mauvais-1-motdepasse");
    expect((await connexionPlateforme(ctx, admin.email, admin.motDePasse)).statusCode).toBe(200);
    for (let i = 0; i < 9; i++) await connexionPlateforme(ctx, admin.email, "Mauvais-1-motdepasse");
    expect((await connexionPlateforme(ctx, admin.email, admin.motDePasse)).statusCode).toBe(200);
  });
});

describe("cabinets : création", () => {
  it("sans motDePasse : mot de passe généré (≥ 20 caractères), l'associé se connecte ensuite", async () => {
    const { p } = await superAdminConnecte(ctx);
    const email = emailUnique("gen");
    const nom = unique("Cabinet généré");
    const r = await p.post(`${BASE}/cabinets`, { nom, associe: { nom: "Aïcha Koné", email } });
    expect(r.statusCode).toBe(201);
    expect(r.headers["cache-control"]).toMatch(/no-store/);
    const j = r.json();
    expect(j.cabinet).toMatchObject({ nom, pays: "CI", actif: true, estDemo: false });
    expect(j.associe).toMatchObject({ email, nom: "Aïcha Koné", roles: ["associe"] });
    expect(typeof j.motDePasseGenere).toBe("string");
    expect(j.motDePasseGenere.length).toBeGreaterThanOrEqual(20);
    expect((await connexionCabinet(ctx, email, j.motDePasseGenere)).statusCode).toBe(200);
    const cookie = await sessionCabinet(ctx, email, j.motDePasseGenere);
    const moi = await api(ctx, cookie).get("/api/auth/moi");
    expect(moi.json().utilisateur.roles).toEqual(["associe"]);
  });

  it("avec motDePasse fourni : motDePasseGenere null, connexion OK ; pays accepté", async () => {
    const { p } = await superAdminConnecte(ctx);
    const email = emailUnique("fourni");
    const r = await p.post(`${BASE}/cabinets`, {
      nom: unique("Cabinet fourni"),
      pays: "SN",
      associe: { nom: "Associé", email, motDePasse: MDP_FOURNI },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().motDePasseGenere).toBeNull();
    expect(r.json().cabinet.pays).toBe("SN");
    expect((await connexionCabinet(ctx, email, MDP_FOURNI)).statusCode).toBe(200);
  });

  it("409 CONFLIT si l'e-mail est déjà pris (casse différente comprise) ; 400 pour les corps invalides", async () => {
    const { p } = await superAdminConnecte(ctx);
    const existant = await creerCabinet(ctx, unique("Cabinet existant"));
    const valide = (surcharges: Record<string, unknown> = {}, associe: object = {}) => ({
      nom: unique("Cabinet"),
      associe: { nom: "Associé", email: emailUnique("n"), motDePasse: MDP_FOURNI, ...associe },
      ...surcharges,
    });
    const conflit = await p.post(
      `${BASE}/cabinets`,
      valide({}, { email: existant.email.toUpperCase() }),
    );
    expect(conflit.statusCode).toBe(409);
    expect(conflit.json().erreur.code).toBe("CONFLIT");

    const invalides: [string, unknown][] = [
      ["mot de passe trop court", valide({}, { motDePasse: "court" })],
      ["clé inconnue à la racine", valide({ extra: 1 })],
      ["clé inconnue dans associe", valide({}, { extra: 1 })],
      ["pays minuscule", valide({ pays: "ci" })],
      ["pays trop long", valide({ pays: "CIV" })],
      ["pays numérique", valide({ pays: "12" })],
      ["nom vide", valide({ nom: "" })],
      ["e-mail invalide", valide({}, { email: "pas-un-email" })],
      ["associé absent", { nom: unique("Cabinet") }],
    ];
    for (const [quoi, corps] of invalides) {
      const r = await p.post(`${BASE}/cabinets`, corps);
      expect(r.statusCode, quoi).toBe(400);
    }
  });
});

describe("cabinets : liste et modification", () => {
  it("la liste contient le nouveau cabinet avec ses compteurs ; estDemo faux", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const liste = (await p.get(`${BASE}/cabinets`)).json().elements as Record<string, unknown>[];
    const trouve = liste.find((x) => x.id === c.cabinetId);
    expect(trouve).toMatchObject({
      actif: true,
      estDemo: false,
      nbUtilisateurs: 1,
      nbUtilisateursActifs: 1,
    });
    // Un second utilisateur, puis désactivé : les compteurs suivent.
    const u = await p.post(`${BASE}/cabinets/${c.cabinetId}/utilisateurs`, {
      nom: "Consultant",
      email: emailUnique("cons"),
      roles: ["consultant"],
    });
    await p.patch(`${BASE}/cabinets/${c.cabinetId}/utilisateurs/${u.json().utilisateur.id}`, {
      actif: false,
    });
    const apres = (await p.get(`${BASE}/cabinets`)).json().elements as Record<string, unknown>[];
    expect(apres.find((x) => x.id === c.cabinetId)).toMatchObject({
      nbUtilisateurs: 2,
      nbUtilisateursActifs: 1,
    });
  });

  it("PATCH : renommer, désactiver puis réactiver ; au moins un champ ; 404 si inconnu ; 400 si non UUID", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const url = `${BASE}/cabinets/${c.cabinetId}`;
    const nouveau = unique("Nouveau nom");
    const renomme = await p.patch(url, { nom: nouveau });
    expect(renomme.statusCode).toBe(200);
    expect(renomme.json().cabinet).toMatchObject({ id: c.cabinetId, nom: nouveau, actif: true });
    expect((await p.patch(url, { actif: false })).json().cabinet.actif).toBe(false);
    const liste = (await p.get(`${BASE}/cabinets`)).json().elements as {
      id: string;
      actif: boolean;
    }[];
    expect(liste.find((x) => x.id === c.cabinetId)?.actif).toBe(false);
    expect((await p.patch(url, { actif: true })).json().cabinet.actif).toBe(true);

    expect((await p.patch(url, {})).statusCode).toBe(400);
    expect((await p.patch(url, { nom: "" })).statusCode).toBe(400);
    expect((await p.patch(url, { actif: "oui" })).statusCode).toBe(400);
    expect((await p.patch(url, { nom: "X", extra: 1 })).statusCode).toBe(400);
    const inconnu = await p.patch(`${BASE}/cabinets/${UUID_INCONNU}`, { nom: "X" });
    expect(inconnu.statusCode).toBe(404);
    expect(inconnu.json().erreur.code).toBe("INTROUVABLE");
    expect((await p.patch(`${BASE}/cabinets/pas-un-uuid`, { nom: "X" })).statusCode).toBe(400);
  });

  it("désactiver un cabinet coupe connexions et sessions existantes ; réactiver les rétablit", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const cookieCabinet = await sessionCabinet(ctx, c.associeEmail, c.motDePasse);
    expect((await api(ctx, cookieCabinet).get("/api/auth/moi")).statusCode).toBe(200);

    await p.patch(`${BASE}/cabinets/${c.cabinetId}`, { actif: false });
    const connexion = await connexionCabinet(ctx, c.associeEmail, c.motDePasse);
    expect(connexion.statusCode).toBe(401);
    expect(connexion.json().erreur.code).toBe("IDENTIFIANTS_INVALIDES");
    expect((await api(ctx, cookieCabinet).get("/api/auth/moi")).statusCode).toBe(401);

    await p.patch(`${BASE}/cabinets/${c.cabinetId}`, { actif: true });
    expect((await connexionCabinet(ctx, c.associeEmail, c.motDePasse)).statusCode).toBe(200);
  });
});

describe("utilisateurs d'un cabinet", () => {
  it("création de chacun des 8 rôles : connexion et /api/auth/moi renvoient le rôle", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const url = `${BASE}/cabinets/${c.cabinetId}/utilisateurs`;
    for (const role of ROLES_CABINET) {
      const email = emailUnique(role);
      const r = await p.post(url, {
        nom: `Test ${role}`,
        email,
        roles: [role],
        motDePasse: MOT_DE_PASSE_TEST,
      });
      expect(r.statusCode, role).toBe(201);
      expect(r.json().utilisateur).toMatchObject({ email, roles: [role], actif: true });
      expect(r.json().motDePasseGenere).toBeNull();
      const cookie = await sessionCabinet(ctx, email, MOT_DE_PASSE_TEST);
      const moi = await api(ctx, cookie).get("/api/auth/moi");
      expect(moi.json().utilisateur.roles, role).toEqual([role]);
    }
    const liste = (await p.get(url)).json().elements as { actif: boolean }[];
    expect(liste).toHaveLength(1 + ROLES_CABINET.length);
    expect(liste.every((u) => u.actif)).toBe(true);
    expect((await p.get(`${BASE}/cabinets/${UUID_INCONNU}/utilisateurs`)).statusCode).toBe(404);
  });

  it("plusieurs rôles ; mot de passe généré utilisable", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const email = emailUnique("multi");
    const r = await p.post(`${BASE}/cabinets/${c.cabinetId}/utilisateurs`, {
      nom: "Multi",
      email,
      roles: ["chef_mission", "consultant"],
    });
    expect(r.statusCode).toBe(201);
    const genere = r.json().motDePasseGenere as string;
    expect(genere.length).toBeGreaterThanOrEqual(20);
    const moi = await api(ctx, await sessionCabinet(ctx, email, genere)).get("/api/auth/moi");
    expect([...moi.json().utilisateur.roles].sort()).toEqual(["chef_mission", "consultant"]);
  });

  it("refus : rôle du portail client, rôles vides / doublons / inconnus, clé inconnue, mot de passe court ; 409 e-mail dupliqué", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const url = `${BASE}/cabinets/${c.cabinetId}/utilisateurs`;
    const corps = (roles: unknown, extra: Record<string, unknown> = {}) => ({
      nom: "Test",
      email: emailUnique("refus"),
      roles,
      ...extra,
    });
    const refus: [string, unknown][] = [
      ["rôle client_dirigeant", corps(["client_dirigeant"])],
      ["rôle client_contributeur", corps(["consultant", "client_contributeur"])],
      ["rôle client_investisseur", corps(["client_investisseur"])],
      ["rôles vides", corps([])],
      ["rôles absents", { nom: "Test", email: emailUnique("refus") }],
      ["doublons", corps(["consultant", "consultant"])],
      ["rôle inconnu", corps(["super_admin"])],
      ["clé inconnue", corps(["consultant"], { extra: 1 })],
      ["mot de passe trop court", corps(["consultant"], { motDePasse: "court" })],
      ["e-mail invalide", { nom: "Test", email: "x", roles: ["consultant"] }],
    ];
    for (const [quoi, c2] of refus) {
      expect((await p.post(url, c2)).statusCode, quoi).toBe(400);
    }
    const email = emailUnique("dup");
    expect((await p.post(url, corps(["consultant"], { email }))).statusCode).toBe(201);
    const dup = await p.post(url, corps(["consultant"], { email: email.toUpperCase() }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erreur.code).toBe("CONFLIT");
  });

  it("PATCH : désactiver (connexion et session tombent), réactiver, changer les rôles", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const email = emailUnique("modif");
    const cree = await p.post(`${BASE}/cabinets/${c.cabinetId}/utilisateurs`, {
      nom: "Modifiable",
      email,
      roles: ["consultant"],
      motDePasse: MOT_DE_PASSE_TEST,
    });
    const url = `${BASE}/cabinets/${c.cabinetId}/utilisateurs/${cree.json().utilisateur.id}`;
    const cookie = await sessionCabinet(ctx, email, MOT_DE_PASSE_TEST);

    const off = await p.patch(url, { actif: false });
    expect(off.statusCode).toBe(200);
    expect(off.json().utilisateur).toMatchObject({ actif: false, roles: ["consultant"] });
    expect((await connexionCabinet(ctx, email, MOT_DE_PASSE_TEST)).statusCode).toBe(401);
    expect((await api(ctx, cookie).get("/api/auth/moi")).statusCode).toBe(401);

    expect((await p.patch(url, { actif: true })).json().utilisateur.actif).toBe(true);
    expect((await connexionCabinet(ctx, email, MOT_DE_PASSE_TEST)).statusCode).toBe(200);

    const roles = await p.patch(url, { roles: ["chef_mission", "expert_metier"] });
    expect(roles.statusCode).toBe(200);
    expect([...roles.json().utilisateur.roles].sort()).toEqual(["chef_mission", "expert_metier"]);
    const nouveau = await sessionCabinet(ctx, email, MOT_DE_PASSE_TEST);
    const moi = await api(ctx, nouveau).get("/api/auth/moi");
    expect([...moi.json().utilisateur.roles].sort()).toEqual(["chef_mission", "expert_metier"]);

    expect((await p.patch(url, {})).statusCode).toBe(400);
    expect((await p.patch(url, { roles: [] })).statusCode).toBe(400);
    expect((await p.patch(url, { roles: ["client_dirigeant"] })).statusCode).toBe(400);
    expect((await p.patch(url, { actif: true, extra: 1 })).statusCode).toBe(400);
  });

  it("dernier associé actif : désactivation ou retrait du rôle refusés (409 DERNIER_ASSOCIE) ; autorisés avec un second", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    const urlAssocie = `${BASE}/cabinets/${c.cabinetId}/utilisateurs/${c.associeId}`;
    for (const corps of [{ actif: false }, { roles: ["consultant"] }]) {
      const r = await p.patch(urlAssocie, corps);
      expect(r.statusCode, JSON.stringify(corps)).toBe(409);
      expect(r.json().erreur.code).toBe("DERNIER_ASSOCIE");
    }
    expect((await connexionCabinet(ctx, c.associeEmail, c.motDePasse)).statusCode).toBe(200);

    const second = await p.post(`${BASE}/cabinets/${c.cabinetId}/utilisateurs`, {
      nom: "Second associé",
      email: emailUnique("second"),
      roles: ["associe"],
    });
    expect(second.statusCode).toBe(201);
    expect((await p.patch(urlAssocie, { actif: false })).statusCode).toBe(200);
    // Le second est désormais le dernier associé actif.
    const idSecond = second.json().utilisateur.id as string;
    const dernier = await p.patch(`${BASE}/cabinets/${c.cabinetId}/utilisateurs/${idSecond}`, {
      actif: false,
    });
    expect(dernier.json().erreur.code).toBe("DERNIER_ASSOCIE");
  });

  it("utilisateur d'un AUTRE cabinet ou inconnu : 404 ; identifiants non UUID : 400", async () => {
    const { p } = await superAdminConnecte(ctx);
    const a = await creerCabinetParPlateforme(p);
    const b = await creerCabinetParPlateforme(p);
    const patch = (cabinetId: string, uid: string) =>
      p.patch(`${BASE}/cabinets/${cabinetId}/utilisateurs/${uid}`, { actif: false });
    const croise = await patch(a.cabinetId, b.associeId);
    expect(croise.statusCode).toBe(404);
    expect(croise.json().erreur.code).toBe("INTROUVABLE");
    expect((await connexionCabinet(ctx, b.associeEmail, b.motDePasse)).statusCode).toBe(200);
    expect((await patch(a.cabinetId, UUID_INCONNU)).statusCode).toBe(404);
    expect((await patch(UUID_INCONNU, a.associeId)).statusCode).toBe(404);
    expect((await patch(a.cabinetId, "pas-un-uuid")).statusCode).toBe(400);
    const creation = await p.post(`${BASE}/cabinets/pas-un-uuid/utilisateurs`, {
      nom: "x",
      email: emailUnique("x"),
      roles: ["consultant"],
    });
    expect(creation.statusCode).toBe(400);
  });
});

describe("secrets et journal", () => {
  it("aucun secret dans les réponses ; le mot de passe généré n'est dans aucune ligne du journal ; une ligne par opération", async () => {
    const admin = await creerSuperAdmin();
    const cookie = await connecterPlateforme(ctx, admin);
    const p = api(ctx, cookie);
    const corps: string[] = [];
    const noter = <T extends { body: string }>(r: T): T => {
      corps.push(r.body);
      return r;
    };

    const cab = noter(
      await p.post(`${BASE}/cabinets`, {
        nom: unique("Cabinet journal"),
        associe: { nom: "Associé", email: emailUnique("journal") },
      }),
    );
    expect(cab.statusCode).toBe(201);
    const generes = [cab.json().motDePasseGenere as string];
    const cabinetId = cab.json().cabinet.id as string;
    noter(await p.patch(`${BASE}/cabinets/${cabinetId}`, { nom: unique("Renommé") }));
    const u = noter(
      await p.post(`${BASE}/cabinets/${cabinetId}/utilisateurs`, {
        nom: "Utilisateur",
        email: emailUnique("journal-u"),
        roles: ["consultant"],
      }),
    );
    generes.push(u.json().motDePasseGenere as string);
    noter(await p.get(`${BASE}/cabinets`));
    noter(await p.get(`${BASE}/cabinets/${cabinetId}/utilisateurs`));
    const uid = u.json().utilisateur.id as string;
    noter(await p.patch(`${BASE}/cabinets/${cabinetId}/utilisateurs/${uid}`, { actif: false }));
    noter(await p.get(`${BASE}/moi`));
    await p.post(`${BASE}/deconnexion`);

    // Aucun haché ni jeton dans les réponses (le mot de passe généré n'est que dans les deux créations).
    const jeton = valeurCookie(cookie);
    for (const b of corps) {
      expect(b).not.toMatch(/mot_?de_?passe_?hash|motDePasseHash|"hash"|jeton/i);
      expect(b).not.toContain(jeton);
      expect(b).not.toMatch(/\$argon2|\$scrypt|\$2[aby]\$/);
    }

    const journal = await journalDe(admin.id);
    expect(journal.map((l) => l.action)).toEqual([
      "connexion",
      "cabinet_creation",
      "cabinet_modification",
      "utilisateur_creation",
      "utilisateur_modification",
      "deconnexion",
    ]);
    expect(journal[1]?.cabinet_id).toBe(cabinetId);
    expect(journal[4]?.details).toMatchObject({ actif: false });

    for (const mdp of [...generes, admin.motDePasse]) {
      expect(JSON.stringify(journal)).not.toContain(mdp);
      const n = await proprietaire(
        async (c) =>
          (
            await c.query(
              "SELECT count(*)::int AS n FROM journal_plateforme j WHERE strpos(to_jsonb(j)::text, $1) > 0",
              [mdp],
            )
          ).rows[0].n as number,
      );
      expect(n).toBe(0);
    }
    expect(JSON.stringify(journal)).not.toMatch(/argon2|scrypt|jeton|hash/i);
  });

  it("un échec de connexion est journalisé sans l'e-mail saisi ni mot de passe", async () => {
    const admin = await creerSuperAdmin();
    await connexionPlateforme(ctx, admin.email, "Mauvais-mot-de-passe-1");
    const journal = await journalDe(admin.id);
    expect(journal.map((l) => l.action)).toEqual(["connexion_echec"]);
    expect(JSON.stringify(journal)).not.toContain("Mauvais-mot-de-passe-1");
    expect(JSON.stringify(journal)).not.toContain(admin.email);
  });

  it("un caractère de contrôle (NUL compris) dans un nom donne 400, jamais 500", async () => {
    const { p } = await superAdminConnecte(ctx);
    const c = await creerCabinetParPlateforme(p);
    for (const nom of ["Cab\u0000inet", "Cab\ninet"]) {
      const associe = { nom: "Associé", email: emailUnique("ctrl") };
      expect((await p.post(`${BASE}/cabinets`, { nom, associe })).statusCode).toBe(400);
      expect(
        (await p.post(`${BASE}/cabinets`, { nom: "Cabinet", associe: { ...associe, nom } }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await p.post(`${BASE}/cabinets/${c.cabinetId}/utilisateurs`, {
            nom,
            email: emailUnique("ctrl"),
            roles: ["consultant"],
          })
        ).statusCode,
      ).toBe(400);
      expect((await p.patch(`${BASE}/cabinets/${c.cabinetId}`, { nom })).statusCode).toBe(400);
    }
  });
});
