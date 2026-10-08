import { describe, expect, it } from "vitest";
import { DELAI_RETOUR, retourModifiable, validerRetourExperience } from "./bilan";

const bilan = { retour_modifiable_jusqu_au: "2027-04-30T10:00:00.000Z" };
const avant = new Date("2027-04-15T10:00:00Z");
const apres = new Date("2027-05-01T10:00:00Z");

describe("retour d'expérience", () => {
  it("est modifiable par le directeur de la mission pendant le délai", () => {
    expect(
      retourModifiable(bilan, {
        utilisateurId: "dir",
        roles: ["directeur_mission"],
        directeurId: "dir",
        maintenant: avant,
      }),
    ).toEqual({ modifiable: true, raison: null });
  });

  it("est modifiable par un associé, pas par un autre directeur", () => {
    const c = { directeurId: "dir", maintenant: avant };
    expect(
      retourModifiable(bilan, { ...c, utilisateurId: "a", roles: ["associe"] }).modifiable,
    ).toBe(true);
    const autre = retourModifiable(bilan, {
      ...c,
      utilisateurId: "autre",
      roles: ["directeur_mission"],
    });
    expect(autre.modifiable).toBe(false);
    expect(autre.raison).toMatch(/directeur de la mission/);
  });

  it("passe en lecture seule après la date limite, même pour un associé", () => {
    const r = retourModifiable(bilan, {
      utilisateurId: "a",
      roles: ["associe"],
      directeurId: "dir",
      maintenant: apres,
    });
    expect(r.modifiable).toBe(false);
    expect(r.raison).toMatch(/30 jours/);
    expect(DELAI_RETOUR).toBe(30);
  });

  it("valide le texte", () => {
    expect(validerRetourExperience("  ").ok).toBe(false);
    expect(validerRetourExperience("x".repeat(10_001)).ok).toBe(false);
    expect(validerRetourExperience(" Bien. ")).toEqual({ ok: true, charge: { texte: "Bien." } });
  });
});
