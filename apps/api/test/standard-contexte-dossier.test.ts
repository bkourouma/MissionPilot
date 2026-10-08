import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Dossier client → méthode (STD-04, DOS-01) : à la liaison d'une mission à une méthode, le
 * contexte est proposé depuis le dossier du client (valeurs courantes des facteurs, avec leur
 * source et leur fiabilité) ; rien n'est écrit tant que l'utilisateur ne confirme pas en liant.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let horsEquipe: ApiUtilisateur;
let missionId: string;
let notationV1: string;

function attendre<R extends { statusCode: number; body: string }>(statut: number, r: R): R {
  if (r.statusCode !== statut) throw new Error(`${r.statusCode} ${r.body}`);
  return r;
}

const source = { type: "entretien", libelle: "Entretien avec le DAF, 2026-09-12" };

async function facteur(corps: Record<string, unknown>) {
  attendre(
    201,
    await a.chef.post(`/api/dossiers/${a.clientId}/facteurs`, {
      date_effet: "2026-01-01",
      source,
      fiabilite: "B",
      ...corps,
    }),
  );
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Contexte dossier A");
  b = await preparerCabinet(ctx, "Contexte dossier B");
  consultant = await a.avecRoles(["consultant"]);
  horsEquipe = await a.avecRoles(["consultant"]);
  missionId = (await creerMission(a)).id;
  attendre(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    }),
  );
  await facteur({ code: "fiabilite_comptes", type: "enumeration", valeur: "non_certifies" });
  await facteur({ code: "part_informel", type: "enumeration", valeur: "forte" });
  await facteur({ code: "effectif", type: "nombre", valeur: 12 });
  await facteur({ code: "effectif", type: "nombre", valeur: 15, date_effet: "2026-06-01" });
  // Valeur future : pas encore en vigueur, donc pas proposée.
  await facteur({ code: "effectif", type: "nombre", valeur: 900, date_effet: "2099-01-01" });
  // Facteur que le référentiel ne connaît pas (l'API le refuse désormais : 400 CONTEXTE_INVALIDE) :
  // écarté avec sa raison. Inséré en base comme le ferait une donnée antérieure au contrôle.
  expect(
    (
      await a.chef.post(`/api/dossiers/${a.clientId}/facteurs`, {
        date_effet: "2026-01-01",
        source,
        fiabilite: "B",
        code: "facteur_maison",
        type: "booleen",
        valeur: true,
      })
    ).statusCode,
  ).toBe(400);
  await proprietaire((c) =>
    c.query(
      `INSERT INTO dossier_facteurs (cabinet_id, client_id, code, type, valeur, date_effet, source_type,
         source_libelle, fiabilite, auteur_id)
       VALUES ($1, $2, 'facteur_maison', 'booleen', 'true', '2026-01-01', 'entretien', $3, 'B', $4)`,
      [a.cabinetId, a.clientId, source.libelle, a.associeId],
    ),
  );
  const liste = attendre(200, await a.associe.get("/api/methodes?limite=100")).json();
  notationV1 = liste.elements.find((m: { code: string }) => m.code === "notation_entreprise")
    .derniere_publiee.id;
}, 120_000);
afterAll(() => ctx.fermer());

const url = () => `/api/missions/${missionId}/methode/contexte-propose`;

describe("GET /missions/:id/methode/contexte-propose", () => {
  it("401, 403 sans standard.lire ou dossier.lire, 404 mission invisible ou d'un autre cabinet", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.get(url())).statusCode).toBe(403);
    expect((await horsEquipe.get(url())).statusCode).toBe(404);
    expect((await b.associe.get(url())).statusCode).toBe(404);
    expect(
      (await a.associe.get(`/api/missions/${b.clientId}/methode/contexte-propose`)).statusCode,
    ).toBe(404);
  });

  it("propose les valeurs courantes du dossier, sourcées ; écarte un facteur inconnu ; n'écrit rien", async () => {
    const r = attendre(200, await consultant.get(url())).json();
    expect(r.contexte).toEqual({
      effectif: 15,
      fiabilite_comptes: "non_certifies",
      part_informel: "forte",
    });
    expect(r.sources).toContainEqual(
      expect.objectContaining({
        facteur: "effectif",
        valeur: 15,
        date_effet: "2026-06-01",
        fiabilite: "B",
        source: { type: "entretien", libelle: source.libelle },
      }),
    );
    expect(r.ecartes).toEqual([
      {
        facteur: "facteur_maison",
        valeur: true,
        raison: "Facteur inconnu du référentiel de méthodes.",
      },
    ]);
    const lu = attendre(200, await consultant.get(`/api/missions/${missionId}/methode`)).json();
    expect(lu.liaison).toBeNull();
  });

  it("l'utilisateur confirme : la liaison avec le contexte proposé applique les règles", async () => {
    const propose = attendre(200, await a.chef.get(url())).json();
    const r = attendre(
      200,
      await a.chef.put(`/api/missions/${missionId}/methode`, {
        version_id: notationV1,
        contexte: propose.contexte,
        motif: "Contexte confirmé depuis le dossier du client.",
      }),
    ).json();
    expect(r.liaison.contexte).toEqual(propose.contexte);
    // Effectif 15 (< 20) : petite structure ; comptes non certifiés et espèces fortes.
    expect([...r.modulation.regles_declenchees].sort()).toEqual([
      "comptes_fragiles",
      "petite_structure",
    ]);
  });
});
