import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preuveCreationSchema } from "@missionpilot/shared";
import { fournisseurSimule, SOURCE_SIMULEE } from "../src/due-diligence/donnees-ouvertes.js";

/*
 * DD-02 (OUVERT) : contrat de l'adaptateur simulé. Valeurs FICTIVES, `simule` toujours vrai, aucun
 * appel réseau, jamais branché à une route ni à la configuration, jamais présentable comme une
 * preuve.
 */

afterEach(() => vi.restoreAllMocks());

describe("fournisseur simulé", () => {
  it("renvoie des points fictifs marqués simule: true, sans aucun appel réseau", async () => {
    const fetchEspion = vi.spyOn(globalThis, "fetch");
    const points = await fournisseurSimule.rechercherIndicateur("ci", "pib");
    expect(fournisseurSimule.identifiant).toBe("simule");
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.simule).toBe(true);
      expect(p.source).toBe(SOURCE_SIMULEE);
      expect(Number.isInteger(p.valeur)).toBe(true);
    }
    expect(fetchEspion).not.toHaveBeenCalled();
  });

  it("est déterministe", async () => {
    expect(await fournisseurSimule.rechercherIndicateur("sn", "inflation")).toEqual(
      await fournisseurSimule.rechercherIndicateur("sn", "inflation"),
    );
  });

  it("n'est assignable ni à une preuve ni à un paramètre de dimensionnement", async () => {
    const [p] = await fournisseurSimule.rechercherIndicateur("ci", "pib");
    expect(preuveCreationSchema.safeParse(p).success).toBe(false);
  });
});

describe("aucun branchement", () => {
  it("le module n'est importé par aucune route ni par la configuration", () => {
    for (const dossier of ["src/routes", "src/auth", "src/http"]) {
      for (const f of readdirSync(dossier)) {
        if (!f.endsWith(".ts")) continue;
        expect(readFileSync(`${dossier}/${f}`, "utf8"), `${dossier}/${f}`).not.toContain(
          "donnees-ouvertes",
        );
      }
    }
    expect(readFileSync("src/config.ts", "utf8")).not.toContain("donnees-ouvertes");
  });

  it("le module due-diligence n'emploie ni IA ni réseau (recherche DD1)", () => {
    const motif = /orchestrateur|openrouter|ia\/|fetch\(|undici|node:https?/i;
    for (const f of readdirSync("src/due-diligence")) {
      const texte = readFileSync(`src/due-diligence/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const code = texte
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
      expect(
        code.filter((l) => motif.test(l)),
        f,
      ).toEqual([]);
    }
  });
});
