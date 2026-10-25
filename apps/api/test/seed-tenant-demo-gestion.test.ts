import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { semerGestion } from "../src/db/tenant-demo/phases/gestion.js";
import { semerTenantDemo, type ResumeTenantDemo } from "../src/db/tenant-demo/index.js";
import { NOM_CABINET_TENANT_DEMO } from "../src/db/tenant-demo/constantes.js";
import {
  CLES_MISSIONS,
  MISSIONS_CASTING,
  MISSIONS_TERMINEES,
} from "../src/db/tenant-demo/gestion/casting.js";
import { MOT_DE_PASSE_DEMO_TENANT } from "../src/db/tenant-demo/constantes.js";
import {
  creerBaseJetable,
  lireSql,
  supprimerBaseJetable,
  type BaseJetable,
} from "./outils-base-jetable.js";

/*
 * Phase « gestion » du Tenant démo (lot 2b) sur la CHAÎNE COMPLÈTE des phases, en démonstration
 * PUBLIQUE (jobs d'envoi neutralisés), dans une base jetable : temps, facturation et encaissements,
 * rapports, salle de mission, ingestion, collaboration et portail, signature qualité des rapports,
 * clôture des 5 missions terminées puis revues à froid. Le déroulé complet dure plusieurs
 * dizaines de minutes ; la phase `gestion` est ensuite rejouée une seconde fois (idempotence).
 */

/** Tables du périmètre de la phase, non vides à la fin de la chaîne. */
const TABLES_NON_VIDES = [
  // Temps
  "feuilles_temps",
  "lignes_temps",
  "feuille_validations",
  "periodes_temps",
  "corrections_temps",
  "parametres_temps",
  "rappels_temps",
  "reste_a_faire",
  "alertes_suivi",
  "cabinet_feries",
  "taux_clients",
  // Facturation, encaissements, débours
  "echeances_facturation",
  "facturation_liens",
  "factures",
  "facture_lignes",
  "sequences_facturation",
  "encaissements",
  "imputations",
  "contre_passations",
  "relances_factures",
  "parametres_relances",
  "plan_comptable_cabinet",
  "plan_comptable_validation",
  "debours",
  // Rapports, clôture
  "rapports_mission",
  "rapports_parametres",
  "bilans_mission",
  "cloture_modele_items",
  "cloture_derogations",
  // Salle de mission
  "salle_demandes",
  "salle_modeles",
  "salle_pieces",
  "salle_relances",
  "salle_depots",
  "salle_piece_evenements",
  "salle_accuses",
  // Ingestion
  "ingestion_documents",
  "ingestion_pages",
  "ingestion_extractions",
  // Collaboration, portail, fichiers
  "commentaires",
  "commentaire_revisions",
  "commentaire_suppressions",
  "taches_collaboration",
  "fichiers_suppressions",
  "portail_clients",
  "portail_validations_jalons",
  "portail_partages",
  // Revues à froid (après la clôture)
  "qualite_froide_campagnes",
  "qualite_froide_echantillon",
  "qualite_froide_constats",
  "qualite_froide_evaluations",
  "qualite_froide_actions",
  "qualite_froide_actions_historique",
] as const;

/** Tables dont le nombre de lignes ne doit pas bouger au rejeu de la phase. */
const TABLES_IDEMPOTENCE = [
  "feuilles_temps",
  "lignes_temps",
  "periodes_temps",
  "corrections_temps",
  "echeances_facturation",
  "factures",
  "encaissements",
  "debours",
  "relances_factures",
  "rapports_mission",
  "salle_demandes",
  "salle_depots",
  "ingestion_documents",
  "ingestion_extractions",
  "commentaires",
  "taches_collaboration",
  "portail_validations_jalons",
  "portail_partages",
  "qualite_suivis",
  "qualite_froide_campagnes",
  "utilisateurs",
  "missions",
] as const;

/** Clients dont le dirigeant du portail doit voir des factures (motif LIKE sur la raison sociale). */
const CLIENTS_PORTAIL_ATTENDUS = [
  "Société Ivoirienne de Café%",
  "Sahel Coton%",
  "Brasseries du Wouri%",
  "Mboa%",
  "Atlantique Retail%",
  "Baobab%",
] as const;

let dossier: string;
let base: BaseJetable | undefined;
let resume: ResumeTenantDemo;
let cabinetId: string;
let comptagesApres: Record<string, number> = {};
let comptagesRejeu: Record<string, number> = {};

const sql = <T = Record<string, unknown>>(requete: string, parametres: unknown[] = []) =>
  lireSql<T>(base as BaseJetable, requete, parametres);
const nombre = async (requete: string): Promise<number> =>
  Number((await sql<{ n: string }>(requete, [cabinetId]))[0]?.n);

async function compter(): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of [...TABLES_NON_VIDES, ...TABLES_IDEMPOTENCE]) {
    // Noms issus des constantes ci-dessus (jamais d'une entrée externe).
    r[t] = await nombre(`SELECT count(*) AS n FROM ${t} WHERE cabinet_id = $1`);
  }
  return r;
}

describe("seed du Tenant démo (phase gestion, chaîne complète, démonstration publique)", () => {
  beforeAll(async () => {
    dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-td-gestion-"));
    base = await creerBaseJetable("tdgestion", dossier);
    const silence = () => undefined;
    // Toutes les phases dans l'ordre du registre, en démonstration publique.
    resume = await semerTenantDemo(base.db, base.config, { publique: true, journal: silence });
    const c = await sql<{ id: string }>("SELECT id FROM cabinets WHERE nom = $1", [
      NOM_CABINET_TENANT_DEMO,
    ]);
    cabinetId = (c[0] as { id: string }).id;
    comptagesApres = await compter();
    // Rejeu de la seule phase gestion : doit reprendre sans rien dupliquer.
    await semerTenantDemo(base.db, base.config, {
      publique: true,
      journal: silence,
      phases: [{ nom: "gestion-rejeu", executer: semerGestion }],
    });
    comptagesRejeu = await compter();
  }, 7_200_000);

  afterAll(async () => {
    await supprimerBaseJetable(base);
    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it("la chaîne complète s'exécute sans CLOTURE_BLOQUEE, gestion comprise", () => {
    const phase = resume.phases.find((p) => p.nom === "gestion");
    expect(phase?.statut).toBe("executee");
  });

  it("les tables du périmètre ne sont plus vides", () => {
    const vides = TABLES_NON_VIDES.filter((t) => !comptagesApres[t]);
    expect(vides).toEqual([]);
  });

  it("les 5 missions terminées sont clôturées avec un bilan, les autres restent ouvertes", async () => {
    const lignes = await sql<{ intitule: string; statut: string; bilan: boolean }>(
      `SELECT m.intitule, m.statut,
              EXISTS (SELECT 1 FROM bilans_mission b WHERE b.mission_id = m.id) AS bilan
         FROM missions m WHERE m.cabinet_id = $1`,
      [cabinetId],
    );
    for (const cle of CLES_MISSIONS) {
      const l = lignes.find((x) => x.intitule === MISSIONS_CASTING[cle]);
      expect(l, `mission ${cle}`).toBeDefined();
      if (MISSIONS_TERMINEES.includes(cle)) {
        expect(l?.statut, cle).toBe("cloturee");
        expect(l?.bilan, cle).toBe(true);
      } else {
        expect(l?.statut, cle).not.toBe("cloturee");
      }
    }
  });

  it("temps : aucune ligne un week-end, feuilles validées jamais par leur auteur, périodes closes", async () => {
    expect(
      await nombre(
        "SELECT count(*) AS n FROM lignes_temps WHERE cabinet_id = $1 AND EXTRACT(isodow FROM date) > 5",
      ),
    ).toBe(0);
    expect(
      await nombre(
        `SELECT count(*) AS n FROM feuille_validations v JOIN feuilles_temps f ON f.id = v.feuille_id
          WHERE v.cabinet_id = $1 AND v.decision = 'validee' AND v.decide_par = f.auteur_id`,
      ),
    ).toBe(0);
    expect(
      await nombre(
        "SELECT count(*) AS n FROM periodes_temps WHERE cabinet_id = $1 AND statut = 'cloturee'",
      ),
    ).toBeGreaterThanOrEqual(20);
    // Aucune feuille non validée ne porte de temps d'une mission terminée.
    expect(
      await nombre(
        `SELECT count(DISTINCT f.id) AS n FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
           JOIN missions m ON m.id = l.mission_id
          WHERE l.cabinet_id = $1 AND m.statut = 'cloturee' AND f.statut IN ('brouillon', 'soumise', 'rejetee')`,
      ),
    ).toBe(0);
  });

  it("temps : jours consommés proches du budget sur les terminées (une seule en dépassement)", async () => {
    const lignes = await sql<{ intitule: string; budget: string; saisi: string }>(
      `SELECT m.intitule,
              (SELECT coalesce(sum(a.jours_alloues), 0) FROM affectations a WHERE a.mission_id = m.id) AS budget,
              (SELECT coalesce(sum(t.centiemes), 0) / 100.0 FROM lignes_temps t WHERE t.mission_id = m.id) AS saisi
         FROM missions m WHERE m.cabinet_id = $1 AND m.statut = 'cloturee'`,
      [cabinetId],
    );
    expect(lignes).toHaveLength(MISSIONS_TERMINEES.length);
    const ratios = lignes.map((l) => ({ nom: l.intitule, r: Number(l.saisi) / Number(l.budget) }));
    const hors = ratios.filter((x) => x.r < 0.85 || x.r > 1.1);
    expect(hors.map((x) => x.nom)).toEqual([MISSIONS_CASTING["wouri-redressement"]]);
  });

  it("facturation : factures émises avec lignes et numéro, numérotation croissante avec les dates", async () => {
    expect(
      await nombre(
        `SELECT count(*) AS n FROM factures f WHERE f.cabinet_id = $1 AND f.statut = 'emise'
            AND (f.numero IS NULL OR NOT EXISTS (SELECT 1 FROM facture_lignes l WHERE l.facture_id = f.id))`,
      ),
    ).toBe(0);
    const desordre = await nombre(
      `SELECT count(*) AS n FROM factures a JOIN factures b
          ON a.cabinet_id = b.cabinet_id AND a.exercice = b.exercice AND a.nature = b.nature
         AND a.sequence < b.sequence
        WHERE a.cabinet_id = $1 AND a.numero IS NOT NULL AND b.numero IS NOT NULL
          AND a.date_emission > b.date_emission`,
    );
    expect(desordre).toBe(0);
    // Une facture en retard au moins, avec ses relances.
    expect(
      await nombre(
        `SELECT count(DISTINCT r.facture_id) AS n FROM relances_factures r WHERE r.cabinet_id = $1`,
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("facturation : chaque mission terminée est entièrement facturée et encaissée", async () => {
    // La clôture (contrôles « factures émises » et « encaissements soldés ») a réussi ; on vérifie en plus
    // qu'aucune facture émise d'une terminée n'a de solde.
    const soldes = await sql<{ numero: string; solde: string }>(
      `SELECT f.numero, f.net_a_payer - coalesce(sum(i.montant), 0) AS solde
         FROM factures f JOIN missions m ON m.id = f.mission_id
         LEFT JOIN imputations i ON i.facture_id = f.id
        WHERE f.cabinet_id = $1 AND m.statut = 'cloturee' AND f.statut = 'emise' AND f.nature = 'facture'
        GROUP BY f.id, f.numero, f.net_a_payer
       HAVING f.net_a_payer - coalesce(sum(i.montant), 0) > 0`,
      [cabinetId],
    );
    // Un avoir peut solder une facture sans encaissement : le contrôle de clôture fait foi.
    expect(soldes.length).toBeLessThanOrEqual(3);
    expect(
      await nombre(
        `SELECT count(*) AS n FROM factures f JOIN missions m ON m.id = f.mission_id
          WHERE f.cabinet_id = $1 AND m.statut = 'cloturee' AND f.statut IN ('brouillon', 'a_approuver', 'approuvee')`,
      ),
    ).toBe(0);
  });

  it("ingestion : extraction validée par un autre que le téléverseur ; texte purgé pour d'anciens documents", async () => {
    expect(
      await nombre(
        `SELECT count(*) AS n FROM ingestion_extractions e JOIN ingestion_documents d ON d.id = e.document_id
          WHERE e.cabinet_id = $1 AND e.valide_par IS NOT NULL
            AND e.valide_par IN (d.cree_par, e.cree_par, e.demande_par)`,
      ),
    ).toBe(0);
    expect(
      await nombre(
        "SELECT count(*) AS n FROM ingestion_documents WHERE cabinet_id = $1 AND texte_purge_le IS NOT NULL",
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("portail : factures émises partagées, jamais de donnée interne ; validations par des dirigeants", async () => {
    // Une mission dont une facture est émise est partagée avec `factures` vrai.
    expect(
      await nombre(
        `SELECT count(*) AS n FROM factures f WHERE f.cabinet_id = $1 AND f.statut = 'emise'
            AND NOT EXISTS (SELECT 1 FROM portail_partages p WHERE p.mission_id = f.mission_id
                              AND p.document_id IS NULL AND p.factures)
            AND EXISTS (SELECT 1 FROM portail_partages p WHERE p.mission_id = f.mission_id)`,
      ),
    ).toBe(0);
    expect(
      await nombre(
        `SELECT count(*) AS n FROM portail_validations_jalons v JOIN utilisateurs u ON u.id = v.valide_par
          WHERE v.cabinet_id = $1 AND NOT (u.roles && ARRAY['client_dirigeant'])`,
      ),
    ).toBe(0);
  });

  it("portail : le dirigeant de chaque client principal voit ses factures, sans donnée interne", async () => {
    const b = base as BaseJetable;
    const app = await buildApp({ ...b.config, NODE_ENV: "test", TOTP_REQUIS: "non" }, b.db);
    try {
      for (const client of CLIENTS_PORTAIL_ATTENDUS) {
        const comptes = await sql<{ email: string }>(
          `SELECT u.email FROM utilisateurs u JOIN utilisateurs_portail p ON p.utilisateur_id = u.id
             JOIN clients c ON c.id = p.client_id
            WHERE u.cabinet_id = $1 AND u.actif AND p.statut = 'actif'
              AND u.roles && ARRAY['client_dirigeant'] AND c.raison_sociale LIKE $2
            ORDER BY u.cree_le LIMIT 1`,
          [cabinetId, client],
        );
        expect(comptes[0], `dirigeant de ${client}`).toBeDefined();
        const c = await app.inject({
          method: "POST",
          url: "/api/auth/connexion",
          payload: { email: comptes[0]?.email, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
        });
        expect(c.statusCode, client).toBe(200);
        const cookie = `${c.cookies[0]?.name}=${c.cookies[0]?.value}`;
        const lire = async (url: string): Promise<{ n: number; corps: string }> => {
          const r = await app.inject({ method: "GET", url, headers: { cookie } });
          expect(r.statusCode, `${client} ${url}`).toBe(200);
          const j = r.json() as { elements?: unknown[] } | unknown[];
          return { n: Array.isArray(j) ? j.length : (j.elements?.length ?? 0), corps: r.body };
        };
        const factures = await lire("/api/portail/factures");
        expect(factures.n, `factures visibles de ${client}`).toBeGreaterThan(0);
        expect((await lire("/api/portail/kpi")).n, `KPI visibles de ${client}`).toBeGreaterThan(0);
        expect(
          (await lire("/api/portail/avancement")).n,
          `rapports d'avancement visibles de ${client}`,
        ).toBeGreaterThan(0);
        expect(factures.corps).not.toMatch(/cout|marge|taux_vente|taux_journalier/i);
      }
    } finally {
      await app.close();
    }
  });

  it("montants : les missions en EUR et USD sont du même ordre de grandeur qu'en FCFA", async () => {
    const lignes = await sql<{ devise: string; ht: string }>(
      `SELECT f.devise, f.total_ht AS ht FROM factures f
        WHERE f.cabinet_id = $1 AND f.nature = 'facture' AND f.statut = 'emise' AND f.devise IN ('EUR', 'USD')`,
      [cabinetId],
    );
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      // Unités mineures (centimes) -> équivalent XOF : EUR 655,957 ; USD 600 (taux fictifs du seed).
      const xof = (Number(l.ht) / 100) * (l.devise === "EUR" ? 655.957 : 600);
      expect(xof, `facture ${l.devise}`).toBeGreaterThan(300_000);
      expect(xof, `facture ${l.devise}`).toBeLessThan(60_000_000);
    }
    const debours = await sql<{ devise: string; montant: string }>(
      `SELECT m.devise, d.montant FROM debours d JOIN missions m ON m.id = d.mission_id
        WHERE d.cabinet_id = $1 AND m.devise IN ('EUR', 'USD')`,
      [cabinetId],
    );
    for (const d of debours) {
      const xof = (Number(d.montant) / 100) * (d.devise === "EUR" ? 655.957 : 600);
      expect(xof).toBeGreaterThan(50_000);
      expect(xof).toBeLessThan(10_000_000);
    }
  });

  it("FIN-02 : un consultant n'accède ni aux factures ni aux encaissements ni aux prévisions", async () => {
    const b = base as BaseJetable;
    const app = await buildApp({ ...b.config, NODE_ENV: "test", TOTP_REQUIS: "non" }, b.db);
    try {
      const c = await app.inject({
        method: "POST",
        url: "/api/auth/connexion",
        payload: { email: "consultant@tenant-demo.test", mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
      });
      expect(c.statusCode).toBe(200);
      const cookie = `${c.cookies[0]?.name}=${c.cookies[0]?.value}`;
      for (const url of ["/api/finance/encaissements", "/api/previsions"]) {
        const r = await app.inject({ method: "GET", url, headers: { cookie } });
        expect(r.statusCode, url).toBe(403);
      }
    } finally {
      await app.close();
    }
  });

  it("comptes : au plus 50 comptes actifs (liste de connexion rapide)", async () => {
    const n = await nombre(
      "SELECT count(*) AS n FROM utilisateurs WHERE cabinet_id = $1 AND actif",
    );
    expect(n).toBeLessThanOrEqual(50);
  });

  it("idempotent : le rejeu de la phase ne duplique rien", () => {
    for (const t of TABLES_IDEMPOTENCE) {
      expect(comptagesRejeu[t], t).toBe(comptagesApres[t]);
    }
  });

  it("aucun fichier de la phase ne dépasse 400 lignes", async () => {
    const dir = path.join(import.meta.dirname, "../src/db/tenant-demo/gestion");
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".ts")) continue;
      const lignes = (await readFile(path.join(dir, f), "utf8")).split("\n").length;
      expect(lignes, f).toBeLessThanOrEqual(400);
    }
  });
});
