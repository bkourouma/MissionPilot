import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MOT_DE_PASSE_DEMO_TENANT, emailTenant } from "../src/db/tenant-demo/constantes.js";
import { semerTenantDemo, type ResumeTenantDemo } from "../src/db/tenant-demo/index.js";
import { APPELS_OFFRES_DEMO } from "../src/db/tenant-demo/appels-offres-canaux/donnees-ao-liste.js";
import { semerAppelsOffresCanaux } from "../src/db/tenant-demo/phases/appels-offres-canaux.js";
import { MODULES_APPELS_OFFRES_CANAUX } from "../src/db/tenant-demo/phases/appels-offres-canaux.js";
import { semerMissions } from "../src/db/tenant-demo/phases/missions.js";
import { creerBaseJetable, supprimerBaseJetable, type BaseJetable } from "./outils-base-jetable.js";

/*
 * Phase « appels-offres-canaux » du Tenant démo (appels d'offres, banque d'AO, veille, canaux
 * simulés, capitalisation, observatoire, services candidats, guichets), après la phase « missions »
 * réelle, dans une base JETABLE (plusieurs minutes). Vérifie que les tables du périmètre ne sont
 * plus vides, quelques invariants métier et l'idempotence (rejeu de la phase sans doublon).
 */

/** Tables du périmètre qui doivent être non vides. `cap_propositions_derogations` en est exclue :
 *  elle dépend de `propositions_standard` (phase « ia-qualite-standard », qui passe après).
 *  `obs_contributions` aussi : elle ne reçoit que le versement de la route à partir de notations
 *  PUBLIÉES (phase « notation-plans », absente de ce test) ; voir le test dédié plus bas. */
const TABLES_REMPLIES = [
  "appels_offres",
  "appels_offres_evenements",
  "ao_evaluations",
  "ao_decisions",
  "ao_dossiers",
  "ao_extractions",
  "ao_exigences",
  "ao_exigences_suivi",
  "ao_retroplanning_etapes",
  "ao_veille_sources",
  "ao_veille_resultats",
  "ao_veille_occurrences",
  "ao_veille_decisions",
  "ao_cv",
  "ao_cv_versions",
  "ao_references",
  "ao_reference_versions",
  "ao_attestations",
  "ao_offres_techniques",
  "ao_offre_technique_versions",
  "ao_offre_technique_validations",
  "ao_offres_financieres",
  "ao_offre_financiere_versions",
  "canaux_comptes",
  "canaux_destinataires",
  "canaux_consentements",
  "canaux_envois",
  "canaux_saisies_kpi",
  "transcriptions",
  "transcriptions_versions",
  "signatures_demandes",
  "signatures_signataires",
  "signatures_preuves",
  "retours_experience",
  "retour_experience_versions",
  "cap_taches_briques",
  "cap_temps_briques",
  "competences",
  "competence_declarations",
  "competence_decisions",
  "competence_preuves",
  "cap_recommandations",
  "cap_recommandation_statuts",
  "cap_efficacite_mesures",
  "obs_adhesion_evenements",
  "services_candidats_parametres",
  "guichets_financement",
] as const;

let dossier: string;
let base: BaseJetable | undefined;
let cabinetId: string;
let premier: ResumeTenantDemo;
let apresPremier: Record<string, number>;
let apresRejeu: Record<string, number>;

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

async function comptages(): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of TABLES_REMPLIES) {
    r[t] = await nombre(`SELECT count(*) n FROM ${t} WHERE cabinet_id = $1`);
  }
  return r;
}

describe("seed du Tenant démo (phase appels-offres-canaux)", () => {
  beforeAll(async () => {
    dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-td-aoc-"));
    base = await creerBaseJetable("td_aoc", dossier);
    const journal = () => undefined;
    premier = await semerTenantDemo(base.db, base.config, {
      publique: false,
      journal,
      phases: [
        { nom: "missions", executer: semerMissions },
        { nom: "appels-offres-canaux", executer: semerAppelsOffresCanaux },
      ],
    });
    cabinetId = premier.socle.cabinetId;
    apresPremier = await comptages();
    // Rejeu complet de la phase (nom de marqueur différent) : aucune ligne de plus.
    await semerTenantDemo(base.db, base.config, {
      publique: false,
      journal,
      phases: [{ nom: "appels-offres-canaux-rejeu", executer: semerAppelsOffresCanaux }],
    });
    apresRejeu = await comptages();
  }, 3_600_000);

  afterAll(async () => {
    await supprimerBaseJetable(base);
    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it("la phase s'exécute et les tables du périmètre ne sont plus vides", () => {
    expect(premier.phases.map((p) => p.statut)).toEqual(["executee", "executee"]);
    const vides = TABLES_REMPLIES.filter((t) => !apresPremier[t]);
    expect(vides).toEqual([]);
  });

  it("idempotente : le rejeu de la phase n'ajoute aucune ligne", () => {
    expect(apresRejeu).toEqual(apresPremier);
  });

  it("banque d'AO : 7 appels d'offres (3 gagnés, 2 perdus, 1 abandonné, 1 en cours)", async () => {
    const r = await lignes<{ reference: string; statut: string }>(
      "SELECT reference, statut FROM appels_offres WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(r.map((x) => x.reference).sort()).toEqual(
      APPELS_OFFRES_DEMO.map((a) => a.reference).sort(),
    );
    const parStatut = (s: string) => r.filter((x) => x.statut === s).length;
    expect(parStatut("gagne")).toBe(3);
    expect(parStatut("perdu")).toBe(2);
    expect(r.length - parStatut("gagne") - parStatut("perdu")).toBe(2);
    // Les gagnés citent la mission obtenue (SICAFE, Mboa Solaire, Baobab).
    const gagnes = await lignes<{ motif: string }>(
      `SELECT e.motif FROM appels_offres_evenements e
       JOIN appels_offres a ON a.id = e.ao_id
       WHERE a.cabinet_id = $1 AND a.statut = 'gagne' AND e.vers_statut = 'gagne'`,
      [cabinetId],
    );
    const motifs = gagnes.map((g) => g.motif).join(" | ");
    for (const mot of ["SICAFE", "Mboa Solaire", "Baobab Assurances"])
      expect(motifs).toContain(mot);
  });

  it("go/no-go : aucune marge pour qui n'a pas finance.lire (FIN-02)", async () => {
    const b = base as BaseJetable;
    const app = await buildApp({ ...b.config, NODE_ENV: "test", TOTP_REQUIS: "non" }, b.db);
    try {
      const lire = async (cle: string, id: string) => {
        const c = await app.inject({
          method: "POST",
          url: "/api/auth/connexion",
          payload: { email: emailTenant(cle), mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
        });
        const cookie = `${c.cookies[0]?.name}=${c.cookies[0]?.value}`;
        return app.inject({
          method: "GET",
          url: `/api/appels-offres/${id}/go-no-go`,
          headers: { cookie },
        });
      };
      const [ao] = await lignes<{ id: string }>(
        "SELECT id FROM appels_offres WHERE cabinet_id = $1 AND reference = $2",
        [cabinetId, APPELS_OFFRES_DEMO[0]?.reference],
      );
      const sans = await lire("chef.mission", (ao as { id: string }).id);
      expect(sans.statusCode).toBe(200);
      expect(sans.body).not.toMatch(/marge/i);
      const avec = await lire("associe", (ao as { id: string }).id);
      expect(avec.statusCode).toBe(200);
      expect(avec.body).toMatch(/marge/i);
    } finally {
      await app.close();
    }
  });

  it("offres techniques : validation par quelqu'un d'autre que l'auteur et le demandeur IA", async () => {
    const abus = await nombre(
      `SELECT count(*) n FROM ao_offre_technique_validations v
       WHERE v.cabinet_id = $1 AND EXISTS (
         SELECT 1 FROM ao_offre_technique_versions x
         LEFT JOIN ia_demandes d ON d.id = x.demande_ia_id
         WHERE x.offre_id = v.offre_id AND (x.cree_par = v.valide_par OR d.demandeur_id = v.valide_par))`,
    );
    expect(abus).toBe(0);
    // Le brouillon IA (ou gabarit) reste la version 1 : jamais « validé d'office ».
    const v1 = await nombre(
      `SELECT count(*) n FROM ao_offre_technique_validations v
       JOIN ao_offre_technique_versions x ON x.id = v.version_id
       WHERE v.cabinet_id = $1 AND x.version = 1`,
    );
    expect(v1).toBe(0);
  });

  it("capitalisation : 5 retours validés par un autre que l'ouvreur ; seuil de 5 observations", async () => {
    const retours = await lignes<{ statut: string; valide_par: string; ouvert_par: string }>(
      "SELECT statut, valide_par, ouvert_par FROM retours_experience WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(retours).toHaveLength(5);
    for (const r of retours) {
      expect(r.statut).toBe("valide");
      expect(r.valide_par).not.toBe(r.ouvert_par);
    }
    const mesures = await lignes<{ score: number | null; evaluable: boolean }>(
      "SELECT score, evaluable FROM cap_efficacite_mesures WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(mesures.some((m) => m.evaluable && m.score !== null)).toBe(true);
    // Les missions n'ont pas été clôturées par cette phase (clôture à la fin du seed).
    const closes = await nombre(
      `SELECT count(*) n FROM missions WHERE cabinet_id = $1 AND statut = 'cloturee'`,
    );
    expect(closes).toBe(0);
    const adhesion = await lignes<{ n: string }>(
      "SELECT count(*) n FROM obs_adhesion_evenements WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(Number(adhesion[0]?.n)).toBeGreaterThan(0);
  });

  it("canaux : compte simulé actif, alerte KPI sortante activée, aucun envoi vers un numéro non vérifié", async () => {
    const c = await lignes<{ actif: boolean; alerte_kpi: boolean; fournisseur: string }>(
      "SELECT actif, alerte_kpi, fournisseur FROM canaux_comptes WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(c.some((x) => x.actif && x.alerte_kpi && x.fournisseur === "simule")).toBe(true);
    const fautifs = await nombre(
      `SELECT count(*) n FROM canaux_envois e
       JOIN canaux_destinataires d ON d.id = e.destinataire_id
       WHERE e.cabinet_id = $1 AND e.statut IN ('accepte', 'livre', 'lu') AND d.verifie_le IS NULL`,
    );
    expect(fautifs).toBe(0);
    // Un envoi réussi suppose un consentement accordé au moment de l'envoi.
    const sansConsentement = await nombre(
      `SELECT count(*) n FROM canaux_envois e
       WHERE e.cabinet_id = $1 AND e.statut IN ('accepte', 'livre', 'lu')
         AND e.categorie IN ('relance', 'synthese', 'alerte')
         AND NOT EXISTS (SELECT 1 FROM canaux_consentements k
                         WHERE k.destinataire_id = e.destinataire_id AND k.statut = 'accorde')`,
    );
    expect(sansConsentement).toBe(0);
  });

  it("signatures : demandes locales, chaîne de preuves continue", async () => {
    const chaines = await lignes<{
      demande_id: string;
      rang: number;
      empreinte_precedente: string;
      empreinte: string;
    }>(
      `SELECT demande_id, rang, empreinte_precedente, empreinte FROM signatures_preuves
       WHERE cabinet_id = $1 ORDER BY demande_id, rang`,
      [cabinetId],
    );
    expect(chaines.length).toBeGreaterThan(0);
    let precedente: (typeof chaines)[number] | undefined;
    for (const p of chaines) {
      if (precedente && precedente.demande_id === p.demande_id) {
        expect(p.rang).toBe(precedente.rang + 1);
        expect(p.empreinte_precedente).toBe(precedente.empreinte);
      } else {
        expect(p.rang).toBe(1);
      }
      precedente = p;
    }
  });

  it("journal d'audit des appels d'offres clos : une décision go/no-go journalisée par appel", async () => {
    const sans = await nombre(
      `SELECT count(*) n FROM appels_offres a
       WHERE a.cabinet_id = $1 AND NOT EXISTS (
         SELECT 1 FROM journal_audit j WHERE j.cabinet_id = a.cabinet_id AND j.entite = 'appel_offres'
           AND j.entite_id = a.id::text AND j.action = 'decision_go_no_go')`,
    );
    expect(sans).toBe(0);
  });

  it("observatoire : aucune valeur écrite à la main (contributions seulement si des notations sont publiées)", async () => {
    const publiees = await nombre(
      `SELECT count(*) n FROM notation_evenements e
       JOIN notation_versions v ON v.id = e.version_id JOIN notations n ON n.id = v.notation_id
       WHERE n.cabinet_id = $1 AND e.action = 'publication'`,
    );
    const contributions = await nombre(
      "SELECT count(*) n FROM obs_contributions WHERE cabinet_id = $1",
    );
    if (publiees === 0) expect(contributions).toBe(0);
    else expect(contributions).toBeGreaterThan(0);
  });

  it("guichets de financement : une dizaine, devises cohérentes avec le pays", async () => {
    const g = await lignes<{ pays: string[]; devise_montant: string | null }>(
      "SELECT pays, devise_montant FROM guichets_financement WHERE cabinet_id = $1",
      [cabinetId],
    );
    expect(g.length).toBeGreaterThanOrEqual(10);
    const uemoa = new Set(["CI", "SN", "BF", "ML", "BJ", "TG", "NE", "GW"]);
    const cemac = new Set(["CM", "GA", "CG", "TD", "GQ", "CF"]);
    for (const x of g) {
      if (x.pays.length === 1 && x.devise_montant) {
        const pays = x.pays[0] as string;
        if (uemoa.has(pays)) expect(x.devise_montant).toBe("XOF");
        if (cemac.has(pays)) expect(x.devise_montant).toBe("XAF");
      }
    }
  });
});

/*
 * Démonstration PUBLIQUE (`publique: true`, voie du serveur) : `neutraliserEnvois` passe en échec
 * tout job en attente ; le module des canaux ouvre sa propre base qui épargne SEULEMENT les envois
 * et les transcriptions simulés (exécutés sur place) et neutralise le reste (e-mails).
 */
describe("seed du Tenant démo (canaux en démonstration publique)", () => {
  let basePublique: BaseJetable | undefined;
  let dossierPublic: string;
  let cabinetPublic: string;
  const requete = async <T>(sql: string): Promise<T[]> => {
    const client = new pg.Client({
      connectionString: (basePublique as BaseJetable).config.DATABASE_OWNER_URL,
    });
    await client.connect();
    try {
      return (await client.query(sql, [cabinetPublic])).rows as T[];
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    dossierPublic = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-td-aoc-pub-"));
    basePublique = await creerBaseJetable("td_aoc_pub", dossierPublic);
    const canaux = MODULES_APPELS_OFFRES_CANAUX.find(([nom]) => nom === "canaux");
    if (!canaux) throw new Error("Module canaux introuvable.");
    const r = await semerTenantDemo(basePublique.db, basePublique.config, {
      publique: true,
      journal: () => undefined,
      phases: [
        { nom: "missions", executer: semerMissions },
        { nom: "canaux-public", executer: canaux[1] },
      ],
    });
    cabinetPublic = r.socle.cabinetId;
  }, 3_600_000);

  afterAll(async () => {
    await supprimerBaseJetable(basePublique);
    await rm(dossierPublic, { recursive: true, force: true });
  }, 120_000);

  it("les envois et transcriptions simulés vont à leur terme, aucun e-mail du seed ne survit", async () => {
    const [v] = await requete<{ n: string }>(
      "SELECT count(*) n FROM transcriptions_versions WHERE cabinet_id = $1",
    );
    expect(Number(v?.n)).toBeGreaterThan(0);
    const [reserves] = await requete<{ n: string }>(
      "SELECT count(*) n FROM canaux_envois WHERE cabinet_id = $1 AND statut = 'reserve'",
    );
    expect(Number(reserves?.n)).toBe(0);
    const [envois] = await requete<{ n: string }>(
      "SELECT count(*) n FROM canaux_envois WHERE cabinet_id = $1",
    );
    expect(Number(envois?.n)).toBeGreaterThan(0);
    const [attente] = await requete<{ n: string }>(
      "SELECT count(*) n FROM jobs WHERE cabinet_id = $1 AND statut = 'en_attente' AND type = 'envoyer_email'",
    );
    expect(Number(attente?.n)).toBe(0);
  });
});
