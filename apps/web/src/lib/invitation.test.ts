import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  chargeInvitation,
  lireJetonFragment,
  messageErreurInvitation,
  validerInvitation,
} from "./invitation";

const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

describe("lireJetonFragment", () => {
  it("lit le jeton du fragment, avec ou sans dièse", () => {
    expect(lireJetonFragment(`#jeton=${JETON}`)).toBe(JETON);
    expect(lireJetonFragment(`jeton=${JETON}&x=1`)).toBe(JETON);
  });

  it("refuse un fragment absent, trop court ou mal formé", () => {
    expect(lireJetonFragment("")).toBeNull();
    expect(lireJetonFragment("#jeton=court")).toBeNull();
    expect(lireJetonFragment(`#autre=${JETON}`)).toBeNull();
    expect(lireJetonFragment(`#jeton=${JETON}<script>`)).toBeNull();
    expect(lireJetonFragment(`#jeton=${"a".repeat(201)}`)).toBeNull();
  });
});

describe("validerInvitation", () => {
  const ok = {
    nom: " Awa Koné ",
    motDePasse: "une phrase longue",
    confirmation: "une phrase longue",
  };

  it("accepte une saisie complète et construit la charge utile", () => {
    expect(validerInvitation(ok)).toEqual({});
    expect(chargeInvitation(JETON, ok)).toEqual({
      jeton: JETON,
      nom: "Awa Koné",
      mot_de_passe: "une phrase longue",
    });
  });

  it("exige un mot de passe d'au moins 12 caractères en indiquant la longueur", () => {
    const e = validerInvitation({ ...ok, motDePasse: "court", confirmation: "court" });
    expect(e.motDePasse).toBe(
      "Le mot de passe doit contenir au moins 12 caractères (actuellement 5).",
    );
    expect(e.confirmation).toBeUndefined();
  });

  it("signale un nom vide et une confirmation différente", () => {
    const e = validerInvitation({ ...ok, nom: "  ", confirmation: "autre chose 123" });
    expect(e.nom).toBe("Saisissez votre nom complet.");
    expect(e.confirmation).toBe("Les deux mots de passe ne sont pas identiques.");
  });
});

describe("messageErreurInvitation", () => {
  it("explique un lien expiré et un e-mail déjà utilisé", () => {
    expect(messageErreurInvitation(new ErreurApi("INVITATION_INVALIDE", "x", 400))).toMatch(
      /expiré ou a déjà été utilisé/,
    );
    expect(messageErreurInvitation(new ErreurApi("CONFLIT", "x", 409))).toMatch(
      /compte existe déjà/,
    );
    expect(messageErreurInvitation(new Error("x"))).toMatch(/erreur inattendue/);
  });
});
