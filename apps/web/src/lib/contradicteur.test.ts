import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminRevues,
  contreAnalysePossible,
  estRevueDejaActive,
  MESSAGES_ERREURS_REVUE,
  messageErreurRevue,
  normaliserListeRevues,
  normaliserRevue,
  resumeRevue,
} from "./contradicteur";

const brouillon = { statut: "terminee", statut_contenu: "brouillon_ia", entite: null };

describe("messageErreurRevue", () => {
  it("traduit chaque code 409 en français", () => {
    for (const code of Object.keys(MESSAGES_ERREURS_REVUE)) {
      const m = messageErreurRevue(new ErreurApi(code, "msg", 409));
      expect(m).toBe(MESSAGES_ERREURS_REVUE[code]);
      expect(m).not.toBe("msg");
    }
  });
  it("nomme l'autonomie, l'agent désactivé et le plafond", () => {
    expect(messageErreurRevue(new ErreurApi("AUTONOMIE_N0", "x", 409))).toMatch(/autonomie/);
    expect(messageErreurRevue(new ErreurApi("AGENT_INACTIF", "x", 409))).toMatch(/désactivé/);
    expect(messageErreurRevue(new ErreurApi("PLAFOND_MISSION_ATTEINT", "x", 409))).toMatch(
      /plafond/,
    );
  });
  it("traite un 502 comme revue non produite et retombe sur le message générique", () => {
    expect(messageErreurRevue(new ErreurApi("AUTRE", "x", 502))).toBe(
      MESSAGES_ERREURS_REVUE.REVUE_NON_PRODUITE,
    );
    expect(messageErreurRevue(new Error("boum"))).not.toBe("boum");
    expect(messageErreurRevue(new ErreurApi("INCONNU", "Message API", 404))).toBe("Message API");
  });
  it("reconnaît la revue déjà active", () => {
    expect(estRevueDejaActive(new ErreurApi("REVUE_DEJA_ACTIVE", "x", 409))).toBe(true);
    expect(estRevueDejaActive(new ErreurApi("AUTONOMIE_N0", "x", 409))).toBe(false);
    expect(estRevueDejaActive(null)).toBe(false);
  });
});

describe("normalisation défensive", () => {
  it("rejette ce qui n'est pas une revue", () => {
    expect(normaliserRevue(null)).toBeNull();
    expect(normaliserRevue({})).toBeNull();
    expect(normaliserRevue([])).toBeNull();
  });
  it("remplace les champs absents ou mal typés par des valeurs vides", () => {
    const r = normaliserRevue({
      id: "r1",
      contenu: { contre_preuves: ["a", 3, "  ", " b "], incoherences: "x" },
      nombres_non_verifies: [12, "15 %"],
      version: "2",
    });
    expect(r?.contenu).toEqual({
      contre_preuves: ["a", "b"],
      incoherences: [],
      affirmations_non_sourcees: [],
    });
    expect(r?.nombres_non_verifies).toEqual(["15 %"]);
    expect(r?.version).toBeNull();
    expect(normaliserRevue({ id: "r2" })?.contenu.incoherences).toEqual([]);
  });
  it("normalise la liste et l'état « revue active »", () => {
    expect(normaliserListeRevues(undefined)).toEqual({ revue_active: false, elements: [] });
    const l = normaliserListeRevues({ revue_active: true, elements: [{ id: "a" }, 5, { id: 1 }] });
    expect(l.revue_active).toBe(true);
    expect(l.elements.map((e) => e.id)).toEqual(["a"]);
    expect(normaliserListeRevues({ revue_active: "oui" }).revue_active).toBe(false);
  });
});

describe("présentation et disponibilité", () => {
  it("résume le nombre d'objections", () => {
    const vide = { contre_preuves: [], incoherences: [], affirmations_non_sourcees: [] };
    expect(resumeRevue(vide)).toBe("Aucune objection relevée");
    expect(resumeRevue({ ...vide, incoherences: ["a"] })).toBe("1 objection à examiner");
    expect(resumeRevue({ ...vide, incoherences: ["a", "b"] })).toBe("2 objections à examiner");
  });
  it("construit le chemin de la liste", () => {
    expect(cheminRevues("abc")).toBe(
      "/api/agents/revues-contradictoires?generation_id=abc&limite=10",
    );
  });
  it("propose la contre-analyse sur un brouillon IA ou modifié seulement", () => {
    expect(contreAnalysePossible(brouillon)).toBe(true);
    expect(contreAnalysePossible({ ...brouillon, statut_contenu: "modifie" })).toBe(true);
    expect(contreAnalysePossible({ ...brouillon, statut_contenu: "valide" })).toBe(false);
    expect(contreAnalysePossible({ ...brouillon, statut: "en_cours" })).toBe(false);
    expect(contreAnalysePossible({ ...brouillon, entite: { type: "revue_contradictoire" } })).toBe(
      false,
    );
  });
  it("masque le bouton sans le droit ia.utiliser", () => {
    expect(contreAnalysePossible(brouillon, { id: "u", roles: ["associe"] })).toBe(true);
    expect(contreAnalysePossible(brouillon, { id: "u", roles: [] })).toBe(false);
  });
});
