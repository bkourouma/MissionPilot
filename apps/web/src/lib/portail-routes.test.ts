import { describe, expect, it } from "vitest";
import {
  destinationApresConnexion,
  estCheminPortail,
  PAGES_PUBLIQUES_PORTAIL,
} from "./portail-routes";

describe("estCheminPortail", () => {
  it("reconnaît le portail et ses pages, avec requête ou fragment", () => {
    for (const c of [
      "/portail",
      "/portail/",
      "/portail/missions/x",
      "/portail?curseur=a",
      "/portail#a",
    ]) {
      expect(estCheminPortail(c), c).toBe(true);
    }
  });

  it("ne confond pas un préfixe voisin ni une page du cabinet", () => {
    for (const c of ["/portails", "/portail-x", "/", "/missions", "/connexion?suite=%2Fportail"]) {
      expect(estCheminPortail(c), c).toBe(false);
    }
  });
});

describe("destinationApresConnexion", () => {
  it("utilisateur du portail : page demandée du portail, sinon l'accueil du portail", () => {
    expect(destinationApresConnexion("/portail/factures?curseur=a", true)).toBe(
      "/portail/factures?curseur=a",
    );
    expect(destinationApresConnexion("/", true)).toBe("/portail");
    expect(destinationApresConnexion("/missions/123", true)).toBe("/portail");
    // Jamais renvoyé vers l'acceptation d'une invitation après connexion.
    expect(destinationApresConnexion("/portail/invitation", true)).toBe("/portail");
    expect(destinationApresConnexion("/portail/invitation?x=1", true)).toBe("/portail");
  });

  it("utilisateur du cabinet : page demandée, jamais une page du portail", () => {
    expect(destinationApresConnexion("/missions/123", false)).toBe("/missions/123");
    expect(destinationApresConnexion("/portail", false)).toBe("/");
    expect(destinationApresConnexion("/portail/missions", false)).toBe("/");
  });

  it("seule l'invitation du portail est publique", () => {
    expect(PAGES_PUBLIQUES_PORTAIL).toEqual(["/portail/invitation"]);
  });
});
