import { describe, expect, it } from "vitest";
import { nomPersonne, optionsPersonnes, personnesDepuisCollaborateurs } from "./personnes";

describe("personnes désignables", () => {
  const liste = [
    { utilisateur_id: "u2", nom: "Zoé Koné", grade_libelle: "Senior", actif: true },
    { utilisateur_id: null, nom: "Externe sans compte", actif: true },
    { utilisateur_id: "u1", nom: "Awa Diallo", grade_libelle: null, actif: true },
    { utilisateur_id: "u3", nom: "Ancien", actif: false },
    { utilisateur_id: "u1", nom: "Doublon", actif: true },
  ];

  it("garde les comptes actifs, triés, sans doublon", () => {
    expect(personnesDepuisCollaborateurs(liste).map((p) => p.utilisateur_id)).toEqual(["u1", "u2"]);
  });

  it("affiche le grade dans les options et un nom neutre si inconnu", () => {
    const p = personnesDepuisCollaborateurs(liste);
    expect(optionsPersonnes(p)[1]).toEqual({ valeur: "u2", libelle: "Zoé Koné (Senior)" });
    expect(nomPersonne("u1", p)).toBe("Awa Diallo");
    expect(nomPersonne(null, p)).toBe("—");
    expect(nomPersonne("u9", p)).toBe("Utilisateur du cabinet");
  });
});
