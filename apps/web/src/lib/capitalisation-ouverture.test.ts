import { describe, expect, it } from "vitest";
import {
  cheminAnalyseDerogations,
  cheminMissionsSansRetour,
  hrefMissionsSansRetour,
  hrefRetour,
  lireSeuilDerogations,
  peutOuvrirRetour,
  SEUIL_DEROGATIONS_MAX,
  SEUIL_DEROGATIONS_MIN,
} from "./capitalisation";

/* Ouverture du retour d'expérience (rattrapage) et seuil de l'analyse des dérogations. */

const moi = "u-moi";

describe("qui peut ouvrir le retour d'expérience", () => {
  const mission = { chef_id: "u-chef", directeur_id: "u-directeur" };

  it("l'associé, le chef et le directeur de la mission (avec mission.planifier)", () => {
    expect(peutOuvrirRetour({ roles: ["associe"], utilisateurId: moi }, mission)).toBe(true);
    expect(peutOuvrirRetour({ roles: ["chef_mission"], utilisateurId: "u-chef" }, mission)).toBe(
      true,
    );
    expect(
      peutOuvrirRetour({ roles: ["directeur_mission"], utilisateurId: "u-directeur" }, mission),
    ).toBe(true);
  });

  it("pas un chef d'une autre mission, ni un rôle sans mission.planifier", () => {
    expect(peutOuvrirRetour({ roles: ["chef_mission"], utilisateurId: moi }, mission)).toBe(false);
    expect(peutOuvrirRetour({ roles: ["consultant"], utilisateurId: "u-chef" }, mission)).toBe(
      false,
    );
    expect(
      peutOuvrirRetour(
        { roles: ["chef_mission"], utilisateurId: moi },
        { chef_id: null, directeur_id: null },
      ),
    ).toBe(false);
  });
});

describe("liste de rattrapage et liens", () => {
  it("chemins et liens", () => {
    expect(cheminMissionsSansRetour(null)).toBe("/api/capitalisation/retours/a-ouvrir?limite=30");
    expect(cheminMissionsSansRetour("c=1", 5)).toBe(
      "/api/capitalisation/retours/a-ouvrir?limite=5&curseur=c%3D1",
    );
    expect(hrefMissionsSansRetour(null)).toBe("/connaissances/retours");
    expect(hrefMissionsSansRetour("a b")).toBe("/connaissances/retours?a_ouvrir=a%20b");
    expect(hrefRetour("r 1")).toBe("/connaissances/retours/r%201");
  });
});

describe("seuil d'analyse des dérogations", () => {
  it("vide : seuil par défaut du cabinet", () => {
    expect(lireSeuilDerogations(undefined)).toEqual({ ok: true, charge: { seuil: null } });
    expect(lireSeuilDerogations("  ")).toEqual({ ok: true, charge: { seuil: null } });
    expect(cheminAnalyseDerogations(null)).toBe("/api/capitalisation/derogations/analyse");
  });

  it("accepte les bornes de l'API", () => {
    expect(lireSeuilDerogations(String(SEUIL_DEROGATIONS_MIN))).toEqual({
      ok: true,
      charge: { seuil: 2 },
    });
    expect(lireSeuilDerogations(String(SEUIL_DEROGATIONS_MAX))).toEqual({
      ok: true,
      charge: { seuil: 100 },
    });
    expect(lireSeuilDerogations(["5", "9"])).toEqual({ ok: true, charge: { seuil: 5 } });
    expect(cheminAnalyseDerogations(5)).toBe("/api/capitalisation/derogations/analyse?seuil=5");
  });

  it("refuse hors bornes ou non entier avec un message lisible", () => {
    for (const v of ["1", "0", "-3", "101", "2.5", "abc", "1e2", "٣"]) {
      const r = lireSeuilDerogations(v);
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.erreurs.seuil).toBe("Indiquez un nombre entier de missions de 2 à 100.");
    }
  });
});
