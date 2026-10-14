/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { attendu, creerDossierDd, INCONNU, preparerDd, type ScenarioDd } from "./dd-outils.js";

/*
 * Plan des 100 jours (DD-15, R43 à R45) : dates et retards du cas du §5.8 (date de l'opération
 * placée 45 jours avant aujourd'hui), liens vers une initiative et un KPI du MÊME client
 * (MPZ30 : initiative ou KPI d'un autre client, responsable hors équipe refusés), libellé MASQUÉ
 * sans visibilité de la mission cible.
 */

let ctx: Contexte;
let s: ScenarioDd;
let dossier: string;
let dateOperation: string;

const jourPlus = (base: string, n: number) =>
  new Date(Date.parse(`${base}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD plan");
  dateOperation = jourPlus(new Date().toISOString().slice(0, 10), -45);
  dossier = (
    await creerDossierDd(s.consultantEquipe, s.missionId, { date_operation: dateOperation })
  ).id;
}, 240_000);
afterAll(() => ctx.fermer());

const url = () => `/api/dd/dossiers/${dossier}/plan-100j`;
const action = (corps: Record<string, unknown>, par = s.consultantEquipe) =>
  par.post(`${url()}/actions`, { libelle: "Action", jour_debut: 0, jour_fin: 10, ...corps });

describe("synthèse et dates (cas du §5.8)", () => {
  it("dates, phases, retards, taux et listes « sans » viennent du moteur", async () => {
    const A = attendu(
      201,
      await action(
        {
          libelle: "A",
          jour_debut: 0,
          jour_fin: 10,
          statut_action: "terminee",
          responsable_id: s.consultant2.utilisateurId,
          kpi_id: s.kpiMemeClient,
        },
        s.a.chef,
      ),
    ).id;
    const B = attendu(
      201,
      await action(
        {
          libelle: "B",
          jour_debut: 5,
          jour_fin: 30,
          statut_action: "en_cours",
          responsable_id: s.consultant2.utilisateurId,
          plan_element_id: s.initiativeMemeClient,
        },
        s.a.chef,
      ),
    ).id;
    const C = attendu(
      201,
      await action({
        libelle: "C",
        jour_debut: 31,
        jour_fin: 45,
        responsable_id: s.consultant2.utilisateurId,
      }),
    ).id;
    const D = attendu(201, await action({ libelle: "D", jour_debut: 50, jour_fin: 60 })).id;
    const E = attendu(
      201,
      await action({
        libelle: "E",
        jour_debut: 61,
        jour_fin: 100,
        responsable_id: s.consultant2.utilisateurId,
      }),
    ).id;
    const p = attendu(200, await s.expertMetier.get(url()));
    expect(p.date_operation).toBe(dateOperation);
    const par = (id: string) => p.actions.find((a: any) => a.id === id);
    expect([par(A), par(B), par(C), par(D), par(E)].map((a) => [a.date_debut, a.date_fin])).toEqual(
      [
        [dateOperation, jourPlus(dateOperation, 10)],
        [jourPlus(dateOperation, 5), jourPlus(dateOperation, 30)],
        [jourPlus(dateOperation, 31), jourPlus(dateOperation, 45)],
        [jourPlus(dateOperation, 50), jourPlus(dateOperation, 60)],
        [jourPlus(dateOperation, 61), jourPlus(dateOperation, 100)],
      ],
    );
    expect(p.actions.map((a: any) => a.phase)).toEqual([
      "jours_0_30",
      "jours_0_30",
      "jours_31_60",
      "jours_31_60",
      "jours_61_100",
    ]);
    expect(p.synthese).toMatchObject({
      total: 5,
      terminees: 1,
      taux_realisation_bp: 2000,
      jour_courant: 45,
      en_retard: [B],
    });
    expect(p.synthese.par_phase).toEqual({
      jours_0_30: { total: 2, terminees: 1 },
      jours_31_60: { total: 2, terminees: 0 },
      jours_61_100: { total: 1, terminees: 0 },
    });
    expect(p.synthese.sans_responsable).toEqual([D]);
    expect(p.synthese.sans_indicateur.sort()).toEqual([B, C, D, E].sort());
    expect(p.synthese.sans_plan.sort()).toEqual([A, C, D, E].sort());
    expect(par(B).en_retard).toBe(true);
    expect(par(C).en_retard).toBe(false);
    expect(par(A).responsable).toMatchObject({ id: s.consultant2.utilisateurId });
  });

  it("sans date d'opération : aucune date, aucun retard", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId, { date_operation: null })).id;
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${d}/plan-100j/actions`, {
        libelle: "Sans date",
        jour_debut: 0,
        jour_fin: 10,
      }),
    );
    const p = attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/plan-100j`));
    expect(p.actions[0]).toMatchObject({ date_debut: null, date_fin: null, en_retard: false });
    expect(p.synthese.jour_courant).toBeNull();
    expect(
      attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/synthese`)).plan_100j.total,
    ).toBe(1);
  });
});

describe("liens (MPZ30) et masquage", () => {
  it("initiative et KPI d'un autre client, élément qui n'est pas une initiative, responsable hors équipe : 400 LIEN_INCOHERENT", async () => {
    for (const extra of [
      { plan_element_id: s.initiativeAutreClient },
      { plan_element_id: s.axeMemeClient },
      { plan_element_id: INCONNU },
      { kpi_id: s.kpiAutreClient },
      { kpi_id: INCONNU },
      { responsable_id: s.consultantHors.utilisateurId },
    ]) {
      const r = await action(extra, s.a.chef);
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
      expect(r.json().erreur.code).toBe("LIEN_INCOHERENT");
    }
  });

  it("une cible invisible de l'auteur est refusée ; le libellé est masqué pour qui ne la voit pas", async () => {
    const refus = await action({
      plan_element_id: s.initiativeMemeClient,
      kpi_id: s.kpiMemeClient,
    });
    expect(refus.json().erreur.code).toBe("LIEN_INCOHERENT");
    const id = attendu(
      201,
      await action(
        { libelle: "Reliée", plan_element_id: s.initiativeMemeClient, kpi_id: s.kpiMemeClient },
        s.a.chef,
      ),
    ).id;
    const vueChef = attendu(200, await s.a.chef.get(url())).actions.find((a: any) => a.id === id);
    expect(vueChef.plan_element).toMatchObject({
      id: s.initiativeMemeClient,
      libelle: "Intégration",
    });
    expect(vueChef.kpi).toMatchObject({
      id: s.kpiMemeClient,
      libelle: "Chiffre d'affaires mensuel",
    });
    const vueConsultant = attendu(200, await s.consultantEquipe.get(url())).actions.find(
      (a: any) => a.id === id,
    );
    expect(vueConsultant.plan_element).toEqual({ id: null, masque: true });
    expect(vueConsultant.kpi).toEqual({ id: null, masque: true });
    expect(JSON.stringify(vueConsultant)).not.toMatch(/Intégration|Chiffre d'affaires/);
  });
});

describe("versions (R45) et droits", () => {
  it("statut, jours, retrait ; version périmée ; contrôle des liens à la modification", async () => {
    const id = attendu(201, await action({ libelle: "À corriger" })).id;
    const v = `/api/dd/actions/${id}/versions`;
    attendu(
      201,
      await s.consultantEquipe.post(v, {
        version_courante: 1,
        motif: "Avancement.",
        statut_action: "en_cours",
        jour_fin: 20,
      }),
    );
    expect(
      (
        await s.consultantEquipe.post(v, {
          version_courante: 1,
          motif: "Encore.",
          statut_action: "terminee",
        })
      ).json().erreur.code,
    ).toBe("VERSION_PERIMEE");
    expect(
      (await s.consultantEquipe.post(v, { version_courante: 2, motif: "Jours.", jour_debut: 50 }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await s.consultantEquipe.post(v, {
          version_courante: 2,
          motif: "Lien.",
          kpi_id: s.kpiAutreClient,
        })
      ).json().erreur.code,
    ).toBe("LIEN_INCOHERENT");
    expect(
      (await s.consultantEquipe.post(v, { version_courante: 2, motif: "Rien." })).statusCode,
    ).toBe(400);
    attendu(
      201,
      await s.consultantEquipe.post(v, { version_courante: 2, motif: "Retrait.", retire: true }),
    );
    expect(
      attendu(200, await s.consultantEquipe.get(url())).actions.some((a: any) => a.id === id),
    ).toBe(false);
  });

  it("401, 403, 404 et 409 plafond (200 actions)", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect(
      (await s.expertMetier.post(`${url()}/actions`, { libelle: "x", jour_debut: 0, jour_fin: 1 }))
        .statusCode,
    ).toBe(403);
    expect((await s.gestionnaire.get(url())).statusCode).toBe(403);
    expect((await s.b.associe.get(url())).statusCode).toBe(404);
    expect((await s.consultantHors.get(url())).statusCode).toBe(404);
    expect(
      (
        await s.consultantEquipe.post(`/api/dd/actions/${INCONNU}/versions`, {
          version_courante: 1,
          motif: "x.",
          libelle: "y",
        })
      ).statusCode,
    ).toBe(404);
    const corps = { libelle: "x", jour_debut: 0, jour_fin: 1 };
    expect((await action({ jour_debut: 20, jour_fin: 10 })).statusCode).toBe(400);
    expect((await action({ jour_fin: 101 })).statusCode).toBe(400);
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    for (let i = 0; i < 200; i += 1) {
      const r = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/plan-100j/actions`, corps);
      if (r.statusCode !== 201) throw new Error(`${i} ${r.body}`);
    }
    const r = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/plan-100j/actions`, corps);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });
});
