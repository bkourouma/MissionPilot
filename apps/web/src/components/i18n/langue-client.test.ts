import { describe, expect, it } from "vitest";
import { langueHorsFournisseur, lireCookieLangue } from "./langue-client";

describe("lireCookieLangue", () => {
  it("trouve le cookie parmi d'autres", () => {
    expect(lireCookieLangue("a=1; mp_langue=en; b=2")).toBe("en");
    expect(lireCookieLangue("mp_langue=fr")).toBe("fr");
  });
  it("renvoie null s'il est absent ou vide", () => {
    expect(lireCookieLangue("")).toBeNull();
    expect(lireCookieLangue("autre=1")).toBeNull();
    expect(lireCookieLangue("mp_langue=")).toBeNull();
  });
});

describe("langueHorsFournisseur", () => {
  it("le cookie prime sur l'attribut lang du document", () => {
    expect(langueHorsFournisseur("mp_langue=en", "fr")).toBe("en");
    expect(langueHorsFournisseur("mp_langue=fr", "en")).toBe("fr");
  });
  it("à défaut de cookie, utilise lang du document puis le français", () => {
    expect(langueHorsFournisseur("", "en")).toBe("en");
    expect(langueHorsFournisseur("", "en-GB")).toBe("en");
    expect(langueHorsFournisseur("", null)).toBe("fr");
    expect(langueHorsFournisseur("mp_langue=xx", "de")).toBe("fr");
  });
});
