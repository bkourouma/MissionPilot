/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { attendu, cloturerMission, INCONNU } from "./dd-outils.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { CLE_INTERDITE, clesDe } from "./portail-outils.js";
import {
  changerOption,
  inviter,
  noteSoumise,
  preparerPortailDd,
  rapportNote,
  urlEtat,
  urlInvitations,
  urlListePortail,
  urlPiecePortail,
  urlPublicationPortail,
  urlPublier,
  type NoteValidee,
  type ScenarioPortailDd,
} from "./portail-dd-outils.js";

/*
 * Portail investisseur de la due diligence (migration 0509), par l'API : droits par rôle (cabinet et
 * portail), option DÉSACTIVÉE par défaut, invitation d'un compte sur un dossier, publication d'une
 * version VALIDÉE (instantané copié par le serveur) avec ses pièces, lecture et téléchargement par
 * l'investisseur invité, 404 uniforme (non invité, autre client, autre cabinet, option désactivée,
 * retrait, pièce d'une autre publication), effet IMMÉDIAT des retraits, routes du cabinet fermées
 * au portail, aucune clé interne dans les réponses, journalisation.
 */

let ctx: Contexte & { dossier: string };
let p: ScenarioPortailDd;
let note: NoteValidee;
let executive: { rapportId: string; fichierId: string };
let detaillee: { rapportId: string; fichierId: string };
let publicationId: string;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  p = await preparerPortailDd(ctx, "DD portail");
  note = await noteSoumise(p.s);
  executive = await rapportNote(p.s.consultantEquipe, note.noteId, "executive");
  detaillee = await rapportNote(p.s.consultantEquipe, note.noteId, "detaillee");
}, 300_000);
afterAll(() => ctx.fermer());

describe("option du cabinet", () => {
  it("désactivée par défaut ; lecture par associé et directeur ; 403 pour les autres rôles", async () => {
    const r = attendu(200, await p.s.a.associe.get("/api/dd/portail/option"));
    expect(r).toEqual({ actif: false, modifie_le: null });
    expect((await p.s.a.directeur.get("/api/dd/portail/option")).statusCode).toBe(200);
    for (const u of [p.s.a.chef, p.s.consultantEquipe, p.s.expertMetier, p.s.gestionnaire]) {
      expect((await u.get("/api/dd/portail/option")).statusCode).toBe(403);
    }
    expect((await api(ctx).get("/api/dd/portail/option")).statusCode).toBe(401);
  });

  it("changement par l'associé SEUL ; un changement sans effet n'inscrit rien ; isolée par cabinet", async () => {
    expect((await p.s.a.directeur.post("/api/dd/portail/option", { actif: true })).statusCode).toBe(
      403,
    );
    expect((await p.s.a.associe.post("/api/dd/portail/option", { actif: "oui" })).statusCode).toBe(
      400,
    );
    const avant = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT count(*)::int AS n FROM dd_portail_options WHERE cabinet_id = $1", [
            p.s.a.cabinetId,
          ])
        ).rows[0].n as number,
    );
    expect((await changerOption(p.s.a.associe, false)).actif).toBe(false);
    const on = await changerOption(p.s.a.associe, true);
    expect(on.actif).toBe(true);
    expect(typeof on.modifie_le).toBe("string");
    expect((await changerOption(p.s.a.associe, true)).modifie_le).toBe(on.modifie_le);
    const apres = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT count(*)::int AS n FROM dd_portail_options WHERE cabinet_id = $1", [
            p.s.a.cabinetId,
          ])
        ).rows[0].n as number,
    );
    expect(apres).toBe(avant + 1);
    // Le cabinet B n'est pas touché.
    expect(attendu(200, await p.s.b.associe.get("/api/dd/portail/option")).actif).toBe(false);
    await changerOption(p.s.a.associe, false);
  });
});

describe("comptes et invitations (cabinet)", () => {
  it("comptes du dossier : investisseurs actifs du client seulement, nom sans e-mail", async () => {
    const r = attendu(200, await p.s.a.directeur.get(`${urlEtat(note.dossierId)}/comptes`));
    const ids = r.elements.map((c: any) => c.utilisateur_id).sort();
    expect(ids).toEqual([p.investisseur.utilisateurId, p.investisseur2.utilisateurId].sort());
    for (const c of r.elements) {
      expect(Object.keys(c).sort()).toEqual(
        ["admissible", "invite", "invite_le", "nom", "utilisateur_id"].sort(),
      );
      expect(c).toMatchObject({ admissible: true, invite: false, invite_le: null });
    }
  });

  it("droits : dd.portail.gerer (associé, directeur) ; 404 pour un autre cabinet ou un dossier inconnu", async () => {
    const corps = { utilisateur_id: p.investisseur.utilisateurId };
    for (const u of [p.s.a.chef, p.s.consultantEquipe, p.s.expertMetier, p.s.gestionnaire]) {
      expect((await u.post(urlInvitations(note.dossierId), corps)).statusCode).toBe(403);
      expect((await u.get(urlEtat(note.dossierId))).statusCode).toBe(403);
    }
    expect((await p.s.b.associe.post(urlInvitations(note.dossierId), corps)).statusCode).toBe(404);
    expect((await p.s.b.associe.get(urlEtat(note.dossierId))).statusCode).toBe(404);
    expect((await p.s.a.associe.post(urlInvitations(INCONNU), corps)).statusCode).toBe(404);
    expect(
      (await p.s.a.associe.post(urlInvitations(note.dossierId), { utilisateur_id: "x" }))
        .statusCode,
    ).toBe(400);
  });

  it("compte non admissible : dirigeant, investisseur d'un autre client ou d'un autre cabinet, interne (400)", async () => {
    for (const u of [
      p.dirigeant,
      p.investisseurAutreClient,
      p.investisseurB,
      p.s.consultantEquipe,
    ]) {
      const r = await p.s.a.directeur.post(urlInvitations(note.dossierId), {
        utilisateur_id: u.utilisateurId,
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().erreur.code).toBe("DD_PORTAIL_COMPTE_NON_ADMISSIBLE");
    }
  });

  it("invitation, double invitation (409), retrait, retrait d'un compte non invité (404), journal", async () => {
    const i = await inviter(p.s.a.directeur, note.dossierId, p.investisseur.utilisateurId);
    expect(i.utilisateur_id).toBe(p.investisseur.utilisateurId);
    const deux = await p.s.a.directeur.post(urlInvitations(note.dossierId), {
      utilisateur_id: p.investisseur.utilisateurId,
    });
    expect(deux.statusCode).toBe(409);
    expect(deux.json().erreur.code).toBe("DD_PORTAIL_DEJA_INVITE");
    const retrait = `${urlInvitations(note.dossierId)}/${p.investisseur2.utilisateurId}/retrait`;
    expect((await p.s.a.associe.post(retrait)).statusCode).toBe(404);
    const etat = attendu(200, await p.s.a.associe.get(urlEtat(note.dossierId)));
    expect(
      etat.comptes.find((c: any) => c.utilisateur_id === p.investisseur.utilisateurId),
    ).toMatchObject({ invite: true });
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT details FROM journal_audit WHERE action = 'dd_portail_compte_invite' AND entite_id = $1`,
        [note.dossierId],
      ),
    );
    expect(journal.rows[0].details).toEqual({ utilisateur_id: p.investisseur.utilisateurId });
  });
});

describe("publication (cabinet)", () => {
  it("note soumise non validée, puis rejetée : 409 NOTE_NON_VALIDEE", async () => {
    const attente = await noteSoumise(p.s, { valider: false });
    const r = await p.s.a.directeur.post(urlPublier(attente.noteId), { version: attente.version });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("NOTE_NON_VALIDEE");
    attendu(
      201,
      await p.s.expertMetier.post(`/api/dd/notes/${attente.noteId}/validation`, {
        version: attente.version,
        decision: "rejete",
        motif: "Sources insuffisantes.",
      }),
    );
    const r2 = await p.s.a.directeur.post(urlPublier(attente.noteId), { version: attente.version });
    expect(r2.json().erreur.code).toBe("NOTE_NON_VALIDEE");
    // Une version antérieure à la dernière soumise (ici le brouillon 1) : périmée.
    expect(
      (await p.s.a.directeur.post(urlPublier(attente.noteId), { version: 1 })).json().erreur.code,
    ).toBe("NOTE_PERIMEE");
    // Une version qui n'existe pas encore : non validée.
    expect(
      (await p.s.a.directeur.post(urlPublier(attente.noteId), { version: 9 })).json().erreur.code,
    ).toBe("NOTE_NON_VALIDEE");
  });

  it("droits : dd.portail.gerer ET dd.lire ; 404 hors cabinet ; corps strict", async () => {
    const corps = { version: note.version };
    for (const u of [p.s.a.chef, p.s.consultantEquipe, p.s.expertMetier]) {
      expect((await u.post(urlPublier(note.noteId), corps)).statusCode).toBe(403);
    }
    expect((await p.s.b.associe.post(urlPublier(note.noteId), corps)).statusCode).toBe(404);
    expect((await p.s.a.associe.post(urlPublier(INCONNU), corps)).statusCode).toBe(404);
    expect(
      (await p.s.a.associe.post(urlPublier(note.noteId), { ...corps, synthese: "x" })).statusCode,
    ).toBe(400);
  });

  it("pièce d'une autre note : 400 DD_PORTAIL_PIECE_NON_ADMISSIBLE, rien n'est publié", async () => {
    const autre = await noteSoumise(p.s);
    const r = await rapportNote(p.s.a.associe, autre.noteId, "executive");
    const refus = await p.s.a.directeur.post(urlPublier(note.noteId), {
      version: note.version,
      rapports: [executive.rapportId, r.rapportId],
    });
    expect(refus.statusCode).toBe(400);
    expect(refus.json().erreur.code).toBe("DD_PORTAIL_PIECE_NON_ADMISSIBLE");
    expect(attendu(200, await p.s.a.associe.get(urlEtat(note.dossierId))).publications).toEqual([]);
  });

  it("publication nominale : instantané de la version validée, pièces dans l'ordre, journal", async () => {
    const r = attendu(
      201,
      await p.s.a.directeur.post(urlPublier(note.noteId), {
        version: note.version,
        rapports: [detaillee.rapportId, executive.rapportId],
      }),
    );
    publicationId = r.id;
    const etat = attendu(200, await p.s.a.associe.get(urlEtat(note.dossierId)));
    expect(etat.publications).toHaveLength(1);
    expect(etat.publications[0]).toMatchObject({
      id: publicationId,
      note_id: note.noteId,
      version: note.version,
      titre: "Note au comité — cible",
      recommandation: "favorable_sous_conditions",
      retiree: false,
      retiree_le: null,
      perimee: false,
    });
    expect(etat.publications[0].pieces.map((x: any) => [x.rapport_id, x.variante])).toEqual([
      [detaillee.rapportId, "detaillee"],
      [executive.rapportId, "executive"],
    ]);
    expect(etat.notes_publiables).toEqual([
      expect.objectContaining({
        note_id: note.noteId,
        version: note.version,
        publication_active_id: publicationId,
      }),
    ]);
    expect(etat.notes_publiables[0].rapports.map((x: any) => x.id).sort()).toEqual(
      [executive.rapportId, detaillee.rapportId].sort(),
    );
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT details FROM journal_audit WHERE action = 'dd_portail_note_publiee' AND entite_id = $1`,
        [publicationId],
      ),
    );
    expect(journal.rows[0].details).toEqual({
      note_id: note.noteId,
      version: note.version,
      pieces: 2,
    });
  });

  it("une seule publication active par note (409)", async () => {
    const r = await p.s.a.associe.post(urlPublier(note.noteId), { version: note.version });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("DD_PORTAIL_PUBLICATION_ACTIVE");
  });
});

describe("lecture par l'investisseur invité (portail)", () => {
  it("option désactivée (défaut) : liste vide, détail et pièce 404", async () => {
    expect(attendu(200, await p.investisseur.get(urlListePortail))).toEqual({
      elements: [],
      curseur_suivant: null,
    });
    expect((await p.investisseur.get(urlPublicationPortail(publicationId))).statusCode).toBe(404);
  });

  it("option active : liste, détail (instantané seul, aucune clé interne), journal", async () => {
    await changerOption(p.s.a.associe, true);
    const l = attendu(200, await p.investisseur.get(urlListePortail));
    expect(l.elements).toEqual([
      {
        id: publicationId,
        titre: "Note au comité — cible",
        recommandation: "favorable_sous_conditions",
        version: note.version,
        valide_le: expect.any(String),
        publie_le: expect.any(String),
        nb_pieces: 2,
      },
    ]);
    const d = attendu(200, await p.investisseur.get(urlPublicationPortail(publicationId)));
    expect(Object.keys(d).sort()).toEqual(
      [
        "conditions",
        "id",
        "pieces",
        "publie_le",
        "recommandation",
        "synthese",
        "titre",
        "valide_le",
        "version",
      ].sort(),
    );
    expect(d).toMatchObject({
      synthese: "Le dossier est solide sous réserve des conditions.",
      conditions: ["Audit fiscal préalable", "Garantie de passif"],
    });
    expect(d.pieces.map((x: any) => Object.keys(x).sort())).toEqual([
      ["format", "id", "variante"],
      ["format", "id", "variante"],
    ]);
    for (const corps of [l, d]) {
      expect(clesDe(corps).filter((k) => CLE_INTERDITE.test(k))).toEqual([]);
      const texte = JSON.stringify(corps);
      for (const interdit of [note.dossierId, note.noteId, note.missionId, executive.rapportId]) {
        expect(texte).not.toContain(interdit);
      }
    }
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT details FROM journal_audit WHERE action = 'portail_lecture'
           AND entite = 'dd_portail_publication' AND entite_id = $1 AND utilisateur_id = $2`,
        [publicationId, p.investisseur.utilisateurId],
      ),
    );
    expect(journal.rows[0].details).toMatchObject({ portail: true, client_id: p.s.a.clientId });
  });

  it("téléchargement d'une pièce : contenu du rapport, pièce jointe, nosniff, no-store, journal", async () => {
    const d = attendu(200, await p.investisseur.get(urlPublicationPortail(publicationId)));
    const piece = d.pieces.find((x: any) => x.variante === "executive");
    const r = await p.investisseur.get(urlPiecePortail(publicationId, piece.id));
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("private, no-store");
    const interne = await p.s.consultantEquipe.get(`/api/fichiers/${executive.fichierId}`);
    expect(interne.statusCode).toBe(200);
    expect(r.rawPayload.length).toBeGreaterThan(0);
    expect(Buffer.compare(r.rawPayload, interne.rawPayload)).toBe(0);
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT details FROM journal_audit WHERE action = 'telechargement'
           AND entite = 'dd_portail_piece' AND entite_id = $1`,
        [piece.id],
      ),
    );
    expect(journal.rows[0].details).toMatchObject({ portail: true, publication_id: publicationId });
  });

  it("404 uniforme : investisseur non invité, d'un autre client, d'un autre cabinet ; 403 sans portail.dd.lire", async () => {
    const d = attendu(200, await p.investisseur.get(urlPublicationPortail(publicationId)));
    const pieceId = d.pieces[0].id;
    for (const u of [p.investisseur2, p.investisseurAutreClient, p.investisseurB]) {
      expect(attendu(200, await u.get(urlListePortail)).elements).toEqual([]);
      const r = await u.get(urlPublicationPortail(publicationId));
      expect(r.statusCode).toBe(404);
      expect(r.json().erreur.code).toBe("INTROUVABLE");
      expect((await u.get(urlPiecePortail(publicationId, pieceId))).statusCode).toBe(404);
    }
    for (const url of [urlListePortail, urlPublicationPortail(publicationId)]) {
      expect((await p.dirigeant.get(url)).statusCode).toBe(403);
      expect((await api(ctx).get(url)).statusCode).toBe(401);
    }
    // Un rôle du cabinet n'a pas portail.dd.lire.
    expect((await p.s.a.associe.get(urlListePortail)).statusCode).toBe(403);
    expect((await p.investisseur.get(urlPublicationPortail(INCONNU))).statusCode).toBe(404);
  });

  it("pièce d'une AUTRE publication, ou publication d'une autre pièce : 404", async () => {
    const autre = await noteSoumise(p.s);
    const r = await rapportNote(p.s.a.associe, autre.noteId, "executive");
    await inviter(p.s.a.associe, autre.dossierId, p.investisseur.utilisateurId);
    const pub2 = attendu(
      201,
      await p.s.a.associe.post(urlPublier(autre.noteId), {
        version: autre.version,
        rapports: [r.rapportId],
      }),
    ).id as string;
    const d2 = attendu(200, await p.investisseur.get(urlPublicationPortail(pub2)));
    const d1 = attendu(200, await p.investisseur.get(urlPublicationPortail(publicationId)));
    expect(
      (await p.investisseur.get(urlPiecePortail(publicationId, d2.pieces[0].id))).statusCode,
    ).toBe(404);
    expect((await p.investisseur.get(urlPiecePortail(pub2, d1.pieces[0].id))).statusCode).toBe(404);
    expect((await p.investisseur.get(urlPiecePortail(pub2, d2.pieces[0].id))).statusCode).toBe(200);
    // Pagination par curseur : une publication par page.
    const page1 = attendu(200, await p.investisseur.get(`${urlListePortail}?limite=1`));
    expect(page1.elements).toHaveLength(1);
    expect(page1.elements[0].id).toBe(pub2);
    const page2 = attendu(
      200,
      await p.investisseur.get(`${urlListePortail}?limite=1&curseur=${page1.curseur_suivant}`),
    );
    expect(page2.elements.map((e: any) => e.id)).toEqual([publicationId]);
    expect((await p.investisseur.get(`${urlListePortail}?curseur=abc`)).statusCode).toBe(400);
  });
});

describe("effet immédiat des retraits", () => {
  it("retrait de l'invitation : 404 aussitôt ; nouvelle invitation : de nouveau visible", async () => {
    const retrait = `${urlInvitations(note.dossierId)}/${p.investisseur.utilisateurId}/retrait`;
    attendu(201, await p.s.a.directeur.post(retrait));
    expect((await p.investisseur.get(urlPublicationPortail(publicationId))).statusCode).toBe(404);
    const ids = attendu(200, await p.investisseur.get(urlListePortail)).elements.map(
      (e: any) => e.id,
    );
    expect(ids).not.toContain(publicationId);
    await inviter(p.s.a.directeur, note.dossierId, p.investisseur.utilisateurId);
    expect((await p.investisseur.get(urlPublicationPortail(publicationId))).statusCode).toBe(200);
  });

  it("désactivation de l'option : 404 aussitôt (pièce comprise) ; réactivation", async () => {
    const d = attendu(200, await p.investisseur.get(urlPublicationPortail(publicationId)));
    await changerOption(p.s.a.associe, false);
    expect((await p.investisseur.get(urlPublicationPortail(publicationId))).statusCode).toBe(404);
    expect(
      (await p.investisseur.get(urlPiecePortail(publicationId, d.pieces[0].id))).statusCode,
    ).toBe(404);
    expect(attendu(200, await p.investisseur.get(urlListePortail)).elements).toEqual([]);
    await changerOption(p.s.a.associe, true);
    expect((await p.investisseur.get(urlPublicationPortail(publicationId))).statusCode).toBe(200);
  });

  it("une version plus récente soumise rend la publication « périmée » côté cabinet seulement", async () => {
    const autre = await noteSoumise(p.s);
    await inviter(p.s.a.associe, autre.dossierId, p.investisseur.utilisateurId);
    const pub = attendu(
      201,
      await p.s.a.associe.post(urlPublier(autre.noteId), { version: autre.version }),
    ).id as string;
    const brouillon = attendu(
      201,
      await p.s.consultantEquipe.post(`/api/dd/notes/${autre.noteId}/versions`, {
        version_courante: autre.version,
        motif: "Mise à jour après le comité.",
        recommandation: "reservee",
        synthese: "Nouvelle synthèse non encore validée.",
        conditions: [],
      }),
    ).version as number;
    // Un brouillon plus récent ne rend pas la publication périmée ; une soumission, si.
    expect(
      attendu(200, await p.s.a.associe.get(urlEtat(autre.dossierId))).publications[0].perimee,
    ).toBe(false);
    attendu(
      201,
      await p.s.consultantEquipe.post(`/api/dd/notes/${autre.noteId}/soumission`, {
        version: brouillon,
      }),
    );
    const etat = attendu(200, await p.s.a.associe.get(urlEtat(autre.dossierId)));
    expect(etat.publications[0]).toMatchObject({ id: pub, perimee: true });
    expect(etat.notes_publiables).toEqual([]);
    expect((await p.investisseur.get(urlPublicationPortail(pub))).statusCode).toBe(200);
  });

  it("retrait de la publication : 404 aussitôt ; second retrait 409 ; nouvelle publication possible", async () => {
    const d = attendu(200, await p.investisseur.get(urlPublicationPortail(publicationId)));
    const url = `/api/dd/portail/publications/${publicationId}/retrait`;
    for (const u of [p.s.a.chef, p.s.consultantEquipe])
      expect((await u.post(url)).statusCode).toBe(403);
    expect((await p.s.b.associe.post(url)).statusCode).toBe(404);
    attendu(201, await p.s.a.directeur.post(url));
    expect((await p.investisseur.get(urlPublicationPortail(publicationId))).statusCode).toBe(404);
    expect(
      (await p.investisseur.get(urlPiecePortail(publicationId, d.pieces[0].id))).statusCode,
    ).toBe(404);
    const deux = await p.s.a.directeur.post(url);
    expect(deux.statusCode).toBe(409);
    expect(deux.json().erreur.code).toBe("DD_PORTAIL_PUBLICATION_RETIREE");
    const etat = attendu(200, await p.s.a.associe.get(urlEtat(note.dossierId)));
    expect(etat.publications[0]).toMatchObject({ id: publicationId, retiree: true });
    expect(etat.notes_publiables[0].publication_active_id).toBeNull();
    const nouvelle = attendu(
      201,
      await p.s.a.directeur.post(urlPublier(note.noteId), { version: note.version }),
    ).id as string;
    expect((await p.investisseur.get(urlPublicationPortail(nouvelle))).statusCode).toBe(200);
    publicationId = nouvelle;
  });

  it("mission clôturée : invitation et publication refusées (409) ; retraits toujours possibles", async () => {
    attendu(
      200,
      await p.s.a.directeur.post(`/api/missions/${note.missionId}/signer`, {
        date_signature: "2026-10-01",
      }),
    );
    await cloturerMission(p.s, note.missionId);
    const inv = await p.s.a.directeur.post(urlInvitations(note.dossierId), {
      utilisateur_id: p.investisseur2.utilisateurId,
    });
    expect(inv.statusCode).toBe(409);
    expect(inv.json().erreur.code).toBe("MISSION_CLOTUREE");
    attendu(
      201,
      await p.s.a.directeur.post(`/api/dd/portail/publications/${publicationId}/retrait`),
    );
    const pub = await p.s.a.directeur.post(urlPublier(note.noteId), { version: note.version });
    expect(pub.json().erreur.code).toBe("MISSION_CLOTUREE");
    attendu(
      201,
      await p.s.a.directeur.post(
        `${urlInvitations(note.dossierId)}/${p.investisseur.utilisateurId}/retrait`,
      ),
    );
  });
});

describe("routes du cabinet fermées au portail", () => {
  it("toute route /api/dd/** répond 403 PORTAIL_ROUTE_INTERDITE à un compte du portail", async () => {
    for (const url of [
      "/api/dd/portail/option",
      urlEtat(note.dossierId),
      `${urlEtat(note.dossierId)}/comptes`,
      `/api/dd/dossiers/${note.dossierId}`,
      `/api/dd/notes/${note.noteId}`,
      `/api/dd/notes/${note.noteId}/rapports`,
      `/api/fichiers/${executive.fichierId}`,
    ]) {
      const r = await p.investisseur.get(url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
    for (const url of [
      urlPublier(note.noteId),
      urlInvitations(note.dossierId),
      "/api/dd/portail/option",
    ]) {
      const r = await p.investisseur.post(url, {});
      expect(r.statusCode, url).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("aucune route d'écriture du portail sous /api/portail/due-diligence", () => {
    const routes = ctx.app.routesInventoriees.filter((r) =>
      r.motif.startsWith("/api/portail/due-diligence"),
    );
    expect([...new Set(routes.map((r) => r.methode))].sort()).toEqual(["GET", "HEAD"]);
    expect([...new Set(routes.map((r) => r.motif))].sort()).toEqual([
      "/api/portail/due-diligence/publications",
      "/api/portail/due-diligence/publications/:id",
      "/api/portail/due-diligence/publications/:id/pieces/:pieceId/fichier",
    ]);
  });
});
