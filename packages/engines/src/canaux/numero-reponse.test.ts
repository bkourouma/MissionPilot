import { describe, expect, it } from "vitest";
import {
  analyserReponse,
  ErreurCanaux,
  estNumeroDeTest,
  masquerNumero,
  normaliserNumero,
  normaliserTexteCanal,
} from "./index";

describe("normaliserNumero", () => {
  it.each(["+225 00 00 00 00 12", "00225 0000000012", "(+225) 0000-000-012", "+225.0000.000.012"])(
    "normalise %s",
    (saisie) => {
      expect(normaliserNumero(saisie)).toBe("+2250000000012");
    },
  );

  it.each([
    "0000000012", // national, sans pays
    "+0225123456789", // l'indicatif ne commence pas par 0
    "+22500", // 5 chiffres
    "+1234567890123456", // 16 chiffres
    "abc",
    "",
  ])("refuse %s", (saisie) => {
    expect(() => normaliserNumero(saisie)).toThrowError(ErreurCanaux);
    try {
      normaliserNumero(saisie);
    } catch (e) {
      expect((e as ErreurCanaux).code).toBe("NUMERO_INVALIDE");
      // Le message ne cite jamais la saisie.
      if (saisie !== "") expect((e as Error).message).not.toContain(saisie);
    }
  });

  it("refuse une saisie trop longue ou qui n'est pas une chaîne", () => {
    expect(() => normaliserNumero("+".padEnd(80, "1"))).toThrowError(ErreurCanaux);
    expect(() => normaliserNumero(undefined as unknown as string)).toThrowError(ErreurCanaux);
  });
});

describe("masquerNumero et estNumeroDeTest", () => {
  it("masque : quatre premiers caractères, points de suspension, deux derniers", () => {
    expect(masquerNumero("+2250000000012")).toBe("+225…12");
    expect(() => masquerNumero("0612345678")).toThrowError(ErreurCanaux);
  });

  it("plage de test réservée aux fournisseurs simulés", () => {
    expect(estNumeroDeTest("+2250000000012")).toBe(true);
    expect(estNumeroDeTest("+2250000000099")).toBe(true);
    expect(estNumeroDeTest("+33612345678")).toBe(false);
    expect(estNumeroDeTest("+2250100000012")).toBe(false);
  });
});

describe("analyserReponse", () => {
  it.each(["STOP", " stop. ", "Arrêt", "ARRÊTER", "stop svp", "Désabonner", "unsubscribe"])(
    "%s est un STOP",
    (texte) => {
      expect(analyserReponse(texte)).toEqual({ type: "stop" });
    },
  );

  it.each(["Arrête", "ARRÊTE !", "Arrêtez", "arretez svp", "Stoppez", "stoper", "Désinscris"])(
    "forme conjuguée ou accentuée : %s est un STOP",
    (texte) => {
      expect(analyserReponse(texte)).toEqual({ type: "stop" });
    },
  );

  it("STOP l'emporte sur toute autre commande", () => {
    expect(analyserReponse("stop non")).toEqual({ type: "stop" });
    expect(analyserReponse("stop oui")).toEqual({ type: "stop" });
  });

  it("un mot de la liste ailleurs qu'en tête n'est pas un STOP", () => {
    expect(analyserReponse("bus stop demain")).toEqual({ type: "autre" });
    expect(analyserReponse("stop un deux trois")).toEqual({ type: "autre" });
  });

  it.each(["oui", "Ok", "d'accord", "D’accord", "confirme"])("%s est un OUI sans valeur", (t) => {
    expect(analyserReponse(t)).toEqual({ type: "oui" });
  });

  it("OUI avec une valeur facultative", () => {
    expect(analyserReponse("OUI 125000")).toEqual({ type: "oui", valeur: "125000" });
    expect(analyserReponse("oui 125 000")).toEqual({ type: "oui", valeur: "125 000" });
  });

  it("un OUI suivi d'un long texte n'est pas une commande", () => {
    expect(analyserReponse("oui je pense que nous verrons cela demain matin")).toEqual({
      type: "autre",
    });
  });

  it.each(["non", "Annuler"])("%s est un NON", (t) => {
    expect(analyserReponse(t)).toEqual({ type: "non" });
  });

  it("le reste est « autre », y compris vide, ponctuation seule ou trop long", () => {
    expect(analyserReponse("bonjour")).toEqual({ type: "autre" });
    expect(analyserReponse("annuler la mission demain matin")).toEqual({ type: "autre" });
    expect(analyserReponse("")).toEqual({ type: "autre" });
    expect(analyserReponse("   ?!  ")).toEqual({ type: "autre" });
    expect(analyserReponse("a".repeat(1001))).toEqual({ type: "autre" });
    // La limite est de 1 000 caractères inclus.
    expect(analyserReponse(`stop${" ".repeat(996)}`)).toEqual({ type: "stop" });
    expect(analyserReponse(undefined as unknown as string)).toEqual({ type: "autre" });
  });

  it("la normalisation retire accents, casse et apostrophes typographiques", () => {
    expect(normaliserTexteCanal("  ÉTÉ d’Accord ")).toBe("  ete d'accord ");
  });
});
