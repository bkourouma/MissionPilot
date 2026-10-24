import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { semerTenantDemo, type ResumeTenantDemo } from "../src/db/tenant-demo/index.js";
import { CASTING } from "../src/db/tenant-demo/missions/donnees-casting.js";
import { OPPORTUNITES_COMPLEMENTAIRES } from "../src/db/tenant-demo/missions/donnees-pipeline.js";
import { cloturerMissionsTerminees } from "../src/db/tenant-demo/missions/cloture.js";
import { semerMissions } from "../src/db/tenant-demo/phases/missions.js";
import { creerBaseJetable, supprimerBaseJetable, type BaseJetable } from "./outils-base-jetable.js";

/* Phase « missions » du Tenant démo puis clôture différée, dans une base jetable (~7 min). */

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

const nombre = async (sql: string): Promise<number> =>
  Number((await lignes<{ n: string }>(sql, [cabinetId]))[0]?.n);

const TABLES =
  "missions opportunites propositions mission_jalons affectations mission_documents budget_versions".split(
    " ",
  );

const comptages = async (): Promise<Record<string, number>> => {
  const r: Record<string, number> = {};
  for (const t of TABLES) r[t] = await nombre(`SELECT count(*) n FROM ${t} WHERE cabinet_id = $1`);
  return r;
};

interface MissionLue {
  id: string;
  intitule: string;
  statut: string;
  client_id: string;
  date_debut: string;
  date_fin: string;
  date_signature: string | null;
  cloturee_le: string | null;
}

const lireMissions = (): Promise<MissionLue[]> =>
  lignes<MissionLue>(
    `SELECT id, intitule, statut, client_id, date_debut::text, date_fin::text,
            date_signature::text, cloturee_le::text
     FROM missions WHERE cabinet_id = $1 ORDER BY intitule`,
    [cabinetId],
  );

const SIGNEES = CASTING.filter((d) => d.signature);
const TERMINEES = CASTING.filter((d) => d.etat === "terminee");
const parNom = (liste: MissionLue[], nom: string): MissionLue => {
  const m = liste.find((x) => x.intitule === nom);
  if (!m) throw new Error(`Mission « ${nom} » absente`);
  return m;
};

let dossier: string;
let base: BaseJetable | undefined;
let cabinetId: string;
let premier: ResumeTenantDemo;
let second: ResumeTenantDemo;
let apresPremier: Record<string, number>;
let apresSecond: Record<string, number>;
let avantCloture: MissionLue[];
let apresCloture: MissionLue[];
let clotureAuditApres3 = 0,
  clotureAuditApres4 = 0;
let erreurCloture: unknown;

const compterClotures = (): Promise<number> =>
  nombre("SELECT count(*) n FROM journal_audit WHERE cabinet_id = $1 AND action = 'cloture'");

describe("seed du Tenant démo (phase missions)", () => {
  beforeAll(async () => {
    dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-td-missions-"));
    base = await creerBaseJetable("tdmissions", dossier);
    const silence = () => undefined;
    const lancer = (nom: string, executer: typeof semerMissions) =>
      semerTenantDemo(base!.db, base!.config, {
        publique: false,
        journal: silence,
        phases: [{ nom, executer }],
      });
    premier = await lancer("missions", semerMissions);
    cabinetId = premier.socle.cabinetId;
    apresPremier = await comptages();
    second = await lancer("missions-bis", semerMissions);
    apresSecond = await comptages();
    avantCloture = await lireMissions();
    try {
      await lancer("cloture", cloturerMissionsTerminees);
      clotureAuditApres3 = await compterClotures();
      apresCloture = await lireMissions();
      await lancer("cloture-bis", cloturerMissionsTerminees);
      clotureAuditApres4 = await compterClotures();
    } catch (e) {
      erreurCloture = e;
      apresCloture = await lireMissions();
    }
  }, 1_800_000);

  afterAll(async () => {
    await supprimerBaseJetable(base);
    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it("les 11 missions du casting existent une seule fois, avec leur client et leurs dates", () => {
    expect(avantCloture).toHaveLength(11);
    for (const d of CASTING) {
      const trouvees = avantCloture.filter((m) => m.intitule === d.nom);
      expect(trouvees, d.nom).toHaveLength(1);
      expect(trouvees[0]?.date_debut, `début de ${d.nom}`).toBe(d.debut);
      expect(trouvees[0]?.date_fin, `fin de ${d.nom}`).toBe(d.fin);
      expect(trouvees[0]?.client_id, `client de ${d.nom}`).toBeTruthy();
    }
    // Un client distinct par mission du casting.
    expect(new Set(CASTING.map((d) => d.client)).size).toBe(11);
    expect(new Set(avantCloture.map((m) => m.client_id)).size).toBe(11);
  });

  it("idempotent : une seconde exécution de la phase ne duplique rien", () => {
    expect(premier.phases).toEqual([{ nom: "missions", statut: "executee" }]);
    expect(second.phases).toEqual([{ nom: "missions-bis", statut: "executee" }]);
    expect(apresSecond).toEqual(apresPremier);
  });

  it("statuts avant clôture conformes à l'état visé", () => {
    for (const d of TERMINEES) expect(parNom(avantCloture, d.nom).statut, d.nom).toBe("a_cloturer");
    for (const d of CASTING.filter((x) => x.etat === "en_cours")) {
      expect(parNom(avantCloture, d.nom).statut, d.nom).toBe("en_cours");
    }
    expect(parNom(avantCloture, "Plan stratégique — Sicafe Export").statut).toBe("signee");
    const dd = parNom(avantCloture, "Due diligence — Wouri Distribution");
    expect(dd.statut).toBe("proposition");
    expect(dd.date_signature).toBeNull();
  });

  it("budget : version 1 initiale figée à la signature, révisions validées, non signée sans budget", async () => {
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
      if (d.debours.length > 0)
        expect(Number(v1?.debours), `débours de ${d.nom}`).toBeGreaterThan(0);
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
  });

  it("jours alloués aux affectations <= jours du budget honoraires (dernière version figée)", async () => {
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
  });

  it("jalons : terminées entièrement franchies, aucun jalon franchi dans le futur, des jalons à venir", async () => {
    for (const d of TERMINEES) {
      const m = parNom(avantCloture, d.nom);
      const j = await lignes<{ total: string; atteints: string }>(
        "SELECT count(*) total, count(*) FILTER (WHERE atteint) atteints FROM mission_jalons WHERE mission_id = $1",
        [m.id],
      );
      expect(Number(j[0]?.total), `jalons de ${d.nom}`).toBeGreaterThan(0);
      expect(j[0]?.atteints, d.nom).toBe(j[0]?.total);
    }
    expect(
      await nombre(
        "SELECT count(*) n FROM mission_jalons WHERE cabinet_id = $1 AND atteint AND date_prevue > '2026-10-22'",
      ),
    ).toBe(0);
    expect(
      await nombre(
        `SELECT count(*) n FROM mission_jalons j JOIN missions m ON m.id = j.mission_id
         WHERE j.cabinet_id = $1 AND NOT j.atteint AND m.statut = 'en_cours'`,
      ),
    ).toBeGreaterThan(0);
  });

  it("pipeline : opportunité gagnée, proposition acceptée validée par un autre ou un associé", async () => {
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
  });

  it("antidatage : historique étalé, rien dans le futur", async () => {
    const sicafe = await lignes<{ avant: boolean }>(
      "SELECT cree_le < '2024-11-01' AS avant FROM missions WHERE cabinet_id = $1 AND intitule = $2",
      [cabinetId, CASTING[0]?.nom],
    );
    expect(sicafe[0]?.avant).toBe(true);
    for (const t of ["missions", "opportunites", "propositions"]) {
      expect(
        await nombre(
          `SELECT count(*) n FROM ${t} WHERE cabinet_id = $1 AND cree_le > '2026-10-24'`,
        ),
        t,
      ).toBe(0);
    }
    expect(
      await nombre(
        "SELECT count(*) n FROM missions WHERE cabinet_id = $1 AND date_signature > '2026-10-24'",
      ),
    ).toBe(0);
    expect(
      await nombre(
        "SELECT count(*) n FROM journal_audit WHERE cabinet_id = $1 AND cree_le < '2026-01-01'",
      ),
    ).toBeGreaterThan(0);
  });

  it("livrables validés avec séparation des tâches, lettre de mission pour chaque mission signée", async () => {
    expect(
      await nombre(
        `SELECT count(*) n FROM mission_documents
         WHERE cabinet_id = $1 AND type = 'livrable' AND statut_contenu = 'valide'
           AND valide_par IS DISTINCT FROM auteur_id AND valide_par IS DISTINCT FROM contenu_modifie_par`,
      ),
    ).toBeGreaterThan(0);
    for (const d of SIGNEES) {
      const m = parNom(avantCloture, d.nom);
      const n = await lignes<{ n: string }>(
        "SELECT count(*) n FROM mission_documents WHERE mission_id = $1 AND type = 'lettre_de_mission'",
        [m.id],
      );
      expect(Number(n[0]?.n), `lettre de mission de ${d.nom}`).toBeGreaterThan(0);
    }
  });

  it("dépendances, satisfaction et vérifications de clôture des missions terminées", async () => {
    expect(
      await nombre("SELECT count(*) n FROM mission_dependances WHERE cabinet_id = $1"),
    ).toBeGreaterThan(0);
    for (const d of TERMINEES) {
      const id = parNom(avantCloture, d.nom).id;
      const s = await lignes<{ n: string }>(
        "SELECT count(*) n FROM qualite_satisfactions WHERE mission_id = $1 AND moment = 'cloture'",
        [id],
      );
      expect(Number(s[0]?.n), `satisfaction de ${d.nom}`).toBeGreaterThan(0);
      const v = await lignes<{ n: string }>(
        "SELECT count(*) n FROM cloture_verifications WHERE mission_id = $1",
        [id],
      );
      expect(Number(v[0]?.n), `vérifications de ${d.nom}`).toBeGreaterThan(0);
    }
  });

  it("clôture : les 5 terminées sont clôturées avec leur bilan, les 6 autres non, et c'est idempotent", async () => {
    expect(erreurCloture, "la clôture des missions terminées doit aboutir").toBeUndefined();
    for (const d of CASTING) {
      const m = parNom(apresCloture, d.nom);
      if (d.etat === "terminee") {
        expect(m.statut, d.nom).toBe("cloturee");
        const date = (m.cloturee_le ?? "").slice(0, 10);
        expect(date >= d.fin && date <= "2026-10-24", `${d.nom} clôturée le ${m.cloturee_le}`).toBe(
          true,
        );
      } else {
        expect(m.statut, d.nom).not.toBe("cloturee");
        expect(m.cloturee_le, d.nom).toBeNull();
      }
    }
    expect(await nombre("SELECT count(*) n FROM bilans_mission WHERE cabinet_id = $1")).toBe(5);
    expect(clotureAuditApres3).toBeGreaterThan(0);
    expect(clotureAuditApres4).toBe(clotureAuditApres3);
    expect(await lireMissions()).toEqual(apresCloture);
  });

  it("pipeline complémentaire : perdues motivées, ouvertes à chaque étape, propositions cohérentes", async () => {
    const attendu = CASTING.length + OPPORTUNITES_COMPLEMENTAIRES.length;
    expect(await nombre("SELECT count(*) n FROM opportunites WHERE cabinet_id = $1")).toBe(attendu);
    const perdues = OPPORTUNITES_COMPLEMENTAIRES.filter((o) => o.perdue);
    const lues = await lignes<{ n: string }>(
      `SELECT count(*) n FROM opportunites WHERE cabinet_id = $1 AND statut = 'perdue'
         AND length(motif_perte) > 10 AND cloturee_le::date >= cree_le::date`,
      [cabinetId],
    );
    expect(Number(lues[0]?.n)).toBe(perdues.length);
    const ouvertes = await lignes<{ etape: string }>(
      "SELECT DISTINCT etape FROM opportunites WHERE cabinet_id = $1 AND statut = 'ouverte' ORDER BY etape",
      [cabinetId],
    );
    expect(ouvertes.map((e) => e.etape)).toEqual([
      "negociation",
      "proposition",
      "prospection",
      "qualification",
    ]);
    // Une proposition refusée appartient à une opportunité perdue ; elle a été validée avant d'être envoyée.
    const refusees = await lignes<{ n: string }>(
      `SELECT count(*) n FROM propositions p JOIN opportunites o ON o.id = p.opportunite_id
         WHERE p.cabinet_id = $1 AND p.statut = 'refusee' AND o.statut = 'perdue'
           AND p.validee_le <= p.envoyee_le AND p.envoyee_le <= p.repondue_le`,
      [cabinetId],
    );
    expect(Number(refusees[0]?.n)).toBe(
      OPPORTUNITES_COMPLEMENTAIRES.filter((o) => o.proposition === "refusee").length,
    );
    expect(
      await nombre(
        "SELECT count(*) n FROM opportunites WHERE cabinet_id = $1 AND cree_le > '2026-10-24'",
      ),
    ).toBe(0);
  });

  it("les tables concernées ne sont plus vides", async () => {
    const tables =
      "mission_dependances mission_jalons affectations mission_documents budget_versions budget_lignes mission_equipe opportunites propositions bilans_mission qualite_satisfactions";
    for (const t of tables.split(" ")) {
      expect(await nombre(`SELECT count(*) n FROM ${t} WHERE cabinet_id = $1`), t).toBeGreaterThan(
        0,
      );
    }
  });
});
