import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAPPORTS_PAR_FENETRE } from "../src/rapports/enregistrement.js";
import { cheminNavigateur } from "../src/rapports/pdf.js";
import { api, type Api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { configTest, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";

/*
 * Rapport d'état financier du dossier client (migration 0552) : POST
 * /api/dossiers/:id/rapports/etat-financier. Droits (mission.lire + dossier.lire), dossier et
 * mission visibles, mission du client, états ACCEPTÉS seulement, chiffres du moteur de synthèse,
 * aucune donnée FIN-02, commentaire du consultant, niveau « dossier » (liste et lecture du
 * fichier), portail client fermé, débit.
 */

type Utilisateur = Api & { utilisateurId: string };
interface RapportCree {
  rapport: { id: string; niveau: string; modele: string; format: string };
  fichier: { id: string };
}

const INCONNU = "00000000-0000-4000-8000-000000000000";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let missionId: string;
let missionB: string;
let gestionnaire: Utilisateur;
let expert: Utilisateur;
let consultantHors: Utilisateur;
const navigateur = cheminNavigateur(configTest());

const url = (clientId: string, mission: string, q = "") =>
  `/api/dossiers/${clientId}/rapports/etat-financier?format=docx&mission_id=${mission}${q}`;
const liste = (id: string) => `/api/missions/${id}/rapports?limite=100`;

function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

const compter = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => Number((await c.query(sql, params)).rows[0].n));

const lignes = (surcharge: Record<string, number> = {}) =>
  [
    { code: "AZ", libelle: "Actif immobilisé", section: "actif", montant: 700 },
    { code: "BT", libelle: "Trésorerie", section: "actif", montant: 500 },
    { code: "BZ", libelle: "Total actif", section: "actif", montant: 1200, role: "total" },
    { code: "CA", libelle: "Capital", section: "passif", montant: 600 },
    { code: "CJ", libelle: "Résultat", section: "passif", montant: 200, role: "resultat_exercice" },
    { code: "DJ", libelle: "Fournisseurs", section: "passif", montant: 400 },
    { code: "RA", libelle: "Achats", section: "charges", montant: 500 },
    { code: "TA", libelle: "Ventes", section: "produits", montant: 700 },
  ].map((l) => ({ ...l, montant: surcharge[l.code] ?? l.montant }));

/** Exercice 2024 : actif 1 000, produits 500, charges 400, résultat 100. */
const lignes2024 = () =>
  lignes({ AZ: 600, BT: 400, BZ: 1000, CA: 500, CJ: 100, DJ: 400, RA: 400, TA: 500 });

const etat = (exercice: number, l: unknown[], corps: Record<string, unknown> = {}) => ({
  exercice,
  date_cloture: `${exercice}-12-31`,
  devise: "XOF",
  source_libelle: `Liasse ${exercice}`,
  lignes: l,
  ...corps,
});

async function deposer(par: Api, clientId: string, corps: unknown) {
  const r = await par.post(`/api/dossiers/${clientId}/etats-financiers`, corps);
  attendre(201, r, "dépôt d'un état");
  return r.json() as { id: string; statut: string };
}

async function generer(par: Api, clientId: string, mission: string, q = "", corps?: unknown) {
  const r = await par.post(url(clientId, mission, q), corps);
  attendre(201, r, "rapport d'état financier");
  return r.json() as RapportCree;
}

async function texte(par: Api, r: RapportCree): Promise<string> {
  const f = await par.get(`/api/fichiers/${r.fichier.id}`);
  attendre(200, f, "lecture du rapport");
  return toutLeXml(dezipper(f.rawPayload));
}

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Cabinet Etat Financier A");
  b = await preparerCabinet(ctx, "Cabinet Etat Financier B");
  missionId = (await creerMission(a, { intitule: "Diagnostic financier" })).id;
  missionB = (await creerMission(b, { intitule: "Mission B" })).id;
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  expert = await a.avecRoles(["expert_metier"]);
  consultantHors = await a.avecRoles(["consultant"]);
  attendre(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: expert.utilisateurId,
    }),
    "équipe",
  );
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("droits, visibilité et cohérence mission/client", () => {
  it("401 sans session ; 403 sans mission.lire ou sans dossier.lire ; 400 requête invalide", async () => {
    const u = url(a.clientId, missionId);
    expect((await api(ctx).post(u)).statusCode).toBe(401);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.post(u)).statusCode).toBe(403);
    // mission.lire sans dossier.lire : gestionnaire et ressources.
    expect((await gestionnaire.post(u)).statusCode).toBe(403);
    expect((await (await a.avecRoles(["ressources"])).post(u)).statusCode).toBe(403);
    expect(
      (await a.chef.post(`/api/dossiers/${a.clientId}/rapports/etat-financier`)).statusCode,
    ).toBe(400);
    expect((await a.chef.post(url(a.clientId, missionId).replace("docx", "pptx"))).statusCode).toBe(
      400,
    );
    expect((await a.chef.post(url(a.clientId, "pas-un-uuid"))).statusCode).toBe(400);
    expect((await a.chef.post(url(a.clientId, missionId, "&exercices=9"))).statusCode).toBe(400);
    expect((await a.chef.post(url(a.clientId, missionId, "&inconnu=1"))).statusCode).toBe(400);
    expect(
      (await a.chef.post(url(a.clientId, missionId), { commentaire: "x".repeat(4001) })).statusCode,
    ).toBe(400);
    expect((await a.chef.post(url(a.clientId, missionId), { autre: "x" })).statusCode).toBe(400);
  });

  it("consultant hors équipe, autre cabinet, dossier ou mission inconnus : 404 ; rien n'est écrit", async () => {
    expect((await consultantHors.post(url(a.clientId, missionId))).statusCode).toBe(404);
    expect((await b.associe.post(url(a.clientId, missionId))).statusCode).toBe(404);
    // Dossier d'un autre cabinet avec une mission du sien.
    expect((await a.associe.post(url(b.clientId, missionId))).statusCode).toBe(404);
    expect((await a.associe.post(url(INCONNU, missionId))).statusCode).toBe(404);
    expect((await a.chef.post(url(a.clientId, INCONNU))).statusCode).toBe(404);
    expect((await a.chef.post(url(a.clientId, missionB))).statusCode).toBe(404);
    expect(
      await compter(
        "SELECT count(*) AS n FROM rapports_mission WHERE modele = 'etat_financier'",
        [],
      ),
    ).toBe(0);
  });

  it("mission d'un autre client : 400 ; mission clôturée : 409", async () => {
    const autreClient = await a.associe.post("/api/clients", { raison_sociale: "Autre client" });
    attendre(201, autreClient, "client");
    const autre = await creerMission(a, { client_id: autreClient.json().id, intitule: "Autre" });
    const r = await a.associe.post(url(a.clientId, autre.id));
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur).toMatchObject({
      code: "REQUETE_INVALIDE",
      message: "La mission n'est pas celle de ce client.",
    });
    // Le dossier du client A avec la mission du client B (même cabinet) : 400 aussi.
    expect((await a.associe.post(url(autreClient.json().id, missionId))).statusCode).toBe(400);

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
    expect((await a.associe.post(url(autreClient.json().id, autre.id))).statusCode).toBe(409);
  });
});

describe("états retenus : acceptés, courants, plus récents", () => {
  it("aucun état accepté (en revue ou rejeté seulement) : 409 AUCUN_ETAT_ACCEPTE", async () => {
    const dossier = a.clientId;
    // Aucun état du tout.
    const vide = await a.chef.post(url(dossier, missionId));
    expect(vide.statusCode).toBe(409);
    expect(vide.json().erreur).toMatchObject({
      code: "AUCUN_ETAT_ACCEPTE",
      message: "Aucun état financier accepté dans le dossier de ce client.",
    });
    // 2026 : en écart, reste en revue (montant 5 555 ne doit jamais apparaître).
    const enRevue = await deposer(a.chef, dossier, etat(2026, lignes({ DJ: 5555 })));
    expect(enRevue.statut).toBe("en_revue");
    // 2023 : incomplet, rejeté (montant 7 777).
    const incomplet = await deposer(
      a.chef,
      dossier,
      etat(2023, [
        { code: "A1", libelle: "Actif", section: "actif", montant: 7777 },
        { code: "P1", libelle: "Passif", section: "passif", montant: 7777 },
      ]),
    );
    attendre(
      200,
      await a.chef.post(`/api/dossiers/${dossier}/etats-financiers/${incomplet.id}/decision`, {
        decision: "rejete",
        motif: "Compte de résultat manquant",
      }),
      "rejet",
    );
    const r = await a.chef.post(url(dossier, missionId));
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("AUCUN_ETAT_ACCEPTE");
    expect(
      await compter(
        "SELECT count(*) AS n FROM rapports_mission WHERE modele = 'etat_financier'",
        [],
      ),
    ).toBe(0);
  });

  it("devises mêlées : erreur claire (400) ; limitée à un exercice, le rapport est produit", async () => {
    const client = await a.associe.post("/api/clients", { raison_sociale: "Client bi-devise" });
    attendre(201, client, "client");
    const clientId = client.json().id as string;
    const mission = await creerMission(a, { client_id: clientId, intitule: "Bi-devise" });
    await deposer(a.chef, clientId, etat(2024, lignes2024()));
    await deposer(a.chef, clientId, etat(2025, lignes(), { devise: "EUR" }));
    const r = await a.chef.post(url(clientId, mission.id));
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("DEVISES_MIXTES");
    expect((await a.chef.post(url(clientId, mission.id, "&exercices=1"))).statusCode).toBe(201);
  });
});

describe("contenu du rapport (états acceptés, chiffres du moteur)", () => {
  let rapport: RapportCree;
  let xml: string;

  beforeAll(async () => {
    const dossier = a.clientId;
    await deposer(a.chef, dossier, etat(2024, lignes2024()));
    // Première version de 2025 (9 999) remplacée par la version retenue.
    await deposer(
      a.chef,
      dossier,
      etat(
        2025,
        lignes({ AZ: 5000, BT: 4999, BZ: 9999, CA: 5000, CJ: 100, DJ: 4899, RA: 400, TA: 500 }),
      ),
    );
    await deposer(
      a.chef,
      dossier,
      etat(2025, lignes(), { source_libelle: "Liasse 2025 corrigée" }),
    );
    rapport = await generer(a.chef, dossier, missionId);
    xml = await texte(a.chef, rapport);
  });

  it("201, modèle et niveau « dossier », fichier Word, brouillon confidentiel", async () => {
    expect(rapport.rapport).toMatchObject({
      modele: "etat_financier",
      niveau: "dossier",
      format: "docx",
    });
    expect(xml).toMatch(/Rapport d(&apos;|')état financier/);
    expect(xml).toContain("Brouillon");
    expect(xml).toContain("Confidentiel");
    for (const titre of [
      "Synthèse",
      "Évolution sur les exercices",
      "Bilan et compte de résultat de l",
      "Contrôles d",
      "Provenance des états",
    ]) {
      expect(xml).toContain(titre);
    }
  });

  it("chiffres du moteur : totaux, marge nette et variations de 2025 sur 2024", async () => {
    // 2025 : actif 1 200, produits 700, résultat 200 ; marge 200/700 ; produits +40 %, résultat +100 %, actif +20 %.
    expect(xml).toMatch(/1\s200\s+FCFA/);
    expect(xml).toMatch(/28,6\s%/);
    expect(xml).toMatch(/\+40\s%/);
    expect(xml).toMatch(/\+100\s%/);
    expect(xml).toMatch(/\+20\s%/);
    // 2024 : marge 100/500 = 20 %.
    expect(xml).toMatch(/20\s%/);
    expect(xml).toContain("Marge nette");
    // Bilan du dernier exercice (lignes lues en base) et contrôles.
    expect(xml).toContain("Fournisseurs");
    expect(xml).toContain("EQUILIBRE_BILAN");
    expect(xml).toContain("Conforme");
  });

  it("états en revue, rejetés ou remplacés : ignorés", async () => {
    expect(xml).not.toMatch(/9\s999|5\s555|7\s777/);
    expect(xml).not.toContain("Liasse 2026");
    expect(xml).not.toContain("Liasse 2023");
    expect(xml).toContain("Liasse 2025 corrigée");
    expect(xml).toContain("Liasse 2024");
  });

  it("annexe de provenance : origine, décision automatique, empreinte abrégée", async () => {
    expect(xml).toContain("Saisie");
    expect(xml).toContain("Automatique le");
    expect(xml).toContain("Empreinte SHA-256");
  });

  it("aucune donnée FIN-02 du cabinet", async () => {
    expect(xml).not.toMatch(
      /Coûts internes|Taux de marge|Honoraires|Valeur produite|Coût journalier|50\s000|90\s000|150\s000|300\s000/,
    );
  });

  it("journal d'audit : identifiants seulement, aucun montant", async () => {
    const lignesAudit = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT details FROM journal_audit
             WHERE action = 'generation_rapport' AND details->>'rapport_id' = $1`,
            [rapport.rapport.id],
          )
        ).rows,
    );
    expect(lignesAudit).toHaveLength(1);
    const d = lignesAudit[0].details as Record<string, unknown>;
    expect(d).toMatchObject({
      modele: "etat_financier",
      niveau: "dossier",
      client_id: a.clientId,
    });
    expect(d.etat_ids).toHaveLength(2);
    // Ensemble exact des clés, et uniquement des chaînes (ou tableaux de chaînes) : aucun montant.
    expect(Object.keys(d).sort()).toEqual(
      ["client_id", "etat_ids", "fichier_id", "format", "modele", "niveau", "rapport_id"].sort(),
    );
    for (const v of Object.values(d)) {
      const valeurs = Array.isArray(v) ? v : [v];
      expect(valeurs.every((x) => typeof x === "string")).toBe(true);
    }
  });

  it("exercices=1 : le seul exercice le plus récent, sans variation", async () => {
    const r = await generer(a.chef, a.clientId, missionId, "&exercices=1");
    const x = await texte(a.chef, r);
    expect(x).toContain("exercice(s) 2025");
    expect(x).not.toContain("Liasse 2024");
    expect(x).not.toMatch(/\+40\s%/);
  });

  it("commentaire du consultant : présent avec sa mention et échappé ; absent sans commentaire", async () => {
    expect(xml).not.toContain("Commentaire du consultant");
    const r = await generer(a.chef, a.clientId, missionId, "", {
      commentaire: "Trésorerie à surveiller <b>fortement</b> & suivre‮.",
    });
    const x = await texte(a.chef, r);
    expect(x).toContain("Commentaire du consultant");
    expect(x).toContain(
      "rédigé par le consultant ; les chiffres du rapport proviennent du moteur de calcul",
    );
    expect(x).toContain("Trésorerie à surveiller &lt;b&gt;fortement&lt;/b&gt; &amp; suivre.");
    expect(x).not.toContain("<b>");
    expect(x).not.toContain("‮");
  });

  it.skipIf(!navigateur)(
    `PDF réel${navigateur ? "" : " (SAUTÉ : aucun navigateur, définir CHROMIUM_PATH)"}`,
    async () => {
      const r = await a.chef.post(url(a.clientId, missionId).replace("docx", "pdf"));
      expect(r.statusCode, r.body).toBe(201);
      const f = await a.chef.get(`/api/fichiers/${r.json().fichier.id}`);
      expect(f.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    },
    60_000,
  );
});

describe("niveau « dossier » : liste, lecture, portail", () => {
  let rapport: RapportCree;

  beforeAll(async () => {
    rapport = await generer(a.associe, a.clientId, missionId);
  });

  const ids = async (par: Api) => {
    const r = await par.get(liste(missionId));
    attendre(200, r, "liste");
    return r.json().elements.map((e: { id: string }) => e.id) as string[];
  };

  it("listé et lisible avec « dossier.lire » ; absent et illisible avec « mission.lire » seul", async () => {
    expect(await ids(a.associe)).toContain(rapport.rapport.id);
    expect(await ids(a.chef)).toContain(rapport.rapport.id);
    expect(await ids(expert)).toContain(rapport.rapport.id);
    expect((await a.chef.get(`/api/fichiers/${rapport.fichier.id}`)).statusCode).toBe(200);
    expect((await expert.get(`/api/fichiers/${rapport.fichier.id}`)).statusCode).toBe(200);
    // Gestionnaire : voit la mission (mission.lire_toutes) mais n'a pas « dossier.lire ».
    expect((await gestionnaire.get(liste(missionId))).statusCode).toBe(200);
    expect(await ids(gestionnaire)).not.toContain(rapport.rapport.id);
    expect([403, 404]).toContain(
      (await gestionnaire.get(`/api/fichiers/${rapport.fichier.id}`)).statusCode,
    );
    // Autre cabinet : invisible.
    expect((await b.associe.get(`/api/fichiers/${rapport.fichier.id}`)).statusCode).toBe(404);
  });

  it("portail client : route absente de la liste blanche (403) et fichier illisible", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    expect((await client.post(url(a.clientId, missionId))).statusCode).toBe(403);
    expect((await client.get(`/api/fichiers/${rapport.fichier.id}`)).statusCode).toBe(403);
  });
});

describe("débit : 10 générations par utilisateur sur 10 minutes", () => {
  it("429 TROP_DE_RAPPORTS à la onzième ; rien d'écrit en plus", async () => {
    const dir = await a.avecRoles(["directeur_mission"]);
    for (let i = 0; i < RAPPORTS_PAR_FENETRE; i++) await generer(dir, a.clientId, missionId);
    const r = await dir.post(url(a.clientId, missionId));
    expect(r.statusCode).toBe(429);
    expect(r.json().erreur.code).toBe("TROP_DE_RAPPORTS");
    expect(
      await compter("SELECT count(*) AS n FROM rapports_mission WHERE genere_par = $1", [
        dir.utilisateurId,
      ]),
    ).toBe(RAPPORTS_PAR_FENETRE);
  });
});
