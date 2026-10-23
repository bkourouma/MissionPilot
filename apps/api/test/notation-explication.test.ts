/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrerIa, serveurFactice, type ServeurFactice } from "./ia-outils.js";
import { CONSIGNE_DONNEES_NON_FIABLES } from "../src/ia/donnees-non-fiables.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Explicabilité de la note (NOT-12) : combinaisons minimales d'améliorations dans
 * `GET /notations/:id/explication`, commentaire IA (brouillon) de `/explication/commentaire` par
 * l'orchestrateur avec un fournisseur FACTICE local (aucun appel réseau externe). Scénario commun :
 * notation de classe C (61,6), seuil de la classe B à 65, trois pratiques au minimum à relever.
 */

let serveur: ServeurFactice;
let ctx: Contexte;
let s: ScenarioQuestionnaires;
let notationId: string;
let versionId: string;
let client: string;

const url = (suffixe = "") => `/api/notations/${notationId}/explication${suffixe}`;
const urlCommentaire = () => url("/commentaire");

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  s = await preparerQuestionnaires(ctx);
  const v = await versionValidee(s.consultant, "notation_augmentee");
  const envoiId = await envoyer(s.consultant, s.missionId, v.versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId, fonction: "Direction générale" },
    { utilisateur_id: s.contributeur.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiId, reponsesAuNiveau(v.definition, 5));
  await repondre(s.contributeur, envoiId, reponsesAuNiveau(v.definition, 2));
  const n = await s.consultant.post(`/api/missions/${s.missionId}/notation`, {});
  attendre(201, n, "notation");
  notationId = n.json().id;
  attendre(
    201,
    await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoiId }),
    "calcul",
  );
  const ligne = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
    const r = await db.query(
      `SELECT v.id, c.raison_sociale FROM notation_versions v
       JOIN notations n ON n.id = v.notation_id JOIN clients c ON c.id = n.client_id
       WHERE v.notation_id = $1 ORDER BY v.numero DESC LIMIT 1`,
      [notationId],
    );
    return r.rows[0];
  });
  versionId = ligne.id;
  client = ligne.raison_sociale;
}, 180_000);
afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});

describe("combinaisons minimales dans l'explication (NOT-12)", () => {
  it("401, 403, 404 (version, autre cabinet) ; paramètres invalides en 400", async () => {
    expect((await s.anonyme.get(url())).statusCode).toBe(401);
    expect((await s.gestionnaire.get(url())).statusCode).toBe(403);
    expect((await s.b.associe.get(url())).statusCode).toBe(404);
    expect((await s.consultant.get(url("?version=99"))).statusCode).toBe(404);
    for (const q of [
      "pratiques_max=0",
      "pratiques_max=9",
      "pratiques_max=abc",
      "pratiques_max=1.5",
      "combinaisons_max=0",
      "combinaisons_max=11",
      "inconnu=1",
    ]) {
      const r = await s.consultant.get(url(`?${q}`));
      expect(r.statusCode, q).toBe(400);
    }
  });

  it("cas C → B chiffré : 3 pratiques au minimum, combinaisons irréductibles, champs existants intacts", async () => {
    const r = await s.consultant.get(url());
    expect(r.statusCode).toBe(200);
    const e = r.json();
    // Champs existants inchangés.
    expect(e).toMatchObject({ numero: 1, score: 61.6, classe: "C" });
    expect(e.dimensions.length).toBeGreaterThan(0);
    expect(e.simulation).toMatchObject({ cible: "B", seuil: 65, deja_atteinte: false });
    // Nouveau bloc.
    const c = e.combinaisons;
    expect(c).toMatchObject({
      classe_actuelle: "C",
      score_actuel: 61.6,
      cible: "B",
      seuil: 65,
      deja_atteinte: false,
      atteignable: true,
      gain_necessaire: 3.4,
      nombre_minimal_pratiques: 3,
      exhaustive: true,
      tronquee: false,
    });
    expect(c.combinaisons).toHaveLength(5);
    for (const k of c.combinaisons) {
      expect(k.etapes).toHaveLength(3);
      expect(k.classe_projetee).toBe("B");
      expect(k.score_projete).toBeGreaterThanOrEqual(65);
      expect(k.nombre_paliers).toBe(k.etapes.reduce((t: number, x: any) => t + x.paliers, 0));
      for (const x of k.etapes) {
        expect(x.points_apres).toBeGreaterThan(x.points_avant);
        expect(x.gain).toBeGreaterThan(0);
      }
    }
    // Ordre : paliers croissants (minimum de paliers d'abord).
    const paliers = c.combinaisons.map((k: any) => k.nombre_paliers);
    expect(paliers).toEqual([...paliers].sort((a: number, b: number) => a - b));
    expect(c.leviers.length).toBeGreaterThan(3);
    expect(Object.keys(c.leviers[0]).sort()).toEqual(
      ["dimension", "indicateur", "libelle", "paliers", "points_actuels", "question"].sort(),
    );
  });

  it("combinaisons_max borne la liste ; classe A visée ; pratiques_max insuffisant : tronquée, jamais « impossible »", async () => {
    const deux = (await s.consultant.get(url("?combinaisons_max=2"))).json().combinaisons;
    expect(deux.combinaisons).toHaveLength(2);
    expect(deux.nombre_minimal_pratiques).toBe(3);

    const a = (await s.consultant.get(url("?cible=A"))).json().combinaisons;
    expect(a).toMatchObject({ cible: "A" });
    expect(a.gain_necessaire).toBeGreaterThan(3.4);

    const court = (await s.consultant.get(url("?pratiques_max=2"))).json().combinaisons;
    expect(court).toMatchObject({
      cible: "B",
      atteignable: false,
      nombre_minimal_pratiques: null,
      exhaustive: false,
      tronquee: true,
    });
    expect(court.combinaisons).toEqual([]);

    // Classe actuelle visée : déjà atteinte, rien à chercher.
    const deja = (await s.consultant.get(url("?cible=C"))).json().combinaisons;
    expect(deja).toMatchObject({ deja_atteinte: true, nombre_minimal_pratiques: 0 });
  });
});

describe("commentaire IA de l'explication (NOT-12)", () => {
  it("401, 403 (sans notation.gerer), 404 ; lecture seule avec notation.lire", async () => {
    expect((await s.anonyme.get(urlCommentaire())).statusCode).toBe(401);
    expect((await s.anonyme.post(urlCommentaire(), {})).statusCode).toBe(401);
    expect((await s.gestionnaire.get(urlCommentaire())).statusCode).toBe(403);
    expect((await s.gestionnaire.post(urlCommentaire(), {})).statusCode).toBe(403);
    // Expert métier : notation.lire et ia.utiliser, mais pas notation.gerer.
    expect((await s.expert.post(urlCommentaire(), {})).statusCode).toBe(403);
    const lecture = await s.expert.get(urlCommentaire());
    expect(lecture.statusCode).toBe(200);
    expect(lecture.json()).toEqual({ numero: 1, statut_contenu: null, commentaire: null });
    expect((await s.b.associe.get(urlCommentaire())).statusCode).toBe(404);
    expect((await s.b.associe.post(urlCommentaire(), {})).statusCode).toBe(404);
    expect((await s.horsEquipe.get(urlCommentaire())).statusCode).toBe(404);
    expect((await s.consultant.post(urlCommentaire(), { version: 99 })).statusCode).toBe(404);
    expect((await s.consultant.post(urlCommentaire(), { cible: "F" })).statusCode).toBe(400);
    expect((await s.consultant.post(urlCommentaire(), { inconnu: 1 })).statusCode).toBe(400);
  });

  it("IA désactivée : gabarit déterministe rédigé par le code, brouillon, aucun appel au fournisseur", async () => {
    const avant = serveur.requetes.length;
    const r = await s.consultant.post(urlCommentaire(), {});
    attendre(201, r, "commentaire (gabarit)");
    expect(serveur.requetes.length).toBe(avant);
    const j = r.json();
    expect(j).toMatchObject({ numero: 1, statut_contenu: "brouillon_ia" });
    const c = j.commentaire;
    expect(c).toMatchObject({
      tache: "redaction",
      gabarit: true,
      statut_contenu: "brouillon_ia",
      livrable_client: false,
      entite: { type: "notation_explication", id: versionId },
      mission_id: s.missionId,
      prompt: { nom: "notation_explication_commentaire", exemple: false },
    });
    expect(c.texte).toContain("Note actuelle : 61,6 sur 100, classe C.");
    expect(c.texte).toContain("il suffit d'améliorer 3 pratiques au minimum");
    expect(c.texte).toContain("Combinaison la plus courte");
    // Repli déterministe : même sortie pour la même note.
    const encore = await s.consultant.post(urlCommentaire(), {});
    attendre(201, encore, "commentaire (gabarit, 2e)");
    expect(encore.json().commentaire.texte).toBe(c.texte);
    expect(encore.json().commentaire.id).not.toBe(c.id);
    // Le prompt n'est semé qu'une fois pour le cabinet.
    const prompts = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query("SELECT 1 FROM ia_prompts WHERE nom = 'notation_explication_commentaire'"),
    );
    expect(prompts.rowCount).toBe(1);
    // GET : le dernier commentaire, avec son statut.
    const lu = (await s.expert.get(urlCommentaire())).json();
    expect(lu.statut_contenu).toBe("brouillon_ia");
    expect(lu.commentaire.id).toBe(encore.json().commentaire.id);
  });

  describe("avec le modèle (fournisseur factice)", () => {
    beforeAll(async () => {
      attendre(200, await s.a.associe.put("/api/ia/parametres", { ia_activee: true }), "IA");
    });

    it("brouillon de l'IA : chiffres de la liste blanche, client masqué, jamais livrable avant validation", async () => {
      serveur.repondre(() => ({
        contenu:
          "La note de 61,6 place l'entreprise en classe C. Il suffit d'améliorer 3 pratiques " +
          "pour atteindre la classe B (seuil 65).",
      }));
      const avant = serveur.requetes.length;
      const r = await s.consultant.post(urlCommentaire(), {});
      attendre(201, r, "commentaire");
      expect(serveur.requetes.length).toBe(avant + 1);
      const messages = serveur.requetes[avant]?.corps.messages ?? [];
      expect(JSON.stringify(messages)).not.toContain(client);
      const utilisateur = messages.find((m) => m.role === "user")?.content ?? "";
      expect(utilisateur).toContain("Score actuel : 61,6 points");
      expect(utilisateur).toContain("Pratiques à relever au minimum : 3");
      // Le texte (libellés de la grille du cabinet) est une variable non fiable : délimitée et signalée.
      expect(utilisateur).toContain(CONSIGNE_DONNEES_NON_FIABLES);
      expect(utilisateur).toContain("Note actuelle : 61,6 sur 100, classe C.");
      const c = r.json().commentaire;
      expect(c).toMatchObject({
        gabarit: false,
        statut_contenu: "brouillon_ia",
        livrable_client: false,
        chiffres_non_verifies: false,
        nombres_non_verifies: [],
      });
      expect(c.texte).toContain("Il suffit d'améliorer 3 pratiques");
      expect(r.json().statut_contenu).toBe("brouillon_ia");
    });

    it("chiffre inventé par le modèle : signalé, validation exigeant l'acquittement", async () => {
      serveur.repondre(() => ({
        contenu: "La note atteindra 87,3 points dès le prochain trimestre grâce à 3 pratiques.",
      }));
      const r = await s.consultant.post(urlCommentaire(), {});
      attendre(201, r, "commentaire (chiffre inventé)");
      const c = r.json().commentaire;
      expect(c.chiffres_non_verifies).toBe(true);
      expect(c.nombres_non_verifies.join(" ")).toContain("87,3");
      const sans = await s.a.chef.post(`/api/ia/generations/${c.id}/valider`, {});
      expect(sans.statusCode).toBe(409);
      expect(sans.json().erreur.code).toBe("CHIFFRES_NON_VERIFIES");
      const avec = await s.a.chef.post(`/api/ia/generations/${c.id}/valider`, {
        acquitte_chiffres: true,
      });
      attendre(200, avec, "validation (acquittée)");
      expect(avec.json()).toMatchObject({ statut_contenu: "valide", chiffres_acquittes: true });
    });

    it("validation humaine par la route des générations : brouillon_ia, puis valide (et livrable)", async () => {
      serveur.repondre(() => ({
        contenu: "La note de 61,6 est en classe C ; 3 pratiques suffisent pour viser la classe B.",
      }));
      const r = await s.consultant.post(urlCommentaire(), { cible: "B" });
      attendre(201, r, "commentaire");
      const c = r.json().commentaire;
      expect(c.statut_contenu).toBe("brouillon_ia");
      // Le demandeur ne valide pas son propre brouillon.
      const soi = await s.consultant.post(`/api/ia/generations/${c.id}/valider`, {});
      expect(soi.statusCode).toBe(403);
      expect(soi.json().erreur.code).toBe("APPROBATION_REQUISE");
      expect((await s.expert.post(`/api/ia/generations/${c.id}/valider`, {})).statusCode).toBe(403);
      expect((await s.b.associe.post(`/api/ia/generations/${c.id}/valider`, {})).statusCode).toBe(
        404,
      );
      expect((await s.consultant.get(urlCommentaire())).json().statut_contenu).toBe("brouillon_ia");

      const v = await s.a.chef.post(`/api/ia/generations/${c.id}/valider`, {});
      attendre(200, v, "validation");
      expect(v.json()).toMatchObject({ statut_contenu: "valide", livrable_client: true });
      const lu = (await s.expert.get(urlCommentaire())).json();
      expect(lu.statut_contenu).toBe("valide");
      expect(lu.commentaire.id).toBe(c.id);
      expect(lu.commentaire.texte).toBe(c.texte);
      // Contenu validé : définitif ; une nouvelle génération repart en brouillon.
      const encore = await s.consultant.post(urlCommentaire(), {});
      attendre(201, encore, "nouveau commentaire");
      expect(encore.json().statut_contenu).toBe("brouillon_ia");
      expect((await s.expert.get(urlCommentaire())).json().commentaire.id).toBe(
        encore.json().commentaire.id,
      );
    });

    it("FIN-02 : modèle, jetons et coût absents sans finance.lire, présents pour l'associé", async () => {
      serveur.repondre(() => ({ contenu: "Note de 61,6, classe C." }));
      const r = await s.consultant.post(urlCommentaire(), {});
      attendre(201, r, "commentaire");
      const sans = r.json().commentaire.trace;
      expect(sans.fournisseur).toBeDefined();
      for (const k of ["modele", "tokens_entree", "tokens_sortie", "cout_micro_usd"]) {
        expect(sans, k).not.toHaveProperty(k);
      }
      const lecture = await s.expert.get(urlCommentaire());
      expect(lecture.body).not.toContain("cout_micro_usd");
      expect(lecture.body).not.toContain("tokens_entree");
      const associe = (await s.a.associe.get(urlCommentaire())).json().commentaire.trace;
      expect(associe).toHaveProperty("modele");
      expect(associe).toHaveProperty("cout_micro_usd");
    });
  });

  it("isolation entre cabinets : la génération d'un cabinet est introuvable dans l'autre", async () => {
    const id = (await s.consultant.get(urlCommentaire())).json().commentaire.id;
    expect((await s.b.associe.get(`/api/ia/generations/${id}`)).statusCode).toBe(404);
    const lignes = await proprietaire(async (c) => {
      const r = await c.query(
        "SELECT DISTINCT cabinet_id FROM ia_demandes WHERE entite_type = 'notation_explication'",
      );
      return r.rows;
    });
    expect(lignes.map((l) => l.cabinet_id)).toEqual([s.a.cabinetId]);
  });

  it("portail client : aucune route (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    for (const compte of [s.dirigeant, s.contributeur, s.investisseur]) {
      for (const [methode, chemin] of [
        ["get", urlCommentaire()],
        ["post", urlCommentaire()],
        ["get", url()],
      ] as const) {
        const r = await compte[methode](chemin);
        expect(r.statusCode, chemin).toBe(403);
        expect(r.json().erreur.code, chemin).toBe("PORTAIL_ROUTE_INTERDITE");
      }
    }
  });
});
