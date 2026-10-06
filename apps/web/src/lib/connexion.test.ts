import { describe, expect, it } from "vitest";
import { cheminDeRetour, PAGES_PUBLIQUES, validerConnexion } from "./connexion";

describe("cheminDeRetour", () => {
  it("garde un chemin interne", () => {
    expect(cheminDeRetour("/missions/42?onglet=budget")).toBe("/missions/42?onglet=budget");
    expect(cheminDeRetour(["/temps", "/autre"])).toBe("/temps");
  });

  it("refuse toute redirection hors de l'application", () => {
    for (const suite of [
      "https://exemple.com",
      "//exemple.com",
      "/\\exemple.com",
      "javascript:alert(1)",
      "missions",
      "/\tevil",
      "/\nevil",
    ]) {
      expect(cheminDeRetour(suite)).toBe("/");
    }
  });

  it("revient à l'accueil sans valeur ou vers /connexion (pas de boucle)", () => {
    expect(cheminDeRetour(undefined)).toBe("/");
    expect(cheminDeRetour(null)).toBe("/");
    expect(cheminDeRetour("")).toBe("/");
    expect(cheminDeRetour([])).toBe("/");
    expect(cheminDeRetour("/connexion")).toBe("/");
    expect(cheminDeRetour("/connexion?suite=/x")).toBe("/");
  });
});

describe("validerConnexion", () => {
  it("accepte une saisie complète", () => {
    expect(validerConnexion({ email: " awa@cabinet.ci ", motDePasse: "secret" })).toEqual({});
  });

  it("exige l'e-mail et le mot de passe, avec des messages en français", () => {
    expect(validerConnexion({ email: "", motDePasse: "" })).toEqual({
      email: "Saisissez votre adresse e-mail.",
      motDePasse: "Saisissez votre mot de passe.",
    });
  });

  it("signale un e-mail mal formé avec un exemple", () => {
    expect(validerConnexion({ email: "awa@cabinet", motDePasse: "x" }).email).toMatch(
      /^Adresse e-mail invalide/,
    );
  });

  it("refuse un mot de passe trop long (limite de l'API)", () => {
    expect(validerConnexion({ email: "a@b.ci", motDePasse: "x".repeat(201) }).motDePasse).toBe(
      "Le mot de passe ne doit pas dépasser 200 caractères.",
    );
  });
});

describe("PAGES_PUBLIQUES", () => {
  it("ne laisse passer sans session que la connexion et l'acceptation d'invitation", () => {
    expect([...PAGES_PUBLIQUES].sort()).toEqual(["/connexion", "/invitation"]);
  });
});
