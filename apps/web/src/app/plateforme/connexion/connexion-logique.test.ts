import { describe, expect, it } from "vitest";
import { ErreurApi, MESSAGE_ORIGINE_REFUSEE } from "../../../lib/api";
import { messageConnexion, validerConnexionPlateforme } from "./connexion-logique";

describe("validerConnexionPlateforme", () => {
  it("exige un e-mail valide et un mot de passe", () => {
    expect(validerConnexionPlateforme({ email: "", motDePasse: "" })).toEqual({
      email: "Saisissez votre adresse e-mail.",
      motDePasse: "Saisissez votre mot de passe.",
    });
    expect(validerConnexionPlateforme({ email: "pas-un-mail", motDePasse: "x" }).email).toMatch(
      /invalide/,
    );
  });

  it("accepte des identifiants bien formés (e-mail rogné)", () => {
    expect(validerConnexionPlateforme({ email: " admin@exemple.com ", motDePasse: "x" })).toEqual(
      {},
    );
  });
});

describe("messageConnexion", () => {
  it("401 : identifiants incorrects, quel que soit le code", () => {
    expect(messageConnexion(new ErreurApi("NON_AUTHENTIFIE", "Non authentifié", 401))).toBe(
      "E-mail ou mot de passe incorrect.",
    );
    expect(messageConnexion(new ErreurApi("IDENTIFIANTS_INVALIDES", "x", 401))).toBe(
      "E-mail ou mot de passe incorrect.",
    );
  });

  it("403 ORIGINE_REFUSEE : message d'origine", () => {
    expect(messageConnexion(new ErreurApi("ORIGINE_REFUSEE", "x", 403))).toBe(
      MESSAGE_ORIGINE_REFUSEE,
    );
  });

  it("429 : trop de tentatives", () => {
    expect(messageConnexion(new ErreurApi("TROP_DE_TENTATIVES", "x", 429))).toMatch(
      /Trop de tentatives/,
    );
  });
});
