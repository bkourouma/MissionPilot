import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configTest, demarrer, proprietaire, type Contexte } from "./helpers.js";
import { connexionPlateforme, emailUnique } from "./plateforme-outils.js";
import { creerSuperAdmin, EmailDejaPris, executer } from "../src/db/creer-super-admin.js";

/*
 * Script db:creer-super-admin : création d'un vrai super admin (non démo) avec le rôle
 * propriétaire, sur vrai PostgreSQL. Le mot de passe n'est affiché que s'il est généré.
 */

let ctx: Contexte;
beforeAll(async () => {
  ctx = await demarrer();
}, 120_000);
afterAll(() => ctx.fermer());

const MOT_DE_PASSE = "Mot-de-passe-fourni-12";
const ENV = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  SUPER_ADMIN_MOT_DE_PASSE: "",
  ...extra,
});

async function lancer(argv: string[], env: NodeJS.ProcessEnv = ENV()) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await executer(argv, env, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const lignes = (email: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          "SELECT id, email, nom, mot_de_passe_hash, actif, est_demo FROM super_admins WHERE lower(email) = lower($1)",
          [email],
        )
      ).rows,
  );

const total = () =>
  proprietaire(
    async (c) => (await c.query("SELECT count(*)::int AS n FROM super_admins")).rows[0].n as number,
  );

const occurrences = (texte: string, motif: string): number => texte.split(motif).length - 1;

describe("creer-super-admin : création", () => {
  it("mot de passe généré : affiché une seule fois, ligne non démo, connexion 200", async () => {
    const email = emailUnique("cree");
    const r = await lancer(["--", "--email", email, "--nom", "Premier Admin"]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    const m = r.out.match(/canal sûr\) : (\S+)$/m);
    expect(m).not.toBeNull();
    const mdp = m![1]!;
    expect(occurrences(r.out, mdp)).toBe(1);
    expect(r.out).toContain(email);
    const rows = await lignes(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nom: "Premier Admin", actif: true, est_demo: false });
    expect(rows[0].mot_de_passe_hash).toMatch(/^scrypt\$/);
    expect(rows[0].mot_de_passe_hash).not.toContain(mdp);
    expect(r.out).toContain(rows[0].id);
    expect((await connexionPlateforme(ctx, email, mdp)).statusCode).toBe(200);
  });

  it("mot de passe fourni (forme --clé=valeur) : connexion 200, jamais réaffiché", async () => {
    const email = emailUnique("opt");
    const r = await lancer([
      `--email=${email}`,
      "--nom=Admin Option",
      `--mot-de-passe=${MOT_DE_PASSE}`,
    ]);
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toContain(MOT_DE_PASSE);
    expect(r.out).not.toMatch(/Mot de passe généré/);
    expect((await connexionPlateforme(ctx, email, MOT_DE_PASSE)).statusCode).toBe(200);
  });

  it("mot de passe fourni par SUPER_ADMIN_MOT_DE_PASSE", async () => {
    const email = emailUnique("env");
    const r = await lancer(
      ["--email", email, "--nom", "Admin Env"],
      ENV({ SUPER_ADMIN_MOT_DE_PASSE: MOT_DE_PASSE }),
    );
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toContain(MOT_DE_PASSE);
    expect((await connexionPlateforme(ctx, email, MOT_DE_PASSE)).statusCode).toBe(200);
  });

  it("variable d'environnement trop courte : refusée, rien d'écrit, valeur jamais citée", async () => {
    const email = emailUnique("envcourt");
    const r = await lancer(
      ["--email", email, "--nom", "X"],
      ENV({ SUPER_ADMIN_MOT_DE_PASSE: "court-1" }),
    );
    expect(r.code).toBe(1);
    expect(r.out + r.err).not.toContain("court-1");
    expect(await lignes(email)).toHaveLength(0);
  });
});

describe("creer-super-admin : doublon", () => {
  it("même e-mail (autre casse comprise) : code 2, une seule ligne, ancien mot de passe valable", async () => {
    const email = emailUnique("dup");
    const premier = await lancer(["--email", email, "--nom", "A", "--mot-de-passe", MOT_DE_PASSE]);
    expect(premier.code).toBe(0);
    const NOUVEAU = "Autre-mot-de-passe-99";
    for (const variante of [email, email.toUpperCase()]) {
      const r = await lancer(["--email", variante, "--nom", "B", "--mot-de-passe", NOUVEAU]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/déjà utilisé/);
      expect(r.out).toBe("");
      expect(r.out + r.err).not.toContain(NOUVEAU);
    }
    const rows = await lignes(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].nom).toBe("A");
    expect((await connexionPlateforme(ctx, email, MOT_DE_PASSE)).statusCode).toBe(200);
    expect((await connexionPlateforme(ctx, email, NOUVEAU)).statusCode).not.toBe(200);
  });

  it("creerSuperAdmin lève EmailDejaPris, y compris en cas de course (contrainte unique)", async () => {
    const email = emailUnique("course");
    const url = configTest().DATABASE_OWNER_URL;
    const entree = { email, nom: "Course", motDePasse: MOT_DE_PASSE };
    const resultats = await Promise.allSettled([
      creerSuperAdmin(url, entree),
      creerSuperAdmin(url, entree),
    ]);
    expect(resultats.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const refus = resultats.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(refus.reason).toBeInstanceOf(EmailDejaPris);
    expect(await lignes(email)).toHaveLength(1);
  });
});

describe("creer-super-admin : arguments invalides", () => {
  const cas: [string, (e: string) => string[]][] = [
    ["option inconnue", (e) => ["--email", e, "--nom", "N", "--role", "x"]],
    ["e-mail invalide", () => ["--email", "pas-un-email", "--nom", "N"]],
    ["e-mail absent", () => ["--nom", "N"]],
    ["nom vide", (e) => ["--email", e, "--nom", "   "]],
    ["nom absent", (e) => ["--email", e]],
    ["mot de passe trop court", (e) => ["--email", e, "--nom", "N", "--mot-de-passe", "court"]],
    ["option sans valeur (en fin de ligne)", (e) => ["--email", e, "--nom"]],
    ["option sans valeur (suivie d'une option)", () => ["--email", "--nom", "N"]],
    ["argument positionnel", (e) => ["--email", e, "--nom", "N", "surprise"]],
  ];
  it.each(cas)("%s : code 1, usage affiché, rien en base", async (_nom, fabrique) => {
    const avant = await total();
    const r = await lancer(fabrique(emailUnique("inv")));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Usage/);
    expect(r.out).toBe("");
    expect(await total()).toBe(avant);
  });

  it("un `--` isolé est toléré", async () => {
    const email = emailUnique("tiret");
    const r = await lancer([
      "--",
      "--email",
      email,
      "--",
      "--nom",
      "Tiret",
      "--mot-de-passe",
      MOT_DE_PASSE,
    ]);
    expect(r.code).toBe(0);
    expect(await lignes(email)).toHaveLength(1);
  });

  it("le mot de passe n'apparaît jamais dans la sortie d'erreur d'un échec", async () => {
    const secret = "Secret-a-ne-pas-fuiter-1";
    const echecs = [
      ["--email", "pas-un-email", "--nom", "N", "--mot-de-passe", secret],
      ["--email", emailUnique("x"), "--nom", "", "--mot-de-passe", secret],
      ["--email", emailUnique("x"), "--nom", "N", "--inconnue", "v", "--mot-de-passe", secret],
      // Jeton positionnel secret (mot de passe collé sans --mot-de-passe), seul ou après une option.
      ["--email", emailUnique("x"), "--nom", "N", secret],
      [secret, "--email", emailUnique("x"), "--nom", "N"],
      ["--email", emailUnique("x"), "--nom", "N", `--inconnue=${secret}`],
    ];
    for (const argv of echecs) {
      const r = await lancer(argv);
      expect(r.code).toBe(1);
      expect(r.out + r.err).not.toContain(secret);
    }
  });

  it("échec technique : message générique, sans chaîne de connexion ni secret", async () => {
    const r = await lancer(
      ["--email", emailUnique("tech"), "--nom", "N", "--mot-de-passe", MOT_DE_PASSE],
      ENV({
        DATABASE_OWNER_URL: "postgres://missionpilot_owner:mdp-secret@127.0.0.1:1/inexistante",
      }),
    );
    expect(r.code).toBe(1);
    expect(r.out + r.err).not.toMatch(/mdp-secret|postgres:\/\/|Mot-de-passe-fourni/);
  });
});
