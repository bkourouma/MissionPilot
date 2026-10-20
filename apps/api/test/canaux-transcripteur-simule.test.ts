import { describe, expect, it } from "vitest";
import { ErreurTranscription, type DemandeTranscription } from "../src/canaux/ports.js";
import { TranscripteurSimule } from "../src/canaux/transcripteur-simule.js";
import { FournisseurSignatureLocal } from "../src/canaux/signature-locale.js";
import { fabriquerAudioDeTest, fauxAudioReel } from "./audio-test.js";

/*
 * Ports TRANSCRIPTEUR et SIGNATURE simulés (SPEC-3c §4.2, §4.3, §18.4 T-01 à T-05, §18.5 G-01 et G-02) :
 * aucun vrai audio, aucun appel externe.
 */

const demande = (
  audio: Buffer,
  langue: DemandeTranscription["langue"] = "fr",
): DemandeTranscription => ({ idempotence: "t1", audio, typeMime: "audio/ogg", langue });

describe("TranscripteurSimule", () => {
  const t = new TranscripteurSimule();

  it("T-01 : texte, langue, durée, un segment, modèle simulé", async () => {
    const texte = "Bonjour, le chiffre d'affaires est de cent mille.";
    const r = await t.transcrire(
      demande(fabriquerAudioDeTest({ texte, langue: "fr", dureeMs: 4200, confiance: 870 })),
    );
    expect(r).toEqual({
      texte,
      segments: [{ debutMs: 0, finMs: 4200, texte, confiance: 870 }],
      langueDetectee: "fr",
      dureeAudioMs: 4200,
      modele: "simule-v1",
    });
    expect(t.langues()).toEqual(["fr", "dyu", "wol", "bam", "lin"]);
  });

  it("segments fournis par le conteneur conservés", async () => {
    const segments = [
      { debutMs: 0, finMs: 1000, texte: "a", confiance: 900 },
      { debutMs: 1000, finMs: 2000, texte: "b", confiance: 600 },
    ];
    const r = await t.transcrire(
      demande(fabriquerAudioDeTest({ texte: "a b", dureeMs: 2000, confiance: 750, segments })),
    );
    expect(r.segments).toEqual(segments);
  });

  it("T-02 : un audio « réel » (OGG sans marque de test) est refusé, définitif", async () => {
    const e = await t.transcrire(demande(fauxAudioReel())).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurTranscription);
    expect(e).toMatchObject({ code: "AUDIO_NON_SIMULE", reessayable: false });
    const conteneur = fabriquerAudioDeTest({ texte: "x", dureeMs: 1, confiance: 1 });
    await expect(
      t.transcrire({ ...demande(conteneur), typeMime: "audio/mpeg" }),
    ).rejects.toMatchObject({
      code: "AUDIO_NON_SIMULE",
    });
  });

  it("T-03 : langue hors liste refusée, dioula acceptée, « auto » prend la langue du conteneur", async () => {
    const audio = fabriquerAudioDeTest({ texte: "x", langue: "dyu", dureeMs: 10, confiance: 500 });
    await expect(t.transcrire(demande(audio, "en" as never))).rejects.toMatchObject({
      code: "LANGUE_NON_PRISE_EN_CHARGE",
      reessayable: false,
    });
    expect((await t.transcrire(demande(audio, "dyu"))).langueDetectee).toBe("dyu");
    expect((await t.transcrire(demande(audio, "auto"))).langueDetectee).toBe("dyu");
  });

  it("T-04 : pannes simulées", async () => {
    const panne = (p: "indisponible" | "delai") =>
      t.transcrire(
        demande(fabriquerAudioDeTest({ texte: "x", dureeMs: 10, confiance: 5, panne: p })),
      );
    await expect(panne("indisponible")).rejects.toMatchObject({
      code: "INDISPONIBLE",
      reessayable: true,
    });
    await expect(panne("delai")).rejects.toMatchObject({
      code: "INDISPONIBLE",
      reessayable: false,
    });
  });

  it("T-05 : JSON invalide ou durée négative : AUDIO_ILLISIBLE", async () => {
    const entete = fauxAudioReel().subarray(0, 27);
    const marque = Buffer.from("MPSIM1\n");
    await expect(
      t.transcrire(demande(Buffer.concat([entete, marque, Buffer.from("{pas du json")]))),
    ).rejects.toMatchObject({ code: "AUDIO_ILLISIBLE" });
    await expect(
      t.transcrire(demande(fabriquerAudioDeTest({ texte: "x", dureeMs: -5, confiance: 5 }))),
    ).rejects.toMatchObject({ code: "AUDIO_ILLISIBLE" });
  });
});

describe("FournisseurSignatureLocal", () => {
  const maintenant = new Date("2026-10-12T08:00:00Z");
  const p = new FournisseurSignatureLocal({ horloge: () => maintenant });
  const base = {
    idempotence: "22222222-2222-4222-8222-222222222222",
    empreintesDocument: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    nomDocument: "Lettre.pdf",
    signataires: [
      { id: "s1", rang: 1, partie: "cabinet" as const },
      { id: "s2", rang: 2, partie: "client" as const },
    ],
    expireLe: new Date("2026-11-12T08:00:00Z"),
  };

  it("G-01 : référence déterministe, parcours interne, aucune URL", async () => {
    expect(p.niveau).toBe("simple_simulee");
    expect(await p.creerDemande(base)).toEqual({
      referenceExterne: "loc-b454f82c5857ebab",
      parcours: "interne",
      signataires: [
        { id: "s1", url: null },
        { id: "s2", url: null },
      ],
    });
    expect(await p.recupererPreuves("loc-b454f82c5857ebab")).toBeNull();
    await expect(p.annuler("loc-b454f82c5857ebab", "motif")).resolves.toBeUndefined();
    expect("verifierEvenement" in p).toBe(false);
  });

  it("G-02 : empreinte de 63 caractères ou échéance passée refusées", async () => {
    await expect(
      p.creerDemande({ ...base, empreintesDocument: base.empreintesDocument.slice(1) }),
    ).rejects.toMatchObject({ code: "EMPREINTE_INVALIDE" });
    await expect(
      p.creerDemande({ ...base, expireLe: new Date("2026-10-11T08:00:00Z") }),
    ).rejects.toMatchObject({ code: "ECHEANCE_INVALIDE" });
  });
});
