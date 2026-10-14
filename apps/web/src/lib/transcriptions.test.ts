import { describe, expect, it } from "vitest";
import type { VersionTranscriptionApi } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  acceptAudio,
  cheminApiAudioTranscription,
  actionsTranscription,
  controlerAudio,
  dernierAuteurHumain,
  enteteIfMatch,
  extensionsAudioLisibles,
  formaterConfiance,
  formaterDuree,
  formaterPosition,
  hrefAudioTranscription,
  libelleErreurTranscription,
  libelleLangue,
  libelleNiveauConfiance,
  libelleStatutTranscription,
  messageErreurTranscription,
  niveauConfiancePm,
  segmentsDe,
  tonaliteConfiance,
  tonaliteStatutTranscription,
  transcriptionEnAttente,
  validerCorrectionTexte,
  validerRejetTranscription,
  validerTranscription,
  versionCourante,
  versionsRecentesDabord,
} from "./transcriptions";

const MOI = "11111111-1111-4111-8111-111111111111";
const AUTRE = "22222222-2222-4222-8222-222222222222";

const version = (
  numero: number,
  origine: "automatique" | "humaine",
  auteur_id: string | null = null,
  segments?: VersionTranscriptionApi["segments"],
): VersionTranscriptionApi => ({
  numero,
  origine,
  texte: `texte ${numero}`,
  auteur_id,
  cree_le: "2027-03-12T10:00:00Z",
  ...(segments ? { segments } : {}),
});

describe("libellés", () => {
  it("traduit statuts, langues et erreurs en français", () => {
    expect(libelleStatutTranscription("a_relire")).toBe("À relire");
    expect(libelleStatutTranscription("inconnu")).toBe("—");
    expect(libelleLangue("dyu")).toBe("Dioula");
    expect(libelleLangue("auto")).toBe("Détection automatique");
    expect(libelleErreurTranscription("AUDIO_NON_SIMULE")).toContain("enregistrement de test");
    expect(libelleErreurTranscription(null)).toBe("La transcription a échoué.");
    expect(tonaliteStatutTranscription("validee")).toBe("succes");
    expect(tonaliteStatutTranscription("echec")).toBe("danger");
    expect(tonaliteStatutTranscription("a_relire")).toBe("attention");
  });

  it("une transcription en file ou en cours n'a pas encore de texte", () => {
    expect(transcriptionEnAttente("en_file")).toBe(true);
    expect(transcriptionEnAttente("en_cours")).toBe(true);
    expect(transcriptionEnAttente("a_relire")).toBe(false);
  });
});

describe("durée et confiance", () => {
  it("formate une durée et une position", () => {
    expect(formaterDuree(42_000)).toBe("42 s");
    expect(formaterDuree(185_000)).toBe("3 min 05 s");
    expect(formaterDuree(null)).toBe("—");
    expect(formaterDuree(-1)).toBe("—");
    expect(formaterPosition(12_000)).toBe("0:12");
    expect(formaterPosition(725_000)).toBe("12:05");
  });

  it("classe la confiance comme le moteur : bon dès 800, moyen dès 600", () => {
    expect(niveauConfiancePm(1000)).toBe("bon");
    expect(niveauConfiancePm(800)).toBe("bon");
    expect(niveauConfiancePm(799)).toBe("moyen");
    expect(niveauConfiancePm(600)).toBe("moyen");
    expect(niveauConfiancePm(599)).toBe("faible");
    expect(niveauConfiancePm(0)).toBe("faible");
    expect(niveauConfiancePm(null)).toBeNull();
    expect(libelleNiveauConfiance("moyen")).toBe("Confiance moyenne");
    expect(libelleNiveauConfiance(null)).toBe("Confiance inconnue");
    expect(tonaliteConfiance("bon")).toBe("succes");
    expect(tonaliteConfiance("faible")).toBe("danger");
    expect(tonaliteConfiance(null)).toBe("neutre");
  });

  it("affiche la confiance en pourcentage (pour mille ÷ 10)", () => {
    expect(formaterConfiance(850)).toBe("85 %");
    expect(formaterConfiance(855).replace(/\s/g, " ")).toBe("85,5 %");
    expect(formaterConfiance(null)).toBe("—");
  });
});

describe("versions", () => {
  const versions = [
    version(1, "automatique", null, [
      { debut_ms: 5000, fin_ms: 9000, texte: "suite", confiance: 700 },
      { debut_ms: 0, fin_ms: 5000, texte: "début", confiance: 900 },
    ]),
    version(3, "humaine", AUTRE),
    version(2, "humaine", MOI),
  ];

  it("la courante est la plus récente ; l'historique va du plus récent au plus ancien", () => {
    expect(versionCourante(versions)?.numero).toBe(3);
    expect(versionsRecentesDabord(versions).map((v) => v.numero)).toEqual([3, 2, 1]);
    expect(versionCourante([])).toBeNull();
  });

  it("les segments viennent de la version 1 et sont triés par début", () => {
    expect(segmentsDe(versions).map((s) => s.texte)).toEqual(["début", "suite"]);
    expect(segmentsDe([version(2, "humaine", MOI)])).toEqual([]);
  });

  it("l'en-tête If-Match porte le numéro de version entre guillemets", () => {
    expect(enteteIfMatch(3)).toBe('"3"');
  });

  it("le dernier auteur humain ignore la version automatique", () => {
    expect(dernierAuteurHumain(versions)).toBe(AUTRE);
    expect(dernierAuteurHumain([version(1, "automatique")])).toBeNull();
  });
});

describe("droits et séparation des tâches", () => {
  const t = { statut: "a_relire" as const, audio_disponible: true };

  it("le consultant corrige mais ne valide pas", () => {
    const a = actionsTranscription({
      transcription: t,
      versions: [version(1, "automatique")],
      roles: ["consultant"],
      utilisateurId: MOI,
    });
    expect(a).toMatchObject({ corriger: true, valider: false, rejeter: false, ecouter: true });
  });

  it("le valideur ne valide pas sa propre correction, sauf associé", () => {
    const versions = [version(1, "automatique"), version(2, "humaine", MOI)];
    const chef = actionsTranscription({
      transcription: t,
      versions,
      roles: ["chef_mission"],
      utilisateurId: MOI,
    });
    expect(chef.valider).toBe(false);
    expect(chef.rejeter).toBe(true);
    expect(chef.motifValidationImpossible).toContain("une autre personne");
    const associe = actionsTranscription({
      transcription: t,
      versions,
      roles: ["associe"],
      utilisateurId: MOI,
    });
    expect(associe.valider).toBe(true);
    const autre = actionsTranscription({
      transcription: t,
      versions,
      roles: ["chef_mission"],
      utilisateurId: AUTRE,
    });
    expect(autre.valider).toBe(true);
    expect(autre.motifValidationImpossible).toBeNull();
  });

  it("une transcription terminée ne se modifie plus ; un audio effacé ne s'écoute plus", () => {
    const a = actionsTranscription({
      transcription: { statut: "validee", audio_disponible: false },
      versions: [version(1, "automatique")],
      roles: ["associe"],
      utilisateurId: MOI,
    });
    expect(a).toEqual({
      corriger: false,
      valider: false,
      rejeter: false,
      ecouter: false,
      motifValidationImpossible: null,
    });
  });

  it("l'audio se téléverse par la route dédiée de la mission, pas par /api/fichiers", () => {
    expect(cheminApiAudioTranscription("m1")).toBe("/api/missions/m1/transcriptions/audio");
  });

  it("l'écoute passe par la route dédiée de la transcription", () => {
    expect(hrefAudioTranscription("abc")).toBe("/api/transcriptions/abc/audio");
  });
});

describe("sélecteur audio dédié", () => {
  it("n'admet que les extensions audio de la liste de la transcription", () => {
    for (const nom of ["a.ogg", "a.opus", "a.mp3", "a.m4a", "a.wav", "A.MP3"]) {
      expect(controlerAudio({ name: nom, size: 1000 }).ok, nom).toBe(true);
    }
    for (const nom of ["a.pdf", "a.mp4", "a", "a.exe"]) {
      expect(controlerAudio({ name: nom, size: 1000 }).ok, nom).toBe(false);
    }
    expect(acceptAudio()).toContain("audio/ogg");
    expect(acceptAudio()).toContain(".m4a");
    expect(extensionsAudioLisibles()).toBe("OGG, OGA, OPUS, MP3, M4A ou WAV");
  });

  it("refuse un fichier vide ou de plus de 15 Mo", () => {
    expect(controlerAudio({ name: "a.mp3", size: 0 }).ok).toBe(false);
    expect(controlerAudio({ name: "a.mp3", size: 15 * 1024 * 1024 }).ok).toBe(true);
    const trop = controlerAudio({ name: "a.mp3", size: 15 * 1024 * 1024 + 1 });
    expect(trop.ok).toBe(false);
    if (!trop.ok) expect(trop.message).toContain("15 Mo");
  });
});

describe("création d'une transcription", () => {
  const saisie = {
    langue: "fr",
    consenti: true,
    reference: "accord oral enregistré le 12/03/2027",
    dureeMinutes: "",
  };

  it("exige le consentement DÉCLARÉ et sa référence, sans quoi rien n'est envoyé", () => {
    expect(validerTranscription(saisie)).toEqual({
      ok: true,
      charge: {
        langue: "fr",
        enregistrement_consenti: true,
        reference_consentement: "accord oral enregistré le 12/03/2027",
      },
    });
    const sans = validerTranscription({ ...saisie, consenti: false, reference: "court" });
    expect(sans.ok).toBe(false);
    if (!sans.ok) expect(Object.keys(sans.erreurs).sort()).toEqual(["consenti", "reference"]);
  });

  it("convertit la durée annoncée en secondes, 1 à 30 minutes", () => {
    const ok = validerTranscription({ ...saisie, dureeMinutes: "12" });
    expect(ok.ok && ok.charge.duree_secondes).toBe(720);
    for (const m of ["0", "31", "abc", "1.5"]) {
      expect(validerTranscription({ ...saisie, dureeMinutes: m }).ok, m).toBe(false);
    }
  });

  it("refuse une langue hors liste", () => {
    expect(validerTranscription({ ...saisie, langue: "klingon" }).ok).toBe(false);
    expect(validerTranscription({ ...saisie, langue: "auto" }).ok).toBe(true);
  });
});

describe("correction et rejet", () => {
  it("la correction n'est ni vide ni au-delà de 200 000 caractères", () => {
    expect(validerCorrectionTexte("  ").ok).toBe(false);
    expect(validerCorrectionTexte("Bonjour")).toEqual({ ok: true, charge: { texte: "Bonjour" } });
    expect(validerCorrectionTexte("x".repeat(200_001)).ok).toBe(false);
  });

  it("le rejet exige un motif", () => {
    expect(validerRejetTranscription("").ok).toBe(false);
    expect(validerRejetTranscription(" illisible ")).toEqual({
      ok: true,
      charge: { motif: "illisible" },
    });
  });
});

describe("messages d'erreur", () => {
  const e = (code: string, statut = 409) => new ErreurApi(code, "message de l'API", statut);
  it("explique le plafond, l'audio refusé et la version périmée", () => {
    expect(messageErreurTranscription(e("PLAFOND_TRANSCRIPTION", 429))).toContain("plafond");
    expect(messageErreurTranscription(e("TYPE_FICHIER_REFUSE", 415))).toContain("test");
    expect(messageErreurTranscription(e("CONFLIT", 412))).toContain("Rechargez");
    expect(messageErreurTranscription(e("AUTRE"))).toBe("message de l'API");
  });
});
