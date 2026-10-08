import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONSERVATION_RAPPORTS } from "@missionpilot/shared";
import { CONSERVATION_JOURS_DEFAUT, MENTION_IA_DEFAUT } from "../src/rapports/parametres.js";
import { cheminNavigateur } from "../src/rapports/pdf.js";
import { detecterType } from "../src/stockage/detection.js";
import { api, type Api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { configTest, MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";

/*
 * Rapports de service (SOC-07) : notation publiée (NOT-07) et plan
 * stratégique (PLA-11) en PDF et Word ; niveaux « notation » et « plan »
 * revérifiés à chaque lecture ; contenus non validés jamais reproduits ;
 * paramètres du cabinet (conservation, mention de la contribution de l'IA).
 */

interface RapportCree {
  rapport: {
    id: string;
    modele: string;
    niveau: string;
    statut: string;
    format: string;
    notation_id: string | null;
    plan_id: string | null;
    version_source: number | null;
  };
  fichier: { id: string };
}

let ctx: Contexte & { dossier: string };
let s: ScenarioQuestionnaires;
let notationId: string;
let planId: string;
let rNotation: RapportCree;
const navigateur = cheminNavigateur(configTest());

const MARQUEUR_NON_VALIDE = "TEXTE-NON-VALIDE-JAMAIS-REPRODUIT";
const SCORE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Cas A du moteur (plans-modele.test.ts). */
const hypotheses = {
  premierExercice: 2027,
  chiffreAffairesReference: 100_000_000,
  croissanceChiffreAffaires: 10,
  tauxMargeBrute: 40,
  tauxChargesVariables: 5,
  chargesFixes: 10_000_000,
  effectifs: [
    { libelle: "Consultants", effectifs: 4, salaireAnnuelBrut: 3_000_000, tauxChargesSociales: 20 },
  ],
  investissements: [{ libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 }],
  emprunts: [
    { libelle: "Prêt bancaire", anneeDeblocage: 1, montant: 10_000_000, tauxAnnuel: 10, duree: 2 },
  ],
  delaiClientsJours: 36,
  delaiFournisseursJours: 60,
  stocksJours: 30,
  tauxImpotSocietes: 25,
  tauxActualisation: 10,
  bilanOuverture: { tresorerie: 20_000_000, capital: 20_000_000 },
};

async function telecharger(par: Api, fichierId: string): Promise<{ statut: number; xml: string }> {
  const r = await par.get(`/api/fichiers/${fichierId}`);
  if (r.statusCode !== 200) return { statut: r.statusCode, xml: "" };
  return { statut: 200, xml: toutLeXml(dezipper(r.rawPayload)) };
}

async function generer(par: Api, chemin: string): Promise<RapportCree> {
  const r = await par.post(chemin);
  attendre(201, r, chemin);
  return r.json();
}

const ids = async (par: Api, chemin: string): Promise<string[]> => {
  const r = await par.get(chemin);
  attendre(200, r, chemin);
  return r.json().elements.map((e: { id: string }) => e.id);
};

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerQuestionnaires(ctx);
  const { versionId, definition } = await versionValidee(s.consultant, "notation_rapport");
  const envoiId = await envoyer(s.consultant, s.missionId, versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId },
    { utilisateur_id: s.contributeur.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 4));
  await repondre(s.contributeur, envoiId, reponsesAuNiveau(definition, 2));
  const n = await s.consultant.post(`/api/missions/${s.missionId}/notation`, {});
  attendre(201, n, "notation");
  notationId = n.json().id;
  const v = await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoiId });
  attendre(201, v, "calcul");
  const dimension = v.json().resultat.dimensions.find((d: { notable: boolean }) => d.notable)
    .dimension as string;
  attendre(
    201,
    await s.consultant.post(`/api/notations/${notationId}/ajustements`, {
      dimension,
      delta: 2.5,
      motif: "Entretien <b>direction</b> : revue mensuelle effective.",
    }),
    "ajustement",
  );

  const plan = await s.a.chef.post(`/api/missions/${s.missionId}/plans`, {
    titre: "Plan <Kora> 2027-2031",
  });
  attendre(201, plan, "plan");
  planId = plan.json().id;
}, 240_000);
afterAll(() => ctx.fermer());

describe("rapport de notation (NOT-07)", () => {
  const url = (format = "docx", q = "") =>
    `/api/notations/${notationId}/rapports?format=${format}${q}`;

  it("401, 403 sans notation.lire, 404 hors équipe et autre cabinet, 400 format", async () => {
    expect((await s.anonyme.post(url())).statusCode).toBe(401);
    expect((await s.anonyme.get(`/api/notations/${notationId}/rapports`)).statusCode).toBe(401);
    // Gestionnaire : lit toutes les missions, mais pas les notations.
    expect((await s.gestionnaire.post(url())).statusCode).toBe(403);
    expect((await s.gestionnaire.get(`/api/notations/${notationId}/rapports`)).statusCode).toBe(
      403,
    );
    expect((await s.horsEquipe.post(url())).statusCode).toBe(404);
    expect((await s.b.associe.post(url())).statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/notations/${notationId}/rapports`)).statusCode).toBe(404);
    expect((await s.consultant.post(url("pptx"))).statusCode).toBe(400);
    expect((await s.consultant.post(url("docx", "&version=0"))).statusCode).toBe(400);
  });

  it("avant publication : 409 NOTATION_NON_PUBLIEE, rien n'est écrit", async () => {
    const r = await s.consultant.post(url());
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("NOTATION_NON_PUBLIEE");
    expect(await ids(s.consultant, `/api/notations/${notationId}/rapports`)).toEqual([]);
  });

  it("version publiée : Word au niveau « notation », statut validé, scores du moteur", async () => {
    attendre(200, await s.consultant.post(`/api/notations/${notationId}/soumettre`), "soumission");
    attendre(200, await s.expert.post(`/api/notations/${notationId}/publier`), "publication");
    rNotation = await generer(s.consultant, url());
    expect(rNotation.rapport).toMatchObject({
      modele: "notation",
      niveau: "notation",
      statut: "valide",
      format: "docx",
      notation_id: notationId,
      version_source: 1,
      plan_id: null,
    });
    const donnees = (await s.consultant.get(`/api/notations/${notationId}/rapport`)).json();
    const { statut, xml } = await telecharger(s.consultant, rNotation.fichier.id);
    expect(statut).toBe(200);
    expect(xml).toContain("Rapport de notation");
    expect(xml).toContain(`${SCORE.format(donnees.donnees.global.score)} / 100`);
    expect(xml).toContain("Ajustements motivés");
    // Motif saisi : échappé, jamais interprété.
    expect(xml).toContain("&lt;b&gt;direction&lt;/b&gt;");
    expect(xml).not.toContain("<b>direction");
    // Mention par défaut du cabinet en pied de page (décision 21.2).
    expect(xml).toContain(MENTION_IA_DEFAUT.slice(0, 60));
    // Aucun nom de répondant du client (écarts entre répondants non reproduits).
    expect(xml).not.toContain("Personne cliente");
  });

  it("une version non publiée demandée explicitement : 409 ; inexistante : 404", async () => {
    // Nouveau calcul : version 2 en brouillon.
    const envoi = (await s.consultant.get(`/api/notations/${notationId}/version`)).json().envoi_id;
    attendre(
      201,
      await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoi }),
      "calcul 2",
    );
    expect((await s.consultant.post(url("docx", "&version=2"))).statusCode).toBe(409);
    expect((await s.consultant.post(url("docx", "&version=9"))).statusCode).toBe(404);
    // Sans version : la dernière PUBLIÉE (1).
    const r = await generer(s.expert, url());
    expect(r.rapport.version_source).toBe(1);
  });

  it.skipIf(!navigateur)("PDF réel, accepté par la détection du stockage", async () => {
    const r = await generer(s.expert, url("pdf"));
    const f = await s.consultant.get(`/api/fichiers/${r.fichier.id}`);
    expect(f.statusCode).toBe(200);
    expect(f.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(detecterType(f.rawPayload, "pdf").type).toBe("application/pdf");
  });

  it("lecture revérifiée : sans notation.lire, ni fichier ni liste, même en lisant toutes les missions", async () => {
    expect((await s.gestionnaire.get(`/api/fichiers/${rNotation.fichier.id}`)).statusCode).not.toBe(
      200,
    );
    expect(await ids(s.gestionnaire, `/api/missions/${s.missionId}/rapports`)).not.toContain(
      rNotation.rapport.id,
    );
    expect(await ids(s.a.chef, `/api/missions/${s.missionId}/rapports`)).toContain(
      rNotation.rapport.id,
    );
    expect(await ids(s.a.chef, `/api/notations/${notationId}/rapports`)).toContain(
      rNotation.rapport.id,
    );
    expect((await s.horsEquipe.get(`/api/fichiers/${rNotation.fichier.id}`)).statusCode).toBe(404);
  });

  it("portail : routes fermées (liste blanche inchangée)", async () => {
    expect((await s.dirigeant.post(url())).statusCode).toBe(403);
    expect((await s.dirigeant.get(`/api/notations/${notationId}/rapports`)).statusCode).toBe(403);
    expect((await s.dirigeant.get(`/api/fichiers/${rNotation.fichier.id}`)).statusCode).toBe(403);
  });

  it("défense en base : version non publiée (MPR02) ; notation d'une autre mission (MPR01)", async () => {
    const inserer = (valeurs: unknown[]) =>
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut,
             niveau, genere_par, notation_id, version_source)
           VALUES ($1, $2, $3, 'notation', 'docx', 'valide', 'notation', $4, $5, $6)`,
          valeurs,
        ),
      );
    const base = [s.a.cabinetId, s.missionId, rNotation.fichier.id, s.consultant.utilisateurId];
    await expect(inserer([...base, notationId, 2])).rejects.toMatchObject({ code: "MPR02" });
    const autre = (await creerMission(s.a, { intitule: "Autre mission" })).id;
    await expect(
      inserer([
        s.a.cabinetId,
        autre,
        rNotation.fichier.id,
        s.consultant.utilisateurId,
        notationId,
        1,
      ]),
    ).rejects.toMatchObject({ code: "MPR01" });
    // Incohérence de modèle et de niveau : refusée par la contrainte.
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut,
             niveau, genere_par, notation_id, version_source)
           VALUES ($1, $2, $3, 'notation', 'docx', 'valide', 'base', $4, $5, 1)`,
          [...base, notationId],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("rapport de plan stratégique (PLA-11)", () => {
  const url = (format = "docx", q = "") => `/api/plans/${planId}/rapports?format=${format}${q}`;
  let axeId: string;
  let brouillonId: string;

  it("401, 403 sans plan.lire, 404 hors équipe et autre cabinet", async () => {
    expect((await s.anonyme.post(url())).statusCode).toBe(401);
    expect((await s.gestionnaire.post(url())).statusCode).toBe(403);
    expect((await s.gestionnaire.get(`/api/plans/${planId}/rapports`)).statusCode).toBe(403);
    expect((await s.horsEquipe.post(url())).statusCode).toBe(404);
    expect((await s.b.associe.post(url())).statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/plans/${planId}/rapports`)).statusCode).toBe(404);
  });

  it("contenus non validés jamais reproduits ; statut brouillon ; chiffres du moteur", async () => {
    const element = async (corps: Record<string, unknown>) => {
      const r = await s.consultant.post(`/api/plans/${planId}/elements`, corps);
      attendre(201, r, "élément");
      return r.json().id as string;
    };
    const valider = async (id: string) =>
      attendre(
        200,
        await s.a.chef.post(`/api/plans/${planId}/elements/${id}/validation`),
        "validation",
      );
    axeId = await element({
      type: "axe",
      donnees: { titre: "Croissance régionale", description: "Ouvrir deux pays" },
    });
    const objectifId = await element({
      type: "objectif",
      parent_id: axeId,
      donnees: { titre: "Doubler le CA export", perspective: "finances", cible: "x2" },
    });
    const initiativeId = await element({
      type: "initiative",
      parent_id: objectifId,
      donnees: {
        titre: "Filiale au Sénégal",
        echeance: "2027-11-30",
        budget: 25_000_000,
        gains_annuels: [10_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000],
      },
    });
    brouillonId = await element({
      type: "diagnostic",
      donnees: { synthese: `${MARQUEUR_NON_VALIDE} <script>alert(1)</script>` },
    });
    for (const id of [axeId, objectifId, initiativeId]) await valider(id);
    attendre(
      201,
      await s.consultant.post(`/api/plans/${planId}/modeles`, { hypotheses }),
      "modèle",
    );

    const r = await generer(s.consultant, url());
    expect(r.rapport).toMatchObject({
      modele: "plan_strategique",
      niveau: "plan",
      statut: "brouillon",
      plan_id: planId,
      // Modèle financier (version 1) non validé : non repris, donc aucune version en source.
      version_source: null,
      notation_id: null,
    });
    const { xml } = await telecharger(s.consultant, r.fichier.id);
    expect(xml).toContain("Plan stratégique");
    expect(xml).toContain("Croissance régionale");
    expect(xml).toContain("Doubler le CA export");
    expect(xml).toContain("Filiale au Sénégal");
    expect(xml).toContain("Modèle financier non validé, non repris");
    expect(xml).not.toContain("Compte de résultat prévisionnel");
    expect(xml).not.toContain("Bilan prévisionnel");
    // Même en le demandant explicitement : une version non validée n'est jamais reproduite.
    const explicite = await generer(s.consultant, url("docx", "&version=1"));
    expect(explicite.rapport.version_source).toBeNull();
    expect((await telecharger(s.consultant, explicite.fichier.id)).xml).not.toContain(
      "Bilan prévisionnel",
    );
    expect(xml).toContain("1 contenu(s) en attente de validation");
    expect(xml).not.toContain(MARQUEUR_NON_VALIDE);
    expect(xml).not.toContain("<script");
    // Montants formatés par le moteur (espace fine insécable, symbole FCFA).
    expect(xml).toContain("25 000 000 FCFA");
    // Titre du plan saisi : échappé.
    expect(xml).toContain("Plan &lt;Kora&gt;");
  });

  it("tout validé (contenus et modèle) : statut validé ; liste du plan et de la mission", async () => {
    attendre(
      200,
      await s.a.chef.post(`/api/plans/${planId}/elements/${brouillonId}/validation`),
      "validation",
    );
    attendre(200, await s.a.chef.post(`/api/plans/${planId}/modeles/1/validation`), "modèle");
    const r = await generer(s.consultant, url());
    expect(r.rapport.statut).toBe("valide");
    expect(r.rapport.version_source).toBe(1);
    const { xml } = await telecharger(s.a.chef, r.fichier.id);
    // Modèle validé : états prévisionnels repris, plus de mention d'omission.
    expect(xml).toContain("Compte de résultat prévisionnel");
    expect(xml).toContain("Bilan prévisionnel");
    expect(xml).not.toContain("non validé, non repris");
    expect(xml).toContain(MARQUEUR_NON_VALIDE);
    expect(xml).toContain("&lt;script&gt;");
    expect(await ids(s.consultant, `/api/plans/${planId}/rapports`)).toContain(r.rapport.id);
    expect(await ids(s.a.chef, `/api/missions/${s.missionId}/rapports`)).toContain(r.rapport.id);
    expect(await ids(s.gestionnaire, `/api/missions/${s.missionId}/rapports`)).not.toContain(
      r.rapport.id,
    );
    expect((await s.gestionnaire.get(`/api/fichiers/${r.fichier.id}`)).statusCode).not.toBe(200);
    // Version du modèle inexistante : 404.
    expect((await s.consultant.post(url("docx", "&version=7"))).statusCode).toBe(404);
  });

  it.skipIf(!navigateur)("PDF réel du plan", async () => {
    const r = await generer(s.a.chef, url("pdf"));
    const f = await s.a.chef.get(`/api/fichiers/${r.fichier.id}`);
    expect(f.statusCode).toBe(200);
    expect(f.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("portail : routes fermées", async () => {
    expect((await s.dirigeant.post(url())).statusCode).toBe(403);
    expect((await s.dirigeant.get(`/api/plans/${planId}/rapports`)).statusCode).toBe(403);
  });
});

describe("paramètres des rapports du cabinet", () => {
  const P = "/api/rapports/parametres";

  it("valeur par défaut identique en base et dans le code", async () => {
    const n = await proprietaire(
      async (c) => (await c.query("SELECT conservation_rapports_defaut() AS n")).rows[0].n,
    );
    expect(n).toBe(CONSERVATION_JOURS_DEFAUT);
    expect(CONSERVATION_RAPPORTS.defaut).toBe(CONSERVATION_JOURS_DEFAUT);
    expect(MENTION_IA_DEFAUT.length).toBeLessThanOrEqual(300);
  });

  it("droits : 401, 403 sans cabinet.gerer ; lecture des valeurs par défaut", async () => {
    expect((await api(ctx).get(P)).statusCode).toBe(401);
    expect((await s.a.chef.get(P)).statusCode).toBe(403);
    expect((await s.a.chef.put(P, {})).statusCode).toBe(403);
    expect((await s.dirigeant.get(P)).statusCode).toBe(403);
    const r = await s.b.associe.get(P);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      conservation_jours: 1095,
      mention_ia_active: true,
      mention_ia: null,
      mention_effective: MENTION_IA_DEFAUT,
      par_defaut: true,
    });
  });

  it("validation : bornes, une ligne, schéma strict", async () => {
    const ok = { conservation_jours: 365, mention_ia_active: true, mention_ia: null };
    for (const corps of [
      { ...ok, conservation_jours: 89 },
      { ...ok, conservation_jours: 3651 },
      { ...ok, conservation_jours: 100.5 },
      { ...ok, mention_ia: "a\nb" },
      { ...ok, mention_ia: "x".repeat(301) },
      { ...ok, autre: 1 },
    ]) {
      expect((await s.a.associe.put(P, corps)).statusCode, JSON.stringify(corps)).toBe(400);
    }
  });

  it("mention propre au cabinet, puis aucune mention ; journalisé ; cabinet isolé", async () => {
    const mention = "Préparé avec l'aide de l'IA <relu> par le cabinet.";
    const r = await s.a.associe.put(P, {
      conservation_jours: CONSERVATION_JOURS_DEFAUT,
      mention_ia_active: true,
      mention_ia: mention,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      conservation_jours: CONSERVATION_JOURS_DEFAUT,
      mention_effective: mention,
    });
    const avec = await generer(s.expert, `/api/notations/${notationId}/rapports?format=docx`);
    const xml1 = (await telecharger(s.expert, avec.fichier.id)).xml;
    expect(xml1).toContain("&lt;relu&gt; par le cabinet.");
    expect(xml1).not.toContain(MENTION_IA_DEFAUT.slice(0, 60));

    attendre(
      200,
      await s.a.associe.put(P, {
        conservation_jours: CONSERVATION_JOURS_DEFAUT,
        mention_ia_active: false,
        mention_ia: null,
      }),
      "sans mention",
    );
    const sans = await generer(s.expert, `/api/notations/${notationId}/rapports?format=docx`);
    const xml2 = (await telecharger(s.expert, sans.fichier.id)).xml;
    expect(xml2).not.toContain("&lt;relu&gt; par le cabinet.");
    expect(xml2).not.toContain(MENTION_IA_DEFAUT.slice(0, 60));

    // L'autre cabinet garde ses valeurs par défaut.
    expect((await s.b.associe.get(P)).json().par_defaut).toBe(true);
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM journal_audit
             WHERE cabinet_id = $1 AND action = 'rapports.parametres'`,
            [s.a.cabinetId],
          )
        ).rows[0].n,
    );
    expect(journal).toBe(2);
  });

  it("raccourcir la durée exige la reconfirmation de l'identité ; la rallonger, non", async () => {
    const corps = (jours: number) => ({
      conservation_jours: jours,
      mention_ia_active: true,
      mention_ia: null,
    });
    const duree = async () => (await s.a.associe.get(P)).json().conservation_jours as number;
    expect(await duree()).toBe(CONSERVATION_JOURS_DEFAUT);

    // Sans confirmation : 403, rien n'est changé.
    const sans = await s.a.associe.put(P, corps(400));
    expect(sans.statusCode).toBe(403);
    expect(sans.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    expect(await duree()).toBe(CONSERVATION_JOURS_DEFAUT);
    // Bloc de confirmation sans mot de passe : même refus ; mauvais mot de passe : 401.
    const vide = await s.a.associe.put(P, { ...corps(400), confirmation: {} });
    expect(vide.statusCode).toBe(403);
    expect(vide.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const faux = await s.a.associe.put(P, {
      ...corps(400),
      confirmation: { mot_de_passe: "mauvais-mot-de-passe" },
    });
    expect(faux.statusCode).toBe(401);
    expect(faux.json().erreur.code).toBe("MOT_DE_PASSE_INVALIDE");
    expect(await duree()).toBe(CONSERVATION_JOURS_DEFAUT);
    // Schéma strict : champ inconnu dans la confirmation refusé.
    expect(
      (
        await s.a.associe.put(P, {
          ...corps(400),
          confirmation: { mot_de_passe: MOT_DE_PASSE_TEST, autre: 1 },
        })
      ).statusCode,
    ).toBe(400);
    // Droit manquant : refusé avant toute confirmation.
    expect(
      (await s.a.chef.put(P, { ...corps(400), confirmation: { mot_de_passe: MOT_DE_PASSE_TEST } }))
        .statusCode,
    ).toBe(403);

    // Avec le mot de passe (cabinet sans 2FA active) : accepté et journalisé avec le facteur.
    const ok = await s.a.associe.put(P, {
      ...corps(400),
      confirmation: { mot_de_passe: MOT_DE_PASSE_TEST },
    });
    attendre(200, ok, "raccourcissement confirmé");
    expect(ok.json().conservation_jours).toBe(400);
    expect(JSON.stringify(ok.json())).not.toContain(MOT_DE_PASSE_TEST);
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT details FROM journal_audit
             WHERE cabinet_id = $1 AND action = 'rapports.parametres' ORDER BY id DESC LIMIT 1`,
            [s.a.cabinetId],
          )
        ).rows[0].details,
    );
    expect(journal).toMatchObject({
      facteur: "mot_de_passe",
      avant: { conservation_jours: CONSERVATION_JOURS_DEFAUT },
      apres: { conservation_jours: 400 },
    });
    expect(JSON.stringify(journal)).not.toContain(MOT_DE_PASSE_TEST);

    // Durée identique ou rallongée : aucune confirmation demandée.
    attendre(200, await s.a.associe.put(P, corps(400)), "durée inchangée");
    attendre(200, await s.a.associe.put(P, corps(1000)), "durée rallongée");
    expect(await duree()).toBe(1000);
  });
});
