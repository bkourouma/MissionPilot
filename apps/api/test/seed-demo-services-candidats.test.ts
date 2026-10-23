import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import {
  GUICHETS_DEMO,
  IDENTITES_SERVICES_CANDIDATS_DEMO,
  INTITULE_BP_DEMO,
  INTITULE_FLASH_DEMO,
  PRIX_FLASH_DEMO,
  semerServicesCandidatsDemo,
  type IdentitesServicesCandidatsDemo,
} from "../src/db/seed-demo-services-candidats.js";
import { configDemo, emailAbidjan, MOT_DE_PASSE_DEMO_ABIDJAN } from "../src/db/seed-demo.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Seed de démonstration des services candidats (db/seed-demo-services-candidats.ts). Le seed
 * complet de démonstration crée des comptes aux adresses FIXES (collision avec
 * `connexion-demo.test.ts` dans la base partagée) : ici, le même code tourne sur un cabinet de test
 * aux comptes équivalents, avec le mot de passe commun de démonstration (modèle :
 * seed-demo-canaux.test.ts).
 */

let ctx: Contexte;
let a: CabinetMissions;
let identites: IdentitesServicesCandidatsDemo;
let premier: { creees: string[] };

const lignes = (sql: string, params: unknown[] = []) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Seed services candidats");
  const ids = [a.associeId, a.directeur.utilisateurId, a.chef.utilisateurId];
  const hash = await hashPassword(MOT_DE_PASSE_DEMO_ABIDJAN);
  await proprietaire((c) =>
    c.query("UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE id = ANY($2::uuid[])", [
      hash,
      ids,
    ]),
  );
  const email = async (id: string) =>
    (await lignes("SELECT email FROM utilisateurs WHERE id = $1", [id]))[0]?.email as string;
  identites = {
    associe: await email(a.associeId),
    directeur: await email(a.directeur.utilisateurId),
    chef: await email(a.chef.utilisateurId),
    clientRaisonSociale: "Client de Seed services candidats",
  };
  premier = await semerServicesCandidatsDemo(ctx.db, ctx.config, identites);
}, 240_000);
afterAll(() => ctx.fermer());

describe("seed de démonstration des services candidats", () => {
  it("les identités par défaut sont celles des comptes du seed de démonstration", () => {
    expect(IDENTITES_SERVICES_CANDIDATS_DEMO.associe).toBe(emailAbidjan("associe"));
    expect(IDENTITES_SERVICES_CANDIDATS_DEMO.directeur).toBe(emailAbidjan("directeur.mission"));
    expect(IDENTITES_SERVICES_CANDIDATS_DEMO.chef).toBe(emailAbidjan("chef.mission"));
  });

  it("aucun prix par défaut en production : le prix de démonstration est marqué DÉMONSTRATION", async () => {
    expect(PRIX_FLASH_DEMO.commentaire).toBe("DÉMONSTRATION");
    expect(premier.creees).toContain("prix_flash");
    const s = (await a.associe.get("/api/services-candidats")).json().elements as {
      code: string;
      prix: { montant: number; commentaire: string; a_fixer: boolean };
      type_mission: { id: string } | null;
    }[];
    const flash = s.find((x) => x.code === "diagnostic_flash");
    expect(flash?.prix).toMatchObject({
      montant: PRIX_FLASH_DEMO.montant,
      commentaire: "DÉMONSTRATION",
      a_fixer: false,
    });
    expect(flash?.type_mission).not.toBeNull();
    expect(s.find((x) => x.code === "business_plan_bancable")?.type_mission).not.toBeNull();
  });

  it("crée les deux missions liées à leur méthode du standard et les guichets fictifs", async () => {
    expect(premier.creees).toEqual(
      expect.arrayContaining([
        "type_diagnostic_flash",
        "type_business_plan_bancable",
        "mission_diagnostic_flash",
        "mission_business_plan_bancable",
        "guichet",
      ]),
    );
    const missions = await lignes(
      `SELECT m.intitule, mm.methode_version_id, me.code AS methode
         FROM missions m JOIN mission_methodes mm ON mm.mission_id = m.id
         JOIN methode_versions v ON v.id = mm.methode_version_id
         JOIN methodes me ON me.id = v.methode_id
        WHERE m.cabinet_id = $1 ORDER BY m.intitule`,
      [a.cabinetId],
    );
    expect(missions.map((m) => [m.intitule, m.methode])).toEqual([
      [INTITULE_BP_DEMO, "business_plan_bancable"],
      [INTITULE_FLASH_DEMO, "diagnostic_flash"],
    ]);
    const guichets = (await a.associe.get("/api/guichets-financement")).json().elements as {
      nom: string;
      a_valider: boolean;
    }[];
    expect(guichets.map((g) => g.nom).sort()).toEqual(GUICHETS_DEMO.map((g) => g.nom).sort());
    for (const g of guichets) {
      expect(g.nom).toContain("DÉMONSTRATION");
      expect(g.a_valider).toBe(true);
    }
  });

  it("est idempotent : relancé, rien n'est dupliqué ni écrit", async () => {
    const second = await semerServicesCandidatsDemo(ctx.db, ctx.config, identites);
    expect(second.creees).toEqual([]);
    const n = await lignes(
      `SELECT (SELECT count(*) FROM missions WHERE cabinet_id = $1 AND intitule LIKE '%DÉMONSTRATION%')::int AS missions,
              (SELECT count(*) FROM guichets_financement WHERE cabinet_id = $1)::int AS guichets`,
      [a.cabinetId],
    );
    expect(n[0]).toEqual({ missions: 2, guichets: GUICHETS_DEMO.length });
  });

  it("mêmes gardes que le seed de démonstration (jamais en production, base locale)", () => {
    const base = {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
      DATABASE_OWNER_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
    };
    expect(() => configDemo({ ...base, NODE_ENV: "production" })).toThrow(/interdit/);
  });
});
