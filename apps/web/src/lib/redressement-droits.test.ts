import { describe, expect, it } from "vitest";
import type { Role } from "@missionpilot/shared";
import { TEXTE_CAUSES_AUTEUR_NE_VALIDE_PAS, validationCauses } from "./redressement-droits";

const rang = (auteurId: string) => ({
  rang: 1,
  statut_contenu: "brouillon_ia" as const,
  auteur: { id: auteurId, nom: "X" },
  chiffres_non_verifies: false,
  chiffres_acquittes: false,
  cree_le: "2026-10-22T08:00:00Z",
});
const version = (auteurs: string[], statut: "brouillon" | "valide" = "brouillon") => ({
  statut,
  cree_par: { id: auteurs[0] ?? "u0", nom: "X" },
  historique: auteurs.map(rang),
});
const consultant: Role[] = ["consultant"];

describe("validationCauses (RED-04 : un consultant autre que l'auteur)", () => {
  it("propose Valider à un consultant qui n'est pas l'auteur (pas seulement au directeur)", () => {
    expect(validationCauses(version(["auteur"]), true, consultant, "autre")).toEqual({
      proposee: true,
      autorisee: true,
      raison: null,
    });
  });
  it("désactive Valider avec une raison pour l'auteur, y compris d'un simple rang", () => {
    const r = validationCauses(version(["auteur", "autre"]), true, consultant, "autre");
    expect(r).toEqual({
      proposee: true,
      autorisee: false,
      raison: TEXTE_CAUSES_AUTEUR_NE_VALIDE_PAS,
    });
  });
  it("dispense l'associé, même auteur", () => {
    const r = validationCauses(version(["moi"]), true, ["associe"], "moi");
    expect(r.autorisee).toBe(true);
  });
  it("ne propose rien sans droit d'écriture ou si la version est validée", () => {
    expect(validationCauses(version(["a"]), false, consultant, "b").proposee).toBe(false);
    expect(validationCauses(version(["a"], "valide"), true, consultant, "b").proposee).toBe(false);
  });
});
