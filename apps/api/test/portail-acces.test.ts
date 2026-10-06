import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LISTE_BLANCHE_PORTAIL, routeOuverteAuPortail } from "../src/portail/garde.js";
import { api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  CLE_INTERDITE,
  clesDe,
  preparerPortail,
  type ScenarioPortail,
  type UtilisateurPortail,
} from "./portail-outils.js";

/*
 * Portail client (SOC-09) : autorisation, liste blanche, IDOR, données
 * financières internes, défense en profondeur RLS, validation de jalon.
 */

let ctx: Contexte;
let s: ScenarioPortail;
const INCONNU = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerPortail(ctx);
}, 180_000);
afterAll(() => ctx.fermer());

/** URL concrète d'un motif de route : identifiants réels du scénario quand ils ont un sens. */
function urlDe(motif: string): string {
  return motif
    .replace(/^\/api\/portail\/missions\/:id/, `/api/portail/missions/${s.missionId}`)
    .replace(/^\/api\/portail\/factures\/:id/, `/api/portail/factures/${s.factureId}`)
    .replace(/^\/api\/portail\/livrables\/:id/, `/api/portail/livrables/${s.documentId}`)
    .replace(/:jalonId/, s.jalonNonAtteint)
    .replace(/:[A-Za-z_]+/g, INCONNU)
    .replace(/\*$/, "x");
}

async function appeler(u: UtilisateurPortail, methode: string, url: string) {
  return ctx.app.inject({
    method: methode as "GET",
    url,
    headers: { cookie: u.cookie },
    ...(methode === "GET" || methode === "HEAD" ? {} : { payload: {} }),
  });
}

describe("liste blanche stricte : parcours de TOUTES les routes enregistrées", () => {
  it("l'inventaire des routes est complet", () => {
    const routes = ctx.app.routesInventoriees;
    expect(routes.length).toBeGreaterThan(200);
    expect(routes).toContainEqual({ methode: "GET", motif: "/api/missions" });
    expect(routes).toContainEqual({ methode: "GET", motif: "/api/portail/missions" });
  });

  it("un utilisateur du portail n'obtient 2xx QUE sur la liste blanche ; ailleurs 403 avant tout accès", async () => {
    const succes: string[] = [];
    const hors: string[] = [];
    for (const { methode, motif } of ctx.app.routesInventoriees) {
      if (methode === "OPTIONS" || motif === "/api/auth/deconnexion") continue;
      for (const u of [s.contributeur, s.dirigeant]) {
        // Le dirigeant ne fait que des lectures (sa validation de jalon est testée plus bas).
        if (u === s.dirigeant && methode !== "GET") continue;
        const r = await appeler(u, methode, urlDe(motif));
        expect(r.statusCode, `${methode} ${motif}`).toBeLessThan(500);
        const ouverte = routeOuverteAuPortail(methode, motif);
        if (!ouverte) {
          expect(r.statusCode, `${methode} ${motif}`).toBe(403);
          if (methode !== "HEAD") expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
          hors.push(motif);
        } else if (r.statusCode < 300) {
          succes.push(`${methode} ${motif}`);
          if (methode !== "HEAD" && /json/.test(String(r.headers["content-type"]))) {
            const interdites = clesDe(r.json()).filter((k) => CLE_INTERDITE.test(k));
            expect(interdites, `${methode} ${motif}`).toEqual([]);
          }
        }
      }
    }
    expect(hors.length).toBeGreaterThan(150);
    for (const ok of succes) {
      expect(ok).toMatch(/ \/api\/(portail\/|auth\/|sante$|notifications)/);
    }
    // Lectures essentielles du portail effectivement servies.
    expect(succes).toEqual(
      expect.arrayContaining([
        "GET /api/portail/moi",
        "GET /api/portail/missions",
        "GET /api/portail/missions/:id/jalons",
        "GET /api/portail/missions/:id/livrables",
        "GET /api/portail/factures",
        "GET /api/portail/factures/:id",
      ]),
    );
  }, 300_000);

  it("routes internes sensibles : journal, utilisateurs, collaborateurs, grades, fichiers, commentaires", async () => {
    for (const url of [
      "/api/audit",
      "/api/utilisateurs",
      "/api/collaborateurs",
      "/api/grades",
      "/api/missions",
      `/api/missions/${s.missionId}`,
      `/api/factures/${s.factureId}/document`,
      "/api/auth/2fa/politique",
      `/api/fichiers/${INCONNU}`,
      `/api/commentaires?entite_type=mission&entite_id=${s.missionId}`,
    ]) {
      const r = await s.dirigeant.get(url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("inventaire /api/portail/* : chaque motif est listé, sinon 403 pour les trois rôles client", async () => {
    const listees = new Set(
      LISTE_BLANCHE_PORTAIL.flatMap((r) => r.methodes.map((m) => `${m} ${r.motif}`)),
    );
    const enregistrees = new Set(ctx.app.routesInventoriees.map((r) => `${r.methode} ${r.motif}`));
    // Aucune entrée périmée ni joker : chaque entrée désigne une route enregistrée.
    for (const cle of listees) expect(enregistrees.has(cle), cle).toBe(true);
    const portail = ctx.app.routesInventoriees.filter(
      (r) => r.motif.startsWith("/api/portail/") && r.methode !== "OPTIONS",
    );
    expect(portail.length).toBeGreaterThan(25);
    const fermees: string[] = [];
    for (const { methode, motif } of portail) {
      if (listees.has(`${methode} ${motif}`)) continue;
      fermees.push(`${methode} ${motif}`);
      for (const u of [s.dirigeant, s.contributeur, s.investisseur]) {
        const r = await appeler(u, methode, urlDe(motif));
        expect(r.statusCode, `${methode} ${motif}`).toBe(403);
        if (methode !== "HEAD") expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
      }
    }
    // Gestion du portail (portail.gerer, cabinet.gerer) : fermée au client par la garde.
    expect(fermees).toEqual(
      expect.arrayContaining([
        "POST /api/portail/invitations",
        "DELETE /api/portail/invitations/:id",
        "GET /api/portail/utilisateurs",
        "POST /api/portail/utilisateurs/:id/desactiver",
        "GET /api/portail/partages",
        "PUT /api/portail/partages",
        "GET /api/portail/parametres",
        "PUT /api/portail/parametres",
      ]),
    );
  }, 120_000);

  it("route inconnue : 404 ordinaire ; sans session : 401", async () => {
    expect((await s.dirigeant.get("/api/nexiste-pas")).statusCode).toBe(404);
    expect((await api(ctx).get("/api/portail/missions")).statusCode).toBe(401);
  });

  it("un utilisateur interne n'accède pas aux lectures du portail (403)", async () => {
    for (const u of [s.a.associe, s.a.chef, s.a.gestionnaire]) {
      expect((await u.get("/api/portail/missions")).statusCode).toBe(403);
      expect((await u.get("/api/portail/moi")).statusCode).toBe(403);
    }
  });
});

describe("contenu servi : partages explicites seulement", () => {
  it("profil : entreprise, contact principal choisi, résumé des partages", async () => {
    const r = await s.dirigeant.get("/api/portail/moi");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      entreprise: { id: s.a.clientId },
      contact_principal: { nom: expect.any(String) },
      partages: { missions: 1, documents: 1, factures: true },
    });
    const moi = (await s.dirigeant.get("/api/auth/moi")).json();
    expect(moi.portail).toBe(true);
    expect(moi.utilisateur.roles).toEqual(["client_dirigeant"]);
  });

  it("résumé des partages limité aux droits du rôle (investisseur : aucun compte)", async () => {
    const partages = async (u: UtilisateurPortail) =>
      (await u.get("/api/portail/moi")).json().partages as Record<string, unknown>;
    expect(await partages(s.dirigeant)).toEqual({ missions: 1, documents: 1, factures: true });
    expect(await partages(s.contributeur)).toEqual({ missions: 1, documents: 1 });
    expect(await partages(s.investisseur)).toEqual({});
  });

  it("missions : seule la mission partagée, sans budget, équipe ni responsable", async () => {
    const r = await s.dirigeant.get("/api/portail/missions");
    expect(r.statusCode).toBe(200);
    expect(r.json().elements).toEqual([
      {
        id: s.missionId,
        intitule: expect.any(String),
        statut: expect.any(String),
        date_debut: expect.any(String),
        date_fin: expect.any(String),
        partage: { jalons: true, factures: true },
      },
    ]);
  });

  it("jalons et livrables : uniquement ce qui est partagé, jamais un brouillon IA", async () => {
    const j = (await s.contributeur.get(`/api/portail/missions/${s.missionId}/jalons`)).json();
    // Tous les jalons de la mission partagée (ceux du modèle de mission compris), et eux seuls.
    const internes = await proprietaire(
      async (c) =>
        (await c.query("SELECT id FROM mission_jalons WHERE mission_id = $1", [s.missionId])).rows,
    );
    expect(j.elements.map((x: { id: string }) => x.id).sort()).toEqual(
      internes.map((x) => x.id as string).sort(),
    );
    expect(j.elements.map((x: { id: string }) => x.id)).toEqual(
      expect.arrayContaining([s.jalonAtteint, s.jalonNonAtteint]),
    );
    expect(Object.keys(j.elements[0]).sort()).toEqual(
      ["atteint", "date_prevue", "id", "libelle", "validation"].sort(),
    );
    const l = (await s.contributeur.get(`/api/portail/missions/${s.missionId}/livrables`)).json();
    expect(l.elements).toEqual([
      expect.objectContaining({ id: s.documentId, telechargeable: true, type: "livrable" }),
    ]);
    expect(JSON.stringify(l)).not.toContain(s.documentNonPartage);
    expect(JSON.stringify(l)).not.toContain(s.documentBrouillonIa);
  });

  it("téléchargement d'un livrable partagé ; non partagé = 404", async () => {
    const r = await s.contributeur.get(`/api/portail/livrables/${s.documentId}/fichier`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.rawPayload.equals(s.contenuLivrable)).toBe(true);
    expect(
      (await s.contributeur.get(`/api/portail/livrables/${s.documentNonPartage}/fichier`))
        .statusCode,
    ).toBe(404);
  });

  it("factures émises : totaux et statut de paiement dérivé ; document HTML aux lignes masquées", async () => {
    const r = (await s.dirigeant.get("/api/portail/factures")).json();
    expect(r.elements).toHaveLength(1);
    expect(r.elements[0]).toMatchObject({
      id: s.factureId,
      statut: "emise",
      numero: expect.any(String),
      paiement: { statut_paiement: expect.any(String) },
      mission: { id: s.missionId },
    });
    const d = await s.dirigeant.get(`/api/portail/factures/${s.factureId}/document`);
    expect(d.statusCode).toBe(200);
    expect(d.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(d.body).toContain(r.elements[0].numero);
    expect(d.body).toContain("—");
    // Le contributeur ne lit pas les factures ; l'investisseur ne lit que son profil.
    expect((await s.contributeur.get("/api/portail/factures")).statusCode).toBe(403);
    expect((await s.investisseur.get("/api/portail/missions")).statusCode).toBe(403);
    expect((await s.investisseur.get("/api/portail/moi")).statusCode).toBe(200);
  });
});

describe("IDOR : rien du client voisin ni d'un autre cabinet ; 404 identique", () => {
  it("même 404 pour une ressource inexistante, non partagée, d'un autre client ou cabinet", async () => {
    const reference = await s.dirigeant.get(`/api/portail/missions/${INCONNU}`);
    expect(reference.statusCode).toBe(404);
    const cas: [UtilisateurPortail, string][] = [
      [s.dirigeant, `/api/portail/missions/${s.missionNonPartagee}`],
      [s.dirigeant, `/api/portail/missions/${s.missionA2}`],
      [s.dirigeantA2, `/api/portail/missions/${s.missionId}`],
      [s.dirigeantA2, `/api/portail/missions/${s.missionId}/jalons`],
      [s.dirigeantA2, `/api/portail/missions/${s.missionId}/livrables`],
      [s.dirigeantA2, `/api/portail/factures/${s.factureId}`],
      [s.dirigeantA2, `/api/portail/factures/${s.factureId}/document`],
      [s.dirigeantA2, `/api/portail/livrables/${s.documentId}/fichier`],
      [s.dirigeantB, `/api/portail/missions/${s.missionId}`],
      [s.dirigeantB, `/api/portail/factures/${s.factureId}`],
      [s.dirigeantB, `/api/portail/livrables/${s.documentId}/fichier`],
    ];
    for (const [u, url] of cas) {
      const r = await u.get(url);
      expect(r.statusCode, url).toBe(404);
      expect(r.body, url).toBe(reference.body);
    }
  });

  it("listes : le client voisin ne voit que sa mission, l'autre cabinet rien ; aucune facture", async () => {
    const a2 = (await s.dirigeantA2.get("/api/portail/missions")).json().elements;
    expect(a2.map((m: { id: string }) => m.id)).toEqual([s.missionA2]);
    expect((await s.dirigeantA2.get("/api/portail/factures")).json().elements).toEqual([]);
    expect((await s.dirigeantB.get("/api/portail/missions")).json().elements).toEqual([]);
    // Mission partagée SANS jalons : 404 sur ses jalons.
    expect(
      (await s.dirigeantA2.get(`/api/portail/missions/${s.missionA2}/jalons`)).statusCode,
    ).toBe(404);
  });
});

describe("défense en profondeur : RLS du portail (migration 0113)", () => {
  it("avec app.portail_client_id, les tables internes sont vides et seules les lignes partagées restent", async () => {
    const compter = (client: string | null) =>
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        if (client)
          await db.query("SELECT set_config('app.portail_client_id', $1, true)", [client]);
        const n = async (sql: string) => (await db.query(sql)).rows[0].n as number;
        return {
          missions: await n("SELECT count(*)::int AS n FROM missions"),
          factures: await n("SELECT count(*)::int AS n FROM factures"),
          clients: await n("SELECT count(*)::int AS n FROM clients"),
          documents: await n("SELECT count(*)::int AS n FROM mission_documents"),
          couts: await n("SELECT count(*)::int AS n FROM collaborateur_couts"),
          grades: await n("SELECT count(*)::int AS n FROM grades"),
          budget: await n("SELECT count(*)::int AS n FROM budget_lignes"),
          equipe: await n("SELECT count(*)::int AS n FROM mission_equipe"),
          journal: await n("SELECT count(*)::int AS n FROM journal_audit"),
          parametres: await n("SELECT count(*)::int AS n FROM parametres_facturation"),
        };
      });
    const interne = await compter(null);
    expect(interne.missions).toBeGreaterThanOrEqual(3);
    expect(interne.couts).toBeGreaterThan(0);
    expect(interne.journal).toBeGreaterThan(0);
    expect(await compter(s.a.clientId)).toEqual({
      missions: 1,
      factures: 1,
      clients: 1,
      documents: 1,
      couts: 0,
      grades: 0,
      budget: 0,
      equipe: 0,
      journal: 0,
      parametres: 0,
    });
    expect((await compter(s.clientA2)).missions).toBe(1);
    expect((await compter(s.clientA2)).factures).toBe(0);
  });

  it("une écriture interne est refusée dans une transaction du portail", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
        await db.query(
          "INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id) VALUES ($1, $2, $3)",
          [s.a.cabinetId, s.missionId, s.a.associeId],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("validation d'un jalon par le dirigeant client", () => {
  it("contributeur 403 ; jalon non atteint 409 ; jalon d'autrui 404", async () => {
    const url = (j: string, m = s.missionId) => `/api/portail/missions/${m}/jalons/${j}/valider`;
    expect((await s.contributeur.post(url(s.jalonAtteint))).statusCode).toBe(403);
    expect((await s.dirigeant.post(url(s.jalonNonAtteint))).statusCode).toBe(409);
    expect((await s.dirigeantA2.post(url(s.jalonAtteint))).statusCode).toBe(404);
    expect((await s.dirigeant.post(url(s.jalonAtteint, s.missionA2))).statusCode).toBe(404);
    expect((await s.dirigeant.post(url(s.jalonAtteint), { atteint: true })).statusCode).toBe(400);
  });

  it("validation horodatée, définitive, tracée, notifiée au chef ; le jalon interne est inchangé", async () => {
    const avant = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT atteint, modifie_le FROM mission_jalons WHERE id = $1", [
            s.jalonAtteint,
          ])
        ).rows[0],
    );
    const url = `/api/portail/missions/${s.missionId}/jalons/${s.jalonAtteint}/valider`;
    const r = await s.dirigeant.post(url, { commentaire: "Conforme au compte rendu." });
    expect(r.statusCode).toBe(201);
    expect(r.json().validation).toMatchObject({ valide_par_moi: true });
    expect((await s.dirigeant.post(url)).statusCode).toBe(409);

    const apres = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT atteint, modifie_le FROM mission_jalons WHERE id = $1", [
            s.jalonAtteint,
          ])
        ).rows[0],
    );
    expect(apres).toEqual(avant);
    const jalons = (await s.contributeur.get(`/api/portail/missions/${s.missionId}/jalons`)).json();
    const vu = jalons.elements.find((j: { id: string }) => j.id === s.jalonAtteint);
    expect(vu.validation).toMatchObject({
      commentaire: "Conforme au compte rendu.",
      valide_par_moi: false,
    });
    const notes = (await s.a.chef.get("/api/notifications")).json().elements;
    expect(notes.some((n: { type?: string; titre: string }) => /Jalon validé/.test(n.titre))).toBe(
      true,
    );
    // Historique en ajout seul, même pour le rôle applicatif.
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE portail_validations_jalons SET commentaire = 'x'"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("journalisation des accès du portail", () => {
  it("lectures, téléchargement et validation sont tracés (qui, quoi, entité)", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT action, entite FROM journal_audit
             WHERE utilisateur_id = $1 AND details->>'portail' = 'true'`,
            [s.contributeur.utilisateurId],
          )
        ).rows as { action: string; entite: string }[],
    );
    const vus = new Set(lignes.map((l) => `${l.action}:${l.entite}`));
    expect(vus).toContain("portail_lecture:missions");
    expect(vus).toContain("portail_lecture:mission_jalons");
    expect(vus).toContain("telechargement:mission_document");
  });
});
