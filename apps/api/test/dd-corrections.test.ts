/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  assertionHypotheseDd,
  attendu,
  creerDossierDd,
  creerHypotheseDd,
  creerPointDd,
  dossierPret,
  inserer,
  INCONNU,
  missionDd,
  preparerDd,
  sourcer,
  type ScenarioDd,
} from "./dd-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";

/*
 * Corrections de l'audit de sécurité du lot 3b : verdict et note validés qui ne deviennent pas
 * faux, un seul rédacteur ne lève pas un blocage E&S, lectures bornées, 404 au même libellé,
 * curseur, liste d'un autre investisseur, auteur de N'IMPORTE QUELLE version d'une assertion,
 * libellés du rapport, dimension désactivée, libellé de la recherche.
 */

let ctx: Contexte & { dossier: string };
let s: ScenarioDd;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerDd(ctx, "DD corrections");
}, 300_000);
afterAll(() => ctx.fermer());

/** Hypothèse de consultantEquipe à deux assertions solides ; verdict proposé (et validé si demandé). */
async function hypotheseEtVerdict(dossier: string, mission: string, valider: boolean) {
  const h = await creerHypotheseDd(s.consultantEquipe, dossier);
  const assertions: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const a = await assertionHypotheseDd(s.consultantEquipe, h.id, { enonce: `Source ${i}.` });
    await sourcer(s.consultantEquipe, mission, a.assertion_id, "solide");
    assertions.push(a.assertion_id);
  }
  const v = attendu(
    201,
    await s.consultantEquipe.post(`/api/dd/hypotheses/${h.id}/verdicts`, {
      hypothese_version: 1,
      verdict: "confirmee",
      motif: "Sources solides et concordantes.",
      assertions_citees: assertions,
    }),
  );
  if (valider) {
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/verdicts/${v.id}/validation`, { decision: "valide" }),
    );
  }
  return { h: h.id, assertions, verdict: v.id as string };
}

describe("IMPORTANT 1 : un verdict ou une note validés ne deviennent pas faux", () => {
  it("une source citée par un verdict en attente ne se délie pas, ne change pas de sens, ne se retire pas", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const { h, assertions } = await hypotheseEtVerdict(d, m, false);
    const url = `/api/dd/hypotheses/${h}/liens`;
    const delier = await s.consultantEquipe.post(url, {
      assertion_id: assertions[0],
      action: "delier",
    });
    expect(delier.statusCode).toBe(409);
    expect(delier.json().erreur.code).toBe("ASSERTION_CITEE");
    const sens = await s.consultantEquipe.post(url, {
      assertion_id: assertions[0],
      action: "lier",
      sens: "contredit",
    });
    expect(sens.json().erreur.code).toBe("ASSERTION_CITEE");
    // Un point d'analyse lié à l'hypothèse puis cité : son retrait est refusé.
    const point = await creerPointDd(s.consultantEquipe, d);
    await sourcer(s.consultantEquipe, m, point.assertion_id, "solide");
    attendu(
      201,
      await s.consultantEquipe.post(url, {
        assertion_id: point.assertion_id,
        action: "lier",
        sens: "soutient",
      }),
    );
    const h2 = await creerHypotheseDd(s.consultantEquipe, d);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/hypotheses/${h2.id}/liens`, {
        assertion_id: point.assertion_id,
        action: "lier",
        sens: "soutient",
      }),
    );
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/hypotheses/${h2.id}/verdicts`, {
        hypothese_version: 1,
        verdict: "non_concluante",
        motif: "Une seule source : prudence, indication du moteur.",
        assertions_citees: [point.assertion_id],
      }),
    );
    const retrait = await s.consultantEquipe.post(`/api/dd/points/${point.id}/versions`, {
      version_courante: 1,
      motif: "Retrait.",
      retire: true,
    });
    expect(retrait.statusCode).toBe(409);
    expect(retrait.json().erreur.code).toBe("ASSERTION_CITEE");
  });

  it("un verdict VALIDÉ garde ses sources ; son hypothèse ne se retire plus (HYPOTHESE_AVEC_VERDICT)", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const { h, assertions } = await hypotheseEtVerdict(d, m, true);
    const r = await s.consultantEquipe.post(`/api/dd/hypotheses/${h}/liens`, {
      assertion_id: assertions[1],
      action: "delier",
    });
    expect(r.json().erreur.code).toBe("ASSERTION_CITEE");
    const retrait = await s.consultantEquipe.post(`/api/dd/hypotheses/${h}/versions`, {
      version_courante: 1,
      motif: "Retrait.",
      retire: true,
    });
    expect(retrait.statusCode).toBe(409);
    expect(retrait.json().erreur.code).toBe("HYPOTHESE_AVEC_VERDICT");
  });

  it("la validation revérifie les citations (API puis base, MPZ27) ; un verdict périmé reste rejetable", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const x = await hypotheseEtVerdict(d, m, false);
    // Le lien est délié hors de l'API (SQL du propriétaire) : le verdict repose sur une source disparue.
    await inserer("dd_hypothese_liens", {
      cabinet_id: s.a.cabinetId,
      dossier_id: d,
      hypothese_id: x.h,
      assertion_id: x.assertions[0],
      action: "delier",
      cree_par: s.consultantEquipe.utilisateurId,
    });
    const r = await s.expertMetier.post(`/api/dd/verdicts/${x.verdict}/validation`, {
      decision: "valide",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("VERDICT_PERIME");
    await expect(
      inserer("dd_verdict_validations", {
        cabinet_id: s.a.cabinetId,
        verdict_id: x.verdict,
        decision: "valide",
        valide_par: s.expertMetier.utilisateurId,
      }),
    ).rejects.toMatchObject({ code: "MPZ27" });
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/verdicts/${x.verdict}/validation`, {
        decision: "rejete",
        motif: "Une source a disparu.",
      }),
    );
    // Une assertion abandonnée entre la proposition et la validation : même refus.
    const y = await hypotheseEtVerdict(d, m, false);
    await inserer("assertion_versions", {
      cabinet_id: s.a.cabinetId,
      assertion_id: y.assertions[0],
      version: 2,
      enonce: "Abandonnée.",
      classe_risque: "R2",
      statut: "abandonnee",
      motif: "Abandon.",
      cree_par: s.consultantEquipe.utilisateurId,
    });
    expect(
      (
        await s.expertMetier.post(`/api/dd/verdicts/${y.verdict}/validation`, {
          decision: "valide",
        })
      ).json().erreur.code,
    ).toBe("VERDICT_PERIME");
  });

  it("validation d'une note : les bloquants du moteur sont recalculés sur l'état courant (NOTE_BLOQUEE)", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
        titre: "Note",
        recommandation: "favorable",
        synthese: "Dossier solide.",
        conditions: [],
      }),
    );
    const v = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 }),
    ).version;
    // Après la soumission, un filtrage touche une règle d'exclusion : la recommandation favorable n'est plus tenable.
    const liste = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: `Après soumission ${dossierId}`,
        regles: [{ code: "casino", libelle: "Jeux", mots_cles: ["casino"] }],
      }),
    );
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/filtrages`, {
        liste_id: liste.id,
        declarations: { activites: ["Casino"] },
      }),
    );
    const r = await s.expertMetier.post(`/api/dd/notes/${n.id}/validation`, {
      version: v,
      decision: "valide",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("NOTE_BLOQUEE");
    expect(r.json().erreur.details.manquants).toContain("EXCLUSION_NON_LEVEE_FAVORABLE");
    // Un rejet reste possible.
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/notes/${n.id}/validation`, {
        version: v,
        decision: "rejete",
        motif: "Le dossier a changé.",
      }),
    );
  });
});

describe("IMPORTANT 2 : un seul rédacteur ne lève pas un blocage", () => {
  async function listeJeux(nom: string, client: string | null = null) {
    return attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom,
        client_id: client,
        regles: [{ code: "casino", libelle: "Jeux d'argent", mots_cles: ["casino"] }],
      }),
    ).id as string;
  }
  const filtrage = (d: string, liste: string, activites: string[], par: Api = s.consultantEquipe) =>
    par.post(`/api/dd/dossiers/${d}/filtrages`, { liste_id: liste, declarations: { activites } });

  it("une exclusion confirmée reste bloquante dans un filtrage ultérieur qui ne la touche plus, jusqu'à décision d'un tiers", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const liste = await listeJeux(`Anterieur ${m}`);
    const f1 = attendu(201, await filtrage(d, liste, ["Casino"])).id;
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/filtrages/${f1}/decisions`, {
        regle_code: "casino",
        decision: "confirmee",
        motif: "Exclusion confirmée par l'expert.",
      }),
    );
    // Le consultant refait un filtrage « propre » : l'exclusion confirmée reste bloquante.
    const f2 = attendu(201, await filtrage(d, liste, ["Culture de cacao"])).id;
    let l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.synthese).toMatchObject({ bloquant: true, touches_bloquantes: 1 });
    expect(l.exclusions_anterieures_non_levees).toEqual([
      { regle: "casino", libelle: "Jeux d'argent" },
    ]);
    // Il ne peut pas la lever lui-même (pas de dd.valider) ; l'auteur du filtrage non plus.
    const ecartee = {
      regle_code: "casino",
      decision: "ecartee",
      motif: "Faux positif constaté par un tiers.",
    };
    expect(
      (await s.consultantEquipe.post(`/api/dd/filtrages/${f2}/decisions`, ecartee)).statusCode,
    ).toBe(403);
    const f3 = attendu(201, await filtrage(d, liste, ["Transformation de cacao"], s.a.chef)).id;
    const refus = await s.a.chef.post(`/api/dd/filtrages/${f3}/decisions`, ecartee);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    // La note exécutive le dit : la base figée liste la règle antérieure.
    const note = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/notes`, {
      titre: "N",
      recommandation: "favorable",
      synthese: "x",
      conditions: [],
    });
    const detail = attendu(200, await s.expertMetier.get(`/api/dd/notes/${note.json().id}`));
    expect(detail.controle.bloquants).toContain("EXCLUSION_NON_LEVEE_FAVORABLE");
    // Un tiers écarte la MÊME règle dans le dernier filtrage : le blocage est levé.
    attendu(201, await s.expertMetier.post(`/api/dd/filtrages/${f3}/decisions`, ecartee));
    l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.synthese.bloquant).toBe(false);
    expect(l.exclusions_anterieures_non_levees).toEqual([]);
    // Une règle jamais touchée dans le dossier reste refusée.
    expect(
      (
        await s.expertMetier.post(`/api/dd/filtrages/${f3}/decisions`, {
          ...ecartee,
          regle_code: "inconnue",
        })
      ).json().erreur.code,
    ).toBe("RATTACHEMENT_INCOHERENT");
  });

  it("base : le trigger MPZ28 accepte une règle d'un filtrage antérieur, refuse une règle inconnue", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const liste = await listeJeux(`Trigger ${m}`);
    attendu(201, await filtrage(d, liste, ["Casino"]));
    const f2 = attendu(201, await filtrage(d, liste, ["Cacao"])).id;
    const base = {
      cabinet_id: s.a.cabinetId,
      filtrage_id: f2,
      decision: "ecartee",
      motif: "Faux positif constaté.",
      decideur_id: s.expertMetier.utilisateurId,
    };
    await expect(
      inserer("dd_filtrage_decisions", { ...base, regle_code: "inconnue" }),
    ).rejects.toMatchObject({ code: "MPZ28", hint: "regle_inconnue" });
    expect(
      (await inserer("dd_filtrage_decisions", { ...base, regle_code: "casino" })).regle_code,
    ).toBe("casino");
  });

  it("MINEUR 6 : une liste d'un autre investisseur ne s'applique pas à ce dossier (400 LIEN_INCOHERENT)", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const autre = await listeJeux(`Autre investisseur ${m}`, s.autreClientId);
    const r = await filtrage(d, autre, ["Casino"]);
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("LIEN_INCOHERENT");
    const memeClient = await listeJeux(`Même client ${m}`, s.a.clientId);
    expect((await filtrage(d, memeClient, ["Casino"])).statusCode).toBe(201);
    // La lecture d'une liste reste ouverte à tout détenteur de dd.lire du cabinet.
    expect(
      attendu(
        200,
        await s.consultantEquipe.get(`/api/dd/listes-exclusion?client_id=${s.autreClientId}`),
      ).elements.map((e: any) => e.id),
    ).toContain(autre);
  });
});

describe("IMPORTANT 3 : lectures bornées en octets", () => {
  it("la base figée ne sort que pour la version demandée ; une page de listes ne porte pas les règles", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
        titre: "Note",
        recommandation: "favorable",
        synthese: "x",
        conditions: [],
      }),
    );
    const v = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 }),
    ).version;
    const sans = attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}`));
    expect(sans.base_figee).toBeUndefined();
    expect(JSON.stringify(sans)).not.toContain("version_base");
    expect(
      attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}?version=${v}`)).base_figee
        .version_base,
    ).toBe(1);
    const listes = attendu(
      200,
      await s.consultantEquipe.get("/api/dd/listes-exclusion?limite=100"),
    );
    expect(listes.elements.length).toBeGreaterThan(0);
    expect(JSON.stringify(listes)).not.toContain("mots_cles");
    const filtrages = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossierId}/filtrages`),
    );
    expect(JSON.stringify(filtrages)).not.toContain("mots_cles");
  });

  it("versions d'une liste paginées ; plafonds des règles (400) ; une liste hors plafonds (200 règles, plus de 700 000 octets) est refusée par la base", async () => {
    const id = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: "Paginée",
        regles: [{ code: "a", libelle: "A", mots_cles: ["a"] }],
      }),
    ).id;
    for (let i = 1; i <= 12; i += 1) {
      attendu(
        201,
        await s.expertMetier.post(`/api/dd/listes-exclusion/${id}/versions`, {
          regles: [{ code: "a", libelle: "A", mots_cles: [`mot${i}`] }],
          version_courante: i,
          motif: `Version ${i}.`,
        }),
      );
    }
    const p1 = attendu(
      200,
      await s.consultantEquipe.get(`/api/dd/listes-exclusion/${id}/versions`),
    );
    expect(p1.elements).toHaveLength(10);
    expect(p1.elements[0].version).toBe(13);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = attendu(
      200,
      await s.consultantEquipe.get(
        `/api/dd/listes-exclusion/${id}/versions?curseur=${p1.curseur_suivant}`,
      ),
    );
    expect(p2.elements.map((e: any) => e.version)).toEqual([3, 2, 1]);
    expect(p2.curseur_suivant).toBeNull();
    expect(
      (await s.consultantEquipe.get(`/api/dd/listes-exclusion/${id}/versions?limite=21`))
        .statusCode,
    ).toBe(400);
    // Plafonds du schéma : 100 règles par liste, 10 mots-clés de 60 caractères par règle.
    const regleMax = (i: number, mots = 10, longueur = 60) => ({
      code: `r${i}`,
      libelle: "Règle",
      mots_cles: Array.from({ length: mots }, (_, j) => `${i}x${j}`.padEnd(longueur, "m")),
    });
    const liste = (regles: unknown[], nom: string) =>
      s.expertMetier.post("/api/dd/listes-exclusion", { nom, regles });
    attendu(
      201,
      await liste(
        Array.from({ length: 100 }, (_, i) => regleMax(i)),
        "Au plafond",
      ),
    );
    expect(
      (
        await liste(
          Array.from({ length: 101 }, (_, i) => regleMax(i)),
          "101 règles",
        )
      ).statusCode,
    ).toBe(400);
    expect((await liste([regleMax(0, 11)], "11 mots-clés")).statusCode).toBe(400);
    expect((await liste([regleMax(0, 10, 61)], "Mot de 61 caractères")).statusCode).toBe(400);
    // Garde-fou de la base, au-delà des plafonds du schéma (insertion directe).
    const grosses = Array.from({ length: 200 }, (_, i) => ({
      code: `r${i}`,
      libelle: "Règle",
      mots_cles: Array.from({ length: 20 }, (_, j) => `${"m".repeat(70)}${i}x${j}`),
    }));
    const r = await s.expertMetier.post("/api/dd/listes-exclusion", {
      nom: "Énorme",
      regles: grosses,
    });
    expect(r.statusCode).toBe(400);
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO dd_exclusion_liste_versions (cabinet_id, liste_id, version, regles, cree_par)
                 SELECT cabinet_id, id, 1, $2::jsonb, cree_par FROM dd_exclusion_listes WHERE id = $1`,
          [id, JSON.stringify(grosses)],
        ),
      ),
    ).rejects.toBeTruthy();
  });
});

describe("mineurs", () => {
  it("4 : 404 au même libellé pour un identifiant inexistant et pour une mission invisible", async () => {
    const { dossierId, hypotheseId } = await dossierPret(s);
    const n = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
        titre: "N",
        recommandation: "favorable",
        synthese: "x",
        conditions: [],
      }),
    );
    const messages = async (par: Api, vrai: string, faux: string) => {
      const a = await par.get(vrai);
      const b = await par.get(faux);
      expect(a.statusCode).toBe(404);
      expect(b.statusCode).toBe(404);
      return [a.json().erreur.message, b.json().erreur.message];
    };
    for (const [vrai, faux] of [
      [`/api/dd/dossiers/${dossierId}`, `/api/dd/dossiers/${INCONNU}`],
      [`/api/dd/notes/${n.id}`, `/api/dd/notes/${INCONNU}`],
      [`/api/dd/hypotheses/${hypotheseId}/verdicts`, `/api/dd/hypotheses/${INCONNU}/verdicts`],
    ] as const) {
      const [invisible, inexistant] = await messages(s.consultantHors, vrai, faux);
      expect(invisible, vrai).toBe(inexistant);
    }
    const v = await s.consultantHors.post(`/api/dd/verdicts/${INCONNU}/validation`, {
      decision: "valide",
    });
    expect(v.statusCode).toBe(403);
  });

  it("5 : un curseur de plus de 18 chiffres répond 400, jamais 500", async () => {
    const curseur = Buffer.from(JSON.stringify(["9999999999999999999", INCONNU]), "utf8").toString(
      "base64url",
    );
    for (const chemin of ["/api/dd/signaux", "/api/dd/listes-exclusion"]) {
      expect((await s.consultantEquipe.get(`${chemin}?curseur=${curseur}`)).statusCode).toBe(400);
    }
  });

  it("7 : l'auteur de N'IMPORTE QUELLE version d'une assertion citée ne valide pas le verdict", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const h = await creerHypotheseDd(s.consultantEquipe, d);
    const a = await assertionHypotheseDd(s.consultantEquipe, h.id, { enonce: "Source initiale." });
    const corps = (enonce: string) => ({
      enonce,
      classe_risque: "R2",
      statut: "retenue",
      rattachement_type: "hypothese",
      rattachement_code: h.id,
      livrable: "Note au comité — due diligence",
      motif: "Reformulation.",
    });
    attendu(
      201,
      await s.a.chef.post(`/api/assertions/${a.assertion_id}/versions`, corps("Version du chef.")),
    );
    attendu(
      201,
      await s.consultantEquipe.post(
        `/api/assertions/${a.assertion_id}/versions`,
        corps("Version du consultant."),
      ),
    );
    await sourcer(s.consultantEquipe, m, a.assertion_id, "solide");
    const b = await assertionHypotheseDd(s.consultantEquipe, h.id, { enonce: "Seconde source." });
    await sourcer(s.consultantEquipe, m, b.assertion_id, "solide");
    const v = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/hypotheses/${h.id}/verdicts`, {
        hypothese_version: 1,
        verdict: "confirmee",
        motif: "Sources solides et concordantes.",
        assertions_citees: [a.assertion_id, b.assertion_id],
      }),
    );
    const r = await s.a.chef.post(`/api/dd/verdicts/${v.id}/validation`, { decision: "valide" });
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    await expect(
      inserer("dd_verdict_validations", {
        cabinet_id: s.a.cabinetId,
        verdict_id: v.id,
        decision: "valide",
        valide_par: s.a.chef.utilisateurId,
      }),
    ).rejects.toMatchObject({ code: "MPZ25" });
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/verdicts/${v.id}/validation`, { decision: "valide" }),
    );
  });

  it("10 : une dimension désactivée par l'équipe n'est pas réactivée par un nouveau dossier", async () => {
    const m = await missionDd(s);
    await creerDossierDd(s.consultantEquipe, m);
    const dims = attendu(
      200,
      await s.consultantEquipe.get(`/api/missions/${m}/preuves/dimensions`),
    ).elements;
    const swot = dims.find((x: any) => x.code === "dd.swot.menaces");
    attendu(
      200,
      await s.a.chef.patch(`/api/missions/${m}/preuves/dimensions/${swot.id}`, { actif: false }),
    );
    const d2 = (await creerDossierDd(s.consultantEquipe, m)).id;
    const apres = attendu(
      200,
      await s.consultantEquipe.get(`/api/missions/${m}/preuves/dimensions`),
    ).elements;
    expect(apres.find((x: any) => x.code === "dd.swot.menaces").actif).toBe(false);
    const r = await s.consultantEquipe.post(`/api/dd/dossiers/${d2}/points`, {
      analyse: "swot",
      categorie: "menaces",
      enonce: "Une menace.",
      classe_risque: "R2",
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("DIMENSION_INCONNUE");
  });

  it("9 et 11 : libellés du rapport sans risque ; « Note au comité » dans la recherche transverse", async () => {
    const { dossierId, missionId } = await dossierPret(s);
    const n = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
        titre: "Note",
        recommandation: "favorable",
        synthese: "Dossier solide.",
        conditions: [],
      }),
    );
    const v = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 }),
    ).version;
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/notes/${n.id}/validation`, {
        version: v,
        decision: "valide",
      }),
    );
    const r = attendu(
      201,
      await s.consultantEquipe.post(
        `/api/dd/notes/${n.id}/rapports?format=docx&variante=executive`,
      ),
    );
    const fichier = await s.consultantEquipe.get(`/api/fichiers/${r.fichier.id}`);
    const xml = toutLeXml(dezipper(fichier.rawPayload));
    expect(xml).toMatch(/Aucun risque élevé ou critique n.{1,7}a été saisi dans le dossier/);
    expect(xml).toContain("Aucun filtrage environnemental et social");
    expect(xml).not.toContain("Aucun risque élevé ou critique.");
    const recherche = await s.a.chef.get("/api/capitalisation/recherche?q=rapport&types=rapport");
    expect(recherche.statusCode).toBe(200);
    expect(recherche.body).toContain("Note au comité");
    expect(recherche.body).not.toContain("Rapport de plan stratégique");
    expect(missionId).toBeTruthy();
  });
});
