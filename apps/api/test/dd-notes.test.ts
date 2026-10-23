import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  attendu,
  cloturerMission,
  creerDossierDd,
  creerPointDd,
  dossierPret,
  INCONNU,
  missionDd,
  preparerDd,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerMissionSignee } from "./missions-outils.js";

/*
 * Notes au comité (DD-13, R46 à R51) : bloquants (NOTE_BLOQUEE, details.manquants), soumission à
 * base figée, validation par un tiers (API et base : MPZ26 ; associé admis), NOTE_PERIMEE, rejet,
 * plafonds, mission clôturée, aucune donnée FIN-02 dans la base figée.
 */

let ctx: Contexte;
let s: ScenarioDd;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD notes");
}, 240_000);
afterAll(() => ctx.fermer());

const CONTENU = { recommandation: "favorable", synthese: "Le dossier est solide.", conditions: [] };
const creerNote = (d: string, par: Api = s.consultantEquipe, extra: Record<string, unknown> = {}) =>
  par.post(`/api/dd/dossiers/${d}/notes`, { titre: "Note au comité", ...CONTENU, ...extra });
const soumettre = (n: string, version: number, par: Api = s.consultantEquipe) =>
  par.post(`/api/dd/notes/${n}/soumission`, { version });
const valider = (n: string, version: number, par: Api, extra: Record<string, unknown> = {}) =>
  par.post(`/api/dd/notes/${n}/validation`, { version, decision: "valide", ...extra });

describe("R46, R47 : liste et création", () => {
  it("401, 403, 404 ; création en brouillon (version 1) ; liste avec l'état dérivé", async () => {
    const { dossierId } = await dossierPret(s);
    const url = `/api/dd/dossiers/${dossierId}/notes`;
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect((await s.expertMetier.post(url, { titre: "x", ...CONTENU })).statusCode).toBe(403);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.consultantHors.post(url, { titre: "x", ...CONTENU })).statusCode).toBe(404);
    const n = attendu(201, await creerNote(dossierId));
    expect(n.version).toBe(1);
    const l = attendu(200, await s.expertMetier.get(url));
    expect(l.elements).toEqual([
      expect.objectContaining({
        id: n.id,
        titre: "Note au comité",
        derniere_version: 1,
        etat: "brouillon",
        validee_version: null,
      }),
    ]);
    expect(
      (await creerNote(dossierId, s.consultantEquipe, { recommandation: "excellente" })).statusCode,
    ).toBe(400);
    expect(
      (
        await creerNote(dossierId, s.consultantEquipe, {
          conditions: Array.from({ length: 21 }, (_, i) => `c${i}`),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("409 PLAFOND_ATTEINT à la onzième note d'un dossier", async () => {
    const { dossierId } = await dossierPret(s);
    for (let i = 0; i < 10; i += 1) attendu(201, await creerNote(dossierId));
    const r = await creerNote(dossierId);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });
});

describe("R50 : soumission et contrôles bloquants", () => {
  it("NOTE_BLOQUEE sans hypothèse (details.manquants) ; rien n'est inséré", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const n = attendu(201, await creerNote(d));
    const r = await soumettre(n.id, 1);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("NOTE_BLOQUEE");
    expect(r.json().erreur.details.manquants).toEqual(["SANS_HYPOTHESE"]);
    const detail = attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}`));
    expect(detail.versions).toHaveLength(1);
    expect(detail.controle).toMatchObject({ soumissible: false, fige: false });
  });

  it("hypothèse sans verdict validé, conditions manquantes, sources manquantes, exclusion non levée", async () => {
    const m = await missionDd(s);
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    await s.consultantEquipe.post(`/api/dd/dossiers/${d}/hypotheses`, { libelle: "Sans verdict" });
    await creerPointDd(s.consultantEquipe, d, { enonce: "Une affirmation sans aucune source." });
    const n = attendu(
      201,
      await creerNote(d, s.consultantEquipe, { recommandation: "favorable_sous_conditions" }),
    );
    const r = await soumettre(n.id, 1);
    expect(r.json().erreur.details.manquants).toEqual([
      "HYPOTHESE_SANS_VERDICT_VALIDE",
      "SOURCES_MANQUANTES",
      "CONDITIONS_MANQUANTES",
    ]);
    const liste = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: `Liste ${m}`,
        regles: [{ code: "casino", libelle: "Jeux", mots_cles: ["casino"] }],
      }),
    );
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${d}/filtrages`, {
        liste_id: liste.id,
        declarations: { activites: ["Casino"] },
      }),
    );
    const detail = attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}`));
    expect(detail.controle.bloquants).toContain("EXCLUSION_NON_LEVEE_FAVORABLE");
  });

  it("soumission nominale : base figée par les moteurs, version suivante « soumise », brouillon périmé ensuite", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(201, await creerNote(dossierId));
    const v = attendu(201, await soumettre(n.id, 1));
    expect(v.version).toBe(2);
    const detail = attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}?version=2`));
    expect(detail.contenu).toMatchObject({ etat: "soumise", recommandation: "favorable" });
    expect(detail.controle).toMatchObject({ soumissible: true, fige: true, bloquants: [] });
    const base = detail.base_figee;
    expect(base.version_base).toBe(1);
    expect(base.hypotheses).toHaveLength(1);
    expect(base.hypotheses[0]).toMatchObject({
      verdict: "confirmee",
      indication_moteur: "confirmee",
      nb_citees: 2,
      solidite_min: "solide",
    });
    expect(base.exclusions_bloquantes).toBe(0);
    // Aucun filtrage E&S sur ce dossier : ni liste, ni filtrage antérieur, ni exclusion antérieure.
    expect(base.filtrage_es).toMatchObject({
      realise: false,
      liste: null,
      filtrages_anterieurs: 0,
      exclusions_anterieures_non_levees: 0,
      touches: [],
    });
    expect(base.cadrage).toMatchObject({
      secteur_libelle: expect.stringMatching(/Agriculture/),
      pays_libelle: expect.stringMatching(/Ivoire/),
    });
    // La base ne sort qu'avec ?version=n d'une version soumise.
    const sans = attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}`));
    expect(sans.base_figee).toBeUndefined();
    const cles = (x: unknown, acc: string[] = []): string[] => {
      if (Array.isArray(x)) x.forEach((y) => cles(y, acc));
      else if (x && typeof x === "object")
        for (const [k, y] of Object.entries(x)) {
          acc.push(k);
          cles(y, acc);
        }
      return acc;
    };
    expect(
      cles(base).filter((k) =>
        /cout_jour|taux_horaire|honoraire|marge_mission|cout_ia|finance/i.test(k),
      ),
    ).toEqual([]);
    const perimee = await soumettre(n.id, 1);
    expect(perimee.statusCode).toBe(409);
    expect(perimee.json().erreur.code).toBe("VERSION_PERIMEE");
    expect((await soumettre(n.id, 2)).json().erreur.code).toBe("VERSION_PERIMEE");
    expect(
      (await s.expertMetier.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 })).statusCode,
    ).toBe(403);
    expect(
      (await s.b.associe.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 })).statusCode,
    ).toBe(404);
  });

  it("base figée : liste du dernier filtrage, filtrages antérieurs et exclusion antérieure non levée", async () => {
    const { dossierId } = await dossierPret(s);
    const liste = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: `Liste figée ${dossierId}`,
        regles: [{ code: "casino", libelle: "Jeux d'argent", mots_cles: ["casino"] }],
      }),
    );
    const filtrer = (activites: string[]) =>
      s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/filtrages`, {
        liste_id: liste.id,
        declarations: { activites },
      });
    const f1 = attendu(201, await filtrer(["Casino"])).id;
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/filtrages/${f1}/decisions`, {
        regle_code: "casino",
        decision: "confirmee",
        motif: "Exclusion confirmée par l'expert.",
      }),
    );
    attendu(201, await filtrer(["Culture de cacao"]));
    // Une exclusion confirmée et non levée interdit un avis favorable, pas un avis défavorable.
    const n = attendu(
      201,
      await creerNote(dossierId, s.consultantEquipe, { recommandation: "defavorable" }),
    );
    attendu(201, await soumettre(n.id, 1));
    const base = attendu(
      200,
      await s.expertMetier.get(`/api/dd/notes/${n.id}?version=2`),
    ).base_figee;
    expect(base.exclusions_bloquantes).toBe(1);
    expect(base.filtrage_es).toMatchObject({
      realise: true,
      liste: { nom: `Liste figée ${dossierId}`, version: 1 },
      filtrages_anterieurs: 1,
      exclusions_anterieures_non_levees: 1,
      bloquant: true,
      touches: [],
    });
  });

  it("R49 : nouveau brouillon (dernière version lue exigée) puis soumission", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(201, await creerNote(dossierId));
    const url = `/api/dd/notes/${n.id}/versions`;
    const corps = {
      ...CONTENU,
      recommandation: "favorable_sous_conditions",
      conditions: ["Obtenir la licence."],
      version_courante: 1,
      motif: "Conditions ajoutées.",
    };
    expect(attendu(201, await s.consultantEquipe.post(url, corps)).version).toBe(2);
    expect((await s.consultantEquipe.post(url, corps)).json().erreur.code).toBe("VERSION_PERIMEE");
    expect((await s.expertMetier.post(url, { ...corps, version_courante: 2 })).statusCode).toBe(
      403,
    );
    expect(
      (await s.consultantEquipe.post(url, { ...corps, version_courante: 2, motif: undefined }))
        .statusCode,
    ).toBe(400);
    expect(attendu(201, await soumettre(n.id, 2)).version).toBe(3);
    const l = attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}?version=3`));
    expect(l.contenu.conditions).toEqual(["Obtenir la licence."]);
  });
});

describe("R51 : validation par un tiers", () => {
  it("un tiers valide (201) ; décidée une fois (NOTE_DEJA_DECIDEE) ; état « validée »", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(201, await creerNote(dossierId));
    const v = attendu(201, await soumettre(n.id, 1)).version;
    attendu(201, await valider(n.id, v, s.expertMetier));
    const deux = await valider(n.id, v, s.a.chef);
    expect(deux.statusCode).toBe(409);
    expect(deux.json().erreur.code).toBe("NOTE_DEJA_DECIDEE");
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${dossierId}/notes`));
    expect(l.elements[0]).toMatchObject({ etat: "validee", validee_version: v });
    // R-03 : la synthèse du dossier suit la décision (la version reste « soumise » en base).
    const synthese = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${dossierId}/synthese`),
    );
    expect(synthese.note).toMatchObject({ id: n.id, derniere_version: v, etat: "validee" });
    expect(
      attendu(200, await s.expertMetier.get(`/api/dd/notes/${n.id}`)).validations,
    ).toHaveLength(1);
  });

  it("séparation des tâches : créateur et auteur d'une version refusés (403, API puis base) ; associé admis", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(201, await creerNote(dossierId, s.a.chef));
    const v = attendu(201, await soumettre(n.id, 1, s.a.chef)).version;
    const r = await valider(n.id, v, s.a.chef);
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    // Auteur d'un brouillon intermédiaire : consultant crée, le directeur ajoute une version, le chef soumet.
    const m = attendu(201, await creerNote(dossierId, s.consultantEquipe));
    attendu(
      201,
      await s.a.directeur.post(`/api/dd/notes/${m.id}/versions`, {
        ...CONTENU,
        version_courante: 1,
        motif: "Relecture.",
      }),
    );
    const w = attendu(201, await soumettre(m.id, 2, s.consultantEquipe)).version;
    expect((await valider(m.id, w, s.a.directeur)).json().erreur.code).toBe(
      "SEPARATION_DES_TACHES",
    );
    attendu(201, await valider(m.id, w, s.a.chef));
    const a = attendu(201, await creerNote(dossierId, s.a.associe));
    const va = attendu(201, await soumettre(a.id, 1, s.a.associe)).version;
    attendu(201, await valider(a.id, va, s.a.associe));
    // Le consultant n'a pas dd.valider : 403 de permission.
    const b = attendu(201, await creerNote(dossierId, s.consultantEquipe));
    const vb = attendu(201, await soumettre(b.id, 1)).version;
    expect((await valider(b.id, vb, s.consultantEquipe)).statusCode).toBe(403);
  });

  it("NOTE_PERIMEE : seule la dernière version soumise se valide", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(201, await creerNote(dossierId));
    const v2 = attendu(201, await soumettre(n.id, 1)).version;
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${n.id}/versions`, {
        ...CONTENU,
        version_courante: v2,
        motif: "Nouvelle rédaction.",
      }),
    );
    const v4 = attendu(201, await soumettre(n.id, 3)).version;
    const r = await valider(n.id, v2, s.expertMetier);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("NOTE_PERIMEE");
    expect((await valider(n.id, 3, s.expertMetier)).json().erreur.code).toBe("NOTE_PERIMEE");
    expect((await valider(n.id, 99, s.expertMetier)).json().erreur.code).toBe("NOTE_PERIMEE");
    attendu(201, await valider(n.id, v4, s.expertMetier));
  });

  it("rejet : motif obligatoire ; état « rejetée » ; 404 et 401", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(201, await creerNote(dossierId));
    const v = attendu(201, await soumettre(n.id, 1)).version;
    expect(
      (
        await s.expertMetier.post(`/api/dd/notes/${n.id}/validation`, {
          version: v,
          decision: "rejete",
        })
      ).statusCode,
    ).toBe(400);
    attendu(
      201,
      await valider(n.id, v, s.expertMetier, {
        decision: "rejete",
        motif: "La recommandation doit être revue.",
      }),
    );
    expect(
      attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${dossierId}/notes`)).elements[0]
        .etat,
    ).toBe("rejetee");
    expect(
      attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${dossierId}/synthese`)).note.etat,
    ).toBe("rejetee");
    expect((await valider(INCONNU, v, s.expertMetier)).statusCode).toBe(404);
    expect((await valider(n.id, v, s.b.associe)).statusCode).toBe(404);
    expect(
      (await api(ctx).post(`/api/dd/notes/${n.id}/validation`, { version: v, decision: "valide" }))
        .statusCode,
    ).toBe(401);
  });
});

describe("garde en base (MPZ29) et mission clôturée", () => {
  it("une version soumise incohérente est refusée par la base ; l'API ne l'insère jamais", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(201, await creerNote(dossierId));
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO dd_note_versions (cabinet_id, note_id, version, etat, recommandation, synthese, base_figee, soumise_le, motif, cree_par)
           VALUES ($1, $2, 2, 'soumise', 'favorable', 'x', '{"bloquants":["SANS_HYPOTHESE"],"exclusions_bloquantes":0}', now(), 'Soumission.', $3)`,
          [s.a.cabinetId, n.id, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPZ29" });
  });

  it("mission clôturée : écritures 409 MISSION_CLOTUREE, lecture ouverte", async () => {
    const m = (await creerMissionSignee(s.a)).id;
    for (const u of [s.consultantEquipe, s.expertMetier]) {
      await s.a.chef.post(`/api/missions/${m}/equipe`, { utilisateur_id: u.utilisateurId });
    }
    const d = (await creerDossierDd(s.consultantEquipe, m)).id;
    const n = attendu(201, await creerNote(d));
    await cloturerMission(s, m);
    const r = await creerNote(d);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("MISSION_CLOTUREE");
    expect((await soumettre(n.id, 1)).json().erreur.code).toBe("MISSION_CLOTUREE");
    expect((await s.consultantEquipe.get(`/api/dd/notes/${n.id}`)).statusCode).toBe(200);
  });
});
