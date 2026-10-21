/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sectionSources } from "../src/rapports/sources.js";
import { demarrer, type Contexte } from "./helpers.js";
import { authDe } from "./ia-outils.js";
import { inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import {
  creerAssertion,
  creerPreuve,
  INCONNU,
  lier,
  PREUVE_DOCUMENT,
  preparerPreuves,
  type ScenarioPreuves,
} from "./preuves-outils.js";

/*
 * Citations cliquables des livrables web (PRV-06) : mêmes numéros [n] que l'annexe « Sources »
 * des exports, droits revérifiés à chaque ouverture, aucune preuve non citée servie.
 */

let ctx: Contexte;
let s: ScenarioPreuves;
let portail: UtilisateurPortail;
const VERBATIM = "Mme Koné dit que les tableaux de bord ne servent à rien.";
const ids: Record<string, string> = {};

const urlSources = (m: string, l = "notation") => `/api/missions/${m}/livrables/${l}/sources`;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerPreuves(ctx, "PRV citations");
  const { chef } = s.a;
  const entretien = await creerPreuve(chef, s.missionId, { extrait: VERBATIM });
  const document = await creerPreuve(chef, s.missionId, PREUVE_DOCUMENT);
  const observation = await creerPreuve(chef, s.missionId, {
    type_source: "observation",
    source_precise: "Visite d'atelier",
    fiabilite: "C",
    extrait: "Aucun tableau de bord affiché.",
  });
  const planOnly = await creerPreuve(chef, s.missionId, { ...PREUVE_DOCUMENT, fiabilite: "B" });
  const nonCitee = await creerPreuve(chef, s.missionId, { source_precise: "Preuve non citée" });
  const brouillon = await creerPreuve(chef, s.missionId, {
    source_precise: "Preuve d'un brouillon",
  });
  Object.assign(ids, {
    entretien: entretien.id,
    document: document.id,
    observation: observation.id,
    planOnly: planOnly.id,
    nonCitee: nonCitee.id,
    brouillon: brouillon.id,
  });

  const retenue = { statut: "retenue" } as const;
  const a1 = await creerAssertion(chef, s.missionId, {
    ...retenue,
    enonce: "Le pilotage repose sur des tableaux de bord peu utilisés.",
    livrable: "Rapport de notation",
  });
  const a2 = await creerAssertion(chef, s.missionId, {
    ...retenue,
    enonce: "Les indicateurs ne sont pas affichés.",
    livrable: "Rapport de notation",
  });
  const aPlan = await creerAssertion(chef, s.missionId, {
    ...retenue,
    enonce: "Le plan doit prioriser la trésorerie.",
    livrable: "Plan stratégique",
  });
  const aBrouillon = await creerAssertion(chef, s.missionId, {
    enonce: "Assertion en brouillon.",
    livrable: "Rapport de notation",
  });
  await lier(chef, a1.id, entretien.id, "pour");
  await lier(chef, a1.id, document.id, "pour");
  await lier(chef, a2.id, observation.id, "pour");
  await lier(chef, a2.id, document.id, "contre");
  await lier(chef, aPlan.id, planOnly.id, "pour");
  await lier(chef, aBrouillon.id, brouillon.id, "pour");
  Object.assign(ids, { a1: a1.id, a2: a2.id, aPlan: aPlan.id, aBrouillon: aBrouillon.id });

  // Autre mission du même cabinet : une preuve citée là-bas ne l'est pas ici.
  const autre = await creerPreuve(chef, s.mission2Id, { source_precise: "Preuve de la mission 2" });
  const a3 = await creerAssertion(chef, s.mission2Id, {
    ...retenue,
    livrable: "Rapport de notation",
  });
  await lier(chef, a3.id, autre.id, "pour");
  ids.autreMission = autre.id;

  // Autre cabinet.
  const pb = await creerPreuve(s.b.chef, s.missionB);
  const ab = await creerAssertion(s.b.chef, s.missionB, {
    ...retenue,
    livrable: "Rapport de notation",
  });
  await lier(s.b.chef, ab.id, pb.id, "pour");
  ids.autreCabinet = pb.id;

  portail = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
}, 240_000);
afterAll(() => ctx.fermer());

describe("liste des sources d'un livrable", () => {
  it("numérote dans l'ordre de première citation, avec solidité et renvois pour / contre", async () => {
    const r = await s.a.chef.get(urlSources(s.missionId));
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.livrable).toBe("notation");
    expect(j.assertions.map((a: any) => a.id)).toEqual([ids.a1, ids.a2]);
    expect(j.assertions[0].renvois).toEqual({ pour: [1, 2], contre: [] });
    expect(j.assertions[1].renvois).toEqual({ pour: [3], contre: [2] });
    for (const a of j.assertions) {
      expect(["solide", "etayee", "fragile"]).toContain(a.solidite.lecture);
      expect(typeof a.solidite.indice).toBe("number");
      expect(a.avis_expert_signe).toBe(false);
    }
    expect(j.sources.map((x: any) => [x.numero, x.preuve_id])).toEqual([
      [1, ids.entretien],
      [2, ids.document],
      [3, ids.observation],
    ]);
    expect(j.sources[1]).toMatchObject({
      type_source: "document",
      fiabilite: "A",
      masque: false,
      extrait: PREUVE_DOCUMENT.extrait,
    });
  });

  it("n'expose ni assertion non retenue, ni assertion d'un autre livrable", async () => {
    const j = (await s.a.chef.get(urlSources(s.missionId))).json();
    const listees = j.assertions.map((a: any) => a.id);
    expect(listees).not.toContain(ids.aBrouillon);
    expect(listees).not.toContain(ids.aPlan);
    const preuves = j.sources.map((x: any) => x.preuve_id);
    for (const k of ["brouillon", "planOnly", "nonCitee"]) expect(preuves).not.toContain(ids[k]);
    const plan = (await s.a.chef.get(urlSources(s.missionId, "plan"))).json();
    expect(plan.assertions.map((a: any) => a.id)).toEqual([ids.aPlan]);
    expect(plan.sources.map((x: any) => [x.numero, x.preuve_id])).toEqual([[1, ids.planOnly]]);
  });

  it("masque pour tous le verbatim nominatif sans accord", async () => {
    for (const u of [s.a.chef, s.a.associe]) {
      const j = (await u.get(urlSources(s.missionId))).json();
      const e = j.sources[0];
      expect(e).toMatchObject({ extrait: null, masque: true });
      expect(e.source_precise).toBe("Source nominative masquée");
      expect(JSON.stringify(j)).not.toContain("Koné");
    }
  });

  it("même numérotation que l'annexe « Sources » des exports", async () => {
    const j = (await s.a.chef.get(urlSources(s.missionId))).json();
    const auth = await authDe(ctx, s.a.cabinetId, s.a.chef.utilisateurId);
    const section = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      sectionSources(db, auth, s.missionId, "notation"),
    );
    const [tAssertions, tSources] = section!.blocs.filter((b) => b.type === "tableau") as any[];
    const refs = (ns: number[]) => ns.map((n) => `[${n}]`).join(", ");
    expect(tAssertions.lignes.map((l: string[]) => [l[0], l[2]])).toEqual(
      j.assertions.map((a: any) => [
        a.enonce,
        [refs(a.renvois.pour), a.renvois.contre.length ? `contre : ${refs(a.renvois.contre)}` : ""]
          .filter(Boolean)
          .join(" ; "),
      ]),
    );
    expect(tSources.lignes.map((l: string[]) => l[0])).toEqual(
      j.sources.map((x: any) => String(x.numero)),
    );
    expect(tSources.lignes.map((l: string[]) => l[4])).toEqual(
      j.sources.map((x: any) => x.fiabilite),
    );
  });

  it("aucune assertion citée : listes vides", async () => {
    const r = await s.a.chef.get(urlSources(s.mission2Id, "plan"));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ livrable: "plan", assertions: [], sources: [] });
  });

  it("droits : sans preuve.lire 403, hors équipe 404, autre cabinet 404, livrable inconnu 400", async () => {
    expect((await s.gestionnaire.get(urlSources(s.missionId))).statusCode).toBe(403);
    expect((await s.consultantHors.get(urlSources(s.missionId))).statusCode).toBe(404);
    expect((await s.b.associe.get(urlSources(s.missionId))).statusCode).toBe(404);
    expect((await s.a.chef.get(urlSources(s.missionB))).statusCode).toBe(404);
    expect((await s.a.chef.get(urlSources(INCONNU))).statusCode).toBe(404);
    expect((await s.a.chef.get(urlSources(s.missionId, "autre"))).statusCode).toBe(400);
    expect((await s.consultantEquipe.get(urlSources(s.missionId))).statusCode).toBe(200);
  });

  it("le portail client est refusé (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    for (const url of [urlSources(s.missionId), `${urlSources(s.missionId)}/${ids.document}`]) {
      const r = await portail.get(url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });
});

describe("ouverture d'une citation", () => {
  it("sert une preuve citée par ce livrable de cette mission", async () => {
    const r = await s.a.chef.get(`${urlSources(s.missionId)}/${ids.document}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: ids.document, extrait: PREUVE_DOCUMENT.extrait });
    // Citée en « contre » seulement : ouverte aussi.
    expect((await s.a.chef.get(`${urlSources(s.missionId)}/${ids.observation}`)).statusCode).toBe(
      200,
    );
  });

  it("le nominatif sans accord reste masqué sauf pour qui peut le voir", async () => {
    const url = `${urlSources(s.missionId)}/${ids.entretien}`;
    const chef = (await s.a.chef.get(url)).json();
    expect(chef).toMatchObject({ masque: false, extrait: VERBATIM });
    const equipe = (await s.consultantEquipe.get(url)).json();
    expect(equipe).toMatchObject({ masque: true, extrait: null });
    expect(JSON.stringify(equipe)).not.toContain("Koné");
  });

  it("refuse (404) toute preuve non autorisée, même réponse pour tous les cas", async () => {
    const cas: [string, string][] = [
      ["preuve d'une autre mission du même cabinet", ids.autreMission!],
      ["preuve du cabinet B", ids.autreCabinet!],
      ["preuve non citée", ids.nonCitee!],
      ["preuve d'une assertion non retenue", ids.brouillon!],
      ["preuve citée par un autre livrable", ids.planOnly!],
      ["identifiant inconnu", INCONNU],
    ];
    const corps = new Set<string>();
    for (const [nom, preuveId] of cas) {
      const r = await s.a.chef.get(`${urlSources(s.missionId)}/${preuveId}`);
      expect(r.statusCode, nom).toBe(404);
      expect(r.json().erreur.code, nom).toBe("INTROUVABLE");
      corps.add(JSON.stringify(r.json()));
    }
    expect(corps.size).toBe(1);
    // Le livrable « plan » ouvre sa propre preuve, pas celles de la notation.
    const plan = urlSources(s.missionId, "plan");
    expect((await s.a.chef.get(`${plan}/${ids.planOnly}`)).statusCode).toBe(200);
    expect((await s.a.chef.get(`${plan}/${ids.document}`)).statusCode).toBe(404);
  });

  it("revérifie les droits à chaque ouverture", async () => {
    const url = `${urlSources(s.missionId)}/${ids.document}`;
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.consultantHors.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    // Une preuve du cabinet A demandée via une mission du cabinet B reste introuvable.
    expect((await s.b.chef.get(`${urlSources(s.missionB)}/${ids.document}`)).statusCode).toBe(404);
    expect(
      (await s.a.chef.get(`${urlSources(s.missionId, "autre")}/${ids.document}`)).statusCode,
    ).toBe(400);
  });
});

describe("mission clôturée", () => {
  it("la lecture des citations reste possible", async () => {
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [s.missionId, s.a.associeId],
      ),
    );
    const r = await s.a.chef.get(urlSources(s.missionId));
    expect(r.statusCode).toBe(200);
    expect(r.json().sources).toHaveLength(3);
    expect((await s.a.chef.get(`${urlSources(s.missionId)}/${ids.document}`)).statusCode).toBe(200);
  });
});
