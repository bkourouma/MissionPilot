import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Garde statique du module de l'activité de démonstration (`apps/api/src/activite-demo/`, job
 * « activite_demo » ; modèle : redressement-sans-ia.test.ts). Les chiffres sortent des moteurs de
 * `packages/engines`, jamais du SQL ni d'un arrondi de l'API ; le module ne lit aucune variable
 * d'environnement, n'ouvre aucune connexion propre, n'emprunte rien aux semis de démonstration ni
 * à l'IA, n'envoie aucune notification et ne réveille pas le worker (ses suites sont différées).
 *
 * Recherche n° 31 de `.claude/rules/review-checklist.md`, à l'identique (texte complet,
 * commentaires compris) : `rg -n "tenant-demo|/seed|/ia/|notifier\(|process\.env|Math\."
 * apps/api/src/activite-demo` ne rend aucune ligne.
 */

const RACINE = join(import.meta.dirname, "..", "src", "activite-demo");

/** Fichiers du socle (territoire T3) : présents dès la première fusion. */
const SOCLE = ["acteurs.ts", "commun.ts", "lecture.ts"];

function sources(): { fichier: string; texte: string }[] {
  return readdirSync(RACINE)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({ fichier: f, texte: readFileSync(join(RACINE, f), "utf8") }));
}

/** Code sans commentaires (les chaînes restent). */
const sansCommentaires = (texte: string) =>
  texte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "");

/** Modules importés ou réexportés, et noms importés, d'un fichier. */
function imports(texte: string): { chemins: string[]; noms: string[] } {
  const chemins: string[] = [];
  const noms: string[] = [];
  const statiques = /(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of texte.matchAll(statiques)) {
    noms.push(...(m[1] ?? "").split(/[^A-Za-z0-9_$]+/).filter(Boolean));
    chemins.push(m[2] ?? "");
  }
  for (const m of texte.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) chemins.push(m[1] ?? "");
  for (const m of texte.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) chemins.push(m[1] ?? "");
  return { chemins, noms };
}

/** Appels de `nom(` dans le code (hors déclaration), avec leurs arguments complets. */
function appels(code: string, nom: string): string[] {
  const trouves: string[] = [];
  let debut = code.indexOf(`${nom}(`);
  while (debut !== -1) {
    const avant = code.slice(Math.max(0, debut - 9), debut);
    if (!/function\s+$/.test(avant)) {
      let profondeur = 0;
      let i = debut + nom.length;
      do {
        if (code[i] === "(") profondeur += 1;
        else if (code[i] === ")") profondeur -= 1;
        i += 1;
      } while (profondeur > 0 && i < code.length);
      trouves.push(code.slice(debut, i));
    }
    debut = code.indexOf(`${nom}(`, debut + nom.length);
  }
  return trouves;
}

describe("activité de démonstration : garde statique du module", () => {
  const toutes = sources();

  it("les sources du module sont trouvées (socle compris)", () => {
    const fichiers = toutes.map((s) => s.fichier);
    for (const f of SOCLE) expect(fichiers, f).toContain(f);
    expect(fichiers.length).toBeGreaterThanOrEqual(SOCLE.length);
  });

  it("recherche n° 31 : ni semis, ni IA, ni notification, ni variable d'environnement, ni arrondi", () => {
    const motif = /tenant-demo|\/seed|\/ia\/|notifier\(|process\.env|Math\./;
    for (const s of toutes) {
      const lignes = s.texte.split("\n").filter((l) => motif.test(l));
      expect(lignes, s.fichier).toEqual([]);
    }
  });

  it("aucun agrégat SQL, aucun arrondi ad hoc, aucune connexion propre", () => {
    for (const s of toutes) {
      for (const motif of ["toFixed(", "pg.Client", "new Pool(", "new Client("]) {
        expect(s.texte.includes(motif), `${s.fichier} : ${motif}`).toBe(false);
      }
      expect(/\b(sum|avg)\s*\(/i.test(s.texte), `${s.fichier} : agrégat SQL`).toBe(false);
    }
  });

  it("aucun import des semis, de l'IA, des notifications ni du signal de réveil du worker", () => {
    const chemin = /tenant-demo|seed|\/ia\/|notifier|reveil/;
    for (const s of toutes) {
      const { chemins, noms } = imports(sansCommentaires(s.texte));
      for (const c of chemins) expect(chemin.test(c), `${s.fichier} importe ${c}`).toBe(false);
      for (const n of ["signalerJobCree", "notifier", "envoyerEmails"]) {
        expect(noms, `${s.fichier} importe ${n}`).not.toContain(n);
      }
    }
  });

  it("evaluerAlertes n'est appelée qu'avec { notifier: false } (aucun e-mail de dérive)", () => {
    for (const s of toutes) {
      for (const appel of appels(sansCommentaires(s.texte), "evaluerAlertes")) {
        expect(/notifier\s*:\s*false/.test(appel), `${s.fichier} : ${appel}`).toBe(true);
      }
    }
  });

  it("aucun LIMIT littéral autre que LIMIT 1 (listes bornées par LIMIT $n, recherche n° 7)", () => {
    for (const s of toutes) {
      const litteraux = [...s.texte.matchAll(/\bLIMIT\s+(\d+)/g)].map((m) => m[1]);
      expect(
        litteraux.filter((n) => n !== "1"),
        s.fichier,
      ).toEqual([]);
    }
  });

  it("socle : un gabarit SQL n'interpole que des constantes (MAJUSCULES)", () => {
    for (const s of toutes.filter((x) => SOCLE.includes(x.fichier))) {
      const code = sansCommentaires(s.texte);
      for (const m of code.matchAll(/\.query\(\s*`([^`]*)`/g)) {
        const expressions = [...(m[1] ?? "").matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]);
        for (const e of expressions) {
          expect(/^[A-Z][A-Z0-9_]*$/.test(e ?? ""), `${s.fichier} : \${${e}}`).toBe(true);
        }
      }
    }
  });

  it("socle : les points de sauvegarde sont des chaînes constantes, jamais un gabarit", () => {
    const commun = toutes.find((s) => s.fichier === "commun.ts");
    const code = sansCommentaires(commun?.texte ?? "");
    expect(code).not.toMatch(/SAVEPOINT \$\{/);
    for (const nom of [
      "ad_prolongation",
      "ad_feuille",
      "ad_derive",
      "ad_alertes",
      "ad_jalon",
      "ad_facture",
      "ad_facture_source",
      "ad_encaissement",
    ]) {
      expect(code, nom).toContain(`"SAVEPOINT ${nom}"`);
      expect(code, nom).toContain(`"RELEASE SAVEPOINT ${nom}"`);
      expect(code, nom).toContain(`"ROLLBACK TO SAVEPOINT ${nom}"`);
    }
  });
});
