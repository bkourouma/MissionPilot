/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import {
  attendu,
  creerDossierDd,
  creerEtapeDd,
  creerRisqueDd,
  INCONNU,
  preparerDd,
  sourcer,
  type ScenarioDd,
} from "./dd-outils.js";

/*
 * Chaîne de valeur et risques (DD-04, DD-06, R10 à R15) : synthèse du moteur (cas du §5.3),
 * risque rattaché à une étape, signal d'origine et écart de niveau (motif obligatoire, ajustement
 * tracé), « à documenter », droits et plafonds.
 */

let ctx: Contexte;
let s: ScenarioDd;
let dossier: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD chaine");
  dossier = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
}, 240_000);
afterAll(() => ctx.fermer());

async function signal(code: string, gravite = "modere") {
  return attendu(
    201,
    await s.expertMetier.post("/api/dd/signaux", {
      code,
      libelle: `Signal ${code}`,
      famille: "change",
      gravite_indicative: gravite,
    }),
  ).id as string;
}

describe("chaîne de valeur (R10 à R12)", () => {
  it("synthèse du moteur : parts affichées, rangs de marge, cohérence", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const coutsEtMarges: [string, number, number, number][] = [
      ["a", 1, 3000, 500],
      ["b", 2, 2500, 2500],
      ["c", 3, 3000, 5000],
      ["dd", 4, 1500, 2000],
    ];
    const ids: Record<string, string> = {};
    for (const [lib, ordre, cout, marge] of coutsEtMarges) {
      ids[lib] = (
        await creerEtapeDd(s.consultantEquipe, d, {
          libelle: `Étape ${lib}`,
          ordre,
          part_cout_bp: cout,
          part_marge_bp: marge,
        })
      ).id;
    }
    const c = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/chaine`));
    expect(c.etapes.map((e: any) => e.libelle)).toEqual([
      "Étape a",
      "Étape b",
      "Étape c",
      "Étape dd",
    ]);
    expect(c.etapes.map((e: any) => e.rang_marge)).toEqual([4, 2, 1, 3]);
    expect(c.etapes[0]).toMatchObject({ part_cout_affichee: "30 %", part_marge_affichee: "5 %" });
    expect(c.synthese).toMatchObject({
      total_cout_bp: 10_000,
      coherence_cout: "coherente",
      etape_marge_max: ids["c"],
    });
    // Une part non renseignée rend la cohérence incomplète.
    await creerEtapeDd(s.consultantEquipe, d, { libelle: "Étape e", ordre: 5, part_cout_bp: null });
    const c2 = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/chaine`));
    expect(c2.synthese.coherence_cout).toBe("incomplete");
  });

  it("un risque se rattache à une étape et apparaît avec elle", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const e = await creerEtapeDd(s.consultantEquipe, d);
    const r = await creerRisqueDd(s.consultantEquipe, d, { etape_id: e.id });
    const c = attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/chaine`));
    expect(c.etapes[0].risques).toEqual([
      {
        id: r.id,
        libelle: "Risque de change",
        famille: "change",
        niveau: "eleve",
        lecture: "fragile",
      },
    ]);
  });

  it("versions : correction motivée, retrait, version périmée ; 400, 403 et 404", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const e = await creerEtapeDd(s.consultantEquipe, d);
    const url = `/api/dd/etapes/${e.id}/versions`;
    attendu(
      201,
      await s.consultantEquipe.post(url, {
        version_courante: 1,
        motif: "Ajustement.",
        ordre: 2,
        acteurs: ["Coopératives"],
      }),
    );
    const perimee = await s.consultantEquipe.post(url, {
      version_courante: 1,
      motif: "Encore.",
      ordre: 3,
    });
    expect(perimee.json().erreur.code).toBe("VERSION_PERIMEE");
    expect(
      (await s.consultantEquipe.post(url, { version_courante: 2, motif: "Rien." })).statusCode,
    ).toBe(400);
    expect(
      (
        await s.consultantEquipe.post(url, {
          version_courante: 2,
          motif: "Hors bornes.",
          part_cout_bp: 10_001,
        })
      ).statusCode,
    ).toBe(400);
    const corps = { version_courante: 2, motif: "Retrait.", retire: true };
    expect((await s.expertMetier.post(url, corps)).statusCode).toBe(403);
    expect((await s.b.associe.post(url, corps)).statusCode).toBe(404);
    attendu(201, await s.consultantEquipe.post(url, corps));
    expect(
      attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/chaine`)).etapes,
    ).toEqual([]);
  });

  it("409 PLAFOND_ATTEINT à la trente et unième étape ; 404 autre cabinet, 403 gestionnaire", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    for (let i = 1; i <= 30; i += 1)
      await creerEtapeDd(s.consultantEquipe, d, {
        libelle: `E${i}`,
        ordre: i,
        part_cout_bp: null,
        part_marge_bp: null,
      });
    const r = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/chaine/etapes`, {
      libelle: "E31",
      ordre: 31,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
    expect((await s.b.associe.get(`/api/dd/dossiers/${d}/chaine`)).statusCode).toBe(404);
    expect((await s.gestionnaire.get(`/api/dd/dossiers/${d}/chaine`)).statusCode).toBe(403);
    expect(
      (await s.expertMetier.post(`/api/dd/dossiers/${d}/chaine/etapes`, { libelle: "x", ordre: 1 }))
        .statusCode,
    ).toBe(403);
  });
});

describe("risques (R13 à R15)", () => {
  it("crée un risque : assertion rattachée `risque`, synthèse du moteur, « à documenter »", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const critique = await creerRisqueDd(s.consultantEquipe, d, {
      famille: "pays",
      niveau: "critique",
      libelle: "Instabilité",
    });
    const modere = await creerRisqueDd(s.consultantEquipe, d, {
      famille: "pays",
      niveau: "modere",
      libelle: "Délais",
    });
    await sourcer(s.consultantEquipe, s.missionId, modere.assertion_id, "solide");
    const etaye = await creerRisqueDd(s.consultantEquipe, d, {
      niveau: "eleve",
      libelle: "Change étayé",
    });
    await sourcer(s.consultantEquipe, s.missionId, etaye.assertion_id, "etayee");
    const a = attendu(
      200,
      await s.consultantEquipe.get(`/api/assertions/${critique.assertion_id}`),
    );
    expect(a.rattachement).toEqual({ type: "risque", code: critique.id });
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/risques`));
    expect(l.risques).toHaveLength(3);
    expect(l.synthese.total).toBe(3);
    expect(l.synthese.a_documenter).toEqual([critique.id]);
    const pays = l.synthese.familles.find((f: any) => f.famille === "pays");
    expect(pays).toMatchObject({ total: 2, niveau_max: "critique" });
    const f = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${d}/risques?famille=change`),
    );
    expect(f.risques.map((r: any) => r.id)).toEqual([etaye.id]);
    expect(f.synthese.total).toBe(3);
  });

  it("niveau différent de la gravité du signal : MOTIF_ECART_REQUIS puis ajustement tracé (R14)", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const sig = await signal("controle-changes", "modere");
    const sans = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/risques`, {
      famille: "change",
      niveau: "critique",
      libelle: "Contrôle des changes",
      signal_id: sig,
      enonce: "Les transferts sont soumis à autorisation.",
      classe_risque: "R2",
    });
    expect(sans.statusCode).toBe(400);
    expect(sans.json().erreur.code).toBe("MOTIF_ECART_REQUIS");
    const court = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/risques`, {
      famille: "change",
      niveau: "critique",
      libelle: "x",
      signal_id: sig,
      motif_ecart: "court",
      enonce: "Les transferts sont soumis à autorisation.",
      classe_risque: "R2",
    });
    expect(court.json().erreur.code).toBe("MOTIF_ECART_REQUIS");
    const ok = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${d}/risques`, {
        famille: "change",
        niveau: "critique",
        libelle: "Contrôle des changes",
        signal_id: sig,
        motif_ecart: "Les transferts sont déjà bloqués chez la cible.",
        enonce: "Les transferts sont soumis à autorisation.",
        classe_risque: "R2",
      }),
    );
    const aj = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/ajustements`)).elements;
    expect(aj).toHaveLength(1);
    expect(aj[0]).toMatchObject({
      cible_type: "risque",
      cible_id: ok.id,
      champ: "niveau",
      valeur_avant: "modere",
      valeur_apres: "critique",
    });
    // Même niveau que le signal : aucun ajustement, aucun motif exigé.
    await creerRisqueDd(s.consultantEquipe, d, { niveau: "modere", signal_id: sig });
    expect(
      attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/ajustements`)).elements,
    ).toHaveLength(1);
  });

  it("400 LIEN_INCOHERENT : étape d'un autre dossier, signal inconnu", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const autre = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const e = await creerEtapeDd(s.consultantEquipe, autre);
    for (const extra of [{ etape_id: e.id }, { etape_id: INCONNU }, { signal_id: INCONNU }]) {
      const r = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/risques`, {
        famille: "pays",
        niveau: "faible",
        libelle: "x",
        enonce: "Un énoncé.",
        classe_risque: "R2",
        ...extra,
      });
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
      expect(r.json().erreur.code).toBe("LIEN_INCOHERENT");
    }
  });

  it("versions d'un risque : niveau, énoncé, retrait ; écart exigé si le niveau change", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const sig = await signal("autre-signal", "faible");
    const r = await creerRisqueDd(s.consultantEquipe, d, { niveau: "faible", signal_id: sig });
    const url = `/api/dd/risques/${r.id}/versions`;
    const sans = await s.consultantEquipe.post(url, {
      version_courante: 1,
      motif: "Aggravation.",
      niveau: "eleve",
    });
    expect(sans.json().erreur.code).toBe("MOTIF_ECART_REQUIS");
    const v = attendu(
      201,
      await s.consultantEquipe.post(url, {
        version_courante: 1,
        motif: "Aggravation.",
        niveau: "eleve",
        motif_ecart: "Nouveaux éléments du dossier.",
        enonce: "Énoncé corrigé du risque.",
      }),
    );
    expect(v).toEqual({ version: 2, assertion_version: 2 });
    expect(
      attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/ajustements`)).elements,
    ).toHaveLength(1);
    const perimee = await s.consultantEquipe.post(url, {
      version_courante: 1,
      motif: "Encore.",
      libelle: "x",
    });
    expect(perimee.json().erreur.code).toBe("VERSION_PERIMEE");
    attendu(
      201,
      await s.consultantEquipe.post(url, { version_courante: 2, motif: "Retrait.", retire: true }),
    );
    expect(attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/risques`)).risques).toEqual(
      [],
    );
    expect(
      attendu(200, await s.consultantEquipe.get(`/api/assertions/${r.assertion_id}`)).statut,
    ).toBe("abandonnee");
  });

  it("droits : 403 expert métier et gestionnaire, 404 autre cabinet", async () => {
    const d = dossier;
    const corps = {
      famille: "pays",
      niveau: "faible",
      libelle: "x",
      enonce: "Un énoncé.",
      classe_risque: "R2",
    };
    expect((await s.expertMetier.post(`/api/dd/dossiers/${d}/risques`, corps)).statusCode).toBe(
      403,
    );
    expect((await s.b.associe.post(`/api/dd/dossiers/${d}/risques`, corps)).statusCode).toBe(404);
    expect((await s.gestionnaire.get(`/api/dd/dossiers/${d}/risques`)).statusCode).toBe(403);
    expect((await s.b.associe.get(`/api/dd/dossiers/${d}/risques`)).statusCode).toBe(404);
  });
});
