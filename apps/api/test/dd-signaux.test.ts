/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import {
  attendu,
  creerDossierDd,
  creerRisqueDd,
  INCONNU,
  preparerDd,
  type ScenarioDd,
} from "./dd-outils.js";

/*
 * Bibliothèque de signaux (DD-11, R24 à R29) : permissions (consultant 403, expert métier 201),
 * unicité du code, filtres, taxonomie, versions, signaux applicables via la chaîne de taxonomie
 * (filière → secteur, pays → zone), constats.
 */

let ctx: Contexte;
let s: ScenarioDd;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD signaux");
}, 240_000);
afterAll(() => ctx.fermer());

const contenu = (extra: Record<string, unknown> = {}) => ({
  code: "controle-changes",
  libelle: "Contrôle des changes",
  famille: "change",
  gravite_indicative: "eleve",
  question: "Les transferts de dividendes sont-ils libres ?",
  reference_publique: "Rapport sur les restrictions de change (document public)",
  ...extra,
});

describe("R24 à R27 : bibliothèque", () => {
  it("401 ; 403 (consultant, gestionnaire) à l'écriture ; 201 (expert métier, directeur, associé)", async () => {
    expect((await api(ctx).get("/api/dd/signaux")).statusCode).toBe(401);
    expect((await api(ctx).post("/api/dd/signaux", contenu())).statusCode).toBe(401);
    for (const u of [s.consultantEquipe, s.gestionnaire, s.a.chef]) {
      expect((await u.post("/api/dd/signaux", contenu())).statusCode).toBe(403);
    }
    expect((await s.gestionnaire.get("/api/dd/signaux")).statusCode).toBe(403);
    attendu(201, await s.expertMetier.post("/api/dd/signaux", contenu()));
    attendu(201, await s.a.directeur.post("/api/dd/signaux", contenu({ code: "autre-signal" })));
    attendu(201, await s.a.associe.post("/api/dd/signaux", contenu({ code: "signal-associe" })));
  });

  it("code unique par cabinet (SIGNAL_EXISTANT) ; autre cabinet indépendant et cloisonné", async () => {
    const r = await s.expertMetier.post("/api/dd/signaux", contenu());
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("SIGNAL_EXISTANT");
    const b = await s.b.associe.post("/api/dd/signaux", contenu());
    expect(b.statusCode).toBe(201);
    const liste = attendu(200, await s.consultantEquipe.get("/api/dd/signaux?limite=100"));
    expect(liste.elements.some((e: any) => e.id === b.json().id)).toBe(false);
  });

  it("400 : code invalide, taxonomie inconnue, famille ou gravité inconnues, champ inconnu", async () => {
    for (const extra of [
      { code: "Code Invalide" },
      { secteur_code: "citi_zz" },
      { pays_code: "zz" },
      { famille: "autre" },
      { gravite_indicative: "extreme" },
      { inconnu: 1 },
    ]) {
      const r = await s.expertMetier.post("/api/dd/signaux", contenu({ code: "x-1", ...extra }));
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
    }
    const r = await s.expertMetier.post(
      "/api/dd/signaux",
      contenu({ code: "x-2", secteur_code: "citi_zz" }),
    );
    expect(r.json().erreur.code).toBe("TAXONOMIE_INCONNUE");
  });

  it("filtres, recherche et pagination par curseur", async () => {
    for (const [code, famille, secteur, pays] of [
      ["sig-a", "pays", "citi_a", "ci"],
      ["sig-b", "operationnel", "cacao", null],
      ["sig-c", "reglementaire", null, "uemoa"],
    ] as const) {
      attendu(
        201,
        await s.expertMetier.post(
          "/api/dd/signaux",
          contenu({
            code,
            libelle: `Libellé ${code}`,
            famille,
            secteur_code: secteur,
            pays_code: pays,
          }),
        ),
      );
    }
    const parFamille = attendu(200, await s.consultantEquipe.get("/api/dd/signaux?famille=pays"));
    expect(parFamille.elements.map((e: any) => e.code)).toEqual(["sig-a"]);
    expect(
      attendu(200, await s.consultantEquipe.get("/api/dd/signaux?secteur_code=cacao")).elements.map(
        (e: any) => e.code,
      ),
    ).toEqual(["sig-b"]);
    expect(
      attendu(200, await s.consultantEquipe.get("/api/dd/signaux?pays_code=uemoa")).elements.map(
        (e: any) => e.code,
      ),
    ).toEqual(["sig-c"]);
    expect(
      attendu(200, await s.consultantEquipe.get("/api/dd/signaux?q=sig-b")).elements,
    ).toHaveLength(1);
    const p1 = attendu(200, await s.consultantEquipe.get("/api/dd/signaux?limite=2"));
    expect(p1.elements).toHaveLength(2);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = attendu(
      200,
      await s.consultantEquipe.get(`/api/dd/signaux?limite=2&curseur=${p1.curseur_suivant}`),
    );
    expect(p2.elements.every((e: any) => !p1.elements.some((x: any) => x.id === e.id))).toBe(true);
    expect((await s.consultantEquipe.get("/api/dd/signaux?limite=101")).statusCode).toBe(400);
    expect((await s.consultantEquipe.get("/api/dd/signaux?curseur=%25")).statusCode).toBe(400);
    expect(
      attendu(200, await s.consultantEquipe.get("/api/dd/signaux?actif=false")).elements,
    ).toEqual([]);
  });

  it("versions : correction motivée, désactivation, historique ; version périmée ; droits", async () => {
    const c = attendu(
      201,
      await s.expertMetier.post("/api/dd/signaux", contenu({ code: "versionne" })),
    );
    const url = `/api/dd/signaux/${c.id}/versions`;
    const corps = {
      ...contenu({ gravite_indicative: "critique" }),
      version_courante: 1,
      motif: "Aggravation.",
    };
    delete (corps as any).code;
    attendu(201, await s.expertMetier.post(url, corps));
    expect((await s.expertMetier.post(url, corps)).json().erreur.code).toBe("VERSION_PERIMEE");
    attendu(
      201,
      await s.expertMetier.post(url, {
        ...corps,
        version_courante: 2,
        actif: false,
        motif: "Désactivé.",
      }),
    );
    const versions = attendu(
      200,
      await s.consultantEquipe.get(`/api/dd/signaux/${c.id}/versions`),
    ).elements;
    expect(versions.map((v: any) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].actif).toBe(false);
    expect((await s.consultantEquipe.post(url, { ...corps, version_courante: 3 })).statusCode).toBe(
      403,
    );
    expect((await s.b.associe.post(url, { ...corps, version_courante: 3 })).statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/dd/signaux/${c.id}/versions`)).statusCode).toBe(404);
    expect(
      (await s.expertMetier.post(url, { ...corps, version_courante: 3, motif: undefined }))
        .statusCode,
    ).toBe(400);
  });
});

describe("R28, R29 : signaux applicables et constats", () => {
  it("applicables via filière → secteur et pays → zone ; spécificité ; inactifs exclus", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id; // citi_a, cacao, ci (zone uemoa)
    const creer = (code: string, extra: Record<string, unknown>) =>
      s.expertMetier.post(
        "/api/dd/signaux",
        contenu({
          code,
          libelle: `Applicable ${code}`,
          secteur_code: null,
          pays_code: null,
          ...extra,
        }),
      );
    const ids: Record<string, string> = {};
    for (const [code, extra] of [
      ["app-general", { gravite_indicative: "modere" }],
      ["app-secteur", { secteur_code: "citi_a", gravite_indicative: "eleve" }],
      [
        "app-filiere-pays",
        { secteur_code: "cacao", pays_code: "ci", gravite_indicative: "critique" },
      ],
      ["app-zone", { pays_code: "uemoa", gravite_indicative: "faible" }],
      ["app-autre-secteur", { secteur_code: "citi_b" }],
      ["app-autre-pays", { pays_code: "sn" }],
      ["app-hors-zone", { pays_code: "cemac" }],
    ] as const) {
      ids[code] = attendu(201, await creer(code, extra)).id;
    }
    const inactif = attendu(201, await creer("app-inactif", {}));
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/signaux/${inactif.id}/versions`, {
        ...contenu({ libelle: "Inactif", secteur_code: null, pays_code: null }),
        actif: false,
        version_courante: 1,
        motif: "Désactivé.",
        code: undefined,
      }),
    );
    const l = attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/signaux`)).elements;
    const codes = (id: string) => Object.entries(ids).find(([, v]) => v === id)?.[0];
    const mine = l.filter((e: any) => codes(e.signal_id));
    expect(mine.map((e: any) => codes(e.signal_id))).toEqual([
      "app-filiere-pays",
      "app-secteur",
      "app-zone",
      "app-general",
    ]);
    expect(mine.map((e: any) => e.specificite)).toEqual([2, 1, 1, 0]);
    expect(l.some((e: any) => e.signal_id === inactif.id)).toBe(false);
    expect(mine[0]).toMatchObject({
      famille: "change",
      gravite_indicative: "critique",
      etat_constat: null,
      risque_id: null,
    });
  });

  it("constats : constaté, écarté (commentaire obligatoire), état courant = dernier constat ; risque lié", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const sig = attendu(
      201,
      await s.expertMetier.post(
        "/api/dd/signaux",
        contenu({ code: "constat-1", secteur_code: null, pays_code: null }),
      ),
    ).id;
    const url = `/api/dd/dossiers/${d}/signaux/${sig}/constats`;
    expect((await s.consultantEquipe.post(url, { etat: "ecarte" })).statusCode).toBe(400);
    attendu(
      201,
      await s.consultantEquipe.post(url, {
        etat: "ecarte",
        commentaire: "Hors périmètre de l'opération.",
      }),
    );
    const risque = await creerRisqueDd(s.consultantEquipe, d, { signal_id: sig, niveau: "eleve" });
    attendu(201, await s.consultantEquipe.post(url, { etat: "constate", risque_id: risque.id }));
    const l = attendu(
      200,
      await s.consultantEquipe.get(`/api/dd/dossiers/${d}/signaux`),
    ).elements.find((e: any) => e.signal_id === sig);
    expect(l).toMatchObject({ etat_constat: "constate", risque_id: risque.id });
    const synthese = attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/synthese`));
    expect(synthese.signaux.constates).toBe(1);
    const autreDossier = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const ailleurs = await s.consultantEquipe.post(
      `/api/dd/dossiers/${autreDossier}/signaux/${sig}/constats`,
      { etat: "constate", risque_id: risque.id },
    );
    expect(ailleurs.statusCode).toBe(400);
    expect(ailleurs.json().erreur.code).toBe("LIEN_INCOHERENT");
  });

  it("404 : signal non applicable ou inconnu, autre cabinet, mission invisible ; 403 expert métier", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id;
    const horsSujet = attendu(
      201,
      await s.expertMetier.post(
        "/api/dd/signaux",
        contenu({ code: "hors-sujet", secteur_code: "citi_b", pays_code: null }),
      ),
    ).id;
    const url = (sig: string) => `/api/dd/dossiers/${d}/signaux/${sig}/constats`;
    expect((await s.consultantEquipe.post(url(horsSujet), { etat: "constate" })).statusCode).toBe(
      404,
    );
    expect((await s.consultantEquipe.post(url(INCONNU), { etat: "constate" })).statusCode).toBe(
      404,
    );
    expect((await s.b.associe.post(url(horsSujet), { etat: "constate" })).statusCode).toBe(404);
    expect((await s.consultantHors.get(`/api/dd/dossiers/${d}/signaux`)).statusCode).toBe(404);
    expect((await s.expertMetier.post(url(horsSujet), { etat: "constate" })).statusCode).toBe(403);
    expect((await s.gestionnaire.get(`/api/dd/dossiers/${d}/signaux`)).statusCode).toBe(403);
  });
});
