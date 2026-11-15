import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { traduireMessage } from "../src/i18n/langue.js";
import { MESSAGES_EN } from "../src/i18n/messages-en.js";

function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    return /\.(ts|mjs)$/.test(nom) && !nom.endsWith(".test.ts") ? [chemin] : [];
  });
}

describe("messages d'erreur bilingues", () => {
  it("le français passe tel quel ; l'anglais vient de la table ou des motifs", () => {
    expect(traduireMessage("Connexion requise.", "fr")).toBe("Connexion requise.");
    expect(traduireMessage("Connexion requise.", "en")).toBe("Sign-in required.");
    expect(traduireMessage("Mission introuvable.", "en")).toBe("Engagement not found.");
    expect(traduireMessage("Objet inconnu introuvable.", "en")).toBe("Objet inconnu not found.");
  });

  it("un message sans traduction reste en français", () => {
    expect(traduireMessage("Message jamais traduit.", "en")).toBe("Message jamais traduit.");
  });

  it("chaque clé de la table figure encore dans le code de l'API (message renommé = table à jour)", () => {
    const code = sources(join(__dirname, "../src"))
      .filter((f) => !f.includes(join("src", "i18n")))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const absents = Object.keys(MESSAGES_EN).filter((cle) => !code.includes(cle));
    expect(absents).toEqual([]);
  });
});
