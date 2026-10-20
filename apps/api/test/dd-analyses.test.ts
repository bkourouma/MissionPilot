/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import {
  AFFIRMATION,
  attendu,
  creerDossierDd,
  creerPointDd,
  INCONNU,
  preparerDd,
  sourcer,
  type ScenarioDd,
} from "./dd-outils.js";

/*
 * Analyses PESTEL, cinq forces, SWOT, opérationnelle (DD-03, DD-05, R07 à R09) : un point est une
 * assertion du registre des preuves (visible par ses routes), sa solidité sort du moteur, le
 * retrait l'abandonne, signer un avis d'expert est réservé.
 */

let ctx: Contexte;
let s: ScenarioDd;
let dossier: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD analyses");
  dossier = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
}, 240_000);
afterAll(() => ctx.fermer());

describe("R08 : création d'un point", () => {
  it("401, 403 (expert métier sans dd.ecrire, gestionnaire), 404 (autre cabinet, hors équipe)", async () => {
    const corps = { analyse: "pestel", categorie: "politique", ...AFFIRMATION };
    const url = `/api/dd/dossiers/${dossier}/points`;
    expect((await s.expertMetier.post(url, corps)).statusCode).toBe(403);
    expect((await s.gestionnaire.post(url, corps)).statusCode).toBe(403);
    expect((await s.b.associe.post(url, corps)).statusCode).toBe(404);
    expect((await s.consultantHors.post(url, corps)).statusCode).toBe(404);
  });

  it("crée l'élément et une assertion visible par les routes du registre", async () => {
    const p = await creerPointDd(s.consultantEquipe, dossier, {
      analyse: "swot",
      categorie: "forces",
      enonce: "Une main-d'œuvre qualifiée et abondante.",
    });
    expect(p.version).toBe(1);
    const a = attendu(200, await s.consultantEquipe.get(`/api/assertions/${p.assertion_id}`));
    expect(a).toMatchObject({
      enonce: "Une main-d'œuvre qualifiée et abondante.",
      classe_risque: "R2",
      statut: "retenue",
      livrable: "Note au comité — due diligence",
      rattachement: { type: "dimension", code: "dd.swot.forces" },
    });
    expect(a.solidite.lecture).toBe("fragile");
  });

  it("400 : catégorie étrangère à l'analyse, classe R1, champ inconnu", async () => {
    const url = `/api/dd/dossiers/${dossier}/points`;
    for (const extra of [
      { categorie: "forces" },
      { classe_risque: "R1" },
      { inconnu: 1 },
      { analyse: "autre" },
    ]) {
      const r = await s.consultantEquipe.post(url, {
        analyse: "pestel",
        categorie: "politique",
        ...AFFIRMATION,
        ...extra,
      });
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
    }
  });

  it("signer un avis d'expert est réservé (403 pour un consultant)", async () => {
    const r = await s.consultantEquipe.post(`/api/dd/dossiers/${dossier}/points`, {
      analyse: "pestel",
      categorie: "social",
      ...AFFIRMATION,
      avis_expert: true,
      avis_expert_motif: "Constat de l'expert.",
      signer_avis: true,
    });
    expect(r.statusCode).toBe(403);
    const ok = await s.consultantEquipe.post(`/api/dd/dossiers/${dossier}/points`, {
      analyse: "pestel",
      categorie: "social",
      ...AFFIRMATION,
      avis_expert: true,
      avis_expert_motif: "Constat de l'expert.",
    });
    expect(ok.statusCode).toBe(201);
  });

  it("la lecture expose les quatre analyses", async () => {
    const lecture = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${dossier}/analyses`));
    expect(lecture.analyses).toHaveLength(4);
  });
});

describe("R07 : lecture et solidité", () => {
  it("lier une preuve change la solidité (valeur du moteur), par catégorie et couverture", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const solide = await creerPointDd(s.consultantEquipe, d, { enonce: "Fait solide." });
    const etaye = await creerPointDd(s.consultantEquipe, d, { enonce: "Fait étayé." });
    const fragile = await creerPointDd(s.consultantEquipe, d, { enonce: "Fait fragile." });
    await sourcer(s.consultantEquipe, s.missionId, solide.assertion_id, "solide");
    await sourcer(s.consultantEquipe, s.missionId, etaye.assertion_id, "etayee");
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/analyses`));
    const pestel = l.analyses.find((a: any) => a.analyse === "pestel");
    expect(pestel.categories.map((c: any) => c.categorie)).toEqual([
      "politique",
      "economique",
      "social",
      "technologique",
      "environnemental",
      "juridique",
    ]);
    const points = pestel.categories[0].points;
    const lecture = (id: string) => points.find((p: any) => p.id === id).solidite.lecture;
    expect(lecture(solide.id)).toBe("solide");
    expect(lecture(etaye.id)).toBe("etayee");
    expect(lecture(fragile.id)).toBe("fragile");
    expect(points.find((p: any) => p.id === solide.id)).toMatchObject({
      assertion_id: solide.assertion_id,
      nb_pour: 2,
      nb_contre: 0,
    });
    expect(l.couverture).toEqual({ points: 3, solides: 1, etayes: 1, fragiles: 1 });
    const filtre = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${d}/analyses?analyse=swot`),
    );
    expect(filtre.analyses).toHaveLength(1);
    expect((await s.expertMetier.get(`/api/dd/dossiers/${d}/analyses?analyse=x`)).statusCode).toBe(
      400,
    );
  });

  it("404 pour un autre cabinet et une mission invisible ; 401 sans session", async () => {
    expect((await s.b.associe.get(`/api/dd/dossiers/${dossier}/analyses`)).statusCode).toBe(404);
    expect((await s.consultantHors.get(`/api/dd/dossiers/${dossier}/analyses`)).statusCode).toBe(
      404,
    );
    expect((await s.expertExterne.get(`/api/dd/dossiers/${dossier}/analyses`)).statusCode).toBe(
      403,
    );
    expect((await s.expertMetier.get(`/api/dd/dossiers/${INCONNU}/analyses`)).statusCode).toBe(404);
  });
});

describe("R09 : versions d'un point", () => {
  it("corrige l'énoncé (nouvelle version d'assertion), puis retire et rétablit", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const p = await creerPointDd(s.consultantEquipe, d);
    const url = `/api/dd/points/${p.id}/versions`;
    const v2 = attendu(
      201,
      await s.consultantEquipe.post(url, {
        version_courante: 1,
        motif: "Reformulation.",
        enonce: "Énoncé reformulé.",
        niveau: "eleve",
      }),
    );
    expect(v2).toEqual({ version: 2, assertion_version: 2 });
    const a = attendu(200, await s.consultantEquipe.get(`/api/assertions/${p.assertion_id}`));
    expect(a.enonce).toBe("Énoncé reformulé.");
    expect(a.version).toBe(2);
    const perimee = await s.consultantEquipe.post(url, {
      version_courante: 1,
      motif: "Encore.",
      niveau: "faible",
    });
    expect(perimee.statusCode).toBe(409);
    expect(perimee.json().erreur.code).toBe("VERSION_PERIMEE");
    attendu(
      201,
      await s.consultantEquipe.post(url, { version_courante: 2, motif: "Retrait.", retire: true }),
    );
    const abandonnee = attendu(
      200,
      await s.consultantEquipe.get(`/api/assertions/${p.assertion_id}`),
    );
    expect(abandonnee.statut).toBe("abandonnee");
    const apres = attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/analyses`));
    expect(apres.couverture.points).toBe(0);
    attendu(
      201,
      await s.consultantEquipe.post(url, { version_courante: 3, motif: "Rétabli.", retire: false }),
    );
    expect(
      attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/analyses`)).couverture
        .points,
    ).toBe(1);
  });

  it("changer de catégorie met à jour le rattachement ; 400 si elle est étrangère à l'analyse", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const p = await creerPointDd(s.consultantEquipe, d);
    const url = `/api/dd/points/${p.id}/versions`;
    expect(
      (
        await s.consultantEquipe.post(url, {
          version_courante: 1,
          motif: "x.",
          categorie: "forces",
        })
      ).statusCode,
    ).toBe(400);
    attendu(
      201,
      await s.consultantEquipe.post(url, {
        version_courante: 1,
        motif: "Reclassé.",
        categorie: "juridique",
      }),
    );
    const a = attendu(200, await s.consultantEquipe.get(`/api/assertions/${p.assertion_id}`));
    expect(a.rattachement.code).toBe("dd.pestel.juridique");
  });

  it("400 sans champ à modifier ; 403 expert métier ; 404 autre cabinet ou identifiant inconnu", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const p = await creerPointDd(s.consultantEquipe, d);
    const url = `/api/dd/points/${p.id}/versions`;
    expect(
      (await s.consultantEquipe.post(url, { version_courante: 1, motif: "Rien." })).statusCode,
    ).toBe(400);
    const corps = { version_courante: 1, motif: "Correction.", niveau: "faible" };
    expect((await s.expertMetier.post(url, corps)).statusCode).toBe(403);
    expect((await s.b.associe.post(url, corps)).statusCode).toBe(404);
    expect(
      (await s.consultantEquipe.post(`/api/dd/points/${INCONNU}/versions`, corps)).statusCode,
    ).toBe(404);
    // Un identifiant d'un autre type d'élément est introuvable comme point.
    const etape = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${d}/chaine/etapes`, {
        libelle: "Étape",
        ordre: 1,
      }),
    );
    expect(
      (await s.consultantEquipe.post(`/api/dd/points/${etape.id}/versions`, corps)).statusCode,
    ).toBe(404);
  });

  it("abaisser la classe de risque est réservé à l'expert (409 CLASSE_RISQUE_ABAISSEE)", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const p = await creerPointDd(s.consultantEquipe, d, { classe_risque: "R3" });
    const r = await s.consultantEquipe.post(`/api/dd/points/${p.id}/versions`, {
      version_courante: 1,
      motif: "Abaissement.",
      classe_risque: "R2",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("CLASSE_RISQUE_ABAISSEE");
  });
});

describe("registre et rapports existants", () => {
  it("l'assertion d'un point n'est citée ni par le contrôle PRV-03 d'un autre livrable ni par ceux de notation et de plan", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const p = await creerPointDd(s.consultantEquipe, d);
    const a = attendu(200, await s.consultantEquipe.get(`/api/assertions/${p.assertion_id}`));
    const normalise = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    expect(normalise(a.livrable)).not.toContain("notation");
    expect(normalise(a.livrable)).not.toContain("plan");
    const controle = attendu(
      200,
      await s.consultantEquipe.get(
        `/api/missions/${s.missionId}/preuves/controle?livrable=${encodeURIComponent("Rapport de notation")}`,
      ),
    );
    expect(controle.anomalies.map((x: any) => x.assertion_id)).not.toContain(p.assertion_id);
  });
});
