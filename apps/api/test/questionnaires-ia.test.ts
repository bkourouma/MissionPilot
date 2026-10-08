import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { proprietaire, type Contexte } from "./helpers.js";
import { demarrerIa, serveurFactice, type ServeurFactice } from "./ia-outils.js";
import { attendre } from "./portail-outils.js";
import { preparerQuestionnaires, type ScenarioQuestionnaires } from "./questionnaires-outils.js";

/*
 * Génération assistée de questionnaires par l'IA (SOC-11) : brouillon IA relu,
 * modifié puis validé par un consultant avant tout envoi ; masquage des données
 * personnelles ; repli déterministe sans clé ; fournisseur FACTICE local (aucun
 * appel réseau externe).
 */

let serveur: ServeurFactice;
let ctx: Contexte;
let s: ScenarioQuestionnaires;
let compteur = 0;

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  s = await preparerQuestionnaires(ctx);
}, 180_000);
afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});

const code = () => `ia_diag_${(compteur += 1)}_${Date.now()}`;
const besoin = (extra: Record<string, unknown> = {}) => ({
  code: code(),
  service: "Diagnostic de compétitivité",
  population: "Dirigeants de PME agroalimentaires",
  theme: "Pilotage de la production",
  nombre_questions: 10,
  ...extra,
});

const REPONSE_MODELE = {
  titre: "Pilotage de la production en PME",
  questions: [
    "likert | Les objectifs de production sont connus de toutes les équipes.",
    "choix_unique | Comment planifiez-vous la production ? | Au jour le jour ; Chaque semaine ; Chaque mois",
    "choix_multiple | Quels outils utilisez-vous ? | Tableur ; Logiciel de gestion ; Aucun outil",
    "oui_non | Un responsable de la production est-il désigné ?",
    "texte | Quelles difficultés rencontrez-vous ?",
    "numerique | Quel est votre taux de rebut approximatif ?",
  ],
};

const modele = (corps: unknown) => ({ contenu: JSON.stringify(corps) });

function activerIa(par: {
  put: (u: string, b: unknown) => Promise<{ statusCode: number; body: string }>;
}) {
  return par.put("/api/ia/parametres", { ia_activee: true });
}

describe("droits et validation de la demande", () => {
  it("401, 403 (sans questionnaire.gerer), 400 (corps invalide), 409 (code déjà pris)", async () => {
    const url = "/api/questionnaires/generation-ia";
    expect((await s.anonyme.post(url, besoin())).statusCode).toBe(401);
    expect((await s.expert.post(url, besoin())).statusCode).toBe(403);
    expect((await s.gestionnaire.post(url, besoin())).statusCode).toBe(403);
    expect((await s.consultant.post(url, besoin({ nombre_questions: 2 }))).statusCode).toBe(400);
    expect((await s.consultant.post(url, besoin({ theme: "" }))).statusCode).toBe(400);
    expect((await s.consultant.post(url, { ...besoin(), inconnu: true })).statusCode).toBe(400);
    const b = besoin();
    attendre(201, await s.consultant.post(url, b), "première génération");
    expect((await s.consultant.post(url, b)).statusCode).toBe(409);
  });
});

describe("repli déterministe (IA désactivée par le cabinet)", () => {
  it("produit un brouillon IA valide, sans appel au fournisseur", async () => {
    const avant = serveur.requetes.length;
    const r = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    attendre(201, r, "génération");
    expect(serveur.requetes.length).toBe(avant);
    const v = r.json();
    expect(v.statut).toBe("brouillon");
    expect(v.ia).toMatchObject({ statut_contenu: "brouillon_ia", gabarit: true });
    expect(v.ia.historique).toHaveLength(1);
    expect(v.ia.brief).toMatchObject({ theme: "Pilotage de la production" });
    const def = v.definition as DefinitionQuestionnaire;
    expect(def.sections[0]?.questions.length).toBeGreaterThanOrEqual(5);
    expect(def.sections[0]?.questions.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(def)).toContain("Pilotage de la production");
    // Déterministe : même besoin → mêmes questions.
    const b = besoin();
    const a1 = (await s.consultant.post("/api/questionnaires/generation-ia", b)).json();
    const a2 = (
      await s.consultant.post("/api/questionnaires/generation-ia", { ...b, code: code() })
    ).json();
    expect(a2.definition.sections).toEqual(a1.definition.sections);
  });
});

describe("génération par le modèle (fournisseur factice)", () => {
  beforeAll(async () => {
    attendre(200, await activerIa(s.a.associe), "activation de l'IA");
  });

  it("construit la définition depuis les lignes du modèle et masque les données personnelles", async () => {
    serveur.repondre(() => modele(REPONSE_MODELE));
    const avant = serveur.requetes.length;
    const r = await s.consultant.post(
      "/api/questionnaires/generation-ia",
      besoin({
        service: "Audit pour la Société Kora Industrie",
        theme: "Pilotage de la production (contact dg@kora.test)",
        termes_sensibles: ["Kora Industrie"],
      }),
    );
    attendre(201, r, "génération");
    expect(serveur.requetes.length).toBe(avant + 1);
    const envoye = JSON.stringify(serveur.requetes[avant]?.corps.messages);
    expect(envoye).not.toContain("Kora Industrie");
    expect(envoye).not.toContain("dg@kora.test");
    const v = r.json();
    expect(v.ia).toMatchObject({ statut_contenu: "brouillon_ia", gabarit: false });
    const def = v.definition as DefinitionQuestionnaire;
    expect(def.titre).toBe("Pilotage de la production en PME");
    const types = def.sections[0]?.questions.map((q) => q.type);
    expect(types).toEqual([
      "likert",
      "choix_unique",
      "choix_multiple",
      "oui_non",
      "texte",
      "numerique",
    ]);
    // Le coût est tracé comme toute génération IA, le contenu n'est pas journalisé.
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE action = 'generation_questionnaire_ia' AND entite_id = $1",
            [v.modele_id],
          )
        ).rows,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("production");
  });

  it("sortie inexploitable : repli déterministe signalé", async () => {
    serveur.repondre(() => ({ contenu: "Voici un questionnaire en prose, sans JSON." }));
    const r = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    attendre(201, r, "génération");
    expect(r.json().ia.gabarit).toBe(true);
    serveur.repondre(() => modele({ titre: "Trop court", questions: ["texte | Une seule ?"] }));
    const r2 = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    attendre(201, r2, "génération");
    expect(r2.json().ia.gabarit).toBe(true);
  });

  it("l'IA propose, l'expert dispose : rien ne s'envoie avant validation, séparation des tâches", async () => {
    serveur.repondre(() => modele(REPONSE_MODELE));
    const g = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    attendre(201, g, "génération");
    const versionId = g.json().id as string;

    // Brouillon IA : aucun envoi possible.
    const envoi = await s.consultant.post(`/api/missions/${s.missionId}/questionnaires`, {
      version_id: versionId,
      mode: "individuel",
      repondants: [{ utilisateur_id: s.dirigeant.utilisateurId }],
    });
    expect(envoi.statusCode).toBe(409);

    // Le demandeur ne valide pas son propre brouillon IA.
    const soi = await s.consultant.post(`/api/questionnaires/versions/${versionId}/valider`);
    expect(soi.statusCode).toBe(403);
    expect(soi.json().erreur.code).toBe("APPROBATION_REQUISE");
    // Droit manquant, version d'un autre cabinet.
    expect(
      (await s.expert.post(`/api/questionnaires/versions/${versionId}/valider`)).statusCode,
    ).toBe(403);
    expect(
      (await s.b.associe.post(`/api/questionnaires/versions/${versionId}/valider`)).statusCode,
    ).toBe(404);
    expect((await s.b.associe.get(`/api/questionnaires/versions/${versionId}`)).statusCode).toBe(
      404,
    );

    // Retouche par le demandeur : statut « modifié », historique complété.
    const def = g.json().definition as DefinitionQuestionnaire;
    const retouche = {
      ...def,
      titre: "Pilotage de la production (relu)",
    };
    const m = await s.consultant.put(`/api/questionnaires/versions/${versionId}`, {
      definition: retouche,
    });
    attendre(200, m, "modification");
    expect(m.json().ia.statut_contenu).toBe("modifie");
    expect(m.json().ia.historique.map((x: { statut_contenu: string }) => x.statut_contenu)).toEqual(
      ["brouillon_ia", "modifie"],
    );

    // Un autre consultant (le chef de mission) valide : version figée et envoyable.
    const ok = await s.a.chef.post(`/api/questionnaires/versions/${versionId}/valider`);
    attendre(200, ok, "validation");
    expect(ok.json().statut).toBe("valide");
    expect(ok.json().ia.statut_contenu).toBe("valide");
    expect(ok.json().ia.historique).toHaveLength(3);
    const envoye = await s.consultant.post(`/api/missions/${s.missionId}/questionnaires`, {
      version_id: versionId,
      mode: "individuel",
      repondants: [{ utilisateur_id: s.dirigeant.utilisateurId }],
    });
    expect(envoye.statusCode).toBe(201);
    // Figée : plus de modification.
    expect(
      (
        await s.consultant.put(`/api/questionnaires/versions/${versionId}`, {
          definition: retouche,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("la copie d'un modèle IA non validé est refusée (409), permise une fois la version validée", async () => {
    serveur.repondre(() => modele(REPONSE_MODELE));
    const g = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    attendre(201, g, "génération");
    const { id: versionId, modele_id: modeleId } = g.json() as { id: string; modele_id: string };
    const copier = () =>
      s.consultant.post("/api/questionnaires/modeles", {
        code: code(),
        source: { type: "copie", modele_id: modeleId },
      });

    // Brouillon IA, puis retouché : toujours non validé, donc jamais copiable.
    const refus = await copier();
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.message).toContain("non validé");
    attendre(
      200,
      await s.consultant.put(`/api/questionnaires/versions/${versionId}`, {
        definition: g.json().definition,
      }),
      "retouche",
    );
    expect((await copier()).statusCode).toBe(409);
    // Aucun modèle n'a été créé par les refus.
    const crees = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM questionnaire_modeles WHERE copie_de = $1",
            [modeleId],
          )
        ).rows[0].n,
    );
    expect(crees).toBe(0);

    attendre(
      200,
      await s.a.chef.post(`/api/questionnaires/versions/${versionId}/valider`),
      "validation",
    );
    const ok = await copier();
    attendre(201, ok, "copie d'une version validée");
    expect(ok.json().copie_de).toBe(modeleId);
  });

  it("l'auteur d'une retouche ne valide pas, l'associé peut", async () => {
    serveur.repondre(() => modele(REPONSE_MODELE));
    const g = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    const versionId = g.json().id as string;
    attendre(
      200,
      await s.a.chef.put(`/api/questionnaires/versions/${versionId}`, {
        definition: g.json().definition,
      }),
      "retouche du chef",
    );
    expect(
      (await s.a.chef.post(`/api/questionnaires/versions/${versionId}/valider`)).statusCode,
    ).toBe(403);
    attendre(
      200,
      await s.a.associe.post(`/api/questionnaires/versions/${versionId}/valider`),
      "associé",
    );
  });

  it("nombres venus du modèle : acquittement explicite exigé", async () => {
    serveur.repondre(() =>
      modele({
        ...REPONSE_MODELE,
        questions: [
          ...REPONSE_MODELE.questions,
          "likert | Disposez-vous des 47 procédures documentées ?",
        ],
      }),
    );
    const g = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    attendre(201, g, "génération");
    expect(g.json().ia.chiffres_non_verifies).toBe(true);
    const id = g.json().id as string;
    const refus = await s.a.chef.post(`/api/questionnaires/versions/${id}/valider`);
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("CHIFFRES_NON_VERIFIES");
    expect(
      (
        await s.a.chef.post(`/api/questionnaires/versions/${id}/valider`, {
          acquitte_chiffres: "oui",
        })
      ).statusCode,
    ).toBe(400);
    attendre(
      200,
      await s.a.chef.post(`/api/questionnaires/versions/${id}/valider`, {
        acquitte_chiffres: true,
      }),
      "validation acquittée",
    );
  });

  it("la base garde le circuit humain même si l'application est contournée", async () => {
    serveur.repondre(() => modele(REPONSE_MODELE));
    const g = await s.consultant.post("/api/questionnaires/generation-ia", besoin());
    const id = g.json().id as string;
    const erreurs = await proprietaire(async (c) => {
      const essayer = async (sql: string, params: unknown[]) => {
        try {
          await c.query(sql, params);
          return "aucune";
        } catch (e) {
          return (e as { code?: string }).code ?? "inconnue";
        }
      };
      return {
        validation: await essayer(
          "UPDATE questionnaire_versions SET statut = 'valide', valide_par = cree_par, valide_le = now() WHERE id = $1",
          [id],
        ),
        definition: await essayer(
          `UPDATE questionnaire_versions SET definition = jsonb_set(definition, '{titre}', '"Autre"') WHERE id = $1`,
          [id],
        ),
        historique: await essayer(
          "UPDATE questionnaire_ia_historique SET gabarit = NOT gabarit WHERE version_id = $1",
          [id],
        ),
        suppression: await essayer(
          "DELETE FROM questionnaire_ia_historique WHERE version_id = $1",
          [id],
        ),
      };
    });
    expect(erreurs).toEqual({
      validation: "MPQ08",
      definition: "MPQ06",
      historique: "MPQ06",
      suppression: "MPQ06",
    });
  });

  it("le portail client ne voit rien de l'historique IA", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT polname, polpermissive FROM pg_policy
             WHERE polrelid = 'questionnaire_ia_historique'::regclass ORDER BY polname`,
          )
        ).rows,
    );
    expect(lignes).toEqual([
      { polname: "isolation", polpermissive: true },
      { polname: "portail_interdit", polpermissive: false },
    ]);
  });
});
