import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decoder, totp } from "../src/auth/totp.js";
import { maintenirA } from "./canaux-outils.js";
import { ECHANTILLONS, televerser } from "./fichiers-outils.js";
import { MOT_DE_PASSE_TEST, proprietaire } from "./helpers.js";
import type { ApiUtilisateur } from "./missions-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import {
  demarrerCanaux,
  preparerCabinetCanaux,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Signature électronique d'un PDF de mission (CLI-05, SPEC-3c §7.7, §18.5 G-03 à G-14) : fournisseur
 * local « simple simulée », reconfirmation d'identité avec second facteur, ordre, refus, annulation,
 * expiration, journal de preuves chaîné, portail, séparation des tâches, aucun effet sur la mission.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let b: CabinetCanaux;
let secretDirecteur = "";
let secretDirigeant = "";
let clientA2: string;
let dirigeantA2: UtilisateurPortail;
let contributeur: UtilisateurPortail;

const code = (secret: string) => totp(base32Decoder(secret), Date.now());

/** Active la 2FA du compte ; renvoie le secret (anti-rejeu remis à zéro avant chaque usage). */
async function activer2fa(u: ApiUtilisateur | UtilisateurPortail): Promise<string> {
  const init = await u.post("/api/auth/2fa/initialiser", { mot_de_passe: MOT_DE_PASSE_TEST });
  attendre(200, init, "initialisation 2FA");
  const secret = init.json().secret as string;
  attendre(200, await u.post("/api/auth/2fa/activer", { code: code(secret) }), "activation 2FA");
  return secret;
}
const reinitialiserAntiRejeu = (utilisateurId: string) =>
  proprietaire((c) =>
    c.query("UPDATE utilisateurs_2fa SET dernier_pas = NULL WHERE utilisateur_id = $1", [
      utilisateurId,
    ]),
  );
const confirmation = async (utilisateurId: string, secret: string) => {
  await reinitialiserAntiRejeu(utilisateurId);
  return { mot_de_passe: MOT_DE_PASSE_TEST, code: code(secret) };
};

/**
 * Lecture du document d'une demande de signature : dans le navigateur (`inline`, type fixé par le
 * serveur), jamais mise en cache, sans reniflage, et SANS CSP `sandbox` (la visionneuse PDF du
 * navigateur refuse un document sandboxé).
 */
function attendreLectureEnLigne(entetes: Record<string, unknown>): void {
  expect(entetes["content-type"]).toBe("application/pdf");
  expect(String(entetes["content-disposition"])).toMatch(/^inline; filename="/);
  expect(entetes["x-content-type-options"]).toBe("nosniff");
  expect(entetes["cache-control"]).toBe("private, no-store");
  const csp = String(entetes["content-security-policy"]);
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toContain("sandbox");
}

async function pdf(
  nom: string,
  type: "lettre_de_mission" | "autre" = "lettre_de_mission",
  missionId = a.missionId,
) {
  const f = await televerser(a.associe, "/api/fichiers", `${nom}.pdf`, ECHANTILLONS.pdf(nom));
  attendre(201, f, "pdf");
  const d = await a.associe.post(`/api/missions/${missionId}/documents`, {
    type,
    nom,
    fichier_id: f.json().id,
  });
  attendre(201, d, "document");
  return { documentId: d.json().id as string, fichierId: f.json().id as string };
}

const corpsDemande = (
  documentId: string,
  ordre: "parallele" | "sequentiel" = "parallele",
  objet = "lettre_mission",
) => ({
  document_id: documentId,
  objet,
  ordre,
  expire_jours: 30,
  signataires: [
    { utilisateur_id: a.directeur.utilisateurId, partie: "cabinet" },
    { utilisateur_id: a.dirigeant.utilisateurId, partie: "client" },
  ],
});

async function creerEtEnvoyer(
  documentId: string,
  ordre: "parallele" | "sequentiel" = "parallele",
  objet = "lettre_mission",
) {
  const c = await a.associe.post(
    `/api/missions/${a.missionId}/signatures`,
    corpsDemande(documentId, ordre, objet),
  );
  attendre(201, c, "création");
  const id = c.json().id as string;
  attendre(200, await a.associe.post(`/api/signatures/${id}/envoyer`, {}), "envoi");
  return id;
}

const typesPreuves = async (id: string) =>
  (
    (await a.associe.get(`/api/signatures/${id}/preuves`)).json().preuves as {
      type_evenement: string;
    }[]
  ).map((p) => p.type_evenement);

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Signatures A");
  b = await preparerCabinetCanaux(ctx, "Signatures B");
  const c2 = await a.associe.post("/api/clients", { raison_sociale: "Client A2 (fictif)" });
  clientA2 = c2.json().id as string;
  dirigeantA2 = await inviterClient(ctx, a.associe, clientA2, ["client_dirigeant"]);
  contributeur = a.contributeur;
  secretDirecteur = await activer2fa(a.directeur);
  secretDirigeant = await activer2fa(a.dirigeant);
}, 300_000);
afterAll(() => ctx.fermer());

describe("création et envoi", () => {
  it("401, 403, autre cabinet, document non signable (DOCX, type, autre mission), un seul brouillon ouvert par document", async () => {
    const { documentId } = await pdf("Lettre de mission nº 1");
    const url = `/api/missions/${a.missionId}/signatures`;
    expect(
      (await ctx.app.inject({ method: "POST", url, payload: corpsDemande(documentId) })).statusCode,
    ).toBe(401);
    expect((await a.chef.post(url, corpsDemande(documentId))).statusCode).toBe(403);
    expect((await b.associe.post(url, corpsDemande(documentId))).statusCode).toBe(404);
    // Corps strict : une clé inconnue est refusée.
    expect(
      (await a.associe.post(url, { ...corpsDemande(documentId), en_plus: 1 })).statusCode,
    ).toBe(400);
    // DOCX : DOCUMENT_NON_SIGNABLE ; type de document incohérent avec l'objet : idem.
    const docx = await televerser(a.associe, "/api/fichiers", "contrat.docx", ECHANTILLONS.docx());
    const dd = await a.associe.post(`/api/missions/${a.missionId}/documents`, {
      type: "lettre_de_mission",
      nom: "Contrat docx",
      fichier_id: docx.json().id,
    });
    attendre(201, dd, "docx");
    const nonSignable = await a.associe.post(url, corpsDemande(dd.json().id));
    expect(nonSignable.statusCode).toBe(409);
    expect(nonSignable.json().erreur.code).toBe("DOCUMENT_NON_SIGNABLE");
    const autreType = await pdf("Procès-verbal nº 1", "autre");
    expect(
      (await a.associe.post(url, corpsDemande(autreType.documentId, "parallele", "lettre_mission")))
        .statusCode,
    ).toBe(409);
    // Document inconnu : 404.
    expect(
      (await a.associe.post(url, corpsDemande("00000000-0000-4000-8000-000000000000"))).statusCode,
    ).toBe(404);
    const ok = await a.associe.post(url, corpsDemande(documentId));
    attendre(201, ok, "création");
    expect(ok.json()).toMatchObject({
      statut: "brouillon",
      objet: "lettre_mission",
      niveau: "simple_simulee",
      mode_fournisseur: "simule",
      signataires_total: 2,
    });
    const doublon = await a.associe.post(url, corpsDemande(documentId));
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().erreur.code).toBe("SIGNATURE_EN_COURS");
    expect(await typesPreuves(ok.json().id)).toEqual(["demande_creee"]);
  });

  it("envoi : mission non partagée 409 PORTAIL_NON_PARTAGE, puis partagée : invitations et preuves", async () => {
    const { documentId } = await pdf("Lettre de mission nº 2");
    const c = await a.associe.post(
      `/api/missions/${a.missionId}/signatures`,
      corpsDemande(documentId),
    );
    attendre(201, c, "création");
    const id = c.json().id as string;
    const nonPartage = await a.associe.post(`/api/signatures/${id}/envoyer`, {});
    expect(nonPartage.statusCode).toBe(409);
    expect(nonPartage.json().erreur.code).toBe("PORTAIL_NON_PARTAGE");
    attendre(
      200,
      await a.associe.put(`/api/portail/partages?client_id=${a.clientId}`, {
        missions: [{ mission_id: a.missionId }],
        documents: [],
      }),
      "partage de la mission",
    );
    const envoi = await a.associe.post(`/api/signatures/${id}/envoyer`, {});
    attendre(200, envoi, "envoi");
    expect(envoi.json()).toMatchObject({
      statut: "envoyee",
      signataires_total: 2,
      signataires_signes: 0,
    });
    expect((await a.associe.post(`/api/signatures/${id}/envoyer`, {})).statusCode).toBe(409);
    expect(await typesPreuves(id)).toEqual([
      "demande_creee",
      "invitation_envoyee",
      "invitation_envoyee",
    ]);
    const detail = await a.associe.get(`/api/signatures/${id}`);
    expect(detail.json().signataires.map((s: { statut: string }) => s.statut)).toEqual([
      "invite",
      "invite",
    ]);
    expect(JSON.stringify(detail.json())).not.toMatch(/montant|cout|marge|taux/i);
    // Une demande ouverte annulée libère le document.
    attendre(
      200,
      await a.associe.post(`/api/signatures/${id}/annuler`, { motif: "Test" }),
      "annulation",
    );
  });
});

describe("signature (G-04, G-06, G-12)", () => {
  it("consultation exigée, second facteur actif, mauvais mot de passe ; cabinet puis client : partielle puis signee, chaîne valide, mission et budget inchangés", async () => {
    const mission = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT statut FROM missions WHERE id = $1", [a.missionId])).rows[0]
          .statut as string,
    );
    const budgetAvant = await proprietaire(async (cl) =>
      JSON.stringify(
        (
          await cl.query("SELECT * FROM budget_versions WHERE mission_id = $1 ORDER BY numero", [
            a.missionId,
          ])
        ).rows,
      ),
    );
    const { documentId } = await pdf("Lettre de mission nº 3");
    const id = await creerEtEnvoyer(documentId);
    // Sans avoir consulté le document : refus.
    const sansLecture = await a.directeur.post(
      `/api/signatures/${id}/signer`,
      await confirmation(a.directeur.utilisateurId, secretDirecteur),
    );
    expect(sansLecture.statusCode).toBe(409);
    expect(sansLecture.json().erreur.code).toBe("DOCUMENT_NON_CONSULTE");
    const lectureCabinet = await a.directeur.get(`/api/signatures/${id}/document`);
    attendre(200, lectureCabinet, "lecture du document");
    attendreLectureEnLigne(lectureCabinet.headers);
    // Un directeur qui n'est pas signataire : 404 (même sans 2FA).
    const chefSansTfa = await a.avecRoles(["directeur_mission"]);
    expect(
      (await chefSansTfa.post(`/api/signatures/${id}/signer`, { mot_de_passe: MOT_DE_PASSE_TEST }))
        .statusCode,
    ).toBe(404);
    // Mot de passe faux, code faux : refus, aucune preuve ajoutée.
    const avant = (await typesPreuves(id)).length;
    expect(
      (
        await a.directeur.post(`/api/signatures/${id}/signer`, {
          mot_de_passe: "mauvais-mot-de-passe",
          code: "000000",
        })
      ).statusCode,
    ).toBe(401);
    await reinitialiserAntiRejeu(a.directeur.utilisateurId);
    expect(
      (
        await a.directeur.post(`/api/signatures/${id}/signer`, {
          mot_de_passe: MOT_DE_PASSE_TEST,
          code: "000000",
        })
      ).statusCode,
    ).toBe(401);
    expect((await typesPreuves(id)).length).toBe(avant);
    // Le directeur signe : partielle.
    const s1 = await a.directeur.post(
      `/api/signatures/${id}/signer`,
      await confirmation(a.directeur.utilisateurId, secretDirecteur),
    );
    attendre(200, s1, "signature du cabinet");
    expect(s1.json()).toMatchObject({
      statut: "partielle",
      signataires_signes: 1,
      signataires_total: 2,
    });
    expect(
      (
        await a.directeur.post(
          `/api/signatures/${id}/signer`,
          await confirmation(a.directeur.utilisateurId, secretDirecteur),
        )
      ).statusCode,
    ).toBe(409);
    // Le dirigeant du client, par le portail : lit le document puis signe.
    const lecturePortail = await a.dirigeant.get(`/api/portail/signatures/${id}/document`);
    attendre(200, lecturePortail, "document du portail");
    attendreLectureEnLigne(lecturePortail.headers);
    const s2 = await a.dirigeant.post(
      `/api/portail/signatures/${id}/signer`,
      await confirmation(a.dirigeant.utilisateurId, secretDirigeant),
    );
    attendre(200, s2, "signature du client");
    expect(Object.keys(s2.json()).sort()).toEqual(["empreinte_document", "signe_le", "statut"]);
    expect(s2.json().statut).toBe("signee");
    // Une demande signée reste consultable (le PDF signé) par ses signataires.
    attendre(
      200,
      await a.dirigeant.get(`/api/portail/signatures/${id}/document`),
      "document d'une demande signée",
    );
    const dossier = await a.associe.get(`/api/signatures/${id}/preuves`);
    attendre(200, dossier, "dossier de preuve");
    expect(dossier.json().verification).toEqual({ valide: true });
    expect(dossier.json().preuves.map((p: { type_evenement: string }) => p.type_evenement)).toEqual(
      [
        "demande_creee",
        "invitation_envoyee",
        "invitation_envoyee",
        "document_consulte",
        "reconfirmation_identite",
        "signature_apposee",
        "document_consulte",
        "reconfirmation_identite",
        "signature_apposee",
        "scellement",
      ],
    );
    expect(
      dossier
        .json()
        .preuves.every((p: { horodatage_source: string }) => p.horodatage_source === "base_locale"),
    ).toBe(true);
    expect(dossier.json().demande).toMatchObject({ statut: "signee", signataires_signes: 2 });
    // Aucun effet sur la mission ni sur le budget (ADR-010).
    expect(
      await proprietaire(
        async (cl) =>
          (await cl.query("SELECT statut FROM missions WHERE id = $1", [a.missionId])).rows[0]
            .statut as string,
      ),
    ).toBe(mission);
    expect(
      await proprietaire(async (cl) =>
        JSON.stringify(
          (
            await cl.query("SELECT * FROM budget_versions WHERE mission_id = $1 ORDER BY numero", [
              a.missionId,
            ])
          ).rows,
        ),
      ),
    ).toBe(budgetAvant);
    // Une demande signée ne se modifie plus (MPH08).
    await expect(
      proprietaire((c) =>
        c.query("UPDATE signatures_demandes SET statut = 'annulee' WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPH08" });
  });

  it("sans second facteur actif : 409 TFA_INACTIVE (client sans 2FA)", async () => {
    const sans = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    const { documentId } = await pdf("Lettre de mission nº 4");
    const c = await a.associe.post(`/api/missions/${a.missionId}/signatures`, {
      ...corpsDemande(documentId),
      signataires: [{ utilisateur_id: sans.utilisateurId, partie: "client" }],
    });
    attendre(201, c, "création");
    const id = c.json().id as string;
    attendre(200, await a.associe.post(`/api/signatures/${id}/envoyer`, {}), "envoi");
    attendre(200, await sans.get(`/api/portail/signatures/${id}/document`), "lecture");
    const r = await sans.post(`/api/portail/signatures/${id}/signer`, {
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("TFA_INACTIVE");
    expect(await typesPreuves(id)).not.toContain("signature_apposee");
  });

  it("ordre séquentiel : le rang 2 ne signe pas avant le rang 1 (409 ORDRE_NON_RESPECTE), aucune preuve", async () => {
    const { documentId } = await pdf("Avenant nº 1", "autre");
    const id = await creerEtEnvoyer(documentId, "sequentiel", "avenant");
    const detail = (await a.associe.get(`/api/signatures/${id}`)).json();
    expect(detail.signataires.map((s: { statut: string }) => s.statut)).toEqual([
      "invite",
      "en_attente",
    ]);
    const avant = (await typesPreuves(id)).length;
    const trop = await a.dirigeant.post(
      `/api/portail/signatures/${id}/signer`,
      await confirmation(a.dirigeant.utilisateurId, secretDirigeant),
    );
    expect(trop.statusCode).toBe(409);
    expect(trop.json().erreur.code).toBe("ORDRE_NON_RESPECTE");
    expect((await typesPreuves(id)).length).toBe(avant);
    attendre(200, await a.directeur.get(`/api/signatures/${id}/document`), "lecture");
    attendre(
      200,
      await a.directeur.post(
        `/api/signatures/${id}/signer`,
        await confirmation(a.directeur.utilisateurId, secretDirecteur),
      ),
      "rang 1",
    );
    // Le rang 2 est invité à son tour.
    expect(
      (await a.associe.get(`/api/signatures/${id}`))
        .json()
        .signataires.map((s: { statut: string }) => s.statut),
    ).toEqual(["signe", "invite"]);
    attendre(
      200,
      await a.dirigeant.get(`/api/portail/signatures/${id}/document`),
      "lecture client",
    );
    attendre(
      200,
      await a.dirigeant.post(
        `/api/portail/signatures/${id}/signer`,
        await confirmation(a.dirigeant.utilisateurId, secretDirigeant),
      ),
      "rang 2",
    );
  });
});

describe("refus, annulation, expiration (G-07, G-08, G-09)", () => {
  it("refus du client avec motif (sans motif : 400) ; annulation par le demandeur seulement ou un associé", async () => {
    const { documentId } = await pdf("Lettre de mission nº 5");
    const id = await creerEtEnvoyer(documentId);
    expect((await a.dirigeant.post(`/api/portail/signatures/${id}/refuser`, {})).statusCode).toBe(
      400,
    );
    const refus = await a.dirigeant.post(`/api/portail/signatures/${id}/refuser`, {
      motif: "Désaccord sur la clause 4",
    });
    attendre(200, refus, "refus");
    expect(refus.json()).toEqual({ statut: "refusee" });
    const d = await a.associe.get(`/api/signatures/${id}/preuves`);
    expect(d.json().demande.statut).toBe("refusee");
    expect(d.json().preuves.map((p: { type_evenement: string }) => p.type_evenement)).toContain(
      "refus",
    );
    expect(d.json().verification).toEqual({ valide: true });
    expect(
      (await a.dirigeant.post(`/api/portail/signatures/${id}/refuser`, { motif: "Encore" }))
        .statusCode,
    ).toBe(409);

    // Annulation : un directeur qui n'est pas le demandeur : 403 ; le demandeur : motif obligatoire.
    const { documentId: doc2 } = await pdf("Lettre de mission nº 6");
    const id2 = await creerEtEnvoyer(doc2);
    expect(
      (await a.directeur.post(`/api/signatures/${id2}/annuler`, { motif: "Pas mon rôle" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await a.chef.post(`/api/signatures/${id2}/annuler`, { motif: "Pas mon rôle" })).statusCode,
    ).toBe(403);
    expect((await a.associe.post(`/api/signatures/${id2}/annuler`, {})).statusCode).toBe(400);
    attendre(
      200,
      await a.associe.post(`/api/signatures/${id2}/annuler`, { motif: "Document remplacé" }),
      "annulation",
    );
    expect((await typesPreuves(id2)).slice(-1)).toEqual(["annulation"]);
    expect(
      (await a.associe.post(`/api/signatures/${id2}/annuler`, { motif: "Encore" })).statusCode,
    ).toBe(409);
    // Une signature après annulation : refus.
    expect(
      (
        await a.dirigeant.post(
          `/api/portail/signatures/${id2}/signer`,
          await confirmation(a.dirigeant.utilisateurId, secretDirigeant),
        )
      ).statusCode,
    ).toBe(409);
  });

  it("expiration à la maintenance (31e jour) : expiree, signataires expire, preuve ; une signature ensuite : 409", async () => {
    const { documentId } = await pdf("Lettre de mission nº 7");
    const id = await creerEtEnvoyer(documentId);
    const bilan = await maintenirA(ctx, a.cabinetId, new Date(Date.now() + 31 * 86_400_000));
    expect(bilan.demandes_expirees).toBeGreaterThanOrEqual(1);
    const d = (await a.associe.get(`/api/signatures/${id}/preuves`)).json();
    expect(d.demande.statut).toBe("expiree");
    expect(d.signataires.map((s: { statut: string }) => s.statut)).toEqual(["expire", "expire"]);
    expect(d.preuves.at(-1).type_evenement).toBe("expiration");
    expect(d.verification).toEqual({ valide: true });
    expect(
      (
        await a.directeur.post(
          `/api/signatures/${id}/signer`,
          await confirmation(a.directeur.utilisateurId, secretDirecteur),
        )
      ).statusCode,
    ).toBe(409);
  });
});

describe("document servi au portail : seulement une demande ouverte ou signée, signataire invité (M2)", () => {
  const document = (id: string) => a.dirigeant.get(`/api/portail/signatures/${id}/document`);

  it("annulée, refusée, expirée : le statut est rendu, jamais le contenu (404)", async () => {
    // Annulée.
    const { documentId: d1 } = await pdf("Lettre M2 annulée");
    const annulee = await creerEtEnvoyer(d1);
    attendre(200, await document(annulee), "ouverte : document servi");
    attendre(
      200,
      await a.associe.post(`/api/signatures/${annulee}/annuler`, { motif: "Document remplacé" }),
      "annulation",
    );
    expect((await document(annulee)).statusCode).toBe(404);
    const vueAnnulee = await a.dirigeant.get(`/api/portail/signatures/${annulee}`);
    attendre(200, vueAnnulee, "statut d'une demande annulée");
    expect(vueAnnulee.json()).toMatchObject({ statut: "annulee", peut_signer: false });
    // Refusée.
    const { documentId: d2 } = await pdf("Lettre M2 refusée");
    const refusee = await creerEtEnvoyer(d2);
    attendre(
      200,
      await a.dirigeant.post(`/api/portail/signatures/${refusee}/refuser`, { motif: "Désaccord" }),
      "refus",
    );
    expect((await document(refusee)).statusCode).toBe(404);
    expect((await a.dirigeant.get(`/api/portail/signatures/${refusee}`)).json().statut).toBe(
      "refusee",
    );
    // Expirée.
    const { documentId: d3 } = await pdf("Lettre M2 expirée");
    const expiree = await creerEtEnvoyer(d3);
    attendre(200, await document(expiree), "ouverte avant l'échéance");
    await maintenirA(ctx, a.cabinetId, new Date(Date.now() + 31 * 86_400_000));
    expect((await a.associe.get(`/api/signatures/${expiree}`)).json().statut).toBe("expiree");
    expect((await document(expiree)).statusCode).toBe(404);
    expect((await a.dirigeant.get(`/api/portail/signatures/${expiree}`)).json().statut).toBe(
      "expiree",
    );
  });

  it("signataire non encore invité (ordre séquentiel, rang 2) : le document n'est pas servi (404)", async () => {
    const { documentId } = await pdf("Avenant M2 séquentiel", "autre");
    const id = await creerEtEnvoyer(documentId, "sequentiel", "avenant");
    expect((await document(id)).statusCode).toBe(404);
    // Le statut reste lisible (« en attente » de son tour).
    expect((await a.dirigeant.get(`/api/portail/signatures/${id}`)).json()).toMatchObject({
      mon_statut: "en_attente",
      peut_signer: false,
    });
  });
});

describe("journal de preuves : ajout seul et chaîne (G-10, G-11)", () => {
  it("UPDATE, DELETE, rang manquant, empreinte précédente fausse : MPH10 ; rôle applicatif : droit refusé ; altération détectée à la lecture", async () => {
    const { documentId } = await pdf("Lettre de mission nº 8");
    const id = await creerEtEnvoyer(documentId);
    await expect(
      proprietaire((c) =>
        c.query(
          "UPDATE signatures_preuves SET donnees = '{\"x\":1}' WHERE demande_id = $1 AND rang = 1",
          [id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPH10" });
    await expect(
      proprietaire((c) => c.query("DELETE FROM signatures_preuves WHERE demande_id = $1", [id])),
    ).rejects.toMatchObject({ code: "MPH10" });
    const insere = (rang: number, precedente: string) =>
      proprietaire((c) =>
        c.query(
          `INSERT INTO signatures_preuves (cabinet_id, demande_id, rang, type_evenement, horodatage, empreinte_document,
             empreinte_precedente, empreinte)
           SELECT cabinet_id, id, $2, 'annulation', clock_timestamp(), empreinte_document, $3, repeat('a', 64)
           FROM signatures_demandes WHERE id = $1`,
          [id, rang, precedente],
        ),
      );
    await expect(insere(9, "0".repeat(64))).rejects.toMatchObject({ code: "MPH10" });
    const derniere = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT rang, empreinte FROM signatures_preuves WHERE demande_id = $1 ORDER BY rang DESC LIMIT 1",
            [id],
          )
        ).rows[0],
    );
    await expect(insere(derniere.rang + 1, "f".repeat(64))).rejects.toMatchObject({
      code: "MPH10",
    });
    // Le rôle applicatif n'a aucun droit de modification.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE signatures_preuves SET donnees = '{}' WHERE demande_id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Altération hors déclencheur (propriétaire) : la vérification de la chaîne la signale.
    await proprietaire(async (c) => {
      await c.query("ALTER TABLE signatures_preuves DISABLE TRIGGER USER");
      try {
        await c.query(
          "UPDATE signatures_preuves SET donnees = '{\"altere\":true}' WHERE demande_id = $1 AND rang = 2",
          [id],
        );
      } finally {
        await c.query("ALTER TABLE signatures_preuves ENABLE TRIGGER USER");
      }
    });
    const lu = (await a.associe.get(`/api/signatures/${id}/preuves`)).json();
    expect(lu.verification).toEqual({ valide: false, rang: 2, cause: "EMPREINTE_DIFFERENTE" });
  });

  it("déclencheurs de la demande : document non signable (MPH11), signataire de la mauvaise partie (MPH09), transition (MPH08)", async () => {
    const { documentId, fichierId } = await pdf("Lettre de mission nº 9");
    const client = await proprietaire(
      async (c) =>
        (await c.query("SELECT client_id FROM missions WHERE id = $1", [a.missionId])).rows[0]
          .client_id as string,
    );
    const insererDemande = (empreinte: string, objet = "lettre_mission") =>
      proprietaire((c) =>
        c.query(
          `INSERT INTO signatures_demandes (cabinet_id, mission_id, client_id, document_id, fichier_id, empreinte_document, objet,
             ordre, demandeur_id) VALUES ($1, $2, $3, $4, $5, $6, $7, 'parallele', $8)`,
          [a.cabinetId, a.missionId, client, documentId, fichierId, empreinte, objet, a.associeId],
        ),
      );
    await expect(insererDemande("b".repeat(64))).rejects.toMatchObject({ code: "MPH11" });
    await expect(
      insererDemande(
        await proprietaire(
          async (c) =>
            (await c.query("SELECT sha256 FROM fichiers WHERE id = $1", [fichierId])).rows[0]
              .sha256 as string,
        ),
        "avenant",
      ),
    ).rejects.toMatchObject({ code: "MPH11" });
    const c = await a.associe.post(
      `/api/missions/${a.missionId}/signatures`,
      corpsDemande(documentId),
    );
    attendre(201, c, "création");
    const id = c.json().id as string;
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO signatures_signataires (cabinet_id, demande_id, utilisateur_id, partie, rang) VALUES ($1, $2, $3, 'client', 5)`,
          [a.cabinetId, id, a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPH09" });
    await expect(
      proprietaire((cl) =>
        cl.query(
          "UPDATE signatures_demandes SET statut = 'signee', termine_le = now() WHERE id = $1",
          [id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPH08" });
    await expect(
      proprietaire((cl) =>
        cl.query("UPDATE signatures_demandes SET empreinte_document = $2 WHERE id = $1", [
          id,
          "c".repeat(64),
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPH08" });
    await expect(
      proprietaire((cl) => cl.query("DELETE FROM signatures_demandes WHERE id = $1", [id])),
    ).rejects.toThrow();
    attendre(
      200,
      await a.associe.post(`/api/signatures/${id}/annuler`, { motif: "Nettoyage" }),
      "annulation",
    );
  });
});

describe("portail et isolation (G-13, G-14)", () => {
  it("même 404 pour inexistant, d'autrui, non invité, brouillon ; 403 contributeur ; aucun nom du cabinet", async () => {
    const { documentId } = await pdf("Lettre de mission nº 10");
    const brouillon = (
      await a.associe.post(`/api/missions/${a.missionId}/signatures`, corpsDemande(documentId))
    ).json().id as string;
    const { documentId: doc2 } = await pdf("Lettre de mission nº 11");
    const ouverte = await creerEtEnvoyer(doc2);
    const inconnu = "00000000-0000-4000-8000-000000000000";
    const urls = (id: string) => [
      `/api/portail/signatures/${id}`,
      `/api/portail/signatures/${id}/document`,
    ];
    const reponses = [];
    for (const [qui, id] of [
      [dirigeantA2, ouverte],
      [b.dirigeant, ouverte],
      [a.dirigeant, brouillon],
      [a.dirigeant, inconnu],
    ] as const) {
      for (const url of urls(id)) reponses.push(await qui.get(url));
    }
    for (const r of reponses) expect(r.statusCode).toBe(404);
    expect(new Set(reponses.map((r) => r.body)).size).toBe(1);
    for (const method of ["signer", "refuser"] as const) {
      const r = await dirigeantA2.post(
        `/api/portail/signatures/${ouverte}/${method}`,
        method === "refuser" ? { motif: "non" } : { mot_de_passe: MOT_DE_PASSE_TEST },
      );
      expect(r.statusCode).toBe(404);
    }
    // Le contributeur n'a pas la permission : 403 ; sans session : 401.
    expect((await contributeur.get("/api/portail/signatures")).statusCode).toBe(403);
    expect(
      (await ctx.app.inject({ method: "GET", url: "/api/portail/signatures" })).statusCode,
    ).toBe(401);
    // SES demandes seulement, aucun nom ni e-mail du cabinet.
    const liste = await a.dirigeant.get("/api/portail/signatures");
    attendre(200, liste, "liste du portail");
    expect(liste.json().elements.some((e: { id: string }) => e.id === brouillon)).toBe(false);
    expect(liste.json().elements.some((e: { id: string }) => e.id === ouverte)).toBe(true);
    expect((await dirigeantA2.get("/api/portail/signatures")).json().elements).toEqual([]);
    const detail = await a.dirigeant.get(`/api/portail/signatures/${ouverte}`);
    attendre(200, detail, "détail");
    expect(Object.keys(detail.json()).sort()).toEqual([
      "expire_le",
      "id",
      "mon_statut",
      "objet",
      "peut_signer",
      "signataires_signes",
      "signataires_total",
      "statut",
    ]);
    expect(detail.json().peut_signer).toBe(true);
    expect(JSON.stringify(detail.json())).not.toMatch(/@|demandeur|directeur|nom/);
    attendre(
      200,
      await a.associe.post(`/api/signatures/${ouverte}/annuler`, { motif: "Nettoyage" }),
      "annulation",
    );
    attendre(
      200,
      await a.associe.post(`/api/signatures/${brouillon}/annuler`, { motif: "Nettoyage" }),
      "annulation du brouillon",
    );
  });

  it("routes du cabinet : 401, 403, autre cabinet 404 ; le portail n'atteint aucune route du cabinet", async () => {
    const { documentId } = await pdf("Lettre de mission nº 12");
    const id = await creerEtEnvoyer(documentId);
    const lecture = [
      `/api/signatures/${id}`,
      `/api/signatures/${id}/preuves`,
      `/api/signatures/${id}/document`,
      `/api/missions/${a.missionId}/signatures`,
    ];
    for (const url of lecture) {
      expect((await ctx.app.inject({ method: "GET", url })).statusCode, url).toBe(401);
      expect((await a.contributeur.get(url)).json().erreur.code, url).toBe(
        "PORTAIL_ROUTE_INTERDITE",
      );
      expect((await b.associe.get(url)).statusCode, url).toBe(404);
    }
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get(`/api/signatures/${id}`)).statusCode).toBe(403);
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.get(`/api/signatures/${id}`)).statusCode).toBe(200); // signature.lire et lecture de toutes les missions
    expect(
      (await gestionnaire.post(`/api/signatures/${id}/annuler`, { motif: "x" })).statusCode,
    ).toBe(403);
    expect((await b.associe.post(`/api/signatures/${id}/envoyer`, {})).statusCode).toBe(404);
    expect((await b.associe.post(`/api/signatures/${id}/annuler`, { motif: "x" })).statusCode).toBe(
      404,
    );
    expect(
      (await b.associe.post(`/api/signatures/${id}/signer`, { mot_de_passe: MOT_DE_PASSE_TEST }))
        .statusCode,
    ).toBe(404);
    // Plafond de création : 30 par 10 minutes et par utilisateur, compté en base.
    await proprietaire((c) =>
      c.query(
        `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite)
         SELECT $1, $2, 'signature.demander', 'signature_demande' FROM generate_series(1, 30)`,
        [a.cabinetId, a.associeId],
      ),
    );
    const { documentId: d2 } = await pdf("Lettre de mission nº 13");
    expect(
      (await a.associe.post(`/api/missions/${a.missionId}/signatures`, corpsDemande(d2)))
        .statusCode,
    ).toBe(429);
    attendre(
      200,
      await a.associe.post(`/api/signatures/${id}/annuler`, { motif: "Nettoyage" }),
      "annulation",
    );
  });
});
