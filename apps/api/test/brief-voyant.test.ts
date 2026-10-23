import { briefSchema, type BriefApi, type ElementBriefApi } from "@missionpilot/shared";
import { ErreurRedressement } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PLAFOND_DOSSIERS_VOYANT, PLAFOND_EVALUATIONS_VOYANT } from "../src/brief/derives.js";
import type { Api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { ouvrirDossierRed, preparerRed, type ScenarioRed } from "./redressement-outils.js";
import { creerMission } from "./missions-outils.js";
import { dossierNeuf, semerUrgenceRouge } from "./redressement-tableau-outils.js";

/*
 * Brief quotidien (AUT-07), source « voyant de redressement au rouge » (famille « Ça dérive ») :
 * présente pour qui détient `redressement.lire` ET voit la mission ; absente sans la permission,
 * pour une mission invisible, entre cabinets, pour un voyant qui n'est pas rouge ; aucun montant
 * (FIN-02), même pour qui détient `finance.lire` ; libellés français.
 */

/* Substitution ciblée : passe-plat, sauf pour les dossiers désignés (calcul défaillant). */
const controle = vi.hoisted(() => ({ defaillants: new Set<string>(), appels: 0 }));
vi.mock("../src/redressement/voyant.js", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../src/redressement/voyant.js")>();
  return {
    ...reel,
    rassemblerDonneesVoyant: (...args: Parameters<typeof reel.rassemblerDonneesVoyant>) => {
      controle.appels += 1;
      if (controle.defaillants.has(args[2].id)) {
        throw new ErreurRedressement("BASE_INCOMPLETE", "Donnée incohérente (test).");
      }
      return reel.rassemblerDonneesVoyant(...args);
    },
  };
});

let ctx: Contexte;
let s: ScenarioRed;
let rouge: string; // dossier au rouge (urgence), mission de l'équipe
let sansDonnee: string; // dossier sans donnée : voyant inconnu
let rougeB: string; // dossier au rouge du cabinet B

const aujourdhui = (): string => new Date().toISOString().slice(0, 10);
const dansJours = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function lire(par: Api, date?: string): Promise<BriefApi> {
  const r = await par.get(date ? `/api/brief?date=${date}` : "/api/brief");
  expect(r.statusCode, r.body).toBe(200);
  expect(briefSchema.safeParse(r.json()).success, r.body).toBe(true);
  return r.json() as BriefApi;
}
const voyants = (br: BriefApi): ElementBriefApi[] =>
  br.familles.deriver.elements.filter((e) => e.type === "voyant_rouge");
const ids = (br: BriefApi): string[] => voyants(br).map((e) => e.entite_id);

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "Brief voyant");
  rouge = (await ouvrirDossierRed(s, s.missionId, { intitule: "Redressement Alpha" })).id;
  await semerUrgenceRouge(s.a.chef, rouge);
  sansDonnee = (await dossierNeuf(s, "Mission sans donnée")).dossierId;
  rougeB = (await ouvrirDossierRed(s, s.missionB, { intitule: "Redressement B" }, s.b.chef)).id;
  await semerUrgenceRouge(s.b.chef, rougeB);
});

afterAll(async () => {
  await ctx.fermer();
});

describe("brief : voyant de redressement au rouge", () => {
  it("le chef de mission voit le dossier au rouge, avec lien, motifs et gravité haute", async () => {
    const br = await lire(s.a.chef);
    const e = voyants(br).find((x) => x.entite_id === rouge);
    expect(e).toBeDefined();
    expect(e).toMatchObject({
      type: "voyant_rouge",
      famille: "deriver",
      gravite: "haute",
      mission_id: s.missionId,
      lien: `/missions/${s.missionId}/redressement`,
      libelle: "Voyant de redressement au rouge : Redressement Alpha",
    });
    expect(e?.motifs).toEqual(["Le dernier diagnostic d'urgence est au rouge."]);
    expect(br.familles.deriver.total).toBeGreaterThanOrEqual(1);
    expect(br.vide).toBe(false);
  });

  it("un dossier sans donnée (voyant inconnu) n'apparaît pas", async () => {
    expect(ids(await lire(s.a.chef))).not.toContain(sansDonnee);
  });

  it("l'ancienneté part de l'évaluation à l'origine du motif (rejeu à J+5)", async () => {
    const jour = await lire(s.a.chef, aujourdhui());
    expect(voyants(jour).find((x) => x.entite_id === rouge)?.anciennete_jours).toBeLessThanOrEqual(
      1,
    );
    const plusTard = await lire(s.a.chef, dansJours(5));
    expect(
      voyants(plusTard).find((x) => x.entite_id === rouge)?.anciennete_jours,
    ).toBeGreaterThanOrEqual(5);
  });

  it("membre de l'équipe avec redressement.lire : le voit ; hors équipe : mission invisible, absent", async () => {
    expect(ids(await lire(s.consultantEquipe))).toContain(rouge);
    expect(ids(await lire(s.consultantHors))).not.toContain(rouge);
  });

  it("qui voit toutes les missions mais n'a pas redressement.lire : absent", async () => {
    // Le gestionnaire détient brief.lire et voit les missions, pas redressement.lire.
    expect(ids(await lire(s.gestionnaire))).not.toContain(rouge);
    expect(ids(await lire(s.expertExterne))).not.toContain(rouge);
  });

  it("qui voit toutes les missions avec redressement.lire (associé) : le voit", async () => {
    expect(ids(await lire(s.associe2))).toContain(rouge);
  });

  it("redressement.lire sans visibilité de la mission (ressources) : absent", async () => {
    expect(ids(await lire(s.ressources))).not.toContain(rouge);
  });

  it("isolation entre cabinets : chacun ne voit que ses dossiers", async () => {
    expect(ids(await lire(s.a.associe))).not.toContain(rougeB);
    expect(ids(await lire(s.b.associe))).toContain(rougeB);
    expect(ids(await lire(s.b.associe))).not.toContain(rouge);
  });

  it("aucun montant dans l'élément, même pour un utilisateur qui détient finance.lire", async () => {
    for (const par of [s.a.chef, s.associe2, s.a.associe]) {
      const e = voyants(await lire(par)).find((x) => x.entite_id === rouge);
      expect(e).toBeDefined();
      expect(e && "montant" in e).toBe(false);
      expect(e && "devise" in e).toBe(false);
      expect(JSON.stringify(e?.motifs)).not.toMatch(/\d+\s?(XOF|FCFA|EUR|USD|€|\$)/);
    }
  });
});

describe("brief : voyant de redressement, robustesse et plafonds", () => {
  it("lus ≥ évalués : le plafond d'évaluations ne dépasse pas celui des dossiers lus", () => {
    expect(PLAFOND_EVALUATIONS_VOYANT).toBeLessThanOrEqual(PLAFOND_DOSSIERS_VOYANT);
  });

  /** Un dossier de redressement par mission : nouvelle mission, dossier, urgence au rouge ou non. */
  async function dossierSurNouvelleMission(
    cab: ScenarioRed["a"],
    nom: string,
    rougeAussi: boolean,
  ): Promise<string> {
    const mission = (await creerMission(cab, { intitule: nom })).id;
    const id = (await ouvrirDossierRed(s, mission, { intitule: nom }, cab.chef)).id;
    if (rougeAussi) await semerUrgenceRouge(cab.chef, id);
    return id;
  }

  it("un dossier au calcul défaillant est ignoré : 200, les autres sortent, famille tronquée", async () => {
    expect((await lire(s.a.chef)).familles.deriver.tronque).toBe(false);
    const casse = await dossierSurNouvelleMission(s.a, "Redressement cassé", true);
    controle.defaillants.add(casse);
    try {
      const br = await lire(s.a.chef, aujourdhui());
      expect(ids(br)).toContain(rouge);
      expect(ids(br)).not.toContain(casse);
      expect(br.familles.deriver.tronque).toBe(true);
    } finally {
      controle.defaillants.clear();
    }
  });

  it("plafond d'évaluations : pile au plafond, complet ; un dossier de plus, famille tronquée", async () => {
    // Cabinet B : rougeB + (plafond - 1) dossiers sans donnée (voyant inconnu). Peu de rouges :
    // la limite d'affichage de 10 éléments par famille ne joue pas sur `tronque`.
    for (let i = 1; i < PLAFOND_EVALUATIONS_VOYANT; i++) {
      await dossierSurNouvelleMission(s.b, `B plafond ${i}`, false);
    }
    controle.appels = 0;
    const complet = await lire(s.b.associe);
    expect(controle.appels).toBe(PLAFOND_EVALUATIONS_VOYANT);
    expect(complet.familles.deriver.tronque).toBe(false);
    expect(ids(complet)).toEqual([rougeB]);

    await dossierSurNouvelleMission(s.b, "B plafond dernier", false);
    controle.appels = 0;
    const br = await lire(s.b.associe);
    expect(controle.appels).toBe(PLAFOND_EVALUATIONS_VOYANT); // calcul borné
    expect(br.familles.deriver.tronque).toBe(true);
    expect(ids(br)).toEqual([]); // le plus ancien (rougeB) est au-delà du plafond : non évalué
  });
});
