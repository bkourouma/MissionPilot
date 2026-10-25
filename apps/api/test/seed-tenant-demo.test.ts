import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, ROLES_CLIENT } from "@missionpilot/shared";
import { buildApp } from "../src/app.js";
import { semerDefaut } from "../src/db/seed-defaut.js";
import { NOM_CABINET_ABIDJAN } from "../src/db/seed-demo.js";
import { semerTenantDemo, type ResumeTenantDemo } from "../src/db/tenant-demo/index.js";
import {
  EMAIL_FONDATEUR_TENANT,
  MOT_DE_PASSE_DEMO_TENANT,
  NOM_CABINET_TENANT_DEMO,
} from "../src/db/tenant-demo/constantes.js";
import { CLES_CLIENTS } from "../src/db/tenant-demo/cles.js";
import type { PhaseTenantDemo } from "../src/db/tenant-demo/phases/index.js";
import {
  creerBaseJetable,
  lireSql,
  supprimerBaseJetable,
  type BaseJetable,
} from "./outils-base-jetable.js";

/*
 * Socle du seed « Tenant démo » (db/tenant-demo/, db/seed-tenant-demo.ts). Le déroulé complet
 * (cabinet créé par les vraies routes) dure une à deux minutes : il tourne dans une base JETABLE
 * créée par le test (jamais la base partagée des autres tests, où les adresses fixes de la
 * démonstration entreraient en collision), qui reçoit d'abord « Lagune Conseil & Associés (démo) »
 * pour prouver que les deux cabinets cohabitent et que Lagune n'est pas touché.
 */

/** Requête en SQL propriétaire (hors RLS) sur la base jetable : lignes brutes. */
const lignes = lireSql;

const TABLES_COMPTEES = [
  "cabinets",
  "utilisateurs",
  "utilisateurs_portail",
  "collaborateurs",
  "collaborateur_couts",
  "absences",
  "clients",
  "contacts_client",
  "taux_clients",
  "grades",
  "cabinet_feries",
  "journal_audit",
] as const;

/** Nombre de lignes par table (tous cabinets), ou d'un seul cabinet si `cabinetId` est donné. */
async function compter(b: BaseJetable, cabinetId?: string): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of TABLES_COMPTEES) {
    const colonne = t === "cabinets" ? "id" : "cabinet_id";
    const filtre = cabinetId ? `WHERE ${colonne} = '${cabinetId}'` : "";
    const rows = await lignes<{ n: string }>(b, `SELECT count(*) n FROM ${t} ${filtre}`);
    r[t] = Number(rows[0]?.n);
  }
  return r;
}

/** Comptes sans le journal d'audit (une reprise y ajoute connexions et réglages rejoués). */
const sansJournal = ({ journal_audit: _j, ...reste }: Record<string, number>) => reste;

const creationsAudit = async (b: BaseJetable, cabinetId: string): Promise<number> =>
  Number(
    (
      await lignes<{ n: string }>(
        b,
        "SELECT count(*) n FROM journal_audit WHERE cabinet_id = $1 AND action = 'creation'",
        [cabinetId],
      )
    )[0]?.n,
  );

let dossier: string;
let creationsApresPremier = 0;
let base: BaseJetable | undefined;
let lagune: { cabinetId: string; avant: Record<string, number> };
let premier: ResumeTenantDemo;
let second: ResumeTenantDemo;
let tenantId: string;
let apresPremier: Record<string, number>;
const appels: string[] = [];

const phaseEspion: PhaseTenantDemo = {
  nom: "espion",
  executer: async (ctx) => {
    appels.push(ctx.cabinetId);
    // Le contexte du socle est complet pour les phases.
    expect(Object.keys(ctx.clients)).toHaveLength(CLES_CLIENTS.length);
    expect(ctx.session("associe").utilisateurId).toBe(ctx.utilisateurs.associe);
    expect(ctx.aujourdhui).toBe("2026-10-24");
  },
};

describe("seed du Tenant démo (socle)", () => {
  beforeAll(async () => {
    dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-tenant-demo-"));
    base = await creerBaseJetable("tenantdemo", dossier);
    const silence = () => undefined;
    // Cabinet de démonstration existant : Lagune.
    const d = await semerDefaut(base.db, base.config, { publique: false, journal: silence });
    lagune = { cabinetId: d.cabinetId, avant: await compter(base, d.cabinetId) };
    const options = { publique: false, journal: silence, phases: [phaseEspion] };
    premier = await semerTenantDemo(base.db, base.config, options);
    tenantId = premier.socle.cabinetId;
    apresPremier = await compter(base, tenantId);
    creationsApresPremier = await creationsAudit(base, tenantId);
    second = await semerTenantDemo(base.db, base.config, options);
  }, 900_000);

  afterAll(async () => {
    await supprimerBaseJetable(base);
    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it("crée le cabinet « Tenant démo », marqué démonstration, à côté de Lagune", async () => {
    const b = base as BaseJetable;
    expect(premier.socle.cabinetCree).toBe(true);
    const cabinets = await lignes<{ id: string; nom: string; est_demo: boolean; actif: boolean }>(
      b,
      "SELECT id, nom, est_demo, actif FROM cabinets ORDER BY nom",
    );
    expect(cabinets.map((c) => c.nom).sort()).toEqual(
      [NOM_CABINET_ABIDJAN, NOM_CABINET_TENANT_DEMO].sort(),
    );
    expect(cabinets.find((c) => c.id === tenantId)).toMatchObject({
      nom: "Tenant démo",
      est_demo: true,
      actif: true,
    });
    expect(NOM_CABINET_TENANT_DEMO).toBe("Tenant démo");
  });

  it("le cabinet est ancien : activité depuis octobre 2024", async () => {
    const b = base as BaseJetable;
    const r = await lignes<{ cree: string }>(
      b,
      "SELECT cree_le::date::text AS cree FROM cabinets WHERE id = $1",
      [tenantId],
    );
    expect(r[0]?.cree).toBe("2024-10-01");
    const couts = await lignes<{ debut: string }>(
      b,
      "SELECT min(depuis_le)::text AS debut FROM collaborateur_couts WHERE cabinet_id = $1",
      [tenantId],
    );
    expect(couts[0]?.debut).toBe("2024-10-01");
  });

  it("au moins 2 comptes actifs sans 2FA par rôle du cabinet et du portail", async () => {
    const b = base as BaseJetable;
    const comptes = await lignes<{ role: string; n: string }>(
      b,
      `SELECT r AS role, count(*) n FROM utilisateurs u, unnest(u.roles) r
       WHERE u.cabinet_id = $1 AND u.actif
         AND NOT EXISTS (SELECT 1 FROM utilisateurs_2fa f WHERE f.utilisateur_id = u.id)
       GROUP BY r`,
      [tenantId],
    );
    for (const role of [...ROLES, ...ROLES_CLIENT]) {
      const n = Number(comptes.find((c) => c.role === role)?.n ?? 0);
      expect(n, `comptes du rôle ${role}`).toBeGreaterThanOrEqual(2);
    }
    // Les comptes du portail sont rattachés à un client actif.
    const portail = await lignes<{ n: string }>(
      b,
      `SELECT count(*) n FROM utilisateurs_portail p JOIN clients c ON c.id = p.client_id
       WHERE p.cabinet_id = $1 AND p.statut = 'actif' AND c.actif`,
      [tenantId],
    );
    expect(Number(portail[0]?.n)).toBeGreaterThanOrEqual(ROLES_CLIENT.length * 2);
  });

  it("équipe, clients et groupes du socle sont semés", async () => {
    const b = base as BaseJetable;
    const types = await lignes<{ type: string; n: string }>(
      b,
      "SELECT type, count(*) n FROM collaborateurs WHERE cabinet_id = $1 GROUP BY type",
      [tenantId],
    );
    expect(types.map((t) => t.type).sort()).toEqual(["externe", "interne", "sous_traitant"]);
    const grades = await lignes<{ code: string }>(
      b,
      `SELECT DISTINCT g.code FROM collaborateurs c JOIN grades g ON g.id = c.grade_id
       WHERE c.cabinet_id = $1`,
      [tenantId],
    );
    expect(grades).toHaveLength(6);
    const inactifs = await lignes<{ n: string }>(
      b,
      "SELECT count(*) n FROM collaborateurs WHERE cabinet_id = $1 AND NOT actif",
      [tenantId],
    );
    expect(Number(inactifs[0]?.n)).toBeGreaterThanOrEqual(1);
    expect(apresPremier.clients).toBe(CLES_CLIENTS.length);
    expect(apresPremier.absences).toBeGreaterThan(0);
    const devises = await lignes<{ devise: string }>(
      b,
      "SELECT DISTINCT devise FROM taux_clients WHERE cabinet_id = $1 ORDER BY devise",
      [tenantId],
    );
    expect(devises.map((d) => d.devise)).toEqual(["EUR", "USD", "XAF", "XOF"]);
    const groupes = await lignes<{ n: string }>(
      b,
      "SELECT count(*) n FROM dossier_participations WHERE cabinet_id = $1",
      [tenantId],
    );
    expect(Number(groupes[0]?.n)).toBeGreaterThanOrEqual(3);
  });

  it("montants EUR et USD en unités mineures (centimes), XOF et XAF en unités", async () => {
    const b = base as BaseJetable;
    const ca = await lignes<{ montant: string }>(
      b,
      `SELECT f.valeur->>'montant' AS montant FROM dossier_faits f
       JOIN clients c ON c.id = f.client_id
       WHERE f.cabinet_id = $1 AND c.raison_sociale = 'Gabon Offshore Services SA'
         AND f.cle = 'chiffre_affaires_2025'`,
      [tenantId],
    );
    // 48 000 000 USD = 4 800 000 000 centimes.
    expect(ca.map((l) => l.montant)).toEqual(["4800000000"]);
    const taux = await lignes<{ devise: string; mini: string; maxi: string }>(
      b,
      `SELECT devise, min(taux)::text AS mini, max(taux)::text AS maxi FROM taux_clients
       WHERE cabinet_id = $1 GROUP BY devise`,
      [tenantId],
    );
    const parDevise = Object.fromEntries(taux.map((t) => [t.devise, t]));
    // Taux journaliers de 700 à 2 500 EUR ou USD, soit 70 000 à 250 000 centimes ; FCFA en unités.
    for (const d of ["EUR", "USD"]) {
      expect(Number(parDevise[d]?.mini)).toBeGreaterThanOrEqual(70_000);
      expect(Number(parDevise[d]?.maxi)).toBeLessThanOrEqual(250_000);
    }
    expect(Number(parDevise.XOF?.mini)).toBeGreaterThanOrEqual(100_000);
    // État financier EUR : le plus gros poste 2025 d'Atlantique Retail (335 M EUR) est en centimes.
    const etat = await lignes<{ total: string }>(
      b,
      `SELECT max(l.montant)::text AS total FROM dossier_etats_financiers e
       JOIN dossier_etats_lignes l ON l.etat_id = e.id
       JOIN clients c ON c.id = e.client_id
       WHERE e.cabinet_id = $1 AND c.raison_sociale = 'Atlantique Retail Group SAS'
         AND e.exercice = 2025`,
      [tenantId],
    );
    expect(Number(etat[0]?.total)).toBeGreaterThanOrEqual(33_500_000_000);
  });

  it("apparaît dans la liste de la connexion de démonstration (GET /api/auth/demo)", async () => {
    const b = base as BaseJetable;
    const app = await buildApp(
      { ...b.config, NODE_ENV: "test", CONNEXION_RAPIDE_DEMO: "oui" },
      b.db,
    );
    try {
      const r = await app.inject({ method: "GET", url: "/api/auth/demo" });
      expect(r.statusCode).toBe(200);
      const cabinets = r.json().cabinets as {
        id: string;
        nom: string;
        comptes: { email: string; roles: string[]; portail: boolean }[];
      }[];
      expect(cabinets.map((c) => c.nom)).toEqual(
        expect.arrayContaining([NOM_CABINET_TENANT_DEMO, NOM_CABINET_ABIDJAN]),
      );
      const tenant = cabinets.find((c) => c.nom === NOM_CABINET_TENANT_DEMO);
      expect(tenant?.id).toBe(tenantId);
      for (const role of [...ROLES, ...ROLES_CLIENT]) {
        const n = (tenant?.comptes ?? []).filter((c) => c.roles.includes(role)).length;
        expect(n, `comptes proposés pour ${role}`).toBeGreaterThanOrEqual(2);
      }
      // Connexion réelle (mot de passe) du fondateur.
      const c = await app.inject({
        method: "POST",
        url: "/api/auth/connexion",
        payload: { email: EMAIL_FONDATEUR_TENANT, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
      });
      expect(c.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("idempotent : la seconde exécution ne duplique rien et saute les phases faites", async () => {
    const b = base as BaseJetable;
    expect(second.socle.cabinetCree).toBe(false);
    expect(second.socle.cabinetId).toBe(tenantId);
    expect(sansJournal(await compter(b, tenantId))).toEqual(sansJournal(apresPremier));
    expect(await creationsAudit(b, tenantId)).toBe(creationsApresPremier);
    expect(premier.phases).toEqual([{ nom: "espion", statut: "executee" }]);
    expect(second.phases).toEqual([{ nom: "espion", statut: "deja_faite" }]);
    expect(appels).toEqual([tenantId]);
  });

  it("les phases enregistrées sont les six phases de domaine, dans l'ordre", async () => {
    const { PHASES } = await import("../src/db/tenant-demo/phases/index.js");
    expect(PHASES.map((p) => p.nom)).toEqual([
      "missions",
      "notation-plans",
      "redressement-dd",
      "appels-offres-canaux",
      "ia-qualite-standard",
      "gestion",
    ]);
  });

  it("Lagune n'est pas modifié par le semis du Tenant démo", async () => {
    const b = base as BaseJetable;
    const apres = await compter(b, lagune.cabinetId);
    // Le journal d'audit de Lagune ne bouge pas non plus.
    expect(apres).toEqual(lagune.avant);
    const l = await lignes<{ nom: string; est_demo: boolean }>(
      b,
      "SELECT nom, est_demo FROM cabinets WHERE id = $1",
      [lagune.cabinetId],
    );
    expect(l[0]).toEqual({ nom: NOM_CABINET_ABIDJAN, est_demo: true });
  });

  it("refus net si l'adresse fondatrice appartient à un autre cabinet : aucun drapeau posé", async () => {
    const b = base as BaseJetable;
    await lignes(b, "UPDATE cabinets SET nom = 'Autre cabinet', est_demo = false WHERE id = $1", [
      tenantId,
    ]);
    try {
      await expect(
        semerTenantDemo(b.db, b.config, { publique: false, journal: () => undefined, phases: [] }),
      ).rejects.toThrow(/n'est pas/);
      const t = await lignes<{ est_demo: boolean }>(
        b,
        "SELECT est_demo FROM cabinets WHERE id = $1",
        [tenantId],
      );
      expect(t[0]?.est_demo).toBe(false);
    } finally {
      await lignes(b, "UPDATE cabinets SET nom = $2, est_demo = true WHERE id = $1", [
        tenantId,
        NOM_CABINET_TENANT_DEMO,
      ]);
    }
  });
});
