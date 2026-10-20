import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MEDIA_ENTRANT_OCTETS_MAX } from "../src/canaux/entrants.js";
import { lireFluxPlafonne, type FluxOctets } from "../src/canaux/media-flux.js";
import { proprietaire } from "./helpers.js";
import { attendre, inviterClient } from "./portail-outils.js";
import { fabriquerAudioDeTest } from "./audio-test.js";
import {
  demarrerCanaux,
  destinataireVerifie,
  evenementId,
  executerJobs,
  preparerCabinetCanaux,
  webhook,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Média entrant EN FLUX avec plafond AVANT lecture complète (SPEC-3c §13, SECURITY « Canaux »).
 * Utilitaire `lireFluxPlafonne` seul, puis webhook : un vocal géant est ignoré sans transcription ni
 * proposition, et la lecture s'arrête au plafond (flux infini fermé après un nombre borné de blocs).
 */

const BLOC = 64 * 1024;

/** Flux de test : `blocs` blocs (infini si absent), avec suivi des blocs produits et de la fermeture. */
function fluxSuivi(opts: { blocs?: number; octets?: number; erreurApres?: number } = {}) {
  const suivi = { blocsLus: 0, ferme: false };
  const taille = opts.octets ?? BLOC;
  const flux: FluxOctets = (async function* () {
    try {
      for (let i = 0; opts.blocs === undefined || i < opts.blocs; i++) {
        if (opts.erreurApres !== undefined && i >= opts.erreurApres) throw new Error("coupure");
        suivi.blocsLus += 1;
        yield new Uint8Array(taille);
      }
    } finally {
      suivi.ferme = true;
    }
  })();
  return { flux, suivi };
}

describe("lireFluxPlafonne", () => {
  it("taille déclarée trop grande : refus immédiat, aucun octet lu", async () => {
    const { flux, suivi } = fluxSuivi({ blocs: 10 });
    const r = await lireFluxPlafonne(flux, 1000, 1001);
    expect(r).toEqual({ statut: "trop_gros" });
    expect(suivi.blocsLus).toBe(0);
  });

  it("flux sans taille qui dépasse : arrêt, compteur de blocs borné, flux annulé", async () => {
    const { flux, suivi } = fluxSuivi({ octets: BLOC }); // infini
    const max = 10 * BLOC;
    const r = await lireFluxPlafonne(flux, max);
    expect(r).toEqual({ statut: "trop_gros" });
    expect(suivi.blocsLus).toBeLessThanOrEqual(max / BLOC + 1);
    expect(suivi.ferme).toBe(true);
  });

  it("une taille déclarée mensongère (petite) ne désactive pas le compteur", async () => {
    const { flux, suivi } = fluxSuivi({ octets: BLOC });
    const r = await lireFluxPlafonne(flux, 3 * BLOC, 10);
    expect(r).toEqual({ statut: "trop_gros" });
    expect(suivi.blocsLus).toBeLessThanOrEqual(4);
    expect(suivi.ferme).toBe(true);
  });

  it("un seul bloc plus grand que le plafond n'est pas retenu", async () => {
    const { flux, suivi } = fluxSuivi({ octets: 5000, blocs: 3 });
    expect(await lireFluxPlafonne(flux, 4999)).toEqual({ statut: "trop_gros" });
    expect(suivi.blocsLus).toBe(1);
    expect(suivi.ferme).toBe(true);
  });

  it("flux exactement au plafond accepté ; un octet de moins de plafond refusé", async () => {
    const exact = fluxSuivi({ octets: 100, blocs: 10 });
    const r = await lireFluxPlafonne(exact.flux, 1000, 1000);
    expect(r.statut).toBe("ok");
    if (r.statut === "ok") expect(r.contenu.length).toBe(1000);
    const trop = fluxSuivi({ octets: 100, blocs: 10 });
    expect(await lireFluxPlafonne(trop.flux, 999)).toEqual({ statut: "trop_gros" });
    expect(trop.suivi.ferme).toBe(true);
  });

  it("flux vide : Buffer vide", async () => {
    const { flux } = fluxSuivi({ blocs: 0 });
    const r = await lireFluxPlafonne(flux, 100);
    expect(r.statut).toBe("ok");
    if (r.statut === "ok") expect(r.contenu.length).toBe(0);
  });

  it("erreur en cours de flux : propagée, flux fermé", async () => {
    const { flux, suivi } = fluxSuivi({ octets: 10, erreurApres: 2 });
    await expect(lireFluxPlafonne(flux, 1000)).rejects.toThrow("coupure");
    expect(suivi.blocsLus).toBe(2);
    expect(suivi.ferme).toBe(true);
  });

  it("un ReadableStream est accepté", async () => {
    const flux = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3]));
        c.close();
      },
    });
    const r = await lireFluxPlafonne(flux as unknown as FluxOctets, 10);
    expect(r.statut === "ok" && [...r.contenu]).toEqual([1, 2, 3]);
  });
});

describe("webhook : média vocal entrant en flux", () => {
  let ctx: ContexteCanaux;
  let a: CabinetCanaux;
  let dest: string;
  const numero = "+2250000000091";

  beforeAll(async () => {
    ctx = await demarrerCanaux();
    a = await preparerCabinetCanaux(ctx, "Media flux A");
    const u = await inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
    dest = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", numero);
  }, 300_000);
  afterAll(async () => {
    await ctx.fermer();
  });

  const propositions = () =>
    proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM canaux_saisies_kpi WHERE destinataire_id = $1",
            [dest],
          )
        ).rows[0].n as number,
    );

  const vocal = async (ref: string) => {
    attendre(
      200,
      await webhook(ctx, {
        compte: a.compteWhatsapp,
        evenement: evenementId("aud"),
        type: "message",
        numero,
        recu_le: new Date().toISOString(),
        genre: "audio",
        ref_media: ref,
        type_mime: "audio/ogg",
        duree_ms: 3000,
      }),
      "audio",
    );
    const avant = ctx.whatsapp.boite.length;
    await executerJobs(ctx);
    return ctx.whatsapp.boite
      .slice(avant)
      .filter((m) => m.numero === numero && m.gabarit === "reponse_session")
      .pop()?.texte;
  };

  const plafondBlocs = Math.ceil(MEDIA_ENTRANT_OCTETS_MAX / BLOC) + 1;
  const transcripteur = () => ctx.canaux.transcripteur!;

  it("média géant sans taille déclarée : lecture arrêtée au plafond, flux fermé, aucune transcription ni proposition", async () => {
    const transcrire = vi.spyOn(transcripteur(), "transcrire");
    const ref = `geant-${evenementId("m")}`.slice(0, 60);
    const suivi = ctx.whatsapp.deposerMediaGeant(a.compteWhatsapp, ref);
    const avant = await propositions();
    expect(await vocal(ref)).toMatch(/Message non compris/);
    expect(transcrire).not.toHaveBeenCalled();
    expect(await propositions()).toBe(avant);
    expect(suivi.blocsLus).toBeGreaterThan(0);
    expect(suivi.blocsLus).toBeLessThanOrEqual(plafondBlocs);
    expect(suivi.ferme).toBe(true);
    transcrire.mockRestore();
  });

  it("média dont la taille déclarée dépasse le plafond : aucun bloc lu", async () => {
    const transcrire = vi.spyOn(transcripteur(), "transcrire");
    const ref = `decl-${evenementId("m")}`.slice(0, 60);
    const suivi = ctx.whatsapp.deposerMediaGeant(a.compteWhatsapp, ref, {
      tailleDeclaree: MEDIA_ENTRANT_OCTETS_MAX + 1,
    });
    const avant = await propositions();
    expect(await vocal(ref)).toMatch(/Message non compris/);
    expect(suivi.blocsLus).toBe(0);
    expect(transcrire).not.toHaveBeenCalled();
    expect(await propositions()).toBe(avant);
    transcrire.mockRestore();
  });

  it("flux en panne en cours de lecture : traité comme une erreur de téléchargement (non compris)", async () => {
    const ref = `panne-${evenementId("m")}`.slice(0, 60);
    const suivi = ctx.whatsapp.deposerMediaGeant(a.compteWhatsapp, ref, { erreurApresBlocs: 3 });
    const avant = await propositions();
    expect(await vocal(ref)).toMatch(/Message non compris/);
    expect(suivi.blocsLus).toBe(3);
    expect(suivi.ferme).toBe(true);
    expect(await propositions()).toBe(avant);
  });

  it("type MIME hors liste blanche annoncé par le fournisseur : ignoré sans lecture", async () => {
    const ref = `mime-${evenementId("m")}`.slice(0, 60);
    const suivi = ctx.whatsapp.deposerMediaGeant(a.compteWhatsapp, ref, {
      typeMime: "application/x-msdownload",
    });
    expect(await vocal(ref)).toMatch(/Message non compris/);
    expect(suivi.blocsLus).toBe(0); // le flux n'a jamais été lu
  });

  it("vocal normal : toujours téléchargé en flux et transcrit, audio transmis intact", async () => {
    const transcrire = vi.spyOn(transcripteur(), "transcrire");
    const ref = `normal-${evenementId("m")}`.slice(0, 60);
    const audio = fabriquerAudioDeTest({ texte: "affaires 105", dureeMs: 3000, confiance: 900 });
    ctx.whatsapp.deposerMedia(a.compteWhatsapp, ref, { contenu: audio, typeMime: "audio/ogg" });
    await vocal(ref);
    expect(transcrire).toHaveBeenCalledTimes(1);
    const demande = transcrire.mock.calls[0]![0];
    expect(Buffer.compare(demande.audio, audio)).toBe(0);
    expect(demande.typeMime).toBe("audio/ogg");
    transcrire.mockRestore();
  });
});
