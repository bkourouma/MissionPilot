import { randomUUID } from "node:crypto";
import { ajouterJours, lundiDeLaSemaine, PARAMETRES_ACTIVITE_DEMO } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contexteActiviteDemo,
  type BilanActiviteDemo,
  type ContexteActiviteDemo,
} from "../src/activite-demo/commun.js";
import {
  encaisserSemaineDemo,
  facturerSemaineDemo,
  poserJalonDemo,
} from "../src/activite-demo/evenements.js";
import { lireSemaineDemo, type MissionDemo } from "../src/activite-demo/lecture.js";
import { brancherDiagnostic } from "../src/automatisation/diagnostic.js";
import type { Db } from "../src/db/pool.js";
import {
  compterActiviteDemo,
  preparerCabinetDemo,
  retirerMarquesDemo,
  type CabinetDemoTest,
} from "./activite-demo-outils.js";
import { attendre } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Tâche « activite_demo » : jalon, facture et encaissement de la semaine (evenements.ts ; DT2, DT3,
 * DT8, DT16). Horloge PASSÉE : quatre lundis avant celui de la semaine courante (L1 à L4), puis le
 * lundi courant (L5) ; chaque événement est daté du lundi de sa semaine (`j` = lundi), jamais après
 * aujourd'hui. Les factures de la tâche sont émises en L1 puis en L3 (ordre chronologique exigé par
 * la numérotation) ; les encaissements, eux, ne dépendent pas de l'ordre des semaines.
 * Les cas qui ne doivent rien laisser en base (jalon « à défaut », mentions légales vides, émission
 * antérieure à la dernière) s'exécutent dans une transaction ANNULÉE.
 * Sources : missions de la fixture (activite-demo-outils.ts) ; la première échéance prévue du
 * forfait est rendue due une semaine avant L1.
 */

const AUJOURDHUI = new Date().toISOString().slice(0, 10);
const L5 = lundiDeLaSemaine(AUJOURDHUI);
const L1 = ajouterJours(L5, -28);
const L2 = ajouterJours(L5, -21);
const L3 = ajouterJours(L5, -14);
const L4 = ajouterJours(L5, -7);

type Comptes = Awaited<ReturnType<typeof compterActiviteDemo>>;
interface Sortie<T> {
  resultat: T;
  bilan: BilanActiviteDemo;
}

let ctx: Contexte;
let cab: CabinetDemoTest;
let base: Comptes;
let debrancher: () => void = () => undefined;
const incidents: Record<string, unknown>[] = [];
/** Factures émises par la tâche : semaine L1, puis semaine L3. */
const emises: { l1: string; l3: string } = { l1: "", l3: "" };

const lignes = (sql: string, params: unknown[]) =>
  proprietaire(async (cl) => (await cl.query(sql, params)).rows);

const contexte = (db: Db, j: string): Promise<ContexteActiviteDemo> =>
  contexteActiviteDemo(db, cab.cabinetId, randomUUID(), new Date(`${j}T09:00:00Z`), j.slice(0, 7));

const missionsDe = async (c: ContexteActiviteDemo, lundi: string): Promise<MissionDemo[]> =>
  (await lireSemaineDemo(c.db, c.cabinetId, lundi, PARAMETRES_ACTIVITE_DEMO)).missions;

/** Exécute `f` dans une transaction VALIDÉE du cabinet, contexte de la tâche au jour `j`. */
function executer<T>(j: string, f: (c: ContexteActiviteDemo) => Promise<T>): Promise<Sortie<T>> {
  return ctx.db.withTenant(cab.cabinetId, async (db) => {
    const c = await contexte(db, j);
    return { resultat: await f(c), bilan: c.bilan };
  });
}

class Annulation extends Error {}

/** Même chose dans une transaction ANNULÉE : rien ne reste en base. */
async function sansLendemain<T>(
  j: string,
  f: (c: ContexteActiviteDemo) => Promise<T>,
): Promise<Sortie<T>> {
  const boite: { sortie?: Sortie<T> } = {};
  try {
    await ctx.db.withTenant(cab.cabinetId, async (db) => {
      const c = await contexte(db, j);
      boite.sortie = { resultat: await f(c), bilan: c.bilan };
      throw new Annulation();
    });
  } catch (e) {
    if (!(e instanceof Annulation)) throw e;
  }
  if (!boite.sortie) throw new Error("Transaction annulée avant le résultat.");
  return boite.sortie;
}

const facture = async (id: string) =>
  (
    await lignes(
      `SELECT mission_id, statut, date_emission::text AS date_emission, numero, cree_par,
         soumise_par, approuvee_par
       FROM factures WHERE id = $1`,
      [id],
    )
  )[0];

/** Échéances liées à une facture, avec le nombre de temps de régie rattachés. */
const echeancesDe = (factureId: string) =>
  lignes(
    `SELECT e.id, e.type, e.statut,
       (SELECT count(*)::int FROM echeance_temps t WHERE t.echeance_id = e.id) AS temps
     FROM facturation_liens l JOIN echeances_facturation e ON e.id = l.echeance_id
     WHERE l.facture_id = $1 AND l.libere_le IS NULL ORDER BY e.id`,
    [factureId],
  );

const marqueur = async (action: string, entiteId: string) =>
  (
    await lignes(
      `SELECT utilisateur_id, details FROM journal_audit
       WHERE cabinet_id = $1 AND action = $2 AND entite_id = $3`,
      [cab.cabinetId, action, entiteId],
    )
  )[0];

/** Imputation unique d'un encaissement de la tâche. */
const imputationDe = async (encaissementId: string) =>
  (
    await lignes(
      `SELECT i.facture_id, i.date_imputation::text AS date_imputation,
         e.date_encaissement::text AS date_encaissement, e.mode, e.reference
       FROM imputations i JOIN encaissements e ON e.id = i.encaissement_id
       WHERE e.id = $1`,
      [encaissementId],
    )
  )[0];

const statutPaiement = async (factureId: string) =>
  (await cab.gestionnaire.get(`/api/factures/${factureId}/paiement`)).json().statut_paiement;

/** Facture de la tâche émise sur cette mission (L1 ou L3). */
async function factureDeLaMission(missionId: string): Promise<string> {
  for (const id of [emises.l1, emises.l3]) {
    if ((await facture(id))?.mission_id === missionId) return id;
  }
  throw new Error("Aucune facture de la tâche sur cette mission.");
}

beforeAll(async () => {
  ctx = await demarrer();
  cab = await preparerCabinetDemo(ctx, "Événements démo", { dateReference: L1 });
  // Première échéance prévue du forfait rendue due avant L1 : source « prevue » de la facture.
  const forfait = cab.missionForfait.id;
  const echeancier = await cab.gestionnaire.get(`/api/missions/${forfait}/echeancier`);
  attendre(200, echeancier, "échéancier");
  const echeances = echeancier.json().echeances as {
    id: string;
    statut: string;
    facture_id: string | null;
  }[];
  const prevue = echeances.find((x) => x.statut === "prevue" && x.facture_id === null);
  if (!prevue) throw new Error("Fixture : aucune échéance prévue sur la mission au forfait.");
  attendre(
    200,
    await cab.gestionnaire.patch(`/api/echeances/${prevue.id}`, {
      date_prevue: ajouterJours(L1, -7),
    }),
    "échéance due",
  );
  base = await compterActiviteDemo(cab.cabinetId);
  debrancher = brancherDiagnostic((entree) => {
    incidents.push(entree);
  });
}, 240_000);

afterAll(async () => {
  debrancher();
  await retirerMarquesDemo();
  await ctx.fermer();
});

describe("jalon de la semaine", () => {
  it("jalon atteint daté de j, sur la mission la plus chargée, sans événement d'automatisation", async () => {
    const avant = await compterActiviteDemo(cab.cabinetId);
    const temps = new Map([
      [cab.missionRegie.id, 400],
      [cab.missionForfait.id, 100],
    ]);
    const { resultat: id, bilan } = await executer(L1, async (c) =>
      poserJalonDemo(c, L1, L1, temps, await missionsDe(c, L1)),
    );
    expect(id).toEqual(expect.any(String));
    expect(bilan.jalons).toBe(1);
    const [jalon] = await lignes(
      `SELECT mission_id, phase_id, libelle, atteint, date_prevue::text AS date_prevue,
         (modifie_le AT TIME ZONE 'UTC')::date::text AS modifie
       FROM mission_jalons WHERE id = $1`,
      [id],
    );
    expect(jalon).toMatchObject({
      mission_id: cab.missionRegie.id,
      phase_id: null,
      atteint: true,
      date_prevue: L1,
      modifie: L1,
    });
    expect(jalon?.libelle).toMatch(/^Point d'étape — semaine du /);
    const apres = await compterActiviteDemo(cab.cabinetId);
    expect(apres.jalons).toBe(avant.jalons + 1);
    // INSERT d'un jalon déjà atteint : le déclencheur « jalon atteint » (UPDATE) ne publie rien.
    expect(apres.evenements_automatisation).toBe(avant.evenements_automatisation);
    expect(await marqueur("activite_demo.jalon", id as string)).toMatchObject({
      utilisateur_id: null,
      details: expect.objectContaining({ semaine: L1, mission_id: cab.missionRegie.id }),
    });
  });

  it("à défaut de temps validé : la première mission en cours par identifiant", async () => {
    const { resultat } = await sansLendemain(L2, async (c) => {
      const missions = await missionsDe(c, L2);
      const id = await poserJalonDemo(c, L2, L2, new Map(), missions);
      const r = await c.db.query("SELECT mission_id FROM mission_jalons WHERE id = $1", [id]);
      const enCours = missions.filter((m) => m.statut === "en_cours").map((m) => m.id);
      return { mission: r.rows[0]?.mission_id as string | undefined, attendue: enCours.sort()[0] };
    });
    expect(resultat.attendue).toEqual(expect.any(String));
    expect(resultat.mission).toBe(resultat.attendue);
  });

  it("idempotent : un second appel de la même semaine ne pose rien", async () => {
    const avant = await compterActiviteDemo(cab.cabinetId);
    const { resultat, bilan } = await executer(L1, async (c) =>
      poserJalonDemo(c, L1, L1, new Map([[cab.missionRegie.id, 400]]), await missionsDe(c, L1)),
    );
    expect(resultat).toBeNull();
    expect(bilan.jalons).toBe(0);
    expect(await compterActiviteDemo(cab.cabinetId)).toEqual(avant);
  });
});

describe("facture de la semaine", () => {
  it("semaine L1 : une facture émise datée de j, approuvée par un tiers", async () => {
    const { resultat: id, bilan } = await executer(L1, async (c) =>
      facturerSemaineDemo(c, L1, L1, await missionsDe(c, L1)),
    );
    expect(id).toEqual(expect.any(String));
    expect(bilan.factures).toBe(1);
    emises.l1 = id as string;
    const f = await facture(emises.l1);
    expect(f).toMatchObject({ statut: "emise", date_emission: L1 });
    expect(f?.numero).toEqual(expect.any(String));
    expect([f?.cree_par, f?.soumise_par]).not.toContain(f?.approuvee_par);
    expect(await marqueur("activite_demo.facture", emises.l1)).toMatchObject({
      utilisateur_id: null,
      details: expect.objectContaining({ semaine: L1 }),
    });
  });

  it("idempotent : la même semaine n'est pas refacturée", async () => {
    const avant = await compterActiviteDemo(cab.cabinetId);
    const { resultat, bilan } = await executer(L1, async (c) =>
      facturerSemaineDemo(c, L1, L1, await missionsDe(c, L1)),
    );
    expect(resultat).toBeNull();
    expect(bilan.factures).toBe(0);
    expect(await compterActiviteDemo(cab.cabinetId)).toEqual(avant);
  });

  it("semaine L3 : rotation, la facture suivante va à l'autre mission", async () => {
    const { resultat: id } = await executer(L3, async (c) =>
      facturerSemaineDemo(c, L3, L3, await missionsDe(c, L3)),
    );
    expect(id).toEqual(expect.any(String));
    emises.l3 = id as string;
    const f1 = await facture(emises.l1);
    const f3 = await facture(emises.l3);
    expect(f3).toMatchObject({ statut: "emise", date_emission: L3 });
    expect([f3?.cree_par, f3?.soumise_par]).not.toContain(f3?.approuvee_par);
    expect(new Set([f1?.mission_id, f3?.mission_id])).toEqual(
      new Set([cab.missionForfait.id, cab.missionRegie.id]),
    );
  });

  it("forfait : l'échéance prévue, passée à facturer, est facturée", async () => {
    const e = await echeancesDe(await factureDeLaMission(cab.missionForfait.id));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ statut: "facturee" });
    expect(e[0]?.type).not.toBe("regie");
    expect(cab.missionForfait.echeanceIds).toContain(e[0]?.id);
  });

  it("régie : échéances créées sur les temps validés, temps rattachés", async () => {
    const e = await echeancesDe(await factureDeLaMission(cab.missionRegie.id));
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) {
      expect(x).toMatchObject({ type: "regie", statut: "facturee" });
      expect(x.temps).toBeGreaterThan(0);
    }
  });

  it("dernière émission de l'exercice postérieure à j : aucune émission", async () => {
    incidents.length = 0;
    // Semaine L2, jour j = veille de L3 : la facture de L3 est postérieure.
    const j = ajouterJours(L3, -1);
    const { resultat, bilan } = await sansLendemain(j, async (c) =>
      facturerSemaineDemo(c, L2, j, await missionsDe(c, L2)),
    );
    expect(resultat).toBeNull();
    expect(bilan.factures).toBe(0);
    expect(incidents.map((i) => i.contexte)).toContain("activite_demo_facture");
  });

  it("mentions légales vides : aucune facture, un incident, aucune exception", async () => {
    incidents.length = 0;
    const { resultat, bilan } = await sansLendemain(L5, async (c) => {
      await c.db.query("UPDATE parametres_facturation SET rccm = NULL WHERE cabinet_id = $1", [
        c.cabinetId,
      ]);
      // Une source due cette semaine : l'échéance prévue restante du forfait.
      await c.db.query(
        `UPDATE echeances_facturation SET date_prevue = $2
         WHERE mission_id = $1 AND statut = 'prevue'`,
        [cab.missionForfait.id, L5],
      );
      return facturerSemaineDemo(c, L5, L5, await missionsDe(c, L5));
    });
    expect(resultat).toBeNull();
    expect(bilan.factures).toBe(0);
    expect(bilan.echecs).toBeGreaterThan(0);
    const factureIncidents = incidents.filter((i) => i.contexte === "activite_demo_facture");
    expect(factureIncidents.map((i) => i.code)).toContain("MENTIONS_INCOMPLETES");
  });
});

describe("encaissement de la semaine", () => {
  it("semaine L4 : la facture de la tâche âgée de 21 jours passe avant la facture semée", async () => {
    const { resultat: id, bilan } = await executer(L4, (c) => encaisserSemaineDemo(c, L4, L4));
    expect(id).toEqual(expect.any(String));
    expect(bilan.encaissements).toBe(1);
    expect(await imputationDe(id as string)).toMatchObject({
      facture_id: emises.l1,
      date_imputation: L4,
      date_encaissement: L4,
      mode: "virement",
      reference: `VIR-DEMO-${L4}`,
    });
    expect(await statutPaiement(emises.l1)).toBe("soldee");
    expect(await marqueur("activite_demo.encaissement", id as string)).toMatchObject({
      utilisateur_id: null,
      details: expect.objectContaining({ semaine: L4, facture_id: emises.l1 }),
    });
  });

  it("semaine L1 : sans facture de la tâche assez ancienne, la facture semée est soldée", async () => {
    const { resultat: id } = await executer(L1, (c) => encaisserSemaineDemo(c, L1, L1));
    expect(id).toEqual(expect.any(String));
    // La facture de la tâche émise en L1 n'est pas « avant le lundi » : exclue.
    expect(await imputationDe(id as string)).toMatchObject({
      facture_id: cab.factureAncienneId,
      date_imputation: L1,
    });
    expect(await statutPaiement(cab.factureAncienneId)).toBe("soldee");
  });

  it("semaine L5 : à défaut, la facture de la tâche âgée d'au moins 7 jours", async () => {
    const { resultat: id } = await executer(L5, (c) => encaisserSemaineDemo(c, L5, L5));
    expect(id).toEqual(expect.any(String));
    expect(await imputationDe(id as string)).toMatchObject({
      facture_id: emises.l3,
      date_imputation: L5,
    });
    expect(await statutPaiement(emises.l3)).toBe("soldee");
  });

  it("idempotent : la même semaine n'est pas encaissée deux fois", async () => {
    const avant = await compterActiviteDemo(cab.cabinetId);
    const { resultat, bilan } = await executer(L4, (c) => encaisserSemaineDemo(c, L4, L4));
    expect(resultat).toBeNull();
    expect(bilan.encaissements).toBe(0);
    expect(await compterActiviteDemo(cab.cabinetId)).toEqual(avant);
  });

  it("indicateurs : au moins une facture soldée sur la semaine L1", async () => {
    const r = await cab.associe.get(
      `/api/indicateurs/cabinet?du=${L1}&au=${ajouterJours(L1, 6)}&niveau=cabinet`,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().cabinet.factures_soldees).toBeGreaterThanOrEqual(1);
  });
});

describe("bilan du fichier", () => {
  it("rien d'autre : ni notification, ni e-mail, ni événement ; les annulations n'ont rien laissé", async () => {
    const apres = await compterActiviteDemo(cab.cabinetId);
    expect(apres.notifications).toBe(base.notifications);
    expect(apres.jobs_email).toBe(base.jobs_email);
    expect(apres.evenements_automatisation).toBe(base.evenements_automatisation);
    expect(apres.jalons).toBe(base.jalons + 1);
    expect(apres.factures_emises).toBe(base.factures_emises + 2);
    expect(apres.encaissements).toBe(base.encaissements + 3);
  });
});
