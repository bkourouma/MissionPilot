/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import {
  attendu,
  creerDossierDd,
  creerPointDd,
  INCONNU,
  preparerDd,
  sourcer,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerAssertion } from "./preuves-outils.js";

/*
 * Filtrage environnemental et social (DD-14, R35 à R41) : listes d'exclusion (génériques ou d'un
 * investisseur), exécution, décisions et séparation des tâches (API et base, MPZ28), synthèse
 * recalculée à chaque lecture, thèmes sourcés.
 */

let ctx: Contexte;
let s: ScenarioDd;
let liste: string;

const REGLES = [
  { code: "jeux-argent", libelle: "Jeux d'argent", mots_cles: ["casino", "jeux d'argent"] },
  { code: "tabac", libelle: "Tabac", mots_cles: ["tabac"] },
  { code: "armes-citi-b", libelle: "Industries extractives", secteur_codes: ["citi_b"] },
];

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD E&S");
  liste = attendu(
    201,
    await s.expertMetier.post("/api/dd/listes-exclusion", {
      nom: "Liste générale",
      reference_cadre: "Normes de performance de la SFI (cadre public)",
      regles: REGLES,
    }),
  ).id;
}, 240_000);
afterAll(() => ctx.fermer());

const filtrage = (d: string, par: Api = s.consultantEquipe, corps: Record<string, unknown> = {}) =>
  par.post(`/api/dd/dossiers/${d}/filtrages`, {
    liste_id: liste,
    declarations: {
      activites: ["Exploitation d'un CASINO en zone franche", "Fabrication d'étiquettes"],
      secteur_codes: ["citi_a"],
      pays_codes: [],
    },
    themes: [{ code: "main_oeuvre", niveau: "faible" }],
    ...corps,
  });

describe("listes d'exclusion (R35 à R38)", () => {
  it("droits : 401 ; 403 consultant à l'écriture ; 201 expert métier et directeur ; lecture dd.lire", async () => {
    expect((await api(ctx).get("/api/dd/listes-exclusion")).statusCode).toBe(401);
    const corps = { nom: "Autre liste", regles: REGLES };
    expect((await s.consultantEquipe.post("/api/dd/listes-exclusion", corps)).statusCode).toBe(403);
    expect((await s.gestionnaire.get("/api/dd/listes-exclusion")).statusCode).toBe(403);
    attendu(201, await s.a.directeur.post("/api/dd/listes-exclusion", corps));
    const l = attendu(200, await s.consultantEquipe.get("/api/dd/listes-exclusion"));
    expect(l.elements.find((e: any) => e.id === liste)).toMatchObject({
      nom: "Liste générale",
      version: 1,
      nb_regles: 3,
      client_id: null,
    });
    expect((await s.b.associe.get(`/api/dd/listes-exclusion/${liste}/versions`)).statusCode).toBe(
      404,
    );
    expect(attendu(200, await s.b.associe.get("/api/dd/listes-exclusion")).elements).toEqual([]);
  });

  it("nom unique (LISTE_EXISTANTE), client inconnu, règle sans critère, codes en double, client de l'investisseur", async () => {
    expect(
      (
        await s.expertMetier.post("/api/dd/listes-exclusion", {
          nom: "Liste générale",
          regles: REGLES,
        })
      ).json().erreur.code,
    ).toBe("LISTE_EXISTANTE");
    const client = s.a.clientId;
    const ok = await s.expertMetier.post("/api/dd/listes-exclusion", {
      nom: "Investisseur A",
      client_id: client,
      regles: REGLES,
    });
    expect(ok.statusCode).toBe(201);
    expect(
      attendu(
        200,
        await s.expertMetier.get(`/api/dd/listes-exclusion?client_id=${client}`),
      ).elements.map((e: any) => e.nom),
    ).toEqual(["Investisseur A"]);
    const inconnu = await s.expertMetier.post("/api/dd/listes-exclusion", {
      nom: "Client inconnu",
      client_id: INCONNU,
      regles: REGLES,
    });
    expect(inconnu.json().erreur.code).toBe("LIEN_INCOHERENT");
    expect(
      (
        await s.expertMetier.post("/api/dd/listes-exclusion", {
          nom: "Sans critère",
          regles: [{ code: "x", libelle: "x" }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.expertMetier.post("/api/dd/listes-exclusion", {
          nom: "Doublons",
          regles: [REGLES[1], REGLES[1]],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await s.expertMetier.post("/api/dd/listes-exclusion", { nom: "Vide", regles: [] }))
        .statusCode,
    ).toBe(400);
  });

  it("versions : nouvelle version motivée, version périmée, historique avec les règles", async () => {
    const id = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: "Versionnée",
        regles: [REGLES[1]],
      }),
    ).id;
    const url = `/api/dd/listes-exclusion/${id}/versions`;
    attendu(
      201,
      await s.expertMetier.post(url, {
        regles: REGLES,
        version_courante: 1,
        motif: "Ajout de règles.",
      }),
    );
    expect(
      (
        await s.expertMetier.post(url, { regles: REGLES, version_courante: 1, motif: "Encore." })
      ).json().erreur.code,
    ).toBe("VERSION_PERIMEE");
    expect(
      (await s.consultantEquipe.post(url, { regles: REGLES, version_courante: 2, motif: "x." }))
        .statusCode,
    ).toBe(403);
    const v = attendu(200, await s.consultantEquipe.get(url)).elements;
    expect(v.map((x: any) => x.version)).toEqual([2, 1]);
    expect(v[0].regles).toHaveLength(3);
  });
});

describe("filtrage d'un dossier (R39 à R41)", () => {
  it("exécute la liste : règles touchées, mots trouvés, synthèse recalculée", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const r = attendu(201, await filtrage(d));
    expect(r.touches).toEqual([
      {
        regle: "jeux-argent",
        libelle: "Jeux d'argent",
        criteres: ["mot_cle"],
        mots_trouves: ["casino"],
      },
    ]);
    expect(r.non_touchees).toBe(2);
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.elements).toHaveLength(1);
    expect(l.elements[0].touches[0]).toMatchObject({ regle: "jeux-argent", decision: null });
    expect(l.synthese).toMatchObject({
      touches_bloquantes: 1,
      bloquant: true,
      niveau_global: "faible",
      complet: false,
    });
    expect(l.synthese.manquants).toHaveLength(7);
    const syn = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/synthese`));
    expect(syn.filtrage_es.bloquant).toBe(true);
    expect(syn.controle_note.bloquants).toContain("SANS_HYPOTHESE");
  });

  it("décision d'un tiers : l'exclusion écartée lève le blocage ; une décision postérieure « confirmée » le rétablit", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const f = attendu(201, await filtrage(d)).id;
    const url = `/api/dd/filtrages/${f}/decisions`;
    attendu(
      201,
      await s.expertMetier.post(url, {
        regle_code: "jeux-argent",
        decision: "ecartee",
        motif: "Faux positif : jeux de société.",
      }),
    );
    let l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.synthese.bloquant).toBe(false);
    expect(l.elements[0].touches[0]).toMatchObject({
      decision: "ecartee",
      decideur: { nom: expect.any(String) },
    });
    attendu(
      201,
      await s.expertMetier.post(url, {
        regle_code: "jeux-argent",
        decision: "confirmee",
        motif: "Après vérification, c'est un casino.",
      }),
    );
    l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.synthese.bloquant).toBe(true);
    expect(l.elements[0].touches[0].decision).toBe("confirmee");
  });

  it("séparation des tâches : l'auteur du filtrage ne décide pas (403) ; associé et tiers admis ; API puis base", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const corps = {
      regle_code: "jeux-argent",
      decision: "confirmee",
      motif: "Exclusion confirmée par l'équipe.",
    };
    const f = attendu(201, await filtrage(d, s.a.chef)).id;
    const r = await s.a.chef.post(`/api/dd/filtrages/${f}/decisions`, corps);
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    attendu(201, await s.expertMetier.post(`/api/dd/filtrages/${f}/decisions`, corps));
    const g = attendu(201, await filtrage(d, s.a.associe)).id;
    attendu(201, await s.a.associe.post(`/api/dd/filtrages/${g}/decisions`, corps));
  });

  it("400 règle absente des règles touchées ; 400 motif court ; 403 consultant ; 404 autre cabinet ou inconnu", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const f = attendu(201, await filtrage(d)).id;
    const url = `/api/dd/filtrages/${f}/decisions`;
    expect(
      (
        await s.expertMetier.post(url, {
          regle_code: "tabac",
          decision: "ecartee",
          motif: "Règle non touchée ici.",
        })
      ).json().erreur.code,
    ).toBe("RATTACHEMENT_INCOHERENT");
    expect(
      (
        await s.expertMetier.post(url, {
          regle_code: "jeux-argent",
          decision: "ecartee",
          motif: "court",
        })
      ).statusCode,
    ).toBe(400);
    const ok = {
      regle_code: "jeux-argent",
      decision: "ecartee",
      motif: "Un motif suffisant pour décider.",
    };
    expect((await s.consultantEquipe.post(url, ok)).statusCode).toBe(403);
    expect((await s.b.associe.post(url, ok)).statusCode).toBe(404);
    expect(
      (await s.expertMetier.post(`/api/dd/filtrages/${INCONNU}/decisions`, ok)).statusCode,
    ).toBe(404);
  });

  it("thèmes sourcés : la lecture de l'assertion nourrit la synthèse ; assertion d'une autre mission refusée", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const point = await creerPointDd(s.consultantEquipe, d);
    await sourcer(s.consultantEquipe, s.missionId, point.assertion_id, "solide");
    const themes = [
      {
        code: "biodiversite",
        niveau: "critique",
        justification: "Zone protégée voisine.",
        assertion_id: point.assertion_id,
      },
      {
        code: "main_oeuvre",
        niveau: "eleve",
        justification: "Recours à des sous-traitants non déclarés.",
      },
    ];
    attendu(
      201,
      await filtrage(d, s.consultantEquipe, {
        themes,
        declarations: { activites: [], secteur_codes: [], pays_codes: [] },
      }),
    );
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.synthese).toMatchObject({
      niveau_global: "critique",
      bloquant: false,
      a_documenter: ["main_oeuvre"],
    });
    const autre = (await creerAssertion(s.a.chef, s.mission2Id)).id;
    const r = await filtrage(d, s.consultantEquipe, {
      themes: [{ code: "biodiversite", niveau: "faible", assertion_id: autre }],
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("LIEN_INCOHERENT");
  });

  it("400 : thème en double, niveau modéré sans justification, liste inconnue ; 409 plafond de 50 ; droits", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    expect(
      (
        await filtrage(d, s.consultantEquipe, {
          themes: [
            { code: "biodiversite", niveau: "faible" },
            { code: "biodiversite", niveau: "faible" },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await filtrage(d, s.consultantEquipe, {
          themes: [{ code: "biodiversite", niveau: "modere" }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await filtrage(d, s.consultantEquipe, { liste_id: INCONNU })).json().erreur.code).toBe(
      "LIEN_INCOHERENT",
    );
    expect((await filtrage(d, s.expertMetier)).statusCode).toBe(403);
    expect((await filtrage(d, s.b.associe)).statusCode).toBe(404);
    expect((await s.consultantHors.get(`/api/dd/dossiers/${d}/filtrages`)).statusCode).toBe(404);
    for (let i = 0; i < 50; i += 1)
      attendu(201, await filtrage(d, s.consultantEquipe, { themes: [] }));
    const r = await filtrage(d);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });
});
