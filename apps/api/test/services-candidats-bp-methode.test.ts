import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import type { Api } from "./api.js";

/*
 * Service candidat « Business plan bancable et recherche de financement » (migration 0561) :
 * méthode du standard, version 1 publiée, assemblée par briques (PRD complémentaire §4 et §11.6).
 * Contenu provisoire, à valider par un expert métier.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let versionId: string;
let methodeId: string;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

const COMPTES_FRAGILES_AGRICOLE = {
  effectif: 35,
  fiabilite_comptes: "non_certifies",
  part_informel: "forte",
  actionnariat: "cooperative",
  filieres: ["anacarde"],
  agricole: true,
  saisonnalite: "campagne_agricole",
  financeur: "banque",
  commerce_exterieur: ["export", "change"],
};

interface BriqueM {
  code: string;
  active: boolean;
  classe_risque: string;
  classe_risque_base: string;
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Business plan A");
  b = await preparerCabinet(ctx, "Business plan B");
  const liste = attendu(200, await a.associe.get("/api/methodes?limite=100"));
  const m = liste.elements.find((x: { code: string }) => x.code === "business_plan_bancable");
  expect(m).toBeDefined();
  methodeId = m.id;
  versionId = m.derniere_publiee.id;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("méthode du standard « business_plan_bancable »", () => {
  it("existe, version 1 publiée, provisoire, rattachée au service candidat", async () => {
    const detail = attendu(200, await a.associe.get(`/api/methodes/versions/${versionId}`));
    expect(detail.version).toMatchObject({ version: 1, statut: "publiee" });
    expect(detail.version.notes_version).toMatch(
      /^PROVISOIRE — contenu à valider par un expert métier/,
    );
    const m = attendu(200, await a.associe.get(`/api/methodes/${methodeId}`));
    expect(m).toMatchObject({ code: "business_plan_bancable", origine: "standard" });
    expect(m.service_code).toBe("business_plan_bancable");
    expect(detail.etapes).toHaveLength(6);
    expect(detail.regles.length).toBeGreaterThanOrEqual(5);
    expect(detail.cas_types.length).toBeGreaterThanOrEqual(3);
    const codes = detail.briques.map((x: { code: string }) => x.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "calcul_modele",
        "bancabilite_pla17",
        "plan_financement",
        "dossier_bancaire",
        "veille_guichets",
      ]),
    );
    const moteurs = Object.fromEntries(
      detail.briques.map((x: { code: string; moteur: string | null }) => [x.code, x.moteur]),
    );
    expect(moteurs).toMatchObject({
      calcul_modele: "plan.modele_financier",
      scenarios: "plan.scenarios",
      bancabilite_pla17: null,
      plan_financement: null,
      veille_guichets: null,
    });
  });

  it("validation sans erreur et tous les cas types passent", async () => {
    const v = attendu(200, await a.associe.get(`/api/methodes/versions/${versionId}/validation`));
    const erreurs = v.anomalies.filter((x: { gravite: string }) => x.gravite === "erreur");
    expect(erreurs).toEqual([]);
    expect(v.valide).toBe(true);
    const exec = attendu(
      200,
      await a.associe.post(`/api/methodes/versions/${versionId}/cas-types/execution`),
    );
    expect(exec.echoues).toBe(0);
    expect(exec.reussi).toBe(true);
    expect(exec.cas.length).toBeGreaterThanOrEqual(3);
    expect(exec.cas.every((c: { reussi: boolean }) => c.reussi)).toBe(true);
  });
});

describe("mission liée à la méthode", () => {
  it("méthode effective modulée selon le contexte et aperçu cohérent", async () => {
    const missionId = (await creerMission(a)).id;
    const lie = attendu(
      200,
      await a.chef.put(`/api/missions/${missionId}/methode`, {
        version_id: versionId,
        contexte: COMPTES_FRAGILES_AGRICOLE,
        motif: "Coopérative d'anacarde : comptes non certifiés, banque impliquée.",
      }),
    );
    expect(lie.liaison).toMatchObject({ methode_version_id: versionId, rang: 1 });
    const effective = attendu(200, await a.chef.get(`/api/missions/${missionId}/methode`));
    expect(effective.version).toMatchObject({
      methode_code: "business_plan_bancable",
      origine: "standard",
    });
    const briques: BriqueM[] = effective.etapes.flatMap((e: { briques: BriqueM[] }) => e.briques);
    const parCode = Object.fromEntries(briques.map((x) => [x.code, x]));
    expect(parCode.reconstitution_ca?.active).toBe(true);
    expect(parCode.bfr_saisonnier?.active).toBe(true);
    expect(parCode.analyse_historique).toMatchObject({
      classe_risque_base: "R2",
      classe_risque: "R3",
    });
    expect(effective.modulation.regles_declenchees).toEqual(
      expect.arrayContaining([
        "comptes_fragiles",
        "filiere_agricole",
        "financeur_institutionnel",
        "exposition_change",
      ]),
    );
    expect(effective.recommandations_candidates).toEqual(["risque_change"]);

    const apercu = attendu(
      200,
      await a.chef.post(`/api/methodes/versions/${versionId}/apercu`, {
        contexte: COMPTES_FRAGILES_AGRICOLE,
      }),
    );
    const apercuBriques: BriqueM[] = apercu.methode.etapes.flatMap(
      (e: { briques: BriqueM[] }) => e.briques,
    );
    const actives = (l: BriqueM[]) =>
      l
        .filter((x) => x.active)
        .map((x) => x.code)
        .sort();
    expect(actives(apercuBriques)).toEqual(actives(briques));
    expect(apercu.synthese.briques_actives).toBe(actives(apercuBriques).length);
    expect(apercu.synthese.classe_max).toBe("R3");
    expect(apercu.synthese.temps_type_total_jours).toBeGreaterThan(0);

    const neutre = attendu(
      200,
      await a.chef.post(`/api/methodes/versions/${versionId}/apercu`, {
        contexte: { effectif: 40, fiabilite_comptes: "certifies", financeur: "aucun" },
      }),
    );
    const neutreBriques: BriqueM[] = neutre.methode.etapes.flatMap(
      (e: { briques: BriqueM[] }) => e.briques,
    );
    const actifsNeutres = actives(neutreBriques);
    expect(actifsNeutres).not.toContain("reconstitution_ca");
    expect(actifsNeutres).not.toContain("bfr_saisonnier");
    expect(actifsNeutres).toEqual(
      expect.arrayContaining(["calcul_modele", "bancabilite_pla17", "dossier_bancaire"]),
    );
    expect(neutre.regles_declenchees).toEqual([]);
  });
});

describe("isolation entre cabinets", () => {
  it("un autre cabinet lit la méthode du standard mais ne peut pas la modifier", async () => {
    const detail = attendu(200, await b.associe.get(`/api/methodes/versions/${versionId}`));
    expect(detail.version.statut).toBe("publiee");
    const refus = await b.associe.post(`/api/methodes/versions/${versionId}/etapes`, {
      code: "intrus",
      libelle: "Intrus",
    });
    expect(attendu(403, refus).erreur.code).toBe("STANDARD_LECTURE_SEULE");
    expect(
      (await b.associe.post(`/api/methodes/versions/${versionId}/publication`)).statusCode,
    ).toBe(403);
    const apres = attendu(200, await b.associe.get(`/api/methodes/versions/${versionId}`));
    expect(apres.etapes).toHaveLength(6);
  });
});
