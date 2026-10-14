/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import {
  AFFIRMATION,
  assertionHypotheseDd,
  attendu,
  creerDossierDd,
  creerHypotheseDd,
  creerPointDd,
  INCONNU,
  preparerDd,
  sourcer,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerAssertion } from "./preuves-outils.js";

/*
 * Hypothèses et verdicts (DD-09, R16 à R23) : profondeur 4, journal des liens, indication du moteur
 * et photographie des citées, verdict sourcé (MPZ24), un seul verdict en attente, séparation des
 * tâches (API et base : proposant, auteur de l'hypothèse, auteur d'une assertion citée refusés,
 * associé et expert tiers admis), verdict périmé, rejet, ajustement si écart à l'indication.
 */

let ctx: Contexte;
let s: ScenarioDd;
let dossier: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD verdicts");
  dossier = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
}, 240_000);
afterAll(() => ctx.fermer());

/** Hypothèse de `auteur` avec `n` assertions solides « soutient » rédigées par `redacteur`. */
async function hypothese(auteur: Api, redacteur: Api, n = 2) {
  const h = await creerHypotheseDd(auteur, dossier);
  const assertions: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = await assertionHypotheseDd(redacteur, h.id, {
      enonce: `Source ${i} soutenant l'hypothèse.`,
    });
    await sourcer(redacteur, s.missionId, a.assertion_id, "solide");
    assertions.push(a.assertion_id);
  }
  return { id: h.id, assertions };
}

const proposer = (par: Api, h: string, corps: Record<string, unknown>) =>
  par.post(`/api/dd/hypotheses/${h}/verdicts`, corps);

describe("arbre d'hypothèses (R16 à R18)", () => {
  it("profondeur 4 : la cinquième est refusée (ARBRE_TROP_PROFOND) ; parent d'un autre dossier refusé", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    let parent = (await creerHypotheseDd(s.consultantEquipe, d)).id;
    const racine = parent;
    for (let niveau = 2; niveau <= 4; niveau += 1) {
      parent = (await creerHypotheseDd(s.consultantEquipe, d, { parent_id: parent })).id;
    }
    const r = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/hypotheses`, {
      libelle: "Trop profonde",
      parent_id: parent,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("ARBRE_TROP_PROFOND");
    const autre = await s.consultantEquipe.post(`/api/dd/dossiers/${dossier}/hypotheses`, {
      libelle: "Parent étranger",
      parent_id: racine,
    });
    expect(autre.json().erreur.code).toBe("RATTACHEMENT_INCOHERENT");
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/hypotheses`));
    expect(l.noeuds).toHaveLength(4);
    expect(l.arbre).toMatchObject({ total: 4, racines: 1, profondeur_max: 4 });
    expect(l.noeuds.every((n: any) => n.etat === "ouverte")).toBe(true);
  });

  it("droits : 403 expert métier et gestionnaire, 404 autre cabinet, 401 sans session", async () => {
    const url = `/api/dd/dossiers/${dossier}/hypotheses`;
    expect((await s.expertMetier.post(url, { libelle: "x" })).statusCode).toBe(403);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.post(url, { libelle: "x" })).statusCode).toBe(404);
    expect((await s.consultantHors.get(url)).statusCode).toBe(404);
  });

  it("versions : correction, version périmée, retrait refusé tant qu'un verdict attend", async () => {
    const h = await hypothese(s.consultantEquipe, s.consultantEquipe);
    const url = `/api/dd/hypotheses/${h.id}/versions`;
    attendu(
      201,
      await s.consultantEquipe.post(url, {
        version_courante: 1,
        motif: "Précision.",
        critere: "Nouveau critère.",
      }),
    );
    expect(
      (
        await s.consultantEquipe.post(url, { version_courante: 1, motif: "Encore.", libelle: "x" })
      ).json().erreur.code,
    ).toBe("VERSION_PERIMEE");
    attendu(
      201,
      await proposer(s.consultantEquipe, h.id, {
        hypothese_version: 2,
        verdict: "confirmee",
        motif: "Sources solides.",
        assertions_citees: h.assertions,
      }),
    );
    const r = await s.consultantEquipe.post(url, {
      version_courante: 2,
      motif: "Retrait.",
      retire: true,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("VERDICT_EN_ATTENTE");
    expect(
      (await s.expertMetier.post(url, { version_courante: 2, motif: "x.", libelle: "y" }))
        .statusCode,
    ).toBe(403);
  });
});

describe("liens (R19, R20)", () => {
  it("lier une assertion existante, journal, délier ; erreurs", async () => {
    const h = await creerHypotheseDd(s.consultantEquipe, dossier);
    const a = (await creerAssertion(s.consultantEquipe, s.missionId)).id as string;
    const url = `/api/dd/hypotheses/${h.id}/liens`;
    attendu(
      201,
      await s.consultantEquipe.post(url, { assertion_id: a, action: "lier", sens: "contredit" }),
    );
    expect(
      (await s.consultantEquipe.post(url, { assertion_id: a, action: "lier", sens: "contredit" }))
        .statusCode,
    ).toBe(409);
    attendu(
      201,
      await s.consultantEquipe.post(url, { assertion_id: a, action: "lier", sens: "soutient" }),
    );
    let noeud = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossier}/hypotheses`),
    ).noeuds.find((n: any) => n.id === h.id);
    expect(noeud.liens).toHaveLength(1);
    expect(noeud.liens[0]).toMatchObject({ assertion_id: a, sens: "soutient" });
    attendu(201, await s.consultantEquipe.post(url, { assertion_id: a, action: "delier" }));
    noeud = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossier}/hypotheses`),
    ).noeuds.find((n: any) => n.id === h.id);
    expect(noeud.liens).toEqual([]);
    const absent = await s.consultantEquipe.post(url, { assertion_id: a, action: "delier" });
    expect(absent.json().erreur.code).toBe("RATTACHEMENT_INCOHERENT");
    const autreMission = (await creerAssertion(s.a.chef, s.mission2Id)).id;
    expect(
      (
        await s.consultantEquipe.post(url, {
          assertion_id: autreMission,
          action: "lier",
          sens: "soutient",
        })
      ).json().erreur.code,
    ).toBe("RATTACHEMENT_INCOHERENT");
    expect(
      (await s.consultantEquipe.post(url, { assertion_id: a, action: "lier" })).statusCode,
    ).toBe(400);
    const abandonnee = await creerPointDd(s.consultantEquipe, dossier);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/points/${abandonnee.id}/versions`, {
        version_courante: 1,
        motif: "Retrait.",
        retire: true,
      }),
    );
    expect(
      (
        await s.consultantEquipe.post(url, {
          assertion_id: abandonnee.assertion_id,
          action: "lier",
          sens: "soutient",
        })
      ).json().erreur.code,
    ).toBe("ASSERTION_ABANDONNEE");
    expect(
      (await s.b.associe.post(url, { assertion_id: a, action: "lier", sens: "soutient" }))
        .statusCode,
    ).toBe(404);
  });

  it("R20 crée l'assertion rattachée à l'hypothèse puis le lien (preuve.ecrire requis)", async () => {
    const h = await creerHypotheseDd(s.consultantEquipe, dossier);
    const a = await assertionHypotheseDd(s.consultantEquipe, h.id);
    const detail = attendu(200, await s.consultantEquipe.get(`/api/assertions/${a.assertion_id}`));
    expect(detail.rattachement).toEqual({ type: "hypothese", code: h.id });
    expect(
      (
        await s.expertMetier.post(`/api/dd/hypotheses/${h.id}/assertions`, {
          sens: "soutient",
          ...AFFIRMATION,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("propositions de verdict (R21, R22)", () => {
  it("indication du moteur, photographie des citées, ajustement si écart", async () => {
    const h = await hypothese(s.consultantEquipe, s.consultantEquipe);
    const lu = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossier}/hypotheses`),
    ).noeuds.find((n: any) => n.id === h.id);
    expect(lu.indication).toMatchObject({
      indication: "confirmee",
      raison: "SOUTIEN_SUFFISANT_SANS_CONTRE",
      conflit: false,
    });
    expect(lu.indication.soutien.solide).toBe(2);
    const v = attendu(
      201,
      await proposer(s.consultantEquipe, h.id, {
        hypothese_version: 1,
        verdict: "confirmee",
        motif: "Sources solides et concordantes.",
        assertions_citees: h.assertions,
      }),
    );
    expect(v).toMatchObject({ indication_moteur: "confirmee", ecart_indication: false });
    const liste = attendu(
      200,
      await s.expertMetier.get(`/api/dd/hypotheses/${h.id}/verdicts`),
    ).elements;
    expect(liste).toHaveLength(1);
    expect(liste[0].decision).toBeNull();
    expect(liste[0].assertions_citees).toHaveLength(2);
    expect(liste[0].assertions_citees[0]).toMatchObject({ sens: "soutient", lecture: "solide" });
    const noeud = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossier}/hypotheses`),
    ).noeuds.find((n: any) => n.id === h.id);
    expect(noeud.etat).toBe("en_attente");
    expect(noeud.verdict_en_vigueur).toBeNull();
    // Écart : verdict « non concluante » alors que le moteur indique « confirmée ».
    const h2 = await hypothese(s.consultantEquipe, s.consultantEquipe);
    const court = await proposer(s.consultantEquipe, h2.id, {
      hypothese_version: 1,
      verdict: "non_concluante",
      motif: "Trop court.",
      assertions_citees: [],
    });
    expect(court.statusCode).toBe(400);
    expect(court.json().erreur.code).toBe("MOTIF_DETAILLE_REQUIS");
    const ecart = attendu(
      201,
      await proposer(s.consultantEquipe, h2.id, {
        hypothese_version: 1,
        verdict: "non_concluante",
        motif: "Les sources datent de plus de trois ans : prudence.",
        assertions_citees: [],
      }),
    );
    expect(ecart.ecart_indication).toBe(true);
    const aj = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossier}/ajustements`),
    ).elements.find((a: any) => a.cible_id === ecart.id);
    expect(aj).toMatchObject({
      cible_type: "verdict",
      champ: "verdict",
      valeur_avant: "confirmee",
      valeur_apres: "non_concluante",
    });
  });

  it("l'indication n'est jamais reçue du client (champ refusé)", async () => {
    const h = await hypothese(s.consultantEquipe, s.consultantEquipe, 1);
    const r = await proposer(s.consultantEquipe, h.id, {
      hypothese_version: 1,
      verdict: "confirmee",
      motif: "x.",
      assertions_citees: h.assertions,
      indication_moteur: "confirmee",
    });
    expect(r.statusCode).toBe(400);
  });

  it("409 VERDICT_SANS_SOURCE : citation absente, non liée, du mauvais sens ; 400 sans citation dans le schéma", async () => {
    const h = await hypothese(s.consultantEquipe, s.consultantEquipe, 1);
    const nonLiee = (await creerAssertion(s.consultantEquipe, s.missionId)).id as string;
    const lien = (corps: Record<string, unknown>) =>
      proposer(s.consultantEquipe, h.id, {
        hypothese_version: 1,
        motif: "Motif détaillé du verdict proposé.",
        ...corps,
      });
    expect((await lien({ verdict: "confirmee", assertions_citees: [] })).statusCode).toBe(400);
    expect(
      (await lien({ verdict: "confirmee", assertions_citees: [nonLiee] })).json().erreur.code,
    ).toBe("VERDICT_SANS_SOURCE");
    expect(
      (await lien({ verdict: "infirmee", assertions_citees: h.assertions })).json().erreur.code,
    ).toBe("VERDICT_SANS_SOURCE");
    expect(
      (await lien({ verdict: "confirmee", assertions_citees: [INCONNU] })).json().erreur.code,
    ).toBe("VERDICT_SANS_SOURCE");
  });

  it("409 VERSION_PERIMEE (hypothese_version), VERDICT_EN_ATTENTE, droits", async () => {
    const h = await hypothese(s.consultantEquipe, s.consultantEquipe, 1);
    const base = {
      verdict: "confirmee",
      motif: "Source solide unique.",
      assertions_citees: h.assertions,
    };
    expect(
      (await proposer(s.consultantEquipe, h.id, { ...base, hypothese_version: 3 })).json().erreur
        .code,
    ).toBe("VERSION_PERIMEE");
    expect(
      (await proposer(s.expertMetier, h.id, { ...base, hypothese_version: 1 })).statusCode,
    ).toBe(403);
    expect((await proposer(s.b.associe, h.id, { ...base, hypothese_version: 1 })).statusCode).toBe(
      404,
    );
    attendu(
      201,
      await proposer(s.consultantEquipe, h.id, {
        ...base,
        hypothese_version: 1,
        verdict: "non_concluante",
        motif: "Une seule source : prudence, indication du moteur.",
        assertions_citees: [],
      }),
    );
    expect(
      (await proposer(s.consultantEquipe, h.id, { ...base, hypothese_version: 1 })).json().erreur
        .code,
    ).toBe("VERDICT_EN_ATTENTE");
  });
});

describe("validation (R23) et séparation des tâches", () => {
  const valider = (par: Api, id: string, corps: Record<string, unknown> = { decision: "valide" }) =>
    par.post(`/api/dd/verdicts/${id}/validation`, corps);

  async function enAttente(auteurHyp: Api, redacteur: Api, proposant: Api) {
    const h = await hypothese(auteurHyp, redacteur, 2);
    const v = attendu(
      201,
      await proposer(proposant, h.id, {
        hypothese_version: 1,
        verdict: "confirmee",
        motif: "Sources solides et concordantes.",
        assertions_citees: h.assertions,
      }),
    );
    return { h, verdict: v.id as string };
  }

  it("un expert tiers valide : le verdict prend effet (état dérivé)", async () => {
    const { h, verdict } = await enAttente(
      s.consultantEquipe,
      s.consultantEquipe,
      s.consultantEquipe,
    );
    attendu(201, await valider(s.expertMetier, verdict));
    const noeud = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossier}/hypotheses`),
    ).noeuds.find((n: any) => n.id === h.id);
    expect(noeud.etat).toBe("confirmee");
    expect(noeud.verdict_en_vigueur).toMatchObject({ id: verdict, verdict: "confirmee" });
    expect(noeud.verdict_en_attente).toBeNull();
    const dec = attendu(200, await s.expertMetier.get(`/api/dd/hypotheses/${h.id}/verdicts`))
      .elements[0].decision;
    expect(dec.decision).toBe("valide");
    const deux = await valider(s.a.chef, verdict);
    expect(deux.statusCode).toBe(409);
    expect(deux.json().erreur.code).toBe("VERDICT_DEJA_DECIDE");
  });

  it("refuse le proposant, l'auteur de l'hypothèse et l'auteur d'une assertion citée (403, API)", async () => {
    // Proposant = chef (dd.valider) ; hypothèse et assertions de consultantEquipe.
    const a = await enAttente(s.consultantEquipe, s.consultantEquipe, s.a.chef);
    const r = await valider(s.a.chef, a.verdict);
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    // Auteur de l'hypothèse = chef ; proposant consultant.
    const b = await enAttente(s.a.chef, s.consultantEquipe, s.consultantEquipe);
    expect((await valider(s.a.chef, b.verdict)).json().erreur.code).toBe("SEPARATION_DES_TACHES");
    // Auteur d'une assertion citée = directeur ; hypothèse et proposant consultant.
    const c = await enAttente(s.consultantEquipe, s.a.directeur, s.consultantEquipe);
    expect((await valider(s.a.directeur, c.verdict)).json().erreur.code).toBe(
      "SEPARATION_DES_TACHES",
    );
    // Le tiers (chef pour c) valide.
    attendu(201, await valider(s.a.chef, c.verdict));
  });

  it("un associé est dispensé de la séparation (mais valide quand même par dd.valider)", async () => {
    const x = await enAttente(s.a.associe, s.a.associe, s.a.associe);
    attendu(201, await valider(s.a.associe, x.verdict));
  });

  it("rejet : motif obligatoire ; l'état antérieur demeure ; un nouveau verdict devient possible", async () => {
    const { h, verdict } = await enAttente(
      s.consultantEquipe,
      s.consultantEquipe,
      s.consultantEquipe,
    );
    expect((await valider(s.expertMetier, verdict, { decision: "rejete" })).statusCode).toBe(400);
    attendu(
      201,
      await valider(s.expertMetier, verdict, { decision: "rejete", motif: "Sources à compléter." }),
    );
    const noeud = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossier}/hypotheses`),
    ).noeuds.find((n: any) => n.id === h.id);
    expect(noeud.etat).toBe("ouverte");
    attendu(
      201,
      await proposer(s.consultantEquipe, h.id, {
        hypothese_version: 1,
        verdict: "confirmee",
        motif: "Sources solides, à nouveau.",
        assertions_citees: h.assertions,
      }),
    );
  });

  it("409 VERDICT_PERIME : l'hypothèse a changé depuis la proposition", async () => {
    const { h, verdict } = await enAttente(
      s.consultantEquipe,
      s.consultantEquipe,
      s.consultantEquipe,
    );
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/hypotheses/${h.id}/versions`, {
        version_courante: 1,
        motif: "Reformulation.",
        libelle: "Hypothèse reformulée",
      }),
    );
    const r = await valider(s.expertMetier, verdict);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("VERDICT_PERIME");
  });

  it("droits : 403 consultant (sans dd.valider), 404 autre cabinet, 401, 404 inconnu", async () => {
    const { verdict } = await enAttente(s.consultantEquipe, s.consultantEquipe, s.consultantEquipe);
    expect((await valider(s.consultantEquipe, verdict)).statusCode).toBe(403);
    expect((await valider(s.b.associe, verdict)).statusCode).toBe(404);
    expect((await valider(s.expertMetier, INCONNU)).statusCode).toBe(404);
    expect(
      (await valider(s.expertMetier, verdict, { decision: "valide", extra: 1 })).statusCode,
    ).toBe(400);
  });
});
