import { describe, expect, it } from "vitest";
import {
  aideContenuIa,
  libelleContenuIa,
  ligneHistoriqueIa,
  SAISIE_GENERATION_IA_VIDE,
  validerGenerationIa,
  type SaisieGenerationIa,
} from "./questionnaires-ia";

const saisie = (modif: Partial<SaisieGenerationIa> = {}): SaisieGenerationIa => ({
  ...SAISIE_GENERATION_IA_VIDE,
  code: "diag_production",
  service: "Diagnostic de compétitivité",
  population: "Dirigeants de PME",
  theme: "Pilotage de la production",
  ...modif,
});

describe("saisie du besoin", () => {
  it("charge valide : champs nettoyés, nombre entier, termes sensibles dédoublonnés", () => {
    const r = validerGenerationIa(
      saisie({
        code: " diag_production ",
        theme: "  Pilotage  ",
        nombre_questions: "15",
        termes_sensibles: "Kora Industrie;\nAwa Koné, Kora Industrie",
      }),
    );
    expect(r).toEqual({
      ok: true,
      charge: {
        code: "diag_production",
        service: "Diagnostic de compétitivité",
        population: "Dirigeants de PME",
        theme: "Pilotage",
        nombre_questions: 15,
        termes_sensibles: ["Kora Industrie", "Awa Koné"],
      },
    });
  });

  it("refuse les champs vides, le code invalide et un nombre hors bornes", () => {
    const r = validerGenerationIa(
      saisie({ code: "Code Invalide", service: " ", theme: "", nombre_questions: "3" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "code",
        "nombre_questions",
        "service",
        "theme",
      ]);
      expect(r.erreurs.service).toBe("Le service est obligatoire.");
    }
    for (const n of ["", "abc", "12,5", "31"]) {
      expect(validerGenerationIa(saisie({ nombre_questions: n })).ok, n).toBe(false);
    }
    expect(validerGenerationIa(saisie({ theme: "x".repeat(301) })).ok).toBe(false);
    expect(validerGenerationIa(saisie({ termes_sensibles: "y".repeat(201) })).ok).toBe(false);
  });
});

describe("statut du contenu et historique", () => {
  it("libellés des trois statuts, repli neutre pour une valeur inconnue", () => {
    expect(libelleContenuIa("brouillon_ia")).toEqual({
      libelle: "Brouillon IA, à relire",
      tonalite: "attention",
    });
    expect(libelleContenuIa("modifie").libelle).toBe("Modifié, à valider");
    expect(libelleContenuIa("valide").tonalite).toBe("succes");
    expect(libelleContenuIa("autre").tonalite).toBe("neutre");
  });

  it("lignes d'historique et aide : l'IA propose, l'expert dispose", () => {
    const rang = {
      rang: 2,
      statut_contenu: "modifie" as const,
      auteur: { id: "u", nom: "Awa Koné" },
      chiffres_non_verifies: false,
      cree_le: "2026-10-08T09:00:00.000Z",
    };
    expect(ligneHistoriqueIa(rang)).toMatch(/^Modifié par Awa Koné, le /);
    expect(ligneHistoriqueIa({ ...rang, statut_contenu: "valide" })).toMatch(/^Validé par /);
    expect(aideContenuIa({ statut_contenu: "brouillon_ia", gabarit: false })).toMatch(
      /proposé par l'IA.*n'est pas envoyable/,
    );
    expect(aideContenuIa({ statut_contenu: "modifie", gabarit: true })).toMatch(
      /gabarit déterministe/,
    );
    expect(aideContenuIa({ statut_contenu: "valide", gabarit: false })).toMatch(/figé/);
  });
});
