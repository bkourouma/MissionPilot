import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAPPORTS_PAR_FENETRE } from "../src/rapports/enregistrement.js";
import { cheminNavigateur } from "../src/rapports/pdf.js";
import { api, type Api } from "./api.js";
import { demarrerAvecStockage, ECHANTILLONS, televerser } from "./fichiers-outils.js";
import { feuilleValidee } from "./finance-outils.js";
import { configTest, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";
import { inviterClient } from "./portail-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";
import { affecter, attendre, missionTemps, type MissionTemps } from "./temps-outils.js";

/*
 * Rapports de mission (SOC-07) : POST et GET /api/missions/:id/rapports,
 * lecture des fichiers de rapport (GET /api/fichiers/:id) selon le NIVEAU
 * (base, jours, finance) revérifié à chaque lecture, débit par utilisateur,
 * isolation (autre cabinet, portail client).
 */

type Utilisateur = Api & { utilisateurId: string };
interface RapportCree {
  rapport: { id: string; niveau: string; format: string };
  fichier: { id: string };
}

let ctx: Contexte & { dossier: string };
let a: CabinetMissions;
let b: CabinetMissions;
let m: MissionTemps;
let membre: Utilisateur;
let gestionnaire: Utilisateur;
let expert: Utilisateur;
/** Rapports produits par la suite (niveau jours par le chef, finance par l'associé, base par l'expert). */
let rJours: RapportCree;
let rFinance: RapportCree;
let rBase: RapportCree;

const INTITULE = `Mission <script>alert(1)</script> & "test"`;
const url = (id: string, format = "docx") => `/api/missions/${id}/rapports?format=${format}`;
const liste = (id: string, q = "") => `/api/missions/${id}/rapports${q}`;
const navigateur = cheminNavigateur(configTest());

/** Texte des entrées XML du fichier généré, téléchargé par la route de fichiers. */
async function telecharger(par: Api, fichierId: string): Promise<{ statut: number; xml: string }> {
  const r = await par.get(`/api/fichiers/${fichierId}`);
  if (r.statusCode !== 200) return { statut: r.statusCode, xml: "" };
  return { statut: 200, xml: toutLeXml(dezipper(r.rawPayload)) };
}

const lire = async (par: Api, r: RapportCree) =>
  (await par.get(`/api/fichiers/${r.fichier.id}`)).statusCode;

async function generer(par: Api, missionId: string, format = "docx"): Promise<RapportCree> {
  const r = await par.post(url(missionId, format));
  attendre(201, r, `rapport ${format}`);
  return r.json();
}

/** Identifiants des rapports listés pour `par` (toutes les pages). */
async function idsListes(par: Api, missionId: string): Promise<string[]> {
  const r = await par.get(liste(missionId, "?limite=100"));
  attendre(200, r, "liste des rapports");
  return r.json().elements.map((e: { id: string }) => e.id);
}

const compter = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => Number((await c.query(sql, params)).rows[0].n));

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Cabinet Rapports A");
  b = await preparerCabinet(ctx, "Cabinet Rapports B");
  m = await missionTemps(
    a,
    { Diagnostic: { senior: 10 }, Restitution: { manager: 4 } },
    { intitule: INTITULE },
  );
  attendre(
    201,
    await a.chef.post(`/api/missions/${m.id}/jalons`, {
      libelle: "Rapport de diagnostic",
      date_prevue: "2026-12-15",
      atteint: true,
    }),
    "jalon",
  );
  attendre(
    201,
    await a.chef.post(`/api/missions/${m.id}/jalons`, {
      libelle: "Restitution",
      date_prevue: "2027-01-20",
    }),
    "jalon",
  );
  attendre(
    200,
    await a.directeur.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }),
    "signature",
  );
  membre = await utilisateurCollaborateur(a, ["consultant"]);
  const collaborateurId = (membre as unknown as { collaborateurId: string }).collaborateurId;
  await affecter(a, m, collaborateurId, { Diagnostic: 5 });
  const equipe = async (u: Utilisateur) =>
    attendre(
      201,
      await a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: u.utilisateurId }),
      "équipe",
    );
  await equipe(membre);
  await feuilleValidee({
    cabinetId: a.cabinetId,
    collaborateurId,
    semaine: "2026-11-02",
    auteurId: membre.utilisateurId,
    lignes: [
      { date: "2026-11-02", missionId: m.id, tacheId: m.taches.Diagnostic as string, jours: 1 },
      { date: "2026-11-03", missionId: m.id, tacheId: m.taches.Diagnostic as string, jours: 1 },
      { date: "2026-11-04", missionId: m.id, tacheId: m.taches.Diagnostic as string, jours: 0.5 },
    ],
  });
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  expert = await a.avecRoles(["expert_metier"]);
  await equipe(expert);
});
afterAll(async () => {
  await ctx.fermer();
});

describe("droits et isolation", () => {
  it("401 sans session, 403 sans « mission.lire », 400 format inconnu (POST et GET)", async () => {
    expect((await api(ctx).post(url(m.id))).statusCode).toBe(401);
    expect((await api(ctx).get(liste(m.id))).statusCode).toBe(401);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.post(url(m.id))).statusCode).toBe(403);
    expect((await externe.get(liste(m.id))).statusCode).toBe(403);
    expect((await a.chef.post(url(m.id, "html"))).statusCode).toBe(400);
    expect((await a.chef.post(`/api/missions/${m.id}/rapports`)).statusCode).toBe(400);
    expect((await a.chef.get(liste(m.id, "?curseur=xyz"))).statusCode).toBe(400);
    expect((await a.chef.get(liste(m.id, "?limite=101"))).statusCode).toBe(400);
  });

  it("autre cabinet et mission invisible : 404 ; rien n'est écrit", async () => {
    expect((await b.associe.post(url(m.id))).statusCode).toBe(404);
    expect((await b.associe.get(liste(m.id))).statusCode).toBe(404);
    const etranger = await a.avecRoles(["consultant"]);
    expect((await etranger.post(url(m.id))).statusCode).toBe(404);
    expect((await etranger.get(liste(m.id))).statusCode).toBe(404);
    expect((await a.chef.post(url("00000000-0000-4000-8000-000000000000"))).statusCode).toBe(404);
    expect(
      await compter("SELECT count(*) AS n FROM rapports_mission WHERE mission_id = $1", [m.id]),
    ).toBe(0);
  });
});

describe("génération : niveau calculé, aucun document de mission", () => {
  it("chef de mission (sans finance.lire) : niveau « jours », chiffres du suivi, sans donnée financière ni document", async () => {
    const documents = () =>
      compter("SELECT count(*) AS n FROM mission_documents WHERE mission_id = $1", [m.id]);
    const documentsAvant = await documents();
    const r = await a.chef.post(url(m.id, "docx"));
    expect(r.statusCode, r.body).toBe(201);
    rJours = r.json();
    const corps = r.json();
    expect(corps.rapport).toMatchObject({ format: "docx", statut: "brouillon", niveau: "jours" });
    expect(corps).not.toHaveProperty("document");
    expect(corps.rapport).not.toHaveProperty("confidentiel");
    expect(corps.fichier.type_mime).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(JSON.stringify(corps)).not.toMatch(/cle_stockage|doublon_de/);
    // Non-régression : un rapport n'est plus une version de document de mission.
    expect(await documents()).toBe(documentsAvant);
    expect(
      await compter("SELECT count(*) AS n FROM mission_documents WHERE fichier_id = $1", [
        corps.fichier.id,
      ]),
    ).toBe(0);

    const { statut, xml } = await telecharger(a.chef, corps.fichier.id);
    expect(statut).toBe(200);
    // Chiffres issus du suivi : 14 j budgétés, 2,5 j réalisés validés ; jalons.
    const suivi = (await a.chef.get(`/api/missions/${m.id}/suivi`)).json();
    expect(suivi.arbre.budget).toBe(14);
    expect(suivi.arbre.realise).toBe(2.5);
    expect(xml).toContain("14 j");
    expect(xml).toContain("2,5 j");
    expect(xml).toContain("Rapport de diagnostic");
    expect(xml).toContain("Atteint");
    expect(xml).toContain("Brouillon");
    // Injection dans l'intitulé : texte échappé.
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;");
    // FIN-02 : aucune donnée financière.
    expect(xml).not.toMatch(/Marge|Honoraires|Coûts internes|Confidentiel/);

    // Lisible par l'équipe qui a « budget.lire_jours », invisible pour un autre cabinet.
    expect(await lire(membre, rJours)).toBe(200);
    expect(await lire(b.associe, rJours)).toBe(404);
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE action = 'generation_rapport' AND entite_id = $1",
            [m.id],
          )
        ).rows,
    );
    expect(audit[0].details).toMatchObject({ format: "docx", niveau: "jours" });
  });

  it("PPTX : présentation valide enregistrée", async () => {
    const r = await generer(a.chef, m.id, "pptx");
    const { xml } = await telecharger(a.chef, r.fichier.id);
    expect(xml).toContain("presentationml");
    expect(xml).toContain("Budget en jours par phase");
    expect(xml).not.toMatch(/Marge|Honoraires/);
  });

  it("associé : niveau « finance » ; lu par un gestionnaire (autre auteur), jamais par le chef ni l'équipe", async () => {
    rFinance = await generer(a.associe, m.id);
    expect(rFinance.rapport.niveau).toBe("finance");
    const { xml } = await telecharger(a.associe, rFinance.fichier.id);
    expect(xml).toContain("Données financières (confidentiel)");
    expect(xml).toMatch(/Coûts internes/);
    expect(xml).toMatch(/Taux de marge/);
    // Mêmes chiffres que l'analyse de rentabilité (moteur) : valeur produite de la mission.
    const rent = (
      await a.associe.get("/api/finance/rentabilite?du=2026-01-01&au=2026-12-31&niveau=mission")
    ).json();
    const ligne = rent.elements.find((e: { cle: string }) => e.cle === m.id);
    expect(ligne.valeur_produite).toBeGreaterThan(0);
    const milliers = String(ligne.valeur_produite).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
    expect(xml).toContain(`${milliers}\u00a0FCFA`);
    // Sans « finance.lire » : 404, même en voyant la mission.
    expect(await lire(a.chef, rFinance)).toBe(404);
    expect(await lire(membre, rFinance)).toBe(404);
    expect(await lire(a.directeur, rFinance)).toBe(404);
    // Avec « finance.lire » : lisible quel que soit l'auteur.
    expect(await lire(gestionnaire, rFinance)).toBe(200);
    // Pas orphelin : la purge ne l'efface pas, le retrait est refusé.
    const orphelin = await proprietaire(
      async (c) =>
        (await c.query("SELECT fichier_orphelin($1) AS o", [rFinance.fichier.id])).rows[0].o,
    );
    expect(orphelin).toBe(false);
    expect((await a.associe.delete(`/api/fichiers/${rFinance.fichier.id}`)).statusCode).toBe(409);
  });

  it("gestionnaire (finance.lire, sans document.ecrire) : rapport « finance » lu par l'associé", async () => {
    const r = await generer(gestionnaire, m.id, "pptx");
    expect(r.rapport.niveau).toBe("finance");
    const { xml } = await telecharger(gestionnaire, r.fichier.id);
    expect(xml).toContain("Marge");
    expect(await lire(a.associe, r)).toBe(200);
    expect(await lire(a.chef, r)).toBe(404);
  });

  it("expert métier (sans budget.lire_jours) : niveau « base » ; ne lit ni le rapport jours ni le finance", async () => {
    rBase = await generer(expert, m.id);
    expect(rBase.rapport.niveau).toBe("base");
    const { statut, xml } = await telecharger(expert, rBase.fichier.id);
    expect(statut).toBe(200);
    expect(xml).toContain("Jalons");
    expect(xml).toContain("Avancement physique");
    expect(xml).not.toContain("Budget en jours par phase");
    expect(xml).not.toContain("Temps consommé");
    expect(xml).not.toMatch(/Marge|Honoraires/);
    expect(await lire(expert, rJours)).toBe(404);
    expect(await lire(expert, rFinance)).toBe(404);
    // Le rapport « base » est lisible par toute l'équipe.
    expect(await lire(membre, rBase)).toBe(200);
  });

  it.skipIf(!navigateur)(
    `PDF réel enregistré${navigateur ? "" : " (SAUTÉ : aucun navigateur, définir CHROMIUM_PATH)"}`,
    async () => {
      const r = await a.chef.post(url(m.id, "pdf"));
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().fichier.type_mime).toBe("application/pdf");
      const f = await a.chef.get(`/api/fichiers/${r.json().fichier.id}`);
      expect(f.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    },
  );

  it("intitulé et client de 200 caractères : sous-titre tronqué, rapport généré (non-régression)", async () => {
    const client = await a.associe.post("/api/clients", { raison_sociale: "C".repeat(200) });
    attendre(201, client, "client");
    const longue = await creerMission(a, {
      intitule: "I".repeat(200),
      client_id: client.json().id,
    });
    const r = await a.chef.post(url(longue.id));
    expect(r.statusCode, r.body).toBe(201);
    const { xml } = await telecharger(a.chef, r.json().fichier.id);
    expect(xml).toContain(`${"I".repeat(89)}… — ${"C".repeat(89)}…`);
    // Le tableau « Mission » garde l'intitulé complet (plafond des cellules : 300).
    expect(xml).toContain("I".repeat(200));
  });

  it("mission clôturée : 409", async () => {
    const autre = await missionTemps(a, { Unique: { junior: 1 } }, { intitule: "Clôturée" });
    attendre(
      200,
      await a.directeur.post(`/api/missions/${autre.id}/signer`, { date_signature: "2026-10-01" }),
      "signature",
    );
    await proprietaire((c) =>
      c.query(
        "UPDATE missions SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2 WHERE id = $1",
        [autre.id, a.associeId],
      ),
    );
    expect((await a.chef.post(url(autre.id))).statusCode).toBe(409);
  });
});

describe("GET /missions/:id/rapports : seulement les rapports lisibles", () => {
  it("filtré par niveau ; métadonnées sans clé de stockage ; plus récent d'abord", async () => {
    const chef = await idsListes(a.chef, m.id);
    expect(chef).toContain(rJours.rapport.id);
    expect(chef).toContain(rBase.rapport.id);
    expect(chef).not.toContain(rFinance.rapport.id);
    const associe = await idsListes(a.associe, m.id);
    expect(associe).toEqual(expect.arrayContaining([rJours.rapport.id, rFinance.rapport.id]));
    expect(await idsListes(expert, m.id)).toEqual([rBase.rapport.id]);
    expect(await idsListes(gestionnaire, m.id)).toContain(rFinance.rapport.id);

    const r = await a.associe.get(liste(m.id));
    expect(JSON.stringify(r.json())).not.toMatch(/cle_stockage|cle_tri/);
    const e = r.json().elements.find((x: { id: string }) => x.id === rFinance.rapport.id);
    expect(e).toMatchObject({
      mission_id: m.id,
      modele: "etat_avancement",
      format: "docx",
      niveau: "finance",
      fichier: { id: rFinance.fichier.id },
    });
    const dates = r.json().elements.map((x: { genere_le: string }) => Date.parse(x.genere_le));
    expect([...dates].sort((x, y) => y - x)).toEqual(dates);
  });

  it("pagination par curseur : pages disjointes qui couvrent toute la liste", async () => {
    const tout = await idsListes(a.associe, m.id);
    expect(tout.length).toBeGreaterThanOrEqual(3);
    const vus: string[] = [];
    let curseur: string | null = null;
    do {
      const q: string = `?limite=2${curseur ? `&curseur=${curseur}` : ""}`;
      const page = (await a.associe.get(liste(m.id, q))).json();
      expect(page.elements.length).toBeLessThanOrEqual(2);
      vus.push(...page.elements.map((x: { id: string }) => x.id));
      curseur = page.curseur_suivant;
    } while (curseur);
    expect(vus).toEqual(tout);
  });

  it("un document téléversé sous le nom d'un rapport n'apparaît pas comme rapport", async () => {
    const avant = await idsListes(a.chef, m.id);
    const f = await televerser(
      membre,
      "/api/fichiers",
      "Etat d'avancement.docx",
      ECHANTILLONS.docx(),
    );
    attendre(201, f, "téléversement");
    attendre(
      201,
      await membre.post(`/api/missions/${m.id}/documents`, {
        type: "autre",
        nom: "État d'avancement (DOCX)",
        fichier_id: f.json().id,
      }),
      "document",
    );
    expect(await idsListes(a.chef, m.id)).toEqual(avant);
    expect(
      await compter("SELECT count(*) AS n FROM rapports_mission WHERE fichier_id = $1", [
        f.json().id,
      ]),
    ).toBe(0);
  });
});

describe("accès revérifié à chaque lecture", () => {
  it("retiré de l'équipe : plus de lecture ni de liste", async () => {
    const passager = await a.avecRoles(["consultant"]);
    attendre(
      201,
      await a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: passager.utilisateurId }),
      "équipe",
    );
    expect(await lire(passager, rJours)).toBe(200);
    attendre(
      200,
      await a.chef.delete(`/api/missions/${m.id}/equipe/${passager.utilisateurId}`),
      "retrait",
    );
    expect(await lire(passager, rJours)).toBe(404);
    expect(await lire(passager, rBase)).toBe(404);
    expect((await passager.get(liste(m.id))).statusCode).toBe(404);
  });

  it("rôle rétrogradé (gestionnaire → ressources) : perd le rapport « finance » immédiatement", async () => {
    const g = await a.avecRoles(["gestionnaire"]);
    expect(await lire(g, rFinance)).toBe(200);
    attendre(
      200,
      await a.associe.patch(`/api/utilisateurs/${g.utilisateurId}`, { roles: ["ressources"] }),
      "rétrogradation",
    );
    expect(await lire(g, rFinance)).toBe(404);
    expect(await idsListes(g, m.id)).not.toContain(rFinance.rapport.id);
    // Garde « budget.lire_jours » et la visibilité de toutes les missions.
    expect(await lire(g, rJours)).toBe(200);
  });
});

describe("débit : au plus 10 générations par utilisateur sur 10 minutes", () => {
  it("429 TROP_DE_RAPPORTS au-delà, y compris pour deux demandes simultanées ; rien n'est écrit", async () => {
    const dir = await a.avecRoles(["directeur_mission"]);
    for (let i = 0; i < RAPPORTS_PAR_FENETRE - 1; i++) await generer(dir, m.id);
    // Deux demandes simultanées pour la dernière place : une seule passe (compte sous verrou).
    const [x, y] = await Promise.all([dir.post(url(m.id)), dir.post(url(m.id))]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 429]);
    const refus = x.statusCode === 429 ? x : y;
    expect(refus.json().erreur.code).toBe("TROP_DE_RAPPORTS");
    const r = await dir.post(url(m.id));
    expect(r.statusCode).toBe(429);
    expect(r.json().erreur.code).toBe("TROP_DE_RAPPORTS");
    expect(
      await compter("SELECT count(*) AS n FROM rapports_mission WHERE genere_par = $1", [
        dir.utilisateurId,
      ]),
    ).toBe(RAPPORTS_PAR_FENETRE);
    // Aucun fichier en trop : le refus sous verrou annule aussi l'enregistrement du fichier.
    expect(
      await compter("SELECT count(*) AS n FROM fichiers WHERE envoye_par = $1", [
        dir.utilisateurId,
      ]),
    ).toBe(RAPPORTS_PAR_FENETRE);
    // Un autre utilisateur n'est pas concerné.
    await generer(a.directeur, m.id);
  });
});

describe("portail client : aucun accès aux rapports", () => {
  it("routes refusées et table invisible dans une transaction du portail (politique portail_interdit)", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    expect((await client.get(liste(m.id))).statusCode).toBe(403);
    expect((await client.post(url(m.id))).statusCode).toBe(403);
    expect(await lire(client, rBase)).toBe(403);

    const vue = (portail: boolean) =>
      ctx.db.withTenant(a.cabinetId, async (db) => {
        if (portail) {
          await db.query("SELECT set_config('app.portail_client_id', $1, true)", [a.clientId]);
        }
        const n = async (sql: string, p: unknown[] = []) =>
          (await db.query(sql, p)).rows[0].n as number;
        return {
          rapports: await n("SELECT count(*)::int AS n FROM rapports_mission"),
          fichiers: await n("SELECT count(*)::int AS n FROM fichiers WHERE id = ANY ($1::uuid[])", [
            [rBase.fichier.id, rJours.fichier.id, rFinance.fichier.id],
          ]),
        };
      });
    expect((await vue(false)).rapports).toBeGreaterThan(0);
    expect((await vue(false)).fichiers).toBe(3);
    expect(await vue(true)).toEqual({ rapports: 0, fichiers: 0 });
    await expect(
      ctx.db.withTenant(a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [a.clientId]);
        await db.query(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut,
             niveau, genere_par)
           VALUES ($1, $2, $3, 'etat_avancement', 'docx', 'brouillon', 'base', $4)`,
          [a.cabinetId, m.id, rBase.fichier.id, a.associeId],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("table en ajout seul pour le rôle applicatif ; niveau inconnu refusé", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE rapports_mission SET niveau = 'base' WHERE id = $1", [
          rFinance.rapport.id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("DELETE FROM rapports_mission WHERE id = $1", [rFinance.rapport.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut,
             niveau, genere_par)
           SELECT cabinet_id, mission_id, gen_random_uuid(), modele, format, statut, 'public', genere_par
           FROM rapports_mission WHERE id = $1`,
          [rBase.rapport.id],
        ),
      ),
    ).rejects.toThrow(/check constraint|violates/);
  });
});
