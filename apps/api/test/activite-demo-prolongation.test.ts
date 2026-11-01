import { randomUUID } from "node:crypto";
import {
  ajouterJours,
  calculerBudget,
  fenetreDuMoisDemo,
  jourSemaine,
  LIBELLE_PHASE_PROLONGATION_DEMO,
  libelleTacheProlongationDemo,
  lundiDeLaSemaine,
  moisDeDateDemo,
  motifAvenantDemo,
  PARAMETRES_ACTIVITE_DEMO,
} from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contexteActiviteDemo } from "../src/activite-demo/commun.js";
import { lireSemaineDemo } from "../src/activite-demo/lecture.js";
import { prolongerMoisDemo } from "../src/activite-demo/prolongation.js";
import { brancherDiagnostic } from "../src/automatisation/diagnostic.js";
import { chargerVersions, versVersionMoteur } from "../src/missions/budget.js";
import { joursAllouesParGrade, joursFigesParGrade } from "../src/planification/affectations.js";
import {
  compterActiviteDemo,
  preparerCabinetDemo,
  retirerMarquesDemo,
  type CabinetDemoTest,
} from "./activite-demo-outils.js";
import { attendre } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Avenant mensuel de prolongation de la tâche « activite_demo » (prolongation.ts ; §5, DT1, DT11,
 * DT12). Fixture : activite-demo-outils.ts (L = lundi de DATE_REFERENCE) ; la régie a ses
 * affectations jusqu'à L + 25 et finit à L + 81, le forfait finit à L + 67. Le mois de l'avenant
 * est celui qui suit de deux semaines la fin de la régie : les deux membres (consultant senior,
 * junior) y sont entièrement libres, et la date de fin de la régie doit être repoussée.
 * Chaque cas a son cabinet (la fixture y est modifiée : révision d'un visiteur, découpage, grade
 * sur-alloué, 36 avenants) ; la tâche mensuelle est appelée par un contexte direct (horloge au 1er
 * du mois, 4 h UTC), sans worker. Les incidents sont lus par la sortie du diagnostic.
 */

const DATE_REFERENCE = "2026-06-01";
const PREPARATION_MS = 300_000;
const MOTIF_VISITEUR = "Révision en cours d'un visiteur";

let ctx: Contexte;
let debrancher: () => void = () => undefined;
const incidents: Record<string, unknown>[] = [];

const lignes = (sql: string, params: unknown[]) =>
  proprietaire(async (cl) => (await cl.query(sql, params)).rows);

async function dateFin(missionId: string): Promise<string | null> {
  const r = await lignes("SELECT date_fin::text AS d FROM missions WHERE id = $1", [missionId]);
  return (r[0]?.d as string | null | undefined) ?? null;
}

/** Mois de l'avenant : deux semaines après la fin de la mission en régie de la fixture. */
async function moisCible(cab: CabinetDemoTest): Promise<string> {
  return moisDeDateDemo(ajouterJours((await dateFin(cab.missionRegie.id)) as string, 14));
}

/** Tâche mensuelle du mois (prolongation seule), transaction VALIDÉE du cabinet. */
function prolonger(cab: CabinetDemoTest, mois: string): Promise<string[]> {
  return ctx.db.withTenant(cab.cabinetId, async (db) => {
    const maintenant = new Date(`${mois}-01T04:00:00Z`);
    const c = await contexteActiviteDemo(db, cab.cabinetId, randomUUID(), maintenant, mois);
    const lundi = lundiDeLaSemaine(c.jour);
    const l = await lireSemaineDemo(db, cab.cabinetId, lundi, PARAMETRES_ACTIVITE_DEMO);
    return prolongerMoisDemo(c, l.missions, l.collaborateurs);
  });
}

/** Révision laissée en cours par un visiteur (associé) : la mission ne doit plus être prolongée. */
async function revisionDuVisiteur(cab: CabinetDemoTest, missionId: string): Promise<void> {
  const r = await cab.associe.post(`/api/missions/${missionId}/budget/revisions`, {
    motif: MOTIF_VISITEUR,
  });
  attendre(201, r, "révision du visiteur");
}

const versionsDe = (missionId: string) =>
  lignes(
    `SELECT id, numero, type, figee, motif, cree_par, validee_par
     FROM budget_versions WHERE mission_id = $1 ORDER BY numero`,
    [missionId],
  );

/** Lignes des versions FIGÉES : elles ne changent jamais (FIN-03). */
const lignesFigees = (missionId: string) =>
  lignes(
    `SELECT v.numero, l.cle, l.nature, l.jours::text AS jours, l.prix_journalier::text AS prix,
       l.montant_forfait::text AS forfait
     FROM budget_lignes l JOIN budget_versions v ON v.id = l.version_id
     WHERE l.mission_id = $1 AND v.figee ORDER BY v.numero, l.cle`,
    [missionId],
  );

const tachesProlongation = (missionId: string, mois: string) =>
  lignes(
    `SELECT id, date_debut::text AS debut FROM mission_taches
     WHERE mission_id = $1 AND libelle = $2`,
    [missionId, libelleTacheProlongationDemo(mois)],
  );

/** Codes de grade du budget en jours d'une tâche. */
const gradesDeTache = async (tacheId: unknown) =>
  (
    await lignes(
      `SELECT g.code FROM tache_budget_lignes l JOIN grades g ON g.id = l.grade_id
       WHERE l.tache_id = $1 ORDER BY g.code`,
      [tacheId],
    )
  ).map((l) => l.code as string);

/** Affectations posées sur les tâches de prolongation du mois, toutes missions du cabinet. */
const affectationsProlongation = (cabinetId: string, mois: string) =>
  lignes(
    `SELECT a.mission_id, a.tache_id, a.collaborateur_id, a.jours_alloues::text AS jours,
       a.date_debut::text AS debut, a.date_fin::text AS fin
     FROM affectations a JOIN mission_taches t ON t.id = a.tache_id
     WHERE a.cabinet_id = $1 AND t.libelle = $2 ORDER BY a.collaborateur_id`,
    [cabinetId, libelleTacheProlongationDemo(mois)],
  );

const echeancesProlongation = (missionId: string) =>
  lignes(
    `SELECT montant::text AS montant, date_prevue::text AS date_prevue, type, statut
     FROM echeances_facturation WHERE mission_id = $1 AND libelle LIKE 'Prolongation %'
     ORDER BY date_prevue`,
    [missionId],
  );

/** Honoraires (moteur) des deux dernières versions figées : avant et après l'avenant. */
function honorairesAvantApres(
  cab: CabinetDemoTest,
  missionId: string,
): Promise<{ avant: number; apres: number }> {
  return ctx.db.withTenant(cab.cabinetId, async (db) => {
    const figees = (await chargerVersions(db, missionId)).filter((v) => v.figee);
    const honoraires = (i: number) => {
      const v = figees[i];
      if (!v) throw new Error("Version figée manquante.");
      return calculerBudget(versVersionMoteur(v)).honoraires.valeur;
    };
    return { avant: honoraires(figees.length - 2), apres: honoraires(figees.length - 1) };
  });
}

const incidentsDe = (message: string) => incidents.filter((i) => i.message === message);

beforeAll(async () => {
  ctx = await demarrer();
  debrancher = brancherDiagnostic((entree) => {
    incidents.push(entree);
  });
});

afterAll(async () => {
  debrancher();
  await retirerMarquesDemo();
  await ctx.fermer();
});

describe("avenant complet sur la mission en régie", () => {
  let cab: CabinetDemoTest;
  let mois: string;
  let ids: string[];
  let figeesAvant: Record<string, unknown>[];
  let finAvant: string | null;
  let avant: Awaited<ReturnType<typeof compterActiviteDemo>>;

  beforeAll(async () => {
    cab = await preparerCabinetDemo(ctx, "Prolongation A", { dateReference: DATE_REFERENCE });
    mois = await moisCible(cab);
    figeesAvant = await lignesFigees(cab.missionRegie.id);
    finAvant = await dateFin(cab.missionRegie.id);
    avant = await compterActiviteDemo(cab.cabinetId);
    ids = await prolonger(cab, mois);
  }, PREPARATION_MS);

  it("une NOUVELLE version révisée, figée, validée par un autre que son auteur", async () => {
    expect(ids).toEqual([cab.missionRegie.id]);
    const versions = await versionsDe(cab.missionRegie.id);
    const derniere = versions[versions.length - 1];
    expect(derniere).toMatchObject({ type: "revise", figee: true, motif: motifAvenantDemo(mois) });
    expect(derniere?.cree_par).toBe(cab.chef.utilisateurId);
    expect(derniere?.validee_par).toBeTruthy();
    expect(derniere?.validee_par).not.toBe(derniere?.cree_par);
    expect(versions.filter((v) => !v.figee)).toEqual([]);
    const comptes = await compterActiviteDemo(cab.cabinetId);
    expect(comptes.versions).toBe(avant.versions + 1);
  });

  it("la version de référence et les versions antérieures sont intactes (FIN-03)", async () => {
    const numeros = new Set(figeesAvant.map((l) => l.numero));
    const apres = await lignesFigees(cab.missionRegie.id);
    expect(apres.filter((l) => numeros.has(l.numero))).toEqual(figeesAvant);
    expect(apres.length).toBeGreaterThan(figeesAvant.length);
  });

  it("la date de fin est repoussée jusqu'au dimanche de fin de l'avenant", async () => {
    const fin = (await dateFin(cab.missionRegie.id)) as string;
    expect(finAvant).not.toBeNull();
    expect(fin > (finAvant as string)).toBe(true);
    expect(fin <= fenetreDuMoisDemo(mois).fin).toBe(true);
    expect(jourSemaine(fin)).toBe(7);
  });

  it("tâche de prolongation dans la phase dédiée, budget en jours des deux grades", async () => {
    const taches = await tachesProlongation(cab.missionRegie.id, mois);
    expect(taches).toHaveLength(1);
    expect(await gradesDeTache(taches[0]?.id)).toEqual(["junior", "senior"]);
    const phase = await lignes(
      `SELECT p.libelle FROM mission_phases p JOIN mission_taches t ON t.phase_id = p.id
       WHERE t.id = $1`,
      [taches[0]?.id],
    );
    expect(phase[0]?.libelle).toBe(LIBELLE_PHASE_PROLONGATION_DEMO);
  });

  it("affectations dans la fenêtre de la tâche et la mission, budget figé tenu", async () => {
    const affectations = await affectationsProlongation(cab.cabinetId, mois);
    const membres = [cab.consultant.collaborateurId, cab.junior.collaborateurId].sort();
    expect(affectations.map((a) => a.collaborateur_id)).toEqual(membres);
    const url = `/api/missions/${cab.missionRegie.id}/planning`;
    const planning = (await cab.associe.get(url)).json();
    const taches = planning.taches as { id: string; debut: string; fin: string }[];
    const fenetre = taches.find((t) => t.id === affectations[0]?.tache_id);
    if (!fenetre) throw new Error("Tâche de prolongation absente du planning.");
    const fin = (await dateFin(cab.missionRegie.id)) as string;
    for (const a of affectations) {
      expect(a.debut >= fenetre.debut && a.fin <= fenetre.fin, JSON.stringify(a)).toBe(true);
      expect(a.fin <= fin).toBe(true);
    }
    await ctx.db.withTenant(cab.cabinetId, async (db) => {
      const fige = await joursFigesParGrade(db, cab.missionRegie.id);
      const alloue = await joursAllouesParGrade(db, cab.missionRegie.id);
      for (const [grade, jours] of alloue) {
        expect(jours, grade).toBeLessThanOrEqual(fige?.get(grade) ?? 0);
      }
    });
    const refus = new Set(["BUDGET_FIGE_DEPASSE", "ECHEANCIER_DEPASSE_BUDGET"]);
    expect(incidents.filter((i) => refus.has(i.code as string))).toEqual([]);
  });

  it("aucune échéance sur une mission en régie ; aucun e-mail ni notification", async () => {
    expect(await echeancesProlongation(cab.missionRegie.id)).toEqual([]);
    const comptes = await compterActiviteDemo(cab.cabinetId);
    expect(comptes.notifications).toBe(avant.notifications);
    expect(comptes.jobs_email).toBe(avant.jobs_email);
    expect(comptes.evenements_automatisation).toBe(avant.evenements_automatisation);
  });

  it("marqueur du mois au nom du job, sans montant", async () => {
    const marqueurs = await lignes(
      `SELECT utilisateur_id, entite, details FROM journal_audit
       WHERE cabinet_id = $1 AND action = 'activite_demo.prolongation' AND entite_id = $2`,
      [cab.cabinetId, cab.missionRegie.id],
    );
    expect(marqueurs).toHaveLength(1);
    expect(marqueurs[0]).toMatchObject({ utilisateur_id: null, entite: "mission" });
    expect(marqueurs[0]?.details).toMatchObject({ mois, affectations: 2, echeances: 0 });
    const cles = Object.keys(marqueurs[0]?.details ?? {});
    expect(cles.filter((k) => /montant|prix|nom/.test(k))).toEqual([]);
  });

  it("second appel du même mois : rien de plus", async () => {
    const comptes = await compterActiviteDemo(cab.cabinetId);
    expect(await prolonger(cab, mois)).toEqual([]);
    expect(await compterActiviteDemo(cab.cabinetId)).toEqual(comptes);
    expect(await tachesProlongation(cab.missionRegie.id, mois)).toHaveLength(1);
  });
});

describe("forfait prolongé et ses échéances ; révision d'un visiteur : mission sautée", () => {
  let cab: CabinetDemoTest;
  let mois: string;
  let ids: string[];

  beforeAll(async () => {
    cab = await preparerCabinetDemo(ctx, "Prolongation B", { dateReference: DATE_REFERENCE });
    mois = await moisCible(cab);
    await revisionDuVisiteur(cab, cab.missionRegie.id);
    // Les deux membres passent sur le forfait : une demi-journée sur sa première tâche.
    const forfait = cab.missionForfait.id;
    const planning = (await cab.chef.get(`/api/missions/${forfait}/planning`)).json();
    const t = planning.taches[0] as { id: string; debut: string };
    for (const k of [cab.consultant, cab.junior]) {
      const r = await cab.chef.post(`/api/missions/${forfait}/affectations`, {
        tache_id: t.id,
        collaborateur_id: k.collaborateurId,
        jours_alloues: 0.5,
        date_debut: t.debut,
        date_fin: t.debut,
      });
      attendre(201, r, "affectation sur le forfait");
    }
    ids = await prolonger(cab, mois);
  }, PREPARATION_MS);

  it("le forfait est prolongé ; la régie et sa révision en cours restent intactes", async () => {
    expect(ids).toEqual([cab.missionForfait.id]);
    const regie = await versionsDe(cab.missionRegie.id);
    expect(regie[regie.length - 1]).toMatchObject({ figee: false, motif: MOTIF_VISITEUR });
    expect(await tachesProlongation(cab.missionRegie.id, mois)).toEqual([]);
  });

  it("une échéance prévue par lundi de l'avenant ; leur somme vaut le supplément", async () => {
    const echeances = await echeancesProlongation(cab.missionForfait.id);
    expect(echeances.length).toBeGreaterThan(0);
    const depuis = lundiDeLaSemaine(`${mois}-01`);
    for (const e of echeances) {
      expect(e).toMatchObject({ type: "avancement", statut: "prevue" });
      expect(jourSemaine(e.date_prevue)).toBe(1);
      expect(e.date_prevue >= depuis).toBe(true);
    }
    const total = echeances.reduce((s, e) => s + Number(e.montant), 0);
    const { avant, apres } = await honorairesAvantApres(cab, cab.missionForfait.id);
    expect(apres).toBeGreaterThan(avant);
    expect(total).toBe(apres - avant);
  });
});

describe("découpage modifié par un visiteur : mission sautée, incident du cabinet", () => {
  let cab: CabinetDemoTest;
  let ids: string[];
  let versions: number;
  let mois: string;
  let alertes: number;

  beforeAll(async () => {
    cab = await preparerCabinetDemo(ctx, "Prolongation C", { dateReference: DATE_REFERENCE });
    mois = await moisCible(cab);
    const { id, taches } = cab.missionRegie;
    const url = `/api/missions/${id}/taches/${taches.diagnostic}/budget`;
    const lignesBudget = [{ grade_id: cab.grades.junior, jours: 0.5 }];
    attendre(200, await cab.associe.put(url, { lignes: lignesBudget }), "budget modifié");
    versions = (await versionsDe(id)).length;
    alertes = incidentsDe("plus_aucune_mission_alimentable").length;
    ids = await prolonger(cab, mois);
  }, PREPARATION_MS);

  it("la régie n'est pas prolongée : ni révision, ni tâche, ni affectation", async () => {
    expect(ids).toEqual([]);
    expect(await versionsDe(cab.missionRegie.id)).toHaveLength(versions);
    expect(await tachesProlongation(cab.missionRegie.id, mois)).toEqual([]);
    expect(await affectationsProlongation(cab.cabinetId, mois)).toEqual([]);
  });

  it("les besoins restent sans socle : incident plus_aucune_mission_alimentable", () => {
    const nouveaux = incidentsDe("plus_aucune_mission_alimentable").slice(alertes);
    expect(nouveaux).toContainEqual(
      expect.objectContaining({
        contexte: "activite_demo_prolongation",
        cabinet_id: cab.cabinetId,
        mois,
      }),
    );
  });
});

describe("grade déjà sur-alloué : membre exclu de l'avenant", () => {
  let cab: CabinetDemoTest;
  let mois: string;
  let ids: string[];

  beforeAll(async () => {
    cab = await preparerCabinetDemo(ctx, "Prolongation D", { dateReference: DATE_REFERENCE });
    mois = await moisCible(cab);
    // Affectation HORS de la fenêtre du mois (le besoin du consultant reste entier) qui porte le
    // grade senior au-delà du budget figé : posée par le propriétaire, comme une donnée héritée.
    const jour = ajouterJours(fenetreDuMoisDemo(mois).debut, -7);
    await lignes(
      `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, jours_alloues,
         date_debut, date_fin)
       VALUES ($1, $2, $3, $4, 900, $5, $5)`,
      [
        cab.cabinetId,
        cab.missionRegie.id,
        cab.missionRegie.taches.diagnostic,
        cab.consultant.collaborateurId,
        jour,
      ],
    );
    ids = await prolonger(cab, mois);
  }, PREPARATION_MS);

  it("le consultant (senior sur-alloué) est écarté, le junior est prolongé seul", async () => {
    expect(ids).toEqual([cab.missionRegie.id]);
    const affectations = await affectationsProlongation(cab.cabinetId, mois);
    expect(affectations.map((a) => a.collaborateur_id)).toEqual([cab.junior.collaborateurId]);
    const taches = await tachesProlongation(cab.missionRegie.id, mois);
    expect(await gradesDeTache(taches[0]?.id)).toEqual(["junior"]);
  });

  it("incident sans contenu pour le membre écarté", () => {
    expect(incidentsDe("grade_sur_alloue")).toContainEqual(
      expect.objectContaining({
        contexte: "activite_demo_prolongation",
        mission_id: cab.missionRegie.id,
        collaborateur_id: cab.consultant.collaborateurId,
      }),
    );
  });
});

describe("36 avenants du job : mission sautée", () => {
  let cab: CabinetDemoTest;
  let mois: string;
  let ids: string[];
  let versions: number;

  /** Révision figée au motif du job, mêmes lignes que la référence (cohérence intacte). */
  async function avenantHerite(missionId: string, numero: number): Promise<void> {
    await proprietaire(async (cl) => {
      const ref = await cl.query(
        `SELECT id, devise FROM budget_versions WHERE mission_id = $1 AND figee
         ORDER BY numero DESC LIMIT 1`,
        [missionId],
      );
      const v = await cl.query(
        `INSERT INTO budget_versions (cabinet_id, mission_id, numero, type, devise, motif, cree_par)
         VALUES ($1, $2, $3, 'revise', $4, $5, $6) RETURNING id`,
        [
          cab.cabinetId,
          missionId,
          numero,
          ref.rows[0].devise,
          motifAvenantDemo("2025-01"),
          cab.chef.utilisateurId,
        ],
      );
      await cl.query(
        `INSERT INTO budget_lignes (cabinet_id, mission_id, version_id, cle, libelle, nature,
           grade_code, jours, prix_journalier, montant_forfait, refacturable, ordre)
         SELECT cabinet_id, mission_id, $2, cle, libelle, nature, grade_code, jours,
           prix_journalier, montant_forfait, refacturable, ordre
         FROM budget_lignes WHERE version_id = $1`,
        [ref.rows[0].id, v.rows[0].id],
      );
      await cl.query(
        `UPDATE budget_versions SET figee = true, date_figeage = $2, validee_par = $3,
           validee_le = now(), role_approbateur = 'directeur_mission'
         WHERE id = $1`,
        [v.rows[0].id, DATE_REFERENCE, cab.directeur.utilisateurId],
      );
    });
  }

  beforeAll(async () => {
    cab = await preparerCabinetDemo(ctx, "Prolongation E", { dateReference: DATE_REFERENCE });
    mois = await moisCible(cab);
    const premiere = (await versionsDe(cab.missionRegie.id)).length + 1;
    const max = PARAMETRES_ACTIVITE_DEMO.prolongation.avenantsMaxParMission;
    for (let i = 0; i < max; i++) await avenantHerite(cab.missionRegie.id, premiere + i);
    versions = (await versionsDe(cab.missionRegie.id)).length;
    ids = await prolonger(cab, mois);
  }, PREPARATION_MS);

  it("la régie, à 36 avenants du job, n'est plus prolongée", async () => {
    expect(ids).not.toContain(cab.missionRegie.id);
    expect(await versionsDe(cab.missionRegie.id)).toHaveLength(versions);
    expect(await tachesProlongation(cab.missionRegie.id, mois)).toEqual([]);
  });
});
