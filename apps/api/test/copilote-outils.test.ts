import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ajouterJours,
  COMMENTAIRE_COPILOTE_LONGUEUR_MAX,
  formaterDateCopilote,
  OUTILS_ACTION_COPILOTE,
} from "@missionpilot/engines";
import {
  actionProposeeSchema,
  EXPIRATION_ACTION_COPILOTE_MINUTES,
  reponseCopiloteSchema,
  resultatActionCopiloteSchema,
  type ActionProposeeCopilote,
  type ReponseCopilote,
} from "@missionpilot/shared";
import { AppError } from "../src/errors.js";
import { ACTIONS, confirmerAction, empreinteParametres } from "../src/copilote/actions.js";
import { semainesEcoulees } from "../src/copilote/lecture-retards.js";
import { creerHandlerCopilotePurge } from "../src/copilote/purge.js";
import { aujourdhui } from "../src/missions/outils.js";
import { type Api } from "./api.js";
import { preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { factureDatee, feuilleValidee } from "./finance-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { authDe } from "./ia-outils.js";
import { creerMission, creerMissionSignee, type ApiUtilisateur } from "./missions-outils.js";
import {
  affectationNominative,
  missionPlanifiable,
  utilisateurCollaborateur,
} from "./planification-outils.js";

/*
 * Copilote (AGT-08), outils étendus : actions « ajouter_commentaire » et « planifier_relance »
 * (proposition, confirmation à usage unique, droits revérifiés, niveau N2) et lectures « mes
 * missions en retard » et « retards sur les feuilles de temps ». Sur vrai PostgreSQL, mode sans IA.
 */

vi.setConfig({ testTimeout: 90_000 });

const jour = aujourdhui();
const TEXTE = "Le comité de pilotage est confirmé pour le 12/11";
const INTITULE = "Transformation Alpha";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let missionId: string;
let missionB: string;
let membre: ApiUtilisateur;
let hors: ApiUtilisateur;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Copilote Outils A");
  b = await preparerFacturation(ctx, "Cabinet Copilote Outils B");
  missionId = (await creerMissionSignee(a, { intitule: INTITULE, mode_facturation: "forfait" })).id;
  missionB = (
    await creerMissionSignee(b, { intitule: "Mission secrète B", mode_facturation: "forfait" })
  ).id;
  membre = await a.avecRoles(["consultant"]);
  hors = await a.avecRoles(["consultant"]);
  const r = await a.chef.post(`/api/missions/${missionId}/equipe`, {
    utilisateur_id: membre.utilisateurId,
  });
  expect(r.statusCode, r.body).toBe(201);
  // Dates de fin lointaines : une mission « à jour » ne dépend pas de la date d'exécution du test.
  await proprietaire((cl) =>
    cl.query("UPDATE missions SET date_fin = '2099-12-31' WHERE id = ANY($1::uuid[])", [
      [missionId, missionB],
    ]),
  );
}, 180_000);
afterAll(() => ctx.fermer());

const poser = (u: Api, message: string, contexte?: { mission_id: string }) =>
  u.post("/api/copilote/messages", { message, ...(contexte ? { contexte } : {}) });

async function demander(
  u: Api,
  message: string,
  contexte?: { mission_id: string },
): Promise<ReponseCopilote> {
  const r = await poser(u, message, contexte);
  expect(r.statusCode, r.body).toBe(200);
  return reponseCopiloteSchema.parse(r.json());
}

async function proposer(
  u: Api,
  message: string,
  outil: (typeof OUTILS_ACTION_COPILOTE)[number],
  contexte?: { mission_id: string },
): Promise<ActionProposeeCopilote> {
  const rep = await demander(u, message, contexte);
  expect(rep.statut, rep.texte).toBe("action_proposee");
  expect(rep.outil).toBe(outil);
  expect(rep.mode).toBe("deterministe");
  return actionProposeeSchema.parse(rep.action);
}

const ligne = (id: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT statut, outil, parametres, empreinte, resume, resultat_id, expire_le, cree_le,
             anonymise_le FROM copilote_actions WHERE id = $1`,
          [id],
        )
      ).rows[0],
  );

const compterPropositions = (cabinetId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query("SELECT count(*)::int AS n FROM copilote_actions WHERE cabinet_id = $1", [
          cabinetId,
        ])
      ).rows[0].n as number,
  );

const journalContient = (cabinetId: string, fragment: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          "SELECT count(*)::int AS n FROM journal_audit WHERE cabinet_id = $1 AND details::text ILIKE $2",
          [cabinetId, `%${fragment}%`],
        )
      ).rows[0].n as number,
  );

const confirmer = (u: Api, id: string) => u.post(`/api/copilote/actions/${id}/confirmer`);
const annuler = (u: Api, id: string) => u.post(`/api/copilote/actions/${id}/annuler`);

/* ----- Ajouter un commentaire ----- */

const MESSAGE_COMMENTAIRE = `Ajoute un commentaire sur la mission ${INTITULE} : ${TEXTE}`;
const commentaires = (cabinetId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT id, texte, auteur_id, entite_type, entite_id, mission_id, mentions
           FROM commentaires WHERE cabinet_id = $1 ORDER BY cree_le`,
          [cabinetId],
        )
      ).rows,
  );

describe("ajouter_commentaire : proposition", () => {
  it("PROPOSE sans rien écrire : paramètres résolus, résumé exact, empreinte, expiration", async () => {
    const avant = (await commentaires(a.cabinetId)).length;
    const action = await proposer(a.chef, MESSAGE_COMMENTAIRE, "ajouter_commentaire");
    expect(action).toMatchObject({
      outil: "ajouter_commentaire",
      libelle: "Ajouter un commentaire",
      resume: `Ajouter à la mission « ${INTITULE} » le commentaire : « ${TEXTE} ». Il sera visible de toutes les personnes qui voient cette mission ; aucune personne n'est mentionnée.`,
    });
    expect((await commentaires(a.cabinetId)).length).toBe(avant);
    const l = await ligne(action.action_id);
    expect(l).toMatchObject({
      statut: "proposee",
      outil: "ajouter_commentaire",
      resultat_id: null,
    });
    expect(l.parametres).toEqual({ texte: TEXTE, mission_id: missionId });
    expect(l.empreinte).toBe(empreinteParametres(l.parametres));
    expect(new Date(l.expire_le).getTime() - new Date(l.cree_le).getTime()).toBe(
      EXPIRATION_ACTION_COPILOTE_MINUTES * 60_000,
    );
    // Le texte n'entre dans aucune ligne du journal (ni proposition, ni échange).
    expect(await journalContient(a.cabinetId, "comité de pilotage")).toBe(0);
  });

  it("mission de l'écran quand elle n'est pas nommée", async () => {
    const action = await proposer(
      a.chef,
      "Ajoute un commentaire : atelier reporté",
      "ajouter_commentaire",
      { mission_id: missionId },
    );
    expect(action.resume).toContain(`mission « ${INTITULE} »`);
    expect((await demander(a.chef, "Ajoute un commentaire : atelier reporté")).statut).toBe(
      "precision_requise",
    );
  });

  it("texte manquant, trop long, mission ambiguë : précision demandée, rien d'inscrit", async () => {
    const avant = await compterPropositions(a.cabinetId);
    const sans = await demander(a.chef, `Ajoute un commentaire sur la mission ${INTITULE}`);
    expect(sans).toMatchObject({ statut: "precision_requise", outil: "ajouter_commentaire" });
    const long = "x".repeat(COMMENTAIRE_COPILOTE_LONGUEUR_MAX + 1);
    const trop = await demander(
      a.chef,
      `Ajoute un commentaire sur la mission ${INTITULE} : ${long}`,
    );
    expect(trop.statut).toBe("precision_requise");
    expect(trop.texte).toContain(`${COMMENTAIRE_COPILOTE_LONGUEUR_MAX + 1} caractères`);
    // Deuxième mission au nom voisin : « Transformation » est ambigu.
    await creerMissionSignee(a, { intitule: "Transformation Beta" });
    const ambigu = await demander(
      a.chef,
      "Ajoute un commentaire sur la mission Transformation : ok",
    );
    expect(ambigu.statut).toBe("precision_requise");
    expect(ambigu.texte).toContain("Plusieurs missions correspondent");
    expect(await compterPropositions(a.cabinetId)).toBe(avant);
  });

  it("mission non visible, inexistante ou d'un autre cabinet : la MÊME réponse « introuvable »", async () => {
    const message = (nom: string) => `Ajoute un commentaire sur la mission ${nom} : ok`;
    const reponses = [
      await demander(hors, message(INTITULE)),
      await demander(a.chef, message("Zorglub Inexistante")),
      await demander(a.chef, message("Mission secrète B")),
      await demander(b.chef, message(INTITULE)),
    ];
    for (const r of reponses) {
      expect(r).toMatchObject({
        outil: "ajouter_commentaire",
        statut: "precision_requise",
        texte: "Aucune mission visible ne correspond à votre demande.",
      });
    }
    // Mission de l'écran non visible : idem.
    const ecran = await demander(hors, "Ajoute un commentaire : ok", { mission_id: missionId });
    expect(ecran.texte).toBe("Aucune mission visible ne correspond à votre demande.");
  });
});

describe("ajouter_commentaire : confirmation", () => {
  it("le même utilisateur confirme : commentaire créé par le service commun, journal sans texte, usage unique", async () => {
    const action = await proposer(a.chef, MESSAGE_COMMENTAIRE, "ajouter_commentaire");
    const r = await confirmer(a.chef, action.action_id);
    expect(r.statusCode, r.body).toBe(200);
    const resultat = resultatActionCopiloteSchema.parse(r.json());
    expect(resultat).toMatchObject({
      statut: "confirmee",
      texte: `Le commentaire a été ajouté à la mission « ${INTITULE} ».`,
    });
    expect(resultat.elements[0]?.lien).toBe(`/missions/${missionId}`);
    const lignes = await commentaires(a.cabinetId);
    const c = lignes.find((x) => x.texte === TEXTE);
    expect(c).toMatchObject({
      auteur_id: a.chef.utilisateurId,
      entite_type: "mission",
      entite_id: missionId,
      mission_id: missionId,
      mentions: [],
    });
    const l = await ligne(action.action_id);
    expect(l).toMatchObject({ statut: "confirmee", resultat_id: c?.id });
    // Journal du service commun, avec l'origine, sans le texte.
    const creation = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT details FROM journal_audit WHERE cabinet_id = $1 AND entite = 'commentaire' AND entite_id = $2",
            [a.cabinetId, c?.id],
          )
        ).rows,
    );
    expect(creation).toHaveLength(1);
    expect(creation[0].details).toMatchObject({
      entite_type: "mission",
      entite_id: missionId,
      mentions: 0,
      via: "copilote",
    });
    expect(await journalContient(a.cabinetId, "comité de pilotage")).toBe(0);
    // Le fil de la mission le montre (lecture par la route des commentaires).
    const fil = await a.chef.get(`/api/commentaires?entite_type=mission&entite_id=${missionId}`);
    expect(fil.json().elements.map((e: { texte: string }) => e.texte)).toContain(TEXTE);
    // Usage unique.
    expect((await confirmer(a.chef, action.action_id)).statusCode).toBe(409);
    expect((await commentaires(a.cabinetId)).filter((x) => x.texte === TEXTE)).toHaveLength(1);
  });

  it("deux confirmations simultanées : une seule réussit", async () => {
    const action = await proposer(
      a.chef,
      `Commente la mission ${INTITULE} : simultané`,
      "ajouter_commentaire",
    );
    const reponses = await Promise.all([
      confirmer(a.chef, action.action_id),
      confirmer(a.chef, action.action_id),
      confirmer(a.chef, action.action_id),
    ]);
    expect(reponses.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect((await commentaires(a.cabinetId)).filter((x) => x.texte === "simultané")).toHaveLength(
      1,
    );
  });

  it("un autre utilisateur ou un autre cabinet : 404, rien n'est publié", async () => {
    const action = await proposer(
      a.chef,
      `Commente la mission ${INTITULE} : d'un autre`,
      "ajouter_commentaire",
    );
    for (const u of [a.directeur, a.associe, b.associe] as Api[]) {
      expect((await confirmer(u, action.action_id)).statusCode).toBe(404);
    }
    expect((await commentaires(a.cabinetId)).filter((x) => x.texte === "d'un autre")).toHaveLength(
      0,
    );
    expect((await ligne(action.action_id)).statut).toBe("proposee");
  });

  it("proposition expirée (borne comprise), empreinte altérée, permission retirée : refus sans publication", async () => {
    const auth = await authDe(ctx, a.cabinetId, a.chef.utilisateurId);
    // Expirée.
    const expiree = await proposer(
      a.chef,
      `Commente la mission ${INTITULE} : expirée`,
      "ajouter_commentaire",
    );
    const l = await ligne(expiree.action_id);
    const erreur = await confirmerAction(
      ctx.db,
      auth,
      expiree.action_id,
      new Date(l.expire_le),
    ).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(AppError);
    expect(erreur).toMatchObject({ statut: 410, code: "ACTION_EXPIREE" });
    expect((await ligne(expiree.action_id)).statut).toBe("expiree");
    // Empreinte altérée (propriétaire, déclencheur contourné).
    const alteree = await proposer(
      a.chef,
      `Commente la mission ${INTITULE} : altérée`,
      "ajouter_commentaire",
    );
    await proprietaire(async (cl) => {
      await cl.query("ALTER TABLE copilote_actions DISABLE TRIGGER copilote_actions_controle");
      try {
        await cl.query(
          `UPDATE copilote_actions SET parametres = jsonb_set(parametres, '{texte}', '"Texte forgé"') WHERE id = $1`,
          [alteree.action_id],
        );
      } finally {
        await cl.query("ALTER TABLE copilote_actions ENABLE TRIGGER copilote_actions_controle");
      }
    });
    expect((await confirmer(a.chef, alteree.action_id)).statusCode).toBe(409);
    expect((await ligne(alteree.action_id)).statut).toBe("refusee");
    // Permission retirée (droits revérifiés à la confirmation).
    const retiree = await proposer(
      a.chef,
      `Commente la mission ${INTITULE} : sans droit`,
      "ajouter_commentaire",
    );
    const sansDroit = { ...auth, roles: [] };
    const refus = await confirmerAction(ctx.db, sansDroit, retiree.action_id, new Date()).catch(
      (e: unknown) => e,
    );
    expect(refus).toMatchObject({ statut: 403 });
    expect((await ligne(retiree.action_id)).statut).toBe("refusee");
    const textes = (await commentaires(a.cabinetId)).map((x) => x.texte);
    for (const t of ["expirée", "altérée", "Texte forgé", "sans droit"]) {
      expect(textes).not.toContain(t);
    }
  });

  it("mission devenue invisible entre la proposition et la confirmation : 404, rien n'est publié", async () => {
    const u = await a.avecRoles(["chef_mission"]);
    const m = await creerMission(a, { intitule: "Mission éphémère", chef_id: u.utilisateurId });
    const action = await proposer(
      u,
      "Commente la mission Mission éphémère : trop tard",
      "ajouter_commentaire",
    );
    await proprietaire((cl) =>
      cl.query("UPDATE missions SET chef_id = $2 WHERE id = $1", [m.id, a.chef.utilisateurId]),
    );
    expect((await confirmer(u, action.action_id)).statusCode).toBe(404);
    expect((await commentaires(a.cabinetId)).filter((x) => x.texte === "trop tard")).toHaveLength(
      0,
    );
  });

  it("le texte d'un commentaire est stocké avec la proposition puis anonymisé à 30 jours (le commentaire reste)", async () => {
    const action = await proposer(
      a.chef,
      `Commente la mission ${INTITULE} : texte à anonymiser`,
      "ajouter_commentaire",
    );
    expect((await confirmer(a.chef, action.action_id)).statusCode).toBe(200);
    const recente = await ligne(action.action_id);
    // Le texte vit dans les paramètres et le résumé de la proposition (jamais dans le journal).
    expect(JSON.stringify(recente.parametres)).toContain("texte à anonymiser");
    expect(recente.resume).toContain("texte à anonymiser");
    // Copie vieille de 31 jours (insérée par le propriétaire : le rôle applicatif ne peut pas vieillir une ligne).
    const vieille = await proprietaire(async (cl) => {
      const r = await cl.query(
        `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
           cree_le, expire_le)
         VALUES ($1, $2, 'ajouter_commentaire', $3::jsonb, $4, $5, now() - interval '31 days',
           now() - interval '31 days' + interval '5 minutes') RETURNING id`,
        [
          a.cabinetId,
          a.chef.utilisateurId,
          JSON.stringify(recente.parametres),
          recente.empreinte,
          recente.resume,
        ],
      );
      const id = r.rows[0].id as string;
      await cl.query(
        `UPDATE copilote_actions SET statut = 'confirmee', decide_le = cree_le + interval '1 minute',
           resultat_id = $2 WHERE id = $1`,
        [id, recente.resultat_id],
      );
      return id;
    });
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      await creerHandlerCopilotePurge()({
        db,
        cabinetId: a.cabinetId,
        jobId: "test",
        charge: {},
        maintenant: new Date(),
      });
    });
    const apres = await ligne(vieille);
    expect(apres.parametres).toEqual({});
    expect(apres.resume).toBe("Proposition anonymisée (durée de conservation écoulée).");
    expect(apres.empreinte).toBe("0".repeat(64));
    expect(apres.anonymise_le).not.toBeNull();
    expect(JSON.stringify(apres)).not.toContain("texte à anonymiser");
    // La proposition récente n'est pas touchée ; le commentaire publié, contenu de la mission, reste.
    expect((await ligne(action.action_id)).anonymise_le).toBeNull();
    expect((await commentaires(a.cabinetId)).map((x) => x.texte)).toContain("texte à anonymiser");
  });
});

/* ----- Relancer une facture échue ----- */

let f1: { id: string; numero: string };
let f2: { id: string; numero: string };
let fB: { id: string; numero: string };
const relances = (factureId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT id, niveau, mode, email_envoye, cree_par, date_relance::text AS date_relance
           FROM relances_factures WHERE facture_id = $1 ORDER BY cree_le`,
          [factureId],
        )
      ).rows,
  );
const MONTANTS = /100\D?000|FCFA|XOF/;

describe("planifier_relance", () => {
  beforeAll(async () => {
    f1 = await factureDatee(ctx, a, missionId, 100_000, ajouterJours(jour, -90));
    f2 = await factureDatee(ctx, a, missionId, 100_000, ajouterJours(jour, -60));
    fB = await factureDatee(ctx, b, missionB, 100_000, ajouterJours(jour, -90));
  });

  it("sans « encaissement.gerer » (directeur, chef) : refus, rien d'inscrit", async () => {
    const avant = await compterPropositions(a.cabinetId);
    for (const u of [a.directeur, a.chef, hors]) {
      const r = await demander(u, `Relance la facture ${f1.numero}`);
      expect(r).toMatchObject({
        outil: "planifier_relance",
        statut: "refuse",
        texte: "Vous n'avez pas le droit d'effectuer cette action.",
      });
    }
    expect(await compterPropositions(a.cabinetId)).toBe(avant);
  });

  it("facture inconnue, d'un autre cabinet : la même réponse « aucune facture échue visible »", async () => {
    // Les numéros sont propres à chaque cabinet : FA-…-00002 n'existe que dans le cabinet A.
    const reponses = [
      await demander(b.gestionnaire, `Relance la facture ${f2.numero}`),
      await demander(a.gestionnaire, "Relance la facture ZZ-0000-9999"),
    ];
    for (const r of reponses) {
      expect(r.statut).toBe("precision_requise");
      expect(r.texte).toMatch(/^Aucune facture échue visible ne correspond à « .+ »\. /);
    }
    // Sans facture précise : on la demande.
    expect((await demander(a.gestionnaire, "Relance les factures échues")).texte).toContain(
      "Quelle facture relancer ?",
    );
  });

  it("PROPOSE : résumé sans montant, niveau 1, rien d'enregistré", async () => {
    const action = await proposer(
      a.gestionnaire,
      `Relance la facture ${f1.numero}`,
      "planifier_relance",
    );
    expect(action).toMatchObject({
      outil: "planifier_relance",
      libelle: "Relancer une facture échue",
    });
    expect(action.resume).toContain(
      `facture ${f1.numero} du client « Client de Cabinet Copilote Outils A »`,
    );
    expect(action.resume).toContain("relance de niveau 1");
    expect(action.resume).toContain("jours de retard");
    expect(action.resume).toContain("Aucun e-mail n'est envoyé au client");
    expect(action.resume).not.toMatch(MONTANTS);
    expect(await relances(f1.id)).toHaveLength(0);
    const l = await ligne(action.action_id);
    expect(l.parametres).toEqual({ facture_id: f1.id, niveau: 1 });
    expect(l.empreinte).toBe(empreinteParametres(l.parametres));
    // Associé (voit tout, droit présent) : même proposition possible.
    expect((await demander(a.associe, `Relance la facture ${f1.numero}`)).statut).toBe(
      "action_proposee",
    );
  });

  it("confirmation par le même utilisateur : relance manuelle SANS e-mail au client, journal, usage unique", async () => {
    const action = await proposer(
      a.gestionnaire,
      `Relance la facture ${f1.numero}`,
      "planifier_relance",
    );
    // Un autre utilisateur du cabinet, ou d'un autre : 404.
    for (const u of [a.associe, b.gestionnaire] as Api[]) {
      expect((await confirmer(u, action.action_id)).statusCode).toBe(404);
    }
    expect(await relances(f1.id)).toHaveLength(0);
    const r = await confirmer(a.gestionnaire, action.action_id);
    expect(r.statusCode, r.body).toBe(200);
    const resultat = resultatActionCopiloteSchema.parse(r.json());
    expect(resultat.statut).toBe("confirmee");
    expect(resultat.texte).toBe(
      `La relance de niveau 1 de la facture ${f1.numero} a été enregistrée. Aucun e-mail n'a été envoyé au client.`,
    );
    expect(resultat.elements[0]?.lien).toBe(`/facturation/${f1.id}`);
    expect(JSON.stringify(resultat)).not.toMatch(MONTANTS);
    const lignes = await relances(f1.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      niveau: 1,
      mode: "manuelle",
      email_envoye: false,
      cree_par: a.gestionnaire.utilisateurId,
    });
    expect(await ligne(action.action_id)).toMatchObject({
      statut: "confirmee",
      resultat_id: lignes[0].id,
    });
    const journal = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT details FROM journal_audit WHERE cabinet_id = $1 AND action = 'relance' AND entite_id = $2",
            [a.cabinetId, f1.id],
          )
        ).rows,
    );
    expect(journal[0].details).toMatchObject({
      niveau: 1,
      mode: "manuelle",
      email: false,
      via: "copilote",
    });
    // Double confirmation : refusée, une seule relance.
    expect((await confirmer(a.gestionnaire, action.action_id)).statusCode).toBe(409);
    expect(await relances(f1.id)).toHaveLength(1);
  });

  it("une seule relance manuelle par facture et par jour via le copilote", async () => {
    const r = await demander(a.gestionnaire, `Relance la facture ${f1.numero}`);
    expect(r.statut).toBe("precision_requise");
    expect(r.texte).toContain("Une relance a déjà été enregistrée aujourd'hui");
  });

  it("deux propositions le même jour : la seconde confirmation est refusée (revérifié à la confirmation)", async () => {
    const f3 = await factureDatee(ctx, a, missionId, 100_000, ajouterJours(jour, -45));
    const message = `Relance la facture ${f3.numero}`;
    const premiere = await proposer(a.gestionnaire, message, "planifier_relance");
    const seconde = await proposer(a.gestionnaire, message, "planifier_relance");
    expect((await confirmer(a.gestionnaire, premiere.action_id)).statusCode).toBe(200);
    const refus = await confirmer(a.gestionnaire, seconde.action_id);
    expect(refus.statusCode, refus.body).toBe(409);
    expect(refus.json().erreur.code).toBe("RELANCE_DEJA_ENREGISTREE");
    expect(await relances(f3.id)).toHaveLength(1);
    await annuler(a.gestionnaire, seconde.action_id);
  });

  it("client commun à plusieurs factures échues : on demande le numéro", async () => {
    const r = await demander(
      a.gestionnaire,
      "Relance la facture de Client de Cabinet Copilote Outils A",
    );
    expect(r.statut).toBe("precision_requise");
    expect(r.texte).toContain("Plusieurs factures échues correspondent");
    expect(r.texte).toContain(f2.numero);
  });

  it("niveau suivant : une relance de niveau 1 existante donne le niveau 2", async () => {
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO relances_factures (cabinet_id, facture_id, niveau, mode, date_relance, jours_retard,
           cree_par) VALUES ($1, $2, 1, 'manuelle', $3, 50, $4)`,
        [a.cabinetId, f2.id, ajouterJours(jour, -10), a.gestionnaire.utilisateurId],
      ),
    );
    const action = await proposer(
      a.gestionnaire,
      `Planifie une relance pour la facture ${f2.numero}`,
      "planifier_relance",
    );
    expect(action.resume).toContain("relance de niveau 2");
    expect((await ligne(action.action_id)).parametres).toEqual({ facture_id: f2.id, niveau: 2 });
    await annuler(a.gestionnaire, action.action_id);
  });

  it("permission retirée entre la proposition et la confirmation : 403, « refusee », aucune relance", async () => {
    const u = await a.avecRoles(["gestionnaire"]);
    const action = await proposer(u, `Relance la facture ${f2.numero}`, "planifier_relance");
    await proprietaire((cl) =>
      cl.query("UPDATE utilisateurs SET roles = '{chef_mission}' WHERE id = $1", [u.utilisateurId]),
    );
    const r = await confirmer(u, action.action_id);
    expect(r.statusCode, r.body).toBe(403);
    expect((await ligne(action.action_id)).statut).toBe("refusee");
    expect((await relances(f2.id)).filter((x) => x.cree_par === u.utilisateurId)).toHaveLength(0);
  });

  it("expirée, empreinte altérée, facture d'un autre cabinet forgée : rien n'est enregistré", async () => {
    const auth = await authDe(ctx, a.cabinetId, a.gestionnaire.utilisateurId);
    const avant = (await relances(f2.id)).length;
    // Expirée.
    const expiree = await proposer(
      a.gestionnaire,
      `Relance la facture ${f2.numero}`,
      "planifier_relance",
    );
    const l = await ligne(expiree.action_id);
    const erreur = await confirmerAction(
      ctx.db,
      auth,
      expiree.action_id,
      new Date(l.expire_le),
    ).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ statut: 410, code: "ACTION_EXPIREE" });
    // Empreinte altérée.
    const alteree = await proposer(
      a.gestionnaire,
      `Relance la facture ${f2.numero}`,
      "planifier_relance",
    );
    await proprietaire(async (cl) => {
      await cl.query("ALTER TABLE copilote_actions DISABLE TRIGGER copilote_actions_controle");
      try {
        await cl.query(
          `UPDATE copilote_actions SET parametres = jsonb_set(parametres, '{niveau}', '3') WHERE id = $1`,
          [alteree.action_id],
        );
      } finally {
        await cl.query("ALTER TABLE copilote_actions ENABLE TRIGGER copilote_actions_controle");
      }
    });
    expect((await confirmer(a.gestionnaire, alteree.action_id)).statusCode).toBe(409);
    expect((await ligne(alteree.action_id)).statut).toBe("refusee");
    // Proposition FORGÉE (empreinte juste) vers la facture d'un autre cabinet : introuvable.
    const parametres = { facture_id: fB.id, niveau: 1 };
    const forgee = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
               expire_le) VALUES ($1, $2, 'planifier_relance', $3::jsonb, $4, 'Relance forgée.',
               now() + interval '5 minutes') RETURNING id`,
            [
              a.cabinetId,
              a.gestionnaire.utilisateurId,
              JSON.stringify(parametres),
              empreinteParametres(parametres),
            ],
          )
        ).rows[0].id as string,
    );
    expect((await confirmer(a.gestionnaire, forgee)).statusCode).toBe(404);
    expect(await relances(fB.id)).toHaveLength(0);
    expect(await relances(f2.id)).toHaveLength(avant);
  });
});

/* ----- Mes missions en retard ----- */

describe("missions_en_retard", () => {
  let echue: string;

  beforeAll(async () => {
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO mission_jalons (cabinet_id, mission_id, libelle, date_prevue, ordre, atteint)
         VALUES ($1, $2, 'Comité de lancement', $3, 1, false), ($1, $2, 'Atelier 2', $4, 2, false),
                ($1, $2, 'Jalon atteint', $3, 3, true), ($1, $2, 'Livraison', $5, 4, false)`,
        [
          a.cabinetId,
          missionId,
          ajouterJours(jour, -10),
          ajouterJours(jour, -3),
          ajouterJours(jour, 30),
        ],
      ),
    );
    echue = (
      await creerMissionSignee(
        a,
        { intitule: "Mission échue", date_debut: "2026-01-05", date_fin: "2026-02-27" },
        { date_signature: "2026-01-02" },
      )
    ).id;
    await creerMissionSignee(a, { intitule: "Mission à jour" });
    await proprietaire((cl) =>
      cl.query("UPDATE missions SET date_fin = '2099-12-31' WHERE intitule = 'Mission à jour'"),
    );
  });

  it("le chef voit ses missions en retard (jalons dépassés, fin dépassée) : faits, liens, ordre", async () => {
    const r = await demander(a.chef, "Quelles sont mes missions en retard ?");
    expect(r).toMatchObject({ outil: "missions_en_retard", statut: "ok", mode: "deterministe" });
    expect(r.texte).toBe("2 missions en retard parmi celles dont vous êtes responsable ou membre.");
    expect(r.elements.map((e) => e.libelle)).toEqual(["Mission échue", INTITULE]);
    expect(r.elements[0]).toMatchObject({
      detail: "date de fin prévue dépassée (27/02/2026)",
      lien: `/missions/${echue}`,
    });
    expect(r.elements[1]).toMatchObject({
      detail: `2 jalons en retard (le plus ancien prévu le ${formaterDateCopilote(ajouterJours(jour, -10))})`,
      lien: `/missions/${missionId}`,
    });
  });

  it("un membre de l'équipe voit la mission ; un non-membre (associé, consultant extérieur) rien", async () => {
    const m = await demander(membre, "mes missions en retard");
    expect(m.texte).toBe("1 mission en retard parmi celles dont vous êtes responsable ou membre.");
    expect(m.elements.map((e) => e.libelle)).toEqual([INTITULE]);
    for (const u of [a.associe, hors] as Api[]) {
      const r = await demander(u, "Quelles missions sont en retard ?");
      if (r.statut === "ok") {
        expect(r.texte).toBe("Aucune de vos missions n'est en retard : tout est à jour.");
      } else {
        expect(r.statut).toBe("refuse");
      }
      expect(JSON.stringify(r)).not.toContain(INTITULE);
    }
  });

  it("isolation entre cabinets : l'autre cabinet ne voit rien du premier", async () => {
    const r = await demander(b.chef, "Quelles sont mes missions en retard ?");
    expect(r.texte).toBe("Aucune de vos missions n'est en retard : tout est à jour.");
    expect(JSON.stringify(r)).not.toContain(INTITULE);
  });
});

/* ----- Retards sur les feuilles de temps ----- */

describe("retard_feuilles_temps", () => {
  let u1: ApiUtilisateur & { collaborateurId: string };
  let u2: ApiUtilisateur & { collaborateurId: string };
  let u3: ApiUtilisateur & { collaborateurId: string };
  const semaines = semainesEcoulees(jour, 4);
  const nom = (u: ApiUtilisateur) => `Collaborateur consultant ${u.utilisateurId.slice(0, 8)}`;

  beforeAll(async () => {
    u1 = await utilisateurCollaborateur(a, ["consultant"], "junior");
    u2 = await utilisateurCollaborateur(a, ["consultant"], "junior");
    u3 = await utilisateurCollaborateur(a, ["consultant"], "junior");
    const m = await missionPlanifiable(a);
    for (const u of [u1, u3]) {
      const r = await a.chef.post(
        `/api/missions/${m.id}/affectations`,
        affectationNominative(m, u.collaborateurId),
      );
      expect(r.statusCode, r.body).toBe(201);
    }
    await proprietaire(async (cl) => {
      // Collaborateurs attendus depuis plus de quatre semaines.
      await cl.query(
        "UPDATE collaborateurs SET cree_le = now() - interval '120 days' WHERE cabinet_id = $1",
        [a.cabinetId],
      );
      // u2 : un brouillon sur la plus ancienne semaine ; u1 : en congé validé cette même semaine.
      await cl.query(
        `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine, origine)
         VALUES ($1, $2, $3, $4, 'saisie')`,
        [a.cabinetId, u2.collaborateurId, u2.utilisateurId, semaines[0]],
      );
      await cl.query(
        `INSERT INTO absences (cabinet_id, collaborateur_id, demandeur_id, type, date_debut, date_fin,
           statut, decide_par, decide_le)
         VALUES ($1, $2, $3, 'conge_paye', $4, $5, 'validee', $6, now())`,
        [
          a.cabinetId,
          u1.collaborateurId,
          u1.utilisateurId,
          semaines[0],
          ajouterJours(semaines[0] as string, 6),
          a.associeId,
        ],
      );
    });
    // u3 est à jour : feuilles validées sur les quatre semaines.
    for (const s of semaines) {
      await feuilleValidee({
        cabinetId: a.cabinetId,
        collaborateurId: u3.collaborateurId,
        semaine: s,
        auteurId: u3.utilisateurId,
        lignes: [],
      });
    }
  });

  it("les quatre dernières semaines ENTIÈREMENT écoulées", () => {
    expect(semaines).toHaveLength(4);
    expect(semaines.every((s) => ajouterJours(s, 6) < jour)).toBe(true);
    expect(ajouterJours(semaines[3] as string, 7) > ajouterJours(jour, -7)).toBe(true);
  });

  it("le chef de mission voit les collaborateurs de ses missions seulement (u3 à jour, u2 hors périmètre)", async () => {
    const r = await demander(a.chef, "Qui est en retard sur les feuilles de temps ?");
    expect(r).toMatchObject({ outil: "retard_feuilles_temps", statut: "ok" });
    expect(r.texte).toBe(
      "1 collaborateur en retard sur ses feuilles de temps (sur les 4 dernières semaines écoulées).",
    );
    // u1 : la semaine de congé validé n'est pas un retard.
    expect(r.elements).toEqual([
      {
        libelle: nom(u1),
        detail: `3 semaines non soumises · la plus ancienne : semaine du ${formaterDateCopilote(semaines[1] as string)}`,
        lien: "/temps/validation",
      },
    ]);
    expect(JSON.stringify(r)).not.toContain(nom(u2));
  });

  it("le directeur (périmètre du cabinet) voit aussi u2, trié par retard décroissant ; jamais un coût ni un taux (FIN-02)", async () => {
    const r = await demander(
      a.directeur,
      "Quels collaborateurs sont en retard sur leur saisie des temps ?",
    );
    expect(r.outil).toBe("retard_feuilles_temps");
    expect(r.texte).toBe(
      "2 collaborateurs en retard sur leurs feuilles de temps (sur les 4 dernières semaines écoulées).",
    );
    expect(r.elements.map((e) => e.libelle)).toEqual([nom(u2), nom(u1)]);
    expect(r.elements[0]?.detail).toContain("4 semaines non soumises");
    expect(JSON.stringify(r)).not.toMatch(/co[uû]t|taux|marge|FCFA|XOF|50\D?000/i);
  });

  it("sans périmètre d'équipe (consultant) : « pas accès », comme une ressource non permise", async () => {
    const r = await demander(u1, "Qui est en retard sur les feuilles de temps ?");
    expect(r).toMatchObject({
      outil: "retard_feuilles_temps",
      statut: "refuse",
      texte: "Vous n'avez pas accès à cette information.",
      elements: [],
    });
    expect(JSON.stringify(r)).not.toContain(nom(u2));
  });

  it("isolation entre cabinets : l'autre cabinet ne voit aucun collaborateur du premier", async () => {
    const r = await demander(b.directeur, "Qui est en retard sur les feuilles de temps ?");
    expect(r.texte).toContain("Aucun collaborateur de votre périmètre n'est en retard");
    expect(r.elements).toEqual([]);
  });
});

/* ----- Niveau d'autonomie : la lecture reste permise, les actions disparaissent sous N2 ----- */

describe("agent limité à la lecture (N1)", () => {
  let c: CabinetFacturation;
  const EXEMPLES_ACTIONS = /Crée une tâche|Ajoute un commentaire|Relance la facture/;

  const plafonner = async (niveau: string | null) => {
    const r = await c.associe.put("/api/agents/copilote/restriction", {
      actif: true,
      niveau_max: niveau,
      motif: "Essai du niveau de l'agent",
    });
    expect(r.statusCode, r.body).toBe(200);
  };

  beforeAll(async () => {
    c = await preparerFacturation(ctx, "Cabinet Copilote Outils N1");
    await creerMissionSignee(c, { intitule: "Mission N1" });
  });

  it("N2 : l'aide cite les actions ; N1 : aucune action, les lectures restent", async () => {
    expect((await demander(c.associe, "aide")).texte).toMatch(EXEMPLES_ACTIONS);
    const avant = await proposer(
      c.chef,
      "Commente la mission Mission N1 : posée avant le plafond",
      "ajouter_commentaire",
    );
    await plafonner("N1");
    try {
      const aide = await demander(c.associe, "aide");
      expect(aide.statut).toBe("aide");
      expect(aide.texte).not.toMatch(EXEMPLES_ACTIONS);
      expect(aide.texte).toContain("Quelles sont mes missions en retard ?");
      // Lectures permises dès N1, y compris les deux nouvelles.
      expect((await demander(c.chef, "mes missions en retard")).statut).toBe("ok");
      expect(
        (await demander(c.directeur, "Qui est en retard sur les feuilles de temps ?")).statut,
      ).toBe("ok");
      // Une demande d'action : message clair (200), pas une erreur 409, rien d'inscrit.
      const compte = await compterPropositions(c.cabinetId);
      for (const [u, message, outil] of [
        [
          c.chef,
          "Ajoute un commentaire sur la mission Mission N1 : interdit",
          "ajouter_commentaire",
        ],
        [c.gestionnaire, "Relance la facture F-2026-0001", "planifier_relance"],
        [c.chef, "Crée une tâche : interdite", "creer_tache"],
      ] as const) {
        const r = await demander(u, message);
        expect(r).toMatchObject({ outil, statut: "refuse", elements: [] });
        expect(r.action).toBeUndefined();
        expect(r.texte).toContain(
          "Cette action n'est pas disponible : l'agent est limité à la lecture",
        );
      }
      expect(await compterPropositions(c.cabinetId)).toBe(compte);
      // Sans le droit : le message ordinaire de refus (pas d'indice sur le niveau).
      const consultant = await c.avecRoles(["consultant"]);
      expect((await demander(consultant, "Relance la facture F-2026-0001")).texte).toBe(
        "Vous n'avez pas le droit d'effectuer cette action.",
      );
      // Confirmation d'une proposition antérieure : 409, rien n'est publié.
      const conf = await confirmer(c.chef, avant.action_id);
      expect(conf.statusCode, conf.body).toBe(409);
      expect(conf.json().erreur.code).toBe("COPILOTE_ACTION_NON_AUTORISEE");
      expect(await commentaires(c.cabinetId)).toHaveLength(0);
    } finally {
      await plafonner(null);
    }
    // Rétabli : la même proposition (non expirée) se confirme et l'aide cite de nouveau les actions.
    expect((await confirmer(c.chef, avant.action_id)).statusCode).toBe(200);
    expect((await demander(c.associe, "aide")).texte).toMatch(EXEMPLES_ACTIONS);
  });

  it("catalogue d'actions et registre : une entrée par action du catalogue", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...OUTILS_ACTION_COPILOTE].sort());
  });
});

/* ----- Fiche de l'agent « copilote » dans le registre standard (migration 0277) ----- */

describe("registre standard : copilote version 3", () => {
  it("la fiche /agents décrit les actions confirmées, le niveau N2 et l'absence d'exécution directe", async () => {
    const r = await a.associe.get("/api/agents/copilote");
    expect(r.statusCode, r.body).toBe(200);
    const agent = r.json();
    expect(agent).toMatchObject({
      code: "copilote",
      version: 3,
      niveau_max_standard: "N2",
      droits: ["copilote.utiliser"],
    });
    expect(agent.mission).toContain("créer une tâche");
    expect(agent.mission).toContain("ajouter un commentaire");
    expect(agent.mission).toContain("relance");
    expect(agent.ne_fait_jamais).toContain("sans sa confirmation explicite");
    expect(agent.ne_fait_jamais).toContain("écrire au client");
    expect(agent.notes_version).toMatch(/creer_tache.*ajouter_commentaire.*planifier_relance/);
    expect(agent.notes_version).toContain("niveau N2");
    expect(agent.outils_autorises).toContain("proposer_relance");
    // La liste du registre sert la dernière version, une seule ligne par agent.
    const liste = (await a.associe.get("/api/agents")).json().elements as {
      code: string;
      version: number;
    }[];
    expect(liste.filter((x) => x.code === "copilote")).toEqual([
      expect.objectContaining({ code: "copilote", version: 3 }),
    ]);
  });

  it("historique en ajout seul : les versions 1 et 2 restent, la 3 ne remplace rien", async () => {
    const versions = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT version, niveau_max FROM agents_registre WHERE code = 'copilote' ORDER BY version",
          )
        ).rows,
    );
    expect(versions).toEqual([
      { version: 1, niveau_max: "N1" },
      { version: 2, niveau_max: "N2" },
      { version: 3, niveau_max: "N2" },
    ]);
  });
});

/* ----- Accord de la phrase « Aucun KPI au rouge » ----- */

describe("kpi_rouges : accord du singulier et du pluriel", () => {
  it("« sur votre mission » pour une seule mission, « sur vos N missions » sinon", async () => {
    const n = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT count(*)::int AS n FROM missions WHERE cabinet_id = $1 AND chef_id = $2
               AND statut IN ('signee', 'en_cours', 'a_cloturer')`,
            [a.cabinetId, a.chef.utilisateurId],
          )
        ).rows[0].n as number,
    );
    expect(n).toBeGreaterThan(1);
    expect((await demander(a.chef, "Quels KPI sont au rouge ?")).texte).toBe(
      `Aucun KPI au rouge sur vos ${n} missions.`,
    );
    const seul = await a.avecRoles(["chef_mission"]);
    await creerMissionSignee(a, {
      intitule: "Mission unique du chef",
      chef_id: seul.utilisateurId,
    });
    expect((await demander(seul, "Quels KPI sont au rouge ?")).texte).toBe(
      "Aucun KPI au rouge sur votre mission.",
    );
  });
});
