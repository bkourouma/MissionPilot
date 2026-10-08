import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import {
  ASSERTION_R2,
  creerAssertion,
  creerPreuve,
  INCONNU,
  lier,
  PREUVE_DOCUMENT,
  preparerPreuves,
  type ScenarioPreuves,
} from "./preuves-outils.js";

/*
 * Registre des preuves (PRV-02, PRV-04) : liens pour et contre, indice de solidité calculé par le
 * moteur (jamais par l'API), contradictions à arbitrer, arbitrage tracé, liens retirés.
 */

let ctx: Contexte;
let s: ScenarioPreuves;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerPreuves(ctx, "PRV solidité");
}, 180_000);
afterAll(() => ctx.fermer());

describe("indice de solidité (moteur)", () => {
  it("une assertion sans preuve est fragile à 0 ; chaque type de source indépendant compte", async () => {
    const a = await creerAssertion(s.a.chef, s.missionId);
    expect(a.solidite).toMatchObject({ indice: 0, lecture: "fragile", preuves_pour: 0 });

    const entretien = await creerPreuve(s.a.chef, s.missionId); // B = 0,75
    const d1 = await lier(s.a.chef, a.id, entretien.id, "pour");
    // 75 / 200 = 0,375 : une seule source, fragile.
    expect(d1.solidite).toMatchObject({ indice: 0.375, lecture: "fragile", preuves_pour: 1 });

    // Une seconde preuve du MÊME type de source n'ajoute rien.
    const entretien2 = await creerPreuve(s.a.chef, s.missionId, { fiabilite: "A" });
    const d2 = await lier(s.a.chef, a.id, entretien2.id, "pour");
    expect(d2.solidite.indice).toBe(0.5); // meilleure fiabilité du type : A = 100 / 200
    expect(d2.solidite.lecture).toBe("etayee");

    // Un second type de source : (100 + 100) / 200 = 1, plafonné.
    const doc = await creerPreuve(s.a.chef, s.missionId, PREUVE_DOCUMENT);
    const d3 = await lier(s.a.chef, a.id, doc.id, "pour");
    expect(d3.solidite).toMatchObject({ indice: 1, lecture: "solide", plafonnee: false });
    expect(d3.solidite.fiabilites_retenues).toEqual([
      { type_source: "entretien", fiabilite: "A", poids_centiemes: 100 },
      { type_source: "document", fiabilite: "A", poids_centiemes: 100 },
    ]);
  });

  it("la liste des assertions porte l'indice et la lecture ; le corps ne peut pas les imposer", async () => {
    const a = await creerAssertion(s.a.chef, s.missionId, {
      enonce: "Assertion de la liste.",
    });
    const forcee = await s.a.chef.post(`/api/missions/${s.missionId}/assertions`, {
      ...ASSERTION_R2,
      indice: 1,
      lecture: "solide",
    });
    expect(forcee.statusCode).toBe(400);
    const liste = (await s.a.chef.get(`/api/missions/${s.missionId}/assertions?limite=100`)).json();
    const ligne = liste.elements.find((e: { id: string }) => e.id === a.id);
    expect(ligne.solidite.lecture).toBe("fragile");
    const filtre = (
      await s.a.chef.get(`/api/missions/${s.missionId}/assertions?classe_risque=R3`)
    ).json();
    expect(filtre.elements).toHaveLength(0);
  });

  it("assertions fragiles : classes les plus risquées d'abord, abandonnées exclues", async () => {
    const m = (
      await s.a.associe.post("/api/missions", {
        intitule: "Mission revue",
        client_id: s.a.clientId,
        type_mission_id: s.a.typePlanId,
        directeur_id: s.a.directeur.utilisateurId,
        chef_id: s.a.chef.utilisateurId,
        date_debut: "2026-11-02",
        date_fin: "2027-01-29",
      })
    ).json().id as string;
    const r1 = await creerAssertion(s.a.chef, m, { classe_risque: "R1", enonce: "Interne" });
    const r3 = await creerAssertion(s.a.chef, m, { classe_risque: "R3", enonce: "Engageante" });
    await creerAssertion(s.a.chef, m, {
      classe_risque: "R2",
      statut: "abandonnee",
      enonce: "Abandon",
    });
    const solide = await creerAssertion(s.a.chef, m, { enonce: "Solide" });
    await lier(
      s.a.chef,
      solide.id,
      (await creerPreuve(s.a.chef, m, { fiabilite: "A" })).id,
      "pour",
    );
    await lier(s.a.chef, solide.id, (await creerPreuve(s.a.chef, m, PREUVE_DOCUMENT)).id, "pour");
    const r = (await s.a.chef.get(`/api/missions/${m}/assertions/fragiles`)).json();
    expect(r.elements.map((e: { id: string }) => e.id)).toEqual([r3.id, r1.id]);
    expect(r.elements[0]).toMatchObject({ lecture: "fragile", indice: 0, classe_risque: "R3" });
  });
});

describe("liens et contradictions (PRV-04)", () => {
  it("une preuve contre divise l'indice par deux ; l'arbitrage le rétablit ; une correction de la preuve rouvre", async () => {
    const a = await creerAssertion(s.a.chef, s.missionId, { enonce: "Contradiction" });
    const pour1 = await creerPreuve(s.a.chef, s.missionId, { fiabilite: "A" });
    const pour2 = await creerPreuve(s.a.chef, s.missionId, PREUVE_DOCUMENT);
    await lier(s.a.chef, a.id, pour1.id, "pour");
    const base = await lier(s.a.chef, a.id, pour2.id, "pour");
    expect(base.solidite).toMatchObject({ indice: 1, lecture: "solide" });

    const contre = await creerPreuve(s.a.chef, s.missionId, {
      type_source: "questionnaire",
      source_precise: "Réponse du DAF au questionnaire de maturité",
      fiabilite: "B",
    });
    const d = await lier(s.a.chef, a.id, contre.id, "contre");
    expect(d.solidite).toMatchObject({
      indice: 0.5,
      lecture: "etayee",
      contradiction_non_resolue: true,
      preuves_contre: 1,
    });
    expect(d.preuves_contre[0].a_arbitrer).toBe(true);

    const file = (await s.a.chef.get(`/api/missions/${s.missionId}/preuves/contradictions`)).json();
    const entree = file.elements.find(
      (e: { assertion: { id: string } }) => e.assertion.id === a.id,
    );
    expect(entree.a_arbitrer).toEqual([contre.id]);

    const arb = await s.consultantEquipe.post(`/api/assertions/${a.id}/arbitrages`, {
      preuve_id: contre.id,
      decision: "contradiction_levee",
      motif: "Le répondant a confondu deux exercices ; confirmé en entretien.",
    });
    expect(arb.statusCode).toBe(201);
    const apres = arb.json();
    expect(apres.solidite).toMatchObject({ indice: 1, contradiction_non_resolue: false });
    expect(apres.preuves_contre[0]).toMatchObject({ a_arbitrer: false });
    expect(apres.preuves_contre[0].arbitrage).toMatchObject({
      decision: "contradiction_levee",
      preuve_version: 1,
    });
    expect(apres.preuves_contre[0].arbitrage.arbitre.id).toBe(s.consultantEquipe.utilisateurId);
    expect(apres.arbitrages).toHaveLength(1);

    const ouvertes = (
      await s.a.chef.get(`/api/missions/${s.missionId}/preuves/contradictions`)
    ).json();
    expect(
      ouvertes.elements.some((e: { assertion: { id: string } }) => e.assertion.id === a.id),
    ).toBe(false);
    const closes = (
      await s.a.chef.get(`/api/missions/${s.missionId}/preuves/contradictions?resolues=oui`)
    ).json();
    expect(
      closes.elements.some((e: { assertion: { id: string } }) => e.assertion.id === a.id),
    ).toBe(true);

    // Corriger la preuve contraire rouvre la contradiction : l'arbitrage visait la version 1.
    await s.a.chef.post(`/api/preuves/${contre.id}/versions`, {
      type_source: "questionnaire",
      source_precise: "Réponse du DAF au questionnaire de maturité",
      date_preuve: "2026-10-12",
      fiabilite: "A",
      motif: "Réponse confirmée par écrit.",
    });
    const rouvert = (await s.a.chef.get(`/api/assertions/${a.id}`)).json();
    expect(rouvert.solidite).toMatchObject({ indice: 0.5, contradiction_non_resolue: true });
    expect(rouvert.preuves_contre[0].a_arbitrer).toBe(true);
    expect(rouvert.arbitrages).toHaveLength(1); // l'historique reste
  });

  it("l'arbitrage ne vise qu'une preuve liée « contre » ; il exige un motif", async () => {
    const a = await creerAssertion(s.a.chef, s.missionId);
    const p = await creerPreuve(s.a.chef, s.missionId);
    await lier(s.a.chef, a.id, p.id, "pour");
    const corps = { preuve_id: p.id, decision: "contradiction_levee", motif: "Motif." };
    const surPour = await s.a.chef.post(`/api/assertions/${a.id}/arbitrages`, corps);
    expect(surPour.statusCode).toBe(409);
    expect(surPour.json().erreur.code).toBe("ARBITRAGE_INVALIDE");
    expect(
      (await s.a.chef.post(`/api/assertions/${a.id}/arbitrages`, { ...corps, motif: "" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await s.a.chef.post(`/api/assertions/${a.id}/arbitrages`, { ...corps, preuve_id: INCONNU }))
        .statusCode,
    ).toBe(404);
    const lecteur = await s.expertMetier.post(`/api/assertions/${a.id}/arbitrages`, corps);
    expect(lecteur.statusCode).toBe(403);
  });

  it("délier retire la preuve (événement), changer de sens est un nouveau lien ; doublons refusés", async () => {
    const a = await creerAssertion(s.a.chef, s.missionId);
    const p = await creerPreuve(s.a.chef, s.missionId, { fiabilite: "A" });
    await lier(s.a.chef, a.id, p.id, "pour");
    const doublon = await s.a.chef.post(`/api/assertions/${a.id}/liens`, {
      preuve_id: p.id,
      sens: "pour",
    });
    expect(doublon.statusCode).toBe(409);
    const contre = await lier(s.a.chef, a.id, p.id, "contre");
    expect(contre.preuves_pour).toHaveLength(0);
    expect(contre.preuves_contre).toHaveLength(1);
    const retire = await s.a.chef.delete(`/api/assertions/${a.id}/liens/${p.id}`);
    expect(retire.statusCode).toBe(200);
    expect(retire.json().solidite).toMatchObject({ indice: 0, preuves_pour: 0, preuves_contre: 0 });
    expect((await s.a.chef.delete(`/api/assertions/${a.id}/liens/${p.id}`)).statusCode).toBe(404);
    const detail = (await s.a.chef.get(`/api/preuves/${p.id}`)).json();
    expect(detail.assertions.some((x: { assertion_id: string }) => x.assertion_id === a.id)).toBe(
      false,
    );
    await lier(s.a.chef, a.id, p.id, "contre");
    expect(
      (await s.a.chef.get(`/api/assertions/${a.id}`)).json().solidite.contradiction_non_resolue,
    ).toBe(true);
  });

  it("une preuve d'une autre mission ne se lie pas (404)", async () => {
    const a = await creerAssertion(s.a.chef, s.missionId);
    const autre = await creerPreuve(s.a.chef, s.mission2Id);
    const r = await s.a.chef.post(`/api/assertions/${a.id}/liens`, {
      preuve_id: autre.id,
      sens: "pour",
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("assertions : versions et avis d'expert", () => {
  it("une correction crée une version avec motif ; la signature est celle de l'auteur de la version", async () => {
    const a = await creerAssertion(s.a.chef, s.missionId, {
      avis_expert: true,
      avis_expert_motif: "Constat de terrain non documentable.",
    });
    expect(a.avis_expert).toMatchObject({ signe: false, signe_par: null });
    const sansMotif = await s.consultantEquipe.post(`/api/assertions/${a.id}/versions`, {
      ...ASSERTION_R2,
      avis_expert: true,
      avis_expert_motif: "Constat.",
      signer_avis: true,
    });
    expect(sansMotif.statusCode).toBe(400);
    const r = await s.consultantEquipe.post(`/api/assertions/${a.id}/versions`, {
      ...ASSERTION_R2,
      avis_expert: true,
      avis_expert_motif: "Constat de terrain non documentable.",
      signer_avis: true,
      motif: "Signature de l'avis.",
    });
    expect(r.statusCode).toBe(201);
    const d = r.json();
    expect(d.version).toBe(2);
    expect(d.avis_expert.signe).toBe(true);
    expect(d.avis_expert.signe_par.id).toBe(s.consultantEquipe.utilisateurId);
    expect(d.historique.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    // Une nouvelle version ne reprend pas la signature.
    const v3 = await s.a.chef.post(`/api/assertions/${a.id}/versions`, {
      ...ASSERTION_R2,
      enonce: "Énoncé reformulé.",
      avis_expert: true,
      avis_expert_motif: "Constat de terrain non documentable.",
      motif: "Reformulation.",
    });
    expect(v3.json().avis_expert.signe).toBe(false);
  });

  it("incohérences refusées (400) : motif sans avis, avis sans motif, rattachement incomplet, dimension inconnue", async () => {
    const url = `/api/missions/${s.missionId}/assertions`;
    for (const corps of [
      { ...ASSERTION_R2, avis_expert_motif: "Seul." },
      { ...ASSERTION_R2, avis_expert: true },
      { ...ASSERTION_R2, signer_avis: true },
      { ...ASSERTION_R2, rattachement_type: "risque" },
      { ...ASSERTION_R2, classe_risque: "R9" },
      { ...ASSERTION_R2, rattachement_type: "dimension", rattachement_code: "inexistante" },
    ]) {
      expect((await s.a.chef.post(url, corps)).statusCode, JSON.stringify(corps)).toBe(400);
    }
    expect(
      (
        await s.a.chef.post(url, {
          ...ASSERTION_R2,
          rattachement_type: "risque",
          rattachement_code: "R-12",
        })
      ).statusCode,
    ).toBe(201);
  });
});
