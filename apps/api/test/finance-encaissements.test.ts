import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ajouterJours } from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import { aujourdhui } from "../src/missions/outils.js";
import { configTest, demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { factureDatee } from "./finance-outils.js";
import { creerMissionSignee, TOUS_LES_ROLES } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let missionA: string;
const jour = aujourdhui();
const il = (n: number) => ajouterJours(jour, -n);

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Encaissements A");
  b = await preparerFacturation(ctx, "Cabinet Encaissements B");
  missionA = (await creerMissionSignee(a, { mode_facturation: "forfait" })).id;
});
afterAll(() => ctx.fermer());

const encaissement = (
  factures: { id: string; montant: number }[],
  montant: number,
  extra = {},
) => ({
  client_id: a.clientId,
  date: il(1),
  montant,
  mode: "virement",
  reference: "VIR-TEST",
  imputations: factures.map((f) => ({ facture_id: f.id, montant: f.montant })),
  ...extra,
});

const paiement = async (id: string) =>
  (await a.gestionnaire.get(`/api/factures/${id}/paiement`)).json();

/** Transaction propriétaire ouverte qui tient un verrou jusqu'à `liberer()`. */
async function tenirVerrou(sql: string, params: unknown[]): Promise<{ liberer(): Promise<void> }> {
  const cl = new pg.Client({ connectionString: configTest().DATABASE_OWNER_URL });
  await cl.connect();
  await cl.query("BEGIN");
  await cl.query(sql, params);
  let libere = false;
  return {
    liberer: async () => {
      if (libere) return;
      libere = true;
      await cl.query("COMMIT");
      await cl.end();
    },
  };
}

/** Nombre de verrous en attente dans la base de test (autres bases du serveur exclues). */
const verrousEnAttente = () =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity s ON s.pid = l.pid
           WHERE NOT l.granted AND s.datname = current_database()`,
        )
      ).rows[0].n as number,
  );

/** Attend qu'une condition soit vraie (au plus `ms`) ; renvoie son dernier état. */
async function attendreQue(condition: () => Promise<boolean>, ms = 5_000): Promise<boolean> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return condition();
}

/** Promesse résolue en « délai » si `p` ne l'est pas dans `ms`. */
const avantDelai = <T>(p: Promise<T>, ms: number): Promise<T | "délai"> =>
  Promise.race([p, new Promise<"délai">((r) => setTimeout(() => r("délai"), ms))]);

describe("encaissements et statut de paiement dérivé (FIN-09)", () => {
  it("paiement partiel puis solde ; statut dérivé, jamais stocké", async () => {
    const f = await factureDatee(ctx, a, missionA, 1_000_000, il(10));
    expect(f.net_a_payer).toBe(1_180_000);
    expect((await paiement(f.id)).statut_paiement).toBe("non_payee");
    const r = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 400_000 }], 400_000),
    );
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ montant: 400_000, non_impute: 0, avance: false });
    expect(await paiement(f.id)).toMatchObject({
      statut_paiement: "partiellement_payee",
      encaisse: 400_000,
      solde: 780_000,
    });
    // Trop-perçu refusé : imputation supérieure au reste à payer.
    const trop = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 780_001 }], 780_001),
    );
    expect(trop.statusCode).toBe(409);
    expect(trop.json().erreur.code).toBe("TROP_PERCU");
    attendre(
      201,
      await a.gestionnaire.post(
        "/api/finance/encaissements",
        encaissement([{ id: f.id, montant: 780_000 }], 780_000, {
          mode: "mobile_money",
          operateur: "wave",
          reference: "WAVE-123",
        }),
      ),
      "solde",
    );
    expect(await paiement(f.id)).toMatchObject({ statut_paiement: "soldee", solde: 0 });
    // Aucune colonne de statut de paiement en base.
    const colonnes = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'factures' AND column_name IN ('statut_paiement', 'payee', 'solde', 'encaisse')",
          )
        ).rows,
    );
    expect(colonnes).toEqual([]);
  });

  it("facture échue non soldée : en retard ; imputation sur plusieurs factures", async () => {
    const f1 = await factureDatee(ctx, a, missionA, 100_000, il(45));
    const f2 = await factureDatee(ctx, a, missionA, 200_000, il(40));
    expect(await paiement(f1.id)).toMatchObject({ statut_paiement: "en_retard", jours_retard: 15 });
    const r = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement(
        [
          { id: f1.id, montant: 118_000 },
          { id: f2.id, montant: 100_000 },
        ],
        218_000,
        { mode: "cheque", reference: "CHQ-0042" },
      ),
    );
    expect(r.statusCode).toBe(201);
    expect(r.json().imputations).toHaveLength(2);
    expect((await paiement(f1.id)).statut_paiement).toBe("soldee");
    expect(await paiement(f2.id)).toMatchObject({ statut_paiement: "en_retard", solde: 136_000 });
  });

  it("part non imputée refusée sauf avance explicite, imputée plus tard", async () => {
    const f = await factureDatee(ctx, a, missionA, 50_000, il(5));
    const refuse = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([], 30_000),
    );
    expect(refuse.statusCode).toBe(409);
    expect(refuse.json().erreur.code).toBe("TROP_PERCU");
    const avance = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([], 30_000, { avance: true, mode: "especes", reference: null }),
    );
    expect(avance.statusCode).toBe(201);
    expect(avance.json()).toMatchObject({ avance: true, non_impute: 30_000 });
    const imputee = await a.gestionnaire.post(
      `/api/finance/encaissements/${avance.json().id}/imputations`,
      { imputations: [{ facture_id: f.id, montant: 30_000 }] },
    );
    expect(imputee.statusCode).toBe(200);
    expect(imputee.json().non_impute).toBe(0);
    expect(imputee.json().imputations[0].origine).toBe("avance");
    const encore = await a.gestionnaire.post(
      `/api/finance/encaissements/${avance.json().id}/imputations`,
      { imputations: [{ facture_id: f.id, montant: 1 }] },
    );
    expect(encore.statusCode).toBe(400);
  });

  it("validation des saisies (Mobile Money, chèque, date, schéma strict)", async () => {
    const f = await factureDatee(ctx, a, missionA, 10_000, il(3));
    const base = encaissement([{ id: f.id, montant: 1_000 }], 1_000);
    const cas: [Record<string, unknown>, number][] = [
      [{ mode: "mobile_money", reference: "OM-1" }, 400],
      [{ mode: "mobile_money", operateur: "orange_money", reference: null }, 400],
      [{ mode: "cheque", reference: null }, 400],
      [{ date: ajouterJours(jour, 2) }, 400],
      [{ date: "1999-12-31" }, 400],
      [{ montant: 0 }, 400],
      [{ montant: 10.5 }, 400],
      [{ inconnu: true }, 400],
      [{ client_id: b.clientId }, 400],
    ];
    for (const [modif, statut] of cas) {
      const r = await a.gestionnaire.post("/api/finance/encaissements", { ...base, ...modif });
      expect(r.statusCode, JSON.stringify(modif)).toBe(statut);
    }
    // Encaissement antérieur à l'émission : refusé (sauf avance).
    const avant = await a.gestionnaire.post("/api/finance/encaissements", {
      ...base,
      date: il(4),
    });
    expect(avant.statusCode).toBe(400);
  });

  it("matrice des 8 rôles : encaissement.gerer (gestionnaire, associé)", async () => {
    const autorises: Role[] = ["associe", "gestionnaire"];
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      const liste = await u.get("/api/finance/encaissements");
      const creation = await u.post("/api/finance/encaissements", {});
      if (autorises.includes(role)) {
        expect(liste.statusCode, role).toBe(200);
        expect(creation.statusCode, role).toBe(400);
      } else {
        expect(liste.statusCode, role).toBe(403);
        expect(creation.statusCode, role).toBe(403);
      }
    }
    expect(
      (await ctx.app.inject({ method: "GET", url: "/api/finance/encaissements" })).statusCode,
    ).toBe(401);
  });

  it("isolation entre cabinets : encaissement, facture et créances invisibles", async () => {
    const f = await factureDatee(ctx, a, missionA, 20_000, il(2));
    const e = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 5_000 }], 5_000),
    );
    expect((await b.gestionnaire.get(`/api/finance/encaissements/${e.json().id}`)).statusCode).toBe(
      404,
    );
    expect((await b.gestionnaire.get(`/api/factures/${f.id}/paiement`)).statusCode).toBe(404);
    const croise = await b.gestionnaire.post("/api/finance/encaissements", {
      ...encaissement([{ id: f.id, montant: 1_000 }], 1_000),
      client_id: b.clientId,
    });
    expect(croise.statusCode).toBe(400);
    expect(
      (
        await b.gestionnaire.post(`/api/finance/encaissements/${e.json().id}/contre-passation`, {
          motif: "x",
        })
      ).statusCode,
    ).toBe(404);
    const liste = (await b.gestionnaire.get("/api/finance/encaissements?limite=100")).json();
    expect(liste.elements.map((x: { id: string }) => x.id)).not.toContain(e.json().id);
    const creances = (await b.gestionnaire.get("/api/finance/creances")).json();
    expect(creances.elements.map((x: { facture_id: string }) => x.facture_id)).not.toContain(f.id);
  });
});

describe("contre-passation (ajout seul, séparation des tâches)", () => {
  it("demandée, refusée à son auteur, validée par un autre : encaissement négatif lié", async () => {
    const f = await factureDatee(ctx, a, missionA, 300_000, il(20));
    const e = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 354_000 }], 354_000),
    );
    expect((await paiement(f.id)).statut_paiement).toBe("soldee");
    // Motif obligatoire.
    expect(
      (await a.gestionnaire.post(`/api/finance/encaissements/${e.json().id}/contre-passation`, {}))
        .statusCode,
    ).toBe(400);
    const d = await a.gestionnaire.post(
      `/api/finance/encaissements/${e.json().id}/contre-passation`,
      {
        motif: "Chèque rejeté par la banque",
      },
    );
    expect(d.statusCode).toBe(201);
    expect(
      (
        await a.gestionnaire.post(`/api/finance/encaissements/${e.json().id}/contre-passation`, {
          motif: "Doublon",
        })
      ).statusCode,
    ).toBe(409);
    const parAuteur = await a.gestionnaire.post(
      `/api/finance/contre-passations/${d.json().id}/valider`,
    );
    expect(parAuteur.statusCode).toBe(403);
    expect(parAuteur.json().erreur.code).toBe("VALIDATION_REQUISE");
    const autre = await a.avecRoles(["gestionnaire"]);
    const v = await autre.post(`/api/finance/contre-passations/${d.json().id}/valider`);
    expect(v.statusCode).toBe(200);
    expect(v.json().contre_passation).toMatchObject({
      montant: -354_000,
      contre_passation_de: e.json().id,
      motif: "Chèque rejeté par la banque",
      valide_par: autre.utilisateurId,
    });
    expect(v.json().contre_passation.imputations[0]).toMatchObject({
      montant: -354_000,
      origine: "contre_passation",
    });
    expect(await paiement(f.id)).toMatchObject({ statut_paiement: "non_payee", solde: 354_000 });
    // L'original reste intact (ajout seul) et ne se contre-passe plus.
    expect(
      (await a.gestionnaire.get(`/api/finance/encaissements/${e.json().id}`)).json(),
    ).toMatchObject({
      montant: 354_000,
      contre_passe_par: v.json().contre_passation.id,
    });
    expect(
      (
        await a.gestionnaire.post(`/api/finance/encaissements/${e.json().id}/contre-passation`, {
          motif: "Encore",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await autre.post(`/api/finance/contre-passations/${d.json().id}/valider`)).statusCode,
    ).toBe(409);
  });

  it("un associé valide sa propre demande ; un rejet est motivé", async () => {
    const f = await factureDatee(ctx, a, missionA, 10_000, il(2));
    const e1 = await a.associe.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 5_000 }], 5_000),
    );
    const d1 = await a.associe.post(`/api/finance/encaissements/${e1.json().id}/contre-passation`, {
      motif: "Erreur de saisie",
    });
    expect(
      (await a.associe.post(`/api/finance/contre-passations/${d1.json().id}/valider`)).statusCode,
    ).toBe(200);
    const e2 = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 5_000 }], 5_000),
    );
    const d2 = await a.gestionnaire.post(
      `/api/finance/encaissements/${e2.json().id}/contre-passation`,
      {
        motif: "Doute",
      },
    );
    expect(
      (await a.associe.post(`/api/finance/contre-passations/${d2.json().id}/rejeter`, {}))
        .statusCode,
    ).toBe(400);
    const rj = await a.associe.post(`/api/finance/contre-passations/${d2.json().id}/rejeter`, {
      motif: "Paiement confirmé",
    });
    expect(rj.json()).toMatchObject({ statut: "rejetee", motif_rejet: "Paiement confirmé" });
    const liste = (
      await a.gestionnaire.get("/api/finance/contre-passations?statut=rejetee")
    ).json();
    expect(liste.elements.map((x: { id: string }) => x.id)).toContain(d2.json().id);
  });

  it("une facture encaissée ne s'annule pas par avoir avant contre-passation", async () => {
    const f = await factureDatee(ctx, a, missionA, 10_000, il(2));
    await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 1_000 }], 1_000),
    );
    const avoir = await a.gestionnaire.post(`/api/factures/${f.id}/avoir`, { motif: "Erreur" });
    expect(avoir.statusCode).toBe(409);
    expect(avoir.json().erreur.code).toBe("FACTURE_ENCAISSEE");
  });

  it("immuabilité en SQL direct avec le rôle applicatif (encaissements, imputations)", async () => {
    const f = await factureDatee(ctx, a, missionA, 10_000, il(1));
    const e = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 2_000 }], 2_000),
    );
    const id = e.json().id as string;
    const essais = [
      ["UPDATE encaissements SET montant = 1 WHERE id = $1", [id]],
      ["DELETE FROM encaissements WHERE id = $1", [id]],
      ["UPDATE imputations SET montant = 1 WHERE encaissement_id = $1", [id]],
      ["DELETE FROM imputations WHERE encaissement_id = $1", [id]],
    ] as const;
    for (const [sql, params] of essais) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [...params])),
        sql,
      ).rejects.toMatchObject({ code: "42501" });
    }
    // Même le propriétaire ne modifie pas (déclencheur).
    await expect(
      proprietaire((cl) =>
        cl.query("UPDATE encaissements SET commentaire = 'x' WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPE01" });
    // Imputation négative hors contre-passation : refusée par le déclencheur.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO imputations (cabinet_id, encaissement_id, facture_id, montant, devise, origine,
             date_imputation, cree_par) VALUES ($1, $2, $3, -1, 'XOF', 'contre_passation', current_date, $4)`,
          [a.cabinetId, id, f.id, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPE02" });
  });
});

describe("créances et balance âgée (FIN-09)", () => {
  it("tranches par client et total par le moteur ; droits décidés", async () => {
    const c = await preparerFacturation(ctx, "Cabinet Balance");
    const m = (await creerMissionSignee(c, { mode_facturation: "forfait" })).id;
    // Échéances : J-40 (retard 10), J-75 (retard 45), J-130 (retard 100) ; une non échue.
    const f1 = await factureDatee(ctx, c, m, 100_000, il(40));
    await factureDatee(ctx, c, m, 200_000, il(75));
    await factureDatee(ctx, c, m, 300_000, il(130));
    await factureDatee(ctx, c, m, 50_000, il(1));
    await c.gestionnaire.post("/api/finance/encaissements", {
      client_id: c.clientId,
      date: jour,
      montant: 18_000,
      mode: "especes",
      imputations: [{ facture_id: f1.id, montant: 18_000 }],
    });
    const r = await c.gestionnaire.get(`/api/finance/balance-agee?date=${jour}`);
    expect(r.statusCode).toBe(200);
    const xof = r.json().devises.find((d: { devise: string }) => d.devise === "XOF");
    expect(xof.total).toEqual({
      non_echu: 59_000,
      j0_30: 100_000,
      j31_60: 236_000,
      j61_90: 0,
      plus_90: 354_000,
      total: 749_000,
    });
    expect(xof.clients).toHaveLength(1);
    expect(xof.clients[0]).toMatchObject({ client_id: c.clientId, total: 749_000 });
    // À une date antérieure : les factures non encore émises n'y sont pas.
    const avant = (await c.gestionnaire.get(`/api/finance/balance-agee?date=${il(100)}`)).json();
    expect(avant.devises[0].total.total).toBe(354_000);
    const creances = (await c.gestionnaire.get("/api/finance/creances")).json();
    expect(creances.elements).toHaveLength(4);

    const roles: Record<Role, number> = {
      associe: 200,
      directeur_mission: 200,
      gestionnaire: 200,
      chef_mission: 403,
      consultant: 403,
      ressources: 403,
      expert_metier: 403,
      expert_externe: 403,
    };
    for (const role of TOUS_LES_ROLES) {
      const u = await c.avecRoles([role]);
      expect((await u.get("/api/finance/balance-agee")).statusCode, role).toBe(roles[role]);
    }
    // Isolation : rien du cabinet c dans la balance de b.
    const autre = (await b.gestionnaire.get(`/api/finance/balance-agee?date=${jour}`)).json();
    for (const d of autre.devises) {
      expect(d.clients.map((x: { client_id: string }) => x.client_id)).not.toContain(c.clientId);
    }
    expect((await c.gestionnaire.get("/api/finance/balance-agee?date=2026-02-30")).statusCode).toBe(
      400,
    );
    expect((await c.gestionnaire.get("/api/finance/balance-agee?base=autre")).statusCode).toBe(400);
  });
});

describe("durcissement du lot finance (audit de sécurité)", () => {
  it("M1 : contre-passation validée et imputation d'avance simultanées : jamais d'imputation active sur un encaissement contre-passé", async () => {
    const f1 = await factureDatee(ctx, a, missionA, 100_000, il(10));
    const f2 = await factureDatee(ctx, a, missionA, 50_000, il(10));
    const e = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f1.id, montant: 118_000 }], 200_000, { avance: true }),
    );
    attendre(201, e, "encaissement avec avance");
    const d = await a.gestionnaire.post(
      `/api/finance/encaissements/${e.json().id}/contre-passation`,
      { motif: "Virement rejeté" },
    );
    attendre(201, d, "demande");
    const valideur = await a.avecRoles(["gestionnaire"]);
    // Un verrou tenu sur la facture déjà imputée retient la contre-passation au
    // moment où elle verrouille les factures : la fenêtre de course est ouverte
    // de façon déterministe.
    const verrou = await tenirVerrou("SELECT 1 FROM factures WHERE id = $1 FOR UPDATE", [f1.id]);
    let validation: ReturnType<typeof valideur.post> | undefined;
    let imputation: ReturnType<typeof valideur.post> | undefined;
    try {
      validation = valideur.post(`/api/finance/contre-passations/${d.json().id}/valider`);
      expect(await attendreQue(async () => (await verrousEnAttente()) >= 1)).toBe(true);
      let finie = false;
      imputation = a.gestionnaire.post(`/api/finance/encaissements/${e.json().id}/imputations`, {
        imputations: [{ facture_id: f2.id, montant: 59_000 }],
      });
      void imputation.then(() => {
        finie = true;
      });
      // L'imputation se termine (ancien ordre des verrous) ou attend l'encaissement.
      await attendreQue(async () => finie || (await verrousEnAttente()) >= 2, 3_000);
    } finally {
      await verrou.liberer();
    }
    const [v, i] = await Promise.all([validation, imputation]);
    expect(v?.statusCode, v?.body).toBe(200);
    expect(i?.statusCode, i?.body).toBe(409);
    const negatif = v?.json().contre_passation.id as string;
    // Chaque facture : imputations de l'encaissement + miroirs = 0.
    const nets = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT facture_id, sum(montant)::bigint AS net FROM imputations
             WHERE encaissement_id = ANY ($1::uuid[]) GROUP BY facture_id`,
            [[e.json().id, negatif]],
          )
        ).rows,
    );
    for (const n of nets) expect(Number(n.net), n.facture_id).toBe(0);
    expect((await paiement(f1.id)).statut_paiement).toBe("non_payee");
    expect((await paiement(f2.id)).statut_paiement).toBe("non_payee");
  });

  it("F5 : identifiant d'encaissement d'un autre cabinet : 404 sans prendre (ni attendre) son verrou", async () => {
    const f = await factureDatee(ctx, a, missionA, 10_000, il(2));
    const e = await a.gestionnaire.post(
      "/api/finance/encaissements",
      encaissement([{ id: f.id, montant: 1_000 }], 1_000),
    );
    attendre(201, e, "encaissement");
    const id = e.json().id as string;
    // Le cabinet A tient le verrou consultatif de son encaissement.
    const verrou = await tenirVerrou(
      "SELECT pg_advisory_xact_lock(hashtextextended('encaissement:' || $1, 0))",
      [id],
    );
    const demandes = [
      b.gestionnaire.post(`/api/finance/encaissements/${id}/contre-passation`, { motif: "x" }),
      b.gestionnaire.post(`/api/finance/encaissements/${id}/imputations`, {
        imputations: [{ facture_id: f.id, montant: 1 }],
      }),
    ];
    try {
      for (const p of demandes) {
        const r = await avantDelai(p, 3_000);
        expect(r === "délai" ? "délai" : r.statusCode).toBe(404);
      }
    } finally {
      await verrou.liberer();
      await Promise.allSettled(demandes);
    }
  });

  it("F1 : TRUNCATE des historiques financiers refusé, même au propriétaire", async () => {
    for (const table of [
      "encaissements CASCADE",
      "imputations",
      "contre_passations",
      "relances_factures",
      "bilans_mission",
    ]) {
      // Transaction annulée dans tous les cas : rien n'est vidé, même sans le déclencheur.
      const erreur = await proprietaire(async (cl) => {
        await cl.query("BEGIN");
        try {
          await cl.query(`TRUNCATE ${table}`);
          return null;
        } catch (err) {
          return err as { code?: string };
        } finally {
          await cl.query("ROLLBACK");
        }
      });
      expect(erreur?.code, table).toBe("MPE01");
    }
  });

  it("F6 : fonctions de déclencheur SECURITY DEFINER non exécutables par PUBLIC", async () => {
    const r = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT p.proname, bool_or(x.grantee = 0) AS public
             FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
             WHERE p.proname IN ('controler_imputation', 'controler_encaissement',
               'controler_annulation_facture')
             GROUP BY p.proname ORDER BY p.proname`,
          )
        ).rows,
    );
    expect(r).toEqual([
      { proname: "controler_annulation_facture", public: false },
      { proname: "controler_encaissement", public: false },
      { proname: "controler_imputation", public: false },
    ]);
  });
});
