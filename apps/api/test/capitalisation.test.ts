import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vueCelluleGroupe } from "../src/capitalisation/competences.js";
import { decoderCurseurHorodate } from "../src/capitalisation/retours.js";
import { api } from "./api.js";
import {
  attendu,
  cloturer,
  missionCap,
  preparerCap,
  temps,
  type MissionCap,
  type ScenarioCap,
} from "./capitalisation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import type { ApiUtilisateur } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";

/*
 * Capitalisation (PRD complémentaire §12) : retour d'expérience à la clôture (CAP-01), base
 * d'estimation par brique et par contexte (CAP-02), analyse des dérogations vers le comité
 * méthode (CAP-05), matrice de compétences (CAP-06), recherche unifiée dans les droits (CAP-07).
 */

let ctx: Contexte;
let a: ScenarioCap;
let b: ScenarioCap;
let m1: MissionCap;
let m2: MissionCap;
let m3: MissionCap;
let m4: MissionCap;
let externe: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let horsEquipe: ApiUtilisateur;
/** Expert métier ajouté à l'équipe de m1 et m4 : lit sans budget.lire_jours (a.expert reste hors équipe). */
let expertEquipe: ApiUtilisateur;
let retour1: string;
let competenceId: string;
let collabConsultant: string;
let collabRessources: string;
let cleGroupe: string;

const ENTRETIENS = "entretiens_individuels";
const COLLECTE = "collecte_documents";

async function codeErreurBase(cabinetId: string, sql: string, params: unknown[]) {
  try {
    await ctx.db.withTenant(cabinetId, (db) => db.query(sql, params));
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return null;
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCap(ctx, "Capitalisation A");
  b = await preparerCap(ctx, "Capitalisation B");
  externe = await a.avecRoles(["expert_externe"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  horsEquipe = await a.avecRoles(["consultant"]);
  expertEquipe = await a.avecRoles(["expert_metier"]);
  collabConsultant = a.collaborateurs.senior as string;
  collabRessources = a.collaborateurs.manager as string;
  await proprietaire(async (cl) => {
    await cl.query(`UPDATE collaborateurs SET utilisateur_id = $2 WHERE id = $1`, [
      collabConsultant,
      a.consultant.utilisateurId,
    ]);
    await cl.query(`UPDATE collaborateurs SET utilisateur_id = $2 WHERE id = $1`, [
      collabRessources,
      a.ressources.utilisateurId,
    ]);
  });
  m1 = await missionCap(a, "Notation stratégique de la société Kora");
  m2 = await missionCap(a, "Notation stratégique Baobab");
  m3 = await missionCap(a, "Notation stratégique Karité");
  m4 = await missionCap(a, "Mission en cours Fromager");
}, 240_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("rattachement des tâches aux briques (CAP-02)", () => {
  it("401, 403, 404 d'un autre cabinet, brique inconnue 400", async () => {
    const url = `/api/capitalisation/missions/${m1.id}/taches/${m1.taches[0]}/brique`;
    expect((await api(ctx).put(url, { brique_code: ENTRETIENS })).statusCode).toBe(401);
    expect((await a.consultant.put(url, { brique_code: ENTRETIENS })).statusCode).toBe(403);
    expect((await b.associe.put(url, { brique_code: ENTRETIENS })).statusCode).toBe(404);
    expect(attendu(400, await a.chef.put(url, { brique_code: "brique_absente" })).erreur.code).toBe(
      "BRIQUE_INCONNUE",
    );
    expect((await a.chef.put(url, { brique_code: "Pas Un Code" })).statusCode).toBe(400);
  });

  it("le chef rattache et détache ; la liste montre les briques de la méthode", async () => {
    for (const m of [m1, m2, m3, m4]) {
      for (const [i, code] of [ENTRETIENS, COLLECTE].entries()) {
        attendu(
          200,
          await a.chef.put(`/api/capitalisation/missions/${m.id}/taches/${m.taches[i]}/brique`, {
            brique_code: code,
          }),
        );
      }
    }
    const l = attendu(200, await a.consultant.get(`/api/capitalisation/missions/${m1.id}/briques`));
    expect(
      l.taches
        .map((t: { brique_code: string | null }) => t.brique_code)
        .filter((c: string | null) => c !== null),
    ).toEqual([ENTRETIENS, COLLECTE]);
    expect(l.briques.some((x: { code: string }) => x.code === ENTRETIENS)).toBe(true);
    const url = `/api/capitalisation/missions/${m4.id}/taches/${m4.taches[1]}/brique`;
    const d = attendu(200, await a.chef.put(url, { brique_code: null }));
    expect(
      d.taches.find((t: { tache_id: string }) => t.tache_id === m4.taches[1]).brique_code,
    ).toBeNull();
    expect((await b.associe.get(`/api/capitalisation/missions/${m1.id}/briques`)).statusCode).toBe(
      404,
    );
  });
});

describe("référentiel de compétences (CAP-06)", () => {
  it("création réservée à competence.gerer, code unique", async () => {
    const corps = {
      code: "conduite_entretiens",
      libelle: "Conduite d'entretiens",
      briques: [ENTRETIENS],
      types_livrable: ["rapport"],
    };
    expect((await api(ctx).post("/api/capitalisation/competences", corps)).statusCode).toBe(401);
    expect((await a.consultant.post("/api/capitalisation/competences", corps)).statusCode).toBe(
      403,
    );
    competenceId = attendu(
      201,
      await a.ressources.post("/api/capitalisation/competences", corps),
    ).id;
    expect(
      attendu(409, await a.ressources.post("/api/capitalisation/competences", corps)).erreur.code,
    ).toBe("COMPETENCE_EXISTANTE");
    const liste = attendu(200, await a.consultant.get("/api/capitalisation/competences"));
    expect(liste.elements).toHaveLength(1);
    expect(attendu(200, await b.associe.get("/api/capitalisation/competences")).elements).toEqual(
      [],
    );
    expect(
      (await b.associe.patch(`/api/capitalisation/competences/${competenceId}`, { active: false }))
        .statusCode,
    ).toBe(404);
  });
});

describe("dérogations et temps des missions (préparation)", () => {
  it("temps validés et dérogations demandées sur trois missions", async () => {
    await temps(a, m1.id, collabConsultant, "2026-11-02", [
      { tacheId: m1.taches[0], jours: 3 },
      { tacheId: m1.taches[1], jours: 0.5 },
    ]);
    await temps(a, m2.id, collabConsultant, "2026-11-09", [{ tacheId: m2.taches[0], jours: 2 }]);
    await temps(a, m3.id, collabConsultant, "2026-11-16", [{ tacheId: m3.taches[0], jours: 2.5 }]);
    const motifs = [
      "Petite entreprise : atelier unique au lieu des entretiens individuels",
      "Atelier unique au lieu des entretiens individuels, petite entreprise",
      "Petite entreprise, entretiens individuels remplacés par un atelier unique",
    ];
    await proprietaire(async (cl) => {
      for (const [i, m] of [m1, m2, m3].entries()) {
        await cl.query(
          `INSERT INTO derogations (cabinet_id, mission_id, mission_methode_id, brique_code, nature,
             motif, classe_risque, demandeur_id)
           SELECT $1, $2, mm.id, $3, 'retirer_brique', $4, 'R1', $5 FROM mission_methodes mm
           WHERE mm.mission_id = $2 AND mm.rang = 1`,
          [a.cabinetId, m.id, ENTRETIENS, motifs[i], a.chef.utilisateurId],
        );
      }
    });
  });
});

describe("retour d'expérience (CAP-01)", () => {
  it("ne s'ouvre qu'à la clôture ; droits d'ouverture", async () => {
    const url = `/api/capitalisation/missions/${m1.id}/retour`;
    expect(attendu(409, await a.chef.post(url)).erreur.code).toBe("MISSION_NON_CLOTUREE");
    await cloturer(a, m1.id);
    expect((await api(ctx).post(url)).statusCode).toBe(401);
    expect((await a.consultant.post(url)).statusCode).toBe(403);
    expect((await b.associe.post(url)).statusCode).toBe(404);
    // Un directeur de mission qui n'en est ni chef ni directeur : 403.
    const autreDirecteur = await a.avecRoles(["directeur_mission"]);
    expect((await autreDirecteur.post(url)).statusCode).toBe(403);
  });

  it("brouillon déterministe depuis les données ; ouverture idempotente", async () => {
    const url = `/api/capitalisation/missions/${m1.id}/retour`;
    const r = attendu(201, await a.chef.post(url));
    retour1 = r.id;
    expect(r.statut).toBe("brouillon");
    expect(r.version_courante).toMatchObject({
      version: 1,
      origine: "gabarit",
      statut_contenu: "brouillon_ia",
    });
    // Le type « plan stratégique » apporte son découpage : le budget total compte toutes les tâches.
    expect(r.version_courante.ecarts).toContain("Temps réel validé : 3,5 j pour un budget de ");
    expect(r.version_courante.ecarts).toMatch(/Tâches rattachées à une brique : 2 sur \d+\./);
    expect(r.version_courante.ecarts).toContain(
      "entretiens_individuels : réel 3 j, référence 2 j (budget), écart +50 %",
    );
    expect(r.version_courante.ecarts).toContain(
      "collecte_documents : réel 0,5 j, référence 1 j (budget), écart −50 %",
    );
    expect(r.version_courante.lecons).toContain("« entretiens_individuels » a dépassé");
    expect(r.version_courante.methode).toContain("Méthode « Notation d'entreprise »");
    expect(r.version_courante.methode).toContain("atelier unique");
    expect(r.version_courante.lecons).toContain("À compléter par le chef de mission");
    expect(attendu(201, await a.chef.post(url)).id).toBe(retour1);
  });

  it("lecture : connaissance.lire et mission visible", async () => {
    const url = `/api/capitalisation/retours/${retour1}`;
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect(attendu(200, await a.consultant.get(url)).mission.intitule).toContain("Kora");
    expect((await horsEquipe.get(url)).statusCode).toBe(404);
    expect((await b.associe.get(url)).statusCode).toBe(404);
    expect((await gestionnaire.get(url)).statusCode).toBe(403);
    const parMission = attendu(
      200,
      await a.consultant.get(`/api/capitalisation/missions/${m1.id}/retour`),
    );
    expect(parMission.retour.id).toBe(retour1);
    expect(
      attendu(200, await a.consultant.get(`/api/capitalisation/missions/${m2.id}/retour`)).retour,
    ).toBeNull();
  });

  it("le chef rédige une version ; l'option IA ajoute une version (repli sur gabarit sans clé)", async () => {
    const corps = {
      contexte: "Mission de notation pour une PME familiale.",
      methode: "Méthode standard avec un atelier unique au lieu des entretiens.",
      ecarts: "Les entretiens ont dépassé leur budget d'une journée.",
      lecons: "Prévoir un atelier unique pour les petites structures dès le cadrage.",
    };
    const url = `/api/capitalisation/retours/${retour1}/versions`;
    expect((await a.consultant.post(url, corps)).statusCode).toBe(403);
    expect((await a.chef.post(url, { ...corps, lecons: "" })).statusCode).toBe(400);
    const v = attendu(201, await a.chef.post(url, corps));
    expect(v.version_courante).toMatchObject({
      version: 2,
      origine: "humain",
      statut_contenu: "modifie",
    });
    const ia = attendu(201, await a.chef.post(`/api/capitalisation/retours/${retour1}/ia`));
    expect(ia.version_courante.version).toBe(3);
    expect(["gabarit", "ia"]).toContain(ia.version_courante.origine);
    expect(ia.historique).toHaveLength(3);
    expect((await a.consultant.post(`/api/capitalisation/retours/${retour1}/ia`)).statusCode).toBe(
      403,
    );
  });

  it("validation par le chef : définitive, versée à la base d'estimation", async () => {
    const url = `/api/capitalisation/retours/${retour1}/valider`;
    expect((await a.consultant.post(url, { version: 2 })).statusCode).toBe(403);
    expect((await a.chef.post(url, { version: 9 })).statusCode).toBe(404);
    const r = attendu(200, await a.chef.post(url, { version: 2 }));
    expect(r).toMatchObject({ statut: "valide", version_validee: 2 });
    expect(r.version_validee_contenu.statut_contenu).toBe("valide");
    expect(attendu(409, await a.chef.post(url, { version: 2 })).erreur.code).toBe("RETOUR_VALIDE");
    expect(
      (
        await a.chef.post(`/api/capitalisation/retours/${retour1}/versions`, {
          contexte: "x",
          methode: "x",
          ecarts: "x",
          lecons: "x",
        })
      ).statusCode,
    ).toBe(409);
    const obs = await proprietaire((cl) =>
      cl.query(
        `SELECT brique_code, realise_centiemes::int AS r, budget_centiemes::int AS b
         FROM cap_temps_briques WHERE mission_id = $1 ORDER BY brique_code`,
        [m1.id],
      ),
    );
    expect(obs.rows).toEqual([
      { brique_code: COLLECTE, r: 50, b: 100 },
      { brique_code: ENTRETIENS, r: 300, b: 200 },
    ]);
  });

  it("sans budget.lire_jours : section « Écarts » et faits chiffrés ABSENTS (expert métier)", async () => {
    // m1 est clôturée (équipe figée par l'API) : l'expert est ajouté par le propriétaire.
    await proprietaire((cl) =>
      cl.query(
        "INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id) VALUES ($1, $2, $3)",
        [a.cabinetId, m1.id, expertEquipe.utilisateurId],
      ),
    );
    const url = `/api/capitalisation/retours/${retour1}`;
    const complet = attendu(200, await a.chef.get(url));
    expect(complet.version_validee_contenu.ecarts).toContain("budget d'une journée");
    expect(typeof complet.version_courante.ecarts).toBe("string");
    expect(complet.version_courante.donnees.temps).toBeDefined();
    for (const vue of [
      attendu(200, await expertEquipe.get(url)),
      attendu(200, await expertEquipe.get(`/api/capitalisation/missions/${m1.id}/retour`)).retour,
    ]) {
      for (const v of [vue.version_courante, vue.version_validee_contenu]) {
        // Champs absents, pas masqués par une chaîne vide ou un zéro.
        expect(Object.keys(v)).not.toContain("ecarts");
        expect(Object.keys(v.donnees)).not.toContain("temps");
        expect(Object.keys(v.donnees)).not.toContain("ecarts");
        expect(v.contexte).toBeTruthy();
        expect(v.lecons).toBeTruthy();
      }
      const texte = JSON.stringify(vue);
      expect(texte).not.toContain("Temps réel validé");
      expect(texte).not.toContain("budget d'une journée");
    }
  });

  it("historique en ajout seul et validation définitive, même hors API (MPJ01, MPJ02)", async () => {
    // Rôle applicatif : UPDATE révoqué ; propriétaire : refusé par le déclencheur (MPJ01).
    expect(
      await codeErreurBase(
        a.cabinetId,
        `UPDATE retour_experience_versions SET lecons = 'x' WHERE retour_id = $1`,
        [retour1],
      ),
    ).toBe("42501");
    const proprio = await proprietaire(async (cl) => {
      try {
        await cl.query(`UPDATE retour_experience_versions SET lecons = 'x' WHERE retour_id = $1`, [
          retour1,
        ]);
        return null;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(proprio).toBe("MPJ01");
    expect(
      await codeErreurBase(
        a.cabinetId,
        `UPDATE retours_experience SET statut = 'brouillon', version_validee = NULL,
         valide_par = NULL, valide_le = NULL WHERE id = $1`,
        [retour1],
      ),
    ).toBe("MPJ02");
    expect(
      await codeErreurBase(a.cabinetId, `DELETE FROM cap_temps_briques WHERE mission_id = $1`, [
        m1.id,
      ]),
    ).not.toBeNull();
  });

  it("références incohérentes refusées en base (MPJ05)", async () => {
    // Décision sur une déclaration inconnue : le déclencheur répond avant la clé étrangère.
    expect(
      await codeErreurBase(
        a.cabinetId,
        `INSERT INTO competence_decisions (cabinet_id, declaration_id, decision, decide_par)
         VALUES ($1, $2, 'validee', $3)`,
        [a.cabinetId, randomUUID(), a.associeId],
      ),
    ).toBe("MPJ05");
    // Observation d'estimation d'une mission dont le retour n'est pas validé.
    expect(
      await codeErreurBase(
        a.cabinetId,
        `INSERT INTO cap_temps_briques (cabinet_id, mission_id, retour_id, brique_code,
           realise_centiemes, budget_centiemes) VALUES ($1, $2, $3, 'x_brique', 100, 100)`,
        [a.cabinetId, m4.id, retour1],
      ),
    ).toBe("MPJ05");
  });

  it("rattachements figés après la clôture (MPJ03, 409)", async () => {
    const r = await a.chef.put(
      `/api/capitalisation/missions/${m1.id}/taches/${m1.taches[0]}/brique`,
      { brique_code: COLLECTE },
    );
    expect(r.statusCode).toBe(409);
    expect(
      await codeErreurBase(a.cabinetId, `DELETE FROM cap_taches_briques WHERE mission_id = $1`, [
        m1.id,
      ]),
    ).toBe("MPJ03");
  });

  it("deux autres missions clôturées puis validées ; liste de la base de connaissances", async () => {
    for (const m of [m2, m3]) {
      await cloturer(a, m.id, m === m2 ? "a_cloturer" : "cloturee");
      const r = attendu(201, await a.chef.post(`/api/capitalisation/missions/${m.id}/retour`));
      attendu(
        200,
        await a.directeur.post(`/api/capitalisation/retours/${r.id}/valider`, { version: 1 }),
      );
    }
    const l = attendu(200, await a.chef.get("/api/capitalisation/retours?statut=valide"));
    expect(l.elements).toHaveLength(3);
    expect(attendu(200, await horsEquipe.get("/api/capitalisation/retours")).elements).toEqual([]);
    expect(attendu(200, await b.associe.get("/api/capitalisation/retours")).elements).toEqual([]);
  });

  it("liste des retours : curseur d'horodatage invalide 400 (jamais 500) ; curseur valide suivi", async () => {
    const page = attendu(200, await a.consultant.get("/api/capitalisation/retours?limite=1"));
    expect(page.curseur_suivant).not.toBeNull();
    const suite = attendu(
      200,
      await a.consultant.get(
        `/api/capitalisation/retours?limite=1&curseur=${encodeURIComponent(page.curseur_suivant)}`,
      ),
    );
    expect(suite.elements).toHaveLength(1);
    const curseur = (cle: string) =>
      Buffer.from(JSON.stringify([cle, randomUUID()])).toString("base64url");
    for (const mauvais of [
      "pas une date",
      "2026-02-30 10:00:00+00",
      "2026-13-01 10:00:00+00",
      "2026-10-08 25:00:00+00",
      "0001-01-01 00:00:00+00",
      "2026-10-08",
    ]) {
      const r = await a.consultant.get(
        `/api/capitalisation/retours?curseur=${encodeURIComponent(curseur(mauvais))}`,
      );
      expect(r.statusCode, mauvais).toBe(400);
      expect(r.json().erreur.code).toBe("REQUETE_INVALIDE");
    }
    expect(decoderCurseurHorodate(curseur("2026-10-08 10:12:33.123456+00"))?.[0]).toBe(
      "2026-10-08 10:12:33.123456+00",
    );
    expect(decoderCurseurHorodate(undefined)).toBeNull();
  });
});

describe("base d'estimation (CAP-02)", () => {
  const url = "/api/capitalisation/estimation";

  it("médiane et quartiles par brique, repli hors contexte, rien sous l'effectif minimum", async () => {
    expect((await api(ctx).post(url, { briques: [ENTRETIENS] })).statusCode).toBe(401);
    expect((await externe.post(url, { briques: [ENTRETIENS] })).statusCode).toBe(403);
    expect((await gestionnaire.post(url, { briques: [ENTRETIENS] })).statusCode).toBe(403);
    expect((await a.consultant.post(url, { briques: [] })).statusCode).toBe(400);
    // Durées réelles en jours : budget.lire_jours exigé en plus (l'expert métier ne l'a pas).
    expect((await a.expert.post(url, { briques: [ENTRETIENS] })).statusCode).toBe(403);
    // Plancher de l'effectif minimum côté serveur : 3 au moins.
    for (const n of [0, 1, 2]) {
      expect(
        (await a.consultant.post(url, { briques: [ENTRETIENS], effectif_minimum: n })).statusCode,
      ).toBe(400);
    }
    const r = attendu(200, await a.consultant.post(url, { briques: [ENTRETIENS] }));
    expect(r.effectif_minimum).toBe(3);
    expect(r.elements[0]).toMatchObject({
      brique_code: ENTRETIENS,
      niveau: "brique",
      effectif_brique: 3,
      libelles: { mediane: "2,5 j", q1: null, q3: null },
    });
    // Trois missions : médiane seule ; ni quartiles ni min ni max (durées individuelles).
    expect(r.elements[0].resume).toEqual({
      effectif: 3,
      mediane: 250,
      q1: null,
      q3: null,
      min: null,
      max: null,
      atypiques: null,
    });
    const c = attendu(
      200,
      await a.consultant.post(url, { briques: [ENTRETIENS], contexte: { effectif: 12 } }),
    );
    expect(c.elements[0]).toMatchObject({
      niveau: "brique",
      effectif_contexte: null,
      facteurs_appliques: [],
    });
    const quatre = attendu(
      200,
      await a.consultant.post(url, { briques: [ENTRETIENS], effectif_minimum: 4 }),
    );
    // Sous le seuil : aucune statistique ET aucun effectif (jamais « 3 missions sur 4 »).
    expect(quatre.elements[0]).toMatchObject({
      niveau: "insuffisant",
      effectif_contexte: null,
      effectif_brique: null,
      resume: null,
      libelles: null,
    });
    const autre = attendu(200, await b.associe.post(url, { briques: [ENTRETIENS] }));
    expect(autre.elements[0]).toMatchObject({
      niveau: "insuffisant",
      effectif_brique: null,
      resume: null,
    });
    const briques = attendu(200, await a.consultant.get(`${url}/briques`));
    expect(briques.elements).toContainEqual({ brique_code: ENTRETIENS, missions: 3 });
  });
});

describe("matrice de compétences (CAP-06)", () => {
  it("preuves d'usage relevées sans niveau ; lecture réservée", async () => {
    const url = "/api/capitalisation/competences/matrice";
    expect((await a.consultant.get(url)).statusCode).toBe(403);
    // Matrice de TOUS : competence.lire (associé, directeur, ressources), pas collaborateurs.lire.
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect((await a.chef.get(url)).statusCode).toBe(403);
    expect((await gestionnaire.get(url)).statusCode).toBe(403);
    expect((await a.expert.get(url)).statusCode).toBe(403);
    expect((await externe.get(url)).statusCode).toBe(403);
    expect((await a.directeur.get(url)).statusCode).toBe(200);
    expect((await a.associe.get(url)).statusCode).toBe(200);
    // Ses propres compétences restent lisibles par qui saisit ses temps (chef, gestionnaire).
    expect((await a.chef.get(`${url.replace("matrice", "moi")}`)).statusCode).toBe(200);
    expect((await gestionnaire.get(`${url.replace("matrice", "moi")}`)).statusCode).toBe(200);
    const m = attendu(200, await a.ressources.get(url));
    const ligne = m.lignes.find(
      (l: { collaborateur: { id: string } }) => l.collaborateur.id === collabConsultant,
    );
    expect(ligne.cellules[0]).toMatchObject({
      competence_id: competenceId,
      niveau_valide: null,
      preuves: 3,
      centiemes: 750,
      jours: "7,5 j",
      a_revoir: true,
    });
    const autre = attendu(200, await b.associe.get(url));
    expect(autre.competences).toEqual([]);
  });

  it("vue de groupe sans budget.lire_jours : temps, preuves et dernier usage ABSENTS", () => {
    const cellule = {
      competence_id: "k",
      niveau_valide: 2 as const,
      niveau_valide_le: "2026-11-01",
      niveau_en_attente: null,
      declaration_en_attente_id: null,
      preuves: 3,
      centiemes: 750,
      derniere_preuve: "2026-11-16",
      a_revoir: false,
    };
    const sans = vueCelluleGroupe(cellule, false);
    expect(Object.keys(sans).sort()).toEqual([
      "a_revoir",
      "competence_id",
      "declaration_en_attente_id",
      "niveau_en_attente",
      "niveau_valide",
      "niveau_valide_le",
    ]);
    expect(vueCelluleGroupe(cellule, true)).toMatchObject({
      preuves: 3,
      centiemes: 750,
      jours: "7,5 j",
    });
  });

  it("déclaration de soi, validation par un tiers habilité", async () => {
    const decl = attendu(
      201,
      await a.consultant.post("/api/capitalisation/competences/declarations", {
        competence_id: competenceId,
        niveau: 3,
      }),
    );
    const url = `/api/capitalisation/competences/declarations/${decl.id}/decision`;
    expect((await a.consultant.post(url, { decision: "validee" })).statusCode).toBe(403);
    expect((await a.ressources.post(url, { decision: "refusee" })).statusCode).toBe(400);
    attendu(201, await a.ressources.post(url, { decision: "validee" }));
    expect(attendu(409, await a.associe.post(url, { decision: "validee" })).erreur.code).toBe(
      "DECLARATION_DECIDEE",
    );
    const moi = attendu(200, await a.consultant.get("/api/capitalisation/competences/moi"));
    expect(moi.cellules[0]).toMatchObject({
      niveau_valide: 3,
      niveau_en_attente: null,
      a_revoir: false,
    });
    expect(
      (
        await a.consultant.post("/api/capitalisation/competences/declarations", {
          collaborateur_id: a.collaborateurs.junior,
          competence_id: competenceId,
          niveau: 2,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("séparation des tâches : ni la personne évaluée, ni le déclarant hors associé (MPJ04)", async () => {
    const pourAutrui = attendu(
      201,
      await a.ressources.post("/api/capitalisation/competences/declarations", {
        collaborateur_id: collabConsultant,
        competence_id: competenceId,
        niveau: 4,
      }),
    );
    // Une seule déclaration EN ATTENTE par couple (collaborateur, compétence) : 409, et en base.
    const decl = "/api/capitalisation/competences/declarations";
    expect(
      attendu(409, await a.consultant.post(decl, { competence_id: competenceId, niveau: 1 })).erreur
        .code,
    ).toBe("DECLARATION_EN_ATTENTE");
    expect(
      (
        await a.ressources.post(decl, {
          collaborateur_id: collabConsultant,
          competence_id: competenceId,
          niveau: 2,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await codeErreurBase(
        a.cabinetId,
        `INSERT INTO competence_declarations (cabinet_id, collaborateur_id, competence_id, niveau,
           declare_par) VALUES ($1, $2, $3, 1, $4)`,
        [a.cabinetId, collabConsultant, competenceId, a.ressources.utilisateurId],
      ),
    ).toBe("MPJ06");
    const url = (id: string) => `/api/capitalisation/competences/declarations/${id}/decision`;
    expect(
      attendu(403, await a.ressources.post(url(pourAutrui.id), { decision: "validee" })).erreur
        .code,
    ).toBe("SEPARATION_DES_TACHES");
    const soi = attendu(
      201,
      await a.ressources.post("/api/capitalisation/competences/declarations", {
        competence_id: competenceId,
        niveau: 2,
      }),
    );
    expect(soi.collaborateur_id).toBe(collabRessources);
    expect((await a.ressources.post(url(soi.id), { decision: "validee" })).statusCode).toBe(403);
    expect(
      await codeErreurBase(
        a.cabinetId,
        `INSERT INTO competence_decisions (cabinet_id, declaration_id, decision, decide_par)
         VALUES ($1, $2, 'validee', $3)`,
        [a.cabinetId, soi.id, a.ressources.utilisateurId],
      ),
    ).toBe("MPJ04");
    attendu(201, await a.associe.post(url(soi.id), { decision: "validee" }));
    expect((await b.associe.post(url(pourAutrui.id), { decision: "validee" })).statusCode).toBe(
      404,
    );
  });
});

describe("référentiel et relevé des preuves (CAP-06)", () => {
  it("modification et relevé manuel : droits, dédoublonnage", async () => {
    const url = `/api/capitalisation/missions/${m1.id}/competences/actualiser`;
    expect((await api(ctx).post(url)).statusCode).toBe(401);
    expect((await a.consultant.post(url)).statusCode).toBe(403);
    expect((await b.associe.post(url)).statusCode).toBe(404);
    expect(attendu(200, await a.ressources.post(url))).toEqual({ preuves_ajoutees: 0 });
    const p = `/api/capitalisation/competences/${competenceId}`;
    expect((await a.consultant.patch(p, { libelle: "x" })).statusCode).toBe(403);
    expect((await a.ressources.patch(p, {})).statusCode).toBe(400);
    const m = attendu(
      200,
      await a.ressources.patch(p, { description: "Entretiens de diagnostic." }),
    );
    expect(m).toMatchObject({
      code: "conduite_entretiens",
      description: "Entretiens de diagnostic.",
    });
  });
});

describe("analyse des dérogations (CAP-05)", () => {
  const url = "/api/capitalisation/derogations/analyse";

  it("comité méthode seul ; motifs lus seulement pour les missions visibles", async () => {
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect((await a.consultant.get(url)).statusCode).toBe(403);
    const expert = attendu(200, await a.expert.get(url));
    const g = expert.elements[0];
    expect(g).toMatchObject({
      brique_code: ENTRETIENS,
      nature: "retirer_brique",
      missions: 3,
      derogations: 3,
      demandees: 3,
      motifs_visibles: 0,
      au_dessus_du_seuil: true,
      proposition: null,
    });
    expect(g.motifs).toEqual([]);
    const associe = attendu(200, await a.associe.get(url));
    expect(associe.elements[0].motifs_visibles).toBe(3);
    expect(associe.elements[0].motifs[0].effectif).toBeGreaterThanOrEqual(2);
    expect(associe.elements[0].mots_cles.map((m: { mot: string }) => m.mot)).toContain("atelier");
    cleGroupe = g.cle;
    expect(attendu(200, await a.associe.get(`${url}?seuil=4`)).elements[0].au_dessus_du_seuil).toBe(
      false,
    );
    // Seuil et similarité hors bornes : 400, jamais 500.
    for (const q of [
      "seuil=1",
      "seuil=0",
      "seuil=101",
      "seuil=abc",
      "similarite=5",
      "similarite=101",
      "seuil=2.5",
    ]) {
      const r = await a.associe.get(`${url}?${q}`);
      expect(r.statusCode, q).toBe(400);
      expect(r.json().erreur.code).toBe("REQUETE_INVALIDE");
    }
    expect((await a.associe.get(`${url}?inconnu=1`)).statusCode).toBe(400);
    expect(attendu(200, await b.associe.get(url)).elements).toEqual([]);
  });

  it("proposition au comité méthode par son service, une seule fois", async () => {
    const p = "/api/capitalisation/derogations/propositions";
    expect((await a.consultant.post(p, { cle: cleGroupe })).statusCode).toBe(403);
    expect(attendu(409, await a.expert.post(p, { cle: cleGroupe, seuil: 4 })).erreur.code).toBe(
      "SEUIL_NON_ATTEINT",
    );
    const r = attendu(201, await a.expert.post(p, { cle: cleGroupe }));
    expect(r.proposition).toMatchObject({ statut: "proposee", auteur_id: a.expert.utilisateurId });
    expect(r.proposition.description).toContain("3 missions");
    expect(r.proposition.description).not.toContain("Petite entreprise");
    // Ni motif, ni mot tiré des motifs : seulement effectifs et groupe.
    expect(r.proposition.description).not.toContain("atelier");
    expect(r.proposition.description).not.toContain("Mots-clés");
    expect(r.proposition.description).toContain(ENTRETIENS);
    expect(attendu(409, await a.expert.post(p, { cle: cleGroupe })).erreur.code).toBe(
      "PROPOSITION_EXISTANTE",
    );
    expect((await b.associe.post(p, { cle: cleGroupe })).statusCode).toBe(404);
    const apres = attendu(200, await a.expert.get(url));
    expect(apres.elements[0].proposition).toMatchObject({ statut: "proposee" });
    const std = attendu(200, await a.associe.get("/api/standard/propositions?limite=10"));
    expect(std.elements.some((x: { id: string }) => x.id === r.proposition.id)).toBe(true);
  });
});

describe("recherche unifiée (CAP-07)", () => {
  const url = (q: string, extra = "") =>
    `/api/capitalisation/recherche?q=${encodeURIComponent(q)}${extra}`;

  beforeAll(async () => {
    await proprietaire(async (cl) => {
      for (const [source, extrait, nominatif] of [
        [
          "Entretien avec le directeur commercial",
          "Les relances clients sont irrégulières.",
          false,
        ],
        ["Entretien confidentiel sur les relances", "Propos nominatif sur les relances.", true],
      ] as const) {
        const p = await cl.query(
          `INSERT INTO preuves (cabinet_id, mission_id, client_id, cree_par)
           SELECT cabinet_id, id, client_id, $2 FROM missions WHERE id = $1 RETURNING id`,
          [m4.id, a.chef.utilisateurId],
        );
        await cl.query(
          `INSERT INTO preuve_versions (cabinet_id, preuve_id, version, type_source, source_precise,
             date_preuve, auteur_id, fiabilite, extrait, nominatif, cree_par)
           VALUES ($1, $2, 1, 'entretien', $3, '2026-11-05', $4, 'B', $5, $6, $4)`,
          [a.cabinetId, p.rows[0].id, source, a.chef.utilisateurId, extrait, nominatif],
        );
      }
    });
  });

  it("401, 403, requête trop courte 400", async () => {
    expect((await api(ctx).get(url("kora"))).statusCode).toBe(401);
    expect((await gestionnaire.get(url("kora"))).statusCode).toBe(403);
    expect((await a.chef.get(url("k"))).statusCode).toBe(400);
    expect((await a.chef.get(url("kora", "&types=inconnu"))).statusCode).toBe(400);
  });

  it("missions sans accents, dans les missions visibles seulement", async () => {
    const r = attendu(200, await a.consultant.get(url("strategique", "&types=mission")));
    expect(r.elements.map((e: { mission_id: string }) => e.mission_id).sort()).toEqual(
      [m1.id, m2.id, m3.id].sort(),
    );
    expect(r.par_type.mission).toEqual({ nombre: 3, tronque: false });
    const limite = attendu(
      200,
      await a.consultant.get(url("stratégique", "&types=mission&limite=2")),
    );
    expect(limite.par_type.mission).toEqual({ nombre: 2, tronque: true });
    expect(attendu(200, await horsEquipe.get(url("strategique"))).elements).toEqual([]);
    expect(attendu(200, await b.associe.get(url("strategique"))).elements).toEqual([]);
  });

  it("retours d'expérience validés : base de connaissances", async () => {
    const r = attendu(
      200,
      await a.consultant.get(url("atelier petites structures", "&types=connaissance")),
    );
    expect(r.elements).toHaveLength(1);
    expect(r.elements[0]).toMatchObject({ type: "connaissance", id: retour1, mission_id: m1.id });
    expect(
      attendu(200, await horsEquipe.get(url("atelier", "&types=connaissance"))).elements,
    ).toEqual([]);
  });

  it("preuves : preuve.lire, version courante, verbatim nominatif sans accord exclu", async () => {
    const chef = attendu(200, await a.chef.get(url("relances", "&types=preuve")));
    expect(chef.elements).toHaveLength(2);
    const consultant = attendu(200, await a.consultant.get(url("relances", "&types=preuve")));
    expect(consultant.elements).toHaveLength(1);
    expect(consultant.elements[0].titre).toBe("Entretien avec le directeur commercial");
    expect(attendu(200, await a.expert.get(url("relances", "&types=preuve"))).elements).toEqual([]);
    const tout = attendu(200, await a.consultant.get(url("relances")));
    expect(tout.par_type.preuve.nombre).toBe(1);
  });
});

describe("recherche : rapports, livrables, retours non validés, débit, portail (CAP-07)", () => {
  const url = (q: string, extra = "") =>
    `/api/capitalisation/recherche?q=${encodeURIComponent(q)}${extra}`;
  let m5: MissionCap;

  beforeAll(async () => {
    await proprietaire(async (cl) => {
      await cl.query(
        "INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id) VALUES ($1, $2, $3)",
        [a.cabinetId, m4.id, expertEquipe.utilisateurId],
      );
      // Un rapport par niveau, plus un rapport dont le fichier a été purgé.
      for (const [i, niveau] of (["base", "jours", "finance", "base"] as const).entries()) {
        const f = await cl.query(
          `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256,
             envoye_par) VALUES ($1, $2, 'rapport.pdf', 'application/pdf', 100, $3, $4) RETURNING id`,
          [
            a.cabinetId,
            randomUUID().replaceAll("-", ""),
            createHash("sha256").update(randomUUID()).digest("hex"),
            a.associeId,
          ],
        );
        await cl.query(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut,
             niveau, genere_par) VALUES ($1, $2, $3, 'etat_avancement', 'pdf', 'valide', $4, $5)`,
          [a.cabinetId, m4.id, f.rows[0].id, niveau, a.associeId],
        );
        if (i === 3) {
          // Le dernier rapport (niveau « base ») est purgé : il disparaît de la recherche.
          await cl.query(
            `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif) VALUES ($1, $2, 'retire')`,
            [a.cabinetId, f.rows[0].id],
          );
        }
      }
      // Livrable à deux versions (seule la dernière sort) et un autre sans rapport avec la requête.
      for (const [nom, version] of [
        ["Diagnostic Fromager phase un", 1],
        ["Diagnostic Fromager phase un", 2],
        ["Plan de relance commerciale", 1],
      ] as const) {
        await cl.query(
          `INSERT INTO mission_documents (cabinet_id, mission_id, type, nom, version, auteur_id)
           VALUES ($1, $2, 'livrable', $3, $4, $5)`,
          [a.cabinetId, m4.id, nom, version, a.chef.utilisateurId],
        );
      }
    });
  });

  it("rapports : seuls les niveaux lisibles, jamais un fichier purgé", async () => {
    const q = url("Fromager", "&types=rapport&limite=30");
    // 4 rapports insérés, 1 purgé : base (1) + jours (1) + finance (1) pour l'associé.
    expect(attendu(200, await a.associe.get(q)).elements).toHaveLength(3);
    // Consultant et chef : base et jours, pas finance.finance (finance.lire absent).
    expect(attendu(200, await a.consultant.get(q)).elements).toHaveLength(2);
    expect(attendu(200, await a.chef.get(q)).elements).toHaveLength(2);
    // Expert métier : ni jours ni finance, donc base seul.
    expect(attendu(200, await expertEquipe.get(q)).elements).toHaveLength(1);
  });

  it("livrables : dernière version seulement, dans les missions visibles", async () => {
    const r = attendu(200, await a.consultant.get(url("diagnostic", "&types=livrable")));
    expect(r.elements).toHaveLength(1);
    expect(r.elements[0]).toMatchObject({
      type: "livrable",
      titre: "Diagnostic Fromager phase un",
      extrait: "livrable, version 2",
      mission_id: m4.id,
    });
    expect(
      attendu(200, await horsEquipe.get(url("diagnostic", "&types=livrable"))).elements,
    ).toEqual([]);
    expect(
      attendu(200, await b.associe.get(url("diagnostic", "&types=livrable"))).elements,
    ).toEqual([]);
  });

  it("retour d'expérience non validé : hors de la recherche ; section « Écarts » hors du texte interrogé", async () => {
    m5 = await missionCap(a, "Mission annexe Palmier");
    await cloturer(a, m5.id, "a_cloturer");
    attendu(201, await a.chef.post(`/api/capitalisation/missions/${m5.id}/retour`));
    // Brouillon : trouvable par sa mission, jamais comme retour d'expérience.
    expect(
      attendu(200, await a.associe.get(url("Palmier", "&types=mission"))).elements,
    ).toHaveLength(1);
    expect(
      attendu(200, await a.associe.get(url("Palmier", "&types=connaissance"))).elements,
    ).toEqual([]);
    // Version validée de m1 : « budget d'une journée » ne figure que dans la section « Écarts ».
    const mot = url("budget journée", "&types=connaissance");
    expect(attendu(200, await a.consultant.get(mot)).elements).toHaveLength(1);
    expect(attendu(200, await expertEquipe.get(mot)).elements).toEqual([]);
  });

  it("validation du retour doublée en base : responsable de la mission et utilisateur de session (MPJ08)", async () => {
    const detail = attendu(
      200,
      await a.chef.get(`/api/capitalisation/missions/${m5.id}/retour`),
    ).retour;
    const sql = `UPDATE retours_experience SET statut = 'valide', version_validee = 1,
       valide_par = $2, valide_le = now() WHERE id = $1`;
    // Le consultant n'est ni associé, ni chef, ni directeur de la mission.
    expect(await codeErreurBase(a.cabinetId, sql, [detail.id, a.consultant.utilisateurId])).toBe(
      "MPJ08",
    );
    // Valideur responsable, mais la session est celle d'un autre utilisateur.
    let code: string | undefined;
    try {
      await ctx.db.withTenant(a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.utilisateur_id', $1, true)", [
          a.consultant.utilisateurId,
        ]);
        await db.query(sql, [detail.id, a.chef.utilisateurId]);
      });
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe("MPJ08");
    // Exception voulue (PRD) : le chef valide la version qu'il a lui-même demandée (ici l'API).
    const ok = attendu(
      200,
      await a.chef.post(`/api/capitalisation/retours/${detail.id}/valider`, { version: 1 }),
    );
    expect(ok).toMatchObject({ statut: "valide", valide_par: a.chef.utilisateurId });
  });

  it("débit par utilisateur : 429 TROP_DE_RECHERCHES, compté sur le journal", async () => {
    const lecteur = await a.avecRoles(["consultant"]);
    expect((await lecteur.get(url("Fromager", "&types=mission"))).statusCode).toBe(200);
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite)
         SELECT $1, $2, 'capitalisation.recherche', 'recherche' FROM generate_series(1, 60)`,
        [a.cabinetId, lecteur.utilisateurId],
      ),
    );
    const r = await lecteur.get(url("Fromager", "&types=mission"));
    expect(r.statusCode).toBe(429);
    expect(r.json().erreur.code).toBe("TROP_DE_RECHERCHES");
    // Un autre utilisateur n'est pas touché ; le texte cherché n'est jamais journalisé.
    expect((await a.chef.get(url("Fromager", "&types=mission"))).statusCode).toBe(200);
    const journal = await proprietaire((cl) =>
      cl.query(
        `SELECT details::text AS d FROM journal_audit WHERE utilisateur_id = $1
         AND action = 'capitalisation.recherche' AND details <> '{}'::jsonb LIMIT 1`,
        [lecteur.utilisateurId],
      ),
    );
    expect(journal.rows[0].d).not.toContain("Fromager");
  });

  it("portail client : recherche, matrice et retours fermés (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    for (const chemin of [
      url("Fromager"),
      "/api/capitalisation/competences/matrice",
      "/api/capitalisation/competences/moi",
      "/api/capitalisation/retours",
      "/api/capitalisation/derogations/analyse",
      "/api/capitalisation/estimation/briques",
    ]) {
      const r = await client.get(chemin);
      expect(r.statusCode, chemin).toBe(403);
      expect(r.json().erreur.code, chemin).toBe("PORTAIL_ROUTE_INTERDITE");
    }
    expect(
      (await client.post("/api/capitalisation/estimation", { briques: [ENTRETIENS] })).statusCode,
    ).toBe(403);
  });
});

describe("déclarations de niveau : plafond par couple (MPJ07)", () => {
  it("50 déclarations par collaborateur et compétence au plus, en API et en base", async () => {
    const k = attendu(
      201,
      await a.ressources.post("/api/capitalisation/competences", {
        code: "plafond_declarations",
        libelle: "Zèbre : plafond de déclarations",
      }),
    ).id as string;
    const junior = a.collaborateurs.junior as string;
    await proprietaire((cl) =>
      cl.query(`
        DO $$
        DECLARE d uuid;
        BEGIN
          FOR i IN 1..50 LOOP
            INSERT INTO competence_declarations (cabinet_id, collaborateur_id, competence_id, niveau,
              declare_par) VALUES ('${a.cabinetId}', '${junior}', '${k}', 2,
              '${a.ressources.utilisateurId}') RETURNING id INTO d;
            INSERT INTO competence_decisions (cabinet_id, declaration_id, decision, decide_par)
              VALUES ('${a.cabinetId}', d, 'validee', '${a.associeId}');
          END LOOP;
        END $$`),
    );
    const r = await a.ressources.post("/api/capitalisation/competences/declarations", {
      collaborateur_id: junior,
      competence_id: k,
      niveau: 3,
    });
    expect(attendu(409, r).erreur.code).toBe("PLAFOND_DECLARATIONS");
    expect(
      await codeErreurBase(
        a.cabinetId,
        `INSERT INTO competence_declarations (cabinet_id, collaborateur_id, competence_id, niveau,
           declare_par) VALUES ($1, $2, $3, 3, $4)`,
        [a.cabinetId, junior, k, a.ressources.utilisateurId],
      ),
    ).toBe("MPJ07");
  }, 60_000);
});
