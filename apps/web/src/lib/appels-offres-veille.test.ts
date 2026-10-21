import { describe, expect, it } from "vitest";
import { VEILLE_IMPORT_TEXTE_MAX } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  cheminResultatsVeille,
  hrefVeille,
  libelleStatutVeille,
  lireFiltresVeille,
  messageVeille,
  texteBilanVeille,
  texteErreursImport,
  tonaliteScoreVeille,
  tonaliteStatutVeille,
  verifierFichierImport,
} from "./appels-offres-veille";

describe("libellés et tonalités", () => {
  it("statuts en français", () => {
    expect(libelleStatutVeille("nouveau")).toBe("Nouveau");
    expect(libelleStatutVeille("ecarte")).toBe("Écarté");
    expect(libelleStatutVeille("fiche_creee")).toBe("Fiche créée");
    expect(tonaliteStatutVeille("fiche_creee")).toBe("succes");
    expect(tonaliteStatutVeille("retenu")).toBe("attention");
    expect(tonaliteStatutVeille("ecarte")).toBe("neutre");
  });

  it("tonalité du score", () => {
    expect(tonaliteScoreVeille(75)).toBe("succes");
    expect(tonaliteScoreVeille(40)).toBe("attention");
    expect(tonaliteScoreVeille(5)).toBe("neutre");
  });

  it("bilan de collecte ou d'import", () => {
    expect(texteBilanVeille({ lus: 8, nouveaux: 6, doublons: 2, plafond: 0 })).toBe(
      "8 avis lu(s) ; 6 nouveau(x) ; 2 déjà connu(s).",
    );
    const t = texteBilanVeille({
      lus: 3,
      nouveaux: 1,
      doublons: 0,
      plafond: 2,
      erreurs: [{ ligne: 4, message: "x" }],
    });
    expect(t).toContain("2 refusé(s) : plafond de résultats atteint");
    expect(t).toContain("1 ligne(s) en erreur");
  });

  it("erreurs d'import : 10 lignes au plus", () => {
    const e = Array.from({ length: 15 }, (_, i) => ({
      ligne: i + 2,
      message: "Titre obligatoire.",
    }));
    const t = texteErreursImport(e);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe("Ligne 2 : Titre obligatoire.");
  });
});

describe("filtres et chemins", () => {
  it("lecture défensive des paramètres d'URL", () => {
    expect(lireFiltresVeille({})).toEqual({ statut: "", q: "", score_min: "", page: 1 });
    expect(
      lireFiltresVeille({ statut: "retenu", q: " audit ", score_min: "40", page: "3" }),
    ).toEqual({ statut: "retenu", q: "audit", score_min: "40", page: 3 });
    expect(
      lireFiltresVeille({ statut: "x", q: "a".repeat(300), score_min: "101", page: "0" }),
    ).toEqual({ statut: "", q: "a".repeat(100), score_min: "", page: 1 });
    expect(lireFiltresVeille({ statut: ["nouveau", "retenu"], page: "abc" }).statut).toBe(
      "nouveau",
    );
  });

  it("chemin de l'API et lien de la page", () => {
    const f = lireFiltresVeille({ statut: "nouveau", q: "santé", score_min: "20", page: "2" });
    expect(cheminResultatsVeille(f)).toBe(
      "/api/appels-offres/veille/resultats?limite=50&decalage=50&statut=nouveau&q=sant%C3%A9&score_min=20",
    );
    expect(hrefVeille()).toBe("/appels-offres/veille");
    expect(hrefVeille(f)).toBe(
      "/appels-offres/veille?statut=nouveau&q=sant%C3%A9&score_min=20&page=2",
    );
  });
});

describe("fichier à importer", () => {
  it("accepte .csv et .json dans la limite de 1 Mo", () => {
    expect(verifierFichierImport({ name: "Avis.CSV", size: 10 })).toEqual({
      ok: true,
      format: "csv",
    });
    expect(verifierFichierImport({ name: "avis.json", size: VEILLE_IMPORT_TEXTE_MAX })).toEqual({
      ok: true,
      format: "json",
    });
  });

  it("refuse autre extension, fichier vide ou trop gros", () => {
    expect(verifierFichierImport({ name: "avis.xlsx", size: 10 })).toMatchObject({ ok: false });
    expect(verifierFichierImport({ name: "avis.csv", size: 0 })).toMatchObject({
      ok: false,
      message: "Le fichier est vide.",
    });
    expect(
      verifierFichierImport({ name: "avis.csv", size: VEILLE_IMPORT_TEXTE_MAX + 1 }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("1 Mo"),
    });
  });
});

describe("messages d'erreur", () => {
  it("texte de l'API pour les conflits de la veille", () => {
    expect(messageVeille(new ErreurApi("AO_VEILLE_PLAFOND", "Plafond atteint.", 409))).toBe(
      "Plafond atteint.",
    );
    expect(messageVeille(new ErreurApi("AO_REFERENCE_EXISTANTE", "Déjà une fiche.", 409))).toBe(
      "Déjà une fiche.",
    );
    expect(messageVeille(new ErreurApi("CONFLIT", "Aucune source activée.", 409))).toBe(
      "Aucune source activée.",
    );
    expect(messageVeille(new ErreurApi("INTROUVABLE", "x", 404))).toBe(
      "Ce résultat de veille n'existe pas ou plus.",
    );
    expect(typeof messageVeille(new Error("x"))).toBe("string");
  });
});
