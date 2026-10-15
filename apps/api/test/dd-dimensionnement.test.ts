/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  attendu,
  creerDossierDd,
  INCONNU,
  PARAMETRES_A1,
  PARAMETRES_D1,
  preparerDd,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerPreuve } from "./preuves-outils.js";

/*
 * Dimensionnement de marché (DD-12, R30 à R34) : l'API rend EXACTEMENT les nombres du moteur
 * (cas D1, D2, A1, X1 de la spécification §5.2), MPZ31 (preuve d'une autre mission, avis sans
 * motif), recoupement, calcul à blanc sans écriture, DEPASSEMENT en 400, aucune clé FIN-02.
 */

let ctx: Contexte;
let s: ScenarioDd;
let dossier: string;
let preuve: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD marché");
  dossier = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
  preuve = (await creerPreuve(s.consultantEquipe, s.missionId)).id;
}, 240_000);
afterAll(() => ctx.fermer());

const creer = (par = s.consultantEquipe, corps: Record<string, unknown> = {}) =>
  par.post(`/api/dd/dossiers/${dossier}/dimensionnements`, {
    methode: "descendant",
    libelle: "Marché capturable",
    parametres: PARAMETRES_D1(preuve),
    ...corps,
  });

describe("calcul et enregistrement (R31, R34)", () => {
  it("D1 : l'API rend les nombres exacts du moteur, étage par étage", async () => {
    const r = attendu(201, await creer());
    expect(r.version).toBe(1);
    expect(r.resultat.etages).toEqual([
      {
        code: "marche_total",
        valeurs: { bas: 80_000_000_000, base: 100_000_000_000, haut: 120_000_000_000 },
      },
      {
        code: "marche_adressable",
        valeurs: { bas: 9_600_000_000, base: 20_000_000_000, haut: 36_000_000_000 },
      },
      {
        code: "marche_capturable",
        valeurs: { bas: 768_000_000, base: 2_000_000_000, haut: 4_320_000_000 },
      },
    ]);
    expect(r.resultat.resultat).toEqual({
      bas: 768_000_000,
      base: 2_000_000_000,
      haut: 4_320_000_000,
    });
    expect(r.resultat.ajuste).toBe(false);
    expect(r.resultat.sensibilite[0]).toMatchObject({
      code: "part_segment",
      resultat_bas: 1_500_000_000,
      resultat_haut: 2_500_000_000,
      amplitude: 1_000_000_000,
      part_amplitude_bp: 10_000,
    });
    expect(r.resultat.couverture).toMatchObject({
      total: 4,
      preuve: 1,
      avis_expert: 3,
      absente: [],
    });
  });

  it("D2 : deux ajustements (facteur exact 0,855), un ajustement tracé par ligne", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const r = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${d}/dimensionnements`, {
        methode: "descendant",
        libelle: "Avec ajustements",
        parametres: PARAMETRES_D1(preuve),
        ajustements: [
          { libelle: "Informel", facteur_bp: 9000, motif: "Part d'activité informelle estimée." },
          { libelle: "Change", facteur_bp: 9500, motif: "Effet de change défavorable attendu." },
        ],
      }),
    );
    expect(r.resultat.avant_ajustement).toEqual({
      bas: 768_000_000,
      base: 2_000_000_000,
      haut: 4_320_000_000,
    });
    expect(r.resultat.resultat).toEqual({
      bas: 656_640_000,
      base: 1_710_000_000,
      haut: 3_693_600_000,
    });
    expect(r.resultat.ajuste).toBe(true);
    expect(r.resultat.ajustements_appliques.map((a: any) => a.base)).toEqual([
      1_800_000_000, 1_710_000_000,
    ]);
    const aj = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${d}/ajustements`),
    ).elements.filter((a: any) => a.cible_type === "dimensionnement");
    expect(aj).toHaveLength(2);
    expect(aj.every((a: any) => a.champ === "resultat" && a.cible_id === r.id)).toBe(true);
    expect(aj.map((a: any) => a.motif).sort()).toEqual([
      "Effet de change défavorable attendu.",
      "Part d'activité informelle estimée.",
    ]);
  });

  it("A1 : ascendant, et recoupement avec le descendant (cas X1 : 4 000 pb, alerte, chevauchement)", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const url = `/api/dd/dossiers/${d}/dimensionnements`;
    const desc = attendu(
      201,
      await s.consultantEquipe.post(url, {
        methode: "descendant",
        libelle: "Descendant",
        parametres: PARAMETRES_D1(preuve),
      }),
    );
    expect(attendu(200, await s.expertMetier.get(url)).recoupement).toBeNull();
    const asc = attendu(
      201,
      await s.consultantEquipe.post(url, {
        methode: "ascendant",
        libelle: "Ascendant",
        parametres: PARAMETRES_A1(preuve),
      }),
    );
    expect(asc.resultat.resultat).toEqual({
      bas: 450_000_000,
      base: 1_200_000_000,
      haut: 2_625_000_000,
    });
    expect(asc.resultat.sensibilite.map((x: any) => x.code)).toEqual([
      "clients_cibles",
      "taux_conquete",
      "prix_unitaire",
      "volume_par_client",
    ]);
    const l = attendu(200, await s.expertMetier.get(url));
    expect(l.elements.map((e: any) => e.methode)).toEqual(["descendant", "ascendant"]);
    expect(l.elements[0].id).toBe(desc.id);
    expect(l.recoupement).toEqual({
      ecart_bp: 4000,
      plus_eleve: "descendant",
      alerte: true,
      chevauchement: true,
    });
    const synthese = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/synthese`));
    expect(synthese.marche.recoupement.alerte).toBe(true);
    expect(synthese.marche.dimensionnements).toHaveLength(2);
  });

  it("calculer (R34) : même résultat, aucune écriture ; sources facultatives signalées", async () => {
    const avant = await proprietaire((c) =>
      c.query(
        "SELECT (SELECT count(*) FROM dd_dimensionnements)::int AS n, (SELECT count(*) FROM dd_dimensionnement_versions)::int AS v, (SELECT count(*) FROM dd_ajustements)::int AS a",
      ),
    );
    const parametres = PARAMETRES_D1(preuve).map((p, i) =>
      i === 3 ? { ...p, source: undefined } : p,
    );
    const r = attendu(
      200,
      await s.expertMetier.post("/api/dd/dimensionnements/calculer", {
        methode: "descendant",
        parametres,
      }),
    );
    expect(r.resultat).toEqual({ bas: 768_000_000, base: 2_000_000_000, haut: 4_320_000_000 });
    expect(r.couverture.absente).toEqual(["part_capturable"]);
    const apres = await proprietaire((c) =>
      c.query(
        "SELECT (SELECT count(*) FROM dd_dimensionnements)::int AS n, (SELECT count(*) FROM dd_dimensionnement_versions)::int AS v, (SELECT count(*) FROM dd_ajustements)::int AS a",
      ),
    );
    expect(apres.rows[0]).toEqual(avant.rows[0]);
    expect((await api(ctx).post("/api/dd/dimensionnements/calculer", {})).statusCode).toBe(401);
    expect(
      (
        await s.gestionnaire.post("/api/dd/dimensionnements/calculer", {
          methode: "descendant",
          parametres,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("400 : bornes incohérentes, paramètre manquant, pourcentage > 10 000, DEPASSEMENT", async () => {
    const p = PARAMETRES_D1(preuve);
    const calc = (parametres: unknown[], ajustements: unknown[] = []) =>
      s.consultantEquipe.post("/api/dd/dimensionnements/calculer", {
        methode: "descendant",
        parametres,
        ajustements,
      });
    expect((await calc(p.map((x, i) => (i === 0 ? { ...x, bas: x.haut } : x)))).statusCode).toBe(
      400,
    );
    expect((await calc(p.slice(1))).statusCode).toBe(400);
    expect((await calc(p.map((x, i) => (i === 1 ? { ...x, haut: 10_001 } : x)))).statusCode).toBe(
      400,
    );
    expect(
      (
        await calc(
          p,
          Array.from({ length: 11 }, () => ({
            libelle: "x",
            facteur_bp: 9000,
            motif: "Un motif suffisant.",
          })),
        )
      ).statusCode,
    ).toBe(400);
    const grand = PARAMETRES_D1(preuve).map((x) => ({
      ...x,
      bas: x.code === "marche_total" ? 9_007_199_254_740_991 : 10_000,
      base: x.code === "marche_total" ? 9_007_199_254_740_991 : 10_000,
      haut: x.code === "marche_total" ? 9_007_199_254_740_991 : 10_000,
    }));
    const r = await calc(grand, [
      { libelle: "Majoration", facteur_bp: 20_000, motif: "Hypothèse extrême de test." },
    ]);
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("DEPASSEMENT");
  });
});

describe("MPZ31 : sources des paramètres", () => {
  it("preuve d'une autre mission → 400 PARAMETRE_SANS_SOURCE ; la source est obligatoire à l'enregistrement", async () => {
    const autre = (await creerPreuve(s.a.chef, s.mission2Id)).id;
    const r = await creer(s.consultantEquipe, { parametres: PARAMETRES_D1(autre) });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("PARAMETRE_SANS_SOURCE");
    const sansSource = PARAMETRES_D1(preuve).map((p, i) =>
      i === 0 ? { ...p, source: undefined } : p,
    );
    expect((await creer(s.consultantEquipe, { parametres: sansSource })).statusCode).toBe(400);
    const avisCourt = PARAMETRES_D1(preuve).map((p, i) =>
      i === 1 ? { ...p, source: { type: "avis_expert", motif: "court" } } : p,
    );
    expect((await creer(s.consultantEquipe, { parametres: avisCourt })).statusCode).toBe(400);
    const inconnue = PARAMETRES_D1(preuve).map((p, i) =>
      i === 0 ? { ...p, source: { type: "preuve", preuve_id: INCONNU } } : p,
    );
    expect((await creer(s.consultantEquipe, { parametres: inconnue })).json().erreur.code).toBe(
      "PARAMETRE_SANS_SOURCE",
    );
  });
});

describe("versions et droits (R32, R33)", () => {
  it("nouvelle version : résultat recalculé, version lue exigée, méthode figée", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const c = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${d}/dimensionnements`, {
        methode: "descendant",
        libelle: "V1",
        parametres: PARAMETRES_D1(preuve),
      }),
    );
    const url = `/api/dd/dimensionnements/${c.id}/versions`;
    const parametres = PARAMETRES_D1(preuve).map((p) =>
      p.code === "part_capturable" ? { ...p, bas: 1000, base: 1200, haut: 1400 } : p,
    );
    const v2 = attendu(
      201,
      await s.consultantEquipe.post(url, {
        libelle: "V2",
        parametres,
        version_courante: 1,
        motif: "Part capturable revue.",
      }),
    );
    expect(v2.version).toBe(2);
    expect(v2.resultat.resultat.base).toBe(2_400_000_000);
    expect(
      (
        await s.consultantEquipe.post(url, {
          libelle: "V2",
          parametres,
          version_courante: 1,
          motif: "Encore.",
        })
      ).json().erreur.code,
    ).toBe("VERSION_PERIMEE");
    const mauvaiseMethode = PARAMETRES_A1(preuve);
    expect(
      (
        await s.consultantEquipe.post(url, {
          libelle: "x",
          parametres: mauvaiseMethode,
          version_courante: 2,
          motif: "Autre méthode.",
        })
      ).json().erreur.code,
    ).toBe("DIMENSIONNEMENT_INVALIDE");
    const versions = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dimensionnements/${c.id}/versions`),
    ).elements;
    expect(versions.map((x: any) => x.version)).toEqual([2, 1]);
    expect(versions[1].resultat.resultat.base).toBe(2_000_000_000);
  });

  it("401, 403 (expert métier, gestionnaire), 404 (autre cabinet, mission invisible, identifiant inconnu)", async () => {
    const url = `/api/dd/dossiers/${dossier}/dimensionnements`;
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect(
      (
        await s.expertMetier.post(url, {
          methode: "descendant",
          libelle: "x",
          parametres: PARAMETRES_D1(preuve),
        })
      ).statusCode,
    ).toBe(403);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.consultantHors.get(url)).statusCode).toBe(404);
    expect(
      (
        await s.b.associe.post(url, {
          methode: "descendant",
          libelle: "x",
          parametres: PARAMETRES_D1(preuve),
        })
      ).statusCode,
    ).toBe(404);
    const id = attendu(200, await s.consultantEquipe.get(url)).elements[0].id;
    for (const chemin of [`/api/dd/dimensionnements/${id}/versions`]) {
      expect((await s.b.associe.get(chemin)).statusCode).toBe(404);
      expect((await s.consultantHors.get(chemin)).statusCode).toBe(404);
    }
    expect(
      (await s.consultantEquipe.get(`/api/dd/dimensionnements/${INCONNU}/versions`)).statusCode,
    ).toBe(404);
  });

  it("409 PLAFOND_ATTEINT au vingt et unième dimensionnement", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const corps = { methode: "descendant", libelle: "x", parametres: PARAMETRES_D1(preuve) };
    for (let i = 0; i < 20; i += 1)
      attendu(201, await s.consultantEquipe.post(`/api/dd/dossiers/${d}/dimensionnements`, corps));
    const r = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/dimensionnements`, corps);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });

  it("aucune clé de coût, de taux horaire, d'honoraire ou de marge de la mission dans les réponses (FIN-02)", async () => {
    const l = await s.expertMetier.get(`/api/dd/dossiers/${dossier}/dimensionnements`);
    const synth = await s.expertMetier.get(`/api/dd/dossiers/${dossier}/synthese`);
    const cles = (v: unknown, acc: string[] = []): string[] => {
      if (Array.isArray(v)) v.forEach((x) => cles(x, acc));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          acc.push(k);
          cles(x, acc);
        }
      return acc;
    };
    for (const r of [l, synth]) {
      expect(
        cles(r.json()).filter((k) =>
          /cout_jour|taux_horaire|honoraire|marge_mission|cout_ia|rentabilite|finance/i.test(k),
        ),
      ).toEqual([]);
    }
  });
});
