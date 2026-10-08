import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ajouterJours } from "@missionpilot/engines";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { relanceSalleMission, TYPE_JOB_RELANCE_SALLE } from "../src/salle-mission/relances.js";
import { paliersAVenir, synthesePieces } from "../src/salle-mission/regles.js";
import { api, type Api } from "./api.js";
import { demarrerAvecStockage, ECHANTILLONS, televerser } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { creerMission, type ApiUtilisateur } from "./missions-outils.js";
import {
  attendre,
  CLE_INTERDITE,
  clesDe,
  preparerPortail,
  type ScenarioPortail,
} from "./portail-outils.js";

/*
 * Salle de mission (CLI-01) : demandes documentaires, dépôt par le client depuis le portail,
 * accusé de réception R0, relances graduées, décisions de l'équipe, versement au dossier de
 * mission. Accès : 401, 403, autre cabinet, autre client, brouillon (même 404 au portail) ;
 * défense en base : ajout seul, transitions, RLS du portail.
 */

let ctx: Contexte & { dossier: string };
let s: ScenarioPortail;
let consultantHorsEquipe: ApiUtilisateur;
let expert: ApiUtilisateur;
const INCONNU = "00000000-0000-4000-8000-000000000000";
const aujourdhui = new Date().toISOString().slice(0, 10);
const echeance = ajouterJours(aujourdhui, 10);
let demandeId: string;
let pieces: { id: string; libelle: string }[];
let brouillonId: string;

const salle = (missionId = s.missionId) => `/api/missions/${missionId}/salle`;
const detail = (id = demandeId) => `${salle()}/demandes/${id}`;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerPortail(ctx);
  consultantHorsEquipe = await s.a.avecRoles(["consultant"]);
  expert = await s.a.avecRoles(["expert_metier"]);
  // Expert dans l'équipe de la mission : il lit la salle sans pouvoir la gérer.
  attendre(
    201,
    await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, {
      utilisateur_id: expert.utilisateurId,
    }),
    "équipe",
  );
}, 240_000);

afterAll(async () => {
  // Jobs de relance non exécutés : retirés (base de test partagée, voir jobs.test.ts).
  await proprietaire((c) => c.query("DELETE FROM jobs WHERE type = $1", [TYPE_JOB_RELANCE_SALLE]));
  await ctx.fermer();
});

async function notifications(utilisateurId: string, type: string) {
  return proprietaire(
    async (c) =>
      (
        await c.query(
          "SELECT id, titre, corps, lien FROM notifications WHERE destinataire_id = $1 AND type = $2 ORDER BY cree_le",
          [utilisateurId, type],
        )
      ).rows as { id: string; titre: string; corps: string; lien: string }[],
  );
}

async function deposer(u: Api, pieceId: string, contenu: Buffer, nom = "piece.pdf") {
  return televerser(u, `/api/portail/salle/pieces/${pieceId}/depots`, nom, contenu);
}

describe("règles pures", () => {
  it("synthèse par statut et paliers à venir", () => {
    expect(
      synthesePieces([
        { statut: "demandee", obligatoire: true },
        { statut: "acceptee", obligatoire: true },
        { statut: "rejetee", obligatoire: false },
      ]),
    ).toEqual({
      total: 3,
      demandee: 1,
      recue: 0,
      acceptee: 1,
      rejetee: 1,
      obligatoires_restantes: 1,
    });
    const p = paliersAVenir("2027-03-10", new Date("2027-03-08T00:00:00Z"));
    expect(p.map((x) => [x.palier, x.executeA.toISOString()])).toEqual([
      ["relance_j_plus_1", "2027-03-11T08:00:00.000Z"],
      ["relance_j_plus_7", "2027-03-17T08:00:00.000Z"],
    ]);
  });
});

describe("accès côté cabinet", () => {
  it("401 sans session, 403 sans droit, 404 hors équipe ou autre cabinet", async () => {
    expect((await api(ctx).get(salle())).statusCode).toBe(401);
    expect((await s.a.gestionnaire.get(salle())).statusCode).toBe(403);
    expect((await consultantHorsEquipe.get(salle())).statusCode).toBe(404);
    expect((await s.b.associe.get(salle())).statusCode).toBe(404);
    expect((await expert.post(`${salle()}/demandes`, { titre: "x" })).statusCode).toBe(403);
    const r = await s.a.chef.get(salle());
    attendre(200, r, "salle");
    expect(r.json().demandes).toEqual([]);
    expect(
      r
        .json()
        .destinataires.map((d: { id: string }) => d.id)
        .sort(),
    ).toEqual([s.dirigeant.utilisateurId, s.contributeur.utilisateurId].sort());
  });
});

describe("modèles et préparation d'une demande", () => {
  it("modèle du cabinet, demande depuis le modèle et pièces saisies", async () => {
    const m = await s.a.chef.post("/api/salle/modeles", {
      nom: "Diagnostic financier",
      pieces: [
        { libelle: "États financiers 2025" },
        { libelle: "Organigramme", obligatoire: false },
      ],
    });
    attendre(201, m, "modèle");
    expect(
      (await s.b.associe.patch(`/api/salle/modeles/${m.json().id}`, { nom: "x" })).statusCode,
    ).toBe(404);
    expect(
      (await s.a.chef.post("/api/salle/modeles", { nom: "Vide", pieces: [] })).statusCode,
    ).toBe(400);
    const liste = await s.a.chef.get("/api/salle/modeles");
    expect(liste.json().elements.map((x: { nom: string }) => x.nom)).toEqual([
      "Diagnostic financier",
    ]);

    const d = await s.a.chef.post(`${salle()}/demandes`, {
      titre: "Pièces du diagnostic",
      message: "Merci de déposer ces pièces.",
      modele_id: m.json().id,
      pieces: [{ libelle: "Statuts", description: "Version à jour" }],
    });
    attendre(201, d, "demande");
    demandeId = d.json().id;
    expect(d.json().statut).toBe("brouillon");
    pieces = d.json().pieces;
    expect(pieces.map((p) => p.libelle)).toEqual([
      "États financiers 2025",
      "Organigramme",
      "Statuts",
    ]);
    // Autre cabinet : même 404.
    expect((await s.b.associe.get(detail())).statusCode).toBe(404);

    const b = await s.a.chef.post(`${salle()}/demandes`, { titre: "Brouillon resté interne" });
    attendre(201, b, "brouillon");
    brouillonId = b.json().id;
  });

  it("brouillon modifiable ; envoi exige une échéance future et des destinataires", async () => {
    attendre(200, await s.a.chef.patch(detail(), { titre: "Pièces du diagnostic 2026" }), "titre");
    const ajout = await s.a.chef.post(`${detail()}/pieces`, { libelle: "Temporaire" });
    attendre(201, ajout, "pièce");
    const temporaire = ajout
      .json()
      .pieces.find((p: { libelle: string }) => p.libelle === "Temporaire");
    attendre(200, await s.a.chef.delete(`${salle()}/pieces/${temporaire.id}`), "retrait pièce");

    const sansEcheance = await s.a.chef.post(`${detail()}/envoyer`);
    expect(sansEcheance.statusCode).toBe(400);
    attendre(200, await s.a.chef.patch(detail(), { echeance: "2020-01-01" }), "échéance passée");
    expect((await s.a.chef.post(`${detail()}/envoyer`)).statusCode).toBe(400);
    attendre(200, await s.a.chef.patch(detail(), { echeance }), "échéance");

    // Brouillon vide : pas d'envoi.
    expect((await s.a.chef.post(`${detail(brouillonId)}/envoyer`)).statusCode).toBe(400);
  });

  it("envoi : notification et e-mail aux dirigeant et contributeur, relances mises en file", async () => {
    const r = await s.a.chef.post(`${detail()}/envoyer`);
    attendre(200, r, "envoi");
    expect(r.json().statut).toBe("envoyee");
    for (const u of [s.dirigeant, s.contributeur]) {
      const n = await notifications(u.utilisateurId, "salle_demande");
      expect(n).toHaveLength(1);
      expect(n[0]?.lien).toBe(`/portail/salle/${demandeId}`);
      expect((ctx.app.mailer as MailerJournal).dernierPour(u.email)?.sujet).toContain(
        "Documents demandés",
      );
    }
    expect(await notifications(s.investisseur.utilisateurId, "salle_demande")).toEqual([]);
    const jobs = await proprietaire(async (c) =>
      (
        await c.query("SELECT cle FROM jobs WHERE type = $1 ORDER BY execute_a", [
          TYPE_JOB_RELANCE_SALLE,
        ])
      ).rows.map((l) => l.cle as string),
    );
    expect(jobs).toEqual(
      ["rappel_j_moins_3", "relance_j_plus_1", "relance_j_plus_7"].map(
        (p) => `salle_relance:${demandeId}:${p}:${echeance}`,
      ),
    );
    // Envoyée : titre et pièces figés, plus de suppression.
    expect((await s.a.chef.patch(detail(), { titre: "Autre" })).json().erreur.code).toBe(
      "DEMANDE_FIGEE",
    );
    expect(
      (await s.a.chef.patch(`${salle()}/pieces/${pieces[0]?.id}`, { libelle: "x" })).statusCode,
    ).toBe(409);
    expect((await s.a.chef.delete(detail())).statusCode).toBe(409);
  });
});

describe("portail : lecture", () => {
  it("le client ne voit que SES demandes envoyées, sans donnée interne", async () => {
    const liste = await s.dirigeant.get("/api/portail/salle/demandes");
    attendre(200, liste, "liste portail");
    expect(liste.json().elements.map((d: { id: string }) => d.id)).toEqual([demandeId]);
    const vue = await s.contributeur.get(`/api/portail/salle/demandes/${demandeId}`);
    attendre(200, vue, "détail portail");
    expect(vue.json().pieces).toHaveLength(3);
    expect(clesDe(vue.json()).filter((k) => CLE_INTERDITE.test(k))).toEqual([]);
    expect(clesDe(liste.json()).filter((k) => CLE_INTERDITE.test(k))).toEqual([]);
    expect(JSON.stringify(vue.json())).not.toContain("mission_id");
    // Brouillon, autre client, autre cabinet, inexistant : le même 404.
    for (const [u, id] of [
      [s.dirigeant, brouillonId],
      [s.dirigeantA2, demandeId],
      [s.dirigeantB, demandeId],
      [s.dirigeant, INCONNU],
    ] as const) {
      const r = await u.get(`/api/portail/salle/demandes/${id}`);
      expect(r.statusCode, id).toBe(404);
      expect(r.json().erreur.code).toBe("INTROUVABLE");
    }
    expect((await s.dirigeantA2.get("/api/portail/salle/demandes")).json().elements).toEqual([]);
    expect((await s.investisseur.get("/api/portail/salle/demandes")).statusCode).toBe(403);
    // Un utilisateur du cabinet n'utilise pas les routes du portail.
    expect((await s.a.chef.get("/api/portail/salle/demandes")).statusCode).toBe(403);
    // Et le portail n'atteint pas la vue interne.
    expect((await s.dirigeant.get(salle())).json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
  });
});

describe("portail : dépôt, accusé de réception, décisions", () => {
  const contenu1 = ECHANTILLONS.pdf("etats financiers v1");

  it("dépôt du contributeur : pièce reçue, accusé R0 au déposant, équipe informée", async () => {
    const piece = pieces[0]!.id;
    const r = await deposer(s.contributeur, piece, contenu1, "etats-2025.pdf");
    attendre(201, r, "dépôt");
    expect(r.json().nouveau).toBe(true);
    const p = r.json().pieces.find((x: { id: string }) => x.id === piece);
    expect(p.statut).toBe("recue");
    expect(p.depots).toHaveLength(1);
    expect(p.depots[0].depose_par_moi).toBe(true);
    expect(clesDe(r.json()).filter((k) => CLE_INTERDITE.test(k))).toEqual([]);

    const accuse = await notifications(s.contributeur.utilisateurId, "salle_accuse_reception");
    expect(accuse).toHaveLength(1);
    expect(accuse[0]?.corps).toContain("etats-2025.pdf");
    expect((ctx.app.mailer as MailerJournal).dernierPour(s.contributeur.email)?.sujet).toContain(
      "Accusé de réception",
    );
    expect(await notifications(s.a.chef.utilisateurId, "salle_piece_recue")).toHaveLength(1);
    const trace = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT a.statut, a.classe_risque, j.utilisateur_id FROM salle_accuses a
             JOIN journal_audit j ON j.entite_id = a.depot_id::text AND j.action = 'accuse_reception'
             WHERE a.depot_id = $1`,
            [r.json().depot_id],
          )
        ).rows,
    );
    expect(trace).toEqual([{ statut: "envoye", classe_risque: "R0", utilisateur_id: null }]);
    // Le dirigeant voit le dépôt de son collègue, avec l'accusé.
    const vue = await s.dirigeant.get(`/api/portail/salle/demandes/${demandeId}`);
    const d = vue.json().pieces[0].depots[0];
    expect(d.depose_par_moi).toBe(false);
    expect(d.accuse_le).not.toBeNull();
    // Le fichier n'est pas orphelin (purge à 24 h).
    const orphelin = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT fichier_orphelin(fichier_id) AS o FROM salle_depots WHERE id = $1",
            [r.json().depot_id],
          )
        ).rows[0].o,
    );
    expect(orphelin).toBe(false);
  });

  it("rejeu du même fichier : sans effet (200) ; autres clients et types refusés", async () => {
    const piece = pieces[0]!.id;
    const r = await deposer(s.contributeur, piece, contenu1, "etats-2025.pdf");
    attendre(200, r, "rejeu");
    expect(r.json().nouveau).toBe(false);
    expect(r.json().pieces[0].depots).toHaveLength(1);
    expect(
      await notifications(s.contributeur.utilisateurId, "salle_accuse_reception"),
    ).toHaveLength(1);
    expect((await deposer(s.dirigeantA2, piece, ECHANTILLONS.pdf("a2"))).statusCode).toBe(404);
    expect((await deposer(s.dirigeantB, piece, ECHANTILLONS.pdf("b"))).statusCode).toBe(404);
    expect((await deposer(s.investisseur, piece, ECHANTILLONS.pdf("i"))).statusCode).toBe(403);
    const exe = await deposer(s.dirigeant, pieces[1]!.id, ECHANTILLONS.exe(), "outil.pdf");
    expect(exe.statusCode).toBe(415);
    // Pièce d'une demande en brouillon : 404 (invisible au portail).
    const brouillon = await s.a.chef.post(`${detail(brouillonId)}/pieces`, { libelle: "Bilan" });
    attendre(201, brouillon, "pièce du brouillon");
    const pieceBrouillon = brouillon.json().pieces[0].id as string;
    expect((await deposer(s.dirigeant, pieceBrouillon, ECHANTILLONS.pdf("tot"))).statusCode).toBe(
      404,
    );
  });

  it("l'équipe télécharge le dépôt ; décisions réservées et transitions contrôlées", async () => {
    const vue = await s.a.chef.get(detail());
    const p = vue.json().pieces[0];
    const depot = p.depots[0];
    expect(depot.origine).toBe("portail");
    expect(depot.accuse.statut).toBe("envoye");
    const f = await s.a.chef.get(`${salle()}/depots/${depot.id}/fichier`);
    attendre(200, f, "téléchargement");
    expect(f.rawPayload.equals(contenu1)).toBe(true);
    expect(f.headers["x-content-type-options"]).toBe("nosniff");
    expect(f.headers["content-disposition"]).toContain("attachment");
    expect((await s.b.associe.get(`${salle()}/depots/${depot.id}/fichier`)).statusCode).toBe(404);
    expect((await s.a.gestionnaire.get(`${salle()}/depots/${depot.id}/fichier`)).statusCode).toBe(
      403,
    );

    expect((await expert.post(`${salle()}/pieces/${p.id}/accepter`, {})).statusCode).toBe(403);
    const demandee = await s.a.chef.post(`${salle()}/pieces/${pieces[2]!.id}/accepter`, {});
    expect(demandee.json().erreur.code).toBe("TRANSITION_REFUSEE");
    expect((await s.a.chef.post(`${salle()}/pieces/${p.id}/rejeter`, {})).statusCode).toBe(400);
  });

  it("rejet motivé, nouveau dépôt, acceptation et versement au dossier de mission", async () => {
    const piece = pieces[0]!.id;
    const rejet = await s.a.chef.post(`${salle()}/pieces/${piece}/rejeter`, {
      motif: "Exercice 2024 au lieu de 2025.",
    });
    attendre(200, rejet, "rejet");
    expect(rejet.json().pieces[0].statut).toBe("rejetee");
    const portail = await s.contributeur.get(`/api/portail/salle/demandes/${demandeId}`);
    expect(portail.json().pieces[0].motif_rejet).toBe("Exercice 2024 au lieu de 2025.");
    expect(await notifications(s.contributeur.utilisateurId, "salle_piece_rejetee")).toHaveLength(
      1,
    );

    const identique = await deposer(s.contributeur, piece, contenu1, "etats-2025.pdf");
    expect(identique.json().erreur.code).toBe("CONTENU_IDENTIQUE");
    attendre(201, await deposer(s.dirigeant, piece, ECHANTILLONS.pdf("v2"), "etats-v2.pdf"), "v2");

    const accept = await s.a.chef.post(`${salle()}/pieces/${piece}/accepter`, { rattacher: true });
    attendre(200, accept, "acceptation");
    expect(accept.json().pieces[0].statut).toBe("acceptee");
    const documentId = accept.json().document_id as string;
    expect(documentId).toMatch(/^[0-9a-f-]{36}$/);
    const docs = await s.a.chef.get(`/api/missions/${s.missionId}/documents?type=autre`);
    expect(docs.json().elements.map((d: { id: string; nom: string }) => [d.id, d.nom])).toEqual([
      [documentId, "États financiers 2025"],
    ]);
    // Le dépôt versé est lisible par la route des fichiers (document de mission visible).
    const versee = accept
      .json()
      .pieces[0].depots.find((d: { document_id: string | null }) => d.document_id);
    expect((await s.a.chef.get(`/api/fichiers/${versee.fichier.id}`)).statusCode).toBe(200);
    // Non partagé : le livrable n'apparaît pas au portail.
    const livrables = await s.dirigeant.get(`/api/portail/missions/${s.missionId}/livrables`);
    expect(livrables.json().elements.map((l: { id: string }) => l.id)).not.toContain(documentId);
    // Un dépôt ne se verse qu'une fois ; pièce acceptée : plus de dépôt.
    expect((await s.a.chef.post(`${salle()}/depots/${versee.id}/rattacher`, {})).statusCode).toBe(
      409,
    );
    const tard = await deposer(s.dirigeant, piece, ECHANTILLONS.pdf("v3"));
    expect(tard.statusCode).toBe(409);
  });

  it("pièce reçue hors portail : déposée par l'équipe, sans accusé", async () => {
    const r = await televerser(
      s.a.chef,
      `${salle()}/pieces/${pieces[1]!.id}/depots`,
      "organigramme.png",
      ECHANTILLONS.png(),
    );
    attendre(201, r, "dépôt cabinet");
    const p = r.json().pieces.find((x: { id: string }) => x.id === pieces[1]!.id);
    expect(p.statut).toBe("recue");
    expect(p.depots[0].origine).toBe("cabinet");
    expect(p.depots[0].accuse).toBeNull();
    expect(
      (
        await televerser(
          expert,
          `${salle()}/pieces/${pieces[1]!.id}/depots`,
          "x.png",
          ECHANTILLONS.png(),
        )
      ).statusCode,
    ).toBe(403);
  });

  it("coupe-circuit N4 actif : l'accusé de réception est suspendu et tracé", async () => {
    attendre(
      200,
      await s.a.associe.put("/api/agents/coupe-circuit", { actif: true, motif: "Essai" }),
      "coupe-circuit",
    );
    const avant = (await notifications(s.dirigeant.utilisateurId, "salle_accuse_reception")).length;
    const r = await deposer(s.dirigeant, pieces[2]!.id, ECHANTILLONS.pdf("statuts"), "statuts.pdf");
    attendre(201, r, "dépôt sous coupe-circuit");
    expect(await notifications(s.dirigeant.utilisateurId, "salle_accuse_reception")).toHaveLength(
      avant,
    );
    const statut = await proprietaire(
      async (c) =>
        (await c.query("SELECT statut FROM salle_accuses WHERE depot_id = $1", [r.json().depot_id]))
          .rows[0]?.statut,
    );
    expect(statut).toBe("suspendu");
    attendre(
      200,
      await s.a.associe.put("/api/agents/coupe-circuit", { actif: false, motif: "Fin de l'essai" }),
      "levée",
    );
  });
});

describe("relances", () => {
  const registre = creerRegistre({ [TYPE_JOB_RELANCE_SALLE]: relanceSalleMission });
  async function executerA(quand: Date) {
    const worker = new WorkerJobs(ctx.db, {
      mailer: new MailerJournal(),
      registre,
      horloge: () => quand,
    });
    const resultats = [];
    for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
    return resultats;
  }
  const relances = () =>
    proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT palier, destinataire_id FROM salle_relances WHERE demande_id = $1 ORDER BY cree_le, palier",
            [demandeId],
          )
        ).rows as { palier: string; destinataire_id: string }[],
    );

  it("une nouvelle demande attend des pièces : relance manuelle, au plus une par 24 h", async () => {
    // La demande principale n'a plus de pièce en attente de dépôt : nouvelle pièce ajoutée.
    attendre(
      201,
      await s.a.chef.post(`${detail()}/pieces`, { libelle: "Contrats clients" }),
      "pièce",
    );
    const r = await s.a.chef.post(`${detail()}/relancer`, {});
    attendre(200, r, "relance");
    expect(r.json().relances).toBe(2);
    expect((await s.a.chef.post(`${detail()}/relancer`, {})).statusCode).toBe(409);
    expect((await expert.post(`${detail()}/relancer`, {})).statusCode).toBe(403);
  });

  it("paliers automatiques idempotents ; alerte de l'équipe à J+7", async () => {
    const lendemain = new Date(`${ajouterJours(echeance, 1)}T09:00:00Z`);
    await executerA(lendemain);
    const apres = await relances();
    const auto = apres.filter((x) => x.palier !== "manuelle");
    expect(auto.map((x) => x.palier).sort()).toEqual([
      "rappel_j_moins_3",
      "rappel_j_moins_3",
      "relance_j_plus_1",
      "relance_j_plus_1",
    ]);
    await executerA(lendemain);
    expect(await relances()).toHaveLength(apres.length);
    await executerA(new Date(`${ajouterJours(echeance, 8)}T09:00:00Z`));
    expect((await relances()).filter((x) => x.palier === "relance_j_plus_7")).toHaveLength(2);
    expect(await notifications(s.a.chef.utilisateurId, "salle_alerte_echeance")).toHaveLength(1);
  });

  it("prolongation : nouveaux paliers pour la nouvelle échéance", async () => {
    const nouvelle = ajouterJours(echeance, 30);
    attendre(200, await s.a.chef.patch(detail(), { echeance: nouvelle }), "prolongation");
    const cles = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT cle FROM jobs WHERE cle LIKE $1", [
            `salle_relance:${demandeId}:%:${nouvelle}`,
          ])
        ).rows.length,
    );
    expect(cles).toBe(3);
  });
});

describe("clôture et défense en base", () => {
  it("demande close : plus de dépôt ni de modification", async () => {
    attendre(200, await s.a.chef.post(`${detail()}/cloturer`), "clôture");
    const vue = await s.a.chef.get(detail());
    const enAttente = vue.json().pieces.find((p: { statut: string }) => p.statut === "demandee");
    const r = await deposer(s.dirigeant, enAttente.id, ECHANTILLONS.pdf("tard"));
    expect(r.statusCode).toBe(409);
    expect((await s.a.chef.patch(detail(), { relances_auto: false })).statusCode).toBe(409);
    // Toujours lisible au portail (statut clos).
    expect((await s.dirigeant.get(`/api/portail/salle/demandes/${demandeId}`)).json().statut).toBe(
      "close",
    );
  });

  it("historiques en ajout seul, transitions et écriture du portail contrôlées", async () => {
    // Dépôt de l'équipe : sa pièce est encore « reçue » (une décision y serait possible).
    const depot = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT id, piece_id, client_id FROM salle_depots WHERE demande_id = $1 AND origine = 'cabinet'",
            [demandeId],
          )
        ).rows[0] as { id: string; piece_id: string; client_id: string },
    );
    await expect(
      proprietaire((c) =>
        c.query("UPDATE salle_depots SET origine = 'cabinet' WHERE id = $1", [depot.id]),
      ),
    ).rejects.toMatchObject({ code: "MPL01" });
    await expect(
      proprietaire((c) =>
        c.query("DELETE FROM salle_piece_evenements WHERE piece_id = $1", [depot.piece_id]),
      ),
    ).rejects.toMatchObject({ code: "MPL01" });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE salle_piece_evenements SET motif = 'x' WHERE piece_id = $1", [
          depot.piece_id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Une pièce demandée ne s'accepte pas (MPL02), même hors de l'API.
    const m = await creerMission(s.a, { intitule: "Mission salle 2" });
    const autre = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      const d = await db.query(
        `INSERT INTO salle_demandes (cabinet_id, mission_id, client_id, titre, cree_par)
         VALUES ($1, $2, $3, 'Essai', $4) RETURNING id`,
        [s.a.cabinetId, m.id, s.a.clientId, s.a.chef.utilisateurId],
      );
      return { missionId: m.id, demandeId: d.rows[0].id as string };
    });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO salle_demandes (cabinet_id, mission_id, client_id, titre, cree_par)
           VALUES ($1, $2, $3, 'Mauvais client', $4)`,
          [s.a.cabinetId, autre.missionId, s.clientA2, s.a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPL04" });
    // Contexte du portail : aucune décision, aucun brouillon visible.
    const commePortail = <T>(
      fn: (db: Parameters<Parameters<typeof ctx.db.withTenant>[1]>[0]) => Promise<T>,
    ) =>
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query(
          `SELECT set_config('app.portail_client_id', $1, true),
             set_config('app.portail_utilisateur_id', $2, true)`,
          [s.a.clientId, s.dirigeant.utilisateurId],
        );
        return fn(db);
      });
    expect(
      (
        await commePortail((db) =>
          db.query("SELECT id FROM salle_demandes WHERE id = $1", [autre.demandeId]),
        )
      ).rowCount,
    ).toBe(0);
    expect((await commePortail((db) => db.query("SELECT id FROM salle_relances"))).rowCount).toBe(
      0,
    );
    expect((await commePortail((db) => db.query("SELECT id FROM salle_modeles"))).rowCount).toBe(0);
    await expect(
      commePortail((db) =>
        db.query(
          `INSERT INTO salle_piece_evenements (cabinet_id, piece_id, client_id, rang, statut, depot_id, par)
           VALUES ($1, $2, $3, 1, 'acceptee', $4, $5)`,
          [s.a.cabinetId, depot.piece_id, depot.client_id, depot.id, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      commePortail((db) =>
        db.query(
          `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
           VALUES ($1, $2, 'x.pdf', 'application/pdf', 1, $3, $4)`,
          [s.a.cabinetId, "a".repeat(32), "b".repeat(64), s.a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
