import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proprietaire } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import { ECHANTILLONS, televerser } from "./fichiers-outils.js";
import { fabriquerAudioDeTest, fauxAudioReel } from "./audio-test.js";
import {
  demarrerCanaux,
  executerJobs,
  maintenirA,
  preparerCabinetCanaux,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Transcription d'un audio téléversé (AGT-11, SPEC-3c §7.6, §18.4 T-06 à T-09) : chemin de
 * téléversement dédié (l'audio n'entre pas par POST /fichiers), brouillon à relire, séparation des
 * tâches (MPH07), plafonds, écoute, conservation et anonymisation, isolation.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let b: CabinetCanaux;
let consultant: Awaited<ReturnType<CabinetCanaux["avecRoles"]>>;
let expert: Awaited<ReturnType<CabinetCanaux["avecRoles"]>>;
const TEXTE = "Bonjour, le chiffre d'affaires est de cent mille.";
const CONSENTEMENT = {
  enregistrement_consenti: true,
  reference_consentement: "Consentement oral enregistré le 12/10/2026",
};

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Transcriptions A");
  b = await preparerCabinetCanaux(ctx, "Transcriptions B");
  consultant = await a.avecRoles(["consultant"]);
  expert = await a.avecRoles(["expert_metier"]);
  for (const u of [consultant, expert]) {
    attendre(
      201,
      await a.chef.post(`/api/missions/${a.missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
      "équipe",
    );
  }
}, 240_000);
afterAll(() => ctx.fermer());

const upload = (contenu: Buffer, nom = "entretien.ogg") =>
  televerser(a.chef, `/api/missions/${a.missionId}/transcriptions/audio`, nom, contenu);

async function transcrire(
  options: Record<string, unknown> = {},
  audio = fabriquerAudioDeTest({ texte: TEXTE, langue: "fr", dureeMs: 4200, confiance: 870 }),
) {
  const f = await upload(audio);
  attendre(201, f, "audio");
  const r = await a.chef.post(`/api/missions/${a.missionId}/transcriptions`, {
    fichier_id: f.json().id,
    langue: "fr",
    ...CONSENTEMENT,
    ...options,
  });
  attendre(201, r, "création");
  await executerJobs(ctx);
  return { fichierId: f.json().id as string, id: r.json().id as string };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lire = async (par: { get: (url: string) => Promise<{ json(): any }> }, id: string) =>
  (await par.get(`/api/transcriptions/${id}`)).json();

describe("téléversement dédié (T-06)", () => {
  it("un conteneur de test est accepté (audio/ogg) ; un exécutable renommé .ogg et un audio nommé .pdf sont refusés ; POST /fichiers n'admet pas l'audio", async () => {
    const ok = await upload(fabriquerAudioDeTest({ texte: "x", dureeMs: 10, confiance: 500 }));
    attendre(201, ok, "audio de test");
    expect(ok.json().type_mime).toBe("audio/ogg");
    const exe = await upload(ECHANTILLONS.exe(), "faux.ogg");
    expect(exe.statusCode).toBe(415);
    expect(exe.json().erreur.code).toBe("TYPE_FICHIER_REFUSE");
    expect(
      (await upload(fabriquerAudioDeTest({ texte: "x", dureeMs: 10, confiance: 500 }), "audio.pdf"))
        .statusCode,
    ).toBe(415);
    expect(
      (
        await televerser(
          a.chef,
          "/api/fichiers",
          "audio.ogg",
          fabriquerAudioDeTest({ texte: "x", dureeMs: 10, confiance: 500 }),
        )
      ).statusCode,
    ).toBe(415);
    // 401, 403, mission d'un autre cabinet : 404.
    expect(
      (
        await televerser(
          a.associe,
          `/api/missions/${b.missionId}/transcriptions/audio`,
          "a.ogg",
          fauxAudioReel(),
        )
      ).statusCode,
    ).toBe(404);
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect(
      (
        await televerser(
          gestionnaire,
          `/api/missions/${a.missionId}/transcriptions/audio`,
          "a.ogg",
          fauxAudioReel(),
        )
      ).statusCode,
    ).toBe(403);
    // Le fichier audio rattaché à une transcription ne se lit pas par GET /fichiers/:id (route dédiée).
    const t = await transcrire();
    expect((await a.chef.get(`/api/fichiers/${t.fichierId}`)).statusCode).toBe(404);
  });
});

describe("parcours : brouillon, correction, validation (T-07)", () => {
  it("création, job, version 1 à relire ; correction humaine ; validation refusée au dernier modificateur (MPH07), acceptée à un autre", async () => {
    const t = await transcrire();
    const d = await lire(a.chef, t.id);
    expect(d).toMatchObject({
      statut: "a_relire",
      langue_detectee: "fr",
      confiance_pm: 870,
      niveau_confiance: "bon",
      duree_audio_ms: 4200,
      mode_fournisseur: "simule",
    });
    expect(d.versions).toHaveLength(1);
    expect(d.versions[0]).toMatchObject({
      numero: 1,
      origine: "automatique",
      texte: TEXTE,
      auteur_id: null,
    });
    expect(d.versions[0].segments).toEqual([
      { debut_ms: 0, fin_ms: 4200, texte: TEXTE, confiance: 870 },
    ]);
    // FIN-02 : le coût est absent sans finance.lire.
    expect("cout_estime_micro_usd" in d).toBe(false);
    expect("cout_estime_micro_usd" in (await lire(a.associe, t.id))).toBe(true);

    // Correction par le chef (If-Match = numéro de la dernière version lue) ; version périmée : 409.
    const put = (par: typeof a.chef, v: number, texte: string) =>
      par.brut({
        method: "PUT",
        url: `/api/transcriptions/${t.id}/texte`,
        payload: JSON.stringify({ texte }),
        headers: { "content-type": "application/json", "if-match": `"${v}"` },
      });
    attendre(200, await put(a.chef, 1, `${TEXTE} (corrigé)`), "correction");
    expect((await put(a.chef, 1, "périmée")).statusCode).toBe(409);
    expect(
      (await a.chef.put(`/api/transcriptions/${t.id}/texte`, { texte: "sans en-tête" })).statusCode,
    ).toBe(400);
    // Le dernier modificateur ne valide pas sa propre correction ; un autre, si.
    const refus = await a.chef.post(`/api/transcriptions/${t.id}/valider`, {});
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("TRANSCRIPTION_VALIDATION_REFUSEE");
    // Le consultant ne valide pas (permission) ; l'expert métier valide.
    expect((await consultant.post(`/api/transcriptions/${t.id}/valider`, {})).statusCode).toBe(403);
    const ok = await expert.post(`/api/transcriptions/${t.id}/valider`, {});
    attendre(200, ok, "validation");
    expect(ok.json()).toMatchObject({ statut: "validee", valide_par: expert.utilisateurId });
    expect((await expert.post(`/api/transcriptions/${t.id}/valider`, {})).statusCode).toBe(409);
    // Version humaine en base : ajout seul (MPH06), même pour le propriétaire.
    await expect(
      proprietaire((c) =>
        c.query(
          "UPDATE transcriptions_versions SET texte = 'x' WHERE transcription_id = $1 AND numero = 2",
          [t.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPH06" });
    await expect(
      proprietaire((c) =>
        c.query("DELETE FROM transcriptions_versions WHERE transcription_id = $1", [t.id]),
      ),
    ).rejects.toMatchObject({ code: "MPH06" });
    // Un statut terminal ne change plus (MPH07).
    await expect(
      proprietaire((c) =>
        c.query("UPDATE transcriptions SET statut = 'a_relire' WHERE id = $1", [t.id]),
      ),
    ).rejects.toMatchObject({ code: "MPH07" });
  });

  it("un associé valide sa propre correction ; un rejet exige un motif", async () => {
    const t = await transcrire();
    attendre(
      200,
      await a.associe.brut({
        method: "PUT",
        url: `/api/transcriptions/${t.id}/texte`,
        payload: JSON.stringify({ texte: "Texte de l'associé" }),
        headers: { "content-type": "application/json", "if-match": "1" },
      }),
      "correction associé",
    );
    attendre(
      200,
      await a.associe.post(`/api/transcriptions/${t.id}/valider`, {}),
      "validation par l'associé",
    );
    const r = await transcrire();
    expect((await expert.post(`/api/transcriptions/${r.id}/rejeter`, {})).statusCode).toBe(400);
    const rej = await expert.post(`/api/transcriptions/${r.id}/rejeter`, {
      motif: "Qualité sonore insuffisante",
    });
    attendre(200, rej, "rejet");
    expect(rej.json()).toMatchObject({
      statut: "rejetee",
      motif_rejet: "Qualité sonore insuffisante",
    });
  });

  it("un faux audio (OGG sans marque de test) : transcription en échec AUDIO_NON_SIMULE", async () => {
    const t = await transcrire({}, fauxAudioReel());
    expect(await lire(a.chef, t.id)).toMatchObject({
      statut: "echec",
      erreur_code: "AUDIO_NON_SIMULE",
    });
  });

  it("panne réessayable du fournisseur : reprise du worker puis échec à la dernière tentative", async () => {
    const t = await transcrire(
      {},
      fabriquerAudioDeTest({ texte: "x", dureeMs: 10, confiance: 5, panne: "indisponible" }),
    );
    // Le job interrompu annule sa transaction : la transcription reste en file jusqu'à la reprise.
    expect((await lire(a.chef, t.id)).statut).toBe("en_file");
    for (let k = 1; k <= 4; k++) await executerJobs(ctx, new Date(Date.now() + k * 10 * 60_000));
    expect(await lire(a.chef, t.id)).toMatchObject({
      statut: "echec",
      erreur_code: "INDISPONIBLE",
    });
  });
});

describe("plafonds (T-08)", () => {
  it("590 min utilisées + 660 s : 429 PLAFOND_TRANSCRIPTION ; 589 min + 660 s : 201", async () => {
    // Cabinet dédié : le remplissage du plafond mensuel ne doit pas gêner les autres cas.
    const p = await preparerCabinetCanaux(ctx, "Transcriptions plafond");
    const up = (nom: string) =>
      televerser(
        p.chef,
        `/api/missions/${p.missionId}/transcriptions/audio`,
        nom,
        fabriquerAudioDeTest({ texte: "y", dureeMs: 10, confiance: 5 }),
      );
    const premier = (await up("premier.ogg")).json().id as string;
    // Les durées d'audio sont plafonnées à 30 minutes par ligne : 590 minutes = 19 lignes de 30 min
    // et une de 20 min, semées par le propriétaire (fichiers et transcriptions de remplissage).
    await proprietaire(async (c) => {
      await c.query(
        `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
         SELECT f.cabinet_id, md5('plafond' || g::text || random()::text), 'remplissage.ogg', 'audio/ogg', 10, f.sha256, f.envoye_par
         FROM fichiers f, generate_series(1, 20) g WHERE f.id = '${premier}'`,
      );
      await c.query(
        `INSERT INTO transcriptions (cabinet_id, mission_id, fichier_id, langue_demandee, enregistrement_consenti,
           reference_consentement, cree_par)
         SELECT '${p.cabinetId}'::uuid, '${p.missionId}'::uuid, f.id, 'fr', true, 'Remplissage du plafond mensuel',
                '${p.chef.utilisateurId}'::uuid
         FROM fichiers f WHERE f.cabinet_id = '${p.cabinetId}' AND f.nom_origine = 'remplissage.ogg'`,
      );
      await c.query(
        "UPDATE transcriptions SET statut = 'en_cours' WHERE reference_consentement = 'Remplissage du plafond mensuel'",
      );
      await c.query(
        "UPDATE transcriptions SET statut = 'a_relire', duree_audio_ms = 1800000 WHERE reference_consentement = 'Remplissage du plafond mensuel'",
      );
    });
    const regler = (minutes: number) =>
      proprietaire((c) =>
        c.query(
          `UPDATE transcriptions SET duree_audio_ms = ${minutes * 60_000 - 19 * 1_800_000} WHERE id = (
             SELECT id FROM transcriptions WHERE reference_consentement = 'Remplissage du plafond mensuel'
             ORDER BY id LIMIT 1)`,
        ),
      );
    await regler(590);
    const corps = async (nom: string) => ({
      fichier_id: (await up(nom)).json().id as string,
      langue: "fr",
      ...CONSENTEMENT,
      duree_secondes: 660,
    });
    const trop = await p.chef.post(
      `/api/missions/${p.missionId}/transcriptions`,
      await corps("a.ogg"),
    );
    expect(trop.statusCode).toBe(429);
    expect(trop.json().erreur.code).toBe("PLAFOND_TRANSCRIPTION");
    await regler(589);
    attendre(
      201,
      await p.chef.post(`/api/missions/${p.missionId}/transcriptions`, await corps("b.ogg")),
      "à la limite",
    );
  });

  it("consentement obligatoire (déclaré et référencé), langue connue, fichier audio du cabinet", async () => {
    const f = (
      await upload(fabriquerAudioDeTest({ texte: "z", dureeMs: 10, confiance: 5 }), "z.ogg")
    ).json().id as string;
    const url = `/api/missions/${a.missionId}/transcriptions`;
    expect(
      (
        await a.chef.post(url, {
          fichier_id: f,
          langue: "fr",
          enregistrement_consenti: false,
          reference_consentement: "Consentement oral enregistré",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.chef.post(url, {
          fichier_id: f,
          langue: "fr",
          enregistrement_consenti: true,
          reference_consentement: "court",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await a.chef.post(url, { fichier_id: f, langue: "en", ...CONSENTEMENT })).statusCode,
    ).toBe(400);
    const pdf = (await televerser(a.chef, "/api/fichiers", "doc.pdf", ECHANTILLONS.pdf())).json()
      .id as string;
    expect(
      (await a.chef.post(url, { fichier_id: pdf, langue: "fr", ...CONSENTEMENT })).statusCode,
    ).toBe(404);
  });
});

describe("routes : 401, 403, autre cabinet, portail, écoute", () => {
  it("401 sans session, 403 sans permission, 404 d'un autre cabinet, portail fermé", async () => {
    const t = await transcrire();
    const sans = await ctx.app.inject({ method: "GET", url: `/api/transcriptions/${t.id}` });
    expect(sans.statusCode).toBe(401);
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.get(`/api/transcriptions/${t.id}`)).statusCode).toBe(403);
    expect((await gestionnaire.get(`/api/missions/${a.missionId}/transcriptions`)).statusCode).toBe(
      403,
    );
    for (const [methode, url] of [
      ["get", `/api/transcriptions/${t.id}`],
      ["get", `/api/transcriptions/${t.id}/audio`],
      ["post", `/api/transcriptions/${t.id}/valider`],
      ["post", `/api/transcriptions/${t.id}/rejeter`],
    ] as const) {
      const autre =
        methode === "get"
          ? await b.associe.get(url)
          : await b.associe.post(url, url.endsWith("/rejeter") ? { motif: "x" } : {});
      expect(autre.statusCode, url).toBe(404);
    }
    expect((await b.associe.get(`/api/missions/${a.missionId}/transcriptions`)).statusCode).toBe(
      404,
    );
    // Un consultant hors équipe ne voit pas la mission : 404.
    const hors = await a.avecRoles(["consultant"]);
    expect((await hors.get(`/api/transcriptions/${t.id}`)).statusCode).toBe(404);
    // Le portail n'atteint aucune de ces routes.
    const p = await a.dirigeant.get(`/api/transcriptions/${t.id}`);
    expect(p.statusCode).toBe(403);
    expect(p.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    const liste = await a.chef.get(`/api/missions/${a.missionId}/transcriptions?limite=2`);
    attendre(200, liste, "liste");
    expect(liste.json().elements.length).toBeLessThanOrEqual(2);
    expect(liste.json().curseur_suivant).not.toBeNull();
  });

  it("écoute : en-têtes de sécurité, contenu servi", async () => {
    const t = await transcrire();
    const r = await a.chef.get(`/api/transcriptions/${t.id}/audio`);
    attendre(200, r, "audio");
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(r.headers["content-security-policy"])).toContain("sandbox");
    expect(r.headers["content-type"]).toBe("audio/ogg");
  });
});

describe("conservation (T-09)", () => {
  it("audio effacé 30 jours après la validation (404 ensuite), texte anonymisé après 365 jours", async () => {
    const t = await transcrire();
    attendre(
      200,
      await a.associe.brut({
        method: "PUT",
        url: `/api/transcriptions/${t.id}/texte`,
        payload: JSON.stringify({ texte: "Texte à conserver" }),
        headers: { "content-type": "application/json", "if-match": "1" },
      }),
      "correction",
    );
    attendre(200, await a.associe.post(`/api/transcriptions/${t.id}/valider`, {}), "validation");
    const jour = 86_400_000;
    // 29 jours : l'audio est encore là ; 31 jours : effacé.
    expect(
      (await maintenirA(ctx, a.cabinetId, new Date(Date.now() + 29 * jour))).audios_effaces,
    ).toBe(0);
    expect((await a.chef.get(`/api/transcriptions/${t.id}/audio`)).statusCode).toBe(200);
    expect(
      (await maintenirA(ctx, a.cabinetId, new Date(Date.now() + 31 * jour))).audios_effaces,
    ).toBeGreaterThanOrEqual(1);
    expect((await a.chef.get(`/api/transcriptions/${t.id}/audio`)).statusCode).toBe(404);
    const apres = await lire(a.chef, t.id);
    expect(apres.audio_disponible).toBe(false);
    const suppr = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT motif FROM fichiers_suppressions WHERE fichier_id = $1", [
            t.fichierId,
          ])
        ).rows[0],
    );
    expect(suppr.motif).toBe("retire");
    // Texte conservé jusqu'à 365 jours, puis `[texte purgé]`.
    expect((await lire(a.chef, t.id)).versions.at(-1).texte).toBe("Texte à conserver");
    expect(
      (await maintenirA(ctx, a.cabinetId, new Date(Date.now() + 366 * jour))).versions_anonymisees,
    ).toBeGreaterThanOrEqual(2);
    const purge = await lire(a.chef, t.id);
    expect(purge.versions.map((v: { texte: string }) => v.texte)).toEqual([
      "[texte purgé]",
      "[texte purgé]",
    ]);
    expect(purge.versions[0].segments).toEqual([]);
  });

  it("anonymiser_transcriptions : moins de 90 jours refusé, date future refusée", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("SELECT anonymiser_transcriptions(now(), 30)"),
      ),
    ).rejects.toThrow(/invalides/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("SELECT anonymiser_transcriptions(now() + interval '1 day', 365)"),
      ),
    ).rejects.toThrow(/futur/);
  });
});
