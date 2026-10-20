import { randomUUID } from "node:crypto";
import { briefSchema, type BriefApi, type ElementBriefApi } from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAFOND_PAR_SOURCE } from "../src/brief/commun.js";
import { cabinetTest, type Api, type CabinetTest } from "./api.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee } from "./missions-outils.js";

/*
 * Brief quotidien (AUT-07), sources « offre technique », « plan stratégique » et « révision de
 * budget » à valider. Pour chacune : présente pour qui détient la permission de la route qui valide
 * ET voit la mission, absente sans la permission, pour une mission invisible, pour l'auteur
 * (séparation des tâches), entre cabinets ; aucun montant (FIN-02) ; aucun contenu client ;
 * plafond de lecture par source.
 */

const SECRET = "VERBATIM-CLIENT-SECRET";
type Utilisateur = Api & { utilisateurId: string };

let ctx: Contexte;
let a: CabinetFacturation;
let mA: string; // mission du directeur et du chef de A
let chef2: Utilisateur; // chef de mission hors équipe : ne voit pas mA
let consultant: Utilisateur; // détient « ao.gerer », pas « plan.valider » ni « budget.reviser »
let ressources: Utilisateur; // voit toutes les missions, aucune des trois permissions
let associe2: Utilisateur;
let b: CabinetTest;
let associeB2: Utilisateur;
const ids: Record<string, string> = {};

async function lire(par: Api, date?: string): Promise<BriefApi> {
  const r = await par.get(date ? `/api/brief?date=${date}` : "/api/brief");
  expect(r.statusCode, r.body).toBe(200);
  expect(briefSchema.safeParse(r.json()).success, r.body).toBe(true);
  return r.json() as BriefApi;
}
const tous = (br: BriefApi): ElementBriefApi[] => [
  ...br.familles.decider.elements,
  ...br.familles.deriver.elements,
  ...br.familles.envoyer.elements,
];
const idsDuType = (br: BriefApi, type: string) =>
  tous(br)
    .filter((e) => e.type === type)
    .map((e) => e.entite_id);

async function offre(
  cabinetId: string,
  createur: string,
  titre: string,
  validePar?: string,
): Promise<string> {
  return proprietaire(async (c) => {
    const o = await c.query(
      `INSERT INTO ao_offres_techniques (cabinet_id, titre, contexte, cree_par)
       VALUES ($1, $2, '{}', $3) RETURNING id`,
      [cabinetId, titre, createur],
    );
    const sections = JSON.stringify({
      comprehension: SECRET,
      methodologie: SECRET,
      planning: SECRET,
      organisation: SECRET,
    });
    const v = await c.query(
      `INSERT INTO ao_offre_technique_versions (cabinet_id, offre_id, version, sections, origine,
         cree_par) VALUES ($1, $2, 1, $3, 'gabarit', $4) RETURNING id`,
      [cabinetId, o.rows[0].id, sections, createur],
    );
    if (validePar) {
      await c.query(
        `INSERT INTO ao_offre_technique_validations (cabinet_id, offre_id, version_id, valide_par)
         VALUES ($1, $2, $3, $4)`,
        [cabinetId, o.rows[0].id, v.rows[0].id, validePar],
      );
    }
    return o.rows[0].id as string;
  });
}

interface OptionsPlan {
  titre: string;
  auteur: string;
  statut?: "brouillon" | "brouillon_ia" | "modifie";
  modelePar?: string;
}

async function plan(missionId: string, o: OptionsPlan): Promise<string> {
  return proprietaire(async (c) => {
    const p = await c.query(
      `INSERT INTO plans_strategiques (cabinet_id, mission_id, titre, cree_par)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [a.cabinetId, missionId, o.titre, o.auteur],
    );
    const id = p.rows[0].id as string;
    if (o.statut) {
      const e = await c.query(
        `INSERT INTO plan_elements (cabinet_id, plan_id, type, cree_par)
         VALUES ($1, $2, 'vision_mission', $3) RETURNING id`,
        [a.cabinetId, id, o.auteur],
      );
      await c.query(
        `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu,
           contenu, auteur_id) VALUES ($1, $2, 1, $3, $4, $5)`,
        [a.cabinetId, e.rows[0].id, o.statut, JSON.stringify({ texte: SECRET }), o.auteur],
      );
    }
    if (o.modelePar) {
      await c.query(
        `INSERT INTO plan_modele_versions (cabinet_id, plan_id, version, hypotheses, ecarts,
           resultat, moteur, cree_par)
         VALUES ($1, $2, 1, '{"horizon":5,"devise":"XOF"}', '{}', '{}', 'test', $3)`,
        [a.cabinetId, id, o.modelePar],
      );
    }
    return id;
  });
}

async function revision(par: Api, missionId: string, corps: Record<string, unknown>) {
  const r = await par.post(`/api/missions/${missionId}/budget/revisions`, corps);
  attendre(201, r, "révision");
  return r.json().id as string;
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Sources A");
  mA = (await creerMissionSignee(a, { intitule: "Mission Sources Un" })).id;
  chef2 = await a.avecRoles(["chef_mission"]);
  consultant = await a.avecRoles(["consultant"]);
  ressources = await a.avecRoles(["ressources"]);
  associe2 = await a.avecRoles(["associe"]);
  b = await cabinetTest(ctx, "Sources B");
  associeB2 = await b.avecRoles(["associe"]);

  // Offres : O1 du chef ; O2 du consultant puis modifiée par le directeur ; O3 validée.
  ids.o1 = await offre(a.cabinetId, a.chef.utilisateurId, "Offre Sources Un");
  ids.o2 = await offre(a.cabinetId, consultant.utilisateurId, "Offre Sources Deux");
  await proprietaire((c) =>
    c.query(
      `INSERT INTO ao_offre_technique_versions (cabinet_id, offre_id, version, sections, origine,
         motif, cree_par)
       SELECT $1, $2, 2, sections, 'manuel', 'Reprise', $3
       FROM ao_offre_technique_versions WHERE offre_id = $2 AND version = 1`,
      [a.cabinetId, ids.o2, a.directeur.utilisateurId],
    ),
  );
  ids.o3 = await offre(a.cabinetId, a.chef.utilisateurId, "Offre Sources Validee", a.associeId);
  ids.oB = await offre(b.cabinetId, b.associeId, "Offre Autre Cabinet");

  // Plans : P1 contenu proposé par l'IA (auteur : le chef) ; P2 modèle financier non validé
  // (auteur : le directeur) ; P3 simple brouillon humain (aucune trace de soumission).
  ids.p1 = await plan(mA, {
    titre: "Plan Sources Un",
    auteur: a.chef.utilisateurId,
    statut: "brouillon_ia",
  });
  ids.p2 = await plan(mA, {
    titre: "Plan Sources Deux",
    auteur: a.directeur.utilisateurId,
    modelePar: a.directeur.utilisateurId,
  });
  ids.p3 = await plan(mA, {
    titre: "Plan Sources Trois",
    auteur: a.chef.utilisateurId,
    statut: "brouillon",
  });

  // Révisions de budget : petite (chef, palier directeur) et majeure (associé, palier associé).
  ids.r1 = await revision(a.chef, mA, { motif: "Ajustement mineur" });
  const mA2 = (await creerMissionSignee(a, { intitule: "Mission Sources Deux" })).id;
  ids.mA2 = mA2;
  ids.r2 = await revision(a.associe, mA2, {
    motif: "Extension majeure",
    lignes: [
      { libelle: "Forfait complémentaire", nature: "honoraires", montant_forfait: 20_000_000 },
    ],
  });
}, 240_000);
afterAll(() => ctx.fermer());

describe("offre technique à valider", () => {
  const TYPE = "offre_technique_a_valider";

  it("proposée à qui détient ao.gerer et n'a rien écrit de l'offre", async () => {
    expect(idsDuType(await lire(a.directeur), TYPE)).toContain(ids.o1);
    expect(idsDuType(await lire(a.associe), TYPE)).toEqual(
      expect.arrayContaining([ids.o1, ids.o2]),
    );
    expect(idsDuType(await lire(consultant), TYPE)).toContain(ids.o1);
  });

  it("absente sans la permission", async () => {
    expect(idsDuType(await lire(ressources), TYPE)).toEqual([]);
    expect(idsDuType(await lire(await a.avecRoles(["expert_metier"])), TYPE)).toEqual([]);
  });

  it("absente pour le créateur de l'offre et pour l'auteur d'une version", async () => {
    expect(idsDuType(await lire(a.chef), TYPE)).not.toContain(ids.o1);
    const creeePar = idsDuType(await lire(consultant), TYPE);
    expect(creeePar).not.toContain(ids.o2);
    const modifieePar = idsDuType(await lire(a.directeur), TYPE);
    expect(modifieePar).not.toContain(ids.o2);
    expect(idsDuType(await lire(a.chef), TYPE)).toContain(ids.o2);
  });

  it("absente quand la dernière version est validée", async () => {
    for (const u of [a.associe, a.directeur, consultant, associe2]) {
      expect(idsDuType(await lire(u), TYPE)).not.toContain(ids.o3);
    }
  });

  it("isolation entre cabinets", async () => {
    expect(idsDuType(await lire(a.associe), TYPE)).not.toContain(ids.oB);
    const vu = idsDuType(await lire(associeB2), TYPE);
    expect(vu).toEqual([ids.oB]);
  });

  it("numéro, titre interne, lien et date seulement : jamais le contenu de l'offre", async () => {
    const r = await a.directeur.get("/api/brief");
    expect(r.body).not.toContain(SECRET);
    const e = (r.json() as BriefApi).familles.decider.elements.find((x) => x.entite_id === ids.o1);
    expect(e).toMatchObject({
      famille: "decider",
      mission_id: null,
      lien: `/appels-offres/banques/offres-techniques/${ids.o1}`,
    });
    expect(e?.libelle).toContain("Offre Sources Un");
    expect(e && "montant" in e).toBe(false);
  });
});

describe("plan stratégique à valider", () => {
  const TYPE = "plan_a_valider";

  it("proposé au responsable de la mission qui détient plan.valider", async () => {
    const dir = idsDuType(await lire(a.directeur), TYPE);
    expect(dir).toEqual(expect.arrayContaining([ids.p1]));
    expect(idsDuType(await lire(a.associe), TYPE)).toEqual(
      expect.arrayContaining([ids.p1, ids.p2]),
    );
  });

  it("le modèle financier non validé suffit, pour un autre que son auteur", async () => {
    expect(idsDuType(await lire(a.chef), TYPE)).toContain(ids.p2);
    expect(idsDuType(await lire(a.directeur), TYPE)).not.toContain(ids.p2);
  });

  it("absent sans la permission, et sans trace de soumission (simple brouillon)", async () => {
    expect(idsDuType(await lire(consultant), TYPE)).toEqual([]);
    expect(idsDuType(await lire(ressources), TYPE)).toEqual([]);
    for (const u of [a.associe, a.directeur, a.chef]) {
      expect(idsDuType(await lire(u), TYPE)).not.toContain(ids.p3);
    }
  });

  it("absent pour l'auteur du contenu", async () => {
    expect(idsDuType(await lire(a.chef), TYPE)).not.toContain(ids.p1);
  });

  it("absent d'une mission que l'utilisateur ne voit pas", async () => {
    expect(idsDuType(await lire(chef2), TYPE)).toEqual([]);
  });

  it("absent pour un autre cabinet ; ni titre de contenu ni chiffre dans la réponse", async () => {
    expect(idsDuType(await lire(associeB2), TYPE)).toEqual([]);
    const r = await a.directeur.get("/api/brief");
    expect(r.body).not.toContain(SECRET);
    const e = (r.json() as BriefApi).familles.decider.elements.find((x) => x.entite_id === ids.p1);
    expect(e).toMatchObject({ mission_id: mA, lien: `/missions/${mA}/plan/${ids.p1}` });
    expect(e && ("montant" in e || "devise" in e)).toBe(false);
  });
});

describe("révision de budget à valider", () => {
  const TYPE = "revision_budget_a_valider";

  it("proposée au directeur de la mission et aux associés", async () => {
    expect(idsDuType(await lire(a.directeur), TYPE)).toContain(ids.r1);
    expect(idsDuType(await lire(a.associe), TYPE)).toEqual(expect.arrayContaining([ids.r1]));
    expect(idsDuType(await lire(associe2), TYPE)).toEqual(expect.arrayContaining([ids.r1, ids.r2]));
  });

  it("absente pour l'auteur de la révision, même associé", async () => {
    expect(idsDuType(await lire(a.chef), TYPE)).toEqual([]);
    expect(idsDuType(await lire(a.associe), TYPE)).not.toContain(ids.r2);
  });

  it("absente sans budget.reviser", async () => {
    for (const u of [consultant, ressources, await a.avecRoles(["gestionnaire"])]) {
      expect(idsDuType(await lire(u), TYPE)).toEqual([]);
    }
  });

  it("absente pour un directeur d'une autre mission ou qui ne voit pas la mission", async () => {
    const autre = await a.avecRoles(["directeur_mission"]);
    expect(idsDuType(await lire(autre), TYPE)).toEqual([]);
    expect(idsDuType(await lire(chef2), TYPE)).toEqual([]);
  });

  it("palier d'approbation : une révision majeure ne revient qu'à un associé", async () => {
    expect(idsDuType(await lire(a.directeur), TYPE)).not.toContain(ids.r2);
  });

  it("jamais de montant ni de devise, avec ou sans finance.lire (FIN-02)", async () => {
    for (const u of [a.directeur, associe2]) {
      const r = await u.get("/api/brief");
      const br = r.json() as BriefApi;
      const e = br.familles.decider.elements.filter((x) => x.type === TYPE);
      expect(e.length).toBeGreaterThan(0);
      for (const x of e) {
        expect("montant" in x || "devise" in x || "ecart_pct" in x).toBe(false);
      }
      expect(r.body).not.toContain("20000000");
      expect(r.body).not.toContain("Extension majeure");
    }
  });

  it("isolation entre cabinets", async () => {
    expect(idsDuType(await lire(associeB2), TYPE)).toEqual([]);
    const e = tous(await lire(a.directeur)).find((x) => x.entite_id === ids.r1);
    expect(e).toMatchObject({
      mission_id: mA,
      lien: `/missions/${mA}/budget`,
      libelle: "Révision de budget à valider : révision n° 2",
    });
  });

  it("l'ancienneté fait monter la gravité comme les autres validations", async () => {
    const br = await lire(a.directeur, "2100-01-01");
    const e = tous(br).find((x) => x.entite_id === ids.r1);
    expect(e?.gravite).toBe("haute");
    expect(e?.anciennete_jours).toBeGreaterThan(7);
  });
});

describe("plafond de lecture par source", () => {
  it(`plans : au plus ${PLAFOND_PAR_SOURCE} lignes lues, le reste compté dans le total`, async () => {
    const c = await preparerFacturation(ctx, "Sources C");
    const m = (await creerMissionSignee(c, { intitule: "Mission Plafond" })).id;
    await proprietaire(async (cl) => {
      for (let i = 0; i < PLAFOND_PAR_SOURCE + 5; i++) {
        const p = await cl.query(
          `INSERT INTO plans_strategiques (cabinet_id, mission_id, titre, cree_par)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [c.cabinetId, m, `Plan ${i}`, c.chef.utilisateurId],
        );
        const e = await cl.query(
          `INSERT INTO plan_elements (cabinet_id, plan_id, type, cree_par)
           VALUES ($1, $2, 'vision_mission', $3) RETURNING id`,
          [c.cabinetId, p.rows[0].id, c.chef.utilisateurId],
        );
        await cl.query(
          `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu,
             contenu, auteur_id) VALUES ($1, $2, 1, 'brouillon_ia', '{}', $3)`,
          [c.cabinetId, e.rows[0].id, c.chef.utilisateurId],
        );
      }
    });
    const br = await lire(c.directeur);
    expect(br.familles.decider.total).toBe(PLAFOND_PAR_SOURCE + 5);
    expect(br.familles.decider.tronque).toBe(true);
    expect(br.familles.decider.elements).toHaveLength(10);
  });

  it(`offres : au plus ${PLAFOND_PAR_SOURCE} lignes lues, le reste compté dans le total`, async () => {
    const d = await cabinetTest(ctx, "Sources D");
    const lecteur = await d.avecRoles(["consultant"]);
    for (let i = 0; i < PLAFOND_PAR_SOURCE + 5; i++) {
      await offre(d.cabinetId, d.associeId, `Offre ${i} ${randomUUID().slice(0, 4)}`);
    }
    const br = await lire(lecteur);
    expect(br.familles.decider.total).toBe(PLAFOND_PAR_SOURCE + 5);
    expect(br.familles.decider.tronque).toBe(true);
  });
});
