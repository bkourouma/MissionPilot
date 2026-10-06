import { describe, expect, it } from "vitest";
import {
  chiffrer,
  creerTrousseau,
  dechiffrer,
  empreinte,
  trousseauDepuisConfig,
} from "../src/auth/chiffrement.js";
import {
  genererCodesSecours,
  normaliserCodeSecours,
  rolesObligatoires,
} from "../src/auth/double-authentification.js";
import {
  base32Decoder,
  base32Encoder,
  hotp,
  pasDe,
  totp,
  uriOtpauth,
  verifierTotp,
} from "../src/auth/totp.js";

const SECRET_RFC = Buffer.from("12345678901234567890", "ascii");

describe("TOTP (RFC 6238, SHA-1)", () => {
  it("vecteurs de test officiels de la RFC 6238 (annexe B, 8 chiffres)", () => {
    const vecteurs: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [t, attendu] of vecteurs) expect(totp(SECRET_RFC, t * 1000, 8)).toBe(attendu);
  });

  it("vecteurs HOTP de la RFC 4226 (annexe D, 6 chiffres)", () => {
    const attendus = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    attendus.forEach((code, i) => expect(hotp(SECRET_RFC, i)).toBe(code));
  });

  it("base32 RFC 4648 (sans remplissage), aller-retour", () => {
    expect(base32Encoder(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decoder("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decoder("mzxw 6ytb oi======").toString()).toBe("foobar");
    const s = Buffer.from(Array.from({ length: 20 }, (_, i) => i * 13));
    expect(base32Decoder(base32Encoder(s)).equals(s)).toBe(true);
    expect(() => base32Decoder("ABC1")).toThrow();
  });

  it("fenêtre de tolérance ±1 pas, refus au-delà", () => {
    const t = 1_700_000_000_000;
    const p = pasDe(t);
    expect(verifierTotp(SECRET_RFC, hotp(SECRET_RFC, p), t, null)).toBe(p);
    expect(verifierTotp(SECRET_RFC, hotp(SECRET_RFC, p - 1), t, null)).toBe(p - 1);
    expect(verifierTotp(SECRET_RFC, hotp(SECRET_RFC, p + 1), t, null)).toBe(p + 1);
    expect(verifierTotp(SECRET_RFC, hotp(SECRET_RFC, p + 2), t, null)).toBeNull();
    expect(verifierTotp(SECRET_RFC, hotp(SECRET_RFC, p - 2), t, null)).toBeNull();
    expect(verifierTotp(SECRET_RFC, "12345", t, null)).toBeNull();
    expect(verifierTotp(SECRET_RFC, "abcdef", t, null)).toBeNull();
  });

  it("anti-rejeu : un pas déjà accepté (ou antérieur) est refusé", () => {
    const t = 1_700_000_000_000;
    const p = pasDe(t);
    const code = hotp(SECRET_RFC, p);
    expect(verifierTotp(SECRET_RFC, code, t, p)).toBeNull();
    expect(verifierTotp(SECRET_RFC, hotp(SECRET_RFC, p - 1), t, p - 1)).toBeNull();
    expect(verifierTotp(SECRET_RFC, hotp(SECRET_RFC, p + 1), t, p)).toBe(p + 1);
  });

  it("URI otpauth:// conforme (SHA1, 6 chiffres, 30 s)", () => {
    const uri = uriOtpauth(SECRET_RFC, "a@exemple.test");
    expect(uri.startsWith("otpauth://totp/MissionPilot:a%40exemple.test?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe(base32Encoder(SECRET_RFC));
    expect(params.get("algorithm")).toBe("SHA1");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
    expect(params.get("issuer")).toBe("MissionPilot");
  });
});

describe("chiffrement des secrets (AES-256-GCM, HKDF)", () => {
  const t1 = creerTrousseau({ 1: "secret-maitre-numero-un-de-32-caracteres" }, 1);

  it("aller-retour, nonce unique, chiffré différent du clair", () => {
    const clair = Buffer.from("secret-totp-20-octet");
    const a = chiffrer(t1, "totp", clair, "totp:u1");
    const b = chiffrer(t1, "totp", clair, "totp:u1");
    expect(a.donnees.equals(b.donnees)).toBe(false);
    expect(a.donnees.includes(clair)).toBe(false);
    expect(dechiffrer(t1, "totp", a, "totp:u1").equals(clair)).toBe(true);
  });

  it("refuse une autre ligne (AAD), un autre usage ou un chiffré altéré", () => {
    const c = chiffrer(t1, "totp", Buffer.from("x".repeat(20)), "totp:u1");
    expect(() => dechiffrer(t1, "totp", c, "totp:u2")).toThrow();
    expect(() => dechiffrer(t1, "file_email", c, "totp:u1")).toThrow();
    const altere = Buffer.from(c.donnees);
    altere[altere.length - 1]! ^= 1;
    expect(() => dechiffrer(t1, "totp", { ...c, donnees: altere }, "totp:u1")).toThrow();
  });

  it("rotation : l'ancienne version reste lisible, la nouvelle chiffre", () => {
    const c1 = chiffrer(t1, "totp", Buffer.from("ancien-secret"), "aad");
    expect(c1.version).toBe(1);
    const t2 = creerTrousseau(
      {
        1: "secret-maitre-numero-un-de-32-caracteres",
        2: "secret-maitre-numero-deux-32-caracteres",
      },
      2,
    );
    expect(dechiffrer(t2, "totp", c1, "aad").toString()).toBe("ancien-secret");
    const c2 = chiffrer(t2, "totp", Buffer.from("ancien-secret"), "aad");
    expect(c2.version).toBe(2);
    const seulementV2 = creerTrousseau({ 2: "secret-maitre-numero-deux-32-caracteres" }, 2);
    expect(dechiffrer(seulementV2, "totp", c2, "aad").toString()).toBe("ancien-secret");
    expect(() => dechiffrer(seulementV2, "totp", c1, "aad")).toThrow("Version de clé inconnue.");
  });

  it("empreintes à clé : dépendent de la version et de l'usage", () => {
    const t2 = creerTrousseau({ 1: "a".repeat(32), 2: "b".repeat(32) }, 2);
    const e1 = empreinte(t2, "codes_secours", 1, "u:code");
    expect(e1).toMatch(/^[0-9a-f]{64}$/);
    expect(empreinte(t2, "codes_secours", 2, "u:code")).not.toBe(e1);
    expect(empreinte(t2, "totp", 1, "u:code")).not.toBe(e1);
  });

  it("trousseau de l'application : version 1 dérivée de SESSION_SECRET, mis en cache", () => {
    const config = { SESSION_SECRET: "s".repeat(32) };
    const t = trousseauDepuisConfig(config);
    expect(t.versionActuelle).toBe(1);
    expect(trousseauDepuisConfig(config)).toBe(t);
  });
});

describe("codes de secours et politique", () => {
  it("10 codes distincts au format xxxxx-xxxxx, sans caractère ambigu", () => {
    const codes = genererCodesSecours();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
    expect(normaliserCodeSecours("ABCDE-fghjk ")).toBe("abcdefghjk");
  });

  it("TOTP_REQUIS=oui ajoute les rôles sensibles à la politique du cabinet", () => {
    expect(rolesObligatoires([], { TOTP_REQUIS: "non" })).toEqual([]);
    expect(rolesObligatoires(["gestionnaire"], { TOTP_REQUIS: "non" })).toEqual(["gestionnaire"]);
    expect(rolesObligatoires([], { TOTP_REQUIS: "oui" }).sort()).toEqual(
      ["associe", "directeur_mission", "gestionnaire"].sort(),
    );
  });
});
