import { describe, expect, it } from "vitest";
import {
  codeSecoursSchema,
  codeTotpSchema,
  connexion2faSchema,
  politiqueTfaSchema,
  tfaConfirmationSchema,
} from "../index";

describe("schémas de la double authentification", () => {
  it("code TOTP : 6 chiffres, espaces tolérés", () => {
    expect(codeTotpSchema.parse("123 456")).toBe("123456");
    expect(codeTotpSchema.safeParse("12345").success).toBe(false);
    expect(codeTotpSchema.safeParse("12345a").success).toBe(false);
  });

  it("code de secours : normalisé, 10 caractères alphanumériques", () => {
    expect(codeSecoursSchema.parse("ABCDE-fgh23")).toBe("abcdefgh23");
    expect(codeSecoursSchema.safeParse("abc").success).toBe(false);
  });

  it("exactement un second facteur", () => {
    const base = { defi: "d".repeat(43) };
    expect(connexion2faSchema.safeParse({ ...base, code: "123456" }).success).toBe(true);
    expect(connexion2faSchema.safeParse({ ...base, code_secours: "abcde-fghjk" }).success).toBe(
      true,
    );
    expect(connexion2faSchema.safeParse(base).success).toBe(false);
    expect(
      connexion2faSchema.safeParse({ ...base, code: "123456", code_secours: "abcde-fghjk" })
        .success,
    ).toBe(false);
    expect(tfaConfirmationSchema.safeParse({ mot_de_passe: "x" }).success).toBe(false);
  });

  it("politique : seuls les rôles sensibles", () => {
    expect(politiqueTfaSchema.parse({ roles_obligatoires: ["associe", "associe"] })).toEqual({
      roles_obligatoires: ["associe"],
    });
    expect(politiqueTfaSchema.safeParse({ roles_obligatoires: ["consultant"] }).success).toBe(
      false,
    );
  });
});
