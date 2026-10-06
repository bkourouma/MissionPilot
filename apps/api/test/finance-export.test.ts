import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ajouterJours } from "@missionpilot/engines";
import { PERMISSIONS_PAR_ROLE, type Permission, type Role } from "@missionpilot/shared";
import { champCsv, ecrituresComptables, montantExport } from "../src/finance/export.js";
import { lirePlanComptable } from "../src/finance/plan-comptable.js";
import { aujourdhui } from "../src/missions/outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { acteur, factureDatee } from "./finance-outils.js";
import { creerMissionSignee, TOUS_LES_ROLES } from "./missions-outils.js";

let ctx: Contexte;
let c: CabinetFacturation;
const jour = aujourdhui();
const il = (n: number) => ajouterJours(jour, -n);
const CLIENT_PIEGE = '=HYPERLINK("http://x.test","clic")';

interface Ligne {
  journal: string;
  date: string;
  piece: string;
  compte: string;
  tiers: string;
  libelle: string;
  debit: string;
  credit: string;
  devise: string;
}

/** Lecture CSV minimale (guillemets doublés, séparateur donné). */
function lire(csv: string, sep = ";"): Ligne[] {
  const lignes = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n");
  const champs = (l: string) => {
    const sortie: string[] = [];
    let courant = "";
    let guillemets = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i] as string;
      if (guillemets) {
        if (ch === '"' && l[i + 1] === '"') {
          courant += '"';
          i++;
        } else if (ch === '"') guillemets = false;
        else courant += ch;
      } else if (ch === '"') guillemets = true;
      else if (ch === sep) {
        sortie.push(courant);
        courant = "";
      } else courant += ch;
    }
    sortie.push(courant);
    return sortie;
  };
  const entetes = champs(lignes[0] as string);
  return lignes
    .slice(1)
    .map((l) => Object.fromEntries(champs(l).map((v, i) => [entetes[i], v])) as unknown as Ligne);
}

const entier = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")));

beforeAll(async () => {
  ctx = await demarrer();
  c = await preparerFacturation(ctx, "Cabinet Export");
  const client = await c.associe.post("/api/clients", { raison_sociale: CLIENT_PIEGE });
  attendre(201, client, "client");
  const m1 = (await creerMissionSignee(c, { mode_facturation: "forfait" })).id;
  const m2 = (
    await creerMissionSignee(c, { mode_facturation: "forfait", client_id: client.json().id })
  ).id;
  const f1 = await factureDatee(ctx, c, m1, 1_000_000, il(20));
  const f2 = await factureDatee(ctx, c, m2, 500_000, il(15));
  // Encaissement avec avance, avance imputée plus tard, puis contre-passation.
  const e = await c.gestionnaire.post("/api/finance/encaissements", {
    client_id: c.clientId,
    date: il(10),
    montant: 1_300_000,
    mode: "cheque",
    reference: "-CHQ 77",
    imputations: [{ facture_id: f1.id, montant: 1_000_000 }],
    avance: true,
  });
  attendre(201, e, "encaissement");
  const f3 = await factureDatee(ctx, c, m1, 100_000, il(5));
  attendre(
    200,
    await c.gestionnaire.post(`/api/finance/encaissements/${e.json().id}/imputations`, {
      imputations: [{ facture_id: f3.id, montant: 118_000 }],
    }),
    "avance",
  );
  attendre(
    201,
    await c.gestionnaire.post("/api/finance/encaissements", {
      client_id: client.json().id,
      date: il(3),
      montant: 590_000,
      mode: "mobile_money",
      operateur: "mtn_momo",
      reference: "MOMO-1",
      imputations: [{ facture_id: f2.id, montant: 590_000 }],
    }),
    "momo",
  );
  const d = await c.gestionnaire.post(
    `/api/finance/encaissements/${e.json().id}/contre-passation`,
    {
      motif: "Chèque impayé",
    },
  );
  attendre(
    200,
    await c.associe.post(`/api/finance/contre-passations/${d.json().id}/valider`),
    "cp",
  );
});
afterAll(() => ctx.fermer());

const exporter = (q = "") =>
  c.gestionnaire.get(`/api/finance/export-comptable?du=${il(60)}&au=${jour}${q}`);

describe("export comptable (FIN-13)", () => {
  it("écritures SYSCOHADA équilibrées pièce par pièce (débit = crédit)", async () => {
    const r = await exporter();
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toContain("attachment");
    const lignes = lire(r.body);
    const pieces = new Map<string, { d: number; c: number }>();
    for (const l of lignes) {
      const p = pieces.get(l.piece) ?? { d: 0, c: 0 };
      p.d += entier(l.debit);
      p.c += entier(l.credit);
      pieces.set(l.piece, p);
    }
    for (const [piece, p] of pieces) expect(p.d, piece).toBe(p.c);
    const total = lignes.reduce((s, l) => s + entier(l.debit) - entier(l.credit), 0);
    expect(total).toBe(0);
    // Facture : 411 au débit (TTC), 706 et 4431 au crédit.
    const facture = lignes.filter((l) => l.journal === "VE");
    expect(facture.some((l) => l.compte === "411" && l.debit === "1180000")).toBe(true);
    expect(facture.some((l) => l.compte === "706" && l.credit === "1000000")).toBe(true);
    expect(facture.some((l) => l.compte === "4431" && l.credit === "180000")).toBe(true);
    // Chèque : 513 au débit, 411 et avance 4191 au crédit ; contre-passation inversée.
    expect(lignes.some((l) => l.compte === "513" && l.debit === "1300000")).toBe(true);
    expect(lignes.some((l) => l.compte === "4191" && l.credit === "300000")).toBe(true);
    expect(lignes.some((l) => l.compte === "513" && l.credit === "1300000")).toBe(true);
    expect(
      lignes.some((l) => l.journal === "OD" && l.compte === "4191" && l.debit === "118000"),
    ).toBe(true);
    expect(
      lignes.some((l) => l.journal === "MM" && l.compte === "552" && l.debit === "590000"),
    ).toBe(true);
  });

  it("neutralise les formules de tableur et applique le format demandé", async () => {
    const brut = (await exporter()).body;
    expect(brut).not.toMatch(/(^|;)=HYPERLINK/m);
    expect(brut).toContain(`"'=HYPERLINK(""http://x.test"",""clic"")"`);
    expect(champCsv("+1", ";")).toBe("'+1");
    expect(champCsv("@SUM(A1)", ";")).toBe("'@SUM(A1)");
    expect(champCsv("-2", ";")).toBe("'-2");
    expect(champCsv("a;b", ";")).toBe('"a;b"');
    expect(montantExport({ valeur: 123450, devise: "EUR" }, "virgule")).toBe("1234,50");
    expect(montantExport({ valeur: 5, devise: "USD" }, "point")).toBe("0.05");
    const bom = await exporter("&bom=oui&separateur=tabulation&format_date=aaaa-mm-jj");
    expect(bom.body.startsWith("\uFEFF")).toBe(true);
    const l = lire(bom.body, "\t");
    expect(l[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const date = lire((await exporter("&format_date=jjmmaaaa")).body)[0]?.date;
    expect(date).toMatch(/^\d{8}$/);
    for (const q of ["&separateur=virgule", "&format=xlsx", "&separateur=pipe", "&inconnu=1"]) {
      expect((await exporter(q)).statusCode, q).toBe(400);
    }
    expect((await exporter("&separateur=virgule&decimale=point")).statusCode).toBe(200);
    expect(
      (await c.gestionnaire.get(`/api/finance/export-comptable?du=2020-01-01&au=${jour}`))
        .statusCode,
    ).toBe(400);
  });

  it("chaque export est journalisé sans montant", async () => {
    await exporter();
    const audit = (await c.associe.get("/api/audit?entite=export_comptable")).json().elements;
    expect(audit.length).toBeGreaterThan(0);
    const d = audit[0].details as Record<string, unknown>;
    expect(d).toMatchObject({ du: il(60), au: jour, format: "csv" });
    expect(d.lignes).toBeGreaterThan(10);
    expect(JSON.stringify(d)).not.toMatch(/1180000|1300000|montant|debit|credit/);
  });

  it("plan comptable : valeurs de départ SYSCOHADA, modification, validation", async () => {
    const p = (await c.gestionnaire.get("/api/finance/plan-comptable")).json();
    expect(p.valeurs_validees).toBe(false);
    expect(p.comptes.find((x: { cle: string }) => x.cle === "clients").compte).toBe("411");
    expect((await c.gestionnaire.patch("/api/finance/plan-comptable", {})).statusCode).toBe(400);
    expect(
      (await c.gestionnaire.patch("/api/finance/plan-comptable", { comptes: { banque: "52;1" } }))
        .statusCode,
    ).toBe(400);
    const m = await c.gestionnaire.patch("/api/finance/plan-comptable", {
      comptes: { banque: "5211" },
      journaux: { banque: "BQ1" },
      valeurs_validees: true,
    });
    expect(m.statusCode).toBe(200);
    expect(m.json().valeurs_validees).toBe(true);
    const lignes = lire((await exporter()).body);
    // Le chèque passe désormais au journal BQ1 (compte 513 inchangé).
    expect(lignes.some((l) => l.journal === "BQ1" && l.compte === "513")).toBe(true);
    expect(lignes.some((l) => l.journal === "BQ")).toBe(false);
  });

  it("F4 : l'export porte sur tout le cabinet et exige mission.lire_toutes", async () => {
    // Module : un lecteur qui ne voit pas toutes les missions est refusé (aucun filtre partiel).
    const plan = await ctx.db.withTenant(c.cabinetId, (db) => lirePlanComptable(db));
    await expect(
      ctx.db.withTenant(c.cabinetId, (db) =>
        ecrituresComptables(
          db,
          acteur(c.cabinetId, c.chef.utilisateurId, "chef_mission"),
          il(60),
          jour,
          plan,
        ),
      ),
    ).rejects.toMatchObject({ statut: 403 });
    // Route : un rôle qui recevrait « export.comptable » sans « mission.lire_toutes » → 403.
    const droits = PERMISSIONS_PAR_ROLE.chef_mission as Permission[];
    droits.push("export.comptable");
    try {
      const r = await c.chef.get(`/api/finance/export-comptable?du=${il(60)}&au=${jour}`);
      expect(r.statusCode, r.body).toBe(403);
    } finally {
      droits.splice(droits.indexOf("export.comptable"), 1);
    }
    // Lecteur autorisé : factures ET encaissements de tous les clients du cabinet.
    const lignes = lire((await exporter()).body);
    expect(lignes.some((l) => l.tiers === `'${CLIENT_PIEGE}` && l.compte === "552")).toBe(true);
    expect(lignes.some((l) => l.tiers === `'${CLIENT_PIEGE}` && l.journal === "VE")).toBe(true);
  });

  it("matrice des 8 rôles (export.comptable) et isolation", async () => {
    for (const role of TOUS_LES_ROLES) {
      const u = await c.avecRoles([role]);
      const attendu = (["associe", "gestionnaire"] as Role[]).includes(role) ? 200 : 403;
      expect(
        (await u.get(`/api/finance/export-comptable?du=${il(60)}&au=${jour}`)).statusCode,
        role,
      ).toBe(attendu);
      expect((await u.get("/api/finance/plan-comptable")).statusCode, role).toBe(attendu);
    }
    const autre = await preparerFacturation(ctx, "Cabinet Export B", false);
    const vide = await autre.gestionnaire.get(
      `/api/finance/export-comptable?du=${il(60)}&au=${jour}`,
    );
    expect(lire(vide.body)).toEqual([]);
    expect(
      (await autre.gestionnaire.get("/api/finance/plan-comptable")).json().comptes[6].compte,
    ).toBe("521");
    // RLS : le plan comptable de c est invisible de l'autre cabinet.
    const n = await ctx.db.withTenant(autre.cabinetId, (db) =>
      db.query("SELECT count(*)::int AS n FROM plan_comptable_cabinet"),
    );
    expect(n.rows[0].n).toBe(0);
    expect(
      (
        await proprietaire((cl) =>
          cl.query("SELECT count(*)::int AS n FROM plan_comptable_cabinet WHERE cabinet_id = $1", [
            c.cabinetId,
          ]),
        )
      ).rows[0].n,
    ).toBe(2);
  });
});
