import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import {
  ASSERTION_R2,
  creerAssertion,
  creerPreuve,
  lier,
  PREUVE_DOCUMENT,
  preparerPreuves,
  type ScenarioPreuves,
} from "./preuves-outils.js";

/*
 * Registre des preuves (PRV-03, PRV-05) : carte de triangulation sources × dimensions avec les
 * zones non couvertes, contrôle des assertions R2 et R3 d'un livrable (preuve ou avis d'expert
 * signé). Les résultats sortent du moteur ; les tests vérifient le câblage, les droits et les
 * cas de bord.
 */

let ctx: Contexte;
let s: ScenarioPreuves;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerPreuves(ctx, "PRV synthèse");
}, 180_000);
afterAll(() => ctx.fermer());

async function nouvelleMission(intitule: string): Promise<string> {
  const r = await s.a.associe.post("/api/missions", {
    intitule,
    client_id: s.a.clientId,
    type_mission_id: s.a.typePlanId,
    directeur_id: s.a.directeur.utilisateurId,
    chef_id: s.a.chef.utilisateurId,
    date_debut: "2026-11-02",
    date_fin: "2027-01-29",
  });
  return r.json().id as string;
}

describe("carte de triangulation (PRV-05)", () => {
  it("sans dimension déclarée, la carte est vide ; droits et isolation", async () => {
    const m = await nouvelleMission("Triangulation vide");
    const r = await s.a.chef.get(`/api/missions/${m}/preuves/triangulation`);
    expect(r.statusCode).toBe(200);
    expect(r.json().dimensions).toEqual([]);
    expect((await s.gestionnaire.get(`/api/missions/${m}/preuves/triangulation`)).statusCode).toBe(
      403,
    );
    expect((await s.b.associe.get(`/api/missions/${m}/preuves/triangulation`)).statusCode).toBe(
      404,
    );
    expect(
      (await s.consultantHors.get(`/api/missions/${m}/preuves/triangulation`)).statusCode,
    ).toBe(404);
  });

  it("couvre, triangule et signale les zones non couvertes avant l'analyse", async () => {
    const m = await nouvelleMission("Triangulation");
    const url = `/api/missions/${m}/preuves`;
    for (const [code, libelle] of [
      ["gouvernance", "Gouvernance"],
      ["finance", "Finance"],
      ["rh", "Ressources humaines"],
    ]) {
      expect((await s.a.chef.post(`${url}/dimensions`, { code, libelle })).statusCode).toBe(201);
    }
    await creerPreuve(s.a.chef, m, { dimensions: ["gouvernance", "finance"] });
    await creerPreuve(s.a.chef, m, { ...PREUVE_DOCUMENT, dimensions: ["gouvernance"] });
    await creerPreuve(s.a.chef, m, {
      fiabilite: "D",
      type_source: "observation",
      dimensions: ["finance"],
    });

    const carte = (await s.a.chef.get(`${url}/triangulation`)).json();
    const par = Object.fromEntries(
      carte.dimensions.map((d: { code: string }) => [d.code, d]),
    ) as Record<string, Record<string, unknown>>;
    expect(par.gouvernance).toMatchObject({
      libelle: "Gouvernance",
      couverte: true,
      triangulee: true,
      types_couverts: ["entretien", "document"],
    });
    expect(par.finance).toMatchObject({ couverte: true, triangulee: true });
    expect(par.rh).toMatchObject({ couverte: false, triangulee: false, preuves: 0 });
    expect(carte.dimensions_non_couvertes).toEqual(["rh"]);
    expect(carte.zones_non_couvertes).toContainEqual({ dimension: "rh", type_source: "entretien" });
    expect(carte.zones_non_couvertes).toContainEqual({
      dimension: "gouvernance",
      type_source: "questionnaire",
    });
    expect(carte.cellules).toHaveLength(15);
    expect(
      carte.cellules.find(
        (c: { dimension: string; type_source: string }) =>
          c.dimension === "finance" && c.type_source === "observation",
      ),
    ).toMatchObject({ preuves: 1, meilleure_fiabilite: "D" });

    // Les types attendus se déclarent par mission : sans observation de terrain, plus de zone.
    const sansObs = (
      await s.a.chef.get(
        `${url}/triangulation?types_attendus=entretien,document,questionnaire,donnee_externe`,
      )
    ).json();
    expect(
      sansObs.zones_non_couvertes.some(
        (z: { type_source: string }) => z.type_source === "observation",
      ),
    ).toBe(false);
    // Fiabilité minimale : la preuve D est écartée.
    const stricte = (await s.a.chef.get(`${url}/triangulation?fiabilite_minimale=C`)).json();
    expect(stricte.preuves_ecartees).toHaveLength(1);
    expect(stricte.dimensions_sous_triangulees).toContain("finance");

    expect((await s.a.chef.get(`${url}/triangulation?types_minimum=9`)).statusCode).toBe(400);
    expect((await s.a.chef.get(`${url}/triangulation?types_attendus=rumeur`)).statusCode).toBe(400);
    expect((await s.a.chef.get(`${url}/triangulation?inconnu=1`)).statusCode).toBe(400);
  });

  it("une dimension désactivée sort de la carte et ses preuves sont signalées", async () => {
    const m = await nouvelleMission("Triangulation retrait");
    const url = `/api/missions/${m}/preuves`;
    const d = (
      await s.a.chef.post(`${url}/dimensions`, { code: "marche", libelle: "Marché" })
    ).json();
    await creerPreuve(s.a.chef, m, { dimensions: ["marche"] });
    await s.a.chef.patch(`${url}/dimensions/${d.id}`, { actif: false });
    const carte = (await s.a.chef.get(`${url}/triangulation`)).json();
    expect(carte.dimensions).toEqual([]);
    expect(carte.rattachements_inconnus).toHaveLength(1);
    expect(carte.rattachements_inconnus[0].dimension).toBe("marche");
  });
});

describe("contrôle PRV-03 des livrables R2 et R3", () => {
  it("signale les assertions sans preuve ni avis d'expert signé ; ignore R0 et R1", async () => {
    const m = await nouvelleMission("Contrôle");
    const url = `/api/missions/${m}/preuves/controle`;
    const sans = await creerAssertion(s.a.chef, m, { enonce: "Sans preuve", classe_risque: "R3" });
    const avisNonSigne = await creerAssertion(s.a.chef, m, {
      enonce: "Avis non signé",
      avis_expert: true,
      avis_expert_motif: "Expérience du terrain.",
    });
    const avisSigne = await creerAssertion(s.a.chef, m, {
      enonce: "Avis signé",
      avis_expert: true,
      avis_expert_motif: "Expérience du terrain.",
      signer_avis: true,
    });
    const etayee = await creerAssertion(s.a.chef, m, { enonce: "Étayée" });
    await lier(s.a.chef, etayee.id, (await creerPreuve(s.a.chef, m)).id, "pour");
    const seulementContre = await creerAssertion(s.a.chef, m, { enonce: "Seulement contre" });
    await lier(s.a.chef, seulementContre.id, (await creerPreuve(s.a.chef, m)).id, "contre");
    await creerAssertion(s.a.chef, m, { enonce: "Note interne", classe_risque: "R1" });
    await creerAssertion(s.a.chef, m, { enonce: "Abandon", statut: "abandonnee" });

    const c = (await s.a.chef.get(url)).json();
    expect(c.conforme).toBe(false);
    expect(c.controlees).toBe(5);
    expect(c.ignorees).toBe(1);
    const codes = Object.fromEntries(
      c.anomalies.map((a: { assertion_id: string; code: string }) => [a.assertion_id, a.code]),
    );
    expect(codes).toEqual({
      [sans.id]: "SANS_PREUVE",
      [avisNonSigne.id]: "AVIS_EXPERT_NON_SIGNE",
      [seulementContre.id]: "SANS_PREUVE",
    });
    expect(codes[avisSigne.id]).toBeUndefined();
    expect(codes[etayee.id]).toBeUndefined();
    expect(
      c.anomalies.find((a: { assertion_id: string }) => a.assertion_id === sans.id),
    ).toMatchObject({
      classe_risque: "R3",
      enonce: "Sans preuve",
    });
  });

  it("filtre par livrable ; conforme quand tout est étayé ; droits", async () => {
    const m = await nouvelleMission("Contrôle livrable");
    const url = `/api/missions/${m}/preuves/controle`;
    await creerAssertion(s.a.chef, m, { livrable: "Note de cadrage", classe_risque: "R2" });
    const ok = await creerAssertion(s.a.chef, m, {
      livrable: "Rapport final",
      ...{ classe_risque: "R2" },
    });
    await lier(s.a.chef, ok.id, (await creerPreuve(s.a.chef, m)).id, "pour");
    expect(
      (await s.a.chef.get(`${url}?livrable=${encodeURIComponent("Rapport final")}`)).json(),
    ).toMatchObject({
      conforme: true,
      controlees: 1,
      livrable: "Rapport final",
    });
    expect(
      (await s.a.chef.get(`${url}?livrable=${encodeURIComponent("Note de cadrage")}`)).json()
        .conforme,
    ).toBe(false);
    expect((await s.a.chef.get(url)).json().anomalies).toHaveLength(1);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect(ASSERTION_R2.classe_risque).toBe("R2");
  });
});
