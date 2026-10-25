import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appliquerSeuil } from "../src/plans/ateliers-resultats.js";
import { semerTenantDemo } from "../src/db/tenant-demo/index.js";
import { CASTING } from "../src/db/tenant-demo/notation-plans/casting.js";
import { semerMissions } from "../src/db/tenant-demo/phases/missions.js";
import { semerNotationPlans } from "../src/db/tenant-demo/phases/notation-plans.js";
import { creerBaseJetable, supprimerBaseJetable, type BaseJetable } from "./outils-base-jetable.js";

/*
 * Phase « notation-plans » du Tenant démo (lot 3) : questionnaires, notation, KPI et plans
 * stratégiques, dans une base JETABLE (socle + phase « missions » + notre phase, quelques
 * minutes). La phase est rejouée sous un autre nom pour prouver qu'elle reprend sans doublon.
 */

/** Tables du périmètre (inventaire « lot 2 » : notation, plans, KPI, questionnaires). */
const TABLES = `
  questionnaire_modeles questionnaire_versions questionnaire_envois questionnaire_repondants
  questionnaire_reponses questionnaire_relances questionnaire_ia_historique
  notation_grilles notation_grille_versions notation_banque_items notation_selections
  notation_selection_items notation_parametres notation_calibrations notation_calibration_cotations
  notation_initiatives_types notation_initiatives_impacts notations notation_versions
  notation_ajustements notation_evenements notation_confiances notation_plans_action
  notation_versions_methode
  kpi_definitions kpi_cibles kpi_mesures kpi_alertes kpi_parametres kpi_rappels kpi_arbres
  kpi_arbre_noeuds kpi_revues kpi_revue_decisions kpi_revue_decision_evenements kpi_actions
  kpi_action_evenements
  plans_strategiques plan_elements plan_element_versions plan_modele_versions
  plan_modele_validations plan_diagnostic_notations plan_objectif_kpis plan_cascade_noeuds
  plan_cascade_versions plan_porteurs plan_initiatives_origines initiative_type_observations
  plan_portefeuille_arbitrages plan_portefeuille_evaluations plan_ateliers plan_atelier_options
  plan_atelier_participants plan_atelier_contributions plan_atelier_contribution_lignes
  plan_simulations_montecarlo plan_rejeux_montecarlo plan_reprevisions plan_realises
`
  .split(/\s+/)
  .filter(Boolean);

let dossier: string;
let base: BaseJetable | undefined;
let cabinetId: string;
let apres1: Record<string, number>;
let apres2: Record<string, number>;

async function lignes<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({
    connectionString: (base as BaseJetable).config.DATABASE_OWNER_URL,
  });
  await client.connect();
  try {
    return (await client.query(sql, p)).rows as T[];
  } finally {
    await client.end();
  }
}

async function comptes(): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = await lignes<{ n: string }>(`SELECT count(*) n FROM ${t} WHERE cabinet_id = $1`, [
      cabinetId,
    ]);
    r[t] = Number(rows[0]?.n);
  }
  return r;
}

const phases = (nomNotationPlans: string) =>
  [
    { nom: "missions", executer: semerMissions },
    { nom: nomNotationPlans, executer: semerNotationPlans },
  ] as const;

beforeAll(async () => {
  dossier = await mkdtemp(path.join(os.tmpdir(), "td-np-"));
  base = await creerBaseJetable("td_np", dossier);
  const options = { publique: false, journal: () => undefined };
  await semerTenantDemo(base.db, base.config, { ...options, phases: phases("notation-plans") });
  cabinetId = (
    await lignes<{ id: string }>("SELECT id FROM cabinets WHERE nom = 'Tenant démo'")
  )[0]!.id;
  apres1 = await comptes();
  // Rejeu sous un autre nom : la phase est exécutée à nouveau en entier.
  await semerTenantDemo(base.db, base.config, {
    ...options,
    phases: phases("notation-plans-rejeu"),
  });
  apres2 = await comptes();
}, 3_600_000);

afterAll(async () => {
  await supprimerBaseJetable(base);
  if (dossier) await rm(dossier, { recursive: true, force: true });
}, 120_000);

describe("phase notation-plans du Tenant démo", () => {
  it("remplit toutes les tables du périmètre", () => {
    const vides = TABLES.filter((t) => !apres1[t]);
    expect(vides).toEqual([]);
  });

  it("se rejoue sans doublon", () => {
    expect(apres2).toEqual(apres1);
  });

  it("publie une note par un expert métier distinct de ceux qui l'ont calculée, ajustée et soumise", async () => {
    const pub = await lignes<{ version_id: string; par: string; roles: string[] }>(
      `SELECT e.version_id, e.par, u.roles
         FROM notation_evenements e JOIN utilisateurs u ON u.id = e.par
        WHERE e.cabinet_id = $1 AND e.action = 'publication'`,
      [cabinetId],
    );
    expect(pub.length).toBeGreaterThanOrEqual(1);
    for (const p of pub) {
      expect(p.roles).toContain("expert_metier");
      const autres = await lignes<{ id: string }>(
        `SELECT calcule_par AS id FROM notation_versions WHERE id = $1
         UNION SELECT auteur_id FROM notation_ajustements WHERE version_id = $1
         UNION SELECT par FROM notation_evenements WHERE version_id = $1 AND action = 'soumission'`,
        [p.version_id],
      );
      expect(autres.map((a) => a.id)).not.toContain(p.par);
    }
    const mission = await lignes<{ intitule: string }>(
      `SELECT m.intitule FROM notation_evenements e
         JOIN notation_versions v ON v.id = e.version_id
         JOIN notations n ON n.id = v.notation_id JOIN missions m ON m.id = n.mission_id
        WHERE e.action = 'publication' AND e.cabinet_id = $1`,
      [cabinetId],
    );
    expect(mission.map((m) => m.intitule)).toContain(CASTING.sahelCoton.intitule);
  });

  it("n'écrit aucune mesure de KPI datée dans le futur", async () => {
    const futur = await lignes<{ n: string }>(
      "SELECT count(*) n FROM kpi_mesures WHERE cabinet_id = $1 AND date_mesure > '2026-10-24'",
      [cabinetId],
    );
    expect(Number(futur[0]?.n)).toBe(0);
    const mois = await lignes<{ n: string }>(
      `SELECT count(DISTINCT date_trunc('month', date_mesure)) n FROM kpi_mesures WHERE cabinet_id = $1`,
      [cabinetId],
    );
    expect(Number(mois[0]?.n)).toBeGreaterThanOrEqual(15);
  });
  it("valide le plan de la mission terminée par une personne habilitée et laisse le plan en cours en brouillon", async () => {
    const etat = async (mission: string) =>
      lignes<{ statut_contenu: string; roles: string[]; directeur: boolean }>(
        `SELECT v.statut_contenu, u.roles, (u.id = m.directeur_id) AS directeur
           FROM plans_strategiques p
           JOIN missions m ON m.id = p.mission_id
           JOIN plan_elements e ON e.plan_id = p.id
           JOIN LATERAL (SELECT * FROM plan_element_versions w WHERE w.element_id = e.id
                          ORDER BY w.version DESC LIMIT 1) v ON true
           JOIN utilisateurs u ON u.id = v.auteur_id
          WHERE p.cabinet_id = $1 AND m.intitule = $2 AND NOT v.retire`,
        [cabinetId, mission],
      );
    const termine = await etat(CASTING.sicafe.intitule);
    expect(termine.length).toBeGreaterThan(10);
    for (const l of termine) {
      expect(l.statut_contenu).toBe("valide");
      expect(l.directeur || l.roles.includes("associe")).toBe(true);
    }
    const enCours = await etat(CASTING.baobab.intitule);
    expect(enCours.some((l) => l.statut_contenu !== "valide")).toBe(true);
  });

  it("relie les plans à des notations publiées du même client", async () => {
    const liens = await lignes<{ n: string }>(
      `SELECT count(*) n FROM plan_diagnostic_notations d
         JOIN plans_strategiques p ON p.id = d.plan_id
         JOIN missions pm ON pm.id = p.mission_id
         JOIN notation_versions nv ON nv.id = d.notation_version_id
         JOIN notations n ON n.id = nv.notation_id
         JOIN missions nm ON nm.id = n.mission_id
        WHERE d.cabinet_id = $1 AND pm.client_id = nm.client_id`,
      [cabinetId],
    );
    expect(Number(liens[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("ne publie les agrégats d'un atelier clos qu'avec au moins 3 contributeurs PAR MÉTHODE", async () => {
    const clos = await lignes<{ id: string; resultats: Record<string, unknown> }>(
      `SELECT id, resultats FROM plan_ateliers
        WHERE cabinet_id = $1 AND statut = 'clos' AND resultats IS NOT NULL`,
      [cabinetId],
    );
    expect(clos.length).toBeGreaterThanOrEqual(1);
    let atelierAvecAgregat = 0;
    for (const a of clos) {
      const parMethode = await lignes<{ methode: string; n: string }>(
        `SELECT methode, count(DISTINCT utilisateur_id) n FROM plan_atelier_contributions
          WHERE atelier_id = $1 GROUP BY methode`,
        [a.id],
      );
      const effectif = new Map(parMethode.map((m) => [m.methode, Number(m.n)]));
      const { visibles } = appliquerSeuil(a.resultats);
      for (const m of visibles) expect(effectif.get(m) ?? 0).toBeGreaterThanOrEqual(3);
      if (visibles.length > 0) atelierAvecAgregat++;
    }
    expect(atelierAvecAgregat).toBeGreaterThanOrEqual(1);
  });

  it("reste sous la borne de comptes de la connexion en un clic, sans 2FA sur le portail", async () => {
    const total = await lignes<{ n: string }>(
      "SELECT count(*) n FROM utilisateurs WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(Number(total[0]?.n)).toBeLessThanOrEqual(45);
    const tfa = await lignes<{ n: string }>(
      `SELECT count(*) n FROM utilisateurs_2fa f
         JOIN utilisateurs_portail p ON p.utilisateur_id = f.utilisateur_id
        WHERE f.cabinet_id = $1`,
      [cabinetId],
    );
    expect(Number(tfa[0]?.n)).toBe(0);
  });

  it("borne les mesures KPI de chaque mission entre un mois avant son début et sa fin", async () => {
    const hors = await lignes<{ intitule: string; n: string }>(
      `SELECT m.intitule, count(*) n
         FROM kpi_mesures k
         JOIN kpi_definitions d ON d.id = k.kpi_id
         JOIN missions m ON m.id = d.mission_id
        WHERE k.cabinet_id = $1
          AND (k.date_mesure < (date_trunc('month', m.date_debut) - interval '1 month')::date
               OR k.date_mesure > LEAST(COALESCE(m.date_fin, '2026-09-30'::date), '2026-09-30'::date))
        GROUP BY m.intitule`,
      [cabinetId],
    );
    expect(hors).toEqual([]);
    const avantDemarrage = await lignes<{ n: string }>(
      `SELECT count(*) n FROM kpi_mesures k
         JOIN kpi_definitions d ON d.id = k.kpi_id
         JOIN missions m ON m.id = d.mission_id
        WHERE k.cabinet_id = $1 AND m.intitule = $2`,
      [cabinetId, CASTING.sicafeExport.intitule],
    );
    expect(Number(avantDemarrage[0]?.n)).toBe(0);
  });
});
