import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Le redressement ne contient ni job, ni calcul de montant dans l'API (SPEC-3a §3, principes 1 et 2 ;
 * ADR-011). Depuis le lot 2 (RED-04, causes racines proposées par l'IA), UN SEUL fichier peut
 * parler à l'IA : `redressement/causes-ia.ts`, qui passe par l'orchestrateur (`ia/orchestrateur`,
 * point d'entrée unique ADR-003) et n'importe jamais un fournisseur de modèle. Les sources de
 * `apps/api/src/redressement/` et de `apps/api/src/routes/redressement*.ts` n'importent par
 * ailleurs ni `ia/`, ni `agents/`, ni `jobs/`, ni un fournisseur, et ne contiennent ni agrégat SQL
 * ni arrondi.
 */

const RACINE = join(import.meta.dirname, "..", "src");

function sources(): { fichier: string; texte: string }[] {
  const liste: { fichier: string; texte: string }[] = [];
  for (const f of readdirSync(join(RACINE, "redressement"))) {
    if (f.endsWith(".ts"))
      liste.push({
        fichier: `redressement/${f}`,
        texte: readFileSync(join(RACINE, "redressement", f), "utf8"),
      });
  }
  for (const f of readdirSync(join(RACINE, "routes"))) {
    if (/^redressement.*\.ts$/.test(f))
      liste.push({
        fichier: `routes/${f}`,
        texte: readFileSync(join(RACINE, "routes", f), "utf8"),
      });
  }
  return liste;
}

describe("aucune IA, aucun job, aucun calcul hors moteur", () => {
  const toutes = sources();

  it("les sources du module sont bien trouvées (services et 11 fichiers de routes)", () => {
    expect(
      toutes.filter((s) => s.fichier.startsWith("redressement/")).length,
    ).toBeGreaterThanOrEqual(20);
    expect(toutes.filter((s) => s.fichier.startsWith("routes/")).length).toBe(11);
  });

  it("aucune importation de ia/, agents/, jobs/ ni d'un fournisseur (hors causes-ia.ts)", () => {
    const interdit =
      /(?:from|import)\s*\(?\s*["'][^"']*(?:\/ia\/|\/agents\/|\/jobs\/|fournisseur|openrouter)[^"']*["']/i;
    for (const s of toutes.filter((x) => x.fichier !== "redressement/causes-ia.ts")) {
      expect(interdit.test(s.texte), s.fichier).toBe(false);
    }
  });

  it("causes-ia.ts passe par l'orchestrateur et jamais par un fournisseur", () => {
    const f = toutes.find((x) => x.fichier === "redressement/causes-ia.ts");
    if (!f) return; // RED-04 pas encore livrée
    const code = f.texte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code.includes("ia/orchestrateur")).toBe(true);
    expect(/fournisseur|openrouter|LlmProvider|fetch\(/i.test(code)).toBe(false);
  });

  it("aucun agrégat SQL ni arrondi : SUM(, AVG(, Math.round, toFixed(", () => {
    for (const s of toutes) {
      for (const motif of ["SUM(", "AVG(", "Math.round", "toFixed("]) {
        expect(s.texte.includes(motif), `${s.fichier} : ${motif}`).toBe(false);
      }
    }
  });

  it("aucun appel réseau, aucune variable d'environnement, aucun fichier reçu", () => {
    for (const s of toutes) {
      for (const motif of ["fetch(", "process.env", "multipart", "http.request"]) {
        expect(s.texte.includes(motif), `${s.fichier} : ${motif}`).toBe(false);
      }
    }
  });

  it("aucun TYPE_JOB_* : le module ne planifie rien", () => {
    for (const s of toutes)
      expect(/TYPE_JOB_|REGISTRE_JOBS|planifier/i.test(s.texte), s.fichier).toBe(false);
  });
});
