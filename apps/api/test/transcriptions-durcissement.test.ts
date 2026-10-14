import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proprietaire } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import type { Api } from "./api.js";
import { televerser } from "./fichiers-outils.js";
import { fabriquerAudioDeTest } from "./audio-test.js";
import { creerMission } from "./missions-outils.js";
import {
  demarrerCanaux,
  executerJobs,
  preparerCabinetCanaux,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Durcissement des transcriptions (audit de sécurité, constats M1 et M4) : un `fichier_id` ne se
 * transcrit que s'il a été téléversé par l'utilisateur et n'a pas déjà de transcription (404 neutre
 * dans tous les cas, plus d'oracle 409) ; correction, validation et rejet sont refusés sur une
 * mission clôturée ; une transcription porte 50 versions au plus ; la correction a un plafond de
 * débit par utilisateur.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
const CONSENTEMENT = {
  enregistrement_consenti: true,
  reference_consentement: "Consentement oral enregistré le 12/10/2026",
};
const audio = () =>
  fabriquerAudioDeTest({ texte: "Bonjour.", langue: "fr", dureeMs: 3000, confiance: 900 });

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Transcriptions durcies");
}, 240_000);
afterAll(() => ctx.fermer());

async function televerserAudio(par: Api, missionId = a.missionId) {
  const f = await televerser(
    par,
    `/api/missions/${missionId}/transcriptions/audio`,
    "e.ogg",
    audio(),
  );
  attendre(201, f, "audio");
  return f.json().id as string;
}
const creer = (par: Api, fichierId: string, missionId = a.missionId) =>
  par.post(`/api/missions/${missionId}/transcriptions`, {
    fichier_id: fichierId,
    langue: "fr",
    ...CONSENTEMENT,
  });
async function transcrire(missionId = a.missionId) {
  const fichier = await televerserAudio(a.chef, missionId);
  const r = await creer(a.chef, fichier, missionId);
  attendre(201, r, "création");
  await executerJobs(ctx);
  return r.json().id as string;
}
const corriger = (par: Api, id: string, version: number, texte = "corrigé") =>
  par.brut({
    method: "PUT",
    url: `/api/transcriptions/${id}/texte`,
    payload: JSON.stringify({ texte }),
    headers: { "content-type": "application/json", "if-match": `"${version}"` },
  });

describe("M1 : fichier_id d'autrui ou déjà transcrit = 404 neutre", () => {
  it("le fichier téléversé par un autre utilisateur du cabinet, ou déjà transcrit, répond 404 (jamais 409)", async () => {
    const fichier = await televerserAudio(a.chef);
    // Un autre utilisateur habilité (l'associé) ne transcrit pas le fichier téléversé par le chef.
    const autrui = await creer(a.associe, fichier);
    expect(autrui.statusCode).toBe(404);
    // Le téléverseur le transcrit une fois ; une seconde fois : 404, plus 409 FICHIER_DEJA_TRANSCRIT.
    attendre(201, await creer(a.chef, fichier), "première transcription");
    const deuxieme = await creer(a.chef, fichier);
    expect(deuxieme.statusCode).toBe(404);
    expect(deuxieme.json().erreur.code).not.toBe("FICHIER_DEJA_TRANSCRIT");
    // Même réponse pour un fichier transcrit puis cité par un autre utilisateur : pas d'oracle.
    const tiers = await creer(a.associe, fichier);
    expect(tiers.statusCode).toBe(404);
    expect(tiers.json()).toEqual(deuxieme.json());
    await executerJobs(ctx);
  });
});

describe("M4 : mission clôturée, plafond de versions, débit de la correction", () => {
  it("correction, validation et rejet sont refusés (409) sur une mission clôturée", async () => {
    const mission = (await creerMission(a, { intitule: "Mission à clôturer" })).id;
    const corrigee = await transcrire(mission);
    const validee = await transcrire(mission);
    const rejetee = await transcrire(mission);
    // Témoin : tant que la mission est ouverte, la correction passe.
    attendre(200, await corriger(a.chef, corrigee, 1), "correction avant clôture");
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [mission, a.associeId],
      ),
    );
    expect((await corriger(a.chef, corrigee, 2, "après clôture")).statusCode).toBe(409);
    expect((await a.associe.post(`/api/transcriptions/${validee}/valider`, {})).statusCode).toBe(
      409,
    );
    expect(
      (await a.associe.post(`/api/transcriptions/${rejetee}/rejeter`, { motif: "Mission close" }))
        .statusCode,
    ).toBe(409);
    const statuts = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT id, statut FROM transcriptions WHERE id = ANY($1::uuid[])", [
            [validee, rejetee],
          ])
        ).rows as { id: string; statut: string }[],
    );
    expect(statuts.every((s) => s.statut === "a_relire")).toBe(true);
  });

  it("50 versions au plus par transcription : la 51e est refusée (409)", async () => {
    const id = await transcrire();
    // 49 versions humaines de plus posées par le propriétaire (ajout seul) : 50 versions au total.
    await proprietaire((c) =>
      c.query(
        `INSERT INTO transcriptions_versions (cabinet_id, transcription_id, numero, origine, texte, auteur_id)
         SELECT $1, $2, g, 'humaine', 'v' || g, $3 FROM generate_series(2, 50) g`,
        [a.cabinetId, id, a.chef.utilisateurId],
      ),
    );
    const r = await corriger(a.chef, id, 50, "cinquante et unième");
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_VERSIONS");
    const n = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM transcriptions_versions WHERE transcription_id = $1",
            [id],
          )
        ).rows[0].n as number,
    );
    expect(n).toBe(50);
  });

  it("débit : au-delà de 30 corrections en 10 minutes par utilisateur, 429", async () => {
    const id = await transcrire();
    await proprietaire((c) =>
      c.query(
        `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite)
         SELECT $1, $2, 'transcription.modifier', 'transcription' FROM generate_series(1, 30)`,
        [a.cabinetId, a.chef.utilisateurId],
      ),
    );
    const r = await corriger(a.chef, id, 1);
    expect(r.statusCode).toBe(429);
    expect(r.json().erreur.code).toBe("TROP_DE_REQUETES");
    // Un autre utilisateur n'est pas affecté.
    attendre(200, await corriger(a.associe, id, 1), "autre utilisateur");
  });
});
