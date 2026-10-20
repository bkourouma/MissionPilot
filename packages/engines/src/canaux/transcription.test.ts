import { describe, expect, it } from "vitest";
import {
  coutTranscriptionMicroUsd,
  confianceMoyennePm,
  ErreurCanaux,
  niveauConfiance,
  type ResultatTranscriptionAValider,
  type SegmentTranscrit,
  validerResultatTranscription,
  verifierPlafondTranscription,
} from "./index";

const seg = (debutMs: number, finMs: number, confiance: number): SegmentTranscrit => ({
  debutMs,
  finMs,
  texte: "texte",
  confiance,
});

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ErreurCanaux ? e.code : "AUTRE";
  }
}

describe("confianceMoyennePm et niveauConfiance (SPEC §18.2)", () => {
  it("moyenne pondérée par la durée : 675, « moyen »", () => {
    const pm = confianceMoyennePm([seg(0, 10_000, 900), seg(10_000, 40_000, 600)]);
    expect(pm).toBe(675);
    expect(niveauConfiance(pm)).toBe("moyen");
  });

  it("700,5 est arrondi au demi supérieur : 701", () => {
    expect(confianceMoyennePm([seg(0, 3000, 701), seg(3000, 6000, 700)])).toBe(701);
  });

  it("800 : « bon » ; 599 : « faible »", () => {
    expect(niveauConfiance(confianceMoyennePm([seg(0, 60_000, 800)]))).toBe("bon");
    expect(niveauConfiance(confianceMoyennePm([seg(0, 1000, 599)]))).toBe("faible");
    expect(niveauConfiance(600)).toBe("moyen");
    expect(niveauConfiance(799)).toBe("moyen");
  });

  it("sans durée cumulée : moyenne simple ; sans segment : 0", () => {
    expect(confianceMoyennePm([seg(5, 5, 900), seg(7, 7, 500)])).toBe(700);
    expect(confianceMoyennePm([])).toBe(0);
    expect(niveauConfiance(0)).toBe("faible");
  });
});

describe("validerResultatTranscription", () => {
  const valide: ResultatTranscriptionAValider = {
    texte: "Bonjour, ceci est un test.",
    dureeAudioMs: 40_000,
    segments: [seg(0, 10_000, 900), seg(10_000, 40_000, 600)],
  };
  const avec = (ecart: Partial<ResultatTranscriptionAValider>) =>
    code(() => validerResultatTranscription({ ...valide, ...ecart }));

  it("un résultat conforme est accepté (segments qui se touchent, aucun segment)", () => {
    expect(avec({})).toBeNull();
    expect(avec({ segments: [] })).toBeNull();
    expect(avec({ dureeAudioMs: 1_800_000, segments: [seg(0, 1_800_000, 1000)] })).toBeNull();
  });

  it("segments qui se chevauchent ou non triés : SEGMENTS_CHEVAUCHANT", () => {
    expect(avec({ segments: [seg(0, 10_001, 900), seg(10_000, 40_000, 600)] })).toBe(
      "SEGMENTS_CHEVAUCHANT",
    );
    expect(avec({ segments: [seg(10_000, 20_000, 900), seg(0, 5_000, 600)] })).toBe(
      "SEGMENTS_CHEVAUCHANT",
    );
  });

  it("fin au-delà de la durée, début négatif ou fin avant début : SEGMENT_HORS_DUREE", () => {
    expect(avec({ segments: [seg(0, 40_001, 900)] })).toBe("SEGMENT_HORS_DUREE");
    expect(avec({ segments: [seg(-1, 10, 900)] })).toBe("SEGMENT_HORS_DUREE");
    expect(avec({ segments: [seg(20, 10, 900)] })).toBe("SEGMENT_HORS_DUREE");
  });

  it("confiance hors de 0 à 1000 ou non entière : CONFIANCE_INVALIDE", () => {
    expect(avec({ segments: [seg(0, 10, 1001)] })).toBe("CONFIANCE_INVALIDE");
    expect(avec({ segments: [seg(0, 10, -1)] })).toBe("CONFIANCE_INVALIDE");
    expect(avec({ segments: [seg(0, 10, 500.5)] })).toBe("CONFIANCE_INVALIDE");
    expect(avec({ segments: [seg(0, 10, 1000), seg(10, 20, 0)] })).toBeNull();
  });

  it("durée de 1 800 001 ms : DUREE_MAX ; durée invalide : DUREE_INVALIDE", () => {
    expect(avec({ dureeAudioMs: 1_800_001, segments: [] })).toBe("DUREE_MAX");
    expect(avec({ dureeAudioMs: -1, segments: [] })).toBe("DUREE_INVALIDE");
    expect(avec({ dureeAudioMs: 1.5, segments: [] })).toBe("DUREE_INVALIDE");
    expect(avec({ segments: [seg(0.5, 10, 900)] })).toBe("DUREE_INVALIDE");
  });

  it("texte vide : TEXTE_VIDE ; texte trop long ; trop de segments", () => {
    expect(avec({ texte: "" })).toBe("TEXTE_VIDE");
    expect(avec({ texte: "   \n" })).toBe("TEXTE_VIDE");
    expect(avec({ texte: "a".repeat(200_001) })).toBe("TEXTE_TROP_LONG");
    expect(avec({ texte: "a".repeat(200_000) })).toBeNull();
    const beaucoup = Array.from({ length: 5001 }, (_, i) => seg(i, i + 1, 500));
    expect(avec({ dureeAudioMs: 6000, segments: beaucoup })).toBe("SEGMENTS_TROP_NOMBREUX");
    expect(avec({ dureeAudioMs: 6000, segments: beaucoup.slice(0, 5000) })).toBeNull();
  });

  it("limites paramétrables", () => {
    expect(code(() => validerResultatTranscription(valide, { dureeMaxMs: 30_000 }))).toBe(
      "DUREE_MAX",
    );
    expect(code(() => validerResultatTranscription(valide, { segmentsMax: 1 }))).toBe(
      "SEGMENTS_TROP_NOMBREUX",
    );
    expect(code(() => validerResultatTranscription(valide, { texteMax: 5 }))).toBe(
      "TEXTE_TROP_LONG",
    );
  });
});

describe("verifierPlafondTranscription (SPEC §18.2)", () => {
  const min = (n: number) => n * 60_000;
  const verifier = (utilisees: number, ajout: number | null) =>
    verifierPlafondTranscription({
      utiliseesMs: min(utilisees),
      ajoutMs: ajout === null ? null : min(ajout),
      plafondMinutes: 600,
    });

  it("590 min utilisées + 11 min : refus ; 589 + 11 = 600 : accepté", () => {
    expect(verifier(590, 11).autorise).toBe(false);
    expect(verifier(589, 11).autorise).toBe(true);
  });

  it("durée non déclarée : cas le plus défavorable, 30 minutes", () => {
    expect(verifier(570, null)).toMatchObject({ autorise: true, ajoutRetenuMs: 1_800_000 });
    expect(verifier(571, null).autorise).toBe(false);
  });

  it("restant, jamais négatif", () => {
    expect(verifier(100, 1).restantMs).toBe(min(500));
    expect(verifier(700, 1).restantMs).toBe(0);
  });

  it("refuse des entrées négatives ou non entières", () => {
    expect(() =>
      verifierPlafondTranscription({ utiliseesMs: -1, ajoutMs: 1, plafondMinutes: 600 }),
    ).toThrowError(ErreurCanaux);
    expect(() =>
      verifierPlafondTranscription({ utiliseesMs: 1, ajoutMs: 1.5, plafondMinutes: 600 }),
    ).toThrowError(ErreurCanaux);
  });
});

describe("coutTranscriptionMicroUsd", () => {
  it("minute entamée, minute due (entiers)", () => {
    expect(coutTranscriptionMicroUsd(61_000, 6000)).toBe(12_000);
    expect(coutTranscriptionMicroUsd(60_000, 6000)).toBe(6000);
    expect(coutTranscriptionMicroUsd(0, 6000)).toBe(0);
    expect(coutTranscriptionMicroUsd(1, 6000)).toBe(6000);
    expect(coutTranscriptionMicroUsd(61_000, 0)).toBe(0);
  });

  it("refuse durée ou tarif invalide, ou dépassement de l'entier sûr", () => {
    expect(() => coutTranscriptionMicroUsd(-1, 1)).toThrowError(ErreurCanaux);
    expect(() => coutTranscriptionMicroUsd(1.5, 1)).toThrowError(ErreurCanaux);
    expect(() => coutTranscriptionMicroUsd(1000, -1)).toThrowError(ErreurCanaux);
    expect(() => coutTranscriptionMicroUsd(1000, 0.5)).toThrowError(ErreurCanaux);
    expect(() => coutTranscriptionMicroUsd(60_000 * 1e9, 1e9)).toThrowError(ErreurCanaux);
  });
});
