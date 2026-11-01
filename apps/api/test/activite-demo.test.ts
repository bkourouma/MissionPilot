import { randomUUID } from "node:crypto";
import { ajouterJours } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BilanActiviteDemo } from "../src/activite-demo/commun.js";
import { creerHandlerActiviteDemo, executerActiviteDemo } from "../src/activite-demo/job.js";
import { lireSuivisTachesDemo } from "../src/activite-demo/lecture.js";
import {
  cleMensuelleActiviteDemo,
  cleSuiteActiviteDemo,
  planificationActiviteDemo,
  planifierActiviteDemo,
  TYPE_JOB_ACTIVITE_DEMO,
} from "../src/activite-demo/planification.js";
import { brancherDiagnostic } from "../src/automatisation/diagnostic.js";
import type { Database, Db } from "../src/db/pool.js";
import { ErreurJobDefinitive } from "../src/jobs/erreurs.js";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { evaluerAlertes } from "../src/temps/suivi.js";
import {
  compterActiviteDemo,
  preparerCabinetDemo,
  retirerMarquesDemo,
  seulementCabinetsDemo,
  type CabinetDemoTest,
} from "./activite-demo-outils.js";
import type { Api } from "./api.js";
import { attendre, viderEmailsEnFile } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";

/*
 * Job « activite_demo » (§7 T4 de la spécification « période hebdomadaire et job activite_demo ») :
 * orchestration de bout en bout sur vrai PostgreSQL. Cabinets : A démo (fixture complète, plus une
 * seconde mission en cours HORS dérive pour le cas de capacité), B démo DÉSACTIVÉ, C réel (non
 * démo) ; A et B sont démarqués en fin de fichier. L'exécution passe par un contexte direct
 * (`withTenant` + `executerActiviteDemo`, horloge PASSÉE) : aucun worker de ce fichier ne planifie
 * l'activité, et les tâches de suite créées sont passées à « termine » dans le même `it`.
 *
 * Calendrier des cas (tous antérieurs au 2026-11-01, chronologiques pour la numérotation des
 * factures) : semaine courante du 28 septembre (exécution le jeudi 1er octobre), semaine rattrapée du
 * 21 septembre, tâche mensuelle d'octobre et suite du 5 octobre, capacité le 12, vandalisme le 19,
 * mois d'octobre clôturé le 26.
 */

const DATE_REFERENCE = "2026-09-21";
const LUNDI = "2026-09-28";
const J = "2026-10-01";
const MAINTENANT = new Date(`${J}T08:00:00Z`);
const NOMINALE = { mois: "2026-09", semaine: LUNDI };
const JOURS_OUVRES = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const LUNDIS_OCTOBRE = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
/** Mission hors dérive : lundi de début, jours senior budgétés (moins que les 56 j de la régie). */
const DEBUT_HORS_DERIVE = "2026-09-21";
const JOURS_HORS_DERIVE = 30;

let ctx: Contexte;
let a: CabinetDemoTest;
let b: CabinetDemoTest;
let reel: CabinetDemoTest;
let initiaux: Awaited<ReturnType<typeof compterActiviteDemo>>;
/** Mission maintenue en dérive par le cas nominal. */
let derive: string | null = null;
const incidents: Record<string, unknown>[] = [];
let debrancher: () => void = () => undefined;

const lignes = (sql: string, params: unknown[] = []) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

/** Une exécution directe dans la transaction du cabinet (contexte RLS), activation injectée. */
const executer = (
  cabinetId: string,
  charge: Record<string, unknown>,
  maintenant: Date,
  actif = true,
): Promise<BilanActiviteDemo> =>
  ctx.db.withTenant(cabinetId, (db) =>
    executerActiviteDemo(
      { db, cabinetId, jobId: randomUUID(), charge, maintenant },
      { actif: () => actif },
    ),
  );

interface VueIndicateurs {
  taux_occupation?: number | null;
  taux_facturabilite?: number | null;
  consommation_budgetaire?: number | null;
  ecart_terminaison?: { relatif_jours: number | null };
  marge?: { taux_marge: number | null };
  taux_realisation?: number | null;
  encours?: Record<string, number>;
  delai_moyen_encaissement?: number | null;
  factures_soldees?: number;
  carnet_commandes?: number;
  carnet_commandes_facture?: number;
  respect_jalons?: { attendus: number };
  discipline_saisie?: { attendus: number };
}

interface ReponseIndicateurs {
  cabinet: VueIndicateurs;
  elements: (VueIndicateurs & { mission_id: string })[];
}

/** Tableau de bord de la semaine `lundi`, évalué à `jour` (requête du web, §1). */
async function indicateurs(par: Api, lundi: string, jour: string): Promise<ReponseIndicateurs> {
  const au = ajouterJours(lundi, 6);
  const r = await par.get(
    `/api/indicateurs/cabinet?du=${lundi}&au=${au}&niveau=mission&date_reference=${jour}`,
  );
  attendre(200, r, "indicateurs");
  return r.json() as ReponseIndicateurs;
}

/** Les 11 cartes du tableau de bord (§7 T4-2) : noms de celles qui restent vides. */
function cartesVides(v: VueIndicateurs): string[] {
  const cartes: Record<string, unknown> = {
    taux_occupation: v.taux_occupation,
    taux_facturabilite: v.taux_facturabilite,
    consommation_budgetaire: v.consommation_budgetaire,
    ecart_terminaison: v.ecart_terminaison?.relatif_jours,
    marge: v.marge?.taux_marge,
    taux_realisation: v.taux_realisation,
    encours: v.encours,
    delai_moyen_encaissement: (v.factures_soldees ?? 0) >= 1 ? v.delai_moyen_encaissement : null,
    carnet_commandes: v.carnet_commandes,
    respect_jalons: (v.respect_jalons?.attendus ?? 0) >= 1 ? v.respect_jalons : null,
    discipline_saisie: (v.discipline_saisie?.attendus ?? 0) >= 1 ? v.discipline_saisie : null,
  };
  return Object.entries(cartes)
    .filter(([, valeur]) => valeur === null || valeur === undefined)
    .map(([nom]) => nom);
}

/** Écart relatif à terminaison (jours) de chaque mission qui en a un. */
const ecartsParMission = (r: ReponseIndicateurs) =>
  r.elements.flatMap((e) => {
    const relatif = e.ecart_terminaison?.relatif_jours;
    return relatif === null || relatif === undefined ? [] : [{ id: e.mission_id, relatif }];
  });

/** Base simulée : enregistre le texte des requêtes ; aucune tâche à réserver. */
function baseEspion(): { database: Database; requetes: string[] } {
  const requetes: string[] = [];
  const db = {
    query: async (sql: string) => {
      requetes.push(sql);
      return { rows: sql.includes("reserver_job_a") ? [] : [{ n: 0 }], rowCount: 0 };
    },
  } as unknown as Db;
  const database: Database = {
    withTenant: (_cabinetId, fn) => fn(db),
    withoutTenant: (fn) => fn(db),
    close: async () => undefined,
  };
  return { database, requetes };
}

/**
 * Seconde mission de A, en cours et HORS dérive (cas de capacité, D5), par les vraies routes :
 * forfait sans échéancier (aucune source de facture), une tâche de 60 jours ouvrés budgétée en
 * senior, le consultant affecté sur toute sa fenêtre (12 semaines, 2026-10-12 → 2026-10-16). Son
 * budget, inférieur à celui de la régie, laisse la régie en dérive : à écart égal (nul avant la
 * première exécution), le moteur retient le budget le plus élevé (`choisirMissionDeriveDemo`). À
 * créer AVANT `initiaux` : signature et passage en cours publient des événements d'automatisation.
 */
async function semerMissionHorsDerive(c: CabinetDemoTest): Promise<void> {
  const m = await creerMission(c, {
    intitule: "Mission hors dérive (capacité)",
    type_mission_id: null,
    mode_facturation: "forfait",
    date_debut: DEBUT_HORS_DERIVE,
    date_fin: ajouterJours(DEBUT_HORS_DERIVE, 7 * 16 - 3),
  });
  const phase = await c.chef.post(`/api/missions/${m.id}/phases`, { libelle: "Cadrage" });
  attendre(201, phase, "phase hors dérive");
  const tache = await c.chef.post(`/api/missions/${m.id}/taches`, {
    parent_id: phase.json().id,
    libelle: "Cadrage",
    duree_jours_ouvres: 60,
  });
  attendre(201, tache, "tâche hors dérive");
  const tacheId = tache.json().id as string;
  const budget = { lignes: [{ grade_id: c.grades.senior, jours: JOURS_HORS_DERIVE }] };
  const url = `/api/missions/${m.id}/taches/${tacheId}/budget`;
  attendre(200, await c.chef.put(url, budget), "budget hors dérive");
  const signature = { date_signature: ajouterJours(DEBUT_HORS_DERIVE, -3) };
  attendre(200, await c.directeur.post(`/api/missions/${m.id}/signer`, signature), "signature");
  const enCours = await c.directeur.post(`/api/missions/${m.id}/statut`, { statut: "en_cours" });
  attendre(200, enCours, "mission hors dérive en cours");
  const affectation = await c.chef.post(`/api/missions/${m.id}/affectations`, {
    tache_id: tacheId,
    collaborateur_id: c.consultant.collaborateurId,
    jours_alloues: JOURS_HORS_DERIVE,
    date_debut: DEBUT_HORS_DERIVE,
    date_fin: ajouterJours(DEBUT_HORS_DERIVE, 7 * 11 + 4),
  });
  attendre(201, affectation, "affectation hors dérive");
  await viderEmailsEnFile(c.cabinetId);
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinetDemo(ctx, "Activité démo A", { dateReference: DATE_REFERENCE });
  await semerMissionHorsDerive(a);
  b = await preparerCabinetDemo(ctx, "Activité démo B (désactivé)", {
    dateReference: DATE_REFERENCE,
    estDemo: true,
    actif: false,
  });
  reel = await preparerCabinetDemo(ctx, "Activité démo C (réel)", {
    dateReference: DATE_REFERENCE,
    estDemo: false,
  });
  initiaux = await compterActiviteDemo(a.cabinetId);
  debrancher = brancherDiagnostic((entree) => incidents.push(entree));
}, 300_000);

afterAll(async () => {
  debrancher();
  // Démarquage obligatoire (fixture) : plafond de 30 cabinets démo (0582), listes « un clic ».
  await retirerMarquesDemo();
  await ctx.fermer();
});

describe("gardes : aucune écriture", () => {
  it("inactive, cabinet démo désactivé, cabinet réel : aucune écriture", async () => {
    const tous = [a, b, reel];
    const avant = await Promise.all(tous.map((k) => compterActiviteDemo(k.cabinetId)));
    expect((await executer(a.cabinetId, NOMINALE, MAINTENANT, false)).statut).toBe("inactif");
    expect((await executer(a.cabinetId, { mois: "2026-10" }, MAINTENANT, false)).statut).toBe(
      "inactif",
    );
    for (const k of [b, reel]) {
      expect((await executer(k.cabinetId, NOMINALE, MAINTENANT)).statut).toBe("hors_perimetre");
      expect((await executer(k.cabinetId, { mois: "2026-10" }, MAINTENANT)).statut).toBe(
        "hors_perimetre",
      );
    }
    expect(await Promise.all(tous.map((k) => compterActiviteDemo(k.cabinetId)))).toEqual(avant);
  }, 60_000);

  it("handler par défaut : inactif dans la configuration de test (DEMO_PUBLIQUE=non), aucune notification", async () => {
    const avant = await compterActiviteDemo(a.cabinetId);
    const rendues = await ctx.db.withTenant(a.cabinetId, (db) =>
      creerHandlerActiviteDemo()({
        db,
        cabinetId: a.cabinetId,
        jobId: randomUUID(),
        charge: NOMINALE,
        maintenant: MAINTENANT,
      }),
    );
    expect(rendues).toEqual([]);
    expect(await compterActiviteDemo(a.cabinetId)).toEqual(avant);
  });

  it("est_demo retiré après la planification : la tâche s'exécute sans rien écrire", async () => {
    const avant = await compterActiviteDemo(a.cabinetId);
    await proprietaire((c) =>
      c.query("UPDATE cabinets SET est_demo = false WHERE id = $1", [a.cabinetId]),
    );
    try {
      expect((await executer(a.cabinetId, NOMINALE, MAINTENANT)).statut).toBe("hors_perimetre");
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE cabinets SET est_demo = true WHERE id = $1", [a.cabinetId]),
      );
    }
    expect(await compterActiviteDemo(a.cabinetId)).toEqual(avant);
  });

  it("charge invalide (mois impossible, mardi, lundi d'un autre mois, clé inconnue) : échec définitif", async () => {
    const avant = await compterActiviteDemo(a.cabinetId);
    for (const charge of [
      {},
      { mois: "2026-13" },
      { mois: "2026-09", semaine: "2026-09-29" },
      { mois: "2026-09", semaine: "2026-10-05" },
      { mois: "2026-09", semaine: "2026-02-30" },
      { mois: "2026-09", autre: 1 },
    ]) {
      await expect(executer(a.cabinetId, charge, MAINTENANT)).rejects.toBeInstanceOf(
        ErreurJobDefinitive,
      );
    }
    // Même refus quand l'activité est inactive : la charge est contrôlée d'abord.
    await expect(executer(a.cabinetId, { mois: "x" }, MAINTENANT, false)).rejects.toThrow(
      /Charge de la tâche activite_demo invalide/,
    );
    expect(await compterActiviteDemo(a.cabinetId)).toEqual(avant);
  });

  it("charge invalide par le worker : échec dès la première tentative", async () => {
    const [job] = await lignes(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
       VALUES ($1, $2, $3, $4, 'activite_demo:charge-invalide') RETURNING id`,
      [
        a.cabinetId,
        TYPE_JOB_ACTIVITE_DEMO,
        JSON.stringify({ mois: "2026-09", semaine: "2026-09-29" }),
        MAINTENANT,
      ],
    );
    const worker = new WorkerJobs(ctx.db, {
      mailer: new MailerJournal(),
      registre: creerRegistre({
        [TYPE_JOB_ACTIVITE_DEMO]: seulementCabinetsDemo(
          [a.cabinetId],
          creerHandlerActiviteDemo({ actif: () => true }),
        ),
      }),
      horloge: () => MAINTENANT,
    });
    let statut: string | null = null;
    for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) {
      if (r.id === job?.id) {
        statut = r.statut;
        break;
      }
    }
    expect(statut).toBe("echec");
    const [apres] = await lignes("SELECT statut, tentatives FROM jobs WHERE id = $1", [job?.id]);
    expect(apres).toEqual({ statut: "echec", tentatives: 1 });
  }, 60_000);
});

describe("cas nominal : semaine courante", () => {
  it("feuilles complètes du lundi au vendredi, partie interne, soumises à l'horloge, validées par un autre", async () => {
    const bilan = await executer(a.cabinetId, NOMINALE, MAINTENANT);
    expect(bilan).toMatchObject({
      statut: "fait",
      mois: "2026-09",
      semaines: [LUNDI],
      jalons: 1,
      factures: 1,
      encaissements: 1,
      suites: 0,
      prolongations: 0,
    });
    expect(bilan.echecs, JSON.stringify(incidents)).toBe(0);
    expect(bilan.derive).not.toBeNull();
    derive = bilan.derive;

    const feuilles = await lignes(
      `SELECT id, statut, auteur_id, premiere_soumission_le FROM feuilles_temps
       WHERE cabinet_id = $1 AND semaine = $2 AND collaborateur_id = ANY ($3::uuid[])`,
      [a.cabinetId, LUNDI, [a.consultant.collaborateurId, a.junior.collaborateurId]],
    );
    expect(feuilles).toHaveLength(2);
    for (const f of feuilles) {
      expect(f.statut).toBe("validee");
      expect((f.premiere_soumission_le as Date).toISOString()).toBe(MAINTENANT.toISOString());
      const saisies = await lignes(
        "SELECT date::text AS date, centiemes, activite_id FROM lignes_temps WHERE feuille_id = $1",
        [f.id],
      );
      const parJour: Record<string, number> = {};
      for (const l of saisies) parJour[l.date] = (parJour[l.date] ?? 0) + (l.centiemes as number);
      // Capacité de 100 % : chaque jour ouvré est complet (1 jour), mission et activité interne.
      expect(parJour).toEqual(Object.fromEntries(JOURS_OUVRES.map((d) => [d, 100])));
      expect(saisies.some((l) => l.activite_id !== null)).toBe(true);
      expect(saisies.some((l) => l.activite_id === null)).toBe(true);
      const decisions = await lignes(
        "SELECT decide_par, decide_le FROM feuille_validations WHERE feuille_id = $1",
        [f.id],
      );
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      for (const d of decisions) {
        expect(d.decide_par).not.toBe(f.auteur_id);
        expect((d.decide_le as Date).toISOString()).toBe(MAINTENANT.toISOString());
      }
    }
    // Journal du job : jamais d'utilisateur, un marqueur d'exécution.
    const journal = await lignes(
      `SELECT action, utilisateur_id FROM journal_audit WHERE cabinet_id = $1 AND action LIKE $2`,
      [a.cabinetId, "activite\\_demo.%"],
    );
    expect(journal.some((l) => l.action === "activite_demo.execution")).toBe(true);
    expect(journal.filter((l) => l.utilisateur_id !== null)).toEqual([]);
  }, 120_000);

  it("tableau de bord de la semaine (associé) : les 11 cartes renseignées, une seule mission en dérive", async () => {
    const r = await indicateurs(a.associe, LUNDI, J);
    expect(cartesVides(r.cabinet)).toEqual([]);
    expect(r.cabinet.factures_soldees).toBeGreaterThanOrEqual(1);
    const ecarts = ecartsParMission(r);
    expect(ecarts.filter((e) => e.relatif > 0.05).map((e) => e.id)).toEqual([derive]);
    expect(ecarts.filter((e) => e.id !== derive && e.relatif > 0)).toEqual([]);
  });

  it("en directeur : même dérive ; marge, réalisation et encours absents (FIN-02), carnet facturé présent", async () => {
    const r = await indicateurs(a.directeur, LUNDI, J);
    expect(r.cabinet.marge).toBeUndefined();
    expect(r.cabinet.taux_realisation).toBeUndefined();
    expect(r.cabinet.encours).toBeUndefined();
    expect(r.cabinet.carnet_commandes_facture).toBeDefined();
    expect(
      ecartsParMission(r)
        .filter((e) => e.relatif > 0.05)
        .map((e) => e.id),
    ).toEqual([derive]);
  });

  it("idempotence : une seconde exécution laisse tous les comptes identiques", async () => {
    const avant = await compterActiviteDemo(a.cabinetId);
    const second = await executer(a.cabinetId, NOMINALE, new Date(`${J}T09:00:00Z`));
    expect(second).toMatchObject({
      statut: "fait",
      semaines: [LUNDI],
      feuilles: 0,
      jalons: 0,
      factures: 0,
      encaissements: 0,
    });
    expect(await compterActiviteDemo(a.cabinetId)).toEqual(avant);
  }, 120_000);
});

describe("semaines et suites", () => {
  it("semaine rattrapée : feuilles seulement, ni jalon, ni facture, ni encaissement", async () => {
    const avant = await compterActiviteDemo(a.cabinetId);
    const r = await executer(a.cabinetId, { mois: "2026-09", semaine: "2026-09-21" }, MAINTENANT);
    expect(r).toMatchObject({
      statut: "fait",
      semaines: ["2026-09-21"],
      jalons: 0,
      factures: 0,
      encaissements: 0,
    });
    expect(r.feuilles).toBeGreaterThanOrEqual(1);
    const apres = await compterActiviteDemo(a.cabinetId);
    expect(apres.feuilles).toBe(avant.feuilles + r.feuilles);
    expect([apres.jalons, apres.factures_emises, apres.encaissements]).toEqual([
      avant.jalons,
      avant.factures_emises,
      avant.encaissements,
    ]);
  }, 120_000);

  it("tâche mensuelle : une suite par lundi restant à 05:00Z ; une suite ne traite que sa semaine", async () => {
    const motif = `${TYPE_JOB_ACTIVITE_DEMO}:2026-10:%`;
    try {
      const mensuel = await executer(
        a.cabinetId,
        { mois: "2026-10" },
        new Date("2026-10-01T04:00:00Z"),
      );
      expect(mensuel).toMatchObject({ statut: "fait", suites: 4, semaines: [LUNDI] });
      const suites = await lignes(
        `SELECT cle, charge, execute_a, statut FROM jobs
         WHERE cabinet_id = $1 AND type = $2 AND cle LIKE $3 ORDER BY cle`,
        [a.cabinetId, TYPE_JOB_ACTIVITE_DEMO, motif],
      );
      expect(suites.map((s) => s.cle)).toEqual(
        LUNDIS_OCTOBRE.map((l) => cleSuiteActiviteDemo("2026-10", l)),
      );
      expect(suites.map((s) => (s.execute_a as Date).toISOString())).toEqual(
        LUNDIS_OCTOBRE.map((l) => `${l}T05:00:00.000Z`),
      );
      expect(suites.map((s) => s.charge)).toEqual(
        LUNDIS_OCTOBRE.map((l) => ({ mois: "2026-10", semaine: l })),
      );
      expect(suites.every((s) => s.statut === "en_attente")).toBe(true);
      // Rejouée, la tâche mensuelle ne double ni les suites ni l'avenant du mois.
      const encore = await executer(
        a.cabinetId,
        { mois: "2026-10" },
        new Date("2026-10-01T04:30:00Z"),
      );
      expect(encore).toMatchObject({ suites: 0, prolongations: 0, feuilles: 0 });
      // La suite du 5 octobre, à son heure : sa seule semaine, ni suite ni avenant.
      const suite = await executer(
        a.cabinetId,
        { mois: "2026-10", semaine: "2026-10-05" },
        new Date("2026-10-05T05:00:00Z"),
      );
      expect(suite).toMatchObject({
        statut: "fait",
        semaines: ["2026-10-05"],
        suites: 0,
        prolongations: 0,
      });
      // Une semaine à venir n'est jamais traitée.
      const avance = await executer(
        a.cabinetId,
        { mois: "2026-10", semaine: "2026-10-12" },
        new Date("2026-10-05T05:00:00Z"),
      );
      expect(avance).toMatchObject({ statut: "fait", semaines: [], feuilles: 0 });
    } finally {
      await proprietaire((c) =>
        c.query(
          "UPDATE jobs SET statut = 'termine' WHERE cabinet_id = $1 AND type = $2 AND cle LIKE $3",
          [a.cabinetId, TYPE_JOB_ACTIVITE_DEMO, motif],
        ),
      );
    }
  }, 180_000);
});

describe("règles de la semaine", () => {
  it("capacité (D5) : une déclaration d'un autre collaborateur bloque la tâche ; budgets tenus hors dérive", async () => {
    const semaine = "2026-10-12";
    // Hors de la mission en dérive (capacité « libre », DT5) : l'affectation du consultant sur la
    // mission hors dérive (semerMissionHorsDerive) ; la déclaration de l'autre collaborateur lui
    // retire toute capacité sur la tâche.
    const [paire] = await lignes(
      `SELECT a.mission_id, a.tache_id, a.collaborateur_id FROM affectations a
       WHERE a.cabinet_id = $1 AND a.collaborateur_id = ANY ($2::uuid[])
         AND ($3::uuid IS NULL OR a.mission_id <> $3::uuid)
         AND a.date_debut <= $5::date AND a.date_fin >= $4::date
       ORDER BY a.tache_id, a.collaborateur_id LIMIT 1`,
      [
        a.cabinetId,
        [a.consultant.collaborateurId, a.junior.collaborateurId],
        derive,
        semaine,
        ajouterJours(semaine, 4),
      ],
    );
    if (!paire) {
      throw new Error("Fixture : aucune affectation hors dérive (voir semerMissionHorsDerive).");
    }
    const autre = paire.collaborateur_id === a.consultant.collaborateurId ? a.junior : a.consultant;
    await lignes(
      `INSERT INTO reste_a_faire
         (cabinet_id, mission_id, tache_id, collaborateur_id, semaine, centiemes, declare_par, declare_le)
       VALUES ($1, $2, $3, $4, '2026-10-05', 500, $5, '2026-10-09T12:00:00Z')`,
      [a.cabinetId, paire.mission_id, paire.tache_id, autre.collaborateurId, autre.utilisateurId],
    );
    const r = await executer(
      a.cabinetId,
      { mois: "2026-10", semaine },
      new Date("2026-10-14T08:00:00Z"),
    );
    expect(r).toMatchObject({ statut: "fait", semaines: [semaine] });
    const feuille = await lignes(
      "SELECT id FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2",
      [paire.collaborateur_id, semaine],
    );
    expect(feuille).toHaveLength(1);
    const surTache = await lignes(
      "SELECT centiemes FROM lignes_temps WHERE feuille_id = $1 AND tache_id = $2",
      [feuille[0]?.id, paire.tache_id],
    );
    expect(surTache).toEqual([]);

    const missions = (
      await lignes(
        "SELECT id FROM missions WHERE cabinet_id = $1 AND statut IN ('signee', 'en_cours')",
        [a.cabinetId],
      )
    ).map((m) => m.id as string);
    const suivis = await ctx.db.withTenant(a.cabinetId, (db) =>
      lireSuivisTachesDemo(db, a.cabinetId, missions),
    );
    const depassees = [...suivis.values()]
      .flat()
      .filter((s) => s.missionId !== derive && s.realiseCentiemes > s.budgetCentiemes)
      .map((s) => s.tacheId);
    expect(depassees).toEqual([]);
  }, 120_000);

  it("vandalisme : une feuille en brouillon d'un visiteur est laissée intacte", async () => {
    const semaine = "2026-10-19";
    const [brouillon] = await lignes(
      `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
       VALUES ($1, $2, $3, $4) RETURNING id, modifie_le`,
      [a.cabinetId, a.consultant.collaborateurId, a.consultant.utilisateurId, semaine],
    );
    const r = await executer(
      a.cabinetId,
      { mois: "2026-10", semaine },
      new Date("2026-10-21T08:00:00Z"),
    );
    expect(r).toMatchObject({ statut: "fait", semaines: [semaine] });
    const [apres] = await lignes(
      "SELECT statut, cycle, soumise_le, modifie_le FROM feuilles_temps WHERE id = $1",
      [brouillon?.id],
    );
    expect(apres).toMatchObject({ statut: "brouillon", cycle: 0, soumise_le: null });
    expect((apres?.modifie_le as Date).getTime()).toBe((brouillon?.modifie_le as Date).getTime());
    expect(
      await lignes("SELECT id FROM lignes_temps WHERE feuille_id = $1", [brouillon?.id]),
    ).toEqual([]);
    expect(
      await lignes("SELECT id FROM feuille_validations WHERE feuille_id = $1", [brouillon?.id]),
    ).toEqual([]);
    const junior = await lignes(
      "SELECT statut FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2",
      [a.junior.collaborateurId, semaine],
    );
    expect(junior.map((f) => f.statut)).toEqual(["validee"]);
  }, 120_000);

  it("mois clôturé (periodes_temps) : aucune ligne dans ce mois, aucune erreur MPT03", async () => {
    const semaine = "2026-10-26";
    await lignes(
      `INSERT INTO periodes_temps (cabinet_id, mois, statut, cloturee_par, cloturee_le)
       VALUES ($1, '2026-10', 'cloturee', $2, now())`,
      [a.cabinetId, a.associeId],
    );
    const compter = async () =>
      (
        await lignes(
          `SELECT count(*)::int AS n FROM lignes_temps
           WHERE cabinet_id = $1 AND date BETWEEN '2026-10-01' AND '2026-10-31'`,
          [a.cabinetId],
        )
      )[0]?.n as number;
    const avant = await compter();
    const debut = incidents.length;
    const r = await executer(
      a.cabinetId,
      { mois: "2026-10", semaine },
      new Date("2026-10-28T08:00:00Z"),
    );
    expect(r.statut).toBe("fait");
    expect(r.feuilles).toBe(0);
    expect(await compter()).toBe(avant);
    expect(
      await lignes("SELECT id FROM feuilles_temps WHERE cabinet_id = $1 AND semaine = $2", [
        a.cabinetId,
        semaine,
      ]),
    ).toEqual([]);
    expect(JSON.stringify(incidents.slice(debut))).not.toContain("MPT03");
  }, 120_000);
});

describe("aucun envoi", () => {
  it("aucune notification, aucun e-mail en file, aucun événement d'automatisation", async () => {
    const apres = await compterActiviteDemo(a.cabinetId);
    expect({
      notifications: apres.notifications,
      jobs_email: apres.jobs_email,
      evenements_automatisation: apres.evenements_automatisation,
    }).toEqual({
      notifications: initiaux.notifications,
      jobs_email: initiaux.jobs_email,
      evenements_automatisation: initiaux.evenements_automatisation,
    });
    // L'activité a bien écrit : la comparaison n'est pas vide de sens.
    expect(apres.feuilles).toBeGreaterThan(initiaux.feuilles);
    expect(apres.factures_emises).toBeGreaterThan(initiaux.factures_emises);
  });

  it("evaluerAlertes(…, { notifier: false }) : alerte active sans notification ; l'appel par défaut notifie", async () => {
    expect(derive).not.toBeNull();
    const mission = derive as string;
    const actives = () =>
      lignes("SELECT type FROM alertes_suivi WHERE mission_id = $1 AND active", [mission]);
    const notifications = async () =>
      (
        await lignes(
          `SELECT count(*)::int AS n FROM notifications
           WHERE cabinet_id = $1 AND type = 'alerte_suivi_budget'`,
          [a.cabinetId],
        )
      )[0]?.n as number;
    const lever = () =>
      proprietaire((c) =>
        c.query("UPDATE alertes_suivi SET active = false, levee_le = now() WHERE mission_id = $1", [
          mission,
        ]),
      );
    // Le job a évalué les alertes de la mission en dérive sans notifier personne (comptes
    // inchangés : cas « aucun envoi » ci-dessus).
    expect((await actives()).length).toBeGreaterThanOrEqual(1);
    const n0 = await notifications();
    await lever();
    expect(
      await ctx.db.withTenant(a.cabinetId, (db) =>
        evaluerAlertes(db, a.cabinetId, mission, { notifier: false }),
      ),
    ).toEqual([]);
    expect((await actives()).length).toBeGreaterThanOrEqual(1);
    expect(await notifications()).toBe(n0);
    // Par défaut, comportement inchangé : la même alerte redéclenchée notifie chef et directeur.
    await lever();
    const creees = await ctx.db.withTenant(a.cabinetId, (db) =>
      evaluerAlertes(db, a.cabinetId, mission),
    );
    expect(creees.length).toBeGreaterThanOrEqual(1);
    expect(await notifications()).toBeGreaterThan(n0);
    await viderEmailsEnFile(a.cabinetId);
  });
});

describe("planification", () => {
  it("clé du mois, exécution le 1er à 4 h UTC ; clés des suites", () => {
    const p = planificationActiviteDemo(new Date("2026-11-17T13:45:00Z"));
    expect(p).toMatchObject({
      cle: "activite_demo:2026-11",
      mois: "2026-11",
      premier: "2026-11-01",
    });
    expect(p.executeA.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(planificationActiviteDemo(new Date("2026-12-31T23:59:59Z")).cle).toBe(
      "activite_demo:2026-12",
    );
    expect(cleMensuelleActiviteDemo("2027-01")).toBe("activite_demo:2027-01");
    expect(cleSuiteActiviteDemo("2026-11", "2026-11-30")).toBe("activite_demo:2026-11:2026-11-30");
  });

  it("inactive : 0 sans aucune requête ; active : une tâche pour le cabinet démo actif, aucune pour B ni C", async () => {
    const quand = new Date("2098-06-15T00:00:00Z");
    const espion = baseEspion();
    expect(
      await espion.database.withoutTenant((db) => planifierActiviteDemo(db, quand, false)),
    ).toBe(0);
    expect(espion.requetes).toEqual([]);
    // Planification réelle dans une transaction ANNULÉE : rien ne reste pour les autres fichiers.
    const vu: { creees: number; tache?: Record<string, unknown>; autres?: number } = { creees: -1 };
    const cle = cleMensuelleActiviteDemo("2098-06");
    await expect(
      ctx.db.withoutTenant(async (db) => {
        vu.creees = await planifierActiviteDemo(db, quand, true);
        const lire = async (cabinetId: string) => {
          await db.query("SELECT set_config('app.cabinet_id', $1, true)", [cabinetId]);
          return (
            await db.query(
              "SELECT charge, execute_a, statut FROM jobs WHERE type = $1 AND cle = $2",
              [TYPE_JOB_ACTIVITE_DEMO, cle],
            )
          ).rows;
        };
        vu.tache = (await lire(a.cabinetId))[0];
        vu.autres = (await lire(b.cabinetId)).length + (await lire(reel.cabinetId)).length;
        throw new Error("annulation du test");
      }),
    ).rejects.toThrow("annulation du test");
    expect(vu.creees).toBeGreaterThanOrEqual(1);
    expect(vu.tache).toMatchObject({ charge: { mois: "2098-06" }, statut: "en_attente" });
    expect((vu.tache?.execute_a as Date).toISOString()).toBe("2098-06-01T04:00:00.000Z");
    expect(vu.autres).toBe(0);
    expect(await lignes("SELECT id FROM jobs WHERE cle = $1", [cle])).toEqual([]);
  });

  it("un worker créé sans l'option ne planifie jamais l'activité ; avec l'option, une fois par cycle", async () => {
    const horloge = () => new Date("2098-06-15T00:00:00Z");
    const sans = baseEspion();
    await new WorkerJobs(sans.database, {
      mailer: new MailerJournal(),
      registre: creerRegistre({}),
      horloge,
    }).cycle();
    expect(sans.requetes.some((q) => q.includes("planifier_job_cabinets"))).toBe(true);
    expect(sans.requetes.some((q) => q.includes("planifier_activite_demo"))).toBe(false);
    const avec = baseEspion();
    await new WorkerJobs(avec.database, {
      mailer: new MailerJournal(),
      registre: creerRegistre({}),
      horloge,
      activiteDemo: true,
    }).cycle();
    expect(avec.requetes.filter((q) => q.includes("planifier_activite_demo"))).toHaveLength(1);
  });
});
