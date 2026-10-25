import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { semerTenantDemo, type ResumeTenantDemo } from "../src/db/tenant-demo/index.js";
import { MISSIONS } from "../src/db/tenant-demo/redressement-dd/commun.js";
import { semerRedressementDd } from "../src/db/tenant-demo/phases/redressement-dd.js";
import { creerBaseJetable, supprimerBaseJetable, type BaseJetable } from "./outils-base-jetable.js";
import {
  creerMissionsCasting,
  TABLES_PERIMETRE,
} from "./seed-tenant-demo-redressement-dd-outils.js";

/*
 * Phase « redressement-dd » du Tenant démo (preuves, redressement, due diligence, paramètres du
 * portail) dans une base JETABLE : socle, casting minimal des 11 missions (les missions 1 à 5 sont
 * ouvertes à l'écriture, comme dans le vrai semis), puis la phase, deux fois (idempotence). Dure
 * plusieurs minutes. Le déroulé avec la vraie phase « missions » se vérifie en ligne de commande
 * (`db:seed-tenant-demo --phase=missions --phase=redressement-dd`).
 */

let dossier: string;
let base: BaseJetable | undefined;
let cabinetId: string;
let premier: ResumeTenantDemo;
let second: ResumeTenantDemo;
let apresPremier: Record<string, number> = {};

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

async function comptages(): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of TABLES_PERIMETRE) {
    // Le nom vient de la liste figée ci-dessus (jamais d'une saisie).
    const rows = await lignes<{ n: string }>(`SELECT count(*) n FROM ${t} WHERE cabinet_id = $1`, [
      cabinetId,
    ]);
    r[t] = Number(rows[0]?.n);
  }
  return r;
}

const missionId = async (nom: string): Promise<string> => {
  const r = await lignes<{ id: string }>(
    "SELECT id FROM missions WHERE cabinet_id = $1 AND intitule = $2",
    [cabinetId, nom],
  );
  if (!r[0]) throw new Error(`Mission « ${nom} » absente`);
  return r[0].id;
};

beforeAll(async () => {
  dossier = await mkdtemp(path.join(os.tmpdir(), "mp-td4-"));
  base = await creerBaseJetable("td4", dossier);
  const phases = [
    { nom: "casting", executer: creerMissionsCasting },
    { nom: "redressement-dd", executer: semerRedressementDd },
  ];
  const options = { publique: false, journal: () => undefined, phases };
  premier = await semerTenantDemo(base.db, base.config, options);
  cabinetId = (await lignes<{ id: string }>("SELECT id FROM cabinets WHERE nom = 'Tenant démo'"))[0]
    ?.id as string;
  apresPremier = await comptages();
  second = await semerTenantDemo(base.db, base.config, options);
}, 3_000_000);

afterAll(async () => {
  await supprimerBaseJetable(base);
  await rm(dossier, { recursive: true, force: true });
}, 120_000);

describe("seed du Tenant démo : redressement, preuves, due diligence", () => {
  it("remplit les 44 tables du périmètre", () => {
    const vides = Object.entries(apresPremier)
      .filter(([, n]) => !(n > 0))
      .map(([t]) => t);
    expect(vides).toEqual([]);
    expect(Object.keys(apresPremier)).toHaveLength(TABLES_PERIMETRE.length);
  });

  it("idempotent : la seconde exécution saute la phase et ne duplique rien", async () => {
    expect(premier.phases.find((p) => p.nom === "redressement-dd")?.statut).toBe("executee");
    expect(second.phases.find((p) => p.nom === "redressement-dd")?.statut).toBe("deja_faite");
    expect(await comptages()).toEqual(apresPremier);
  });

  it("mission 3 : dossier de redressement clos, bilan et plan validés par le directeur de la mission", async () => {
    const m = await missionId(MISSIONS.redressementTermine);
    const d = await lignes<{ id: string; statut: string; directeur_id: string }>(
      `SELECT d.id, d.statut, m.directeur_id FROM red_dossiers d JOIN missions m ON m.id = d.mission_id
        WHERE d.mission_id = $1`,
      [m],
    );
    expect(d).toHaveLength(1);
    expect(d[0]?.statut).toBe("clos");
    const bilans = await lignes<{ valide_par: string | null; cree_par: string; statut: string }>(
      "SELECT valide_par, cree_par, statut FROM red_clotures WHERE dossier_id = $1",
      [d[0]?.id],
    );
    const valide = bilans.filter((b) => b.statut === "valide");
    expect(valide.length).toBeGreaterThan(0);
    for (const b of valide) {
      expect(b.valide_par).toBe(d[0]?.directeur_id);
      expect(b.valide_par).not.toBe(b.cree_par);
    }
    const plans = await lignes<{ valide_par: string | null; statut: string }>(
      "SELECT valide_par, statut FROM red_plan_versions WHERE dossier_id = $1",
      [d[0]?.id],
    );
    expect(plans.some((p) => p.statut === "valide")).toBe(true);
    for (const p of plans.filter((x) => x.statut === "valide")) {
      expect(p.valide_par).toBe(d[0]?.directeur_id);
    }
    const suivi = await lignes("SELECT 1 FROM red_suivi_jalons WHERE dossier_id = $1", [d[0]?.id]);
    expect(suivi.length).toBeGreaterThan(0);
  });

  it("mission 7 : dossier en mise en oeuvre, plan v1 validé par le directeur, v2 en brouillon, actions en retard", async () => {
    const m = await missionId(MISSIONS.redressementEnCours);
    const d = await lignes<{ id: string; statut: string; directeur_id: string }>(
      `SELECT d.id, d.statut, m.directeur_id FROM red_dossiers d JOIN missions m ON m.id = d.mission_id
        WHERE d.mission_id = $1`,
      [m],
    );
    expect(d).toHaveLength(1);
    expect(d[0]?.statut).toBe("mise_en_oeuvre");
    const plans = await lignes<{
      version: number;
      statut: string;
      valide_par: string | null;
      cree_par: string;
    }>(
      "SELECT version, statut, valide_par, cree_par FROM red_plan_versions WHERE dossier_id = $1 ORDER BY version",
      [d[0]?.id],
    );
    expect(plans[0]?.statut).toBe("valide");
    expect(plans[0]?.valide_par).toBe(d[0]?.directeur_id);
    expect(plans[0]?.valide_par).not.toBe(plans[0]?.cree_par);
    expect(plans.at(-1)?.statut).toBe("brouillon");
    const retard = await lignes(
      "SELECT 1 FROM red_actions WHERE dossier_id = $1 AND statut NOT IN ('terminee', 'abandonnee') AND echeance < '2026-10-24'",
      [d[0]?.id],
    );
    expect(retard.length).toBeGreaterThan(0);
    const statuts = await lignes<{ statut: string }>(
      "SELECT DISTINCT statut FROM red_actions WHERE dossier_id = $1",
      [d[0]?.id],
    );
    expect(statuts.map((x) => x.statut)).toEqual(expect.arrayContaining(["terminee", "en_cours"]));
    const clos = await lignes(
      "SELECT 1 FROM red_clotures WHERE dossier_id = $1 AND statut = 'valide'",
      [d[0]?.id],
    );
    expect(clos).toHaveLength(0);
  });

  it("devises : dossier, mission et états alignés (XAF mission 3, USD mission 7) et leviers chiffrés", async () => {
    for (const [nom, devise] of [
      [MISSIONS.redressementTermine, "XAF"],
      [MISSIONS.redressementEnCours, "USD"],
    ] as const) {
      const r = await lignes<{ md: string; dd: string; etats: string[]; leviers: string }>(
        `SELECT m.devise md, d.devise dd,
                (SELECT array_agg(DISTINCT e.devise) FROM dossier_etats_financiers e
                  WHERE e.client_id = m.client_id) etats,
                (SELECT count(*) FROM red_actions a
                  WHERE a.dossier_id = d.id AND a.levier_code IS NOT NULL AND a.impact IS NOT NULL) leviers
           FROM missions m JOIN red_dossiers d ON d.mission_id = m.id WHERE m.intitule = $1`,
        [nom],
      );
      expect(r[0]?.md, nom).toBe(devise);
      expect(r[0]?.dd, nom).toBe(devise);
      expect(r[0]?.etats, nom).toEqual([devise]);
      expect(Number(r[0]?.leviers), nom).toBeGreaterThan(0);
    }
  });

  it("unités mineures : USD en centimes (CA 2025 = 48 000 000 USD), XAF en francs entiers", async () => {
    const lire = async (nom: string, code: string) =>
      lignes<{ montant: string }>(
        `SELECT l.montant::text FROM dossier_etats_lignes l
           JOIN dossier_etats_financiers e ON e.id = l.etat_id
           JOIN missions m ON m.client_id = e.client_id
          WHERE m.intitule = $1 AND e.exercice = 2025 AND l.code = $2`,
        [nom, code],
      );
    const ca7 = await lire(MISSIONS.redressementEnCours, "XB");
    expect(ca7.map((x) => Number(x.montant))).toEqual([4_800_000_000]);
    const soldeInitial = await lignes<{ solde_initial: string }>(
      `SELECT v.solde_initial::text FROM red_tresorerie_versions v
         JOIN red_dossiers d ON d.id = v.dossier_id JOIN missions m ON m.id = d.mission_id
        WHERE m.intitule = $1 ORDER BY v.version LIMIT 1`,
      [MISSIONS.redressementEnCours],
    );
    // 380 M XOF des données = 1 900 000 USD = 190 000 000 centimes.
    expect(Number(soldeInitial[0]?.solde_initial)).toBe(190_000_000);
    const m3 = await lignes<{ solde_initial: string }>(
      `SELECT v.solde_initial::text FROM red_tresorerie_versions v
         JOIN red_dossiers d ON d.id = v.dossier_id JOIN missions m ON m.id = d.mission_id
        WHERE m.intitule = $1`,
      [MISSIONS.redressementTermine],
    );
    for (const x of m3) expect(Number.isInteger(Number(x.solde_initial))).toBe(true);
  });

  it("preuves : contradictions arbitrées par quelqu'un d'autre que l'auteur de l'assertion", async () => {
    const r = await lignes<{ n: string }>(
      `SELECT count(*) n FROM preuve_arbitrages b JOIN assertions a ON a.id = b.assertion_id
        WHERE b.arbitre_par = a.cree_par`,
    );
    expect(Number(r[0]?.n)).toBe(0);
    const missions = await lignes<{ intitule: string }>(
      `SELECT DISTINCT m.intitule FROM preuves p JOIN missions m ON m.id = p.mission_id
        WHERE p.cabinet_id = $1`,
      [cabinetId],
    );
    for (const nom of [
      MISSIONS.plan2025,
      MISSIONS.notation,
      MISSIONS.redressementTermine,
      MISSIONS.ddTerminee,
      MISSIONS.businessPlan,
    ]) {
      expect(missions.map((x) => x.intitule)).toContain(nom);
    }
  });

  it("due diligence mission 4 : verdicts et notes validés par un tiers, publiée au portail", async () => {
    const m = await missionId(MISSIONS.ddTerminee);
    const verdicts = await lignes<{ proposee_par: string; valide_par: string }>(
      `SELECT v.proposee_par, x.valide_par FROM dd_verdicts v
         JOIN dd_verdict_validations x ON x.verdict_id = v.id
         JOIN dd_dossiers d ON d.id = v.dossier_id WHERE d.mission_id = $1`,
      [m],
    );
    expect(verdicts.length).toBeGreaterThan(0);
    for (const v of verdicts) expect(v.valide_par).not.toBe(v.proposee_par);
    const notes = await lignes<{ cree_par: string; valide_par: string }>(
      `SELECT v.cree_par, x.valide_par FROM dd_note_validations x
         JOIN dd_note_versions v ON v.id = x.note_version_id
         JOIN dd_notes n ON n.id = v.note_id JOIN dd_dossiers d ON d.id = n.dossier_id
        WHERE d.mission_id = $1 AND x.decision = 'valide'`,
      [m],
    );
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.valide_par).not.toBe(n.cree_par);
    const pub = await lignes<{ pieces: string; retraits: string; invites: string }>(
      `SELECT (SELECT count(*) FROM dd_portail_pieces p WHERE p.publication_id = pu.id) pieces,
              (SELECT count(*) FROM dd_portail_publication_retraits r WHERE r.publication_id = pu.id) retraits,
              (SELECT count(*) FROM dd_portail_invites i WHERE i.dossier_id = pu.dossier_id) invites
         FROM dd_portail_publications pu JOIN dd_dossiers d ON d.id = pu.dossier_id
        WHERE d.mission_id = $1`,
      [m],
    );
    expect(pub.length).toBeGreaterThan(0);
    expect(pub.some((p) => Number(p.pieces) > 0)).toBe(true);
    expect(pub.some((p) => Number(p.retraits) > 0)).toBe(true);
    expect(pub.every((p) => Number(p.invites) > 0)).toBe(true);
  });

  it("due diligence mission 11 : dossier ouvert, notes en brouillon, aucune publication", async () => {
    const m = await missionId(MISSIONS.ddPreparation);
    const d = await lignes<{ id: string }>("SELECT id FROM dd_dossiers WHERE mission_id = $1", [m]);
    expect(d).toHaveLength(1);
    const etats = await lignes<{ etat: string }>(
      `SELECT v.etat FROM dd_note_versions v JOIN dd_notes n ON n.id = v.note_id WHERE n.dossier_id = $1`,
      [d[0]?.id],
    );
    expect(etats.length).toBeGreaterThan(0);
    expect(etats.every((e) => e.etat === "brouillon")).toBe(true);
    const pub = await lignes("SELECT 1 FROM dd_portail_publications WHERE dossier_id = $1", [
      d[0]?.id,
    ]);
    expect(pub).toHaveLength(0);
    const val = await lignes(
      `SELECT 1 FROM dd_verdict_validations x JOIN dd_verdicts v ON v.id = x.verdict_id WHERE v.dossier_id = $1`,
      [d[0]?.id],
    );
    expect(val).toHaveLength(0);
  });

  it("missions terminées : l'équipe n'a gardé aucun compte ajouté par la phase", async () => {
    const ajouts = await lignes<{ mission_id: string }>(
      `SELECT DISTINCT a.entite_id AS mission_id FROM journal_audit a
         JOIN mission_equipe e ON e.mission_id::text = a.entite_id::text
          AND e.utilisateur_id::text = a.details->>'utilisateur_id'
        WHERE a.cabinet_id = $1 AND a.action = 'semis_tenant_demo_equipe'`,
      [cabinetId],
    );
    const terminees = await lignes<{ id: string }>(
      "SELECT id FROM missions WHERE cabinet_id = $1 AND intitule = ANY($2)",
      [
        cabinetId,
        [
          MISSIONS.plan2025,
          MISSIONS.notation,
          MISSIONS.redressementTermine,
          MISSIONS.ddTerminee,
          MISSIONS.businessPlan,
        ],
      ],
    );
    const ids = terminees.map((t) => t.id);
    expect(ids).toHaveLength(5);
    expect(ajouts.filter((x) => ids.includes(x.mission_id))).toEqual([]);
  });

  it("DD Mboa (mission terminée) : plan des 100 jours achevé, tout daté avant la fin de la mission", async () => {
    const m = await missionId(MISSIONS.ddTerminee);
    const actions = await lignes<{ statut_action: string }>(
      `SELECT v.statut_action FROM dd_elements e
         JOIN dd_dossiers d ON d.id = e.dossier_id
         JOIN dd_element_versions v ON v.element_id = e.id
        WHERE d.mission_id = $1 AND e.type = 'action_100j'
          AND v.version = (SELECT max(x.version) FROM dd_element_versions x WHERE x.element_id = e.id)`,
      [m],
    );
    expect(actions).toHaveLength(5);
    expect(actions.every((x) => x.statut_action === "terminee")).toBe(true);
    // Rien n'est daté plus de 6 jours après la fin de la mission (2025-12-19).
    const apres = await lignes<{ t: string; n: string }>(
      `SELECT 'publications' t, count(*) n FROM dd_portail_publications p
         JOIN dd_dossiers d ON d.id = p.dossier_id WHERE d.mission_id = $1 AND p.cree_le > '2025-12-25'
       UNION ALL SELECT 'notes', count(*) FROM dd_note_versions v JOIN dd_notes n ON n.id = v.note_id
         JOIN dd_dossiers d ON d.id = n.dossier_id WHERE d.mission_id = $1 AND v.cree_le > '2025-12-25'
       UNION ALL SELECT 'elements', count(*) FROM dd_element_versions v JOIN dd_elements e ON e.id = v.element_id
         JOIN dd_dossiers d ON d.id = e.dossier_id WHERE d.mission_id = $1 AND v.cree_le > '2025-12-25'
       UNION ALL SELECT 'rapports', count(*) FROM rapports_mission r WHERE r.mission_id = $1 AND r.genere_le > '2025-12-25'`,
      [m],
    );
    expect(apres.filter((x) => Number(x.n) > 0)).toEqual([]);
  });

  it("redressement mission 3 : dates de référence et événements cohérents avec la période", async () => {
    const m = await missionId(MISSIONS.redressementTermine);
    const d = await lignes<{ id: string }>("SELECT id FROM red_dossiers WHERE mission_id = $1", [
      m,
    ]);
    const id = d[0]?.id;
    const refs = await lignes<{ t: string; ref: string }>(
      `SELECT 'score' t, date_reference::text ref FROM red_scores WHERE dossier_id = $1
       UNION ALL SELECT 'bilan', date_reference::text FROM red_clotures WHERE dossier_id = $1`,
      [id],
    );
    expect(refs.length).toBeGreaterThan(1);
    for (const r of refs) {
      expect(r.ref >= "2025-03-10" && r.ref <= "2025-11-20", `${r.t} ${r.ref}`).toBe(true);
    }
    const bilan = await lignes<{ contenu: { date_reference: string }; date_reference: string }>(
      "SELECT contenu, date_reference::text FROM red_clotures WHERE dossier_id = $1",
      [id],
    );
    for (const b of bilan) expect(b.contenu.date_reference).toBe(b.date_reference);
    // Aucune écriture du suivi après le plafond de la clôture fictive des missions (2026-09-14).
    const tard = await lignes(
      `SELECT 1 FROM red_suivi_releves WHERE dossier_id = $1 AND (cree_le > '2026-09-14' OR date_releve > '2026-09-14')`,
      [id],
    );
    expect(tard).toHaveLength(0);
  });

  it("aucune qualification juridique dans les libellés semés", async () => {
    const motif =
      "cessation|faillite|insolvab|liquidation judiciaire|banqueroute|d[ée]faillan|proc[ée]dure collective";
    for (const t of TABLES_PERIMETRE) {
      const r = await lignes<{ n: string }>(
        `SELECT count(*) n FROM ${t} x WHERE cabinet_id = $1 AND row_to_json(x)::text ~* $2`,
        [cabinetId, motif],
      );
      expect(Number(r[0]?.n), t).toBe(0);
    }
  });

  it("le portail n'a pas la double authentification obligatoire par défaut", async () => {
    const r = await lignes<{ tfa_obligatoire: boolean }>(
      "SELECT tfa_obligatoire FROM portail_parametres WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(r).toEqual([{ tfa_obligatoire: false }]);
  });
});
