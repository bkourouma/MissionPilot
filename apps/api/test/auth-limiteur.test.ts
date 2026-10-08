import { createHash, randomInt } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerTrousseau, trousseauDepuisConfig, type Trousseau } from "../src/auth/chiffrement.js";
import { creerLimiteur, empreinteCle, type Limiteur } from "../src/auth/limiteur.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { configTest, demarrer, type Contexte } from "./helpers.js";

/*
 * Limiteur de tentatives persistant et partagé (migration 0120, auth/limiteur.ts).
 *
 * - Mécanique paramétrée (`tentative_auth_reserver`, rôle propriétaire) : petites
 *   capacités, chaque test dans son propre espace (la capacité se compte par espace).
 * - Limiteur de l'application (rôle applicatif) : espaces réels et leurs règles
 *   (10 essais par 15 min glissantes), e-mails propres à chaque test.
 * - Horloge : réglage `app.horloge_test`, honoré dans une base « _test » seulement.
 */

let base: Database;
let autreBase: Database;
let trousseau: Trousseau;
let proprio: pg.Client;

beforeAll(async () => {
  base = createDatabase(configTest());
  autreBase = createDatabase(configTest()); // seconde « instance » : autre pool
  trousseau = trousseauDepuisConfig(configTest());
  proprio = new pg.Client({ connectionString: configTest().DATABASE_OWNER_URL });
  await proprio.connect();
});
afterAll(async () => {
  await base.close();
  await autreBase.close();
  await proprio.end();
});

const aleatoire = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");
/** Espace propre au test (lettres seules : ^[a-z_]{1,40}$). */
const espace = (prefixe: string) => `${prefixe}_${aleatoire()}`;
const email = (prefixe: string) => `${prefixe}-${aleatoire()}@exemple.test`;
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

const QUINZE_MIN = 15 * 60 * 1000;

/** Mécanique paramétrée (rôle propriétaire) : plafond, fenêtre et capacité au choix. */
function mecanique(max: number, capacite: number, t0: number, fenetreMs = 60_000) {
  const nom = espace("meca");
  let maintenant: number | null = t0;
  return {
    nom,
    fenetreMs,
    avancer(ms: number) {
      if (maintenant !== null) maintenant += ms;
    },
    horlogeReelle() {
      maintenant = null;
    },
    async reserver(cle: string): Promise<boolean> {
      await proprio.query("SELECT set_config('app.horloge_test', $1, false)", [
        maintenant === null ? "" : new Date(maintenant).toISOString(),
      ]);
      const r = await proprio.query(
        "SELECT tentative_auth_reserver($1, $2, $3, $4::interval, $5) AS ok",
        [nom, sha256(cle), max, `${fenetreMs} milliseconds`, capacite],
      );
      return r.rows[0].ok as boolean;
    },
    async lignes(): Promise<number> {
      const r = await proprio.query(
        "SELECT count(*)::int AS n FROM tentatives_auth WHERE espace = $1",
        [nom],
      );
      return r.rows[0].n as number;
    },
  };
}

/** Réserve à l'instant `t` (horloge de test de la transaction) avec le rôle applicatif. */
const reserverA = (l: Limiteur, cle: string, t: number, b: Database = base) =>
  b.withoutTenant(async (db) => {
    await db.query("SELECT set_config('app.horloge_test', $1, true)", [new Date(t).toISOString()]);
    return l.reserver(cle, db);
  });

/*
 * Constat F4 (audit du commit 6f28b95), puis audit du limiteur persistant
 * (mineurs 1-2) : une entrée bloquée ne doit jamais être évincée, ni une entrée
 * qui porte déjà la moitié du plafond (cible d'une attaque en cours).
 */
describe("limiteur : saturation et capacité (F4, mineurs 1-2)", () => {
  it("une entrée à ≥ 50 % du plafond n'est jamais évincée ; une nouvelle clé est refusée si toutes le sont", async () => {
    const m = mecanique(4, 2, Date.UTC(2026, 0, 1));
    for (let i = 0; i < 4; i++) expect(await m.reserver("cible")).toBe(true);
    expect(await m.reserver("cible")).toBe(false); // bloquée
    expect(await m.reserver("demi")).toBe(true);
    expect(await m.reserver("demi")).toBe(true); // 2 sur 4 : protégée
    // Espace plein de lignes protégées : la nouvelle clé est refusée plutôt que d'en évincer une.
    for (let i = 0; i < 20; i++) expect(await m.reserver(`faux${i}`)).toBe(false);
    expect(await m.reserver("cible")).toBe(false);
    expect(await m.lignes()).toBe(2);
    // Fenêtre écoulée : les entrées périmées font place, la cible retrouve ses essais.
    m.avancer(m.fenetreMs);
    expect(await m.reserver("nouvelle")).toBe(true);
    expect(await m.reserver("cible")).toBe(true);
  });

  it("espace plein : la ligne sous 50 % la plus ancienne fait place ; bloquée et demi-pleine restent", async () => {
    const m = mecanique(4, 3, Date.UTC(2026, 0, 2));
    for (let i = 0; i < 4; i++) await m.reserver("cible");
    expect(await m.reserver("cible")).toBe(false);
    await m.reserver("demi");
    await m.reserver("demi");
    for (let i = 0; i < 30; i++) {
      m.avancer(10);
      expect(await m.reserver(`faux${i}`)).toBe(true); // évince le faux précédent (1 sur 4)
    }
    expect(await m.lignes()).toBe(3); // jamais plus que la capacité
    expect(await m.reserver("cible")).toBe(false);
    // La ligne à 50 % a gardé ses deux tentatives : deux de plus la bloquent.
    expect(await m.reserver("demi")).toBe(true);
    expect(await m.reserver("demi")).toBe(true);
    expect(await m.reserver("demi")).toBe(false);
  });

  it("grande capacité : estimation sans parcours, puis comptage et éviction près de la capacité", async () => {
    const m = mecanique(4, 20_000, Date.now());
    m.horlogeReelle();
    // 20 000 clés à une tentative (évinçables), statistiques à jour.
    await proprio.query(
      `INSERT INTO tentatives_auth (espace, cle, instants, expire_le)
       SELECT $1, encode(sha256(convert_to($1 || g, 'UTF8')), 'hex'), ARRAY[now()],
              now() + interval '1 minute'
       FROM generate_series(1, 20000) g`,
      [m.nom],
    );
    await proprio.query("ANALYZE tentatives_auth");
    try {
      expect(await m.reserver("nouvelle")).toBe(true);
      expect(await m.lignes()).toBe(20_000); // une ligne évincée pour la nouvelle
      // Toutes protégées (2 sur 4) : la clé suivante est refusée, rien n'est évincé.
      await proprio.query(
        "UPDATE tentatives_auth SET instants = ARRAY[now(), now()] WHERE espace = $1",
        [m.nom],
      );
      await proprio.query("ANALYZE tentatives_auth");
      expect(await m.reserver("refusee")).toBe(false);
      expect(await m.lignes()).toBe(20_000);
    } finally {
      await proprio.query("DELETE FROM tentatives_auth WHERE espace = $1", [m.nom]);
    }
  });

  it("règles par espace : 10 essais par 15 min, 1 000 000 de clés ; espace inconnu refusé", async () => {
    for (const nom of ["connexion", "reauth", "facteur"]) {
      const r = await proprio.query(
        `SELECT p_max, extract(epoch FROM p_fenetre)::int AS fenetre_s, p_capacite
         FROM tentatives_auth_regles($1)`,
        [nom],
      );
      expect(r.rows[0], nom).toEqual({ p_max: 10, fenetre_s: 900, p_capacite: 1_000_000 });
    }
    await expect(proprio.query("SELECT * FROM tentatives_auth_regles('autre')")).rejects.toThrow(
      /inconnu/,
    );
  });
});

/*
 * Mineur 3 : plafond, fenêtre, capacité et horloge ne sont plus des paramètres de
 * la fonction appelée par l'application.
 */
describe("limiteur : fonctions de production (mineur 3)", () => {
  it("reserver_tentative_auth n'accepte que (espace, empreinte) ; espaces connus seulement", async () => {
    const sig = await proprio.query(
      `SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
       FROM pg_proc WHERE proname IN ('reserver_tentative_auth', 'liberer_tentatives_auth',
                                      'debloquer_tentatives_auth')
       ORDER BY proname`,
    );
    expect(sig.rows).toEqual([
      { proname: "debloquer_tentatives_auth", args: "p_espace text, p_cle text", prosecdef: true },
      { proname: "liberer_tentatives_auth", args: "p_espace text, p_cle text", prosecdef: true },
      { proname: "reserver_tentative_auth", args: "p_espace text, p_cle text", prosecdef: true },
    ]);
    const k = sha256("x");
    const appel = (sql: string, params: unknown[]) =>
      base.withoutTenant((db) => db.query(sql, params));
    await expect(
      appel("SELECT reserver_tentative_auth($1, $2, 1000, 86400000, 1000000, NULL)", [
        "connexion",
        k,
      ]),
    ).rejects.toThrow(/does not exist|n'existe pas/);
    for (const f of [
      "reserver_tentative_auth",
      "liberer_tentatives_auth",
      "debloquer_tentatives_auth",
    ]) {
      await expect(appel(`SELECT ${f}($1, $2)`, ["inconnu", k]), f).rejects.toThrow(/inconnu/);
      await expect(
        appel(`SELECT ${f}($1, $2)`, ["connexion", "pas-une-empreinte"]),
        f,
      ).rejects.toThrow(/invalides/);
    }
  });

  it("le rôle applicatif n'accède ni à la table, ni à la mécanique paramétrée, ni à l'horloge", async () => {
    const refus = (sql: string, params: unknown[] = []) =>
      expect(base.withoutTenant((db) => db.query(sql, params))).rejects.toThrow(/permission/);
    await refus("SELECT * FROM tentatives_auth");
    await refus("INSERT INTO tentatives_auth VALUES ('connexion', $1, '{}', now())", [
      "0".repeat(64),
    ]);
    await refus("DELETE FROM tentatives_auth");
    await refus("SELECT tentative_auth_reserver('connexion', $1, 1000, interval '1 second', 1)", [
      "0".repeat(64),
    ]);
    await refus(
      "SELECT tentatives_auth_faire_place('connexion', 1000, interval '1 second', 1, now())",
    );
    await refus("SELECT horloge_tentatives_auth()");
    await refus("SELECT * FROM tentatives_auth_regles('connexion')");
  });

  it("horloge : le réglage de test fixe l'instant enregistré ; sans lui, horloge de la base", async () => {
    const l = creerLimiteur(base, "facteur", trousseau);
    const cle = email("horloge");
    const instants = async () =>
      (
        await proprio.query(
          "SELECT instants FROM tentatives_auth WHERE espace = 'facteur' AND cle = $1",
          [empreinteCle(trousseau, cle)],
        )
      ).rows[0].instants as Date[];
    const t = Date.UTC(2026, 2, 3, 4, 5, 6);
    expect(await reserverA(l, cle, t)).toBe(true);
    expect((await instants()).map((d) => d.getTime())).toEqual([t]);
    // Horloge réelle : l'instant de test, sorti de la fenêtre, est oublié.
    expect(await l.reserver(cle)).toBe(true);
    const [reel, ...reste] = await instants();
    expect(reste).toEqual([]);
    expect(Math.abs((reel?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
  });
});

describe("limiteur de l'application : fenêtre glissante, empreinte, déblocage", () => {
  it("au plus 10 tentatives sur toute période de 15 min (fenêtre glissante)", async () => {
    const l = creerLimiteur(base, "connexion", trousseau);
    const cle = email("glisse");
    const t0 = Date.UTC(2026, 0, 3);
    for (let i = 0; i < 10; i++) expect(await reserverA(l, cle, t0 + i * 10_000)).toBe(true);
    expect(await reserverA(l, cle, t0 + 100_000)).toBe(false); // 10 dans la fenêtre
    // Une fenêtre fixe repartirait de zéro ici ; la fenêtre glissante ne rend qu'un essai.
    expect(await reserverA(l, cle, t0 + QUINZE_MIN + 1)).toBe(true); // t0 est sorti
    expect(await reserverA(l, cle, t0 + QUINZE_MIN + 2)).toBe(false);
    expect(await reserverA(l, cle, t0 + QUINZE_MIN + 10_001)).toBe(true); // t0 + 10 s est sorti
  });

  /* Mineur 4 : l'empreinte SHA-256 nue d'un e-mail se recalcule depuis une fuite de la base. */
  it("clé = e-mail normalisé en empreinte HMAC à clé dérivée de TFA_MASTER_KEY ; libérer efface", async () => {
    const l = creerLimiteur(base, "facteur", trousseau);
    const cle = email("libere");
    expect(await l.reserver(cle.toUpperCase())).toBe(true);
    expect(await l.reserver(` ${cle} `)).toBe(true);
    for (let i = 0; i < 8; i++) await l.reserver(cle);
    expect(await l.reserver(cle)).toBe(false); // même clé normalisée : 10 atteint
    const attendue = empreinteCle(trousseau, cle);
    const lignes = await proprio.query(
      "SELECT espace, cle FROM tentatives_auth WHERE cle = ANY($1)",
      [[attendue, sha256(cle)]],
    );
    expect(lignes.rows).toEqual([{ espace: "facteur", cle: attendue }]);
    expect(attendue).not.toBe(sha256(cle));
    expect(JSON.stringify(lignes.rows)).not.toContain("exemple");
    // Une autre clé maîtresse donne une autre empreinte (la base seule ne suffit pas).
    const autre = creerTrousseau({ 7: "une-autre-cle-maitresse-de-test-000000" }, 7);
    expect(empreinteCle(autre, cle)).not.toBe(attendue);
    expect(empreinteCle(autre, cle)).toMatch(/^[0-9a-f]{64}$/);
    await l.liberer(cle.toUpperCase());
    expect(await l.reserver(cle)).toBe(true);
  });

  it("espaces distincts : compteurs distincts", async () => {
    const connexion = creerLimiteur(base, "connexion", trousseau);
    const reauth = creerLimiteur(base, "reauth", trousseau);
    const cle = email("espaces");
    for (let i = 0; i < 10; i++) await connexion.reserver(cle);
    expect(await connexion.reserver(cle)).toBe(false);
    expect(await reauth.reserver(cle)).toBe(true);
  });

  it("débloquer : efface le compteur et dit si la clé était bloquée", async () => {
    const l = creerLimiteur(base, "connexion", trousseau);
    const cle = email("debloque");
    for (let i = 0; i < 10; i++) await l.reserver(cle);
    expect(await l.reserver(cle)).toBe(false);
    expect(await l.debloquer(cle)).toBe(true);
    expect(await l.reserver(cle)).toBe(true);
    expect(await l.debloquer(cle)).toBe(false); // une seule tentative : pas bloquée
    expect(await l.debloquer(email("inconnu"))).toBe(false);
  });
});

describe("limiteur de l'application : persistance et partage", () => {
  let ctx: Contexte;
  beforeAll(async () => {
    ctx = await demarrer();
  });
  afterAll(async () => {
    await ctx.fermer();
  });

  it("partagé entre instances (pools distincts) et conservé au redémarrage", async () => {
    const l1 = creerLimiteur(base, "reauth", trousseau);
    const l2 = creerLimiteur(autreBase, "reauth", trousseau);
    const cle = email("partage");
    for (let i = 0; i < 10; i++) expect(await (i % 2 ? l1 : l2).reserver(cle)).toBe(true);
    expect(await l1.reserver(cle)).toBe(false);
    expect(await l2.reserver(cle)).toBe(false);
    // « Redémarrage » : un limiteur neuf retrouve l'état.
    expect(await creerLimiteur(base, "reauth", trousseau).reserver(cle)).toBe(false);
  });

  it("concurrence : N réservations parallèles (nouvelle clé, deux instances) ne dépassent pas le plafond", async () => {
    for (const n of [40, 25]) {
      const l1 = creerLimiteur(base, "facteur", trousseau);
      const l2 = creerLimiteur(autreBase, "facteur", trousseau);
      const cle = email("concur");
      const r = await Promise.all(
        Array.from({ length: n }, (_, i) => (i % 2 ? l1 : l2).reserver(cle)),
      );
      expect(r.filter(Boolean)).toHaveLength(10);
    }
  });

  it("concurrence dans des transactions appelantes : le plafond tient aussi", async () => {
    const l = creerLimiteur(base, "facteur", trousseau);
    const cle = email("transac");
    const r = await Promise.all(
      Array.from({ length: 12 }, () => base.withoutTenant((db) => l.reserver(cle, db))),
    );
    expect(r.filter(Boolean)).toHaveLength(10);
  });

  it("le blocage de connexion survit à une nouvelle instance de l'application", async () => {
    const adresse = email("limite");
    const essai = (app: Contexte["app"]) =>
      app.inject({
        method: "POST",
        url: "/api/auth/connexion",
        payload: { email: adresse, mot_de_passe: "faux" },
      });
    for (let i = 0; i < 10; i++) expect((await essai(ctx.app)).statusCode).toBe(401);
    const autre = await demarrer();
    try {
      const r = await essai(autre.app);
      expect(r.statusCode).toBe(429);
      expect(r.json().erreur.code).toBe("TROP_DE_TENTATIVES");
    } finally {
      await autre.fermer();
    }
  });
});
