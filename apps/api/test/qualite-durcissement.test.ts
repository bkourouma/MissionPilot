import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import {
  attendre,
  insererRapport,
  ouvrir,
  preparerQualite,
  preuveDeTest,
  type ScenarioQualite,
} from "./qualite-outils.js";

/*
 * Durcissement du lot qualité (audit de sécurité du 2026-10-08) : auteur d'un suivi imposé par le
 * module ou membre actif de la mission, parcours de revue non vide et sans source libre, étape à
 * reconfirmer après un dépôt tardif, empreinte du contenu relu, acceptation figée après décision,
 * retrait d'une relation en ajout seul, note interne réservée, attestation hors auteur, origine
 * du NPS.
 */

let ctx: Contexte;
let s: ScenarioQualite;
let preuveId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQualite(ctx, "Cabinet Durcissement");
  preuveId = await preuveDeTest(s);
}, 180_000);
afterAll(async () => {
  await ctx.fermer();
});

const detail = (par: Api, id: string) => par.get(`/api/qualite/suivis/${id}`).then((r) => r.json());
const valider = (par: Api, id: string, etape: string) =>
  par.post(`/api/qualite/suivis/${id}/validations`, { etape });

async function parcourir(par: Api, suiviId: string) {
  const d = await detail(par, suiviId);
  for (const e of d.elements as { id: string }[]) {
    attendre(200, await par.post(`/api/qualite/suivis/${suiviId}/elements/${e.id}/vu`), "vu");
  }
}

/** Suivi d'un rapport R2 en revue : définition satisfaite (chiffre tracé, mention attestée). */
async function rapportEnRevue(options: { elements?: boolean } = {}) {
  const rapport = await insererRapport(s, { auteurId: s.consultant.utilisateurId });
  const o = await ouvrir(s.c.chef, s, { type_livrable: "rapport", livrable_id: rapport.id });
  attendre(201, o, "ouverture");
  const id = o.json().suivi.id as string;
  attendre(200, await s.c.chef.post(`/api/qualite/suivis/${id}/verification`), "verification");
  if (options.elements !== false) {
    attendre(
      200,
      await s.c.chef.post(`/api/qualite/suivis/${id}/elements`, {
        elements: [
          { cle: "a1", kind: "assertion_fragile", libelle: "Le marché croît de 20 %" },
          { cle: "c1", kind: "chiffre", libelle: "Chiffre d'affaires 2025", preuve_id: preuveId },
        ],
      }),
      "éléments",
    );
  }
  const v = await s.c.chef.post(`/api/qualite/suivis/${id}/verification`);
  for (const i of v.json().definition.items as { id: string; statut: string; controle: string }[]) {
    if (i.statut === "non_evaluable" || i.controle === "manuel") {
      attendre(
        200,
        await s.c.chef.post(`/api/qualite/suivis/${id}/verification/${i.id}/attestation`, {
          commentaire: "Vérifié",
        }),
        "attestation",
      );
    }
  }
  return { id, rapport };
}

/** Remplace, en base, le fichier d'un rapport (contenu modifié après la revue). */
async function modifierRapport(rapportId: string) {
  await proprietaire(async (c) => {
    const f = await c.query(
      `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
       VALUES ($1, $2, 'rapport-v2.pdf', 'application/pdf', 100, $3, $4) RETURNING id`,
      [
        s.c.cabinetId,
        randomUUID().replaceAll("-", ""),
        createHash("sha256").update(randomUUID()).digest("hex"),
        s.consultant.utilisateurId,
      ],
    );
    await c.query("UPDATE rapports_mission SET fichier_id = $2 WHERE id = $1", [
      rapportId,
      f.rows[0].id,
    ]);
  });
}

describe("auteur du suivi (point 1)", () => {
  it("type lu par le module : l'auteur est celui du module, le corps ne le remplace pas", async () => {
    const rapport = await insererRapport(s, { auteurId: s.consultant.utilisateurId });
    const o = await ouvrir(s.c.chef, s, {
      type_livrable: "rapport",
      livrable_id: rapport.id,
      auteur_id: s.c.chef.utilisateurId,
    });
    expect(o.statusCode).toBe(201);
    expect(o.json().suivi.auteur_id).toBe(s.consultant.utilisateurId);
    const agent = await ouvrir(s.c.chef, s, {
      type_livrable: "rapport",
      livrable_id: (await insererRapport(s, { auteurId: s.consultant.utilisateurId })).id,
      auteur_id: null,
    });
    expect(agent.statusCode).toBe(400);
    expect(agent.json().erreur.code).toBe("AUTEUR_IMPOSE");
  });

  it("type opaque : auteur membre actif de la mission (400 AUTEUR_NON_MEMBRE, MPY11)", async () => {
    const etranger = await ouvrir(s.c.chef, s, {
      type_livrable: "autre",
      auteur_id: s.etranger.utilisateurId,
    });
    expect(etranger.statusCode).toBe(400);
    expect(etranger.json().erreur.code).toBe("AUTEUR_NON_MEMBRE");
    const membre = await ouvrir(s.c.chef, s, {
      type_livrable: "autre",
      auteur_id: s.consultant.utilisateurId,
    });
    expect(membre.statusCode).toBe(201);
    expect(membre.json().suivi.auteur_id).toBe(s.consultant.utilisateurId);
    // Sans droit : 401 et 403 (inchangés).
    expect(
      (await api(ctx).post("/api/qualite/suivis", { type_livrable: "autre" })).statusCode,
    ).toBe(401);
    expect((await ouvrir(s.consultant, s, { type_livrable: "autre" })).statusCode).toBe(403);
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO qualite_suivis (cabinet_id, mission_id, type_livrable, livrable_id, libelle,
             classe_minimale, classe, auteur_id, ouvert_par)
           VALUES ($1, $2, 'autre', $3, 'X', 'R1', 'R1', $4, $5)`,
          [
            s.c.cabinetId,
            s.missionId,
            randomUUID(),
            s.etranger.utilisateurId,
            s.c.chef.utilisateurId,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPY11" });
  });
});

describe("parcours de revue (point 2)", () => {
  it("le relecteur ne pose ni « facultatif » ni source libre ; un chiffre se trace par une preuve de la mission", async () => {
    const o = await ouvrir(s.c.chef, s, { type_livrable: "autre" });
    const id = o.json().suivi.id as string;
    const url = `/api/qualite/suivis/${id}/elements`;
    for (const element of [
      { cle: "x1", kind: "recommandation", libelle: "X", obligatoire: false },
      { cle: "x2", kind: "chiffre", libelle: "X", source: "Moteur finance" },
      { cle: "x3", kind: "recommandation", libelle: "X", preuve_id: preuveId },
    ]) {
      const r = await s.c.chef.post(url, { elements: [element] });
      expect(r.statusCode, JSON.stringify(element)).toBe(400);
    }
    // Preuve d'une autre mission : 404 (comme une preuve inexistante).
    const autreMission = (await creerMission(s.c)).id as string;
    const autre = await s.c.chef.post(`/api/missions/${autreMission}/preuves`, {
      type_source: "document",
      source_precise: "Pièce d'une autre mission",
      date_preuve: "2026-09-30",
      fiabilite: "B",
    });
    attendre(201, autre, "preuve autre mission");
    expect(
      (
        await s.c.chef.post(url, {
          elements: [{ cle: "x4", kind: "chiffre", libelle: "X", preuve_id: autre.json().id }],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await s.consultant.post(url, { elements: [{ cle: "x5", kind: "chiffre", libelle: "X" }] }))
        .statusCode,
    ).toBe(403);
    const ok = await s.c.chef.post(url, {
      elements: [{ cle: "c1", kind: "chiffre", libelle: "Marge 2025", preuve_id: preuveId }],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().elements[0]).toMatchObject({
      obligatoire: true,
      source_type: "preuve",
      reference: `preuve:${preuveId}`,
    });
    expect(ok.json().elements[0].source).toMatch(/^Registre des preuves : preuve n° \d+/);
  });

  it("un livrable R2 ne se valide pas sur un parcours vide (409 PARCOURS_VIDE, MPY08)", async () => {
    const { id } = await rapportEnRevue({ elements: false });
    const r = await valider(s.consultant, id, "validation_consultant");
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PARCOURS_VIDE");
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO qualite_validations (cabinet_id, suivi_id, etape, acteur_id)
           VALUES ($1, $2, 'validation_consultant', $3)`,
          [s.c.cabinetId, id, s.consultant.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPY08" });
  });

  it("un élément déposé après une étape la rend « à reconfirmer » jusqu'au parcours de son auteur", async () => {
    const { id } = await rapportEnRevue();
    await parcourir(s.consultant, id);
    attendre(200, await valider(s.consultant, id, "validation_consultant"), "consultant");
    // Dépôt tardif d'un élément obligatoire.
    const ajout = await s.c.chef.post(`/api/qualite/suivis/${id}/elements`, {
      elements: [{ cle: "r9", kind: "recommandation", libelle: "Recommandation tardive" }],
    });
    expect(ajout.statusCode).toBe(200);
    expect(ajout.json().garde.etapes_a_reconfirmer).toEqual(["validation_consultant"]);
    expect(ajout.json().validations[0].a_reconfirmer).toBe(true);
    expect(ajout.json().evenements.map((e: { action: string }) => e.action)).toContain(
      "elements_apres_validation",
    );
    // La relecture du chef s'enregistre, mais la garde n'est pas satisfaite.
    await parcourir(s.c.chef, id);
    const chef = await valider(s.c.chef, id, "relecture_chef_mission");
    expect(chef.statusCode).toBe(200);
    expect(chef.json().suivi.statut).toBe("en_revue");
    // L'étape déjà franchie ne se rejoue pas : son auteur parcourt le nouvel élément.
    const rejeu = await valider(s.consultant, id, "validation_consultant");
    expect(rejeu.statusCode).toBe(409);
    expect(rejeu.json().erreur.code).toBe("ETAPE_A_RECONFIRMER");
    await parcourir(s.consultant, id);
    const fin = await detail(s.c.chef, id);
    expect(fin.garde.etapes_a_reconfirmer).toEqual([]);
    expect(fin.suivi.statut).toBe("valide");
  });
});

describe("empreinte du contenu relu (point 3)", () => {
  it("posée au passage en revue ; une étape sur un contenu modifié est refusée (409)", async () => {
    const { id, rapport } = await rapportEnRevue();
    const d = await detail(s.c.chef, id);
    expect(d.suivi.empreinte_revue).toBe(rapport.sha256);
    await parcourir(s.consultant, id);
    await modifierRapport(rapport.id);
    const r = await valider(s.consultant, id, "validation_consultant");
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("LIVRABLE_MODIFIE_APRES_REVUE");
    // L'empreinte relue est figée en base (MPY02).
    await expect(
      proprietaire((c) =>
        c.query("UPDATE qualite_suivis SET empreinte_revue = $2 WHERE id = $1", [
          id,
          "0".repeat(64),
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPY02" });
  });

  it("la signature porte sur le contenu relu : un livrable modifié depuis ne se signe pas", async () => {
    const { id, rapport } = await rapportEnRevue();
    for (const par of [s.consultant, s.c.chef, s.c.directeur]) await parcourir(par, id);
    attendre(200, await valider(s.consultant, id, "validation_consultant"), "consultant");
    const chef = await valider(s.c.chef, id, "relecture_chef_mission");
    expect(chef.json().suivi.statut).toBe("valide");
    await modifierRapport(rapport.id);
    const sig = await s.c.directeur.post(`/api/qualite/suivis/${id}/signature`, {});
    expect(sig.statusCode).toBe(409);
    expect(sig.json().erreur.code).toBe("LIVRABLE_MODIFIE_APRES_REVUE");
  });
});

describe("attestation (point 7)", () => {
  it("l'auteur du livrable n'atteste pas sa propre définition (409 ATTESTATION_PAR_AUTEUR, MPY10)", async () => {
    const o = await ouvrir(s.c.chef, s, {
      type_livrable: "etat",
      auteur_id: s.c.chef.utilisateurId,
    });
    attendre(201, o, "ouverture");
    const id = o.json().suivi.id as string;
    const v = await s.c.chef.post(`/api/qualite/suivis/${id}/verification`);
    const item = (v.json().definition.items as { id: string; controle: string }[]).find(
      (i) => i.controle === "manuel",
    )!;
    const url = `/api/qualite/suivis/${id}/verification/${item.id}/attestation`;
    const parAuteur = await s.c.chef.post(url, { commentaire: "Fait" });
    expect(parAuteur.statusCode).toBe(409);
    expect(parAuteur.json().erreur.code).toBe("ATTESTATION_PAR_AUTEUR");
    expect(
      (await s.c.directeur.post(url, { commentaire: "Rapproché des pièces" })).statusCode,
    ).toBe(200);
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO qualite_verifications (cabinet_id, suivi_id, item_id, rang, statut, detail, par)
           VALUES ($1, $2, $3, 99, 'atteste', 'x', $4)`,
          [s.c.cabinetId, id, item.id, s.c.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPY10" });
  });
});

describe("acceptation et relations (points 4 et 7)", () => {
  let clientLie: string;
  let relationId: string;

  beforeAll(async () => {
    const c = await s.c.associe.post("/api/clients", { raison_sociale: "Filiale Lien SA" });
    attendre(201, c, "client");
    clientLie = c.json().id;
    const r = await s.c.directeur.post("/api/qualite/relations-clients", {
      client_id: s.c.clientId,
      client_lie_id: clientLie,
      nature: "meme_groupe",
      note: "Note interne : actionnaire commun",
    });
    attendre(201, r, "relation");
    relationId = r.json().id;
  });

  it("après une décision, un « en attente » exige qualite.signer et le niveau ne s'abaisse plus", async () => {
    const url = `/api/qualite/missions/${s.missionId}/acceptation`;
    attendre(
      200,
      await s.c.chef.post(url, { decision: "en_attente", facteurs: ["secteur_reglemente"] }),
      "attente",
    );
    attendre(
      200,
      await s.c.directeur.post(url, {
        decision: "acceptee_sous_conditions",
        motif: "Équipes séparées",
        facteurs: ["pays_a_risque"],
      }),
      "décision",
    );
    const annule = await s.c.chef.post(url, { decision: "en_attente" });
    expect(annule.statusCode).toBe(403);
    const abaisse = await s.c.directeur.post(url, { decision: "en_attente", facteurs: [] });
    expect(abaisse.statusCode).toBe(409);
    expect(abaisse.json().erreur.code).toBe("NIVEAU_RISQUE_ABAISSE");
    const maintenu = await s.c.directeur.post(url, {
      decision: "en_attente",
      facteurs: [],
      niveau_retenu: "eleve",
    });
    expect(maintenu.statusCode).toBe(200);
    expect(maintenu.json().derniere).toMatchObject({ niveau_risque: "eleve", rang: 3 });
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO qualite_acceptations (cabinet_id, mission_id, client_id, rang, profil_risque,
             niveau_risque, decision, evalue_par)
           VALUES ($1, $2, $3, 99, '{}', 'faible', 'en_attente', $4)`,
          [s.c.cabinetId, s.missionId, s.c.clientId, s.c.directeur.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPY09" });
  });

  it("la note interne n'est servie qu'avec qualite.signer ; la liste exige aussi clients.lire", async () => {
    const liste = `/api/qualite/relations-clients?client_id=${clientLie}`;
    expect((await api(ctx).get(liste)).statusCode).toBe(401);
    // L'expert métier relit (qualite.relire) mais ne lit pas les clients.
    expect((await s.expert.get(liste)).statusCode).toBe(403);
    const chef = await s.c.chef.get(liste);
    expect(chef.statusCode).toBe(200);
    expect(chef.json().elements[0]).not.toHaveProperty("note");
    const dir = await s.c.directeur.get(liste);
    expect(dir.json().elements[0].note).toBe("Note interne : actionnaire commun");
    const acc = `/api/qualite/missions/${s.missionId}/acceptation`;
    const parChef = (await s.c.chef.get(acc)).json();
    expect(JSON.stringify(parChef)).not.toContain("actionnaire commun");
    const parDir = (await s.c.directeur.get(acc)).json();
    expect(parDir.conflits_actuels[0].note).toBe("Note interne : actionnaire commun");
    const autre = await cabinetTest(ctx, "Autre cabinet durcissement");
    const etrangere = await autre.associe.get(liste);
    expect(etrangere.json().elements).toHaveLength(0);
  });

  it("retirer une relation est un événement en ajout seul ; elle se déclare de nouveau ensuite", async () => {
    expect((await s.c.chef.delete(`/api/qualite/relations-clients/${relationId}`)).statusCode).toBe(
      403,
    );
    expect(
      (await s.c.directeur.delete(`/api/qualite/relations-clients/${relationId}`)).statusCode,
    ).toBe(204);
    expect(
      (await s.c.directeur.delete(`/api/qualite/relations-clients/${relationId}`)).statusCode,
    ).toBe(404);
    const n = await proprietaire(async (c) => {
      const r = await c.query(
        `SELECT (SELECT count(*)::int FROM qualite_relations_clients WHERE id = $1) AS relations,
           (SELECT count(*)::int FROM qualite_relations_retraits WHERE relation_id = $1) AS retraits`,
        [relationId],
      );
      return r.rows[0];
    });
    expect(n).toEqual({ relations: 1, retraits: 1 });
    await expect(
      proprietaire((c) =>
        c.query("DELETE FROM qualite_relations_clients WHERE id = $1", [relationId]),
      ),
    ).rejects.toMatchObject({ code: "MPY01" });
    await expect(
      proprietaire((c) =>
        c.query("DELETE FROM qualite_relations_retraits WHERE relation_id = $1", [relationId]),
      ),
    ).rejects.toMatchObject({ code: "MPY01" });
    const liste = await s.c.directeur.get(`/api/qualite/relations-clients?client_id=${clientLie}`);
    expect(liste.json().elements).toHaveLength(0);
    const redeclaree = await s.c.directeur.post("/api/qualite/relations-clients", {
      client_id: clientLie,
      client_lie_id: s.c.clientId,
      nature: "meme_groupe",
    });
    expect(redeclaree.statusCode).toBe(201);
    const doublon = await s.c.directeur.post("/api/qualite/relations-clients", {
      client_id: s.c.clientId,
      client_lie_id: clientLie,
      nature: "meme_groupe",
    });
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().erreur.code).toBe("RELATION_EN_DOUBLE");
  });
});

describe("satisfaction : origine tracée (point 7)", () => {
  it("une note saisie par le cabinet porte l'origine « saisie_par_equipe »", async () => {
    const j = await s.c.chef.post(`/api/missions/${s.missionId}/jalons`, { libelle: "Atelier" });
    attendre(201, j, "jalon");
    const r = await s.c.chef.post(`/api/qualite/missions/${s.missionId}/satisfactions`, {
      moment: "jalon",
      jalon_id: j.json().id,
      note: 8,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().notes[0].origine).toBe("saisie_par_equipe");
    expect(r.json().synthese.total).toBe(1);
  });
});
