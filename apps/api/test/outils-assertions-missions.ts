import { expect } from "vitest";
import { CLIENTS } from "../src/db/tenant-demo/donnees-clients.js";
import { TAUX_VENTE_GRADE } from "../src/db/tenant-demo/donnees-equipe.js";
import { CASTING } from "../src/db/tenant-demo/missions/donnees-casting.js";

/* Assertions de la phase « missions » (budget, jours alloués, pipeline), partagées avec le test de semis. */

export interface MissionLue {
  id: string;
  intitule: string;
  statut: string;
  client_id: string;
  date_debut: string;
  date_fin: string;
  date_signature: string | null;
  cloturee_le: string | null;
}

export type Lire = <T = Record<string, unknown>>(sql: string, p?: unknown[]) => Promise<T[]>;

export const SIGNEES = CASTING.filter((d) => d.signature);
export const TERMINEES = CASTING.filter((d) => d.etat === "terminee");

export const parNom = (liste: MissionLue[], nom: string): MissionLue => {
  const m = liste.find((x) => x.intitule === nom);
  if (!m) throw new Error(`Mission « ${nom} » absente`);
  return m;
};

export async function verifierBudget(
  lignes: Lire,
  cabinetId: string,
  avantCloture: MissionLue[],
): Promise<void> {
  const versions = await lignes<{
    mission_id: string;
    numero: number;
    type: string;
    figee: boolean;
    date_figeage: string | null;
    validee_par: string | null;
    cree_par: string | null;
    validateur_associe: boolean | null;
    honoraires: string;
    debours: string;
  }>(
    `SELECT v.mission_id, v.numero, v.type, v.figee, v.date_figeage::text, v.validee_par, v.cree_par,
              (SELECT 'associe' = ANY(u.roles) FROM utilisateurs u WHERE u.id = v.validee_par) AS validateur_associe,
              (SELECT count(*) FROM budget_lignes l WHERE l.version_id = v.id AND l.nature = 'honoraires') AS honoraires,
              (SELECT count(*) FROM budget_lignes l WHERE l.version_id = v.id AND l.nature = 'debours') AS debours
       FROM budget_versions v WHERE v.cabinet_id = $1`,
    [cabinetId],
  );
  expect(SIGNEES).toHaveLength(10);
  for (const d of SIGNEES) {
    const m = parNom(avantCloture, d.nom);
    const v1 = versions.find((v) => v.mission_id === m.id && v.numero === 1);
    expect(v1, `version 1 de ${d.nom}`).toMatchObject({ type: "initial", figee: true });
    expect(v1?.date_figeage, d.nom).toBe(m.date_signature);
    expect(Number(v1?.honoraires), `honoraires de ${d.nom}`).toBeGreaterThan(0);
    // Les missions sans débours dans le casting (Teranga) n'ont pas de ligne de débours.
    if (d.debours.length > 0) expect(Number(v1?.debours), `débours de ${d.nom}`).toBeGreaterThan(0);
    const v2 = versions.find((v) => v.mission_id === m.id && v.numero === 2);
    if (d.revision) {
      expect(v2, `révision de ${d.nom}`).toMatchObject({ type: "revise", figee: true });
      expect(v2?.validee_par, d.nom).not.toBeNull();
      expect(v2?.validee_par !== v2?.cree_par || v2?.validateur_associe, d.nom).toBe(true);
    } else {
      expect(v2, `pas de révision pour ${d.nom}`).toBeUndefined();
    }
  }
  const nonSignee = parNom(avantCloture, "Due diligence — Wouri Distribution");
  expect(versions.filter((v) => v.mission_id === nonSignee.id)).toHaveLength(0);
}

export async function verifierJoursAlloues(lignes: Lire, cabinetId: string): Promise<void> {
  const r = await lignes<{ intitule: string; alloues: string; budget: string }>(
    `SELECT m.intitule,
              coalesce((SELECT sum(a.jours_alloues) FROM affectations a WHERE a.mission_id = m.id), 0) AS alloues,
              coalesce((SELECT sum(l.jours) FROM budget_lignes l
                         WHERE l.nature = 'honoraires'
                           AND l.version_id = (SELECT v.id FROM budget_versions v
                                                WHERE v.mission_id = m.id AND v.figee
                                                ORDER BY v.numero DESC LIMIT 1)), 0) AS budget
       FROM missions m WHERE m.cabinet_id = $1 AND m.date_signature IS NOT NULL`,
    [cabinetId],
  );
  expect(r).toHaveLength(10);
  for (const x of r) {
    expect(Number(x.budget), `budget de ${x.intitule}`).toBeGreaterThan(0);
    expect(Number(x.alloues), x.intitule).toBeLessThanOrEqual(Number(x.budget));
  }
}

export async function verifierPipelineGagne(lignes: Lire, cabinetId: string): Promise<void> {
  const r = await lignes<{
    intitule: string;
    type_mission_id: string | null;
    ostatut: string | null;
    pstatut: string | null;
    valide_ok: boolean | null;
  }>(
    `SELECT m.intitule, m.type_mission_id, o.statut AS ostatut, p.statut AS pstatut,
              (p.validee_par <> p.cree_par
               OR EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = p.validee_par AND 'associe' = ANY(u.roles))) AS valide_ok
       FROM missions m
       LEFT JOIN opportunites o ON o.id = m.opportunite_id
       LEFT JOIN propositions p ON p.id = m.proposition_id
       WHERE m.cabinet_id = $1`,
    [cabinetId],
  );
  expect(r).toHaveLength(11);
  for (const x of r) {
    expect(x.type_mission_id, x.intitule).not.toBeNull();
    expect(x.ostatut, x.intitule).toBe("gagnee");
    expect(x.pstatut, x.intitule).toBe("acceptee");
    expect(x.valide_ok, x.intitule).toBe(true);
  }
  await verifierDevises(lignes, cabinetId);
  await verifierEchelleMontants(lignes, cabinetId);
}

/** Devise de chaque mission, de sa proposition, de son opportunité et de son budget = devise du client (socle). */
const XOF_PAR_UNITE: Record<string, number> = { XOF: 1, XAF: 1, EUR: 655.957, USD: 600 };
const FACTEUR_MINEUR: Record<string, number> = { XOF: 1, XAF: 1, EUR: 100, USD: 100 };

/**
 * Montants en unités mineures : pour chaque mission, le prix journalier moyen pondéré des
 * honoraires (équivalent XOF au taux fictif) est du même ordre de grandeur (écart < 2x) que celui
 * des missions XOF/XAF ; les honoraires des missions EUR/USD restent proches de jours x barème.
 */
async function verifierEchelleMontants(lignes: Lire, cabinetId: string): Promise<void> {
  const r = await lignes<{ intitule: string; devise: string; prix: string; honoraires: string }>(
    `SELECT m.intitule, m.devise,
            sum(l.jours * l.prix_journalier) / nullif(sum(l.jours), 0) AS prix,
            sum(l.jours * l.prix_journalier) AS honoraires
       FROM missions m JOIN budget_versions v ON v.mission_id = m.id AND v.numero = 1
       JOIN budget_lignes l ON l.version_id = v.id AND l.nature = 'honoraires'
      WHERE m.cabinet_id = $1 GROUP BY m.intitule, m.devise`,
    [cabinetId],
  );
  const xof = (x: { devise: string; prix: string }): number =>
    (Number(x.prix) / (FACTEUR_MINEUR[x.devise] ?? 1)) * (XOF_PAR_UNITE[x.devise] ?? 1);
  const reference = r.filter((x) => x.devise === "XOF" || x.devise === "XAF").map(xof);
  const moyenne = reference.reduce((a, b) => a + b, 0) / reference.length;
  for (const x of r.filter((y) => y.devise === "EUR" || y.devise === "USD")) {
    expect(xof(x) / moyenne, `prix journalier de ${x.intitule}`).toBeGreaterThan(0.5);
    expect(xof(x) / moyenne, `prix journalier de ${x.intitule}`).toBeLessThan(2);
  }
  // Honoraires budgétés (équivalent XOF) = jours x barème du cabinet, à un facteur 2 près (taux négociés).
  for (const x of r.filter((y) => y.devise === "EUR" || y.devise === "USD")) {
    const jours = await lignes<{ grade_code: string; jours: string }>(
      `SELECT l.grade_code, sum(l.jours) AS jours FROM budget_lignes l
         JOIN budget_versions v ON v.id = l.version_id AND v.numero = 1
         JOIN missions m ON m.id = v.mission_id
        WHERE m.cabinet_id = $1 AND m.intitule = $2 AND l.nature = 'honoraires' GROUP BY 1`,
      [cabinetId, x.intitule],
    );
    const bareme = jours.reduce(
      (s, g) => s + Number(g.jours) * (TAUX_VENTE_GRADE[g.grade_code] ?? 0),
      0,
    );
    const honoraires = (Number(x.honoraires) / 100) * (XOF_PAR_UNITE[x.devise] ?? 1);
    expect(honoraires / bareme, `honoraires de ${x.intitule}`).toBeGreaterThan(0.5);
    expect(honoraires / bareme, `honoraires de ${x.intitule}`).toBeLessThan(2);
  }
}

async function verifierDevises(lignes: Lire, cabinetId: string): Promise<void> {
  const r = await lignes<{
    intitule: string;
    client: string;
    mission: string;
    proposition: string;
    opportunite: string;
    budgets: string[] | null;
  }>(
    `SELECT m.intitule, c.raison_sociale AS client, m.devise AS mission, p.devise AS proposition,
            o.devise AS opportunite,
            (SELECT array_agg(DISTINCT v.devise) FROM budget_versions v WHERE v.mission_id = m.id) AS budgets
       FROM missions m JOIN clients c ON c.id = m.client_id
       JOIN propositions p ON p.id = m.proposition_id JOIN opportunites o ON o.id = m.opportunite_id
      WHERE m.cabinet_id = $1`,
    [cabinetId],
  );
  expect(r).toHaveLength(CASTING.length);
  for (const d of CASTING) {
    const mission = r.find((x) => x.intitule === d.nom);
    const attendue = CLIENTS.find((c) => c.cle === d.client)?.devise;
    expect(attendue, `client de ${d.nom}`).toBeDefined();
    expect(mission?.client, d.nom).toBe(CLIENTS.find((c) => c.cle === d.client)?.raison_sociale);
    expect([mission?.mission, mission?.proposition, mission?.opportunite], d.nom).toEqual([
      attendue,
      attendue,
      attendue,
    ]);
    if (mission?.budgets) expect(mission.budgets, d.nom).toEqual([attendue]);
  }
}

/** 5 bilans archivés ; au moins deux clôtureurs différents, et chacun étant l associé de l équipe de sa mission. */
/** Un jalon tardif (écriture métier postérieure à fin + 6 jours) à ajouter avant la clôture de la mission. */
export const JALON_TARDIF = { mission: "Due diligence — Mboa Solaire", date: "2026-02-10" };

export async function ajouterJalonTardif(lignes: Lire): Promise<void> {
  await lignes(
    `UPDATE mission_jalons SET date_prevue = $2 WHERE id = (
       SELECT j.id FROM mission_jalons j JOIN missions m ON m.id = j.mission_id
        WHERE m.intitule = $1 ORDER BY j.id LIMIT 1)`,
    [JALON_TARDIF.mission, JALON_TARDIF.date],
  );
}

/** 5 bilans ; au moins deux clôtureurs ; aucune écriture métier postérieure à la clôture fictive. */
export async function verifierBilansEtCloturants(lignes: Lire, cabinetId: string): Promise<void> {
  const bilans = await lignes<{ n: string }>(
    "SELECT count(*) n FROM bilans_mission WHERE cabinet_id = $1",
    [cabinetId],
  );
  expect(Number(bilans[0]?.n)).toBe(5);
  const c = await lignes<{ n: string }>(
    "SELECT count(DISTINCT cloturee_par) n FROM missions WHERE cabinet_id = $1 AND statut = 'cloturee'",
    [cabinetId],
  );
  expect(Number(c[0]?.n), "clôtureurs différents").toBeGreaterThanOrEqual(2);
  const apres = await lignes<{ intitule: string }>(
    `SELECT m.intitule FROM missions m WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND (
       EXISTS (SELECT 1 FROM factures f WHERE f.mission_id = m.id AND f.date_emission > m.cloturee_le::date)
       OR EXISTS (SELECT 1 FROM rapports_mission r WHERE r.mission_id = m.id AND r.genere_le > m.cloturee_le)
       OR EXISTS (SELECT 1 FROM lignes_temps l WHERE l.mission_id = m.id AND l.date > m.cloturee_le::date)
       OR EXISTS (SELECT 1 FROM mission_jalons j WHERE j.mission_id = m.id AND j.date_prevue > m.cloturee_le::date)
       OR EXISTS (SELECT 1 FROM mission_documents d WHERE d.mission_id = m.id AND d.cree_le > m.cloturee_le))`,
    [cabinetId],
  );
  expect(apres, "écritures datées après la clôture").toEqual([]);
  const tardive = await lignes<{ ok: boolean }>(
    "SELECT cloturee_le::date > $2::date AS ok FROM missions WHERE cabinet_id = $1 AND intitule = $3",
    [cabinetId, JALON_TARDIF.date, JALON_TARDIF.mission],
  );
  expect(tardive[0]?.ok, "clôture de Mboa après le jalon tardif").toBe(true);
}
