import { describe, expect, it } from "vitest";
import {
  creerTraduire,
  estLangue,
  libelleRole,
  resoudreLangue,
  ROLE_LIBELLES_EN,
  TOUS_LES_ROLES,
} from "./index";

describe("langue de l'interface", () => {
  it("le choix explicite prime sur Accept-Language", () => {
    expect(resoudreLangue("en", "fr-FR,fr;q=0.9")).toBe("en");
    expect(resoudreLangue("fr", "en-US,en;q=0.9")).toBe("fr");
  });

  it("sans choix, la première langue reconnue d'Accept-Language", () => {
    expect(resoudreLangue(undefined, "de-DE,en-GB;q=0.8,fr;q=0.5")).toBe("en");
    expect(resoudreLangue(null, "EN-us")).toBe("en");
  });

  it("à défaut, le français ; une valeur inconnue est ignorée", () => {
    expect(resoudreLangue(undefined, undefined)).toBe("fr");
    expect(resoudreLangue("es", "de-DE")).toBe("fr");
    expect(estLangue("es")).toBe(false);
  });

  it("t(fr, en) rend la version de la langue", () => {
    expect(creerTraduire("fr")("Enregistrer", "Save")).toBe("Enregistrer");
    expect(creerTraduire("en")("Enregistrer", "Save")).toBe("Save");
  });

  it("chaque rôle a un libellé anglais", () => {
    for (const role of TOUS_LES_ROLES) expect(ROLE_LIBELLES_EN[role]).toBeTruthy();
    expect(libelleRole("associe", "en")).toBe("Partner");
    expect(libelleRole("associe")).toBe("Associé");
  });
});
