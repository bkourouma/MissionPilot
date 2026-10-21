import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { MOT_DE_PASSE_DEMO_ABIDJAN } from "../src/db/seed-demo.js";
import {
  CLIENT_REDRESSEMENT_DEMO,
  DOSSIER_ACTIF_DEMO,
  DOSSIER_CLOS_DEMO,
  semerRedressementDemo,
  type ResumeRedressementDemo,
} from "../src/db/seed-demo-redressement.js";
import { api, type Api } from "./api.js";
import { connecter, demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Sous-semis du service #5 (db/seed-demo-redressement.ts) rejoué sur la base de test : le cabinet
 * de démonstration est recréé sous la forme du seed principal (même rôles, mêmes mots de passe),
 * avec des adresses propres à ce test pour ne pas heurter les autres suites. Tout passe par les
 * routes du module ; aucun appel réseau n'est toléré (fetch espionné).
 */

const SUFFIXE = `red-demo-${Date.now()}.test`;
const email = (cle: string) => `${cle}@${SUFFIXE}`;

const COMPTES = [
  ["associe", "associe"],
  ["directeur.mission", "directeur_mission"],
  ["chef.mission", "chef_mission"],
  ["consultant", "consultant"],
  ["consultant.junior", "consultant"],
] as const;

let ctx: Contexte;
let cabinetId: string;
let resume: ResumeRedressementDemo | null;
let associe: Api;
let fetchEspion: MockInstance<typeof fetch>;

const compter = async (sql: string): Promise<number> =>
  proprietaire(async (c) => Number((await c.query(sql, [cabinetId])).rows[0].n));

const TABLES = [
  "red_dossiers",
  "red_urgences",
  "red_scores",
  "red_tresorerie_versions",
  "red_creanciers",
  "red_actions",
  "red_plan_versions",
  "red_clotures",
  "red_causes_versions",
];

beforeAll(async () => {
  fetchEspion = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("Appel réseau interdit dans le seed de démonstration.");
  });
  ctx = await demarrer();
  const hash = await hashPassword(MOT_DE_PASSE_DEMO_ABIDJAN);
  cabinetId = await ctx.db.withoutTenant(async (db) => {
    const r = await db.query("SELECT creer_cabinet($1, 'CI', $2, 'Awa Koné', $3) AS id", [
      "Lagune Conseil & Associés (démo, test redressement)",
      email("associe"),
      hash,
    ]);
    return r.rows[0].id as string;
  });
  await ctx.db.withTenant(cabinetId, async (db) => {
    for (const [cle, role] of COMPTES.slice(1)) {
      await db.query(
        `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [cabinetId, email(cle), cle, [role], hash],
      );
    }
  });
  const cookie = await connecter(ctx, email("associe")).catch(async () => {
    const r = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/connexion",
      payload: { email: email("associe"), mot_de_passe: MOT_DE_PASSE_DEMO_ABIDJAN },
    });
    return `${r.cookies[0]?.name}=${r.cookies[0]?.value}`;
  });
  associe = api(ctx, cookie);
  const client = await associe.post("/api/clients", {
    raison_sociale: CLIENT_REDRESSEMENT_DEMO,
    forme_juridique: "SARL",
    secteur: "Transport et logistique",
    taille: "pme",
    pays: "CI",
    adresse: "Abidjan, Côte d'Ivoire",
  });
  expect(client.statusCode, client.body).toBe(201);
  resume = await semerRedressementDemo(ctx.db, ctx.config, { email });
}, 300_000);

afterAll(async () => {
  fetchEspion.mockRestore();
  await ctx.fermer();
});

describe("seed de démonstration du redressement", () => {
  it("crée les deux dossiers, sans aucun appel réseau", async () => {
    expect(resume).not.toBeNull();
    expect(fetchEspion).not.toHaveBeenCalled();
    const liste = await associe.get("/api/redressement/dossiers?limite=50");
    expect(liste.statusCode).toBe(200);
    const dossiers = liste.json().elements as { id: string; intitule: string; statut: string }[];
    const actif = dossiers.find((d) => d.intitule === DOSSIER_ACTIF_DEMO);
    const clos = dossiers.find((d) => d.intitule === DOSSIER_CLOS_DEMO);
    expect(actif?.id).toBe(resume?.actif.dossierId);
    expect(clos?.id).toBe(resume?.clos.dossierId);
    expect(clos?.statut).toBe("clos");
  });

  it("calcule voyants, scores, ratios et trésorerie par les moteurs (valeurs non nulles)", async () => {
    const d = `/api/redressement/dossiers/${resume?.actif.dossierId}`;
    const urgences = (await associe.get(`${d}/urgences`)).json();
    expect(JSON.stringify(urgences)).not.toBe("{}");
    expect((urgences.evaluations ?? urgences.elements ?? urgences).length).toBeGreaterThanOrEqual(
      2,
    );
    const scores = (await associe.get(`${d}/scores`)).json();
    expect((scores.evaluations ?? scores.elements ?? scores).length).toBeGreaterThanOrEqual(2);
    const ratios = (await associe.get(`${d}/ratios`)).json();
    expect(ratios.exercices).toHaveLength(2);
    expect(ratios.exercices[0].ratios.liquidite_generale.valeur).toBeGreaterThan(0);
    const treso = (await associe.get(`${d}/tresorerie`)).json();
    expect(treso.version?.version ?? treso.versions?.length).toBeGreaterThanOrEqual(1);
    const mensuelle = await associe.get(`${d}/tresorerie/mensuelle`);
    expect(mensuelle.statusCode).toBe(200);
  });

  it("plan : version validée par le directeur de la mission, kanban renseigné", async () => {
    const d = `/api/redressement/dossiers/${resume?.actif.dossierId}`;
    const plan = (await associe.get(`${d}/plan`)).json();
    const texte = JSON.stringify(plan);
    expect(texte).toContain(resume?.actif.versionPlanId);
    const statuts = (
      await proprietaire((c) =>
        c.query(
          `SELECT v.id, v.valide_par, u.roles
             FROM red_plan_versions v JOIN utilisateurs u ON u.id = v.valide_par
            WHERE v.id = $1`,
          [resume?.actif.versionPlanId],
        ),
      )
    ).rows;
    expect(statuts).toHaveLength(1);
    expect(statuts[0].roles).toContain("directeur_mission");
    const dossier = (await associe.get(d)).json();
    expect(dossier.statut).toBe("plan_valide");
    expect(
      await compter("SELECT count(*) AS n FROM red_actions WHERE cabinet_id = $1"),
    ).toBeGreaterThanOrEqual(4);
  });

  it("créanciers : trois, dont un accord avec échéancier et un paiement", async () => {
    const d = `/api/redressement/dossiers/${resume?.actif.dossierId}`;
    expect(await compter("SELECT count(*) AS n FROM red_creanciers WHERE cabinet_id = $1")).toBe(3);
    const synthese = JSON.stringify((await associe.get(`${d}/creanciers`)).json());
    expect(synthese).toContain("Banque Atlantique Lagune (fictive)");
    const echeances = await compter(
      "SELECT count(*) AS n FROM red_echeances WHERE cabinet_id = $1",
    );
    expect(echeances).toBe(3);
  });

  it("causes racines : gabarit sans IA, modifiées puis validées par un consultant", async () => {
    const d = `/api/redressement/dossiers/${resume?.actif.dossierId}`;
    const causes = (await associe.get(`${d}/causes`)).json();
    const versions = (causes.versions ?? causes.elements) as {
      id: string;
      statut: string;
      gabarit: boolean;
      exploitable_livrable: boolean;
    }[];
    const v = versions.find((x) => x.id === resume?.actif.causesId);
    expect(v).toMatchObject({ statut: "valide", gabarit: true, exploitable_livrable: true });
    const rangs = (
      await proprietaire((c) =>
        c.query(
          "SELECT statut_contenu, auteur_id FROM red_causes_historique WHERE version_id = $1 ORDER BY rang",
          [resume?.actif.causesId],
        ),
      )
    ).rows as { statut_contenu: string; auteur_id: string }[];
    expect(rangs.map((r) => r.statut_contenu)).toEqual(["brouillon_ia", "modifie", "valide"]);
    expect(new Set(rangs.map((r) => r.auteur_id)).size).toBe(3);
    expect(
      await compter(
        "SELECT count(*) AS n FROM ia_demandes WHERE cabinet_id = $1 AND statut = 'terminee'",
      ),
    ).toBeLessThanOrEqual(1);
  });

  it("check-list, covenants et plan de financement présents", async () => {
    const d = `/api/redressement/dossiers/${resume?.actif.dossierId}`;
    const listes = (await associe.get(`${d}/checklists`)).json();
    expect(JSON.stringify(listes)).toContain("Services : points de contrôle de départ");
    const cov = (await associe.get(`${d}/covenants`)).json();
    expect(JSON.stringify(cov)).toContain("liquidite_generale");
    const fin = (await associe.get(`${d}/financement`)).json();
    expect(JSON.stringify(fin)).toContain("apport_associes");
  });

  it("bilan de clôture : brouillon non validé", async () => {
    const d = `/api/redressement/dossiers/${resume?.actif.dossierId}`;
    const bilan = await associe.get(`/api/redressement/clotures/${resume?.actif.bilanId}`);
    expect(bilan.statusCode).toBe(200);
    expect(bilan.json().statut).toBe("brouillon");
    expect(bilan.json().valide_le ?? null).toBeNull();
    const liste = (await associe.get(`${d}/clotures`)).json();
    expect(JSON.stringify(liste)).toContain(resume?.actif.bilanId);
  });

  it("dossier clos : suivi post-mission à 6 et 12 mois avec un relevé", async () => {
    const suivi = (
      await associe.get(`/api/redressement/dossiers/${resume?.clos.dossierId}/suivi`)
    ).json();
    expect(suivi.dossier_clos).toBe(true);
    expect(suivi.jalons).toHaveLength(2);
    expect(suivi.jalons.map((j: { libelle: string }) => j.libelle).join(" ")).toMatch(/6/);
    expect(suivi.jalons.map((j: { rang: number }) => j.rang)).toEqual([1, 2]);
    expect(await compter("SELECT count(*) AS n FROM red_suivi_releves WHERE cabinet_id = $1")).toBe(
      1,
    );
  });

  it("le tableau de bord du dossier répond 200 sur les deux dossiers pour l'associé", async () => {
    for (const id of [resume?.actif.dossierId, resume?.clos.dossierId]) {
      const r = await associe.get(`/api/redressement/dossiers/${id}/tableau-de-bord`);
      expect(r.statusCode, r.body).toBe(200);
    }
  });

  it("idempotent : un second appel renvoie null et n'écrit rien de plus", async () => {
    const avant = await Promise.all(
      TABLES.map((t) => compter(`SELECT count(*) AS n FROM ${t} WHERE cabinet_id = $1`)),
    );
    expect(avant.every((n) => n > 0)).toBe(true);
    expect(await semerRedressementDemo(ctx.db, ctx.config, { email })).toBeNull();
    const apres = await Promise.all(
      TABLES.map((t) => compter(`SELECT count(*) AS n FROM ${t} WHERE cabinet_id = $1`)),
    );
    expect(apres).toEqual(avant);
    expect(fetchEspion).not.toHaveBeenCalled();
  });

  it("refuse net si le cabinet de démonstration n'existe pas", async () => {
    await expect(
      semerRedressementDemo(ctx.db, ctx.config, { email: (cle) => `absent-${cle}@${SUFFIXE}` }),
    ).rejects.toThrow(/n'existe pas/);
  });
});
