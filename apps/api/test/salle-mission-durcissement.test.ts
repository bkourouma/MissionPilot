import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ajouterJours } from "@missionpilot/engines";
import { traduireErreurSalle } from "../src/salle-mission/erreurs.js";
import { TYPE_JOB_RELANCE_SALLE } from "../src/salle-mission/relances.js";
import { api, type Api } from "./api.js";
import { demarrerAvecStockage, ECHANTILLONS, televerser } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee, type ApiUtilisateur } from "./missions-outils.js";
import { attendre, preparerPortail, type ScenarioPortail } from "./portail-outils.js";

/*
 * Salle de mission : durcissement d'audit (migration 0332). Plafonds des dépôts (par pièce, en
 * octets par demande, débit par utilisateur du portail), retrait d'un dépôt par l'équipe, cycle
 * de vie face à la clôture de la mission, séparation des tâches à l'acceptation, versement du seul
 * dépôt retenu, fichier cité par un dépôt traité comme rattaché, dates et tailles bornées.
 */

let ctx: Contexte & { dossier: string };
let s: ScenarioPortail;
let expert: ApiUtilisateur;
const INCONNU = "00000000-0000-4000-8000-000000000000";
const aujourdhui = new Date().toISOString().slice(0, 10);

const salle = (missionId: string) => `/api/missions/${missionId}/salle`;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerPortail(ctx);
  expert = await s.a.avecRoles(["expert_metier"]);
  attendre(
    201,
    await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, {
      utilisateur_id: expert.utilisateurId,
    }),
    "équipe",
  );
}, 240_000);

afterAll(async () => {
  await proprietaire((c) => c.query("DELETE FROM jobs WHERE type = $1", [TYPE_JOB_RELANCE_SALLE]));
  await ctx.fermer();
});

const deposerPortail = (u: Api, pieceId: string, contenu: Buffer, nom = "piece.pdf") =>
  televerser(u, `/api/portail/salle/pieces/${pieceId}/depots`, nom, contenu);

interface DemandeCreee {
  id: string;
  pieces: { id: string; libelle: string }[];
}

async function demandeEnvoyee(missionId: string, libelles: string[]): Promise<DemandeCreee> {
  const r = await s.a.chef.post(`${salle(missionId)}/demandes`, {
    titre: "Demande de test",
    echeance: ajouterJours(aujourdhui, 20),
    pieces: libelles.map((libelle) => ({ libelle })),
  });
  attendre(201, r, "demande");
  attendre(
    200,
    await s.a.chef.post(`${salle(missionId)}/demandes/${r.json().id}/envoyer`),
    "envoi",
  );
  return { id: r.json().id as string, pieces: r.json().pieces as DemandeCreee["pieces"] };
}

/** Fichier et dépôt écrits directement en base (propriétaire), pour pousser un plafond. */
async function depotDirect(opts: {
  pieceId: string;
  taille: number;
  sha: string;
  origine: "portail" | "cabinet";
  par: string;
}) {
  await proprietaire(async (c) => {
    const l = await c.query("SELECT client_id, demande_id FROM salle_pieces WHERE id = $1", [
      opts.pieceId,
    ]);
    const f = await c.query(
      `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
       VALUES ($1, $2, 'direct.pdf', 'application/pdf', $3, $4, $5) RETURNING id`,
      [
        s.a.cabinetId,
        createHash("md5").update(opts.sha).digest("hex"),
        opts.taille,
        opts.sha,
        opts.par,
      ],
    );
    await c.query(
      `INSERT INTO salle_depots (cabinet_id, piece_id, demande_id, client_id, fichier_id, origine, depose_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        s.a.cabinetId,
        opts.pieceId,
        l.rows[0].demande_id,
        l.rows[0].client_id,
        f.rows[0].id,
        opts.origine,
        opts.par,
      ],
    );
  });
}

describe("dates et tailles bornées", () => {
  it("échéance hors 2000-2100 et pièces trop volumineuses : 400, jamais 500", async () => {
    for (const hors of ["2101-01-01", "1999-12-31"]) {
      const r = await s.a.chef.post(`${salle(s.missionId)}/demandes`, {
        titre: "Échéance hors bornes",
        echeance: hors,
      });
      expect(r.statusCode, hors).toBe(400);
    }
    const brouillon = await s.a.chef.post(`${salle(s.missionId)}/demandes`, { titre: "Dates" });
    attendre(201, brouillon, "brouillon");
    expect(
      (
        await s.a.chef.patch(`${salle(s.missionId)}/demandes/${brouillon.json().id}`, {
          echeance: "2101-01-01",
        })
      ).statusCode,
    ).toBe(400);
    const grosses = Array.from({ length: 100 }, (_, i) => ({
      libelle: `Pièce ${i}`,
      description: "é".repeat(2000),
    }));
    expect(
      (await s.a.chef.post("/api/salle/modeles", { nom: "Énorme", pieces: grosses })).statusCode,
    ).toBe(400);
  });

  it("un CHECK de la base qui échapperait à Zod est traduit en 400 (23514), MPL06-09 en codes dédiés", () => {
    const e = traduireErreurSalle({ code: "23514" }) as { statut: number; code: string };
    expect([e.statut, e.code]).toEqual([400, "REQUETE_INVALIDE"]);
    const attendus: Record<string, [number, string]> = {
      MPL06: [409, "MISSION_CLOTUREE"],
      MPL07: [409, "DEPOTS_PLAFOND"],
      MPL08: [429, "DEPOTS_TROP_RAPIDES"],
      MPL09: [409, "ACCEPTATION_PAR_DEPOSANT"],
    };
    for (const [sqlstate, [statut, code]] of Object.entries(attendus)) {
      const t = traduireErreurSalle({ code: sqlstate, message: "x" }) as {
        statut: number;
        code: string;
      };
      expect([t.statut, t.code], sqlstate).toEqual([statut, code]);
    }
  });
});

describe("plafonds des dépôts, retrait par l'équipe, séparation des tâches", () => {
  let missionId: string;
  let d: DemandeCreee;

  const deposerCabinet = (pieceId: string, contenu: Buffer, nom = "piece.pdf") =>
    televerser(s.a.chef, `${salle(missionId)}/pieces/${pieceId}/depots`, nom, contenu);
  const url = (depotId: string) => `${salle(missionId)}/depots/${depotId}`;

  beforeAll(async () => {
    missionId = (await creerMissionSignee(s.a, { intitule: "Mission plafonds" })).id;
    d = await demandeEnvoyee(missionId, ["Plafond", "Retrait", "Séparation", "Volume"]);
  });

  it("vingt dépôts non rejetés par pièce : le vingt et unième est refusé (409, cabinet comme portail ; MPL07 en base)", async () => {
    const piece = d.pieces[0]!.id;
    for (let i = 0; i < 20; i += 1) {
      attendre(201, await deposerCabinet(piece, ECHANTILLONS.pdf(`plafond ${i}`)), `dépôt ${i}`);
    }
    const cabinet = await deposerCabinet(piece, ECHANTILLONS.pdf("plafond 20"));
    expect(cabinet.statusCode).toBe(409);
    expect(cabinet.json().erreur.code).toBe("DEPOTS_PLAFOND");
    const portail = await deposerPortail(
      s.contributeur,
      piece,
      ECHANTILLONS.pdf("plafond portail"),
    );
    expect(portail.statusCode).toBe(409);
    expect(portail.json().erreur.code).toBe("DEPOTS_PLAFOND");
    // Le déclencheur dit la même chose, hors de l'API.
    await expect(
      depotDirect({
        pieceId: piece,
        taille: 10,
        sha: "e".repeat(64),
        origine: "cabinet",
        par: s.a.chef.utilisateurId,
      }),
    ).rejects.toMatchObject({ code: "MPL07" });
  });

  it("le retrait d'un dépôt libère la place (droits, trace, fichier plus servi)", async () => {
    const piece = d.pieces[0]!.id;
    const vue = (await s.a.chef.get(`${salle(missionId)}/demandes/${d.id}`)).json();
    const depots = vue.pieces.find((p: { id: string }) => p.id === piece).depots as {
      id: string;
    }[];
    expect(depots).toHaveLength(20);
    const premier = depots[0]!.id;
    expect((await api(ctx).delete(url(premier))).statusCode).toBe(401);
    expect((await expert.delete(url(premier))).statusCode).toBe(403);
    expect((await s.b.associe.delete(url(premier))).statusCode).toBe(404);
    expect((await s.a.chef.delete(url(INCONNU))).statusCode).toBe(404);
    // Le portail n'atteint pas cette route.
    expect((await s.dirigeant.delete(url(premier))).statusCode).toBe(403);
    const r = await s.a.chef.delete(url(premier));
    attendre(200, r, "retrait");
    expect(
      r.json().pieces.find((p: { id: string }) => p.id === piece).depots[0].fichier,
    ).toBeNull();
    expect((await s.a.chef.get(`${url(premier)}/fichier`)).statusCode).toBe(404);
    expect((await s.a.chef.delete(url(premier))).statusCode).toBe(404);
    // Une place est libre : le contenu retiré se redépose.
    attendre(201, await deposerCabinet(piece, ECHANTILLONS.pdf("plafond 0")), "redépôt");
    const trace = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'salle_depot_retire' AND entite_id = $1",
            [premier],
          )
        ).rows[0].n as number,
    );
    expect(trace).toBe(1);
  });

  it("retrait d'un dépôt accepté refusé ; pièce sans fichier : acceptation refusée", async () => {
    const piece = d.pieces[1]!.id;
    const r = await deposerPortail(s.contributeur, piece, ECHANTILLONS.pdf("retrait 1"));
    attendre(201, r, "dépôt portail");
    attendre(
      200,
      await s.a.chef.post(`${salle(missionId)}/pieces/${piece}/accepter`, {}),
      "accepter",
    );
    expect((await s.a.chef.delete(url(r.json().depot_id))).statusCode).toBe(409);

    const piece2 = d.pieces[2]!.id;
    const r2 = await deposerPortail(s.contributeur, piece2, ECHANTILLONS.pdf("retrait 2"));
    attendre(201, r2, "dépôt portail 2");
    attendre(200, await s.a.chef.delete(url(r2.json().depot_id)), "retrait");
    const sans = await s.a.chef.post(`${salle(missionId)}/pieces/${piece2}/accepter`, {});
    expect(sans.statusCode).toBe(409);
    expect(sans.json().erreur.code).toBe("TRANSITION_REFUSEE");
    const vuePortail = await s.contributeur.get(`/api/portail/salle/demandes/${d.id}`);
    expect(vuePortail.json().pieces.find((p: { id: string }) => p.id === piece2).depots).toEqual(
      [],
    );
  });

  it("séparation des tâches : on n'accepte pas le dépôt qu'on a fait, sauf associé (API et base)", async () => {
    const piece = d.pieces[2]!.id;
    const depot = await deposerCabinet(piece, ECHANTILLONS.pdf("séparation"), "chef.pdf");
    attendre(201, depot, "dépôt de l'équipe");
    const refus = await s.a.chef.post(`${salle(missionId)}/pieces/${piece}/accepter`, {});
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("ACCEPTATION_PAR_DEPOSANT");
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO salle_piece_evenements (cabinet_id, piece_id, client_id, rang, statut, depot_id, par)
           SELECT $1, $2, x.client_id, 1, 'acceptee', x.id, $3 FROM salle_depots x WHERE x.id = $4`,
          [s.a.cabinetId, piece, s.a.chef.utilisateurId, depot.json().depot_id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPL09" });
    // Un autre membre accepte.
    attendre(
      200,
      await s.a.directeur.post(`${salle(missionId)}/pieces/${piece}/accepter`, {}),
      "acceptation par un autre membre",
    );
  });

  it("seul le dépôt retenu à l'acceptation se verse au dossier de mission", async () => {
    const piece = d.pieces[3]!.id;
    const premier = await deposerPortail(s.contributeur, piece, ECHANTILLONS.pdf("volume 1"));
    const second = await deposerPortail(s.dirigeant, piece, ECHANTILLONS.pdf("volume 2"));
    attendre(201, premier, "premier");
    attendre(201, second, "second");
    attendre(
      200,
      await s.a.chef.post(`${salle(missionId)}/pieces/${piece}/accepter`, {}),
      "accepter",
    );
    const refus = await s.a.chef.post(`${url(premier.json().depot_id)}/rattacher`, {});
    expect(refus.statusCode).toBe(409);
    attendre(
      201,
      await s.a.chef.post(`${url(second.json().depot_id)}/rattacher`, {}),
      "versement du dépôt retenu",
    );
  });

  it("GET /api/fichiers/:id : un fichier cité par un dépôt de la salle est traité comme rattaché (404)", async () => {
    const m = await creerMissionSignee(s.a, { intitule: "Mission fichiers cités" });
    const e = await demandeEnvoyee(m.id, ["Citée"]);
    const r = await televerser(
      s.a.chef,
      `${salle(m.id)}/pieces/${e.pieces[0]!.id}/depots`,
      "cite.pdf",
      ECHANTILLONS.pdf("fichier cité"),
    );
    attendre(201, r, "dépôt");
    const fichierId = await proprietaire(
      async (c) =>
        (await c.query("SELECT fichier_id FROM salle_depots WHERE id = $1", [r.json().depot_id]))
          .rows[0].fichier_id as string,
    );
    // L'auteur lui-même n'y accède plus par la route générique ; la route dédiée le sert.
    expect((await s.a.chef.get(`/api/fichiers/${fichierId}`)).statusCode).toBe(404);
    expect(
      (await s.a.chef.get(`${salle(m.id)}/depots/${r.json().depot_id}/fichier`)).statusCode,
    ).toBe(200);
  });

  it("le volume d'une demande se plafonne en octets (409 DEPOTS_PLAFOND, API et base)", async () => {
    const m = await creerMissionSignee(s.a, { intitule: "Mission volume" });
    const e = await demandeEnvoyee(m.id, [
      "Gros 1",
      "Gros 2",
      "Gros 3",
      "Gros 4",
      "Gros 5",
      "Autre",
    ]);
    // Un fichier pèse 100 Mo au plus (CHECK de 0070) : cinq dépôts fictifs laissent 600 octets.
    const tailles = [104_857_600, 104_857_600, 104_857_600, 104_857_600, 104_857_000];
    for (const [i, taille] of tailles.entries()) {
      await depotDirect({
        pieceId: e.pieces[i]!.id,
        taille,
        sha: `${i + 1}`.repeat(64),
        origine: "cabinet",
        par: s.a.chef.utilisateurId,
      });
    }
    // Base : 1 000 octets de plus dépassent les 500 Mo (524 288 000 octets).
    await expect(
      depotDirect({
        pieceId: e.pieces[5]!.id,
        taille: 1_000,
        sha: "b".repeat(64),
        origine: "cabinet",
        par: s.a.chef.utilisateurId,
      }),
    ).rejects.toMatchObject({ code: "MPL07" });
    // API : un vrai fichier dépasse la marge restante.
    const r = await televerser(
      s.a.chef,
      `${salle(m.id)}/pieces/${e.pieces[5]!.id}/depots`,
      "grand.pdf",
      ECHANTILLONS.pdf("x".repeat(2000)),
    );
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("DEPOTS_PLAFOND");
  });
});

describe("clôture de la mission et salle", () => {
  it("la clôture clôt les demandes envoyées ; plus aucun dépôt (portail, cabinet) ; garde en base", async () => {
    const mission = (await creerMissionSignee(s.a, { intitule: "Mission à clôturer" })).id;
    const creer = async (envoyer: boolean) => {
      const r = await s.a.chef.post(`${salle(mission)}/demandes`, {
        titre: envoyer ? "Envoyée" : "Brouillon",
        echeance: ajouterJours(aujourdhui, 15),
        pieces: [{ libelle: "Pièce" }],
      });
      attendre(201, r, "demande");
      if (envoyer) {
        attendre(
          200,
          await s.a.chef.post(`${salle(mission)}/demandes/${r.json().id}/envoyer`),
          "envoi",
        );
      }
      return { id: r.json().id as string, piece: r.json().pieces[0].id as string };
    };
    const envoyee = await creer(true);
    const brouillon = await creer(false);
    attendre(
      201,
      await deposerPortail(s.dirigeant, envoyee.piece, ECHANTILLONS.pdf("avant clôture")),
      "dépôt avant clôture",
    );
    for (const statut of ["en_cours", "a_cloturer"]) {
      attendre(
        200,
        await s.a.directeur.post(`/api/missions/${mission}/statut`, { statut }),
        statut,
      );
    }
    attendre(200, await s.a.directeur.post(`/api/missions/${mission}/cloturer`), "clôture");

    const apres = (await s.a.chef.get(`${salle(mission)}/demandes/${envoyee.id}`)).json();
    expect(apres.statut).toBe("close");
    expect(apres.close_par).toBe(s.a.directeur.utilisateurId);
    expect((await s.a.chef.get(`${salle(mission)}/demandes/${brouillon.id}`)).json().statut).toBe(
      "brouillon",
    );
    const trace = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE action = 'salle_demande_cloture' AND entite_id = $1",
            [envoyee.id],
          )
        ).rows,
    );
    expect(trace).toHaveLength(1);
    expect(trace[0].details).toMatchObject({ cause: "cloture_mission" });

    // Portail : refus (demande close). Cabinet : 409 « mission clôturée » (écriture).
    expect(
      (await deposerPortail(s.dirigeant, envoyee.piece, ECHANTILLONS.pdf("après clôture")))
        .statusCode,
    ).toBe(409);
    const cabinet = await televerser(
      s.a.chef,
      `${salle(mission)}/pieces/${envoyee.piece}/depots`,
      "tard.pdf",
      ECHANTILLONS.pdf("après clôture cabinet"),
    );
    expect(cabinet.statusCode).toBe(409);
    expect(cabinet.json().erreur.message).toContain("clôturée");
    // Un brouillon ne s'envoie plus (API et base) ; une demande ne se crée plus.
    expect(
      (await s.a.chef.post(`${salle(mission)}/demandes/${brouillon.id}/envoyer`)).statusCode,
    ).toBe(409);
    await expect(
      proprietaire((c) =>
        c.query(
          "UPDATE salle_demandes SET statut = 'envoyee', envoyee_par = $2, envoyee_le = now() WHERE id = $1",
          [brouillon.id, s.a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPL06" });
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO salle_demandes (cabinet_id, mission_id, client_id, titre, cree_par)
           VALUES ($1, $2, $3, 'Tardive', $4)`,
          [s.a.cabinetId, mission, s.a.clientId, s.a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPL06" });
  });

  it("en base, une mission ne se clôt pas tant qu'une de ses demandes est envoyée (MPL06)", async () => {
    const m = await creerMissionSignee(s.a, { intitule: "Mission clôture directe" });
    await demandeEnvoyee(m.id, ["Pièce"]);
    await expect(
      proprietaire((c) =>
        c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [
          m.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPL06" });
  });
});

describe("débit des dépôts du portail", () => {
  it("trente dépôts par fenêtre et par utilisateur : le suivant est refusé (429 ; MPL08 en base)", async () => {
    const m = await creerMissionSignee(s.a, { intitule: "Mission débit" });
    const e = await demandeEnvoyee(
      m.id,
      Array.from({ length: 32 }, (_, i) => `Pièce ${i}`),
    );
    const dirigeantId = s.dirigeant.utilisateurId;
    const avant = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM salle_depots WHERE depose_par = $1 AND depose_le > now() - interval '10 minutes'",
            [dirigeantId],
          )
        ).rows[0].n as number,
    );
    for (let i = 0; i < 30 - avant; i += 1) {
      await depotDirect({
        pieceId: e.pieces[i]!.id,
        taille: 10,
        sha: `${i}`.padStart(64, "d"),
        origine: "portail",
        par: dirigeantId,
      });
    }
    await expect(
      depotDirect({
        pieceId: e.pieces[30]!.id,
        taille: 10,
        sha: "f".repeat(64),
        origine: "portail",
        par: dirigeantId,
      }),
    ).rejects.toMatchObject({ code: "MPL08" });
    const refus = await deposerPortail(
      s.dirigeant,
      e.pieces[31]!.id,
      ECHANTILLONS.pdf("trop vite"),
    );
    expect(refus.statusCode).toBe(429);
    expect(refus.json().erreur.code).toBe("DEPOTS_TROP_RAPIDES");
    // Un autre utilisateur du même client n'est pas touché.
    attendre(
      201,
      await deposerPortail(s.contributeur, e.pieces[31]!.id, ECHANTILLONS.pdf("autre utilisateur")),
      "autre utilisateur",
    );
  });
});
