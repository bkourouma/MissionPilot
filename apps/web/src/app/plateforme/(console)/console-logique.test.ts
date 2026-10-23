import { describe, expect, it } from "vitest";
import {
  destinationApresDeconnexion,
  libelleComptePremierAssocie,
  libelleUtilisateursCabinet,
  texteActionEtat,
} from "./console-logique";

describe("destinationApresDeconnexion", () => {
  it("renvoie un compte démo vers la connexion des cabinets, les autres vers la console", () => {
    expect(destinationApresDeconnexion(true)).toBe("/connexion");
    expect(destinationApresDeconnexion(false)).toBe("/plateforme/connexion");
  });
});

describe("libelleUtilisateursCabinet", () => {
  it("décrit le total et les actifs", () => {
    expect(libelleUtilisateursCabinet({ nbUtilisateurs: 5, nbUtilisateursActifs: 4 })).toBe(
      "5 utilisateurs, 4 actifs",
    );
    expect(libelleUtilisateursCabinet({ nbUtilisateurs: 1, nbUtilisateursActifs: 1 })).toBe(
      "1 utilisateur, 1 actif",
    );
    expect(libelleUtilisateursCabinet({ nbUtilisateurs: 2, nbUtilisateursActifs: 0 })).toBe(
      "2 utilisateurs, aucun actif",
    );
    expect(libelleUtilisateursCabinet({ nbUtilisateurs: 0, nbUtilisateursActifs: 0 })).toBe(
      "Aucun utilisateur",
    );
  });
});

describe("texteActionEtat", () => {
  it("désactivation d'un cabinet actif : conséquences et état visé", () => {
    const t = texteActionEtat({ nom: "Cabinet Akwaba", actif: true });
    expect(t.bouton).toBe("Désactiver");
    expect(t.nomAccessible).toBe("Désactiver le cabinet Cabinet Akwaba");
    expect(t.consequences).toContain("ne pourront plus se connecter");
    expect(t.consequences).toContain("réactiver");
    expect(t.actif).toBe(false);
  });

  it("activation d'un cabinet désactivé", () => {
    const t = texteActionEtat({ nom: "Cabinet Akwaba", actif: false });
    expect(t.bouton).toBe("Activer");
    expect(t.nomAccessible).toBe("Activer le cabinet Cabinet Akwaba");
    expect(t.actif).toBe(true);
    expect(t.succes).toBe("Le cabinet Cabinet Akwaba est réactivé.");
  });
});

describe("libelleComptePremierAssocie", () => {
  it("nomme le cabinet, l'associé et son e-mail", () => {
    expect(libelleComptePremierAssocie("Akwaba", { nom: "Awa Koné", email: "awa@akwaba.ci" })).toBe(
      "Premier associé de Akwaba : Awa Koné (awa@akwaba.ci)",
    );
  });
});
