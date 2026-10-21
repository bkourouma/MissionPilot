import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { traduireErreurServicesCandidats } from "../src/services-candidats/erreurs.js";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Guichets de financement du cabinet : liste vide par défaut, CRUD, validation, isolation entre
 * cabinets, rapprochement indicatif (profil surchargé et client du dossier), déclencheur MQV01.
 * Les dates sont dérivées de la date du jour (jamais en dur).
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let gestionnaire: Api;
let consultant: Api;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

/** Date ISO (UTC) décalée de `jours` par rapport à aujourd'hui. */
function dans(jours: number): string {
  return new Date(Date.now() + jours * 86_400_000).toISOString().slice(0, 10);
}

interface ResultatM {
  guichet: { id: string; nom: string };
  statut: "compatible" | "partiel" | "exclu";
  score: number;
  raisons_exclusion: string[];
}

const RAPPROCHER = "/api/guichets-financement/rapprochement";
const statuts = (r: { resultats: ResultatM[] }) =>
  Object.fromEntries(r.resultats.map((x) => [x.guichet.nom, x.statut]));

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Guichets A");
  b = await preparerCabinet(ctx, "Guichets B");
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  consultant = await a.avecRoles(["consultant"]);
}, 180_000);
afterAll(() => ctx.fermer());

describe("liste et CRUD", () => {
  it("la liste est vide par défaut (aucun guichet inventé)", async () => {
    expect(attendu(200, await a.associe.get("/api/guichets-financement"))).toEqual({
      elements: [],
      tronque: false,
    });
    const r = attendu(200, await a.associe.post(RAPPROCHER, { profil: { pays: "CI" } }));
    expect(r.resultats).toEqual([]);
    expect(r.tronque).toBe(false);
    expect(r.avertissement).toEqual(expect.any(String));
  });

  it("crée (201), lit, modifie et désactive un guichet ; filtre actif", async () => {
    const cree = attendu(
      201,
      await a.associe.post("/api/guichets-financement", {
        nom: "Banque Test",
        type: "banque",
        pays: ["CI"],
        objets: ["croissance"],
        devises: ["XOF"],
        montant_min: 1_000_000,
        montant_max: 5_000_000,
        devise_montant: "XOF",
        date_limite: dans(60),
        description: "Ligne de crédit PME.",
        url: "https://banque.exemple.test/pme",
      }),
    );
    expect(cree).toMatchObject({
      nom: "Banque Test",
      type: "banque",
      pays: ["CI"],
      secteurs: [],
      montant_min: 1_000_000,
      montant_max: 5_000_000,
      devise_montant: "XOF",
      date_limite: dans(60),
      actif: true,
      a_valider: true,
      cree_par: a.associeId,
    });
    const lu = attendu(200, await consultant.get(`/api/guichets-financement/${cree.id}`));
    expect(lu).toEqual(cree);
    const modifie = attendu(
      200,
      await a.associe.patch(`/api/guichets-financement/${cree.id}`, {
        nom: "Banque Test 2",
        montant_max: 8_000_000,
      }),
    );
    expect(modifie).toMatchObject({
      nom: "Banque Test 2",
      montant_max: 8_000_000,
      cree_par: a.associeId,
    });
    // Désactivation (pas de suppression : aucune route DELETE).
    const inactif = attendu(
      200,
      await a.associe.patch(`/api/guichets-financement/${cree.id}`, { actif: false }),
    );
    expect(inactif.actif).toBe(false);
    expect(
      attendu(200, await a.associe.get("/api/guichets-financement?actif=true")).elements,
    ).toEqual([]);
    expect(
      attendu(200, await a.associe.get("/api/guichets-financement?actif=false")).elements,
    ).toHaveLength(1);
    expect(attendu(200, await a.associe.get("/api/guichets-financement")).elements).toHaveLength(1);
    expect((await a.associe.delete(`/api/guichets-financement/${cree.id}`)).statusCode).toBe(404);
    expect((await a.associe.get("/api/guichets-financement?limite=0")).statusCode).toBe(400);
    expect(
      (await a.associe.get(`/api/guichets-financement/${crypto.randomUUID()}`)).statusCode,
    ).toBe(404);
    expect((await a.associe.get("/api/guichets-financement/pas-un-uuid")).statusCode).toBe(400);
    // Droits : un gestionnaire lit mais ne modifie pas.
    expect((await gestionnaire.get("/api/guichets-financement")).statusCode).toBe(200);
    expect(
      (await gestionnaire.patch(`/api/guichets-financement/${cree.id}`, { actif: true }))
        .statusCode,
    ).toBe(403);
  });
});

describe("validation", () => {
  const base = { nom: "Guichet invalide", type: "banque" };
  const refus = async (corps: Record<string, unknown>) =>
    (await a.associe.post("/api/guichets-financement", corps)).statusCode;

  it("refuse (400) minimum > maximum, borne sans devise, lien non http, champ inconnu", async () => {
    expect(await refus({ ...base, montant_min: 10, montant_max: 5, devise_montant: "XOF" })).toBe(
      400,
    );
    expect(await refus({ ...base, montant_min: 10 })).toBe(400);
    expect(await refus({ ...base, montant_max: 10 })).toBe(400);
    expect(await refus({ ...base, url: "javascript:alert(1)" })).toBe(400);
    expect(await refus({ ...base, url: "data:text/html,<b>x</b>" })).toBe(400);
    expect(await refus({ ...base, champ_inconnu: 1 })).toBe(400);
    expect(await refus({ ...base, type: "casino" })).toBe(400);
    expect(await refus({ ...base, objets: ["loterie"] })).toBe(400);
    expect(await refus({ ...base, devises: ["GBP"] })).toBe(400);
    expect(await refus({ ...base, date_limite: "2026-02-30" })).toBe(400);
    expect(await refus({ ...base, nom: "   " })).toBe(400);
  });

  it("modification : corps vide, incohérence finale des bornes et devise retirée refusés (400)", async () => {
    const g = attendu(
      201,
      await a.associe.post("/api/guichets-financement", {
        nom: "Guichet borné",
        type: "bailleur",
        montant_min: 100,
        montant_max: 200,
        devise_montant: "EUR",
      }),
    );
    const url = `/api/guichets-financement/${g.id}`;
    expect((await a.associe.patch(url, {})).statusCode).toBe(400);
    expect((await a.associe.patch(url, { montant_min: 500 })).statusCode).toBe(400);
    expect((await a.associe.patch(url, { devise_montant: null })).statusCode).toBe(400);
    expect((await a.associe.patch(url, { url: "javascript:void(0)" })).statusCode).toBe(400);
    expect((await a.associe.patch(url, { cabinet_id: b.cabinetId })).statusCode).toBe(400);
    expect((await a.associe.patch(url, { cree_par: a.associeId })).statusCode).toBe(400);
    // Les bornes et la devise levées ensemble restent acceptées.
    const ok = attendu(
      200,
      await a.associe.patch(url, { montant_min: null, montant_max: null, devise_montant: null }),
    );
    expect(ok).toMatchObject({ montant_min: null, montant_max: null, devise_montant: null });
    expect(attendu(200, await a.associe.get(url))).toEqual(ok);
  });
});

describe("isolation entre cabinets", () => {
  it("le cabinet B ne lit ni ne modifie le guichet de A (404) et ne le voit pas", async () => {
    const g = attendu(
      201,
      await a.associe.post("/api/guichets-financement", {
        nom: "Guichet de A",
        type: "fonds_investissement",
      }),
    );
    const url = `/api/guichets-financement/${g.id}`;
    expect((await b.associe.get(url)).statusCode).toBe(404);
    expect((await b.associe.patch(url, { actif: false })).statusCode).toBe(404);
    expect(attendu(200, await b.associe.get("/api/guichets-financement")).elements).toEqual([]);
    const r = attendu(200, await b.associe.post(RAPPROCHER, { profil: {} }));
    expect(r.resultats).toEqual([]);
    // Inchangé côté A.
    expect(attendu(200, await a.associe.get(url)).actif).toBe(true);
  });
});

describe("rapprochement par profil", () => {
  let cabinet: CabinetMissions;
  beforeAll(async () => {
    cabinet = await preparerCabinet(ctx, "Guichets rapprochement");
    const cree = async (corps: Record<string, unknown>) =>
      attendu(201, await cabinet.associe.post("/api/guichets-financement", corps));
    await cree({
      nom: "G1 compatible",
      type: "banque",
      pays: ["CI"],
      objets: ["croissance"],
      devises: ["XOF"],
      montant_min: 1_000_000,
      montant_max: 5_000_000,
      devise_montant: "XOF",
      date_limite: dans(30),
    });
    await cree({ nom: "G2 partiel", type: "bailleur", secteurs: ["Agro-industrie"] });
    const inactif = await cree({ nom: "G3 inactif", type: "banque", actif: false });
    expect(inactif.actif).toBe(false);
    await cree({ nom: "G4 échéance dépassée", type: "programme_public", date_limite: dans(-30) });
    await cree({
      nom: "G5 montant hors borne",
      type: "fonds_investissement",
      montant_max: 1_000_000,
      devise_montant: "XOF",
    });
  });

  const profil = {
    pays: "CI",
    objet: "croissance",
    devise: "XOF",
    montant: 2_000_000,
  };

  it("statuts : compatible, partiel, et exclu (inactif, échéance dépassée, montant hors borne)", async () => {
    const r = attendu(200, await cabinet.associe.post(RAPPROCHER, { profil }));
    expect(r.dossier).toBeNull();
    expect(r.profil_utilise).toMatchObject(profil);
    expect(statuts(r)).toEqual({
      "G1 compatible": "compatible",
      "G2 partiel": "partiel",
      "G3 inactif": "exclu",
      "G4 échéance dépassée": "exclu",
      "G5 montant hors borne": "exclu",
    });
    const res: ResultatM[] = r.resultats;
    // Tri : compatible, partiel, puis exclus ; score 0 et raison pour chaque exclu.
    expect(res.map((x) => x.statut)).toEqual(["compatible", "partiel", "exclu", "exclu", "exclu"]);
    expect(res[0]?.score).toBe(100);
    for (const x of res.filter((y) => y.statut === "exclu")) {
      expect(x.score).toBe(0);
      expect(x.raisons_exclusion.length).toBeGreaterThan(0);
    }
    const g5 = res.find((x) => x.guichet.nom === "G5 montant hors borne") as ResultatM;
    expect(g5.raisons_exclusion.join(" ")).toMatch(/maximum/);
    const g4 = res.find((x) => x.guichet.nom === "G4 échéance dépassée") as ResultatM;
    expect(g4.raisons_exclusion.join(" ")).toContain(dans(-30));
    expect(r.avertissement).toEqual(expect.any(String));
  });

  it("un secteur correspondant rend le guichet partiel compatible ; la devise différente rend le montant inconnu", async () => {
    const r = attendu(
      200,
      await cabinet.associe.post(RAPPROCHER, { profil: { ...profil, secteur: "agro-industrie" } }),
    );
    expect(statuts(r)["G2 partiel"]).toBe("compatible");
    const autreDevise = attendu(
      200,
      await cabinet.associe.post(RAPPROCHER, { profil: { ...profil, devise: "EUR" } }),
    );
    // G1 : devise absente de sa liste -> exclu ; G5 : montant non comparable, sans conversion.
    expect(statuts(autreDevise)["G1 compatible"]).toBe("exclu");
    expect(statuts(autreDevise)["G5 montant hors borne"]).toBe("partiel");
  });

  it("corps invalide : ni client ni profil, champ inconnu, client_id non UUID (400)", async () => {
    expect((await cabinet.associe.post(RAPPROCHER, {})).statusCode).toBe(400);
    expect((await cabinet.associe.post(RAPPROCHER, { profil: { inconnu: 1 } })).statusCode).toBe(
      400,
    );
    expect((await cabinet.associe.post(RAPPROCHER, { client_id: "x" })).statusCode).toBe(400);
    expect((await cabinet.associe.post(RAPPROCHER, { profil: { montant: -5 } })).statusCode).toBe(
      400,
    );
  });

  it("le consultant peut rapprocher (lecture), sans session : 401", async () => {
    expect(
      (await (await cabinet.avecRoles(["consultant"])).post(RAPPROCHER, { profil })).statusCode,
    ).toBe(200);
    expect((await api(ctx).post(RAPPROCHER, { profil })).statusCode).toBe(401);
  });
});

describe("rapprochement depuis un client du dossier", () => {
  let cabinet: CabinetMissions;
  let clientId: string;

  beforeAll(async () => {
    cabinet = await preparerCabinet(ctx, "Guichets dossier");
    const c = attendu(
      201,
      await cabinet.associe.post("/api/clients", {
        raison_sociale: "Coopérative Dossier",
        pays: "CI",
        secteur: "Agro-industrie",
        taille: "pme",
      }),
    );
    clientId = c.id;
    attendu(
      201,
      await cabinet.associe.post(`/api/dossiers/${clientId}/facteurs`, {
        code: "filieres",
        type: "liste",
        valeur: ["cacao"],
        date_effet: "2026-01-01",
        source: { type: "entretien", libelle: "Entretien avec le dirigeant" },
        fiabilite: "B",
      }),
    );
    const cree = async (corps: Record<string, unknown>) =>
      attendu(201, await cabinet.associe.post("/api/guichets-financement", corps));
    await cree({
      nom: "D1 filière cacao",
      type: "programme_public",
      pays: ["CI"],
      secteurs: ["agro-industrie"],
      filieres: ["Cacao"],
      tailles: ["pme"],
    });
    await cree({ nom: "D2 mauvais pays", type: "banque", pays: ["SN"] });
    await cree({ nom: "D3 objet à préciser", type: "bailleur", objets: ["export"] });
  });

  it("construit le profil du dossier (pays, secteur, taille, filières) et rapproche", async () => {
    const r = attendu(200, await cabinet.associe.post(RAPPROCHER, { client_id: clientId }));
    expect(r.profil_utilise).toMatchObject({
      pays: "CI",
      secteur: "Agro-industrie",
      taille: "pme",
      filieres: ["cacao"],
      objet: null,
      montant: null,
      devise: null,
    });
    expect(r.dossier).toMatchObject({ client_id: clientId });
    expect(statuts(r)).toEqual({
      "D1 filière cacao": "compatible",
      "D2 mauvais pays": "exclu",
      "D3 objet à préciser": "partiel",
    });
  });

  it("le profil saisi surcharge le dossier", async () => {
    const r = attendu(
      200,
      await cabinet.associe.post(RAPPROCHER, {
        client_id: clientId,
        profil: { pays: "SN", objet: "export" },
      }),
    );
    expect(r.profil_utilise).toMatchObject({ pays: "SN", objet: "export", taille: "pme" });
    expect(statuts(r)).toMatchObject({
      "D1 filière cacao": "exclu",
      "D2 mauvais pays": "compatible",
      "D3 objet à préciser": "compatible",
    });
  });

  it("client d'un autre cabinet ou inexistant : 404 ; sans dossier.lire : 403 ; dossier invisible : 404", async () => {
    // Client du cabinet B, demandé depuis A.
    expect((await cabinet.associe.post(RAPPROCHER, { client_id: b.clientId })).statusCode).toBe(
      404,
    );
    expect(
      (await cabinet.associe.post(RAPPROCHER, { client_id: crypto.randomUUID() })).statusCode,
    ).toBe(404);
    // Gestionnaire : services_candidats.lire mais pas dossier.lire.
    const sansDossier = await cabinet.avecRoles(["gestionnaire"]);
    expect((await sansDossier.post(RAPPROCHER, { profil: { pays: "CI" } })).statusCode).toBe(200);
    expect((await sansDossier.post(RAPPROCHER, { client_id: clientId })).statusCode).toBe(403);
    // Consultant sans mission sur ce client : dossier invisible (404, comme inexistant).
    const consultantSeul = await cabinet.avecRoles(["consultant"]);
    expect((await consultantSeul.post(RAPPROCHER, { client_id: clientId })).statusCode).toBe(404);
    // Un directeur de mission voit tous les dossiers.
    expect((await cabinet.directeur.post(RAPPROCHER, { client_id: clientId })).statusCode).toBe(
      200,
    );
  });
});

describe("déclencheur MQV01 (identité d'un guichet figée)", () => {
  it("le propriétaire ne peut changer ni le cabinet ni l'auteur ni la date de création", async () => {
    const g = attendu(
      201,
      await a.associe.post("/api/guichets-financement", { nom: "Guichet figé", type: "autre" }),
    );
    for (const [colonne, valeur] of [
      ["cabinet_id", b.cabinetId],
      ["cree_par", a.directeur.utilisateurId],
      ["cree_le", "2020-01-01T00:00:00Z"],
    ] as const) {
      const erreur = await proprietaire(async (c) => {
        try {
          await c.query(`UPDATE guichets_financement SET ${colonne} = $2 WHERE id = $1`, [
            g.id,
            valeur,
          ]);
          return null;
        } catch (e) {
          return e as { code?: string };
        }
      });
      expect(erreur?.code, colonne).toBe("MQV01");
    }
    // Un UPDATE de contenu par le propriétaire reste possible.
    await proprietaire((c) =>
      c.query("UPDATE guichets_financement SET description = 'x' WHERE id = $1", [g.id]),
    );
    expect(attendu(200, await a.associe.get(`/api/guichets-financement/${g.id}`)).cree_par).toBe(
      a.associeId,
    );
  });

  it("le code SQLSTATE MQV01 est traduit en 409 GUICHET_FIGE (non atteignable par HTTP)", async () => {
    // Aucune route API n'atteint ces colonnes (schéma strict, pas de DELETE) : le 409 GUICHET_FIGE
    // n'est pas atteignable par HTTP ; on vérifie le mappage de l'erreur du déclencheur.
    const traduit = traduireErreurServicesCandidats({ code: "MQV01" });
    expect(traduit).toBeInstanceOf(AppError);
    expect(traduit).toMatchObject({ statut: 409, code: "GUICHET_FIGE" });
    const autre = new Error("autre");
    expect(traduireErreurServicesCandidats(autre)).toBe(autre);
  });

  it("MQV02 → 409 PLAFOND_GUICHETS_ATTEINT et CHECK 23514 → 400 (traduction)", () => {
    expect(traduireErreurServicesCandidats({ code: "MQV02" })).toMatchObject({
      statut: 409,
      code: "PLAFOND_GUICHETS_ATTEINT",
    });
    expect(traduireErreurServicesCandidats({ code: "23514" })).toMatchObject({
      statut: 400,
      code: "REQUETE_INVALIDE",
    });
  });
});

describe("validation alignée sur les bornes de la base (400)", () => {
  const poster = (corps: Record<string, unknown>) =>
    a.associe.post("/api/guichets-financement", { nom: "Borne", type: "banque", ...corps });
  const liste = (n: number, longueur: number) =>
    Array.from({ length: n }, (_, i) => String(i).padStart(longueur, "x"));

  it("listes trop longues, longueur totale, nom, adresse : 400 (jamais 500)", async () => {
    const refus: Record<string, unknown>[] = [
      { pays: liste(61, 2) },
      { pays: liste(60, 10) },
      { secteurs: liste(51, 3) },
      { filieres: liste(50, 40) },
      { tailles: liste(11, 3) },
      { tailles: liste(10, 20) },
      { objets: ["creation", "bfr", "inconnu"] },
      { devises: ["XOF", "GBP"] },
      { nom: "Nom" + String.fromCharCode(7) + "piégé" },
      { url: "http:exemple.org" },
      { url: "https://exemple .org" },
      { url: "javascript:alert(1)" },
    ];
    for (const corps of refus) {
      const r = await poster(corps);
      expect(r.statusCode, JSON.stringify(corps).slice(0, 80)).toBe(400);
    }
    expect((await poster({ pays: liste(60, 9), tailles: liste(10, 19) })).statusCode).toBe(201);
    const modif = await a.associe.patch(
      `/api/guichets-financement/${(await poster({ nom: "Cible" })).json().id}`,
      { tailles: liste(11, 3) },
    );
    expect(modif.statusCode).toBe(400);
  });
});

describe("plafond de 500 guichets par cabinet (MQV02)", () => {
  it("le 501e est refusé (409 en API, MQV02 en base) ; liste tronquée au-delà de la limite", async () => {
    const c = await preparerCabinet(ctx, "Guichets plafond");
    await proprietaire((p) =>
      p.query(
        `INSERT INTO guichets_financement (cabinet_id, nom, type, cree_par)
         SELECT $1, 'Guichet ' || lpad(g::text, 4, '0'), 'banque', $2 FROM generate_series(1, 500) g`,
        [c.cabinetId, c.associeId],
      ),
    );
    const refus = await c.associe.post("/api/guichets-financement", { nom: "501", type: "banque" });
    expect(refus.statusCode, refus.body).toBe(409);
    expect(refus.json().erreur.code).toBe("PLAFOND_GUICHETS_ATTEINT");
    const erreur = await proprietaire(async (p) => {
      try {
        await p.query(
          "INSERT INTO guichets_financement (cabinet_id, nom, type, cree_par) VALUES ($1, '501', 'banque', $2)",
          [c.cabinetId, c.associeId],
        );
        return null;
      } catch (e) {
        return e as { code?: string };
      }
    });
    expect(erreur?.code).toBe("MQV02");
    // Un autre cabinet n'est pas concerné.
    expect(
      (await b.associe.post("/api/guichets-financement", { nom: "Autre", type: "banque" }))
        .statusCode,
    ).toBe(201);
    // Liste : tronquée à la limite demandée ; le rapprochement lit les 500, sans troncature.
    const liste = attendu(200, await c.associe.get("/api/guichets-financement?limite=200"));
    expect(liste.elements).toHaveLength(200);
    expect(liste.tronque).toBe(true);
    const complete = attendu(200, await c.associe.get("/api/guichets-financement?limite=100"));
    expect(complete.tronque).toBe(true);
    const r = attendu(200, await c.associe.post(RAPPROCHER, { profil: {} }));
    expect(r.resultats).toHaveLength(500);
    expect(r.tronque).toBe(false);
  }, 120_000);
});

describe("droits SQL du rôle applicatif", () => {
  it("guichets_financement : ni DELETE, ni UPDATE des colonnes d'identité (permission denied)", async () => {
    attendu(
      201,
      await a.associe.post("/api/guichets-financement", { nom: "Droits", type: "autre" }),
    );
    const refuser = async (sql: string) =>
      expect(ctx.db.withTenant(a.cabinetId, (db) => db.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    await refuser("DELETE FROM guichets_financement");
    for (const colonne of ["id", "cabinet_id", "cree_par", "cree_le"]) {
      await refuser(`UPDATE guichets_financement SET ${colonne} = ${colonne}`);
    }
    // Les colonnes de contenu restent modifiables.
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE guichets_financement SET description = 'ok' WHERE nom = 'Droits'"),
    );
  });

  it("services_candidats_parametres : ni DELETE, ni UPDATE de cabinet_id et service_code", async () => {
    attendu(
      200,
      await a.associe.put("/api/services-candidats/business_plan_bancable/prix", {
        montant: 1,
        devise: "XOF",
      }),
    );
    const refuser = async (sql: string) =>
      expect(ctx.db.withTenant(a.cabinetId, (db) => db.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    await refuser("DELETE FROM services_candidats_parametres");
    for (const colonne of ["cabinet_id", "service_code"]) {
      await refuser(`UPDATE services_candidats_parametres SET ${colonne} = ${colonne}`);
    }
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE services_candidats_parametres SET devise = devise"),
    );
  });
});
