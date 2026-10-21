import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Services candidats (diagnostic flash, business plan bancable) : lecture des deux services, prix
 * fixe, activation des types de mission, mission liée à la méthode du standard et aperçu, droits par
 * rôle, fermeture du portail client, isolation entre cabinets.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: Api;
let gestionnaire: Api;
let externe: Api;
let client: UtilisateurPortail;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

interface ServiceM {
  code: string;
  libelle: string;
  methode: { version_id: string; version: number } | null;
  coherence: { valide: boolean; erreurs: string[]; avertissements: string[] } | null;
  type_mission: { id: string; a_valider: boolean } | null;
  prix: {
    montant: number | null;
    devise: string;
    a_fixer: boolean;
    personnalise: boolean;
    commentaire: string | null;
  };
  a_valider_expert: boolean;
}

const lireServices = async (c: Api) =>
  (attendu(200, await c.get("/api/services-candidats")).elements as ServiceM[]).reduce<
    Record<string, ServiceM>
  >((acc, s) => ({ ...acc, [s.code]: s }), {});

const CONTEXTES: Record<string, Record<string, unknown>> = {
  diagnostic_flash: {
    effectif: 8,
    fiabilite_comptes: "non_certifies",
    part_informel: "forte",
    filieres: ["cacao"],
    agricole: true,
  },
  business_plan_bancable: {
    effectif: 35,
    fiabilite_comptes: "non_certifies",
    part_informel: "forte",
    actionnariat: "cooperative",
    filieres: ["anacarde"],
    agricole: true,
    saisonnalite: "campagne_agricole",
    financeur: "banque",
    commerce_exterieur: ["export", "change"],
  },
};

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Services candidats A");
  b = await preparerCabinet(ctx, "Services candidats B");
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  externe = await a.avecRoles(["expert_externe"]);
  client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
}, 180_000);
afterAll(() => ctx.fermer());

describe("lecture des deux services", () => {
  it("liste le diagnostic flash et le business plan avec leur méthode STANDARD publiée et cohérente", async () => {
    const s = await lireServices(a.associe);
    expect(Object.keys(s).sort()).toEqual(["business_plan_bancable", "diagnostic_flash"]);
    for (const code of Object.keys(s)) {
      const x = s[code] as ServiceM;
      expect(x.libelle).toEqual(expect.any(String));
      expect(x.methode, code).toMatchObject({ version: 1 });
      expect(x.methode?.version_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(x.coherence, code).toMatchObject({ valide: true, erreurs: [] });
      expect(x.a_valider_expert).toBe(true);
    }
  });

  it("aucun prix par défaut : flash « à fixer » par le cabinet ; business plan sur devis", async () => {
    const s = await lireServices(a.associe);
    expect(s["diagnostic_flash"]?.prix).toEqual({
      montant: null,
      devise: "XOF",
      a_fixer: true,
      personnalise: false,
      commentaire: null,
    });
    expect(s["business_plan_bancable"]?.prix).toEqual({
      montant: null,
      devise: "XOF",
      a_fixer: false,
      personnalise: false,
      commentaire: null,
    });
  });
});

describe("prix fixe", () => {
  it("l'associé fixe le prix : personnalisé, plus « à fixer » ; validation du corps", async () => {
    const r = attendu(
      200,
      await a.associe.put("/api/services-candidats/diagnostic_flash/prix", {
        montant: 2_000_000,
        devise: "XOF",
      }),
    );
    expect(r).toEqual({
      montant: 2_000_000,
      devise: "XOF",
      a_fixer: false,
      personnalise: true,
      commentaire: null,
    });
    const s = await lireServices(a.associe);
    expect(s["diagnostic_flash"]?.prix).toEqual(r);
    // Le business plan n'est pas touché.
    expect(s["business_plan_bancable"]?.prix.personnalise).toBe(false);
    // Remplacement (upsert) et prix « sur devis » (null).
    attendu(
      200,
      await a.associe.put("/api/services-candidats/diagnostic_flash/prix", {
        montant: 1_800_000,
        devise: "EUR",
      }),
    );
    expect((await lireServices(a.associe))["diagnostic_flash"]?.prix).toMatchObject({
      montant: 1_800_000,
      devise: "EUR",
      commentaire: null,
    });
    // Mention libre du cabinet, relue telle quelle.
    attendu(
      200,
      await a.associe.put("/api/services-candidats/diagnostic_flash/prix", {
        montant: 1_800_000,
        devise: "EUR",
        commentaire: "DÉMONSTRATION",
      }),
    );
    expect((await lireServices(a.associe))["diagnostic_flash"]?.prix).toMatchObject({
      commentaire: "DÉMONSTRATION",
    });
    attendu(
      200,
      await a.associe.put("/api/services-candidats/business_plan_bancable/prix", {
        montant: null,
        devise: "XOF",
      }),
    );
    const bp = (await lireServices(a.associe))["business_plan_bancable"];
    expect(bp?.prix).toEqual({
      montant: null,
      devise: "XOF",
      a_fixer: false,
      personnalise: true,
      commentaire: null,
    });
    const url = "/api/services-candidats/diagnostic_flash/prix";
    for (const corps of [
      { montant: -1, devise: "XOF" },
      { montant: 1.5, devise: "XOF" },
      { montant: 1000, devise: "GBP" },
      { montant: 1000 },
      { montant: 1000, devise: "XOF", extra: 1 },
      { montant: 1000, devise: "XOF", commentaire: "x".repeat(201) },
    ]) {
      expect((await a.associe.put(url, corps)).statusCode, JSON.stringify(corps)).toBe(400);
    }
    expect(
      (await a.associe.put("/api/services-candidats/inconnu/prix", { montant: 1, devise: "XOF" }))
        .statusCode,
    ).toBe(400);
  });
});

describe("activation des types de mission", () => {
  it("le diagnostic flash ne s'active pas sans prix (409 PRIX_A_FIXER) ; le business plan, si", async () => {
    const refus = await b.associe.post("/api/services-candidats/activer", {
      service: "diagnostic_flash",
    });
    expect(refus.statusCode, refus.body).toBe(409);
    expect(refus.json().erreur.code).toBe("PRIX_A_FIXER");
    expect(refus.json().erreur.message).toMatch(/prix/);
    expect((await lireServices(b.associe))["diagnostic_flash"]?.type_mission).toBeNull();
    // Un prix « sur devis » (montant null) ne lève pas l'obstacle d'un service à prix fixe.
    attendu(
      200,
      await b.associe.put("/api/services-candidats/diagnostic_flash/prix", {
        montant: null,
        devise: "XOF",
      }),
    );
    expect(
      (await b.associe.post("/api/services-candidats/activer", { service: "diagnostic_flash" }))
        .statusCode,
    ).toBe(409);
    expect(
      attendu(
        200,
        await b.associe.post("/api/services-candidats/activer", {
          service: "business_plan_bancable",
        }),
      ),
    ).toEqual({ types_crees: 1 });
  });

  it("corps invalide : 400", async () => {
    for (const corps of [
      undefined,
      {},
      { service: "inconnu" },
      { service: "diagnostic_flash", x: 1 },
    ]) {
      const r = await a.associe.post("/api/services-candidats/activer", corps);
      expect(r.statusCode, JSON.stringify(corps)).toBe(400);
    }
  });

  it("crée chaque type (à valider) une fois le prix fixé, puis est idempotente", async () => {
    expect((await lireServices(a.associe))["diagnostic_flash"]?.type_mission).toBeNull();
    for (const service of ["diagnostic_flash", "business_plan_bancable"]) {
      expect(
        attendu(200, await a.associe.post("/api/services-candidats/activer", { service })),
      ).toEqual({
        types_crees: 1,
      });
      expect(
        attendu(200, await a.associe.post("/api/services-candidats/activer", { service })),
      ).toEqual({
        types_crees: 0,
      });
    }
    const s = await lireServices(a.associe);
    for (const code of ["diagnostic_flash", "business_plan_bancable"]) {
      expect(s[code]?.type_mission).toMatchObject({ a_valider: true });
    }
    const types = attendu(200, await a.associe.get("/api/types-mission")).elements as {
      code: string;
    }[];
    expect(types.filter((t) => t.code === "diagnostic_flash")).toHaveLength(1);
    expect(types.filter((t) => t.code === "business_plan_bancable")).toHaveLength(1);
  });
});

describe("mission de chaque service : création, liaison à la méthode, aperçu", () => {
  for (const code of ["diagnostic_flash", "business_plan_bancable"]) {
    it(`${code} : mission créée par POST /missions, liée à la version publiée, aperçu cohérent`, async () => {
      const service = (await lireServices(a.associe))[code] as ServiceM;
      expect(service.type_mission).not.toBeNull();
      const versionId = service.methode?.version_id as string;
      const mission = await creerMission(a, {
        intitule: `Mission ${code}`,
        type_mission_id: service.type_mission?.id,
      });
      expect(mission).toMatchObject({ type_mission_id: service.type_mission?.id });

      const contexte = CONTEXTES[code];
      const lien = attendu(
        200,
        await a.chef.put(`/api/missions/${mission.id}/methode`, {
          version_id: versionId,
          contexte,
          motif: "Contexte du dossier : essai du service candidat.",
        }),
      );
      expect(lien.liaison).toMatchObject({ methode_version_id: versionId, contexte });
      expect(lien.etapes.length).toBeGreaterThan(0);

      const apercu = attendu(
        200,
        await consultant.post(`/api/methodes/versions/${versionId}/apercu`, { contexte }),
      );
      expect(apercu.version).toMatchObject({ id: versionId, version: 1, statut: "publiee" });
      expect(apercu.contexte).toEqual(contexte);
      const briques = apercu.methode.etapes.flatMap(
        (e: { briques: { active: boolean }[] }) => e.briques,
      ) as { active: boolean }[];
      expect(briques.length).toBeGreaterThan(0);
      expect(apercu.synthese.briques_actives).toBe(briques.filter((x) => x.active).length);
      expect(apercu.synthese.briques_inactives).toBe(briques.filter((x) => !x.active).length);
      expect(apercu.synthese.temps_type_total_jours).toBeGreaterThan(0);
      expect(apercu.regles_declenchees.length).toBeGreaterThan(0);
      // Identité avec la méthode effective de la mission réelle.
      const reelle = attendu(200, await a.chef.get(`/api/missions/${mission.id}/methode`));
      const actives = (m: { etapes: { briques: { code: string; active: boolean }[] }[] }) =>
        m.etapes
          .flatMap((e) => e.briques)
          .filter((x) => x.active)
          .map((x) => x.code)
          .sort();
      expect(actives(apercu.methode)).toEqual(actives(reelle));
    });
  }
});

describe("droits par rôle", () => {
  it("consultant, gestionnaire et chef : lecture oui, activation, prix et guichets non", async () => {
    for (const u of [consultant, gestionnaire, a.chef]) {
      expect((await u.get("/api/services-candidats")).statusCode).toBe(200);
      expect((await u.get("/api/guichets-financement")).statusCode).toBe(200);
      expect((await u.post("/api/services-candidats/activer")).statusCode).toBe(403);
      expect(
        (
          await u.put("/api/services-candidats/diagnostic_flash/prix", {
            montant: 1,
            devise: "XOF",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await u.post("/api/guichets-financement", { nom: "Refusé", type: "banque" })).statusCode,
      ).toBe(403);
      expect(
        (await u.patch(`/api/guichets-financement/${crypto.randomUUID()}`, { actif: false }))
          .statusCode,
      ).toBe(403);
    }
  });

  it("le directeur de mission gère (activation, prix, guichets) comme l'associé", async () => {
    expect((await a.directeur.get("/api/services-candidats")).statusCode).toBe(200);
    expect(
      attendu(
        200,
        await a.directeur.post("/api/services-candidats/activer", { service: "diagnostic_flash" }),
      ),
    ).toEqual({ types_crees: 0 });
    expect(
      (
        await a.directeur.put("/api/services-candidats/diagnostic_flash/prix", {
          montant: 1_800_000,
          devise: "EUR",
        })
      ).statusCode,
    ).toBe(200);
    const g = await a.directeur.post("/api/guichets-financement", {
      nom: "Guichet du directeur",
      type: "banque",
    });
    expect(g.statusCode, g.body).toBe(201);
    expect(
      (await a.directeur.patch(`/api/guichets-financement/${g.json().id}`, { actif: false }))
        .statusCode,
    ).toBe(200);
  });

  it("expert externe (sans services_candidats.lire) : 403 partout, même en lecture", async () => {
    expect((await externe.get("/api/services-candidats")).statusCode).toBe(403);
    expect((await externe.get("/api/guichets-financement")).statusCode).toBe(403);
    expect(
      (await externe.post("/api/guichets-financement/rapprochement", { profil: {} })).statusCode,
    ).toBe(403);
    expect((await externe.post("/api/services-candidats/activer")).statusCode).toBe(403);
  });

  it("sans session : 401", async () => {
    expect((await api(ctx).get("/api/services-candidats")).statusCode).toBe(401);
    expect((await api(ctx).get("/api/guichets-financement")).statusCode).toBe(401);
  });
});

describe("portail client fermé", () => {
  it("un utilisateur client reçoit 403 sur toutes les routes des services candidats", async () => {
    const id = crypto.randomUUID();
    const reponses = await Promise.all([
      client.get("/api/services-candidats"),
      client.post("/api/services-candidats/activer"),
      client.put("/api/services-candidats/diagnostic_flash/prix", { montant: 1, devise: "XOF" }),
      client.get("/api/guichets-financement"),
      client.post("/api/guichets-financement", { nom: "Client", type: "banque" }),
      client.post("/api/guichets-financement/rapprochement", { profil: {} }),
      client.get(`/api/guichets-financement/${id}`),
      client.patch(`/api/guichets-financement/${id}`, { actif: false }),
    ]);
    reponses.forEach((r) => expect(r.statusCode, r.body).toBe(403));
  });
});

describe("isolation entre cabinets", () => {
  it("le prix fixé par le cabinet A est invisible du cabinet B", async () => {
    const vueB = await lireServices(b.associe);
    expect(vueB["diagnostic_flash"]?.prix).toMatchObject({ montant: null, a_fixer: true });
    expect(vueB["business_plan_bancable"]?.prix.personnalise).toBe(false);
    expect(vueB["diagnostic_flash"]?.type_mission).toBeNull();
    // B fixe son propre prix sans toucher à A.
    attendu(
      200,
      await b.associe.put("/api/services-candidats/diagnostic_flash/prix", {
        montant: 900_000,
        devise: "XAF",
      }),
    );
    expect((await lireServices(a.associe))["diagnostic_flash"]?.prix).toMatchObject({
      montant: 1_800_000,
      devise: "EUR",
    });
    expect((await lireServices(b.associe))["diagnostic_flash"]?.prix).toMatchObject({
      montant: 900_000,
      devise: "XAF",
    });
  });
});
