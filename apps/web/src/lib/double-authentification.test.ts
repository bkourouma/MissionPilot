import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  avecReconfirmation,
  chargeConnexion2fa,
  confirmationDemandee,
  messageReconfirmation,
  SAISIE_CONFIRMATION_VIDE,
  validerReconfirmation,
  ETAT_INITIAL,
  grouperSecret,
  lireReponseIdentifiants,
  MESSAGE_CODE_INVALIDE,
  MESSAGE_DEFI_EXPIRE,
  MESSAGE_SECOURS_INVALIDE,
  MESSAGE_TROP_DE_TENTATIVES,
  messageErreurGestion,
  normaliserCodeSecours,
  normaliserCodeTotp,
  peutReinitialiserTfa,
  rolesPolitique,
  texteCodesSecours,
  transitionConnexion,
  validerConfirmation,
  validerFacteur,
  validerMotDePasse,
  type EtatConnexion,
} from "./double-authentification";

const DEFI = "d".repeat(43);
const enCode: EtatConnexion = { etape: "code", defi: DEFI, facteur: "totp", message: null };

describe("lireReponseIdentifiants", () => {
  it("reconnaît la connexion directe et le défi", () => {
    expect(lireReponseIdentifiants({ ok: true, etape: "connecte" })).toEqual({
      etape: "connecte",
    });
    expect(lireReponseIdentifiants({ ok: false, etape: "2fa_requise", defi: DEFI })).toEqual({
      etape: "2fa",
      defi: DEFI,
    });
  });

  it("refuse une réponse mal formée ou un défi hors bornes", () => {
    expect(lireReponseIdentifiants(undefined)).toBeNull();
    expect(lireReponseIdentifiants({ ok: false, etape: "2fa_requise" })).toBeNull();
    expect(lireReponseIdentifiants({ ok: false, etape: "2fa_requise", defi: "court" })).toBeNull();
    expect(lireReponseIdentifiants({ ok: true, etape: "autre" })).toBeNull();
  });
});

describe("transitionConnexion", () => {
  it("passe au code quand l'API demande la 2FA, et garde le défi en mémoire", () => {
    const e = transitionConnexion(ETAT_INITIAL, {
      type: "reponse_identifiants",
      corps: { ok: false, etape: "2fa_requise", defi: DEFI },
    });
    expect(e).toEqual(enCode);
  });

  it("connecte directement sans 2FA", () => {
    expect(
      transitionConnexion(ETAT_INITIAL, {
        type: "reponse_identifiants",
        corps: { ok: true, etape: "connecte" },
      }),
    ).toEqual({ etape: "connecte" });
  });

  it("reste sur les identifiants avec un message si la réponse est inattendue", () => {
    const e = transitionConnexion(ETAT_INITIAL, { type: "reponse_identifiants", corps: {} });
    expect(e.etape).toBe("identifiants");
  });

  it("connecte après un code accepté", () => {
    expect(transitionConnexion(enCode, { type: "reponse_code" })).toEqual({ etape: "connecte" });
    expect(transitionConnexion(ETAT_INITIAL, { type: "reponse_code" })).toEqual(ETAT_INITIAL);
  });

  it("revient au formulaire et oublie le défi s'il est expiré ou consommé", () => {
    const e = transitionConnexion(enCode, {
      type: "erreur_code",
      erreur: new ErreurApi("DEFI_2FA_INVALIDE", "x", 401),
    });
    expect(e).toEqual({ etape: "identifiants", message: MESSAGE_DEFI_EXPIRE });
    expect(JSON.stringify(e)).not.toContain(DEFI);
  });

  it("reste sur le code avec un message pour un code faux ou trop de tentatives", () => {
    const faux = transitionConnexion(enCode, {
      type: "erreur_code",
      erreur: new ErreurApi("CODE_2FA_INVALIDE", "x", 401),
    });
    expect(faux).toEqual({ ...enCode, message: MESSAGE_CODE_INVALIDE });
    const secours = transitionConnexion(
      { ...enCode, facteur: "secours" },
      { type: "erreur_code", erreur: new ErreurApi("CODE_2FA_INVALIDE", "x", 401) },
    );
    expect(secours.etape === "code" && secours.message).toBe(MESSAGE_SECOURS_INVALIDE);
    const limite = transitionConnexion(enCode, {
      type: "erreur_code",
      erreur: new ErreurApi("TROP_DE_TENTATIVES", "x", 429),
    });
    expect(limite.etape === "code" && limite.message).toBe(MESSAGE_TROP_DE_TENTATIVES);
  });

  it("bascule entre code de l'application et code de secours", () => {
    const s = transitionConnexion({ ...enCode, message: "m" }, { type: "changer_facteur" });
    expect(s).toEqual({ ...enCode, facteur: "secours", message: null });
    expect(transitionConnexion(s, { type: "changer_facteur" })).toEqual(enCode);
    expect(transitionConnexion(ETAT_INITIAL, { type: "changer_facteur" })).toEqual(ETAT_INITIAL);
  });

  it("abandonne vers l'état initial", () => {
    expect(transitionConnexion(enCode, { type: "abandonner" })).toEqual(ETAT_INITIAL);
  });

  it("ignore une erreur de code hors de l'étape du code", () => {
    expect(
      transitionConnexion(ETAT_INITIAL, { type: "erreur_code", erreur: new Error("x") }),
    ).toEqual(ETAT_INITIAL);
  });
});

describe("saisie des codes", () => {
  it("normalise un code TOTP", () => {
    expect(normaliserCodeTotp("123 456")).toBe("123456");
    expect(normaliserCodeTotp("12345")).toBeNull();
    expect(normaliserCodeTotp("12345a")).toBeNull();
  });

  it("normalise un code de secours", () => {
    expect(normaliserCodeSecours("ABCDE-12345")).toBe("abcde12345");
    expect(normaliserCodeSecours("abcde 1234")).toBeNull();
  });

  it("produit exactement un facteur", () => {
    expect(validerFacteur("123456", "totp")).toEqual({ ok: true, charge: { code: "123456" } });
    expect(validerFacteur("abcde-12345", "secours")).toEqual({
      ok: true,
      charge: { code_secours: "abcde12345" },
    });
    expect(validerFacteur("", "totp").ok).toBe(false);
    expect(validerFacteur("12", "totp").ok).toBe(false);
    expect(validerFacteur("", "secours").ok).toBe(false);
    expect(validerFacteur("abc", "secours").ok).toBe(false);
  });

  it("construit le corps du second temps", () => {
    expect(chargeConnexion2fa(DEFI, { code: "123456" })).toEqual({ defi: DEFI, code: "123456" });
    expect(chargeConnexion2fa(DEFI, { code_secours: "abcde12345" })).toEqual({
      defi: DEFI,
      code_secours: "abcde12345",
    });
  });

  it("valide la confirmation (mot de passe et second facteur)", () => {
    expect(validerConfirmation({ motDePasse: "", code: "", facteur: "totp" })).toEqual({
      ok: false,
      erreurs: {
        mot_de_passe: "Saisissez votre mot de passe.",
        code: "Saisissez le code à 6 chiffres de votre application.",
      },
    });
    expect(validerConfirmation({ motDePasse: "x", code: "654321", facteur: "totp" })).toEqual({
      ok: true,
      charge: { mot_de_passe: "x", code: "654321" },
    });
    expect(
      validerConfirmation({ motDePasse: "x".repeat(201), code: "654321", facteur: "totp" }).ok,
    ).toBe(false);
  });

  it("valide le mot de passe seul", () => {
    expect(validerMotDePasse("").ok).toBe(false);
    expect(validerMotDePasse("x".repeat(201)).ok).toBe(false);
    expect(validerMotDePasse("abc")).toEqual({ ok: true, charge: { mot_de_passe: "abc" } });
  });
});

describe("messages et affichage", () => {
  it("traduit les refus de gestion", () => {
    expect(messageErreurGestion(new ErreurApi("MOT_DE_PASSE_INVALIDE", "x", 401))).toBe(
      "Mot de passe incorrect.",
    );
    expect(messageErreurGestion(new ErreurApi("CODE_2FA_INVALIDE", "x", 401), "secours")).toBe(
      MESSAGE_SECOURS_INVALIDE,
    );
    expect(messageErreurGestion(new ErreurApi("TFA_NON_INITIALISEE", "x", 400))).toMatch(
      /Recommencez/,
    );
    expect(messageErreurGestion(new ErreurApi("AUTRE", "x", 500))).toBeNull();
    expect(messageErreurGestion(new Error("x"))).toBeNull();
  });

  it("filtre les rôles de la politique", () => {
    expect(rolesPolitique(["gestionnaire", "consultant", "associe", "associe"])).toEqual([
      "associe",
      "gestionnaire",
    ]);
  });

  it("groupe le secret par 4", () => {
    expect(grouperSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("produit le fichier des codes de secours", () => {
    const t = texteCodesSecours(["aaaaa-11111", "bbbbb-22222"], "a@b.ci", "6 oct. 2026");
    expect(t).toContain("Compte : a@b.ci");
    expect(t).toContain(" 1. aaaaa-11111");
    expect(t).toContain(" 2. bbbbb-22222");
  });

  it("n'offre la réinitialisation que pour une autre personne dont la 2FA est active", () => {
    expect(peutReinitialiserTfa("a", "b", true)).toBe(true);
    expect(peutReinitialiserTfa("a", "a", true)).toBe(false);
    expect(peutReinitialiserTfa("a", "b", false)).toBe(false);
  });
});

describe("reconfirmation d'identité", () => {
  it("reconnaît la demande de l'API", () => {
    expect(confirmationDemandee(new ErreurApi("CONFIRMATION_REQUISE", "x", 403))).toBe(true);
    expect(confirmationDemandee(new ErreurApi("INTERDIT", "x", 403))).toBe(false);
  });

  it("exige le mot de passe, le code restant facultatif", () => {
    expect(validerReconfirmation(SAISIE_CONFIRMATION_VIDE).ok).toBe(false);
    expect(validerReconfirmation({ ...SAISIE_CONFIRMATION_VIDE, motDePasse: "m" })).toEqual({
      ok: true,
      charge: { mot_de_passe: "m" },
    });
    expect(
      validerReconfirmation({ motDePasse: "m", code: "abcde-12345", facteur: "secours" }),
    ).toEqual({ ok: true, charge: { mot_de_passe: "m", code_secours: "abcde12345" } });
    expect(validerReconfirmation({ motDePasse: "m", code: "12", facteur: "totp" }).ok).toBe(false);
  });

  it("joint la confirmation à la charge seulement quand elle est demandée", () => {
    const v = { ok: true as const, charge: { roles_obligatoires: ["associe"] } };
    expect(avecReconfirmation(v, null)).toBe(v);
    expect(avecReconfirmation(v, { motDePasse: "m", code: "123456", facteur: "totp" })).toEqual({
      ok: true,
      charge: { roles_obligatoires: ["associe"], mot_de_passe: "m", code: "123456" },
    });
    const r = avecReconfirmation(
      { ok: false as const, erreurs: { iban: "x" } },
      SAISIE_CONFIRMATION_VIDE,
    );
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual(["iban", "mot_de_passe"]);
  });

  it("explique l'exigence d'une 2FA active chez l'auteur", () => {
    expect(messageReconfirmation(new ErreurApi("TFA_INACTIVE", "x", 409), "totp")).toMatch(
      /votre propre double authentification/,
    );
    expect(messageReconfirmation(new ErreurApi("TFA_OBLIGATOIRE", "x", 409), "totp")).toMatch(
      /obligatoire/,
    );
  });
});
