import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cabinetTest, type Api } from "./api.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { factureDatee } from "./finance-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";
import { consultantAffecte, missionTemps, type MissionTemps } from "./temps-outils.js";

/*
 * AUT-12 (prévisions) et AUT-09 (pré-remplissage des temps). Les montants et les mois
 * attendus sont ceux du moteur (packages/engines/src/previsions) ; ces tests vérifient le
 * câblage : droits (finance.lire), carnet, pipeline, charge, isolation entre cabinets, et le
 * caractère LECTURE SEULE de la suggestion de temps.
 */

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let m: MissionTemps;
const REFERENCE = "date_reference=2026-10-15";

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Prévisions A");
  b = await preparerFacturation(ctx, "Cabinet Prévisions B");
});
afterAll(() => ctx.fermer());

type LigneMois = Record<string, number | string>;
const ligne = (mois: LigneMois[], cle: string) =>
  mois.find((x) => x.mois === cle) as Record<string, number>;

describe("prévisions du cabinet (AUT-12)", () => {
  it("refuse sans session (401) et sans finance.lire (403)", async () => {
    const anonyme = await ctx.app.inject({ method: "GET", url: "/api/previsions" });
    expect(anonyme.statusCode).toBe(401);
    for (const role of [
      "directeur_mission",
      "chef_mission",
      "consultant",
      "ressources",
      "expert_metier",
      "expert_externe",
    ] as const) {
      const u = await a.avecRoles([role]);
      const r = await u.get(`/api/previsions?${REFERENCE}`);
      expect(r.statusCode, role).toBe(403);
    }
  });

  it("est ouverte à l'associé et au gestionnaire (finance.lire)", async () => {
    expect((await a.associe.get(`/api/previsions?${REFERENCE}`)).statusCode).toBe(200);
    expect((await a.gestionnaire.get(`/api/previsions?${REFERENCE}`)).statusCode).toBe(200);
  });

  it("refuse une date ou un paramètre invalide (400)", async () => {
    expect((await a.associe.get("/api/previsions?date_reference=2026-13-45")).statusCode).toBe(400);
    expect((await a.associe.get("/api/previsions?autre=1")).statusCode).toBe(400);
  });

  it("date de référence extrême ou inexistante : 400, jamais 500", async () => {
    for (const d of [
      "9999-12-31",
      "0001-01-01",
      "0000-01-01",
      "1999-12-31",
      "2101-01-01",
      "2026-02-30",
    ]) {
      const r = await a.associe.get(`/api/previsions?date_reference=${d}`);
      expect(r.statusCode, d).toBe(400);
      expect(r.json().erreur.code, d).toBe("REQUETE_INVALIDE");
    }
    // Bornes admises : l'horizon dépasse 2100 sans erreur.
    expect((await a.associe.get("/api/previsions?date_reference=2100-12-31")).statusCode).toBe(200);
    expect((await a.associe.get("/api/previsions?date_reference=2000-01-01")).statusCode).toBe(200);
  });

  it("portail client : prévisions et pré-remplissage fermés (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    for (const chemin of ["/api/previsions", "/api/temps/preremplissage"]) {
      const r = await client.get(chemin);
      expect(r.statusCode, chemin).toBe(403);
      expect(r.json().erreur.code, chemin).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("construit le carnet signé depuis les échéances non facturées", async () => {
    const mission = await creerMissionSignee(a, { mode_facturation: "forfait" });
    for (const [libelle, montant, date] of [
      ["Acompte", 300_000, "2026-11-15"],
      ["Solde", 700_000, "2027-01-20"],
    ] as const) {
      attendre(
        201,
        await a.gestionnaire.post(`/api/missions/${mission.id}/echeances`, {
          type: "jalon",
          libelle,
          montant,
          date_prevue: date,
        }),
        libelle,
      );
    }
    // Une échéance déjà facturée ne fait plus partie du carnet.
    await factureDatee(ctx, a, mission.id, 123_456, "2026-10-05");

    const r = await a.gestionnaire.get(`/api/previsions?${REFERENCE}`);
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.devise).toBe("XOF");
    expect(p.mois).toHaveLength(12);
    expect(p.mois[0].mois).toBe("2026-10");
    expect(p.mois[11].mois).toBe("2027-09");
    expect(ligne(p.mois, "2026-11").ca_carnet).toBe(300_000);
    expect(ligne(p.mois, "2027-01").ca_carnet).toBe(700_000);
    expect(p.totaux.ca_carnet).toBe(1_000_000);
    expect(p.nombre_echeances).toBe(2);
    expect(p.exclusions).toEqual({ echeances_sans_taux_change: 0, opportunites_autre_devise: 0 });
  });

  it("pondère le pipeline par la probabilité et écarte une autre devise", async () => {
    const corps = {
      client_id: a.clientId,
      intitule: "Opportunité pondérée",
      montant_estime: 1_000_000,
      probabilite: 50,
      etape: "proposition",
      date_cloture_prevue: "2026-11-20",
    };
    attendre(201, await a.chef.post("/api/opportunites", corps), "opportunité");
    attendre(
      201,
      await a.chef.post("/api/opportunites", {
        ...corps,
        intitule: "En euros",
        devise: "EUR",
        montant_estime: 5_000,
      }),
      "opportunité EUR",
    );
    const p = (await a.associe.get(`/api/previsions?${REFERENCE}`)).json();
    // Clôture en novembre + 1 mois de délai : trois parts à partir de décembre.
    expect(ligne(p.mois, "2026-12").ca_pipeline).toBe(166_667);
    expect(ligne(p.mois, "2027-01").ca_pipeline).toBe(166_667);
    expect(ligne(p.mois, "2027-02").ca_pipeline).toBe(166_666);
    expect(p.totaux.ca_pipeline).toBe(500_000);
    expect(p.totaux.ca_total).toBe(p.totaux.ca_carnet + p.totaux.ca_pipeline);
    expect(p.exclusions.opportunites_autre_devise).toBe(1);
    expect(p.nombre_opportunites).toBe(1);
    expect(p.par_etape.find((e: { etape: string }) => e.etape === "proposition")).toMatchObject({
      nombre: 1,
      montant: 1_000_000,
      montant_pondere: 500_000,
    });
    expect(p.opportunites_sans_charge).toBe(1);
  });

  it("n'inclut pas une opportunité gagnée ou perdue", async () => {
    const o = await a.chef.post("/api/opportunites", {
      client_id: a.clientId,
      intitule: "Perdue",
      montant_estime: 9_000_000,
      probabilite: 100,
      etape: "negociation",
      date_cloture_prevue: "2026-11-20",
    });
    attendre(201, o, "opportunité");
    attendre(
      200,
      await a.chef.post(`/api/opportunites/${o.json().id}/issue`, {
        statut: "perdue",
        motif_perte: "Prix",
      }),
      "perdue",
    );
    const p = (await a.associe.get(`/api/previsions?${REFERENCE}`)).json();
    expect(p.totaux.ca_pipeline).toBe(500_000);
  });

  it("compare la charge des affectations à la capacité des collaborateurs", async () => {
    m = await missionTemps(a, { Diagnostic: { senior: 10 } });
    await consultantAffecte(a, m, { Diagnostic: 10 }, { debut: "2026-11-02", fin: "2026-11-13" });
    const p = (await a.associe.get(`/api/previsions?${REFERENCE}`)).json();
    expect(p.totaux.charge_carnet_jours).toBe(10);
    expect(ligne(p.mois, "2026-11").charge_carnet_jours).toBe(10);
    expect(ligne(p.mois, "2026-11").capacite_jours).toBeGreaterThan(0);
    expect(ligne(p.mois, "2026-11").charge_totale_jours).toBeGreaterThanOrEqual(10);
    const novembre = ligne(p.mois, "2026-11") as Record<string, number>;
    expect(novembre.ecart_jours).toBeCloseTo(
      (novembre.capacite_jours as number) - (novembre.charge_totale_jours as number),
      2,
    );
    expect(p.totaux.capacite_jours).toBeGreaterThan(0);
  });

  it("chiffre la charge du pipeline depuis les jours de la dernière proposition", async () => {
    const o = await a.chef.post("/api/opportunites", {
      client_id: a.clientId,
      intitule: "Avec proposition",
      type_mission_id: a.typePlanId,
      montant_estime: 2_000_000,
      probabilite: 100,
      etape: "proposition",
      date_cloture_prevue: "2026-10-20",
    });
    attendre(201, o, "opportunité");
    attendre(
      201,
      await a.chef.post(`/api/opportunites/${o.json().id}/propositions`, {}),
      "proposition",
    );
    const jours = await proprietaire(async (c) => {
      const r = await c.query(
        `SELECT l.jours::float8 AS jours FROM proposition_lignes l
         JOIN propositions p ON p.id = l.proposition_id WHERE p.opportunite_id = $1`,
        [o.json().id],
      );
      return r.rows.map((x) => x.jours as number);
    });
    const attendu = jours.reduce((t, j) => t + j, 0);
    expect(attendu).toBeGreaterThan(0);
    const p = (await a.associe.get(`/api/previsions?${REFERENCE}`)).json();
    // Probabilité 100 % : toute la charge de la proposition entre dans l'horizon (centième près).
    expect(Math.abs(p.totaux.charge_pipeline_jours - attendu)).toBeLessThan(0.02);
  });

  it("isole les cabinets : B ne voit rien de A", async () => {
    const p = (await b.associe.get(`/api/previsions?${REFERENCE}`)).json();
    expect(p.totaux.ca_carnet).toBe(0);
    expect(p.totaux.ca_pipeline).toBe(0);
    expect(p.totaux.charge_carnet_jours).toBe(0);
    expect(p.nombre_echeances).toBe(0);
    expect(p.nombre_opportunites).toBe(0);
  });
});

describe("pré-remplissage des temps (AUT-09)", () => {
  const LUNDI = "2026-11-02";
  let consultant: Api & { utilisateurId: string; collaborateurId: string };
  let mission: MissionTemps;
  let c: CabinetFacturation;

  beforeAll(async () => {
    c = await preparerFacturation(ctx, "Cabinet Pré-remplissage");
    mission = await missionTemps(c, { Diagnostic: { senior: 10 }, Analyse: { senior: 10 } });
    // 10 jours sur 10 jours ouvrés (2 au 13 novembre) : 1 jour par jour.
    consultant = await consultantAffecte(
      c,
      mission,
      { Diagnostic: 10 },
      { debut: "2026-11-02", fin: "2026-11-13" },
    );
  });

  it("refuse sans session (401)", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/api/temps/preremplissage" });
    expect(r.statusCode).toBe(401);
  });

  it("refuse un paramètre invalide (400)", async () => {
    expect((await consultant.get("/api/temps/preremplissage?semaine=demain")).statusCode).toBe(400);
  });

  it("propose les jours planifiés, sans rien enregistrer", async () => {
    const r = await consultant.get(`/api/temps/preremplissage?semaine=${LUNDI}`);
    expect(r.statusCode, r.body).toBe(200);
    const s = r.json();
    expect(s.feuille_modifiable).toBe(true);
    expect(s.sources).toEqual({ affectations: true, activite_plateforme: true, agenda: false });
    expect(s.propositions).toHaveLength(5);
    expect(s.total_jours).toBe(5);
    expect(s.propositions[0]).toMatchObject({
      date: "2026-11-02",
      tache_id: mission.taches["Diagnostic"],
      jours: 1,
      source: "affectation",
      confiance: "moyenne",
      mission_intitule: expect.any(String),
      tache_libelle: "Diagnostic",
    });
    // Identique au pré-remplissage historique à la création de la feuille.
    const semaine = (await consultant.get(`/api/feuilles-temps/semaine?semaine=${LUNDI}`)).json();
    expect(
      s.propositions.map((p: { date: string; tache_id: string; jours: number }) => [
        p.date,
        p.tache_id,
        p.jours,
      ]),
    ).toEqual(
      semaine.pre_remplissage.map((p: { date: string; tache_id: string; jours: number }) => [
        p.date,
        p.tache_id,
        p.jours,
      ]),
    );
    // Rien n'a été créé : ni feuille ni ligne.
    expect(semaine.feuille).toBeNull();
    const n = await proprietaire(async (cl) => {
      const x = await cl.query(
        "SELECT (SELECT count(*) FROM feuilles_temps WHERE cabinet_id = $1)::int AS f, (SELECT count(*) FROM lignes_temps WHERE cabinet_id = $1)::int AS l",
        [c.cabinetId],
      );
      return x.rows[0] as { f: number; l: number };
    });
    expect(n).toEqual({ f: 0, l: 0 });
  });

  it("confirme une ligne planifiée par l'activité du consultant, pas par celle d'un collègue", async () => {
    const autre = await c.avecRoles(["consultant"]);
    await proprietaire(async (cl) => {
      for (const [auteur, jour] of [
        [consultant.utilisateurId, "2026-11-04T10:00:00Z"],
        [autre.utilisateurId, "2026-11-05T10:00:00Z"],
      ] as const) {
        await cl.query(
          `INSERT INTO commentaires (cabinet_id, entite_type, entite_id, mission_id, tache_id, auteur_id, texte, cree_le)
           VALUES ($1, 'mission_tache', $2, $3, $2, $4, 'Avancement', $5)`,
          [c.cabinetId, mission.taches["Diagnostic"], mission.id, auteur, jour],
        );
      }
    });
    const s = (await consultant.get(`/api/temps/preremplissage?semaine=${LUNDI}`)).json();
    const parDate = new Map(
      s.propositions.map((p: { date: string; source: string; confiance: string }) => [p.date, p]),
    );
    expect(parDate.get("2026-11-04")).toMatchObject({
      source: "affectation_et_activite",
      confiance: "haute",
    });
    expect(parDate.get("2026-11-05")).toMatchObject({
      source: "affectation",
      confiance: "moyenne",
    });
  });

  it("n'invente rien sur une tâche non affectée", async () => {
    await proprietaire(async (cl) => {
      await cl.query(
        `INSERT INTO commentaires (cabinet_id, entite_type, entite_id, mission_id, tache_id, auteur_id, texte, cree_le)
         VALUES ($1, 'mission_tache', $2, $3, $2, $4, 'Hors affectation', '2026-11-06T09:00:00Z')`,
        [c.cabinetId, mission.taches["Analyse"], mission.id, consultant.utilisateurId],
      );
    });
    const s = (await consultant.get(`/api/temps/preremplissage?semaine=${LUNDI}`)).json();
    expect(
      s.propositions.some((p: { tache_id: string }) => p.tache_id === mission.taches["Analyse"]),
    ).toBe(false);
    expect(s.activite_ignoree).toBe(1);
  });

  it("ne propose rien pour une feuille déjà soumise", async () => {
    const f = await consultant.post("/api/feuilles-temps", {
      semaine: "2026-11-09",
      pre_remplir: false,
    });
    attendre(201, f, "feuille");
    attendre(
      200,
      await consultant.put(`/api/feuilles-temps/${f.json().id}/lignes`, {
        lignes: [{ date: "2026-11-09", tache_id: mission.taches["Diagnostic"], jours: 1 }],
      }),
      "lignes",
    );
    attendre(
      200,
      await consultant.post(`/api/feuilles-temps/${f.json().id}/soumettre`),
      "soumission",
    );
    const s = (await consultant.get("/api/temps/preremplissage?semaine=2026-11-09")).json();
    expect(s.feuille_modifiable).toBe(false);
    expect(s.propositions).toEqual([]);
  });

  it("tient compte des lignes déjà saisies d'une feuille en brouillon", async () => {
    const f = await consultant.post("/api/feuilles-temps", { semaine: LUNDI, pre_remplir: false });
    attendre(201, f, "feuille");
    attendre(
      200,
      await consultant.put(`/api/feuilles-temps/${f.json().id}/lignes`, {
        lignes: [{ date: "2026-11-02", tache_id: mission.taches["Diagnostic"], jours: 0.5 }],
      }),
      "lignes",
    );
    const s = (await consultant.get(`/api/temps/preremplissage?semaine=${LUNDI}`)).json();
    expect(s.feuille_modifiable).toBe(true);
    expect(s.propositions.some((p: { date: string }) => p.date === "2026-11-02")).toBe(false);
    expect(s.ecartees).toContainEqual(
      expect.objectContaining({ date: "2026-11-02", motif: "deja_saisi" }),
    );
    expect(s.propositions).toHaveLength(4);
  });

  it("n'écrit pas sur un mois clôturé", async () => {
    const cl = await preparerFacturation(ctx, "Cabinet Clôture");
    const mi = await missionTemps(
      cl,
      { Diagnostic: { senior: 10 } },
      { debut: "2026-09-01", fin: "2026-09-30" },
    );
    const u = await consultantAffecte(
      cl,
      mi,
      { Diagnostic: 10 },
      { debut: "2026-09-07", fin: "2026-09-18" },
    );
    await proprietaire((x) =>
      x.query(
        `INSERT INTO periodes_temps (cabinet_id, mois, statut, cloturee_par, cloturee_le)
         VALUES ($1, '2026-09', 'cloturee', $2, now())`,
        [cl.cabinetId, cl.associeId],
      ),
    );
    const s = (await u.get("/api/temps/preremplissage?semaine=2026-09-07")).json();
    expect(s.propositions).toEqual([]);
    expect(s.ecartees.length).toBeGreaterThan(0);
    expect(s.ecartees.every((e: { motif: string }) => e.motif === "jour_verrouille")).toBe(true);
  });

  it("répond vide à un utilisateur sans fiche collaborateur", async () => {
    const s = (await c.associe.get(`/api/temps/preremplissage?semaine=${LUNDI}`)).json();
    expect(s.collaborateur_id).toBeNull();
    expect(s.propositions).toEqual([]);
  });

  it("ne donne rien à un collaborateur d'un autre cabinet", async () => {
    const autre = await cabinetTest(ctx, "Cabinet Voisin");
    const u = await autre.avecRoles(["consultant"]);
    const s = (await u.get(`/api/temps/preremplissage?semaine=${LUNDI}`)).json();
    expect(s.propositions).toEqual([]);
  });
});
