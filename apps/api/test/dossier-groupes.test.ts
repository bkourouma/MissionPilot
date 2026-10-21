import { arrondirPoints, consoliderGroupe } from "@missionpilot/engines";
import { aPermission, PARTICIPATIONS_PAR_CABINET_MAX } from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { clesDe, preparerPortail, type ScenarioPortail } from "./portail-outils.js";

/*
 * Groupes et filiales du dossier client (DOS-05) : historique de détention en ajout seul,
 * règles du moteur doublées en base (MQF01 à MQF04), visibilité (noeuds anonymes), isolation
 * entre cabinets, portail fermé, consolidation simple (états acceptés courants seulement), FIN-02.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let c: CabinetMissions;
let consultantEquipe: ApiUtilisateur;
let consultantHors: ApiUtilisateur;
let expert: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let compteur = 0;
const INCONNU = "00000000-0000-4000-8000-000000000000";

function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

async function client(cab: CabinetMissions, nom: string): Promise<string> {
  compteur += 1;
  const r = await cab.associe.post("/api/clients", { raison_sociale: `${nom} ${compteur}` });
  attendre(201, r, "client");
  return r.json().id as string;
}

const lier = (
  de: string,
  vers: string,
  points: number,
  date = "2026-01-01",
  extra: Record<string, unknown> = {},
) =>
  a.associe.post(`/api/dossiers/${vers}/participations`, {
    detenteur_id: de,
    filiale_id: vers,
    points_base: points,
    date_effet: date,
    ...extra,
  });

async function lierOk(de: string, vers: string, points: number, date = "2026-01-01") {
  const r = await a.associe.post(`/api/dossiers/${de}/participations`, {
    detenteur_id: de,
    filiale_id: vers,
    points_base: points,
    date_effet: date,
  });
  attendre(201, r, `participation ${points}`);
  return r.json();
}

/** État équilibré, montants multipliés par k : actif = passif = 1000k, produits 500k, charges 400k. */
const lignes = (k: number, ecart = 0) => [
  { code: "AZ", libelle: "Actif immobilisé", section: "actif", montant: 600 * k },
  { code: "BT", libelle: "Trésorerie", section: "actif", montant: 400 * k - ecart },
  {
    code: "BZ",
    libelle: "Total actif",
    section: "actif",
    montant: 1000 * k - ecart,
    role: "total",
  },
  { code: "CA", libelle: "Capital", section: "passif", montant: 500 * k },
  {
    code: "CJ",
    libelle: "Résultat",
    section: "passif",
    montant: 100 * k,
    role: "resultat_exercice",
  },
  { code: "DJ", libelle: "Fournisseurs", section: "passif", montant: 400 * k },
  { code: "RA", libelle: "Achats", section: "charges", montant: 400 * k },
  { code: "TA", libelle: "Ventes", section: "produits", montant: 500 * k },
];

async function etat(clientId: string, exercice: number, k: number, devise = "XOF", ecart = 0) {
  const r = await a.associe.post(`/api/dossiers/${clientId}/etats-financiers`, {
    exercice,
    date_cloture: `${exercice}-12-31`,
    devise,
    source_libelle: `Liasse ${exercice}`,
    lignes: lignes(k, ecart),
  });
  attendre(201, r, "état");
  return r.json() as { id: string; statut: string };
}

/** Client dont le dossier est visible du consultant d'équipe (mission + équipe). */
async function clientVisible(nom: string): Promise<string> {
  const id = await client(a, nom);
  const m = await creerMission(a, { client_id: id, intitule: `Mission ${nom}` });
  attendre(
    201,
    await a.chef.post(`/api/missions/${m.id}/equipe`, {
      utilisateur_id: consultantEquipe.utilisateurId,
    }),
    "équipe",
  );
  return id;
}

const groupe = (
  u: { get: (url: string) => ReturnType<ReturnType<typeof api>["get"]> },
  id: string,
  q = "",
) => u.get(`/api/dossiers/${id}/groupe${q}`);

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Groupes A");
  b = await preparerCabinet(ctx, "Groupes B");
  c = await preparerCabinet(ctx, "Groupes C");
  const missionId = (await creerMission(a, { intitule: "Diagnostic groupe" })).id;
  consultantEquipe = await a.avecRoles(["consultant"]);
  consultantHors = await a.avecRoles(["consultant"]);
  expert = await a.avecRoles(["expert_metier"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  for (const u of [consultantEquipe, expert]) {
    attendre(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
      "équipe",
    );
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("droits", () => {
  it("401 sans session, 403 sans dossier.lire ou sans dossier.ecrire, 201 avec", async () => {
    const f = await client(a, "Filiale droits");
    const corps = {
      detenteur_id: a.clientId,
      filiale_id: f,
      points_base: 1000,
      date_effet: "2026-01-01",
    };
    const url = `/api/dossiers/${f}`;
    expect((await api(ctx).get(`${url}/groupe`)).statusCode).toBe(401);
    expect((await api(ctx).get(`${url}/participations`)).statusCode).toBe(401);
    expect((await api(ctx).post(`${url}/participations`, corps)).statusCode).toBe(401);
    expect((await gestionnaire.get(`${url}/groupe`)).statusCode).toBe(403);
    expect((await gestionnaire.get(`${url}/participations`)).statusCode).toBe(403);
    expect((await gestionnaire.post(`${url}/participations`, corps)).statusCode).toBe(403);
    // Expert métier : lecture seule (le dossier de la mission est visible, pas celui de f : 404).
    expect((await expert.get(`/api/dossiers/${a.clientId}/groupe`)).statusCode).toBe(200);
    expect((await expert.get(`/api/dossiers/${a.clientId}/participations`)).statusCode).toBe(200);
    const refus = await expert.post(`/api/dossiers/${a.clientId}/participations`, corps);
    expect(refus.statusCode).toBe(403);
    const ok = await a.directeur.post(`${url}/participations`, corps);
    attendre(201, ok, "directeur");
    expect(ok.json()).toMatchObject({
      points_base: 1000,
      date_effet: "2026-01-01",
      fin_de_detention: false,
    });
  });

  it("corps invalide ou dossier étranger à la participation : 400", async () => {
    const [x, y, z] = [await client(a, "X"), await client(a, "Y"), await client(a, "Z")];
    const corps = { detenteur_id: x, filiale_id: y, points_base: 500, date_effet: "2026-01-01" };
    const sur = (id: string, p: unknown) => a.associe.post(`/api/dossiers/${id}/participations`, p);
    // Le dossier de l'URL doit être le détenteur ou la filiale.
    expect((await sur(z, corps)).statusCode).toBe(400);
    expect((await sur(x, { ...corps, intrus: 1 })).statusCode).toBe(400);
    expect((await sur(x, { ...corps, points_base: 10_001 })).statusCode).toBe(400);
    expect((await sur(x, { ...corps, points_base: 12.5 })).statusCode).toBe(400);
    expect((await sur(x, { ...corps, points_base: -1 })).statusCode).toBe(400);
    expect((await sur(x, { ...corps, date_effet: "2026-13-01" })).statusCode).toBe(400);
    expect((await sur(x, { ...corps, filiale_id: x })).statusCode).toBe(400);
    expect((await sur(x, { ...corps, points_base: 0 })).statusCode).toBe(400);
    expect((await sur(x, { ...corps, filiale_id: "pas-un-uuid" })).statusCode).toBe(400);
    expect((await sur(INCONNU, { ...corps, detenteur_id: INCONNU })).statusCode).toBe(404);
    attendre(201, await sur(y, corps), "depuis la filiale");
  });
});

describe("règles de détention (moteur) et ajout seul", () => {
  it("cycles direct, indirect et futur refusés ; auto-détention refusée", async () => {
    const [p, q, r] = [await client(a, "P"), await client(a, "Q"), await client(a, "R")];
    await lierOk(p, q, 5000);
    await lierOk(q, r, 5000);
    const direct = await lier(q, p, 100);
    expect(direct.statusCode).toBe(409);
    expect(direct.json().erreur.code).toBe("DETENTION_CYCLE");
    // Le message ne cite aucun identifiant de dossier.
    expect(direct.body).not.toContain(p);
    const indirect = await lier(r, p, 100);
    expect(indirect.statusCode).toBe(409);
    expect(indirect.json().erreur.code).toBe("DETENTION_CYCLE");
    // Cycle « futur » : un lien à effet futur compte (règle prudente, toutes dates confondues).
    const [s, t] = [await client(a, "S"), await client(a, "T")];
    await lierOk(s, t, 5000, "2030-01-01");
    const futur = await lier(t, s, 5000, "2026-01-01");
    expect(futur.statusCode).toBe(409);
    expect(futur.json().erreur.code).toBe("DETENTION_CYCLE");
    // Un cycle dont les liens sont terminés n'en est plus un.
    const fin = await lier(p, q, 0, "2026-06-01", { motif: "Cession totale" });
    attendre(201, fin, "fin");
    attendre(201, await lier(q, p, 3000, "2026-07-01"), "inversion après fin");
    const soi = await a.associe.post(`/api/dossiers/${p}/participations`, {
      detenteur_id: p,
      filiale_id: p,
      points_base: 100,
      date_effet: "2026-01-01",
    });
    expect(soi.statusCode).toBe(400);
  });

  it("dépassement de 100 % refusé ; un nouveau lien remplace celui de sa paire", async () => {
    const [h1, h2, f] = [await client(a, "H1"), await client(a, "H2"), await client(a, "F")];
    await lierOk(h1, f, 6000);
    const trop = await lier(h2, f, 5000);
    expect(trop.statusCode).toBe(409);
    expect(trop.json().erreur.code).toBe("DETENTION_SUPERIEURE_100");
    // 6000 est remplacé par 4000 : 4000 + 5000 <= 10 000.
    await lierOk(h1, f, 4000, "2026-02-01");
    attendre(201, await lier(h2, f, 5000), "deuxième détenteur");
    await lierOk(h2, f, 6000, "2026-03-01");
    expect((await lier(h2, f, 6001, "2026-04-01")).json().erreur.code).toBe(
      "DETENTION_SUPERIEURE_100",
    );
    // 100 % exactement est admis.
    const [u, v] = [await client(a, "U"), await client(a, "V")];
    await lierOk(u, v, 10_000);
  });

  it("profondeur : au plus 8 liens en chaîne (moteur 409 DETENTION_TROP_PROFONDE, déclencheur MQF04)", async () => {
    const c: string[] = [];
    for (let i = 0; i < 10; i++) c.push(await client(a, `Chaîne ${i}`));
    for (let i = 0; i < 8; i++) await lierOk(c[i]!, c[i + 1]!, 10_000);
    const refus = await lier(c[8]!, c[9]!, 10_000);
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("DETENTION_TROP_PROFONDE");
    // Même refus par le déclencheur, en SQL direct (contournant l'API).
    const code = await proprietaire(async (cl) => {
      try {
        await cl.query(
          `INSERT INTO dossier_participations (cabinet_id, detenteur_id, filiale_id, points_base, date_effet, cree_par)
           VALUES ($1, $2, $3, 10000, '2026-01-01', $4)`,
          [a.cabinetId, c[8], c[9], a.associeId],
        );
        return null;
      } catch (e) {
        return (e as { code: string }).code;
      }
    });
    expect(code).toBe("MQF04");
  });

  it("fin de détention : motif obligatoire, détention antérieure obligatoire ; historique conservé", async () => {
    const [h, f] = [await client(a, "Hf"), await client(a, "Ff")];
    expect((await lier(h, f, 0, "2026-05-01", { motif: "Cession" })).json().erreur.code).toBe(
      "DETENTION_INVALIDE",
    );
    const v1 = await lierOk(h, f, 7000, "2026-01-01");
    expect((await lier(h, f, 0, "2026-05-01")).statusCode).toBe(400);
    // Une fin antérieure à la détention n'a rien à terminer.
    expect((await lier(h, f, 0, "2025-12-01", { motif: "Cession" })).statusCode).toBe(409);
    const fin = await lier(h, f, 0, "2026-05-01", { motif: "Cession à un tiers" });
    attendre(201, fin, "fin");
    expect(fin.json()).toMatchObject({ fin_de_detention: true, motif: "Cession à un tiers" });
    const hist = (await a.associe.get(`/api/dossiers/${f}/participations`)).json().elements;
    expect(hist).toHaveLength(2);
    expect(hist.map((e: { points_base: number }) => e.points_base).sort()).toEqual([0, 7000]);
    const vue = hist.find((e: { id: string }) => e.id === v1.id);
    expect(vue).toMatchObject({
      detenteur: { visible: true, id: h },
      filiale: { visible: true, id: f },
      date_effet: "2026-01-01",
    });
    // Depuis le détenteur, le même historique.
    const depuisH = (await a.associe.get(`/api/dossiers/${h}/participations`)).json().elements;
    expect(depuisH).toHaveLength(2);
    // Avant la fin : détenue ; après : plus de filiale.
    const avant = (await groupe(a.associe, h, "?date=2026-04-30&vue=client")).json();
    expect(avant.structure.filiales).toHaveLength(1);
    const apres = (await groupe(a.associe, h, "?date=2026-05-01&vue=client")).json();
    expect(apres.structure.filiales).toHaveLength(0);
  });

  it("ajout seul en base : UPDATE et DELETE refusés au rôle applicatif et au propriétaire", async () => {
    const [h, f] = [await client(a, "Hs"), await client(a, "Fs")];
    await lierOk(h, f, 1000);
    const refusApp = await ctx.db
      .withTenant(a.cabinetId, (db) =>
        db.query("UPDATE dossier_participations SET points_base = 1"),
      )
      .catch((e: { code: string }) => e.code);
    expect(refusApp).toBe("42501");
    const refusSuppr = await ctx.db
      .withTenant(a.cabinetId, (db) => db.query("DELETE FROM dossier_participations"))
      .catch((e: { code: string }) => e.code);
    expect(refusSuppr).toBe("42501");
    const refusProprietaire = await proprietaire(async (cl) => {
      try {
        await cl.query("UPDATE dossier_participations SET points_base = 1 WHERE filiale_id = $1", [
          f,
        ]);
        return null;
      } catch (e) {
        return (e as { code: string }).code;
      }
    });
    expect(refusProprietaire).toBe("MPO01");
  });

  it("plafond : GROUPES_PLEIN au-delà du maximum d'enregistrements par cabinet", async () => {
    const [h, f] = [await client(c, "Hplein"), await client(c, "Fplein")];
    await proprietaire(async (cl) => {
      await cl.query(
        "ALTER TABLE dossier_participations DISABLE TRIGGER dossier_participations_controle",
      );
      try {
        await cl.query(
          `INSERT INTO dossier_participations (cabinet_id, detenteur_id, filiale_id, points_base, date_effet, cree_par)
           SELECT $1, $2, $3, 100, DATE '2026-01-01' + (g % 300), $4
           FROM generate_series(1, $5::int) g`,
          [c.cabinetId, h, f, c.associeId, PARTICIPATIONS_PAR_CABINET_MAX],
        );
      } finally {
        await cl.query(
          "ALTER TABLE dossier_participations ENABLE TRIGGER dossier_participations_controle",
        );
      }
    });
    const plein = await c.associe.post(`/api/dossiers/${h}/participations`, {
      detenteur_id: h,
      filiale_id: f,
      points_base: 200,
      date_effet: "2027-01-01",
    });
    expect(plein.statusCode).toBe(409);
    expect(plein.json().erreur.code).toBe("GROUPES_PLEIN");
    // Lecture toujours possible, bornée.
    expect((await c.associe.get(`/api/dossiers/${h}/groupe`)).statusCode).toBe(200);
  });
});

describe("règles doublées en base (déclencheur, hors API)", () => {
  it("MQF01 cycle, MQF02 plus de 100 %, MQF03 fin sans détention antérieure", async () => {
    const [p, q, r, s] = [
      await client(a, "Tp"),
      await client(a, "Tq"),
      await client(a, "Tr"),
      await client(a, "Ts"),
    ];
    const inserer = (det: string, fil: string, points: number, date: string, motif?: string) =>
      proprietaire(async (cl) => {
        try {
          await cl.query(
            `INSERT INTO dossier_participations (cabinet_id, detenteur_id, filiale_id, points_base, date_effet, motif, cree_par)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [a.cabinetId, det, fil, points, date, motif ?? null, a.associeId],
          );
          return null;
        } catch (e) {
          return (e as { code: string }).code;
        }
      });
    expect(await inserer(p, q, 5000, "2026-01-01")).toBeNull();
    expect(await inserer(q, r, 5000, "2026-01-01")).toBeNull();
    // Cycle direct, indirect, et à effet futur.
    expect(await inserer(q, p, 100, "2026-01-01")).toBe("MQF01");
    expect(await inserer(r, p, 100, "2026-01-01")).toBe("MQF01");
    expect(await inserer(r, p, 100, "2030-01-01")).toBe("MQF01");
    // Dépassement : 5000 (p) + 6000 > 10 000 ; le remplacement de la paire est pris en compte.
    expect(await inserer(s, q, 6000, "2026-01-01")).toBe("MQF02");
    expect(await inserer(p, q, 2000, "2026-02-01")).toBeNull();
    expect(await inserer(s, q, 6000, "2026-02-01")).toBeNull();
    expect(await inserer(s, q, 8001, "2026-03-01")).toBe("MQF02");
    // Fin de détention sans détention antérieure (paire inconnue, ou date antérieure).
    expect(await inserer(r, s, 0, "2026-01-01", "Cession")).toBe("MQF03");
    expect(await inserer(p, q, 0, "2025-01-01", "Cession")).toBe("MQF03");
    expect(await inserer(p, q, 0, "2026-03-01", "Cession")).toBeNull();
    // Contraintes de table (le déclencheur passe avant elles : auto-détention = cycle, 10 001 = plus de 100 %).
    expect(await inserer(p, q, 0, "2026-04-01")).toBe("23514");
    expect(await inserer(p, p, 100, "2026-04-01")).toBe("MQF01");
    expect(await inserer(p, q, 10_001, "2026-04-01")).toBe("MQF02");
    expect(await inserer(p, q, 100, "1999-12-31")).toBe("23514");
    // Clés composites : un client d'un autre cabinet est refusé.
    expect(await inserer(p, b.clientId, 100, "2026-04-01")).toBe("23503");
  });
});

describe("visibilité et isolation", () => {
  it("noeuds anonymes pour les dossiers invisibles ; exclusion NON_VISIBLE sans fuite", async () => {
    // H (visible du consultant d'équipe) détient F1 (invisible), qui détient F2 (invisible).
    const h = await clientVisible("Visible H");
    const [f1, f2] = [await client(a, "Secrète Une"), await client(a, "Secrète Deux")];
    await lierOk(h, f1, 7000);
    await lierOk(f1, f2, 6000);
    await etat(h, 2024, 2);
    await etat(f1, 2024, 3);
    await etat(f2, 2024, 1);
    const noms = [
      (await a.associe.get(`/api/dossiers/${f1}`)).json().client.raison_sociale,
      (await a.associe.get(`/api/dossiers/${f2}`)).json().client.raison_sociale,
    ] as string[];

    const r = await groupe(consultantEquipe, h, "?vue=client&exercice=2024");
    attendre(200, r, "groupe du consultant");
    const j = r.json();
    const brut = r.body;
    for (const secret of [f1, f2, ...noms]) expect(brut).not.toContain(secret);
    expect(j.structure.filiales).toEqual([
      { visible: false, niveau: 1, part_cumulee_bps: 7000 },
      { visible: false, niveau: 2, part_cumulee_bps: 4200 },
    ]);
    expect(j.consolidation.partielle).toBe(true);
    expect(j.consolidation.perimetre.inclus.map((e: { id: string }) => e.id)).toEqual([h]);
    expect(j.consolidation.perimetre.exclus).toEqual([
      {
        motif: "NON_VISIBLE",
        motif_libelle: "Dossier non visible avec vos droits",
      },
      {
        motif: "NON_VISIBLE",
        motif_libelle: "Dossier non visible avec vos droits",
      },
    ]);
    // Aucune donnée des invisibles : l'intégrale ne porte que la racine (actif 2000).
    expect(j.consolidation.integrale.actif).toBe(2000);
    expect(j.consolidation.proportionnelle.actif).toBe(2000);
    expect(j.structure.liens).toEqual([]);
    // L'associé, lui, voit tout.
    const complet = (await groupe(a.associe, h, "?vue=client&exercice=2024")).json();
    expect(complet.structure.filiales.map((n: { id: string }) => n.id).sort()).toEqual(
      [f1, f2].sort(),
    );
    expect(complet.consolidation.partielle).toBe(false);
    expect(complet.consolidation.integrale.actif).toBe(5000);

    // Détenteurs invisibles d'un client visible : tête et détenteurs anonymes.
    const feuille = await clientVisible("Feuille visible");
    await lierOk(f2, feuille, 3000);
    const g = await groupe(consultantEquipe, feuille, "?vue=client");
    attendre(200, g, "feuille");
    for (const secret of [f1, f2, ...noms]) expect(g.body).not.toContain(secret);
    const gj = g.json();
    expect(gj.structure.tete).toMatchObject({ visible: true, id: h });
    expect(gj.structure.detenteurs.find((n: { visible: boolean }) => !n.visible)).toBeDefined();
    expect(gj.structure.racine.id).toBe(feuille);
    // Rien d'une partie invisible dans l'historique non plus.
    const hist = (await consultantEquipe.get(`/api/dossiers/${feuille}/participations`)).json();
    expect(hist.elements[0].detenteur).toEqual({ visible: false });
    expect(hist.elements[0].filiale.visible).toBe(true);
  });

  it("dossier hors équipe : 404 en lecture et en écriture, y compris l'autre partie", async () => {
    const invisible = await client(a, "Invisible");
    const corps = {
      detenteur_id: a.clientId,
      filiale_id: invisible,
      points_base: 1000,
      date_effet: "2026-01-01",
    };
    expect((await groupe(consultantHors, a.clientId)).statusCode).toBe(404);
    expect(
      (await consultantHors.get(`/api/dossiers/${a.clientId}/participations`)).statusCode,
    ).toBe(404);
    expect(
      (await consultantHors.post(`/api/dossiers/${a.clientId}/participations`, corps)).statusCode,
    ).toBe(404);
    // Le dossier de l'URL est visible mais l'autre partie ne l'est pas : 404, rien n'est écrit.
    expect(
      (await consultantEquipe.post(`/api/dossiers/${a.clientId}/participations`, corps)).statusCode,
    ).toBe(404);
    expect(
      (await a.associe.get(`/api/dossiers/${invisible}/participations`)).json().elements,
    ).toEqual([]);
    expect((await groupe(a.associe, INCONNU)).statusCode).toBe(404);
  });

  it("isolation entre cabinets : 404 sur les clients d'un autre cabinet, aucun lien entre cabinets", async () => {
    const b2 = await client(b, "B deux");
    attendre(
      201,
      await b.associe.post(`/api/dossiers/${b.clientId}/participations`, {
        detenteur_id: b.clientId,
        filiale_id: b2,
        points_base: 9000,
        date_effet: "2026-01-01",
      }),
      "lien du cabinet B",
    );
    expect((await groupe(a.associe, b.clientId)).statusCode).toBe(404);
    expect((await a.associe.get(`/api/dossiers/${b.clientId}/participations`)).statusCode).toBe(
      404,
    );
    const versB = await a.associe.post(`/api/dossiers/${a.clientId}/participations`, {
      detenteur_id: a.clientId,
      filiale_id: b.clientId,
      points_base: 1000,
      date_effet: "2026-01-01",
    });
    expect(versB.statusCode).toBe(404);
    const depuisB = await a.associe.post(`/api/dossiers/${b.clientId}/participations`, {
      detenteur_id: b.clientId,
      filiale_id: a.clientId,
      points_base: 1000,
      date_effet: "2026-01-01",
    });
    expect(depuisB.statusCode).toBe(404);
    // Le groupe de A ne contient rien de B.
    const ga = (await groupe(a.associe, a.clientId)).json();
    expect(JSON.stringify(ga)).not.toContain(b.clientId);
    expect(JSON.stringify(ga)).not.toContain(b2);
    // Base : une participation entre deux cabinets est refusée par les clés composites.
    const code = await proprietaire(async (cl) => {
      try {
        await cl.query(
          `INSERT INTO dossier_participations (cabinet_id, detenteur_id, filiale_id, points_base, date_effet, cree_par)
           VALUES ($1, $2, $3, 100, '2026-01-01', $4)`,
          [a.cabinetId, a.clientId, b2, a.associeId],
        );
        return null;
      } catch (e) {
        return (e as { code: string }).code;
      }
    });
    expect(code).toBe("23503");
    // Le cabinet B voit son propre lien.
    const gb = (await groupe(b.associe, b.clientId, "?vue=client")).json();
    expect(gb.structure.filiales).toHaveLength(1);
  });

  it("portail client : routes fermées (403)", async () => {
    const s: ScenarioPortail = await preparerPortail(ctx);
    const id = s.a.clientId;
    for (const u of [s.dirigeant, s.contributeur, s.investisseur]) {
      for (const url of [`/api/dossiers/${id}/groupe`, `/api/dossiers/${id}/participations`]) {
        const r = await u.get(url);
        expect(r.statusCode, url).toBe(403);
        expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
      }
      const w = await u.post(`/api/dossiers/${id}/participations`, {
        detenteur_id: id,
        filiale_id: s.clientA2,
        points_base: 100,
        date_effet: "2026-01-01",
      });
      expect(w.statusCode).toBe(403);
      expect(w.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });
});

describe("consolidation simple", () => {
  // Groupe T : T -> U 60 %, T -> V 60 %, U -> W 50 %, V -> W 50 % (losange : W 60 % cumulé).
  const g: Record<string, string> = {};

  it("parts cumulées par un losange ; chiffres égaux à ceux du moteur", async () => {
    for (const n of ["T", "U", "V", "W"]) g[n] = await client(a, `Groupe ${n}`);
    await lierOk(g.T!, g.U!, 6000);
    await lierOk(g.T!, g.V!, 6000);
    await lierOk(g.U!, g.W!, 5000);
    await lierOk(g.V!, g.W!, 5000);
    await etat(g.T!, 2023, 1);
    await etat(g.T!, 2024, 10);
    await etat(g.U!, 2024, 5);
    await etat(g.V!, 2024, 1);
    await etat(g.W!, 2024, 2);

    const r = await groupe(a.associe, g.W!, "?vue=tete");
    attendre(200, r, "groupe");
    const j = r.json();
    // Exercice par défaut : le plus récent exercice accepté du client demandé (W : 2024).
    expect(j.exercice).toBe(2024);
    expect(j.structure.tete).toMatchObject({ visible: true, id: g.T });
    expect(j.avertissement).toBe("Lecture indicative, pas une consolidation comptable légale");
    expect(j.regles.seuil_controle_points).toBe(5000);
    expect(j.regles.conversion_devise).toBe(true);
    // Depuis la tête : U et V 60 %, W 60 % (0,6 × 0,5 × 2).
    const parts = Object.fromEntries(
      j.structure.arbre_tete.map((n: { id: string; part_cumulee_bps: number }) => [
        n.id,
        n.part_cumulee_bps,
      ]),
    );
    expect(parts).toEqual({ [g.U!]: 6000, [g.V!]: 6000, [g.W!]: 6000 });
    // Depuis W : deux détenteurs directs à 50 %, la tête à 60 % cumulé.
    expect(j.structure.detenteurs).toHaveLength(3);
    const c0 = j.consolidation;
    expect(c0).toMatchObject({ devise: "XOF", exercice: 2024, partielle: false });
    // Calcul attendu par le moteur lui-même (mêmes entrées).
    const montants = (k: number) => ({
      actif: 1000 * k,
      passif: 1000 * k,
      charges: 400 * k,
      produits: 500 * k,
      resultat: 100 * k,
    });
    const attendu = consoliderGroupe({
      devise: "XOF",
      exercice: 2024,
      noeuds: [
        { client: g.T!, partCumuleeBps: 10_000 },
        { client: g.U!, partCumuleeBps: 6000 },
        { client: g.V!, partCumuleeBps: 6000 },
        { client: g.W!, partCumuleeBps: 6000 },
      ],
      entites: [
        [g.T!, 10],
        [g.U!, 5],
        [g.V!, 1],
        [g.W!, 2],
      ].map(([client, k]) => ({
        client: client as string,
        devise: "XOF",
        exercice: 2024,
        montants: montants(k as number),
        fiabilitePoints: null,
        visible: true,
      })),
    });
    expect(c0.integrale.actif).toBe(attendu.integrale.actif);
    expect(c0.integrale.actif).toBe(18_000);
    expect(c0.proportionnelle.actif).toBe(attendu.proportionnelle.actif);
    expect(c0.proportionnelle.actif).toBe(14_800);
    expect(c0.integrale.marge_nette_bps).toBe(attendu.integrale.margeNetteBps);
    expect(c0.integrale.marge_nette_bps).toBe(2000);
    expect(c0.proportionnelle.resultat).toBe(attendu.proportionnelle.resultat);
    expect(c0.perimetre.inclus.map((e: { id: string }) => e.id).sort()).toEqual(
      Object.values(g).sort(),
    );
    expect(c0.perimetre.inclus.every((e: { controlee: boolean }) => e.controlee)).toBe(true);

    // Fiabilité : moyenne pondérée par la part cumulée des derniers indices enregistrés.
    const points = await proprietaire(async (cl) =>
      Object.fromEntries(
        (
          await cl.query(
            `SELECT DISTINCT ON (client_id) client_id, points FROM dossier_indices_fiabilite
             WHERE client_id = ANY($1::uuid[]) ORDER BY client_id, cree_le DESC, id DESC`,
            [Object.values(g)],
          )
        ).rows.map((x) => [x.client_id as string, x.points as number]),
      ),
    );
    const poids: Record<string, number> = {
      [g.T!]: 10_000,
      [g.U!]: 6000,
      [g.V!]: 6000,
      [g.W!]: 6000,
    };
    let num = 0n;
    let den = 0n;
    for (const [id, p] of Object.entries(points)) {
      num += BigInt(poids[id]!) * BigInt(p);
      den += BigInt(poids[id]!);
    }
    expect(c0.fiabilite.moyenne_ponderee).toBe(den === 0n ? null : arrondirPoints(num, den));
    expect(c0.fiabilite.ponderation).toBe("part_cumulee");

    // Vue « client » depuis U : U (100 %) et W (50 % : pas strictement au-dessus du seuil).
    const vu = (await groupe(a.associe, g.U!, "?vue=client")).json();
    expect(vu.structure.arbre_tete).toBeNull();
    expect(vu.consolidation.integrale.actif).toBe(5000);
    expect(vu.consolidation.proportionnelle.actif).toBe(6000);
    const w = vu.consolidation.perimetre.inclus.find((e: { id: string }) => e.id === g.W);
    expect(w).toMatchObject({ part_cumulee_bps: 5000, controlee: false });

    // Exercice explicite : 2023 (seule la tête a un état, les autres ne sont pas de cet exercice).
    const e23 = (await groupe(a.associe, g.T!, "?vue=client&exercice=2023")).json();
    expect(e23.consolidation.exercice).toBe(2023);
    expect(e23.consolidation.partielle).toBe(true);
    expect(e23.consolidation.perimetre.inclus.map((e: { id: string }) => e.id)).toEqual([g.T]);
    expect(
      e23.consolidation.perimetre.exclus.every(
        (e: { motif: string }) => e.motif === "EXERCICE_DIFFERENT",
      ),
    ).toBe(true);
  });

  it("états en revue, rejetés ou remplacés exclus ; devise sans taux (USD) exclue ; seul l'état courant accepté compte", async () => {
    const t = await client(a, "Tête statuts");
    const [enRevue, rejete, remplaceEnRevue, remplaceAccepte, eur, absent] = [
      await client(a, "S enrevue"),
      await client(a, "S rejete"),
      await client(a, "S remplace en revue"),
      await client(a, "S remplace accepte"),
      await client(a, "S eur"),
      await client(a, "S absent"),
    ];
    for (const f of [enRevue, rejete, remplaceEnRevue, remplaceAccepte, eur, absent]) {
      await lierOk(t, f, 8000);
    }
    await etat(t, 2024, 4);
    expect((await etat(enRevue, 2024, 1, "XOF", 50)).statut).toBe("en_revue");
    const r = await etat(rejete, 2024, 1, "XOF", 50);
    attendre(
      200,
      await a.associe.post(`/api/dossiers/${rejete}/etats-financiers/${r.id}/decision`, {
        decision: "rejete",
        motif: "Liasse illisible",
      }),
      "rejet",
    );
    expect((await etat(remplaceEnRevue, 2024, 9)).statut).toBe("accepte");
    expect((await etat(remplaceEnRevue, 2024, 9, "XOF", 50)).statut).toBe("en_revue");
    expect((await etat(remplaceAccepte, 2024, 100)).statut).toBe("accepte");
    expect((await etat(remplaceAccepte, 2024, 3)).statut).toBe("accepte");
    expect((await etat(eur, 2024, 6, "USD")).statut).toBe("accepte");

    const j = (await groupe(a.associe, t, "?vue=client&exercice=2024")).json();
    const motifs = Object.fromEntries(
      j.consolidation.perimetre.exclus.map((e: { id: string; motif: string }) => [e.id, e.motif]),
    );
    expect(motifs).toEqual({
      [enRevue]: "ETAT_ABSENT",
      [rejete]: "ETAT_ABSENT",
      [remplaceEnRevue]: "ETAT_ABSENT",
      [eur]: "DEVISE_DIFFERENTE",
      [absent]: "ETAT_ABSENT",
    });
    expect(j.consolidation.partielle).toBe(true);
    expect(j.consolidation.perimetre.inclus.map((e: { id: string }) => e.id).sort()).toEqual(
      [t, remplaceAccepte].sort(),
    );
    // Racine 4 + état remplaçant 3 (l'ancien état de 100 ne compte plus).
    expect(j.consolidation.integrale.actif).toBe(4000 + 3000);
    // 4000 × 100 % + 3000 × 80 %.
    expect(j.consolidation.proportionnelle.actif).toBe(4000 + 2400);
    expect(j.consolidation.devise).toBe("XOF");
  });

  it("devise : une filiale en EUR est convertie à la parité fixe dans la devise de la racine (XOF), USD exclu", async () => {
    const t = await client(a, "Tête devises");
    const eur = await client(a, "Fille euro");
    const usd = await client(a, "Fille dollar");
    await lierOk(t, eur, 8000);
    await lierOk(t, usd, 8000);
    await etat(t, 2024, 4);
    await etat(eur, 2024, 100, "EUR");
    await etat(usd, 2024, 100, "USD");
    const j = (await groupe(a.associe, t, "?vue=client&exercice=2024")).json();
    expect(j.consolidation.devise).toBe("XOF");
    expect(j.consolidation.conversions).toMatchObject([{ id: eur, de: "EUR", vers: "XOF" }]);
    expect(
      j.consolidation.perimetre.exclus.map((e: { id: string; motif: string }) => e.motif),
    ).toEqual(["DEVISE_DIFFERENTE"]);
    expect(j.consolidation.partielle).toBe(true);
    // 100 000 centimes d'actif × 655,957 / 100 = 655 957 XOF.
    expect(j.consolidation.integrale.actif).toBe(4000 + 655_957 * 1);
    expect(j.consolidation.proportionnelle.actif).toBe(4000 + Math.round(655_957 * 0.8));
  });

  it("sans état accepté : consolidation vide et partielle", async () => {
    const t = await client(a, "Sans état");
    const f = await client(a, "Sans état fille");
    await lierOk(t, f, 7000);
    const j = (await groupe(a.associe, t, "?vue=client")).json();
    expect(j.exercice).toBeNull();
    expect(j.consolidation).toMatchObject({
      devise: null,
      partielle: true,
      integrale: { actif: null, resultat: null, marge_nette_bps: null },
      proportionnelle: { actif: null, produits: null },
      fiabilite: { moyenne_ponderee: null },
    });
    expect(j.consolidation.perimetre.inclus).toEqual([]);
    expect(j.consolidation.perimetre.exclus.map((e: { motif: string }) => e.motif)).toEqual([
      "ETAT_ABSENT",
      "ETAT_ABSENT",
    ]);
    // Client isolé : structure vide, lui-même seul dans le périmètre.
    const seul = (await groupe(a.associe, await client(a, "Isolé"))).json();
    expect(seul.structure.filiales).toEqual([]);
    expect(seul.structure.detenteurs).toEqual([]);
    expect(seul.structure.tete.visible).toBe(true);
    // Paramètres invalides.
    expect((await groupe(a.associe, t, "?vue=autre")).statusCode).toBe(400);
    expect((await groupe(a.associe, t, "?date=2026-02-30")).statusCode).toBe(400);
    expect((await groupe(a.associe, t, "?exercice=1800")).statusCode).toBe(400);
    expect((await groupe(a.associe, t, "?intrus=1")).statusCode).toBe(400);
  });

  it("FIN-02 : même réponse avec et sans finance.lire, aucune clé de coût, taux ou marge de mission", async () => {
    expect(aPermission(["associe"], "finance.lire")).toBe(true);
    const directeur = await a.avecRoles(["directeur_mission"]);
    expect(aPermission(["directeur_mission"], "finance.lire")).toBe(false);
    const t = await client(a, "Tête fin02");
    const f = await client(a, "Fille fin02");
    await lierOk(t, f, 9000);
    await etat(t, 2024, 2);
    await etat(f, 2024, 1);
    // Une mission avec budget et coûts existe pour ce client : rien n'en sort.
    await creerMission(a, { client_id: t, intitule: "Mission avec coûts" });
    const avec = await groupe(a.associe, t, "?vue=client&exercice=2024");
    const sans = await groupe(directeur, t, "?vue=client&exercice=2024");
    attendre(200, avec, "associé");
    attendre(200, sans, "directeur");
    expect(avec.json()).toEqual(sans.json());
    const cles = clesDe(avec.json());
    expect(cles.filter((k) => /cout|coût|taux|honorair|budget|tarif|rentab/i.test(k))).toEqual([]);
    // La seule « marge » est celle des états financiers du client (marge nette en points de base).
    expect(cles.filter((k) => /marge/i.test(k)).every((k) => /^marge_nette(_bps)?$/.test(k))).toBe(
      true,
    );
    const hist1 = (await a.associe.get(`/api/dossiers/${t}/participations`)).json();
    const hist2 = (await directeur.get(`/api/dossiers/${t}/participations`)).json();
    expect(hist1).toEqual(hist2);
  });
});
